(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const digits=s=>String(s||'').replace(/\D/g,'');
  const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(2):'—';
  const get=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;}};
  const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const STORES=[
    {name:'H-E-B',domain:'heb.com',url:q=>`https://www.heb.com/search?q=${encodeURIComponent(q)}`},
    {name:'Dollar General',domain:'dollargeneral.com',url:q=>`https://www.dollargeneral.com/search?q=${encodeURIComponent(q)}`},
    {name:"Sam's Club",domain:'samsclub.com',url:q=>`https://www.samsclub.com/s/${encodeURIComponent(q)}`}
  ];
  const UPC_MIN_MS=10500, UPC_DAILY_MAX=95, OFFER_TTL_HOURS=12;
  let activeCode='', activeTitle='', activeProductId='';

  function usage(){
    const today=new Date().toISOString().slice(0,10),u=get('ec_upcitemdbUsage',{date:today,count:0,last_at:0});
    return u.date===today?u:{date:today,count:0,last_at:0};
  }

  async function fetchOffers(code){
    const cache=get('ec_retailOfferCache',{}),c=cache[code];
    if(c && Date.now()-new Date(c.cached_at||0).getTime()<OFFER_TTL_HOURS*3600000) return c;
    const u=usage(),now=Date.now();
    if(u.count>=UPC_DAILY_MAX) return {offers:[],error:'UPC offer lookup daily limit reached.'};
    const wait=UPC_MIN_MS-(now-Number(u.last_at||0));
    if(wait>0) await new Promise(r=>setTimeout(r,wait));
    const v=usage();v.last_at=Date.now();v.count+=1;set('ec_upcitemdbUsage',v);
    try{
      const r=await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,{headers:{Accept:'application/json'}});
      if(!r.ok) return {offers:[],error:`UPC offer lookup returned ${r.status}.`};
      const j=await r.json(),item=j?.items?.[0];
      const out={title:item?.title||'',brand:item?.brand||'',offers:(item?.offers||[]).map(o=>({merchant:o.merchant||'',domain:o.domain||'',title:o.title||'',price:Number(o.price),list_price:Number(o.list_price)||null,availability:o.availability||'',link:o.link||'',updated_t:Number(o.updated_t)||0})).filter(o=>o.price>0),cached_at:new Date().toISOString()};
      cache[code]=out;set('ec_retailOfferCache',cache);return out;
    }catch(e){return {offers:[],error:'Retail offer lookup unavailable: '+e.message};}
  }

  function normalize(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function titleFor(code){
    const ext=get('ec_externalBarcodeCatalog',{})[code];
    if(ext?.title)return ext.title;
    const map=get('ec_barcodeMap',{})[code];
    if(map?.name)return map.name;
    const h=get('ec_scanHistory',[]).find(x=>x.code===code&&x.name);
    return h?.name||code;
  }
  function productIdFor(code){return get('ec_barcodeMap',{})[code]?.product_id||`barcode_${code}`;}

  function localPrice(code,store){
    const verified=get('ec_retailLocalPrices',{})[code]?.[store];
    if(verified?.price>0) return {...verified,kind:'local-verified'};
    const shelf=get('ec_barcodeShelfChecks',{})[code];
    if(shelf?.store===store&&shelf?.price>0)return{price:Number(shelf.price),at:shelf.confirmed_at,kind:'local-verified',source:'barcode shelf confirmation'};
    const pid=productIdFor(code),obs=get('ec_priceObservations',[]).filter(x=>x.store===store&&Number(x.price)>0&&(x.barcode===code||x.product_id===pid));
    if(obs.length){obs.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));return{price:Number(obs[0].price),at:obs[0].date,kind:'local-history',source:obs[0].source||'price history'};}
    return null;
  }

  function bestMerchantOffer(all,store){
    const cfg=STORES.find(s=>s.name===store);if(!cfg)return null;
    const matches=(all||[]).filter(o=>String(o.domain).toLowerCase().includes(cfg.domain));
    if(!matches.length)return null;
    matches.sort((a,b)=>a.price-b.price);return matches[0];
  }

  function ageLabel(t){
    if(!t)return'age unknown';
    const ms=(String(t).length<=10?Number(t)*1000:new Date(t).getTime()),days=Math.max(0,(Date.now()-ms)/86400000);
    return days<1?'today':days<2?'1 day old':`${Math.floor(days)} days old`;
  }

  function statusBox(store,local,offer){
    if(local?.kind==='local-verified')return{price:local.price,label:'LOCAL VERIFIED',cls:'pGood',detail:`${local.source||'confirmed by you'} · ${ageLabel(local.at)}`,canWin:true};
    if(local?.kind==='local-history')return{price:local.price,label:'LOCAL HISTORY',cls:'pWarn',detail:`${local.source||'receipt/history'} · ${ageLabel(local.at)}`,canWin:false};
    if(offer)return{price:offer.price,label:'ONLINE OFFER',cls:'pWarn',detail:`${offer.merchant||store} · ${ageLabel(offer.updated_t)}`,canWin:false};
    return{price:null,label:'NO MATCH YET',cls:'pMute',detail:store==="Sam's Club"?'Same UPC not found; warehouse pack may use a different barcode.':'Open retailer search or confirm a local price.',canWin:false};
  }

  function winner(rows){
    const verified=rows.filter(x=>x.box.canWin&&Number(x.box.price)>0).sort((a,b)=>a.box.price-b.box.price);
    return verified.length>=2?verified[0]:null;
  }

  function render(code,title,offers,error=''){
    const host=$('#retailPriceMatch');if(!host)return;
    const rows=STORES.map(s=>{const local=localPrice(code,s.name),offer=bestMerchantOffer(offers,s.name);return{store:s,local,offer,box:statusBox(s.name,local,offer)};});
    const win=winner(rows),query=[title,code].filter(Boolean).join(' ');
    host.innerHTML=`<div class="card" style="margin-top:10px"><h2>DG · H-E-B · Sam's real-price match</h2><div class="note">Local confirmed prices are allowed to win. Web merchant offers are useful leads but do not override a local shelf/receipt price because retailer pricing can vary by location and fulfillment method.</div>${win?`<div class="resultBanner" style="margin-top:9px"><strong>${esc(win.store.name)} ${money(win.box.price)}</strong><span>cheapest across currently confirmed local prices</span></div>`:''}<div class="storeGrid">${rows.map(r=>`<div class="storeBox ${win?.store.name===r.store.name?'win':''}"><div class="storeName">${esc(r.store.name)}</div><div class="storePrice">${money(r.box.price)}</div><span class="pill ${r.box.cls}">${r.box.label}</span><small>${esc(r.box.detail)}</small></div>`).join('')}</div>${error?`<div class="tiny" style="margin-top:7px">${esc(error)}</div>`:''}<div style="margin-top:10px">${rows.map(r=>`<div class="compare"><div class="compareTop"><div><b>${esc(r.store.name)}</b><div class="note">${r.offer?`${esc(r.offer.title||title)} · merchant offer ${money(r.offer.price)}`:'No exact-UPC merchant offer cached.'}</div></div><a class="btn secondary" style="text-decoration:none;padding:8px" target="_blank" rel="noopener" href="${esc(r.store.url(query))}">Open live search</a></div><div class="formRow"><input data-rp-price="${esc(r.store.name)}" type="number" min="0" step="0.01" placeholder="Confirm local price"><button class="btn primary" data-rp-save="${esc(r.store.name)}">Save local price</button></div></div>`).join('')}</div><div class="note" style="margin-top:9px"><b>Important:</b> exact UPC comparisons are safe. Sam's bulk/equivalent packs often use a different UPC, so those need pack-size normalization before the app can call them cheaper.</div></div>`;
    host.querySelectorAll('[data-rp-save]').forEach(b=>b.onclick=()=>saveLocal(code,b.dataset.rpSave,title,offers));
  }

  function saveLocal(code,store,title,offers){
    const input=document.querySelector(`[data-rp-price="${CSS.escape(store)}"]`),price=Number(input?.value);if(!(price>0)){alert('Enter the current local price.');return;}
    const all=get('ec_retailLocalPrices',{});all[code]=all[code]||{};all[code][store]={price,at:new Date().toISOString(),source:'scan price confirmation',title};set('ec_retailLocalPrices',all);
    const obs=get('ec_priceObservations',[]);obs.unshift({product_id:productIdFor(code),name:title,barcode:code,price,store,date:new Date().toISOString().slice(0,10),source:'scan local retail price'});set('ec_priceObservations',obs.slice(0,1000));render(code,title,offers);
  }

  async function attach(code){
    const root=$('#scanResult');if(!root||!code)return;
    let host=$('#retailPriceMatch');if(!host){host=document.createElement('div');host.id='retailPriceMatch';root.appendChild(host);}host.innerHTML='<div class="card"><div class="note">Checking H-E-B, Dollar General and Sam\'s merchant offers…</div></div>';
    activeCode=code;activeTitle=titleFor(code);activeProductId=productIdFor(code);
    const data=await fetchOffers(code);if(activeCode!==code)return;render(code,activeTitle,data.offers||[],data.error||'');
  }

  function observe(){
    const root=$('#scanResult');if(!root){setTimeout(observe,400);return;}
    let last='';const run=()=>{const code=digits($('#scanManual')?.value);if(code.length>=6&&code!==last){last=code;setTimeout(()=>attach(code),150);}};
    new MutationObserver(run).observe(root,{childList:true,subtree:true});$('#scanManual')?.addEventListener('change',run);run();
  }

  function start(){observe();const sub=document.querySelector('.head .sub');if(sub)sub.textContent='Household optimizer v1.5';}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,1200));else setTimeout(start,1200);
})();