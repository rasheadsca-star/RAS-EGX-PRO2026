#!/usr/bin/env node
/* EGX Pro Hub V11 — Actionable Watchlist mirror of Unified Decision Board */
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel,f){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f}catch{return f}}
function writeJson(rel,d){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n','utf8')}
function num(v,d=0){const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,''));return Number.isFinite(n)?n:d}
function tier(decision){return decision==='BUY_TODAY_INTRADAY'?'A+':decision==='BUY_TOMORROW_CONDITIONAL'?'A':decision==='WATCH'?'B':decision==='NO_TRADE'?'C':'Risk'}
function label(decision){return ({BUY_TODAY_INTRADAY:'شراء اليوم للمضاربة داخل الجلسة',BUY_TOMORROW_CONDITIONAL:'شراء غدًا مشروط',WATCH:'مراقبة فقط',NO_TRADE:'لا تدخل',BLOCKED:'ممنوع التنفيذ'})[decision]||'مراقبة'}
const board=readJson('data/unified-decision-board.json',{rows:[],summary:{}});
let rows=(board.rows||[]).map((r,i)=>({
  rank:i+1,symbol:r.symbol,name:r.name,tier:tier(r.finalDecision),decision:label(r.finalDecision),finalDecision:r.finalDecision,
  recommendation:r.userMessage,compositeScore:r.finalScore,confidence:r.finalConfidence,dataQualityScore:r.dataQuality,
  technicalScore:r.technicalTrend,liquidityScore:r.liquidity,financialScore:null,newsScore:r.newsSector,
  historySessions:r.historySessions,price:r.price,priceDisplay:r.priceDisplay,changePct:r.changePct,turnover:r.turnover,volume:r.volume,
  support1:null,resistance1:null,entryLow:r.entryFrom,entryHigh:r.entryTo,entryRange:`${r.entryFrom??'-'} - ${r.entryTo??'-'}`,
  target1:r.target1,target2:r.target2,stopLoss:r.stopLoss,riskReward:r.riskReward,priceState:r.priceState,
  precisionRisk:r.precisionRisk===true,executionAllowed:r.executionAllowed===true,blocks:r.blockReasons||[],reason:r.why,
  decisionNote:r.userMessage,executionBlockReason:r.executionBlockReason,sourceUrl:null
}));
const buckets={strong:rows.filter(r=>r.finalDecision==='BUY_TODAY_INTRADAY'),watch:rows.filter(r=>r.finalDecision==='BUY_TOMORROW_CONDITIONAL'),follow:rows.filter(r=>r.finalDecision==='WATCH'),wait:rows.filter(r=>r.finalDecision==='NO_TRADE'),risk:rows.filter(r=>r.finalDecision==='BLOCKED')};
const output={ok:true,engine:'v11_actionable_watchlist_mirror_unified_board',generatedAt:new Date().toISOString(),sourceOfTruth:'data/unified-decision-board.json',summary:{total:rows.length,strong:buckets.strong.length,watch:buckets.watch.length,follow:buckets.follow.length,wait:buckets.wait.length,risk:buckets.risk.length,precisionRisk:rows.filter(r=>r.precisionRisk).length,actionable:rows.filter(r=>r.executionAllowed).length},topActionable:rows.filter(r=>r.executionAllowed).slice(0,25),buckets,rows,rules:['هذا الملف مرآة للوحة القرار الموحدة ولا يصدر قرارًا مستقلًا','أي شراء يجب أن يكون BUY_TODAY_INTRADAY أو BUY_TOMORROW_CONDITIONAL من unified-decision-board فقط','WATCH تعني مراقبة لا تنفيذ','BLOCKED يعني ممنوع التنفيذ'],disclaimer:'هذه قائمة مشتقة من V11 Trust Execution Governor وليست مصدر قرار مستقل.'};
writeJson('data/actionable-watchlist.json',output);
console.log(`V11 Actionable mirror: ${rows.length}, actionable=${output.summary.actionable}`);
