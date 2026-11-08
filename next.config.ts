import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // mqtt uses Node modules (net/tls); load it from node_modules instead of bundling it.
  serverExternalPackages: ['mqtt'],
  // There is a package-lock.json further up the directory tree; pin the project root explicitly.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
