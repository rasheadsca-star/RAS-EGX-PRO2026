/*
  EGX Pro Hub — V4.2.1 Universe Audit
  Safe add-on script. It DOES NOT reset scan-state.json or full-market-cache.json.
  It reads current config/cache outputs and writes data/symbol-audit.json only.
*/
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean).map(x => String(x).trim().toUpperCase())));
}

function normalizeArabic(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeSymbol(value) {
  return /^[A-Z]{2,8}(?:\.CA)?$/.test(String(value || '').trim().toUpperCase());
}

function normalizeCsvText(text) {
  let clean = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();

  // Some prior generated CSV files were accidentally flattened, e.g.
  // symbol,name_ar,name_en,aliases COMI,... TMGH,...
  // Insert a newline before any likely EGX ticker followed by a comma.
  clean = clean.replace(/(aliases)\s+(?=[A-Z]{2,8}(?:\.CA)?,)/i, '$1\n');
  clean = clean.replace(/\s+(?=[A-Z]{2,8}(?:\.CA)?,[^\n]*?,)/g, '\n');
  return clean;
}

function parseLooseCsvLine(line) {
  // The project CSV is simple and does not intentionally use quoted commas.
  // For safety, keep extra commas in aliases rather than losing the row.
  const parts = String(line || '').split(',').map(x => x.trim());
  const symbol = String(parts.shift() || '').trim().toUpperCase();
  if (!looksLikeSymbol(symbol)) return null;
  const name_ar = parts.shift() || '';
  const name_en = parts.shift() || symbol;
  const aliasesRaw = parts.join(',');
  const aliases = aliasesRaw
    ? aliasesRaw.split('|').map(x => x.trim()).filter(Boolean)
    : [];
  return { symbol, name_ar, name_en, aliases };
}

function readCsvSymbols(file) {
  const text = readText(file, '');
  if (!text.trim()) return { rows: [], malformedLines: [], rawSymbols: [] };

  const normalized = normalizeCsvText(text);
  const lines = normalized.split(/\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  const malformedLines = [];

  for (const line of lines) {
    if (/^symbol\s*,/i.test(line)) continue;
    const row = parseLooseCsvLine(line);
    if (row) rows.push(row);
    else malformedLines.push(line.slice(0, 220));
  }

  // Fallback: extract all ticker-like tokens before comma even if a row is malformed.
  const rawSymbols = [];
  const re = /(?:^|\s|\n)([A-Z]{2,8}(?:\.CA)?)\s*,/g;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    if (looksLikeSymbol(m[1]) && m[1].toLowerCase() !== 'symbol') rawSymbols.push(m[1].toUpperCase());
  }

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.symbol)) map.set(row.symbol, row);
    else {
      const old = map.get(row.symbol);
      map.set(row.symbol, {
        ...old,
        name_ar: old.name_ar || row.name_ar,
        name_en: old.name_en && old.name_en !== old.symbol ? old.name_en : row.name_en,
        aliases: Array.from(new Set([...(old.aliases || []), ...(row.aliases || [])]))
      });
    }
  }
  for (const symbol of rawSymbols) {
    if (!map.has(symbol)) map.set(symbol, { symbol, name_ar: '', name_en: symbol, aliases: [] });
  }

  return { rows: Array.from(map.values()), malformedLines, rawSymbols: uniq(rawSymbols) };
}

function readWatchlistSymbols(file) {
  const config = readJson(file, {});
  const rows = [];
  const add = (item) => {
    if (typeof item === 'string' && looksLikeSymbol(item)) rows.push({ symbol: item.toUpperCase(), source: 'watchlist' });
    else if (item && looksLikeSymbol(item.symbol || item.code || item.mubasherSymbol || item.mubasher_symbol)) {
      rows.push({
        symbol: String(item.symbol || item.code || item.mubasherSymbol || item.mubasher_symbol).toUpperCase(),
        name_ar: item.name_ar || '',
        name_en: item.name_en || item.name || '',
        aliases: Array.isArray(item.aliases) ? item.aliases : [],
        source: 'watchlist'
      });
    }
  };
  if (Array.isArray(config.symbols)) config.symbols.forEach(add);
  if (Array.isArray(config.symbolCorrections)) config.symbolCorrections.forEach(add);
  return rows;
}

function symbolsFromRows(rows) {
  return uniq((Array.isArray(rows) ? rows : []).map(r => r && r.symbol));
}

function duplicateSymbols(list) {
  const counts = new Map();
  for (const s of list.filter(Boolean)) counts.set(s, (counts.get(s) || 0) + 1);
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([symbol, count]) => ({ symbol, count }));
}

