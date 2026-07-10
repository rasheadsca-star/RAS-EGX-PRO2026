#!/usr/bin/env node
'use strict';

const path = require('path');
const { fetchGapHistory } = require('./adapters/yahoo-seed-gap-adapter.cjs');
const { mergeAndValidate } = require('./history-validator.cjs');
const { readHistory, writeHistory } = require('./history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const {
  nowIso,
  readJson,
  round,
  safeTicker,
  sleep,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'history-gap-completion-config.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SEED_REPORT_PATH = path.join(DATA, 'history-seed-import-report.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const REPORT_PATH = path.join(DATA, 'history-gap-completion-report.json');
const ERRORS_PATH = path.join(DATA, 'history-gap-completion-errors.json');
const SOURCE_AUDIT_PATH = path.join(DATA, 'source-audit.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');

const BATCH_NUMBER = Math.max(1, Number(process.env.GAP_BATCH_NUMBER || 1));
const BATCH_SIZE = Math.max(1, Math.min(25, Number(process.env.GAP_BATCH_SIZE || 11)));
const ONLY_TICKER = safeTicker(process.env.GAP_TICKER || '');
const FORCE_REFRESH = String(process.env.GAP_FORCE_REFRESH || 'false').toLowerCase() === 'true';
const REQUEST_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.GAP_REQUEST_CONCURRENCY || 2)));
const BETWEEN_BATCH_MS = Math.max(0, Number(process.env.GAP_BATCH_DELAY_MS || 1600));
const BETWEEN_SYMBOL_MS = Math.max(0, Number(process.env.GAP_SYMBOL_DELAY_MS || 600));

function normalizeMap(raw) {
  const wasArray = Array.isArray(raw);
  const entries = wasArray ? raw : Object.values(raw || {});
  const byTicker = new Map();
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const ticker = safeTicker(item.ticker);
    if (!ticker) continue;
    byTicker.set(ticker, { ...item, ticker });
  }
  return { wasArray, byTicker };
}

function serializeMap(byTicker, wasArray) {
  const ordered = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return wasArray ? ordered : Object.fromEntries(ordered.map((entry) => [entry.ticker, entry]));
}

function seedTickers(seedReport) {
  const items = [
    ...(Array.isArray(seedReport?.imported) ? seedReport.imported : []),
    ...(Array.isArray(seedReport?.improved) ? seedReport.improved : []),
  ];
  return unique(items.map((item) => safeTicker(item?.ticker)).filter(Boolean));
}

