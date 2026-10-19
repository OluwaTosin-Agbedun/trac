import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Mount under an existing site route (e.g. /tracker) once the Athena site's hosting is known.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  // PGlite loads a WASM build of Postgres at runtime; keep it out of the server bundle.
  // (pg is externalised by Next automatically.)
  serverExternalPackages: ["@electric-sql/pglite", "exceljs", "jszip"],
  experimental: {
    serverActions: {
      // Import uploads are small TSV/CSV files; allow some headroom over the 1MB default.
      bodySizeLimit: "4mb",
    },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
