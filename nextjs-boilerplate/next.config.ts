import type { NextConfig } from "next";

const authServiceUrl =
  process.env.AUTH_SERVICE_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: `${authServiceUrl}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
