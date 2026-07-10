#!/usr/bin/env node
// V11.3 Historical Backfill Recovery Engine
// Attempts automated public/optional licensed historical OHLCV recovery. Never fabricates missing sessions.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function normSym(s){ return String(s||'').trim().toUpperCase().replace(/\.CA$/,''); }
function n(v){ const x=Number(String(v??'').replace(/[,،%\s]/g,'')); return Number.isFinite(x)?x:null; }
function toIsoDate(s){
  s=String(s||'').trim();
  let m=s.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/); if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m=s.match(/(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})/); if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  const d = new Date(s); if(!Number.isNaN(d.getTime()) && d.getFullYear()>2000) return d.toISOString().slice(0,10);
  return null;
}
function validSession(r){
  if(!r || !toIsoDate(r.date)) return false;
  const open=n(r.open), high=n(r.high), low=n(r.low), close=n(r.close), volume=n(r.volume)||0;
  if([open,high,low,close].some(x=>x==null || x<=0)) return false;
  if(high < low) return false;
  if(close > high*1.02 || close < low*0.98) return false;
  if(open > high*1.02 || open < low*0.98) return false;
  if(volume < 0) return false;
  return true;
}
function normalizeSession(r, source){
  const date=toIsoDate(r.date);
  const out={date, open:n(r.open), high:n(r.high), low:n(r.low), close:n(r.close), volume:n(r.volume)||0};
  const tv=n(r.valueTraded ?? r.turnover ?? r.value); if(tv!=null) out.valueTraded=tv, out.turnover=tv;
  out.source = r.source || source;
  out.sourceQuality = r.sourceQuality || 'public_automated_historical_backfill';
  return out;
}
function mergeSessions(existing, incoming){
  const byDate = new Map();
  for(const r of [...(existing||[]), ...(incoming||[])]){
    if(!validSession(r)) continue;
    const nr=normalizeSession(r, r.source||'existing_history');
    const old=byDate.get(nr.date);
    if(!old || String(nr.sourceQuality||'').includes('historical_backfill')) byDate.set(nr.date,nr);
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-120);
}
function extractRowsFromHtml(html, sourceId){
  const rows=[];
  const text=String(html||'');
  // 1) Try table rows.
  const trRe=/<tr[^>]*>([\s\S]*?)<\/tr>/gi; let m;
  while((m=trRe.exec(text))){
    const cells=[...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>x[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
    const dateCell=cells.find(c=>toIsoDate(c));
    if(!dateCell) continue;
    const nums=cells.filter(c=>c!==dateCell).map(n).filter(x=>x!=null);
    if(nums.length>=4){
      // Most public tables use open/high/low/close/volume or close/open/high/low/volume.
      let [open, high, low, close, volume, turnover] = nums;
      if(high < low && nums.length>=4){ // attempt close/open/high/low
        close=nums[0]; open=nums[1]; high=nums[2]; low=nums[3]; volume=nums[4]; turnover=nums[5];
      }
      const r={date:dateCell, open, high, low, close, volume:volume||0, valueTraded:turnover, source:sourceId};
      if(validSession(r)) rows.push(normalizeSession(r,sourceId));
    }
  }
  // 2) Try embedded JSON-like arrays/objects with OHLC keys.
  const objRe=/{[^{}]*(?:"date"|"tradingDate"|"x")\s*:\s*"?[^,"}]+"?[^{}]*(?:"open"|"high"|"low"|"close")[^{}]*}/gi;
  while((m=objRe.exec(text))){
    const raw=m[0];
    function pick(keys){ for(const k of keys){ const re=new RegExp('"?'+k+'"?\\s*:\\s*"?([^,"}]+)"?','i'); const mm=raw.match(re); if(mm) return mm[1]; } return null; }
    const r={date:pick(['date','tradingDate','x']), open:pick(['open','o']), high:pick(['high','h']), low:pick(['low','l']), close:pick(['close','c','last']), volume:pick(['volume','v']), valueTraded:pick(['turnover','valueTraded','value']) , source:sourceId};
    if(validSession(r)) rows.push(normalizeSession(r,sourceId));
  }
  const uniq=new Map(); rows.forEach(r=>uniq.set(r.date,r));
  return [...uniq.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
async function fetchText(url, timeoutMs=22000){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const res=await fetch(url,{signal:ctrl.signal,headers:{'user-agent':'Mozilla/5.0 RAS-EGX-Pro-Historical-Backfill/11.3','accept':'text/html,application/json;q=0.9,*/*;q=0.8'}});
    const txt=await res.text().catch(()=> '');
    return {ok:res.ok, status:res.status, text:txt, url};
  } finally { clearTimeout(t); }
}
function licensedUrl(symbol){
  const base=process.env.EGX_HISTORY_API_URL; if(!base) return null;
  return base.replace('{symbol}', encodeURIComponent(symbol)).replace('{market}','EGX').replace('{limit}','120');
}
async function trySources(sym, registry, resolver){
  const attempts=[]; const found=[];
  const aliases=[sym, resolver?.mubasherSymbol, resolver?.egxSymbol].filter(Boolean).map(normSym);
  const uniqueAliases=[...new Set(aliases)];
  const sources=(registry.sources||[]).filter(s=>s.enabled!==false).sort((a,b)=>(b.priority||0)-(a.priority||0));
  for(const source of sources){
    for(const alias of uniqueAliases){
      let templates=source.templates||[];
      if(source.id==='optional_licensed_eod_provider'){
        const u=licensedUrl(alias); templates=u?[u]:[];
      }
      for(const tpl of templates){
        const url=tpl.replaceAll('{symbol}', encodeURIComponent(alias));
        if(!/^https?:\/\//.test(url)) continue;
        try{
          const r=await fetchText(url);
          if(!r.ok){ attempts.push({source:source.id, url, ok:false, status:r.status, reason:'http_'+r.status}); continue; }
          let rows=[];
          const ct=r.text.trim();
          if(ct.startsWith('{') || ct.startsWith('[')){
            try{
              const j=JSON.parse(ct);
              const arr=Array.isArray(j)?j:(j.rows||j.data||j.history||j.prices||[]);
              if(Array.isArray(arr)) rows=arr.map(x=>normalizeSession({date:x.date||x.tradingDate||x.datetime||x.time, open:x.open||x.o, high:x.high||x.h, low:x.low||x.l, close:x.close||x.c||x.last, volume:x.volume||x.v, valueTraded:x.turnover||x.valueTraded||x.value}, source.id)).filter(validSession);
            }catch(e){}
          }
          if(!rows.length) rows=extractRowsFromHtml(r.text, source.id);
          if(rows.length){ attempts.push({source:source.id, url, ok:true, status:r.status, rows:rows.length, reason:'parsed_ohlcv'}); found.push(...rows); }
          else attempts.push({source:source.id, url, ok:true, status:r.status, rows:0, reason:'parsed_no_ohlcv'});
          if(found.length>=120) return {found:mergeSessions([],found), attempts};
        }catch(e){ attempts.push({source:source.id, url, ok:false, reason:String(e.name||e.message||e).slice(0,120)}); }
      }
    }
  }
  return {found:mergeSessions([],found), attempts};
}
(async()=>{
  const generatedAt=new Date().toISOString();
  const registry=readJson(path.join(DATA,'historical-source-registry.json'), {sources:[]});
  const aliasMap=readJson(path.join(DATA,'symbol-alias-map.json'), {symbols:[]});
  const resolverBySymbol=new Map((aliasMap.symbols||[]).map(x=>[normSym(x.symbol),x]));
  const market=readJson(path.join(DATA,'market.json'),{}).rows||[];
  const symbols=(aliasMap.symbols&&aliasMap.symbols.length?aliasMap.symbols:market.map(r=>({symbol:r.symbol}))).map(r=>normSym(r.symbol)).filter(Boolean);
  const history=readJson(path.join(DATA,'history.json'),{});
  const history50=readJson(path.join(DATA,'history-50.json'),{}).symbols||{};
  const sessionsBySymbol={};
  for(const [s,rows] of Object.entries(history.sessionsBySymbol||{})) sessionsBySymbol[normSym(s)] = mergeSessions(sessionsBySymbol[normSym(s)]||[], rows||[]);
  for(const [s,rows] of Object.entries(history50)) sessionsBySymbol[normSym(s)] = mergeSessions(sessionsBySymbol[normSym(s)]||[], rows||[]);
  const maintenance=String(process.env.HISTORY_MAINTENANCE||'false').toLowerCase()==='true';
  const maxSymbols = Number(process.env.EGX_HISTORY_BACKFILL_MAX_SYMBOLS || (maintenance?224:35));
  const need=symbols.map(sym=>({sym, count:(sessionsBySymbol[sym]||[]).length})).sort((a,b)=>a.count-b.count).slice(0,maxSymbols);
  const rows=[]; let added=0, improved=0, parsedSymbols=0;
  for(const {sym,count} of need){
    const before=sessionsBySymbol[sym]||[];
    if(before.length>=120){ rows.push({symbol:sym, before:before.length, after:before.length, added:0, status:'ALREADY_120'}); continue; }
    const resolver=resolverBySymbol.get(sym)||{};
    const {found, attempts}=await trySources(sym, registry, resolver);
    const merged=mergeSessions(before, found);
    sessionsBySymbol[sym]=merged;
    const delta=Math.max(0, merged.length-before.length);
    added+=delta; if(delta>0) improved++; if(found.length) parsedSymbols++;
    const lastReason = attempts.find(a=>a.reason==='parsed_ohlcv')?.reason || attempts[attempts.length-1]?.reason || 'no_source_attempted';
    rows.push({symbol:sym, before:before.length, discovered:found.length, after:merged.length, added:delta, status:delta>0?'IMPROVED':(before.length>=50?'READY_50':'NOT_IMPROVED'), reason:lastReason, attempts:attempts.slice(0,12)});
  }
  const allSyms=[...new Set([...symbols, ...Object.keys(sessionsBySymbol).map(normSym)])].filter(Boolean);
  const counts=allSyms.map(s=>(sessionsBySymbol[s]||[]).length);
  const summary={
    totalSymbols: allSyms.length,
    scannedThisRun: need.length,
    improvedSymbols: improved,
    parsedSymbols,
    sessionsAdded: added,
    ready20: counts.filter(c=>c>=20).length,
    ready50: counts.filter(c=>c>=50).length,
    ready120: counts.filter(c=>c>=120).length,
    avgSessions: counts.length? Number((counts.reduce((a,b)=>a+b,0)/counts.length).toFixed(2)):0,
    maxSymbolsPerRun:maxSymbols,
    maintenanceMode:maintenance
  };
  const newHistory={...history, version:'v11_3_public_historical_backfill_recovery', generatedAt, requiredSessions:50, preferredSessions:120, importantNote:'Only real public/optional licensed source rows are stored. Missing sessions are not fabricated.', sessionsBySymbol};
  writeJson(path.join(DATA,'history.json'), newHistory);
  writeJson(path.join(DATA,'history-backfill-report.json'), {ok:true, engine:'v11_3_historical_backfill_recovery', generatedAt, summary, rows, note:'If rows are still low, inspect history-source-diagnostics.json. Public pages may expose current data but not historical OHLCV tables.'});
  writeJson(path.join(DATA,'history-backfill-status.json'), {ok:true, engine:'v11_3_historical_backfill_recovery_status', generatedAt, summary});
  console.log('V11.3 historical backfill:', summary);
})().catch(err=>{ console.error(err); process.exitCode=1; });
