#!/usr/bin/env node
/*
EGX Pro Hub V11.1 — Price Truth Layer
Purpose: reduce false execution blocks caused by comparing fresh market prices with stale cached snapshots.
Rules:
- No non-public/manual trading input is used.
- Only public/delayed repository data and collected public market snapshots are reconciled.
- True conflict is measured among fresh/current-session sources only.
- Stale cache/history can be reference evidence, but cannot create a hard execution conflict against a newer public source.
*/
const fs = require('fs');
const path = require('path');
function read(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function write(file, obj){ fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(obj,null,2)+'\n','utf8'); }
function arr(x){ return Array.isArray(x) ? x : []; }
function key(s){ return String(s||'').trim().toUpperCase(); }
function num(v, d=null){ if(v===null||v===undefined||v==='') return d; const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,'')); return Number.isFinite(n) ? n : d; }
function round(v, dp=2){ const n=num(v,0); const m=10**dp; return Math.round(n*m)/m; }
function pct(v){ return round(v,2); }
function parseDate(v){ if(!v) return null; const d=new Date(v); return Number.isFinite(d.getTime()) ? d : null; }
function latestDate(dates){ return dates.filter(Boolean).sort((a,b)=>b-a)[0] || null; }
function minutesBetween(a,b){ if(!a||!b) return null; return Math.abs(a.getTime()-b.getTime())/60000; }
function decimalsFromDisplay(v, display){
  const s = String(display ?? v ?? '').trim();
  const m = s.match(/\.(\d+)/);
  return m ? m[1].length : 0;
}
function pushCandidate(candidates, row, source, priority, priceFields, tsFields, extra={}){
  if(!row) return;
  let price=null, display=null;
  for(const f of priceFields){
    const p = num(row[f], null);
    if(p !== null && p > 0){ price=p; display=row[`${f}Display`] ?? row.priceDisplay ?? row.finalPriceDisplay ?? row.lastDisplay ?? row[f]; break; }
  }
  if(!(price>0)) return;
  let ts=null;
  for(const f of tsFields){ ts=parseDate(row[f]); if(ts) break; }
  candidates.push({
    source,
    price,
    priceDisplay: String(display ?? price),
    ts: ts ? ts.toISOString() : null,
    priority,
    decimals: decimalsFromDisplay(price, display),
    sourceUrl: row.sourceUrl || row.url || '',
    sourceMode: row.dataMode || row.source || '',
    ...extra
  });
}
function mapRows(rows){ const m={}; arr(rows).forEach(r=>{ const k=key(r.symbol||r.ticker||r.code); if(k) m[k]=r; }); return m; }
function unionSymbols(...maps){ const set=new Set(); maps.forEach(m=>Object.keys(m||{}).forEach(k=>set.add(k))); return [...set].sort(); }
function latestHistorySession(history, history50, sym){
  const list = [];
  arr(history?.sessionsBySymbol?.[sym]).forEach(x=>list.push({...x, _source:'history'}));
  arr(history50?.symbols?.[sym]).forEach(x=>list.push({...x, _source:'history50'}));
  list.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  return list[0] || null;
}
function liquidityThreshold(row){
  const turnover = num(row?.valueTraded ?? row?.turnover, 0) || 0;
  // More liquid names require tighter price agreement. Less liquid names get a slightly wider tolerance.
  if(turnover >= 50_000_000) return 0.5;
  if(turnover >= 10_000_000) return 0.75;
  return 1.0;
}
function precisionRisk(price, candidates){
  if(!(price>0)) return true;
  if(price >= 1) return false;
  // Sub-pound EGX prices need mill precision. A 3-decimal display from a fresh market/reconciliation source is accepted.
  return !candidates.some(c => c.price === price && c.decimals >= 3 && /market|recon|mubasher/i.test(`${c.source} ${c.sourceMode}`));
}
function main(){
  const now = new Date().toISOString();
  const market = read('data/market.json',{rows:[]});
  const cache = read('data/full-market-cache.json',{rows:[]});
  const rec = read('data/recommendations.json',{all:[]});
  const recon = read('data/price-reconciliation-report.json',{rows:[]});
  const audit = read('data/price-source-audit.json',{rows:[]});
  const history = read('data/history.json',{sessionsBySymbol:{}});
  const history50 = read('data/history-50.json',{symbols:{}});
  const sourceHealth = read('data/source-health.json',{});
  const gateway = read('data/source-gateway-report.json',{});
  const marketMap = mapRows(market.rows);
  const cacheMap = mapRows(cache.rows);
  const recMap = mapRows(rec.all);
  const reconMap = mapRows(recon.rows);
  const auditMap = mapRows(audit.rows);
  const symbols = unionSymbols(marketMap, cacheMap, recMap, reconMap, auditMap, history.sessionsBySymbol || {}, history50.symbols || {});
  const rows = symbols.map(sym=>{
    const candidates=[];
    pushCandidate(candidates, marketMap[sym], 'market_current_public', 100, ['price','last','close'], ['updatedAt','fetchedAt','generatedAt']);
    pushCandidate(candidates, reconMap[sym], 'price_reconciliation_final', 90, ['finalPrice','marketPrice'], ['sourceTimestamp','generatedAt']);
    pushCandidate(candidates, auditMap[sym], 'price_source_audit', 85, ['price'], ['updatedAt','generatedAt']);
    pushCandidate(candidates, recMap[sym], 'recommendations_snapshot', 35, ['price','last','close'], ['fetchedAt','updatedAt','generatedAt'], {conflictEligible:false});
    pushCandidate(candidates, cacheMap[sym], 'full_market_cache_snapshot', 30, ['price','last','close'], ['fetchedAt','updatedAt','generatedAt'], {conflictEligible:false});
    const hs = latestHistorySession(history, history50, sym);
    if(hs) candidates.push({source:`${hs._source}_latest_close`, price:num(hs.close,0), priceDisplay:String(hs.close ?? ''), ts:hs.date ? `${hs.date}T12:00:00.000Z` : null, priority:55, decimals:decimalsFromDisplay(hs.close, hs.close), sourceMode:'public_accumulated_history', conflictEligible:false});
    const dates = candidates.map(c=>parseDate(c.ts));
    const latest = latestDate(dates);
    candidates.forEach(c=>{ c.ageFromLatestMinutes = latest ? minutesBetween(parseDate(c.ts), latest) : null; c.freshAgainstLatest = c.ageFromLatestMinutes === null ? false : c.ageFromLatestMinutes <= 36*60; });
    const fresh = candidates.filter(c=>c.freshAgainstLatest).sort((a,b)=>b.priority-a.priority);
    const usable = fresh.length ? fresh : candidates.slice().sort((a,b)=>b.priority-a.priority);
    const selected = usable[0] || null;
    const refPrice = selected?.price || 0;
    const threshold = liquidityThreshold(marketMap[sym] || cacheMap[sym] || recMap[sym]);
    let spreadPct = 0;
    const conflictFresh = fresh.filter(c => c.conflictEligible !== false && c.priority >= 80);
    if(conflictFresh.length >= 2){
      const ps = conflictFresh.map(c=>c.price).filter(p=>p>0);
      const mn = Math.min(...ps), mx = Math.max(...ps);
      if(mn > 0) spreadPct = (mx-mn)/mn*100;
    }
    const realConflict = conflictFresh.length >= 2 && spreadPct > threshold;
    const staleOnly = !fresh.length && candidates.length > 0;
    const pRisk = precisionRisk(refPrice, usable);
    let priceTruthState = 'OK';
    let executionPriceOk = true;
    const reasons=[];
    if(!refPrice){ priceTruthState='NO_PRICE'; executionPriceOk=false; reasons.push('لا يوجد سعر عام صالح'); }
    else if(realConflict){ priceTruthState='CONFLICT'; executionPriceOk=false; reasons.push(`تعارض حقيقي بين مصادر حديثة بفارق ${pct(spreadPct)}%`); }
    else if(pRisk){ priceTruthState='PRECISION_RISK'; executionPriceOk=false; reasons.push('دقة السعر غير كافية خاصة للأسهم دون 1 جنيه'); }
    else if(staleOnly){ priceTruthState='STALE'; executionPriceOk=false; reasons.push('المتاح فقط سعر قديم ولا يصلح للتنفيذ'); }
    const staleComparisonsIgnored = candidates.filter(c=>!c.freshAgainstLatest && c.ageFromLatestMinutes !== null).length;
    return {
      symbol: sym,
      name: marketMap[sym]?.name_ar || recMap[sym]?.name_ar || cacheMap[sym]?.name_ar || cacheMap[sym]?.name || reconMap[sym]?.name || '',
      price: refPrice || null,
      priceDisplay: refPrice ? (refPrice < 1 ? Number(refPrice).toFixed(3) : Number(refPrice).toFixed(2)) : null,
      priceTruthState,
      executionPriceOk,
      reasons,
      conflictAmongFreshSources: realConflict,
      conflictFreshSourceCount: conflictFresh.length,
      freshSourceCount: fresh.length,
      totalCandidateSources: candidates.length,
      staleComparisonsIgnored,
      maxFreshSpreadPct: pct(spreadPct),
      allowedSpreadPct: threshold,
      selectedSource: selected?.source || '',
      selectedTimestamp: selected?.ts || null,
      latestTimestamp: latest ? latest.toISOString() : null,
      precisionRisk: pRisk,
      staleOnly,
      candidates: candidates.sort((a,b)=>(b.freshAgainstLatest-a.freshAgainstLatest)||b.priority-a.priority)
    };
  }).sort((a,b)=>{
    const order={OK:5,STALE:4,PRECISION_RISK:3,CONFLICT:2,NO_PRICE:1};
    return (order[b.priceTruthState]-order[a.priceTruthState]) || String(a.symbol).localeCompare(String(b.symbol));
  });
  const summary = {
    total: rows.length,
    ok: rows.filter(r=>r.priceTruthState==='OK').length,
    conflict: rows.filter(r=>r.priceTruthState==='CONFLICT').length,
    precisionRisk: rows.filter(r=>r.priceTruthState==='PRECISION_RISK').length,
    stale: rows.filter(r=>r.priceTruthState==='STALE').length,
    noPrice: rows.filter(r=>r.priceTruthState==='NO_PRICE').length,
    executionPriceOk: rows.filter(r=>r.executionPriceOk).length,
    reliableCoveragePct: rows.length ? pct(rows.filter(r=>r.executionPriceOk).length / rows.length * 100) : 0,
    staleComparisonsIgnored: rows.reduce((a,r)=>a+(r.staleComparisonsIgnored||0),0),
    method: 'freshness-weighted public price reconciliation; stale cache cannot create conflict against fresh source',
    manualInput: false
  };
  write('data/price-truth-layer.json', {
    ok:true,
    engine:'v11_1_price_truth_layer',
    generatedAt:now,
    dataMode:'public_delayed_only',
    sourceHealth:{coveragePct:sourceHealth.coveragePct || sourceHealth.universeCoveragePct || gateway.coveragePct || null, fallbackUsed:Boolean(sourceHealth.fallbackUsed || gateway.fallbackUsed), lastGoodSnapshotUsed:Boolean(sourceHealth.lastGoodSnapshotUsed || gateway.lastGoodSnapshotUsed)},
    summary,
    rows,
    note:'Only public/delayed data sources are used. This layer reduces false conflicts by comparing only fresh/current-session public sources for execution.'
  });
  console.log('V11.1 Price Truth Layer', summary);
}
main();
