const CACHE_NAME = 'dds-v6'; // bumped: excludes the signed-in Presence app surfaces (today/connections/visual-studio/presence) from cache-first — purges any stale app shells
const PRECACHE = [
  '/about',
  '/services',
  '/work',
  '/contact',
  '/manifest.json',
  '/404.html'
];

// Pages that must always load fresh (have live API calls or dynamic content)
const NETWORK_FIRST = ['/audit', '/tools', '/report-card', '/speed-test', '/local-visibility', '/pricing-estimator', '/roi-calculator', '/'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // NEVER intercept the logged-in surfaces or the research instrument.
  // The admin tool and portal are living apps; serving them stale is a
  // correctness bug, not a performance win. Let the browser hit the network.
  if (url.pathname.startsWith('/portal') || url.pathname.includes('supabase')) return;
  if (url.pathname.startsWith('/dds-studio-manage')) return;
  if (url.pathname === '/dp-mode.js') return;
  if (url.pathname === '/config.js') return; // per-deployment config must NEVER be cache-served
  if (url.pathname.startsWith('/set-password')) return;
  // The signed-in Presence app surfaces are living apps too — never serve them
  // stale (they load live data via the API; a cached shell after a deploy is a
  // correctness bug). Let the browser hit the network.
  if (url.pathname.startsWith('/presence') || url.pathname.startsWith('/today') ||
      url.pathname.startsWith('/connections') || url.pathname.startsWith('/visual-studio') ||
      url.pathname.startsWith('/client') || url.pathname.startsWith('/agency') || url.pathname.startsWith('/sharing')) return;

  // Network-first for dynamic/tool pages — always fetch fresh, fall back to cache
  var isNetworkFirst = NETWORK_FIRST.some(function(p) { return url.pathname === p || url.pathname === p + '.html'; });
  if (isNetworkFirst) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }

  // Cache-first for everything else (static marketing assets/pages)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var networkFetch = fetch(e.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      });
      return cached || networkFetch;
    })
  );
});
