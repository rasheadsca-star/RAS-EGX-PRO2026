
/*
EGX Pro Hub V7.9 — News Intelligence Builder

Reads:
- data/news-report.json if present
- data/recommendations.json reasons as fallback evidence

Outputs:
- data/news-intelligence.json
- data/news-intelligence-status.json

No paid sources, no login, no fabricated news. If no real news file exists, it uses only already-present recommendation reasons as weak news/evidence signals.
*/

const fs = require("fs");
const path = require("path");

function readJson(file, fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function norm(s){return String(s||"").toLowerCase().replace(/[أإآا]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")}
function num(v){if(v==null||v==="")return null;if(typeof v==="number")return isFinite(v)?v:null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function symbolOf(r){return String(r.symbol||r.ticker||r.code||r.Symbol||"").trim().toUpperCase()}

const CATS = [
  ["treasury","أسهم خزينة",["خزينه","خزينة","treasury","buyback","شراء اسهم"]],
  ["earnings","نتائج أعمال",["نتائج","ارباح","أرباح","ربح","خسائر","خساره","خسارة","earnings","profit","loss"]],
  ["dividend","توزيعات",["توزيع","توزيعات","كوبون","dividend","coupon"]],
  ["capital","رأس مال",["راس المال","رأس المال","زياده رأس","زياده راس","زيادة رأس","زيادة راس","capital increase","rights issue"]],
  ["mna","استحواذ / صفقة",["استحواذ","صفقه","صفقة","اندماج","acquisition","merger","deal"]],
  ["macro","اقتصاد / فائدة",["فائده","فائدة","تضخم","دولار","سعر الصرف","المركزي","interest","inflation","fx"]],
  ["sector","قطاع",["قطاع","sector","industry"]],
  ["governance","إدارة / حوكمة",["مجلس الاداره","مجلس الإدارة","رئيس","اداره","إدارة","board","management"]]
];

function classify(text){
  const n=norm(text);
  let category="عام", code="general";
  for(const [c,label,keys] of CATS){if(keys.some(k=>n.includes(norm(k)))){code=c;category=label;break}}
  let impact=0;
  const pos=["ايجابي","إيجابي","ارتفاع","نمو","زياده ارباح","زيادة ارباح","توزيع","شراء اسهم","خزينه","اختراق","positive","growth","profit","buyback"];
  const neg=["سلبي","انخفاض","خسائر","خساره","خسارة","تراجع","ايقاف","غرامه","كسر دعم","negative","loss","decline"];
  pos.forEach(k=>{if(n.includes(norm(k)))impact+=12});
  neg.forEach(k=>{if(n.includes(norm(k)))impact-=14});
  if(code==="treasury"||code==="dividend")impact+=10;
  if(code==="earnings"&&impact===0)impact+=4;
  impact=Math.max(-100,Math.min(100,impact));
  const sentiment=impact>8?"positive":impact<-8?"negative":"neutral";
  return{code,category,impact,sentiment}
}
function rowsFromNewsReport(news){
  if(!news)return[];
  if(Array.isArray(news))return news;
  if(Array.isArray(news.rows))return news.rows;
  if(Array.isArray(news.items))return news.items;
  if(Array.isArray(news.news))return news.news;
  if(Array.isArray(news.articles))return news.articles;
  return[];
}
function main(){
  const rec=readJson("data/recommendations.json",{});
  const all=Array.isArray(rec.all)?rec.all:[];
  const bySymbol=new Map(all.map(r=>[symbolOf(r),r]).filter(x=>x[0]));
  const newsReport=readJson("data/news-report.json",null);
  const rawNews=rowsFromNewsReport(newsReport);
  const items=[];
  let sourceMode="news-report";

  for(const item of rawNews){
    const text=[item.title,item.headline,item.summary,item.description,item.body,item.text].filter(Boolean).join(" ");
    if(!text.trim())continue;
    let symbol=symbolOf(item);
    if(!symbol){
      const up=text.toUpperCase();
      for(const s of bySymbol.keys()){if(new RegExp(`\\b${s}\\b`).test(up)){symbol=s;break}}
    }
    const row=bySymbol.get(symbol)||{};
    const c=classify(text);
    items.push({
      symbol:symbol||null,
      sector:row.sector||item.sector||"غير مصنف",
      title:item.title||item.headline||text.slice(0,140),
      summary:item.summary||item.description||text.slice(0,260),
      url:item.url||item.link||null,
      date:item.date||item.publishedAt||item.generatedAt||null,
      category:c.category,
      categoryCode:c.code,
      sentiment:c.sentiment,
      impactScore:c.impact,
      source:"news-report", evidenceType:"external_news", sourceName:item.sourceName||item.publisher||item.source||"news-report"
    });
  }

  if(!items.length){
    sourceMode="recommendation-reasons";
    for(const r of all){
      const reason=String(r.reason||"").trim();
      if(!reason)continue;
      const c=classify(reason);
      if(c.code==="general"&&Math.abs(c.impact)<8)continue;
      items.push({
        symbol:symbolOf(r),
        sector:r.sector||"غير مصنف",
        title:`إشارة من سبب التوصية — ${symbolOf(r)}`,
        summary:reason.slice(0,280),
        url:null,
        date:rec.generatedAt||null,
        category:c.category,
        categoryCode:c.code,
        sentiment:c.sentiment,
        impactScore:c.impact,
        source:"recommendation-reason", evidenceType:"internal_signal", sourceName:"إشارة تحليلية داخلية من سبب التوصية", url:null, evidenceType:"internal_signal", sourceName:"إشارة تحليلية داخلية من سبب التوصية", url:null
      });
    }
  }

  const bySymbolOut={};
  const bySectorOut={};
  for(const it of items){
    const s=it.symbol||"UNLINKED";
    bySymbolOut[s]=bySymbolOut[s]||{symbol:it.symbol,items:[],netImpact:0,positive:0,negative:0,neutral:0};
    bySymbolOut[s].items.push(it);
    bySymbolOut[s].netImpact+=it.impactScore;
    bySymbolOut[s][it.sentiment]++;
    const sec=it.sector||"غير مصنف";
    bySectorOut[sec]=bySectorOut[sec]||{sector:sec,items:[],netImpact:0,positive:0,negative:0,neutral:0};
    bySectorOut[sec].items.push(it);
    bySectorOut[sec].netImpact+=it.impactScore;
    bySectorOut[sec][it.sentiment]++;
  }

  Object.values(bySymbolOut).forEach(x=>x.netImpact=Math.max(-100,Math.min(100,Math.round(x.netImpact))));
  Object.values(bySectorOut).forEach(x=>x.netImpact=Math.max(-100,Math.min(100,Math.round(x.netImpact))));

  const status={
    ok:true,
    engine:"v7_9_1_news_source_links",
    generatedAt:new Date().toISOString(),
    sourceMode,
    rawNewsRows:rawNews.length,
    classifiedItems:items.length,
    linkedSymbols:Object.keys(bySymbolOut).filter(s=>s!=="UNLINKED").length,
    linkedSectors:Object.keys(bySectorOut).length,
    note:sourceMode==="recommendation-reasons"?"No standalone news-report rows found. Internal recommendation reasons were used as analytical signals only; no external news source link is created.":"Used news-report rows; items with url show external source links."
  };

  writeJson("data/news-intelligence.json",{
    ok:true,
    engine:"v7_9_1_news_source_links",
    generatedAt:new Date().toISOString(),
    sourceMode,
    importantNote:"News intelligence is an evidence layer. External news should include url/sourceName. Recommendation reasons are internal analytical signals, not external news.",
    items,
    bySymbol:bySymbolOut,
    bySector:bySectorOut
  });
  writeJson("data/news-intelligence-status.json",status);

  console.log("News intelligence complete:",status);
}
main();
