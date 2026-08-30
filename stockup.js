(() => {
  const $s = s => document.querySelector(s);
  const $$s = s => [...document.querySelectorAll(s)];
  const moneyS = n => n == null ? '—' : '$' + Number(n).toFixed(2);
  let seed = null;

  const state = {
    get settings(){ return JSON.parse(localStorage.getItem('ec_stockSettings') || '{}'); },
    set settings(v){ localStorage.setItem('ec_stockSettings', JSON.stringify(v)); },
    get profiles(){ return JSON.parse(localStorage.getItem('ec_stockProfiles') || '{}'); },
    set profiles(v){ localStorage.setItem('ec_stockProfiles', JSON.stringify(v)); },
    get current(){ return JSON.parse(localStorage.getItem('ec_stockCurrent') || '{}'); },
    set current(v){ localStorage.setItem('ec_stockCurrent', JSON.stringify(v)); },
    get importedReceipts(){ return JSON.parse(localStorage.getItem('ec_importedReceipts') || '[]'); },
    get shoppingList(){ return JSON.parse(localStorage.getItem('ec_shoppingList') || '[]'); },
    set shoppingList(v){ localStorage.setItem('ec_shoppingList', JSON.stringify(v)); }
  };

  const PLAN_MAP = {
    'sams-dove-sensitive-2':'bulk-dove-sensitive-bodywash',
    'sams-bush-baked-beans-8':'bulk-bush-baked-beans',
    'sams-crest-scope-5':'bulk-crest-scope'
  };

  async function init(){
    seed = await fetch('./data/stockup_seed.json').then(r=>r.json());
    injectUI();
    restoreSettings();
    bind();
    render();
    const sub = document.querySelector('.head .sub');
    if(sub) sub.textContent = 'Household optimizer v0.9';
  }

  function injectUI(){
    if($s('[data-tab="stock"]')) return;
    const tabs = $s('.tabs');
    const planTab = $s('[data-tab="plan"]');
    const btn = document.createElement('button');
    btn.className='tab'; btn.dataset.tab='stock'; btn.textContent='Stock Up';
    planTab?.after(btn) || tabs?.appendChild(btn);

    const section = document.createElement('section');
    section.id='stock'; section.className='panel';
    section.innerHTML = `
      <div class="card"><h2>Stock-up intelligence</h2><div class="note">A past receipt is a benchmark, not proof the deal still exists. The app only says <b>STOCK UP NOW</b> after you confirm the current price. As more dated receipts are imported, it will learn how fast your household uses each item.</div><div id="stockSummary" class="summary" style="margin-top:10px"></div></div>
      <div class="card"><h2>Guardrails</h2><div class="formRow"><label class="note">Target weeks of supply<input id="stockWeeks" type="number" min="1" max="24" step="1" value="8"></label><label class="note">Stock-up budget<input id="stockBudget" type="number" min="0" step="5" value="50"></label></div><div class="formRow"><label class="note">Stock-up threshold (% below normal)<input id="stockDiscount" type="number" min="5" max="60" step="1" value="20"></label><div class="note" style="padding-top:11px">Perishables/freezer items have lower supply caps. Budget recommendations only use current prices confirmed within the freshness window.</div></div></div>
      <div class="card"><h2>Best stock-up opportunities</h2><div id="stockRecommendations"></div></div>
      <div class="card"><h2>Teach the app your usage</h2><div class="note">Until we have enough dated receipts, enter rough weekly use and what you have on hand. These values stay on this phone. Once there are 2+ separated purchase dates, receipt-learning can begin replacing the manual estimate.</div><div id="stockProfiles"></div></div>`;
    const bulk = $s('#bulk');
    bulk?.before(section) || $s('.wrap')?.appendChild(section);

    btn.onclick=()=>{
      $$s('.tab').forEach(x=>x.classList.remove('active'));
      $$s('.panel').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active'); section.classList.add('active');
      render();
    };
  }

  function restoreSettings(){
    const d=seed.policy||{}, s=state.settings;
    $s('#stockWeeks').value = s.weeks ?? d.default_target_weeks ?? 8;
    $s('#stockBudget').value = s.budget ?? d.default_budget ?? 50;
    $s('#stockDiscount').value = s.discount ?? d.default_stockup_discount_percent ?? 20;
  }

  function saveSettings(){
    state.settings={
      weeks:clamp(Number($s('#stockWeeks').value)||8,1,24),
      budget:Math.max(0,Number($s('#stockBudget').value)||0),
      discount:clamp(Number($s('#stockDiscount').value)||20,5,60)
    };
  }

  function bind(){
    ['#stockWeeks','#stockBudget','#stockDiscount'].forEach(sel=>{
      const el=$s(sel); if(el) el.onchange=()=>{saveSettings();render();};
    });
  }

  function render(){
    if(!seed || !$s('#stockRecommendations')) return;
    saveSettings();
    const scored=seed.items.map(analyzeItem);
    const confirmed=scored.filter(x=>x.action==='STOCK UP NOW');
    const verify=scored.filter(x=>x.action==='VERIFY DEAL');
    const learned=scored.filter(x=>x.rate.source==='receipt-learned').length;
    $s('#stockSummary').innerHTML=`<div class="k"><b>${confirmed.length}</b><span>confirmed stock-ups</span></div><div class="k"><b>${verify.length}</b><span>deal checks</span></div><div class="k"><b>${learned}</b><span>usage rates learned</span></div>`;
    renderRecommendations(scored);
    renderProfiles(scored);
  }

  function analyzeItem(item){
    const settings=state.settings;
    const trigger=round2(item.normal_price*(1-settings.discount/100));
    const cur=validCurrent(item.product_id);
    const rate=usageRate(item);
    const prof=state.profiles[item.product_id]||{};
    const targetWeeks=Math.min(settings.weeks,item.max_weeks||settings.weeks);
    const onHand=Math.max(0,Number(prof.on_hand)||0);
    const weekly=Math.max(0,Number(rate.weekly)||0);
    const targetQty=weekly>0?Math.ceil(targetWeeks*weekly):null;
    const suggested=targetQty==null?null:Math.max(0,targetQty-Math.floor(onHand));
    const lastDiscount=item.normal_price>0?(item.normal_price-item.last_paid_price)/item.normal_price:0;
    let action='WAIT', actionClass='pMute', price=item.last_paid_price, current=false;
    if(cur){
      price=cur.price; current=true;
      const ratio=price/item.normal_price;
      if(ratio<=1-settings.discount/100){action='STOCK UP NOW';actionClass='pGood';}
      else if(ratio<=.95){action='BUY IF NEEDED';actionClass='pWarn';}
      else if(ratio<=1.05){action='NORMAL PRICE';actionClass='pMute';}
      else {action='WAIT';actionClass='pBad';}
    } else if(lastDiscount>=settings.discount/100){action='VERIFY DEAL';actionClass='pWarn';}
    else if(lastDiscount>=.05){action='CHECK IF NEEDED';actionClass='pMute';}
    const savingsPer=Math.max(0,item.normal_price-price);
    return {...item,trigger,cur,rate,targetWeeks,onHand,targetQty,suggested,action,actionClass,price,current,savingsPer,lastDiscount};
  }

  function validCurrent(id){
    const x=state.current[id]; if(!x||!(Number(x.price)>0)||!x.confirmed_at) return null;
    const age=(Date.now()-new Date(x.confirmed_at).getTime())/86400000;
    const max=seed.policy?.current_confirmation_max_age_days ?? 3;
    return age>=0&&age<=max?{...x,price:Number(x.price),age}:null;
  }

  function usageRate(item){
    const p=state.profiles[item.product_id]||{};
    if(Number(p.weekly_use)>0) return {weekly:Number(p.weekly_use),source:'manual',confidence:'user-set'};
    const learned=inferFromReceipts(item);
    if(learned) return learned;
    return {weekly:0,source:'unknown',confidence:'need 2+ dated purchases'};
  }

  function inferFromReceipts(item){
    const events=[{date:item.last_purchase_date,qty:1}];
    for(const r of state.importedReceipts){
      if(!r?.date||!Array.isArray(r.lines)) continue;
      let qty=0;
      for(const line of r.lines){
        const n=String(line.name||'').toLowerCase();
        if((item.aliases||[]).some(a=>n.includes(String(a).toLowerCase()))) qty+=Math.max(1,Number(line.qty)||1);
      }
      if(qty) events.push({date:r.date,qty});
    }
    const byDate=new Map();
    events.forEach(e=>byDate.set(e.date,(byDate.get(e.date)||0)+e.qty));
    const arr=[...byDate.entries()].map(([date,qty])=>({date,qty,t:new Date(date+'T12:00:00').getTime()})).filter(x=>Number.isFinite(x.t)).sort((a,b)=>a.t-b.t);
    if(arr.length<2) return null;
    const days=(arr.at(-1).t-arr[0].t)/86400000;
    if(days<7) return null;
    const replenishments=arr.slice(1).reduce((s,x)=>s+x.qty,0);
    const weekly=replenishments/(days/7);
    if(!(weekly>0)) return null;
    return {weekly:Number(weekly.toFixed(2)),source:'receipt-learned',confidence:arr.length>=4?'medium':'low',observations:arr.length,span_days:Math.round(days)};
  }

  function renderRecommendations(scored){
    const rank={"STOCK UP NOW":0,"VERIFY DEAL":1,"BUY IF NEEDED":2,"CHECK IF NEEDED":3,"NORMAL PRICE":4,"WAIT":5};
    const ordered=[...scored].sort((a,b)=>(rank[a.action]??9)-(rank[b.action]??9)||b.lastDiscount-a.lastDiscount);
    const allocation=allocateBudget(ordered);
    $s('#stockRecommendations').innerHTML=ordered.map(x=>{
      const curLabel=x.current?`${x.cur.store} · confirmed ${freshnessText(x.cur)}`:`${x.store} · last paid ${x.last_purchase_date}`;
      const qtyText=x.suggested==null?'Set usage to calculate quantity':x.suggested===0?'Target supply already covered':`Suggested need: ${x.suggested} package${x.suggested===1?'':'s'} for ${x.targetWeeks} weeks`;
      const alloc=allocation[x.product_id]||0;
      const budgetText=x.action==='STOCK UP NOW'?(alloc?`Budget plan: buy ${alloc} · ${moneyS(alloc*x.price)}`:'Budget plan: no allocation'):'Not counted in budget until current price is confirmed as a stock-up deal.';
      return `<div class="compare"><div class="compareTop"><div><b>${esc(x.name)}</b><div class="note">${esc(x.package)} · ${esc(curLabel)}</div></div><span class="pill ${x.actionClass}">${esc(x.action)}</span></div><div class="storeGrid"><div class="storeBox"><div class="storeName">Normal</div><div class="storePrice">${moneyS(x.normal_price)}</div><small>benchmark</small></div><div class="storeBox ${x.current&&x.action==='STOCK UP NOW'?'win':''}"><div class="storeName">${x.current?'Confirmed now':'Last paid'}</div><div class="storePrice">${moneyS(x.price)}</div><small>${x.current?esc(x.cur.store):'receipt history'}</small></div><div class="storeBox"><div class="storeName">Stock-up trigger</div><div class="storePrice">${moneyS(x.trigger)}</div><small>${state.settings.discount}% below normal</small></div><div class="storeBox"><div class="storeName">Save / pack</div><div class="storePrice">${moneyS(x.savingsPer)}</div><small>${Math.max(0,(x.savingsPer/x.normal_price)*100).toFixed(0)}%</small></div></div><div class="impact ${x.action==='WAIT'?'warn':''}">${esc(qtyText)}</div><div class="note">${esc(budgetText)}</div></div>`;
    }).join('');
  }

  function allocateBudget(items){
    let budget=Number(state.settings.budget)||0; const out={};
    const eligible=items.filter(x=>x.action==='STOCK UP NOW'&&x.current&&x.suggested>0).sort((a,b)=>b.savingsPer-a.savingsPer || (b.savingsPer/b.price)-(a.savingsPer/a.price));
    for(const x of eligible){
      const max=Math.min(x.suggested,Math.floor(budget/x.price));
      if(max>0){out[x.product_id]=max;budget-=max*x.price;}
    }
    return out;
  }

  function renderProfiles(scored){
    $s('#stockProfiles').innerHTML=scored.map(x=>{
      const p=state.profiles[x.product_id]||{};
      const current=state.current[x.product_id]||{};
      const learned=x.rate.source==='receipt-learned'?`Auto estimate ${x.rate.weekly}/wk · ${x.rate.observations} purchases over ${x.rate.span_days} days`:x.rate.source==='manual'?`Manual ${x.rate.weekly}/wk`:'Waiting for another dated purchase';
      return `<div class="compare"><div class="compareTop"><div><b>${esc(x.name)}</b><div class="note">${esc(learned)}</div></div><span class="pill ${x.rate.source==='receipt-learned'?'pGood':x.rate.source==='manual'?'pWarn':'pMute'}">${esc(x.rate.confidence)}</span></div><div class="formRow"><label class="note">Packages used per week<input data-stock-weekly="${esc(x.product_id)}" type="number" min="0" step="0.05" value="${esc(p.weekly_use??'')}"></label><label class="note">Packages on hand<input data-stock-hand="${esc(x.product_id)}" type="number" min="0" step="1" value="${esc(p.on_hand??'')}"></label></div><div class="formRow"><select data-stock-store="${esc(x.product_id)}"><option ${sel(current.store,"Sam's Club")}>Sam's Club</option><option ${sel(current.store,'H-E-B')}>H-E-B</option><option ${sel(current.store,'Walmart')}>Walmart</option><option ${sel(current.store,'Dollar General')}>Dollar General</option></select><input data-stock-price="${esc(x.product_id)}" type="number" min="0" step="0.01" placeholder="Confirm current price" value="${esc(current.price??'')}"></div><div class="formRow"><button class="btn secondary" data-save-usage="${esc(x.product_id)}">Save usage</button><button class="btn primary" data-confirm-price="${esc(x.product_id)}">Confirm current price</button></div>${PLAN_MAP[x.product_id]?`<button class="btn secondary" style="width:100%;margin-top:8px" data-add-stock-plan="${esc(x.product_id)}">Add suggested need to Plan</button>`:''}</div>`;
    }).join('');
    $$s('[data-save-usage]').forEach(b=>b.onclick=()=>saveUsage(b.dataset.saveUsage));
    $$s('[data-confirm-price]').forEach(b=>b.onclick=()=>confirmPrice(b.dataset.confirmPrice));
    $$s('[data-add-stock-plan]').forEach(b=>b.onclick=()=>addToPlan(b.dataset.addStockPlan));
  }

  function saveUsage(id){
    const profiles=state.profiles;
    const weekly=Number($s(`[data-stock-weekly="${id}"]`)?.value)||0;
    const onHand=Number($s(`[data-stock-hand="${id}"]`)?.value)||0;
    profiles[id]={weekly_use:Math.max(0,weekly),on_hand:Math.max(0,onHand),updated_at:new Date().toISOString()};
    state.profiles=profiles; render();
  }

  function confirmPrice(id){
    const price=Number($s(`[data-stock-price="${id}"]`)?.value);
    const store=$s(`[data-stock-store="${id}"]`)?.value;
    if(!(price>0)){alert('Enter the current shelf/app price first.');return;}
    const cur=state.current; cur[id]={price,store,confirmed_at:new Date().toISOString()}; state.current=cur; render();
  }

  function addToPlan(id){
    const x=analyzeItem(seed.items.find(i=>i.product_id===id));
    const planId=PLAN_MAP[id]; if(!planId) return;
    const qty=x.suggested>0?x.suggested:1;
    const list=state.shoppingList;
    const existing=list.find(y=>y.product_id===planId);
    // Bulk planner quantity is normalized need. One stock-up package equals the known Sam's pack's native need.
    const needPerPack = id==='sams-dove-sensitive-2'?61.2:id==='sams-bush-baked-beans-8'?132:id==='sams-crest-scope-5'?31.5:1;
    if(existing) existing.qty=Number(existing.qty||0)+qty*needPerPack;
    else list.push({product_id:planId,name:x.name,size:x.package,qty:qty*needPerPack,custom:false,planner_type:'bulk'});
    state.shoppingList=list;
    if(window.renderPlanner) window.renderPlanner();
    alert(`Added ${qty} suggested package${qty===1?'':'s'} to Plan.`);
  }

  function freshnessText(x){
    if(x.age<1) return 'today';
    const d=Math.floor(x.age); return `${d} day${d===1?'':'s'} ago`;
  }
  function sel(a,b){return a===b?'selected':'';}
  function round2(n){return Math.round((Number(n)+Number.EPSILON)*100)/100;}
  function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

  init().catch(err=>console.error('Stock-up engine failed',err));
})();