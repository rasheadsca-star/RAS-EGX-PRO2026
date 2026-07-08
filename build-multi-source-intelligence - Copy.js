#!/usr/bin/env node
/* EGX Pro Hub V9.9 — Build Source Evidence Matrix from Precision-Aware Coverage Loop */
const fs=require('fs'), path=require('path');
const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function rowsOf(x){if(Array.isArray(x))return x;if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.all))return x.all;if(Array.isArray(x?.data))return x.data;return[]}
function sym(v){return String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim()}
function num(v){if(v==null||v==='')return null;let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim().replace(/[^0-9.+\-eE]/g,'');const n=Number(s);return Number.isFinite(n)?n:null}
function mapBase(){const all=[...rowsOf(read('data/full-market-cache.json',{})),...rowsOf(read('data/market.json',{})),...rowsOf(read('data/recommendations.json',{}))];const m={};for(const r of all){const k=sym(r.symbol||r.ticker||r.code);if(k)m[k]={...(m[k]||{}),...r,symbol:k}}return m}
function matrixDecision(r){
  const score=num(r.sourceStrengthScore||r.evidenceScore)||0;
  const st=String(r.coverageStatus||'').toUpperCase();
  if(st==='ANALYSIS_READY' && score>=75) return 'TRUSTED_ANALYSIS_READY';
  if(st==='ANALYSIS_READY_PRICE_REVIEW' && score>=60) return 'ANALYSIS_READY_PRICE_REVIEW';
  if(st.includes('ANALYSIS_READY')) return 'ANALYSIS_READY';
  if(st.includes('WATCH')) return st;
  return 'BLOCKED_MISSING_CORE_DATA';
}
function main(){
 const coverage=read('data/evidence-coverage-loop-status.json',{}); const base=mapBase();
 let rows=rowsOf(coverage).map(x=>{const b=base[sym(x.symbol)]||{}; const conf=Array.isArray(x.confirmationSources)?x.confirmationSources:[]; const d=matrixDecision(x); return {...x,name:x.name||b.name_ar||b.name||'',price:b.price,volume:b.volume,valueTraded:b.valueTraded,sector:b.sector||b.sector_ar||'غير مصنف',finalDataDecision:d,decision:d,level:d,sourceStrengthScore:num(x.sourceStrengthScore)||0,evidenceScore:num(x.evidenceScore||x.sourceStrengthScore)||0,confirmationCount:num(x.confirmationCount)||conf.length,confirmationSources:conf,sourceQuality:{price:x.priceStatus,volume:x.volumeStatus,support:x.supportStatus,plan:x.planStatus},reason:x.exclusionReason||''}});
 const total=coverage.summary?.totalUniverse || Object.keys(base).length || rows.length;
 const ready=rows.filter(x=>/ANALYSIS_READY|TRUSTED/.test(x.finalDataDecision)).length;
 const priceReview=rows.filter(x=>x.pricePrecisionRisk || String(x.finalDataDecision).includes('PRICE_REVIEW')).length;
 const blocked=rows.filter(x=>String(x.finalDataDecision).includes('BLOCK')).length;
 const watch=rows.filter(x=>String(x.finalDataDecision).includes('WATCH')).length;
 const summary={...(coverage.summary||{}),totalUniverse:total,analysisReadySymbols:ready,reliableSymbols:ready,reliableCoveragePct:Number((ready/Math.max(1,total)*100).toFixed(1)),targetCoveragePct:coverage.summary?.targetCoveragePct||80,watchOnlySymbols:watch,blockedSymbols:blocked,priceReviewSymbols:priceReview,avgSourceStrength:Math.round(rows.reduce((s,x)=>s+(num(x.sourceStrengthScore)||0),0)/Math.max(1,rows.length)),avgConfirmations:Number((rows.reduce((s,x)=>s+(num(x.confirmationCount)||0),0)/Math.max(1,rows.length)).toFixed(1))};
 rows=rows.sort((a,b)=>(num(b.sourceStrengthScore)-num(a.sourceStrengthScore))||a.symbol.localeCompare(b.symbol));
 const out={ok:summary.reliableCoveragePct>=summary.targetCoveragePct,engine:'v9_9_precision_aware_source_evidence_matrix_builder',generatedAt:RUN_AT,summary,rows,note:'V9.9 separates analysis coverage from execution. Price precision review symbols can be analyzed but remain execution-gated.'};
 write('data/source-evidence-matrix.json',out); write('data/multi-source-intelligence.json',out); console.log('V9.9 evidence matrix', summary);
}
main();
