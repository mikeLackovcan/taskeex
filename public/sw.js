// Keeps the app opening without a connection.
// Pages are fetched fresh when online and fall back to the saved copy when offline.
// Built files have a unique name per version, so a saved copy of them never goes stale.
const CACHE = 'taskeex-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  const save = (response) => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(request, copy))
    }
    return response
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(save)
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./'))),
    )
    return
  }
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then(save)))
})
