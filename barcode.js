(() => {
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=n=>n==null||!Number.isFinite(Number(n))?'—':'$'+Number(n).toFixed(2);
  const digits=s=>String(s||'').replace(/\D/g,'');
  let stock={items:[]}, comps={comparisons:[]}, inv={items:[]}, receipt={items:[]};
  let products=[], detector=null, stream=null, running=false, timer=null, lastCode='';
  const get=(k,d)=>JSON.parse(localStorage.getItem(k)||JSON.stringify(d));
  const set=(k,v)=>localStorage.setItem(k,JSON.stringify(v));

  async function init(){
    [stock,comps,inv,receipt]=await Promise.all([
      fetch('./data/stockup_seed.json').then(r=>r.json()),
      fetch('./data/comparisons.json').then(r=>r.json()),
      fetch('./data/inventory_seed.json').then(r=>r.json()),
      fetch('./data/receipt_match_catalog.json').then(r=>r.json())
    ]);
    buildProducts(); inject(); bind(); capability(); renderHistory();
    const sub=document.querySelector('.head .sub'); if(sub) sub.textContent='Household optimizer v1.3';
  }

  function buildProducts(){
    const map=new Map(), rec=new Map(receipt.items.map(x=>[x.product_id,x]));
    for(const x of stock.items){const r=rec.get(x.product_id);map.set(x.product_id,{...x,aliases:[x.name,...(x.aliases||[]),...(r?.aliases||[])],item_code:r?.item_codes?.[0]||''});}
    for(const x of comps.comparisons) if(!map.has(x.product_id)) map.set(x.product_id,{...x,package:x.size,aliases:[x.name]});
    products=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }

  function inject(){
    if($('[data-tab="scan"]'))return;
    const b=document.createElement('button'); b.className='tab';b.dataset.tab='scan';b.textContent='Scan';
    $('[data-tab="plan"]')?.after(b) || $('.tabs')?.appendChild(b);
    const s=document.createElement('section');s.id='scan';s.className='panel';s.innerHTML=`
      <div class="card"><h2>Scan while shopping</h2><div class="note">Scan the package barcode, then confirm the shelf price. Unknown barcodes stay unknown until you verify the exact package and map it once.</div><div id="scanCap" class="note" style="margin-top:8px"></div><video id="scanVideo" playsinline muted style="display:none;width:100%;max-height:300px;object-fit:cover;border-radius:13px;margin-top:9px;background:#000"></video><div class="formRow"><button id="scanStart" class="btn primary">Start camera</button><button id="scanStop" class="btn secondary">Stop</button></div><div class="formRow"><input id="scanManual" inputmode="numeric" placeholder="Type UPC / EAN"><button id="scanLookup" class="btn secondary">Look up</button></div></div>
      <div class="card"><h2>Product result</h2><div id="scanResult"><div class="empty">Scan or enter a barcode.</div></div></div>
      <div class="card"><h2>Recent scans</h2><div id="scanHistory"></div></div>`;
    $('#plan')?.after(s) || $('.wrap')?.appendChild(s);
    b.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));$$('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');s.classList.add('active');renderHistory();};
  }

  function bind(){
    $('#scanStart').onclick=start; $('#scanStop').onclick=stop;
    $('#scanLookup').onclick=()=>handle($('#scanManual').value,'manual');
    $('#scanManual').onkeydown=e=>{if(e.key==='Enter')handle(e.target.value,'manual');};
    window.addEventListener('pagehide',stop);
  }

  async function capability(){
    const el=$('#scanCap');
    if(!('BarcodeDetector' in window)){el.innerHTML='<span class="warn">Camera barcode detection is unavailable in this browser.</span> Manual barcode entry still works.';$('#scanStart').disabled=true;return;}
    try{const f=await BarcodeDetector.getSupportedFormats();const wanted=['ean_13','ean_8','upc_a','upc_e','code_128'].filter(x=>f.includes(x));detector=new BarcodeDetector(wanted.length?{formats:wanted}:undefined);el.textContent='Camera scanner ready.';}catch(e){el.textContent='Camera scanner setup failed; manual entry still works.';}
  }

  async function start(){
    if(running)return; if(!detector){await capability();if(!detector)return;}
    try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});const v=$('#scanVideo');v.srcObject=stream;v.style.display='block';await v.play();running=true;loop();}catch(e){$('#scanCap').textContent='Camera unavailable: '+e.message;}
  }
  function stop(){running=false;if(timer)clearTimeout(timer);timer=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;const v=$('#scanVideo');if(v){v.pause();v.srcObject=null;v.style.display='none';}}
  async function loop(){
    if(!running||!detector)return;
    try{const v=$('#scanVideo');if(v?.readyState>=2){const r=await detector.detect(v);if(r?.[0]?.rawValue){const c=digits(r[0].rawValue);if(c){navigator.vibrate?.(80);stop();handle(c,r[0].format||'camera');return;}}}}catch(e){}
    if(running)timer=setTimeout(loop,220);
  }

  function mapped(code){const m=get('ec_barcodeMap',{})[code];return m?products.find(x=>x.product_id===m.product_id)||null:null;}
  function handle(raw,format){
    const code=digits(raw);if(code.length<6){$('#scanResult').innerHTML='<div class="empty">Enter a valid barcode.</div>';return;}
    lastCode=code;$('#scanManual').value=code;const p=mapped(code),h=get('ec_scanHistory',[]);h.unshift({code,format,product_id:p?.product_id||'',name:p?.name||'',at:new Date().toISOString()});set('ec_scanHistory',h.slice(0,40));render(code,p);renderHistory();
  }

  function render(code,p){
    if(!p){$('#scanResult').innerHTML=`<div class="compare"><div class="compareTop"><div><b>Unknown barcode</b><div class="note">${esc(code)}</div></div><span class="pill pWarn">REVIEW</span></div><div class="note" style="margin-top:8px">Map only when you can verify the exact product and package in your hand.</div><div class="formRow"><select id="scanTeach"></select><button id="scanTeachBtn" class="btn primary">Teach barcode</button></div></div>`;fillTeach();$('#scanTeachBtn').onclick=teach;return;}
    const ctx=inventoryCtx(p.product_id), shelf=shelfCtx(code,p.product_id), rec=recommend(p,shelf,ctx), coupons=get('ec_activeCoupons',[]).filter(x=>x.confirmed&&x.product_id===p.product_id);
    const last=lastPrice(p), c=comps.comparisons.find(x=>x.product_id===p.product_id);
    $('#scanResult').innerHTML=`<div class="compare"><div class="compareTop"><div><b>${esc(p.name)}</b><div class="note">${esc(p.package||p.size||'mapped exact product')} · ${esc(code)}</div></div><span class="pill pGood">KNOWN</span></div><div class="storeGrid"><div class="storeBox"><div class="storeName">Last paid</div><div class="storePrice">${money(last.price)}</div><small>${esc(last.store||'history')}</small></div><div class="storeBox"><div class="storeName">Normal</div><div class="storePrice">${money(p.normal_price)}</div><small>benchmark</small></div><div class="storeBox"><div class="storeName">On hand</div><div class="storePrice">${ctx.onHand}</div><small>${ctx.confirmed?'confirmed':'estimate'}</small></div><div class="storeBox"><div class="storeName">Weeks left</div><div class="storePrice">${ctx.weeksLeft==null?'—':ctx.weeksLeft.toFixed(1)}</div><small>${ctx.weekly?'forecast':'set usage'}</small></div></div><div class="formRow"><select id="scanStore"><option>H-E-B</option><option>Walmart</option><option>Dollar General</option><option>Sam's Club</option><option>Other</option></select><input id="scanPrice" type="number" min="0" step="0.01" placeholder="Shelf price" value="${shelf?Number(shelf.price).toFixed(2):''}"></div><button id="scanConfirmPrice" class="btn primary" style="width:100%;margin-top:8px">Confirm shelf price</button><div class="impact ${rec.cls}">${esc(rec.label)}</div><div class="note">${esc(rec.detail)}</div><div class="note" style="margin-top:8px"><b>Coupon:</b> ${coupons.length?esc(coupons.map(x=>`${x.name} ${money(x.value)}`).join(' · ')):'No clipped coupon linked to this exact product.'}</div>${comparisonHtml(c)}<div class="formRow"><button id="scanPlan" class="btn secondary">Add to Plan</button><button id="scanRemap" class="btn secondary">Change mapping</button></div><div id="scanRemapBox" style="display:none"><div class="formRow"><select id="scanTeach"></select><button id="scanTeachBtn" class="btn primary">Save mapping</button></div></div></div>`;
    if(shelf)$('#scanStore').value=shelf.store||'Other';
    $('#scanConfirmPrice').onclick=()=>confirmPrice(code,p);$('#scanPlan').onclick=()=>addPlan(p);$('#scanRemap').onclick=()=>{const x=$('#scanRemapBox');x.style.display=x.style.display==='none'?'block':'none';fillTeach(p.product_id);$('#scanTeachBtn').onclick=teach;};
  }

  function fillTeach(sel=''){const e=$('#scanTeach');if(!e)return;e.innerHTML='<option value="">Choose exact product…</option>'+products.map(p=>`<option value="${esc(p.product_id)}" ${p.product_id===sel?'selected':''}>${esc(p.name)}${p.package?` · ${esc(p.package)}`:''}</option>`).join('');}
  function teach(){const id=$('#scanTeach')?.value;if(!id||!lastCode)return;const p=products.find(x=>x.product_id===id);const m=get('ec_barcodeMap',{});m[lastCode]={product_id:id,name:p.name,confirmed_at:new Date().toISOString()};set('ec_barcodeMap',m);render(lastCode,p);}

  function inventoryCtx(id){const a=get('ec_inventoryActual',{})[id]||{}, seed=inv.items.find(x=>x.product_id===id), base=a.on_hand!=null?Number(a.on_hand)||0:Number(seed?.initial_packages)||0, cut=a.updated_at?new Date(a.updated_at).getTime():0, delta=get('ec_inventoryLedger',[]).filter(x=>x.product_id===id&&new Date(x.at||x.date||0).getTime()>cut).reduce((s,x)=>s+Number(x.delta||0),0), weekly=Number(get('ec_stockProfiles',{})[id]?.weekly_use)||0, onHand=Math.max(0,base+delta);return{onHand,weekly,weeksLeft:weekly?onHand/weekly:null,confirmed:!!a.confirmed};}
  function shelfCtx(code,id){const s=get('ec_barcodeShelfChecks',{})[code];if(s?.product_id===id)return s;const c=get('ec_stockCurrent',{})[id];if(c?.price&&c.confirmed_at&&(Date.now()-new Date(c.confirmed_at))/86400000<=3)return c;return null;}
  function lastPrice(p){let best={price:p.last_paid_price??null,store:p.store||'',date:'0000'};for(const r of get('ec_importedReceipts',[]))for(const l of r.lines||[])if(l.product_id===p.product_id&&String(r.date)>=best.date)best={price:Number(l.unit_price??l.price),store:r.store,date:r.date};return best;}
  function recommend(p,s,ctx){if(!s)return{label:'CONFIRM SHELF PRICE',detail:'Barcode identifies the product, but the current local price is still unknown.',cls:'warn'};const price=Number(s.price), normal=Number(p.normal_price)||0;if(!normal){const lp=Number(p.last_paid_price)||0;if(lp&&price<=lp*.95)return{label:'BEATS YOUR LAST PRICE',detail:`${money(price)} is at least 5% below your last known ${money(lp)}.`,cls:'good'};return{label:'PRICE CONFIRMED',detail:'More history is needed for a stock-up verdict.',cls:'warn'};}const st=get('ec_stockSettings',{}),d=Number(st.discount)||20,t=normal*(1-d/100);if(price<=t){if(!ctx.weekly)return{label:'STOCK-UP PRICE · SET USAGE',detail:`At or below the ${money(t)} trigger, but usage is unknown.`,cls:'good'};const item=stock.items.find(x=>x.product_id===p.product_id),weeks=Math.min(Number(st.weeks)||8,item?.max_weeks||24),need=Math.max(0,Math.ceil(weeks*ctx.weekly)-Math.floor(ctx.onHand));return need?{label:`STOCK UP · BUY ${need}`,detail:`Price beats the ${d}% trigger and inventory is below target.`,cls:'good'}:{label:'GREAT PRICE · INVENTORY COVERED',detail:'Price qualifies, but inventory already covers the target supply.',cls:'good'};}if(price<=normal*.95)return{label:'BUY IF NEEDED',detail:`Below normal ${money(normal)}, but not at stock-up price.`,cls:'good'};if(price<=normal*1.05)return{label:'NORMAL PRICE',detail:`Close to normal ${money(normal)}.`,cls:'warn'};return{label:'WAIT IF YOU CAN',detail:`Above normal ${money(normal)}.`,cls:'bad'};}
  function comparisonHtml(c){if(!c)return'<div class="note" style="margin-top:9px">No cross-store baseline is linked to this exact product yet.</div>';return'<div class="note" style="margin-top:9px"><b>Comparison baseline</b> · not automatically current</div><div class="storeGrid">'+Object.entries(c.stores||{}).map(([s,v])=>`<div class="storeBox"><div class="storeName">${esc(s)}</div><div class="storePrice">${money(v.price)}</div><small>${v.verified?'verified dataset':'unverified'}</small></div>`).join('')+'</div>';}

  function confirmPrice(code,p){const price=Number($('#scanPrice').value),store=$('#scanStore').value;if(!(price>0)){alert('Enter the shelf price.');return;}const at=new Date().toISOString(),s=get('ec_barcodeShelfChecks',{});s[code]={product_id:p.product_id,store,price,confirmed_at:at};set('ec_barcodeShelfChecks',s);if(stock.items.some(x=>x.product_id===p.product_id)){const c=get('ec_stockCurrent',{});c[p.product_id]={store,price,confirmed_at:at,source:'barcode shelf confirmation'};set('ec_stockCurrent',c);}const o=get('ec_priceObservations',[]);o.unshift({product_id:p.product_id,name:p.name,barcode:code,price,store,date:at.slice(0,10),source:'barcode shelf confirmation'});set('ec_priceObservations',o.slice(0,750));render(code,p);}
  function addPlan(p){const l=get('ec_shoppingList',[]), ex=l.find(x=>x.product_id===p.product_id);if(ex)ex.qty=Number(ex.qty||0)+1;else l.push({product_id:p.product_id,name:p.name,size:p.package||p.size||'',qty:1,custom:!comps.comparisons.some(x=>x.product_id===p.product_id),planner_type:'scan'});set('ec_shoppingList',l);alert('Added to Plan.');}
  function renderHistory(){const e=$('#scanHistory');if(!e)return;const h=get('ec_scanHistory',[]).slice(0,12);e.innerHTML=h.length?h.map(x=>`<div class="history"><div><b>${esc(x.name||'Unknown barcode')}</b><small>${esc(x.code)} · ${esc(x.format||'')}</small></div><div class="right"><small>${new Date(x.at).toLocaleString()}</small></div></div>`).join(''):'<div class="empty">No scans yet.</div>';}

  init().catch(e=>console.error('barcode init',e));
})();