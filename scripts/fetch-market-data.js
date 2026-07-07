/*
EGX Pro Hub V9.8.6 — Mubasher Analysis Tools Adapter
Adds Mubasher EGX analysis tools:
- liquidity-monitor/EGX
- volume-monitor/EGX
- stocks-support-resistance/EGX

Notes:
- User supplied TDWL links. TDWL is Saudi market; for Egypt we use EGX.
- Some Mubasher pages are Angular templates and may require API discovery or login.
- We never invent prices. If tools cannot be parsed, report why and fall back to other adapters/existing files.
*/
const fs=require("fs");
const path=require("path");

const RUN_AT=new Date().toISOString();
const MIN_ROWS=Number(process.env.EGX_MIN_PUBLIC_ROWS||80);
const SYMBOL_LIMIT=Number(process.env.EGX_MUBASHER_STOCK_PAGE_LIMIT||260);
const CONCURRENCY=Math.max(1,Math.min(Number(process.env.EGX_FETCH_CONCURRENCY||8),16));
const ACCEPT_LOW=String(process.env.EGX_ALLOW_LOW_COVERAGE_FETCH||"").toLowerCase()==="true";
const BASES=["https://www.mubasher.info","https://english.mubasher.info"];

function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;let s=String(v).replace(/&nbsp;/g," ").replace(/[,%٬،]/g,"").replace(/[−–—]/g,"-").replace(/[^\d.+\-eE]/g,"");const n=Number(s);return Number.isFinite(n)?n:null}
function clean(s){return String(s==null?"":s).replace(/\s+/g," ").trim()}
function decode(s){return clean(String(s||"").replace(/\\u002F/g,"/").replace(/\\u0026/g,"&").replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(parseInt(d,10))).replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'"))}
function strip(html){return decode(String(html||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," "))}
function normSymbol(v){return String(v||"").trim().toUpperCase().replace(/[^A-Z0-9._-]/g,"")}
function normalizeRow(r, source, url){
  const symbol=normSymbol(r.symbol||r.ticker||r.code||r.Symbol||r.securityCode||r.companySymbol);
  const price=num(r.price ?? r.last ?? r.lastPrice ?? r.close ?? r.Last ?? r.last_price);
  const name=clean(r.name||r.company||r.companyName||r.name_ar||r.name_en||r.stockName||"");
  if((!symbol && !name) || !price || price<=0)return null;
  return {
    symbol:symbol||name.slice(0,12).toUpperCase(),
    name_ar:clean(r.name_ar||name),
    name_en:clean(r.name_en||name),
    price,last:price,
    change:num(r.change||r.changeValue),
    changePct:num(r.changePct??r.changePercentage??r.change_percent??r.percentChange),
    open:num(r.open), previousClose:num(r.previousClose),
    high:num(r.high), low:num(r.low),
    volume:num(r.volume??r.tradedVolume??r.volumeTraded),
    valueTraded:num(r.valueTraded??r.turnover??r.tradedValue??r.value),
    inFlow:num(r.inFlow), outFlow:num(r.outFlow),
    support1:num(r.support1??r.support??r.firstSupport),
    support2:num(r.support2??r.secondSupport),
    resistance1:num(r.resistance1??r.resistance??r.firstResistance),
    resistance2:num(r.resistance2??r.secondResistance),
    updatedAt:r.updatedAt||r.date||r.timestamp||RUN_AT,
    source, sourceUrl:url
  };
}
function uniqueRows(rows){
  const m=new Map();
  for(const r of rows){if(r&&r.symbol&&!m.has(r.symbol))m.set(r.symbol,r)}
  return [...m.values()];
}
function hasVal(v){return v!==undefined&&v!==null&&v!==""}
function decimalPlaces(v){
  if(!Number.isFinite(Number(v)))return 0;
  const s=String(v);
  if(!s.includes("."))return 0;
  return s.split(".")[1].replace(/0+$/g,"").length;
}
function mergeRowsPreferPrecisePrice(preciseRows,enrichRows){
  const pRows=Array.isArray(preciseRows)?preciseRows:[];
  const eRows=Array.isArray(enrichRows)?enrichRows:[];
  const eMap=new Map();
  for(const e of eRows){if(e&&e.symbol)eMap.set(e.symbol,e)}
  const used=new Set();
  const merged=[];
  for(const p of pRows){
    const e=eMap.get(p.symbol)||{}; used.add(p.symbol);
    const out={...e,...p};
    for(const k of ["volume","valueTraded","support1","support2","resistance1","resistance2","inFlow","outFlow","open","previousClose","high","low","sector","sector_ar","sector_en"]){
      if(!hasVal(out[k])&&hasVal(e[k]))out[k]=e[k];
    }
    out.price=p.price;
    out.last=p.price;
    out.priceSource=p.source||"mubasher_symbol_pages_precise";
    out.enrichedFrom=e.source||null;
    out.pricePrecisionWarning=(p.price>0&&p.price<1&&decimalPlaces(p.price)<3)?"sub_1_price_has_less_than_3_decimals":null;
    merged.push(out);
  }
  for(const e of eRows){if(e&&e.symbol&&!used.has(e.symbol))merged.push(e)}
  return uniqueRows(merged);
}
function getUniverseSymbols(){
  const rec=read("data/recommendations.json",{}), market=read("data/market.json",{}), cache=read("data/full-market-cache.json",{}), hist=read("data/history.json",{});
  const set=new Set();
  for(const arr of [rec.all,market.rows,cache.rows]) if(Array.isArray(arr)) arr.forEach(r=>{const s=normSymbol(r.symbol);if(s)set.add(s)});
  const h=hist.sessionsBySymbol||hist.symbols||hist.history||{}; Object.keys(h||{}).forEach(k=>{const s=normSymbol(k);if(s)set.add(s)});
  return [...set].filter(s=>s.length>=2&&s.length<=12).slice(0,SYMBOL_LIMIT);
}
async function fetchText(url){
  const res=await fetch(url,{redirect:"follow",headers:{
    "accept":"text/html,application/json,text/plain,*/*",
    "accept-language":"ar,en-US;q=0.9,en;q=0.8",
    "cache-control":"no-cache","pragma":"no-cache",
    "referer":"https://www.mubasher.info/",
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36 EGXProHub/9.8.6"
  }});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
function extractScriptSrc(html, base){
  const out=[]; const re=/<script[^>]+src=["']([^"']+)["'][^>]*>/gi; let m;
  while((m=re.exec(html))){
    let u=decode(m[1]);
    if(u.startsWith("//"))u="https:"+u;
    else if(u.startsWith("/"))u=base+u;
    else if(!/^https?:/i.test(u))u=base+"/"+u;
    out.push(u);
  }
  return [...new Set(out)];
}
function discoverApiUrls(text, base, market="EGX"){
  const s=String(text||"");
  const candidates=new Set();
  const known=[
    `/analysis-tools/liquidity-monitor/${market}`,
    `/analysis-tools/volume-monitor/${market}`,
    `/analysis-tools/stocks-support-resistance/${market}`,
    `/api/analysis-tools/liquidity-monitor/${market}`,
    `/api/analysis-tools/volume-monitor/${market}`,
    `/api/analysis-tools/stocks-support-resistance/${market}`,
    `/api/v1/analysis-tools/liquidity-monitor/${market}`,
    `/api/v1/analysis-tools/volume-monitor/${market}`,
    `/api/v1/analysis-tools/stocks-support-resistance/${market}`,
    `/api/markets/${market}/liquidity-monitor`,
    `/api/markets/${market}/volume-monitor`,
    `/api/markets/${market}/support-resistance`,
    `/api/markets/${market}/stocks-support-resistance`
  ];
  known.forEach(p=>candidates.add(base+p));
  const quoted=/["'`](\/[^"'`]*(?:liquidity|volume|support|resistance|analysis-tools|api)[^"'`]*)["'`]/gi; let m;
  while((m=quoted.exec(s))){
    let u=decode(m[1]).replace(/\\\//g,"/");
    if(u.includes("{{")||u.includes("}"))continue;
    if(u.includes("TDWL"))u=u.replace(/TDWL/g,market);
    if(!u.includes(market)&&/(liquidity|volume|support|resistance)/i.test(u)) {
      // keep too, some endpoints infer market from query
    }
    if(u.startsWith("//"))u="https:"+u;
    else if(u.startsWith("/"))u=base+u;
    candidates.add(u);
  }
  const full=/https?:\/\/[^"'`\s]+(?:liquidity|volume|support|resistance|analysis-tools|api)[^"'`\s]*/gi;
  while((m=full.exec(s))){
    let u=decode(m[0]).replace(/\\\//g,"/");
    if(u.includes("TDWL"))u=u.replace(/TDWL/g,market);
    candidates.add(u);
  }
  return [...candidates].filter(u=>/^https?:\/\//.test(u)).slice(0,80);
}
function parseJson(raw){
  try{return JSON.parse(raw)}catch{return null}
}
function flattenArrays(obj, acc=[]){
  if(!obj||typeof obj!=="object")return acc;
  if(Array.isArray(obj)){
    if(obj.length&&typeof obj[0]==="object"){
      const keys=Object.keys(obj[0]).map(k=>k.toLowerCase());
      if(keys.some(k=>["symbol","ticker","code","name","lastprice","last","price","turnover","inflow","support","resistance"].some(x=>k.includes(x)))) acc.push(obj);
    }
    for(const x of obj)flattenArrays(x,acc);
  }else{
    for(const k of Object.keys(obj))flattenArrays(obj[k],acc);
  }
  return acc;
}
function rowsFromJsonPayload(payload, source, url){
  const arrs=flattenArrays(payload);
  const rows=[];
  for(const arr of arrs) for(const item of arr){
    const r=normalizeRow(item,source,url);
    if(r)rows.push(r);
  }
  return uniqueRows(rows);
}
function rowsFromAngularTemplate(html, source, url){
  // If only Angular placeholders are present, this returns zero; report will show template-only.
  const rows=[];
  const jsonScripts=[...String(html).matchAll(/<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>decode(m[1]));
  for(const js of jsonScripts){const payload=parseJson(js);if(payload)rows.push(...rowsFromJsonPayload(payload,source,url))}
  const next=String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(next){const payload=parseJson(decode(next[1]));if(payload)rows.push(...rowsFromJsonPayload(payload,source,url))}
  return uniqueRows(rows);
}
async function sourceConfiguredJson(){
  const url=process.env.EGX_MARKET_JSON_URL||process.env.PUBLIC_MARKET_JSON_URL||"";
  if(!url)return {ok:false,name:"configured_json",url:null,rows:[],message:"EGX_MARKET_JSON_URL not configured"};
  const raw=await fetchText(url); const payload=parseJson(raw);
  if(!payload)throw new Error("Configured URL did not return JSON");
  const rows=rowsFromJsonPayload(payload,"configured_json",url);
  return {ok:rows.length>=MIN_ROWS||(ACCEPT_LOW&&rows.length),name:"configured_json",url,rows,message:`Parsed ${rows.length} rows`};
}
async function sourceMubasherAnalysisTools(){
  const toolPaths=[
    ["mubasher_liquidity_monitor","/analysis-tools/liquidity-monitor/EGX"],
    ["mubasher_volume_monitor","/analysis-tools/volume-monitor/EGX"],
    ["mubasher_support_resistance","/analysis-tools/stocks-support-resistance/EGX"]
  ];
  const attempts=[]; const combinedBySymbol=new Map(); const apiCandidates=new Set();
  for(const base of BASES){
    for(const [name,path] of toolPaths){
      const pageUrl=base+path;
      try{
        const html=await fetchText(pageUrl);
        const templateOnly=/\{\{row\./.test(html);
        const pageRows=rowsFromAngularTemplate(html,name,pageUrl);
        pageRows.forEach(r=>combinedBySymbol.set(r.symbol,{...(combinedBySymbol.get(r.symbol)||{}),...r}));
        attempts.push({name, url:pageUrl, ok:pageRows.length>0, rows:pageRows.length, message:templateOnly?`Angular template detected; inline rows ${pageRows.length}`:`Parsed inline rows ${pageRows.length}`});
        discoverApiUrls(html,base,"EGX").forEach(u=>apiCandidates.add(u));
        for(const script of extractScriptSrc(html,base).slice(0,25)){
          try{
            const js=await fetchText(script);
            discoverApiUrls(js,base,"EGX").forEach(u=>apiCandidates.add(u));
          }catch(e){}
        }
      }catch(e){attempts.push({name,url:pageUrl,ok:false,rows:0,error:e.message})}
    }
  }
  const apiList=[...apiCandidates].filter(u=>!/login|register|facebook|twitter|youtube/i.test(u)).slice(0,60);
  for(const url of apiList){
    try{
      const raw=await fetchText(url);
      const payload=parseJson(raw);
      if(payload){
        const rows=rowsFromJsonPayload(payload,"mubasher_analysis_api",url);
        rows.forEach(r=>combinedBySymbol.set(r.symbol,{...(combinedBySymbol.get(r.symbol)||{}),...r}));
        attempts.push({name:"mubasher_analysis_api",url,ok:rows.length>0,rows:rows.length,message:`JSON parsed ${rows.length} rows`});
      }else{
        const rows=rowsFromAngularTemplate(raw,"mubasher_analysis_api_html",url);
        rows.forEach(r=>combinedBySymbol.set(r.symbol,{...(combinedBySymbol.get(r.symbol)||{}),...r}));
        attempts.push({name:"mubasher_analysis_api_html",url,ok:rows.length>0,rows:rows.length,message:`HTML parsed ${rows.length} rows`});
      }
    }catch(e){attempts.push({name:"mubasher_analysis_api",url,ok:false,rows:0,error:e.message})}
  }
  const rows=uniqueRows([...combinedBySymbol.values()]);
  return {ok:rows.length>=MIN_ROWS||(ACCEPT_LOW&&rows.length),name:"mubasher_analysis_tools",url:"EGX liquidity/volume/support-resistance",rows,message:`Combined ${rows.length} rows from tools/API discovery`,attempts};
}
async function sourceMubasherSymbolPages(){
  const symbols=getUniverseSymbols();
  async function fetchSymbol(symbol){
    const urls=[
      `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`,
      `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/`
    ];
    let lastErr="";
    for(const url of urls){
      try{
        const html=await fetchText(url); const plain=strip(html);
        const esc=symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        let m=plain.match(new RegExp(`(.{0,120})\\s*\\(${esc}\\)\\s*Last update:\\s*([^\\.]+?market time)\\.\\s*([0-9][0-9,.]*\\.?[0-9]*)\\s+([+\\-−–]?[0-9][0-9,.]*\\.?[0-9]*)\\s+([+\\-−–]?[0-9][0-9,.]*\\.?[0-9]*)%`,"i"));
        if(!m){
          const idx=plain.search(/Last update:/i); const sn=idx>=0?plain.slice(Math.max(0,idx-160),idx+320):plain;
          m=sn.match(/(.{0,140})Last update:\s*([^\.]+?market time)\.\s*([0-9][0-9,.]*\.?[0-9]*)\s+([+\-−–]?[0-9][0-9,.]*\.?[0-9]*)\s+([+\-−–]?[0-9][0-9,.]*\.?[0-9]*)%/i);
        }
        const price=m?num(m[3]):null;
        if(price){
          const getAfter=(label)=>{const mm=plain.match(new RegExp(label+"\\s+([0-9][0-9,.]*\\.?[0-9]*)","i"));return mm?num(mm[1]):null};
          const row=normalizeRow({symbol,name:m?m[1]:"",price,change:m?m[4]:null,changePct:m?m[5]:null,open:getAfter("Open"),previousClose:getAfter("Previous Close"),high:getAfter("High"),low:getAfter("Low"),volume:getAfter("Volume"),valueTraded:getAfter("Turnover"),updatedAt:RUN_AT},"mubasher_symbol_pages",url);
          if(row)return {ok:true,row};
        }
        lastErr="price parse failed";
      }catch(e){lastErr=e.message}
    }
    return {ok:false,symbol,error:lastErr};
  }
  async function mapLimit(items,limit,fn){const ret=[];let i=0;async function w(){while(i<items.length){const j=i++;ret[j]=await fn(items[j])}} await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},w)); return ret}
  const results=await mapLimit(symbols,CONCURRENCY,fetchSymbol);
  const rows=uniqueRows(results.filter(x=>x.ok).map(x=>x.row));
  return {ok:rows.length>=MIN_ROWS||(ACCEPT_LOW&&rows.length),name:"mubasher_symbol_pages",url:`${symbols.length} symbols`,rows,message:`Parsed ${rows.length}/${symbols.length} symbol pages`,attempts:[{name:"mubasher_symbol_pages",url:`${symbols.length} symbols`,ok:rows.length>0,rows:rows.length,message:`Parsed ${rows.length}/${symbols.length}`} ]};
}
async function trySources(){
  const attempts=[];

  // 1) If the user provides an external JSON source, respect it first.
  try{
    const cfg=await sourceConfiguredJson();
    if(Array.isArray(cfg.attempts)) attempts.push(...cfg.attempts);
    attempts.push({name:cfg.name,url:cfg.url,ok:!!cfg.ok,rows:cfg.rows.length,message:cfg.message});
    if(cfg.ok)return {selected:cfg,attempts};
  }catch(e){attempts.push({name:"sourceConfiguredJson",url:null,ok:false,rows:0,error:e.stack||e.message})}

  // 2) Use symbol pages as the primary price source because they preserve small-price precision
  //    مثل 0.216 بدلاً من 0.21. Analysis tools can still enrich liquidity/support data.
  let precise=null;
  try{
    precise=await sourceMubasherSymbolPages();
    if(Array.isArray(precise.attempts)) attempts.push(...precise.attempts);
    attempts.push({name:precise.name,url:precise.url,ok:!!precise.ok,rows:precise.rows.length,message:precise.message});
  }catch(e){attempts.push({name:"sourceMubasherSymbolPages",url:null,ok:false,rows:0,error:e.stack||e.message})}

  if(precise&&precise.ok){
    let enrichedRows=precise.rows;
    try{
      const tools=await sourceMubasherAnalysisTools();
      if(Array.isArray(tools.attempts)) attempts.push(...tools.attempts);
      attempts.push({name:tools.name,url:tools.url,ok:!!tools.ok,rows:tools.rows.length,message:tools.message});
      if(tools.rows&&tools.rows.length)enrichedRows=mergeRowsPreferPrecisePrice(precise.rows,tools.rows);
    }catch(e){attempts.push({name:"sourceMubasherAnalysisTools_enrichment",url:null,ok:false,rows:0,error:e.stack||e.message})}
    return {selected:{...precise,name:"mubasher_symbol_pages_precise_enriched",url:precise.url+" + analysis tools enrichment",rows:enrichedRows,message:`Parsed precise prices ${precise.rows.length}; enriched rows ${enrichedRows.length}`},attempts};
  }

  // 3) Fallback only: analysis tools. If this is selected, sub-1 prices may be rounded;
  //    the price reconciliation report will mark such cases as precision risk.
  try{
    const tools=await sourceMubasherAnalysisTools();
    if(Array.isArray(tools.attempts)) attempts.push(...tools.attempts);
    attempts.push({name:tools.name,url:tools.url,ok:!!tools.ok,rows:tools.rows.length,message:tools.message});
    if(tools.ok)return {selected:tools,attempts};
  }catch(e){attempts.push({name:"sourceMubasherAnalysisTools",url:null,ok:false,rows:0,error:e.stack||e.message})}

  return {selected:null,attempts};
}
async function main(){
  const {selected,attempts}=await trySources();
  const existingMarket=read("data/market.json",{}), existingCache=read("data/full-market-cache.json",{}), rec=read("data/recommendations.json",{});
  const expected=Math.max(Array.isArray(existingCache.rows)?existingCache.rows.length:0, Array.isArray(rec.all)?rec.all.length:0, 224);
  if(selected&&selected.rows.length){
    const rows=uniqueRows(selected.rows);
    const coveragePct=expected?Number((rows.length/expected*100).toFixed(1)):0;
    write("data/market.json",{ok:true,generatedAt:RUN_AT,updatedAt:RUN_AT,source:selected.name,sourceUrl:selected.url,rows,note:"Public/delayed data fetched with price-precision priority. Symbol pages are preferred for exact sub-1 EGP prices. Validate with broker before trading."});
    write("data/source-health.json",{ok:true,generatedAt:RUN_AT,lastSuccessAt:RUN_AT,mode:"price_precision_source_adapter",sourceName:selected.name,sourceUrl:selected.url,marketRows:rows.length,cacheRows:Array.isArray(existingCache.rows)?existingCache.rows.length:0,recommendationRows:Array.isArray(rec.all)?rec.all.length:0,totalUniverse:expected,universeCoveragePct:coveragePct,coveragePct,delayed:true});
    write("data/fetch-status.json",{ok:true,realFetch:true,scriptExists:true,generatedAt:RUN_AT,mode:"price_precision_source_adapter",sourceName:selected.name,sourceUrl:selected.url,marketRows:rows.length,coveragePct,message:`Fetched and accepted ${rows.length} rows from ${selected.name}`});
    write("data/source-fetch-report.json",{ok:true,realFetch:true,engine:"v8_9_5_price_precision_source_adapter",generatedAt:RUN_AT,mode:"price_precision_source_adapter",sourceName:selected.name,selected:{name:selected.name,url:selected.url,rows:rows.length,message:selected.message},attempts,marketRows:rows.length,expectedUniverse:expected,coveragePct,minimumRows:MIN_ROWS,note:"Accepted public/delayed Mubasher analysis tools/symbol pages. Validate before execution."});
    console.log(`Accepted ${selected.name}: ${rows.length}/${expected} rows`);
    return;
  }
  const status={ok:false,realFetch:false,scriptExists:true,generatedAt:RUN_AT,mode:"mubasher_analysis_tools_failed_existing_files_only",sourceName:null,marketRows:Array.isArray(existingMarket.rows)?existingMarket.rows.length:0,cacheRows:Array.isArray(existingCache.rows)?existingCache.rows.length:0,recommendationRows:Array.isArray(rec.all)?rec.all.length:0,message:"Mubasher analysis tools and symbol pages did not produce enough valid rows. Existing repository data preserved; freshness is not guaranteed."};
  write("data/fetch-status.json",status);
  write("data/source-fetch-report.json",{ok:false,realFetch:false,engine:"v8_9_5_price_precision_source_adapter",generatedAt:RUN_AT,mode:status.mode,selected:null,attempts,marketRows:status.marketRows,expectedUniverse:expected,coveragePct:0,minimumRows:MIN_ROWS,note:"No data overwritten because coverage was too low. See attempts for exact reason."});
  console.warn(status.message);
}
main().catch(err=>{
  const status={ok:false,realFetch:false,scriptExists:true,generatedAt:new Date().toISOString(),mode:"mubasher_analysis_tools_exception",message:err.stack||err.message};
  write("data/fetch-status.json",status);
  write("data/source-fetch-report.json",{ok:false,realFetch:false,engine:"v8_9_5_price_precision_source_adapter",generatedAt:status.generatedAt,mode:status.mode,attempts:[],error:status.message});
  console.error(err);
});
