#!/usr/bin/env node
/* EGX Pro Hub V8.9.3 — Executive Home Report
   Output: data/executive-home-report.json */
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel,f){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;}catch{return f;}}
function writeJson(rel,d){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n','utf8');}
function num(v,d=0){const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,''));return Number.isFinite(n)?n:d;}
const now=new Date().toISOString();
const source=readJson('data/source-health.json',{}), gateway=readJson('data/source-gateway-report.json',{}), fetch=readJson('data/source-fetch-report.json',{});
const actionable=readJson('data/actionable-watchlist.json',{rows:[]}), perf=readJson('data/recommendation-performance-index.json',{}), engines=readJson('data/engines-console-report.json',{});
const alerts=readJson('data/alert-decision-center.json',{}), smart=readJson('data/smart-alert-rules.json',{}), history=readJson('data/history-health.json',{});
const rows=Array.isArray(actionable.rows)?actionable.rows:[];
const critical=(alerts.alerts||alerts.rows||smart.alerts||[]).filter(a=>/urgent|critical|risk|عاجل|حرج/i.test(String(a.level||a.severity||a.type||''))).slice(0,8);
const dataRows=num(gateway.rows||gateway.acceptedRows||fetch.marketRows||source.rowsRead||source.cacheRows);
const coverage=num(gateway.coveragePct||fetch.coveragePct||source.universeCoveragePct);
const dataStatus=dataRows>=180?'ok':dataRows>=80?'warn':'bad';
const top=rows.slice().sort((a,b)=>num(b.compositeScore||b.confidence)-num(a.compositeScore||a.confidence)).slice(0,10);
const summary={
  dataStatus,coveragePct:coverage,marketRows:dataRows,source:gateway.selectedSource||fetch.sourceName||source.sourceName||'public_sources',
  actionableCount:rows.length,aPlus:rows.filter(r=>String(r.tier).toUpperCase()==='A+').length,aOrBetter:rows.filter(r=>['A+','A'].includes(String(r.tier).toUpperCase())).length,
  criticalAlerts:critical.length,historyAverage:num(history.averageSessionsPerSymbol||history.avgSessions),historyComplete50:num(history.symbolsWithComplete50),
  recommendationIndex:perf.index??null,recommendationGrade:perf.grade||null,enginesOk:engines.summary?.ok??null,enginesWarn:engines.summary?.warn??null
};
const nextActions=[];
if(dataStatus!=='ok')nextActions.push('راجع بوابة البيانات قبل الاعتماد على أي توصية.');
if(summary.criticalAlerts)nextActions.push('ابدأ بالتنبيهات الحرجة قبل الفرص الجديدة.');
if(summary.aOrBetter)nextActions.push('راجع أسهم A+/A فقط داخل نطاق الدخول وبوقف خسارة واضح.');
if(num(perf.index)<50 && perf.index!=null)nextActions.push('راجع شروط قبول التوصيات لأن مؤشر الدقة يحتاج تحسين.');
if(num(history.symbolsWithComplete50)===0)nextActions.push('تعامل مع نقص 50 جلسة كنقص تحليل تاريخي وليس فشل تشغيل.');
writeJson('data/executive-home-report.json',{ok:true,engine:'v8_9_3_executive_home',generatedAt:now,summary,topOpportunities:top,criticalAlerts:critical,nextActions,disclaimer:'مساعد قرار وتحليل فقط. لا يوجد ضمان ربح أو أمر تداول.'});
console.log(`Executive home generated: ${top.length} opportunities, data ${dataStatus}`);
