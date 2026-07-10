#!/usr/bin/env node
/*
  EGX Pro Hub V5.4 Universe Index Builder
  - Generates data/universe-index.json
  - Does NOT touch data/scan-state.json or data/full-market-cache.json
  - Robustly parses compressed/malformed config/egx-symbols.csv where records are not one line per stock.
*/
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const files = {
  configCsv: path.join(ROOT, 'config', 'egx-symbols.csv'),
  health: path.join(ROOT, 'data', 'source-health.json'),
  cache: path.join(ROOT, 'data', 'full-market-cache.json'),
  market: path.join(ROOT, 'data', 'market.json'),
  recs: path.join(ROOT, 'data', 'recommendations.json'),
  pro: path.join(ROOT, 'data', 'pro-report.json'),
  audit: path.join(ROOT, 'data', 'symbol-audit.json'),
  out: path.join(ROOT, 'data', 'universe-index.json')
};

function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return fallback; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(readText(file)); } catch (_) { return fallback; }
}

function symbolOf(row) {
  return String(row?.symbol || row?.ticker || row?.code || row?.mubasherSymbol || row?.Symbol || row?.SYMBOL || '')
    .trim().toUpperCase();
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') { cur += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function dedupe(rows) {
  const map = new Map();
  for (const row of rows) {
    const symbol = symbolOf(row);
    if (!symbol) continue;
    map.set(symbol, Object.assign({}, map.get(symbol) || {}, row, { symbol }));
  }
  return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function discoverSymbolRecords(text) {
  const records = [];
  if (!text || !text.trim()) return records;

  const clean = text.replace(/\r/g, '\n').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
  const headerless = clean.replace(/^symbol\s*,\s*name_ar\s*,\s*name_en\s*,\s*aliases\s*/i, '');
  const re = /(?:^|\s)([A-Z]{2,7}(?:\.[A-Z]{1,3})?)(?=\s*,)/g;
  const matches = [];
  let m;
  while ((m = re.exec(headerless)) !== null) {
    const symbol = String(m[1]).toUpperCase();
    if (['SYMBOL', 'NAME', 'ALIASES', 'FOR', 'AND', 'THE'].includes(symbol)) continue;
    matches.push({ symbol, start: m.index + (m[0].startsWith(' ') ? 1 : 0) });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].start;
    const end = i + 1 < matches.length ? matches[i + 1].start : headerless.length;
    const chunk = headerless.slice(start, end).trim();
    const cells = parseCsvLine(chunk);
    const symbol = String(cells[0] || matches[i].symbol).trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (!symbol || !/^[A-Z0-9.]{2,12}$/.test(symbol)) continue;
    records.push({
      symbol,
      name_ar: cells[1] || '',
      name_en: cells[2] || '',
      aliases: cells.slice(3).join(',').trim(),
      configured: true,
      active: true
    });
  }
  return dedupe(records);
}

