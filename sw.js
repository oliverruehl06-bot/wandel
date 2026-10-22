/* Service Worker: hält nur den Programmcode offline vor. Die Daten (IndexedDB) fasst er nie an.
   Bei jedem Update VERSION erhöhen, dann lädt die App beim nächsten Start den neuen Code. */
const VERSION = 'wandel-v16';
const FILES = ['./', 'index.html', 'styles.css', 'content.js', 'foods.js', 'app.js', 'food.js', 'lib/zxing.min.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Open Food Facts usw. nicht cachen
  // Netz zuerst (damit Updates sofort ankommen), offline aus dem Cache.
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).then(res => { // immer frisch vom Server, nicht aus dem Browser-Zwischenspeicher
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
