const CACHE_NAME = 'dds-v14'; // bumped: studio door + every app/token page excluded from cache-first — a stale signing page is a correctness bug
const PRECACHE = [
  '/about',
  '/services',
  '/work',
  '/contact',
  '/manifest.json',
  '/404.html'
];

// Pages that must always load fresh (have live API calls or dynamic content)
const NETWORK_FIRST = ['/audit', '/tools', '/report-card', '/local-visibility', '/pricing-estimator', '/roi-calculator', '/'];

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
      url.pathname.startsWith('/client') || url.pathname.startsWith('/agency') || url.pathname.startsWith('/sharing') ||
      url.pathname.startsWith('/developer') || url.pathname.startsWith('/crm') ||
      url.pathname.startsWith('/shell') || url.pathname.startsWith('/approve') ||
      url.pathname.startsWith('/leads') || url.pathname.startsWith('/schedule') ||
      url.pathname.startsWith('/get-started') ||
      url.pathname.startsWith('/studio') ||            // the owner front door — never stale
      url.pathname.startsWith('/sign') ||              // contract/proposal signing + signup — stale = correctness bug
      url.pathname.startsWith('/project-survey') || url.pathname.startsWith('/welcome') ||
      url.pathname.startsWith('/provision') || url.pathname.startsWith('/pipeline') ||
      url.pathname.startsWith('/contacts') || url.pathname.startsWith('/projects') ||
      url.pathname.startsWith('/inbox') || url.pathname.startsWith('/files') ||
      url.pathname.startsWith('/analytics') || url.pathname.startsWith('/attention') ||
      url.pathname.startsWith('/approval-center') || url.pathname.startsWith('/business-insights') ||
      url.pathname.startsWith('/content-tree') || url.pathname.startsWith('/snapshot-history') ||
      url.pathname.startsWith('/timeline') || url.pathname.startsWith('/upcoming') ||
      url.pathname.startsWith('/website-health') || url.pathname.startsWith('/help') ||
      url.pathname.startsWith('/admin-health') || url.pathname.startsWith('/admin-growth') ||
      url.pathname === '/pricing' || url.pathname === '/pricing.html' ||   // exact — /pricing-estimator keeps its NETWORK_FIRST rule
      url.pathname.startsWith('/payment-')) return; // every signed-in/app/money surface — always fresh

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

// ── Web Push (Studio OS notifications) ───────────────────────────────────────
// Shows a notification when the platform pushes one (a lead waiting, an approval,
// a payment). Tapping it focuses/open the page that resolves it. Best-effort:
// if a push arrives without a body, we still show a calm generic notice.
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { try { data = { body: e.data.text() }; } catch (__) { data = {}; } }
  var title = data.title || 'Studio OS';
  var opts = {
    body: data.body || 'Something needs a look.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/today.html' },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/today.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
