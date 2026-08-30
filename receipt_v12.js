(() => {
  let receiptMatchCatalog = {items:[]};

  const compact12 = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const storeKey12 = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const codeKey12 = s => String(s||'').replace(/\D/g,'').replace(/^0+/,'') || '0';

  fetch('./data/receipt_match_catalog.json')
    .then(r=>r.json())
    .then(x=>{ receiptMatchCatalog=x; })
    .catch(err=>console.warn('Receipt match catalog unavailable',err));

  function catalogMatch12(name,itemCode,store){
    const code=String(itemCode||'').replace(/\D/g,'');
    const ck=codeKey12(code);
    const nk=compact12(name);
    const sk=storeKey12(store);
    let aliasHit=null;
    for(const item of receiptMatchCatalog.items||[]){
      if(item.store && storeKey12(item.store)!==sk) continue;
      if(code){
        for(const known of item.item_codes||[]){
          if(code===String(known) || (ck.length>=6 && ck===codeKey12(known))){
            return {...item,match_confidence:'item-code-exact'};
          }
        }
      }
      for(const alias of item.aliases||[]){
        const ak=compact12(alias);
        if(!ak) continue;
        if(nk===ak || (ak.length>=7 && (nk.includes(ak) || ak.includes(nk)))){
          aliasHit={...item,match_confidence:'alias-exact'};
        }
      }
    }
    return aliasHit;
  }

  function makeCandidate12({name,itemCode='',qty=1,unitPrice,lineTotal,store,rawLine}){
    const rawName=String(name||'').replace(/\s+/g,' ').trim();
    const q=Math.max(1,Math.round(Number(qty)||1));
    const up=Number(unitPrice);
    const lt=Number(lineTotal ?? (up*q));
    if(rawName.length<2 || !(up>0) || up>9999) return null;
    const known=catalogMatch12(rawName,itemCode,store);
    return {
      include:true,
      name:known?.normalized_name || rawName,
      raw_name:rawName,
      item_code:String(itemCode||''),
      qty:q,
      price:Number(up.toFixed(2)),
      unit_price:Number(up.toFixed(2)),
      line_total:Number((Number.isFinite(lt)?lt:up*q).toFixed(2)),
      product_id:known?.product_id || '',
      match_confidence:known?.match_confidence || 'unmatched',
      raw_line:rawLine || ''
    };
  }

  function enhancedParse12(text){
    const selected=$('#storeSelect').value;
    const store=selected==='Auto-detect store'?detectStore(text):selected;
    const candidates=[];
    let pendingName='';

    const lines=String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    for(const raw of lines){
      const line=raw.replace(/\s+/g,' ').trim();
      if(/\b(TOTAL|SUBTOTAL|TAX|SAVING|COUPON|DEBIT|CREDIT|CHANGE|BALANCE|INSTANT SAV|INST SV|TENDER|AUTH|CARD)\b/i.test(line)){
        pendingName='';
        continue;
      }

      let m=line.match(/^(\d+)\s*(?:EA|EACH|PCS?)?\s*@\s*(?:1\s*\/\s*)?\$?(\d+\.\d{2})\s*(?:[A-Z]{1,2})?\s*\$?(\d+\.\d{2})$/i);
      if(m && pendingName){
        const c=makeCandidate12({name:pendingName,qty:Number(m[1]),unitPrice:Number(m[2]),lineTotal:Number(m[3]),store,rawLine:raw});
        if(c) candidates.push(c);
        pendingName='';
        continue;
      }

      m=line.match(/^(?:(\d{6,14})\s+)?(.+?)\s+(\d+)\s*(?:EA|EACH|PCS?|X)\s*@\s*(?:1\s*\/\s*)?\$?(\d+\.\d{2})\s*(?:[A-Z]{1,2})?\s*\$?(\d+\.\d{2})$/i);
      if(m){
        const c=makeCandidate12({name:m[2],itemCode:m[1]||'',qty:Number(m[3]),unitPrice:Number(m[4]),lineTotal:Number(m[5]),store,rawLine:raw});
        if(c) candidates.push(c);
        pendingName='';
        continue;
      }

      m=line.match(/^(?:(\d{6,14})\s+)?(.+?)\s+(\d+)\s*[Xx]\s*\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/);
      if(m){
        const c=makeCandidate12({name:m[2],itemCode:m[1]||'',qty:Number(m[3]),unitPrice:Number(m[4]),lineTotal:Number(m[5]),store,rawLine:raw});
        if(c) candidates.push(c);
        pendingName='';
        continue;
      }

      m=line.match(/^(\d{6,14})\s+(.+?)\s+\$?(\d+\.\d{2})(?:\s+[A-Z]{1,2})?$/i);
      if(m){
        const c=makeCandidate12({name:m[2],itemCode:m[1],qty:1,unitPrice:Number(m[3]),lineTotal:Number(m[3]),store,rawLine:raw});
        if(c) candidates.push(c);
        pendingName='';
        continue;
      }

      m=line.match(/^\d{1,3}\s+(.+?)\s+\$?(\d+\.\d{2})(?:\s+[A-Z]{1,2})?$/i);
      if(m){
        const c=makeCandidate12({name:m[1],qty:1,unitPrice:Number(m[2]),lineTotal:Number(m[2]),store,rawLine:raw});
        if(c) candidates.push(c);
        pendingName='';
        continue;
      }

      m=line.match(/^(.+?)[\s$]+(\d+\.\d{2})(?:\s+[A-Z]{1,2})?$/i);
      if(m){
        const c=makeCandidate12({name:m[1],qty:1,unitPrice:Number(m[2]),lineTotal:Number(m[2]),store,rawLine:raw});
        if(c) candidates.push(c);
        pendingName='';
        continue;
      }

      if(/[A-Z]{3}/i.test(line) && !/^\d+[\s.:/-]*$/.test(line) && line.length>=3 && line.length<=80){
        pendingName=line.replace(/^\d{1,3}\s+/,'').trim();
      } else pendingName='';
    }

    parsedCandidates=candidates.slice(0,180);
    renderCandidates();
    return {store,total:findTotal(text,store),candidates:parsedCandidates};
  }

  function enhancedRender12(){
    if(!parsedCandidates.length){
      $('#candidates').innerHTML='<div class="empty">No confident item lines found. Edit the OCR text and parse again.</div>';
      return;
    }
    $('#candidates').innerHTML=parsedCandidates.map((c,i)=>{
      const badge=c.match_confidence==='item-code-exact'?'CODE MATCH':c.match_confidence==='alias-exact'?'KNOWN ITEM':'UNMATCHED';
      const badgeClass=c.match_confidence==='item-code-exact'?'pGood':c.match_confidence==='alias-exact'?'pWarn':'pMute';
      return `<div class="candidate" style="align-items:start"><input type="checkbox" ${c.include?'checked':''} data-inc="${i}"><div><input value="${escapeHtml(c.name)}" data-name="${i}"><div class="formRow" style="margin-top:5px"><label class="note">Qty<input data-qty="${i}" type="number" min="1" step="1" value="${Math.max(1,Number(c.qty)||1)}" style="padding:7px"></label><label class="note">Item / UPC code<input data-code="${i}" value="${escapeHtml(c.item_code||'')}" placeholder="if printed" style="padding:7px"></label></div><small><span class="pill ${badgeClass}">${badge}</span> · line ${money(Number(c.line_total)||Number(c.price)||0)}</small></div><input type="number" step="0.01" value="${Number(c.unit_price??c.price).toFixed(2)}" data-price="${i}" aria-label="Unit price"></div>`;
    }).join('');

    $$('[data-inc]').forEach(el=>el.onchange=e=>parsedCandidates[+e.target.dataset.inc].include=e.target.checked);
    $$('[data-name]').forEach(el=>el.oninput=e=>parsedCandidates[+e.target.dataset.name].name=e.target.value);
    $$('[data-qty]').forEach(el=>el.oninput=e=>{
      const i=+e.target.dataset.qty,c=parsedCandidates[i]; c.qty=Math.max(1,Math.round(Number(e.target.value)||1)); c.line_total=Number((Number(c.unit_price??c.price)*c.qty).toFixed(2));
    });
    $$('[data-code]').forEach(el=>el.oninput=e=>{
      const i=+e.target.dataset.code,c=parsedCandidates[i]; c.item_code=e.target.value.replace(/\D/g,'');
      const known=catalogMatch12(c.raw_name||c.name,c.item_code,($('#storeSelect').value==='Auto-detect store'?detectStore($('#receiptText').value):$('#storeSelect').value));
      if(known){ c.product_id=known.product_id;c.match_confidence=known.match_confidence;c.name=known.normalized_name; }
    });
    $$('[data-price]').forEach(el=>el.oninput=e=>{
      const i=+e.target.dataset.price,c=parsedCandidates[i],p=Number(e.target.value); c.price=p;c.unit_price=p;c.line_total=Number((p*(Number(c.qty)||1)).toFixed(2));
    });
  }

  function extractDate12(text){
    const now=new Date();
    const matches=[...String(text||'').matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/g)];
    for(const m of matches){
      let y=Number(m[3]); if(y<100) y+=2000;
      const mo=Number(m[1]),d=Number(m[2]);
      const dt=new Date(y,mo-1,d,12,0,0);
      if(dt.getFullYear()!==y||dt.getMonth()!==mo-1||dt.getDate()!==d) continue;
      if(y<2020 || dt.getTime()>now.getTime()+7*86400000) continue;
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    return now.toISOString().slice(0,10);
  }

  function fingerprint12(receipt){
    const sig=(receipt.lines||[]).map(x=>`${x.item_code||compact12(x.name)}:${x.qty||1}:${Number((x.unit_price ?? x.price) || 0).toFixed(2)}`).sort().join('|');
    const base=`${storeKey12(receipt.store)}|${receipt.date}|${Number(receipt.total||0).toFixed(2)}|${sig}`;
    let h=2166136261;
    for(let i=0;i<base.length;i++){h^=base.charCodeAt(i);h=Math.imul(h,16777619);}
    return `r${(h>>>0).toString(16)}`;
  }

  function enhancedSave12(){
    const confirmed=parsedCandidates.filter(x=>x.include&&x.name&&Number(x.unit_price??x.price)>0);
    if(!confirmed.length){alert('No confirmed item lines to save.');return;}
    const text=$('#receiptText').value;
    const selected=$('#storeSelect').value;
    const store=selected==='Auto-detect store'?detectStore(text):selected;
    const date=extractDate12(text);
    const total=findTotal(text,store) ?? confirmed.reduce((s,x)=>s+Number(x.line_total ?? ((x.unit_price??x.price)*(x.qty||1))),0);
    const receipt={
      id:Date.now(),store,date,total:Number(total.toFixed(2)),
      items:confirmed.reduce((s,x)=>s+Math.max(1,Number(x.qty)||1),0),
      source:'phone receipt import v1.2',
      parser_version:'1.2',
      lines:confirmed.map(x=>({
        name:x.name,raw_name:x.raw_name||x.name,item_code:x.item_code||'',product_id:x.product_id||'',match_confidence:x.match_confidence||'unmatched',
        qty:Math.max(1,Number(x.qty)||1),unit_price:Number(x.unit_price??x.price),price:Number(x.unit_price??x.price),line_total:Number(x.line_total ?? ((x.unit_price??x.price)*(x.qty||1)))
      }))
    };
    receipt.fingerprint=fingerprint12(receipt);
    const existing=state.importedReceipts;
    const duplicate=existing.find(r=>r.fingerprint===receipt.fingerprint || fingerprint12(r)===receipt.fingerprint);
    if(duplicate){
      $('#ocrStatus').textContent=`Duplicate blocked: this ${store} receipt is already saved (${duplicate.date||'date unknown'}).`;
      return;
    }
    existing.unshift(receipt); state.importedReceipts=existing;
    const obs=state.priceObservations;
    receipt.lines.forEach(x=>obs.unshift({name:x.name,item_code:x.item_code,price:x.unit_price,qty:x.qty,store,date,source:'confirmed receipt v1.2'}));
    state.priceObservations=obs.slice(0,750);
    const strong=receipt.lines.filter(x=>x.match_confidence==='item-code-exact').length;
    $('#ocrStatus').textContent=`Saved ${receipt.items} purchased unit${receipt.items===1?'':'s'} across ${receipt.lines.length} lines for ${store} · ${date}.${strong?` ${strong} exact item-code match${strong===1?'':'es'}.`:''}`;
    renderHistory();
    window.dispatchEvent(new CustomEvent('ec:receipt-saved',{detail:{receipt}}));
  }

  parseReceiptText=enhancedParse12;
  renderCandidates=enhancedRender12;
  saveReceipt=enhancedSave12;
  if($('#parseBtn')) $('#parseBtn').onclick=()=>parseReceiptText($('#receiptText').value);
  if($('#saveReceiptBtn')) $('#saveReceiptBtn').onclick=saveReceipt;
  const sub=document.querySelector('.head .sub');
  if(sub) sub.textContent='Household optimizer v1.2';
})();