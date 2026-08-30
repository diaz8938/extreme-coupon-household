(() => {
  const $i = s => document.querySelector(s);
  const $$i = s => [...document.querySelectorAll(s)];
  let stockSeed = null;
  let invSeed = null;

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
    set shoppingList(v){ localStorage.setItem('ec_shoppingList', JSON.stringify(v)); }
  };

  async function init(){
    [stockSeed, invSeed] = await Promise.all([
      fetch('./data/stockup_seed.json').then(r=>r.json()),
      fetch('./data/inventory_seed.json').then(r=>r.json())
    ]);
    injectUI();
    restoreSettings();
    bindSettings();
    render();
    const sub=document.querySelector('.head .sub');
    if(sub) sub.textContent='Household optimizer v1.0';
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
      <div class="card"><h2>Household inventory</h2><div class="note">Receipt purchases seed the list, but they are not treated as proof the item is still on hand. Confirm counts once, then the app can forecast run-out dates and build restock needs.</div><div id="inventorySummary" class="summary" style="margin-top:10px"></div></div>
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

  function seedMap(){
    return new Map((invSeed.items||[]).map(x=>[x.product_id,x]));
  }

  function allItems(){
    const sm=seedMap();
    const base=(stockSeed.items||[]).map(x=>({...x,inventory_seed:sm.get(x.product_id)||null,custom:false}));
    return base.concat(state.custom.map(x=>({...x,custom:true,storage:x.storage||'pantry'})));
  }

  function analyze(item){
    const actual=state.actual[item.product_id]||{};
    const profile=state.profiles[item.product_id]||{};
    const seeded=item.inventory_seed?.initial_packages;
    const onHand=actual.on_hand!=null?Math.max(0,Number(actual.on_hand)||0):item.custom?Math.max(0,Number(item.on_hand)||0):Math.max(0,Number(seeded)||0);
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
    return {...item,onHand,confirmed,weekly,weeksLeft,runout,targetWeeks,targetQty,restock,status,cls};
  }

  function render(){
    if(!stockSeed || !$i('#inventoryItems')) return;
    saveSettings();
    const rows=allItems().map(analyze);
    const confirmed=rows.filter(x=>x.confirmed).length;
    const low=rows.filter(x=>x.status==='RESTOCK').length;
    const unknown=rows.filter(x=>x.weekly<=0).length;
    $i('#inventorySummary').innerHTML=`<div class="k"><b>${confirmed}/${rows.length}</b><span>counts confirmed</span></div><div class="k"><b>${low}</b><span>need restock</span></div><div class="k"><b>${unknown}</b><span>usage rates missing</span></div>`;
    const priority={RESTOCK:0,'CONFIRM COUNT':1,'SET USAGE':2,WATCH:3,ENOUGH:4,'USAGE NEEDED':5};
    rows.sort((a,b)=>(priority[a.status]??9)-(priority[b.status]??9)||(a.weeksLeft??999)-(b.weeksLeft??999));
    $i('#inventoryItems').innerHTML=rows.map(card).join('') || '<div class="empty">No inventory items yet.</div>';
    bindRows();
  }

  function card(x){
    const weeks=x.weeksLeft==null?'—':x.weeksLeft<10?x.weeksLeft.toFixed(1):Math.round(x.weeksLeft);
    const runout=x.runout?x.runout.toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Need usage rate';
    const source=x.confirmed?'user-confirmed count':x.inventory_seed?.source||'manual item';
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
    const actual=state.actual; actual[id]={on_hand:hand,confirmed:true,updated_at:new Date().toISOString()}; state.actual=actual;
    const profiles=state.profiles; profiles[id]={...(profiles[id]||{}),on_hand:hand,weekly_use:weekly,updated_at:new Date().toISOString()}; state.profiles=profiles;
    if(state.custom.some(x=>x.product_id===id)){
      const custom=state.custom.map(x=>x.product_id===id?{...x,on_hand:hand,weekly_use:weekly}:x); state.custom=custom;
    }
    render();
  }

  function adjust(id,delta){
    const current=allItems().map(analyze).find(x=>x.product_id===id); if(!current) return;
    const next=Math.max(0,current.onHand+delta);
    const actual=state.actual; actual[id]={on_hand:next,confirmed:true,updated_at:new Date().toISOString()}; state.actual=actual;
    const profiles=state.profiles; profiles[id]={...(profiles[id]||{}),on_hand:next,weekly_use:current.weekly,updated_at:new Date().toISOString()}; state.profiles=profiles;
    render();
  }

  function addRestockToPlan(id){
    const x=allItems().map(analyze).find(v=>v.product_id===id); if(!x || !(x.restock>0)) return;
    const mapped=PLAN_MAP[id];
    const list=state.shoppingList;
    if(mapped){
      const existing=list.find(v=>v.product_id===mapped);
      const needBasisQty=plannerNeedQuantity(id,x.restock);
      if(existing) existing.qty=Number(existing.qty||0)+needBasisQty;
      else list.push({product_id:mapped,name:x.name,size:x.package||'',qty:needBasisQty,custom:false,planner_type:'bulk'});
    } else {
      list.push({product_id:'custom_'+Date.now(),name:`Restock: ${x.name}`,qty:x.restock,custom:true,planner_type:'custom'});
    }
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
    const name=$i('#invCustomName').value.trim();
    if(!name) return;
    const onHand=Math.max(0,Number($i('#invCustomHand').value)||0);
    const weekly=Math.max(0,Number($i('#invCustomWeekly').value)||0);
    const custom=state.custom;
    custom.push({product_id:'inv_'+Date.now(),name,package:'1 package',on_hand:onHand,weekly_use:weekly,max_weeks:24,storage:'pantry'});
    state.custom=custom;
    $i('#invCustomName').value=''; $i('#invCustomHand').value=''; $i('#invCustomWeekly').value='';
    render();
  }

  function removeCustom(id){ state.custom=state.custom.filter(x=>x.product_id!==id); const actual=state.actual; delete actual[id]; state.actual=actual; render(); }
  function fmt(n){const v=Number(n)||0;return Number.isInteger(v)?String(v):v.toFixed(2).replace(/0+$/,'').replace(/\.$/,'');}
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  init().catch(err=>{console.error(err);});
})();