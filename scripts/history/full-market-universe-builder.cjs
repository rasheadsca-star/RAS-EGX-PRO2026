#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  nowIso,
  readJson,
  safeTicker,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const REPO_ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA_DIR = path.join(REPO_ROOT, 'data');
const MAP_PATH = path.join(DATA_DIR, 'symbol-map.json');
const REPORT_PATH = path.join(DATA_DIR, 'history-universe-report.json');
const MAX_SYMBOLS = Math.max(10, Math.min(400, Number(process.env.HISTORY_UNIVERSE_MAX || 300)));

const CANDIDATE_FILES = [
  'full-market-cache.json',
  'final-opportunity-ranking.json',
  'final-multisource-ranking.json',
  'v54-universe-index.json',
  'universe-index.json',
  'scan-state.json',
  'actionable-watchlist.json',
  'symbol-audit.json',
  'history-50.json',
];

const RESERVED = new Set([
  'EGX', 'EGX30', 'EGX70', 'EGX100', 'CASE30', 'INDEX', 'MARKET', 'TOTAL',
  'UNKNOWN', 'NA', 'NULL', 'NONE', 'USD', 'EGP', 'EUR', 'GBP', 'GOOD', 'TEST',
  'ALIASES', 'ALIAS', 'MAPPING', 'MAPPINGS', 'DEFAULT', 'DEFAULTS', 'CONFIG', 'SETTINGS',
  'METADATA', 'VERSION', 'SCHEMA', 'ERRORS', 'WARNINGS', 'SOURCE', 'SOURCES',
  'WAIT', 'WATCH', 'STRONG', 'BUY', 'SELL', 'HOLD', 'ENTER', 'EXIT',
  'MONITOR', 'MONITORING', 'RECOMMENDATION', 'RECOMMENDATIONS', 'OPPORTUNITY', 'OPPORTUNITIES',
]);


const GENERIC_OBJECT_KEYS = new Set([
  'rows', 'data', 'items', 'stocks', 'symbols', 'results', 'opportunities', 'ranking',
  'candidates', 'meta', 'chart', 'result', 'indicators', 'quote', 'adjclose', 'history',
  'sessions', 'market', 'summary', 'coverage', 'sources', 'status', 'details',
]);

const TICKER_PATHS = [
  'ticker', 'symbol', 'code', 'stockCode', 'stock_code', 'egxSymbol', 'egx_symbol',
  'securityCode', 'security_code', 'instrumentCode', 'instrument_code',
  'identity.symbol', 'stock.symbol', 'security.symbol',
];

const AR_NAME_PATHS = [
  'companyNameAr', 'nameAr', 'arabicName', 'name_ar', 'company_name_ar',
  'companyArabicName', 'securityNameAr', 'stockNameAr',
];

const EN_NAME_PATHS = [
  'companyNameEn', 'nameEn', 'englishName', 'name_en', 'company_name_en',
  'companyName', 'company', 'name', 'securityName', 'stockName',
];

function getPath(object, dotted) {
  let current = object;
  for (const key of dotted.split('.')) {
    if (!current || typeof current !== 'object' || !(key in current)) return null;
    current = current[key];
  }
  return current;
}

function firstValue(object, paths) {
  for (const item of paths) {
    const value = getPath(object, item);
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return null;
}

function normalizeTicker(value) {
  let ticker = safeTicker(value).replace(/\.CA$/i, '');
  if (!/^[A-Z0-9]{2,8}$/.test(ticker)) return null;
  if (RESERVED.has(ticker)) return null;
  if (/^EGX\d+$/.test(ticker)) return null;
  return ticker;
}

function loadExistingMap() {
  const raw = readJson(MAP_PATH, {});
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  const map = new Map();
  for (const entry of entries) {
    const ticker = normalizeTicker(entry?.ticker);
    if (!ticker) continue;
    map.set(ticker, { ...entry, ticker });
  }
  return map;
}

function collectFromObject(root, sourceFile, output) {
  const visited = new Set();

  function addCandidate(rawTicker, object, hint = null) {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) return;
    const companyNameAr = firstValue(object || {}, AR_NAME_PATHS);
    const companyNameEn = firstValue(object || {}, EN_NAME_PATHS);
    const explicitTicker = firstValue(object || {}, TICKER_PATHS);
    const hasMarketEvidence = ['price','close','lastPrice','currentPrice','volume','open','high','low']
      .some((key) => object && typeof object === 'object' && object[key] !== undefined && object[key] !== null);
    if (hint === 'object_key' && !companyNameAr && !companyNameEn && !explicitTicker && !hasMarketEvidence) return;
    const current = output.get(ticker) || {
      ticker,
      companyNameAr: null,
      companyNameEn: null,
      discoverySources: [],
      discoveryHints: [],
    };
    if (!current.companyNameAr && companyNameAr && /[\u0600-\u06FF]/.test(companyNameAr)) current.companyNameAr = companyNameAr;
    if (!current.companyNameEn && companyNameEn && !/^[\d.,%+\- ]+$/.test(companyNameEn)) current.companyNameEn = companyNameEn;
    current.discoverySources = unique([...(current.discoverySources || []), sourceFile]);
    if (hint) current.discoveryHints = unique([...(current.discoveryHints || []), hint]);
    output.set(ticker, current);
  }

  function walk(node, depth, parentKey = null) {
    if (depth > 7 || node === null || node === undefined) return;
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, parentKey);
      return;
    }

    const tickerValue = firstValue(node, TICKER_PATHS);
    if (tickerValue) addCandidate(tickerValue, node, 'field');

    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === 'object') {
        const keyTicker = normalizeTicker(key);
        if (keyTicker && !GENERIC_OBJECT_KEYS.has(String(key).toLowerCase()) && !TICKER_PATHS.includes(key)) {
          addCandidate(keyTicker, value, 'object_key');
        }
        walk(value, depth + 1, key);
      }
    }
  }

  walk(root, 0);
}

