const CACHE_NAME = 'gsm-call-bridge-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/audio-manager.js',
    './js/webrtc-client.js',
    './js/dialer.js',
    './js/app.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request).catch(() => {
                return caches.match('./index.html');
            });
        })
    );
});
