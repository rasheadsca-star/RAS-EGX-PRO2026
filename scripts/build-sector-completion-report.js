#!/usr/bin/env node
/*
EGX Pro Hub V11 — Sector Completion Report
Uses config/egx-sector-map.json first, then existing row sector, then keyword suggestions.
Does not overwrite full-market-cache or scan-state.
*/
const fs=require('fs');
const path=require('path');
function read(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}}
function write(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj,null,2)+'\n','utf8')}
function num(v){if(v==null||v==='')return 0;const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^\d.+\-eE]/g,''));return Number.isFinite(n)?n:0}
function key(s){return String(s||'').trim().toUpperCase()}
function cleanSector(s){s=String(s||'').trim();return(!s||s==='-'||s==='غير مصنف'||/unknown/i.test(s))?'غير مصنف':s}
const RULES=[
  ['بنوك وخدمات مالية مصرفية',90,/(bank|بنك|مصرف|credit|ائتمان|قرض)/i],
  ['عقارات وإنشاءات',86,/(real estate|housing|development|تعمير|اسكان|إسكان|عقار|مدينة نصر|طلعت|بالم|اعمار|سوديك|construction|مقاولات)/i],
  ['أغذية ومشروبات',86,/(food|foods|beverage|مطاحن|مخابز|اغذية|أغذية|دواجن|زيوت|سكر|البان|ألبان|دومتي|جهينة|عبور لاند|poultry|domty|juhayna)/i],
  ['رعاية صحية وأدوية',88,/(pharma|medical|health|دواء|ادوية|أدوية|مستشفى|مستشفيات|تشخيص|سبيد|راميدا|ابن سينا|نيل|ممفيس|healthcare)/i],
  ['أسمنت ومواد بناء',86,/(cement|اسمنت|أسمنت|مواد بناء|ceramic|سيراميك|رخام|جرانيت)/i],
  ['معادن ومواد أساسية',86,/(iron|steel|حديد|صلب|aluminum|aluminium|المونيوم|ألمنيوم|حديد عز|عز الدخيلة|حديد|صلب)/i],
  ['بتروكيماويات وكيماويات',86,/(chemical|chemicals|fertilizer|petrochemical|كيماويات|بتروكيماويات|سماد|اسمدة|أسمدة|ابو قير|موبكو|سيدي كرير)/i],
  ['اتصالات وإعلام وتكنولوجيا',86,/(telecom|اتصالات|technology|تكنولوجيا|فوري|اي فاينانس|e-finance|راية|اورنج|موبايل|media)/i],
  ['خدمات مالية غير مصرفية',84,/(financial|finance|leasing|تأجير|تمويل|سمسرة|هيرميس|بلتون|ثروة|كونتكت|ci capital|سي اي كابيتال)/i],
  ['سياحة وترفيه',80,/(tourism|hotel|hotels|سياحة|فنادق|منتجعات|بيراميزا|رمكو)/i],
  ['نقل وخدمات لوجستية',80,/(shipping|transport|logistics|نقل|شحن|ملاحة|قناة|حاويات|containers)/i],
  ['صناعة وطاقة وبنية تحتية',78,/(industrial|صناعات|صناعة|كابلات|نساجون|غزل|نسيج|ورق|عبوات|مطابع|cables|energy|power)/i]
];
function inferSector(r){
  const text=[r.symbol,r.name,r.name_ar,r.name_en,r.companyName,r.company].filter(Boolean).join(' ');
  for(const [sector,confidence,rx] of RULES){ if(rx.test(text)) return {symbol:key(r.symbol),suggestedSector:sector,confidence,reason:'matched company name keywords'}; }
  return null;
}
function main(){
  const rec=read('data/recommendations.json',{});
  const market=read('data/market.json',{rows:[]});
  const sectorMap=read('config/egx-sector-map.json',{symbolToSector:{}}).symbolToSector||{};
  const m={};(market.rows||[]).forEach(r=>{const k=key(r.symbol);if(k)m[k]=r});
  const seen=new Set();
  const rows=[];
  [...(rec.all||[]),...(market.rows||[])].forEach(r=>{const k=key(r.symbol);if(k&&!seen.has(k)){seen.add(k);rows.push({...r,...(m[k]||{})})}});
  const sectors={}, missing=[], suggestions=[];
  rows.forEach(r=>{
    const sym=key(r.symbol);
    let sector=cleanSector(sectorMap[sym]||r.sector||r.sector_ar||r.industry||r.marketSector);
    if(sector==='غير مصنف'){
      const inf=inferSector(r);
      if(inf && inf.confidence>=84){ sector=inf.suggestedSector; suggestions.push(inf); }
      else { if(inf) suggestions.push(inf); missing.push(r); }
    }
    sectors[sector]=sectors[sector]||{sector,count:0,valueTraded:0,avgChange:0,newsImpact:0,symbols:[]};
    sectors[sector].count++;
    sectors[sector].valueTraded+=num(r.valueTraded||r.turnover);
    sectors[sector].avgChange+=num(r.changePct);
    sectors[sector].newsImpact+=num(r.newsImpactScore);
    sectors[sector].symbols.push(sym);
  });
  const sectorRows=Object.values(sectors).map(x=>({...x,avgChange:x.count?Number((x.avgChange/x.count).toFixed(3)):0,newsImpact:x.count?Number((x.newsImpact/x.count).toFixed(2)):0})).sort((a,b)=>b.valueTraded-a.valueTraded);
  const known=rows.length-missing.length;
  const coveragePct=rows.length?Number((known/rows.length*100).toFixed(2)):0;
  const report={ok:true,engine:'v11_sector_completion_config_map_plus_inference',generatedAt:new Date().toISOString(),totalSymbols:rows.length,classifiedSymbols:known,unclassifiedSymbols:missing.length,coveragePct,sectors:sectorRows,missing:missing.map(r=>({symbol:key(r.symbol),name:r.name_ar||r.name_en||r.name||'',price:num(r.price),changePct:num(r.changePct),valueTraded:num(r.valueTraded||r.turnover)})),suggestions:[...new Map(suggestions.map(s=>[s.symbol,s])).values()].sort((a,b)=>b.confidence-a.confidence),note:'V11 applies config/egx-sector-map.json and high-confidence inferred sectors for analysis/reporting. Review suggestions before adding permanently to the config map.'};
  write('data/sector-completion-report.json',report);
  write('data/egx-sector-map-suggestions.json',{ok:true,generatedAt:report.generatedAt,suggestions:report.suggestions});
  console.log('Sector completion', {coveragePct, missing:missing.length, suggestions:report.suggestions.length});
}
main();
