#!/usr/bin/env node
/* EGX Pro Hub V11.1 — Historical Trust Recovery
   Builds a real-data history recovery status/work queue. It may upsert the latest public market snapshot into history.json only when the session date is not already present. It never fabricates backfilled sessions. */
const fs=require('fs'); const path=require('path');
function read(f,fb){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fb}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')}
function arr(x){return Array.isArray(x)?x:[]}
function key(s){return String(s||'').trim().toUpperCase()}
function num(v,d=0){const n=Number(String(v??'').replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:d}
function mapRows(rows){const m={};arr(rows).forEach(r=>{const k=key(r.symbol||r.ticker||r.code);if(k)m[k]=r});return m}
function dateOnly(x){if(!x)return null;const d=new Date(x);if(!Number.isFinite(d.getTime()))return String(x).slice(0,10);return d.toISOString().slice(0,10)}
function uniqSessions(list){const m={};arr(list).forEach(s=>{const d=String(s.date||'').slice(0,10); if(d) m[d]={...m[d],...s,date:d}}); return Object.values(m).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-120)}
function latestMarketSession(market){const d=dateOnly(market.updatedAt||market.generatedAt||new Date());return d}
function main(){
 const now=new Date().toISOString();
 const market=read('data/market.json',{rows:[]});
 const cache=read('data/full-market-cache.json',{rows:[]});
 const h=read('data/history.json',{version:'v11_1_auto_recovered_history',sessionsBySymbol:{}});
 const h50=read('data/history-50.json',{symbols:{}});
 const integrity=read('data/history-integrity-report.json',{symbols:[]});
 const marketMap=mapRows(market.rows), cacheMap=mapRows(cache.rows), integrityMap=mapRows(integrity.symbols);
 const symbols=[...new Set([...Object.keys(marketMap),...Object.keys(cacheMap),...Object.keys(h.sessionsBySymbol||{}),...Object.keys(h50.symbols||{})])].sort();
 if(!h.sessionsBySymbol) h.sessionsBySymbol={};
 const sessionDate=latestMarketSession(market);
 let upserted=0;
 symbols.forEach(sym=>{
   let sessions=arr(h.sessionsBySymbol[sym]).concat(arr(h50.symbols?.[sym]));
   const mr=marketMap[sym];
   if(mr && sessionDate){
     const exists=sessions.some(s=>String(s.date||'').slice(0,10)===sessionDate);
     if(!exists){
       sessions.push({date:sessionDate,open:num(mr.open,mr.price),high:num(mr.high,mr.price),low:num(mr.low,mr.price),close:num(mr.price||mr.last||mr.close,0),volume:num(mr.volume,0),valueTraded:num(mr.valueTraded||mr.turnover,0),sourceQuality:'public_market_snapshot_v11_1'});
       upserted++;
     }
   }
   h.sessionsBySymbol[sym]=uniqSessions(sessions);
 });
 h.version='v11_1_auto_rolling_public_history_recovery';
 h.generatedAt=now; h.sessionDate=sessionDate; h.requiredSessions=50; h.targetSessions=120; h.maxStoredSessions=120;
 h.importantNote='Accumulated only from public/delayed market snapshots and repository history. No fabricated sessions and no non-public/manual input.';
 // Upsert is safe and real; if nothing new, file content stays almost unchanged except metadata.
 write('data/history.json',h);
 const rows=symbols.map(sym=>{
   const sessions=arr(h.sessionsBySymbol[sym]);
   const n=sessions.length;
   let state='MISSING'; if(n>=120)state='READY_120'; else if(n>=50)state='READY_50'; else if(n>=20)state='PARTIAL_20'; else if(n>=10)state='WARMUP_10'; else if(n>0)state='INSUFFICIENT';
   return {symbol:sym,name:marketMap[sym]?.name_ar||cacheMap[sym]?.name_ar||cacheMap[sym]?.name||integrityMap[sym]?.name||'',sessions:n,target50Remaining:Math.max(0,50-n),target120Remaining:Math.max(0,120-n),state,latestDate:sessions[n-1]?.date||null,executionHistoryOk:n>=20,fullHistory50:n>=50,fullHistory120:n>=120};
 }).sort((a,b)=>a.sessions-b.sessions||a.symbol.localeCompare(b.symbol));
 const summary={total:rows.length,ready120:rows.filter(r=>r.sessions>=120).length,ready50:rows.filter(r=>r.sessions>=50).length,ready20:rows.filter(r=>r.sessions>=20).length,warmup10:rows.filter(r=>r.sessions>=10&&r.sessions<20).length,insufficient:rows.filter(r=>r.sessions>0&&r.sessions<10).length,missing:rows.filter(r=>r.sessions===0).length,avgSessions:rows.length?Math.round(rows.reduce((a,r)=>a+r.sessions,0)/rows.length*10)/10:0,latestPublicSnapshotDate:sessionDate,upsertedLatestMarketSessions:upserted,manualInput:false,mode:'public_snapshot_accumulation'};
 const workQueue=rows.filter(r=>r.sessions<50).map(r=>({symbol:r.symbol,name:r.name,currentSessions:r.sessions,neededFor50:r.target50Remaining,priority:r.sessions===0?'P0_MISSING':r.sessions<10?'P1_INSUFFICIENT':r.sessions<20?'P2_WARMUP':'P3_PARTIAL',action:'continue_public_daily_snapshot_accumulation_and_source_history_recovery'}));
 write('data/history-trust-recovery.json',{ok:true,engine:'v11_1_history_trust_recovery',generatedAt:now,summary,rows,workQueue,note:'This engine raises trust only through real accumulated public snapshots/history. It does not fabricate missing historical sessions.'});
 console.log('V11.1 History Trust Recovery',summary);
}
main();
