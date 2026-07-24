const CACHE_NAME = 'urban-vibe-reconcile-v29';
const STATIC_ASSETS = [
  '/public/vendor/bootstrap/bootstrap.min.css',
  '/public/vendor/bootstrap/bootstrap.bundle.min.js',
  '/public/css/app.css',
  '/public/js/main.js',
  '/public/icons/urban-vibe-favicon.png',
  '/public/icons/urban-vibe-pwa-dark.png',
  '/public/icons/urban-vibe-logo-light.png',
  '/public/icons/urban-vibe-logo-dark.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith('/public/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => new Response(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Urban Vibe Reconcile</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(180deg,#f8fafc,#eef2ff);color:#111827}main{min-height:100vh;display:grid;place-items:center;padding:1.25rem}.panel{width:min(34rem,100%);background:#fff;border:1px solid rgba(34,33,63,.12);border-radius:1.25rem;box-shadow:0 18px 40px rgba(15,23,42,.1);padding:1.5rem}.eyebrow{margin:0 0 .5rem;color:#6b7280;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:.25rem 0 .75rem;font-size:1.7rem;line-height:1.15;color:#22213f}p{margin:0 0 1rem;color:#4b5563;line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}.btn{appearance:none;border:0;border-radius:999px;padding:.8rem 1.1rem;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:.45rem}.btn-primary{background:#cf8464;color:#fff;box-shadow:0 10px 18px rgba(207,132,100,.22)}.btn-secondary{background:#f8fafc;color:#1e293b;border:1px solid #cbd5e1}.hint{font-size:.88rem;color:#6b7280}</style></head><body><main><section class="panel" role="status" aria-live="polite"><p class="eyebrow">Urban Vibe Reconcile</p><h1>You are offline</h1><p>Reconnect to continue working with live reconciliation data.</p><p class="hint">If you are back online, tap retry to load the live app again.</p><div class="actions"><button class="btn btn-primary" type="button" onclick="location.reload()">Try again</button><a class="btn btn-secondary" href="/">Open My Work</a></div></section></main></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      ))
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/shop-floor?refresh=true';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
