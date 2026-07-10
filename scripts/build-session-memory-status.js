/*
EGX Pro Hub V9.2 — Session Memory Status
Verifies that future sessions are being appended into data/history.json by the rolling history engine.
*/
const fs=require("fs");
const path=require("path");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function todayEgypt(){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=t=>parts.find(p=>p.type===t)?.value;return `${g("year")}-${g("month")}-${g("day")}`}
function main(){
  const history=read("data/history.json",{}), hreport=read("data/history-report.json",{}), health=read("data/history-health.json",{}), rec=read("data/recommendations.json",{});
  const by=history.sessionsBySymbol||history.symbols||history.history||{};
  const date=history.sessionDate||hreport.sessionDate||todayEgypt();
  const rows=Object.entries(by).map(([symbol,arr])=>{
    arr=Array.isArray(arr)?arr:[];
    const last=arr[arr.length-1]||{};
    return {symbol,sessionsAvailable:arr.length,lastDate:last.date||null,lastClose:last.close||last.price||null,complete50:arr.length>=50};
  }).sort((a,b)=>b.sessionsAvailable-a.sessionsAvailable||a.symbol.localeCompare(b.symbol));
  const todayCaptured=rows.some(r=>String(r.lastDate||"").slice(0,10)===date);
  const avg=rows.length?rows.reduce((a,b)=>a+b.sessionsAvailable,0)/rows.length:0;
  write("data/session-memory-status.json",{
    ok:true,
    engine:"v9_2_session_memory_status",
    generatedAt:new Date().toISOString(),
    sessionDate:date,
    todayCaptured,
    currentSessionCaptured:todayCaptured,
    rowsReadFromRecommendations:Array.isArray(rec.all)?rec.all.length:0,
    symbolsTracked:rows.length,
    symbolsWithComplete50:rows.filter(r=>r.complete50).length,
    averageSessionsPerSymbol:Number(avg.toFixed(2)),
    rows,
    note:"data/history.json is appended by build-history-50-engine.js. This report proves whether the current session was captured."
  });
  console.log("Session memory status", {date,todayCaptured,symbols:rows.length,complete50:rows.filter(r=>r.complete50).length,avg:avg.toFixed(2)});
}
main();
