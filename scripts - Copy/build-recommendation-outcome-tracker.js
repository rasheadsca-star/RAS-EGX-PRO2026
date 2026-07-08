#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.2 — Recommendation Outcome Tracker
  Tracks whether signals later hit target/stop using future workflow snapshots.
  Output: data/recommendation-outcome-tracker.json
*/
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function readJson(rel,f){try{const p=path.join(ROOT,rel);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;}catch{return f;}}
function writeJson(rel,d){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n','utf8');}
function num(v,d=0){const n=Number(String(v??'').replace(/,/g,'').replace(/%/g,''));return Number.isFinite(n)?n:d;}
function round(n,dp=2){const m=10**dp;return Math.round(num(n)*m)/m;}
const previous=readJson('data/recommendation-outcome-tracker.json',{signals:[]});
const aw=readJson('data/actionable-watchlist.json',{rows:[]});
const now=new Date().toISOString();
const prevMap=new Map((previous.signals||[]).map(s=>[s.id,s]));
function makeId(r){return `${r.symbol}|${r.entryLow}|${r.entryHigh}|${r.target1}|${r.stopLoss}`;}
function statusOf(s, price){
  if (!price) return s.status || 'open';
  if (num(s.stopLoss) && price <= num(s.stopLoss)) return 'stop_hit';
  if (num(s.target2) && price >= num(s.target2)) return 'target2_hit';
  if (num(s.target1) && price >= num(s.target1)) return 'target1_hit';
  return s.status && s.status !== 'open' ? s.status : 'open';
}
const signals=[];
for(const r of (aw.rows||[]).filter(x=>['A+','A','B'].includes(x.tier))){
  const id=makeId(r); const price=num(r.price); let s=prevMap.get(id);
  if(!s){
    s={id, symbol:r.symbol, name:r.name, openedAt:now, firstPrice:price, entryLow:r.entryLow, entryHigh:r.entryHigh, target1:r.target1, target2:r.target2, stopLoss:r.stopLoss, riskReward:r.riskReward, initialTier:r.tier, initialConfidence:r.confidence, initialScore:r.compositeScore, status:'open', maxFavorablePct:0, maxAdversePct:0, observations:0};
  }
  s.lastSeenAt=now; s.lastPrice=price; s.lastTier=r.tier; s.lastConfidence=r.confidence; s.lastScore=r.compositeScore; s.observations=(s.observations||0)+1;
  const base=num(s.firstPrice)||price;
  if(base && price){
    const ret=round(((price-base)/base)*100,2);
    s.currentReturnPct=ret;
    s.maxFavorablePct=Math.max(num(s.maxFavorablePct),ret);
    s.maxAdversePct=Math.min(num(s.maxAdversePct),ret);
  }
  s.status=statusOf(s, price);
  if(s.status!=='open' && !s.closedAt) s.closedAt=now;
  signals.push(s);
}
// keep previous signals not present today for continuity, up to 300 closed/open records
for(const old of previous.signals||[]){
  if(!signals.find(s=>s.id===old.id)) signals.push(old);
}
signals.sort((a,b)=> String(b.lastSeenAt||b.openedAt).localeCompare(String(a.lastSeenAt||a.openedAt)));
const open=signals.filter(s=>s.status==='open'); const t1=signals.filter(s=>s.status==='target1_hit'); const t2=signals.filter(s=>s.status==='target2_hit'); const stop=signals.filter(s=>s.status==='stop_hit');
const closed=[...t1,...t2,...stop];
const summary={totalSignals:signals.length,open:open.length,target1Hit:t1.length,target2Hit:t2.length,stopHit:stop.length,closed:closed.length,winRateClosedPct: closed.length? round(((t1.length+t2.length)/closed.length)*100,1): null, avgCurrentReturnPct: open.length? round(open.reduce((a,s)=>a+num(s.currentReturnPct),0)/open.length,2): null};
writeJson('data/recommendation-outcome-tracker.json',{ok:true,engine:'v8_9_2_recommendation_outcome_tracker',generatedAt:now,summary,signals:signals.slice(0,500),note:'يقيس أداء الإشارات مع مرور تشغيلات Workflow اللاحقة. لا يحكم على التوصية من أول جلسة فقط.'});
console.log(`Recommendation outcome tracker generated: ${signals.length} signals`);
