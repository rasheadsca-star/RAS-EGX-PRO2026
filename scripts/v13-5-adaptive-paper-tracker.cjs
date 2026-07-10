#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const Q = path.join(DATA, 'quant');
const HISTORY_DIR = path.join(DATA, 'history');
const POLICY_PATH = path.join(DATA, 'v13-5-adaptive-policy.json');

const INPUTS = {
  v134Policy: path.join(DATA, 'v13-4-quant-policy.json'),
  recommendations: path.join(Q, 'daily-recommendations.json'),
  model: path.join(Q, 'recommendation-model.json'),
  walk: path.join(Q, 'walk-forward-results.json'),
  regime: path.join(Q, 'market-regime.json'),
  audit: path.join(Q, 'recommendation-audit.json')
};

const OUTPUTS = {
  calibration: path.join(Q, 'adaptive-strategy-calibration.json'),
  strategyHealth: path.join(Q, 'strategy-health.json'),
  ledger: path.join(Q, 'paper-recommendation-ledger.json'),
  metrics: path.join(Q, 'paper-recommendation-metrics.json'),
  recommendations: path.join(Q, 'adaptive-daily-recommendations.json'),
  audit: path.join(Q, 'v13-5-audit.json')
};

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, filePath);
}

function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}

function dateOnly(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function compareDates(a, b) { return String(a || '').localeCompare(String(b || '')); }
function average(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}
function sum(values) { return values.map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0); }

function normalizeHistory(raw) {
  const sessions = Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw) ? raw : [];
  const byDate = new Map();
  for (const row of sessions) {
    const date = dateOnly(row?.date || row?.sessionDate || row?.session);
    const open = Number(row?.open);
    const high = Number(row?.high);
    const low = Number(row?.low);
    const close = Number(row?.close);
    const volume = row?.volume === null || row?.volume === undefined || row?.volume === '' ? null : Number(row.volume);
    if (!date || ![open, high, low, close].every(v => Number.isFinite(v) && v > 0)) continue;
    if (high < low || high < open || high < close || low > open || low > close) continue;
    byDate.set(date, { date, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : null });
  }
  return [...byDate.values()].sort((a, b) => compareDates(a.date, b.date));
}

function loadHistories() {
  const map = new Map();
  if (!fs.existsSync(HISTORY_DIR)) return map;
  for (const name of fs.readdirSync(HISTORY_DIR).filter(n => n.endsWith('.json')).sort()) {
    const raw = readJson(path.join(HISTORY_DIR, name), null);
    const ticker = safeTicker(raw?.ticker || path.basename(name, '.json'));
    const rows = normalizeHistory(raw);
    if (ticker && rows.length) map.set(ticker, rows);
  }
  return map;
}

function emptyMetrics() {
  return {
    totalSignals: 0, pendingEntries: 0, openTrades: 0, closedTrades: 0, cancelledOrExpired: 0,
    wins: 0, losses: 0, winRatePct: 0, profitFactor: 0, averageReturnPct: 0, averageR: 0,
    maxDrawdownPct: 0, maxConsecutiveLosses: 0, averageHoldingSessions: 0,
    snapshots: { '1': null, '3': null, '5': null, '10': null }
  };
}

function calculateMetrics(signals) {
  const list = Array.isArray(signals) ? signals : [];
  const closed = list.filter(s => s.status === 'CLOSED' && Number.isFinite(Number(s.netReturnPct)));
  const pending = list.filter(s => s.status === 'PENDING_ENTRY').length;
  const open = list.filter(s => s.status === 'OPEN').length;
  const cancelled = list.filter(s => ['CANCELLED', 'EXPIRED'].includes(s.status)).length;
  const wins = closed.filter(s => Number(s.netReturnPct) > 0);
  const losses = closed.filter(s => Number(s.netReturnPct) <= 0);
  const grossProfit = sum(wins.map(s => s.netReturnPct));
  const grossLoss = Math.abs(sum(losses.map(s => s.netReturnPct)));
  const ordered = closed.slice().sort((a, b) => compareDates(a.exitDate, b.exitDate) || String(a.id).localeCompare(String(b.id)));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let maxStreak = 0;
  for (const trade of ordered) {
    equity += Number(trade.netReturnPct) || 0;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (Number(trade.netReturnPct) <= 0) { streak += 1; maxStreak = Math.max(maxStreak, streak); }
    else streak = 0;
  }
  const horizons = [1, 3, 5, 10];
  const snapshots = {};
  for (const h of horizons) {
    const vals = list.map(s => Number(s.snapshots?.[String(h)]?.netReturnPct)).filter(Number.isFinite);
    snapshots[String(h)] = vals.length ? {
      measuredSignals: vals.length,
      averageReturnPct: round(average(vals), 3),
      positivePct: round((vals.filter(v => v > 0).length / vals.length) * 100, 2)
    } : null;
  }
  return {
    totalSignals: list.length,
    pendingEntries: pending,
    openTrades: open,
    closedTrades: closed.length,
    cancelledOrExpired: cancelled,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? round((wins.length / closed.length) * 100, 2) : 0,
    profitFactor: closed.length ? round(grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.999 : 0), 3) : 0,
    averageReturnPct: closed.length ? round(average(closed.map(s => s.netReturnPct)), 3) : 0,
    averageR: closed.length ? round(average(closed.map(s => s.rMultiple)), 3) : 0,
    maxDrawdownPct: round(maxDrawdown, 3),
    maxConsecutiveLosses: maxStreak,
    averageHoldingSessions: closed.length ? round(average(closed.map(s => s.holdingSessions)), 2) : 0,
    snapshots
  };
}

