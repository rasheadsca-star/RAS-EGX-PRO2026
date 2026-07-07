/*
EGX Pro Hub V8.6 — Historical Integrity Report
Reads available history-related JSON files and reports 50-session completeness per symbol.
*/
const fs=require("fs");
const path=require("path");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function countHistoryFor(sym, sources){
  const S=String(sym||"").toUpperCase();
  let best=0;
  for(const src of sources){
    if(!src)continue;
    let v=null;
    if(Array.isArray(src)){
      v=src.find(x=>String(x.symbol||x.code||"").toUpperCase()===S);
    }else{
      v=src[S]||src[sym]||src[String(sym).toLowerCase()];
    }
    if(!v)continue;
    const arr=v.data||v.history||v.prices||v.closes||v.sessions||null;
    const n=Array.isArray(arr)?arr.length:Number(v.count||v.sessionsCount||v.availableSessions||v.actualSessions||v.days||v.rows||0);
    if(Number.isFinite(n))best=Math.max(best,n);
  }
  return Math.round(best);
}
function main(){
  const rec=read("data/recommendations.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  const candidateFiles=[
    "data/history-50.json",
    "data/history50.json",
    "data/rolling-history-50.json",
    "data/history.json",
    "data/market-history.json",
    "data/full-market-history.json"
  ];
  const sources=candidateFiles.map(f=>read(f,null)).map(x=>x&&(x.symbols||x.data||x.history||x));
  const symbols=rows.map(r=>{
    const sessions=countHistoryFor(r.symbol,sources) || Number(r.historySessionsAvailable||r.historyActualSessions||r.sessionsAvailable||r.historySessions||0) || 0;
    return {
      symbol:r.symbol,
      name:r.name_ar||r.name_en||r.name||"",
      sessions,
      target:50,
      complete:sessions>=50,
      state:sessions>=50?"complete":sessions>0?"partial":"missing"
    };
  });
  const full=symbols.filter(x=>x.complete).length;
  const partial=symbols.filter(x=>x.sessions>0&&x.sessions<50).length;
  const missing=symbols.filter(x=>x.sessions===0).length;
  const avg=symbols.length?symbols.reduce((a,b)=>a+b.sessions,0)/symbols.length:0;
  write("data/history-integrity-report.json",{
    ok:true,
    engine:"v8_6_history_integrity",
    generatedAt:new Date().toISOString(),
    totalSymbols:symbols.length,
    full50Symbols:full,
    partialSymbols:partial,
    missingSymbols:missing,
    avgSessions:Number(avg.toFixed(2)),
    symbols,
    note:"Technical 50-session indicators should be treated as incomplete unless sessions >= 50 for the symbol."
  });
  console.log("History integrity report", {total:symbols.length, full, partial, missing, avg:avg.toFixed(2)});
}
main();
