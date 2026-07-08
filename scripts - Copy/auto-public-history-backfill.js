/*
EGX Pro Hub V7.3 — Public Historical Discovery

Opportunistically searches public pages for embedded historical OHLCV rows.
It never fabricates history. If no public historical rows are exposed, it writes a transparent status file.

Primary historical recovery should still come from:
1) git snapshot recovery
2) automatic future rolling sessions
3) optional uploaded backfill
*/

const fs = require("fs");
const path = require("path");

const MAX_SYMBOLS = Number(process.env.PUBLIC_HISTORY_BACKFILL_LIMIT || 30);
const MAX_SESSIONS = 75;
const TIMEOUT_MS = 15000;

function readJson(f, fb){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return fb}}
function writeJson(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function num(v){if(v==null||v==="")return null;if(typeof v==="number")return isFinite(v)?v:null;let n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function symbolOf(r){return String(r.symbol||r.ticker||r.code||r.Symbol||"").trim().toUpperCase()}
function dateOnly(v){if(!v)return null;if(typeof v==="number"){let d=new Date(v>100000000000?v:v*1000);return d.toISOString().slice(0,10)}let s=String(v);let m=s.match(/(\d{4}-\d{2}-\d{2})/);if(m)return m[1];let d=new Date(s);return isNaN(d)?null:d.toISOString().slice(0,10)}
function extractRows(obj){if(!obj)return[];if(Array.isArray(obj.all))return obj.all;if(Array.isArray(obj.rows))return obj.rows;if(Array.isArray(obj.data))return obj.data;if(Array.isArray(obj))return obj;return[]}
function universe(){
  const rec=readJson("data/recommendations.json",{}), cache=readJson("data/full-market-cache.json",{}), market=readJson("data/market.json",{});
  let rows=extractRows(rec); if(!rows.length)rows=extractRows(cache); if(!rows.length)rows=extractRows(market);
  return [...new Set(rows.map(symbolOf).filter(Boolean))];
}
function existingHistory(){
  const h=readJson("data/history.json",{}), out={};
  const add=(s,a)=>{s=String(s||"").toUpperCase();if(!s||!Array.isArray(a))return;out[s]=out[s]||[];for(const p of a){let c=num(p.close||p.price||p.value),d=dateOnly(p.date||p.sessionDate);if(d&&c)out[s].push({...p,symbol:s,date:d,close:c,open:num(p.open)||c,high:num(p.high)||c,low:num(p.low)||c,volume:num(p.volume),valueTraded:num(p.valueTraded)})}};
  if(h.sessionsBySymbol)for(const[s,a]of Object.entries(h.sessionsBySymbol))add(s,a);
  if(h.prices)for(const[s,a]of Object.entries(h.prices))add(s,a);
  if(h.history)for(const[s,a]of Object.entries(h.history))add(s,a);
  for(const s of Object.keys(out))out[s]=dedupe(out[s]).slice(-MAX_SESSIONS);
  return out;
}
function dedupe(a){let m=new Map();for(const p of a){if(p&&p.date&&p.close)m.set(p.date,p)}return[...m.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)))}
async function fetchText(url){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),TIMEOUT_MS);
  try{
    const r=await fetch(url,{signal:ctrl.signal,headers:{"user-agent":"EGX-Pro-Hub/7.3 public-history-discovery","accept":"text/html,application/json,*/*"}});
    if(!r.ok)return null;
    return await r.text();
  }catch{return null}finally{clearTimeout(t)}
}
function parseEmbeddedHistory(text,symbol,sourceUrl){
  const out=[];
  if(!text)return out;

  // JSON object rows: {"date":"2026-06-01","open":...,"high":...,"low":...,"close":...,"volume":...}
  const objRe=/{[^{}]{0,600}(?:"date"|"sessionDate"|"time"|"timestamp")[^{}]{0,600}(?:"close"|"price"|"value")[^{}]{0,600}}/g;
  const matches=text.match(objRe)||[];
  for(const raw of matches.slice(0,2000)){
    try{
      const o=JSON.parse(raw);
      const date=dateOnly(o.date||o.sessionDate||o.time||o.timestamp);
      const close=num(o.close||o.price||o.value||o.last);
      if(!date||!close)continue;
      const open=num(o.open)||close, high=num(o.high)||Math.max(open,close), low=num(o.low)||Math.min(open,close);
      out.push({symbol,date,open,high,low,close,volume:num(o.volume||o.vol),valueTraded:num(o.valueTraded||o.turnover),source:"public_historical_discovery",sourceUrl,sourceQuality:"embedded_json_ohlcv"});
    }catch{}
  }

  // Numeric arrays: [timestamp,open,high,low,close,volume]
  const arrRe=/\[(\d{10,13}|"\d{4}-\d{2}-\d{2}")[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\]/g;
  let m;
  while((m=arrRe.exec(text)) && out.length<2000){
    const date=dateOnly(String(m[1]).replace(/"/g,""));
    const open=num(m[2]), high=num(m[3]), low=num(m[4]), close=num(m[5]), volume=num(m[6]);
    if(date&&close) out.push({symbol,date,open:open||close,high:high||close,low:low||close,close,volume,source:"public_historical_discovery",sourceUrl,sourceQuality:"embedded_array_ohlcv"});
  }

  // Keep only credible daily rows. Current page single snapshot is not enough for "past".
  return dedupe(out).filter(p=>p.date&&p.close).slice(-MAX_SESSIONS);
}
function candidateUrls(symbol){
  return [
    `https://english.mubasher.info/markets/EGX/stocks/${symbol}/`,
    `https://www.mubasher.info/markets/EGX/stocks/${symbol}/`,
    `https://english.mubasher.info/markets/EGX/stocks/${symbol}/historical-data`,
    `https://www.mubasher.info/markets/EGX/stocks/${symbol}/historical-data`,
    `https://english.mubasher.info/markets/EGX/stocks/${symbol}/historical-prices`,
    `https://www.mubasher.info/markets/EGX/stocks/${symbol}/historical-prices`
  ];
}
async function main(){
  const hist=existingHistory();
  const symbols=universe().filter(s=>(hist[s]?.length||0)<50).slice(0,MAX_SYMBOLS);
  const status={ok:true,engine:"v7_3_public_historical_discovery",generatedAt:new Date().toISOString(),symbolsAttempted:symbols.length,importedRows:0,symbolsWithImportedRows:0,attempts:[],message:""};

  for(const symbol of symbols){
    let imported=[];
    for(const url of candidateUrls(symbol)){
      const text=await fetchText(url);
      status.attempts.push({symbol,url,ok:!!text,bytes:text?text.length:0});
      if(text){
        const rows=parseEmbeddedHistory(text,symbol,url);
        if(rows.length>imported.length) imported=rows;
      }
      await sleep(250);
    }
    if(imported.length>=2){
      hist[symbol]=hist[symbol]||[];
      hist[symbol].push(...imported);
      hist[symbol]=dedupe(hist[symbol]).slice(-MAX_SESSIONS);
      status.importedRows+=imported.length;
      status.symbolsWithImportedRows++;
    }
  }

  if(status.importedRows>0){
    writeJson("data/history.json",{version:"v7_3_public_historical_discovery",generatedAt:new Date().toISOString(),requiredSessions:50,maxStoredSessions:MAX_SESSIONS,sessionsBySymbol:hist});
    status.message=`Imported ${status.importedRows} public historical rows for ${status.symbolsWithImportedRows} symbols.`;
  }else{
    status.message="No public historical OHLCV rows were exposed in the tested public pages/endpoints. Future rolling collection and git recovery remain active.";
  }
  writeJson("data/public-history-discovery-status.json",status);
  console.log("Public historical discovery complete:",{symbolsAttempted:status.symbolsAttempted,importedRows:status.importedRows});
}
main();
