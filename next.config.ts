import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Next clones the request body when proxy/middleware runs (default 10MB, silent truncate).
    proxyClientMaxBodySize: "200mb",
  },
  serverExternalPackages: ["ssh2", "@prisma/client", "pg", "exceljs"],
  outputFileTracingIncludes: {
    "/api/phones/export": ["./ops/templates/**/*"],
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
