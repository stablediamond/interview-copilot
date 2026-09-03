/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Electron loads http://127.0.0.1 (not localhost) so IPv6 ::1 never blanks
  // the window. Next 16 blocks that as a cross-origin HMR request otherwise.
  allowedDevOrigins: ["127.0.0.1"],
  // Custom webpack is still required: Edge compilation of instrumentation.ts
  // otherwise follows Node fs/Prisma imports and 500s GET /. Next 16 defaults
  // to Turbopack, so `next dev` / `next build` pass `--webpack`.
  webpack: (config, { nextRuntime, webpack }) => {
    // instrumentation.ts dynamically imports migrate-runtime (Node fs + Prisma).
    // Next also compiles that graph for Edge, which has no `fs` and 500s GET /.
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.IgnorePlugin({
          resourceRegExp: /(migrate-runtime|instrumentation\.node)/,
        })
      );
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        path: false,
      };
    }
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    return config;
  },
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
};

export default nextConfig;
