#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const MAX_POINTS = 50;
const BACKFILL_LIMIT = Number(process.env.V56_HISTORY_BACKFILL_LIMIT || 15);
const ENABLE_WEB_BACKFILL = String(process.env.V56_ENABLE_WEB_BACKFILL || 'true').toLowerCase() !== 'false';

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
function writeJson(rel, data) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function asArray(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (Array.isArray(x.rows)) return x.rows;
  if (Array.isArray(x.data)) return x.data;
  if (Array.isArray(x.items)) return x.items;
  if (Array.isArray(x.symbols)) return x.symbols;
  if (typeof x === 'object') return Object.values(x).filter(v => v && typeof v === 'object');
  return [];
}
function num(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[,%\s]/g, '').replace(/−/g, '-'));
  return Number.isFinite(n) ? n : fallback;
}
function text(v, fallback = '') { return v === null || v === undefined ? fallback : String(v).trim(); }
function symbolOf(r) { return text(r.symbol || r.ticker || r.code || r.Symbol || r.s || r.shortName).toUpperCase(); }
function priceOf(r) { return num(r.close ?? r.price ?? r.lastPrice ?? r.last ?? r.value ?? r.lastTradePrice); }
function sessionDate(sourceHealth) {
  const d = sourceHealth?.lastSuccessAt ? new Date(sourceHealth.lastSuccessAt) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
function normalizePoint(raw, fallbackDate) {
  const close = priceOf(raw);
  if (close === null) return null;
  return {
    date: text(raw.date || raw.sessionDate || raw.day || raw.tradingDate || fallbackDate),
    open: num(raw.open ?? raw.openPrice, close),
    high: num(raw.high ?? raw.highPrice, close),
    low: num(raw.low ?? raw.lowPrice, close),
    close,
    volume: num(raw.volume ?? raw.tradedVolume ?? raw.qty ?? raw.quantity, 0) || 0,
    turnover: num(raw.turnover ?? raw.tradedValue ?? raw.valueTraded, null) ?? ((num(raw.volume ?? raw.tradedVolume, 0) || 0) * close),
    source: raw.source || raw._source || 'snapshot'
  };
}
function mergePoint(list, point) {
  if (!point || !point.date) return list;
  const idx = list.findIndex(p => p.date === point.date);
  if (idx >= 0) list[idx] = { ...list[idx], ...point };
  else list.push(point);
  return list
    .filter(p => p && p.date && num(p.close) !== null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-MAX_POINTS);
}
function uniqueRecords(...sources) {
  const map = new Map();
  sources.flatMap(asArray).forEach(r => {
    const s = symbolOf(r);
    if (!s) return;
    map.set(s, { ...(map.get(s) || {}), ...r, symbol: s });
  });
  return Array.from(map.values());
}
function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function parseDateLoose(s) {
  const t = String(s || '').trim();
  const m1 = t.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m1) {
    const dd = m1[1].padStart(2, '0');
    const mm = m1[2].padStart(2, '0');
    const yyyy = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function extractHistoricalRows(html) {
  const rows = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(html))) {
    const cells = [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => decodeHtml(m[1]));
    if (cells.length < 5) continue;
    const joined = cells.join('|');
    if (!/\d/.test(joined)) continue;
    const date = parseDateLoose(cells[0]);
    if (!date) continue;
    const nums = cells.slice(1).map(c => num(c)).filter(n => n !== null);
    if (!nums.length) continue;
    const [close, open, high, low, volume] = nums;
    rows.push({ date, close, open, high, low, volume: volume || 0, source: 'mubasher-historical-best-effort' });
  }
  return rows;
}
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 EGX-Pro-Hub/5.6' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.text();
}
async function tryBackfill(symbol) {
  if (!ENABLE_WEB_BACKFILL || !global.fetch) return { rows: [], status: 'disabled' };
  const urls = [
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/historical-data`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(symbol)}/historical-data`
  ];
  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const rows = extractHistoricalRows(html).slice(-MAX_POINTS);
      if (rows.length) return { rows, status: 'ok', url };
    } catch (err) {
      // Try next URL.
    }
  }
  return { rows: [], status: 'unavailable' };
}
async function main() {
  const sourceHealth = readJson('data/source-health.json', {});
  const existing = readJson('data/history-50.json', { symbols: {} });
  const legacyHistory = readJson('data/history.json', {});
  const fullCache = readJson('data/full-market-cache.json', []);
  const market = readJson('data/market.json', []);
  const recommendations = readJson('data/recommendations.json', []);
  const universeIndex = readJson('data/universe-index.json', {});
  const today = sessionDate(sourceHealth);

  const output = {
    version: '5.6.0',
    generatedAt: new Date().toISOString(),
    maxSessions: MAX_POINTS,
    status: {
      mode: ENABLE_WEB_BACKFILL ? 'best_effort_web_backfill_plus_incremental_snapshots' : 'incremental_snapshots_only',
      note: 'No fabricated historical prices. If public historical pages are not parseable, the file grows by one real collected session per workflow run.'
    },
    symbols: existing.symbols && typeof existing.symbols === 'object' ? existing.symbols : {}
  };

  // Import legacy history if it exists in any common shape.
  for (const [symbol, list] of Object.entries(legacyHistory.symbols || legacyHistory || {})) {
    if (!Array.isArray(list)) continue;
    const s = String(symbol).toUpperCase();
    output.symbols[s] = output.symbols[s] || [];
    list.map(p => normalizePoint(p, today)).filter(Boolean).forEach(p => { output.symbols[s] = mergePoint(output.symbols[s], p); });
  }

  const records = uniqueRecords(universeIndex.symbols || universeIndex, fullCache, market, recommendations);
  let backfilled = 0;
  let attempted = 0;

  for (const rec of records) {
    const s = symbolOf(rec);
    if (!s) continue;
    output.symbols[s] = output.symbols[s] || [];
    const point = normalizePoint({ ...rec, date: today, source: 'workflow-market-snapshot' }, today);
    output.symbols[s] = mergePoint(output.symbols[s], point);

    if (output.symbols[s].length < Math.min(20, MAX_POINTS) && attempted < BACKFILL_LIMIT) {
      attempted += 1;
      const result = await tryBackfill(s);
      if (result.rows.length) {
        result.rows.forEach(p => { output.symbols[s] = mergePoint(output.symbols[s], p); });
        backfilled += 1;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  const counts = Object.values(output.symbols).map(v => Array.isArray(v) ? v.length : 0);
  output.summary = {
    symbols: counts.length,
    symbolsWithAtLeast2Sessions: counts.filter(n => n >= 2).length,
    symbolsWithAtLeast20Sessions: counts.filter(n => n >= 20).length,
    symbolsWith50Sessions: counts.filter(n => n >= 50).length,
    backfillAttempted: attempted,
    backfillSucceeded: backfilled,
    latestSessionDate: today
  };

  writeJson('data/history-50.json', output);
  console.log(`history-50 generated: ${output.summary.symbols} symbols, ${output.summary.symbolsWithAtLeast2Sessions} with >=2 sessions, backfill ${backfilled}/${attempted}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
