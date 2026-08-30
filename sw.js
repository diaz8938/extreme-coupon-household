const CACHE='extreme-coupon-v08-bulk';
const CORE=['./','./index.html','./app.js','./planner.js','./bulk.js','./manifest.webmanifest','./icon.svg','./data/household.json','./data/comparisons.json','./data/coupons.json','./data/unit_catalog.json','./data/unit_competitors.json','./receipts/heb-2026-08-29.json','./receipts/dg-2026-08-29.json','./receipts/sams-2026-08-28.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));
});