function metricsByStrategy(signals, strategyIds) {
  const result = {};
  for (const id of strategyIds) result[id] = calculateMetrics(signals.filter(s => s.strategyId === id));
  return result;
}

function createLedger(currentSession, generatedAt, policy) {
  return {
    schemaVersion: '13.5.0',
    generatedAt,
    activatedAt: generatedAt,
    activationSession: currentSession,
    activationMode: policy.paperSafety.activationMode,
    lastProcessedSession: currentSession,
    liveExecutionEnabled: false,
    signals: []
  };
}

function loadLedger(currentSession, generatedAt, policy) {
  const existing = readJson(OUTPUTS.ledger, null);
  if (!existing || !Array.isArray(existing.signals)) return { ledger: createLedger(currentSession, generatedAt, policy), activatedNow: true };
  return {
    ledger: {
      ...existing,
      schemaVersion: '13.5.0',
      generatedAt,
      liveExecutionEnabled: false,
      signals: existing.signals
    },
    activatedNow: false
  };
}

function closeSignal(signal, row, exitPrice, outcome, policy, sameBarConflict = false) {
  const entry = Number(signal.entryPrice);
  const stop = Number(signal.originalPlan.stopLoss);
  const grossReturnPct = ((exitPrice / entry) - 1) * 100;
  const netReturnPct = grossReturnPct - Number(policy.paperSafety.roundTripCostPct || 0);
  const riskPct = ((entry - stop) / entry) * 100;
  signal.status = 'CLOSED';
  signal.outcome = outcome;
  signal.exitDate = row.date;
  signal.exitPrice = round(exitPrice, 4);
  signal.grossReturnPct = round(grossReturnPct, 3);
  signal.netReturnPct = round(netReturnPct, 3);
  signal.rMultiple = round(riskPct > 0 ? netReturnPct / riskPct : 0, 3);
  signal.sameBarConflict = sameBarConflict;
  signal.lastEvaluatedSession = row.date;
}

function updateExcursions(signal, row) {
  if (!Number.isFinite(Number(signal.entryPrice))) return;
  const entry = Number(signal.entryPrice);
  const favorable = ((Number(row.high) / entry) - 1) * 100;
  const adverse = ((Number(row.low) / entry) - 1) * 100;
  signal.maximumFavorableExcursionPct = round(Math.max(Number(signal.maximumFavorableExcursionPct) || 0, favorable), 3);
  signal.maximumAdverseExcursionPct = round(Math.min(Number(signal.maximumAdverseExcursionPct) || 0, adverse), 3);
}

function evaluateOpenOnRow(signal, row, policy) {
  updateExcursions(signal, row);
  const stopHit = Number(row.low) <= Number(signal.originalPlan.stopLoss);
  const targetHit = Number(row.high) >= Number(signal.originalPlan.target1);
  if (stopHit && targetHit) {
    closeSignal(signal, row, Number(signal.originalPlan.stopLoss), 'STOP_FIRST_SAME_BAR', policy, true);
    return;
  }
  if (stopHit) {
    closeSignal(signal, row, Number(signal.originalPlan.stopLoss), 'STOP_LOSS', policy, false);
    return;
  }
  if (targetHit) closeSignal(signal, row, Number(signal.originalPlan.target1), 'TARGET1', policy, false);
}

