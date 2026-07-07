/*
EGX Pro Hub V8.2 — Build Rebalancing Candidates
This report does not know the user's local portfolio. It prepares Grade A/B alternatives from public/delayed recommendations.
*/
const fs=require("fs");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(require("path").dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return 0;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:0}
function sclass(r){const s=String(r.signal||r.recommendation||"").toLowerCase();if(s.includes("risk")||s.includes("sell")||s.includes("تخفيف"))return"risk";if(s.includes("buy")||s.includes("شراء"))return"buy";if(s.includes("near")||s.includes("قريب"))return"near";return"watch"}
function grade(r){const c=num(r.finalConfidence||r.confidence); if(c>=85)return"A"; if(c>=72)return"B"; if(c>=58)return"C"; return"D"}
function main(){
  const rec=read("data/recommendations.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  const candidates=rows.filter(r=>sclass(r)!=="risk" && ["A","B"].includes(grade(r))).map(r=>({
    symbol:r.symbol,
    name:r.name_ar||r.name_en||r.name||"",
    sector:r.sector||"غير مصنف",
    grade:grade(r),
    confidence:num(r.finalConfidence||r.confidence),
    price:num(r.price),
    entryFrom:num(r.entryFrom),
    entryTo:num(r.entryTo),
    target1:num(r.target1),
    stopLoss:num(r.stopLoss),
    valueTraded:num(r.valueTraded),
    recommendation:r.recommendation||r.signal||""
  })).sort((a,b)=>b.confidence-a.confidence).slice(0,40);
  write("data/rebalancing-candidates.json",{
    ok:true,
    engine:"v8_2_rebalancing_candidates",
    generatedAt:new Date().toISOString(),
    total:candidates.length,
    candidates,
    note:"Portfolio-specific rebalancing is calculated locally in the browser after importing the user's portfolio."
  });
  console.log("Rebalancing candidates generated", candidates.length);
}
main();
