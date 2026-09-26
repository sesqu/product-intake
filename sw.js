const CACHE='product-intake-v29';
const ASSETS=['./','./index.html','./manifest.webmanifest','./version.json','./styles.css?v=29','./intake-core.js?v=29','./product-storage.js?v=2','./pwa-updates.js?v=29','./navigation.js?v=29','./cloud-products.js?v=29','./catalog-lookup.js?v=29','./secondary-views.js?v=29','./product-editor.js?v=29','./enhancements.js?v=29'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
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