function fillSnapshots(signal, rows, policy) {
  if (!signal.entryDate || !Number.isFinite(Number(signal.entryPrice))) return;
  const entryIndex = rows.findIndex(r => r.date === signal.entryDate);
  if (entryIndex < 0) return;
  signal.snapshots = signal.snapshots || {};
  for (const horizon of policy.paperSafety.snapshotHorizons || [1, 3, 5, 10]) {
    const key = String(horizon);
    if (signal.snapshots[key]) continue;
    const row = rows[entryIndex + Number(horizon)];
    if (!row) continue;
    const gross = ((Number(row.close) / Number(signal.entryPrice)) - 1) * 100;
    signal.snapshots[key] = {
      sessionDate: row.date,
      close: round(row.close, 4),
      grossReturnPct: round(gross, 3),
      netReturnPct: round(gross - Number(policy.paperSafety.roundTripCostPct || 0), 3)
    };
  }
}

function processSignal(signal, rows, currentSession, policy) {
  if (!rows?.length || ['CANCELLED', 'EXPIRED'].includes(signal.status)) return;
  const eligibleRows = rows.filter(r => compareDates(r.date, signal.signalDate) > 0 && compareDates(r.date, currentSession) <= 0);

  if (signal.status === 'PENDING_ENTRY') {
    const entryRow = eligibleRows[0];
    if (!entryRow) return;
    const plan = signal.originalPlan;
    const maxGapPrice = Number(plan.entryHigh) * (1 + Number(policy.paperSafety.maximumEntryGapPct || 0) / 100);
    if (Number(entryRow.open) <= Number(plan.stopLoss)) {
      signal.status = 'CANCELLED';
      signal.outcome = 'STOP_BEFORE_ENTRY';
      signal.cancelDate = entryRow.date;
      signal.lastEvaluatedSession = entryRow.date;
      return;
    }
    if (Number(entryRow.open) > maxGapPrice) {
      signal.status = 'CANCELLED';
      signal.outcome = 'GAP_ABOVE_ALLOWED_ENTRY';
      signal.cancelDate = entryRow.date;
      signal.lastEvaluatedSession = entryRow.date;
      return;
    }
    const touched = Number(entryRow.high) >= Number(plan.entryLow) && Number(entryRow.low) <= Number(plan.entryHigh);
    if (!touched) {
      signal.status = 'EXPIRED';
      signal.outcome = 'ENTRY_NOT_TOUCHED';
      signal.expiryDate = entryRow.date;
      signal.lastEvaluatedSession = entryRow.date;
      return;
    }
    let rawEntry;
    if (Number(entryRow.open) >= Number(plan.entryLow) && Number(entryRow.open) <= Number(plan.entryHigh)) rawEntry = Number(entryRow.open);
    else if (Number(entryRow.open) < Number(plan.entryLow)) rawEntry = Number(plan.entryLow);
    else rawEntry = Number(plan.entryHigh);
    const entryPrice = rawEntry * (1 + Number(policy.paperSafety.entrySlippagePct || 0) / 100);
    if (!(entryPrice > Number(plan.stopLoss) && entryPrice < Number(plan.target1))) {
      signal.status = 'CANCELLED';
      signal.outcome = 'INVALID_ENTRY_AFTER_SLIPPAGE';
      signal.cancelDate = entryRow.date;
      signal.lastEvaluatedSession = entryRow.date;
      return;
    }
    signal.status = 'OPEN';
    signal.entryDate = entryRow.date;
    signal.entryPrice = round(entryPrice, 4);
    signal.holdingSessions = 1;
    signal.lastEvaluatedSession = entryRow.date;
    signal.maximumFavorableExcursionPct = 0;
    signal.maximumAdverseExcursionPct = 0;
    evaluateOpenOnRow(signal, entryRow, policy);
  }

  if (signal.entryDate) {
    const entryIndex = rows.findIndex(r => r.date === signal.entryDate);
    const startAfter = signal.lastEvaluatedSession || signal.entryDate;
    if (signal.status === 'OPEN') {
      for (const row of rows.filter(r => compareDates(r.date, startAfter) > 0 && compareDates(r.date, currentSession) <= 0)) {
        const rowIndex = rows.findIndex(r => r.date === row.date);
        signal.holdingSessions = rowIndex - entryIndex + 1;
        signal.lastEvaluatedSession = row.date;
        evaluateOpenOnRow(signal, row, policy);
        if (signal.status === 'CLOSED') break;
        if (signal.holdingSessions >= Number(policy.paperSafety.maximumHoldingSessions || 10)) {
          closeSignal(signal, row, Number(row.close), 'TIME_EXIT', policy, false);
          break;
        }
      }
    }
    fillSnapshots(signal, rows, policy);
  }
}

