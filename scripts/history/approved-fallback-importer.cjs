#!/usr/bin/env node
'use strict';

const path = require('path');
const { mergeAndValidate } = require('./history-validator.cjs');
const { readHistory, writeHistory } = require('./history-storage.cjs');
const { historyStatus, buildSummary, buildSessionCalendar } = require('./history-summary-builder.cjs');
const {
  nowIso,
  readJson,
  round,
  safeTicker,
  unique,
  writeJsonAtomic,
} = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const INPUT_PATH = path.join(DATA, 'history-fallback-import.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const REPORT_PATH = path.join(DATA, 'history-fallback-import-report.json');
const LAST_RUN_PATH = path.join(DATA, 'history-last-run.json');
const STATE_PATH = path.join(DATA, 'history-batch-state.json');

const SOURCE_CONFIDENCE = {
  egx_official: 100,
  mubasher: 90,
  investing: 85,
  approved_csv: 80,
};

function normalizeMap(raw) {
  const entries = Array.isArray(raw) ? raw : Object.values(raw || {});
  const output = new Map();
  for (const item of entries) {
    const ticker = safeTicker(item?.ticker);
    if (ticker) output.set(ticker, { ...item, ticker });
  }
  return output;
}

function mapToObject(map) {
  const output = {};
  for (const ticker of [...map.keys()].sort()) output[ticker] = map.get(ticker);
  return output;
}

function prepareSessions(record, confidence) {
  return (record.sessions || []).map((session) => ({
    ticker: safeTicker(record.ticker),
    date: session.date,
    open: session.open,
    high: session.high,
    low: session.low,
    close: session.close,
    adjustedClose: session.adjustedClose ?? null,
    volume: session.volume ?? null,
    currency: session.currency || 'EGP',
    primarySource: record.source,
    officialVerified: record.source === 'egx_official',
    verifiedBy: unique([record.source]),
    sourceUrls: {
      primary: record.sourceUrl || null,
      verification: [],
    },
    fetchedAt: record.fetchedAt || nowIso(),
    validatedAt: nowIso(),
    confidence: {
      overall: confidence,
      ohlc: confidence,
      volume: session.volume === null || session.volume === undefined ? 60 : confidence,
      symbolIdentity: record.symbolVerified === true ? confidence : 0,
    },
    validationStatus: record.source === 'egx_official' ? 'officially_verified' : 'approved_fallback_import',
    warnings: unique(session.warnings || []),
  }));
}

function averageConfidence(sessions) {
  const values = sessions.map((item) => Number(item.confidence?.overall || 0)).filter(Number.isFinite);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : 0;
}

function main() {
  const input = readJson(INPUT_PATH, null);
  if (!input) throw new Error('Missing data/history-fallback-import.json');
  const records = Array.isArray(input.records) ? input.records : [];
  if (!records.length) throw new Error('No approved fallback records were supplied. Keep the template empty until real reviewed data is available.');

  const rawMap = readJson(MAP_PATH, null);
  if (!rawMap) throw new Error('Missing data/symbol-map.json');
  const map = normalizeMap(rawMap);
  const imported = [];
  const failed = [];

  for (const record of records) {
    const ticker = safeTicker(record?.ticker);
    const source = String(record?.source || '').toLowerCase();
    const confidence = SOURCE_CONFIDENCE[source];
    try {
      if (!ticker || !map.has(ticker)) throw new Error('ticker_not_found_in_symbol_map');
      if (!confidence) throw new Error(`unsupported_source:${source || 'missing'}`);
      if (record.approved !== true) throw new Error('record_not_explicitly_approved');
      if (record.symbolVerified !== true) throw new Error('symbol_not_verified');
      if (!Array.isArray(record.sessions) || !record.sessions.length) throw new Error('sessions_missing');

      const existing = readHistory(ROOT, ticker);
      const merged = mergeAndValidate(existing?.sessions || [], prepareSessions({ ...record, ticker }, confidence), 100);
      if (!merged.sessions.length) throw new Error('no_valid_sessions_after_validation');

      const entry = map.get(ticker);
      const verificationSources = unique([...(existing?.verificationSources || []), source]);
      const document = {
        schemaVersion: '12.5.0',
        ticker,
        companyNameAr: entry.companyNameAr || null,
        companyNameEn: entry.companyNameEn || null,
        isin: entry.isin || null,
        reutersCode: entry.reutersCode || null,
        yahooSymbol: entry.yahooSymbol || null,
        currency: entry.currency || 'EGP',
        exchange: entry.exchange || 'EGX',
        generatedAt: nowIso(),
        availableSessions: merged.sessions.length,
        firstSession: merged.sessions[0].date,
        lastSession: merged.sessions.at(-1).date,
        historyStatus: historyStatus(merged.sessions.length),
        primarySource: source,
        verificationSources,
        officiallyVerifiedLatestSession: source === 'egx_official',
        symbolVerified: true,
        symbolVerification: {
          verified: true,
          policy: 'administrator_approved_fallback_import',
          source,
          approvalNote: record.approvalNote || null,
        },
        averageConfidence: averageConfidence(merged.sessions),
        staleData: false,
        updateFailed: false,
        warnings: unique(merged.corporateActions.map(() => 'corporate_action_review_required')),
        sessions: merged.sessions,
      };
      writeHistory(ROOT, ticker, document);
      map.set(ticker, {
        ...entry,
        symbolVerified: true,
        fallbackRequired: false,
        fallbackResolvedBy: source,
        fallbackResolvedAt: nowIso(),
        identityReviewStatus: null,
      });
      imported.push({ ticker, source, sessionsStored: document.availableSessions });
    } catch (error) {
      failed.push({ ticker: ticker || null, source: source || null, error: error.message });
    }
  }

  writeJsonAtomic(MAP_PATH, mapToObject(map));
  const activeEntries = [...map.values()].filter((entry) => entry.active !== false).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const summary = buildSummary(ROOT, activeEntries, {
    egx: { status: 'approved_import_supported', role: 'official verification and fallback' },
    yahoo: { status: 'available', role: 'historical backfill' },
    mubasher: { status: 'approved_import_supported', role: 'cross-check and fallback' },
    investing: { status: 'approved_import_supported', role: 'historical fallback' },
  });
  buildSessionCalendar(ROOT, summary);

  const report = {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    requested: records.length,
    imported,
    failed,
    coverageAfterImport: summary.coverage,
  };
  writeJsonAtomic(REPORT_PATH, report);
  writeJsonAtomic(LAST_RUN_PATH, {
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    mode: 'import_approved_fallback',
    selectedTickers: records.map((record) => safeTicker(record.ticker)).filter(Boolean),
    succeededTickers: imported.map((item) => item.ticker),
    failed,
    coverageAfterRun: summary.coverage,
  });
  const oldState = readJson(STATE_PATH, {});
  writeJsonAtomic(STATE_PATH, {
    ...oldState,
    schemaVersion: '12.5.0',
    generatedAt: nowIso(),
    totalSymbols: activeEntries.length,
    lastMode: 'import_approved_fallback',
    lastSucceededCount: imported.length,
    lastFailedCount: failed.length,
  });

  console.log(JSON.stringify(report, null, 2));
  if (!imported.length) process.exitCode = 1;
}

main();
