/*
EGX Pro Hub V9.8.7 — Data Gateway & Source Resilience
Pipeline:
Source Adapters -> Validation -> Reconciliation -> Last Good Snapshot -> data/*.json
*/
const fs=require("fs");
const path=require("path");
const cp=require("child_process");

const RUN_AT=new Date().toISOString();
const FULL_ROWS=Number(process.env.EGX_GATEWAY_FULL_ROWS||200);
const CONDITIONAL_ROWS=Number(process.env.EGX_GATEWAY_CONDITIONAL_ROWS||80);
const UNIVERSE=Number(process.env.EGX_EXPECTED_UNIVERSE||224);

function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function rowsOf(m){return Array.isArray(m?.rows)?m.rows:[]}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function ageMinutes(t){if(!t)return null;const d=new Date(t);if(isNaN(d))return null;return Number(((Date.now()-d.getTime())/60000).toFixed(1))}
function pct(rows,total=UNIVERSE){return total?Number((rows/total*100).toFixed(1)):0}
function sourceName(fetch, status, health){return fetch.sourceName||status.sourceName||health.sourceName||fetch.mode||status.mode||"unknown"}
function classify(rows, realFetch){
  if(realFetch && rows>=FULL_ROWS)return {accepted:true,status:"accepted_full",level:"ok",fallback:false};
  if(realFetch && rows>=CONDITIONAL_ROWS)return {accepted:true,status:"accepted_partial",level:"warn",fallback:false};
  return {accepted:false,status:"rejected_low_coverage",level:"bad",fallback:true};
}
function buildMarketFromLastGood(lastGood){
  const rows=rowsOf(lastGood);
  return {ok:true,generatedAt:RUN_AT,updatedAt:lastGood.updatedAt||lastGood.generatedAt||RUN_AT,source:"last_good_market_snapshot",sourceUrl:lastGood.sourceUrl||null,rows,note:"Degraded mode: current public fetch failed; using last good snapshot."};
}
function updateAlerts(report, previous){
  const prevFailures=n(previous.consecutiveFailures);
  const failed=report.level==="bad"||report.status==="degraded_last_good"||report.status==="failed_no_snapshot";
  const recovered=!failed && prevFailures>0;
  const consecutiveFailures=failed?prevFailures+1:0;
  const alerts=[];
  if(failed&&consecutiveFailures>=2)alerts.push({level:"critical",type:"source_failure",title:"فشل جلب المصدر الخارجي أكثر من مرة",text:`Consecutive failures: ${consecutiveFailures}`,action:"راجع مصدر مباشر أو EGX_MARKET_JSON_URL"});
  else if(failed)alerts.push({level:"warning",type:"source_degraded",title:"تم استخدام وضع Degraded",text:"المصدر الحالي لم ينجح بما يكفي",action:"راجع بوابة البيانات"});
  if(recovered)alerts.push({level:"info",type:"source_recovered",title:"تم استعادة الجلب الخارجي",text:"المصدر عاد للعمل بعد فشل سابق",action:"راجع تدقيق الأسعار"});
  return {ok:true,generatedAt:RUN_AT,consecutiveFailures,recovered,alerts,lastGatewayStatus:report.status,lastGatewayLevel:report.level};
}
function writeHealth(report, marketRows){
  write("data/source-health.json",{
    ok:report.accepted||report.fallbackUsed,
    generatedAt:RUN_AT,
    lastSuccessAt:report.lastGoodAt||RUN_AT,
    mode:report.mode,
    sourceName:report.selectedSource,
    sourceUrl:report.selectedUrl||null,
    marketRows,
    totalUniverse:UNIVERSE,
    universeCoveragePct:pct(marketRows),
    coveragePct:pct(marketRows),
    fallbackUsed:report.fallbackUsed,
    lastGoodSnapshotUsed:report.lastGoodSnapshotUsed,
    delayed:true
  });
}
function main(){
  const beforeMarket=read("data/market.json",{});
  const beforeLastGood=read("data/last-good-market.json",null);
  const previousAlerts=read("data/source-alerts.json",{});
  const preRows=rowsOf(beforeMarket).length;

  let fetchExit=null, fetchStdout="", fetchStderr="";
  if(fs.existsSync("scripts/fetch-market-data.js")){
    const res=cp.spawnSync(process.execPath,["scripts/fetch-market-data.js"],{encoding:"utf8",timeout:Number(process.env.EGX_FETCH_TIMEOUT_MS||240000),env:process.env});
    fetchExit=res.status;
    fetchStdout=res.stdout||"";
    fetchStderr=res.stderr||"";
  }

  const afterMarket=read("data/market.json",{});
  const fetchReport=read("data/source-fetch-report.json",{});
  const fetchStatus=read("data/fetch-status.json",{});
  const sourceHealth=read("data/source-health.json",{});
  const afterRows=rowsOf(afterMarket).length;
  const realFetch=!!(fetchReport.realFetch||fetchStatus.realFetch);
  const selected=sourceName(fetchReport,fetchStatus,sourceHealth);
  const selectedUrl=fetchReport.selected?.url||fetchStatus.sourceUrl||sourceHealth.sourceUrl||null;
  const classifyResult=classify(afterRows, realFetch);
  let report={
    ok:false,
    engine:"v9_8_7_data_gateway",
    generatedAt:RUN_AT,
    mode:"multi_source_gateway",
    status:classifyResult.status,
    level:classifyResult.level,
    accepted:classifyResult.accepted,
    selectedSource:selected,
    selectedUrl,
    marketRows:afterRows,
    expectedUniverse:UNIVERSE,
    coveragePct:pct(afterRows),
    fallbackUsed:false,
    lastGoodSnapshotUsed:false,
    lastGoodAt:null,
    lastGoodAgeMinutes:null,
    fetchExit,
    message:"",
    sources:fetchReport.attempts||[],
    fetchStdout:fetchStdout.slice(-4000),
    fetchStderr:fetchStderr.slice(-4000)
  };

  if(classifyResult.accepted){
    const snapshot={...afterMarket,ok:true,generatedAt:RUN_AT,updatedAt:RUN_AT,source:selected,sourceUrl:selectedUrl,rows:rowsOf(afterMarket),gatewayAccepted:true};
    write("data/last-good-market.json",snapshot);
    report.ok=true;
    report.message=afterRows>=FULL_ROWS?"Full gateway acceptance":"Conditional gateway acceptance; coverage is enough but not complete.";
    report.lastGoodAt=RUN_AT;
    report.lastGoodAgeMinutes=0;
    writeHealth(report,afterRows);
    write("data/fetch-status.json",{...fetchStatus,ok:true,realFetch:true,generatedAt:RUN_AT,mode:"multi_source_gateway",sourceName:selected,marketRows:afterRows,coveragePct:report.coveragePct,message:report.message});
  }else{
    const lastGood=beforeLastGood&&rowsOf(beforeLastGood).length?beforeLastGood:(preRows>=CONDITIONAL_ROWS?{...beforeMarket,generatedAt:beforeMarket.generatedAt||beforeMarket.updatedAt||RUN_AT,updatedAt:beforeMarket.updatedAt||beforeMarket.generatedAt||RUN_AT,rows:rowsOf(beforeMarket),source:beforeMarket.source||"pre_gateway_market"}:null);
    if(lastGood&&rowsOf(lastGood).length>=CONDITIONAL_ROWS){
      const lgRows=rowsOf(lastGood).length;
      const restored=buildMarketFromLastGood(lastGood);
      write("data/market.json",restored);
      report.ok=true;
      report.status="degraded_last_good";
      report.level="warn";
      report.fallbackUsed=true;
      report.lastGoodSnapshotUsed=true;
      report.marketRows=lgRows;
      report.coveragePct=pct(lgRows);
      report.lastGoodAt=lastGood.updatedAt||lastGood.generatedAt||null;
      report.lastGoodAgeMinutes=ageMinutes(report.lastGoodAt);
      report.message="Current source fetch was rejected; last good snapshot restored.";
      writeHealth(report,lgRows);
      write("data/fetch-status.json",{...fetchStatus,ok:true,realFetch:false,generatedAt:RUN_AT,mode:"degraded_last_good_snapshot",sourceName:"last_good_market_snapshot",marketRows:lgRows,coveragePct:report.coveragePct,message:report.message});
    }else{
      report.ok=false;
      report.status="failed_no_snapshot";
      report.level="bad";
      report.message="Current source fetch failed and no acceptable last-good snapshot exists.";
      write("data/fetch-status.json",{...fetchStatus,ok:false,realFetch:false,generatedAt:RUN_AT,mode:"gateway_failed_no_snapshot",marketRows:afterRows,coveragePct:pct(afterRows),message:report.message});
    }
  }

  write("data/source-gateway-report.json",report);
  write("data/source-alerts.json",updateAlerts(report,previousAlerts));
  console.log("Data Gateway", {status:report.status, rows:report.marketRows, coverage:report.coveragePct, fallback:report.fallbackUsed});
}
main();
