import type { MetadataRoute } from 'next';

// Web app manifest: makes the dashboard installable as an app (needs HTTPS, e.g. via Nginx Proxy Manager).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bambu Dashboard',
    short_name: 'Bambu',
    description: 'Live status, cameras and projects for your Bambu Lab printer',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#111315',
    theme_color: '#111315',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Projects', url: '/projects', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Stats', url: '/stats', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
