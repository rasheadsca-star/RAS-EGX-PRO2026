/*
EGX Pro Hub V9.4 — History Backfill Plan
Builds an actionable plan to reach 50 sessions per symbol.
Does not invent historical data; only reports what is missing and how to recover it.
*/
const fs=require("fs");
const path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){const n=Number(v);return isFinite(n)?n:0}
function main(){
  const history=read("data/history.json",{}), rec=read("data/recommendations.json",{}), integrity=read("data/history-integrity-report.json",{}), status=read("data/session-memory-status.json",{});
  const by=history.sessionsBySymbol||history.symbols||history.history||{};
  const recRows=Array.isArray(rec.all)?rec.all:[];
  const names={}; recRows.forEach(r=>{if(r.symbol)names[String(r.symbol).toUpperCase()]=r.name_ar||r.name_en||r.name||""});
  const symbols=[...new Set([...Object.keys(names),...Object.keys(by)])].sort();
  const rows=symbols.map(s=>{
    const arr=Array.isArray(by[s])?by[s]:[];
    const sess=arr.length;
    const miss=Math.max(0,50-sess);
    const last=arr[arr.length-1]||{};
    return {
      symbol:s,
      name:names[s]||"",
      sessionsAvailable:sess,
      missingSessions:miss,
      lastDate:last.date||null,
      lastClose:last.close||last.price||null,
      priority:miss===0?"complete":miss>35?"urgent":miss>15?"medium":"low",
      proposedAction:miss===0?"none":miss>35?"import_backfill_or_git_recovery":"automatic_future_accumulation"
    };
  }).sort((a,b)=>b.missingSessions-a.missingSessions||a.symbol.localeCompare(b.symbol));
  const total=rows.length, full=rows.filter(x=>x.sessionsAvailable>=50).length, partial=rows.filter(x=>x.sessionsAvailable>0&&x.sessionsAvailable<50).length, missing=rows.filter(x=>x.sessionsAvailable===0).length, avg=total?rows.reduce((a,b)=>a+b.sessionsAvailable,0)/total:0;
  write("data/history-backfill-plan.json",{
    ok:true,
    engine:"v9_4_history_backfill_plan",
    generatedAt:new Date().toISOString(),
    totalSymbols:total,
    full50Symbols:full,
    partialSymbols:partial,
    missingSymbols:missing,
    avgSessions:Number(avg.toFixed(2)),
    totalMissingSessions:rows.reduce((a,b)=>a+b.missingSessions,0),
    currentSessionCaptured:!!status.currentSessionCaptured,
    sessionDate:status.sessionDate||history.sessionDate||null,
    rows,
    actions:[
      "Daily workflow accumulates future sessions automatically.",
      "Run workflow_dispatch with history_maintenance=true for Git recovery/import/public discovery.",
      "Use uploaded trusted CSV/JSON backfill only; do not invent historical prices."
    ],
    note:"Backfill plan is diagnostic/actionable; actual historical data is only added by trusted sources or future sessions."
  });
  console.log("History backfill plan", {total, full, partial, missing, avg:avg.toFixed(2)});
}
main();
