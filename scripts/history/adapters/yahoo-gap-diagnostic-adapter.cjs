'use strict';

const { getJson } = require('../lib/http-client.cjs');
const {
  cairoDateFromUnix,
  round,
  safeTicker,
  toNumber,
  unique,
} = require('../lib/utils.cjs');

function unixStart(dateText, lookbackDays = 75) {
  const value = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid history date: ${dateText}`);
  value.setUTCDate(value.getUTCDate() - Math.max(14, Number(lookbackDays || 75)));
  return Math.floor(value.getTime() / 1000);
}

function unixEnd() {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + 2);
  return Math.floor(value.getTime() / 1000);
}

function buildUrls(symbol, startDate, lookbackDays) {
  const encoded = encodeURIComponent(symbol);
  const query = [
    `period1=${unixStart(startDate, lookbackDays)}`,
    `period2=${unixEnd()}`,
    'interval=1d',
    'events=history',
    'includeAdjustedClose=true',
  ].join('&');
  return [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
  ];
}

function parsePayload(payload, requestedSymbol) {
  const chart = payload?.chart;
  if (chart?.error) throw new Error(`Yahoo chart error: ${chart.error.description || chart.error.code || 'unknown'}`);
  const result = chart?.result?.[0];
  if (!result) throw new Error('Yahoo response did not contain chart.result[0]');
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const sessions = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = toNumber(quote.close?.[index]);
    const date = cairoDateFromUnix(toNumber(timestamps[index]));
    if (!date || close === null) continue;
    sessions.push({
      date,
      open: round(toNumber(quote.open?.[index])),
      high: round(toNumber(quote.high?.[index])),
      low: round(toNumber(quote.low?.[index])),
      close: round(close),
      volume: toNumber(quote.volume?.[index]),
    });
  }
  return { requestedSymbol, meta: result.meta || {}, sessions };
}

function identityEvidence(meta, requestedSymbol, entry) {
  const returnedSymbol = String(meta.symbol || '').toUpperCase();
  const expectedSymbol = String(requestedSymbol || '').toUpperCase();
  const exchangeEvidence = [
    meta.exchangeName,
    meta.fullExchangeName,
    meta.exchangeTimezoneName,
    meta.timezone,
  ].filter(Boolean).map(String);
  const exchangeText = exchangeEvidence.join(' ').toLowerCase();
  const currency = String(meta.currency || '').toUpperCase();
  const expectedCurrency = String(entry.currency || 'EGP').toUpperCase();
  const companyName = meta.longName || meta.shortName || null;
  const exactSymbol = returnedSymbol === expectedSymbol;
  const cairoSuffix = returnedSymbol.endsWith('.CA') && expectedSymbol.endsWith('.CA');
  const mapDeclaresEgx = String(entry.exchange || '').toUpperCase() === 'EGX';
  const exchangeConfirmed = /(^|[^a-z])(cai|cairo|egypt|egx)([^a-z]|$)/i.test(exchangeText);
  const currencyMatches = currency === expectedCurrency;
  const currencyAcceptable = currencyMatches || (!currency && expectedCurrency === 'EGP');
  return {
    exactSymbol,
    cairoSuffix,
    mapDeclaresEgx,
    exchangeConfirmed,
    currencyMatches,
    currencyAcceptable,
    requestedSymbol,
    returnedSymbol: meta.symbol || null,
    currency: meta.currency || null,
    expectedCurrency,
    exchangeEvidence,
    companyName,
    regularMarketPrice: toNumber(meta.regularMarketPrice),
    firstTradeDate: meta.firstTradeDate || null,
    instrumentType: meta.instrumentType || null,
  };
}

function overlapEvidence(existingSessions, fetchedSessions, config) {
  const existingByDate = new Map((existingSessions || []).map((session) => [session.date, session]));
  const checks = [];
  const tolerancePct = Math.max(0.01, Number(config.overlapCloseTolerancePct || 0.25));
  const toleranceAbs = Math.max(0.001, Number(config.overlapCloseToleranceAbsolute || 0.02));
  for (const fetched of fetchedSessions || []) {
    const existing = existingByDate.get(fetched.date);
    if (!existing || !(Number(existing.close) > 0) || !(Number(fetched.close) > 0)) continue;
    const difference = Math.abs(Number(fetched.close) - Number(existing.close));
    const differencePct = difference / Number(existing.close) * 100;
    checks.push({
      date: fetched.date,
      existingClose: Number(existing.close),
      fetchedClose: Number(fetched.close),
      differencePct: round(differencePct, 5),
      matched: difference <= Math.max(toleranceAbs, Number(existing.close) * tolerancePct / 100),
    });
  }
  const recent = checks.sort((a, b) => b.date.localeCompare(a.date)).slice(0, Math.max(1, Number(config.maximumOverlapRows || 10)));
  const matches = recent.filter((item) => item.matched).length;
  const ratio = recent.length ? matches / recent.length : 0;
  return {
    overlapRows: recent.length,
    matches,
    mismatches: recent.length - matches,
    matchRatio: round(ratio * 100, 2),
    verified: recent.length >= Number(config.minimumOverlapMatches || 3)
      && matches >= Number(config.minimumOverlapMatches || 3)
      && ratio >= Number(config.minimumOverlapMatchRatio || 0.8),
    checks: recent,
  };
}

function classifyHttpFailure(message) {
  const text = String(message || '');
  if (/HTTP 404/i.test(text)) return 'yahoo_http_404';
  if (/429|rate limit/i.test(text)) return 'yahoo_rate_limited';
  if (/timeout/i.test(text)) return 'yahoo_timeout';
  return 'yahoo_request_failed';
}

async function inspectYahooCandidate(entry, document, config = {}) {
  const existingSessions = Array.isArray(document?.sessions) ? document.sessions : [];
  const lastSession = document?.lastSession || existingSessions.at(-1)?.date;
  if (!lastSession) throw new Error(`No existing history date for ${entry.ticker}`);
  const candidates = unique([
    entry.yahooSymbol,
    entry.reutersCode,
    entry.yahooAlternative,
    `${safeTicker(entry.ticker)}.CA`,
    entry.isin ? `${String(entry.isin).toUpperCase()}.CA` : null,
  ]);
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const loaded = await getJson(buildUrls(candidate, lastSession, config.lookbackCalendarDays || 90), {
        timeoutMs: Number(config.timeoutMs || 15000),
        maxAttempts: Number(config.maxAttempts || 2),
        backoffMs: Number(config.backoffMs || 900),
      });
      const parsed = parsePayload(loaded.json, candidate);
      const identity = identityEvidence(parsed.meta, candidate, entry);
      const overlap = overlapEvidence(existingSessions, parsed.sessions, config);
      attempts.push({
        candidate,
        status: 'response_received',
        sourceUrl: loaded.response?.url || null,
        rowsReceived: parsed.sessions.length,
        firstDate: parsed.sessions[0]?.date || null,
        lastDate: parsed.sessions.at(-1)?.date || null,
        identity,
        overlap,
      });
    } catch (error) {
      attempts.push({
        candidate,
        status: 'request_failed',
        failureClass: classifyHttpFailure(error.message),
        error: error.message,
      });
    }
  }
  return attempts;
}

module.exports = {
  inspectYahooCandidate,
  buildUrls,
  parsePayload,
  identityEvidence,
  overlapEvidence,
  classifyHttpFailure,
};
