const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = n => n == null ? '—' : '$' + Number(n).toFixed(2);

let household, hebReceipt, dgReceipt, comparisonData, couponData;
let receiptFile = null;
let parsedCandidates = [];
let deferredPrompt = null;

const state = {
  get activeCoupons(){ return JSON.parse(localStorage.getItem('ec_activeCoupons') || '[]'); },
  set activeCoupons(v){ localStorage.setItem('ec_activeCoupons', JSON.stringify(v)); },
  get importedReceipts(){ return JSON.parse(localStorage.getItem('ec_importedReceipts') || '[]'); },
  set importedReceipts(v){ localStorage.setItem('ec_importedReceipts', JSON.stringify(v)); }
};

async function load(){
  [household, hebReceipt, dgReceipt, comparisonData, couponData] = await Promise.all([
    fetch('./data/household.json').then(r=>r.json()),
    fetch('./receipts/heb-2026-08-29.json').then(r=>r.json()),
    fetch('./receipts/dg-2026-08-29.json').then(r=>r.json()),
    fetch('./data/comparisons.json').then(r=>r.json()),
    fetch('./data/coupons.json').then(r=>r.json())
  ]);
  renderAll();
}

function renderAll(){
  renderHome();
  renderComparisons();
  renderWallet();
  renderHistory();
}

function renderHome(){
  $('#summary').innerHTML = `
    <div class="k"><b>${hebReceipt.items_purchased}</b><span>items</span></div>
    <div class="k"><b>${money(hebReceipt.total_sale)}</b><span>paid</span></div>
    <div class="k"><b>${money(hebReceipt.total_savings)}</b><span>receipt savings</span></div>`;

  const alerts = comparisonData.comparisons
    .map(c=>scoreComparison(c))
    .filter(x=>x && x.impact >= household.optimization_rules.minimum_item_switch_savings)
    .sort((a,b)=>b.impact-a.impact)
    .slice(0,4);

  $('#alerts').innerHTML = alerts.length ? alerts.map(x=>`
    <div class="item">
      <div><b>${x.name}</b><small>${x.qty > 1 ? `${x.qty} normally bought · ` : ''}${x.from} → ${x.to}</small></div>
      <div class="right"><b class="good">save ${money(x.impact)}</b><small>${x.matchQuality}</small></div>
    </div>`).join('') : '<div class="empty">No verified $1+ switches yet.</div>';

  $('#items').innerHTML = household.known_items.map(x=>`
    <div class="item"><div><b>${x.name}</b><small>${x.size || x.category || ''}</small></div>
    <div class="right"><b>${money(x.paid_price ?? x.last_price ?? x.regular_price)}</b><small>${x.last_store}</small></div></div>`).join('');
}

function scoreComparison(c){
  const verified = Object.entries(c.stores || {}).filter(([,v])=>v.verified && v.price != null);
  if(verified.length < 2) return null;
  const sorted = verified.sort((a,b)=>a[1].price-b[1].price);
  const best = sorted[0];
  const current = c.stores['H-E-B']?.verified ? ['H-E-B', c.stores['H-E-B']] : sorted[sorted.length-1];
  const per = Math.max(0, current[1].price - best[1].price);
  const impact = per * (c.usual_qty || 1);
  return {name:c.name, from:current[0], to:best[0], impact, per, qty:c.usual_qty||1, matchQuality:c.match_quality, bestStore:best[0]};
}

function renderComparisons(){
  $('#comparisons').innerHTML = comparisonData.comparisons.map(c=>{
    const verified = Object.entries(c.stores||{}).filter(([,v])=>v.verified && v.price != null);
    const best = verified.length ? verified.reduce((a,b)=>a[1].price <= b[1].price ? a : b) : null;
    const score = scoreComparison(c);
    const exactRequired = household.optimization_rules.require_exact_match_for_branded_items;
    const isSubstitute = c.match_quality === 'substitute-only';
    const canAutoRecommend = !(exactRequired && isSubstitute);
    const storeNames = ['H-E-B','Walmart','Dollar General'];
    const boxes = storeNames.map(store=>{
      const v = c.stores?.[store];
      if(!v) return `<div class="storeBox"><div class="storeName">${store}</div><div class="storePrice">—</div><small>unverified</small></div>`;
      const wins = best && best[0]===store && canAutoRecommend;
      return `<div class="storeBox ${wins?'win':''}"><div class="storeName">${store}</div><div class="storePrice">${money(v.price)}</div><small>${v.verified?'verified':'unverified'}</small></div>`;
    }).join('');
    let verdict = '';
    if(isSubstitute) verdict = `<div class="impact warn">Substitute only — excluded from exact-product winner.</div>`;
    else if(score && score.impact >= household.optimization_rules.minimum_item_switch_savings) verdict = `<div class="impact">${score.to} saves ${money(score.impact)} at usual quantity.</div>`;
    else if(score) verdict = `<div class="impact warn">Difference ${money(score.impact)} — below your $${household.optimization_rules.minimum_item_switch_savings.toFixed(2)} item-switch threshold.</div>`;
    return `<div class="compare"><div class="compareTop"><div><b>${c.name}</b><div class="note">${c.size} · ${c.match_quality}</div></div><span class="pill ${c.match_quality==='exact'?'pGood':'pWarn'}">${c.match_quality}</span></div><div class="storeGrid">${boxes}</div>${verdict}</div>`;
  }).join('');
}

