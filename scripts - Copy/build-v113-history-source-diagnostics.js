#!/usr/bin/env node
// V11.3 History Source Diagnostics: explains why each symbol is not ready yet.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function normSym(s){ return String(s||'').trim().toUpperCase().replace(/\.CA$/,''); }
const generatedAt = new Date().toISOString();
const alias = readJson(path.join(DATA,'symbol-alias-map.json'),{symbols:[]}).symbols||[];
const historyRaw = readJson(path.join(DATA,'history.json'),{}).sessionsBySymbol||{};
const history = {}; for(const [k,v] of Object.entries(historyRaw)) history[normSym(k)] = [...(history[normSym(k)]||[]), ...(Array.isArray(v)?v:[])];
const backfill = readJson(path.join(DATA,'history-backfill-report.json'),{}).rows||[];
const byRun = new Map(backfill.map(r=>[normSym(r.symbol),r]));
const symbols = alias.length ? alias.map(r=>normSym(r.symbol)) : Object.keys(history).map(normSym);
function stateFor(sym){
  const count=(history[sym]||[]).length;
  const run=byRun.get(sym)||{};
  let state='MISSING_HISTORY', reason='لا توجد جلسات تاريخية كافية بعد';
  if(count>=120){state='READY_120'; reason='جاهز لسياق تاريخي واسع';}
  else if(count>=50){state='READY_50'; reason='جاهز للتحليل الفني الكامل';}
  else if(count>=20){state='READY_20'; reason='جاهز مبدئيًا للتوصية المشروطة مع سقف ثقة مخفض';}
  else if(count>=10){state='WARMUP_10'; reason='تاريخ جزئي للمراقبة فقط';}
  else if(count>0){state='INSUFFICIENT'; reason=`تاريخ ضعيف جدًا (${count}/20): مراقبة فقط ولا تنفيذ`;}
  if(count<20){
    if(run.reason==='parsed_no_ohlcv') reason='المصادر العامة استجابت لكن لم تعرض جدول OHLCV قابلًا للاستخراج';
    else if(String(run.reason||'').startsWith('http_')) reason='المصدر رفض أو لم يجد صفحة تاريخية صالحة: '+run.reason;
    else if(run.reason && run.reason!=='no_source_attempted') reason='فشل الاسترجاع: '+run.reason;
    else if(!byRun.has(sym) && count===0) reason='لم يتم فحص الرمز في هذا التشغيل بسبب حد الوقت/الميزانية؛ شغل history_maintenance=true';
  }
  return {symbol:sym, sessions:count, state, reason, resolverConfidence:(alias.find(x=>normSym(x.symbol)===sym)||{}).confidence||0, sector:(alias.find(x=>normSym(x.symbol)===sym)||{}).sector||'غير مصنف', lastAttempt:run.reason||null, attempts:(run.attempts||[]).slice(0,6)};
}
const rows=[...new Set(symbols)].filter(Boolean).map(stateFor).sort((a,b)=>a.sessions-b.sessions || a.symbol.localeCompare(b.symbol));
const counts=rows.reduce((a,r)=>{a[r.state]=(a[r.state]||0)+1; return a;},{});
const commonFailures={}; rows.forEach(r=>{ if(r.sessions<20) commonFailures[r.reason]=(commonFailures[r.reason]||0)+1; });
writeJson(path.join(DATA,'history-source-diagnostics.json'), {
  ok:true,
  engine:'v11_3_history_source_diagnostics',
  generatedAt,
  summary:{total:rows.length, ready20:rows.filter(r=>r.sessions>=20).length, ready50:rows.filter(r=>r.sessions>=50).length, ready120:rows.filter(r=>r.sessions>=120).length, states:counts, commonFailures},
  rows,
  nextAction:'Run Actions → Update EGX Market Data with history_maintenance=true. If parsed_no_ohlcv remains dominant, add an official/licensed EOD API endpoint through EGX_HISTORY_API_URL secrets.',
  note:'Diagnostics are factual: no historical session is counted unless it exists in history.json and passes validation.'
});
console.log('Wrote history-source-diagnostics.json');
