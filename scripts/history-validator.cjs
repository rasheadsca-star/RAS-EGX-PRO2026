'use strict';

const { cairoDate, nowIso, round, toNumber, unique } = require('./lib/utils.cjs');

function validateSession(input) {
  const session = { ...input };
  const errors = [];
  const warnings = [...(Array.isArray(session.warnings) ? session.warnings : [])];
  const open = toNumber(session.open);
  const high = toNumber(session.high);
  const low = toNumber(session.low);
  const close = toNumber(session.close);
  const volume = session.volume === null || session.volume === undefined ? null : toNumber(session.volume);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ''))) errors.push('invalid_date');
  if (String(session.date || '') > cairoDate()) errors.push('future_date');
  if (!(open > 0)) errors.push('open_not_positive');
  if (!(high > 0)) errors.push('high_not_positive');
  if (!(low > 0)) errors.push('low_not_positive');
  if (!(close > 0)) errors.push('close_not_positive');
  if (high !== null && low !== null && high < low) errors.push('high_below_low');
  if (high !== null && open !== null && high < open) errors.push('high_below_open');
  if (high !== null && close !== null && high < close) errors.push('high_below_close');
  if (low !== null && open !== null && low > open) errors.push('low_above_open');
  if (low !== null && close !== null && low > close) errors.push('low_above_close');
  if (volume !== null && volume < 0) errors.push('negative_volume');
  if (volume === null) warnings.push('volume_missing');

  session.open = round(open);
  session.high = round(high);
  session.low = round(low);
  session.close = round(close);
  session.adjustedClose = session.adjustedClose === null || session.adjustedClose === undefined
    ? null
    : round(toNumber(session.adjustedClose));
  session.volume = volume;
  session.validatedAt = nowIso();
  session.warnings = unique(warnings);

  return { valid: errors.length === 0, session, errors };
}

function detectCorporateActions(sessions) {
  const candidates = [];
  for (let index = 1; index < sessions.length; index += 1) {
    const previous = sessions[index - 1];
    const current = sessions[index];
    if (!(previous.close > 0) || !(current.close > 0)) continue;
    const changePct = (current.close - previous.close) / previous.close * 100;
    if (Math.abs(changePct) >= 35) {
      candidates.push({
        ticker: current.ticker,
        previousDate: previous.date,
        date: current.date,
        previousClose: previous.close,
        close: current.close,
        changePct: round(changePct, 3),
        status: 'review_required',
        reason: 'large_unadjusted_close_change',
      });
      current.warnings = unique([...(current.warnings || []), 'possible_corporate_action']);
    }
  }
  return candidates;
}

function choosePreferred(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (incoming.officialVerified && !existing.officialVerified) return incoming;
  const incomingConfidence = Number(incoming.confidence?.overall || 0);
  const existingConfidence = Number(existing.confidence?.overall || 0);
  if (incomingConfidence > existingConfidence) return incoming;
  return existing;
}

function mergeAndValidate(existingSessions, incomingSessions, limit = 100) {
  const validByDate = new Map();
  const quarantine = [];

  for (const raw of [...(existingSessions || []), ...(incomingSessions || [])]) {
    const result = validateSession(raw);
    if (!result.valid) {
      quarantine.push({ ticker: raw.ticker || null, date: raw.date || null, errors: result.errors, row: raw });
      continue;
    }
    validByDate.set(result.session.date, choosePreferred(validByDate.get(result.session.date), result.session));
  }

  const sessions = [...validByDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  const corporateActions = detectCorporateActions(sessions);
  return { sessions, quarantine, corporateActions };
}

module.exports = { validateSession, mergeAndValidate, detectCorporateActions };
