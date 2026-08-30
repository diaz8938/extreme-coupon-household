(() => {
  const $b = s => document.querySelector(s);
  const $$b = s => [...document.querySelectorAll(s)];
  const moneyB = n => n == null ? '—' : '$' + Number(n).toFixed(2);
  let unitData = null;

  const unitState = {
    get overrides(){ return JSON.parse(localStorage.getItem('ec_unitOverrides') || '{}'); },
    set overrides(v){ localStorage.setItem('ec_unitOverrides', JSON.stringify(v)); }
  };

  async function initBulk(){
    if(!$b('#bulkNormalized')) return;
    unitData = await fetch('./data/unit_catalog.json').then(r=>r.json());
    applyOverrides();
    renderBulk();
    bindBulk();
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
    const unresolved = unitData.items.filter(x=>x.unit_price == null);
    $b('#bulkSummary').innerHTML = `
      <div class="k"><b>${normalized.length}</b><span>unit-normalized</span></div>
      <div class="k"><b>${unresolved.length}</b><span>need pack size</span></div>
      <div class="k"><b>${moneyB(normalized.reduce((s,x)=>s+(x.instant_savings||0),0))}</b><span>savings on normalized</span></div>`;

    $b('#bulkNormalized').innerHTML = normalized.map(x=>{
      const confidence = x.pack_confidence === 'high' || x.pack_confidence === 'user-confirmed' ? 'pGood' : x.pack_confidence === 'medium' ? 'pWarn' : 'pBad';
      const unitLabel = prettyUnit(x.unit_basis);
      return `<div class="compare"><div class="compareTop"><div><b>${esc(x.display_name)}</b><div class="note">Sam's receipt ${esc(x.receipt_name)} · ${x.pack_units} ${esc(unitLabel)}${x.pack_units===1?'':'s'}</div></div><span class="pill ${confidence}">${esc(x.pack_confidence)}</span></div><div class="storeGrid"><div class="storeBox win"><div class="storeName">Sam's paid</div><div class="storePrice">${moneyB(x.paid_price)}</div><small>${x.instant_savings?`after ${moneyB(x.instant_savings)} Instant Savings`:'receipt price'}</small></div><div class="storeBox"><div class="storeName">Unit price</div><div class="storePrice">${moneyB(x.unit_price)}</div><small>per ${esc(unitLabel)}</small></div></div><div class="impact ${x.status.includes('needs')?'warn':''}">${statusText(x)}</div></div>`;
    }).join('') || '<div class="empty">No normalized warehouse items yet.</div>';

    $b('#bulkNeeds').innerHTML = unresolved.map(x=>`<div class="compare"><div class="compareTop"><div><b>${esc(x.display_name)}</b><div class="note">${esc(x.receipt_name)} · paid ${moneyB(x.paid_price)}</div></div><span class="pill pWarn">needs pack size</span></div><div class="formRow"><input data-bulk-name="${esc(x.item_code)}" placeholder="Exact product name (optional)" value="${esc(x.display_name||'')}"><input data-bulk-units="${esc(x.item_code)}" type="number" min="0" step="0.01" placeholder="Pack units"></div><div class="formRow"><select data-bulk-basis="${esc(x.item_code)}"><option value="count">count / each</option><option value="ounce">ounces</option><option value="pound">pounds</option><option value="roll">rolls</option><option value="sheet">sheets</option><option value="fluid-ounce">fluid ounces</option><option value="pack-piece">pack pieces</option></select><button class="btn primary" data-bulk-save="${esc(x.item_code)}">Save pack size</button></div><div class="note">${esc(x.status)}. Once saved, this item moves into normalized unit pricing on this phone.</div></div>`).join('') || '<div class="empty">Everything is normalized.</div>';

    $$b('[data-bulk-save]').forEach(btn=>btn.onclick=()=>saveOverride(btn.dataset.bulkSave));
    renderCalculator();
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
    return basis || 'unit';
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
    $b('#bulkCalcResult').innerHTML=`<div class="resultBanner"><span class="tiny">NORMALIZED UNIT COMPARISON</span><strong>${esc(winner)}</strong><div class="note">Sam's ${moneyB(a)}/unit · competitor ${moneyB(b)}/unit</div><div class="impact">${winner==='Tie'?'Same unit price':`${moneyB(d)} per unit cheaper · ${pct.toFixed(1)}% advantage`}</div></div>`;
  }

  function bindBulk(){
    ['#bulkPrice','#bulkUnits','#compPrice','#compUnits'].forEach(s=>{const el=$b(s);if(el)el.oninput=renderCalculator;});
  }

  function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  initBulk().catch(err=>{console.error(err);if($b('#bulkNormalized'))$b('#bulkNormalized').innerHTML=`<div class="empty">Bulk engine failed: ${esc(err.message)}</div>`;});
})();