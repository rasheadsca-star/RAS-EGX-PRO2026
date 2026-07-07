/* EGX Pro Hub V8.9.1 — Alert Decision Center Calibration */
const fs=require('fs'), path=require('path');
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),'utf8')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function add(out,a){out.push({id:a.id||[a.source,a.type,a.symbol||'market',a.title].join(':'),...a})}
function main(){
  const prices=read('data/price-reconciliation-report.json',{rows:[],summary:{}});
  const ranking=read('data/final-opportunity-ranking.json',{rows:[]});
  const smart=read('data/smart-alert-rules.json',{rules:[]});
  const portfolioRules=read('data/portfolio-decision-rules.json',{rules:[]});
  const out=[];

  const conflicts=(prices.rows||[]).filter(x=>x.hasConflict);
  conflicts.slice(0,20).forEach(x=>add(out,{level:'critical',priority:'عاجل',source:'price',type:'price_conflict',symbol:x.symbol,title:'تعارض سعر',text:`final=${x.finalPrice}, recommendation=${x.recommendationPrice}, market=${x.marketPrice}, cache=${x.cachePrice}`,action:'مراجعة السعر قبل أي قرار قوي',why:x.conflictSummary||'اختلاف داخلي بين المصادر'}));

  const stale=(prices.rows||[]).filter(x=>x.isStale);
  if(stale.length){
    add(out,{level:stale.length>25?'warning':'info',priority:stale.length>25?'مهم':'معلومة',source:'price',type:'stale_price_summary',symbol:null,title:`${stale.length} أسعار قديمة/غير مؤكدة`,text:`أمثلة: ${stale.slice(0,14).map(x=>x.symbol).join(', ')}`,action:'شغّل Workflow مرة واحدة فقط أو انتظر تحديث المصدر',why:'تم دمج الأسعار القديمة في تنبيه واحد بدل عشرات التنبيهات'});
  }

  (ranking.rows||[]).slice(0,40).forEach((r,i)=>{
    if(r.grade==='P1') add(out,{level:'opportunity',priority:'مراقبة قوية',source:'ranking',type:'p1_opportunity',symbol:r.symbol,title:`P1 فرصة قوية #${i+1}`,text:`prob=${r.targetProbability}% expected=${r.expectedReturnPct}% rr=${r.rr}`,action:'راجع الدخول والوقف وحجم الصفقة',why:r.why});
    else if(r.grade==='P2' && i<15) add(out,{level:'watch',priority:'مراقبة',source:'ranking',type:'p2_watch',symbol:r.symbol,title:`P2 مراقبة #${i+1}`,text:`prob=${r.targetProbability}% expected=${r.expectedReturnPct}% rr=${r.rr}`,action:'انتظار Trigger واضح',why:r.why});
    else if(r.grade==='Blocked' && i<20) add(out,{level:'warning',priority:'مهم',source:'ranking',type:'blocked_opportunity',symbol:r.symbol,title:'فرصة مقيّدة',text:`prob=${r.targetProbability}%`,action:'لا ترفع للأولوية قبل حل القيود',why:r.why});
  });

  (smart.rules||[]).slice(0,40).forEach(r=>add(out,{level:r.level||'info',priority:r.priority||'معلومة',source:r.category||'market',type:r.type||'smart_rule',symbol:r.symbol,title:r.title||r.type||'تنبيه سوق',text:r.trigger||'',action:r.action||'مراجعة',why:r.reason||r.trigger||''}));

  (portfolioRules.rules||[]).forEach(r=>{
    if(r.action==='increase_conditionally')add(out,{level:'opportunity',priority:'مراقبة قوية',source:'portfolio_rules',type:'increase_candidate',symbol:r.symbol,title:'مرشح زيادة مشروطة',text:`prob=${r.targetProbability}%`,action:'يستخدم فقط إذا كان السهم موجودًا بالمحفظة وبوزن مناسب',why:r.why});
    if(r.action==='do_not_add_review')add(out,{level:'warning',priority:'مهم',source:'portfolio_rules',type:'do_not_add',symbol:r.symbol,title:'لا تزود قبل المراجعة',text:`prob=${r.targetProbability}%`,action:'مراجعة القيود قبل أي زيادة',why:r.why});
  });

  const order={critical:5,warning:4,opportunity:3,watch:2,info:1};
  const seen=new Set();
  let deduped=out.filter(a=>{if(seen.has(a.id))return false;seen.add(a.id);return true}).sort((a,b)=>(order[b.level]||0)-(order[a.level]||0));
  const cap={critical:20,warning:12,opportunity:8,watch:15,info:8};
  const buckets={critical:[],warning:[],opportunity:[],watch:[],info:[]};
  deduped.forEach(a=>(buckets[a.level]||buckets.info).push(a));
  const suppressed={critical:Math.max(0,buckets.critical.length-cap.critical),warning:Math.max(0,buckets.warning.length-cap.warning),opportunity:Math.max(0,buckets.opportunity.length-cap.opportunity),watch:Math.max(0,buckets.watch.length-cap.watch),info:Math.max(0,buckets.info.length-cap.info)};
  const alerts=[...buckets.critical.slice(0,cap.critical),...buckets.warning.slice(0,cap.warning),...buckets.opportunity.slice(0,cap.opportunity),...buckets.watch.slice(0,cap.watch),...buckets.info.slice(0,cap.info)];
  if(Object.values(suppressed).some(Boolean)){
    alerts.push({id:'system:suppressed_alerts_summary',level:'info',priority:'معلومة',source:'system',type:'suppressed_summary',symbol:null,title:'تم إخفاء تنبيهات منخفضة الأولوية لتقليل الضوضاء',text:`مخفي: مهم ${suppressed.warning} / فرص ${suppressed.opportunity} / مراقبة ${suppressed.watch} / معلومات ${suppressed.info}`,action:'استخدم التقارير التفصيلية عند الحاجة',why:'مركز التنبيهات يعرض المهم فقط حتى لا يتحول إلى قائمة مزعجة'});
  }
  const summary={
    critical:alerts.filter(a=>a.level==='critical').length,
    warning:alerts.filter(a=>a.level==='warning').length,
    opportunity:alerts.filter(a=>a.level==='opportunity').length,
    watch:alerts.filter(a=>a.level==='watch').length,
    info:alerts.filter(a=>a.level==='info').length,
    urgent:alerts.filter(a=>a.level==='critical').length,
    important:alerts.filter(a=>a.level==='warning').length
  };
  write('data/alert-decision-center.json',{ok:true,engine:'v8_9_1_alert_decision_center_calibrated',generatedAt:new Date().toISOString(),total:alerts.length,summary,suppressed,alerts,note:'Calibrated: critical only for true blocking conflicts; stale prices are summarized, low-priority alerts are capped.'});
  console.log('Alert decision center',summary);
}
main();
