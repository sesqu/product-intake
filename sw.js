const CACHE='product-intake-v38';
const ASSETS=['./','./index.html','./manifest.webmanifest','./version.json','./styles.css?v=38','./intake-core.js?v=38','./product-storage.js?v=2','./pwa-updates.js?v=38','./modal-ui.js?v=38','./navigation.js?v=38','./cloud-products.js?v=38','./catalog-lookup.js?v=38','./intake-session.js?v=38','./secondary-views.js?v=38','./product-list.js?v=38','./product-editor.js?v=38','./enhancements.js?v=38'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(
        ASSETS.map(async asset => {
          const hit = await cache.match(asset);
          if (!hit) await cache.add(asset);
        })
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(new Request(event.request, {cache:'no-store'}))
        .catch(() => caches.match('./version.json'))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(new Request(event.request, {cache:'no-store'}))
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
