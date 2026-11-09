import type { NextConfig } from 'next';

// Set by the Dockerfile. Keeps `next build` within reach of small machines such as a
// Raspberry Pi 2B (1 GB RAM): one build worker, webpack memory optimisations, and no
// type check during the build (run `npm run typecheck` on your development machine instead).
const lowMemory = process.env.BAMBU_LOW_MEMORY === '1';

const nextConfig: NextConfig = {
  // Self-contained server in .next/standalone, used by the Docker image.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // mqtt and socket.io-client (AFFiNE sync) use Node modules (net/tls, ws); load them from node_modules
  // instead of bundling them. yjs must exist only once, or it warns and its documents misbehave.
  serverExternalPackages: ['mqtt', 'socket.io-client', 'yjs'],
  // There may be a package-lock.json further up the directory tree; pin the project root explicitly.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // The service worker must never be cached, or updates would never reach installed apps.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
  ...(lowMemory && {
    typescript: { ignoreBuildErrors: true },
    productionBrowserSourceMaps: false,
    experimental: { cpus: 1, workerThreads: false, webpackMemoryOptimizations: true },
  }),
};

export default nextConfig;
