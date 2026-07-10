'use strict';

const fs = require('fs');
const path = require('path');
const { nowIso, readJson, round, writeJsonAtomic } = require('./lib/utils.cjs');

function historyStatus(count) {
  if (count >= 100) return 'historical_complete_100';
  if (count >= 50) return 'historical_partial_50';
  if (count >= 20) return 'historical_limited_20';
  if (count >= 5) return 'historical_limited_5';
  return 'historical_insufficient';
}

function buildSummary(repoRoot, mapEntries, sourceStatuses = {}) {
  const details = [];
  for (const entry of mapEntries) {
    const file = path.join(repoRoot, 'data', 'history', `${entry.ticker}.json`);
    const document = readJson(file, null);
    const count = Array.isArray(document?.sessions) ? document.sessions.length : 0;
    details.push({
      ticker: entry.ticker,
      companyNameAr: entry.companyNameAr || null,
      companyNameEn: entry.companyNameEn || null,
      symbolVerified: Boolean(document?.symbolVerified),
      availableSessions: count,
      firstSession: document?.firstSession || document?.sessions?.[0]?.date || null,
      lastSession: document?.lastSession || document?.sessions?.at(-1)?.date || null,
      historyStatus: document?.historyStatus || historyStatus(count),
      primarySource: document?.primarySource || null,
      verificationSources: document?.verificationSources || [],
      officiallyVerifiedLatestSession: Boolean(document?.officiallyVerifiedLatestSession),
      averageConfidence: Number(document?.averageConfidence || 0),
      staleData: Boolean(document?.staleData),
      updateFailed: Boolean(document?.updateFailed),
      warnings: document?.warnings || [],
      sourceFile: document ? `data/history/${entry.ticker}.json` : null,
    });
  }

  const eligible = details.filter((item) => item.symbolVerified);
  const denominator = eligible.length || details.length || 1;
  const countAtLeast = (number) => eligible.filter((item) => item.availableSessions >= number).length;
  const confidenceValues = eligible.map((item) => item.averageConfidence).filter((value) => Number.isFinite(value) && value > 0);
  const latestMarketSession = details.map((item) => item.lastSession).filter(Boolean).sort().at(-1) || null;

  const summary = {
    schemaVersion: '12.2.0',
    generatedAt: nowIso(),
    targetSessions: 100,
    symbolsTotal: details.length,
    symbolsMapped: mapEntries.filter((entry) => entry.yahooSymbol || entry.reutersCode || entry.yahooAlternative).length,
    symbolsRuntimeVerified: eligible.length,
    symbolsComplete100: countAtLeast(100),
    symbolsComplete50: eligible.filter((item) => item.availableSessions >= 50 && item.availableSessions < 100).length,
    symbolsLimited20: eligible.filter((item) => item.availableSessions >= 20 && item.availableSessions < 50).length,
    symbolsLimited5: eligible.filter((item) => item.availableSessions >= 5 && item.availableSessions < 20).length,
    symbolsBelow5: eligible.filter((item) => item.availableSessions < 5).length,
    symbolsFailed: details.filter((item) => item.updateFailed || !item.sourceFile).length,
    officiallyVerifiedSymbols: details.filter((item) => item.officiallyVerifiedLatestSession).length,
    crossVerifiedSymbols: details.filter((item) => item.verificationSources.some((source) => /^(egx_|mubasher_|investing_)/.test(String(source)))).length,
    singleSourceSymbols: details.filter((item) => item.sourceFile && !item.verificationSources.some((source) => /^(egx_|mubasher_|investing_)/.test(String(source)))).length,
    averageConfidence: confidenceValues.length ? round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length, 2) : 0,
    latestMarketSession,
    coverage: {
      denominator: eligible.length,
      sessions20Count: countAtLeast(20),
      sessions20Pct: round(countAtLeast(20) / denominator * 100, 2),
      sessions50Count: countAtLeast(50),
      sessions50Pct: round(countAtLeast(50) / denominator * 100, 2),
      sessions100Count: countAtLeast(100),
      sessions100Pct: round(countAtLeast(100) / denominator * 100, 2),
    },
    sources: {
      egx: sourceStatuses.egx || { status: 'not_automated_in_sample', role: 'official verification' },
      yahoo: sourceStatuses.yahoo || { status: 'configured', role: 'historical backfill' },
      mubasher: sourceStatuses.mubasher || { status: 'existing_cache_when_available', role: 'latest-session cross-check' },
      investing: sourceStatuses.investing || { status: 'not_automated_in_sample', role: 'fallback/manual verification' },
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
    schemaVersion: '12.2.0',
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
