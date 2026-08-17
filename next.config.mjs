/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a self-contained server in `.next/standalone` that the Electron
  // desktop build can run without npm/node_modules present.
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "@prisma/client", "prisma"],
  // Ensure the Prisma client + query engine and schema are traced into the
  // standalone bundle so the packaged app can reach the database.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
      "./prisma/schema.prisma",
      // Bundled so the runtime migration applier can upgrade the user's DB.
      "./prisma/migrations/**",
    ],
  },
  eslint: {
    // Linting is run separately via `npm run lint`; don't block production builds.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
