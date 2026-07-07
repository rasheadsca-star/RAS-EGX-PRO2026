/* EGX Pro Hub V8.9.1 — Confidence Guard Report */
const fs=require('fs'), path=require('path');
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),'utf8')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function main(){
  const rank=read('data/final-opportunity-ranking.json',{rows:[]});
  const hist=read('data/history-backfill-plan.json',{});
  const price=read('data/price-reconciliation-report.json',{summary:{}});
  const source=read('data/source-fetch-report.json',{});
  const avg=n(hist.avgSessions), full=n(hist.full50Symbols), total=n(hist.totalSymbols);
  const coverage=n(source.coveragePct);
  const stale=n(price.summary?.stale), conflict=n(price.summary?.conflict);
  const guards=[];
  if(avg<15)guards.push({id:'history_limited',level:'warning',title:'سجل 50 جلسة غير مكتمل',message:`متوسط التاريخ ${avg.toFixed(1)}/50، لذلك لا يتم اعتبار إشارات 50 جلسة مكتملة.`,action:'استخدم النتائج للمراقبة ولا ترفع وزن SMA50/RSI حتى يكتمل السجل'});
  if(coverage && coverage<95)guards.push({id:'coverage_partial',level:'info',title:'تغطية المصدر أقل من 95%',message:`تغطية آخر جلب ${coverage.toFixed(1)}%`,action:'لا تعمل Reset؛ استمر بالتحديث التدريجي'});
  if(stale)guards.push({id:'stale_prices',level:stale>25?'warning':'info',title:'بعض الأسعار قديمة',message:`عدد الأسعار القديمة/غير المؤكدة ${stale}`,action:'راجع مركز تدقيق الأسعار قبل قرار سريع'});
  if(conflict)guards.push({id:'price_conflict',level:'critical',title:'تعارض أسعار',message:`عدد التعارضات ${conflict}`,action:'امنع ترقية أي سهم متعارض إلى تنفيذ'});
  const rows=(rank.rows||[]).slice(0,80).map(r=>{
    let guardPenalty=0; const notes=[];
    if(avg<15 || n(r.historySessions)<15){guardPenalty+=6;notes.push(`تاريخ محدود ${n(r.historySessions)}/50`)}
    if(r.priceState==='stale'){guardPenalty+=8;notes.push('سعر قديم')}
    if(r.priceState==='conflict'){guardPenalty+=25;notes.push('تعارض سعر')}
    if((r.blocks||[]).length){guardPenalty+=5;notes.push('قيود: '+(r.blocks||[]).join('، '))}
    return {symbol:r.symbol,name:r.name,grade:r.grade,rawProbability:n(r.targetProbability),guardedProbability:clamp(n(r.targetProbability)-guardPenalty,5,95),finalScore:n(r.finalScore),historySessions:n(r.historySessions),priceState:r.priceState,notes};
  });
  const score=clamp(100 - guards.filter(g=>g.level==='critical').length*25 - guards.filter(g=>g.level==='warning').length*10 - guards.filter(g=>g.level==='info').length*3,0,100);
  write('data/confidence-guard-report.json',{ok:true,engine:'v8_9_1_confidence_guard',generatedAt:new Date().toISOString(),score,state:score>=80?'ok':score>=60?'warn':'bad',summary:{historyAverageSessions:avg,full50:full,totalSymbols:total,sourceCoveragePct:coverage,stalePrices:stale,priceConflicts:conflict,guards:guards.length},guards,rows,note:'Explains why confidence should be guarded while historical depth or price freshness is incomplete.'});
  console.log('Confidence guard', {score,guards:guards.length});
}
main();
