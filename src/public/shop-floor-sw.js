const CACHE_NAME = 'urban-vibe-shop-floor-pwa-v2';
const STATIC_ASSETS = [
  '/public/vendor/bootstrap/bootstrap.min.css',
  '/public/vendor/bootstrap/bootstrap.bundle.min.js',
  '/public/css/app.css',
  '/public/js/main.js',
  '/public/icons/odoo-shop-floor-192.png',
  '/public/icons/odoo-shop-floor-512.png',
  '/public/shop-floor/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('urban-vibe-shop-floor-pwa-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Always network-first for live Shop Floor pages and JSON endpoints
  if (
    request.mode === 'navigate' ||
    url.pathname.startsWith('/public/shop-floor') ||
    url.pathname.startsWith('/public-shop-floor') ||
    url.pathname.startsWith('/shop-floor') ||
    url.pathname.startsWith('/public/board-logs')
  ) {
    event.respondWith(
      fetch(request).catch(() => new Response(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SHOP FLOOR</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f0f2f5;color:#1e293b;display:grid;place-items:center;min-height:100vh;padding:1.25rem}.card{max-width:28rem;width:100%;background:#fff;border-radius:1rem;padding:1.5rem;box-shadow:0 14px 32px rgba(15,23,42,.12);text-align:center}h1{margin:0 0 .5rem;color:#714B67;font-size:1.35rem}p{margin:0 0 1rem;color:#64748b;font-size:.92rem}button{background:#714B67;color:#fff;border:0;border-radius:999px;padding:.65rem 1.35rem;font-weight:700;cursor:pointer}</style></head><body><div class="card"><h1>SHOP FLOOR Offline</h1><p>Reconnect to the network to sync live Odoo work orders.</p><button onclick="location.reload()">Retry</button></div></body></html>',
        { headers: { 'Content-Type': 'text/html' } },
      )),
    );
    return;
  }

  // Cache-first for static assets only
  if (
    url.pathname.startsWith('/public/vendor/') ||
    url.pathname.startsWith('/public/css/') ||
    url.pathname.startsWith('/public/js/') ||
    url.pathname.startsWith('/public/icons/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
