#!/usr/bin/env node
/* EGX Pro Hub V10.0 — Apply Real Coverage Recovery to Ranking
   لا يغير السعر أو الدخول أو الهدف أو الوقف. يرفع التحليل/المراقبة فقط ويترك التنفيذ لحاكم السلامة. */
const fs=require('fs'),path=require('path');const RUN_AT=new Date().toISOString();
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n','utf8')}
function rowsOf(x){if(Array.isArray(x))return x;if(Array.isArray(x?.rows))return x.rows;if(Array.isArray(x?.all))return x.all;if(Array.isArray(x?.data))return x.data;return[]}
function sym(v){return String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'').trim()}
function num(v){if(v==null||v==='')return null;let s=String(v).replace(/[,%٬،]/g,'').replace(/−/g,'-').trim().replace(/[^0-9.+\-eE]/g,'');const n=Number(s);return Number.isFinite(n)?n:null}
function finite(v){const x=num(v);return x!=null&&Number.isFinite(x)?x:null}
function rr(r){const p=finite(r.price),t=finite(r.target1),sl=finite(r.stopLoss);if(!p||!t||!sl||p<=sl)return finite(r.rr??r.riskReward)||0;return (t-p)/(p-sl)}
function planValid(r){const p=finite(r.price),e1=finite(r.entryFrom),e2=finite(r.entryTo),t=finite(r.target1),sl=finite(r.stopLoss);return !!(p&&e1&&e2&&t&&sl&&e1<=e2&&e1>=p*.50&&e2<=p*1.60&&t>p*1.001&&sl<p*.999)}
function statusRank(s){s=String(s||'').toUpperCase();if(s==='EXECUTABLE_REVIEW')return 4;if(s==='WATCH_ONLY')return 3;if(s.includes('READY'))return 2;if(s.includes('WATCH'))return 1;return 0}
function gradeRank(g){return {P1:5,P2:4,P3:3,Watch:2,Blocked:0}[String(g||'')]??1}
function main(){const ranking=read('data/final-opportunity-ranking.json',{}),evid=read('data/source-evidence-matrix.json',{});const em={};rowsOf(evid).forEach(x=>{const k=sym(x.symbol);if(k)em[k]=x});
 const rows=rowsOf(ranking).map(r=>{const k=sym(r.symbol),e=em[k]||{};const ev=String(e.finalDataDecision||e.decision||e.coverageStatus||'NO_EVIDENCE').toUpperCase();const score=num(e.sourceStrengthScore||e.evidenceScore)||0;const conf=num(e.confirmationCount??e.confirmations)||0;const out={...r,sourceStrengthScore:score||r.sourceStrengthScore,sourceConfirmationCount:conf,sourceEvidenceDecision:ev,coverageStatus:e.coverageStatus||ev,coverageReason:e.exclusionReason||e.reason||'',coverageLoopEngine:'v10_0_real_coverage_recovery_apply',coverageLoopAppliedAt:RUN_AT};
   const pValid=planValid(r), rrv=rr(r), prob=num(r.targetProbability||r.probability||r.finalConfidence)||0;let safety=num(r.safetyGovernorScore||r.finalScore||r.score||prob)||0;if(score)safety=Math.round(safety*.72+score*.28);out.safetyGovernorScore=safety;out.finalScore=safety;
   const analysisReady=/ANALYSIS_READY|TRUSTED/.test(ev), watchReady=/WATCH/.test(ev), priceReview=!!(e.pricePrecisionRisk||ev.includes('PRICE_REVIEW'));
   if(analysisReady&&score>=65&&pValid&&rrv>=0.85&&prob>=65&&!priceReview&&String(r.safetyGovernorStatus||'')!=='BLOCKED'){
     if(safety>=82){out.grade='P1';out.safetyGovernorStatus='EXECUTABLE_REVIEW';out.executionAllowed=true}
     else if(safety>=74){out.grade='P2';out.safetyGovernorStatus='EXECUTABLE_REVIEW';out.executionAllowed=true}
     else{if(String(out.grade)==='Blocked')out.grade='P3';out.safetyGovernorStatus='WATCH_ONLY';out.executionAllowed=false}
   }else if(analysisReady||watchReady){
     if(String(out.grade)==='Blocked')out.grade='P3'; if(String(out.grade)==='P1'||String(out.grade)==='P2')out.grade='P3'; out.safetyGovernorStatus='WATCH_ONLY';out.executionAllowed=false;out.executionNote=priceReview?'تحليل/مراقبة فقط: التنفيذ موقوف حتى تأكيد السعر.':'تحليل/مراقبة فقط: يحتاج استكمال شروط التنفيذ.';
   }else{out.executionAllowed=false;if(String(out.grade)==='P1'||String(out.grade)==='P2')out.grade='P3';out.safetyGovernorStatus='WATCH_ONLY'}
   return out;
 }).sort((a,b)=>statusRank(b.safetyGovernorStatus)-statusRank(a.safetyGovernorStatus)||gradeRank(b.grade)-gradeRank(a.grade)||(num(b.finalScore)-num(a.finalScore))||(num(b.sourceStrengthScore)-num(a.sourceStrengthScore)));
 const summary={total:rows.length,executable:rows.filter(x=>x.executionAllowed).length,watchOnly:rows.filter(x=>x.safetyGovernorStatus==='WATCH_ONLY').length,blocked:rows.filter(x=>String(x.grade)==='Blocked'||x.safetyGovernorStatus==='BLOCKED').length,analysisReady:rows.filter(x=>/ANALYSIS_READY|TRUSTED/.test(String(x.sourceEvidenceDecision))).length,avgSourceStrength:Math.round(rows.reduce((s,x)=>s+(num(x.sourceStrengthScore)||0),0)/Math.max(1,rows.length)),coverageTargetPct:evid.summary?.targetCoveragePct||80,coveragePct:evid.summary?.reliableCoveragePct||0};
 const out={...ranking,ok:true,engine:'v10_0_final_ranking_with_real_coverage_recovery',generatedAt:RUN_AT,summary,rows,note:'V10 improves analysis/watch coverage using internal cache evidence without weakening execution safety.'};write('data/final-multisource-ranking.json',out);write('data/final-opportunity-ranking.json',out);write('data/coverage-loop-application-report.json',{ok:true,engine:'v10_0_real_coverage_recovery_apply',generatedAt:RUN_AT,summary,rows:rows.map(x=>({symbol:x.symbol,name:x.name||x.name_ar,grade:x.grade,status:x.safetyGovernorStatus,executionAllowed:x.executionAllowed,sourceStrengthScore:x.sourceStrengthScore,confirmationCount:x.sourceConfirmationCount,coverageStatus:x.coverageStatus,reason:x.coverageReason}))});console.log('V10 coverage applied',summary)}
main();
