const CACHE='fbt-v6';
const ASSETS=['./','./index.html','./manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=e.request.url;
  if(u.includes('script.google.com')||u.includes('accounts.google.com')||u.includes('googleusercontent')||u.includes('api.qrserver.com')||e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));
});
