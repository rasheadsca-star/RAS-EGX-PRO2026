/*
EGX Pro Hub V9.2 — Price Freshness Report
Detects stale/internal price discrepancies between recommendations, market, and full cache.
It cannot verify true live exchange price unless the source has updated it.
*/
const fs=require("fs");
const path=require("path");
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function sym(r){return String(r.symbol||r.ticker||r.code||r.Symbol||"").trim().toUpperCase()}
function mapRows(rows){const m={};(rows||[]).forEach(r=>{const s=sym(r);if(s)m[s]=r});return m}
function price(r){return num(r&& (r.price??r.last??r.close??r.lastPrice??r.Last))}
function pct(a,b){return a&&b?((a-b)/b*100):0}
function main(){
  const rec=read("data/recommendations.json",{}), cache=read("data/full-market-cache.json",{}), market=read("data/market.json",{}), source=read("data/source-health.json",{});
  const recRows=Array.isArray(rec.all)?rec.all:[], cacheRows=Array.isArray(cache.rows)?cache.rows:[], marketRows=Array.isArray(market.rows)?market.rows:(Array.isArray(market.data)?market.data:[]);
  const cm=mapRows(cacheRows), mm=mapRows(marketRows);
  const discrepancies=[];
  recRows.forEach(r=>{
    const s=sym(r), rp=price(r), cp=price(cm[s]), mp=price(mm[s]);
    const candidates=[["cache",cp],["market",mp]].filter(x=>x[1]!=null);
    candidates.forEach(([src,p])=>{
      if(rp&&p&&Math.abs(pct(rp,p))>=0.75){
        discrepancies.push({symbol:s,issue:"recommendation price differs from "+src,recommendationPrice:rp,sourcePrice:p,diffPct:Number(pct(rp,p).toFixed(2)),detail:`recommendations=${rp}, ${src}=${p}`});
      }
    });
  });
  const last=source.generatedAt||source.lastSuccessAt||market.updatedAt||rec.generatedAt||null;
  const minutes=last?((Date.now()-new Date(last).getTime())/60000):null;
  write("data/price-freshness-report.json",{
    ok:true,
    engine:"v9_2_price_freshness",
    generatedAt:new Date().toISOString(),
    lastSourceUpdate:last,
    sourceAgeMinutes:minutes==null?null:Number(minutes.toFixed(1)),
    staleRows:discrepancies.sort((a,b)=>Math.abs(b.diffPct)-Math.abs(a.diffPct)),
    discrepancies:discrepancies.sort((a,b)=>Math.abs(b.diffPct)-Math.abs(a.diffPct)),
    note:"If all internal sources show the same stale price, the report cannot know the true live price. Run workflow or improve the fetch source."
  });
  console.log("Price freshness report", {ageMinutes:minutes&&minutes.toFixed(1), discrepancies:discrepancies.length});
}
main();