function dateDiffDays(later, earlier) {
  if (!later || !earlier) return null;
  const a = new Date(`${later}T00:00:00Z`).getTime();
  const b = new Date(`${earlier}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

function averageConfidence(sessions) {
  const values = (sessions || [])
    .map((session) => Number(session?.confidence?.overall ?? session?.confidence ?? 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : 0;
}

function readAllActiveMapEntries(mapState) {
  return [...mapState.byTicker.values()]
    .filter((entry) => entry.active !== false)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function selectCandidates(mapState, seedReport, config) {
  let tickers = seedTickers(seedReport);
  if (!tickers.length && config.allowDocumentDiscoveryFallback) {
    tickers = readAllActiveMapEntries(mapState)
      .filter((entry) => Boolean(readHistory(ROOT, entry.ticker)?.seedImport?.requiresIncrementalGapFill))
      .map((entry) => entry.ticker);
  }

  if (ONLY_TICKER) tickers = tickers.filter((ticker) => ticker === ONLY_TICKER);

  const candidates = tickers.map((ticker) => {
    const entry = mapState.byTicker.get(ticker);
    const document = readHistory(ROOT, ticker);
    return { ticker, entry, document };
  }).filter((item) => item.entry && item.document && Array.isArray(item.document.sessions) && item.document.sessions.length > 0);

  const filtered = candidates.filter((item) => {
    if (FORCE_REFRESH) return true;
    const complete = item.document.sessions.length >= Number(config.targetSessions || 100);
    const requiresGap = item.document.seedImport?.requiresIncrementalGapFill !== false;
    const stale = Boolean(item.document.staleData);
    return !complete || requiresGap || stale;
  });

  const totalBatches = Math.max(1, Math.ceil(filtered.length / BATCH_SIZE));
  if (ONLY_TICKER) return { selected: filtered, all: filtered, totalBatches: 1 };
  if (BATCH_NUMBER > totalBatches && filtered.length) {
    throw new Error(`Gap batch ${BATCH_NUMBER} exceeds ${totalBatches} batches for ${filtered.length} candidates.`);
  }
  const start = (BATCH_NUMBER - 1) * BATCH_SIZE;
  return {
    selected: filtered.slice(start, start + BATCH_SIZE),
    all: filtered,
    totalBatches,
  };
}

function updateSourceAudit(report) {
  const raw = readJson(SOURCE_AUDIT_PATH, { operations: [] });
  const operations = Array.isArray(raw) ? raw : (Array.isArray(raw?.operations) ? raw.operations : []);
  const records = report.results.map((item) => ({
    operation: 'historical_seed_gap_completion',
    ticker: item.ticker,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    status: item.status,
    requestedSymbol: item.requestedSymbol || null,
    beforeSessions: item.beforeSessions,
    afterSessions: item.afterSessions,
    appendedSessions: item.appendedSessions,
    previousLastSession: item.previousLastSession,
    lastSession: item.lastSession,
    overlap: item.overlap || null,
    confidence: item.averageConfidence || 0,
    errors: item.error ? [item.error] : [],
    warnings: item.warnings || [],
  }));
  const merged = [...operations, ...records].slice(-3000);
  writeJsonAtomic(SOURCE_AUDIT_PATH, Array.isArray(raw) ? merged : {
    ...(raw && typeof raw === 'object' ? raw : {}),
    schemaVersion: '12.7.0',
    generatedAt: report.completedAt,
    lastOperation: records.at(-1) || null,
    operations: merged,
  });
}

async function processCandidate(candidate, config, latestMarketSession, mapState) {
  const startedAt = nowIso();
  const { ticker, entry, document } = candidate;
  const beforeSessions = document.sessions.length;
  const previousLastSession = document.lastSession || document.sessions.at(-1)?.date || null;

  const base = {
    ticker,
    startedAt,
    completedAt: null,
    status: 'failed',
    requestedSymbol: null,
    beforeSessions,
    afterSessions: beforeSessions,
    appendedSessions: 0,
    previousLastSession,
    lastSession: previousLastSession,
    becameComplete100: false,
    recentEnough: false,
    marketLagCalendarDays: null,
    overlap: null,
    averageConfidence: Number(document.averageConfidence || 0),
    warnings: [],
    error: null,
  };

  try {
    const fetched = await fetchGapHistory(entry, document, config);
    const incomingAfterGap = fetched.sessions.filter((session) => session.date > previousLastSession);
    const merged = mergeAndValidate(document.sessions, incomingAfterGap, Number(config.targetSessions || 100));
    const afterSessions = merged.sessions.length;
    const lastSession = merged.sessions.at(-1)?.date || previousLastSession;
    const appendedSessions = incomingAfterGap.filter((session) => merged.sessions.some((stored) => stored.date === session.date)).length;
    const lag = latestMarketSession ? dateDiffDays(latestMarketSession, lastSession) : 0;
    const recentEnough = lag !== null && lag <= Number(config.maxMarketSessionLagCalendarDays || 14);
    const complete100 = afterSessions >= Number(config.targetSessions || 100);
    const gapComplete = complete100 && recentEnough;

    if (appendedSessions < 1 && !FORCE_REFRESH) {
      return {
        ...base,
        completedAt: nowIso(),
        status: 'no_new_sessions',
        requestedSymbol: fetched.requestedSymbol,
        overlap: fetched.overlap,
        recentEnough,
        marketLagCalendarDays: lag,
        warnings: ['overlap_verified_but_no_new_sessions'],
      };
    }

    const warnings = unique([
      ...(document.warnings || []).filter((warning) => warning !== 'historical_seed_requires_recent_gap_fill'),
      ...merged.corporateActions.map(() => 'corporate_action_review_required'),
      'gap_completed_from_same_yahoo_source_family',
      'not_independently_cross_verified',
      !gapComplete ? 'historical_seed_requires_recent_gap_fill' : null,
      !recentEnough ? `latest_session_lags_market:${lag ?? 'unknown'}_calendar_days` : null,
    ]);

    const nextDocument = {
      ...document,
      schemaVersion: '12.7.0',
      generatedAt: nowIso(),
      yahooSymbol: fetched.requestedSymbol,
      availableSessions: afterSessions,
      firstSession: merged.sessions[0]?.date || null,
      lastSession,
      historyStatus: historyStatus(afterSessions),
      primarySource: 'mixed_history_with_yahoo_gap_completion',
      symbolVerified: true,
      symbolVerification: {
        verified: true,
        policy: 'seed_overlap_continuity',
        identityConfidence: fetched.identity.currencyMatches ? 90 : 85,
        officialVerification: false,
        sameSourceFamily: true,
        requestedSymbol: fetched.requestedSymbol,
        returnedSymbol: fetched.identity.returnedSymbol,
        overlap: fetched.overlap,
      },
      identityVerificationPolicy: 'seed_overlap_continuity',
      averageConfidence: averageConfidence(merged.sessions),
      staleData: !recentEnough,
      updateFailed: false,
      lastUpdateError: null,
      warnings,
      seedImport: {
        ...(document.seedImport || {}),
        requiresIncrementalGapFill: !gapComplete,
        gapCompletionAttemptedAt: nowIso(),
        gapCompletionStatus: gapComplete ? 'complete_and_current' : 'partial_or_stale',
      },
      gapCompletion: {
        schemaVersion: '12.7.0',
        source: 'yahoo',
        sourceFamilyMatchesSeed: true,
        requestedSymbol: fetched.requestedSymbol,
        completedAt: nowIso(),
        previousLastSession,
        lastSession,
        appendedSessions,
        overlap: fetched.overlap,
        latestMarketSession,
        marketLagCalendarDays: lag,
        recentEnough,
        complete100,
        officialVerification: false,
      },
      sessions: merged.sessions,
    };

    writeHistory(ROOT, ticker, nextDocument);

    mapState.byTicker.set(ticker, {
      ...entry,
      symbolVerified: true,
      yahooSymbol: fetched.requestedSymbol,
      gapContinuityVerified: true,
      gapContinuityVerifiedAt: nowIso(),
      seedGapCompletionStatus: gapComplete ? 'complete_and_current' : 'partial_or_stale',
      seedGapLastSession: lastSession,
      seedGapAvailableSessions: afterSessions,
      fallbackRequired: !gapComplete,
    });

    return {
      ...base,
      completedAt: nowIso(),
      status: gapComplete ? 'completed_100_current' : 'improved_partial',
      requestedSymbol: fetched.requestedSymbol,
      afterSessions,
      appendedSessions,
      lastSession,
      becameComplete100: beforeSessions < 100 && complete100,
      recentEnough,
      marketLagCalendarDays: lag,
      overlap: fetched.overlap,
      averageConfidence: nextDocument.averageConfidence,
      warnings,
    };
  } catch (error) {
    return {
      ...base,
      completedAt: nowIso(),
      status: 'failed',
      error: error.message,
      warnings: ['existing_history_preserved_unchanged'],
    };
  }
}

async function main() {
  const startedAt = nowIso();
  const config = readJson(CONFIG_PATH, null);
  if (!config || config.enabled !== true) throw new Error('Missing or disabled data/history-gap-completion-config.json');
  const rawMap = readJson(MAP_PATH, null);
  if (!rawMap) throw new Error('Missing data/symbol-map.json');
  const seedReport = readJson(SEED_REPORT_PATH, null);
  if (!seedReport) throw new Error('Missing data/history-seed-import-report.json');
  const summaryBefore = readJson(SUMMARY_PATH, {});
  const latestMarketSession = summaryBefore.latestMarketSession || config.latestMarketSessionOverride || null;
  const mapState = normalizeMap(rawMap);
  const selection = selectCandidates(mapState, seedReport, config);
  if (!selection.selected.length) throw new Error('No seed-imported symbols require gap completion');

  console.log(`V12.7 seed gap completion: candidates=${selection.all.length}, selected=${selection.selected.length}, batch=${BATCH_NUMBER}/${selection.totalBatches}, latestMarketSession=${latestMarketSession || 'unknown'}`);

  const results = [];
  for (let offset = 0; offset < selection.selected.length; offset += REQUEST_CONCURRENCY) {
    const group = selection.selected.slice(offset, offset + REQUEST_CONCURRENCY);
    const groupResults = await Promise.all(group.map(async (candidate, index) => {
      if (index > 0 && BETWEEN_SYMBOL_MS > 0) await sleep(index * BETWEEN_SYMBOL_MS);
      console.log(`Completing gap for ${candidate.ticker}...`);
      const result = await processCandidate(candidate, config, latestMarketSession, mapState);
      console.log(`${candidate.ticker}: ${result.status}${result.error ? ` - ${result.error}` : ''}`);
      return result;
    }));
    results.push(...groupResults);
    if (offset + REQUEST_CONCURRENCY < selection.selected.length && BETWEEN_BATCH_MS > 0) await sleep(BETWEEN_BATCH_MS);
  }

  writeJsonAtomic(MAP_PATH, serializeMap(mapState.byTicker, mapState.wasArray));

  const activeEntries = readAllActiveMapEntries(mapState);
  const summaryAfter = buildSummary(ROOT, activeEntries, {
    egx: { status: 'manual_or_approved_import', role: 'official verification' },
    yahoo: { status: 'live_gap_completion_and_historical_seed', role: 'historical backfill and seed gap completion' },
    mubasher: { status: 'existing_cache_or_approved_import', role: 'cross-check/fallback' },
    investing: { status: 'approved_import', role: 'fallback' },
  });
  buildSessionCalendar(ROOT, summaryAfter);

  const improved = results.filter((item) => item.status === 'completed_100_current' || item.status === 'improved_partial');
  const completed100 = results.filter((item) => item.status === 'completed_100_current');
  const failed = results.filter((item) => item.status === 'failed');
  const noNew = results.filter((item) => item.status === 'no_new_sessions');
  const completedAt = nowIso();
  const report = {
    schemaVersion: '12.7.0',
    startedAt,
    completedAt,
    mode: 'seed_gap_completion',
    batchNumber: ONLY_TICKER ? null : BATCH_NUMBER,
    batchSize: BATCH_SIZE,
    totalBatches: selection.totalBatches,
    latestMarketSession,
    candidateTickers: selection.all.map((item) => item.ticker),
    selectedTickers: selection.selected.map((item) => item.ticker),
    counts: {
      candidates: selection.all.length,
      selected: selection.selected.length,
      improved: improved.length,
      completed100Current: completed100.length,
      becameComplete100: results.filter((item) => item.becameComplete100).length,
      noNewSessions: noNew.length,
      failed: failed.length,
      appendedSessions: results.reduce((sum, item) => sum + Number(item.appendedSessions || 0), 0),
    },
    results,
    coverageBefore: summaryBefore.coverage || null,
    coverageAfter: summaryAfter.coverage,
    summaryAfter: {
      symbolsComplete100: summaryAfter.symbolsComplete100,
      symbolsComplete50: summaryAfter.symbolsComplete50,
      symbolsFailed: summaryAfter.symbolsFailed,
      symbolsStale: summaryAfter.symbolsStale,
      averageConfidence: summaryAfter.averageConfidence,
      latestMarketSession: summaryAfter.latestMarketSession,
    },
    warnings: [
      'Gap completion uses Yahoo, the same source family as the XLSX seed; it is continuity validation, not independent cross-verification.',
      'Duplicate seed dates are never overwritten. Only dates after each existing lastSession are appended; the oldest rows may roll out when retaining the latest 100 sessions.',
      'Confidence remains capped below high-confidence recommendation thresholds until EGX/Mubasher/Investing verification is available.',
    ],
  };
  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(ERRORS_PATH, {
    schemaVersion: '12.7.0',
    generatedAt: completedAt,
    count: failed.length,
    failures: failed.map((item) => ({ ticker: item.ticker, error: item.error })),
    noNewSessions: noNew.map((item) => item.ticker),
  });
  updateSourceAudit(report);
  writeJsonAtomic(LAST_RUN_PATH, {
    schemaVersion: '12.7.0',
    generatedAt: completedAt,
    mode: 'seed_gap_completion',
    selectedTickers: report.selectedTickers,
    succeededTickers: improved.map((item) => item.ticker),
    failed: failed.map((item) => ({ ticker: item.ticker, error: item.error })),
    noNewSessionTickers: noNew.map((item) => item.ticker),
    coverageAfterRun: summaryAfter.coverage,
    gapCompletionReport: 'data/history-gap-completion-report.json',
  });

  console.log(JSON.stringify({
    candidates: report.counts.candidates,
    selected: report.counts.selected,
    improved: report.counts.improved,
    completed100Current: report.counts.completed100Current,
    becameComplete100: report.counts.becameComplete100,
    failed: report.counts.failed,
    appendedSessions: report.counts.appendedSessions,
    coverage100Before: report.coverageBefore?.sessions100Count ?? null,
    coverage100After: report.coverageAfter?.sessions100Count ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
