'use strict';

const fs = require('fs');
const path = require('path');
const { getJson } = require('../lib/http-client.cjs');
const {
  cairoDateFromUnix,
  nowIso,
  readJson,
  round,
  safeTicker,
  toNumber,
  unique,
} = require('../lib/utils.cjs');

function buildUrls(symbol, range) {
  const encoded = encodeURIComponent(symbol);
  const query = `range=${encodeURIComponent(range)}&interval=1d&events=history&includeAdjustedClose=true`;
  return [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encoded}?${query}`,
  ];
}

function loadFixture(symbol) {
  const fixtureDir = process.env.HISTORY_FIXTURE_DIR;
  if (!fixtureDir) return null;
  const candidates = [
    path.join(fixtureDir, `${symbol}.json`),
    path.join(fixtureDir, `${symbol.replace(/[^A-Za-z0-9_-]/g, '_')}.json`),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  return file ? { json: readJson(file), response: { url: `fixture://${path.basename(file)}` }, attempts: 1 } : null;
}

function identityCheck(meta, requestedSymbol, mapEntry, localReference) {
  const warnings = [];
  let score = 0;

  // Yahoo commonly reports Egyptian listings with exchangeName="CAI"
  // and fullExchangeName="Egypt". The previous implementation used
  // exchangeName OR fullExchangeName, so "CAI" hid the stronger
  // fullExchangeName evidence and every correct EGX symbol scored too low.
  const exchangeEvidence = [
    meta.exchangeName,
    meta.fullExchangeName,
    meta.exchangeTimezoneName,
    meta.timezone,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  const exchangeText = exchangeEvidence.join(' ').toLowerCase();
  const currency = String(meta.currency || '').toUpperCase();
  const returnedSymbol = String(meta.symbol || '').toUpperCase();
  const expectedSymbol = String(requestedSymbol || '').toUpperCase();
  const expectedCurrency = String(mapEntry.currency || 'EGP').toUpperCase();

  if (returnedSymbol === expectedSymbol) {
    score += 35;
  } else {
    warnings.push(`returned_symbol_mismatch:${returnedSymbol || 'missing'}`);
  }

  if (currency === expectedCurrency) {
    score += 25;
  } else {
    warnings.push(`currency_mismatch:${currency || 'missing'}`);
  }

  const cairoExchangeConfirmed =
    /(^|[^a-z])(cai|cairo|egypt|egx)([^a-z]|$)/i.test(exchangeText) ||
    (
      expectedSymbol.endsWith('.CA') &&
      String(mapEntry.exchange || '').toUpperCase() === 'EGX' &&
      /egypt/i.test(String(meta.fullExchangeName || ''))
    );

  if (cairoExchangeConfirmed) {
    score += 30;
  } else {
    warnings.push(`exchange_not_confirmed:${exchangeText || 'missing'}`);
  }

  const regularMarketPrice = toNumber(meta.regularMarketPrice);
  if (localReference?.close && regularMarketPrice) {
    const differencePct = Math.abs(regularMarketPrice - localReference.close) / localReference.close * 100;
    if (differencePct <= 25) {
      score += 10;
    } else {
      warnings.push(`latest_price_far_from_local_reference:${round(differencePct, 3)}%`);
    }
  } else if (meta.shortName || meta.longName) {
    score += 10;
  } else {
    warnings.push('company_name_missing');
  }

  return {
    verified: score >= 80,
    score,
    warnings,
    evidence: {
      requestedSymbol,
      returnedSymbol: meta.symbol || null,
      exchangeName: meta.exchangeName || null,
      fullExchangeName: meta.fullExchangeName || null,
      exchangeEvidence,
      currency: meta.currency || null,
      shortName: meta.shortName || null,
      longName: meta.longName || null,
      regularMarketPrice,
    },
  };
}

function parseYahooPayload(payload, requestedSymbol, mapEntry, localReference, sourceUrl) {
  const chart = payload?.chart;
  if (chart?.error) throw new Error(`Yahoo chart error: ${chart.error.description || chart.error.code || 'unknown'}`);
  const result = chart?.result?.[0];
  if (!result) throw new Error('Yahoo response did not contain chart.result[0]');

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const identity = identityCheck(result.meta || {}, requestedSymbol, mapEntry, localReference);
  const sessions = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const close = toNumber(quote.close?.[index]);
    if (close === null) continue;
    const date = cairoDateFromUnix(toNumber(timestamps[index]));
    if (!date) continue;
    sessions.push({
      ticker: safeTicker(mapEntry.ticker),
      date,
      open: round(toNumber(quote.open?.[index])),
      high: round(toNumber(quote.high?.[index])),
      low: round(toNumber(quote.low?.[index])),
      close: round(close),
      adjustedClose: round(toNumber(adjusted[index])),
      volume: toNumber(quote.volume?.[index]),
      currency: result.meta?.currency || mapEntry.currency || 'EGP',
      primarySource: 'yahoo',
      officialVerified: false,
      verifiedBy: [],
      sourceUrls: {
        primary: sourceUrl,
        verification: [],
      },
      fetchedAt: nowIso(),
      validatedAt: null,
      confidence: {
        overall: identity.verified ? 75 : 0,
        ohlc: identity.verified ? 75 : 0,
        volume: quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 60 : (identity.verified ? 75 : 0),
        symbolIdentity: identity.score,
      },
      validationStatus: identity.verified ? 'single_source_validated' : 'symbol_identity_failed',
      warnings: unique([
        ...identity.warnings,
        quote.volume?.[index] === null || quote.volume?.[index] === undefined ? 'volume_missing' : null,
        adjusted[index] === null || adjusted[index] === undefined ? 'adjusted_close_missing' : null,
      ]),
    });
  }

  return {
    requestedSymbol,
    meta: result.meta || {},
    identity,
    sessions,
  };
}

async function fetchHistory(mapEntry, options = {}) {
  const range = options.range || '1y';
  const candidates = unique([
    mapEntry.yahooSymbol,
    mapEntry.reutersCode,
    mapEntry.yahooAlternative,
  ]);
  if (!candidates.length) throw new Error(`No Yahoo candidate symbols configured for ${mapEntry.ticker}`);

  const failures = [];
  for (const candidate of candidates) {
    try {
      const fixture = loadFixture(candidate);
      const loaded = fixture || await getJson(buildUrls(candidate, range), {
        timeoutMs: options.timeoutMs || 18000,
        maxAttempts: options.maxAttempts || 3,
        backoffMs: options.backoffMs || 900,
      });
      const parsed = parseYahooPayload(loaded.json, candidate, mapEntry, options.localReference, loaded.response.url);
      if (!parsed.identity.verified) {
        failures.push(`${candidate}: identity score ${parsed.identity.score}`);
        continue;
      }
      if (!parsed.sessions.length) {
        failures.push(`${candidate}: no sessions`);
        continue;
      }
      return { ...parsed, attempts: loaded.attempts, candidateFailures: failures };
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }

  const error = new Error(`Yahoo history failed for ${mapEntry.ticker}: ${failures.join(' | ')}`);
  error.candidateFailures = failures;
  throw error;
}

module.exports = { fetchHistory, parseYahooPayload, identityCheck };
