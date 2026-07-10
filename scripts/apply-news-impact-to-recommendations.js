/*
EGX Pro Hub V7.10 — Apply Trusted News Impact To Recommendations
Strict rule: Only trusted external news can adjust recommendation confidence.
Internal recommendation reasons and untrusted/no-link items are displayed only.
*/
const fs = require("fs");
const path = require("path");
function readJson(file, fallback){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch{return fallback}}
function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2),"utf8")}
function num(v){if(v==null||v==="")return null;if(typeof v==="number")return isFinite(v)?v:null;const n=Number(String(v).replace(/[,%٬،]/g,"").replace(/[^\d.+\-eE]/g,""));return isFinite(n)?n:null}
function symbolOf(r){return String(r.symbol||r.ticker||r.code||r.Symbol||"").trim().toUpperCase()}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
const TRUSTED_DOMAINS=["egx.com.eg","egx.com","mubasher.info","english.mubasher.info","reuters.com","zawya.com","arabfinance.com","alborsaanews.com","cnbcarabia.com","enterprise.press"];
function hostname(url){try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase()}catch{return ""}}
function trustedItem(item){
  if(item.trusted===true||item.trustedNewsSource===true||item.sourceTrust==="trusted")return true;
  if(item.source==="recommendation-reason"||item.evidenceType==="internal_signal")return false;
  const url=item.url||item.link||""; if(!url)return false;
  const host=hostname(url); return TRUSTED_DOMAINS.some(d=>host===d||host.endsWith("."+d));
}
function trustScore(item){
  if(!trustedItem(item))return 0; const host=hostname(item.url||item.link||"");
  if(host.includes("egx.com"))return 100; if(host.includes("mubasher.info"))return 92; if(host.includes("reuters.com"))return 95; if(host.includes("zawya.com"))return 88;
  if(host.includes("arabfinance.com")||host.includes("alborsaanews.com")||host.includes("cnbcarabia.com"))return 82;
  if(item.trusted===true||item.sourceTrust==="trusted")return 85; return 75;
}
function label(score){if(score>8)return "إيجابي"; if(score<-8)return "سلبي"; return "محايد"}
function main(){
  const news=readJson("data/news-intelligence.json",{}), rec=readJson("data/recommendations.json",null);
  const items=Array.isArray(news.items)?news.items:[];
  if(!rec||!Array.isArray(rec.all)){writeJson("data/news-impact-status.json",{ok:false,engine:"v7_10_trusted_news_impact",message:"recommendations.json not found or invalid"});return}
  const trusted=items.filter(trustedItem).map(x=>({...x,sourceTrustScore:trustScore(x)}));
  const bySymbol={}, bySector={};
  for(const it of trusted){
    if(it.symbol){const s=String(it.symbol).toUpperCase();(bySymbol[s]=bySymbol[s]||[]).push(it)}
    const sec=String(it.sector||"غير مصنف");(bySector[sec]=bySector[sec]||[]).push(it)
  }
  let enhanced=0, positive=0, negative=0;
  rec.all=rec.all.map(r=>{
    const sym=symbolOf(r), sec=String(r.sector||"غير مصنف");
    const direct=bySymbol[sym]||[], sector=bySector[sec]||[];
    let net=0; direct.forEach(it=>net+=(num(it.impactScore)||0)*(trustScore(it)/100)); sector.slice(0,5).forEach(it=>net+=(num(it.impactScore)||0)*(trustScore(it)/100)*0.20);
    net=Math.round(clamp(net,-100,100)); let adj=0;
    if(direct.length||sector.length){ if(net>0)adj=Math.round(clamp(net*0.08,0,5)); if(net<0)adj=Math.round(clamp(net*0.10,-7,0)); }
    const used=adj!==0 && (direct.length>0||Math.abs(net)>=15); const oldConf=num(r.finalConfidence)??num(r.confidence)??0; const newConf=used?Math.round(clamp(oldConf+adj,0,100)):oldConf;
    const best=direct.slice().sort((a,b)=>Math.abs(num(b.impactScore)||0)-Math.abs(num(a.impactScore)||0))[0] || sector.slice().sort((a,b)=>Math.abs(num(b.impactScore)||0)-Math.abs(num(a.impactScore)||0))[0] || null;
    if(used){enhanced++; if(adj>0)positive++; if(adj<0)negative++;}
    const note=used?` | News impact (${label(net)}): ${net}, trusted source adjustment ${adj}.`:"";
    return {...r,finalConfidence:newConf,newsImpactScore:net,newsImpactAdjustment:adj,newsImpactLabel:label(net),newsUsedInScore:used,trustedNewsSource:!!best,newsImpactSummary:best?(best.summary||best.title||""):"",newsSourceUrl:best?(best.url||best.link||""):"",newsSourceName:best?(best.sourceName||best.publisher||best.source||"trusted news"):"",reason:note&&!String(r.reason||"").includes("News impact")?String(r.reason||"")+note:r.reason}
  });
  rec.newsImpactEngine={version:"v7_10_trusted_news_impact",updatedAt:new Date().toISOString(),rule:"Only trusted external news can affect finalConfidence. Internal recommendation reasons are display-only.",enhanced,positive,negative};
  fs.writeFileSync("data/recommendations.json",JSON.stringify(rec,null,2),"utf8");
  writeJson("data/news-impact-status.json",{ok:true,engine:"v7_10_trusted_news_impact",generatedAt:new Date().toISOString(),rawNewsItems:items.length,trustedNewsItems:trusted.length,enhancedRecommendations:enhanced,positiveAdjustments:positive,negativeAdjustments:negative,maxPositiveAdjustment:5,maxNegativeAdjustment:-7,trustedDomains:TRUSTED_DOMAINS,rule:"No source link/trusted flag = no score impact. Recommendation reasons = internal signals only."});
  console.log("Trusted news impact complete:",{trustedNewsItems:trusted.length,enhancedRecommendations:enhanced});
}
main();
