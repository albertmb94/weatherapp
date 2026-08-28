// La sustitucion de version ocurre al SERVIR: app/api/sw/route.ts
// reemplaza los marcadores de abajo usando lib/serviceWorkerVersion.ts.
// La version deriva de la identidad del DESPLIEGUE (SHA del commit o
// BUILD_ID de Next), no del hash de esta plantilla — antes derivaba de
// esta plantilla, que no cambia entre despliegues, asi que `activate`
// no purgaba nunca nada.
//
// CICLO DE VIDA (auditoria): este SW ya NO llama a `skipWaiting()` ni a
// `clients.claim()` de forma incondicional. Hacerlo, combinado con un
// `activate` que BORRA todas las caches de versiones anteriores, dejaba
// a las pestanas ya abiertas —que siguen pidiendo los chunks con hash
// del build viejo— sin esos ficheros ni en cache ni en el CDN:
// ChunkLoadError. El sintoma ya tenia parche en la app
// (`importWithChunkReload` en app/home-content.tsx, que fuerza una
// recarga), lo cual era la senal de que el ciclo de vida estaba mal.
//
// Ahora el SW nuevo espera. Las pestanas abiertas conservan su SW y sus
// chunks hasta que se cierran; las nuevas arrancan con el nuevo. Se
// admite ademas un mensaje SKIP_WAITING para que la app pueda ofrecer
// "actualizar ahora" cuando quiera implementarlo.
// AUDITORIA (encontrado verificando en produccion): aqui habia un
// ternario que comparaba SW_VERSION con el marcador '__SW_BUILD_ID__'
// para decidir si usar un nombre de respaldo. Pero la sustitucion que
// hace app/api/sw/route.ts es GLOBAL:
//
//     source.replace(/__SW_BUILD_ID__/g, SW_VERSION)
//
// asi que tambien reemplazaba el marcador DENTRO de la comparacion, que
// quedaba como (SW_VERSION === SW_VERSION): siempre cierta. El SW usaba
// SIEMPRE el nombre de respaldo 'weather-dev-<fecha>', nunca la version
// del despliegue — de modo que `activate` seguia sin purgar nada entre
// despliegues, que era justo lo que se pretendia arreglar.
//
// El respaldo ya no hace falta en el cliente: lib/serviceWorkerVersion.ts
// garantiza SIEMPRE un valor con sentido (SHA del commit, id de
// despliegue, BUILD_ID o hash de esta plantilla). Una sola sustitucion,
// sin logica que la pueda contradecir.
const EFFECTIVE_VERSION = '__SW_BUILD_ID__'
const CACHE_NAME = `${EFFECTIVE_VERSION}-static`
const RUNTIME_CACHE = `${EFFECTIVE_VERSION}-runtime`
const PRECACHE_URLS = ['/', '/manifest.json', '/icon-192.svg']

self.addEventListener('install', (event) => {
  // Sin skipWaiting(): el SW nuevo queda en espera hasta que no quede
  // ninguna pestana controlada por el viejo.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
})

// Activacion voluntaria: la pagina puede pedir el relevo cuando avise al
// usuario de que hay version nueva.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Auditoría F3: las respuestas de navegación (cada URL con su query string
// de estado) se guardaban en CACHE_NAME sin límite → crecimiento ilimitado
// para usuarios con mucha variación de URL. Ahora van al runtime cache
// acotado y se evictan las entradas más antiguas por encima de un tope.
const MAX_RUNTIME_ENTRIES = 120
function capRuntimeCache() {
  return caches.open(RUNTIME_CACHE).then((cache) =>
    cache.keys().then((keys) => {
      if (keys.length <= MAX_RUNTIME_ENTRIES) return
      const toDelete = keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES)
      return Promise.all(toDelete.map((k) => cache.delete(k)))
    })
  )
}

self.addEventListener('activate', (event) => {
  // Cuando se llega aqui ya no queda ninguna pestana con el SW anterior
  // (o el usuario ha pedido el relevo explicitamente), asi que borrar las
  // caches viejas es seguro. `clients.claim()` se mantiene porque en ese
  // punto solo afecta a clientes sin controlador, no secuestra pestanas
  // que esten usando el build antiguo.
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
    // network fails, fall back to the precached shell. La respuesta se
    // guarda en el runtime cache acotado (no en CACHE_NAME, que es solo el
    // shell precacheados) y se aplica eviction por tamaño.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone()
            event.waitUntil(
              caches.open(RUNTIME_CACHE).then((cache) =>
                cache.put(request, clone).then(() => capRuntimeCache())
              )
            )
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
