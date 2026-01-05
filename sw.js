const cacheName = 'wordplay-v1';
const assetsToCache = [
  './',
  './index.html',
  './wordplay.css',
  './wordplay.js',
  './manifest.json',
  './gemini/icon.svg'
];

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
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});
