// Aşık Veysel Takvimi - Service Worker (çevrimdışı çalışma)
const CACHE = 'av2027-v3';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // Yalnızca kendi dosyalarımız ve statik CDN'ler önbelleğe alınır.
  // Firestore / Google API istekleri asla araya girilmeden doğrudan ağa gider (canlı senkron için şart).
  const cacheable = url.origin === self.location.origin ||
    ['cdn.tailwindcss.com', 'cdn.sheetjs.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'].includes(url.hostname);
  if (!cacheable) return;

  // Sayfa istekleri: önce ağ, olmazsa önbellek (güncellemeler hemen gelsin)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Diğer her şey (Tailwind CDN, Google Fonts, ikonlar): önbellek öncelikli, arka planda yenile
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
