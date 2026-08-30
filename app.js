const $ = s => document.querySelector(s);
const money = n => '$' + Number(n || 0).toFixed(2);
let household, receipt;

async function load() {
  household = await fetch('./data/household.json').then(r=>r.json());
  receipt = await fetch('./receipts/heb-2026-08-29.json').then(r=>r.json());
  render();
}

function render() {
  $('#summary').innerHTML = `
    <div class="k"><b>${receipt.items_purchased}</b><span>items</span></div>
    <div class="k"><b>${money(receipt.total_sale)}</b><span>paid</span></div>
    <div class="k"><b>${money(receipt.total_savings)}</b><span>saved</span></div>`;
  $('#rules').innerHTML = Object.entries(household.optimization_rules)
    .map(([k,v])=>`<div class="rule"><span>${k.replaceAll('_',' ')}</span><b>${v}</b></div>`).join('');
  $('#items').innerHTML = household.known_items.map((x,i)=>`
    <div class="item">
      <div><b>${x.name}</b><small>${x.size||x.category||''}</small></div>
      <div class="right"><b>${money(x.paid_price ?? x.last_price ?? x.regular_price)}</b><small>${x.last_store}</small></div>
    </div>`).join('');
}

load();
