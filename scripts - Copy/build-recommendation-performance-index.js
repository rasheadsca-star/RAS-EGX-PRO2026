#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.3 — Recommendation Performance Index
  Output: data/recommendation-performance-index.json
  Composite indicator for recommendation success without treating open signals as failures.
*/
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel,f){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;}catch{return f;}}
function writeJson(rel,d){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n','utf8');}
function num(v,d=0){const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,''));return Number.isFinite(n)?n:d;}
function round(n,dp=2){const m=10**dp;return Math.round(num(n)*m)/m;}
function clamp(n,a=0,b=100){return Math.max(a,Math.min(b,num(n)));}
function grade(x){x=num(x);return x>=80?'ممتاز':x>=65?'جيد':x>=50?'متوسط':'يحتاج مراجعة';}
const now=new Date().toISOString();
const acc=readJson('data/recommendation-accuracy-latest.json',{});
const accHist=readJson('data/recommendation-accuracy.json',{});
const outcome=readJson('data/recommendation-outcome-tracker.json',{signals:[],summary:{}});
const aw=readJson('data/actionable-watchlist.json',{rows:[]});
const signals=Array.isArray(outcome.signals)?outcome.signals:[];
const os=outcome.summary||{};
const evaluated=num(acc.evaluatedRecommendations)||num(os.totalSignals)||signals.length;
const success=num(acc.success)||num(os.target1Hit)+num(os.target2Hit)||signals.filter(s=>/target/i.test(String(s.status))).length;
const partial=num(acc.partial)||num(os.open)||signals.filter(s=>String(s.status)==='open').length;
const failed=num(acc.failed)||num(os.stopHit)||signals.filter(s=>/stop|failed/i.test(String(s.status))).length;
const targetHits=num(acc.targetHit)||num(os.target1Hit)+num(os.target2Hit)||success;
const stopHits=num(acc.stopHit)||num(os.stopHit)||failed;
const weightedAccuracy=acc.weightedAccuracyPct!=null?num(acc.weightedAccuracyPct):null;
const rawAccuracy=acc.accuracyPct!=null?num(acc.accuracyPct):null;
const closed=success+failed;
const closedWinRate=closed?success/closed*100:null;
const stopProtection=closed?Math.max(0,100-(stopHits/Math.max(1,closed))*100):70;
const targetEfficiency=evaluated?Math.min(100,(targetHits/Math.max(1,evaluated))*250):50;
const openQuality=signals.length?signals.filter(s=>String(s.status)==='open').reduce((a,s)=>a+Math.max(0,Math.min(100,num(s.lastConfidence||s.initialConfidence||0))),0)/Math.max(1,signals.filter(s=>String(s.status)==='open').length||1):null;
const returns=signals.map(s=>num(s.currentReturnPct,null)).filter(v=>v!=null && Number.isFinite(v));
const avgReturn=returns.length?returns.reduce((a,b)=>a+b,0)/returns.length:null;
const returnScore=avgReturn==null?55:clamp(50+avgReturn*8);
const baseWeighted=weightedAccuracy!=null?weightedAccuracy:(closedWinRate!=null?closedWinRate:55);
const components=[
  {id:'weighted_accuracy',name:'الدقة المرجحة',value:round(baseWeighted,1),weight:0.35,source:'recommendation-accuracy-latest'},
  {id:'closed_win_rate',name:'نجاح الإشارات المغلقة',value:round(closedWinRate==null?baseWeighted:closedWinRate,1),weight:0.25,source:'outcome-tracker'},
  {id:'target_efficiency',name:'كفاءة ضرب الأهداف',value:round(targetEfficiency,1),weight:0.15,source:'target hits'},
  {id:'stop_protection',name:'حماية وقف الخسارة',value:round(stopProtection,1),weight:0.15,source:'stop hits'},
  {id:'return_score',name:'متوسط العائد بعد الإشارة',value:round(returnScore,1),weight:0.10,source:'tracked returns'}
];
let index=components.reduce((a,c)=>a+num(c.value)*num(c.weight),0);
// If very few closed signals, keep the index provisional and lean more on weighted/open quality.
let confidence='normal';
if(closed<10){
  confidence='provisional';
  const oq=openQuality!=null?openQuality:baseWeighted;
  index=index*0.55 + oq*0.25 + baseWeighted*0.20;
}
index=round(clamp(index),1);
const summary={
  evaluatedRecommendations:evaluated,
  success,partial,failed,targetHits,stopHits,
  totalSignals:num(os.totalSignals)||signals.length,
  open:num(os.open)||signals.filter(s=>String(s.status)==='open').length,
  closed,closedWinRatePct:closedWinRate==null?null:round(closedWinRate,1),
  weightedAccuracyPct:weightedAccuracy==null?null:round(weightedAccuracy,1),
  rawAccuracyPct:rawAccuracy==null?null:round(rawAccuracy,1),
  avgCurrentReturnPct:avgReturn==null?null:round(avgReturn,2),
  actionableRows:Array.isArray(aw.rows)?aw.rows.length:0
};
const interpretation=confidence==='provisional'
  ? 'المؤشر مبدئي لأن عدد الإشارات المغلقة قليل. لا يتم اعتبار الإشارات المفتوحة فاشلة قبل الوصول إلى هدف أو وقف أو انتهاء فترة المتابعة.'
  : 'المؤشر يقيس الدقة المركبة للتوصيات مع مراعاة الأهداف ووقف الخسارة والعائد بعد الإشارة.';
writeJson('data/recommendation-performance-index.json',{
  ok:true,engine:'v8_9_3_recommendation_performance_index',generatedAt:now,
  index,grade:grade(index),verdict:grade(index),confidence,summary,components,interpretation,
  recommendations:[
    index<50?'راجع شروط قبول توصيات A/A+ وقلل الإشارات الضعيفة.':'استمر في قياس الإشارات على أكثر من جلسة قبل الحكم النهائي.',
    stopHits>targetHits?'ارفع وزن وقف الخسارة وجودة الدخول قبل قبول التوصية.':'نسبة الوقف لا تبدو مسيطرة على المؤشر الحالي.',
    closed<10?'انتظر مزيدًا من الإشارات المغلقة لثبات المؤشر.':'العينة أصبحت أفضل للحكم على الأداء.'
  ]
});
console.log(`Recommendation performance index generated: ${index}% (${grade(index)})`);
