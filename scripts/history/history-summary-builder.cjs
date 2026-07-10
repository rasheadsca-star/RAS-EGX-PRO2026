'use strict';

const path = require('path');
const { nowIso, readJson, round, writeJsonAtomic } = require('./lib/utils.cjs');

function historyStatus(count) {
  if (count >= 100) return 'historical_complete_100';
  if (count >= 50) return 'historical_partial_50';
  if (count >= 20) return 'historical_limited_20';
  if (count >= 5) return 'historical_limited_5';
  return 'historical_insufficient';
}

function latestAuditByTicker(repoRoot) {
  const audit = readJson(path.join(repoRoot, 'data', 'source-audit.json'), { operations: [] });
  const map = new Map();
  for (const operation of audit.operations || []) {
    if (!operation?.ticker) continue;
    map.set(operation.ticker, operation);
  }
  return map;
}

function buildSummary(repoRoot, mapEntries, sourceStatuses = {}) {
  const audits = latestAuditByTicker(repoRoot);
  const details = [];

  for (const entry of mapEntries) {
    const file = path.join(repoRoot, 'data', 'history', `${entry.ticker}.json`);
    const document = readJson(file, null);
    const count = Array.isArray(document?.sessions) ? document.sessions.length : 0;
    const latestAudit = audits.get(entry.ticker) || null;
    const sourceFile = document ? `data/history/${entry.ticker}.json` : null;
    const symbolVerified = Boolean(document?.symbolVerified);
    const hasValidHistory = Boolean(sourceFile && symbolVerified && count > 0);
    let processingStatus = 'pending';
    if (document?.staleData || document?.updateFailed) processingStatus = 'stale';
    else if (hasValidHistory && count >= 100) processingStatus = 'complete';
    else if (hasValidHistory) processingStatus = 'partial';
    else if (latestAudit?.errors?.length) processingStatus = 'failed';

    details.push({
      ticker: entry.ticker,
      companyNameAr: entry.companyNameAr || null,
      companyNameEn: entry.companyNameEn || null,
      symbolVerified,
      availableSessions: count,
      firstSession: document?.firstSession || document?.sessions?.[0]?.date || null,
      lastSession: document?.lastSession || document?.sessions?.at(-1)?.date || null,
      historyStatus: document?.historyStatus || historyStatus(count),
      processingStatus,
      primarySource: document?.primarySource || null,
      verificationSources: document?.verificationSources || [],
      officiallyVerifiedLatestSession: Boolean(document?.officiallyVerifiedLatestSession),
      averageConfidence: Number(document?.averageConfidence || 0),
      staleData: Boolean(document?.staleData),
      updateFailed: Boolean(document?.updateFailed),
      lastUpdateError: document?.lastUpdateError || latestAudit?.errors?.at(-1) || null,
      warnings: document?.warnings || [],
      sourceFile,
    });
  }

  const mappedDenominator = details.length || 1;
  const validDetails = details.filter((item) => item.sourceFile && item.symbolVerified && item.availableSessions > 0);
  const runtimeVerifiedDenominator = validDetails.length || 1;
  const countAtLeast = (number) => validDetails.filter((item) => item.availableSessions >= number).length;
  const confidenceValues = validDetails.map((item) => item.averageConfidence).filter((value) => Number.isFinite(value) && value > 0);
  const latestMarketSession = validDetails.map((item) => item.lastSession).filter(Boolean).sort().at(-1) || null;

  const summary = {
    schemaVersion: '12.3.0',
    generatedAt: nowIso(),
    targetSessions: 100,
    symbolsTotal: details.length,
    symbolsMapped: mapEntries.filter((entry) => entry.yahooSymbol || entry.reutersCode || entry.yahooAlternative).length,
    symbolsRuntimeVerified: validDetails.length,
    symbolsComplete100: countAtLeast(100),
    symbolsComplete50: validDetails.filter((item) => item.availableSessions >= 50 && item.availableSessions < 100).length,
    symbolsLimited20: validDetails.filter((item) => item.availableSessions >= 20 && item.availableSessions < 50).length,
    symbolsLimited5: validDetails.filter((item) => item.availableSessions >= 5 && item.availableSessions < 20).length,
    symbolsBelow5: validDetails.filter((item) => item.availableSessions < 5).length,
    symbolsPending: details.filter((item) => item.processingStatus === 'pending').length,
    symbolsFailed: details.filter((item) => item.processingStatus === 'failed').length,
    symbolsStale: details.filter((item) => item.processingStatus === 'stale').length,
    officiallyVerifiedSymbols: details.filter((item) => item.officiallyVerifiedLatestSession).length,
    crossVerifiedSymbols: details.filter((item) => item.verificationSources.some((source) => /^(egx_|mubasher_|investing_)/.test(String(source)))).length,
    singleSourceSymbols: validDetails.filter((item) => !item.verificationSources.some((source) => /^(egx_|mubasher_|investing_)/.test(String(source)))).length,
    averageConfidence: confidenceValues.length ? round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length, 2) : 0,
    latestMarketSession,
    coverage: {
      basis: 'all_active_mapped_symbols',
      denominator: details.length,
      sessions20Count: countAtLeast(20),
      sessions20Pct: round(countAtLeast(20) / mappedDenominator * 100, 2),
      sessions50Count: countAtLeast(50),
      sessions50Pct: round(countAtLeast(50) / mappedDenominator * 100, 2),
      sessions100Count: countAtLeast(100),
      sessions100Pct: round(countAtLeast(100) / mappedDenominator * 100, 2),
    },
    runtimeVerifiedCoverage: {
      basis: 'runtime_verified_symbols_only',
      denominator: validDetails.length,
      sessions20Count: countAtLeast(20),
      sessions20Pct: round(countAtLeast(20) / runtimeVerifiedDenominator * 100, 2),
      sessions50Count: countAtLeast(50),
      sessions50Pct: round(countAtLeast(50) / runtimeVerifiedDenominator * 100, 2),
      sessions100Count: countAtLeast(100),
      sessions100Pct: round(countAtLeast(100) / runtimeVerifiedDenominator * 100, 2),
    },
    sources: {
      egx: sourceStatuses.egx || { status: 'not_automated', role: 'official verification' },
      yahoo: sourceStatuses.yahoo || { status: 'configured', role: 'historical backfill' },
      mubasher: sourceStatuses.mubasher || { status: 'existing_cache_when_available', role: 'latest-session cross-check' },
      investing: sourceStatuses.investing || { status: 'manual_fallback', role: 'fallback/manual verification' },
    },
    symbols: details,
  };

  writeJsonAtomic(path.join(repoRoot, 'data', 'history-summary.json'), summary);
  return summary;
}

function buildSessionCalendar(repoRoot, summary) {
  const allDates = new Set();
  for (const item of summary.symbols || []) {
    if (!item.sourceFile) continue;
    const document = readJson(path.join(repoRoot, item.sourceFile), null);
    for (const session of document?.sessions || []) allDates.add(session.date);
  }
  const calendar = {
    schemaVersion: '12.3.0',
    generatedAt: nowIso(),
    exchange: 'EGX',
    timezone: 'Africa/Cairo',
    latestMarketSession: [...allDates].sort().at(-1) || null,
    sessions: [...allDates].sort(),
    note: 'Union of validated stored sessions. It is not an official EGX holiday calendar.',
  };
  writeJsonAtomic(path.join(repoRoot, 'data', 'session-calendar.json'), calendar);
  return calendar;
}

module.exports = { historyStatus, buildSummary, buildSessionCalendar };
