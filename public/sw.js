// SW version substitution happens at SERVE time: app/api/sw/route.ts
// replaces the placeholders below using lib/serviceWorkerVersion.ts
// (next.config.ts only sets headers). A new deployment therefore purges
// the previous cache deterministically on first fetch of /sw.js.
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
  //
  // B-NBT-9 (2026-08-22): the revalidation promise AND its `waitUntil`
  // registration both happen synchronously while the fetch event is
  // still dispatching. The previous shape called `event.waitUntil(...)`
  // from inside the fetch continuation — after `respondWith(cached)`
  // had already settled — which throws InvalidStateError once the event
  // has terminated, so updated responses were silently never persisted.
  const cachedPromise = caches.match(request)
  const networkResponsePromise = fetch(request)
  event.waitUntil(
    networkResponsePromise.then((res) => {
      if (!res || !res.ok) return undefined
      const clone = res.clone()
      return caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone))
    }).catch(() => undefined)
  )
  event.respondWith(cachedPromise.then((cached) => cached || networkResponsePromise))
})
