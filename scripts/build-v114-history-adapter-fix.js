#!/usr/bin/env node
// V11.4 Historical Source Adapter Fix
// Goal: when parsedSymbols=0, diagnose exactly why, save safe debug samples, and use stronger public adapters.
// Policy: no fake history, no manual CSV, no broker-screen data. Rows are stored only after OHLCV validation.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DEBUG = path.join(DATA, 'debug', 'history-fetch-samples');
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function normSym(s){ return String(s||'').trim().toUpperCase().replace(/\.CA$/,''); }
function cleanText(s){ return String(s??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#x2F;/g,'/').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim(); }
function arabicDigitsToLatin(s){ return String(s??'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }
function num(v){
  if(v==null || v==='') return null;
  let s=arabicDigitsToLatin(String(v)).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s=s.replace(/[()]/g,'').replace(/[,%،\s]/g,'').replace(/−/g,'-');
  // Keep only first numeric-looking token when cells include labels.
  const m=s.match(/-?\d+(?:\.\d+)?/);
  if(!m) return null;
  const x=Number(m[0]);
  if(!Number.isFinite(x)) return null;
  return neg ? -Math.abs(x) : x;
}
function toIsoDate(s){
  s=arabicDigitsToLatin(String(s||'').trim());
  let m=s.match(/(20\d{2})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/); if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  m=s.match(/(\d{1,2})[-\/\.](\d{1,2})[-\/\.](20\d{2})/); if(m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  m=s.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})/i);
  if(m){ const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}; return `${m[3]}-${String(months[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`; }
  m=s.match(/(20\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/i);
  if(m){ const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12}; return `${m[1]}-${String(months[m[2].slice(0,3).toLowerCase()]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`; }
  const d = new Date(s); if(!Number.isNaN(d.getTime()) && d.getFullYear()>2000 && d.getFullYear()<2100) return d.toISOString().slice(0,10);
  return null;
}
function validSession(r){
  const date=toIsoDate(r?.date); if(!date) return false;
  const open=num(r.open), high=num(r.high), low=num(r.low), close=num(r.close), volume=num(r.volume) ?? 0;
  if([open,high,low,close].some(x=>x==null || x<=0)) return false;
  if(high < low) return false;
  if(close > high*1.015 || close < low*0.985) return false;
  if(open > high*1.015 || open < low*0.985) return false;
  if(volume < 0) return false;
  return true;
}
function normalizeSession(r, source){
  const out={date:toIsoDate(r.date), open:num(r.open), high:num(r.high), low:num(r.low), close:num(r.close), volume:num(r.volume)??0};
  const tv=num(r.valueTraded ?? r.turnover ?? r.value ?? r.tradedValue); if(tv!=null) out.valueTraded=tv, out.turnover=tv;
  out.source=r.source||source;
  out.sourceQuality=r.sourceQuality||'public_automated_historical_adapter_v11_4';
  return out;
}
function mergeSessions(existing, incoming){
  const byDate=new Map();
  for(const r of [...(existing||[]),...(incoming||[])]){
    if(!validSession(r)) continue;
    const nr=normalizeSession(r, r.source||'existing_history');
    const old=byDate.get(nr.date);
    if(!old || String(nr.sourceQuality||'').includes('adapter_v11_4') || String(nr.sourceQuality||'').includes('historical_backfill')) byDate.set(nr.date,nr);
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-120);
}
function keyFromHeader(h){
  const x=cleanText(h).toLowerCase();
  if(/date|time|تاريخ|الوقت|session|trading/.test(x)) return 'date';
  if(/open|opening|افتتاح|الأفتتاح|سعر الفتح/.test(x)) return 'open';
  if(/high|highest|اعلى|أعلى|الاعلى|الأعلى/.test(x)) return 'high';
  if(/low|lowest|ادنى|أدنى|الادنى|الأدنى/.test(x)) return 'low';
  if(/close|closing|last|اخر|آخر|اغلاق|إغلاق|الاغلاق|الإغلاق/.test(x)) return 'close';
  if(/volume|vol\.?|كمية|حجم|shares/.test(x)) return 'volume';
  if(/turnover|value|traded value|قيمة|القيمة/.test(x)) return 'valueTraded';
  return null;
}
function extractTableRows(html, sourceId){
  const out=[]; const tables=[...String(html||'').matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].map(m=>m[1]);
  let tableCount=0, rowCount=0, dateRows=0, invalid=0;
  for(const table of tables){
    tableCount++;
    const trs=[...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>m[1]);
    let headers=[];
    for(const tr of trs){
      const cells=[...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>cleanText(x[1]));
      if(!cells.length) continue; rowCount++;
      const headerKeys=cells.map(keyFromHeader);
      if(headerKeys.filter(Boolean).length>=3){ headers=headerKeys; continue; }
      const dateIdx=cells.findIndex(c=>toIsoDate(c));
      if(dateIdx<0) continue; dateRows++;
      let rec={date:cells[dateIdx], source:sourceId};
      if(headers.length===cells.length && headers.includes('close')){
        cells.forEach((c,i)=>{ const k=headers[i]; if(k) rec[k]=c; });
      }else{
        // Fallback: after removing date cell, test common market column orders.
        const nums=cells.filter((_,i)=>i!==dateIdx).map(num).filter(x=>x!=null);
        const orders=[
          ['open','high','low','close','volume','valueTraded'],
          ['close','open','high','low','volume','valueTraded'],
          ['close','high','low','open','volume','valueTraded'],
          ['last','open','high','low','volume','valueTraded']
        ];
        for(const order of orders){
          const test={date:cells[dateIdx], source:sourceId};
          order.forEach((k,i)=>{ if(k==='last') test.close=nums[i]; else test[k]=nums[i]; });
          if(validSession(test)){ rec=test; break; }
        }
      }
      if(validSession(rec)) out.push(normalizeSession(rec,sourceId)); else invalid++;
    }
  }
  return {rows:dedupeRows(out), stats:{tables:tableCount, tableRows:rowCount, dateRows, invalidCandidateRows:invalid}};
}
function dedupeRows(rows){ const m=new Map(); (rows||[]).forEach(r=>{ if(validSession(r)) m.set(toIsoDate(r.date), normalizeSession(r,r.source)); }); return [...m.values()].sort((a,b)=>a.date.localeCompare(b.date)); }
function traverseJson(obj, sourceId){
  const rows=[]; let arraysSeen=0, objectsSeen=0;
  function visit(x){
    if(!x || typeof x!=='object') return;
    if(Array.isArray(x)){ arraysSeen++; if(x.length && x.length<10000){
      // Array of objects with OHLC keys.
      if(x.every(v=>v && typeof v==='object' && !Array.isArray(v))){
        for(const it of x){
          const r={date:it.date||it.tradingDate||it.datetime||it.time||it.t||it.x, open:it.open??it.o, high:it.high??it.h, low:it.low??it.l, close:it.close??it.c??it.last??it.price, volume:it.volume??it.v, valueTraded:it.turnover??it.valueTraded??it.value??it.tradedValue, source:sourceId};
          if(validSession(r)) rows.push(normalizeSession(r,sourceId));
        }
      }
      x.slice(0,500).forEach(visit);
    } return; }
    objectsSeen++;
    // Yahoo chart format.
    if(x.timestamp && x.indicators && x.indicators.quote && Array.isArray(x.indicators.quote)){
      const q=x.indicators.quote[0]||{}; const ts=x.timestamp||[];
      for(let i=0;i<ts.length;i++){
        const date=new Date(Number(ts[i])*1000).toISOString().slice(0,10);
        const r={date, open:q.open?.[i], high:q.high?.[i], low:q.low?.[i], close:q.close?.[i], volume:q.volume?.[i], source:sourceId};
        if(validSession(r)) rows.push(normalizeSession(r,sourceId));
      }
    }
    // Common flat object.
    const r={date:x.date||x.tradingDate||x.datetime||x.time||x.t||x.x, open:x.open??x.o, high:x.high??x.h, low:x.low??x.l, close:x.close??x.c??x.last??x.price, volume:x.volume??x.v, valueTraded:x.turnover??x.valueTraded??x.value??x.tradedValue, source:sourceId};
    if(validSession(r)) rows.push(normalizeSession(r,sourceId));
    for(const v of Object.values(x).slice(0,1000)) visit(v);
  }
  visit(obj);
  return {rows:dedupeRows(rows), stats:{arraysSeen, objectsSeen}};
}
function extractJsonPayloads(text, sourceId){
  const rows=[]; let jsonBlocks=0, parsedBlocks=0;
  const s=String(text||'');
  const candidates=[];
  const next=s.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i); if(next) candidates.push(next[1]);
  const jsonScriptRe=/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while((m=jsonScriptRe.exec(s))) candidates.push(m[1]);
  // Try balanced-ish JSON snippets around OHLC keywords, intentionally capped.
  const keywordRe=/(?:open|high|low|close|volume|timestamp|tradingDate)/ig; let km; let seen=0;
  while((km=keywordRe.exec(s)) && seen<20){ seen++; const start=Math.max(0, km.index-15000), end=Math.min(s.length, km.index+15000); const chunk=s.slice(start,end); const a=chunk.indexOf('{'), b=chunk.lastIndexOf('}'); if(a>=0&&b>a) candidates.push(chunk.slice(a,b+1)); }
  for(const raw of candidates){
    jsonBlocks++;
    const txt=cleanText(raw).replace(/&quot;/g,'"');
    try{ const obj=JSON.parse(txt); parsedBlocks++; const got=traverseJson(obj, sourceId).rows; if(got.length) rows.push(...got); }
    catch(e){/* ignore */}
  }
  return {rows:dedupeRows(rows), stats:{jsonBlocks, parsedBlocks}};
}
function parseCsvLike(text, sourceId){
  const lines=String(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean).slice(0,5000);
  if(lines.length<2) return {rows:[], stats:{csvLines:lines.length, parsedCsvRows:0}};
  const sep = lines[0].includes('\t')?'\t':(lines[0].includes(';')?';':',');
  const headers=lines[0].split(sep).map(keyFromHeader);
  const rows=[];
  for(const line of lines.slice(1)){
    const cells=line.split(sep).map(x=>x.trim()); if(cells.length<5) continue;
    const r={source:sourceId}; cells.forEach((c,i)=>{ const k=headers[i]; if(k) r[k]=c; });
    if(validSession(r)) rows.push(normalizeSession(r,sourceId));
  }
  return {rows:dedupeRows(rows), stats:{csvLines:lines.length, parsedCsvRows:rows.length}};
}
function parseContent(text, sourceId, contentType){
  const s=String(text||'');
  let rows=[]; const stats={bytes:s.length, contentType:contentType||'', reasonHints:[]};
  if(!s.trim()){ stats.reasonHints.push('empty_response'); return {rows, stats}; }
  if(/captcha|access denied|cloudflare|enable javascript|robot|forbidden/i.test(s)) stats.reasonHints.push('possible_block_or_js_required');
  if(s.trim().startsWith('{') || s.trim().startsWith('[')){
    try{ const obj=JSON.parse(s); const tr=traverseJson(obj, sourceId); rows.push(...tr.rows); Object.assign(stats,tr.stats); }
    catch(e){ stats.reasonHints.push('json_parse_failed'); }
  }
  const csv=parseCsvLike(s,sourceId); if(csv.rows.length) rows.push(...csv.rows); Object.assign(stats,csv.stats);
  const tables=extractTableRows(s, sourceId); if(tables.rows.length) rows.push(...tables.rows); Object.assign(stats,tables.stats);
  const json=extractJsonPayloads(s, sourceId); if(json.rows.length) rows.push(...json.rows); Object.assign(stats,json.stats);
  rows=dedupeRows(rows);
  if(!rows.length){
    if((stats.tables||0)>0 && (stats.dateRows||0)===0) stats.reasonHints.push('tables_without_date_rows');
    else if((stats.dateRows||0)>0) stats.reasonHints.push('date_rows_found_but_ohlcv_invalid_or_unmapped');
    else if((stats.jsonBlocks||0)>0) stats.reasonHints.push('json_blocks_without_ohlcv_rows');
    else if(stats.reasonHints.length===0) stats.reasonHints.push('no_table_or_json_ohlcv_found');
  }
  return {rows, stats};
}
async function fetchText(url, timeoutMs=15000){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const headers={
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 RAS-EGX-Pro-History-Adapter/11.4',
      'accept':'text/html,application/json,text/csv;q=0.9,*/*;q=0.8',
      'accept-language':'en-US,en;q=0.9,ar;q=0.8',
      'cache-control':'no-cache'
    };
    if(process.env.EGX_HISTORY_API_KEY) headers.authorization=`Bearer ${process.env.EGX_HISTORY_API_KEY}`;
    const res=await fetch(url,{signal:ctrl.signal,headers,redirect:'follow'});
    const text=await res.text().catch(()=> '');
    return {ok:res.ok, status:res.status, contentType:res.headers.get('content-type')||'', text, url};
  } finally { clearTimeout(t); }
}
function licensedUrl(symbol){ const base=process.env.EGX_HISTORY_API_URL; return base?base.replaceAll('{symbol}', encodeURIComponent(symbol)).replaceAll('{market}','EGX').replaceAll('{limit}','120'):null; }
function buildTemplates(source, alias){
  let t=[...(source.templates||[])];
  if(source.id==='optional_licensed_eod_provider'){ const u=licensedUrl(alias); t=u?[u]:[]; }
  return t;
}
function addV114Templates(registry){
  const sources=[...(registry.sources||[])];
  const has=id=>sources.some(s=>s.id===id);
  if(!has('yahoo_chart_public_api')) sources.push({id:'yahoo_chart_public_api', name:'Yahoo public chart endpoint for EGX .CA symbols when available', priority:88, enabled:true, type:'public_chart_json', templates:['https://query1.finance.yahoo.com/v8/finance/chart/{symbol}.CA?range=6mo&interval=1d&events=history'], limitations:['Availability varies by EGX symbol; accepted only when OHLCV JSON validates.']});
  if(!has('stooq_public_daily_candidate')) sources.push({id:'stooq_public_daily_candidate', name:'Stooq public daily CSV candidate', priority:45, enabled:true, type:'public_csv_candidate', templates:['https://stooq.com/q/d/l/?s={symbol}.eg&i=d','https://stooq.com/q/d/l/?s={symbol}.ca&i=d'], limitations:['Symbol coverage may be incomplete; accepted only when OHLCV validates.']});
  return {...registry, sources};
}
function extractLinksForFollowup(html, baseUrl){
  const out=[]; const s=String(html||''); const base=new URL(baseUrl);
  const re=/<a[^>]+href=["']([^"']+)["'][^>]*>/gi; let m;
  while((m=re.exec(s))){
    const href=m[1]; if(!/history|historical|price|chart|trading|بيانات|تاريخ/i.test(href)) continue;
    try{ const u=new URL(href, base); if(u.hostname===base.hostname && /^https?:/.test(u.protocol)) out.push(u.href); }catch(e){}
  }
  return [...new Set(out)].slice(0,4);
}
function reasonFromAttempt(a){
  if(!a) return 'no_source_attempted';
  if(a.rows>0) return 'parsed_ohlcv';
  if(!a.ok) return a.reason || `http_${a.status||'failed'}`;
  const hints=(a.stats?.reasonHints||[]).filter(Boolean);
  if(hints.includes('possible_block_or_js_required')) return 'source_requires_javascript_or_blocks_automation';
  if(hints.includes('date_rows_found_but_ohlcv_invalid_or_unmapped')) return 'date_rows_found_but_ohlcv_invalid_or_unmapped';
  if(hints.includes('json_blocks_without_ohlcv_rows')) return 'json_found_but_no_ohlcv_array';
  if(hints.includes('tables_without_date_rows')) return 'tables_found_without_history_dates';
  return 'no_extractable_ohlcv';
}
function saveDebugSample(sym, attempt, html){
  try{
    fs.mkdirSync(DEBUG,{recursive:true});
    const safe=normSym(sym).replace(/[^A-Z0-9_-]/g,'_');
    const file=path.join(DEBUG, `${safe}-${String(attempt.source||'source').replace(/[^a-z0-9_-]/gi,'_')}.json`);
    const sample=String(html||'').slice(0,5000);
    writeJson(file, {symbol:sym, generatedAt:new Date().toISOString(), attempt:{source:attempt.source,url:attempt.url,status:attempt.status,ok:attempt.ok,reason:attempt.reason,stats:attempt.stats}, htmlSample:sample, note:'Truncated sample for parser diagnostics only; no credentials or manual data included.'});
  }catch(e){}
}
async function trySources(sym, registry, resolver, debugBudget){
  const attempts=[]; const found=[]; const aliases=[sym,resolver?.mubasherSymbol,resolver?.egxSymbol,`${sym}.CA`].filter(Boolean).map(normSym); const uniqueAliases=[...new Set(aliases)];
  const sources=(registry.sources||[]).filter(s=>s.enabled!==false).sort((a,b)=>(b.priority||0)-(a.priority||0));
  for(const source of sources){
    for(const alias of uniqueAliases){
      const templates=buildTemplates(source, alias);
      for(const tpl of templates){
        const url=tpl.replaceAll('{symbol}', encodeURIComponent(alias.replace(/\.CA$/,'')));
        if(!/^https?:\/\//.test(url)) continue;
        try{
          const r=await fetchText(url, Number(process.env.EGX_SOURCE_FETCH_TIMEOUT_MS||15000));
          const parsed=parseContent(r.text, source.id, r.contentType);
          const attempt={source:source.id, alias, url, ok:r.ok, status:r.status, contentType:r.contentType, bytes:(r.text||'').length, rows:parsed.rows.length, stats:parsed.stats};
          attempt.reason=r.ok?(parsed.rows.length?'parsed_ohlcv':reasonFromAttempt(attempt)):`http_${r.status}`;
          attempts.push(attempt);
          if(parsed.rows.length) found.push(...parsed.rows);
          else if(debugBudget.count<8 && r.ok){ saveDebugSample(sym, attempt, r.text); debugBudget.count++; }
          // Follow useful links only when page loaded but no rows.
          if(r.ok && !parsed.rows.length && (r.text||'').length && attempts.filter(a=>a.source===source.id).length<6){
            for(const link of extractLinksForFollowup(r.text, url)){
              try{
                const rr=await fetchText(link, 10000); const pp=parseContent(rr.text, source.id, rr.contentType);
                const aa={source:source.id+'_followup', alias, url:link, ok:rr.ok, status:rr.status, contentType:rr.contentType, bytes:(rr.text||'').length, rows:pp.rows.length, stats:pp.stats};
                aa.reason=rr.ok?(pp.rows.length?'parsed_ohlcv':reasonFromAttempt(aa)):`http_${rr.status}`;
                attempts.push(aa); if(pp.rows.length) found.push(...pp.rows); else if(debugBudget.count<8 && rr.ok){ saveDebugSample(sym, aa, rr.text); debugBudget.count++; }
                if(found.length>=120) return {found:mergeSessions([],found), attempts};
              }catch(e){ attempts.push({source:source.id+'_followup', alias, url:link, ok:false, reason:String(e.name||e.message||e).slice(0,120)}); }
            }
          }
          if(found.length>=120) return {found:mergeSessions([],found), attempts};
        }catch(e){ attempts.push({source:source.id, alias, url, ok:false, reason:String(e.name||e.message||e).slice(0,140)}); }
      }
    }
  }
  return {found:mergeSessions([],found), attempts};
}
(async()=>{
  const generatedAt=new Date().toISOString();
  const registry=addV114Templates(readJson(path.join(DATA,'historical-source-registry.json'), {sources:[]}));
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
  const maxSymbols=Number(process.env.EGX_HISTORY_BACKFILL_MAX_SYMBOLS || (maintenance?224:35));
  const need=symbols.map(sym=>({sym,count:(sessionsBySymbol[sym]||[]).length})).sort((a,b)=>a.count-b.count||a.sym.localeCompare(b.sym)).slice(0,maxSymbols);
  const debugBudget={count:0}; const rows=[]; let added=0, improved=0, parsedSymbols=0;
  const failureCounts={}; const sourceCounts={};
  for(const {sym} of need){
    const before=sessionsBySymbol[sym]||[]; const resolver=resolverBySymbol.get(sym)||{};
    const {found, attempts}=await trySources(sym, registry, resolver, debugBudget);
    const merged=mergeSessions(before, found); sessionsBySymbol[sym]=merged;
    const delta=Math.max(0, merged.length-before.length); added+=delta; if(delta>0) improved++; if(found.length) parsedSymbols++;
    const reason=attempts.find(a=>a.rows>0)?.reason || reasonFromAttempt(attempts[attempts.length-1]); failureCounts[reason]=(failureCounts[reason]||0)+1;
    for(const a of attempts){ sourceCounts[a.source]=(sourceCounts[a.source]||0)+1; }
    rows.push({symbol:sym, before:before.length, discovered:found.length, after:merged.length, added:delta, status:delta>0?'IMPROVED':(merged.length>=50?'READY_50':'NOT_IMPROVED'), reason, resolverConfidence:resolver.confidence||0, attempts:attempts.slice(0,18)});
  }
  const allSyms=[...new Set([...symbols, ...Object.keys(sessionsBySymbol).map(normSym)])].filter(Boolean);
  const counts=allSyms.map(s=>(sessionsBySymbol[s]||[]).length);
  const summary={totalSymbols:allSyms.length, scannedThisRun:need.length, improvedSymbols:improved, parsedSymbols, sessionsAdded:added, ready20:counts.filter(c=>c>=20).length, ready50:counts.filter(c=>c>=50).length, ready120:counts.filter(c=>c>=120).length, avgSessions:counts.length?Number((counts.reduce((a,b)=>a+b,0)/counts.length).toFixed(2)):0, maxSymbolsPerRun:maxSymbols, maintenanceMode:maintenance, debugSamplesWritten:debugBudget.count, failureCounts, sourceAttemptCounts:sourceCounts};
  const newHistory={...history, version:'v11_4_historical_source_adapter_fix', generatedAt, requiredSessions:50, preferredSessions:120, importantNote:'Only validated public/optional licensed OHLCV rows are stored. Missing sessions are not fabricated.', sessionsBySymbol};
  writeJson(path.join(DATA,'history.json'), newHistory);
  const report={ok:true, engine:'v11_4_historical_source_adapter_fix', generatedAt, summary, rows, topFailures:Object.entries(failureCounts).sort((a,b)=>b[1]-a[1]).map(([reason,count])=>({reason,count})), debugSamplesPath:'data/debug/history-fetch-samples/*.json', conclusion: parsedSymbols>0?'V11.4 parsed historical OHLCV rows from at least one source.':'V11.4 ran and scanned symbols, but no source exposed extractable OHLCV rows. Inspect debug samples and failureCounts to decide next source adapter or licensed EOD API.', note:'No manual CSV or fabricated sessions were used.'};
  writeJson(path.join(DATA,'history-backfill-report.json'), report);
  writeJson(path.join(DATA,'history-backfill-status.json'), {ok:true, engine:'v11_4_historical_source_adapter_fix_status', generatedAt, summary});
  writeJson(path.join(DATA,'v11-4-history-adapter-report.json'), report);
  console.log('V11.4 historical adapter fix:', summary);
})().catch(err=>{ console.error(err); process.exitCode=1; });
