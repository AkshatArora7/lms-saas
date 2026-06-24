# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# Shared base + workspace-deps image for the LMS mesh (#369, lever L5).
#
# Today every buildable image (27 services + apps/web + apps/admin + the seed
# job) carried a byte-shaped-identical `base` -> `manifests` -> `deps` triplet
# and re-ran a full `pnpm install --frozen-lockfile` of the WHOLE workspace.
# #299 (PR #368) shared the pnpm STORE via a BuildKit cache mount, but the
# install WORK (linking ~550 packages into node_modules) was still re-executed
# per image and the resulting `deps` layer was never reused as a layer.
#
# L5 builds that deps stage ONCE here, as a single image, and every service /
# app Dockerfile does `FROM ${BASE_IMAGE}` for both its build and runtime
# stages, reusing the install as a shared layer.
#
# Build it (BuildKit on) before building any service image:
#   docker build -f docker/base.Dockerfile -t lms-base-deps:local .
#   (npm script shortcut: `pnpm build:base`; `pnpm start:build` runs it first.)
#
# openssl + ca-certificates are standardized HERE for ALL images. Previously 7
# prisma services (ai, gateway, lti, mobile-bff, reporting, sis, video) ran
# `prisma generate` WITHOUT installing openssl, relying on whatever shipped in
# node:20-slim. Centralizing the toolchain removes that drift: every image now
# has the OpenSSL 3.0 (Debian bookworm) libs Prisma selects at generate-time and
# needs (libssl) at runtime.
# -----------------------------------------------------------------------------
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Prisma needs OpenSSL both at build time (so `prisma generate` selects the
# engine matching node:20-slim = Debian bookworm / OpenSSL 3.0) and at runtime
# (libssl). Without it Prisma fails with "cannot find libssl.so.1.1" or an
# engine-target mismatch (generated debian-openssl-1.1.x vs runtime 3.0.x).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# manifests: extract ONLY package manifests + lockfile so the deps layer is
# reused across source-only changes (node_modules already excluded by
# .dockerignore).
FROM base AS manifests
COPY . /tmp/ctx
RUN cd /tmp/ctx \
 && find . -type f \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml \) -print \
    | xargs -I{} cp --parents {} /app/

# deps: install the full workspace from manifests only, with a cached pnpm store.
# This is the single, shared install. Consumers `FROM` this image's `deps` stage.
FROM base AS deps
COPY --from=manifests /app ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