function renderWallet(){
  const active = state.activeCoupons;
  $('#activeCoupons').innerHTML = active.length ? active.map((c,i)=>`
    <div class="coupon"><div><b>${c.name}</b><small>${c.store} · confirmed clipped</small></div><div class="right"><b>${money(c.value)}</b><button class="btn danger" style="padding:5px 8px;margin-top:4px" onclick="removeCoupon(${i})">Remove</button></div></div>`).join('') : '<div class="empty">No active coupons saved yet.</div>';
  $('#couponHistory').innerHTML = couponData.history.map(c=>`
    <div class="coupon"><div><b>${c.name}</b><small>${c.store} · ${c.date} · ${c.status}</small></div><div class="right"><b>${money(c.value)}</b><small>${c.source}</small></div></div>`).join('');
}

window.removeCoupon = i => { const a=state.activeCoupons; a.splice(i,1); state.activeCoupons=a; renderWallet(); };

function renderHistory(){
  const imported = state.importedReceipts;
  const fixed = [
    {store:'H-E-B',date:hebReceipt.date,total:hebReceipt.total_sale,items:hebReceipt.items_purchased,source:'baseline'},
    {store:'Dollar General',date:dgReceipt.date,total:dgReceipt.total_paid,items:null,source:'baseline'}
  ];
  const all = [...imported, ...fixed];
  $('#receiptHistory').innerHTML = all.map(r=>`
    <div class="history"><div><b>${r.store}</b><small>${r.date || 'date unknown'} · ${r.source || 'imported'}</small></div><div class="right"><b>${money(r.total)}</b><small>${r.items ? r.items+' items' : ''}</small></div></div>`).join('');
}

function detectStore(text){
  const t=text.toUpperCase();
  if(t.includes('H-E-B') || t.includes(' HEB ')) return 'H-E-B';
  if(t.includes('DOLLAR GENERAL')) return 'Dollar General';
  if(t.includes('WALMART')) return 'Walmart';
  return 'Other';
}

function findTotal(text, store){
  const lines=text.split(/\r?\n/);
  const patterns = store==='H-E-B'
    ? [/TOTAL SALE[^\d]*(\d+\.\d{2})/i,/SALE SUBTOTAL[^\d]*(\d+\.\d{2})/i]
    : store==='Dollar General'
      ? [/BALANCE TO PAY[^\d]*(\d+\.\d{2})/i,/TOTAL PURCHASE[^\d]*(\d+\.\d{2})/i]
      : [/TOTAL[^\d]*(\d+\.\d{2})/i];
  for(const p of patterns){ const m=text.match(p); if(m) return Number(m[1]); }
  return null;
}

function parseReceiptText(text){
  const selected=$('#storeSelect').value;
  const store=selected==='Auto-detect store' ? detectStore(text) : selected;
  const rawLines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const candidates=[];
  for(const line of rawLines){
    if(/TOTAL|SUBTOTAL|TAX|SAVING|COUPON|DEBIT|CHANGE|BALANCE/i.test(line)) continue;
    let m=line.match(/^\s*\d+\s+(.+?)\s+(\d+\.\d{2})(?:\s*[A-Z]{0,2})?\s*$/);
    if(!m) m=line.match(/^(.+?)[\s$]+(\d+\.\d{2})\s*$/);
    if(!m) continue;
    const name=m[1].replace(/\s+/g,' ').trim();
    const price=Number(m[2]);
    if(name.length<3 || price<=0 || price>999) continue;
    candidates.push({include:true,name,price});
  }
  parsedCandidates=candidates.slice(0,160);
  renderCandidates();
  return {store,total:findTotal(text,store),candidates:parsedCandidates};
}