function main() {
  const generatedAt = new Date().toISOString();
  const csv = readCsvSymbols('config/egx-symbols.csv');
  const watchlistRows = readWatchlistSymbols('config/watchlist.json');

  const configuredRowsMap = new Map();
  for (const row of [...csv.rows, ...watchlistRows]) {
    if (!row || !looksLikeSymbol(row.symbol)) continue;
    if (!configuredRowsMap.has(row.symbol)) configuredRowsMap.set(row.symbol, row);
    else {
      const old = configuredRowsMap.get(row.symbol);
      configuredRowsMap.set(row.symbol, {
        ...old,
        ...row,
        name_ar: old.name_ar || row.name_ar || '',
        name_en: old.name_en || row.name_en || row.symbol,
        aliases: Array.from(new Set([...(old.aliases || []), ...(row.aliases || [])]))
      });
    }
  }

  const configuredRows = Array.from(configuredRowsMap.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const configuredSymbols = configuredRows.map(r => r.symbol);

  const fullCache = readJson('data/full-market-cache.json', {});
  const market = readJson('data/market.json', {});
  const recs = readJson('data/recommendations.json', {});
  const sourceHealth = readJson('data/source-health.json', {});
  const symbolsJson = readJson('data/symbols.json', {});

  const cacheSymbols = symbolsFromRows(fullCache.rows);
  const marketSymbols = symbolsFromRows(market.rows);
  const recSymbols = symbolsFromRows(recs.all || recs.topBuyCandidates || []);
  const generatedUniverseSymbols = symbolsFromRows(symbolsJson.symbols);
  const allKnownSymbols = uniq([...configuredSymbols, ...generatedUniverseSymbols]);
  const cachedAny = uniq([...cacheSymbols, ...marketSymbols, ...recSymbols]);

  const missingFromCache = allKnownSymbols.filter(s => !cachedAny.includes(s)).sort();
  const cachedButNotConfigured = cachedAny.filter(s => !allKnownSymbols.includes(s)).sort();
  const duplicates = duplicateSymbols([...csv.rawSymbols, ...watchlistRows.map(r => r.symbol)]);

  const focused = ['ETRS', 'NIPH', 'GGRN', 'POCO', 'DCCC', 'ALCN', 'CSAG', 'MOIL'];
  const focusStatus = focused.map(symbol => ({
    symbol,
    configured: allKnownSymbols.includes(symbol),
    cached: cachedAny.includes(symbol),
    status: cachedAny.includes(symbol) ? 'cached' : (allKnownSymbols.includes(symbol) ? 'waiting_next_batch' : 'missing_from_config')
  }));

  const rowsBySymbol = new Map();
  for (const row of configuredRows) rowsBySymbol.set(row.symbol, row);

  const audit = {
    ok: true,
    generatedAt,
    mode: 'v4_2_1_universe_repair_audit',
    warning: 'بيانات عامة ومتأخرة من Mubasher Public Pages. هذا التقرير للتدقيق الفني وليس أمر تداول.',
    summary: {
      configuredFromCsv: csv.rows.length,
      configuredFromWatchlist: watchlistRows.length,
      totalConfiguredOrDiscovered: allKnownSymbols.length,
      generatedUniverseFromSymbolsJson: generatedUniverseSymbols.length,
      cachedRows: cachedAny.length,
      missingFromCache: missingFromCache.length,
      cachedButNotConfigured: cachedButNotConfigured.length,
      duplicates: duplicates.length,
      malformedCsvLines: csv.malformedLines.length,
      sourceHealthTotalUniverse: sourceHealth.totalUniverse || null,
      sourceHealthCacheRows: sourceHealth.cacheRows || null,
      universeCoveragePct: sourceHealth.universeCoveragePct || (allKnownSymbols.length ? Math.round((cachedAny.length / allKnownSymbols.length) * 100) : 0)
    },
    etrs: focusStatus.find(x => x.symbol === 'ETRS'),
    focusStatus,
    missingFromCache,
    cachedButNotConfigured,
    duplicates,
    malformedCsvLines: csv.malformedLines.slice(0, 25),
    symbols: allKnownSymbols.map(symbol => {
      const row = rowsBySymbol.get(symbol) || { symbol };
      return {
        symbol,
        name_ar: row.name_ar || '',
        name_en: row.name_en || symbol,
        aliases: row.aliases || [],
        searchText: normalizeArabic([symbol, row.name_ar, row.name_en, ...(row.aliases || [])].filter(Boolean).join(' ')),
        cached: cachedAny.includes(symbol),
        status: cachedAny.includes(symbol) ? 'cached' : 'waiting_next_batch'
      };
    })
  };

  writeJson('data/symbol-audit.json', audit);
  console.log(`symbol-audit.json generated: configured=${audit.summary.totalConfiguredOrDiscovered}, cached=${audit.summary.cachedRows}, missing=${audit.summary.missingFromCache}`);
  if (audit.etrs) console.log(`ETRS status: configured=${audit.etrs.configured}, cached=${audit.etrs.cached}, status=${audit.etrs.status}`);
}

main();
