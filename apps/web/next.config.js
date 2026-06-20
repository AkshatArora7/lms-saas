/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: ["@lms/types"],
  experimental: { typedRoutes: true },
};

module.exports = nextConfig;