function renderCandidates(){
  if(!parsedCandidates.length){ $('#candidates').innerHTML='<div class="empty">No confident item lines found. You can edit the OCR text and parse again.</div>'; return; }
  $('#candidates').innerHTML=parsedCandidates.map((c,i)=>`
    <div class="candidate"><input type="checkbox" ${c.include?'checked':''} data-inc="${i}"><input value="${escapeHtml(c.name)}" data-name="${i}"><input type="number" step="0.01" value="${c.price.toFixed(2)}" data-price="${i}"></div>`).join('');
  $$('[data-inc]').forEach(el=>el.onchange=e=>parsedCandidates[+e.target.dataset.inc].include=e.target.checked);
  $$('[data-name]').forEach(el=>el.oninput=e=>parsedCandidates[+e.target.dataset.name].name=e.target.value);
  $$('[data-price]').forEach(el=>el.oninput=e=>parsedCandidates[+e.target.dataset.price].price=Number(e.target.value));
}

function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

async function runOCR(){
  if(!receiptFile){ alert('Take or choose a receipt photo first.'); return; }
  if(!window.Tesseract){ alert('OCR library did not load. Paste receipt text instead.'); return; }
  $('#ocrStatus').textContent='Starting on-device OCR…';
  $('#ocrProgress').style.width='2%';
  try{
    const result = await Tesseract.recognize(receiptFile,'eng',{logger:m=>{
      if(m.status==='recognizing text') $('#ocrProgress').style.width=Math.round((m.progress||0)*100)+'%';
      $('#ocrStatus').textContent=m.status + (m.progress!=null ? ` ${Math.round(m.progress*100)}%` : '');
    }});
    $('#receiptText').value=result.data.text;
    $('#ocrStatus').textContent='OCR complete. Review the text, then confirm parsed lines.';
    parseReceiptText(result.data.text);
  }catch(err){ $('#ocrStatus').textContent='OCR failed: '+err.message; }
}

function saveReceipt(){
  const confirmed=parsedCandidates.filter(x=>x.include && x.name && x.price>0);
  if(!confirmed.length){ alert('No confirmed item lines to save.'); return; }
  const text=$('#receiptText').value;
  const selected=$('#storeSelect').value;
  const store=selected==='Auto-detect store' ? detectStore(text) : selected;
  const total=findTotal(text,store) ?? confirmed.reduce((s,x)=>s+x.price,0);
  const receipt={id:Date.now(),store,date:new Date().toISOString().slice(0,10),total:Number(total.toFixed(2)),items:confirmed.length,source:'phone receipt import',lines:confirmed};
  const all=state.importedReceipts; all.unshift(receipt); state.importedReceipts=all;
  $('#ocrStatus').textContent=`Saved ${confirmed.length} confirmed lines for ${store}.`;
  renderHistory();
}

function bind(){
  $$('.tab').forEach(btn=>btn.onclick=()=>{
    $$('.tab').forEach(x=>x.classList.remove('active')); $$('.panel').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active'); $('#'+btn.dataset.tab).classList.add('active');
  });
  $('#receiptImage').onchange=e=>{
    receiptFile=e.target.files?.[0]||null;
    if(receiptFile){ $('#preview').src=URL.createObjectURL(receiptFile); $('#preview').hidden=false; }
  };
  $('#ocrBtn').onclick=runOCR;
  $('#parseBtn').onclick=()=>parseReceiptText($('#receiptText').value);
  $('#saveReceiptBtn').onclick=saveReceipt;
  $('#addCouponBtn').onclick=()=>{
    const name=$('#couponName').value.trim(), value=Number($('#couponValue').value), store=$('#couponStore').value;
    if(!name || !(value>0)){ alert('Enter a coupon name and value.'); return; }
    const a=state.activeCoupons; a.push({name,value,store,confirmed:true,added_at:new Date().toISOString()}); state.activeCoupons=a;
    $('#couponName').value=''; $('#couponValue').value=''; renderWallet();
  };
  $('#refreshBtn').onclick=()=>location.reload();
  $('#installBtn').onclick=async()=>{
    if(deferredPrompt){ deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; }
    else alert('In Chrome, use the browser menu and choose Add to Home screen / Install app.');
  };
}

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
bind();
load().catch(err=>{console.error(err);document.body.insertAdjacentHTML('beforeend',`<div style="padding:20px;color:#fecaca">App data failed to load: ${escapeHtml(err.message)}</div>`);});