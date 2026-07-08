#!/usr/bin/env node
/*
  EGX Pro Hub V9.9 — Precision-Aware Trusted Coverage Loop Collector
  الهدف: رفع نسبة الأسهم القابلة للتحليل إلى 80%+ بدون كسر حاكم التنفيذ.
  التغيير الجوهري عن V9.8: نقص دقة سعر سهم أقل من 1 جنيه لا يحجب السهم من التحليل؛
  لكنه يمنعه من التنفيذ إلى أن تؤكد 3 خانات سعرية أو مصدر أقوى.
*/
const fs = require('fs');
const path = require('path');
const RUN_AT = new Date().toISOString();
const TARGET = Number(process.env.EGX_TRUSTED_COVERAGE_TARGET || 80);
const MAX_CYCLES = Number(process.env.EGX_COVERAGE_MAX_CYCLES || 4);
const SOURCE_RETRIES = Number(process.env.EGX_SOURCE_RETRIES || 3);
const TIMEOUT_MS = Number(process.env.EGX_SOURCE_FETCH_TIMEOUT_MS || 45000);
const MIN_READY_SCORE = Number(process.env.EGX_ANALYSIS_READY_SCORE || 50);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const EXTERNAL_SOURCES = [
  { id:'mubasherVolume', group:'volume', title:'Mubasher Volume Monitor', url:'https://www.mubasher.info/analysis-tools/volume-monitor/EGX' },
  { id:'mubasherLiquidity', group:'liquidity', title:'Mubasher Liquidity Monitor', url:'https://www.mubasher.info/analysis-tools/liquidity-monitor/EGX' },
  { id:'mubasherSupportResistance', group:'supportResistance', title:'Mubasher Support & Resistance', url:'https://www.mubasher.info/analysis-tools/stocks-support-resistance/EGX' },
  { id:'mubasherFinancialRatios', group:'financialRatios', title:'Mubasher Financial Ratios', url:'https://www.mubasher.info/analysis-tools/financial-ratios/EGX' },
  { id:'mubasherMarketStocks', group:'market', title:'Mubasher EGX Market Stocks', url:'https://www.mubasher.info/markets/EGX/stocks' },
  { id:'mubasherPrices', group:'priceBoard', title:'Mubasher EGX Price Board', url:'https://www.mubasher.info/markets/EGX' }
];
function read(file, def){ try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return def} }
function write(file, obj){ fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(obj,null,2)+'\n','utf8') }
function rowsOf(x){ if(Array.isArray(x))return x; if(Array.isArray(x?.rows))return x.rows; if(Array.isArray(x?.all))return x.all; if(Array.isArray(x?.data))return x.data; if(Array.isArray(x?.items))return x.items; return [] }
function sym(v){ return String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim() }
function clean(s){ return String(s==null?'':s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#x2F;|&#47;/g,'/').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim() }
function stripTags(s){ return clean(String(s||'').replace(/<[^>]*>/g,' ')) }
function num(v){ if(v==null||v==='')return null; let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim(); let mult=1; if(/[Kk]$/.test(s)){mult=1e3;s=s.slice(0,-1)} if(/[Mm]$/.test(s)){mult=1e6;s=s.slice(0,-1)} if(/[Bb]$/.test(s)){mult=1e9;s=s.slice(0,-1)} s=s.replace(/[^0-9.+\-eE]/g,''); const n=Number(s); return Number.isFinite(n)?n*mult:null }
function finite(v){ const x=num(v); return x!=null && Number.isFinite(x) ? x : null }
function decs(v){ const s=String(v??''); const m=s.match(/\.(\d+)/); return m?m[1].length:0 }
function keyName(r){ return r.name_ar||r.nameAr||r.arabicName||r.name||r.name_en||r.symbol||r.ticker||'' }
function sourceRows(file){ return rowsOf(read(file,{})) }
function buildUniverse(){
  const candidates=[...sourceRows('data/full-market-cache.json'),...sourceRows('data/market.json'),...sourceRows('data/recommendations.json'),...sourceRows('data/final-opportunity-ranking.json')];
  const map=new Map();
  for(const r of candidates){ const k=sym(r.symbol||r.ticker||r.code); if(!k)continue; const old=map.get(k)||{}; map.set(k,{...old,...r,symbol:k,name:keyName(r)||keyName(old)||k}); }
  return Array.from(map.values()).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}
function priceValue(r){ return finite(r.price??r.lastPrice??r.last??r.close??r.currentPrice) }
function hasCorePrice(r){ const p=priceValue(r); return !!(p && p>0) }
function pricePrecisionRisk(r){ const p=priceValue(r); if(!p || p<=0) return true; return p<1 && Math.max(decs(r.price),decs(r.priceDisplay),decs(r.lastPrice),decs(r.last),decs(p))<3 }
function executionPriceOk(r){ return hasCorePrice(r) && !pricePrecisionRisk(r) }
function validVolume(r){ return (finite(r.volume??r.tradedVolume)>0) || (finite(r.valueTraded??r.turnover??r.value)>0) }
function validSupport(r){ const p=priceValue(r), s=finite(r.support1??r.support??r.s1), res=finite(r.resistance1??r.resistance??r.r1); return !!(p && s && res && s>0 && res>0 && s<p*1.35 && res>p*.65) }
function validPlan(r){ const p=priceValue(r), e1=finite(r.entryFrom??r.entryLow), e2=finite(r.entryTo??r.entryHigh), t=finite(r.target1), sl=finite(r.stopLoss); if(!p||!e1||!e2||!t||!sl)return false; return e1<=e2 && e1>=p*.60 && e2<=p*1.40 && t>p*1.002 && sl<p*.999 }
function qualityScore(r){ return Math.max(0, Math.min(100, finite(r.dataQualityScore??r.finalConfidence??r.confidence??r.score)??0)) }
function symbolFromRow(rowHtml, universeSet){
  const patterns=[/href=["'][^"']*\/(?:stocks|companies|securities)\/([A-Z0-9.]+)(?:\.CA)?[^"']*["']/i,/\/markets\/EGX\/stocks\/([A-Z0-9.]+)(?:\.CA)?/i,/data-symbol=["']([A-Z0-9.]+)["']/i,/\b([A-Z]{2,7})(?:\.CA)?\b/g];
  for(const re of patterns){
    if(re.global){ let m; while((m=re.exec(rowHtml))){ const k=sym(m[1]); if(k && (!universeSet.size || universeSet.has(k))) return k; } }
    else { const m=rowHtml.match(re); const k=sym(m&&m[1]); if(k && (!universeSet.size || universeSet.has(k))) return k; }
  }
  return '';
}
function numbersFromCells(cells){ return cells.map(c=>({raw:c,value:num(c),isPercent:/[%٪]/.test(c)})).filter(x=>x.value!=null) }
function parseHtmlRows(html, source, universeSet){
  const rows=[]; const trRe=/<tr[\s\S]*?<\/tr>/gi; let m,idx=0;
  while((m=trRe.exec(html))){
    const tr=m[0]; if(!/<td[\s\S]*?<\/td>/i.test(tr))continue;
    const symbol=symbolFromRow(tr, universeSet); if(!symbol)continue;
    const cells=[]; let cm; const cellRe=/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    while((cm=cellRe.exec(tr))) cells.push(stripTags(cm[1]));
    if(cells.length<2)continue;
    rows.push({symbol,sourceId:source.id,group:source.group,rowIndex:++idx,name:cells.find(c=>/[\u0600-\u06FF]/.test(c))||cells[0]||symbol,cells,numeric:numbersFromCells(cells),rowText:stripTags(tr)});
  }
  if(rows.length)return rows;
  const text=stripTags(html); const re=/\b([A-Z]{2,7})(?:\.CA)?\b([^A-Z]{0,260})/g; let mm;
  while((mm=re.exec(text)) && rows.length<1500){
    const symbol=sym(mm[1]); if(!symbol || (universeSet.size && !universeSet.has(symbol)))continue;
    const chunk=(mm[1]+(mm[2]||'')).slice(0,420); const nums=[]; const nr=/[+\-]?\d+(?:[.,]\d+)?\s*[%٪]?/g; let nm;
    while((nm=nr.exec(chunk)) && nums.length<12) nums.push({raw:nm[0],value:num(nm[0]),isPercent:/[%٪]/.test(nm[0])});
    rows.push({symbol,sourceId:source.id,group:source.group,rowIndex:rows.length+1,name:symbol,cells:[chunk],numeric:nums,rowText:chunk,fallback:true});
  }
  return rows;
}
async function fetchOne(source, universeSet, attempt){
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(), TIMEOUT_MS);
  try{
    const res=await fetch(source.url,{signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 EGX-Pro-Hub/9.9 PrecisionCoverageLoop','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'ar,en;q=0.8','cache-control':'no-cache'}});
    const text=await res.text();
    const rows=parseHtmlRows(text,source,universeSet);
    return {ok:rows.length>0,currentRunOk:res.ok,attempt,generatedAt:RUN_AT,id:source.id,group:source.group,title:source.title,url:source.url,httpStatus:res.status,count:rows.length,rows,error:rows.length?'':`no rows parsed; status ${res.status}`};
  }catch(e){ return {ok:false,currentRunOk:false,attempt,generatedAt:RUN_AT,id:source.id,group:source.group,title:source.title,url:source.url,count:0,rows:[],error:String(e&&e.message||e)} }
  finally{clearTimeout(timeout)}
}
function previousGood(source){ const old=read(`data/${source.id}.json`,null) || read(`data/mubasher-${source.group}.json`,null); if(old && Array.isArray(old.rows) && old.rows.length){ return {...old,id:source.id,group:source.group,title:source.title,url:source.url,ok:true,currentRunOk:false,staleFallback:true,count:old.rows.length,generatedAt:old.generatedAt||RUN_AT,error:old.error||'current source not available; preserved last good rows'} } return null }
function mergeEvidence(universe, sourceResults){
  const map=new Map();
  for(const r of universe){ const k=sym(r.symbol); if(!k)continue; map.set(k,{symbol:k,name:keyName(r)||k,base:r,evidence:{},sources:{},reasons:[]}); }
  for(const src of sourceResults){ for(const row of (src.rows||[])){ const k=sym(row.symbol); if(!map.has(k))continue; const it=map.get(k); it.sources[src.group||src.id]={sourceId:src.id,title:src.title,currentRunOk:!!src.currentRunOk,staleFallback:!!src.staleFallback,row}; } }
  const out=[];
  for(const it of map.values()){
    const r=it.base, sourceKeys=Object.keys(it.sources);
    let score=0; const conf=[]; const reasons=[]; const review=[];
    const corePrice=hasCorePrice(r), precisionRisk=pricePrecisionRisk(r), execPrice=executionPriceOk(r);
    if(corePrice){score+=22; conf.push('price cache'); if(precisionRisk){review.push('يحتاج تأكيد 3 خانات سعرية قبل التنفيذ');}}
    else reasons.push('سعر غير موجود');
    if(validVolume(r)){score+=18; conf.push('volume/value cache');} else reasons.push('حجم/قيمة تداول غير كافية');
    if(validSupport(r)){score+=16; conf.push('support/resistance cache');} else reasons.push('دعم/مقاومة غير مكتملة');
    if(validPlan(r)){score+=16; conf.push('valid plan');} else reasons.push('خطة الدخول/الهدف/الوقف غير مكتملة');
    if(qualityScore(r)>=80){score+=12; conf.push('data quality');} else if(qualityScore(r)>=60){score+=6; conf.push('partial data quality');} else reasons.push('جودة بيانات أقل من المطلوب');
    const externalCurrent=sourceKeys.filter(k=>it.sources[k].currentRunOk).length;
    const externalAny=sourceKeys.length;
    if(externalAny){ score += Math.min(28, externalAny*7 + externalCurrent*3); conf.push(...sourceKeys.map(k=>'external:'+k)); }
    else review.push('لم يظهر في المصادر الخارجية الحالية؛ يعتمد على الكاش الآمن فقط');
    score=Math.max(0,Math.min(100,Math.round(score)));
    const coreSignals=[validVolume(r),validSupport(r),validPlan(r),qualityScore(r)>=60,externalAny>=1].filter(Boolean).length;
    let status='BLOCKED_MISSING_CORE_DATA';
    if(corePrice && score>=MIN_READY_SCORE && coreSignals>=2){
      status = precisionRisk ? 'ANALYSIS_READY_PRICE_REVIEW' : 'ANALYSIS_READY';
    } else if(corePrice){
      status = precisionRisk ? 'WATCH_PRICE_REVIEW' : 'WATCH_NEEDS_EVIDENCE';
    }
    const blocked = status==='BLOCKED_MISSING_CORE_DATA';
    out.push({
      symbol:it.symbol,name:it.name,coverageStatus:status,sourceStrengthScore:score,evidenceScore:score,
      confirmationCount:conf.length,confirmationSources:conf,coreSignalCount:coreSignals,
      priceStatus:corePrice?(precisionRisk?'سعر موجود لكن يحتاج تأكيد 3 خانات قبل التنفيذ':'ok'):'missing',
      executionPriceOk:execPrice,pricePrecisionRisk:!!precisionRisk,
      volumeStatus:validVolume(r)?'بيانات حجم/قيمة متاحة':'حجم/قيمة غير كافية',
      supportStatus:validSupport(r)?'دعم ومقاومة متاحة':'دعم/مقاومة غير مكتملة',
      planStatus:validPlan(r)?'خطة سعرية منطقية':'خطة غير مكتملة',
      sourceCount:sourceKeys.length,currentExternalSourceCount:externalCurrent,sources:it.sources,
      exclusionReason:blocked?reasons.join('، '):review.join('، '),
      basePrice:r.price,baseVolume:r.volume,baseValue:r.valueTraded
    });
  }
  return out.sort((a,b)=>b.sourceStrengthScore-a.sourceStrengthScore||a.symbol.localeCompare(b.symbol));
}
function summarize(rows,total,target,sourceResults,cycles){
  const ready=rows.filter(x=>/^ANALYSIS_READY/.test(x.coverageStatus)).length;
  const watch=rows.filter(x=>/^WATCH/.test(x.coverageStatus)).length;
  const blocked=rows.filter(x=>x.coverageStatus==='BLOCKED_MISSING_CORE_DATA').length;
  const priceReview=rows.filter(x=>x.pricePrecisionRisk).length;
  const executablePriceOk=rows.filter(x=>x.executionPriceOk).length;
  const reasonMap=new Map(); rows.filter(x=>x.coverageStatus!=='ANALYSIS_READY').forEach(x=>{const r=x.exclusionReason||'غير محدد'; for(const p of r.split('،').map(s=>s.trim()).filter(Boolean)){reasonMap.set(p,(reasonMap.get(p)||0)+1)} });
  return {targetCoveragePct:target,totalUniverse:total,reliableSymbols:ready,analysisReadySymbols:ready,reliableCoveragePct:Number((ready/Math.max(1,total)*100).toFixed(1)),watchOnlySymbols:watch,blockedSymbols:blocked,priceReviewSymbols:priceReview,executionPriceOkSymbols:executablePriceOk,attempts:{cycles,totalAttempts:sourceResults.reduce((s,x)=>s+(x.attempt||1),0)},sourcesOk:sourceResults.filter(x=>x.ok).length,currentSourcesOk:sourceResults.filter(x=>x.currentRunOk).length,staleFallbackSources:sourceResults.filter(x=>x.staleFallback).length,totalExternalRows:sourceResults.reduce((s,x)=>s+(x.count||0),0),exclusionReasons:Array.from(reasonMap.entries()).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count).slice(0,20)};
}
async function main(){
  const universe=buildUniverse(); const universeSet=new Set(universe.map(r=>sym(r.symbol)).filter(Boolean));
  const accepted=new Map(); let cycles=0, rows=[];
  for(let cycle=1; cycle<=MAX_CYCLES; cycle++){
    cycles=cycle;
    for(const src of EXTERNAL_SOURCES){
      if(accepted.has(src.id) && accepted.get(src.id).currentRunOk) continue;
      let best=null;
      for(let attempt=1; attempt<=SOURCE_RETRIES; attempt++){
        const r=await fetchOne(src, universeSet, attempt); best = (!best || (r.count||0)>(best.count||0)) ? r : best;
        if(r.ok && r.count>=5) break;
        await sleep(250*attempt);
      }
      if(!best || !best.ok){ const prev=previousGood(src); if(prev) best=prev; }
      if(best) { accepted.set(src.id,best); write(`data/${src.id}.json`,best); if(src.group) write(`data/mubasher-${src.group}.json`,best); }
    }
    rows=mergeEvidence(universe, Array.from(accepted.values()));
    const ready=rows.filter(x=>/^ANALYSIS_READY/.test(x.coverageStatus)).length;
    const pct=ready/Math.max(1,universe.length)*100;
    console.log(`precision-aware coverage cycle ${cycle}: ${pct.toFixed(1)}% (${ready}/${universe.length})`);
    if(pct>=TARGET) break;
  }
  const sourceResults=Array.from(accepted.values());
  rows=rows.length?rows:mergeEvidence(universe, sourceResults);
  const summary=summarize(rows, universe.length, TARGET, sourceResults, cycles);
  const report={ok:summary.reliableCoveragePct>=TARGET,engine:'v9_9_precision_aware_trusted_coverage_loop',generatedAt:RUN_AT,delayed:true,note:'Analysis coverage is separated from execution permission. Sub-pound prices with fewer than 3 decimals can be analysis-ready but remain execution-gated until precision is confirmed.',summary,sources:sourceResults.map(s=>({id:s.id,group:s.group,title:s.title,url:s.url,ok:!!s.ok,currentRunOk:!!s.currentRunOk,staleFallback:!!s.staleFallback,httpStatus:s.httpStatus,count:s.count,error:s.error||'',attempt:s.attempt||1})),rows};
  const mubasher={ok:sourceResults.some(s=>s.ok),engine:'v9_9_mubasher_and_alternative_analysis_tools_loop',generatedAt:RUN_AT,summary:{sources:sourceResults.length,sourcesOk:sourceResults.filter(s=>s.ok).length,currentSourcesOk:sourceResults.filter(s=>s.currentRunOk).length,staleFallbackSources:sourceResults.filter(s=>s.staleFallback).length,totalRows:sourceResults.reduce((s,x)=>s+(x.count||0),0),uniqueSymbols:new Set(rows.filter(x=>x.sourceCount>0).map(x=>x.symbol)).size},sources:report.sources,symbols:rows.map(x=>({symbol:x.symbol,name:x.name,sourceCount:x.sourceCount,currentExternalSourceCount:x.currentExternalSourceCount,sources:x.sources}))};
  write('data/evidence-coverage-loop-status.json',report);
  write('data/mubasher-analysis-tools.json',mubasher);
  console.log('V9.9 precision-aware coverage loop summary', summary);
}
main().catch(e=>{console.error(e); write('data/evidence-coverage-loop-status.json',{ok:false,engine:'v9_9_precision_aware_trusted_coverage_loop',generatedAt:RUN_AT,error:String(e&&e.stack||e)}); process.exitCode=0;});
