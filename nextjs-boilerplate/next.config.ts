import type { NextConfig } from "next";

const authServiceUrl =
  process.env.AUTH_SERVICE_URL ?? "http://localhost:4000";
const projectServiceUrl =
  process.env.PROJECT_SERVICE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
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
