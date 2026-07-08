/*
EGX Pro Hub V9.8.1 — Workflow & Source Fetcher Verification
Verifies whether workflow can actually fetch/update public market data or only process existing files.
*/
const fs=require("fs");
const path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function exists(f){try{return fs.existsSync(f)}catch{return false}}
function num(v){const n=Number(v);return isFinite(n)?n:0}
function ts(obj){return obj?.generatedAt||obj?.updatedAt||obj?.lastSuccessAt||obj?.sessionDate||null}
function ageMinutes(t){if(!t)return null;const d=new Date(t);if(isNaN(d))return null;return Number(((Date.now()-d.getTime())/60000).toFixed(1))}
function check(id,name,state,value,message,action){return {id,name,state,value:String(value??""),message,action}}
function main(){
  const workflowPath=".github/workflows/update-market-data.yml";
  const workflow=exists(workflowPath)?fs.readFileSync(workflowPath,"utf8"):"";
  const fetchScriptExists=exists("scripts/fetch-market-data.js");
  const fetchStatus=read("data/fetch-status.json",{});
  const sourceFetchReport=read("data/source-fetch-report.json",{});
  const gateway=read("data/source-gateway-report.json",{});
  const source=read("data/source-health.json",{});
  const market=read("data/market.json",{});
  const cache=read("data/full-market-cache.json",{});
  const rec=read("data/recommendations.json",{});
  const price=read("data/price-reconciliation-report.json",{summary:{}});
  const history=read("data/history.json",{});
  const checks=[];
  checks.push(check("fetch_script","fetch-market-data.js",fetchScriptExists?"ok":"bad",fetchScriptExists?"exists":"missing",fetchScriptExists?"سكريبت الجلب موجود":"سكريبت الجلب غير موجود وسيوقف Workflow","ارفع scripts/fetch-market-data.js"));
  checks.push(check("workflow_reference","Workflow fetch step",workflow.includes("node scripts/fetch-market-data.js")?"ok":"bad",workflow.includes("node scripts/fetch-market-data.js")?"referenced":"missing","هل الـ Workflow يشغّل سكريبت الجلب؟",workflow.includes("node scripts/fetch-market-data.js")?"متابعة":"عدّل workflow"));
  checks.push(check("external_fetch","External public source",(fetchStatus.realFetch||sourceFetchReport.realFetch||gateway.accepted)?"ok":"warn",fetchStatus.mode||"unknown",(fetchStatus.realFetch||sourceFetchReport.realFetch||gateway.accepted)?"تم الجلب من مصدر خارجي/عام مضبوط":"لا يوجد دليل على جلب خارجي؛ قد تكون البيانات من الملفات الحالية فقط",fetchStatus.realFetch?"متابعة":"اضبط EGX_MARKET_JSON_URL أو أضف fetcher حقيقي"));
  const marketRows=Array.isArray(market.rows)?market.rows.length:0, cacheRows=Array.isArray(cache.rows)?cache.rows.length:0, recommendationRows=Array.isArray(rec.all)?rec.all.length:0;
  checks.push(check("market_rows","market.json rows",marketRows>0?"ok":"bad",marketRows,marketRows>0?"market.json يحتوي صفوفًا":"market.json فارغ أو غير موجود",marketRows>0?"متابعة":"راجع الجلب"));
  checks.push(check("cache_rows","full-market-cache rows",cacheRows>0?"ok":"warn",cacheRows,cacheRows>0?"الكاش موجود":"الكاش غير متاح في هذا الفحص",cacheRows>0?"متابعة":"لا ترفعه يدويًا إلا عند reset"));
  checks.push(check("recommendations_rows","recommendations rows",recommendationRows>0?"ok":"bad",recommendationRows,recommendationRows>0?"التوصيات موجودة":"لا توجد توصيات مبنية",recommendationRows>0?"متابعة":"راجع builder"));
  const sourceAge=ageMinutes(ts(source)||ts(market)||ts(rec));
  checks.push(check("source_age","Source age",sourceAge==null?"warn":sourceAge>240?"bad":sourceAge>120?"warn":"ok",sourceAge==null?"unknown":`${sourceAge} min`,sourceAge==null?"لا يوجد timestamp واضح":sourceAge>240?"المصدر قديم جدًا":sourceAge>120?"المصدر يحتاج متابعة":"المصدر حديث نسبيًا",sourceAge>120?"شغّل Workflow أو راجع fetcher":"متابعة"));
  const conflicts=num(price.summary?.conflict), stale=num(price.summary?.stale);
  checks.push(check("price_reconciliation","Price reconciliation",conflicts>0?"bad":stale>0?"warn":"ok",`${conflicts} conflict / ${stale} stale`,conflicts>0?"يوجد تعارض أسعار بعد الجلب":stale>0?"بعض الأسعار قديمة بعد الجلب":"الأسعار متسقة",conflicts>0?"افتح تدقيق الأسعار":"متابعة"));
  const histSymbols=history.sessionsBySymbol||history.symbols||history.history||{};
  checks.push(check("history_memory","history.json memory",Object.keys(histSymbols).length>0?"ok":"warn",Object.keys(histSymbols).length,Object.keys(histSymbols).length>0?"ذاكرة الجلسات موجودة":"لا توجد ذاكرة جلسات كافية","راجع ذاكرة الجلسات"));
  const bad=checks.filter(x=>x.state==="bad").length, warn=checks.filter(x=>x.state==="warn").length, ok=checks.filter(x=>x.state==="ok").length;
  const score=Math.max(0,100-bad*22-warn*9);
  checks.push(check("public_adapter","Public source adapter",sourceFetchReport.realFetch?"ok":"warn",gateway.selectedSource||sourceFetchReport.sourceName||sourceFetchReport.mode||"not accepted",gateway.accepted?`تم قبول بوابة البيانات بعدد ${gateway.marketRows||0} صف`:sourceFetchReport.realFetch?`تم قبول مصدر عام بعدد ${sourceFetchReport.marketRows||0} صف`:"لم يتم قبول مصدر عام كافٍ",sourceFetchReport.realFetch?"متابعة":"راجع source-fetch-report أو هيكل صفحات المصدر"));
  const report={ok:bad===0,engine:"v9_8_7_workflow_source_verification",generatedAt:new Date().toISOString(),score,state:score>=85?"ok":score>=60?"warn":"bad",realFetch:!!(fetchStatus.realFetch||sourceFetchReport.realFetch||gateway.accepted),fetchMode:fetchStatus.mode||"unknown",message:fetchStatus.message||"",marketRows,cacheRows,recommendationRows,sourceAgeMinutes:sourceAge,summary:{ok,warn,bad,total:checks.length},checks,note:"This report verifies data pipeline mechanics. It does not certify tick-by-tick live prices."};
  write("data/workflow-source-verification.json",report);
  console.log("Workflow source verification", {score, ok, warn, bad, realFetch:report.realFetch, mode:report.fetchMode});
}
main();
