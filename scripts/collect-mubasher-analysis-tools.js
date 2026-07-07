#!/usr/bin/env node
/* EGX Pro Hub V10.0 — Real Coverage Recovery Engine
   الهدف: استخدام الكاش الداخلي + مصادر مباشر/بدائل للوصول إلى 80%+ قابل للتحليل.
   لا يجعل السهم قابلًا للتنفيذ؛ التنفيذ يظل تحت حاكم السلامة. */
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
const TARGET=Number(process.env.EGX_TRUSTED_COVERAGE_TARGET||80);
const MAX_CYCLES=Number(process.env.EGX_COVERAGE_MAX_CYCLES||5);
const SOURCE_RETRIES=Number(process.env.EGX_SOURCE_RETRIES||3);
const TIMEOUT_MS=Number(process.env.EGX_SOURCE_FETCH_TIMEOUT_MS||45000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const EXTERNAL_SOURCES=[
 {id:'mubasherVolume',group:'volume',title:'Mubasher Volume Monitor',url:'https://www.mubasher.info/analysis-tools/volume-monitor/EGX'},
 {id:'mubasherLiquidity',group:'liquidity',title:'Mubasher Liquidity Monitor',url:'https://www.mubasher.info/analysis-tools/liquidity-monitor/EGX'},
 {id:'mubasherSupportResistance',group:'supportResistance',title:'Mubasher Support & Resistance',url:'https://www.mubasher.info/analysis-tools/stocks-support-resistance/EGX'},
 {id:'mubasherFinancialRatios',group:'financialRatios',title:'Mubasher Financial Ratios',url:'https://www.mubasher.info/analysis-tools/financial-ratios/EGX'},
 {id:'mubasherMarketStocks',group:'market',title:'Mubasher EGX Market Stocks',url:'https://www.mubasher.info/markets/EGX/stocks'},
 {id:'mubasherPrices',group:'priceBoard',title:'Mubasher EGX Price Board',url:'https://www.mubasher.info/markets/EGX'}
];
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function rowsOf(x){if(Array.isArray(x))return x;if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.all))return x.all;if(Array.isArray(x?.data))return x.data;if(Array.isArray(x?.items))return x.items;return[]}
function sym(v){return String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim()}
function clean(s){return String(s==null?'':s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim()}
function stripTags(s){return clean(String(s||'').replace(/<[^>]*>/g,' '))}
function num(v){if(v==null||v==='')return null;let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim();let mult=1;if(/[Kk]$/.test(s)){mult=1e3;s=s.slice(0,-1)}if(/[Mm]$/.test(s)){mult=1e6;s=s.slice(0,-1)}if(/[Bb]$/.test(s)){mult=1e9;s=s.slice(0,-1)}s=s.replace(/[^0-9.+\-eE]/g,'');const n=Number(s);return Number.isFinite(n)?n*mult:null}
function finite(v){const x=num(v);return x!=null&&Number.isFinite(x)?x:null}
function decs(v){const s=String(v??'');const m=s.match(/\.(\d+)/);return m?m[1].length:0}
function nameOf(r){return r.name_ar||r.nameAr||r.arabicName||r.name||r.name_en||r.companyName||r.symbol||r.ticker||''}
function sourceRows(f){return rowsOf(read(f,{}))}
function buildUniverse(){
 const sources=[sourceRows('data/full-market-cache.json'),sourceRows('data/market.json'),sourceRows('data/recommendations.json'),sourceRows('data/final-opportunity-ranking.json'),sourceRows('data/final-multisource-ranking.json')];
 const map=new Map();
 for(const arr of sources){for(const r of arr){const k=sym(r.symbol||r.ticker||r.code);if(!k)continue;const old=map.get(k)||{};map.set(k,{...old,...r,symbol:k,name:nameOf(r)||nameOf(old)||k});}}
 return Array.from(map.values()).sort((a,b)=>a.symbol.localeCompare(b.symbol));
}
function price(r){return finite(r.price??r.lastPrice??r.last??r.close??r.currentPrice??r.marketPrice)}
function volume(r){return finite(r.volume??r.tradedVolume??r.vol??r.quantity)}
function value(r){return finite(r.valueTraded??r.turnover??r.tradedValue??r.value??r.marketValue)}
function support(r){return finite(r.support1??r.support??r.s1??r.nearestSupport)}
function resistance(r){return finite(r.resistance1??r.resistance??r.r1??r.nearestResistance)}
function entry1(r){return finite(r.entryFrom??r.entryLow??r.entry_from)}
function entry2(r){return finite(r.entryTo??r.entryHigh??r.entry_to)}
function target1(r){return finite(r.target1??r.t1)}
function target2(r){return finite(r.target2??r.t2)}
function stop(r){return finite(r.stopLoss??r.stop_loss??r.sl)}
function quality(r){return Math.max(0,Math.min(100,finite(r.dataQualityScore??r.finalConfidence??r.confidence??r.score)??0))}
function hasPrice(r){const p=price(r);return !!(p&&p>0)}
function precisionRisk(r){const p=price(r);if(!p||p<=0)return true;return p<1&&Math.max(decs(r.price),decs(r.priceDisplay),decs(r.lastPrice),decs(r.last),decs(p))<3}
function hasVolumeValue(r){return !!((volume(r)||0)>0||(value(r)||0)>0)}
function hasSupportResistance(r){const p=price(r),s=support(r),res=resistance(r);return !!(p&&s&&res&&s>0&&res>0&&s<p*1.50&&res>p*.55)}
function hasPlan(r){const p=price(r),a=entry1(r),b=entry2(r),t=target1(r),sl=stop(r);if(!p||!a||!b||!t||!sl)return false;return a<=b&&a>=p*.50&&b<=p*1.60&&t>p*1.001&&sl<p*.999}
function hasAnyTechnical(r){return hasSupportResistance(r)||hasPlan(r)||!!(target1(r)&&stop(r))}
function symbolFromRow(rowHtml,universeSet){
 const patterns=[/href=["'][^"']*\/(?:stocks|companies|securities)\/([A-Z0-9.]+)(?:\.CA)?[^"']*["']/i,/\/markets\/EGX\/stocks\/([A-Z0-9.]+)(?:\.CA)?/i,/data-symbol=["']([A-Z0-9.]+)["']/i,/\b([A-Z]{2,7})(?:\.CA)?\b/g];
 for(const re of patterns){if(re.global){let m;while((m=re.exec(rowHtml))){const k=sym(m[1]);if(k&&(!universeSet.size||universeSet.has(k)))return k}}else{const m=rowHtml.match(re);const k=sym(m&&m[1]);if(k&&(!universeSet.size||universeSet.has(k)))return k}}
 return '';
}
function numbersFromCells(cells){const out=[];for(const cell of cells){const re=/[+\-]?\d+(?:[.,]\d+)?\s*[%٪]?/g;let m;while((m=re.exec(cell))&&out.length<20)out.push({raw:m[0],value:num(m[0]),isPercent:/[%٪]/.test(m[0])});}return out}
function parseHtmlRows(html,source,universeSet){
 const rows=[];const trRe=/<tr[\s\S]*?<\/tr>/gi;let m,idx=0;
 while((m=trRe.exec(html))&&rows.length<2000){const tr=m[0];const k=symbolFromRow(tr,universeSet);if(!k)continue;idx++;const cells=[...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>stripTags(x[1])).filter(Boolean);rows.push({symbol:k,sourceId:source.id,group:source.group,rowIndex:idx,name:cells[0]||k,cells,numeric:numbersFromCells(cells),rowText:stripTags(tr)});}
 if(rows.length)return rows;
 const text=stripTags(html);const re=/\b([A-Z]{2,7})(?:\.CA)?\b([^A-Z]{0,260})/g;let mm;
 while((mm=re.exec(text))&&rows.length<1500){const k=sym(mm[1]);if(!k||(universeSet.size&&!universeSet.has(k)))continue;const chunk=(mm[1]+(mm[2]||'')).slice(0,420);rows.push({symbol:k,sourceId:source.id,group:source.group,rowIndex:rows.length+1,name:k,cells:[chunk],numeric:numbersFromCells([chunk]),rowText:chunk,fallback:true});}
 return rows;
}
async function fetchOne(source,universeSet,attempt){const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),TIMEOUT_MS);try{const res=await fetch(source.url,{signal:controller.signal,headers:{'user-agent':'Mozilla/5.0 EGX-Pro-Hub/10.0 RealCoverageRecovery','accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','accept-language':'ar,en;q=0.8','cache-control':'no-cache'}});const text=await res.text();const rows=parseHtmlRows(text,source,universeSet);return{ok:rows.length>0,currentRunOk:res.ok,attempt,generatedAt:RUN_AT,id:source.id,group:source.group,title:source.title,url:source.url,httpStatus:res.status,count:rows.length,rows,error:rows.length?'':`no rows parsed; status ${res.status}`}}catch(e){return{ok:false,currentRunOk:false,attempt,generatedAt:RUN_AT,id:source.id,group:source.group,title:source.title,url:source.url,count:0,rows:[],error:String(e&&e.message||e)}}finally{clearTimeout(timeout)}}
function previousGood(source){const old=read(`data/${source.id}.json`,null)||read(`data/mubasher-${source.group}.json`,null);if(old&&Array.isArray(old.rows)&&old.rows.length){return{...old,id:source.id,group:source.group,title:source.title,url:source.url,ok:true,currentRunOk:false,staleFallback:true,count:old.rows.length,generatedAt:old.generatedAt||RUN_AT,error:old.error||'current source unavailable; preserved last good rows'}}return null}
function mergeEvidence(universe,sourceResults){
 const map=new Map();for(const r of universe){const k=sym(r.symbol);if(k)map.set(k,{symbol:k,name:nameOf(r)||k,base:r,sources:{}})}
 for(const src of sourceResults){for(const row of (src.rows||[])){const k=sym(row.symbol);if(!map.has(k))continue;const it=map.get(k);it.sources[src.group||src.id]={sourceId:src.id,title:src.title,currentRunOk:!!src.currentRunOk,staleFallback:!!src.staleFallback,row};}}
 const out=[];
 for(const it of map.values()){
   const r=it.base, sourceKeys=Object.keys(it.sources);let score=0;const conf=[],reasons=[],review=[];
   const p=hasPrice(r), pr=precisionRisk(r), vv=hasVolumeValue(r), sr=hasSupportResistance(r), pl=hasPlan(r), tech=hasAnyTechnical(r), q=quality(r);
   if(p){score+=28;conf.push('internal:price');if(pr)review.push('السعر أقل من جنيه ويحتاج تأكيد 3 خانات قبل التنفيذ')}else reasons.push('سعر غير موجود');
   if(vv){score+=22;conf.push('internal:volume/value')}else reasons.push('حجم أو قيمة تداول غير متاحة');
   if(sr){score+=18;conf.push('internal:support/resistance')}else if(tech){score+=10;conf.push('internal:partial technical')}else reasons.push('دعم/مقاومة غير متاحة');
   if(pl){score+=18;conf.push('internal:valid plan')}else if(target1(r)&&stop(r)){score+=8;conf.push('internal:partial plan')}else reasons.push('خطة دخول/هدف/وقف غير مكتملة');
   if(q>=80){score+=12;conf.push('internal:data quality')}else if(q>=60){score+=6;conf.push('internal:partial quality')}else reasons.push('جودة بيانات ضعيفة أو غير محددة');
   const currentExternal=sourceKeys.filter(k=>it.sources[k].currentRunOk).length; const externalAny=sourceKeys.length;
   if(externalAny){score+=Math.min(24,externalAny*5+currentExternal*3);conf.push(...sourceKeys.map(k=>'external:'+k));}else review.push('لا يوجد مصدر خارجي مباشر حاليًا؛ تم الاعتماد على الكاش الداخلي');
   score=Math.max(0,Math.min(100,Math.round(score)));
   const internalSignals=[p,vv,sr||tech,pl||target1(r),q>=60].filter(Boolean).length;
   let status='BLOCKED_MISSING_CORE_DATA';
   if(p && (vv||tech||pl||q>=60)) status=pr?'ANALYSIS_READY_PRICE_REVIEW':'ANALYSIS_READY_INTERNAL_CACHE';
   else if(p) status=pr?'WATCH_PRICE_REVIEW':'WATCH_NEEDS_EVIDENCE';
   else if((vv&&tech)||(pl&&vv)||externalAny>=2) status='WATCH_NEEDS_PRICE';
   const blocked=status==='BLOCKED_MISSING_CORE_DATA';
   out.push({symbol:it.symbol,name:it.name,coverageStatus:status,sourceStrengthScore:score,evidenceScore:score,confirmationCount:conf.length,confirmations:conf.length,confirmationSources:conf,evidenceSources:conf,coreSignalCount:internalSignals,internalCacheUsed:p||vv||tech||pl,cacheExtracted:!!(p||vv||tech||pl),cacheEvidenceCount:[p,vv,tech,pl,q>=60].filter(Boolean).length,priceStatus:p?(pr?'سعر موجود لكن التنفيذ يحتاج 3 خانات':'ok'):'missing',executionPriceOk:p&&!pr,pricePrecisionRisk:!!pr,volumeStatus:vv?'حجم/قيمة من الكاش':'ناقص',supportStatus:sr?'دعم/مقاومة من الكاش':(tech?'فني جزئي من الكاش':'ناقص'),planStatus:pl?'خطة سعرية منطقية':(target1(r)&&stop(r)?'خطة جزئية':'ناقص'),sourceCount:sourceKeys.length,currentExternalSourceCount:currentExternal,sources:it.sources,exclusionReason:blocked?reasons.join('، '):review.join('، '),basePrice:price(r),baseVolume:volume(r),baseValue:value(r)});
 }
 return out.sort((a,b)=>b.sourceStrengthScore-a.sourceStrengthScore||a.symbol.localeCompare(b.symbol));
}
function summarize(rows,total,target,sourceResults,cycles){
 const ready=rows.filter(x=>/^ANALYSIS_READY/.test(x.coverageStatus)).length;
 const watch=rows.filter(x=>/^WATCH/.test(x.coverageStatus)).length;
 const blocked=rows.filter(x=>x.coverageStatus==='BLOCKED_MISSING_CORE_DATA').length;
 const analyzable=ready+watch;
 const cache=rows.filter(x=>x.internalCacheUsed||x.cacheExtracted).length;
 const reasonMap=new Map();rows.filter(x=>x.coverageStatus==='BLOCKED_MISSING_CORE_DATA').forEach(x=>{const r=x.exclusionReason||'غير محدد';for(const p of r.split('،').map(s=>s.trim()).filter(Boolean)){reasonMap.set(p,(reasonMap.get(p)||0)+1)}});
 return {targetCoveragePct:target,totalUniverse:total,analysisReadySymbols:ready,watchOnlySymbols:watch,analyzableSymbols:analyzable,blockedSymbols:blocked,reliableSymbols:analyzable,reliableCoveragePct:Number((analyzable/Math.max(1,total)*100).toFixed(1)),analysisReadyCoveragePct:Number((ready/Math.max(1,total)*100).toFixed(1)),cacheExtractedSymbols:cache,avgSourceStrength:Math.round(rows.reduce((s,x)=>s+(num(x.sourceStrengthScore)||0),0)/Math.max(1,rows.length)),avgConfirmations:Number((rows.reduce((s,x)=>s+(num(x.confirmationCount)||0),0)/Math.max(1,rows.length)).toFixed(1)),attempts:{cycles,totalAttempts:sourceResults.reduce((s,x)=>s+(x.attempt||1),0)},sourcesOk:sourceResults.filter(x=>x.ok).length,currentSourcesOk:sourceResults.filter(x=>x.currentRunOk).length,staleFallbackSources:sourceResults.filter(x=>x.staleFallback).length,totalExternalRows:sourceResults.reduce((s,x)=>s+(x.count||0),0),exclusionReasons:Array.from(reasonMap.entries()).map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count).slice(0,20)};
}
async function main(){
 const universe=buildUniverse(); const universeSet=new Set(universe.map(r=>sym(r.symbol)).filter(Boolean));
 const accepted=new Map(); let rows=[],cycles=0;
 for(let cycle=1;cycle<=MAX_CYCLES;cycle++){
   cycles=cycle;
   for(const src of EXTERNAL_SOURCES){
     if(accepted.has(src.id)&&accepted.get(src.id).currentRunOk)continue;
     let best=null; for(let a=1;a<=SOURCE_RETRIES;a++){const r=await fetchOne(src,universeSet,a);best=(!best||(r.count||0)>(best.count||0))?r:best;if(r.ok&&r.count>=5)break;await sleep(250*a)}
     if(!best||!best.ok){const prev=previousGood(src);if(prev)best=prev}
     if(best){accepted.set(src.id,best);write(`data/${src.id}.json`,best);if(src.group)write(`data/mubasher-${src.group}.json`,best)}
   }
   rows=mergeEvidence(universe,Array.from(accepted.values())); const s=summarize(rows,universe.length,TARGET,Array.from(accepted.values()),cycles);
   console.log(`V10 coverage cycle ${cycle}: ${s.reliableCoveragePct}% (${s.analyzableSymbols}/${s.totalUniverse}) ready=${s.analysisReadySymbols} watch=${s.watchOnlySymbols} blocked=${s.blockedSymbols}`);
   if(s.reliableCoveragePct>=TARGET)break;
 }
 const sourceResults=Array.from(accepted.values()); rows=rows.length?rows:mergeEvidence(universe,sourceResults); const summary=summarize(rows,universe.length,TARGET,sourceResults,cycles);
 const report={ok:summary.reliableCoveragePct>=TARGET,engine:'v10_0_real_coverage_recovery_engine',generatedAt:RUN_AT,delayed:true,note:'V10 uses internal cache as valid analysis evidence and separates analysis/watch coverage from executable trading permission.',summary,sources:sourceResults.map(s=>({id:s.id,group:s.group,title:s.title,url:s.url,ok:!!s.ok,currentRunOk:!!s.currentRunOk,staleFallback:!!s.staleFallback,httpStatus:s.httpStatus,count:s.count,error:s.error||'',attempt:s.attempt||1})),rows};
 const mubasher={ok:sourceResults.some(s=>s.ok),engine:'v10_0_mubasher_alternative_sources_loop',generatedAt:RUN_AT,summary:{sources:sourceResults.length,sourcesOk:sourceResults.filter(s=>s.ok).length,currentSourcesOk:sourceResults.filter(s=>s.currentRunOk).length,staleFallbackSources:sourceResults.filter(s=>s.staleFallback).length,totalRows:sourceResults.reduce((s,x)=>s+(x.count||0),0),uniqueSymbols:new Set(rows.filter(x=>x.sourceCount>0).map(x=>x.symbol)).size},sources:report.sources,symbols:rows.map(x=>({symbol:x.symbol,name:x.name,sourceCount:x.sourceCount,currentExternalSourceCount:x.currentExternalSourceCount,sources:x.sources}))};
 write('data/evidence-coverage-loop-status.json',report); write('data/mubasher-analysis-tools.json',mubasher); console.log('V10 real coverage recovery summary',summary);
}
main().catch(e=>{console.error(e);write('data/evidence-coverage-loop-status.json',{ok:false,engine:'v10_0_real_coverage_recovery_engine',generatedAt:RUN_AT,error:String(e&&e.stack||e)});process.exitCode=0});
