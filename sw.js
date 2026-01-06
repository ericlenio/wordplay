const cacheName = 'wordplay-v2';
const assetsToCache = [
  './',
  './index.html',
  './wordplay.css',
  './wordplay.js',
  './manifest.json',
  './gemini/icon.svg'
];

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Install event: cache the assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => {
        return cache.addAll(assetsToCache);
      })
  );
});

// Fetch event: serve assets from cache, or fetch from network
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).then(response => {
      // If we get a valid response, cache it and return it
      if (response && response.status === 200) {
        const responseToCache = response.clone();
        caches.open(cacheName).then(cache => {
          cache.put(event.request, responseToCache);
        });
      }
      return response;
    }).catch(() => {
      // If the network request fails, fall back to the cache
      return caches.match(event.request);
    })
  );
});

// Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== cacheName) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});
