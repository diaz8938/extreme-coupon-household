(() => {
  const $b = s => document.querySelector(s);
  const $$b = s => [...document.querySelectorAll(s)];
  const moneyB = n => n == null ? '—' : '$' + Number(n).toFixed(2);
  let unitData = null;
  let competitorData = null;

  const unitState = {
    get overrides(){ return JSON.parse(localStorage.getItem('ec_unitOverrides') || '{}'); },
    set overrides(v){ localStorage.setItem('ec_unitOverrides', JSON.stringify(v)); }
  };

  async function initBulk(){
    if(!$b('#bulkNormalized')) return;
    [unitData, competitorData] = await Promise.all([
      fetch('./data/unit_catalog.json').then(r=>r.json()),
      fetch('./data/unit_competitors.json').then(r=>r.json())
    ]);
    applyOverrides();
    ensureReferenceCard();
    renderBulk();
    bindBulk();
  }

  function ensureReferenceCard(){
    if($b('#bulkReferences')) return;
    const normalizedCard = $b('#bulkNormalized')?.closest('.card');
    if(!normalizedCard) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h2>Cross-store unit references</h2><div class="note">Sam's receipt prices are locally verified. H-E-B/Walmart values below are current online references until a San Angelo shelf/app price is confirmed. Reference prices can guide a decision, but they cannot auto-route your trip.</div><div id="bulkReferences"></div>`;
    normalizedCard.after(card);
  }

  function applyOverrides(){
    const ov = unitState.overrides;
    unitData.items = unitData.items.map(x => {
      const o = ov[x.item_code];
      if(!o) return x;
      const units = Number(o.pack_units);
      return {
        ...x,
        display_name:o.display_name || x.display_name,
        unit_basis:o.unit_basis || x.unit_basis,
        pack_units:units>0?units:x.pack_units,
        unit_price:units>0?Number(((x.paid_price||0)/units).toFixed(4)):x.unit_price,
        pack_confidence:'user-confirmed',
        status:units>0?'normalized-user-confirmed':x.status
      };
    });
  }

  function renderBulk(){
    const normalized = unitData.items.filter(x=>x.unit_price != null);
    const unresolved = unitData.items.filter(x=>x.unit_price == null || String(x.status||'').includes('needs-product'));
    const normalizedSavings = normalized.reduce((s,x)=>s+(x.instant_savings||0),0);
    $b('#bulkSummary').innerHTML = `
      <div class="k"><b>${normalized.length}</b><span>unit-normalized</span></div>
      <div class="k"><b>${unresolved.length}</b><span>need resolution</span></div>
      <div class="k"><b>${moneyB(normalizedSavings)}</b><span>Instant Savings normalized</span></div>`;

    $b('#bulkNormalized').innerHTML = normalized.map(x=>{
      const confidence = ['high','web-confirmed','user-confirmed'].includes(x.pack_confidence) ? 'pGood' : x.pack_confidence === 'medium' ? 'pWarn' : 'pBad';
      const unitLabel = prettyUnit(x.unit_basis);
      const needsIdentity = String(x.status||'').includes('needs-product');
      return `<div class="compare"><div class="compareTop"><div><b>${esc(x.display_name)}</b><div class="note">Sam's receipt ${esc(x.receipt_name)} · ${formatUnits(x.pack_units)} ${esc(unitLabel)}</div></div><span class="pill ${confidence}">${esc(x.pack_confidence)}</span></div><div class="storeGrid"><div class="storeBox win"><div class="storeName">Sam's paid</div><div class="storePrice">${moneyB(x.paid_price)}</div><small>${x.instant_savings?`after ${moneyB(x.instant_savings)} Instant Savings`:'receipt price'}</small></div><div class="storeBox"><div class="storeName">Unit price</div><div class="storePrice">${unitMoney(x.unit_price)}</div><small>per ${esc(unitLabel)}</small></div></div><div class="impact ${needsIdentity?'warn':''}">${statusText(x)}</div></div>`;
    }).join('') || '<div class="empty">No normalized warehouse items yet.</div>';

    $b('#bulkNeeds').innerHTML = unresolved.map(x=>`<div class="compare"><div class="compareTop"><div><b>${esc(x.display_name)}</b><div class="note">${esc(x.receipt_name)} · paid ${moneyB(x.paid_price)}</div></div><span class="pill pWarn">needs confirmation</span></div><div class="formRow"><input data-bulk-name="${esc(x.item_code)}" placeholder="Exact product name (optional)" value="${esc(x.display_name||'')}"><input data-bulk-units="${esc(x.item_code)}" type="number" min="0" step="0.01" placeholder="Pack units" value="${x.pack_units||''}"></div><div class="formRow"><select data-bulk-basis="${esc(x.item_code)}"><option value="count">count / each</option><option value="ounce">ounces</option><option value="pound">pounds</option><option value="roll">rolls</option><option value="100-sheets">100 sheets</option><option value="sheet">sheets</option><option value="fluid-ounce">fluid ounces</option><option value="pack-piece">pack pieces</option></select><button class="btn primary" data-bulk-save="${esc(x.item_code)}">Confirm details</button></div><div class="note">${esc(x.status)}. Confirming details is stored only on this device.</div></div>`).join('') || '<div class="empty">Everything has enough detail for unit math.</div>';

    $$b('[data-bulk-save]').forEach(btn=>btn.onclick=()=>saveOverride(btn.dataset.bulkSave));
    renderReferences();
    renderCalculator();
  }

  function renderReferences(){
    const el = $b('#bulkReferences');
    if(!el || !competitorData) return;
    const rows = competitorData.comparisons || [];
    el.innerHTML = rows.map(c=>{
      const refs = (c.references||[]).filter(r=>r.unit_price!=null);
      if(!refs.length) return '';
      const bestRef = refs.reduce((a,b)=>a.unit_price<=b.unit_price?a:b);
      const samUnit = Number(c.sams.unit_price);
      const refUnit = Number(bestRef.unit_price);
      const samLeads = samUnit < refUnit;
      const diff = Math.abs(samUnit-refUnit);
      const pct = Math.max(samUnit,refUnit)>0 ? diff/Math.max(samUnit,refUnit)*100 : 0;
      const lead = samLeads
        ? `Sam's receipt leads the best online reference by ${pct.toFixed(1)}% per ${prettyUnit(c.unit_basis)}.`
        : `${bestRef.store} online reference leads Sam's receipt by ${pct.toFixed(1)}% per ${prettyUnit(c.unit_basis)}.`;
      const boxes = [`<div class="storeBox win"><div class="storeName">Sam's receipt</div><div class="storePrice">${unitMoney(samUnit)}</div><small>local verified</small></div>`]
        .concat(refs.map(r=>`<div class="storeBox"><div class="storeName">${esc(r.store)}</div><div class="storePrice">${unitMoney(r.unit_price)}</div><small>${esc(r.confidence)} · ${esc(r.match_quality)}</small></div>`)).join('');
      return `<div class="compare"><div class="compareTop"><div><b>${esc(c.name)}</b><div class="note">normalized per ${esc(prettyUnit(c.unit_basis))}</div></div><span class="pill pWarn">REFERENCE</span></div><div class="storeGrid">${boxes}</div><div class="impact ${samLeads?'':'warn'}">${lead}</div><div class="note">Confirm the competitor's local San Angelo price before this result is allowed to auto-route your shopping trip.</div></div>`;
    }).join('') || '<div class="empty">No same-basis online references yet.</div>';
  }

  function saveOverride(code){
    const units = Number($b(`[data-bulk-units="${code}"]`)?.value);
    const basis = $b(`[data-bulk-basis="${code}"]`)?.value || 'count';
    const name = $b(`[data-bulk-name="${code}"]`)?.value.trim() || '';
    if(!(units>0)){ alert('Enter the package unit count or size first.'); return; }
    const ov = unitState.overrides;
    ov[code] = {pack_units:units,unit_basis:basis,display_name:name,confirmed_at:new Date().toISOString()};
    unitState.overrides = ov;
    applyOverrides();
    renderBulk();
  }

  function prettyUnit(basis){
    if(basis==='count') return 'each';
    if(basis==='pack-piece') return 'pack piece';
    if(basis==='fluid-ounce') return 'fl oz';
    if(basis==='100-sheets') return '100 sheets';
    return basis || 'unit';
  }

  function formatUnits(n){
    const v=Number(n);
    return Number.isInteger(v)?String(v):v.toFixed(1).replace(/\.0$/,'');
  }

  function unitMoney(n){
    const v=Number(n);
    if(!Number.isFinite(v)) return '—';
    return v < 0.10 ? '$'+v.toFixed(3) : '$'+v.toFixed(2);
  }

  function statusText(x){
    if(x.status === 'normalized' || x.status === 'normalized-user-confirmed') return 'Ready for same-basis competitor comparison.';
    if(x.status === 'normalized-but-size-needed-for-cross-store') return 'Internal unit math works, but exact jar/package size is still required before cross-store comparison.';
    if(x.status === 'needs-product-resolution') return 'Count is usable, but exact product identity should be confirmed before comparing brands.';
    return 'Needs more detail before a cross-store winner is allowed.';
  }

  function renderCalculator(){
    const p = Number($b('#bulkPrice')?.value);
    const u = Number($b('#bulkUnits')?.value);
    const q = Number($b('#compPrice')?.value);
    const v = Number($b('#compUnits')?.value);
    if(!(p>0&&u>0&&q>0&&v>0)){
      if($b('#bulkCalcResult')) $b('#bulkCalcResult').innerHTML='<div class="empty">Enter both package prices and equivalent unit counts.</div>';
      return;
    }
    const a=p/u,b=q/v,d=Math.abs(a-b),winner=a<b?"Sam's":a>b?'Competitor':'Tie';
    const pct=Math.max(a,b)>0?d/Math.max(a,b)*100:0;
    $b('#bulkCalcResult').innerHTML=`<div class="resultBanner"><span class="tiny">NORMALIZED UNIT COMPARISON</span><strong>${esc(winner)}</strong><div class="note">Sam's ${unitMoney(a)}/unit · competitor ${unitMoney(b)}/unit</div><div class="impact">${winner==='Tie'?'Same unit price':`${unitMoney(d)} per unit cheaper · ${pct.toFixed(1)}% advantage`}</div></div>`;
  }

  function bindBulk(){
    ['#bulkPrice','#bulkUnits','#compPrice','#compUnits'].forEach(s=>{const el=$b(s);if(el)el.oninput=renderCalculator;});
  }

  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  initBulk().catch(err=>{console.error(err);if($b('#bulkNormalized'))$b('#bulkNormalized').innerHTML=`<div class="empty">Bulk engine failed: ${esc(err.message)}</div>`;});
})();