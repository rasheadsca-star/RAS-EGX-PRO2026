#!/usr/bin/env node
/* EGX Pro Hub V11.1 — Liquidity Gate */
const fs=require('fs'); const path=require('path');
function read(f,fb){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fb}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')}
function arr(x){return Array.isArray(x)?x:[]}
function key(s){return String(s||'').trim().toUpperCase()}
function num(v,d=0){const n=Number(String(v??'').replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:d}
function round(v,dp=2){const m=10**dp;return Math.round(num(v,0)*m)/m}
function mapRows(rows){const m={};arr(rows).forEach(r=>{const k=key(r.symbol||r.ticker||r.code);if(k)m[k]=r});return m}
function avg(xs){xs=xs.filter(x=>x>0);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0}
function scoreFromTurnover(current,avg20,trades=0){let score=0; if(current>=5_000_000)score+=35; else score+=Math.min(35,current/5_000_000*35); if(avg20>=2_000_000)score+=35; else score+=Math.min(35,avg20/2_000_000*35); if(current>=10_000_000||avg20>=5_000_000)score+=15; if(trades>=100)score+=15; else score+=Math.min(15,trades/100*15); return Math.round(Math.max(0,Math.min(100,score)));}
function main(){
 const now=new Date().toISOString(); const market=read('data/market.json',{rows:[]}); const cache=read('data/full-market-cache.json',{rows:[]}); const history=read('data/history.json',{sessionsBySymbol:{}}); const truth=read('data/price-truth-layer.json',{rows:[]});
 const mm=mapRows(market.rows), cm=mapRows(cache.rows), tm=mapRows(truth.rows); const symbols=[...new Set([...Object.keys(mm),...Object.keys(cm),...Object.keys(history.sessionsBySymbol||{}),...Object.keys(tm)])].sort();
 const rows=symbols.map(sym=>{
   const m=mm[sym]||cm[sym]||{}; const sessions=arr(history.sessionsBySymbol?.[sym]).slice(-20);
   const currentTurnover=num(m.valueTraded||m.turnover,0); const currentVolume=num(m.volume,0); const avg20Turnover=avg(sessions.map(s=>num(s.valueTraded||s.turnover,0))); const avg20Volume=avg(sessions.map(s=>num(s.volume,0))); const trades=num(m.trades||m.numberOfTrades,0);
   const liquidityScore=scoreFromTurnover(currentTurnover,avg20Turnover,trades);
   const intradayEligible=currentTurnover>=5_000_000 && avg20Turnover>=2_000_000 && currentVolume>0 && liquidityScore>=65;
   const shortTermEligible=(currentTurnover>=1_000_000 || avg20Turnover>=1_000_000) && currentVolume>0 && liquidityScore>=45;
   let liquidityDecision='BLOCKED_ILLIQUID'; let reason='سيولة ضعيفة أو غير كافية للخروج الآمن';
   if(intradayEligible){liquidityDecision='EXECUTION_OK'; reason='السيولة الحالية ومتوسط 20 جلسة يسمحان بمراجعة تنفيذية';}
   else if(shortTermEligible){liquidityDecision='CONDITIONAL_OK'; reason='السيولة تسمح بمراقبة/تنفيذ مشروط وليس مضاربة فورية';}
   else if(currentTurnover>0||avg20Turnover>0){liquidityDecision='WATCH_ONLY'; reason='توجد سيولة لكن أقل من حد التنفيذ الآمن';}
   return {symbol:sym,name:m.name_ar||m.name_en||m.name||'',liquidityDecision,liquidityScore,currentTurnover:round(currentTurnover,0),avg20Turnover:round(avg20Turnover,0),currentVolume:round(currentVolume,0),avg20Volume:round(avg20Volume,0),trades,executionLiquidityOk:intradayEligible,conditionalLiquidityOk:shortTermEligible,reason,priceTruthState:tm[sym]?.priceTruthState||'UNKNOWN'};
 }).sort((a,b)=>b.liquidityScore-a.liquidityScore||a.symbol.localeCompare(b.symbol));
 const summary={total:rows.length,executionOk:rows.filter(r=>r.liquidityDecision==='EXECUTION_OK').length,conditionalOk:rows.filter(r=>r.liquidityDecision==='CONDITIONAL_OK').length,watchOnly:rows.filter(r=>r.liquidityDecision==='WATCH_ONLY').length,blockedIlliquid:rows.filter(r=>r.liquidityDecision==='BLOCKED_ILLIQUID').length,avgLiquidityScore:rows.length?round(rows.reduce((a,r)=>a+r.liquidityScore,0)/rows.length,1):0,intradayMinCurrentTurnover:5000000,intradayMinAvg20Turnover:2000000,shortTermMinTurnover:1000000};
 write('data/liquidity-gate-report.json',{ok:true,engine:'v11_1_liquidity_gate',generatedAt:now,summary,rows,note:'Liquidity gate prevents technically attractive but non-executable/low-liquidity names from becoming BUY recommendations.'}); console.log('V11.1 Liquidity Gate',summary);
}
main();
