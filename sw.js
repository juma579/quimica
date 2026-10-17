// La app en la web (GitHub Pages: para el iPhone y para quien no tenga la APK) funciona sin internet:
// este «service worker» guarda una copia de todos sus archivos y la usa. Solo se usa en la web (https
// que no es la app de Android); en la app de Android y en Química PC no se registra (app.js).
// Cada versión (VERSION_WEB, de version.js) tiene su copia: al publicar una nueva, el navegador ve que
// version.js ha cambiado, guarda la copia nueva y borra la vieja. La nueva se usa al volver a abrir.
importScripts('version.js');
/* global VERSION_WEB */
const COPIA = `quimica-${VERSION_WEB}`;
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'version.js', 'quimica.js', 'ia.js', 'cuaderno.js', 'fotos.js', 'sincronizar.js', 'app.js',
  'manifest.webmanifest', 'icono.svg', 'iconos/icono-180.png', 'iconos/icono-192.png', 'iconos/icono-512.png',
  'vendor/UTIF.js', 'vendor/pako_inflate.min.js', 'vendor/jsQR.js', 'vendor/qrcode.js', 'vendor/docx.js'];

// Pedidos a internet de verdad (`cache: 'reload'`): si no, el navegador puede dar lo que tenía guardado
// de hace unos minutos (GitHub Pages deja guardarlo 10 min) y la copia nueva quedaría con archivos viejos
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(COPIA).then((c) => c.addAll(ARCHIVOS.map((a) => new Request(a, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('quimica-') && k !== COPIA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Lo de la app, de la copia; lo demás (Gemini), por internet como siempre
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
