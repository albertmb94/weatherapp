// SW version is injected at build time by `next.config.ts` so a new
// deployment can purge the previous cache deterministically. The
// placeholder below is replaced before bundling; if you see this
// comment in a deployed bundle the build pipeline is broken.
//
// `__SW_BUILD_ID__` will be a short hash like `weather-2026-07-26.abc1234`.
// Older deployments that lack the hash will keep their existing cache.
// `__SW_BUILD_ID_FALLBACK__` is the manual bump counter used when
// the build pipeline isn't running (e.g. `npm run dev`).
const SW_VERSION = '__SW_BUILD_ID__'
const SW_VERSION_FALLBACK = '__SW_BUILD_ID_FALLBACK__'
const EFFECTIVE_VERSION = (SW_VERSION === '__SW_BUILD_ID__')
  ? `weather-dev-${SW_VERSION_FALLBACK}`
  : SW_VERSION
const CACHE_NAME = `${EFFECTIVE_VERSION}-static`
const RUNTIME_CACHE = `${EFFECTIVE_VERSION}-runtime`
const PRECACHE_URLS = ['/', '/manifest.json', '/icon-192.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(EFFECTIVE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.pathname.startsWith('/api/')) return
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Network-first for HTML so a deploy reaches users immediately. If the
    // network fails, fall back to the precached shell.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)))
          }
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    )
    return
  }

  // Stale-while-revalidate for static assets so chunk URLs (whose hashes
  // change every build) are fetched fresh once they exist.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone()
            event.waitUntil(cache.put(request, clone))
          }
          return res
        }).catch(() => cached)
        return cached || fetchPromise
      })
    )
  )
})
