/* Service Worker – sorgt dafür, dass die App auch ohne Internet startet.
   Prinzip: Die App-Dateien werden aus dem Zwischenspeicher (Cache) geladen
   (schnell + offline). Gleichzeitig wird im Hintergrund nach einer neuen
   Version gesucht. Updates sind deshalb beim ÜBERNÄCHSTEN Öffnen sichtbar.
   Deine Finanzdaten liegen NICHT hier, sondern in IndexedDB.
   Die Texterkennung (Ordner ocr/, ca. 4,5 MB) wird erst beim ersten
   Screenshot-Import geladen und ab dann ebenfalls offline gespeichert. */

const CACHE = 'finanzen-cache-v4';
const DATEIEN = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Alte Caches aufräumen (den Zwischenspeicher fürs Teilen nicht)
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE && k !== 'finanzen-geteilt').map((k) => caches.delete(k)))));
  self.clients.claim();
});

// "Teilen → Finanzen" aus einer anderen App (z. B. Screenshot aus der Banking-App):
// Bilder kurz zwischenspeichern und die App mit ?geteilt=1 öffnen
async function geteiltAnnehmen(request) {
  try {
    const formular = await request.formData();
    await caches.delete('finanzen-geteilt');
    const c = await caches.open('finanzen-geteilt');
    let nr = 0;
    for (const datei of formular.getAll('bilder')) {
      if (datei && datei.size) await c.put(`./geteilt/bild-${nr++}`, new Response(datei));
    }
    const text = [formular.get('titel'), formular.get('text')].filter(Boolean).join('\n');
    if (text) await c.put('./geteilt/text', new Response(text));
  } catch { /* App öffnet trotzdem und meldet "nichts gefunden" */ }
  return Response.redirect('./?geteilt=1', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/teilen')) {
    e.respondWith(geteiltAnnehmen(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // cache: 'no-cache' = beim Server nachfragen, ob es eine neue Version gibt
  const ausNetz = fetch(e.request.url, { cache: 'no-cache' }).then(async (antwort) => {
    if (antwort.ok) (await caches.open(CACHE)).put(e.request, antwort.clone());
    return antwort;
  }).catch(() => null);
  e.waitUntil(ausNetz);
  e.respondWith(caches.match(e.request, { ignoreSearch: true })
    .then((ausCache) => ausCache || ausNetz.then((a) => a || Response.error())));
});
