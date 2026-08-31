(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const digits=s=>String(s||'').replace(/\D/g,'');
  const get=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(d));}catch{return d;}};
  const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const money=n=>Number.isFinite(Number(n))?'$'+Number(n).toFixed(2):'—';
  const CACHE_DAYS=30, MISS_HOURS=6, UPC_MIN_MS=10500, UPC_DAILY_MAX=95;
  let resolving='';

  function sourceName(url){
    if(/openbeautyfacts/.test(url)) return 'Open Beauty Facts';
    if(/openpetfoodfacts/.test(url)) return 'Open Pet Food Facts';
    if(/openproductsfacts/.test(url)) return 'Open Products Facts';
    return 'Open Food Facts';
  }

  async function openFacts(code){
    const fields='code,product_name,product_name_en,brands,quantity,categories,image_front_url';
    const url=`https://world.openfoodfacts.org/api/v3.6/product/${encodeURIComponent(code)}.json?product_type=all&fields=${encodeURIComponent(fields)}`;
    try{
      const r=await fetch(url,{headers:{Accept:'application/json'}});
      if(!r.ok) return null;
      const j=await r.json();
      const p=j?.product;
      if(!p || !(p.product_name||p.product_name_en||p.brands)) return null;
      return {code,title:p.product_name||p.product_name_en||'Unnamed product',brand:p.brands||'',size:p.quantity||'',category:p.categories||'',image:p.image_front_url||'',provider:sourceName(r.url),provider_url:r.url,confidence:'public-database-match'};
    }catch(e){ return {error:'Open Facts unavailable: '+e.message,provider:'Open Facts'}; }
  }

  function upcUsage(){
    const today=new Date().toISOString().slice(0,10), u=get('ec_upcitemdbUsage',{date:today,count:0,last_at:0});
    if(u.date!==today) return {date:today,count:0,last_at:0};
    return u;
  }

  async function upcItemDb(code,force=false){
    const u=upcUsage(), now=Date.now();
    if(u.count>=UPC_DAILY_MAX) return {error:'UPCitemdb fallback paused for today to stay below the free daily limit.',provider:'UPCitemdb',rate_limited:true};
    const wait=UPC_MIN_MS-(now-Number(u.last_at||0));
    if(wait>0&&!force) return {error:`UPCitemdb fallback available in ${Math.ceil(wait/1000)}s.`,provider:'UPCitemdb',rate_limited:true,retry_after:wait};
    if(wait>0) await new Promise(r=>setTimeout(r,wait));
    const usage=upcUsage(); usage.last_at=Date.now(); usage.count+=1; set('ec_upcitemdbUsage',usage);
    try{
      const r=await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`,{headers:{Accept:'application/json'}});
      if(r.status===404) return null;
      if(r.status===429) return {error:'UPCitemdb rate limit reached. Try again later.',provider:'UPCitemdb',rate_limited:true};
      if(!r.ok) return {error:`UPCitemdb returned ${r.status}.`,provider:'UPCitemdb'};
      const j=await r.json(), x=j?.items?.[0];
      if(!x) return null;
      return {code,title:x.title||x.description||'Unnamed product',brand:x.brand||'',size:x.size||'',category:x.category||'',image:(x.images||[])[0]||'',provider:'UPCitemdb',provider_url:'https://www.upcitemdb.com/',confidence:'public-database-match'};
    }catch(e){ return {error:'UPCitemdb unavailable from this browser: '+e.message,provider:'UPCitemdb'}; }
  }

  function externalCache(){ return get('ec_externalBarcodeCatalog',{}); }
  function cached(code){
    const x=externalCache()[code]; if(!x) return null;
    const age=(Date.now()-new Date(x.cached_at||0).getTime())/86400000;
    return age<=CACHE_DAYS?x:null;
  }
  function missCached(code){
    const x=get('ec_barcodeMissCache',{})[code];
    return x && Date.now()-new Date(x).getTime()<MISS_HOURS*3600000;
  }
  function saveExternal(x,confirmed=false){
    const m=externalCache(); m[x.code]={...x,cached_at:new Date().toISOString(),user_confirmed:confirmed||!!m[x.code]?.user_confirmed}; set('ec_externalBarcodeCatalog',m); return m[x.code];
  }

  async function resolve(code,forceUpc=false){
    const c=cached(code); if(c) return {...c,from_cache:true};
    if(missCached(code)&&!forceUpc) return {not_found:true,cached_miss:true};
    const off=await openFacts(code);
    if(off && !off.error) return saveExternal(off,false);
    const upc=await upcItemDb(code,forceUpc);
    if(upc && !upc.error) return saveExternal(upc,false);
    if(upc?.rate_limited) return upc;
    const misses=get('ec_barcodeMissCache',{}); misses[code]=new Date().toISOString(); set('ec_barcodeMissCache',misses);
    return {not_found:true,errors:[off?.error,upc?.error].filter(Boolean)};
  }

  function dbBox(){
    const root=$('#scanResult'); if(!root) return null;
    let box=$('#barcodeDbResult');
    if(!box){box=document.createElement('div');box.id='barcodeDbResult';box.style.marginTop='9px';root.appendChild(box);}
    return box;
  }

  function currentCode(){ return digits($('#scanManual')?.value); }

  async function lookupCurrent(forceUpc=false){
    const code=currentCode(); if(code.length<6 || resolving===code) return;
    resolving=code; const box=dbBox(); if(!box){resolving='';return;}
    box.innerHTML='<div class="compare"><div class="note">Checking local cache → Open Facts → UPCitemdb…</div></div>';
    const x=await resolve(code,forceUpc);
    resolving='';
    if(currentCode()!==code) return;
    renderDb(code,x);
  }

  function renderDb(code,x){
    const box=dbBox(); if(!box) return;
    if(x?.rate_limited){
      box.innerHTML=`<div class="compare"><div class="compareTop"><b>Public database fallback</b><span class="pill pWarn">RATE SAFE</span></div><div class="note" style="margin-top:7px">${esc(x.error)}</div><button id="dbRetryUpc" class="btn secondary" style="width:100%;margin-top:8px">Retry UPCitemdb</button></div>`;
      $('#dbRetryUpc').onclick=()=>lookupCurrent(true); return;
    }
    if(!x || x.not_found){
      box.innerHTML=`<div class="compare"><div class="compareTop"><b>No public database match</b><span class="pill pMute">UNKNOWN</span></div><div class="note" style="margin-top:7px">Keep using the exact-product “Teach barcode” control above. Once confirmed, your local mapping remains the highest-confidence source.</div>${x?.errors?.length?`<div class="tiny" style="margin-top:6px">${esc(x.errors.join(' · '))}</div>`:''}</div>`; return;
    }
    const confirmed=!!x.user_confirmed;
    box.innerHTML=`<div class="compare"><div class="compareTop"><div><b>${esc(x.title)}</b><div class="note">${esc([x.brand,x.size].filter(Boolean).join(' · ')||code)}</div></div><span class="pill ${confirmed?'pGood':'pWarn'}">${confirmed?'VERIFIED BY YOU':'DATABASE MATCH'}</span></div>${x.image?`<img src="${esc(x.image)}" alt="" style="max-width:110px;max-height:110px;object-fit:contain;border-radius:10px;margin-top:8px;background:white">`:''}<div class="note" style="margin-top:8px"><b>Source:</b> ${esc(x.provider)}${x.category?` · ${esc(x.category)}`:''}</div><div class="note">Public database identity is a lead until you verify the package in your hand.</div><div class="formRow"><button id="dbConfirm" class="btn primary">${confirmed?'Database match saved':'Confirm this product'}</button><button id="dbAddPlan" class="btn secondary">Add to Plan</button></div><div class="formRow"><select id="dbStore"><option>H-E-B</option><option>Walmart</option><option>Dollar General</option><option>Sam's Club</option><option>Other</option></select><input id="dbPrice" type="number" min="0" step="0.01" placeholder="Current shelf price"></div><button id="dbSavePrice" class="btn secondary" style="width:100%;margin-top:8px">Save shelf price</button><div class="tiny" style="margin-top:7px">Barcode ${esc(code)} · local verified mappings override public databases.</div></div>`;
    $('#dbConfirm').onclick=()=>{const y=saveExternal({...x,code},true);renderDb(code,y);};
    $('#dbAddPlan').onclick=()=>addPlan(code,x);
    $('#dbSavePrice').onclick=()=>savePrice(code,x);
  }

  function addPlan(code,x){
    const l=get('ec_shoppingList',[]), id='barcode_'+code, ex=l.find(v=>v.product_id===id);
    if(ex) ex.qty=Number(ex.qty||0)+1; else l.push({product_id:id,name:x.title,size:x.size||'',qty:1,custom:true,planner_type:'barcode-database'});
    set('ec_shoppingList',l); alert('Added database product to Plan as a custom item.');
  }

  function savePrice(code,x){
    const price=Number($('#dbPrice')?.value), store=$('#dbStore')?.value||'Other'; if(!(price>0)){alert('Enter the shelf price.');return;}
    const at=new Date().toISOString(), s=get('ec_barcodeShelfChecks',{}); s[code]={product_id:'barcode_'+code,store,price,confirmed_at:at,name:x.title,source:'barcode public-database match'}; set('ec_barcodeShelfChecks',s);
    const o=get('ec_priceObservations',[]);o.unshift({product_id:'barcode_'+code,name:x.title,barcode:code,price,store,date:at.slice(0,10),source:'barcode database + shelf confirmation'});set('ec_priceObservations',o.slice(0,750));
    alert(`Saved ${money(price)} at ${store}.`);
  }

  function observe(){
    const root=$('#scanResult'); if(!root){setTimeout(observe,300);return;}
    const mo=new MutationObserver(()=>{
      const code=currentCode(); if(code.length<6) return;
      const text=root.textContent||'';
      if(/Unknown barcode|Scan or enter a barcode/i.test(text)){
        const box=$('#barcodeDbResult'); if(box?.dataset?.code===code) return;
        if(box) box.dataset.code=code;
        setTimeout(()=>lookupCurrent(false),80);
      }
    });
    mo.observe(root,{childList:true,subtree:true});
  }

  function injectNote(){
    const cap=$('#scanCap'); if(cap && !$('#dbPrivacyNote')){
      const d=document.createElement('div');d.id='dbPrivacyNote';d.className='tiny';d.style.marginTop='5px';d.textContent='Unknown barcodes may be sent to Open Facts and, if needed, UPCitemdb for product identification.';cap.after(d);
    }
  }

  function start(){injectNote();observe();const sub=document.querySelector('.head .sub');if(sub)sub.textContent='Household optimizer v1.4';}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,900));else setTimeout(start,900);
})();