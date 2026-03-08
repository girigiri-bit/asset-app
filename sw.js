// ============================================================
// sw.js — Network-First Service Worker with Versioned Cache
// ============================================================
// HOW CACHE VERSIONING WORKS:
//   - CACHE_NAME contains a version string (e.g. "v2").
//   - On activation, old caches with different names are deleted.
//   - To force all users to re-download assets, bump the version
//     (e.g. "v2" → "v3") and deploy. The new SW will install,
//     skip waiting, claim clients, and purge old caches.
// ============================================================

const CACHE_NAME = 'assetfolio-cache-v2';

// Core assets to pre-cache on install
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json'
];

// --- Install: Pre-cache core assets, then skip waiting ---
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_ASSETS))
            .then(() => self.skipWaiting()) // Activate immediately
    );
});

// --- Activate: Delete old caches, then claim clients ---
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME) // Keep only current version
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim()) // Take control of all open tabs
    );
});

// --- Fetch: Network-First Strategy ---
// 1. Try the network first (always get the freshest content)
// 2. If network succeeds, update the cache with the fresh response
// 3. If network fails (offline), fall back to cached response
self.addEventListener('fetch', (event) => {
    // Only handle GET requests; let others pass through
    if (event.request.method !== 'GET') return;

    // Skip non-http(s) requests (e.g. chrome-extension://)
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Network succeeded — clone and cache for offline fallback
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return networkResponse;
            })
            .catch(() => {
                // Network failed — try the cache
                return caches.match(event.request);
            })
    );
});
