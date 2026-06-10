// M2: Generate a unique cache name at install time. When the SW updates
// (a new SW replaces the old one on each deploy) the new install event
// produces a fresh cache name, so the activate handler deletes the
// stale cache. This prevents the classic "HTML referencing missing
// chunks" break after a deploy.
const CACHE_NAME = `weather-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const RUNTIME_CACHE = `${CACHE_NAME}-runtime`
const PRECACHE_URLS = ['/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never intercept API routes — let them pass through normally
  if (url.pathname.startsWith('/api/')) return

  // Only cache same-origin static assets
  if (url.origin !== self.location.origin) return

  // M2: Network-first for HTML navigations. This guarantees that after a
  // deploy the user gets the new HTML (and chunk references) immediately,
  // even if the old HTML is still in cache. Static assets (JS/CSS) can
  // still use stale-while-revalidate since their content-hashed URLs
  // change with every build.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    )
    return
  }

  // Stale-while-revalidate for static assets
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((res) => {
          if (res.ok) {
            const clone = res.clone()
            cache.put(request, clone)
          }
          return res
        }).catch(() => cached)
        return cached || fetchPromise
      })
    )
  )
})
