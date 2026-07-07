#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

function readJson(rel, fallback) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } }
function writeJson(rel, data) { const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function decode(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function strip(s) { return decode(s).slice(0, 500); }
function asArray(x) { return Array.isArray(x) ? x : []; }
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 EGX-Pro-Hub/5.6' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}
function tag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? strip(m[1]) : '';
}
function parseRss(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const linkMatch = b.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
    items.push({
      title: tag(b, 'title'),
      description: tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'),
      url: tag(b, 'link') || (linkMatch ? linkMatch[1] : ''),
      publishedAt: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated'),
      source: sourceName
    });
  }
  return items.filter(x => x.title);
}
function parseHtmlNews(html, sourceName, baseUrl) {
  const items = [];
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) && items.length < 80) {
    const title = strip(m[2]);
    if (title.length < 12) continue;
    if (!/(EGX|بورصة|الأسهم|سهم|تداول|إفصاح|قيد|أرباح|توزيع|استحواذ|مؤشر|قطاع|سوق|Exchange|Disclosure|Listing|Financial|Dividend|Acquisition|Shares|Stock)/i.test(title)) continue;
    let url = m[1];
    try { url = new URL(url, baseUrl).href; } catch {}
    items.push({ title, url, source: sourceName, publishedAt: '' });
  }
  return items;
}
function loadSymbols() {
  const universe = readJson('data/universe-index.json', {});
  const cache = readJson('data/full-market-cache.json', []);
  const map = new Map();
  for (const r of [].concat(asArray(universe.symbols), asArray(cache))) {
    const s = String(r.symbol || r.ticker || r.code || '').trim().toUpperCase();
    if (!s) continue;
    map.set(s, { symbol: s, name: r.name || r.name_en || r.name_ar || r.company || s, sector: r.sector || r.sector_ar || r.industry || '' });
  }
  return [...map.values()];
}
function classify(item, symbols, keywords) {
  const text = `${item.title} ${item.description || ''}`;
  const relatedSymbols = [];
  const relatedSectors = new Set();
  for (const s of symbols) {
    if (relatedSymbols.length >= 8) break;
    const name = String(s.name || '').trim();
    if ((s.symbol && new RegExp(`\\b${s.symbol}\\b`, 'i').test(text)) || (name.length > 4 && text.toLowerCase().includes(name.toLowerCase()))) {
      relatedSymbols.push(s.symbol);
      if (s.sector) relatedSectors.add(s.sector);
    }
  }
  let score = 0;
  for (const k of keywords.highImpact || []) if (new RegExp(k, 'i').test(text)) score += 3;
  for (const k of keywords.marketImpact || []) if (new RegExp(k, 'i').test(text)) score += 2;
  for (const k of keywords.negative || []) if (new RegExp(k, 'i').test(text)) score += 2;
  for (const k of keywords.positive || []) if (new RegExp(k, 'i').test(text)) score += 1;
  score += relatedSymbols.length ? 2 : 0;
  const impactLevel = score >= 5 ? 'مرتفع' : score >= 3 ? 'متوسط' : 'منخفض';
  const urgent = score >= 5;
  return { ...item, impactScore: score, impactLevel, urgent, relatedSymbols, relatedSectors: [...relatedSectors] };
}
async function main() {
  const cfg = readJson('config/news-sources-v56.json', { sources: [], keywords: {} });
  const symbols = loadSymbols();
  const collected = [];
  const sourceStatus = [];
  for (const src of asArray(cfg.sources)) {
    if (!src.url || src.enabled === false) continue;
    try {
      const raw = await fetchText(src.url);
      const items = src.type === 'html' ? parseHtmlNews(raw, src.name, src.url) : parseRss(raw, src.name);
      collected.push(...items.map(x => ({ ...x, source: src.name, sourceUrl: src.url })));
      sourceStatus.push({ name: src.name, ok: true, items: items.length, url: src.url });
    } catch (err) {
      sourceStatus.push({ name: src.name, ok: false, error: String(err.message || err), url: src.url });
    }
    await new Promise(r => setTimeout(r, 300));
  }
  const seen = new Set();
  const items = collected
    .filter(i => i.title)
    .filter(i => { const key = `${i.title}|${i.url}`.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .map(i => classify(i, symbols, cfg.keywords || {}))
    .sort((a,b) => (b.impactScore || 0) - (a.impactScore || 0))
    .slice(0, 120);
  const urgent = items.filter(i => i.urgent).slice(0, 30);
  const report = {
    version: '5.6.0',
    generatedAt: new Date().toISOString(),
    status: sourceStatus.some(s => s.ok) ? 'ok' : 'no_sources_available',
    sources: sourceStatus,
    items,
    urgent,
    summary: {
      collected: items.length,
      urgent: urgent.length,
      sourcesOk: sourceStatus.filter(s => s.ok).length,
      sourcesFailed: sourceStatus.filter(s => !s.ok).length
    }
  };
  writeJson('data/smart-news-report.json', report);
  // Merge urgent news into alerts without destroying existing alert structure.
  const oldAlerts = readJson('data/alerts.json', []);
  const newsAlerts = urgent.map(n => ({ type: 'news', severity: n.impactLevel, title: n.title, source: n.source, url: n.url, relatedSymbols: n.relatedSymbols, generatedAt: report.generatedAt }));
  writeJson('data/alerts-v56-news.json', newsAlerts);
  if (Array.isArray(oldAlerts)) writeJson('data/alerts.json', [...newsAlerts, ...oldAlerts].slice(0, 150));
  console.log(`smart-news-report generated: ${items.length} items, ${urgent.length} urgent`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
