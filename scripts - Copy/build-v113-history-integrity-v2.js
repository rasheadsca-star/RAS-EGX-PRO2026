#!/usr/bin/env node
// V11.3 History Integrity V2: validates OHLCV consistency and readiness thresholds.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function n(v){ const x=Number(String(v??'').replace(/[,،%\s]/g,'')); return Number.isFinite(x)?x:null; }
function validDate(s){ return /^20\d{2}-\d{2}-\d{2}$/.test(String(s||'')); }
function rowErrors(r){
  const e=[]; const o=n(r.open), h=n(r.high), l=n(r.low), c=n(r.close), v=n(r.volume)||0;
  if(!validDate(r.date)) e.push('invalid_date');
  if([o,h,l,c].some(x=>x==null || x<=0)) e.push('missing_or_nonpositive_ohlc');
  if(h!=null && l!=null && h<l) e.push('high_below_low');
  if(h!=null && l!=null && c!=null && (c>h*1.02 || c<l*0.98)) e.push('close_outside_high_low');
  if(h!=null && l!=null && o!=null && (o>h*1.02 || o<l*0.98)) e.push('open_outside_high_low');
  if(v<0) e.push('negative_volume');
  return e;
}
const generatedAt=new Date().toISOString();
const histRaw=readJson(path.join(DATA,'history.json'),{}).sessionsBySymbol||{};
function normSym(s){ return String(s||'').trim().toUpperCase().replace(/\.CA$/,''); }
const hist={}; for(const [k,v] of Object.entries(histRaw)) hist[normSym(k)] = [...(hist[normSym(k)]||[]), ...(Array.isArray(v)?v:[])];
const resolver=readJson(path.join(DATA,'symbol-alias-map.json'),{symbols:[]}).symbols||[];
const symSet=[...new Set([...Object.keys(hist), ...resolver.map(r=>normSym(r.symbol))].filter(Boolean))];
const rows=[]; const errorCounts={};
for(const sym of symSet){
  const raw=hist[sym]||[]; const dates=new Set(); let duplicateDates=0, invalidRows=0, validRows=0, latestDate=null, earliestDate=null;
  for(const r of raw){
    const errs=rowErrors(r); if(dates.has(r.date)) duplicateDates++; dates.add(r.date);
    if(errs.length){ invalidRows++; errs.forEach(x=>errorCounts[x]=(errorCounts[x]||0)+1); }
    else { validRows++; latestDate = !latestDate || String(r.date)>latestDate ? String(r.date) : latestDate; earliestDate = !earliestDate || String(r.date)<earliestDate ? String(r.date) : earliestDate; }
  }
  const integrityScore = Math.max(0, Math.min(100, Math.round((validRows/Math.max(1,raw.length))*100 - duplicateDates*2)));
  let state='MISSING'; if(validRows>=120) state='READY_120'; else if(validRows>=50) state='READY_50'; else if(validRows>=20) state='READY_20'; else if(validRows>=10) state='WARMUP_10'; else if(validRows>0) state='INSUFFICIENT';
  rows.push({symbol:sym, sessions:validRows, rawRows:raw.length, invalidRows, duplicateDates, integrityScore, state, earliestDate, latestDate, executionHistoryOk:validRows>=20, fullHistory50:validRows>=50, fullHistory120:validRows>=120});
}
rows.sort((a,b)=>b.sessions-a.sessions || a.symbol.localeCompare(b.symbol));
const summary={total:rows.length, ready20:rows.filter(r=>r.sessions>=20).length, ready50:rows.filter(r=>r.sessions>=50).length, ready120:rows.filter(r=>r.sessions>=120).length, anyHistory:rows.filter(r=>r.sessions>0).length, missing:rows.filter(r=>r.sessions===0).length, avgSessions:Number((rows.reduce((a,r)=>a+r.sessions,0)/Math.max(1,rows.length)).toFixed(2)), invalidRows:rows.reduce((a,r)=>a+r.invalidRows,0), duplicateDates:rows.reduce((a,r)=>a+r.duplicateDates,0), errorCounts};
writeJson(path.join(DATA,'history-integrity-v2.json'), {ok:true, engine:'v11_3_history_integrity_v2', generatedAt, summary, rows, note:'Execution requires at least 20 valid sessions; full technical confidence requires at least 50 valid sessions.'});
// Keep legacy report aligned for existing UI if it reads these fields.
const legacy=readJson(path.join(DATA,'history-integrity-report.json'),{});
writeJson(path.join(DATA,'history-integrity-report.json'), {...legacy, generatedAt, engine:'v11_3_history_integrity_v2_compat', symbolsWithComplete50:summary.ready50, symbolsWithAnyHistory:summary.anyHistory, averageSessionsPerSymbol:summary.avgSessions, summary:{...(legacy.summary||{}), ...summary}, rows});
console.log('V11.3 history integrity v2:', summary);
