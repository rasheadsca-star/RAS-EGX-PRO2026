/*
EGX Pro Hub V7.14 — Recommendation Accuracy Tracker

Compares previous recommendation signals with current actual stock performance.
Outputs:
- data/recommendation-signals-ledger.json
- data/recommendation-accuracy-latest.json
- data/recommendation-accuracy.json

Important: first run is warm-up because there is no prior recommendation snapshot yet.
*/
const fs = require('fs');
const path = require('path');

function readJson(file, fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),'utf8')}
function num(v){if(v==null||v==='')return null;if(typeof v==='number')return isFinite(v)?v:null;const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return isFinite(n)?n:null}
function symbolOf(r){return String(r.symbol||r.ticker||r.code||r.Symbol||'').trim().toUpperCase()}
function dateOf(ts){const d=ts?new Date(ts):new Date();return isNaN(d)?new Date().toISOString().slice(0,10):d.toISOString().slice(0,10)}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function avg(arr){arr=arr.filter(x=>x!=null&&isFinite(x));return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:null}

function directionOf(r){
  const text=String([r.recommendation,r.reason,r.signal,r.decision,r.priority].join(' ')).toLowerCase();
  if(/risk|sell|exit|invalid|stop|خفض|تخفيف|خروج|بيع|مخاطر|سلبي/.test(text)) return 'negative';
  if(/buy|entry|increase|watch|positive|شراء|دخول|زيادة|فرصة|مراقبة/.test(text)) return 'positive';
  const c=num(r.finalConfidence)||num(r.confidence)||0;
  return c>=70?'positive':'neutral';
}
function directionLabel(d){return d==='positive'?'إيجابي / فرصة':d==='negative'?'تحذير / مخاطر':'محايد / انتظار'}
function signalFromRow(r, generatedAt){
  const price=num(r.price)||num(r.last)||num(r.close)||0;
  if(!symbolOf(r)||price<=0)return null;
  return {
    signalId:`${dateOf(generatedAt)}-${symbolOf(r)}`,
    signalDate:dateOf(generatedAt),
    generatedAt,
    symbol:symbolOf(r),
    name:r.name_ar||r.name_en||r.name||'',
    sector:r.sector||'غير مصنف',
    recommendation:r.recommendation||r.decision||'',
    direction:directionOf(r),
    directionLabel:directionLabel(directionOf(r)),
    confidence:num(r.finalConfidence)||num(r.confidence)||0,
    priceAtSignal:price,
    target1:num(r.target1)||null,
    target2:num(r.target2)||null,
    stopLoss:num(r.stopLoss)||null,
    entryFrom:num(r.entryFrom)||null,
    entryTo:num(r.entryTo)||null,
    evaluated:false
  };
}
function resultFor(sig,row){
  const current=num(row.price)||num(row.last)||num(row.close)||0;
  if(!current||!sig.priceAtSignal)return null;
  const ret=((current-sig.priceAtSignal)/sig.priceAtSignal)*100;
  const hitTarget=sig.target1&&current>=sig.target1;
  const hitStop=sig.stopLoss&&current<=sig.stopLoss;
  let score=0, result='fail', label='فشل';
  if(sig.direction==='positive'){
    if(hitTarget || ret>=0.50){score=1;result='success';label=hitTarget?'ناجح — وصل هدف':'ناجح'}
    else if(ret>=-0.50 && !hitStop){score=.5;result='partial';label='جزئي / لم يحسم'}
    else {score=0;result='fail';label=hitStop?'فشل — ضرب وقف':'فشل'}
  } else if(sig.direction==='negative'){
    if(ret<=-0.25 || hitStop){score=1;result='success';label='ناجح — التحذير كان صحيحًا'}
    else if(ret<=0.50){score=.5;result='partial';label='جزئي'}
    else {score=0;result='fail';label='فشل — السهم عكس التحذير'}
  } else {
    if(Math.abs(ret)<=1.0){score=1;result='success';label='ناجح — انتظار مناسب'}
    else if(Math.abs(ret)<=2.0){score=.5;result='partial';label='جزئي'}
    else {score=0;result='fail';label='فشل'}
  }
  return {
    symbol:sig.symbol,name:sig.name,sector:sig.sector,signalDate:sig.signalDate,evaluationDate:null,
    direction:sig.direction,directionLabel:sig.directionLabel,recommendation:sig.recommendation,
    priceAtSignal:sig.priceAtSignal,currentPrice:current,actualReturnPct:ret,confidence:sig.confidence,
    target1:sig.target1,stopLoss:sig.stopLoss,targetHit:!!hitTarget,stopHit:!!hitStop,
    score,result,resultLabel:label
  };
}
function summarizeDay(date, items){
  const n=items.length;
  const success=items.filter(x=>x.result==='success').length;
  const partial=items.filter(x=>x.result==='partial').length;
  const failed=items.filter(x=>x.result==='fail').length;
  const scoreSum=items.reduce((a,b)=>a+(num(b.score)||0),0);
  const top10=items.slice().sort((a,b)=>(num(b.confidence)||0)-(num(a.confidence)||0)).slice(0,10);
  const topScore=top10.reduce((a,b)=>a+(num(b.score)||0),0);
  return {
    date,evaluatedRecommendations:n,success,partial,failed,
    accuracyPct:n?success/n*100:null,
    weightedAccuracyPct:n?scoreSum/n*100:null,
    avgActualReturnPct:avg(items.map(x=>x.actualReturnPct)),
    top10WeightedAccuracyPct:top10.length?topScore/top10.length*100:null,
    targetHit:items.filter(x=>x.targetHit).length,
    stopHit:items.filter(x=>x.stopHit).length,
    items
  };
}
function summarizeLife(days){
  const valid=days.filter(d=>(d.evaluatedRecommendations||0)>0);
  const total=valid.reduce((a,d)=>a+(d.evaluatedRecommendations||0),0);
  const success=valid.reduce((a,d)=>a+(d.success||0),0);
  const weightedPoints=valid.reduce((a,d)=>a+((d.weightedAccuracyPct||0)/100)*(d.evaluatedRecommendations||0),0);
  const avgRet=avg(valid.map(d=>d.avgActualReturnPct));
  return {
    daysTracked:valid.length,totalEvaluated:total,totalSuccess:success,
    overallAccuracyPct:total?success/total*100:null,
    overallWeightedAccuracyPct:total?weightedPoints/total*100:null,
    avgDailyWeightedAccuracyPct:avg(valid.map(d=>d.weightedAccuracyPct)),
    avgActualReturnPct:avgRet,
    firstDate:valid[0]?.date||null,lastDate:valid[valid.length-1]?.date||null
  };
}
function main(){
  const rec=readJson('data/recommendations.json',{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  const generatedAt=rec.generatedAt||rec.updatedAt||new Date().toISOString();
  const today=dateOf(generatedAt);
  const bySymbol=new Map(rows.map(r=>[symbolOf(r),r]));
  const ledger=readJson('data/recommendation-signals-ledger.json',{version:'v7_14',signals:[]});
  const prior=(ledger.signals||[]).filter(s=>s.signalDate && s.signalDate<today);
  const latestBySymbol=new Map();
  prior.sort((a,b)=>String(a.generatedAt).localeCompare(String(b.generatedAt))).forEach(s=>latestBySymbol.set(s.symbol,s));
  const evaluated=[];
  for(const [sym,sig] of latestBySymbol.entries()){
    const row=bySymbol.get(sym);
    if(!row)continue;
    const item=resultFor(sig,row);
    if(item){item.evaluationDate=today;evaluated.push(item)}
  }
  evaluated.sort((a,b)=>(num(b.confidence)||0)-(num(a.confidence)||0));
  const daily=summarizeDay(today,evaluated);
  daily.engine='v7_14_recommendation_accuracy';
  daily.generatedAt=new Date().toISOString();
  daily.method='Compares latest prior recommendation snapshot with current actual price. Partial results count as 0.5 in weighted accuracy.';
  if(evaluated.length===0)daily.message='Warm-up: no prior recommendation snapshot was available to evaluate yet.';

  const history=readJson('data/recommendation-accuracy.json',{version:'v7_14',days:[],lifetime:{}});
  const days=(history.days||[]).filter(d=>d.date!==today);
  days.push({...daily,items:daily.items.slice(0,80)});
  days.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const capped=days.slice(-120);
  const lifetime=summarizeLife(capped);
  const latest={ok:true,engine:'v7_14_recommendation_accuracy',generatedAt:new Date().toISOString(),daily:{...daily,items:daily.items.slice(0,80)},lifetime};
  writeJson('data/recommendation-accuracy-latest.json',latest);
  writeJson('data/recommendation-accuracy.json',{ok:true,version:'v7_14',updatedAt:new Date().toISOString(),days:capped,lifetime});

  const newSignals=rows.map(r=>signalFromRow(r,generatedAt)).filter(Boolean);
  const kept=(ledger.signals||[]).filter(s=>s.signalDate && s.signalDate>=dateOf(new Date(Date.now()-1000*60*60*24*45).toISOString()) && s.signalDate!==today);
  writeJson('data/recommendation-signals-ledger.json',{ok:true,version:'v7_14',updatedAt:new Date().toISOString(),signals:[...kept,...newSignals].slice(-15000)});

  console.log('Recommendation accuracy:',{date:today,evaluated:evaluated.length,weightedAccuracyPct:daily.weightedAccuracyPct,lifetime:lifetime.overallWeightedAccuracyPct});
}
main();
