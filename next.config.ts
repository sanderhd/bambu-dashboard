import type { NextConfig } from 'next';

// Set by the Dockerfile. Keeps `next build` within reach of small machines such as a
// Raspberry Pi 2B (1 GB RAM): one build worker, webpack memory optimisations, and no
// type check during the build (run `npm run typecheck` on your development machine instead).
const lowMemory = process.env.BAMBU_LOW_MEMORY === '1';

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the Docker image.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // mqtt uses Node modules (net/tls); load it from node_modules instead of bundling it.
  serverExternalPackages: ['mqtt'],
  // There may be a package-lock.json further up the directory tree; pin the project root explicitly.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  ...(lowMemory && {
    typescript: { ignoreBuildErrors: true },
    productionBrowserSourceMaps: false,
    experimental: { cpus: 1, workerThreads: false, webpackMemoryOptimizations: true },
  }),
};

export default nextConfig;
