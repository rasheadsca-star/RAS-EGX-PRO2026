/* EGX Pro Hub V8.9.1 — Clear Data Operations Center */
const fs=require('fs'), path=require('path');
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),'utf8')}
function num(v){const n=Number(v);return isFinite(n)?n:0}
function stateFromScore(score){return score>=85?'ok':score>=60?'warn':'bad'}
function main(){
  const source=read('data/source-health.json',{}), fetchVerify=read('data/workflow-source-verification.json',{}), fetchStatus=read('data/fetch-status.json',{}), sourceFetchReport=read('data/source-fetch-report.json',{}), price=read('data/price-reconciliation-report.json',{summary:{}}), hist=read('data/history-backfill-plan.json',{}), ranking=read('data/final-opportunity-ranking.json',{summary:{}}), alerts=read('data/alert-decision-center.json',{summary:{}}), reg=read('data/app-regression-report.json',{}), guard=read('data/confidence-guard-report.json',{});
  const checks=[];
  const realFetch=!!(sourceFetchReport.realFetch || fetchStatus.realFetch || fetchVerify.realFetch);
  const coverage=num(sourceFetchReport.coveragePct || source.universeCoveragePct || source.coveragePct || 0);
  const selectedRows=num(sourceFetchReport.marketRows || sourceFetchReport.selected?.rows || source.marketRows || 0);
  checks.push({id:'fetcher',name:'جلب البيانات',state:realFetch&&coverage>=80?'ok':realFetch?'warn':'bad',value:realFetch?`accepted ${selectedRows} صف`:'غير مؤكد',message:realFetch?`مصدر ${sourceFetchReport.sourceName||fetchStatus.sourceName||'public'} قبل ${selectedRows} صف`:'لا يوجد جلب خارجي مؤكد',action:realFetch?'متابعة بدون Reset':'افتح تحقق الجلب'});
  checks.push({id:'coverage',name:'تغطية السوق',state:coverage>=95?'ok':coverage>=80?'warn':'bad',value:`${coverage.toFixed(1)}%`,message:coverage>=95?'تغطية ممتازة':coverage>=80?'تغطية مقبولة مع نقص محدود':'التغطية أقل من حد التشغيل المريح',action:coverage>=95?'متابعة':coverage>=80?'تشغيل Workflow لاحقًا عند الحاجة':'راجع مصدر البيانات'});
  const conflicts=num(price.summary?.conflict), stale=num(price.summary?.stale);
  checks.push({id:'price',name:'تدقيق الأسعار',state:conflicts>0?'bad':stale>25?'warn':'ok',value:`${conflicts} تعارض / ${stale} قديم`,message:conflicts>0?'يوجد تعارض أسعار مؤثر':stale>0?'بعض الأسعار تحتاج تحقق لكن ليست فشلًا عامًا':'الأسعار الداخلية متسقة',action:conflicts>0?'افتح تدقيق الأسعار':stale>0?'راجع القائمة ولا تكرر Workflow بلا داعٍ':'متابعة'});
  const total=num(hist.totalSymbols), full=num(hist.full50Symbols), avg=num(hist.avgSessions);
  checks.push({id:'history',name:'ذاكرة 50 جلسة',state:total&&full/total>=.5?'ok':avg>=15?'warn':'warn',value:`${full}/${total} مكتمل`,message:`متوسط الجلسات ${avg.toFixed(1)} / 50 — التحليل الطويل غير مكتمل`,action:avg<15?'شغّل history_maintenance=true فقط عند الحاجة':'استمر في التراكم'});
  const p1=num(ranking.summary?.p1), p2=num(ranking.summary?.p2), blocked=num(ranking.summary?.blocked);
  checks.push({id:'ranking',name:'محرك الأولويات',state:p1+p2>0?'ok':blocked>0?'warn':'bad',value:`P1 ${p1} / P2 ${p2} / مقيّد ${blocked}`,message:p1+p2>0?'يوجد فرص قابلة للمراجعة':'لا توجد فرص قوية واضحة الآن',action:'افتح محرك الأولويات'});
  const critical=num(alerts.summary?.critical), warning=num(alerts.summary?.warning), opp=num(alerts.summary?.opportunity), watch=num(alerts.summary?.watch);
  checks.push({id:'alerts',name:'مركز التنبيهات',state:critical>0?'bad':warning>8?'warn':'ok',value:`عاجل ${critical} / مهم ${warning} / فرص ${opp} / مراقبة ${watch}`,message:critical>0?'ابدأ بالتنبيهات العاجلة':warning>0?'تنبيهات مهمة بدون فشل حرج':'لا توجد تنبيهات مؤثرة',action:critical||warning?'افتح مركز التنبيهات':'متابعة'});
  const guardScore=num(guard.score);
  checks.push({id:'confidence_guard',name:'حارس الثقة',state:guardScore>=80?'ok':guardScore>=60?'warn':'bad',value:guardScore?`${guardScore}%`:'غير متاح',message:guard.summary?`تاريخ ${num(guard.summary.historyAverageSessions).toFixed(1)}/50 وتغطية ${num(guard.summary.sourceCoveragePct).toFixed(1)}%`:'لم يتم توليد تقرير حارس الثقة',action:'راجع تفسير الثقة قبل الاعتماد على النتائج'});
  const failures=num(reg.failed||reg.failures||0);
  checks.push({id:'regression',name:'فحص الثبات',state:failures>0?'bad':'ok',value:`${failures} فشل`,message:failures>0?'يوجد فحص فاشل':'لا توجد أخطاء فحص معروفة',action:failures>0?'افتح فحص الثبات':'متابعة'});
  const bad=checks.filter(x=>x.state==='bad').length, warn=checks.filter(x=>x.state==='warn').length, ok=checks.filter(x=>x.state==='ok').length, score=Math.max(0,100-bad*20-warn*6);
  write('data/data-operations-center.json',{ok:true,engine:'v8_9_1_data_operations_center_clear',generatedAt:new Date().toISOString(),score,state:stateFromScore(score),summary:{ok,warn,bad,total:checks.length},checks,runbook:['إذا الجلب accepted والتغطية فوق 80% فلا تعمل Reset.','إذا التاريخ أقل من 15/50 فهذا نقص تحليل طويل وليس فشل تشغيل.','إذا التنبيهات كثيرة، ابدأ بالعاجل فقط ثم المهم.','لا ترفع scan-state أو full-market-cache يدويًا إلا عند Restore/Reset صريح.'],note:'Clear operational center: separates source failure from incomplete history and alert noise.'});
  console.log('Data operations center', {score,ok,warn,bad});
}
main();
