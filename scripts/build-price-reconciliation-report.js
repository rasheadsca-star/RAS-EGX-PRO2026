#!/usr/bin/env node
/*
  EGX Pro Hub V8.9.7 — Price Reconciliation + HARD Execution Price Gate
  Purpose:
  - Select the freshest internal public/delayed price.
  - Detect sub-1 EGP rounded/low-precision prices such as 0.21/0.210.
  - Mark those rows as NOT execution safe so recommendation engines cannot promote them.
*/
const fs=require("fs"),path=require("path");
function read(f,d){try{return JSON.parse(fs.readFileSync(f,"utf8"))}catch{return d}}
function write(f,o){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+"\n","utf8")}
function num(v){if(v==null||v==="")return null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[−–—]/g,"-").replace(/[^\d.+\-eE]/g,""));return Number.isFinite(n)?n:null}
function sym(r){return String(r&&(r.symbol||r.ticker||r.code||r.Symbol)||"").trim().toUpperCase()}
function price(r){return num(r&&(r.price??r.last??r.close??r.lastPrice??r.Last??r.Close))}
function mapRows(rows){const m={};(rows||[]).forEach(r=>{const s=sym(r);if(s)m[s]=r});return m}
function age(ts){if(!ts)return null;const d=new Date(ts);if(isNaN(d))return null;return (Date.now()-d.getTime())/60000}
function ts(obj,row){return row?.generatedAt||row?.updatedAt||row?.timestamp||row?.time||obj?.generatedAt||obj?.updatedAt||obj?.lastSuccessAt||obj?.sessionDate||null}
function round(n,dp=2){const m=10**dp;return Math.round(Number(n||0)*m)/m}
function effectiveDecimalsFromNumber(n){
  if(!Number.isFinite(Number(n)))return 0;
  const s=String(Number(n));
  return s.includes(".") ? s.split(".")[1].replace(/0+$/g,"").length : 0;
}
function rawPriceText(row){
  const vals=[row?.priceText,row?.rawPrice,row?.lastText,row?.lastPriceText,row?.priceDisplay,row?.finalPriceDisplay,row?.price,row?.last,row?.close,row?.lastPrice];
  return vals.filter(v=>v!==undefined&&v!==null&&String(v).trim()!=="").map(v=>String(v).trim());
}
function effectiveDecimalsFromRaw(row,n){
  const texts=rawPriceText(row);
  for(const t of texts){
    const cleaned=t.replace(/,/g,".").replace(/[^0-9.\-]/g,"");
    const m=cleaned.match(/^-?\d*\.(\d+)/);
    if(m)return m[1].replace(/0+$/g,"").length;
  }
  return effectiveDecimalsFromNumber(n);
}
function looksRoundedSubPoundText(row){
  return rawPriceText(row).some(t=>{
    const cleaned=t.replace(/,/g,".").replace(/[^0-9.\-]/g,"");
    return /^0?\.\d{1,2}$/.test(cleaned) || /^0?\.\d{2}0+$/.test(cleaned);
  });
}
function isTwoDecimalGridSubPound(n){
  const p=Number(n);
  if(!Number.isFinite(p)||p<=0||p>=1)return false;
  return Math.abs(p*100-Math.round(p*100)) < 1e-8;
}
function hasSourcePrecisionWarning(row){
  const w=String(row?.pricePrecisionWarning||row?.precisionWarning||row?.warning||"").toLowerCase();
  return /precision|decimal|sub_1|rounded|دقة/.test(w);
}
function detectPrecisionRisk(finalPrice, chosen, candidates){
  const p=Number(finalPrice);
  if(!Number.isFinite(p)||p<=0||p>=1)return {risk:false,state:"normal_price",reason:""};
  const sourceWarn=hasSourcePrecisionWarning(chosen?.row)||candidates.some(c=>hasSourcePrecisionWarning(c.row));
  const dec=Math.max(effectiveDecimalsFromRaw(chosen?.row,p), ...candidates.map(c=>effectiveDecimalsFromRaw(c.row,c.price)).filter(Number.isFinite));
  const twoGrid=isTwoDecimalGridSubPound(p);
  const roundedText=looksRoundedSubPoundText(chosen?.row)||candidates.some(c=>looksRoundedSubPoundText(c.row));
  if(sourceWarn) return {risk:true,state:"precision_risk",reason:"sub_1_price_source_warned_low_precision"};
  if(twoGrid) return {risk:true,state:"precision_risk",reason:"sub_1_price_on_0.01_grid_needs_exact_0.001_confirmation"};
  if(roundedText) return {risk:true,state:"precision_risk",reason:"sub_1_price_text_looks_rounded"};
  if(dec<3) return {risk:true,state:"precision_risk",reason:"sub_1_price_has_less_than_3_effective_decimals"};
  return {risk:false,state:"precise_sub_1",reason:""};
}
function main(){
 const rec=read("data/recommendations.json",{}),cache=read("data/full-market-cache.json",{}),market=read("data/market.json",{}),hist=read("data/history.json",{}),source=read("data/source-health.json",{});
 const recRows=Array.isArray(rec.all)?rec.all:[],cacheRows=Array.isArray(cache.rows)?cache.rows:[],marketRows=Array.isArray(market.rows)?market.rows:(Array.isArray(market.data)?market.data:[]);
 const rm=mapRows(recRows),cm=mapRows(cacheRows),mm=mapRows(marketRows),hby=hist.sessionsBySymbol||hist.symbols||hist.history||{};
 const symbols=[...new Set([...Object.keys(rm),...Object.keys(cm),...Object.keys(mm),...Object.keys(hby)].filter(Boolean))].sort();
 const rows=symbols.map(s=>{
  const rr=rm[s],cr=cm[s],mr=mm[s],harr=Array.isArray(hby[s])?hby[s]:[],lastHist=harr[harr.length-1]||{},hp=price(lastHist);
  const cand=[
    {source:"market",price:price(mr),ts:ts(market,mr),priority:4,row:mr},
    {source:"full-market-cache",price:price(cr),ts:ts(cache,cr),priority:3,row:cr},
    {source:"recommendations",price:price(rr),ts:ts(rec,rr),priority:2,row:rr},
    {source:"history",price:hp,ts:lastHist.date||hist.generatedAt,priority:1,row:lastHist}
  ].filter(x=>x.price!=null&&x.price>0);
  cand.sort((a,b)=>{const aa=age(a.ts),bb=age(b.ts);if(aa!=null&&bb!=null&&Math.abs(aa-bb)>15)return aa-bb;return b.priority-a.priority});
  const chosen=cand[0]||{},vals=cand.map(x=>x.price),max=vals.length?Math.max(...vals):null,min=vals.length?Math.min(...vals):null;
  const diff=max&&min?(max-min)/min*100:0;
  const ag=age(chosen.ts||source.generatedAt||source.lastSuccessAt||market.updatedAt||rec.generatedAt);
  const finalPrice=chosen.price||price(rr)||price(cr)||price(mr)||hp;
  const precision=detectPrecisionRisk(finalPrice, chosen, cand);
  const conflict=diff>=0.75;
  const stale=ag!=null?ag>180:false;
  const executionSafe=Boolean(finalPrice)&&!stale&&!conflict&&!precision.risk;
  return {
    symbol:s,
    name:rr?.name_ar||rr?.name_en||rr?.name||cr?.name_ar||cr?.name_en||cr?.name||mr?.name_ar||mr?.name_en||mr?.name||"",
    finalPrice,
    finalPriceDisplay: finalPrice&&finalPrice<1 ? Number(finalPrice).toFixed(3) : String(finalPrice??""),
    recommendationPrice:price(rr),marketPrice:price(mr),cachePrice:price(cr),historyPrice:hp,
    sourceUsed:chosen.source||"fallback",sourceTimestamp:chosen.ts||null,sourceAgeMinutes:ag==null?null:Number(ag.toFixed(1)),
    isStale:stale,hasConflict:conflict,diffPct:Number(diff.toFixed(2)),
    precisionRisk:precision.risk,precisionState:precision.state,precisionReason:precision.reason,
    isExecutionSafe:executionSafe,
    executionBlockReason: executionSafe?"":(precision.risk?"دقة السعر غير كافية للتنفيذ":conflict?"تعارض أسعار داخلي":stale?"السعر قديم":"السعر غير متاح"),
    conflictSummary:conflict?`max/min internal price spread ${diff.toFixed(2)}%`:"",
    candidates:cand.map(c=>({source:c.source,price:c.price,ts:c.ts,priority:c.priority,pricePrecisionWarning:c.row?.pricePrecisionWarning||null}))
  };
 });
 const summary={
  total:rows.length,
  ok:rows.filter(x=>x.isExecutionSafe).length,
  stale:rows.filter(x=>x.isStale).length,
  conflict:rows.filter(x=>x.hasConflict).length,
  precisionRisk:rows.filter(x=>x.precisionRisk).length,
  adjusted:rows.filter(x=>x.finalPrice&&x.recommendationPrice&&Math.abs(x.finalPrice-x.recommendationPrice)>0.0001).length,
  executionBlocked:rows.filter(x=>!x.isExecutionSafe).length
 };
 const last=source.generatedAt||source.lastSuccessAt||market.updatedAt||rec.generatedAt||null;
 write("data/price-reconciliation-report.json",{ok:true,engine:"v8_9_7_hard_price_gate_reconciliation",generatedAt:new Date().toISOString(),lastSourceUpdate:last,sourceAgeMinutes:age(last)==null?null:Number(age(last).toFixed(1)),summary,rows,note:"Hard gate: any sub-1 EGP price on a 0.01 grid, rounded-looking text, or fewer than 3 effective decimals is blocked from execution recommendations until a 0.001-precision source confirms it."});
 console.log("Price reconciliation",summary);
}
main();