function parseSymbolsCsv(text) {
  const rawLines = String(text || '').replace(/\r/g, '\n').split('\n').map(x => x.trim()).filter(Boolean);
  const physicalLines = rawLines.length;
  const discovered = discoverSymbolRecords(text);

  // Normal-line parser is used only if the CSV is truly line-based.
  let normal = [];
  if (physicalLines > 100) {
    const header = parseCsvLine(rawLines[0]).map(h => h.toLowerCase());
    const idx = (names, fallback) => {
      for (const name of names) {
        const i = header.indexOf(name);
        if (i >= 0) return i;
      }
      return fallback;
    };
    const iSymbol = idx(['symbol', 'ticker', 'code'], 0);
    const iAr = idx(['name_ar', 'arabic_name', 'company_ar'], 1);
    const iEn = idx(['name_en', 'name', 'company_en', 'company'], 2);
    const iAliases = idx(['aliases', 'alias'], 3);
    const iSector = idx(['sector', 'industry'], -1);
    normal = rawLines.slice(1).map(line => {
      const cells = parseCsvLine(line);
      const symbol = String(cells[iSymbol] || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
      if (!symbol) return null;
      return {
        symbol,
        name_ar: cells[iAr] || '',
        name_en: cells[iEn] || '',
        aliases: cells[iAliases] || '',
        sector: iSector >= 0 ? cells[iSector] || '' : '',
        configured: true,
        active: true
      };
    }).filter(Boolean);
  }

  const rows = discovered.length >= normal.length ? discovered : normal;
  return { rows: dedupe(rows), physicalLines, parsedRecords: rows.length, parser: discovered.length >= normal.length ? 'compressed-boundary-parser' : 'line-csv-parser' };
}

function likelyStockArray(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  const candidates = [json.rows, json.data, json.market, json.stocks, json.symbols, json.items, json.cache, json.recommendations, json.all, json.records, json.topOpportunities, json.opportunities];
  for (const c of candidates) if (Array.isArray(c) && c.some(x => symbolOf(x))) return c;
  if (typeof json === 'object') {
    const values = Object.values(json);
    if (values.some(v => v && typeof v === 'object' && symbolOf(v))) return values;
  }
  return [];
}

function merge(map, row, source) {
  const symbol = symbolOf(row);
  if (!symbol) return;
  const prev = map.get(symbol) || { symbol };
  map.set(symbol, Object.assign({}, prev, row, { symbol, sources: Array.from(new Set([...(prev.sources || []), source])) }));
}

function main() {
  const csvText = readText(files.configCsv);
  const parsed = parseSymbolsCsv(csvText);
  const health = readJson(files.health, {});
  const audit = readJson(files.audit, {});
  const cache = readJson(files.cache, []);
  const market = readJson(files.market, []);
  const recs = readJson(files.recs, []);
  const pro = readJson(files.pro, []);

  const map = new Map();
  parsed.rows.forEach(r => merge(map, r, 'config'));
  likelyStockArray(cache).forEach(r => merge(map, Object.assign({}, r, { cached: true }), 'cache'));
  likelyStockArray(market).forEach(r => merge(map, Object.assign({}, r, { marketVisible: true }), 'market'));
  likelyStockArray(recs).forEach(r => merge(map, Object.assign({}, r, { recommended: true }), 'recommendations'));
  likelyStockArray(pro).forEach(r => merge(map, Object.assign({}, r, { recommended: true }), 'pro'));

  const failedSymbols = Array.isArray(health.failedSymbols) ? health.failedSymbols.map(s => String(s).toUpperCase()) : [];
  failedSymbols.forEach(symbol => merge(map, { symbol, failed: true }, 'health'));
  const auditMissing = Array.isArray(audit.missingFromCache) ? audit.missingFromCache.map(s => String(s).toUpperCase()) : [];
  auditMissing.forEach(symbol => merge(map, { symbol, missingFromCache: true }, 'audit'));

  const rows = Array.from(map.values()).map(row => {
    const cached = Boolean(row.cached || (row.sources || []).includes('cache'));
    const configured = Boolean(row.configured || (row.sources || []).includes('config'));
    const failed = Boolean(row.failed || failedSymbols.includes(row.symbol));
    const coverageStatus = failed ? 'failed' : cached ? 'cached' : configured ? 'waiting_next_batch' : 'unknown';
    return Object.assign({}, row, { cached, configured, failed, coverageStatus });
  }).sort((a,b) => a.symbol.localeCompare(b.symbol));

  const configuredCount = Number(health.totalUniverse || 0) > rows.length ? Number(health.totalUniverse) : rows.filter(r => r.configured).length;
  const cachedCount = rows.filter(r => r.cached).length || Number(health.cacheRows || 0);
  const waitingSymbols = rows.filter(r => r.coverageStatus === 'waiting_next_batch').map(r => r.symbol);

  const out = {
    version: '5.4.0-institutional-workspace',
    generatedAt: new Date().toISOString(),
    source: 'public-delayed-mubasher-files',
    note: 'Analysis/monitoring only. Not trading orders. This file does not reset scan-state or full-market-cache.',
    diagnostics: {
      parser: parsed.parser,
      csvPhysicalLines: parsed.physicalLines,
      csvParsedRecords: parsed.parsedRecords,
      healthTotalUniverse: health.totalUniverse || null,
      healthCacheRows: health.cacheRows || null,
      scanMode: health.scanMode || null
    },
    summary: {
      configuredCount,
      indexedRows: rows.length,
      cachedCount,
      waitingCount: Math.max(0, configuredCount - cachedCount - failedSymbols.length),
      failedCount: failedSymbols.length,
      coveragePct: configuredCount ? Math.round((cachedCount / configuredCount) * 100) : 0,
      etrsStatus: (rows.find(r => r.symbol === 'ETRS') || { coverageStatus: 'missing_from_index' }).coverageStatus
    },
    missingFromCache: waitingSymbols,
    failedSymbols,
    rows
  };

  fs.mkdirSync(path.dirname(files.out), { recursive: true });
  fs.writeFileSync(files.out, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`[EGX V5.4] universe-index.json generated: ${rows.length} rows, ${cachedCount} cached, ETRS=${out.summary.etrsStatus}`);
}

main();
