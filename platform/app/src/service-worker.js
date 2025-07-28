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
const isLocalDevelopment = self.location.hostname === 'localhost' || 
                           self.location.hostname === '127.0.0.1' || 
                           self.location.hostname.includes('local') ||
                           self.location.port === '3000' ||
                           self.location.port === '3001';

// Install newest
// https://developers.google.com/web/tools/workbox/modules/workbox-core
workbox.core.skipWaiting();
workbox.core.clientsClaim();

// Cache JS/CSS bundles - NetworkFirst for development, CacheFirst for production
workbox.routing.registerRoute(
  /\.(?:js|css|json5)$/,
  isLocalDevelopment 
    ? new workbox.strategies.NetworkFirst({
        cacheName: STATIC_CACHE,
        plugins: [
          new workbox.cacheableResponse.CacheableResponsePlugin({
            statuses: [0, 200],
          }),
          new workbox.expiration.ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 24 * 60 * 60, // 1 day in development
          }),
        ],
      })
    : new workbox.strategies.CacheFirst({
        cacheName: STATIC_CACHE,
        plugins: [
          new workbox.cacheableResponse.CacheableResponsePlugin({
            statuses: [0, 200],
          }),
          new workbox.expiration.ExpirationPlugin({
            maxEntries: 100,
            maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days in production
          }),
        ],
      })
);

// Cache images and fonts for 3 months (change less frequently)
workbox.routing.registerRoute(
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot)$/,
  new workbox.strategies.CacheFirst({
    cacheName: `assets-${CACHE_VERSION}`,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new workbox.expiration.ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 90 * 24 * 60 * 60, // 90 days
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
          if (!cacheName.includes(CACHE_VERSION)) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Listen for cache clear messages from cacheManager
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_ALL_CACHES') {
    console.log('🧹 Clearing all caches for version update...');
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            console.log('🗑️ Deleting cache for update:', cacheName);
            return caches.delete(cacheName);
          })
        );
      })
    );
  }
});

// Exclude version.json from precaching and runtime caching
workbox.precaching.precacheAndRoute(
  self.__WB_MANIFEST.filter(entry => !entry.url.includes('version.json'))
);

// Never cache version.json - critical for update detection
workbox.routing.registerRoute(
  /\/version\.json/,
  new workbox.strategies.NetworkOnly()
);

// TODO: Cache API
// https://developers.google.com/web/fundamentals/instant-and-offline/web-storage/cache-api
// Store DICOMs?
// Clear Service Worker cache?
// navigator.storage.estimate().then(est => console.log(est)); (2GB?)
