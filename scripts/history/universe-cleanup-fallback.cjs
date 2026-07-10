#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const { loadLocalReferences } = require('./adapters/local-verification-adapter.cjs');
const {
  nowIso,
  readJson,
  safeTicker,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const CLEANUP_REPORT_PATH = path.join(DATA, 'history-universe-cleanup-report.json');
const FALLBACK_QUEUE_PATH = path.join(DATA, 'history-fallback-queue.json');
const STATE_PATH = path.join(DATA, 'history-batch-state.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');

const RESERVED_NON_SECURITIES = new Set([
  'ALIASES', 'ALIAS', 'WAIT', 'WATCH', 'STRONG', 'BUY', 'SELL', 'HOLD', 'ENTER', 'EXIT',
  'MONITOR', 'MONITORING', 'RECOMMENDATION', 'RECOMMENDATIONS', 'OPPORTUNITY', 'OPPORTUNITIES',
  'MAPPING', 'MAPPINGS', 'DEFAULT', 'DEFAULTS', 'CONFIG', 'SETTINGS', 'METADATA', 'VERSION',
  'SCHEMA', 'ERRORS', 'WARNINGS', 'SOURCE', 'SOURCES', 'TOTAL', 'MARKET', 'INDEX', 'RESULT',
  'RESULTS', 'SUMMARY', 'COVERAGE', 'STATUS', 'DETAILS', 'ROW', 'ROWS', 'ITEM', 'ITEMS',
  'DATA', 'META', 'CHART', 'QUOTE', 'SESSION', 'SESSIONS',
]);

function cleanName(value) {
  const cleaned = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\bEnd AdSlot\b/gi, ' ')
    .replace(/\[\[?\d+(?:,\d+)*(?:\],?)+/g, ' ')
    .replace(/-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function normalizeMap(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  const map = new Map();
  for (const item of entries) {
    const ticker = safeTicker(item?.ticker);
    if (!ticker) continue;
    map.set(ticker, { ...item, ticker });
  }
  return map;
}

function mapToObject(map) {
  const output = {};
  for (const ticker of [...map.keys()].sort()) output[ticker] = map.get(ticker);
  return output;
}

function classifyError(message) {
  const text = String(message || '');
  const scoreMatch = text.match(/identity score\s+(\d+(?:\.\d+)?)/i);
  if (/HTTP\s+404/i.test(text)) return { category: 'yahoo_404', identityScore: null };
  if (scoreMatch) return { category: 'identity_rejected', identityScore: Number(scoreMatch[1]) };
  if (/no sessions|did not contain|empty/i.test(text)) return { category: 'no_sessions', identityScore: null };
  if (/429|rate limit|too many requests/i.test(text)) return { category: 'rate_limited', identityScore: null };
  if (/timeout|timed out|ECONNRESET|ENOTFOUND/i.test(text)) return { category: 'temporary_network', identityScore: null };
  return { category: 'other', identityScore: null };
}

function isObviousNonSecurity(entry, summaryItem) {
  const ticker = safeTicker(entry?.ticker);
  if (!ticker) return true;
  if (RESERVED_NON_SECURITIES.has(ticker)) return true;
  if (!/^[A-Z0-9]{2,8}$/.test(ticker)) return true;
  const hasName = Boolean(cleanName(entry.companyNameAr) || cleanName(entry.companyNameEn));
  const hasHistory = Boolean(summaryItem?.sourceFile || fs.existsSync(path.join(DATA, 'history', `${ticker}.json`)));
  const onlyObjectKey = Array.isArray(entry.discoveryHints) && entry.discoveryHints.length > 0 && entry.discoveryHints.every((hint) => hint === 'object_key');
  if (!hasName && !hasHistory && onlyObjectKey && /^(WAIT|WATCH|STRONG|BUY|SELL|HOLD|ENTER|EXIT)$/i.test(ticker)) return true;
  return false;
}

function main() {
  const rawMap = readJson(MAP_PATH, null);
  if (!rawMap) throw new Error('Missing data/symbol-map.json');
  const map = normalizeMap(rawMap);
  const oldSummary = readJson(SUMMARY_PATH, { symbols: [] });
  const summaryByTicker = new Map((oldSummary.symbols || []).map((item) => [safeTicker(item.ticker), item]));
  const localReferences = loadLocalReferences(ROOT);

  const deactivated = [];
  const cleanedNames = [];
  const classified = [];
  const fallbackQueue = [];
  const counts = {
    yahoo_404: 0,
    identity_rejected: 0,
    no_sessions: 0,
    rate_limited: 0,
    temporary_network: 0,
    other: 0,
    eligible_guarded_salvage: 0,
  };

  for (const [ticker, original] of map) {
    const summaryItem = summaryByTicker.get(ticker) || null;
    const companyNameAr = cleanName(original.companyNameAr);
    const companyNameEn = cleanName(original.companyNameEn);
    let entry = { ...original, companyNameAr, companyNameEn };

    if (companyNameAr !== original.companyNameAr || companyNameEn !== original.companyNameEn) {
      cleanedNames.push(ticker);
    }

    if (isObviousNonSecurity(entry, summaryItem)) {
      entry = {
        ...entry,
        active: false,
        instrumentType: 'non_security_metadata',
        exclusionReason: 'v12_5_reserved_or_non_security_key',
        excludedAt: nowIso(),
        fallbackRequired: false,
        identityReviewStatus: null,
      };
      deactivated.push(ticker);
      map.set(ticker, entry);
      continue;
    }

    if (entry.active === false && entry.exclusionReason === 'v12_5_reserved_or_non_security_key') {
      map.set(ticker, entry);
      continue;
    }

    const failed = summaryItem && (summaryItem.processingStatus === 'failed' || !summaryItem.sourceFile || !summaryItem.symbolVerified);
    if (!failed) {
      map.set(ticker, { ...entry, fallbackRequired: false });
      continue;
    }

    const classification = classifyError(summaryItem.lastUpdateError);
    counts[classification.category] += 1;
    const localReference = localReferences.get(ticker) || null;
    const configuredSymbol = String(entry.yahooSymbol || entry.reutersCode || `${ticker}.CA`).toUpperCase();
    const exactCairoCandidate = configuredSymbol === `${ticker}.CA`;
    const eligibleGuardedSalvage = classification.category === 'identity_rejected'
      && classification.identityScore >= 60
      && exactCairoCandidate
      && Boolean(localReference?.close)
      && Boolean(companyNameAr || companyNameEn);

    if (eligibleGuardedSalvage) counts.eligible_guarded_salvage += 1;

    entry = {
      ...entry,
      active: entry.active !== false,
      failureCategory: classification.category,
      lastFailureMessage: summaryItem.lastUpdateError || null,
      identityRejectedScore: classification.identityScore,
      identityReviewStatus: eligibleGuardedSalvage ? 'eligible_for_guarded_salvage' : null,
      identityPolicy: eligibleGuardedSalvage ? 'guarded_local_crosscheck' : null,
      identityMaxPriceDifferencePct: eligibleGuardedSalvage ? 8 : null,
      fallbackRequired: !eligibleGuardedSalvage,
      fallbackPriority: classification.category === 'yahoo_404' ? 'high' : 'medium',
      fallbackSources: ['egx_daily_report', 'mubasher', 'investing', 'approved_csv'],
      classifiedAt: nowIso(),
    };
    map.set(ticker, entry);

    const row = {
      ticker,
      companyNameAr,
      companyNameEn,
      category: classification.category,
      identityScore: classification.identityScore,
      currentYahooSymbol: configuredSymbol,
      localReferenceAvailable: Boolean(localReference?.close),
      localReferenceClose: localReference?.close || null,
      localReferenceSource: localReference?.source || null,
      eligibleGuardedSalvage,
      recommendedAction: eligibleGuardedSalvage
        ? 'run_salvage_identity'
        : (classification.category === 'yahoo_404' ? 'use_verified_alternative_source_or_approved_import' : 'manual_review'),
      error: summaryItem.lastUpdateError || null,
    };
    classified.push(row);
    if (!eligibleGuardedSalvage) fallbackQueue.push(row);
  }

  writeJsonAtomic(MAP_PATH, mapToObject(map));
  const activeEntries = [...map.values()].filter((entry) => entry.active !== false).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const summary = buildSummary(ROOT, activeEntries, {
    egx: { status: 'manual_or_approved_import', role: 'official verification and fallback' },
    yahoo: { status: 'available_with_guarded_identity_policy', role: 'historical backfill' },
    mubasher: { status: 'existing_cache_or_approved_import', role: 'latest-session cross-check and fallback' },
    investing: { status: 'approved_import', role: 'historical fallback' },
  });
  buildSessionCalendar(ROOT, summary);

  const report = {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    symbolsBefore: map.size,
    activeSymbolsAfter: activeEntries.length,
    deactivatedCount: deactivated.length,
    deactivatedTickers: deactivated,
    cleanedNameCount: cleanedNames.length,
    cleanedNameTickers: cleanedNames,
    failedClassified: classified.length,
    counts,
    guardedSalvageTickers: classified.filter((item) => item.eligibleGuardedSalvage).map((item) => item.ticker),
    fallbackQueueCount: fallbackQueue.length,
    classification: classified,
  };
  writeJsonAtomic(CLEANUP_REPORT_PATH, report);
  writeJsonAtomic(FALLBACK_QUEUE_PATH, {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    instructions: 'Do not fabricate data. Resolve with EGX/Mubasher/Investing or approved CSV/JSON only.',
    total: fallbackQueue.length,
    queue: fallbackQueue,
  });

  const oldState = readJson(STATE_PATH, {});
  const batchSize = Math.max(1, Number(oldState.batchSize || 20));
  writeJsonAtomic(STATE_PATH, {
    ...oldState,
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    totalSymbols: activeEntries.length,
    totalBatches: Math.max(1, Math.ceil(activeEntries.length / batchSize)),
    lastMode: 'cleanup_and_classify',
    universeCleanup: {
      deactivatedCount: deactivated.length,
      identitySalvageEligible: counts.eligible_guarded_salvage,
      fallbackQueueCount: fallbackQueue.length,
    },
  });
  writeJsonAtomic(LAST_RUN_PATH, {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    mode: 'cleanup_and_classify',
    selectedTickers: [],
    deactivatedTickers: deactivated,
    guardedSalvageTickers: report.guardedSalvageTickers,
    fallbackQueueCount: fallbackQueue.length,
    coverageAfterRun: summary.coverage,
  });

  console.log(JSON.stringify({
    activeSymbolsAfter: activeEntries.length,
    deactivated,
    identityRejected: counts.identity_rejected,
    eligibleGuardedSalvage: counts.eligible_guarded_salvage,
    yahoo404: counts.yahoo_404,
    fallbackQueue: fallbackQueue.length,
    complete100: summary.symbolsComplete100,
    failedAfterCleanup: summary.symbolsFailed,
  }, null, 2));
}

main();
