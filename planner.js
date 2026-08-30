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
    const [standard, bulk] = await Promise.all([
      fetch('./data/comparisons.json').then(r => r.json()),
      fetch('./data/planner_bulk.json').then(r => r.json()).catch(() => ({items:[]}))
    ]);
    catalog = [
      ...(standard.comparisons || []).map(x => ({...x, planner_type:'package'})),
      ...(bulk.items || []).map(x => ({...x, planner_type:'bulk'}))
    ];
    populateProductSelect();
    populateCouponProductSelect();
    restoreSettings();
    bindPlanner();
    syncQtyForSelectedProduct(false);
    renderShoppingList();
  }

  function populateProductSelect(){
    const sel = $p('#planProduct');
    const regular = catalog.filter(c=>c.planner_type!=='bulk');
    const bulk = catalog.filter(c=>c.planner_type==='bulk');
    sel.innerHTML = `${optionGroup('Regular / exact package',regular)}${optionGroup("Bulk / Sam's normalized need",bulk)}`;
    sel.onchange = () => syncQtyForSelectedProduct(true);
  }

  function optionGroup(label, items){
    if(!items.length) return '';
    return `<optgroup label="${esc(label)}">${items.map(c => `<option value="${esc(c.product_id)}">${esc(c.name)} · ${esc(c.planner_type==='bulk' ? `need ${prettyBasis(c.need_basis)}` : (c.size || ''))}</option>`).join('')}</optgroup>`;
  }

  function populateCouponProductSelect(){
    const sel = $p('#couponProduct');
    if(!sel) return;
    const regular = catalog.filter(c=>c.planner_type!=='bulk');
    sel.innerHTML = '<option value="">Unlinked — don\'t auto-apply</option>' + regular.map(c => `<option value="${esc(c.product_id)}">${esc(c.name)} · ${esc(c.size || '')}</option>`).join('');
  }

  function syncQtyForSelectedProduct(force){
    const c = catalog.find(x=>x.product_id===$p('#planProduct').value);
    const q = $p('#planQty');
    if(!c || !q) return;
    if(c.planner_type==='bulk'){
      q.setAttribute('aria-label',`Need ${prettyBasis(c.need_basis)}`);
      q.title = `Enter how many ${prettyBasis(c.need_basis)} you need. Package rounding is automatic.`;
      if(force || Number(q.value)===1) q.value = c.default_need || 1;
    } else {
      q.setAttribute('aria-label','Package quantity');
      q.title='Enter package quantity';
      if(force) q.value=1;
    }
  }

  function restoreSettings(){
    const s = planState.settings;
    if(s.mode) mode = s.mode;
    if(Number.isFinite(Number(s.stopPenalty))) $p('#stopPenalty').value = Number(s.stopPenalty);
    $p('#allowSubs').checked = !!s.allowSubs;
    $$p('.modeBtn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }

  function saveSettings(){
    planState.settings = {mode,stopPenalty:Math.max(0, Number($p('#stopPenalty').value) || 0),allowSubs:$p('#allowSubs').checked};
  }

  function bindPlanner(){
    $p('#addPlanItem').onclick = () => {
      const productId = $p('#planProduct').value;
      const c = catalog.find(x => x.product_id === productId);
      if(!c) return;
      const rawQty = Number($p('#planQty').value) || 1;
      const qty = c.planner_type==='bulk' ? Math.max(0.01, rawQty) : Math.max(1, Math.floor(rawQty));
      const list = planState.list;
      const existing = list.find(x => x.product_id === productId);
      if(existing) existing.qty = Number(existing.qty || 0) + qty;
      else list.push({product_id:productId,name:c.name,size:c.size||'',qty,custom:false,planner_type:c.planner_type,need_basis:c.need_basis||null});
      planState.list = list; renderShoppingList();
    };
    $p('#addCustomPlanItem').onclick = () => {
      const name = $p('#customPlanName').value.trim();
      const qty = Math.max(1, Math.floor(Number($p('#customPlanQty').value) || 1));
      if(!name) return;
      const list = planState.list; list.push({product_id:'custom_'+Date.now(),name,qty,custom:true,planner_type:'custom'}); planState.list = list;
      $p('#customPlanName').value = ''; renderShoppingList();
    };
    $p('#quickAddUsual').onclick = () => {
      const list = planState.list;
      catalog.filter(c=>c.planner_type!=='bulk').forEach(c => {if(!list.find(x => x.product_id === c.product_id)) list.push({product_id:c.product_id,name:c.name,size:c.size,qty:Math.max(1,c.usual_qty||1),custom:false,planner_type:'package'});});
      planState.list = list; renderShoppingList();
    };
    $p('#clearPlan').onclick = () => {planState.list=[];renderShoppingList();$p('#planResult').innerHTML='<div class="empty">Add items and optimize.</div>';};
    $$p('.modeBtn').forEach(btn => btn.onclick = () => {mode=btn.dataset.mode;$$p('.modeBtn').forEach(x=>x.classList.toggle('active',x===btn));saveSettings();});
    $p('#stopPenalty').onchange=saveSettings;$p('#allowSubs').onchange=saveSettings;$p('#optimizeBtn').onclick=()=>{saveSettings();renderOptimizedPlan();};
  }

  function renderShoppingList(){
    const list=planState.list,el=$p('#shoppingList');
    if(!list.length){el.innerHTML='<div class="empty">No items yet.</div>';return;}
    el.innerHTML=list.map((x,i)=>{
      const c=catalog.find(c=>c.product_id===x.product_id);
      const verifiedCount=c?strictOptions(c,!!$p('#allowSubs')?.checked).length:0;
      const isBulk=c?.planner_type==='bulk';
      const badge=x.custom?'<span class="pill pWarn">needs price</span>':isBulk?`<span class="pill ${verifiedCount?'pGood':'pWarn'}">bulk · ${verifiedCount} strict store${verifiedCount===1?'':'s'}</span>`:`<span class="pill ${verifiedCount>1?'pGood':'pWarn'}">${verifiedCount} store${verifiedCount===1?'':'s'} verified</span>`;
      const basis=isBulk?`need ${prettyBasis(c.need_basis)} · package rounding automatic`:(x.size||'');
      const step=isBulk?'0.01':'1';
      return `<div class="planItem"><div><b>${esc(x.name)}</b><small>${esc(basis)}${x.custom?'custom item':''}</small>${badge}</div><input type="number" min="0.01" step="${step}" value="${x.qty}" data-plan-qty="${i}" aria-label="Quantity"><button class="btn danger removeMini" data-plan-remove="${i}">×</button></div>`;
    }).join('');
    $$p('[data-plan-qty]').forEach(inp=>inp.onchange=e=>{const list=planState.list,c=catalog.find(x=>x.product_id===list[+e.target.dataset.planQty].product_id),raw=Number(e.target.value)||1;list[+e.target.dataset.planQty].qty=c?.planner_type==='bulk'?Math.max(.01,raw):Math.max(1,Math.floor(raw));planState.list=list;renderShoppingList();});
    $$p('[data-plan-remove]').forEach(btn=>btn.onclick=e=>{const list=planState.list;list.splice(+e.target.dataset.planRemove,1);planState.list=list;renderShoppingList();});
  }

  function strictOptions(c,allowSubs){
    if(c.planner_type==='bulk'){
      return Object.entries(c.stores||{}).flatMap(([store,v])=>{
        if(v.confidence!=='local-receipt-verified' || !(v.package_price>=0) || !(v.package_units>0)) return [];
        if(v.match_quality==='substitute-only'&&!allowSubs) return [];
        return [{store,packagePrice:Number(v.package_price),packageUnits:Number(v.package_units),match_quality:v.match_quality||'same-product',source:v.source||'recent local receipt',bulk:true,confidence:v.confidence,need_basis:c.need_basis}];
      });
    }
    return Object.entries(c.stores||{}).flatMap(([store,v])=>{
      if(!v.verified||v.price==null)return[];
      if(v.requires_unit_normalization&&!v.unit_normalized)return[];
      if(c.match_quality==='substitute-only'&&store!=='H-E-B'&&!allowSubs)return[];
      return[{store,unitPrice:Number(v.price),match_quality:c.match_quality,source:v.source||'verified source',bulk:false,confidence:'verified'}];
    });
  }

  function optionsForItem(item,allowSubs){
    const c=catalog.find(x=>x.product_id===item.product_id);if(!c)return[];
    return strictOptions(c,allowSubs).map(opt=>{
      if(!opt.bulk) return opt;
      const packages=Math.max(1,Math.ceil((Number(item.qty)||0)/opt.packageUnits));
      const supplied=packages*opt.packageUnits;
      return {...opt,packages,supplied,excess:Math.max(0,supplied-Number(item.qty||0)),packageCost:packages*opt.packagePrice};
    });
  }

  function referenceOptionsForItem(item,allowSubs){
    const c=catalog.find(x=>x.product_id===item.product_id);if(!c||c.planner_type!=='bulk')return[];
    return Object.entries(c.stores||{}).flatMap(([store,v])=>{
      if(v.confidence!=='current-online-reference'||!(v.package_price>=0)||!(v.package_units>0))return[];
      if(v.match_quality==='substitute-only'&&!allowSubs)return[];
      const packages=Math.max(1,Math.ceil((Number(item.qty)||0)/Number(v.package_units)));
      const supplied=packages*Number(v.package_units);
      return [{store,packages,packagePrice:Number(v.package_price),packageUnits:Number(v.package_units),supplied,excess:Math.max(0,supplied-Number(item.qty||0)),packageCost:packages*Number(v.package_price),match_quality:v.match_quality||'same-product',confidence:v.confidence,source:v.source||'current online reference',bulk:true,need_basis:c.need_basis}];
    });
  }

  function bestLinkedCoupon(productId,store,qty){const eligible=activeCoupons().filter(c=>c.confirmed!==false&&c.product_id===productId&&c.store===store&&qty>=Math.max(1,Number(c.min_qty)||1));if(!eligible.length)return null;return eligible.reduce((a,b)=>Number(a.value||0)>=Number(b.value||0)?a:b);}

  function lineForOption(item,opt){
    const base=opt.bulk?opt.packageCost:opt.unitPrice*item.qty;
    const couponQty=opt.bulk?opt.packages:item.qty;
    const coupon=bestLinkedCoupon(item.product_id,opt.store,couponQty),couponValue=Math.min(base,Number(coupon?.value)||0);
    return{...opt,item,base,coupon,couponValue,effective:base-couponValue};
  }

  function storeSubsets(maxStores){const sets=[],n=STORES.length;for(let mask=1;mask<(1<<n);mask++){const s=STORES.filter((_,i)=>mask&(1<<i));if(s.length<=maxStores)sets.push(s);}return sets;}
  function evaluateSubset(stores,list,allowSubs,stopPenalty){const unresolved=[],assigned=[];for(const item of list){const allOpts=optionsForItem(item,allowSubs);if(!allOpts.length){unresolved.push(item);continue;}const opts=allOpts.filter(o=>stores.includes(o.store));if(!opts.length)return null;assigned.push(opts.map(o=>lineForOption(item,o)).sort((a,b)=>a.effective-b.effective)[0]);}if(!assigned.length)return{stores:[],assigned,unresolved,raw:0,coupons:0,penalty:0,total:0};const used=[...new Set(assigned.map(x=>x.store))],raw=assigned.reduce((s,x)=>s+x.base,0),coupons=assigned.reduce((s,x)=>s+x.couponValue,0),penalty=Math.max(0,used.length-1)*stopPenalty;return{stores:used,assigned,unresolved,raw,coupons,penalty,total:raw-coupons+penalty};}
  function findBest(maxStores,list,allowSubs,stopPenalty){const results=storeSubsets(maxStores).map(s=>evaluateSubset(s,list,allowSubs,stopPenalty)).filter(Boolean);return results.length?results.sort((a,b)=>a.total-b.total||a.stores.length-b.stores.length)[0]:null;}
  function forcedStore(store,list,allowSubs){return evaluateSubset([store],list,allowSubs,0);}

  function renderReferenceScout(list,result,allowSubs){
    const strictByProduct=new Map(result.assigned.map(x=>[x.item.product_id,x]));
    const rows=[];
    for(const item of list){
      const c=catalog.find(x=>x.product_id===item.product_id);
      if(c?.planner_type!=='bulk')continue;
      const strict=strictByProduct.get(item.product_id);
      const refs=referenceOptionsForItem(item,allowSubs);
      if(!refs.length)continue;
      const ranked=[...(strict?[strict]:[]),...refs].sort((a,b)=>(a.bulk?a.packageCost:a.effective)-(b.bulk?b.packageCost:b.effective));
      const best=ranked[0];
      const strictCost=strict?.effective ?? null;
      const refBest=refs.sort((a,b)=>a.packageCost-b.packageCost)[0];
      let verdict='';
      if(strictCost==null) verdict=`${refBest.store} reference covers the need for ${moneyP(refBest.packageCost)}. Verify locally before routing.`;
      else if(refBest.packageCost+0.005<strictCost) verdict=`${refBest.store} could save ${moneyP(strictCost-refBest.packageCost)} vs the strict verified plan. Verify local price before switching.`;
      else verdict=`Recent Sam's price still leads this reference check by ${moneyP(Math.max(0,refBest.packageCost-strictCost))}.`;
      rows.push(`<div class="planLine"><div><b>${esc(item.name)}</b><small>Need ${fmtQty(item.qty)} ${esc(prettyBasis(c.need_basis))}</small><small class="warn">${esc(verdict)}</small></div><div class="right"><b>${esc(best.store)}</b><small>${moneyP(best.bulk?best.packageCost:best.effective)} scenario</small></div></div>`);
    }
    return rows.length?`<div class="planStore"><div class="planStoreHead"><b>Reference scout</b><span class="pill pWarn">not auto-routed</span></div><div class="note">Current online references are for scouting only. They cannot override a local/recent verified price until confirmed.</div>${rows.join('')}</div>`:'';
  }

  function renderOptimizedPlan(){
    const list=planState.list;if(!list.length){$p('#planResult').innerHTML='<div class="empty">Add at least one item first.</div>';return;}
    const allowSubs=$p('#allowSubs').checked,stopPenalty=Math.max(0,Number($p('#stopPenalty').value)||0),maxStores=mode==='one'?1:mode==='balance'?2:STORES.length,result=findBest(maxStores,list,allowSubs,stopPenalty);
    if(!result){$p('#planResult').innerHTML='<div class="empty">No store combination can cover the verified items under these rules.</div>';return;}
    const oneStop=findBest(1,list,allowSubs,0),heb=forcedStore('H-E-B',list,allowSubs),unresolved=result.unresolved,baseline=heb||oneStop,baselineName=heb?'all H-E-B':oneStop?'best one-stop':'baseline',savings=baseline?Math.max(0,baseline.total-result.total):null,unlinkedCoupons=activeCoupons().filter(c=>!c.product_id).length;
    const byStore={};result.assigned.forEach(line=>(byStore[line.store]||=[]).push(line));
    const storeBlocks=Object.entries(byStore).map(([store,lines])=>{const sub=lines.reduce((s,x)=>s+x.effective,0);return `<div class="planStore"><div class="planStoreHead"><b>${esc(store)}</b><strong>${moneyP(sub)}</strong></div>${lines.map(x=>renderPlanLine(x)).join('')}</div>`;}).join('');
    const incomplete=unresolved.length>0,unresolvedBlock=incomplete?`<div class="planStore"><div class="planStoreHead"><b class="warn">Needs verified price</b><strong>${unresolved.length}</strong></div>${unresolved.map(x=>`<div class="planLine"><div><b>${esc(x.name)}</b><small>qty ${fmtQty(x.qty)} · excluded from calculated total</small></div><span class="pill pWarn">unpriced</span></div>`).join('')}</div>`:'',modeLabel=mode==='one'?'One stop':mode==='balance'?'Best balance':'Cheapest overall',summaryNote=incomplete?'Partial total — unpriced items are not included.':'Complete for all items with current strict verified data.',couponNote=unlinkedCoupons?`${unlinkedCoupons} unlinked clipped coupon${unlinkedCoupons===1?' is':'s are'} excluded from auto math.`:'All saved coupons used in auto math are explicitly linked.';
    const scout=renderReferenceScout(list,result,allowSubs);
    $p('#planResult').innerHTML=`<div class="resultBanner"><span class="tiny">${modeLabel.toUpperCase()} · ${result.stores.length} STORE${result.stores.length===1?'':'S'}</span><strong>${moneyP(result.total)}</strong><div class="note">Merchandise ${moneyP(result.raw)} · linked coupons -${moneyP(result.coupons)} · extra-store cost ${moneyP(result.penalty)}</div>${savings!=null?`<div class="impact">Save about ${moneyP(savings)} vs ${baselineName} on strictly priced items.</div>`:''}</div><div class="note ${incomplete?'warn':''}">${summaryNote} ${couponNote} Bulk needs are rounded up to whole packages, so overbuy is included in the actual cost. Online reference prices are never allowed to silently reroute the trip.</div>${storeBlocks}${scout}${unresolvedBlock}`;
  }

  function renderPlanLine(x){
    if(!x.bulk) return `<div class="planLine"><div><b>${esc(x.item.name)}</b><small>${fmtQty(x.item.qty)} × ${moneyP(x.unitPrice)} · ${esc(x.match_quality)}</small>${x.coupon?`<small class="good">linked coupon: -${moneyP(x.couponValue)} · min qty ${Math.max(1,Number(x.coupon.min_qty)||1)}</small>`:''}</div><div class="right"><b>${moneyP(x.effective)}</b><small>${esc(x.source)}</small></div></div>`;
    const basis=prettyBasis(x.need_basis);
    const utilization=x.supplied>0?Math.min(100,(Number(x.item.qty)/x.supplied)*100):0;
    return `<div class="planLine"><div><b>${esc(x.item.name)}</b><small>Need ${fmtQty(x.item.qty)} ${esc(basis)} · buy ${x.packages} × ${fmtQty(x.packageUnits)}-${esc(basis)} package</small><small>${fmtQty(x.excess)} ${esc(basis)} excess · ${utilization.toFixed(0)}% package utilization</small>${x.coupon?`<small class="good">linked coupon: -${moneyP(x.couponValue)}</small>`:''}</div><div class="right"><b>${moneyP(x.effective)}</b><small>${moneyP(x.packagePrice)}/package · ${esc(x.source)}</small></div></div>`;
  }

  function prettyBasis(b){return ({count:'items',bottle:'bottles',can:'cans',ounce:'oz','fluid-ounce':'fl oz',roll:'rolls','100-sheets':'100-sheet units',pouch:'pouches',box:'boxes'})[b]||b||'units';}
  function fmtQty(n){const v=Number(n);return Number.isInteger(v)?String(v):v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');}
  function esc(s){return String(s??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[c]));}
  window.renderPlanner=renderShoppingList;
  initPlanner().catch(err=>{console.error(err);if($p('#planResult'))$p('#planResult').innerHTML=`<div class="empty">Planner failed to load: ${esc(err.message)}</div>`;});
})();
