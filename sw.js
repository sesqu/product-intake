const CACHE='product-intake-v43';
const ASSETS=['./','./index.html','./manifest.webmanifest','./version.json','./styles.css?v=43','./intake-core.js?v=43','./product-storage.js?v=2','./pwa-updates.js?v=43','./modal-ui.js?v=43','./navigation.js?v=43','./cloud-products.js?v=43','./catalog-lookup.js?v=43','./intake-session.js?v=43','./secondary-views.js?v=43','./product-list.js?v=43','./product-editor.js?v=43','./product-finder.js?v=43','./product-research.js?v=43','./enhancements.js?v=43'];

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
