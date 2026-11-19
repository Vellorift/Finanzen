/* Service Worker – sorgt dafür, dass die App auch ohne Internet startet.
   Prinzip: Die App-Dateien werden aus dem Zwischenspeicher (Cache) geladen
   (schnell + offline). Gleichzeitig wird im Hintergrund nach einer neuen
   Version gesucht. Updates sind deshalb beim ÜBERNÄCHSTEN Öffnen sichtbar.
   Deine Finanzdaten liegen NICHT hier, sondern in IndexedDB. */

const CACHE = 'finanzen-cache-v3';
const DATEIEN = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Alte Caches aufräumen
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // cache: 'no-cache' = beim Server nachfragen, ob es eine neue Version gibt
  const ausNetz = fetch(e.request.url, { cache: 'no-cache' }).then(async (antwort) => {
    if (antwort.ok) (await caches.open(CACHE)).put(e.request, antwort.clone());
    return antwort;
  }).catch(() => null);
  e.waitUntil(ausNetz);
  e.respondWith(caches.match(e.request, { ignoreSearch: true })
    .then((ausCache) => ausCache || ausNetz.then((a) => a || Response.error())));
});
