import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Port 3000 matches the OAuth redirect URL (http://localhost:3000/auth/callback).
export default defineConfig({
  plugins: [
    react(),
    // Installable app + offline shell. The service worker precaches the built
    // app; map tiles are cached as you view them (bounded, per OSM tile policy:
    // no bulk prefetching). API and WebSocket traffic is never cached.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'G-Map · Live Location Tracking',
        short_name: 'G-Map',
        description: 'Share your live location with a group: routes, ETA, zone alerts and trip replay.',
        theme_color: '#2563eb',
        background_color: '#f6f7f9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/public\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 3000, strictPort: true },
  preview: { port: 3000, strictPort: true },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
