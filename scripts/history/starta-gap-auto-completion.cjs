#!/usr/bin/env node
'use strict';

const path = require('path');
const { fetchStartaTicker, evaluateOverlap } = require('./adapters/starta-ohlc-adapter.cjs');
const { mergeAndValidate } = require('./history-validator.cjs');
const { readHistory, writeHistory } = require('./history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const { nowIso, readJson, round, safeTicker, sleep, unique, writeJsonAtomic } = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'history-starta-gap-config.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const REPORT_PATH = path.join(DATA, 'history-starta-gap-report.json');
const QUARANTINE_PATH = path.join(DATA, 'history-starta-gap-quarantine.json');
const SOURCE_AUDIT_PATH = path.join(DATA, 'source-audit.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');
const QUEUE_PATH = path.join(DATA, 'history-approved-gap-queue.json');
const MODE = String(process.env.STARTA_GAP_MODE || 'safe_apply');
const ONLY_TICKER = safeTicker(process.env.STARTA_GAP_TICKER || '');

function normalizeMap(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  const map = new Map();
  for (const item of entries) {
    const ticker = safeTicker(item?.ticker);
    if (ticker) map.set(ticker, { ...item, ticker });
  }
  return map;
}

function averageConfidence(sessions) {
  const values = (sessions || []).map((item) => Number(item?.confidence?.overall ?? item?.confidence ?? 0)).filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : 0;
}

function dateDiffDays(later, earlier) {
  if (!later || !earlier) return null;
  const a = new Date(`${later}T00:00:00Z`).getTime();
  const b = new Date(`${earlier}T00:00:00Z`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 86400000) : null;
}

function updateSourceAudit(report) {
  const raw = readJson(SOURCE_AUDIT_PATH, { operations: [] });
  const operations = Array.isArray(raw) ? raw : (Array.isArray(raw?.operations) ? raw.operations : []);
  const records = report.results.map((item) => ({
    operation: 'starta_ohlc_gap_auto_completion', ticker: item.ticker, startedAt: item.startedAt, completedAt: item.completedAt,
    status: item.status, source: 'starta_ohlc_api', rowsReceived: item.rowsReceived || 0, rowsAccepted: item.appendedSessions || 0,
    beforeSessions: item.beforeSessions || 0, afterSessions: item.afterSessions || 0, overlap: item.overlap || null,
    errors: item.error ? [item.error] : [], warnings: item.warnings || [],
  }));
  const merged = [...operations, ...records].slice(-5000);
  writeJsonAtomic(SOURCE_AUDIT_PATH, Array.isArray(raw) ? merged : {
    ...(raw || {}), schemaVersion: '12.9.0', generatedAt: report.completedAt, lastOperation: records.at(-1) || null, operations: merged,
  });
}

function updateQueue(report) {
  const queue = readJson(QUEUE_PATH, null);
  if (!queue || !Array.isArray(queue.items)) return;
  const byTicker = new Map(report.results.map((item) => [item.ticker, item]));
  queue.generatedAt = report.completedAt;
  queue.items = queue.items.map((item) => {
    const result = byTicker.get(item.ticker);
    if (!result) return item;
    return {
      ...item,
      startaGapStatus: result.status,
      startaAppendedSessions: result.appendedSessions || 0,
      startaLastAttemptAt: result.completedAt,
      startaLastError: result.error || null,
      approvedImportStatus: result.status === 'improved' ? 'completed_by_public_egx_database_fallback' : item.approvedImportStatus,
    };
  });
  writeJsonAtomic(QUEUE_PATH, queue);
}

async function main() {
  const startedAt = nowIso();
  const config = readJson(CONFIG_PATH, null);
  if (!config || !Array.isArray(config.targets)) throw new Error('Invalid data/history-starta-gap-config.json');
  const symbolMap = normalizeMap(readJson(MAP_PATH, {}));
  const summaryBefore = readJson(SUMMARY_PATH, {});
  const latestMarketSession = summaryBefore.latestMarketSession || null;
  const targets = config.targets.filter((item) => !ONLY_TICKER || safeTicker(item.ticker) === ONLY_TICKER);
  const results = [];
  const quarantine = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const ticker = safeTicker(target.ticker);
    const itemStartedAt = nowIso();
    const mapEntry = symbolMap.get(ticker);
    const existing = readHistory(ROOT, ticker);
    const beforeSessions = Array.isArray(existing?.sessions) ? existing.sessions.length : 0;
    const previousLastSession = existing?.lastSession || existing?.sessions?.at(-1)?.date || null;
    const base = {
      ticker, mode: target.mode || 'gap', startedAt: itemStartedAt, completedAt: null, status: 'failed', beforeSessions,
      afterSessions: beforeSessions, previousLastSession, lastSession: previousLastSession, rowsReceived: 0, validRows: 0,
      appendedSessions: 0, becameComplete100: false, recentEnough: false, overlap: null, identity: null, sourceUrl: null,
      warnings: [], error: null,
    };
    try {
      if (!mapEntry) throw new Error('ticker_missing_from_symbol_map');
      if (!existing || !Array.isArray(existing.sessions) || !existing.sessions.length) throw new Error('existing_history_missing');
      if (target.isin && mapEntry.isin && String(target.isin).toUpperCase() !== String(mapEntry.isin).toUpperCase()) throw new Error('isin_mismatch');

      const fetched = await fetchStartaTicker(ticker, mapEntry, target, config);
      base.rowsReceived = fetched.rows.length + fetched.rejected.length;
      base.validRows = fetched.rows.length;
      base.identity = fetched.identity;
      base.sourceUrl = fetched.sourceUrl;
      quarantine.push(...fetched.rejected.map((row) => ({ ...row, source: 'starta_ohlc_api' })));

      const boundedRows = fetched.rows.filter((row) => !latestMarketSession || row.date <= latestMarketSession);
      const overlap = evaluateOverlap(existing.sessions, boundedRows, config);
      base.overlap = overlap;
      if (!overlap.accepted) throw new Error(`overlap_validation_failed:${overlap.matches}/${overlap.overlapCount};ratio=${overlap.ratio}`);

      const newer = boundedRows.filter((row) => row.date > previousLastSession);
      if (newer.length < Number(config.minimumNewSessions || 1)) throw new Error('no_new_valid_sessions_after_existing_last_date');

      if (MODE === 'diagnose') {
        results.push({ ...base, completedAt: nowIso(), status: 'diagnosed_ready', appendedSessions: newer.length, lastSession: newer.at(-1)?.date || previousLastSession });
      } else {
        const merged = mergeAndValidate(existing.sessions, newer, Number(config.targetSessions || 100));
        quarantine.push(...merged.quarantine.map((row) => ({ ...row, source: 'merged_history_validation' })));
        const lastSession = merged.sessions.at(-1)?.date || previousLastSession;
        const lag = latestMarketSession ? dateDiffDays(latestMarketSession, lastSession) : null;
        const recentEnough = lag !== null && lag <= Number(config.maxMarketLagCalendarDays || 21);
        const becameComplete100 = beforeSessions < 100 && merged.sessions.length >= 100;
        const warnings = unique([
          ...(existing.warnings || []).filter((warning) => !['historical_seed_requires_recent_gap_fill','latest_session_stale'].includes(warning)),
          'starta_ohlc_gap_completion_applied',
          'non_official_public_database_fallback',
          'not_independently_verified_by_egx',
          !recentEnough ? `latest_session_lags_market:${lag ?? 'unknown'}_calendar_days` : null,
          ...merged.corporateActions.map(() => 'corporate_action_review_required'),
        ]);
        const next = {
          ...existing,
          schemaVersion: '12.9.0', generatedAt: nowIso(), availableSessions: merged.sessions.length,
          firstSession: merged.sessions[0]?.date || null, lastSession, historyStatus: historyStatus(merged.sessions.length),
          primarySource: 'mixed_history_with_starta_ohlc_api',
          verificationSources: unique([...(existing.verificationSources || []), 'starta_egx_database_identity']),
          officiallyVerifiedLatestSession: false, symbolVerified: true, averageConfidence: averageConfidence(merged.sessions),
          staleData: !recentEnough, updateFailed: false, lastUpdateError: null, warnings,
          startaGapCompletion: {
            importedAt: nowIso(), source: 'starta_ohlc_api', sourceUrl: fetched.sourceUrl,
            identityEvidence: fetched.identity, overlap, rowsReceived: base.rowsReceived, rowsAccepted: newer.length,
            confidenceCap: Number(config.sourceConfidence || 75),
          },
          sessions: merged.sessions,
        };
        writeHistory(ROOT, ticker, next);
        results.push({
          ...base, completedAt: nowIso(), status: 'improved', afterSessions: merged.sessions.length, appendedSessions: newer.length,
          lastSession, becameComplete100, recentEnough, warnings,
        });
      }
    } catch (error) {
      results.push({
        ...base, completedAt: nowIso(), status: 'failed', error: error.message,
        details: error.details || null, warnings: ['existing_history_preserved_unchanged'],
      });
    }
    if (index < targets.length - 1) await sleep(Number(config.delayBetweenTickersMs || 1000));
  }

  const activeEntries = [...symbolMap.values()].filter((entry) => entry.active !== false).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const summaryAfter = MODE === 'diagnose' ? summaryBefore : buildSummary(ROOT, activeEntries, {
    ...(summaryBefore.sources || {}),
    starta: { status: 'public_api_fallback', role: 'gap completion from EGX-scoped OHLC database; non-official' },
  });
  if (MODE !== 'diagnose') buildSessionCalendar(ROOT, summaryAfter);
  const completedAt = nowIso();
  const report = {
    schemaVersion: '12.9.0', startedAt, completedAt, mode: MODE, latestMarketSession,
    source: {
      name: 'Starta Markets public EGX OHLC API',
      role: 'non-official fallback gap completion',
      authority: 'TradingView-primary / own ohlc_data database per public architecture documentation',
      confidenceCap: Number(config.sourceConfidence || 75),
      officialEgxVerified: false,
    },
    counts: {
      selected: targets.length,
      improved: results.filter((item) => item.status === 'improved').length,
      diagnosedReady: results.filter((item) => item.status === 'diagnosed_ready').length,
      failed: results.filter((item) => item.status === 'failed').length,
      appendedSessions: results.reduce((sum, item) => sum + (item.status === 'improved' ? (item.appendedSessions || 0) : 0), 0),
      becameComplete100: results.filter((item) => item.becameComplete100).length,
      recentEnough: results.filter((item) => item.status === 'improved' && item.recentEnough).length,
      quarantinedRows: quarantine.length,
    },
    coverageBefore: summaryBefore.coverage || null,
    coverageAfter: summaryAfter.coverage || null,
    summaryAfter: {
      symbolsComplete100: summaryAfter.symbolsComplete100 ?? summaryBefore.symbolsComplete100,
      symbolsComplete50: summaryAfter.symbolsComplete50 ?? summaryBefore.symbolsComplete50,
      symbolsFailed: summaryAfter.symbolsFailed ?? summaryBefore.symbolsFailed,
      averageConfidence: summaryAfter.averageConfidence ?? summaryBefore.averageConfidence,
      latestMarketSession: summaryAfter.latestMarketSession ?? summaryBefore.latestMarketSession,
    },
    results,
    warnings: [
      'This source is not the official EGX and may not be labelled 100% confidence.',
      'Exact symbol identity is checked against an EGX-scoped stock endpoint and historical overlap is required before writing.',
      'Existing sessions always win on duplicate dates; only newer validated sessions are appended.',
      'Rows with invalid OHLC, negative volume, future dates, or flat zero-volume non-trading bars are quarantined.',
    ],
  };
  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(QUARANTINE_PATH, { schemaVersion: '12.9.0', generatedAt: completedAt, total: quarantine.length, rows: quarantine });
  if (MODE !== 'diagnose') {
    updateSourceAudit(report);
    updateQueue(report);
    writeJsonAtomic(LAST_RUN_PATH, {
      schemaVersion: '12.9.0', generatedAt: completedAt, mode: 'starta_ohlc_gap_auto_completion',
      succeededTickers: results.filter((item) => item.status === 'improved').map((item) => item.ticker),
      failed: results.filter((item) => item.status === 'failed').map((item) => ({ ticker: item.ticker, error: item.error })),
    });
  }
  console.log(`V12.9 ${MODE}: improved=${report.counts.improved}, diagnosedReady=${report.counts.diagnosedReady}, failed=${report.counts.failed}, appended=${report.counts.appendedSessions}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