function buildEntry(ticker, existing, discovered) {
  const yahooSymbol = existing?.yahooSymbol || existing?.reutersCode || `${ticker}.CA`;
  return {
    ticker,
    companyNameAr: existing?.companyNameAr || discovered?.companyNameAr || null,
    companyNameEn: existing?.companyNameEn || discovered?.companyNameEn || null,
    isin: existing?.isin || null,
    reutersCode: existing?.reutersCode || `${ticker}.CA`,
    yahooSymbol,
    yahooAlternative: existing?.yahooAlternative || null,
    mubasherTicker: existing?.mubasherTicker || ticker,
    investingSlug: existing?.investingSlug || null,
    currency: existing?.currency || 'EGP',
    exchange: existing?.exchange || 'EGX',
    active: existing?.active !== false,
    sample: Boolean(existing?.sample),
    symbolVerified: Boolean(existing?.symbolVerified),
    lastVerifiedAt: existing?.lastVerifiedAt || null,
    discoverySources: unique([
      ...(existing?.discoverySources || []),
      ...(discovered?.discoverySources || []),
    ]),
  };
}

function main() {
  const existingMap = loadExistingMap();
  const discovered = new Map();
  const sourceResults = [];

  for (const filename of CANDIDATE_FILES) {
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      sourceResults.push({ file: `data/${filename}`, status: 'missing', discovered: 0 });
      continue;
    }
    const before = discovered.size;
    const payload = readJson(fullPath, null);
    if (!payload) {
      sourceResults.push({ file: `data/${filename}`, status: 'invalid_json', discovered: 0 });
      continue;
    }
    collectFromObject(payload, `data/${filename}`, discovered);
    sourceResults.push({ file: `data/${filename}`, status: 'read', discovered: discovered.size - before });
  }

  const tickers = unique([...existingMap.keys(), ...discovered.keys()]).sort().slice(0, MAX_SYMBOLS);
  if (tickers.length < 10) {
    throw new Error(`Universe discovery produced only ${tickers.length} symbols; refusing to shrink the existing map.`);
  }

  const output = {};
  for (const ticker of tickers) output[ticker] = buildEntry(ticker, existingMap.get(ticker), discovered.get(ticker));

  writeJsonAtomic(MAP_PATH, output);
  writeJsonAtomic(REPORT_PATH, {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    existingSymbolsBefore: existingMap.size,
    discoveredSymbols: discovered.size,
    symbolsWritten: tickers.length,
    newSymbolsAdded: tickers.filter((ticker) => !existingMap.has(ticker)).length,
    symbolsPreserved: tickers.filter((ticker) => existingMap.has(ticker)).length,
    maxSymbols: MAX_SYMBOLS,
    sourceResults,
    sampleSymbols: tickers.filter((ticker) => output[ticker].sample),
    warning: 'Generated Yahoo candidates are not trusted until runtime identity validation succeeds.',
  });

  console.log(JSON.stringify({
    existingSymbolsBefore: existingMap.size,
    discoveredSymbols: discovered.size,
    symbolsWritten: tickers.length,
    newSymbolsAdded: tickers.filter((ticker) => !existingMap.has(ticker)).length,
  }, null, 2));
}

main();
