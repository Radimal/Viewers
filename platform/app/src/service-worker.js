navigator.serviceWorker.getRegistrations().then(function (registrations) {
  for (let registration of registrations) {
    registration.unregister();
  }
});

// https://developers.google.com/web/tools/workbox/guides/troubleshoot-and-debug
importScripts('https://storage.googleapis.com/workbox-cdn/releases/5.0.0-beta.1/workbox-sw.js');

// Add version-based cache busting
const CACHE_VERSION = new Date().toISOString().split('T')[0]; // Use date as version
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const FONTS_CACHE = `fonts-${CACHE_VERSION}`;

// Detect environment - development vs production
const isLocalDevelopment =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.hostname.includes('local') ||
  self.location.port === '3000' ||
  self.location.port === '3001';

// Install newest
// https://developers.google.com/web/tools/workbox/modules/workbox-core
workbox.core.skipWaiting();
workbox.core.clientsClaim();

// Cache static assets that aren't precached
workbox.routing.registerRoute(
  /\.(?:js|css|json5)$/,
  new workbox.strategies.NetworkFirst({
    cacheName: STATIC_CACHE,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 24 * 60 * 60, // 24 hours
      }),
    ],
  })
);

// Cache the Google Fonts stylesheets with a stale-while-revalidate strategy.
workbox.routing.registerRoute(
  /^https:\/\/fonts\.googleapis\.com/,
  new workbox.strategies.StaleWhileRevalidate({
    cacheName: FONTS_CACHE,
  })
);

// Cache the underlying font files with a cache-first strategy for 1 year.
workbox.routing.registerRoute(
  /^https:\/\/fonts\.gstatic\.com/,
  new workbox.strategies.CacheFirst({
    cacheName: FONTS_CACHE,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 Year
        maxEntries: 30,
      }),
    ],
  })
);

// MESSAGE HANDLER
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    self.clients.claim();
  }
});

// Clear old caches on activation
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheName.startsWith(CACHE_VERSION)) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Use the manifest for precaching
workbox.precaching.precacheAndRoute(self.__WB_MANIFEST);

// TODO: Cache API
// https://developers.google.com/web/fundamentals/instant-and-offline/web-storage/cache-api
// Store DICOMs?
// Clear Service Worker cache?
// navigator.storage.estimate().then(est => console.log(est)); (2GB?)