function processLedger(ledger, histories, currentSession, policy) {
  let processed = 0;
  for (const signal of ledger.signals) {
    const before = JSON.stringify({ status: signal.status, last: signal.lastEvaluatedSession, snapshots: signal.snapshots });
    processSignal(signal, histories.get(signal.ticker), currentSession, policy);
    const after = JSON.stringify({ status: signal.status, last: signal.lastEvaluatedSession, snapshots: signal.snapshots });
    if (before !== after) processed += 1;
  }
  return processed;
}

function variantVotes(folds, strategyId) {
  const votes = new Map();
  const relevant = (folds || []).map(f => f.selections?.find(s => s.strategyId === strategyId)).filter(Boolean);
  relevant.forEach((selection, index) => {
    if (!selection.selectedVariantId) return;
    const metrics = selection.validationMetrics || {};
    const recencyWeight = 1 + (index / Math.max(1, relevant.length - 1));
    const performanceWeight = Math.max(0.25, 1 + Math.min(2, Number(metrics.averageR) || 0) + Math.min(1, Math.max(-0.5, ((Number(metrics.profitFactor) || 0) - 1) * 0.5)));
    votes.set(selection.selectedVariantId, (votes.get(selection.selectedVariantId) || 0) + recencyWeight * performanceWeight);
  });
  const ordered = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sum(ordered.map(v => v[1]));
  return {
    selectedVariantId: ordered[0]?.[0] || null,
    stabilityPct: total > 0 ? round((ordered[0][1] / total) * 100, 2) : 0,
    votes: ordered.map(([variantId, weight]) => ({ variantId, weightedVote: round(weight, 3) }))
  };
}

function positiveFoldRatio(folds, strategyId, recentCount = null) {
  let selections = (folds || []).map(f => f.selections?.find(s => s.strategyId === strategyId)).filter(Boolean);
  if (recentCount) selections = selections.slice(-recentCount);
  if (!selections.length) return 0;
  const positive = selections.filter(s => Number(s.validationMetrics?.averageR) > 0 && Number(s.validationMetrics?.profitFactor) >= 1).length;
  return positive / selections.length;
}

