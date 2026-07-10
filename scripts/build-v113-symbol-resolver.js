#!/usr/bin/env node
// V11.3 Symbol Resolver: builds a canonical symbol/alias map from existing public config and generated data.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CONFIG = path.join(ROOT, 'config');
function readJson(file, fallback){ try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return fallback;} }
function writeJson(file,obj){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(obj,null,2)); }
function normSym(s){ return String(s||'').trim().toUpperCase().replace(/\.CA$/,''); }
function cleanName(s){ return String(s||'').replace(/<[^>]*>/g,' ').replace(/-->/g,' ').replace(/\[[^\]]*\]/g,' ').replace(/End AdSlot.*?-->/gi,' ').replace(/\s+/g,' ').trim(); }
function splitAliases(s){ return String(s||'').split(/[|,؛;]/).map(x=>cleanName(x)).filter(Boolean); }
function parseCsv(text){
  const lines = String(text||'').split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const rows=[]; const header=lines[0].split(',').map(x=>x.trim());
  for(const line of lines.slice(1)){
    const parts=[]; let cur='', q=false;
    for(let i=0;i<line.length;i++){ const ch=line[i]; if(ch==='"'){q=!q; continue;} if(ch===','&&!q){parts.push(cur); cur='';} else cur+=ch; }
    parts.push(cur);
    const obj={}; header.forEach((h,i)=>obj[h]=parts[i]||''); rows.push(obj);
  }
  return rows;
}
const generatedAt = new Date().toISOString();
const symbols = readJson(path.join(DATA,'symbols.json'),{}).symbols || [];
const marketRows = readJson(path.join(DATA,'market.json'),{}).rows || [];
const cacheRows = readJson(path.join(DATA,'full-market-cache.json'),{}).rows || [];
const sectorMap = readJson(path.join(CONFIG,'egx-sector-map.json'),{}).symbolToSector || {};
const udbRows = readJson(path.join(DATA,'unified-decision-board.json'),{}).rows || [];
const sectorRows = readJson(path.join(DATA,'sector-completion-report.json'),{}).rows || [];
const universeRows = readJson(path.join(DATA,'universe-index.json'),{}).rows || [];
let csvRows=[]; try{csvRows=parseCsv(fs.readFileSync(path.join(CONFIG,'egx-symbols.csv'),'utf8'));}catch(e){}
const map = new Map();
function upsert(symbol, patch){
  const key=normSym(symbol); if(!key) return;
  const old=map.get(key)||{symbol:key, egxSymbol:key, mubasherSymbol:key, aliases:[], sourceEvidence:[], confidence:50};
  for(const [k,v] of Object.entries(patch||{})){
    if(v==null || v==='') continue;
    if(k==='aliases') old.aliases=[...new Set([...(old.aliases||[]), ...v.map(cleanName).filter(Boolean)])];
    else if(k==='sourceEvidence') old.sourceEvidence=[...new Set([...(old.sourceEvidence||[]), ...v.filter(Boolean)])];
    else if(!old[k] || String(old[k]).length < String(v).length) old[k]=v;
  }
  old.sector = old.sector || sectorMap[key] || sectorMap[symbol] || 'غير مصنف';
  old.confidence = Math.min(100, Math.max(old.confidence||50, patch.confidence||50));
  map.set(key, old);
}
for(const r of csvRows){ upsert(r.symbol, {name_ar: cleanName(r.name_ar), name_en: cleanName(r.name_en), aliases: splitAliases(r.aliases), sourceEvidence:['config/egx-symbols.csv'], confidence:90}); }
for(const r of symbols){ upsert(r.symbol||r.mubasherSymbol, {mubasherSymbol:normSym(r.mubasherSymbol||r.symbol), name_ar: cleanName(r.name_ar), name_en: cleanName(r.name_en), aliases: Array.isArray(r.aliases)?r.aliases:[], sourceEvidence:['data/symbols.json'], confidence:85}); }
for(const r of marketRows){ upsert(r.symbol, {name_ar: cleanName(r.name_ar), name_en: cleanName(r.name_en), aliases: [r.name_ar,r.name_en].map(cleanName).filter(Boolean), sourceEvidence:['data/market.json'], confidence:75}); }
for(const r of cacheRows){ upsert(r.symbol, {name_ar: cleanName(r.name_ar), name_en: cleanName(r.name_en), aliases: [r.name_ar,r.name_en].map(cleanName).filter(Boolean), sourceEvidence:['data/full-market-cache.json'], confidence:65}); }
for(const r of udbRows){ upsert(r.symbol, {sector: r.sector, name_ar: cleanName(r.name_ar||r.name), name_en: cleanName(r.name_en), sourceEvidence:['data/unified-decision-board.json'], confidence:82}); }
for(const r of sectorRows){ upsert(r.symbol, {sector: r.sector||r.mappedSector||r.finalSector, sourceEvidence:['data/sector-completion-report.json'], confidence:78}); }
for(const r of universeRows){ upsert(r.symbol, {sector: r.sector, name_ar: cleanName(r.name_ar||r.name), name_en: cleanName(r.name_en), sourceEvidence:['data/universe-index.json'], confidence:70}); }
for(const [s,sector] of Object.entries(sectorMap)){ upsert(s,{sector, sourceEvidence:['config/egx-sector-map.json'], confidence:70}); }
const rows=[...map.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol)).map(r=>{
  const aliases=[r.symbol, r.mubasherSymbol, r.name_ar, r.name_en, ...(r.aliases||[])].map(cleanName).filter(Boolean);
  return {...r, aliases:[...new Set(aliases)].slice(0,20), searchText:[r.symbol,r.name_ar,r.name_en,...aliases].join(' ').toLowerCase()};
});
const unresolved = rows.filter(r=>!r.mubasherSymbol || r.sector==='غير مصنف').length;
writeJson(path.join(DATA,'symbol-alias-map.json'), {ok:true, engine:'v11_3_symbol_resolver', generatedAt, summary:{total:rows.length, unresolvedOrUnclassified:unresolved, fromCsv:csvRows.length, fromSymbols:symbols.length, fromMarket:marketRows.length}, symbols:rows, note:'Canonical resolver for automated source discovery. No manual CSV trading data is accepted; config CSV contains symbol metadata only.'});
writeJson(path.join(DATA,'symbol-resolver-report.json'), {ok:true, engine:'v11_3_symbol_resolver_report', generatedAt, summary:{total:rows.length, sectorKnown:rows.filter(r=>r.sector&&r.sector!=='غير مصنف').length, sectorUnknown:rows.filter(r=>!r.sector||r.sector==='غير مصنف').length}, rows:rows.map(r=>({symbol:r.symbol, mubasherSymbol:r.mubasherSymbol, name_ar:r.name_ar||'', name_en:r.name_en||'', sector:r.sector, aliasesCount:(r.aliases||[]).length, confidence:r.confidence, sources:r.sourceEvidence}))});
console.log(`V11.3 symbol resolver wrote ${rows.length} symbols`);
