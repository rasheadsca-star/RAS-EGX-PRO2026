#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getJson } = require('./lib/http-client.cjs');
const { fetchHistory } = require('./adapters/yahoo-history-adapter.cjs');
const { buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const {
  nowIso,
  readJson,
  safeTicker,
  sleep,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const REPORT_PATH = path.join(DATA, 'history-symbol-repair-report.json');
const STATE_PATH = path.join(DATA, 'history-batch-state.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');
const BATCH_SIZE = Math.max(1, Math.min(40, Number(process.env.HISTORY_REPAIR_BATCH_SIZE || 20)));
const BATCH_NUMBER = Math.max(1, Number(process.env.HISTORY_REPAIR_BATCH_NUMBER || 1));
const DELAY_MS = Math.max(0, Number(process.env.HISTORY_REPAIR_DELAY_MS || 500));

const NON_SECURITY_TICKERS = new Set([
  'ALIASES', 'ALIAS', 'MAPPING', 'MAPPINGS', 'DEFAULT', 'DEFAULTS', 'CONFIG', 'SETTINGS',
  'METADATA', 'VERSION', 'SCHEMA', 'ERRORS', 'WARNINGS', 'SOURCE', 'SOURCES', 'TOTAL',
  'MARKET', 'INDEX', 'RESULT', 'RESULTS', 'SUMMARY', 'COVERAGE', 'STATUS', 'DETAILS',
]);

function normalizeMap(raw) {
  const values = Array.isArray(raw) ? raw : Object.values(raw || {});
  const map = new Map();
  for (const entry of values) {
    const ticker = safeTicker(entry?.ticker);
    if (!ticker) continue;
    map.set(ticker, { ...entry, ticker });
  }
  return map;
}

function mapToObject(map) {
  const output = {};
  for (const ticker of [...map.keys()].sort()) output[ticker] = map.get(ticker);
  return output;
}

function cleanName(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\bEnd AdSlot\b/gi, ' ')
    .replace(/\[\[?\d+(?:,\d+)*(?:\],?)+/g, ' ')
    .replace(/-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return new Set(cleanName(value).toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !['company', 'egypt', 'egyptian', 'holding', 'industries'].includes(token)));
}

function similarity(a, b) {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / Math.max(left.size, right.size);
}

function isObviousNonSecurity(entry) {
  const ticker = safeTicker(entry.ticker);
  if (NON_SECURITY_TICKERS.has(ticker)) return true;
  if (!/^[A-Z0-9]{2,8}$/.test(ticker)) return true;
  if (/^(ROW|ROWS|ITEM|ITEMS|DATA|META|CHART|QUOTE|SESSION|SESSIONS)$/i.test(ticker)) return true;
  return false;
}

function buildSearchUrls(query) {
  const encoded = encodeURIComponent(query);
  const params = `q=${encoded}&quotesCount=20&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
  return [
    `https://query1.finance.yahoo.com/v1/finance/search?${params}`,
    `https://query2.finance.yahoo.com/v1/finance/search?${params}`,
  ];
}

function loadSearchFixture(query) {
  const dir = process.env.HISTORY_SEARCH_FIXTURE_DIR;
  if (!dir) return null;
  const safe = String(query).replace(/[^A-Za-z0-9_-]/g, '_');
  const file = path.join(dir, `${safe}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file, null);
}

function candidateScore(entry, quote) {
  const ticker = safeTicker(entry.ticker);
  const symbol = String(quote.symbol || '').toUpperCase();
  const base = symbol.replace(/\.CA$/i, '');
  const exchangeText = [quote.exchange, quote.exchDisp, quote.exchangeDisplay, quote.fullExchangeName]
    .filter(Boolean).join(' ').toLowerCase();
  const type = String(quote.quoteType || quote.typeDisp || '').toUpperCase();
  const candidateName = quote.longname || quote.shortname || quote.name || '';
  let score = 0;
  const reasons = [];

  if (symbol.endsWith('.CA')) { score += 20; reasons.push('cairo_suffix'); }
  if (/(^|\b)(cai|cairo|egypt|egx)(\b|$)/i.test(exchangeText)) { score += 20; reasons.push('cairo_exchange'); }
  if (type === 'EQUITY') { score += 15; reasons.push('equity'); }
  if (base === ticker) { score += 35; reasons.push('exact_ticker'); }
  else if (base.startsWith(ticker) || ticker.startsWith(base)) { score += 15; reasons.push('ticker_similarity'); }

  const nameScore = Math.max(
    similarity(entry.companyNameEn, candidateName),
    similarity(entry.companyNameAr, candidateName),
  );
  if (nameScore >= 0.7) { score += 20; reasons.push('strong_name_match'); }
  else if (nameScore >= 0.35) { score += 10; reasons.push('partial_name_match'); }

  return { score, reasons, symbol, candidateName, exchangeText, type, nameScore };
}

async function searchYahoo(entry) {
  const queries = unique([
    entry.ticker,
    cleanName(entry.companyNameEn),
    cleanName(entry.companyNameAr),
  ]).filter(Boolean);
  const candidates = new Map();
  const errors = [];

  for (const query of queries) {
    try {
      const fixture = loadSearchFixture(query);
      const payload = fixture || (await getJson(buildSearchUrls(query), {
        timeoutMs: 15000,
        maxAttempts: 2,
        backoffMs: 700,
      })).json;
      for (const quote of payload?.quotes || []) {
        const scored = candidateScore(entry, quote);
        if (!scored.symbol || !scored.symbol.endsWith('.CA')) continue;
        const previous = candidates.get(scored.symbol);
        if (!previous || scored.score > previous.score) candidates.set(scored.symbol, { ...scored, quote });
      }
    } catch (error) {
      errors.push(`${query}:${error.message}`);
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  return { candidates: [...candidates.values()].sort((a, b) => b.score - a.score), errors };
}

async function verifyCandidate(entry, candidate) {
  const temporary = {
    ...entry,
    yahooSymbol: candidate.symbol,
    reutersCode: candidate.symbol,
    yahooAlternative: null,
  };
  try {
    const fetched = await fetchHistory(temporary, { range: '1y' });
    return {
      ok: true,
      symbol: fetched.requestedSymbol,
      sessions: fetched.sessions.length,
      identityScore: fetched.identity.score,
      identityEvidence: fetched.identity.evidence,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function failedTickers(summary, map) {
  const fromSummary = (summary?.symbols || [])
    .filter((item) => item.processingStatus === 'failed' || !item.sourceFile || !item.symbolVerified)
    .map((item) => safeTicker(item.ticker));
  if (fromSummary.length) return unique(fromSummary).filter((ticker) => map.has(ticker));
  return [...map.values()]
    .filter((entry) => entry.active !== false)
    .filter((entry) => !fs.existsSync(path.join(DATA, 'history', `${entry.ticker}.json`)))
    .map((entry) => entry.ticker);
}

async function main() {
  const rawMap = readJson(MAP_PATH, null);
  if (!rawMap) throw new Error('Missing data/symbol-map.json');
  const map = normalizeMap(rawMap);
  const summaryBefore = readJson(SUMMARY_PATH, { symbols: [] });
  const failed = failedTickers(summaryBefore, map);

  const deactivated = [];
  for (const ticker of failed) {
    const entry = map.get(ticker);
    if (!entry || entry.active === false || !isObviousNonSecurity(entry)) continue;
    map.set(ticker, {
      ...entry,
      active: false,
      instrumentType: 'non_security_metadata',
      exclusionReason: 'obvious_non_security_discovery_key',
      excludedAt: nowIso(),
    });
    deactivated.push(ticker);
  }

  const repairable = failed.filter((ticker) => map.get(ticker)?.active !== false);
  const totalBatches = Math.max(1, Math.ceil(repairable.length / BATCH_SIZE));
  if (BATCH_NUMBER > totalBatches && repairable.length) {
    throw new Error(`Repair batch ${BATCH_NUMBER} exceeds ${totalBatches} batches for ${repairable.length} failed symbols.`);
  }
  const start = (BATCH_NUMBER - 1) * BATCH_SIZE;
  const selected = repairable.slice(start, start + BATCH_SIZE);
  const operations = [];
  const resolvedTickers = [];

  for (const ticker of selected) {
    const entry = map.get(ticker);
    const operation = {
      ticker,
      startedAt: nowIso(),
      oldYahooSymbol: entry.yahooSymbol || entry.reutersCode || null,
      status: 'unresolved',
      searchErrors: [],
      candidates: [],
      selectedCandidate: null,
      verification: null,
    };
    console.log(`Resolving ${ticker}...`);
    const search = await searchYahoo(entry);
    operation.searchErrors = search.errors;
    operation.candidates = search.candidates.slice(0, 5).map((item) => ({
      symbol: item.symbol,
      score: item.score,
      reasons: item.reasons,
      name: item.candidateName,
      exchange: item.exchangeText,
      quoteType: item.type,
    }));

    for (const candidate of search.candidates.filter((item) => item.score >= 65).slice(0, 5)) {
      const verification = await verifyCandidate(entry, candidate);
      if (!verification.ok) continue;
      operation.status = 'resolved_candidate';
      operation.selectedCandidate = candidate.symbol;
      operation.verification = verification;
      map.set(ticker, {
        ...entry,
        companyNameEn: cleanName(entry.companyNameEn) || entry.companyNameEn || null,
        companyNameAr: cleanName(entry.companyNameAr) || entry.companyNameAr || null,
        yahooSymbol: candidate.symbol,
        reutersCode: candidate.symbol,
        yahooAlternative: operation.oldYahooSymbol && operation.oldYahooSymbol !== candidate.symbol ? operation.oldYahooSymbol : entry.yahooAlternative || null,
        repairStatus: 'resolved_candidate',
        repairMethod: 'yahoo_search_plus_chart_validation',
        repairScore: candidate.score,
        repairedAt: nowIso(),
      });
      resolvedTickers.push(ticker);
      break;
    }

    if (operation.status !== 'resolved_candidate') {
      map.set(ticker, {
        ...entry,
        companyNameEn: cleanName(entry.companyNameEn) || entry.companyNameEn || null,
        companyNameAr: cleanName(entry.companyNameAr) || entry.companyNameAr || null,
        repairStatus: search.errors.length && !search.candidates.length ? 'search_error' : 'unresolved_no_valid_yahoo_candidate',
        lastRepairAttemptAt: nowIso(),
      });
    }
    operation.completedAt = nowIso();
    operations.push(operation);
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  writeJsonAtomic(MAP_PATH, mapToObject(map));
  const report = {
    schemaVersion: '12.4.0',
    generatedAt: nowIso(),
    failedBefore: failed.length,
    deactivatedNonSecurities: deactivated,
    repairableFailed: repairable.length,
    batchNumber: BATCH_NUMBER,
    batchSize: BATCH_SIZE,
    totalBatches,
    selectedTickers: selected,
    resolvedTickers,
    unresolvedTickers: selected.filter((ticker) => !resolvedTickers.includes(ticker)),
    operations,
  };
  writeJsonAtomic(REPORT_PATH, report);

  const activeEntries = [...map.values()].filter((entry) => entry.active !== false).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const summary = buildSummary(ROOT, activeEntries, {
    egx: { status: 'manual_or_future_adapter', role: 'official verification' },
    yahoo: { status: 'available_with_symbol_repair', role: 'historical backfill' },
    mubasher: { status: 'existing_cache_available', role: 'latest-session cross-check' },
    investing: { status: 'manual_fallback', role: 'fallback/manual verification' },
  });
  buildSessionCalendar(ROOT, summary);
  const oldState = readJson(STATE_PATH, {});
  writeJsonAtomic(STATE_PATH, {
    ...oldState,
    schemaVersion: '12.4.0',
    generatedAt: nowIso(),
    totalSymbols: activeEntries.length,
    totalBatches: Math.max(1, Math.ceil(activeEntries.length / Number(oldState.batchSize || 20))),
    lastMode: 'repair_failed_batch',
    lastRepairBatchNumber: BATCH_NUMBER,
    repairTotalBatches: totalBatches,
    repairResolvedCount: resolvedTickers.length,
    repairUnresolvedCount: report.unresolvedTickers.length,
  });
  writeJsonAtomic(LAST_RUN_PATH, {
    schemaVersion: '12.4.0',
    generatedAt: nowIso(),
    mode: 'retry_resolved',
    selectedTickers: resolvedTickers,
    repairBatchNumber: BATCH_NUMBER,
    coverageAfterMapRepair: summary.coverage,
  });

  console.log(JSON.stringify({
    failedBefore: failed.length,
    deactivated: deactivated.length,
    selected: selected.length,
    resolved: resolvedTickers.length,
    unresolved: report.unresolvedTickers.length,
    activeDenominator: activeEntries.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