function strategyCalibration(model, walk, paperMetrics, policy) {
  const validation = model.validationMetrics || {};
  const folds = walk.folds || [];
  const votes = variantVotes(folds, model.strategyId);
  const allPositiveRatio = positiveFoldRatio(folds, model.strategyId, null);
  const recentPositiveRatio = positiveFoldRatio(folds, model.strategyId, Number(policy.calibration.recentFoldCount || 3));
  const foldCount = (folds || []).filter(f => f.selections?.some(s => s.strategyId === model.strategyId)).length;
  const validationPass = foldCount >= Number(policy.calibration.minimumWalkForwardFolds)
    && Number(validation.closedTrades) >= Number(policy.calibration.minimumValidationTrades)
    && Number(validation.profitFactor) >= Number(policy.calibration.minimumValidationProfitFactor)
    && Number(validation.averageR) > Number(policy.calibration.minimumValidationAverageR)
    && Number(validation.maxDrawdownPct) <= Number(policy.calibration.maximumValidationDrawdownPct)
    && allPositiveRatio >= Number(policy.calibration.minimumPositiveFoldRatio);

  const breaker = policy.strategyCircuitBreaker;
  const enoughPaper = Number(paperMetrics.closedTrades) >= Number(breaker.minimumClosedPaperTrades);
  const pause = enoughPaper && (
    Number(paperMetrics.profitFactor) < Number(breaker.pauseBelowProfitFactor)
    || Number(paperMetrics.averageR) <= Number(breaker.pauseAtOrBelowAverageR)
    || Number(paperMetrics.maxDrawdownPct) > Number(breaker.pauseAboveDrawdownPct)
    || Number(paperMetrics.maxConsecutiveLosses) >= Number(breaker.pauseAtConsecutiveLosses)
  );
  const caution = !pause
    && Number(paperMetrics.closedTrades) >= Number(breaker.cautionMinimumClosedTrades)
    && (Number(paperMetrics.profitFactor) < Number(breaker.cautionBelowProfitFactor)
      || Number(paperMetrics.averageR) <= Number(breaker.cautionAtOrBelowAverageR));

  let minimumScore = Number(policy.calibration.basePaperScore || 70);
  if (Number(validation.profitFactor) < 1.2) minimumScore += 5;
  if (Number(validation.averageR) < 0.05) minimumScore += 4;
  if (Number(validation.maxDrawdownPct) > 10) minimumScore += 4;
  if (votes.stabilityPct < Number(policy.calibration.minimumVariantStabilityPct)) minimumScore += 3;
  if (recentPositiveRatio < 0.5) minimumScore += 3;
  if (caution) minimumScore += 5;
  if (Number(paperMetrics.closedTrades) >= Number(breaker.minimumClosedPaperTrades)
      && Number(paperMetrics.profitFactor) >= 1.5 && Number(paperMetrics.averageR) >= 0.2) minimumScore -= 3;
  minimumScore = round(clamp(minimumScore, Number(policy.calibration.minimumAdaptivePaperScore), Number(policy.calibration.maximumAdaptivePaperScore)), 1);

  let status = 'RESEARCH_ONLY';
  let labelAr = 'بحث فقط';
  if (pause) { status = 'PAUSED_BY_PAPER_CIRCUIT_BREAKER'; labelAr = 'موقوف مؤقتًا بسبب الأداء الورقي'; }
  else if (validationPass || model.researchValidated === true) { status = caution ? 'ACTIVE_WITH_CAUTION' : 'ACTIVE_PAPER'; labelAr = caution ? 'نشط بحذر' : 'نشط للتداول الورقي'; }

  const healthScore = round(clamp(
    35
    + Math.min(25, Number(validation.profitFactor || 0) * 10)
    + Math.max(-15, Math.min(15, Number(validation.averageR || 0) * 30))
    + (allPositiveRatio * 15)
    + Math.min(10, votes.stabilityPct / 10)
    - Math.min(20, Number(validation.maxDrawdownPct || 0))
    + (Number(paperMetrics.closedTrades) ? Math.max(-10, Math.min(10, Number(paperMetrics.averageR || 0) * 20)) : 0)
  ), 1);

  return {
    strategyId: model.strategyId,
    strategyLabelAr: model.strategyLabelAr,
    status,
    statusLabelAr: labelAr,
    healthScore,
    selectedVariantId: votes.selectedVariantId || model.selectedVariantId,
    v134SelectedVariantId: model.selectedVariantId,
    variantStabilityPct: votes.stabilityPct,
    weightedVariantVotes: votes.votes,
    minimumAdaptivePaperScore: minimumScore,
    foldCount,
    positiveFoldRatioPct: round(allPositiveRatio * 100, 2),
    recentPositiveFoldRatioPct: round(recentPositiveRatio * 100, 2),
    validationMetrics: validation,
    paperMetrics,
    validationPass,
    circuitBreakerTriggered: pause,
    caution,
    riskScale: status === 'ACTIVE_PAPER' ? 1 : status === 'ACTIVE_WITH_CAUTION' ? 0.65 : 0,
    reasonAr: pause
      ? 'تم إيقاف الاستراتيجية تلقائيًا لأن أداءها الورقي تجاوز حدود الخطر.'
      : status === 'RESEARCH_ONLY'
        ? 'لم تثبت الاستراتيجية أفضلية كافية خارج فترة التدريب حتى الآن.'
        : caution
          ? 'الاستراتيجية صالحة للقياس الورقي مع رفع درجة القبول وتقليل المخاطرة الافتراضية.'
          : 'اجتازت الاستراتيجية حد البحث الزمني ولم يظهر سبب لإيقافها ورقيًا.'
  };
}

function proximity(candidate, health, policy) {
  const passed = Array.isArray(candidate.passedConditions) ? candidate.passedConditions.length : 0;
  const failed = Array.isArray(candidate.failedConditions) ? candidate.failedConditions.length : 0;
  const conditionPct = passed + failed > 0 ? (passed / (passed + failed)) * 100 : (candidate.status === 'PAPER_CANDIDATE' ? 100 : 50);
  const threshold = Number(health?.minimumAdaptivePaperScore || policy.calibration.basePaperScore || 70);
  const scorePct = clamp((Number(candidate.recommendationScore || 0) / Math.max(1, threshold)) * 100, 0, 110);
  const qualityPct = clamp(Number(candidate.dataQuality?.historyConfidence || 0));
  const strategyPct = health?.status === 'ACTIVE_PAPER' ? 100 : health?.status === 'ACTIVE_WITH_CAUTION' ? 80 : health?.status === 'PAUSED_BY_PAPER_CIRCUIT_BREAKER' ? 20 : 45;
  return round(clamp(conditionPct * 0.45 + scorePct * 0.3 + qualityPct * 0.15 + strategyPct * 0.1, 0, 100), 1);
}

