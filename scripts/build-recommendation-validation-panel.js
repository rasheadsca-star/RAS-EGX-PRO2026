#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.8 — Recommendation Validation Panel
  Purpose: measure recommendation outcomes without treating open recommendations as failures.
*/
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel, fallback){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):fallback;}catch{return fallback;}}
function writeJson(rel,data){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(data,null,2)+'\n','utf8');}
function arr(x,keys=[]){if(Array.isArray(x))return x;if(!x||typeof x!=='object')return [];for(const k of keys)if(Array.isArray(x[k]))return x[k];return []}
function num(v,d=0){if(v===null||v===undefined||v==='')return d;if(typeof v==='number')return Number.isFinite(v)?v:d;const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:d;}
function clamp(n,lo=0,hi=100){return Math.max(lo,Math.min(hi,n));}
function round(n,dp=2){const m=10**dp;return Math.round(num(n)*m)/m;}
function symOf(r){return String(r?.symbol||r?.code||r?.ticker||'').trim().toUpperCase();}
function priceOf(r){return num(r?.price??r?.finalPrice??r?.last??r?.close??r?.currentPrice,0)}
function pct(a,b){return b?((a-b)/b)*100:0}
function resolveRows(){
  const outcome=readJson('data/recommendation-outcome-tracker.json',{});
  const accuracyLatest=readJson('data/recommendation-accuracy-latest.json',{});
  const accuracy=readJson('data/recommendation-accuracy.json',{});
  const perf=readJson('data/recommendation-performance-index.json',{});
  const actionable=readJson('data/actionable-watchlist.json',{});
  const ranking=readJson('data/final-opportunity-ranking.json',{});
  const market=readJson('data/market.json',{});
  const cache=readJson('data/full-market-cache.json',{});
  const recs=readJson('data/recommendations.json',{});
  return {outcome,accuracyLatest,accuracy,perf,actionable,ranking,market,cache,recs};
}
const {outcome,accuracyLatest,accuracy,perf,actionable,ranking,market,cache,recs}=resolveRows();
const marketMap=new Map([...arr(cache,['rows']),...arr(market,['rows'])].map(r=>[symOf(r),r]).filter(x=>x[0]));
const candidateRows=[...arr(outcome,['rows','signals','recommendations']),...arr(actionable,['rows','items','watchlist']),...arr(ranking,['rows']),...arr(recs,['all','rows','topBuyCandidates','watchlist'])];
const seen=new Set();
const rows=[];
for(const raw of candidateRows){
  const symbol=symOf(raw); if(!symbol||seen.has(symbol))continue; seen.add(symbol);
  const m=marketMap.get(symbol)||{};
  const entry=num(raw.entryHigh??raw.entryFrom??raw.entryTo??raw.entryLow??raw.entry??raw.price,0);
  const current=priceOf(m)||priceOf(raw);
  const target1=num(raw.target1??raw.t1,0);
  const target2=num(raw.target2??raw.t2,0);
  const stop=num(raw.stopLoss??raw.stop??raw.sl,0);
  let status='open'; let statusLabel='مفتوحة'; let score=50;
  const explicit=String(raw.outcome||raw.status||raw.result||'').toLowerCase();
  if(/target2|هدف 2|t2/.test(explicit)){status='target2';statusLabel='وصل هدف 2';score=100;}
  else if(/target1|هدف 1|success|نجاح|hit target/.test(explicit)){status='target1';statusLabel='وصل هدف 1';score=85;}
  else if(/stop|وقف|fail|فشل/.test(explicit)){status='stop';statusLabel='ضرب وقف';score=0;}
  else if(current&&target2&&current>=target2){status='target2';statusLabel='وصل هدف 2';score=100;}
  else if(current&&target1&&current>=target1){status='target1';statusLabel='وصل هدف 1';score=85;}
  else if(current&&stop&&current<=stop){status='stop';statusLabel='ضرب وقف';score=0;}
  const maxGainPct=num(raw.maxGainPct??raw.maxProfitPct??raw.peakReturnPct, current&&entry?pct(current,entry):0);
  const maxDrawdownPct=num(raw.maxDrawdownPct??raw.maxLossPct??raw.drawdownPct, 0);
  let openReturnPct=current&&entry?round(pct(current,entry),2):null; if(openReturnPct!==null && Math.abs(openReturnPct)>120) openReturnPct=null;
  rows.push({symbol,name:raw.name||raw.name_ar||m.name_ar||m.name||'',grade:raw.grade||raw.tier||raw.finalGrade||raw.classification||'',action:raw.action||raw.recommendation||'',entry,current,target1,target2,stopLoss:stop,status,statusLabel,score,maxGainPct:round(maxGainPct,2),maxDrawdownPct:round(maxDrawdownPct,2),openReturnPct,confidence:num(raw.confidence??raw.finalConfidence??raw.targetProbability??raw.finalScore,0),source:raw.source||raw.sourceTag||'merged'});
}
const evaluated=rows.filter(r=>r.status!=='open');
const openRows=rows.filter(r=>r.status==='open');
const rawTargetHit=num(accuracyLatest.targetHit??accuracyLatest.targetHits??accuracyLatest.target1Hit,0);
const rawStopHit=num(accuracyLatest.stopHit??accuracyLatest.stopHits,0);
const rawEvaluated=num(accuracyLatest.evaluatedRecommendations??accuracyLatest.measuredRecommendations??accuracyLatest.total,0);
let target1=rows.filter(r=>r.status==='target1').length, target2=rows.filter(r=>r.status==='target2').length, stops=rows.filter(r=>r.status==='stop').length;
if(!target1&&!target2&&rawTargetHit) target1=rawTargetHit;
if(!stops&&rawStopHit) stops=rawStopHit;
const fullSuccess=target1+target2;
const evaluatedCount=evaluated.length || rawEvaluated || (fullSuccess+stops);
const openCount=Math.max(0, rows.length-evaluated.length);
const successRate=evaluatedCount?round((fullSuccess/evaluatedCount)*100,1):0;
const stopRate=evaluatedCount?round((stops/evaluatedCount)*100,1):0;
const validOpen=rows.filter(r=>r.openReturnPct!==null&&r.openReturnPct!==undefined);
const validGain=rows.filter(r=>Math.abs(num(r.maxGainPct,0))<=120);
const avgOpenReturn=validOpen.length?round(validOpen.reduce((s,r)=>s+num(r.openReturnPct,0),0)/validOpen.length,2):0;
const avgMaxGain=validGain.length?round(validGain.reduce((s,r)=>s+num(r.maxGainPct,0),0)/validGain.length,2):0;
const avgDrawdown=rows.length?round(rows.reduce((s,r)=>s+Math.abs(num(r.maxDrawdownPct,0)),0)/rows.length,2):0;
const weightedFromExisting=num(perf.summary?.weightedAccuracyPct ?? perf.index ?? perf.accuracyIndex ?? accuracyLatest.weightedAccuracyPct ?? accuracyLatest.accuracyPct, null);
let validationIndex = weightedFromExisting!==null ? weightedFromExisting : (evaluatedCount? successRate*0.75 + Math.max(0,100-stopRate)*0.25 : 50 + Math.max(-12,Math.min(12,avgOpenReturn*2)));
validationIndex=round(clamp(validationIndex),1);
let grade='Warm-up'; if(evaluatedCount>=10){grade=validationIndex>=80?'ممتاز':validationIndex>=65?'جيد':validationIndex>=50?'متوسط':'يحتاج مراجعة'}
else if(rows.length){grade='مرحلة قياس مبكر'}
const summary={totalSignals:rows.length,evaluated:evaluatedCount,open:openCount,fullSuccess,target1Hit:target1,target2Hit:target2,stopHit:stops,successRatePct:successRate,stopRatePct:stopRate,avgOpenReturnPct:avgOpenReturn,avgMaxGainPct:avgMaxGain,avgDrawdownPct:avgDrawdown,validationIndex,grade,fromExistingMetric:weightedFromExisting!==null};
const recommendations=[];
if(openCount>evaluatedCount)recommendations.push('لا تعتبر التوصيات المفتوحة فاشلة؛ انتظر الوصول إلى هدف أو وقف أو نهاية فترة التقييم.');
if(stops>fullSuccess&&evaluatedCount>=5)recommendations.push('معدل الوقف أعلى من النجاح؛ راجع نقاط الدخول والوقف قبل زيادة عدد التوصيات.');
if(avgDrawdown>avgMaxGain&&rows.length)recommendations.push('متوسط الهبوط أكبر من متوسط الربح؛ شدد فلتر R/R والسيولة.');
if(!evaluatedCount)recommendations.push('المؤشر في مرحلة Warm-up: يحتاج عدة جلسات بعد تشغيل المحرك حتى يقيس نتائج حقيقية.');
writeJson('data/recommendation-validation-panel.json',{ok:true,engine:'v8_9_8_recommendation_validation_panel',generatedAt:new Date().toISOString(),summary,rows:rows.sort((a,b)=>({stop:0,open:1,target1:2,target2:3}[a.status]-{stop:0,open:1,target1:2,target2:3}[b.status])||b.confidence-a.confidence),recommendations,interpretation:'المؤشر يقيس النتائج المحسومة فقط، ويعرض المفتوح منفصلًا حتى لا تتحول التوصيات قيد المتابعة إلى فشل وهمي.'});
console.log('Recommendation validation panel generated', summary);
