/*
EGX Pro Hub V8.3 — Build Watchlist Pipeline Candidates
Generates market-wide candidates for the local browser pipeline.
*/
const fs=require("fs");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(require("path").dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:0}
function sclass(r){const s=String(r.signal||r.recommendation||"").toLowerCase();if(s.includes("risk")||s.includes("sell")||s.includes("تخفيف"))return"risk";if(s.includes("buy")||s.includes("شراء"))return"buy";if(s.includes("near")||s.includes("قريب"))return"near";return"watch"}
function readiness(r){let score=(num(r.finalConfidence)||0)*0.7;const p=num(r.price),e1=num(r.entryFrom),e2=num(r.entryTo);if(e1&&e2&&p>=e1*.99&&p<=e2*1.01)score+=20;else if(e1&&e2&&p>=e1*.97&&p<=e2*1.04)score+=10;if(num(r.valueTraded)>=20000000)score+=8;if(sclass(r)==="risk")score-=35;return Math.max(0,Math.min(100,Math.round(score)))}
function main(){
  const rec=read("data/recommendations.json",{}), rows=Array.isArray(rec.all)?rec.all:[];
  const candidates=rows.filter(r=>sclass(r)!=="risk").map(r=>({symbol:r.symbol,name:r.name_ar||r.name_en||r.name||"",sector:r.sector||"غير مصنف",readiness:readiness(r),confidence:num(r.finalConfidence||r.confidence),price:num(r.price),entryFrom:num(r.entryFrom),entryTo:num(r.entryTo),target1:num(r.target1),stopLoss:num(r.stopLoss),recommendation:r.recommendation||r.signal||""})).filter(x=>x.readiness>=55).sort((a,b)=>b.readiness-a.readiness).slice(0,60);
  write("data/watchlist-pipeline-candidates.json",{ok:true,engine:"v8_3_watchlist_pipeline_candidates",generatedAt:new Date().toISOString(),total:candidates.length,candidates,note:"Pipeline stages are local in the browser; this file provides candidate ideas only."});
  console.log("Watchlist pipeline candidates generated", candidates.length);
}
main();
