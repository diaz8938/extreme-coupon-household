(() => {
  const $i = s => document.querySelector(s);
  const $$i = s => [...document.querySelectorAll(s)];
  let stockSeed = null;
  let invSeed = null;
  const pendingReceiptEvents = [];

  const PLAN_MAP = {
    'sams-bush-baked-beans-8':'bulk-bush-baked-beans',
    'sams-dove-sensitive-2':'bulk-dove-sensitive-bodywash',
    'sams-crest-scope-5':'bulk-crest-scope'
  };

  const state = {
    get actual(){ return JSON.parse(localStorage.getItem('ec_inventoryActual') || '{}'); },
    set actual(v){ localStorage.setItem('ec_inventoryActual', JSON.stringify(v)); },
    get custom(){ return JSON.parse(localStorage.getItem('ec_inventoryCustom') || '[]'); },
    set custom(v){ localStorage.setItem('ec_inventoryCustom', JSON.stringify(v)); },
    get profiles(){ return JSON.parse(localStorage.getItem('ec_stockProfiles') || '{}'); },
    set profiles(v){ localStorage.setItem('ec_stockProfiles', JSON.stringify(v)); },
    get settings(){ return JSON.parse(localStorage.getItem('ec_inventorySettings') || '{}'); },
    set settings(v){ localStorage.setItem('ec_inventorySettings', JSON.stringify(v)); },
    get stockSettings(){ return JSON.parse(localStorage.getItem('ec_stockSettings') || '{}'); },
    set stockSettings(v){ localStorage.setItem('ec_stockSettings', JSON.stringify(v)); },
    get shoppingList(){ return JSON.parse(localStorage.getItem('ec_shoppingList') || '[]'); },
    set shoppingList(v){ localStorage.setItem('ec_shoppingList', JSON.stringify(v)); },
    get ledger(){ return JSON.parse(localStorage.getItem('ec_inventoryLedger') || '[]'); },
    set ledger(v){ localStorage.setItem('ec_inventoryLedger', JSON.stringify(v)); },
    get review(){ return JSON.parse(localStorage.getItem('ec_inventoryReview') || '[]'); },
    set review(v){ localStorage.setItem('ec_inventoryReview', JSON.stringify(v)); },
    get processed(){ return JSON.parse(localStorage.getItem('ec_inventoryProcessedReceipts') || '{}'); },
    set processed(v){ localStorage.setItem('ec_inventoryProcessedReceipts', JSON.stringify(v)); },
    get importedReceipts(){ return JSON.parse(localStorage.getItem('ec_importedReceipts') || '[]'); }
  };

  window.addEventListener('ec:receipt-saved', e => {
    const receipt = e.detail?.receipt;
    if(!receipt) return;
    if(stockSeed) processReceipt(receipt, true);
    else pendingReceiptEvents.push(receipt);
  });

  async function init(){
    [stockSeed, invSeed] = await Promise.all([
      fetch('./data/stockup_seed.json').then(r=>r.json()),
      fetch('./data/inventory_seed.json').then(r=>r.json())
    ]);
    injectUI();
    restoreSettings();
    bindSettings();
    reconcileExistingImports();
    while(pendingReceiptEvents.length) processReceipt(pendingReceiptEvents.shift(), true);
    render();
    window.refreshInventory = render;
    const sub=document.querySelector('.head .sub');
    if(sub) sub.textContent='Household optimizer v1.1';
  }

  function injectUI(){
    if($i('[data-tab="inventory"]')) return;
    const tabs=$i('.tabs');
    const stockTab=$i('[data-tab="stock"]');
    const btn=document.createElement('button');
    btn.className='tab'; btn.dataset.tab='inventory'; btn.textContent='Inventory';
    stockTab?.after(btn) || tabs?.appendChild(btn);

    const section=document.createElement('section');
    section.id='inventory'; section.className='panel';
    section.innerHTML=`
      <div class="card"><h2>Household inventory</h2><div class="note">Confirmed receipt purchases now feed an inventory ledger. Exact/strong matches are added automatically; uncertain matches wait for review. Receipt additions do not magically confirm an older uncertain pantry count.</div><div id="inventorySummary" class="summary" style="margin-top:10px"></div></div>
      <div class="card"><h2>Receipt inventory review</h2><div class="note">Only likely matches appear here. Accepting one adds that purchase to inventory; ignoring it changes nothing.</div><div id="inventoryReview"></div></div>
      <div class="card"><h2>Inventory rules</h2><div class="formRow"><label class="note">Low-stock warning (weeks left)<input id="invLowWeeks" type="number" min="0.5" max="8" step="0.5" value="2"></label><label class="note">Target supply (weeks)<input id="invTargetWeeks" type="number" min="1" max="24" step="1" value="8"></label></div></div>
      <div class="card"><h2>Tracked items</h2><div id="inventoryItems"></div></div>
      <div class="card"><h2>Add household item</h2><div class="formRow"><input id="invCustomName" placeholder="Item name / exact size"><input id="invCustomHand" type="number" min="0" step="1" placeholder="On hand"></div><div class="formRow"><input id="invCustomWeekly" type="number" min="0" step="0.05" placeholder="Packages used / week"><button id="invAddCustom" class="btn primary">Add item</button></div></div>`;
    const stock=$i('#stock');
    stock?.after(section) || $i('.wrap')?.appendChild(section);

    btn.onclick=()=>{
      $$i('.tab').forEach(x=>x.classList.remove('active'));
      $$i('.panel').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active'); section.classList.add('active'); render();
    };
  }

  function restoreSettings(){
    const s=state.settings, stock=state.stockSettings;
    $i('#invLowWeeks').value=s.lowWeeks ?? invSeed.policy?.default_low_stock_weeks ?? 2;
    $i('#invTargetWeeks').value=s.targetWeeks ?? stock.weeks ?? invSeed.policy?.default_target_weeks ?? 8;
  }

  function bindSettings(){
    ['#invLowWeeks','#invTargetWeeks'].forEach(sel=>{
      const el=$i(sel); if(el) el.onchange=()=>{saveSettings();render();};
    });
    $i('#invAddCustom').onclick=addCustom;
  }

  function saveSettings(){
    const low=Math.max(.5,Number($i('#invLowWeeks').value)||2);
    const target=Math.max(1,Number($i('#invTargetWeeks').value)||8);
    state.settings={lowWeeks:low,targetWeeks:target};
    const stock=state.stockSettings; stock.weeks=target; state.stockSettings=stock;
  }

  function seedMap(){ return new Map((invSeed.items||[]).map(x=>[x.product_id,x])); }

  function allItems(){
    const sm=seedMap();
    const base=(stockSeed.items||[]).map(x=>({...x,inventory_seed:sm.get(x.product_id)||null,custom:false}));
    return base.concat(state.custom.map(x=>({...x,custom:true,storage:x.storage||'pantry'})));
  }

  function pendingLedgerDelta(id, snapshotAt){
    const cutoff=snapshotAt?new Date(snapshotAt).getTime():0;
    return state.ledger.filter(e=>e.product_id===id && new Date(e.at||e.date||0).getTime()>cutoff).reduce((s,e)=>s+Number(e.delta||0),0);
  }

  function analyze(item){
    const actual=state.actual[item.product_id]||{};
    const profile=state.profiles[item.product_id]||{};
    const seeded=item.inventory_seed?.initial_packages;
    const base=actual.on_hand!=null?Math.max(0,Number(actual.on_hand)||0):item.custom?Math.max(0,Number(item.on_hand)||0):Math.max(0,Number(seeded)||0);
    const ledgerDelta=pendingLedgerDelta(item.product_id, actual.updated_at);
    const onHand=Math.max(0,base+ledgerDelta);
    const confirmed=!!actual.confirmed || !!item.custom;
    const weekly=profile.weekly_use!=null?Math.max(0,Number(profile.weekly_use)||0):item.custom?Math.max(0,Number(item.weekly_use)||0):0;
    const lowWeeks=Number(state.settings.lowWeeks)||2;
    const targetWeeks=Math.min(Number(state.settings.targetWeeks)||8,item.max_weeks||24);
    const weeksLeft=weekly>0?onHand/weekly:null;
    const runout=weeksLeft!=null?new Date(Date.now()+weeksLeft*7*86400000):null;
    const targetQty=weekly>0?Math.ceil(targetWeeks*weekly):null;
    const restock=targetQty==null?null:Math.max(0,targetQty-Math.floor(onHand));
    let status='USAGE NEEDED', cls='pMute';
    if(!confirmed){status='CONFIRM COUNT';cls='pWarn';}
    else if(weekly<=0){status='SET USAGE';cls='pWarn';}
    else if(onHand<=0 || weeksLeft<=lowWeeks){status='RESTOCK';cls='pBad';}
    else if(weeksLeft<=targetWeeks){status='WATCH';cls='pWarn';}
    else {status='ENOUGH';cls='pGood';}
    return {...item,onHand,confirmed,weekly,weeksLeft,runout,targetWeeks,targetQty,restock,status,cls,ledgerDelta};
  }

  function render(){
    if(!stockSeed || !$i('#inventoryItems')) return;
    saveSettings();
    const rows=allItems().map(analyze);
    const confirmed=rows.filter(x=>x.confirmed).length;
    const low=rows.filter(x=>x.status==='RESTOCK').length;
    const pending=state.review.length;
    const receiptAdds=state.ledger.reduce((s,e)=>s+Math.max(0,Number(e.delta)||0),0);
    $i('#inventorySummary').innerHTML=`<div class="k"><b>${confirmed}/${rows.length}</b><span>counts confirmed</span></div><div class="k"><b>${low}</b><span>need restock</span></div><div class="k"><b>${receiptAdds}</b><span>receipt packages logged</span></div>`;
    const priority={RESTOCK:0,'CONFIRM COUNT':1,'SET USAGE':2,WATCH:3,ENOUGH:4,'USAGE NEEDED':5};
    rows.sort((a,b)=>(priority[a.status]??9)-(priority[b.status]??9)||(a.weeksLeft??999)-(b.weeksLeft??999));
    $i('#inventoryItems').innerHTML=rows.map(card).join('') || '<div class="empty">No inventory items yet.</div>';
    renderReview(pending);
    bindRows();
  }

  function renderReview(pendingCount){
    const el=$i('#inventoryReview'); if(!el) return;
    const review=state.review;
    if(!review.length){el.innerHTML='<div class="empty">No receipt lines need inventory review.</div>';return;}
    el.innerHTML=`<div class="note" style="margin:7px 0">${pendingCount} pending suggestion${pendingCount===1?'':'s'}</div>`+review.map(r=>{
      const opts=(r.candidates||[]).map(c=>`<option value="${esc(c.product_id)}">${esc(c.name)} · ${(c.score*100).toFixed(0)}% match</option>`).join('');
      return `<div class="compare"><div class="compareTop"><div><b>${esc(r.line_name)}</b><div class="note">${esc(r.store)} · ${esc(r.date)} · ${moneyI(r.price)}</div></div><span class="pill pWarn">REVIEW</span></div><div class="formRow"><select data-review-choice="${esc(r.id)}">${opts}</select><input data-review-qty="${esc(r.id)}" type="number" min="1" step="1" value="${Math.max(1,Number(r.qty)||1)}" aria-label="Packages purchased"></div><div class="formRow"><button class="btn primary" data-review-accept="${esc(r.id)}">Accept purchase</button><button class="btn danger" data-review-ignore="${esc(r.id)}">Ignore</button></div></div>`;
    }).join('');
    $$i('[data-review-accept]').forEach(b=>b.onclick=()=>acceptReview(b.dataset.reviewAccept));
    $$i('[data-review-ignore]').forEach(b=>b.onclick=()=>ignoreReview(b.dataset.reviewIgnore));
  }

  function card(x){
    const weeks=x.weeksLeft==null?'—':x.weeksLeft<10?x.weeksLeft.toFixed(1):Math.round(x.weeksLeft);
    const runout=x.runout?x.runout.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Need usage rate';
    const receiptNote=x.ledgerDelta?` · ${x.ledgerDelta>0?'+':''}${fmt(x.ledgerDelta)} from receipts since last count`:'';
    const source=(x.confirmed?'user-confirmed count':x.inventory_seed?.source||'manual item')+receiptNote;
    const restock=x.restock==null?'Set usage to calculate':x.restock===0?'No restock needed':`Restock ${x.restock} package${x.restock===1?'':'s'} to reach ~${x.targetWeeks} weeks`;
    return `<div class="compare"><div class="compareTop"><div><b>${esc(x.name)}</b><div class="note">${esc(x.package||'custom package')} · ${esc(source)}</div></div><span class="pill ${x.cls}">${esc(x.status)}</span></div><div class="storeGrid"><div class="storeBox"><div class="storeName">On hand</div><div class="storePrice">${fmt(x.onHand)}</div><small>packages</small></div><div class="storeBox"><div class="storeName">Use / week</div><div class="storePrice">${x.weekly?fmt(x.weekly):'—'}</div><small>packages</small></div><div class="storeBox"><div class="storeName">Weeks left</div><div class="storePrice">${weeks}</div><small>estimate</small></div><div class="storeBox"><div class="storeName">Run out</div><div class="storePrice" style="font-size:13px">${esc(runout)}</div><small>forecast</small></div></div><div class="formRow"><label class="note">Packages on hand<input data-inv-hand="${esc(x.product_id)}" type="number" min="0" step="1" value="${fmt(x.onHand)}"></label><label class="note">Packages used per week<input data-inv-weekly="${esc(x.product_id)}" type="number" min="0" step="0.05" value="${x.weekly?fmt(x.weekly):''}" placeholder="e.g. 0.25"></label></div><div class="formRow"><button class="btn secondary" data-inv-minus="${esc(x.product_id)}">−1 used</button><button class="btn secondary" data-inv-plus="${esc(x.product_id)}">+1 purchased</button></div><div class="formRow"><button class="btn primary" data-inv-save="${esc(x.product_id)}">Save / confirm</button>${x.custom?`<button class="btn danger" data-inv-remove="${esc(x.product_id)}">Remove</button>`:`<button class="btn secondary" data-inv-plan="${esc(x.product_id)}" ${x.restock>0?'':'disabled'}>Add restock to Plan</button>`}</div><div class="impact ${x.status==='RESTOCK'?'bad':x.status==='WATCH'?'warn':''}">${esc(restock)}</div></div>`;
  }

  function bindRows(){
    $$i('[data-inv-save]').forEach(b=>b.onclick=()=>saveRow(b.dataset.invSave));
    $$i('[data-inv-minus]').forEach(b=>b.onclick=()=>adjust(b.dataset.invMinus,-1));
    $$i('[data-inv-plus]').forEach(b=>b.onclick=()=>adjust(b.dataset.invPlus,1));
    $$i('[data-inv-plan]').forEach(b=>b.onclick=()=>addRestockToPlan(b.dataset.invPlan));
    $$i('[data-inv-remove]').forEach(b=>b.onclick=()=>removeCustom(b.dataset.invRemove));
  }

  function saveRow(id){
    const hand=Math.max(0,Number($i(`[data-inv-hand="${id}"]`)?.value)||0);
    const weekly=Math.max(0,Number($i(`[data-inv-weekly="${id}"]`)?.value)||0);
    const now=new Date().toISOString();
    const actual=state.actual; actual[id]={on_hand:hand,confirmed:true,updated_at:now}; state.actual=actual;
    const profiles=state.profiles; profiles[id]={...(profiles[id]||{}),on_hand:hand,weekly_use:weekly,updated_at:now}; state.profiles=profiles;
    if(state.custom.some(x=>x.product_id===id)) state.custom=state.custom.map(x=>x.product_id===id?{...x,on_hand:hand,weekly_use:weekly}:x);
    render();
  }

  function adjust(id,delta){
    const current=allItems().map(analyze).find(x=>x.product_id===id); if(!current) return;
    const next=Math.max(0,current.onHand+delta), now=new Date().toISOString();
    const actual=state.actual; actual[id]={on_hand:next,confirmed:true,updated_at:now}; state.actual=actual;
    const profiles=state.profiles; profiles[id]={...(profiles[id]||{}),on_hand:next,weekly_use:current.weekly,updated_at:now}; state.profiles=profiles;
    render();
  }

  function addRestockToPlan(id){
    const x=allItems().map(analyze).find(v=>v.product_id===id); if(!x || !(x.restock>0)) return;
    const mapped=PLAN_MAP[id], list=state.shoppingList;
    if(mapped){
      const existing=list.find(v=>v.product_id===mapped), needBasisQty=plannerNeedQuantity(id,x.restock);
      if(existing) existing.qty=Number(existing.qty||0)+needBasisQty;
      else list.push({product_id:mapped,name:x.name,size:x.package||'',qty:needBasisQty,custom:false,planner_type:'bulk'});
    } else list.push({product_id:'custom_'+Date.now(),name:`Restock: ${x.name}`,qty:x.restock,custom:true,planner_type:'custom'});
    state.shoppingList=list;
    alert('Restock need added to Plan.');
  }

  function plannerNeedQuantity(id,packages){
    if(id==='sams-bush-baked-beans-8') return packages*132;
    if(id==='sams-dove-sensitive-2') return packages*61.2;
    if(id==='sams-crest-scope-5') return packages*31.5;
    return packages;
  }

  function addCustom(){
    const name=$i('#invCustomName').value.trim(); if(!name) return;
    const onHand=Math.max(0,Number($i('#invCustomHand').value)||0), weekly=Math.max(0,Number($i('#invCustomWeekly').value)||0);
    const custom=state.custom; custom.push({product_id:'inv_'+Date.now(),name,package:'1 package',on_hand:onHand,weekly_use:weekly,max_weeks:24,storage:'pantry'}); state.custom=custom;
    $i('#invCustomName').value=''; $i('#invCustomHand').value=''; $i('#invCustomWeekly').value=''; render();
  }

  function removeCustom(id){ state.custom=state.custom.filter(x=>x.product_id!==id); const actual=state.actual; delete actual[id]; state.actual=actual; render(); }

  function reconcileExistingImports(){
    for(const receipt of state.importedReceipts) processReceipt(receipt, false);
  }

  function processReceipt(receipt, notify){
    const key=String(receipt.id ?? `${receipt.store}-${receipt.date}-${receipt.total}`), processed=state.processed;
    if(processed[key]) return processed[key];
    const auto=new Map(), review=state.review, reviewIds=new Set(review.map(r=>r.id));
    for(let idx=0; idx<(receipt.lines||[]).length; idx++){
      const line=receipt.lines[idx]; if(!line?.name) continue;
      const match=matchLine(line,receipt.store);
      const qty=Math.max(1,Math.round(Number(line.qty)||1));
      if(match.kind==='auto') auto.set(match.top.product_id,(auto.get(match.top.product_id)||0)+qty);
      else if(match.kind==='review'){
        const id=`${key}-${idx}`;
        if(!reviewIds.has(id)) review.push({id,receipt_id:key,store:receipt.store,date:receipt.date,line_name:line.name,price:Number(line.price)||0,qty,candidates:match.candidates.slice(0,3)});
      }
    }
    const at=new Date().toISOString(), ledger=state.ledger;
    for(const [product_id,delta] of auto){
      const eventId=`receipt-${key}-${product_id}`;
      if(!ledger.some(e=>e.id===eventId)) ledger.push({id:eventId,product_id,delta,source:'confirmed receipt auto-match',receipt_id:key,store:receipt.store,date:receipt.date,at,confidence:'strong'});
    }
    state.ledger=ledger; state.review=review;
    const summary={auto_packages:[...auto.values()].reduce((s,n)=>s+n,0),auto_products:auto.size,review:review.filter(r=>r.receipt_id===key).length,processed_at:at};
    processed[key]=summary; state.processed=processed;
    render();
    if(notify){
      const el=document.querySelector('#ocrStatus');
      if(el) el.textContent += ` Inventory: ${summary.auto_packages} package${summary.auto_packages===1?'':'s'} auto-added${summary.review?`, ${summary.review} match${summary.review===1?'':'es'} need review`:''}.`;
    }
    return summary;
  }

  function matchLine(line,store){
    const lineCompact=compact(line.name), lineTokens=tokens(line.name);
    if(lineCompact.length<4) return {kind:'none',candidates:[]};
    const candidates=(stockSeed.items||[]).map(item=>{
      const aliases=[item.name,...(item.aliases||[])];
      let exact=false, bestToken=0, shared=0;
      for(const alias of aliases){
        const ac=compact(alias), at=tokens(alias);
        const thisShared=[...lineTokens].filter(t=>at.has(t)).length;
        const score=dice(lineTokens,at);
        if(score>bestToken){bestToken=score;shared=thisShared;}
        if(ac.length>=7 && (lineCompact===ac || lineCompact.includes(ac) || ac.includes(lineCompact))) exact=true;
      }
      const sameStore=storeKey(store)===storeKey(item.store);
      const price=Number(line.price)||0, refs=[Number(item.last_paid_price)||0,Number(item.normal_price)||0].filter(Boolean);
      const priceClose=!price||!refs.length||Math.min(...refs.map(r=>Math.abs(price-r)/r))<=0.45;
      let score=exact?0.94:bestToken;
      if(sameStore) score+=0.04; else score-=0.12;
      if(priceClose) score+=0.02; else score-=0.08;
      return {product_id:item.product_id,name:item.name,score:Math.max(0,Math.min(1,score)),exact,sameStore,priceClose,shared};
    }).sort((a,b)=>b.score-a.score);
    const top=candidates[0], second=candidates[1];
    if(!top) return {kind:'none',candidates:[]};
    const margin=top.score-(second?.score||0);
    if(top.sameStore && top.priceClose && ((top.exact&&top.score>=0.9)||(top.score>=0.84&&top.shared>=2&&margin>=0.08))) return {kind:'auto',top,candidates};
    if(top.score>=0.48 && (top.shared>=1||top.exact) && margin>=0.05) return {kind:'review',top,candidates};
    return {kind:'none',candidates};
  }

  function acceptReview(id){
    const review=state.review, r=review.find(x=>x.id===id); if(!r) return;
    const product_id=$i(`[data-review-choice="${cssEscape(id)}"]`)?.value || r.candidates?.[0]?.product_id;
    const qty=Math.max(1,Math.round(Number($i(`[data-review-qty="${cssEscape(id)}"]`)?.value)||r.qty||1));
    if(!product_id) return;
    const ledger=state.ledger, eventId=`review-${id}-${product_id}`;
    if(!ledger.some(e=>e.id===eventId)) ledger.push({id:eventId,product_id,delta:qty,source:'receipt review accepted',receipt_id:r.receipt_id,store:r.store,date:r.date,at:new Date().toISOString(),confidence:'user-confirmed'});
    state.ledger=ledger; state.review=review.filter(x=>x.id!==id); render();
  }

  function ignoreReview(id){ state.review=state.review.filter(x=>x.id!==id); render(); }

  function norm(s){return String(s||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
  function compact(s){return norm(s).replace(/\s+/g,'');}
  function tokens(s){return new Set(norm(s).split(' ').filter(t=>t.length>1 && !['the','and','with','pack','ct'].includes(t)));}
  function dice(a,b){if(!a.size||!b.size)return 0;let inter=0;a.forEach(t=>{if(b.has(t))inter++;});return (2*inter)/(a.size+b.size);}
  function storeKey(s){return norm(s).replace(/club$/,'').replace(/sams/,'sam');}
  function cssEscape(s){return window.CSS?.escape?CSS.escape(s):String(s).replace(/[^a-zA-Z0-9_-]/g,'\\$&');}
  function moneyI(n){return '$'+Number(n||0).toFixed(2);}
  function fmt(n){const v=Number(n)||0;return Number.isInteger(v)?String(v):v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');}
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  init().catch(err=>console.error(err));
})();