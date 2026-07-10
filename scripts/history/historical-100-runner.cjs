#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { fetchHistory } = require('./adapters/yahoo-history-adapter.cjs');
const { loadLocalReferences } = require('./adapters/local-verification-adapter.cjs');
const { loadApprovedRecords, applyApprovedRecords } = require('./adapters/approved-verification-adapter.cjs');
const { mergeAndValidate } = require('./history-validator.cjs');
const { readHistory, writeHistory, preserveFailedHistory } = require('./history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const {
  ensureDir,
  nowIso,
  readJson,
  round,
  safeTicker,
  sleep,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const REPO_ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA_DIR = path.join(REPO_ROOT, 'data');
const MAP_PATH = path.join(DATA_DIR, 'symbol-map.json');
const STATE_PATH = path.join(DATA_DIR, 'history-batch-state.json');
const LAST_RUN_PATH = path.join(DATA_DIR, 'history-last-run.json');
const MODE = String(process.env.HISTORY_MODE || process.argv[2] || 'sample').trim();
const REPAIR_TICKER = safeTicker(process.env.HISTORY_TICKER || process.argv[3] || '');
const TARGET_SESSIONS = 100;
const BATCH_SIZE = Math.max(1, Math.min(25, Number(process.env.HISTORY_BATCH_SIZE || 20)));
const REQUEST_BATCH_SIZE = Math.max(1, Math.min(5, Number(process.env.HISTORY_REQUEST_CONCURRENCY || 3)));
const EXPLICIT_BATCH_NUMBER = Math.max(1, Number(process.env.HISTORY_BATCH_NUMBER || 1));
const BETWEEN_BATCH_MS = Math.max(0, Number(process.env.HISTORY_BATCH_DELAY_MS || 1800));
const BETWEEN_SYMBOL_MS = Math.max(0, Number(process.env.HISTORY_SYMBOL_DELAY_MS || 550));
const FORCE_REFRESH = String(process.env.HISTORY_FORCE_REFRESH || 'false').toLowerCase() === 'true';

function loadMap() {
  const parsed = readJson(MAP_PATH, null);
  if (!parsed) throw new Error(`Missing required map: ${path.relative(REPO_ROOT, MAP_PATH)}`);
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
  return entries
    .map((entry) => ({ ...entry, ticker: safeTicker(entry.ticker) }))
    .filter((entry) => entry.ticker && entry.active !== false)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function isCompleteHealthy(entry) {
  const document = readHistory(REPO_ROOT, entry.ticker);
  return Boolean(
    document &&
    document.symbolVerified &&
    Array.isArray(document.sessions) &&
    document.sessions.length >= TARGET_SESSIONS &&
    !document.staleData &&
    !document.updateFailed
  );
}

function selectEntries(entries) {
  const state = readJson(STATE_PATH, {});
  const totalBatches = Math.max(1, Math.ceil(entries.length / BATCH_SIZE));
  let batchNumber = EXPLICIT_BATCH_NUMBER;
  let selected;

  if (MODE === 'repair_symbol') {
    if (!REPAIR_TICKER) throw new Error('repair_symbol mode requires HISTORY_TICKER');
    const found = entries.find((entry) => entry.ticker === REPAIR_TICKER);
    if (!found) throw new Error(`Ticker ${REPAIR_TICKER} was not found in data/symbol-map.json`);
    selected = [found];
    batchNumber = null;
  } else if (MODE === 'sample') {
    selected = entries.filter((entry) => entry.sample).slice(0, 10);
    if (!selected.length) selected = entries.slice(0, 10);
    batchNumber = null;
  } else if (MODE === 'retry_resolved') {
    const repairReport = readJson(path.join(DATA_DIR, 'history-symbol-repair-report.json'), {});
    const resolved = new Set((repairReport.resolvedTickers || []).map(safeTicker).filter(Boolean));
    selected = entries.filter((entry) => resolved.has(entry.ticker));
    batchNumber = Number(repairReport.batchNumber || EXPLICIT_BATCH_NUMBER || 1);
  } else if (MODE === 'retry_identity') {
    const identityEntries = entries.filter((entry) => {
      const document = readHistory(REPO_ROOT, entry.ticker);
      return entry.identityReviewStatus === 'eligible_for_guarded_salvage'
        && entry.identityPolicy === 'guarded_local_crosscheck'
        && (!document || !document.symbolVerified || (document.sessions || []).length < 20);
    });
    const identityBatches = Math.max(1, Math.ceil(identityEntries.length / BATCH_SIZE));
    if (EXPLICIT_BATCH_NUMBER > identityBatches && identityEntries.length) {
      throw new Error(`Identity salvage batch ${EXPLICIT_BATCH_NUMBER} exceeds ${identityBatches} batches.`);
    }
    const start = (EXPLICIT_BATCH_NUMBER - 1) * BATCH_SIZE;
    selected = identityEntries.slice(start, start + BATCH_SIZE);
    batchNumber = EXPLICIT_BATCH_NUMBER;
  } else if (MODE === 'retry_failed') {
    const failedEntries = entries.filter((entry) => {
      const document = readHistory(REPO_ROOT, entry.ticker);
      return !document || document.updateFailed || !document.symbolVerified || (document.sessions || []).length < 20;
    });
    const failedBatches = Math.max(1, Math.ceil(failedEntries.length / BATCH_SIZE));
    if (EXPLICIT_BATCH_NUMBER > failedBatches) {
      throw new Error(`Retry batch ${EXPLICIT_BATCH_NUMBER} exceeds ${failedBatches} failed-symbol batches.`);
    }
    const start = (EXPLICIT_BATCH_NUMBER - 1) * BATCH_SIZE;
    selected = failedEntries.slice(start, start + BATCH_SIZE);
    batchNumber = EXPLICIT_BATCH_NUMBER;
  } else if (MODE === 'incremental_auto' || MODE === 'incremental') {
    batchNumber = Math.max(1, Math.min(totalBatches, Number(state.nextIncrementalBatch || 1)));
    const start = (batchNumber - 1) * BATCH_SIZE;
    selected = entries.slice(start, start + BATCH_SIZE);
  } else if (MODE === 'batch_backfill' || MODE === 'incremental_batch' || MODE === 'full_backfill') {
    if (batchNumber > totalBatches) {
      throw new Error(`Batch ${batchNumber} exceeds total batches ${totalBatches} for ${entries.length} symbols.`);
    }
    const start = (batchNumber - 1) * BATCH_SIZE;
    selected = entries.slice(start, start + BATCH_SIZE);
  } else {
    throw new Error(`Unsupported HISTORY_MODE: ${MODE}`);
  }

  if (!selected.length) throw new Error(`No symbols selected for mode=${MODE}`);
  return { selected, batchNumber, totalBatches, state };
}

function compareLatestWithLocal(session, reference) {
  if (!session || !reference?.close) return { session, verification: null };
  const tolerance = Math.max(0.01, Math.abs(reference.close) * 0.001);
  const difference = Math.abs(session.close - reference.close);
  const differencePct = difference / reference.close * 100;
  const source = reference.source || 'pro2026_existing_cache';
  const trustedIndependentSource = /^(egx_|mubasher_|investing_)/.test(source);
  if (!trustedIndependentSource) {
    return {
      session,
      verification: {
        source,
        matched: null,
        usedForConfidence: false,
        differencePct: round(differencePct, 4),
        reference,
      },
    };
  }

  if (difference <= tolerance) {
    const verifiedBy = unique([...(session.verifiedBy || []), source]);
    const sourceUrls = {
      ...(session.sourceUrls || {}),
      verification: unique([...(session.sourceUrls?.verification || []), reference.sourceFile]),
    };
    return {
      session: {
        ...session,
        verifiedBy,
        sourceUrls,
        confidence: {
          ...session.confidence,
          overall: source.includes('egx_') ? 100 : 90,
          ohlc: 90,
          volume: session.volume === null ? 60 : Number(session.confidence?.volume || 75),
        },
        officialVerified: source.includes('egx_'),
        validationStatus: source.includes('egx_') ? 'officially_verified_latest_close' : 'cross_verified_latest_close',
        warnings: (session.warnings || []).filter((warning) => !String(warning).startsWith('local_price_conflict')),
      },
      verification: { source, matched: true, differencePct: round(differencePct, 4), reference },
    };
  }

  return {
    session: {
      ...session,
      confidence: { ...session.confidence, overall: 40, ohlc: 40 },
      validationStatus: 'source_conflict',
      warnings: unique([...(session.warnings || []), `local_price_conflict:${round(differencePct, 3)}%`]),
    },
    verification: { source, matched: false, differencePct: round(differencePct, 4), reference },
  };
}

function averageConfidence(sessions) {
  const values = sessions.map((session) => Number(session.confidence?.overall || 0)).filter(Number.isFinite);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : 0;
}

function shouldSkipComplete(entry) {
  return !FORCE_REFRESH && (MODE === 'batch_backfill' || MODE === 'full_backfill') && isCompleteHealthy(entry);
}

async function processSymbol(entry, localReference, approvedRecords) {
  const startedAt = nowIso();
  const existing = readHistory(REPO_ROOT, entry.ticker);
  const range = MODE.startsWith('incremental') || MODE === 'incremental' ? '3mo' : '1y';
  const audit = {
    ticker: entry.ticker,
    operation: MODE,
    startedAt,
    completedAt: null,
    requestedSymbol: null,
    primarySource: 'yahoo',
    rowsReceived: 0,
    rowsValid: 0,
    rowsStored: existing?.sessions?.length || 0,
    firstStoredDate: existing?.firstSession || null,
    lastStoredDate: existing?.lastSession || null,
    verificationSources: [],
    confidence: existing?.averageConfidence || 0,
    errors: [],
    warnings: [],
  };

  try {
    const fetched = await fetchHistory(entry, { range, localReference });
    audit.requestedSymbol = fetched.requestedSymbol;
    audit.rowsReceived = fetched.sessions.length;
    audit.warnings.push(...(fetched.candidateFailures || []));

    let incoming = fetched.sessions;
    let verification = null;
    if (incoming.length && localReference) {
      const latestIndex = incoming.length - 1;
      const checked = compareLatestWithLocal(incoming[latestIndex], localReference);
      incoming[latestIndex] = checked.session;
      verification = checked.verification;
    }

    const approved = applyApprovedRecords(incoming, entry.ticker, approvedRecords);
    incoming = approved.sessions;
    if (approved.applied.length) audit.warnings.push(...approved.applied.map((item) => `approved_verification:${item.source}:${item.date}`));

    const merged = mergeAndValidate(existing?.sessions || [], incoming, TARGET_SESSIONS);
    audit.rowsValid = merged.sessions.length;
    audit.warnings.push(...merged.quarantine.map((item) => `${item.date || 'unknown'}:${item.errors.join(',')}`));

    if (!merged.sessions.length) throw new Error('No valid sessions remained after validation');

    const verificationSources = unique([
      ...(existing?.verificationSources || []),
      ...(verification?.matched ? [verification.source] : []),
      ...merged.sessions.flatMap((session) => session.verifiedBy || []),
    ]);
    const document = {
      schemaVersion: '12.5.0',
      ticker: entry.ticker,
      companyNameAr: entry.companyNameAr || null,
      companyNameEn: entry.companyNameEn || null,
      isin: entry.isin || null,
      reutersCode: entry.reutersCode || null,
      yahooSymbol: fetched.requestedSymbol,
      currency: entry.currency || fetched.meta?.currency || 'EGP',
      exchange: entry.exchange || 'EGX',
      generatedAt: nowIso(),
      availableSessions: merged.sessions.length,
      firstSession: merged.sessions[0].date,
      lastSession: merged.sessions.at(-1).date,
      historyStatus: historyStatus(merged.sessions.length),
      primarySource: 'yahoo',
      verificationSources,
      officiallyVerifiedLatestSession: Boolean(merged.sessions.at(-1).officialVerified),
      symbolVerified: Boolean(fetched.identity?.verified),
      symbolVerification: fetched.identity,
      identityVerificationPolicy: fetched.identity?.policy || 'standard_identity',
      guardedIdentitySalvage: Boolean(fetched.identity?.guardedVerified),
      averageConfidence: averageConfidence(merged.sessions),
      staleData: false,
      updateFailed: false,
      warnings: unique([
        ...(fetched.identity?.guardedVerified ? ['guarded_identity_salvage_not_high_confidence'] : []),
        ...(verification && !verification.matched ? [`latest_close_conflict:${verification.differencePct}%`] : []),
        ...merged.corporateActions.map(() => 'corporate_action_review_required'),
      ]),
      sessions: merged.sessions,
    };

    writeHistory(REPO_ROOT, entry.ticker, document);
    audit.rowsStored = document.availableSessions;
    audit.firstStoredDate = document.firstSession;
    audit.lastStoredDate = document.lastSession;
    audit.verificationSources = document.verificationSources;
    audit.confidence = document.averageConfidence;
    audit.completedAt = nowIso();

    return {
      ok: true,
      ticker: entry.ticker,
      audit,
      quarantine: merged.quarantine,
      corporateActions: merged.corporateActions,
      verification,
    };
  } catch (error) {
    preserveFailedHistory(REPO_ROOT, entry.ticker, error.message);
    audit.errors.push(error.message);
    audit.completedAt = nowIso();
    return { ok: false, ticker: entry.ticker, audit, quarantine: [], corporateActions: [], error: error.message };
  }
}

function updateState(allEntries, selection, results, skipped) {
  const nextIncrementalBatch = selection.batchNumber
    ? (selection.batchNumber >= selection.totalBatches ? 1 : selection.batchNumber + 1)
    : Number(selection.state.nextIncrementalBatch || 1);
  const state = {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    totalSymbols: allEntries.length,
    batchSize: BATCH_SIZE,
    totalBatches: selection.totalBatches,
    lastMode: MODE,
    lastBatchNumber: selection.batchNumber,
    nextIncrementalBatch,
    lastSelectedCount: selection.selected.length,
    lastFetchedCount: results.length,
    lastSkippedCompleteCount: skipped.length,
    lastSucceededCount: results.filter((item) => item.ok).length,
    lastFailedCount: results.filter((item) => !item.ok).length,
  };
  writeJsonAtomic(STATE_PATH, state);
  return state;
}

async function main() {
  ensureDir(path.join(DATA_DIR, 'history'));
  const allEntries = loadMap();
  const selection = selectEntries(allEntries);
  const localReferences = loadLocalReferences(REPO_ROOT);
  const approvedRecords = loadApprovedRecords(REPO_ROOT);
  const skipped = selection.selected.filter(shouldSkipComplete);
  const entriesToFetch = selection.selected.filter((entry) => !shouldSkipComplete(entry));
  const results = [];

  console.log(`V12.5 Historical 100: mode=${MODE}, universe=${allEntries.length}, selected=${selection.selected.length}, fetch=${entriesToFetch.length}, skippedComplete=${skipped.length}, batch=${selection.batchNumber || '-'} / ${selection.totalBatches}`);

  for (let offset = 0; offset < entriesToFetch.length; offset += REQUEST_BATCH_SIZE) {
    const batch = entriesToFetch.slice(offset, offset + REQUEST_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (entry, index) => {
      if (index > 0 && BETWEEN_SYMBOL_MS > 0) await sleep(index * BETWEEN_SYMBOL_MS);
      console.log(`Fetching ${entry.ticker}...`);
      const result = await processSymbol(entry, localReferences.get(entry.ticker), approvedRecords);
      console.log(`${entry.ticker}: ${result.ok ? 'OK' : `FAILED - ${result.error}`}`);
      return result;
    }));
    results.push(...batchResults);
    if (offset + REQUEST_BATCH_SIZE < entriesToFetch.length && BETWEEN_BATCH_MS > 0) await sleep(BETWEEN_BATCH_MS);
  }

  const oldAudit = readJson(path.join(DATA_DIR, 'source-audit.json'), { operations: [] });
  const operations = [...(oldAudit.operations || []), ...results.map((result) => result.audit)].slice(-2500);
  writeJsonAtomic(path.join(DATA_DIR, 'source-audit.json'), {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    mode: MODE,
    operations,
  });

  writeJsonAtomic(path.join(DATA_DIR, 'history-errors.json'), {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    mode: MODE,
    failures: results.filter((result) => !result.ok).map((result) => ({ ticker: result.ticker, error: result.error })),
    quarantine: results.flatMap((result) => result.quarantine.map((item) => ({ ...item, ticker: result.ticker }))),
  });

  const previousActions = readJson(path.join(DATA_DIR, 'corporate-actions.json'), { candidates: [] });
  const actionsByKey = new Map();
  for (const item of [...(previousActions.candidates || []), ...results.flatMap((result) => result.corporateActions)]) {
    actionsByKey.set(`${item.ticker}:${item.date}`, item);
  }
  writeJsonAtomic(path.join(DATA_DIR, 'corporate-actions.json'), {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    candidates: [...actionsByKey.values()].sort((a, b) => `${a.ticker}:${a.date}`.localeCompare(`${b.ticker}:${b.date}`)),
  });

  const summary = buildSummary(REPO_ROOT, allEntries, {
    yahoo: { status: results.some((result) => result.ok) || skipped.length ? 'available' : 'failed', role: 'historical backfill' },
    egx: { status: 'manual_or_future_adapter', role: 'official verification' },
    mubasher: { status: localReferences.size ? 'existing_cache_available' : 'not_available', role: 'latest-session cross-check' },
    investing: { status: 'manual_fallback', role: 'fallback/manual verification' },
  });
  buildSessionCalendar(REPO_ROOT, summary);
  const state = updateState(allEntries, selection, results, skipped);

  const lastRun = {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    mode: MODE,
    batchNumber: selection.batchNumber,
    batchSize: BATCH_SIZE,
    totalBatches: selection.totalBatches,
    selectedTickers: selection.selected.map((entry) => entry.ticker),
    fetchedTickers: entriesToFetch.map((entry) => entry.ticker),
    skippedCompleteTickers: skipped.map((entry) => entry.ticker),
    succeededTickers: results.filter((result) => result.ok).map((result) => result.ticker),
    failed: results.filter((result) => !result.ok).map((result) => ({ ticker: result.ticker, error: result.error })),
    coverageAfterRun: summary.coverage,
    nextIncrementalBatch: state.nextIncrementalBatch,
  };
  writeJsonAtomic(LAST_RUN_PATH, lastRun);

  console.log(JSON.stringify({
    universe: allEntries.length,
    selected: selection.selected.length,
    fetched: entriesToFetch.length,
    skippedComplete: skipped.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    sessions100: summary.symbolsComplete100,
    sessions50OrMore: summary.coverage.sessions50Count,
    sessions20OrMore: summary.coverage.sessions20Count,
    mappedCoverage100Pct: summary.coverage.sessions100Pct,
    nextIncrementalBatch: state.nextIncrementalBatch,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
