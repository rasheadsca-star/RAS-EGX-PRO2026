#!/usr/bin/env node
/* EGX Pro Hub V11 — Entry Trigger mirror of Unified Decision Board */
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel,f){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;}catch{return f;}}
function writeJson(rel,d){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n','utf8');}
function num(v,d=0){const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,''));return Number.isFinite(n)?n:d;} function round(n,dp=2){const m=10**dp;return Math.round(num(n)*m)/m;}
function triggerFor(r){
  if(r.finalDecision==='BLOCKED') return {trigger:'blocked',label:'ممنوع التنفيذ',urgency:'urgent',distancePct:null};
  if(!r.executionAllowed && r.finalDecision==='WATCH') return {trigger:'watch_only',label:'مراقبة فقط',urgency:'watch',distancePct:r.entryDistancePct??null};
  if(r.finalDecision==='BUY_TODAY_INTRADAY') return {trigger:'inside_or_near_entry',label:'داخل/قريب من نطاق الدخول',urgency:'important',distancePct:r.entryDistancePct??0};
  if(r.finalDecision==='BUY_TOMORROW_CONDITIONAL') return {trigger:'tomorrow_confirmation',label:'انتظار تأكيد جلسة الغد',urgency:'watch',distancePct:r.entryDistancePct??null};
  return {trigger:'no_trade',label:'لا تدخل',urgency:'info',distancePct:null};
}
const board=readJson('data/unified-decision-board.json',{rows:[]});
const rows=(board.rows||[]).map(r=>({symbol:r.symbol,name:r.name,tier:r.finalDecision,recommendation:r.userMessage,price:r.price,priceDisplay:r.priceDisplay,entryLow:r.entryFrom,entryHigh:r.entryTo,target1:r.target1,target2:r.target2,stopLoss:r.stopLoss,riskReward:r.riskReward,confidence:r.finalConfidence,compositeScore:r.finalScore,precisionRisk:r.precisionRisk,executionAllowed:r.executionAllowed,...triggerFor(r),reason:r.why,executionBlockReason:r.executionBlockReason}));
const summary={total:rows.length,urgent:rows.filter(r=>r.urgency==='urgent').length,important:rows.filter(r=>r.urgency==='important').length,watch:rows.filter(r=>r.urgency==='watch').length,info:rows.filter(r=>r.urgency==='info').length,precisionHold:rows.filter(r=>r.precisionRisk).length,insideEntry:rows.filter(r=>r.trigger==='inside_or_near_entry').length,extended:0,stopBroken:0};
writeJson('data/entry-trigger-report.json',{ok:true,engine:'v11_entry_trigger_mirror_unified_board',generatedAt:new Date().toISOString(),sourceOfTruth:'data/unified-decision-board.json',summary,rows,disclaimer:'Triggers مشتقة من V11 Unified Decision Board فقط. لا توجد Trigger تنفيذية مستقلة.'});
console.log(`V11 Entry trigger mirror generated: ${rows.length}`);
