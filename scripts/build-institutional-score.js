/*
EGX Pro Hub V8.0 — Institutional Score Report
Builds a transparent scoring report from recommendations.json.
No trading orders; public/delayed data only.
*/
const fs=require("fs");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(require("path").dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,Number.isFinite(+x)?+x:0))}
function sclass(r){const s=String(r.signal||r.recommendation||"").toLowerCase();if(s.includes("risk")||s.includes("sell")||s.includes("تخفيف"))return"risk";if(s.includes("buy")||s.includes("شراء"))return"buy";if(s.includes("near")||s.includes("قريب"))return"near";return"watch"}
function rr(r){const entry=num(r.entryFrom)||num(r.price), t=num(r.target1), stop=num(r.stopLoss);if(!entry||!t||!stop||entry<=stop)return 0;return (t-entry)/(entry-stop)}
function liquidity(r){const val=num(r.valueTraded)||0;if(val>=100000000)return 100;if(val>=50000000)return 86;if(val>=20000000)return 72;if(val>=10000000)return 60;if(val>=3000000)return 45;return 25}
function rowScore(r){
  const conf=num(r.finalConfidence)||num(r.confidence)||0;
  const technical=clamp(conf*.65+(num(r.snapshotEvidenceScore)||0)*.20+(num(r.priceActionScore)||conf)*.15 + (sclass(r)==="risk"?-18:0));
  const liq=liquidity(r);
  const rrVal=rr(r), rrScore=rrVal>=3?100:rrVal>=2?82:rrVal>=1.5?68:rrVal>=1?52:30;
  const hist=(r.historyComplete50||r.history50UsedInRecommendation)?90:(num(r.historySessionsAvailable)||0)>0?50+(num(r.historySessionsAvailable)||0):32;
  const news=r.newsUsedInScore?clamp(50+(num(r.newsImpactScore)||0)*.5):50;
  const qual=clamp(num(r.dataQualityScore)||100);
  let penalty=sclass(r)==="risk"?24:0;
  if((num(r.finalConfidence)||0)<60)penalty+=8;
  const score=clamp(technical*.32+liq*.18+rrScore*.16+hist*.14+news*.10+qual*.10-penalty*.55);
  const grade=score>=85?"A":score>=72?"B":score>=58?"C":"D";
  return {symbol:r.symbol,score:Math.round(score),grade,technical:Math.round(technical),liquidity:Math.round(liq),rrScore:Math.round(rrScore),history:Math.round(hist),news:Math.round(news),quality:Math.round(qual),penalty:Math.round(penalty),recommendation:r.recommendation||r.signal||"",sector:r.sector||"غير مصنف"};
}
function main(){
  const rec=read("data/recommendations.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  const scores=rows.map(rowScore).sort((a,b)=>b.score-a.score);
  const counts={A:0,B:0,C:0,D:0};scores.forEach(x=>counts[x.grade]=(counts[x.grade]||0)+1);
  write("data/institutional-score-report.json",{
    ok:true,
    engine:"v8_0_institutional_scoring",
    generatedAt:new Date().toISOString(),
    total:scores.length,
    averageScore:Math.round(scores.reduce((s,x)=>s+x.score,0)/Math.max(1,scores.length)),
    counts,
    top:scores.slice(0,30),
    note:"Transparent scoring indicator only. Public/delayed data; not trading orders."
  });
  console.log("Institutional score report generated",{total:scores.length,counts});
}
main();
