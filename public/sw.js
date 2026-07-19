// SW version is injected at build time so a new deployment can purge the
// previous cache deterministically. Generic scoping rules from public/sw.js.
const SW_VERSION = 'weather-2026-07-19' // bumped manually on each deploy
const CACHE_NAME = `${SW_VERSION}-static`
const RUNTIME_CACHE = `${SW_VERSION}-runtime`
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
          .filter((k) => !k.startsWith(SW_VERSION))
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
