#!/usr/bin/env node
/* EGX Pro Hub V11.1 — Practical Readiness Report */
const fs=require('fs'); const path=require('path');
function read(f,fb){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fb}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')}
function round(v,dp=2){const n=Number(v||0);const m=10**dp;return Math.round(n*m)/m}
function main(){
 const now=new Date().toISOString(); const price=read('data/price-truth-layer.json',{summary:{}}); const hist=read('data/history-trust-recovery.json',{summary:{}}); const liq=read('data/liquidity-gate-report.json',{summary:{}}); const plan=read('data/trade-plan-validation-report.json',{summary:{}}); const board=read('data/unified-decision-board.json',{summary:{},topThree:[]}); const paper=read('data/paper-trading-dashboard.json',{summary:{},readinessChecks:[]}); const sector=read('data/sector-completion-report.json',{});
 const metrics={
  priceReliableCoveragePct: price.summary?.reliableCoveragePct || 0,
  priceConflictPct: price.summary?.total?round((price.summary.conflict||0)/price.summary.total*100,1):100,
  history50CoveragePct: hist.summary?.total?round((hist.summary.ready50||0)/hist.summary.total*100,1):0,
  history20CoveragePct: hist.summary?.total?round((hist.summary.ready20||0)/hist.summary.total*100,1):0,
  executionLiquidityNames: liq.summary?.executionOk || 0,
  conditionalLiquidityNames: liq.summary?.conditionalOk || 0,
  validTradePlans: plan.summary?.valid || 0,
  invalidTradePlans: plan.summary?.invalid || 0,
  boardExecutionAllowed: board.summary?.executionAllowed || 0,
  boardWatch: board.summary?.watch || 0,
  boardBlocked: board.summary?.blocked || 0,
  v11ClosedSignals: paper.summary?.v11Closed || 0,
  v11ClosedWinRatePct: paper.summary?.v11ClosedWinRatePct,
  sectorClassifiedPct: sector.classifiedPct || sector.summary?.classifiedPct || null
 };
 const phase = paper.summary?.practicalMode==='LIVE_EXECUTION_ADVISORY' ? 'PHASE_4_LIVE_EXECUTION_ADVISORY' : metrics.priceReliableCoveragePct>=80 && metrics.history20CoveragePct>=50 ? 'PHASE_2_PAPER_TRADING' : 'PHASE_1_MONITORING';
 const blockers=[];
 if(metrics.priceReliableCoveragePct<80) blockers.push('تغطية السعر الموثوق أقل من 80%');
 if(metrics.priceConflictPct>=5) blockers.push('تعارضات السعر أعلى من 5%');
 if(metrics.history50CoveragePct<80) blockers.push('تاريخ 50 جلسة غير مكتمل لـ 80% من السوق');
 if(metrics.v11ClosedSignals<30) blockers.push('لا يوجد 30 توصية V11 مغلقة لقياس الدقة');
 if(metrics.validTradePlans===0) blockers.push('لا توجد خطط تداول صالحة كافية');
 const recommendedNextRunOrder=['fetch market data','price truth layer','history trust recovery','liquidity gate','trade plan validator','unified decision board','paper trading ledger','readiness report'];
 write('data/v11-1-readiness-report.json',{ok:true,engine:'v11_1_practical_readiness_report',generatedAt:now,phase,readyForLiveExecution:phase==='PHASE_4_LIVE_EXECUTION_ADVISORY',metrics,readinessChecks:paper.readinessChecks||[],topThree:board.topThree||[],blockers,recommendedNextRunOrder,manualInput:false,conclusion:blockers.length?'لم يصل التطبيق بعد للتشغيل العملي الكامل؛ تم رفع جودة الحكم ومنع التوصيات غير المؤكدة، ويجب استمرار تراكم التاريخ وقياس Paper Trading.':'التطبيق اجتاز شروط التشغيل العملي وفق مؤشرات V11.1.',note:'V11.1 lifts trust through public data recovery, price truth, liquidity, validated plans, and measured closed outcomes only.'});
 console.log('V11.1 Readiness', {phase, blockers:blockers.length, metrics});
}
main();
