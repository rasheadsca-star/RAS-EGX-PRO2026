#!/usr/bin/env node
const fs=require('fs');
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function num(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0}
const board=read('data/unified-decision-board.json',{rows:[],summary:{}});
const rows=board.rows||[];
const tests=[
  ['no_buy_on_price_conflict', rows.every(r=>!(r.priceConflict && ['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision)))],
  ['no_buy_today_under_20_history', rows.every(r=>!(r.finalDecision==='BUY_TODAY_INTRADAY' && num(r.historySessions)<20))],
  ['no_confidence_100_under_50_history', rows.every(r=>!(num(r.finalConfidence)>=100 && num(r.historySessions)<50))],
  ['no_stop_above_entry_for_valid_plans', rows.every(r=>!r.planValidation?.planValid || num(r.stopLoss)<num(r.entryMid))],
  ['no_target_below_entry_for_valid_plans', rows.every(r=>!r.planValidation?.planValid || num(r.target1)>num(r.entryMid))],
  ['no_executable_invalid_entry_ranges', rows.every(r=>!['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision) || r.planValidation?.planValid)],
  ['unified_board_only_declared', board.singleSourceOfTruth==='data/unified-decision-board.json'],
  ['fallback_prevents_direct_execution', board.gateway?.fallbackUsed||board.gateway?.lastGoodSnapshotUsed ? rows.every(r=>!['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision)) : true]
];
const failed=tests.filter(x=>!x[1]);
const report={ok:failed.length===0,generatedAt:new Date().toISOString(),tests:Object.fromEntries(tests),summary:board.summary||{}};
fs.writeFileSync('data/v11-acceptance-report.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
if(failed.length){process.exit(1)}
