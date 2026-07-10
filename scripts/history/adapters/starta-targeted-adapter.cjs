#!/usr/bin/env node
'use strict';

const { sleep, safeTicker, toNumber, round, unique } = require('../lib/utils.cjs');

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

const STOP = new Set([
  'the','and','for','of','company','co','sae','s','a','e','egypt','egyptian','bank','holding',
  'شركة','المصرية','مصر','للاستثمار','والخدمات','بنك','شركه'
]);

function tokens(value) {
  return new Set(normalizeText(value).split(/\s+/).filter((item) => item.length > 1 && !STOP.has(item)));
}

function nameSimilarity(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / Math.max(1, Math.min(left.size, right.size));
}

async function fetchJson(url, config, diagnostics) {
  const timeoutMs = Number(config.requestTimeoutMs || 25000);
  const retryCount = Number(config.retryCount || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'RAS-EGX-PRO2026-V13-Targeted-Repair/1.0 (+public-data-validation)',
        },
        signal: controller.signal,
      });
      const text = await response.text();
      diagnostics.push({ url, attempt, status: response.status, bytes: text.length });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('invalid_json_response');
      }
    } catch (error) {
      lastError = error;
      if (attempt < retryCount) await sleep(Number(config.retryBaseDelayMs || 1200) * (2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${url}: ${lastError?.message || 'request_failed'}`);
}

async function fetchFromAnyBase(pathname, config, diagnostics) {
  const bases = unique([
    process.env.STARTA_API_BASE,
    ...(Array.isArray(config.apiBases) ? config.apiBases : []),
  ]).map((value) => String(value).replace(/\/$/, ''));
  const errors = [];
  for (const base of bases) {
    try {
      return { data: await fetchJson(`${base}${pathname}`, config, diagnostics), base };
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(' | '));
}

function normalizeIdentity(raw) {
  return {
    symbol: safeTicker(raw?.symbol),
    marketCode: String(raw?.market_code || raw?.marketCode || '').toUpperCase(),
    nameEn: raw?.name_en || raw?.nameEn || raw?.company_name_en || raw?.name || null,
    nameAr: raw?.name_ar || raw?.nameAr || raw?.company_name_ar || null,
    isin: String(raw?.isin || raw?.ISIN || '').trim().toUpperCase() || null,
    currency: String(raw?.currency || '').trim().toUpperCase() || null,
    lastPrice: toNumber(raw?.last_price ?? raw?.lastPrice ?? raw?.close),
    raw,
  };
}

function verifyIdentity(raw, ticker, mapEntry, target, config) {
  const identity = normalizeIdentity(raw);
  const expectedName = target.companyNameEn || mapEntry?.companyNameEn || '';
  const expectedIsin = String(target.isin || mapEntry?.isin || '').trim().toUpperCase();
  const similarity = Math.max(
    nameSimilarity(identity.nameEn, expectedName),
    nameSimilarity(identity.nameAr, mapEntry?.companyNameAr || target.companyNameAr || ''),
  );
  const exactSymbol = identity.symbol === ticker;
  const egxMarket = !identity.marketCode || identity.marketCode === 'EGX';
  const minimum = Number(config.minimumIdentityNameSimilarity || 0.34);
  const nameAccepted = similarity >= minimum || (!identity.nameEn && !identity.nameAr);
  const exactIsin = Boolean(expectedIsin && identity.isin && expectedIsin === identity.isin);
  const isinAccepted = !expectedIsin || !identity.isin || exactIsin;
  const verified = exactSymbol && egxMarket && nameAccepted && isinAccepted;
  return {
    verified,
    exactSymbol,
    egxMarket,
    nameAccepted,
    exactIsin,
    isinAccepted,
    nameSimilarity: round(similarity, 4),
    identity,
    warnings: unique([
      !exactSymbol ? `identity_symbol_mismatch:${identity.symbol || 'missing'}` : null,
      !egxMarket ? `identity_market_mismatch:${identity.marketCode || 'missing'}` : null,
      !nameAccepted ? `identity_name_similarity_low:${round(similarity, 4)}` : null,
      !isinAccepted ? `identity_isin_mismatch:${identity.isin || 'missing'}:${expectedIsin}` : null,
      (!identity.marketCode ? 'identity_market_code_missing_but_endpoint_is_egx_scoped' : null),
      (!identity.isin ? 'identity_isin_missing' : null),
    ]),
  };
}

function normalizeOhlcRows(rows, ticker, sourceUrl, confidence) {
  if (!Array.isArray(rows)) throw new Error('ohlc_response_not_array');
  const normalized = [];
  const rejected = [];
  for (const raw of rows) {
    const date = String(raw?.date || raw?.session_date || '').slice(0, 10);
    const open = toNumber(raw?.open);
    const high = toNumber(raw?.high);
    const low = toNumber(raw?.low);
    const close = toNumber(raw?.close);
    const volume = raw?.volume === null || raw?.volume === undefined || raw?.volume === '' ? null : toNumber(raw.volume);
    const flatZero = volume === 0 && open > 0 && open === high && high === low && low === close;
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('invalid_date');
    if (!(open > 0 && high > 0 && low > 0 && close > 0)) errors.push('non_positive_ohlc');
    if (high < low || high < open || high < close || low > open || low > close) errors.push('invalid_ohlc_invariant');
    if (volume !== null && volume < 0) errors.push('negative_volume');
    if (flatZero) errors.push('flat_zero_volume_non_trading_row');
    if (errors.length) {
      rejected.push({ ticker, date: date || null, errors, row: raw });
      continue;
    }
    normalized.push({
      ticker,
      date,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      adjustedClose: null,
      volume,
      currency: 'EGP',
      primarySource: 'starta_ohlc_api',
      officialVerified: false,
      verifiedBy: ['starta_egx_database_identity'],
      sourceUrls: { primary: sourceUrl, verification: [] },
      fetchedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
      confidence: {
        overall: confidence,
        ohlc: confidence,
        volume: volume === null ? 60 : confidence,
        symbolIdentity: 90,
      },
      validationStatus: 'public_egx_database_exact_symbol_validated',
      warnings: unique([
        'non_official_fallback_source',
        'starta_ohlc_database_uses_mixed_history_reservoir',
        'not_independently_verified_by_egx',
        volume === null ? 'volume_missing' : null,
      ]),
    });
  }
  const byDate = new Map();
  for (const row of normalized) byDate.set(row.date, row);
  return { rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), rejected };
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function closeDifferencePct(a, b) {
  if (!(Number(a) > 0) || !(Number(b) > 0)) return null;
  return Math.abs(Number(a) - Number(b)) / Number(a) * 100;
}

function evaluateExactOverlap(existingSessions, incomingRows, config) {
  const existing = new Map((existingSessions || []).map((item) => [item.date, item]));
  const tolerancePct = Number(config.closeTolerancePct || 1.5);
  const overlap = [];
  for (const row of incomingRows) {
    const old = existing.get(row.date);
    if (!old) continue;
    const differencePct = closeDifferencePct(old.close, row.close);
    if (differencePct === null) continue;
    overlap.push({
      date: row.date,
      existingClose: Number(old.close),
      incomingClose: row.close,
      differencePct: round(differencePct, 4),
      matched: differencePct <= tolerancePct,
    });
  }
  const matches = overlap.filter((item) => item.matched).length;
  const ratio = overlap.length ? matches / overlap.length : 0;
  return { overlapCount: overlap.length, matches, ratio: round(ratio, 4), samples: overlap.slice(-12) };
}

function evaluateShiftedOverlap(existingSessions, incomingRows, config) {
  const tolerancePct = Number(config.closeTolerancePct || 1.5);
  const incoming = new Map((incomingRows || []).map((item) => [item.date, item]));
  const offsets = Array.isArray(config.allowedDateOffsets) ? config.allowedDateOffsets : [-2, -1, 1, 2];
  let best = { offsetDays: null, overlapCount: 0, matches: 0, ratio: 0, samples: [] };
  for (const offsetDays of offsets) {
    const samples = [];
    for (const old of existingSessions || []) {
      const shiftedDate = addDays(old.date, offsetDays);
      const row = incoming.get(shiftedDate);
      if (!row) continue;
      const differencePct = closeDifferencePct(old.close, row.close);
      if (differencePct === null) continue;
      samples.push({
        existingDate: old.date,
        incomingDate: shiftedDate,
        offsetDays,
        existingClose: Number(old.close),
        incomingClose: row.close,
        differencePct: round(differencePct, 4),
        matched: differencePct <= tolerancePct,
      });
    }
    const matches = samples.filter((item) => item.matched).length;
    const ratio = samples.length ? matches / samples.length : 0;
    if (matches > best.matches || (matches === best.matches && ratio > best.ratio)) {
      best = { offsetDays, overlapCount: samples.length, matches, ratio: round(ratio, 4), samples: samples.slice(-12) };
    }
  }
  return best;
}

function evaluateBridge(existingSessions, incomingRows, identity, config) {
  const existingLast = [...(existingSessions || [])].sort((a, b) => a.date.localeCompare(b.date)).at(-1) || null;
  const newer = (incomingRows || []).filter((row) => !existingLast || row.date > existingLast.date);
  const firstNew = newer[0] || null;
  const lastNew = newer.at(-1) || null;
  const gapDays = existingLast && firstNew
    ? Math.round((new Date(`${firstNew.date}T00:00:00Z`) - new Date(`${existingLast.date}T00:00:00Z`)) / 86400000)
    : null;
  const differencePct = existingLast && firstNew ? closeDifferencePct(existingLast.close, firstNew.close) : null;
  const requiredNew = Number(config.minimumBridgeNewSessions || 5);
  const maxGap = Number(config.maxBridgeCalendarDays || 240);
  const tolerance = Number(config.bridgeCloseTolerancePct || 15);
  const strongIdentity = Boolean(identity?.exactSymbol && identity?.egxMarket && identity?.nameAccepted && identity?.exactIsin);
  return {
    accepted: strongIdentity && newer.length >= requiredNew && gapDays !== null && gapDays >= 0 && gapDays <= maxGap && differencePct !== null && differencePct <= tolerance,
    strongIdentity,
    newSessions: newer.length,
    gapDays,
    closeDifferencePct: differencePct === null ? null : round(differencePct, 4),
    firstNewDate: firstNew?.date || null,
    firstNewClose: firstNew?.close || null,
    lastNewDate: lastNew?.date || null,
    existingLastDate: existingLast?.date || null,
    existingLastClose: existingLast?.close || null,
  };
}

function evaluateSparseEvidence(existingSessions, incomingRows, identity, config) {
  const exact = evaluateExactOverlap(existingSessions, incomingRows, config);
  const shifted = evaluateShiftedOverlap(existingSessions, incomingRows, config);
  const bridge = evaluateBridge(existingSessions, incomingRows, identity, config);
  const exactRequired = Number(config.minimumOverlapMatches || 3);
  const sparseExactRequired = Number(config.minimumSparseExactMatches || 2);
  const ratioRequired = Number(config.minimumOverlapRatio || 0.75);
  const exactAccepted = exact.matches >= exactRequired && exact.ratio >= ratioRequired;
  const sparseExactAccepted = Boolean(identity?.exactIsin) && exact.matches >= sparseExactRequired && exact.ratio === 1;
  const shiftedAccepted = Boolean(identity?.exactIsin) && shifted.matches >= exactRequired && shifted.ratio >= ratioRequired;
  let method = null;
  if (exactAccepted) method = 'exact_overlap';
  else if (sparseExactAccepted) method = 'sparse_exact_overlap_with_isin';
  else if (shiftedAccepted) method = `shifted_overlap_${shifted.offsetDays >= 0 ? '+' : ''}${shifted.offsetDays}d`;
  else if (bridge.accepted) method = 'exact_isin_contiguous_bridge';
  return { accepted: Boolean(method), method, exact, shifted, bridge };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function analyzeAdjustment(existingSessions, incomingRows, config) {
  const incoming = new Map((incomingRows || []).map((item) => [item.date, item]));
  const observations = [];
  for (const old of existingSessions || []) {
    const row = incoming.get(old.date);
    if (!row || !(Number(old.close) > 0) || !(row.close > 0)) continue;
    observations.push({
      date: old.date,
      existingClose: Number(old.close),
      incomingClose: row.close,
      factor: Number(old.close) / row.close,
    });
  }
  const factors = observations.map((item) => item.factor);
  const factor = median(factors);
  const deviations = factor ? factors.map((value) => Math.abs(value - factor) / factor * 100) : [];
  const maxDeviationPct = deviations.length ? Math.max(...deviations) : null;
  const medianDeviationPct = median(deviations);
  const minimum = Number(config.minimumAdjustmentObservations || 10);
  const maxAllowedDeviation = Number(config.maximumAdjustmentFactorDeviationPct || 0.25);
  const stable = observations.length >= minimum && maxDeviationPct !== null && maxDeviationPct <= maxAllowedDeviation;
  return {
    observations: observations.length,
    factor: factor === null ? null : round(factor, 8),
    maxDeviationPct: maxDeviationPct === null ? null : round(maxDeviationPct, 6),
    medianDeviationPct: medianDeviationPct === null ? null : round(medianDeviationPct, 6),
    stable,
    requiresManualApproval: true,
    samples: observations.slice(-12).map((item) => ({ ...item, factor: round(item.factor, 8) })),
  };
}

async function fetchTargetedTicker(ticker, mapEntry, target, config) {
  const diagnostics = [];
  const identityResult = await fetchFromAnyBase(`/egx/stock/${encodeURIComponent(ticker)}`, config, diagnostics);
  const identity = verifyIdentity(identityResult.data, ticker, mapEntry, target, config);
  if (!identity.verified) {
    const error = new Error(`starta_identity_failed:${identity.warnings.join(',') || 'unknown'}`);
    error.details = { identity, diagnostics };
    throw error;
  }

  const periodCandidates = Array.isArray(target.periodCandidates) && target.periodCandidates.length
    ? target.periodCandidates
    : (Array.isArray(config.periodCandidates) ? config.periodCandidates : ['5y', '3y', '2y', '1y']);
  const limit = Number(config.maximumRowsPerRequest || 2000);
  const fetchErrors = [];
  let best = null;
  for (const period of periodCandidates) {
    try {
      const ohlcResult = await fetchFromAnyBase(`/egx/ohlc/${encodeURIComponent(ticker)}?period=${encodeURIComponent(period)}&limit=${limit}`, config, diagnostics);
      const sourceUrl = `${ohlcResult.base}/egx/ohlc/${ticker}?period=${period}&limit=${limit}`;
      const normalized = normalizeOhlcRows(ohlcResult.data, ticker, sourceUrl, Number(config.sourceConfidence || 70));
      if (!normalized.rows.length) throw new Error('no_valid_rows');
      if (!best || normalized.rows.length > best.rows.length) {
        best = { ...normalized, sourceUrl, period };
      }
    } catch (error) {
      fetchErrors.push(`${period}:${error.message}`);
    }
  }
  if (!best) {
    const error = new Error(`starta_targeted_ohlc_failed:${fetchErrors.join(' | ')}`);
    error.details = { identity, diagnostics };
    throw error;
  }
  return { identity, ...best, diagnostics, fetchErrors };
}

function scaleRows(rows, factor, ticker, approval) {
  return (rows || []).map((row) => ({
    ...row,
    open: round(row.open * factor),
    high: round(row.high * factor),
    low: round(row.low * factor),
    close: round(row.close * factor),
    validationStatus: 'admin_approved_stable_adjustment_factor_applied',
    confidence: {
      ...(row.confidence || {}),
      overall: Math.min(65, Number(row.confidence?.overall || 65)),
      ohlc: Math.min(65, Number(row.confidence?.ohlc || 65)),
    },
    warnings: unique([
      ...(row.warnings || []),
      'admin_approved_adjustment_factor_applied',
      `adjustment_factor:${factor}`,
      `reviewed_by:${approval.reviewedBy || 'unspecified'}`,
    ]),
    adjustmentApproval: {
      ticker,
      factor,
      reviewedBy: approval.reviewedBy || null,
      reviewedAt: approval.reviewedAt || null,
      sourceUrls: Array.isArray(approval.sourceUrls) ? approval.sourceUrls : [],
    },
  }));
}

module.exports = {
  fetchTargetedTicker,
  evaluateSparseEvidence,
  analyzeAdjustment,
  scaleRows,
  nameSimilarity,
};
