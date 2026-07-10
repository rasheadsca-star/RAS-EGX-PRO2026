/*
EGX Pro Hub V7.11 — Trusted External News Collector

Purpose:
- Collect public news/disclosure links from trusted sources only.
- Save external news to data/news-report.json.
- No login, no paid APIs, no fabricated news.
- If sources return no linkable news, status says so and scoring remains unaffected.

Inputs:
- data/recommendations.json for symbols/names/sectors.
- optional data/news-sources.json for extra trusted source URLs.

Outputs:
- data/news-report.json
- data/trusted-news-collector-status.json
*/

const fs = require("fs");
const path = require("path");

const TIMEOUT_MS = Number(process.env.NEWS_FETCH_TIMEOUT_MS || 15000);
const MAX_SYMBOLS = Number(process.env.NEWS_SYMBOL_LIMIT || 60);
const MAX_ITEMS = Number(process.env.NEWS_MAX_ITEMS || 160);

const TRUSTED_DOMAINS = [
  "egx.com.eg",
  "egx.com",
  "mubasher.info",
  "english.mubasher.info",
  "zawya.com",
  "arabfinance.com",
  "alborsaanews.com",
  "cnbcarabia.com",
  "enterprise.press",
  "reuters.com"
];

function readJson(file, fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function symbolOf(r){return String(r.symbol||r.ticker||r.code||r.Symbol||"").trim().toUpperCase()}
function escRx(s){return String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}
function stripHtml(s){return String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#x27;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim()}
function norm(s){return String(s||"").toLowerCase().replace(/[أإآا]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه")}
function hostOf(url){try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase()}catch{return""}}
function isTrusted(url){const h=hostOf(url);return TRUSTED_DOMAINS.some(d=>h===d||h.endsWith("."+d))}
function absUrl(href, base){try{return new URL(href, base).href}catch{return""}}
function dateGuess(text){const m=String(text||"").match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})|(\d{1,2}[-/]\d{1,2}[-/]20\d{2})/);return m?m[0].replace(/\//g,"-"):null}

function extractUniverse(){
  const rec=readJson("data/recommendations.json",{});
  const rows=Array.isArray(rec.all)?rec.all:[];
  return rows.map(r=>({symbol:symbolOf(r),name:r.name||r.name_ar||"",sector:r.sector||"غير مصنف"})).filter(x=>x.symbol).slice(0,MAX_SYMBOLS);
}

function defaultSources(universe){
  const urls = [
    "https://english.mubasher.info/markets/EGX/news",
    "https://www.mubasher.info/markets/EGX/news",
    "https://english.mubasher.info/markets/EGX",
    "https://www.mubasher.info/markets/EGX"
  ];
  for(const u of universe.slice(0,40)){
    urls.push(`https://english.mubasher.info/markets/EGX/stocks/${u.symbol}/news`);
    urls.push(`https://www.mubasher.info/markets/EGX/stocks/${u.symbol}/news`);
    urls.push(`https://english.mubasher.info/markets/EGX/stocks/${u.symbol}/`);
    urls.push(`https://www.mubasher.info/markets/EGX/stocks/${u.symbol}/`);
  }
  return urls;
}

function configuredSources(){
  const cfg=readJson("data/news-sources.json",null);
  if(!cfg)return[];
  if(Array.isArray(cfg))return cfg;
  if(Array.isArray(cfg.urls))return cfg.urls;
  if(Array.isArray(cfg.sources))return cfg.sources.map(x=>typeof x==="string"?x:x.url).filter(Boolean);
  return[];
}

async function fetchText(url){
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
  try{
    const res=await fetch(url,{signal:ctrl.signal,headers:{
      "user-agent":"EGX-Pro-Hub/7.11 trusted-news-collector",
      "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }});
    if(!res.ok)return null;
    return await res.text();
  }catch{return null}
  finally{clearTimeout(t)}
}

function parseLinks(html, baseUrl){
  const out=[];
  const aRe=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=aRe.exec(html))){
    const url=absUrl(m[1],baseUrl);
    if(!url||!isTrusted(url))continue;
    const title=stripHtml(m[2]);
    if(!title||title.length<12)continue;
    if(!/(news|disclosure|announcement|markets|stocks|أخبار|افصاح|إفصاح|بيان|بورصة|سهم)/i.test(url+" "+title))continue;
    out.push({title,url,sourceUrl:baseUrl,sourceName:hostOf(url),summary:title,date:dateGuess(title)});
  }
  return out;
}

function linkToSymbol(item, universe){
  const text=norm([item.title,item.summary,item.url].join(" "));
  const up=[item.title,item.summary,item.url].join(" ").toUpperCase();
  for(const u of universe){
    if(new RegExp(`\\b${escRx(u.symbol)}\\b`).test(up))return u;
    const name=norm(u.name);
    if(name && name.length>5 && text.includes(name.slice(0,Math.min(name.length,30))))return u;
  }
  // infer from stock URL /stocks/SYMBOL/
  const m=String(item.url).match(/\/stocks\/([A-Z0-9.]+)\b/i);
  if(m){
    const found=universe.find(u=>u.symbol===m[1].toUpperCase());
    if(found)return found;
  }
  return null;
}

function classify(text){
  const n=norm(text);
  const cats=[
    ["أسهم خزينة",["خزينه","خزينة","treasury","buyback"]],
    ["نتائج أعمال",["نتائج","ارباح","أرباح","خسائر","profit","loss","earnings"]],
    ["توزيعات",["توزيع","توزيعات","كوبون","dividend"]],
    ["زيادة رأس مال",["راس المال","رأس المال","capital increase","rights"]],
    ["استحواذ / صفقة",["استحواذ","صفقه","صفقة","acquisition","deal","merger"]],
    ["اقتصاد / فائدة",["فائده","فائدة","تضخم","المركزي","interest","inflation"]],
    ["إفصاح / بيان",["افصاح","إفصاح","بيان","disclosure","announcement"]]
  ];
  let category="عام";
  for(const [c,keys] of cats){if(keys.some(k=>n.includes(norm(k)))){category=c;break}}
  let impact=0;
  ["ايجابي","إيجابي","ارتفاع","نمو","ارباح","أرباح","توزيع","خزينه","positive","profit","growth","buyback"].forEach(k=>{if(n.includes(norm(k)))impact+=10});
  ["سلبي","انخفاض","خسائر","خساره","خسارة","تراجع","negative","loss","decline"].forEach(k=>{if(n.includes(norm(k)))impact-=12});
  return {category,impactScore:Math.max(-100,Math.min(100,impact)),sentiment:impact>8?"positive":impact<-8?"negative":"neutral"};
}

async function main(){
  const universe=extractUniverse();
  const sourceUrls=[...new Set([...configuredSources(),...defaultSources(universe)].filter(Boolean))];

  const status={
    ok:true,
    engine:"v7_11_trusted_external_news_collector",
    generatedAt:new Date().toISOString(),
    sourcesAttempted:sourceUrls.length,
    sourcesOk:0,
    linksExtracted:0,
    itemsSaved:0,
    externalNewsRows:0,
    linkedSymbols:0,
    linkedSectors:0,
    trustedDomains:TRUSTED_DOMAINS,
    note:"Only trusted public links are saved. If no links are found, news scoring remains unchanged.",
    attempts:[]
  };

  const raw=[];
  for(const url of sourceUrls){
    if(!isTrusted(url)){
      status.attempts.push({url,ok:false,reason:"untrusted-domain"});
      continue;
    }
    const html=await fetchText(url);
    status.attempts.push({url,ok:!!html,bytes:html?html.length:0});
    if(!html)continue;
    status.sourcesOk++;
    const links=parseLinks(html,url);
    status.linksExtracted+=links.length;
    raw.push(...links);
    await new Promise(r=>setTimeout(r,200));
  }

  const seen=new Set();
  const items=[];
  for(const link of raw){
    if(seen.has(link.url))continue;
    seen.add(link.url);
    const u=linkToSymbol(link,universe);
    const c=classify(link.title+" "+link.summary);
    items.push({
      symbol:u?u.symbol:null,
      sector:u?u.sector:"غير مصنف",
      title:link.title,
      summary:link.summary,
      url:link.url,
      sourceName:link.sourceName,
      publisher:link.sourceName,
      sourceUrl:link.sourceUrl,
      date:link.date,
      category:c.category,
      sentiment:c.sentiment,
      impactScore:c.impactScore,
      trusted:true,
      sourceTrust:"trusted",
      evidenceType:"external_news",
      source:"trusted-external-news-collector"
    });
    if(items.length>=MAX_ITEMS)break;
  }

  status.itemsSaved=items.length;
  status.externalNewsRows=items.length;
  status.linkedSymbols=new Set(items.map(x=>x.symbol).filter(Boolean)).size;
  status.linkedSectors=new Set(items.map(x=>x.sector).filter(Boolean)).size;

  writeJson("data/news-report.json",{
    ok:true,
    engine:"v7_11_trusted_external_news_collector",
    generatedAt:new Date().toISOString(),
    sourceMode:"trusted-external-news",
    rows:items
  });
  writeJson("data/trusted-news-collector-status.json",status);

  console.log("Trusted external news collector complete:",{
    sourcesOk:status.sourcesOk,
    linksExtracted:status.linksExtracted,
    itemsSaved:status.itemsSaved,
    linkedSymbols:status.linkedSymbols
  });
}
main();
