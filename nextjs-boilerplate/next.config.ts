import type { NextConfig } from "next";

const authServiceUrl =
  process.env.AUTH_SERVICE_URL ?? "http://localhost:4000";
const projectServiceUrl =
  process.env.PROJECT_SERVICE_URL ?? "http://localhost:3000";
const executionServiceUrl = process.env.EXECUTION_SERVICE_URL ?? "http://127.0.0.1:5002";

const nextConfig: NextConfig = {
  // AI fetches have a 90s deadline; Next's default 30s rewrite timeout must not cut them off.
  // Keep a finite proxy deadline below the browser client's 100s deadline.
  experimental: { proxyTimeout: 95_000 },
  async rewrites() {
    return [
      { source: "/api/conversations", destination: `${projectServiceUrl}/api/conversations` },
      { source: "/api/runs/:path*", destination: `${executionServiceUrl}/api/runs/:path*` },
      {
        source: "/api/auth/:path*",
        destination: `${authServiceUrl}/api/auth/:path*`,
      },
      {
        source: "/api/projects/:path*",
        destination: `${projectServiceUrl}/api/projects/:path*`,
      },
    ];
  },
};

export default nextConfig;
