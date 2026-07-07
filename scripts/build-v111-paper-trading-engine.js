#!/usr/bin/env node
/* EGX Pro Hub V11.1 — Paper Trading & Recommendation Ledger */
const fs=require('fs'); const path=require('path');
function read(f,fb){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fb}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')}
function arr(x){return Array.isArray(x)?x:[]}
function key(s){return String(s||'').trim().toUpperCase()}
function num(v,d=0){const n=Number(String(v??'').replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:d}
function round(v,dp=2){const m=10**dp;return Math.round(num(v,0)*m)/m}
function main(){
 const now=new Date().toISOString(); const board=read('data/unified-decision-board.json',{rows:[],summary:{}}); const oldLedger=read('data/recommendation-ledger.json',{signals:[]}); const outcome=read('data/recommendation-outcome-tracker.json',{signals:[],summary:{}}); const priceTruth=read('data/price-truth-layer.json',{summary:{}}); const hist=read('data/history-trust-recovery.json',{summary:{}}); const liq=read('data/liquidity-gate-report.json',{summary:{}});
 const byId=new Map(); arr(oldLedger.signals).forEach(s=>byId.set(s.id,s));
 // Import legacy signals as legacy paper observations only; never use them to claim V11 success.
 arr(outcome.signals).forEach(s=>{const id=`LEGACY|${s.id||`${s.symbol}|${s.openedAt}`}`; if(!byId.has(id)) byId.set(id,{id,engine:'legacy_import_from_outcome_tracker',symbol:key(s.symbol),name:s.name||'',openedAt:s.openedAt,decision:'LEGACY_OPEN_SIGNAL',entryFrom:s.entryLow,entryTo:s.entryHigh,target1:s.target1,target2:s.target2,stopLoss:s.stopLoss,riskReward:s.riskReward,status:s.status||'open',firstPrice:s.firstPrice,lastPrice:s.lastPrice,maxFavorablePct:s.maxFavorablePct,maxAdversePct:s.maxAdversePct,closedAt:s.closedAt||null,result:s.status==='target1Hit'||s.status==='target2Hit'?'target_hit':s.status==='stopHit'?'stop_hit':'open',v11Executable:false,legacyImport:true});});
 // Track actual V11 executable recommendations; current strict data may produce none, which is correct.
 arr(board.rows).filter(r=>['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision)).forEach(r=>{const id=`V11|${r.symbol}|${r.finalDecision}|${r.entryFrom}|${r.entryTo}|${r.target1}|${r.stopLoss}`; if(!byId.has(id)) byId.set(id,{id,engine:'v11_1_trust_execution_governor',symbol:r.symbol,name:r.name||'',openedAt:now,decision:r.finalDecision,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,target2:r.target2,stopLoss:r.stopLoss,riskReward:r.riskReward,status:'open',firstPrice:r.price,lastPrice:r.price,maxFavorablePct:0,maxAdversePct:0,result:'open',v11Executable:true,legacyImport:false,confidence:r.finalConfidence});});
 const signals=[...byId.values()].sort((a,b)=>String(b.openedAt||'').localeCompare(String(a.openedAt||'')));
 const closed=signals.filter(s=>!['open','OPEN','LEGACY_OPEN_SIGNAL'].includes(String(s.status)) || ['target_hit','stop_hit','expired'].includes(String(s.result)));
 const targetHits=signals.filter(s=>String(s.result).includes('target')||/target/i.test(String(s.status))).length; const stopHits=signals.filter(s=>String(s.result).includes('stop')||/stop/i.test(String(s.status))).length;
 const v11Closed=closed.filter(s=>s.v11Executable); const v11Target=v11Closed.filter(s=>String(s.result).includes('target')).length;
 const closedWinRatePct=v11Closed.length?round(v11Target/v11Closed.length*100,1):null;
 const watchCandidates=arr(board.rows).filter(r=>r.finalDecision==='WATCH' && r.planValidation?.planValid && r.priceState==='ok').slice(0,20).map(r=>({symbol:r.symbol,name:r.name,price:r.price,entryFrom:r.entryFrom,entryTo:r.entryTo,target1:r.target1,stopLoss:r.stopLoss,riskReward:r.riskReward,why:r.why,shadowReason:'Paper trading فقط: لا تظهر كتوصية شراء حتى يكتمل التاريخ/الثقة/الأداء'}));
 const readinessChecks=[
   {id:'price_reliable_coverage',name:'تغطية سعر موثوقة ≥80%',value:priceTruth.summary?.reliableCoveragePct||0,pass:(priceTruth.summary?.reliableCoveragePct||0)>=80},
   {id:'price_conflicts',name:'تعارضات أسعار أقل من 5%',value:priceTruth.summary?.total?round((priceTruth.summary.conflict||0)/priceTruth.summary.total*100,1):100,pass:priceTruth.summary?.total?((priceTruth.summary.conflict||0)/priceTruth.summary.total)<0.05:false},
   {id:'history_50',name:'80% من السوق لديه 50 جلسة',value:hist.summary?.total?round((hist.summary.ready50||0)/hist.summary.total*100,1):0,pass:hist.summary?.total?((hist.summary.ready50||0)/hist.summary.total)>=0.8:false},
   {id:'closed_v11_signals',name:'30 توصية V11 مغلقة على الأقل',value:v11Closed.length,pass:v11Closed.length>=30},
   {id:'liquidity',name:'سيولة تنفيذية/مشروطة كافية',value:(liq.summary?.executionOk||0)+(liq.summary?.conditionalOk||0),pass:((liq.summary?.executionOk||0)+(liq.summary?.conditionalOk||0))>=20},
   {id:'win_rate',name:'نسبة نجاح V11 المغلقة ≥55%',value:closedWinRatePct,pass:closedWinRatePct!==null&&closedWinRatePct>=55}
 ];
 const practicalMode=readinessChecks.every(x=>x.pass)?'LIVE_EXECUTION_ADVISORY':'PAPER_TRADING_OR_WATCH_ONLY';
 const summary={totalSignals:signals.length,legacySignals:signals.filter(s=>s.legacyImport).length,v11ExecutableSignals:signals.filter(s=>s.v11Executable).length,open:signals.filter(s=>String(s.status).toLowerCase()==='open').length,closed:closed.length,targetHits,stopHits,v11Closed:v11Closed.length,v11ClosedWinRatePct:closedWinRatePct,shadowPaperCandidates:watchCandidates.length,practicalMode};
 write('data/recommendation-ledger.json',{ok:true,engine:'v11_1_recommendation_ledger',generatedAt:now,summary,signals,note:'Open signals are not counted as success or failure. Legacy imports are separated from V11 executable recommendations.'});
 write('data/paper-trading-dashboard.json',{ok:true,engine:'v11_1_paper_trading_dashboard',generatedAt:now,summary,readinessChecks,watchCandidates,conclusion:practicalMode==='LIVE_EXECUTION_ADVISORY'?'النظام اجتاز شروط التشغيل العملي.':'النظام لم يجتز شروط التشغيل العملي بعد؛ يستمر في Paper Trading / Watch Only.',note:'Paper trading raises trust through measured closed outcomes, not by weakening gates.'});
 console.log('V11.1 Paper Trading',summary);
}
main();
