const CACHE='extreme-coupon-v12-qty-code-parser';
const CORE=['./','./index.html','./app.js','./planner.js','./bulk.js','./stockup.js','./inventory.js','./receipt_v12.js','./manifest.webmanifest','./icon.svg','./data/household.json','./data/comparisons.json','./data/coupons.json','./data/unit_catalog.json','./data/unit_competitors.json','./data/planner_bulk.json','./data/stockup_seed.json','./data/inventory_seed.json','./data/receipt_match_catalog.json','./receipts/heb-2026-08-29.json','./receipts/dg-2026-08-29.json','./receipts/sams-2026-08-28.json'];

self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));

function injectReceiptParser(html){
  if(html.includes('receipt_v12.js')) return html;
  return html.replace('</body>','<script src="./receipt_v12.js"></script></body>');
}

async function htmlResponseWithParser(response){
  const text=injectReceiptParser(await response.text());
  const headers=new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type','text/html; charset=utf-8');
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin) return;
  const isPage=e.request.mode==='navigate' || /\/index\.html$/.test(u.pathname);
  if(isPage){
    e.respondWith((async()=>{
      try{
        const network=await fetch(e.request,{cache:'no-store'});
        if(!network.ok) throw new Error('network page fetch failed');
        const out=await htmlResponseWithParser(network);
        const copy=out.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return out;
      }catch(err){
        const cached=await caches.match(e.request) || await caches.match('./index.html');
        if(cached) return htmlResponseWithParser(cached);
        throw err;
      }
    })());
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r;}).catch(()=>caches.match(e.request)));
});