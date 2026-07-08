#!/usr/bin/env node
/* EGX Pro Hub V11.1 — Trade Plan Validator */
const fs=require('fs'); const path=require('path');
function read(f,fb){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return fb}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')}
function arr(x){return Array.isArray(x)?x:[]}
function key(s){return String(s||'').trim().toUpperCase()}
function num(v,d=0){if(v===null||v===undefined||v==='')return d;const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:d}
function round(v,dp=2){const m=10**dp;return Math.round(num(v,0)*m)/m}
function pick(...xs){for(const x of xs){if(x!==undefined&&x!==null&&x!=='')return x}return null}
function mapRows(rows){const m={};arr(rows).forEach(r=>{const k=key(r.symbol||r.ticker||r.code);if(k)m[k]=r});return m}
function validate(r, price){
 const p=num(price,0); let entryFrom=num(pick(r.entryFrom,r.entryLow,r.entry_low,r.buyFrom),0), entryTo=num(pick(r.entryTo,r.entryHigh,r.entry_high,r.buyTo),0), target1=num(pick(r.target1,r.target,r.firstTarget,r.tp1),0), target2=num(pick(r.target2,r.tp2),0), stopLoss=num(pick(r.stopLoss,r.stop_loss,r.sl),0);
 const errors=[]; if(entryFrom&&entryTo&&entryFrom>entryTo){const t=entryFrom;entryFrom=entryTo;entryTo=t}
 if(!p||p<=0)errors.push('لا يوجد سعر نهائي صالح'); if(!entryFrom||!entryTo||!target1||!stopLoss)errors.push('خطة الدخول/الهدف/الوقف غير مكتملة');
 [entryFrom,entryTo,target1,target2||target1,stopLoss].filter(Boolean).forEach(v=>{if(v<=0)errors.push('الخطة تحتوي رقمًا صفرًا أو سالبًا')});
 const entryMid=entryFrom&&entryTo?(entryFrom+entryTo)/2:0;
 if(p&&[entryFrom,entryTo,target1,target2||target1,stopLoss].filter(Boolean).some(v=>v<p*.70||v>p*1.30))errors.push('الخطة تحتوي رقمًا بعيدًا أكثر من 30% عن السعر');
 if(p&&entryFrom&&entryTo&&((entryTo-entryFrom)/p*100)>5)errors.push('نطاق الدخول أوسع من 5% من السعر');
 if(entryMid&&stopLoss&&stopLoss>=entryMid)errors.push('وقف الخسارة أعلى من أو يساوي متوسط الدخول');
 if(entryMid&&target1&&target1<=entryMid)errors.push('الهدف الأول أقل من أو يساوي متوسط الدخول');
 const riskPct=entryMid&&stopLoss?Math.max(0,(entryMid-stopLoss)/entryMid*100):0; const rewardPct=entryMid&&target1?Math.max(0,(target1-entryMid)/entryMid*100):0; const riskReward=riskPct>0?rewardPct/riskPct:0;
 if(riskReward>0&&riskReward<1.5)errors.push('العائد/المخاطرة أقل من 1.5');
 const entryDistancePct=p&&entryFrom&&entryTo?(p<entryFrom?(entryFrom-p)/entryFrom*100:p>entryTo?(p-entryTo)/entryTo*100:0):null;
 return {planValid:errors.length===0,planErrors:[...new Set(errors)],entryFrom:entryFrom||null,entryTo:entryTo||null,entryMid:entryMid?round(entryMid,3):null,target1:target1||null,target2:target2||null,stopLoss:stopLoss||null,rewardPct:round(rewardPct,2),riskPct:round(riskPct,2),riskReward:round(riskReward,2),entryDistancePct:entryDistancePct===null?null:round(entryDistancePct,2),insideOrNearEntry:entryDistancePct!==null&&entryDistancePct<=1};
}
function main(){
 const now=new Date().toISOString(); const rec=read('data/recommendations.json',{all:[]}); const ranking=read('data/final-opportunity-ranking.json',{rows:[]}); const market=read('data/market.json',{rows:[]}); const truth=read('data/price-truth-layer.json',{rows:[]});
 const rm=mapRows(rec.all), rk=mapRows(ranking.rows), mm=mapRows(market.rows), tm=mapRows(truth.rows); const symbols=[...new Set([...Object.keys(rm),...Object.keys(rk),...Object.keys(mm),...Object.keys(tm)])].sort();
 const rows=symbols.map(sym=>{const r={...(rm[sym]||{}),...(rk[sym]||{})}; const price=num(tm[sym]?.price ?? mm[sym]?.price ?? r.price,0); const v=validate(r,price); return {symbol:sym,name:r.name_ar||r.name||mm[sym]?.name_ar||'',price,sourceGrade:r.grade||'',...v,executionPlanOk:v.planValid&&v.riskReward>=1.5,displayAllowed:v.planValid,reason:v.planValid?'خطة تداول منطقية وقابلة للمراجعة':'الخطة مخفية من التوصية حتى تصحيح الأخطاء'};}).sort((a,b)=>Number(b.executionPlanOk)-Number(a.executionPlanOk)||b.riskReward-a.riskReward);
 const errorCounts={}; rows.forEach(r=>r.planErrors.forEach(e=>errorCounts[e]=(errorCounts[e]||0)+1));
 const summary={total:rows.length,valid:rows.filter(r=>r.planValid).length,invalid:rows.filter(r=>!r.planValid).length,executionPlanOk:rows.filter(r=>r.executionPlanOk).length,avgRiskReward:rows.length?round(rows.reduce((a,r)=>a+(r.riskReward||0),0)/rows.length,2):0,errorCounts};
 write('data/trade-plan-validation-report.json',{ok:true,engine:'v11_1_trade_plan_validator',generatedAt:now,summary,rows,note:'Targets/stops must be displayed only when planValid=true. Invalid or illogical plans cannot produce BUY.'}); console.log('V11.1 Trade Plan Validator',summary);
}
main();
