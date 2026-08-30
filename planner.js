(() => {
  const $p = s => document.querySelector(s);
  const $$p = s => [...document.querySelectorAll(s)];
  const moneyP = n => n == null ? '—' : '$' + Number(n).toFixed(2);
  const STORES = ['H-E-B','Walmart','Dollar General',"Sam's Club"];
  let catalog = [];
  let mode = 'extreme';

  const planState = {
    get list(){ return JSON.parse(localStorage.getItem('ec_shoppingList') || '[]'); },
    set list(v){ localStorage.setItem('ec_shoppingList', JSON.stringify(v)); },
    get settings(){ return JSON.parse(localStorage.getItem('ec_planSettings') || '{}'); },
    set settings(v){ localStorage.setItem('ec_planSettings', JSON.stringify(v)); }
  };

  const activeCoupons = () => JSON.parse(localStorage.getItem('ec_activeCoupons') || '[]');

  async function initPlanner(){
    if(!$p('#planProduct')) return;
    const data = await fetch('./data/comparisons.json').then(r => r.json());
    catalog = data.comparisons || [];
    populateProductSelect();
    populateCouponProductSelect();
    restoreSettings();
    bindPlanner();
    renderShoppingList();
  }

  function populateProductSelect(){
    const sel = $p('#planProduct');
    sel.innerHTML = catalog.map(c => `<option value="${esc(c.product_id)}">${esc(c.name)} · ${esc(c.size || '')}</option>`).join('');
  }

  function populateCouponProductSelect(){
    const sel = $p('#couponProduct');
    if(!sel) return;
    const first = '<option value="">Unlinked — don\'t auto-apply</option>';
    sel.innerHTML = first + catalog.map(c => `<option value="${esc(c.product_id)}">${esc(c.name)} · ${esc(c.size || '')}</option>`).join('');
  }

  function restoreSettings(){
    const s = planState.settings;
    if(s.mode) mode = s.mode;
    if(Number.isFinite(Number(s.stopPenalty))) $p('#stopPenalty').value = Number(s.stopPenalty);
    $p('#allowSubs').checked = !!s.allowSubs;
    $$p('.modeBtn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }

  function saveSettings(){
    planState.settings = {
      mode,
      stopPenalty: Math.max(0, Number($p('#stopPenalty').value) || 0),
      allowSubs: $p('#allowSubs').checked
    };
  }

  function bindPlanner(){
    $p('#addPlanItem').onclick = () => {
      const productId = $p('#planProduct').value;
      const qty = Math.max(1, Math.floor(Number($p('#planQty').value) || 1));
      const c = catalog.find(x => x.product_id === productId);
      if(!c) return;
      const list = planState.list;
      const existing = list.find(x => x.product_id === productId);
      if(existing) existing.qty += qty;
      else list.push({product_id:productId,name:c.name,size:c.size,qty,custom:false});
      planState.list = list;
      renderShoppingList();
    };

    $p('#addCustomPlanItem').onclick = () => {
      const name = $p('#customPlanName').value.trim();
      const qty = Math.max(1, Math.floor(Number($p('#customPlanQty').value) || 1));
      if(!name) return;
      const list = planState.list;
      list.push({product_id:'custom_'+Date.now(),name,qty,custom:true});
      planState.list = list;
      $p('#customPlanName').value = '';
      renderShoppingList();
    };

    $p('#quickAddUsual').onclick = () => {
      const list = planState.list;
      catalog.forEach(c => {
        const existing = list.find(x => x.product_id === c.product_id);
        if(!existing) list.push({product_id:c.product_id,name:c.name,size:c.size,qty:Math.max(1,c.usual_qty||1),custom:false});
      });
      planState.list = list;
      renderShoppingList();
    };

    $p('#clearPlan').onclick = () => {
      planState.list = [];
      renderShoppingList();
      $p('#planResult').innerHTML = '<div class="empty">Add items and optimize.</div>';
    };

    $$p('.modeBtn').forEach(btn => btn.onclick = () => {
      mode = btn.dataset.mode;
      $$p('.modeBtn').forEach(x => x.classList.toggle('active', x === btn));
      saveSettings();
    });

    $p('#stopPenalty').onchange = saveSettings;
    $p('#allowSubs').onchange = saveSettings;
    $p('#optimizeBtn').onclick = () => { saveSettings(); renderOptimizedPlan(); };
  }

  function renderShoppingList(){
    const list = planState.list;
    const el = $p('#shoppingList');
    if(!list.length){ el.innerHTML = '<div class="empty">No items yet.</div>'; return; }
    el.innerHTML = list.map((x,i) => {
      const c = catalog.find(c => c.product_id === x.product_id);
      const verifiedCount = c ? Object.values(c.stores||{}).filter(v=>v.verified && v.price != null).length : 0;
      const badge = x.custom ? '<span class="pill pWarn">needs price</span>' : `<span class="pill ${verifiedCount>1?'pGood':'pWarn'}">${verifiedCount} store${verifiedCount===1?'':'s'} verified</span>`;
      return `<div class="planItem"><div><b>${esc(x.name)}</b><small>${esc(x.size||'')}${x.custom?'custom item':''}</small>${badge}</div><input type="number" min="1" step="1" value="${x.qty}" data-plan-qty="${i}" aria-label="Quantity"><button class="btn danger removeMini" data-plan-remove="${i}">×</button></div>`;
    }).join('');
    $$p('[data-plan-qty]').forEach(inp => inp.onchange = e => {
      const list = planState.list;
      list[+e.target.dataset.planQty].qty = Math.max(1,Math.floor(Number(e.target.value)||1));
      planState.list = list;
      renderShoppingList();
    });
    $$p('[data-plan-remove]').forEach(btn => btn.onclick = e => {
      const list = planState.list;
      list.splice(+e.target.dataset.planRemove,1);
      planState.list = list;
      renderShoppingList();
    });
  }

  function optionsForItem(item, allowSubs){
    const c = catalog.find(x => x.product_id === item.product_id);
    if(!c) return [];
    return Object.entries(c.stores || {}).flatMap(([store,v]) => {
      if(!v.verified || v.price == null) return [];
      if(c.match_quality === 'substitute-only' && store !== 'H-E-B' && !allowSubs) return [];
      return [{store,unitPrice:Number(v.price),match_quality:c.match_quality,source:v.source || 'verified source'}];
    });
  }

  function bestLinkedCoupon(productId, store, qty){
    const eligible = activeCoupons().filter(c => c.confirmed !== false && c.product_id === productId && c.store === store && qty >= Math.max(1,Number(c.min_qty)||1));
    if(!eligible.length) return null;
    return eligible.reduce((a,b) => Number(a.value||0) >= Number(b.value||0) ? a : b);
  }

  function lineForOption(item,opt){
    const base = opt.unitPrice * item.qty;
    const coupon = bestLinkedCoupon(item.product_id,opt.store,item.qty);
    const couponValue = Math.min(base, Number(coupon?.value)||0);
    return {...opt,item,base,coupon,couponValue,effective:base-couponValue};
  }

  function storeSubsets(maxStores){
    const sets=[];
    const n=STORES.length;
    for(let mask=1;mask<(1<<n);mask++){
      const s=STORES.filter((_,i)=>mask&(1<<i));
      if(s.length<=maxStores) sets.push(s);
    }
    return sets;
  }

  function evaluateSubset(stores, list, allowSubs, stopPenalty){
    const unresolved=[];
    const assigned=[];
    for(const item of list){
      const allOpts=optionsForItem(item,allowSubs);
      if(!allOpts.length){ unresolved.push(item); continue; }
      const opts=allOpts.filter(o=>stores.includes(o.store));
      if(!opts.length) return null;
      const lines=opts.map(o=>lineForOption(item,o)).sort((a,b)=>a.effective-b.effective);
      assigned.push(lines[0]);
    }
    if(!assigned.length) return {stores:[],assigned,unresolved,raw:0,coupons:0,penalty:0,total:0};
    const used=[...new Set(assigned.map(x=>x.store))];
    const raw=assigned.reduce((s,x)=>s+x.base,0);
    const coupons=assigned.reduce((s,x)=>s+x.couponValue,0);
    const penalty=Math.max(0,used.length-1)*stopPenalty;
    return {stores:used,assigned,unresolved,raw,coupons,penalty,total:raw-coupons+penalty};
  }

  function findBest(maxStores,list,allowSubs,stopPenalty){
    const results=storeSubsets(maxStores).map(s=>evaluateSubset(s,list,allowSubs,stopPenalty)).filter(Boolean);
    if(!results.length) return null;
    return results.sort((a,b)=>a.total-b.total || a.stores.length-b.stores.length)[0];
  }

  function forcedStore(store,list,allowSubs){ return evaluateSubset([store],list,allowSubs,0); }

  function renderOptimizedPlan(){
    const list=planState.list;
    if(!list.length){ $p('#planResult').innerHTML='<div class="empty">Add at least one item first.</div>'; return; }
    const allowSubs=$p('#allowSubs').checked;
    const stopPenalty=Math.max(0,Number($p('#stopPenalty').value)||0);
    const maxStores=mode==='one'?1:mode==='balance'?2:STORES.length;
    const result=findBest(maxStores,list,allowSubs,stopPenalty);
    if(!result){ $p('#planResult').innerHTML='<div class="empty">No store combination can cover the verified items under these rules.</div>'; return; }

    const oneStop=findBest(1,list,allowSubs,0);
    const heb=forcedStore('H-E-B',list,allowSubs);
    const unresolved=result.unresolved;
    const baseline=heb || oneStop;
    const baselineName=heb?'all H-E-B':oneStop?'best one-stop':'baseline';
    const savings=baseline ? Math.max(0,baseline.total-result.total) : null;
    const unlinkedCoupons=activeCoupons().filter(c=>!c.product_id).length;

    const byStore={};
    result.assigned.forEach(line => (byStore[line.store] ||= []).push(line));
    const storeBlocks=Object.entries(byStore).map(([store,lines])=>{
      const sub=lines.reduce((s,x)=>s+x.effective,0);
      return `<div class="planStore"><div class="planStoreHead"><b>${esc(store)}</b><strong>${moneyP(sub)}</strong></div>${lines.map(x=>`<div class="planLine"><div><b>${esc(x.item.name)}</b><small>${x.item.qty} × ${moneyP(x.unitPrice)} · ${esc(x.match_quality)}</small>${x.coupon?`<small class="good">linked coupon: -${moneyP(x.couponValue)} · min qty ${Math.max(1,Number(x.coupon.min_qty)||1)}</small>`:''}</div><div class="right"><b>${moneyP(x.effective)}</b><small>${esc(x.source)}</small></div></div>`).join('')}</div>`;
    }).join('');

    const incomplete=unresolved.length>0;
    const unresolvedBlock=incomplete?`<div class="planStore"><div class="planStoreHead"><b class="warn">Needs verified price</b><strong>${unresolved.length}</strong></div>${unresolved.map(x=>`<div class="planLine"><div><b>${esc(x.name)}</b><small>qty ${x.qty} · excluded from calculated total</small></div><span class="pill pWarn">unpriced</span></div>`).join('')}</div>`:'';
    const modeLabel=mode==='one'?'One stop':mode==='balance'?'Best balance':'Cheapest overall';
    const summaryNote=incomplete?'Partial total — unpriced items are not included.':'Complete for all items with current verified data.';
    const couponNote=unlinkedCoupons?`${unlinkedCoupons} unlinked clipped coupon${unlinkedCoupons===1?' is':'s are'} excluded from auto math.`:'All saved coupons used in auto math are explicitly linked.';

    $p('#planResult').innerHTML=`<div class="resultBanner"><span class="tiny">${modeLabel.toUpperCase()} · ${result.stores.length} STORE${result.stores.length===1?'':'S'}</span><strong>${moneyP(result.total)}</strong><div class="note">Merchandise ${moneyP(result.raw)} · linked coupons -${moneyP(result.coupons)} · extra-store cost ${moneyP(result.penalty)}</div>${savings!=null?`<div class="impact">Save about ${moneyP(savings)} vs ${baselineName} on priced items.</div>`:''}</div><div class="note ${incomplete?'warn':''}">${summaryNote} ${couponNote} Sam's Club prices must be normalized by pack size/unit before they can beat a smaller retail package. For safety, only the single highest-value linked coupon is auto-applied per product/store line until stacking rules are verified.</div>${storeBlocks}${unresolvedBlock}`;
  }

  function esc(s){ return String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  window.renderPlanner = renderShoppingList;
  initPlanner().catch(err => {
    console.error(err);
    if($p('#planResult')) $p('#planResult').innerHTML=`<div class="empty">Planner failed to load: ${esc(err.message)}</div>`;
  });
})();