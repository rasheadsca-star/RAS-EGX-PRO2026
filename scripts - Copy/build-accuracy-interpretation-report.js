/*
EGX Pro Hub V9.0 — Accuracy Interpretation Report
Normalizes recommendation-accuracy outputs into clear segments:
daily strict, weighted, 3/5/10 sessions, target hit, stop hit, average return.
*/
const fs=require("fs");
const path=require("path");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function pick(obj, keys){for(const k of keys){const n=num(obj&&obj[k]); if(n!=null)return n} return null}
function classifyRow(r){
  const ret=pick(r,["actualReturn","returnPct","performancePct","actualReturnPct"]);
  const hit=String(r.result||r.outcome||r.status||"").toLowerCase();
  const targetHit=hit.includes("target")||hit.includes("hit")||hit.includes("success")||hit.includes("هدف");
  const stopHit=hit.includes("stop")||hit.includes("loss")||hit.includes("وقف");
  return {ret,targetHit,stopHit};
}
function avg(arr){const xs=arr.filter(x=>x!=null&&isFinite(x));return xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(2)):null}
function pct(n,d){return d?Number((n/d*100).toFixed(2)):null}
function main(){
  const latest=read("data/recommendation-accuracy-latest.json",{});
  const hist=read("data/recommendation-accuracy.json",{});
  const d=latest.daily||latest.today||latest.latest||latest||{};
  const l=latest.lifetime||latest.cumulative||hist.lifetime||{};
  const rows=Array.isArray(latest.rows)?latest.rows:(Array.isArray(d.rows)?d.rows:[]);
  const classified=rows.map(r=>({...r,...classifyRow(r)}));
  const targetHits=classified.filter(x=>x.targetHit).length;
  const stopHits=classified.filter(x=>x.stopHit).length;
  const measured=pick(d,["evaluatedRecommendations","measuredRecommendations","measured","total"]) || rows.length || 0;
  function horizon(keys, fallback){
    const src=keys.map(k=>latest[k]||d[k]||hist[k]).find(Boolean)||{};
    return {
      accuracyPct: pick(src,["accuracyPct","strictAccuracyPct","hitRatePct","accuracy"]),
      weightedAccuracyPct: pick(src,["weightedAccuracyPct","weightedAccuracy","accuracyWeighted"]),
      evaluatedRecommendations: pick(src,["evaluatedRecommendations","measuredRecommendations","measured","total"])
    };
  }
  const report={
    ok:true,
    engine:"v9_0_accuracy_interpretation",
    generatedAt:new Date().toISOString(),
    summary:{
      evaluatedRecommendations:measured,
      sampleStatus: measured>=50?"useful":measured>=20?"building":"warmup",
      note:"Read strict daily accuracy separately from weighted accuracy."
    },
    segments:{
      daily:{
        accuracyPct:pick(d,["accuracyPct","strictAccuracyPct","strictAccuracy","directionAccuracy","accuracy"]),
        weightedAccuracyPct:pick(d,["weightedAccuracyPct","weightedAccuracy","accuracyWeighted"]),
        evaluatedRecommendations:measured
      },
      after3Sessions:horizon(["after3Sessions","after3","horizon3"], d),
      after5Sessions:horizon(["after5Sessions","after5","horizon5"], d),
      after10Sessions:horizon(["after10Sessions","after10","horizon10"], d)
    },
    targetHit:{targetHitRatePct:pct(targetHits, rows.length), targetHits, total:rows.length},
    stopHit:{stopHitRatePct:pct(stopHits, rows.length), stopHits, total:rows.length},
    returns:{avgReturnPct:avg(classified.map(x=>x.ret))},
    lifetime:{
      overallWeightedAccuracyPct:pick(l,["overallWeightedAccuracyPct","weightedAccuracyPct","weightedAccuracy","accuracyWeighted","accuracy","lifetimeAccuracy"]),
      measuredRecommendations:pick(l,["measuredRecommendations","measured","total"])
    },
    rows:classified.slice(0,300).map(r=>({
      symbol:r.symbol||r.code,
      recommendation:r.recommendation||r.signal,
      prevPrice:r.prevPrice||r.basePrice||r.oldPrice,
      currentPrice:r.currentPrice||r.price||r.lastPrice,
      actualReturn:r.ret,
      result:r.result||r.outcome||r.status,
      horizon:r.horizon||r.sessionsAfter
    })),
    definitions:{
      strictDaily:"Short-horizon direction correctness. Can be very low during warm-up.",
      weightedAccuracy:"Broader score; may credit partial progress, target approach, and avoiding stops.",
      after3_5_10:"Recommendation performance after enough sessions, more meaningful than same-day.",
      targetHitRate:"Share of measured recommendations reaching target.",
      stopHitRate:"Share of measured recommendations hitting stop; lower is better.",
      avgReturn:"Average actual return after recommendation."
    }
  };
  write("data/accuracy-interpretation-report.json",report);
  console.log("Accuracy interpretation report", {measured, targetHitRate:report.targetHit.targetHitRatePct, stopHitRate:report.stopHit.stopHitRatePct});
}
main();
