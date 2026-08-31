(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const digits=s=>String(s||'').replace(/\D/g,'');
  const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(2):'—';
  const get=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;}};
  const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const PRICE_API='https://extreme-coupon-price-api.floot.app/_api/price-lookup';
  const STORES=[
    {name:'H-E-B',url:q=>`https://www.heb.com/search?q=${encodeURIComponent(q)}`},
    {name:'Walmart',url:q=>`https://www.walmart.com/search?q=${encodeURIComponent(q)}`},
    {name:'Dollar General',url:q=>`https://www.dollargeneral.com/?q=${encodeURIComponent(q)}`},
    {name:"Sam's Club",url:q=>`https://www.samsclub.com/search?q=${encodeURIComponent(q)}`}
  ];
  const STORE_CONTEXT={dgStore:'16310',hebStore:'734',samsClub:'4948'};
  const AUTO_CACHE_KEY='ec_autoRetailPriceCache_v18';
  const AUTO_TTL_HOURS=6,PARTIAL_TTL_MINUTES=2,LOOKUP_TIMEOUT_MS=50000;
  let activeCode='', activeIdentity=null, samsCatalog=[];

  function normalize(s){return String(s||'').toLowerCase().replace(/[^a-z0-9.]+/g,' ').replace(/\s+/g,' ').trim();}
  function productIdFor(code){return get('ec_barcodeMap',{})[code]?.product_id||`barcode_${code}`;}
  function identityFor(code){
    const ext=get('ec_externalBarcodeCatalog',{})[code]||{};
    const map=get('ec_barcodeMap',{})[code]||{};
    const h=get('ec_scanHistory',[]).find(x=>x.code===code&&x.name)||{};
    return {title:ext.title||map.name||h.name||code,brand:ext.brand||'',size:ext.size||map.size||''};
  }
  function identityKey(code,id){return `${code}|${id.title}|${id.brand}|${id.size}`;}

  function unitSig(value){
    const t=normalize(value),m=t.match(/(\d+(?:\.\d+)?)\s*(fl\s*oz|floz|oz|ounce|ounces|lb|lbs|pound|pounds|ct|count|pk|pack|bottle|can|pouch|roll)s?\b/);
    if(!m)return null;
    let amount=Number(m[1]),unit=m[2].replace(/\s+/g,'');
    if(['ounce','ounces'].includes(unit))unit='oz';
    if(['lb','lbs','pound','pounds'].includes(unit)){amount*=16;unit='oz';}
    if(['count','pk','pack'].includes(unit))unit='count';
    if(unit==='floz')unit='fl_oz';
    return{amount,unit};
  }
  function basisName(b){return b==='fluid-ounce'?'fl_oz':b==='ounce'?'oz':b==='count'?'count':b==='100-sheets'?'100_sheets':b;}
  function displayUnit(u){return u==='fl_oz'?'fl oz':u==='100_sheets'?'100 sheets':u||'unit';}
  function isAlternate(auto){return ['same_product_different_size','nearest_size_match','similar_substitute'].includes(auto?.matchQuality);}

  function localPrice(code,store){
    const verified=get('ec_retailLocalPrices',{})[code]?.[store];
    if(verified?.price>0)return{...verified,kind:'local-verified'};
    const shelf=get('ec_barcodeShelfChecks',{})[code];
    if(shelf?.store===store&&shelf?.price>0)return{price:Number(shelf.price),at:shelf.confirmed_at,kind:'local-verified',source:'barcode shelf confirmation'};
    const pid=productIdFor(code),obs=get('ec_priceObservations',[]).filter(x=>x.store===store&&Number(x.price)>0&&(x.barcode===code||x.product_id===pid));
    if(obs.length){obs.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));return{price:Number(obs[0].price),at:obs[0].date,kind:'local-history',source:obs[0].source||'price history'};}
    return null;
  }
  function alternatePrice(code,store,auto){
    if(!isAlternate(auto))return null;
    const row=get('ec_retailAlternatePrices',{})[code]?.[store];
    if(!row?.price)return null;
    const sameProduct=!row.sourceUrl||!auto?.sourceUrl||row.sourceUrl===auto.sourceUrl||normalize(row.title)===normalize(auto.productName);
    return sameProduct?row:null;
  }
  function ageLabel(t){if(!t)return'age unknown';const ms=(String(t).length<=10?Number(t)*1000:new Date(t).getTime()),d=Math.max(0,(Date.now()-ms)/86400000);return d<1?'today':d<2?'1 day old':`${Math.floor(d)} days old`;}

  function familyScore(identity,item){
    const stop=new Set(['with','and','the','for','of','pack','pk','ct','count','oz','ounce','fl','fluid']);
    const q=normalize(`${identity.brand} ${identity.title}`).split(' ').filter(x=>x.length>1&&!stop.has(x));
    const t=normalize(item.display_name||item.receipt_name||'');
    if(!q.length)return 0;
    let score=q.filter(x=>t.includes(x)).length/q.length;
    const variants=['peanut','organic','dark','mini','grape','strawberry','sensitive','original','vanilla'];
    for(const v of variants)if(normalize(identity.title).includes(v)!==t.includes(v))score-=.3;
    return Math.max(0,score);
  }
  function samsFamily(identity){
    const matches=samsCatalog.filter(x=>x.status==='normalized'&&Number(x.paid_price)>0).map(x=>({item:x,score:familyScore(identity,x)})).sort((a,b)=>b.score-a.score);
    const best=matches[0];return best&&best.score>=.62?best.item:null;
  }

  function isPartial(data){return STORES.some(s=>!(autoFor(data,s.name)?.price>0));}
  async function fetchAuto(code,identity,force=false){
    const cache=get(AUTO_CACHE_KEY,{}),key=identityKey(code,identity),c=cache[key];
    if(!force&&c){
      const age=Date.now()-new Date(c.cached_at||0).getTime();
      const ttl=(isPartial(c.data)?PARTIAL_TTL_MINUTES*60000:AUTO_TTL_HOURS*3600000);
      if(age<ttl)return c.data;
    }
    const qs=new URLSearchParams({barcode:code,name:identity.title,brand:identity.brand,size:identity.size,...STORE_CONTEXT});
    if(force)qs.set('_retry',String(Date.now()));
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),LOOKUP_TIMEOUT_MS);
    try{
      const r=await fetch(`${PRICE_API}?${qs}`,{headers:{Accept:'application/json'},cache:'no-store',signal:ctrl.signal});
      if(!r.ok)throw new Error(`price service ${r.status}`);
      const data=await r.json();cache[key]={cached_at:new Date().toISOString(),data};set(AUTO_CACHE_KEY,cache);return data;
    }finally{clearTimeout(timer);}
  }

  function autoFor(data,store){return data?.stores?.find(x=>x.store===store)||null;}
  function mergeData(base,fresh){
    if(!base)return fresh;if(!fresh)return base;
    const stores=STORES.map(s=>{const a=autoFor(base,s.name),b=autoFor(fresh,s.name);return b?.price>0?b:a||b;}).filter(Boolean);
    return{...base,...fresh,stores};
  }
  function statusBox(store,local,alt,auto,samsPack,identity){
    const qUnit=unitSig(identity.size);
    if(local?.kind==='local-verified')return{price:Number(local.price),label:'LOCAL VERIFIED',cls:'pGood',detail:`${local.source||'confirmed by you'} · ${ageLabel(local.at)}`,strict:true,lead:true,unit:qUnit?{basis:qUnit.unit,price:Number(local.price)/qUnit.amount}:null,substitute:false,alternate:false};
    if(auto?.price>0){
      const alternate=isAlternate(auto),substitute=auto.matchQuality==='similar_substitute';
      const matched=unitSig(auto.matchedSize||auto.productName||'');
      const usePrice=alt?.price>0?Number(alt.price):Number(auto.price);
      const unit=matched?{basis:matched.unit,price:usePrice/matched.amount}:qUnit&&!alternate?{basis:qUnit.unit,price:usePrice/qUnit.amount}:null;
      let label='AUTO FETCHED';
      if(alt?.price>0)label=substitute?'CONFIRMED SUBSTITUTE':'CONFIRMED NEAREST';
      else if(substitute)label='SIMILAR SUBSTITUTE';
      else if(['nearest_size_match','same_product_different_size'].includes(auto.matchQuality))label='NEAREST SIZE';
      else if(auto.confidence==='current_web_not_local')label='CURRENT WEB';
      const detail=`${auto.productName||'matched product'}${auto.matchedSize?` · ${auto.matchedSize}`:''}${auto.matchScore?` · match ${auto.matchScore}%`:''}${alt?.price>0?' · locally confirmed':' · double-check'}`;
      return{price:usePrice,label,cls:alt?.price>0?'pGood':'pWarn',detail,strict:false,lead:!alternate,unit,auto,substitute,alternate,confirmedAlternate:!!alt?.price};
    }
    if(store==="Sam's Club"&&samsPack){
      const basis=basisName(samsPack.unit_basis),up=Number(samsPack.unit_price);
      return{price:Number(samsPack.paid_price),label:'LOCAL RECEIPT PACK',cls:'pWarn',detail:`${samsPack.display_name} · recent local receipt · normalized`,strict:false,lead:false,unit:up>0?{basis,price:up}:null,samsPack,substitute:false,alternate:true};
    }
    if(local?.kind==='local-history')return{price:Number(local.price),label:'LOCAL HISTORY',cls:'pWarn',detail:`${local.source||'receipt/history'} · ${ageLabel(local.at)}`,strict:false,lead:false,unit:qUnit?{basis:qUnit.unit,price:Number(local.price)/qUnit.amount}:null,substitute:false,alternate:false};
    return{price:null,label:'NO SAFE PRICE',cls:'pMute',detail:store==="Sam's Club"?'No fresh validated match; a different warehouse pack may exist.':'No fresh validated exact or nearby match returned.',strict:false,lead:false,unit:null,substitute:false,alternate:false};
  }

  function choose(rows,identity){
    const strict=rows.filter(r=>r.box.strict&&r.box.price>0).sort((a,b)=>a.box.price-b.box.price);
    if(strict.length>=2)return{kind:'strict',row:strict[0]};
    const units=rows.filter(r=>r.box.unit&&r.box.unit.price>0),q=unitSig(identity.size),same=q?units.filter(r=>r.box.unit.basis===q.unit):[];
    if(same.length>=2){
      same.sort((a,b)=>a.box.unit.price-b.box.unit.price);
      return{kind:same.some(r=>r.box.substitute)?'comparable-unit':'unit',row:same[0]};
    }
    const leads=rows.filter(r=>r.box.lead&&r.box.price>0).sort((a,b)=>a.box.price-b.box.price);
    return leads.length>=2?{kind:'lead',row:leads[0]}:null;
  }

  function render(code,identity,data,error=''){
    const host=$('#retailPriceMatch');if(!host)return;
    const pack=samsFamily(identity);
    const rows=STORES.map(store=>{const local=localPrice(code,store.name),auto=autoFor(data,store.name),alt=alternatePrice(code,store.name,auto),box=statusBox(store.name,local,alt,auto,pack,identity);return{store,local,alt,auto,box};});
    const pick=choose(rows,identity),query=[identity.brand,identity.title,identity.size].filter(Boolean).join(' ');
    let banner='';
    if(pick?.kind==='strict')banner=`<div class="resultBanner" style="margin-top:9px"><strong>${esc(pick.row.store.name)} ${money(pick.row.box.price)}</strong><span>cheapest across confirmed exact local prices</span></div>`;
    else if(pick?.kind==='unit')banner=`<div class="resultBanner" style="margin-top:9px"><strong>${esc(pick.row.store.name)} ${money(pick.row.box.unit.price)}/${esc(displayUnit(pick.row.box.unit.basis))}</strong><span>best normalized same-product price lead · double-check</span></div>`;
    else if(pick?.kind==='comparable-unit')banner=`<div class="resultBanner" style="margin-top:9px"><strong>${esc(pick.row.store.name)} ${money(pick.row.box.unit.price)}/${esc(displayUnit(pick.row.box.unit.basis))}</strong><span>best comparable unit price · includes substitute/nearby size</span></div>`;
    else if(pick?.kind==='lead')banner=`<div class="resultBanner" style="margin-top:9px"><strong>${esc(pick.row.store.name)} ${money(pick.row.box.price)}</strong><span>best same-package web/local lead · double-check</span></div>`;
    host.innerHTML=`<div class="card" style="margin-top:10px"><h2>H-E-B · Walmart · DG · Sam's price match</h2><div class="note">Exact match is preferred. If a store does not carry that exact size, the resolver can show the nearest same-product size or a closely related substitute. Different sizes are compared by unit price, never sticker price alone.</div>${banner}<div class="storeGrid">${rows.map(r=>`<div class="storeBox ${pick?.row.store.name===r.store.name?'win':''}"><div class="storeName">${esc(r.store.name)}</div><div class="storePrice">${money(r.box.price)}</div><span class="pill ${r.box.cls}">${esc(r.box.label)}</span>${r.box.unit?`<small>${money(r.box.unit.price)} / ${esc(displayUnit(r.box.unit.basis))}</small>`:''}<small>${esc(r.box.detail)}</small></div>`).join('')}</div>${error?`<div class="tiny" style="margin-top:7px">${esc(error)}</div>`:''}<div style="margin:10px 0"><button class="btn secondary" id="retryRetailPrices">Retry missing prices</button></div><div style="margin-top:10px">${rows.map(r=>{const live=r.auto?.sourceUrl||r.store.url(query);const prefill=r.box.price>0&&r.auto?.price>0?Number(r.box.price).toFixed(2):'';const alt=r.box.alternate;return`<div class="compare"><div class="compareTop"><div><b>${esc(r.store.name)}</b><div class="note">${r.auto?.productName?`${esc(r.auto.productName)}${r.auto.matchedSize?` · ${esc(r.auto.matchedSize)}`:''}`:r.box.samsPack?esc(r.box.samsPack.display_name):'No validated auto-match yet.'}</div></div><a class="btn secondary" style="text-decoration:none;padding:8px" target="_blank" rel="noopener" href="${esc(live)}">Double-check live</a></div><div class="formRow"><input data-rp-price="${esc(r.store.name)}" type="number" min="0" step="0.01" placeholder="${alt?'Confirm alternate price':'Confirm local price'}" value="${esc(prefill)}"><button class="btn primary" data-rp-save="${esc(r.store.name)}">${alt?'Confirm alternate':'Confirm local price'}</button></div></div>`}).join('')}</div><div class="note" style="margin-top:9px"><b>Safety rule:</b> a confirmed substitute/nearest-size price is stored separately from the scanned UPC. It cannot overwrite the exact product's price history or silently route the shopping plan as an exact match.</div></div>`;
    host.querySelectorAll('[data-rp-save]').forEach(b=>b.onclick=()=>saveLocal(code,b.dataset.rpSave,identity,data));
    const retry=host.querySelector('#retryRetailPrices');if(retry)retry.onclick=()=>retryMissing(code,identity,data,retry);
  }

  async function retryMissing(code,identity,data,button){
    if(button){button.disabled=true;button.textContent='Retrying nearest matches…';}
    const signature=identityKey(code,identity);
    try{
      const fresh=await fetchAuto(code,identity,true);
      if(activeCode!==code||identityKey(code,activeIdentity)!==signature)return;
      render(code,identity,mergeData(data,fresh));
    }catch(e){
      if(activeCode!==code||identityKey(code,activeIdentity)!==signature)return;
      render(code,identity,data,e?.name==='AbortError'?'Nearest-match retry timed out. Tap Retry missing prices to try again.':`Retry unavailable: ${e?.message||e}`);
    }
  }

  function saveLocal(code,store,identity,data){
    const input=document.querySelector(`[data-rp-price="${CSS.escape(store)}"]`),price=Number(input?.value);if(!(price>0)){alert('Enter the current local price.');return;}
    const auto=autoFor(data,store),alternate=isAlternate(auto);
    if(alternate){
      const all=get('ec_retailAlternatePrices',{});all[code]=all[code]||{};all[code][store]={price,at:new Date().toISOString(),source:'scan alternate double-confirmation',title:auto.productName||identity.title,size:auto.matchedSize||'',matchQuality:auto.matchQuality,sourceUrl:auto.sourceUrl||'',matchedBarcode:auto.matchedBarcode||null};set('ec_retailAlternatePrices',all);
      const obs=get('ec_priceObservations',[]);obs.unshift({product_id:auto.matchedBarcode?`barcode_${auto.matchedBarcode}`:`alternate_${store.replace(/\W/g,'_')}_${code}`,name:auto.productName||identity.title,barcode:auto.matchedBarcode||null,size:auto.matchedSize||'',price,store,date:new Date().toISOString().slice(0,10),source:'scan double-confirmed alternate price',match_quality:auto.matchQuality,source_url:auto.sourceUrl||''});set('ec_priceObservations',obs.slice(0,1000));
    }else{
      const all=get('ec_retailLocalPrices',{});all[code]=all[code]||{};all[code][store]={price,at:new Date().toISOString(),source:'scan double-confirmation',title:identity.title};set('ec_retailLocalPrices',all);
      const obs=get('ec_priceObservations',[]);obs.unshift({product_id:productIdFor(code),name:identity.title,barcode:code,price,store,date:new Date().toISOString().slice(0,10),source:'scan double-confirmed local price'});set('ec_priceObservations',obs.slice(0,1000));
    }
    render(code,identity,data);
  }

  async function attach(code,identity){
    const root=$('#scanResult');if(!root||!code)return;
    let host=$('#retailPriceMatch');if(!host){host=document.createElement('div');host.id='retailPriceMatch';root.appendChild(host);}host.innerHTML='<div class="card"><div class="note">Resolving exact product → nearest size → similar substitute…</div></div>';
    activeCode=code;activeIdentity=identity;
    const signature=identityKey(code,identity);
    try{
      let data=await fetchAuto(code,identity);
      if(activeCode!==code||identityKey(code,activeIdentity)!==signature)return;
      render(code,identity,data);
      if(!(autoFor(data,'H-E-B')?.price>0)&&identity.title!==code){
        try{
          const fresh=await fetchAuto(code,identity,true);
          if(activeCode!==code||identityKey(code,activeIdentity)!==signature)return;
          data=mergeData(data,fresh);render(code,identity,data);
        }catch(e){
          if(activeCode!==code||identityKey(code,activeIdentity)!==signature)return;
          if(e?.name==='AbortError')render(code,identity,data,'H-E-B nearest-size lookup is taking longer than usual. Tap Retry missing prices to try again.');
        }
      }
    }catch(e){if(activeCode!==code||identityKey(code,activeIdentity)!==signature)return;render(code,identity,null,e?.name==='AbortError'?'Price lookup timed out. Tap Retry missing prices to continue searching nearby sizes.':`Auto price lookup unavailable: ${e?.message||e}`);}
  }

  function observe(){
    const root=$('#scanResult');if(!root){setTimeout(observe,400);return;}
    let lastSignature='';
    const run=()=>{
      const code=digits($('#scanManual')?.value);if(code.length<6)return;
      const identity=identityFor(code),signature=identityKey(code,identity);
      if(signature===lastSignature)return;
      lastSignature=signature;setTimeout(()=>attach(code,identity),220);
    };
    new MutationObserver(run).observe(root,{childList:true,subtree:true,characterData:true});
    $('#scanManual')?.addEventListener('change',run);run();
  }

  async function start(){
    try{samsCatalog=(await fetch('./data/unit_catalog.json').then(r=>r.json())).items||[];}catch{samsCatalog=[];}
    observe();const sub=document.querySelector('.head .sub');if(sub)sub.textContent='Household optimizer v1.8';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,1200));else setTimeout(start,1200);
})();