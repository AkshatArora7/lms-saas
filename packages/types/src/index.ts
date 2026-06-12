/**
 * Shared domain types for the LMS platform.
 * These mirror the canonical database schema (see /database/schema.sql).
 */

// ── Tenancy ────────────────────────────────────────────────
export type TenantTier = "pool" | "silo";
export type TenantStatus = "active" | "suspended" | "provisioning" | "deleted";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  tier: TenantTier;
  status: TenantStatus;
  region: string;
  /** For silo tenants: connection string ref resolved from secret store. */
  databaseRef: string | null;
  createdAt: string;
}

/** Request-scoped tenant context propagated through every service call. */
export interface TenantContext {
  tenantId: string;
  tier: TenantTier;
  /** Resolved DB URL (pool = shared; silo = dedicated). */
  databaseUrl: string;
}

// ── Org-unit hierarchy (Brightspace-style) ─────────────────
export type OrgUnitType =
  | "organization"
  | "department"
  | "semester"
  | "course_template"
  | "course_offering"
  | "section"
  | "group";

export interface OrgUnit {
  id: string;
  tenantId: string;
  type: OrgUnitType;
  parentId: string | null;
  name: string;
  code: string | null;
  isActive: boolean;
}

// ── Identity & RBAC ────────────────────────────────────────
export interface User {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  status: "active" | "inactive" | "invited";
}

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  isSystem: boolean;
}

/** Granular, tool-scoped permission (e.g. "discussions:posts:manage"). */
export type Permission = string;

export interface RoleAssignment {
  userId: string;
  roleId: string;
  orgUnitId: string;
  /** When true, applies to all descendant org units. */
  cascade: boolean;
}

// ── Standard personas mapped to OneRoster / LTI 1.3 roles ──
export type StandardRole =
  | "learner"
  | "instructor"
  | "teaching_assistant"
  | "course_builder"
  | "observer"
  | "org_admin"
  | "super_admin";
