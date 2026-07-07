/*
EGX Pro Hub V7.15 — Build App Health Status
Creates a transparent health file from existing generated JSON.
No market data reset and no trading action.
*/
const fs=require("fs");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(require("path").dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function ageMin(ts){const t=ts?new Date(ts).getTime():NaN;return isFinite(t)?Math.max(0,Math.round((Date.now()-t)/60000)):null}
function main(){
  const src=read("data/source-health.json",{}), rec=read("data/recommendations.json",{}), hh=read("data/history-health.json",{}),
        nc=read("data/trusted-news-collector-status.json",{}), ni=read("data/news-intelligence-status.json",{}),
        acc=read("data/recommendation-accuracy-latest.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  const last=src.generatedAt||src.lastSuccessAt||null;
  const warnings=[], failures=[];
  const marketRows=src.cacheRows||rows.length||0;
  if(!marketRows) failures.push("No market/recommendation rows available.");
  const a=ageMin(last);
  if(a!=null && a>24*60) warnings.push("Market data is older than 24 hours.");
  if((hh.symbolsWithComplete50||0)===0) warnings.push("No symbol has complete 50-session history yet.");
  if((nc.itemsSaved||nc.externalNewsRows||0)===0) warnings.push("No trusted external news collected.");
  const measured=((acc.daily||{}).measuredRecommendations)||0;
  if(!measured) warnings.push("Recommendation accuracy is in warm-up or not measured yet.");
  const scoreBase=100-(warnings.length*8)-(failures.length*35);
  write("data/app-health-status.json",{
    ok:failures.length===0,
    engine:"v7_15_data_trust_health_center",
    generatedAt:new Date().toISOString(),
    score:Math.max(0,Math.min(100,scoreBase)),
    warnings,
    failures,
    metrics:{
      marketRows,
      totalUniverse:src.totalUniverse||224,
      marketDataAgeMinutes:a,
      complete50History:hh.symbolsWithComplete50||0,
      partialHistory:hh.symbolsWithAnyHistory||0,
      trustedExternalNews:nc.itemsSaved||nc.externalNewsRows||0,
      newsSignals:ni.totalItems||0,
      measuredRecommendations:measured
    },
    note:"Health score is a transparency indicator, not investment advice."
  });
  console.log("App health status generated", {warnings:warnings.length, failures:failures.length});
}
main();
