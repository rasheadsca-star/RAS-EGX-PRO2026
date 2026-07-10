#!/usr/bin/env node
/* EGX Pro Hub V8.9.3 — Engines Console Report
   Output: data/engines-console-report.json */
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel,f){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;}catch{return f;}}
function writeJson(rel,d){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n','utf8');}
function num(v,d=0){const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,''));return Number.isFinite(n)?n:d;}
function status(ok,warn=false){return ok?'ok':warn?'warn':'info';}
const now=new Date().toISOString();
const source=readJson('data/source-health.json',{}), gateway=readJson('data/source-gateway-report.json',{}), fetch=readJson('data/source-fetch-report.json',{});
const quality=readJson('data/signal-quality-report.json',{}), actionable=readJson('data/actionable-watchlist.json',{}), entry=readJson('data/entry-trigger-report.json',{});
const ranking=readJson('data/final-opportunity-ranking.json',{}), daily=readJson('data/daily-decision-brief.json',{}), alerts=readJson('data/alert-decision-center.json',{}), smart=readJson('data/smart-alert-rules.json',{});
const news=readJson('data/news-intelligence.json',{}), portfolio=readJson('data/portfolio-decision-rules.json',{}), perf=readJson('data/recommendation-performance-index.json',{}), outcome=readJson('data/recommendation-outcome-tracker.json',{});
const history=readJson('data/history-health.json',{}), app=readJson('data/app-health-status.json',{}), regression=readJson('data/app-regression-report.json',{}), dataOps=readJson('data/data-operations-center.json',{});
const rows=num(gateway.rows||gateway.acceptedRows||fetch.marketRows||source.rowsRead||source.cacheRows);
const cov=num(gateway.coveragePct||fetch.coveragePct||source.universeCoveragePct);
const critical=(alerts.alerts||alerts.rows||smart.alerts||[]).filter(a=>/urgent|critical|risk|عاجل|حرج/i.test(String(a.level||a.severity||a.type||''))).length;
const engines=[
  {id:'data_gateway',name:'محرك البيانات',screen:'gateway',status:rows>=180?'ok':rows>=80?'warn':'bad',items:rows,lastUpdate:gateway.generatedAt||fetch.generatedAt||source.generatedAt||now,headline:`تغطية ${cov||0}% — مصدر ${gateway.selectedSource||fetch.sourceName||source.sourceName||'public'}`},
  {id:'signal_quality',name:'محرك جودة الإشارة',screen:'performanceIndex',status:quality.ok||actionable.ok?'ok':'warn',items:(quality.rows||quality.summary?.rows||actionable.rows||[]).length||0,lastUpdate:quality.generatedAt||actionable.generatedAt||now,headline:'يضبط الثقة ويمنع التوصيات الضعيفة من الظهور كفرص قوية'},
  {id:'actionable_watchlist',name:'قائمة قرار اليوم',screen:'home',status:actionable.ok?'ok':'warn',items:(actionable.rows||[]).length,lastUpdate:actionable.generatedAt||now,headline:'توحيد الفرص اليومية ومحرك الأولويات في قائمة واحدة'},
  {id:'entry_trigger',name:'محرك الدخول والأهداف',screen:'home',status:entry.ok?'ok':'warn',items:(entry.rows||entry.triggers||[]).length,lastUpdate:entry.generatedAt||now,headline:'يتحقق من الدخول والهدف والوقف وR/R'},
  {id:'daily_opportunities',name:'محرك الفرص اليومية',screen:'dailyOpportunities',status:ranking.ok||ranking.rows?'ok':'warn',items:(ranking.rows||ranking.items||[]).length,lastUpdate:ranking.generatedAt||now,headline:'يرتب فرص الجلسة بناءً على السيولة والحركة والاحتمال'},
  {id:'alerts',name:'محرك المخاطر والتنبيهات',screen:'alertsCenter',status:critical?'warn':'ok',items:critical,lastUpdate:alerts.generatedAt||smart.generatedAt||now,headline:critical?`${critical} تنبيه حرج يحتاج مراجعة`:'لا توجد تنبيهات حرجة'},
  {id:'news',name:'محرك الأخبار',screen:'newsIntel',status:news.ok||news.items?'ok':'info',items:news.items||news.summary?.items||0,lastUpdate:news.generatedAt||now,headline:'يربط الأخبار بالأسهم والقطاعات عند توفر البيانات'},
  {id:'portfolio',name:'محرك المحفظة',screen:'portfolioDecision',status:portfolio.ok?'ok':'info',items:(portfolio.rows||portfolio.decisions||[]).length,lastUpdate:portfolio.generatedAt||now,headline:'يعطي قواعد احتفاظ/تخفيف/مراقبة للمحفظة'},
  {id:'accuracy',name:'محرك دقة التوصيات',screen:'performanceIndex',status:num(perf.index)>=65?'ok':num(perf.index)>=50?'warn':'info',items:perf.index!=null?`${perf.index}%`:'-',lastUpdate:perf.generatedAt||outcome.generatedAt||now,headline:perf.interpretation||'مؤشر مركب لقياس نجاح التوصيات'},
  {id:'history',name:'محرك ذاكرة 50 جلسة',screen:'sessionMemory',status:num(history.symbolsWithComplete50)>0?'ok':num(history.symbolsWithAnyHistory)>0?'warn':'info',items:`${num(history.averageSessionsPerSymbol||history.avgSessions)}/50`,lastUpdate:history.generatedAt||now,headline:`${num(history.symbolsWithComplete50)} سهم مكتمل 50 جلسة`},
  {id:'data_ops',name:'مركز عمليات البيانات',screen:'dataOps',status:dataOps.ok?'ok':'warn',items:(dataOps.checks||[]).length,lastUpdate:dataOps.generatedAt||now,headline:'يتابع الجلب، الكاش، التغطية، والتحذيرات'},
  {id:'app_health',name:'محرك صحة التطبيق',screen:'sources',status:app.ok&&!(regression.failedCount>0)?'ok':'warn',items:app.score||'-',lastUpdate:app.generatedAt||regression.generatedAt||now,headline:regression.failedCount?`${regression.failedCount} فحص فشل`:'فحص التطبيق مستقر'}
];
const summary={total:engines.length,ok:engines.filter(e=>e.status==='ok').length,warn:engines.filter(e=>e.status==='warn').length,bad:engines.filter(e=>e.status==='bad').length,info:engines.filter(e=>e.status==='info').length};
writeJson('data/engines-console-report.json',{ok:true,engine:'v8_9_3_engines_console',generatedAt:now,summary,engines});
console.log(`Engines console generated: ${summary.ok}/${summary.total} ok`);
