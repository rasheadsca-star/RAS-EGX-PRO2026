#!/usr/bin/env node
// V11.3 Readiness Accelerator: combines price, history, liquidity, plan, sectors, and paper trading into one operational roadmap.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function normSym(s){ return String(s||'').trim().toUpperCase().replace(/\.CA$/,''); }
const generatedAt=new Date().toISOString();
const pt=readJson(path.join(DATA,'price-truth-layer.json'),{});
const hi=readJson(path.join(DATA,'history-integrity-v2.json'),{});
const liq=readJson(path.join(DATA,'liquidity-gate-report.json'),{});
const plan=readJson(path.join(DATA,'trade-plan-validation-report.json'),{});
const resolver=readJson(path.join(DATA,'symbol-alias-map.json'),{symbols:[]});
const diag=readJson(path.join(DATA,'history-source-diagnostics.json'),{});
const udb=readJson(path.join(DATA,'unified-decision-board.json'),{});
const paper=readJson(path.join(DATA,'paper-trading-dashboard.json'),{});
const byHist=new Map((hi.rows||[]).map(r=>[normSym(r.symbol),r]));
const byPrice=new Map((pt.rows||[]).map(r=>[normSym(r.symbol),r]));
const byLiq=new Map((liq.rows||[]).map(r=>[normSym(r.symbol),r]));
const byPlan=new Map((plan.rows||[]).map(r=>[normSym(r.symbol),r]));
const symbols=[...new Set([...(resolver.symbols||[]).map(r=>normSym(r.symbol)), ...(udb.rows||[]).map(r=>normSym(r.symbol))])].filter(Boolean);
function score(sym){
  const h=byHist.get(sym)||{}; const p=byPrice.get(sym)||{}; const l=byLiq.get(sym)||{}; const tp=byPlan.get(sym)||{}; const meta=(resolver.symbols||[]).find(r=>normSym(r.symbol)===sym)||{};
  const priceOk=p.executionPriceOk===true || p.priceTruthState==='OK';
  const liquidityOk=['EXECUTION_OK','CONDITIONAL_OK'].includes(l.liquidityDecision);
  const planOk=tp.planValid===true || tp.executionPlanOk===true || (tp.planValidation&&tp.planValidation.planValid);
  const sectorOk=meta.sector && meta.sector!=='غير مصنف';
  const histSessions=h.sessions||0;
  let readiness=0;
  readiness += priceOk?25:0;
  readiness += histSessions>=50?25:(histSessions>=20?15:(histSessions>=10?7:0));
  readiness += liquidityOk?18:0;
  readiness += planOk?17:0;
  readiness += sectorOk?8:0;
  readiness += (paper.summary?.v11Closed||0)>=30?7:0;
  let phase='NOT_READY'; if(readiness>=85&&histSessions>=50) phase='EXECUTION_CANDIDATE'; else if(readiness>=70&&histSessions>=20) phase='CONDITIONAL_CANDIDATE'; else if(readiness>=55) phase='WATCH_READY'; else phase='DATA_RECOVERY';
  const blockers=[]; if(!priceOk) blockers.push('price_not_verified'); if(histSessions<20) blockers.push('history_less_than_20'); if(histSessions<50) blockers.push('history_less_than_50'); if(!liquidityOk) blockers.push('liquidity_not_ready'); if(!planOk) blockers.push('trade_plan_invalid'); if(!sectorOk) blockers.push('sector_unknown');
  return {symbol:sym, readinessScore:readiness, phase, priceOk, historySessions:histSessions, historyReady20:histSessions>=20, historyReady50:histSessions>=50, liquidityOk, planOk, sector:meta.sector||'غير مصنف', sectorOk, blockers};
}
const rows=symbols.map(score).sort((a,b)=>b.readinessScore-a.readinessScore || b.historySessions-a.historySessions);
const metrics={
  total:rows.length,
  priceReliableCoveragePct: pt.summary?.reliableCoveragePct || 0,
  priceConflicts: pt.summary?.conflict || 0,
  ready20: hi.summary?.ready20 || 0,
  ready50: hi.summary?.ready50 || 0,
  ready120: hi.summary?.ready120 || 0,
  avgSessions: hi.summary?.avgSessions || 0,
  liquidityExecutable: liq.summary?.executionOk || 0,
  liquidityConditional: liq.summary?.conditionalOk || 0,
  validPlans: plan.summary?.valid || 0,
  sectorKnown: (resolver.symbols||[]).filter(r=>r.sector&&r.sector!=='غير مصنف').length,
  sectorUnknown: (resolver.symbols||[]).filter(r=>!r.sector||r.sector==='غير مصنف').length,
  paperClosed: paper.summary?.v11Closed || 0
};
const checks=[
  {name:'السعر الموثوق', pass:(metrics.priceReliableCoveragePct>=80 && metrics.priceConflicts===0), value:`${metrics.priceReliableCoveragePct}% / conflicts ${metrics.priceConflicts}`},
  {name:'تاريخ 20 جلسة', pass:metrics.ready20>=Math.ceil(rows.length*0.50), value:`${metrics.ready20}/${rows.length}`},
  {name:'تاريخ 50 جلسة', pass:metrics.ready50>=Math.ceil(rows.length*0.50), value:`${metrics.ready50}/${rows.length}`},
  {name:'السيولة', pass:metrics.liquidityExecutable+metrics.liquidityConditional>=Math.ceil(rows.length*0.50), value:`${metrics.liquidityExecutable+metrics.liquidityConditional}/${rows.length}`},
  {name:'خطط التداول', pass:metrics.validPlans>=Math.ceil(rows.length*0.40), value:`${metrics.validPlans}/${rows.length}`},
  {name:'القطاعات', pass:metrics.sectorKnown>=Math.ceil(rows.length*0.80), value:`${metrics.sectorKnown}/${rows.length}`},
  {name:'Paper Trading مغلق', pass:metrics.paperClosed>=30, value:String(metrics.paperClosed)}
];
let phase='PHASE_1_MONITORING';
if(checks[0].pass && metrics.ready20>0) phase='PHASE_2_PAPER_TRADING';
if(checks[0].pass && metrics.ready20>=Math.ceil(rows.length*0.50) && metrics.paperClosed>=30) phase='PHASE_3_CONDITIONAL_EXECUTION';
if(checks.every(c=>c.pass) && metrics.ready50>=Math.ceil(rows.length*0.50)) phase='PHASE_4_LIVE_EXECUTION_ADVISORY';
const blockers=[];
if(metrics.ready20===0) blockers.push('محرك التاريخ لم يصل بعد إلى 20 جلسة لأي سهم؛ شغّل history_maintenance=true وراجع history-source-diagnostics.json.');
if(metrics.ready50===0) blockers.push('لا توجد 50 جلسة كاملة؛ الثقة الفنية ستظل مخفضة ولن تظهر توصيات تنفيذية كاملة.');
if(metrics.paperClosed<30) blockers.push('سجل Paper Trading لم يغلق 30 توصية بعد؛ لا يوجد إثبات أداء كافٍ.');
if(metrics.sectorUnknown>0) blockers.push(`يوجد ${metrics.sectorUnknown} رموز غير مصنفة قطاعيًا؛ استكمال خريطة القطاعات يرفع جودة الفلترة.`);
const report={ok:true, engine:'v11_3_readiness_accelerator', generatedAt, phase, readyForLiveExecution:phase==='PHASE_4_LIVE_EXECUTION_ADVISORY', metrics, checks, topNearReady:rows.slice(0,15), blockers, sourceDiagnosticsSummary:diag.summary||{}, conclusion: phase==='PHASE_1_MONITORING'?'التطبيق ما زال في وضع مراقبة/استرجاع بيانات؛ أقوى مانع هو التاريخ وسجل الأداء.':phase==='PHASE_2_PAPER_TRADING'?'يمكن تشغيل Paper Trading ومراقبة توصيات مشروطة تجريبية، لكن لا ينصح بالتنفيذ الحقيقي بعد.':phase==='PHASE_3_CONDITIONAL_EXECUTION'?'يمكن عرض توصيات مشروطة بحذر مع بقاء الحاكم الصارم.':'يمكن دراسة تفعيل توصيات تنفيذية مشروطة لأن بوابات الجاهزية الأساسية اكتملت.', rows};
writeJson(path.join(DATA,'readiness-accelerator-report.json'), report);
writeJson(path.join(DATA,'v11-3-readiness-report.json'), report);
console.log('V11.3 readiness accelerator:', phase, metrics);
