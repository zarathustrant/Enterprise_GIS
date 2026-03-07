const SHELL_CACHE = 'enterprise-gis-shell-v1'
const RUNTIME_CACHE = 'enterprise-gis-runtime-v1'

const APP_SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/vite.svg']

const BASEMAP_HOSTS = new Set([
  'basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com',
])

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  event.waitUntil(self.clients.claim())
})

function shouldRuntimeCache(url) {
  return BASEMAP_HOSTS.has(url.hostname) || url.hostname === 'nominatim.openstreetmap.org'
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)

  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    return cached
  }

  const network = await networkPromise
  if (network) {
    return network
  }

  if (request.mode === 'navigate') {
    return caches.match('/offline.html')
  }
  return new Response('', { status: 503, statusText: 'Offline' })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', response.clone()))
          return response
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html')
          return cachedIndex || caches.match('/offline.html')
        }),
    )
    return
  }

  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    event.respondWith(
      staleWhileRevalidate(request),
    )
    return
  }

  if (shouldRuntimeCache(url)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

