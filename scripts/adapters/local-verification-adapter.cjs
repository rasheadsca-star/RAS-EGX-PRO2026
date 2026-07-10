'use strict';

const fs = require('fs');
const path = require('path');
const {
  extractRows,
  getFirst,
  readJson,
  safeTicker,
  toNumber,
} = require('../lib/utils.cjs');

const DEFAULT_FILES = [
  'data/full-market-cache.json',
  'data/final-opportunity-ranking.json',
  'data/final-multisource-ranking.json',
  'data/price-source-audit.json',
];

function sourceName(row, file) {
  const text = String(getFirst(row, [
    'primarySource', 'source', 'priceSource', 'sourceName', 'evidence.source', 'marketSource',
  ]) || path.basename(file)).toLowerCase();
  if (text.includes('mubasher')) return 'mubasher_existing_cache';
  if (text.includes('egx')) return 'egx_existing_cache';
  if (text.includes('investing')) return 'investing_existing_cache';
  return `pro2026_existing:${path.basename(file)}`;
}

function normalizeRow(row, file) {
  const ticker = safeTicker(getFirst(row, ['symbol', 'ticker', 'code', 'stockCode', 'securityCode']));
  if (!ticker) return null;
  const close = toNumber(getFirst(row, ['close', 'price', 'lastPrice', 'currentPrice', 'last', 'market.close', 'quote.close']));
  if (!close || close <= 0) return null;
  return {
    ticker,
    close,
    open: toNumber(getFirst(row, ['open', 'market.open', 'quote.open'])),
    high: toNumber(getFirst(row, ['high', 'market.high', 'quote.high'])),
    low: toNumber(getFirst(row, ['low', 'market.low', 'quote.low'])),
    volume: toNumber(getFirst(row, ['volume', 'market.volume', 'quote.volume'])),
    date: getFirst(row, ['date', 'sessionDate', 'asOfDate', 'market.date', 'quote.date']),
    source: sourceName(row, file),
    sourceFile: file,
  };
}

function loadLocalReferences(repoRoot) {
  const references = new Map();
  for (const relative of DEFAULT_FILES) {
    const file = path.join(repoRoot, relative);
    if (!fs.existsSync(file)) continue;
    const parsed = readJson(file, null);
    const extracted = extractRows(parsed);
    const rows = extracted.length ? extracted : (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.values(parsed).filter((value) => value && typeof value === 'object') : []);
    for (const row of rows) {
      const normalized = normalizeRow(row, relative);
      if (!normalized) continue;
      if (!references.has(normalized.ticker)) references.set(normalized.ticker, normalized);
    }
  }
  return references;
}

module.exports = { loadLocalReferences };
