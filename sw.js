// The build injects an asset fingerprint and an exact, same-origin app-shell list.
const VERSION = '__BUILD_ID__';
const FILES = /* PRECACHE */ [];
const PREFIX = `lilypb-shell:${self.registration.scope}:`;
const CACHE = `${PREFIX}${VERSION}`;
const assetURLs = FILES.map(file => new URL(file, self.registration.scope).href);
const indexURL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(assetURLs.map(url => new Request(url, { cache: 'reload' }))); }
    catch (error) { await caches.delete(CACHE); throw error; }
    // Updates wait for an explicit user action, or until all old app windows close.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') void self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Never intercept cloud API calls, authentication, JSON backups, or unknown files.
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    // Cache only the actual app entry paths; unrelated paths must still return 404.
    if (![self.registration.scope, indexURL].includes(`${url.origin}${url.pathname}`)) return;
    event.respondWith((async () => (await caches.open(CACHE)).match(indexURL).then(hit => hit || fetch(request)))());
  } else if (assetURLs.includes(url.href)) {
    event.respondWith((async () => (await caches.open(CACHE)).match(url.href).then(hit => hit || fetch(request)))());
  }
});
