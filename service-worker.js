const CACHE_VERSION = 'about-open-call-v1-20260604';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/job-detail.html',
  '/my-applications.html',
  '/assets/css/base.css',
  '/assets/css/layout.css',
  '/assets/css/components.css',
  '/assets/css/home-v2.css',
  '/assets/css/admin.css',
  '/assets/js/store.js',
  '/assets/js/utils.js',
  '/assets/js/pwa-register.js',
  '/assets/js/pages/home.js',
  '/assets/js/pages/chat-widget.js',
  '/assets/images/brand/about-logo-en.png',
  '/assets/images/brand/warm-water-logo.png',
  '/assets/images/brand/ccc-blue-lab-cutout.png',
  '/assets/images/magazines/about-06.webp',
  '/assets/images/magazines/about-07.webp',
  '/assets/images/magazines/about-10.webp',
  '/assets/icons/about-icon-192.png',
  '/assets/icons/about-icon-512.png',
  '/assets/icons/about-maskable-512.png',
  '/manifest.webmanifest'
];

function isStaticAsset(url) {
  return url.pathname.startsWith('/assets/') ||
    url.pathname === '/manifest.webmanifest';
}

function shouldBypass(request, url) {
  return request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/download/') ||
    url.pathname.startsWith('/uploads/');
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('about-open-call-') && !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (shouldBypass(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const networkFetch = fetch(request)
          .then(response => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then(cache => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
