/* Offline support. The app shell (index.html, manifest) is NETWORK-FIRST, fetched past the HTTP cache, so a new version
   shows up at the next launch even in an iPhone home-screen app; the cached copy is only used offline (or when the
   network is too slow). The instrument samples are cache-first and kept for good. */
const CACHE = 'psalter-v38';
const SAMPLES = 'psalter-samples-v1'; // bump only when the sample files themselves change
const SHELL = ['./', './index.html', './share.html', './psalm-singer-qr.png', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './my-songs.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => r.ok ? c.put(u, r) : null).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== SAMPLES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// The page sends the list of every sample once its first instrument has loaded; fetch the missing ones quietly.
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'skip-waiting') { self.skipWaiting(); return; }
  if (d.type === 'version' && e.source) { e.source.postMessage({ type: 'version', version: CACHE }); return; }
  if (d.type !== 'cache-samples' || !Array.isArray(d.urls)) return;
  e.waitUntil(caches.open(SAMPLES).then(async c => {
    const urls = d.urls.map(u => new URL(u, self.registration.scope).href);
    // drop samples of sounds that are no longer in the app (e.g. the removed choir and organ)
    const want = new Set(urls);
    for (const k of await c.keys()) { const u = k.url.split('?')[0]; if (!want.has(u)) await c.delete(k); }
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
  const shell = req.mode === 'navigate' || /\/(index\.html|share\.html|manifest\.webmanifest)?$/.test(url.pathname);
  if (shell) {
    // network first (no HTTP cache), the cached copy after 4 s or offline
    e.respondWith(caches.open(CACHE).then(async cache => {
      // Keep the app shell on index.html for app navigations, but serve share.html when that path is requested.
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const isShare = /\/share\.html$/.test(path) || path.endsWith('/share');
      const key = isShare ? './share.html' : (req.mode === 'navigate' ? './index.html' : req);
      const netReq = isShare
        ? new Request('./share.html', { cache: 'no-store' })
        : (req.mode === 'navigate' ? new Request('./index.html', { cache: 'no-store' }) : new Request(req, { cache: 'no-store' }));
      const net = fetch(netReq)
        .then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
      const slow = new Promise(r => setTimeout(r, 4000, null));
      const res = await Promise.race([net, slow]);
      if (res && res.ok) return res;
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || Response.error();
    }));
    return;
  }
  // other files (icons, my-songs.js): cached copy at once, refreshed in the background
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const res = await net;
    return res || Response.error();
  }));
});