function adaptiveCandidate(candidate, health, policy, accepted) {
  const p = proximity(candidate, health, policy);
  const scoreGap = round(Math.max(0, Number(health.minimumAdaptivePaperScore) - Number(candidate.recommendationScore || 0)), 1);
  const missing = [];
  if (!['ACTIVE_PAPER', 'ACTIVE_WITH_CAUTION'].includes(health.status)) missing.push(health.reasonAr);
  if (scoreGap > 0) missing.push(`تحتاج ${scoreGap} نقطة إضافية لتجاوز حد الاستراتيجية المتكيف.`);
  for (const reason of candidate.failedConditions || []) missing.push(reason);
  if (Number(candidate.dataQuality?.historyConfidence || 0) < Number(policy.recommendations.minimumDataConfidence)) missing.push('ثقة البيانات أقل من الحد الأدنى.');
  const status = accepted ? 'PAPER_READY' : p >= Number(policy.recommendations.nearTriggerMinimumProximityPct) ? 'NEAR_TRIGGER' : 'CONDITIONAL_WATCH';
  return {
    ...candidate,
    status,
    statusLabelAr: accepted ? 'جاهز للتسجيل الورقي' : status === 'NEAR_TRIGGER' ? 'قريب من اكتمال الإشارة' : 'مراقبة مشروطة',
    adaptive: {
      proximityPct: p,
      strategyHealthStatus: health.status,
      strategyHealthScore: health.healthScore,
      minimumRequiredScore: health.minimumAdaptivePaperScore,
      scoreGap,
      calibratedVariantId: health.selectedVariantId,
      riskScale: health.riskScale,
      missingRequirementsAr: [...new Set(missing)].slice(0, 8),
      automaticConversionRuleAr: 'يتحول تلقائيًا إلى إشارة ورقية فقط عند اكتمال شروط V13.4 وبقاء الاستراتيجية نشطة وتجاوز الدرجة المتكيفة.'
    }
  };
}

function signalId(candidate) {
  return `${safeTicker(candidate.ticker)}:${candidate.strategyId}:${candidate.signalDate}`;
}

function immutablePlan(candidate) {
  const p = candidate.plan || {};
  return {
    entryLow: Number(p.entryLow),
    entryHigh: Number(p.entryHigh),
    stopLoss: Number(p.stopLoss),
    target1: Number(p.target1),
    target2: Number(p.target2),
    validEntrySessions: Number(p.validEntrySessions || 1),
    maximumHoldingSessions: Number(p.maximumHoldingSessions || 10)
  };
}

function registerSignals(ledger, candidates, currentSession, generatedAt, policy) {
  const existingIds = new Set(ledger.signals.map(s => s.id));
  const activeTicker = new Set(ledger.signals.filter(s => ['PENDING_ENTRY', 'OPEN'].includes(s.status)).map(s => s.ticker));
  const added = [];
  for (const candidate of candidates.slice(0, Number(policy.paperSafety.maximumNewSignalsPerSession || 8))) {
    const id = signalId(candidate);
    const ticker = safeTicker(candidate.ticker);
    if (!ticker || existingIds.has(id) || activeTicker.has(ticker)) continue;
    const plan = immutablePlan(candidate);
    if (![plan.entryLow, plan.entryHigh, plan.stopLoss, plan.target1, plan.target2].every(Number.isFinite)) continue;
    const fingerprint = sha256({ ticker, strategyId: candidate.strategyId, signalDate: currentSession, plan });
    const signal = {
      id,
      schemaVersion: '13.5.0',
      ticker,
      companyNameAr: candidate.companyNameAr || null,
      companyNameEn: candidate.companyNameEn || null,
      sector: candidate.sector || null,
      strategyId: candidate.strategyId,
      strategyLabelAr: candidate.strategyLabelAr,
      variantId: candidate.variantId,
      signalDate: currentSession,
      createdAt: generatedAt,
      status: 'PENDING_ENTRY',
      recommendationScore: Number(candidate.recommendationScore),
      proximityPct: Number(candidate.adaptive?.proximityPct),
      marketRegime: candidate.marketRegime,
      originalPlan: plan,
      originalPlanFingerprint: fingerprint,
      source: 'V13.5_ADAPTIVE_PAPER_ONLY',
      liveExecutionEnabled: false,
      lastEvaluatedSession: currentSession,
      snapshots: {}
    };
    ledger.signals.push(signal);
    existingIds.add(id);
    activeTicker.add(ticker);
    added.push(id);
  }
  return added;
}

