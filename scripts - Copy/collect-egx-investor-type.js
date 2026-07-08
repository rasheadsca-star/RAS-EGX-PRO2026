#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

function readJson(rel, fallback) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } }
function writeJson(rel, data) { const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function num(v, f = null) { if (v === null || v === undefined || v === '') return f; if (typeof v === 'number' && Number.isFinite(v)) return v; const n = Number(String(v).replace(/[,%\s]/g, '').replace(/−/g, '-')); return Number.isFinite(n) ? n : f; }
function decode(s) { return String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 EGX-Pro-Hub/5.6' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}
function parsePotentialRows(html) {
  const clean = decode(html);
  const groups = [];
  const labels = [
    ['Institutions', /Institutions|Institutional|مؤسسات/i],
    ['Individuals', /Individuals|Retail|أفراد/i],
    ['Egyptians', /Egyptians|مصريين|مصريون/i],
    ['Arabs', /Arabs|عرب/i],
    ['Foreigners', /Foreigners|Foreign|أجانب/i]
  ];
  for (const [label, re] of labels) {
    const idx = clean.search(re);
    if (idx < 0) continue;
    const window = clean.slice(Math.max(0, idx - 120), idx + 260);
    const nums = [...window.matchAll(/[-+]?\d[\d,.]*\s*%?/g)].map(m => num(m[0]));
    const share = nums.find(n => n !== null && n >= 0 && n <= 100);
    groups.push({ group: label, sharePct: share, rawWindow: window.slice(0, 220) });
  }
  return groups;
}
function normalizeManual(manual) {
  const rows = Array.isArray(manual.rows) ? manual.rows : [];
  const out = rows.map(r => ({
    group: r.group || r.type || r.name,
    buy: num(r.buy || r.buys, 0),
    sell: num(r.sell || r.sells, 0),
    net: num(r.net || r.netValue, null) ?? ((num(r.buy || r.buys, 0) || 0) - (num(r.sell || r.sells, 0) || 0)),
    sharePct: num(r.sharePct || r.share)
  })).filter(r => r.group);
  return out;
}
function classify(rows) {
  let strongestBuyer = '—', strongestSeller = '—';
  const withNet = rows.filter(r => num(r.net) !== null);
  if (withNet.length) {
    strongestBuyer = withNet.slice().sort((a,b)=>b.net-a.net)[0]?.group || '—';
    strongestSeller = withNet.slice().sort((a,b)=>a.net-b.net)[0]?.group || '—';
  }
  const inst = rows.find(r => /Institution|مؤسسات/i.test(r.group || ''));
  const ind = rows.find(r => /Individual|أفراد/i.test(r.group || ''));
  const foreigners = rows.find(r => /Foreign|أجانب/i.test(r.group || ''));
  let signal = 'محايد / يحتاج متابعة';
  if (foreigners && num(foreigners.net, 0) > 0 && inst && num(inst.net, 0) > 0) signal = 'دعم مؤسسي وأجنبي إيجابي';
  else if (foreigners && num(foreigners.net, 0) < 0 && inst && num(inst.net, 0) < 0) signal = 'ضغط بيع مؤسسي/أجنبي';
  else if (inst && num(inst.net, 0) > 0) signal = 'دعم مؤسسي';
  return { strongestBuyer, strongestSeller, signal, institutionsPct: inst?.sharePct, individualsPct: ind?.sharePct };
}
async function main() {
  const manual = readJson('data/investor-flow-daily.json', null) || readJson('config/investor-flow-manual-template.json', null) || {};
  const manualRows = normalizeManual(manual);
  const sources = [
    'https://www.egx.com.eg/en/InvestorsTypeCharts.aspx',
    'https://www.egx.com.eg/en/InvestorsTypePieChart.aspx'
  ];
  let status = 'needs_investor_flow_source';
  let rows = manualRows;
  const rawSources = [];

  if (global.fetch) {
    for (const url of sources) {
      try {
        const html = await fetchText(url);
        const parsed = parsePotentialRows(html);
        rawSources.push({ url, ok: true, parsedRows: parsed.length, fetchedAt: new Date().toISOString() });
        if (!rows.length && parsed.length) {
          rows = parsed;
          status = 'parsed_best_effort_from_egx';
        }
      } catch (err) {
        rawSources.push({ url, ok: false, error: String(err.message || err), fetchedAt: new Date().toISOString() });
      }
    }
  }

  if (manualRows.length) status = 'manual_or_prepared_daily_file';
  const c = classify(rows);
  const report = {
    version: '5.6.0',
    generatedAt: new Date().toISOString(),
    status,
    source: status === 'manual_or_prepared_daily_file' ? 'data/investor-flow-daily.json or config template' : 'EGX official investor type pages best effort',
    rows,
    strongestBuyer: c.strongestBuyer,
    strongestSeller: c.strongestSeller,
    signal: c.signal,
    institutionsPct: c.institutionsPct,
    individualsPct: c.individualsPct,
    impact: rows.length ? `أقوى مشتري: ${c.strongestBuyer}. أقوى بائع: ${c.strongestSeller}. الإشارة: ${c.signal}.` : 'لم يتم التقاط بيانات نوع المتعاملين بعد.',
    sources: rawSources
  };
  writeJson('data/investor-flow-daily.json', { generatedAt: report.generatedAt, status, rows });
  writeJson('data/investor-flow-report.json', report);
  writeJson('data/investor-type-source.json', { generatedAt: report.generatedAt, sources: rawSources });
  console.log(`investor-flow-report generated: ${status}, rows=${rows.length}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
