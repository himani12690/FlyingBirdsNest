const CACHE='fbt-v8';
const ASSETS=['./','./index.html','./manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(u.includes('script.google.com')||u.includes('accounts.google.com')||u.includes('googleusercontent')||u.includes('api.qrserver.com')||e.request.method!=='GET')return;
  // HTML pages (navigation) → network-first, taaki naya deploy turant dikhe
  if(e.request.mode==='navigate'||u.endsWith('.html')||u.endsWith('/')){
    e.respondWith(fetch(e.request).then(r=>{ caches.open(CACHE).then(c=>c.put(e.request,r.clone())); return r; }).catch(()=>caches.match(e.request)));
    return;
  }
  // Baaki assets (icons, manifest) → cache-first, fast load
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
});