function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(POLICY_PATH, null);
  const v134Policy = readJson(INPUTS.v134Policy, null);
  const recs = readJson(INPUTS.recommendations, null);
  const model = readJson(INPUTS.model, null);
  const walk = readJson(INPUTS.walk, null);
  const regime = readJson(INPUTS.regime, null);
  const v134Audit = readJson(INPUTS.audit, null);
  if (!policy || !v134Policy || !recs || !model || !walk || !regime) throw new Error('Missing one or more required V13.4/V13.5 input files.');
  if (recs.schemaVersion !== '13.4.0' || model.schemaVersion !== '13.4.0' || walk.schemaVersion !== '13.4.0') throw new Error('V13.4 inputs have unexpected schema versions.');
  const currentSession = dateOnly(recs.sessionId || model.latestMarketSession || regime.latestMarketSession);
  if (!currentSession) throw new Error('Current market session is unavailable.');

  const histories = loadHistories();
  const loaded = loadLedger(currentSession, generatedAt, policy);
  const ledger = loaded.ledger;
  const processedSignals = processLedger(ledger, histories, currentSession, policy);

  const strategyIds = (model.strategies || []).map(s => s.strategyId);
  let overallMetrics = calculateMetrics(ledger.signals);
  let byStrategy = metricsByStrategy(ledger.signals, strategyIds);
  const health = (model.strategies || []).map(s => strategyCalibration(s, walk, byStrategy[s.strategyId] || emptyMetrics(), policy));
  const healthMap = new Map(health.map(h => [h.strategyId, h]));

  const blocked = new Set((policy.safety.blockedTickers || []).map(safeTicker));
  const sourceCandidates = [...(recs.paperCandidates || []), ...(recs.watchCandidates || [])];
  const adaptivePaper = [];
  const adaptiveWatch = [];
  const seen = new Set();
  for (const candidate of sourceCandidates) {
    const ticker = safeTicker(candidate.ticker);
    if (!ticker || seen.has(`${ticker}:${candidate.strategyId}`) || blocked.has(ticker)) continue;
    seen.add(`${ticker}:${candidate.strategyId}`);
    const strategy = healthMap.get(candidate.strategyId);
    if (!strategy) continue;
    const accepted = candidate.status === 'PAPER_CANDIDATE'
      && ['ACTIVE_PAPER', 'ACTIVE_WITH_CAUTION'].includes(strategy.status)
      && Number(candidate.recommendationScore) >= Number(strategy.minimumAdaptivePaperScore)
      && Number(candidate.dataQuality?.historyConfidence || 0) >= Number(policy.recommendations.minimumDataConfidence);
    const item = adaptiveCandidate(candidate, strategy, policy, accepted);
    if (accepted) adaptivePaper.push(item);
    else if (item.adaptive.proximityPct >= Number(policy.recommendations.watchMinimumProximityPct)) adaptiveWatch.push(item);
  }
  adaptivePaper.sort((a, b) => b.recommendationScore - a.recommendationScore || b.adaptive.proximityPct - a.adaptive.proximityPct || a.ticker.localeCompare(b.ticker));
  adaptiveWatch.sort((a, b) => b.adaptive.proximityPct - a.adaptive.proximityPct || b.recommendationScore - a.recommendationScore || a.ticker.localeCompare(b.ticker));
  const finalPaper = adaptivePaper.slice(0, Number(policy.recommendations.maximumPaperCandidates || 8));
  const finalWatch = adaptiveWatch.slice(0, Number(policy.recommendations.maximumConditionalWatch || 20));

  const isNewSession = compareDates(currentSession, ledger.lastProcessedSession) > 0;
  const canRegister = !loaded.activatedNow || policy.paperSafety.registerCurrentSessionOnActivation === true;
  const newSignalIds = canRegister && isNewSession ? registerSignals(ledger, finalPaper, currentSession, generatedAt, policy) : [];
  ledger.lastProcessedSession = currentSession;
  ledger.generatedAt = generatedAt;

  overallMetrics = calculateMetrics(ledger.signals);
  byStrategy = metricsByStrategy(ledger.signals, strategyIds);

  const calibrationDoc = {
    schemaVersion: '13.5.0',
    generatedAt,
    sessionId: currentSession,
    methodology: 'Walk-forward fold stability plus immutable out-of-sample paper feedback; thresholds may tighten but never bypass V13.4 signal conditions.',
    liveExecutionEnabled: false,
    strategies: health.map(item => ({
      ...item,
      calibratedParametersAreAdvisory: true,
      noFutureDataUsed: true
    }))
  };

  const strategyHealthDoc = {
    schemaVersion: '13.5.0',
    generatedAt,
    sessionId: currentSession,
    liveExecutionEnabled: false,
    activeStrategies: health.filter(h => ['ACTIVE_PAPER', 'ACTIVE_WITH_CAUTION'].includes(h.status)).length,
    pausedStrategies: health.filter(h => h.status === 'PAUSED_BY_PAPER_CIRCUIT_BREAKER').length,
    researchOnlyStrategies: health.filter(h => h.status === 'RESEARCH_ONLY').length,
    strategies: health
  };

  const metricsDoc = {
    schemaVersion: '13.5.0',
    generatedAt,
    sessionId: currentSession,
    activationSession: ledger.activationSession,
    lastProcessedSession: ledger.lastProcessedSession,
    liveExecutionEnabled: false,
    overall: overallMetrics,
    byStrategy
  };

  const adaptiveRecommendations = {
    schemaVersion: '13.5.0',
    generatedAt,
    sessionId: currentSession,
    liveExecutionEnabled: false,
    status: finalPaper.length ? 'ADAPTIVE_PAPER_READY' : 'CONDITIONAL_WATCH_ONLY',
    statusLabelAr: finalPaper.length ? 'مرشحو تداول ورقي متكيفون' : 'مراقبة مشروطة فقط',
    marketRegime: recs.marketRegime,
    counts: {
      sourcePaperCandidates: (recs.paperCandidates || []).length,
      sourceWatchCandidates: (recs.watchCandidates || []).length,
      adaptivePaperCandidates: finalPaper.length,
      conditionalWatch: finalWatch.length,
      activeStrategies: strategyHealthDoc.activeStrategies,
      pausedStrategies: strategyHealthDoc.pausedStrategies,
      newSignalsRegistered: newSignalIds.length,
      openPaperSignals: overallMetrics.openTrades,
      closedPaperSignals: overallMetrics.closedTrades
    },
    paperCandidates: finalPaper,
    conditionalWatch: finalWatch,
    registration: {
      activationMode: policy.paperSafety.activationMode,
      activationSession: ledger.activationSession,
      firstRunBaselineOnly: loaded.activatedNow && policy.paperSafety.registerCurrentSessionOnActivation !== true,
      newSignalIds,
      automaticConversion: true,
      actualTrading: false
    },
    warningAr: 'هذه توصيات بحث وتداول ورقي فقط. لا يوجد تنفيذ حقيقي ولا ضمان للربح.'
  };

  const auditDoc = {
    schemaVersion: '13.5.0',
    generatedAt,
    sessionId: currentSession,
    controls: {
      noLookahead: true,
      noRetroactiveSignalCreation: true,
      immutableOriginalPlans: true,
      sameBarConflictRule: policy.paperSafety.sameBarConflictRule,
      entryStartsNextSession: true,
      costsIncluded: true,
      liveExecutionEnabled: false,
      strategyCircuitBreaker: true
    },
    activation: {
      activatedNow: loaded.activatedNow,
      activationSession: ledger.activationSession,
      baselineOnly: loaded.activatedNow && policy.paperSafety.registerCurrentSessionOnActivation !== true
    },
    processing: {
      historySymbolsAvailable: histories.size,
      processedSignals,
      newSignalIds,
      totalLedgerSignals: ledger.signals.length
    },
    inputHashes: {
      v134Recommendations: sha256(recs),
      v134Model: sha256(model),
      v134WalkForward: sha256(walk),
      v134Audit: sha256(v134Audit || {})
    },
    strategyStates: health.map(h => ({ strategyId: h.strategyId, status: h.status, minimumAdaptivePaperScore: h.minimumAdaptivePaperScore })),
    blockedTickers: [...blocked]
  };

  writeJsonAtomic(OUTPUTS.calibration, calibrationDoc);
  writeJsonAtomic(OUTPUTS.strategyHealth, strategyHealthDoc);
  writeJsonAtomic(OUTPUTS.ledger, ledger);
  writeJsonAtomic(OUTPUTS.metrics, metricsDoc);
  writeJsonAtomic(OUTPUTS.recommendations, adaptiveRecommendations);
  writeJsonAtomic(OUTPUTS.audit, auditDoc);

  console.log(`V13.5 session: ${currentSession}`);
  console.log(`V13.5 strategies active: ${strategyHealthDoc.activeStrategies}; paused: ${strategyHealthDoc.pausedStrategies}`);
  console.log(`V13.5 adaptive paper candidates: ${finalPaper.length}; watch: ${finalWatch.length}`);
  console.log(`V13.5 ledger signals: ${ledger.signals.length}; new: ${newSignalIds.length}; processed: ${processedSignals}`);
}

try { main(); }
catch (error) {
  console.error(`V13.5 adaptive paper tracker failed: ${error.stack || error.message}`);
  process.exit(1);
}
