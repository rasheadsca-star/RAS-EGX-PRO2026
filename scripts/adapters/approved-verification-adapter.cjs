'use strict';

const path = require('path');
const {
  readJson,
  round,
  safeTicker,
  toNumber,
  unique,
} = require('../lib/utils.cjs');

function loadApprovedRecords(repoRoot) {
  const file = path.join(repoRoot, 'data', 'history-verification-overrides.json');
  const parsed = readJson(file, { records: [] });
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.records) ? parsed.records : []);
}

function sourceLabel(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'egx' || normalized.includes('egx_official')) return 'egx_official';
  if (normalized.includes('mubasher')) return 'mubasher_approved';
  if (normalized.includes('investing')) return 'investing_approved';
  return `approved_${normalized || 'manual'}`;
}

function applyApprovedRecords(sessions, ticker, records) {
  const relevant = records.filter((record) => (
    record.approved === true
    && safeTicker(record.ticker) === safeTicker(ticker)
    && /^\d{4}-\d{2}-\d{2}$/.test(String(record.date || ''))
  ));
  if (!relevant.length) return { sessions, applied: [] };

  const byDate = new Map(sessions.map((session) => [session.date, { ...session }]));
  const applied = [];

  for (const record of relevant) {
    const current = byDate.get(record.date);
    if (!current) continue;
    const label = sourceLabel(record.source);
    const official = label === 'egx_official';
    const sourceValues = {
      open: toNumber(record.open),
      high: toNumber(record.high),
      low: toNumber(record.low),
      close: toNumber(record.close),
      volume: record.volume === null || record.volume === undefined ? null : toNumber(record.volume),
    };
    const referenceClose = sourceValues.close;
    const tolerance = referenceClose ? Math.max(0.01, Math.abs(referenceClose) * 0.001) : null;
    const differencePct = referenceClose && current.close
      ? Math.abs(referenceClose - current.close) / current.close * 100
      : null;
    const matches = differencePct === null || Math.abs(referenceClose - current.close) <= tolerance;

    let next = {
      ...current,
      sourceValues: {
        ...(current.sourceValues || {}),
        [label]: sourceValues,
      },
      verifiedBy: unique([...(current.verifiedBy || []), label]),
      sourceUrls: {
        ...(current.sourceUrls || {}),
        verification: unique([...(current.sourceUrls?.verification || []), record.sourceUrl]),
      },
    };

    if (official) {
      next = {
        ...next,
        open: sourceValues.open ?? next.open,
        high: sourceValues.high ?? next.high,
        low: sourceValues.low ?? next.low,
        close: sourceValues.close ?? next.close,
        volume: record.volume === undefined ? next.volume : sourceValues.volume,
        officialVerified: true,
        validationStatus: 'officially_verified',
        confidence: {
          ...next.confidence,
          overall: 100,
          ohlc: 100,
          volume: record.volume === undefined ? Number(next.confidence?.volume || 60) : 100,
        },
        warnings: unique([...(next.warnings || []), matches ? null : `official_value_replaced_primary:${round(differencePct, 3)}%`]),
      };
    } else if (matches) {
      const sourceConfidence = label.includes('mubasher') ? 90 : 85;
      next = {
        ...next,
        validationStatus: 'cross_verified',
        confidence: {
          ...next.confidence,
          overall: Math.max(Number(next.confidence?.overall || 0), sourceConfidence),
          ohlc: Math.max(Number(next.confidence?.ohlc || 0), sourceConfidence),
        },
      };
    } else {
      next = {
        ...next,
        validationStatus: 'source_conflict',
        confidence: { ...next.confidence, overall: 40, ohlc: 40 },
        warnings: unique([...(next.warnings || []), `approved_source_conflict:${label}:${round(differencePct, 3)}%`]),
      };
    }

    byDate.set(record.date, next);
    applied.push({
      ticker: safeTicker(ticker),
      date: record.date,
      source: label,
      official,
      matchedPrimary: matches,
      differencePct: round(differencePct, 4),
      approvedBy: record.approvedBy || null,
      approvedAt: record.approvedAt || null,
    });
  }

  return {
    sessions: sessions.map((session) => byDate.get(session.date) || session),
    applied,
  };
}

module.exports = { loadApprovedRecords, applyApprovedRecords };
