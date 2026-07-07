#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.8 — Price Source Audit
  Purpose: expose price source / precision / execution block reasons so the UI can explain
  why a symbol was accepted, blocked, or downgraded. No manual data, no cache reset.
*/
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
function readJson(rel, fallback){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;}catch{return fallback;}}
function writeJson(rel, data){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n','utf8');}
function arr(x, keys=[]){if(Array.isArray(x))return x;if(!x||typeof x!=='object')return [];for(const k of keys){if(Array.isArray(x[k]))return x[k];}return [];}
function num(v,d=0){if(v===null||v===undefined||v==='')return d;if(typeof v==='number')return Number.isFinite(v)?v:d;const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:d;}
function symOf(r){return String(r?.symbol||r?.code||r?.ticker||'').trim().toUpperCase();}
function priceOf(r){return num(r?.finalPrice ?? r?.price ?? r?.last ?? r?.close ?? r?.currentPrice ?? r?.marketPrice,0);}
function decimalsFromText(v){if(v===null||v===undefined)return null;const m=String(v).replace(',', '.').match(/-?\d+(?:\.(\d+))?/);return m ? (m[1] ? m[1].length : 0) : null;}
function inferredDecimals(price, row={}){
  const fields=[row.finalPriceDisplay,row.priceDisplay,row.priceText,row.rawPrice,row.lastText,row.closeText,row.finalPrice,row.price,row.last,row.close].filter(v=>v!==undefined&&v!==null);
  let best=null;
  for(const f of fields){const d=decimalsFromText(f); if(d!==null) best=best===null?d:Math.max(best,d);}
  if(best!==null)return best;
  const p=Number(price); if(!Number.isFinite(p))return 0;
  const s=String(p); return s.includes('.') ? s.split('.')[1].length : 0;
}
function subPoundPrecisionRisk(price, row={}){
  const p=Number(price);
  if(!Number.isFinite(p)||p<=0||p>=1)return false;
  const dec=inferredDecimals(p,row);
  const centGrid=Math.abs(p*100-Math.round(p*100))<1e-8;
  const textRounded=[row.finalPriceDisplay,row.priceDisplay,row.priceText,row.rawPrice,row.finalPrice,row.price,row.last,row.close].filter(v=>v!==undefined&&v!==null).some(v=>{
    const t=String(v).replace(',', '.').replace(/[^0-9.\-]/g,'');
    return /^0?\.\d{1,2}$/.test(t)||/^0?\.\d{2}0+$/.test(t);
  });
  return dec<3 || centGrid || textRounded;
}
function sourceLabel(r){
  const s=String(r?.sourceUsed||r?.sourceName||r?.source||r?.sourceTag||r?.sourceType||'').toLowerCase();
  if(/detail|symbol|page/.test(s))return 'detail';
  if(/market|summary|table/.test(s))return 'market';
  if(/cache|last/.test(s))return 'cache';
  if(r?.verified===true||r?.isExecutionSafe===true)return 'verified';
  return s || 'unknown';
}
function stateOf(price, row={}, finalRow={}, signalRow={}){
  const precisionRisk = Boolean(row.precisionRisk || finalRow.precisionRisk || signalRow.precisionRisk || subPoundPrecisionRisk(price,row));
  const conflict = Boolean(row.hasConflict || row.priceConflict || finalRow.priceState==='conflict' || signalRow.blocks?.includes?.('price_mismatch'));
  const stale = Boolean(row.isStale || row.stale || finalRow.priceState==='stale' || signalRow.blocks?.includes?.('stale_price'));
  const blockedByFinal = String(finalRow.grade||finalRow.classification||'').toLowerCase()==='blocked';
  const executionAllowed = !precisionRisk && !conflict && !stale && !blockedByFinal;
  const reasons=[];
  if(precisionRisk)reasons.push('دقة السعر غير كافية للتنفيذ');
  if(conflict)reasons.push('تعارض بين مصادر السعر');
  if(stale)reasons.push('السعر قديم أو يحتاج تحديث');
  if(blockedByFinal && !reasons.length)reasons.push(finalRow.executionBlockReason || 'محجوب من محرك الترتيب النهائي');
  return {precisionRisk,conflict,stale,executionAllowed,reasons};
}
const priceRec=readJson('data/price-reconciliation-report.json',{});
const market=readJson('data/market.json',{});
const cache=readJson('data/full-market-cache.json',{});
const recs=readJson('data/recommendations.json',{});
const finalRanking=readJson('data/final-opportunity-ranking.json',{});
const signalQuality=readJson('data/signal-quality-report.json',{});
const sourceHealth=readJson('data/source-health.json',{});
const map=new Map();
function add(rows,tag){for(const r of rows||[]){const s=symOf(r);if(!s)continue;if(!map.has(s))map.set(s,{symbol:s,seenIn:[]});Object.assign(map.get(s),r);map.get(s).seenIn.push(tag);}}
add(arr(cache,['rows']),'cache'); add(arr(market,['rows']),'market'); add(arr(recs,['all','rows']),'recommendations');
const priceMap=new Map(arr(priceRec,['rows','symbols']).map(r=>[symOf(r),r]));
const finalMap=new Map(arr(finalRanking,['rows']).map(r=>[symOf(r),r]));
const signalMap=new Map(arr(signalQuality,['rows']).map(r=>[symOf(r),r]));
const rows=[];
for(const [symbol,base] of map.entries()){
  const pr=priceMap.get(symbol)||{}; const fr=finalMap.get(symbol)||{}; const sq=signalMap.get(symbol)||{};
  const price=priceOf(pr)||priceOf(base)||priceOf(fr)||priceOf(sq); if(!price)continue;
  const dec=inferredDecimals(price, {...base,...pr});
  const state=stateOf(price, {...base,...pr}, fr, sq);
  const src=sourceLabel({...base,...pr});
  const pricePrecision = price>0 && price<1 ? `${dec}/3` : `${dec}/2`;
  const executionState = state.executionAllowed ? 'allowed' : 'blocked';
  rows.push({
    symbol,
    name: base.name_ar||base.name_en||base.name||base.companyName||fr.name||sq.name||'',
    price,
    priceDisplay: price>0&&price<1 ? Number(price).toFixed(3) : Number(price).toFixed(2),
    source: src,
    sourceUsed: pr.sourceUsed||pr.sourceName||base.sourceUsed||base.sourceName||src,
    pricePrecision,
    decimals: dec,
    precisionRisk: state.precisionRisk,
    conflict: state.conflict,
    stale: state.stale,
    executionAllowed: state.executionAllowed,
    executionState,
    blockReason: state.reasons.join('، '),
    finalGrade: fr.grade||fr.classification||sq.grade||'',
    finalScore: fr.finalScore??sq.compositeScore??null,
    sourceTags: Array.from(new Set(base.seenIn||[])),
    updatedAt: pr.generatedAt||pr.updatedAt||base.updatedAt||base.cacheUpdatedAt||null
  });
}
rows.sort((a,b)=> Number(a.executionAllowed)-Number(b.executionAllowed) || Number(b.precisionRisk)-Number(a.precisionRisk) || String(a.symbol).localeCompare(String(b.symbol)) );
const total=rows.length;
const summary={
  total,
  allowed: rows.filter(r=>r.executionAllowed).length,
  blocked: rows.filter(r=>!r.executionAllowed).length,
  precisionBlocked: rows.filter(r=>r.precisionRisk).length,
  conflicts: rows.filter(r=>r.conflict).length,
  stale: rows.filter(r=>r.stale).length,
  subPound: rows.filter(r=>r.price>0&&r.price<1).length,
  sourceCoveragePct: total ? Math.round((rows.filter(r=>r.source&&r.source!=='unknown').length/total)*1000)/10 : 0,
  marketCoveragePct: num(sourceHealth.universeCoveragePct ?? sourceHealth.coveragePct ?? sourceHealth.coverage, 0)
};
writeJson('data/price-source-audit.json',{ok:true,engine:'v8_9_8_price_source_audit',generatedAt:new Date().toISOString(),summary,rows,note:'Execution gate: any sub-1 EGP price without verified 0.001 precision is blocked from executable recommendations.'});
console.log('Price source audit generated', summary);
