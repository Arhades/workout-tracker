// Hand-written service worker — caches the full app shell so the PWA launches
// and works with zero network (offline-first). Bump CACHE to ship an update.
const CACHE = 'workout-tracker-v6'

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/app.js',
  './src/dom.js',
  './src/db.js',
  './src/program.js',
  './src/recommend.js',
  './src/aiReport.js',
  './src/markdown.js',
  './src/components/chart.js',
  './src/components/timer.js',
  './src/views/log.js',
  './src/views/progress.js',
  './src/views/readiness.js',
  './src/views/techniques.js',
  './src/views/data.js',
  './icons/favicon.svg',
  './icons/apple-touch-icon.png',
  './icons/pwa-192.png',
  './icons/pwa-512.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Cache-first for same-origin GETs (static app shell). Falls back to network and
// caches anything new it fetches, so a forgotten file still works offline next time.
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }).catch(() => caches.match('./index.html'))),
  )
})
