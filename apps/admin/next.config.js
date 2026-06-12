/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lms/types"],
  experimental: { typedRoutes: true },
};

module.exports = nextConfig;
