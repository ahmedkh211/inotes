const VERSION = 'inotes-v1.3.0';
const CACHE_NAME = 'inotes-' + VERSION;
const APP_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-48.png',
  './favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_ASSETS);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) {}
    }
  })());
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const hit = await caches.match('./index.html', { ignoreSearch: true });
        if (hit) return hit;
        return await fetch(req);
      } catch (e) {
        try { return await fetch(req); } catch (e2) {
          return new Response('<h1>iNotes</h1><p>لا يوجد اتصال بالإنترنت.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 });
        }
      }
    })());
    return;
  }

  if (req.destination && !['', 'document', 'style', 'script', 'image', 'font', 'manifest', 'other'].includes(req.destination)) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: false });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && (url.origin === self.location.origin)) {
        if (url.pathname.includes('/dev/')) return res;
        if (isAppAssetPath(url.pathname)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, res.clone());
        }
      }
      return res;
    } catch (e) {
      const fallback = await caches.match('./index.html', { ignoreSearch: true });
      if (fallback) return fallback;
      throw e;
    }
  })());
});

function isAppAssetPath(pathname) {
  return /\/(index\.html|styles\.css|app\.js|sw\.js|manifest\.webmanifest)$/i.test(pathname) || /\/icons\//i.test(pathname);
}
