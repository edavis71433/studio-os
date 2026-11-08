const CACHE_NAME = 'dds-v17'; // bumped: the worker now caches only the marketing pages listed below, so every old copy of an app page rotates out
const PRECACHE = [
  '/about',
  '/services',
  '/work',
  '/contact',
  '/404.html'
];

// The marketing pages, and nothing else (list item 64). The worker used to cache every
// page that wasn't on a hand-written list of app pages, so Settings, Customers and Send an
// update were served stale for one load after each deploy, and so would every new app page
// have been. Now a page is handled only if it is listed here: fresh from the network, the
// cached copy only when there is no connection. An unlisted page, every app page
// included, goes straight to the network. Paths _redirects sends off this site stay off.
const NETWORK_FIRST = ['/', '/about', '/services', '/work', '/contact', '/how-we-work', '/industries', '/web-design',
  '/seo-strategy', '/monthly-retainer', '/privacy', '/terms', '/accessibility', '/ai-disclaimer', '/report-card',
  '/burbank-web-design', '/glendale-web-design', '/pasadena-web-design', '/health-wellness-web-design',
  '/home-services-web-design', '/restaurant-web-design', '/retail-web-design', '/salon-web-design'];
// The Free Tools report page carries private data and versioned scripts: never from this cache.
const NEVER_CACHE = /^\/(report\/|site-review|ai-visibility)/;
// Pictures, icons and fonts keep their meaning across a deploy: served from the cache and
// refreshed behind it. Scripts and styles are not cached: a page and its script must come
// from the same deploy.
const STATIC_FILE = /\.(png|jpe?g|webp|avif|gif|svg|ico|woff2?)$/i;

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

function keep(request, response) {
  if (response.ok) {
    var clone = response.clone();
    caches.open(CACHE_NAME).then(function(cache) { cache.put(request, clone); });
  }
  return response;
}

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (NEVER_CACHE.test(url.pathname)) return;   // plain network, no cache lookups or puts

  var page = url.pathname.replace(/\.html$/, '').replace(/(.)\/$/, '$1');
  if (NETWORK_FIRST.indexOf(page) >= 0) {
    e.respondWith(
      fetch(e.request).then(function(response) { return keep(e.request, response); })
        .catch(function() { return caches.match(e.request); })
    );
    return;
  }
  if (STATIC_FILE.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        var fresh = fetch(e.request).then(function(response) { return keep(e.request, response); });
        return cached || fresh;
      })
    );
  }
  // anything else, every app page and script included: the network, untouched
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
