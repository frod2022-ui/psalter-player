/* Offline support: cache the app shell (refreshed in the background) and the instrument samples (kept for good). */
const CACHE = 'psalter-v6';
const SAMPLES = 'psalter-samples-v1'; // bump only when the sample files themselves change
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './my-songs.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SAMPLES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// The page sends the list of every sample once its first instrument has loaded; fetch the missing ones quietly.
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type !== 'cache-samples' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(SAMPLES).then(async c => {
    const urls = d.urls.map(u => new URL(u, self.registration.scope).href);
    for (let i = 0; i < urls.length; i += 6) {
      await Promise.all(urls.slice(i, i + 6).map(async u => {
        if (await c.match(u)) return;
        try { const r = await fetch(u); if (r.ok) await c.put(u, r); } catch (err) { /* offline: try again next time */ }
      }));
    }
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/samples/')) {
    // samples never change under the same name: cache first, network once
    e.respondWith(caches.open(SAMPLES).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    return res || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }));
});
