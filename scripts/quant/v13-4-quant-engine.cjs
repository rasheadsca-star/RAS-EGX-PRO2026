#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const HISTORY_DIR = path.join(DATA, 'history');
const QUANT_DIR = path.join(DATA, 'quant');
const POLICY_PATH = path.join(DATA, 'v13-4-quant-policy.json');
const SYMBOL_MAP_PATH = path.join(DATA, 'symbol-map.json');
const ELIGIBILITY_PATH = path.join(DATA, 'history-eligibility.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');

const OUTPUTS = {
  featureStore: path.join(QUANT_DIR, 'feature-store.json'),
  marketRegime: path.join(QUANT_DIR, 'market-regime.json'),
  backtests: path.join(QUANT_DIR, 'strategy-backtests.json'),
  walkForward: path.join(QUANT_DIR, 'walk-forward-results.json'),
  model: path.join(QUANT_DIR, 'recommendation-model.json'),
  recommendations: path.join(QUANT_DIR, 'daily-recommendations.json'),
  audit: path.join(QUANT_DIR, 'recommendation-audit.json'),
  gateTraceV139: path.join(QUANT_DIR, 'recommendation-gate-trace-v13-9.json')
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

function median(values) {
  const clean = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!clean.length) return null;
  const i = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[i] : (clean[i - 1] + clean[i]) / 2;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function sum(values) { return values.filter(Number.isFinite).reduce((a, b) => a + b, 0); }

function mapEntries(raw) {
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
}

function normalizeHistory(raw) {
  const sessions = Array.isArray(raw?.sessions) ? raw.sessions : Array.isArray(raw) ? raw : [];
  const byDate = new Map();
  for (const row of sessions) {
    const date = dateOnly(row?.date || row?.sessionDate || row?.session);
    const open = Number(row?.open);
    const high = Number(row?.high);
    const low = Number(row?.low);
    const close = Number(row?.close);
    const volumeRaw = row?.volume ?? row?.tradedVolume ?? row?.qty ?? null;
    const volume = volumeRaw === null || volumeRaw === undefined || volumeRaw === '' ? null : Number(volumeRaw);
    if (!date || ![open, high, low, close].every(v => Number.isFinite(v) && v > 0)) continue;
    if (high < low || high < open || high < close || low > open || low > close) continue;
    byDate.set(date, {
      date,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : null
    });
  }
  return [...byDate.values()].sort((a, b) => compareDates(a.date, b.date));
}

function sma(values, period, index) {
  if (index + 1 < period) return null;
  return average(values.slice(index - period + 1, index + 1));
}

function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const seed = average(values.slice(0, period));
  out[period - 1] = seed;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function rsiSeries(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change; else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const g = Math.max(change, 0);
    const l = Math.max(-change, 0);
    avgGain = ((avgGain * (period - 1)) + g) / period;
    avgLoss = ((avgLoss * (period - 1)) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

function atrSeries(rows, period = 14) {
  const tr = rows.map((row, i) => {
    if (!i) return row.high - row.low;
    const previous = rows[i - 1].close;
    return Math.max(row.high - row.low, Math.abs(row.high - previous), Math.abs(row.low - previous));
  });
  const out = new Array(rows.length).fill(null);
  if (rows.length < period) return out;
  let current = average(tr.slice(0, period));
  out[period - 1] = current;
  for (let i = period; i < rows.length; i += 1) {
    current = ((current * (period - 1)) + tr[i]) / period;
    out[i] = current;
  }
  return out;
}

function percentReturn(values, index, lag) {
  if (index < lag || !(values[index - lag] > 0)) return null;
  return ((values[index] / values[index - lag]) - 1) * 100;
}

function priorExtreme(rows, index, period, field, mode) {
  if (index < period) return null;
  const values = rows.slice(index - period, index).map(r => Number(r[field])).filter(Number.isFinite);
  if (!values.length) return null;
  return mode === 'min' ? Math.min(...values) : Math.max(...values);
}

function buildMarketProxy(histories) {
  const dailyReturns = new Map();
  for (const rows of histories.values()) {
    for (let i = 1; i < rows.length; i += 1) {
      const ret = ((rows[i].close / rows[i - 1].close) - 1) * 100;
      if (!Number.isFinite(ret)) continue;
      const list = dailyReturns.get(rows[i].date) || [];
      list.push(ret);
      dailyReturns.set(rows[i].date, list);
    }
  }
  const dates = [...dailyReturns.keys()].sort(compareDates);
  const indexByDate = new Map();
  let index = 100;
  for (const date of dates) {
    const ret = median(dailyReturns.get(date)) || 0;
    index *= 1 + (ret / 100);
    indexByDate.set(date, index);
  }
  const ordered = dates.map(date => ({ date, value: indexByDate.get(date) }));
  const pos = new Map(ordered.map((row, i) => [row.date, i]));
  function marketReturn(date, lag) {
    const i = pos.get(date);
    if (i === undefined || i < lag) return null;
    return ((ordered[i].value / ordered[i - lag].value) - 1) * 100;
  }
  return { ordered, marketReturn };
}

function prepareIndicators(rows, proxy) {
  const closes = rows.map(r => r.close);
  const volumes = rows.map(r => r.volume);
  const ema9 = emaSeries(closes, 9);
  const ema12 = emaSeries(closes, 12);
  const ema21 = emaSeries(closes, 21);
  const ema26 = emaSeries(closes, 26);
  const macd = closes.map((_, i) => Number.isFinite(ema12[i]) && Number.isFinite(ema26[i]) ? ema12[i] - ema26[i] : null);
  const macdSignal = emaSeries(macd.map(v => Number.isFinite(v) ? v : 0), 9);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(rows, 14);
  const features = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const sma5 = sma(closes, 5, i);
    const sma10 = sma(closes, 10, i);
    const sma20 = sma(closes, 20, i);
    const sma50 = sma(closes, 50, i);
    const volumeWindow = volumes.slice(Math.max(0, i - 19), i + 1).filter(v => Number.isFinite(v) && v > 0);
    const turnoverWindow = rows.slice(Math.max(0, i - 19), i + 1)
      .map(r => Number.isFinite(r.volume) && r.volume > 0 ? r.close * r.volume : null)
      .filter(Number.isFinite);
    const avgVolume20 = average(volumeWindow);
    const avgTurnover20 = average(turnoverWindow);
    const support20 = priorExtreme(rows, i, 20, 'low', 'min');
    const resistance20 = priorExtreme(rows, i, 20, 'high', 'max');
    const marketRet20 = proxy.marketReturn(row.date, 20);
    const ret20 = percentReturn(closes, i, 20);
    const previousRsi = i > 0 ? rsi[i - 1] : null;
    const currentMacd = Number.isFinite(macd[i]) ? macd[i] : null;
    const currentSignal = Number.isFinite(macdSignal[i]) ? macdSignal[i] : null;
    features.push({
      index: i,
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      return1: percentReturn(closes, i, 1),
      return3: percentReturn(closes, i, 3),
      return5: percentReturn(closes, i, 5),
      return10: percentReturn(closes, i, 10),
      return20: ret20,
      sma5,
      sma10,
      sma20,
      sma50,
      sma20Slope5Pct: i >= 5 && Number.isFinite(sma20) ? ((sma20 / sma(closes, 20, i - 5)) - 1) * 100 : null,
      ema9: ema9[i],
      ema21: ema21[i],
      rsi14: rsi[i],
      previousRsi14: previousRsi,
      atr14: atr[i],
      atrPct: Number.isFinite(atr[i]) ? (atr[i] / row.close) * 100 : null,
      macd: currentMacd,
      macdSignal: currentSignal,
      macdHistogram: Number.isFinite(currentMacd) && Number.isFinite(currentSignal) ? currentMacd - currentSignal : null,
      avgVolume20,
      volumeRatio20: Number.isFinite(row.volume) && Number.isFinite(avgVolume20) && avgVolume20 > 0 ? row.volume / avgVolume20 : null,
      avgTurnover20,
      nonZeroVolumeSessions20: volumeWindow.length,
      support20,
      resistance20,
      breakoutPct: Number.isFinite(resistance20) && resistance20 > 0 ? ((row.close / resistance20) - 1) * 100 : null,
      distanceSma20Pct: Number.isFinite(sma20) && sma20 > 0 ? ((row.close / sma20) - 1) * 100 : null,
      distanceSupport20Pct: Number.isFinite(support20) && support20 > 0 ? ((row.close / support20) - 1) * 100 : null,
      resistanceUpsidePct: Number.isFinite(resistance20) && row.close > 0 ? ((resistance20 / row.close) - 1) * 100 : null,
      marketReturn20: marketRet20,
      relativeStrength20: Number.isFinite(ret20) && Number.isFinite(marketRet20) ? ret20 - marketRet20 : null
    });
  }
  return features;
}

function condition(id, labelAr, pass, detail) { return { id, labelAr, pass: Boolean(pass), detail }; }

function liquidityConditions(feature, policy) {
  return [
    condition('turnover', 'متوسط قيمة التداول', Number(feature.avgTurnover20) >= Number(policy.liquidity.minimumAverageTurnover20Egp), round(feature.avgTurnover20, 0)),
    condition('volumeSessions', 'جلسات حجم تداول صالحة', Number(feature.nonZeroVolumeSessions20) >= Number(policy.liquidity.minimumNonZeroVolumeSessions20), feature.nonZeroVolumeSessions20),
    condition('volumeRatioFloor', 'نشاط الحجم الحالي', Number(feature.volumeRatio20) >= Number(policy.liquidity.minimumLatestVolumeRatio), round(feature.volumeRatio20, 2))
  ];
}

function strategyEvaluation(strategyId, variant, feature, policy) {
  const liq = liquidityConditions(feature, policy);
  const common = [
    condition('warmup', 'اكتمال المؤشرات', feature.index >= Number(policy.research.featureWarmupSessions), feature.index + 1),
    ...liq,
    condition('atr', 'توفر قياس المخاطرة', Number(feature.atr14) > 0 && Number(feature.atrPct) > 0, round(feature.atrPct, 2)),
    condition('relativeStrength', 'القوة النسبية', Number(feature.relativeStrength20) >= Number(variant.minRelativeStrength20), round(feature.relativeStrength20, 2))
  ];
  let specific = [];
  let score = 0;

  if (strategyId === 'trend_follow') {
    specific = [
      condition('trendStructure', 'ترتيب الاتجاه', feature.close > feature.sma20 && feature.sma20 > feature.sma50, `${round(feature.close, 3)} > ${round(feature.sma20, 3)} > ${round(feature.sma50, 3)}`),
      condition('sma20Slope', 'ميل متوسط 20', Number(feature.sma20Slope5Pct) > 0, round(feature.sma20Slope5Pct, 2)),
      condition('rsiRange', 'منطقة RSI', Number(feature.rsi14) >= variant.minRsi && Number(feature.rsi14) <= variant.maxRsi, round(feature.rsi14, 1)),
      condition('volumeRatio', 'دعم الحجم', Number(feature.volumeRatio20) >= variant.minVolumeRatio, round(feature.volumeRatio20, 2)),
      condition('resistanceRoom', 'مساحة حتى المقاومة', Number(feature.resistanceUpsidePct) >= variant.minResistanceUpsidePct || Number(feature.breakoutPct) > 0, round(feature.resistanceUpsidePct, 2))
    ];
    score = 25 * (feature.close > feature.sma20 && feature.sma20 > feature.sma50 ? 1 : 0)
      + clamp((Number(feature.sma20Slope5Pct) || 0) * 8, 0, 15)
      + clamp(15 - Math.abs((Number(feature.rsi14) || 50) - 60) * 0.8, 0, 15)
      + clamp((Number(feature.volumeRatio20) || 0) * 10, 0, 15)
      + clamp((Number(feature.relativeStrength20) || 0) * 2 + 8, 0, 20)
      + clamp((Number(feature.resistanceUpsidePct) || 0) * 2, 0, 10);
  } else if (strategyId === 'breakout') {
    specific = [
      condition('trendStructure', 'اتجاه داعم للاختراق', feature.close > feature.sma20 && feature.sma20 > feature.sma50, null),
      condition('breakout', 'اختراق مقاومة 20 جلسة', Number(feature.breakoutPct) >= Number(variant.breakoutBufferPct), round(feature.breakoutPct, 2)),
      condition('volumeRatio', 'حجم يؤكد الاختراق', Number(feature.volumeRatio20) >= variant.minVolumeRatio, round(feature.volumeRatio20, 2)),
      condition('rsiRange', 'منطقة RSI', Number(feature.rsi14) >= variant.minRsi && Number(feature.rsi14) <= variant.maxRsi, round(feature.rsi14, 1)),
      condition('positiveClose', 'إغلاق إيجابي', Number(feature.return1) > 0, round(feature.return1, 2))
    ];
    score = 20 * (feature.close > feature.sma20 && feature.sma20 > feature.sma50 ? 1 : 0)
      + clamp((Number(feature.breakoutPct) || 0) * 12 + 12, 0, 25)
      + clamp((Number(feature.volumeRatio20) || 0) * 12, 0, 20)
      + clamp(15 - Math.abs((Number(feature.rsi14) || 60) - 64) * 0.7, 0, 15)
      + clamp((Number(feature.relativeStrength20) || 0) * 2 + 8, 0, 20);
  } else if (strategyId === 'pullback') {
    const nearSma = Number(feature.distanceSma20Pct) >= -1.5 && Number(feature.distanceSma20Pct) <= Number(variant.maxDistanceSma20Pct);
    specific = [
      condition('trendStructure', 'الاتجاه المتوسط صاعد', feature.close > feature.sma50 && feature.sma20 > feature.sma50, null),
      condition('nearSma20', 'الاقتراب من متوسط 20', nearSma, round(feature.distanceSma20Pct, 2)),
      condition('touchedZone', 'اختبار منطقة الدعم', feature.low <= feature.sma20 * 1.015, round(((feature.low / feature.sma20) - 1) * 100, 2)),
      condition('rsiRange', 'RSI مناسب للارتداد', Number(feature.rsi14) >= variant.minRsi && Number(feature.rsi14) <= variant.maxRsi, round(feature.rsi14, 1)),
      condition('rsiRecovery', 'تحسن RSI', Number(feature.rsi14) > Number(feature.previousRsi14), `${round(feature.previousRsi14, 1)} → ${round(feature.rsi14, 1)}`),
      condition('volumeRatio', 'سيولة كافية', Number(feature.volumeRatio20) >= variant.minVolumeRatio, round(feature.volumeRatio20, 2))
    ];
    score = 25 * (feature.close > feature.sma50 && feature.sma20 > feature.sma50 ? 1 : 0)
      + clamp(20 - Math.abs(Number(feature.distanceSma20Pct) || 0) * 6, 0, 20)
      + clamp(15 - Math.abs((Number(feature.rsi14) || 50) - 50) * 0.8, 0, 15)
      + (Number(feature.rsi14) > Number(feature.previousRsi14) ? 15 : 0)
      + clamp((Number(feature.relativeStrength20) || 0) * 2 + 8, 0, 15)
      + clamp((Number(feature.volumeRatio20) || 0) * 7, 0, 10);
  }

  const conditions = [...common, ...specific];
  return {
    passed: conditions.every(c => c.pass),
    score: round(clamp(score), 1),
    conditions,
    failedConditions: conditions.filter(c => !c.pass).map(c => `${c.labelAr}: ${c.detail ?? 'لم يتحقق'}`)
  };
}

function tradePlan(feature, strategyId, policy) {
  const atrPct = clamp(feature.atrPct, 1.5, 6.0);
  const supportRiskPct = Number(feature.support20) > 0 ? ((feature.close / feature.support20) - 1) * 100 + 0.3 : null;
  let riskPct = Number.isFinite(supportRiskPct) && supportRiskPct >= 1.5 && supportRiskPct <= 6 ? supportRiskPct : Math.max(2, Math.min(5.5, atrPct * 1.35));
  if (strategyId === 'breakout') riskPct = Math.max(2.2, Math.min(5.5, atrPct * 1.5));
  const entryLow = feature.close * (1 - Math.min(0.006, atrPct * 0.0012));
  const entryHigh = feature.close * (1 + Math.min(0.01, atrPct * 0.0015));
  const entryMid = (entryLow + entryHigh) / 2;
  const stopLoss = entryMid * (1 - riskPct / 100);
  const target1 = entryMid + (entryMid - stopLoss) * Number(policy.recommendations.minimumRiskReward);
  const target2 = entryMid + (entryMid - stopLoss) * Number(policy.recommendations.target2RiskMultiple);
  return {
    entryLow: round(entryLow, 4),
    entryHigh: round(entryHigh, 4),
    stopLoss: round(stopLoss, 4),
    target1: round(target1, 4),
    target2: round(target2, 4),
    riskPct: round(riskPct, 3),
    riskReward1: Number(policy.recommendations.minimumRiskReward),
    validEntrySessions: Number(policy.recommendations.validEntrySessions),
    maximumHoldingSessions: Number(policy.research.maximumHoldingSessions),
    cancelConditionsAr: [
      'إلغاء الإشارة إذا افتتحت الجلسة التالية أعلى من الحد الأعلى للدخول بأكثر من 3%.',
      'إلغاء الإشارة إذا كسر السعر وقف الخسارة قبل تنفيذ الدخول.',
      'الإشارة صالحة لجلسة دخول واحدة فقط.'
    ]
  };
}

function simulateTrade(rows, signalIndex, plan, policy, metadata) {
  const next = rows[signalIndex + 1];
  if (!next) return null;
  const maxGap = Number(policy.research.maximumEntryGapPct);
  const gapPct = ((next.open / rows[signalIndex].close) - 1) * 100;
  if (gapPct > maxGap || next.open <= plan.stopLoss) {
    return {
      ...metadata,
      signalDate: rows[signalIndex].date,
      entryDate: next.date,
      exitDate: next.date,
      outcome: 'CANCELLED_GAP_OR_STOP',
      status: 'CANCELLED',
      rMultiple: 0,
      netReturnPct: 0,
      holdingSessions: 0,
      entryPrice: null,
      exitPrice: null,
      sameBarConflict: false
    };
  }

  const slippage = Number(policy.research.entrySlippagePct) / 100;
  const entryPrice = next.open * (1 + slippage);
  const riskPct = Number(plan.riskPct) / 100;
  const stopLoss = entryPrice * (1 - riskPct);
  const target1 = entryPrice * (1 + riskPct * Number(policy.recommendations.minimumRiskReward));
  const lastIndex = Math.min(rows.length - 1, signalIndex + Number(policy.research.maximumHoldingSessions));
  let exitPrice = rows[lastIndex].close;
  let exitDate = rows[lastIndex].date;
  let outcome = 'TIME_EXIT';
  let sameBarConflict = false;
  let exitIndex = lastIndex;

  for (let i = signalIndex + 1; i <= lastIndex; i += 1) {
    const row = rows[i];
    const stopTouched = row.low <= stopLoss;
    const targetTouched = row.high >= target1;
    if (stopTouched) {
      exitPrice = stopLoss;
      exitDate = row.date;
      exitIndex = i;
      sameBarConflict = targetTouched;
      outcome = targetTouched ? 'STOP_FIRST_SAME_BAR' : 'STOP_LOSS';
      break;
    }
    if (targetTouched) {
      exitPrice = target1;
      exitDate = row.date;
      exitIndex = i;
      outcome = 'TARGET1';
      break;
    }
  }

  const grossReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  const netReturnPct = grossReturnPct - Number(policy.research.roundTripCostPct);
  return {
    ...metadata,
    signalDate: rows[signalIndex].date,
    entryDate: next.date,
    exitDate,
    status: 'CLOSED',
    outcome,
    entryPrice: round(entryPrice, 4),
    exitPrice: round(exitPrice, 4),
    stopLoss: round(stopLoss, 4),
    target1: round(target1, 4),
    grossReturnPct: round(grossReturnPct, 3),
    netReturnPct: round(netReturnPct, 3),
    rMultiple: round(netReturnPct / (riskPct * 100), 3),
    holdingSessions: exitIndex - signalIndex,
    sameBarConflict
  };
}

function metrics(trades) {
  const closed = trades.filter(t => t.status === 'CLOSED');
  const wins = closed.filter(t => Number(t.netReturnPct) > 0);
  const losses = closed.filter(t => Number(t.netReturnPct) < 0);
  const grossProfit = sum(wins.map(t => t.netReturnPct));
  const grossLoss = Math.abs(sum(losses.map(t => t.netReturnPct)));

  // V13.9 correction:
  // Drawdown must be measured from the peak of a compounded equity index,
  // not by adding percentage points. The old additive method could exceed 100%.
  let equityIndex = 100;
  let peakEquityIndex = 100;
  let maxDrawdownPct = 0;
  let additiveEquity = 0;
  let additivePeak = 0;
  let legacyAdditiveDrawdownPct = 0;

  const ordered = closed.slice().sort((a, b) =>
    compareDates(a.exitDate, b.exitDate) || compareDates(a.signalDate, b.signalDate)
  );

  for (const trade of ordered) {
    const tradeReturnPct = Number(trade.netReturnPct) || 0;

    additiveEquity += tradeReturnPct;
    additivePeak = Math.max(additivePeak, additiveEquity);
    legacyAdditiveDrawdownPct = Math.max(
      legacyAdditiveDrawdownPct,
      additivePeak - additiveEquity
    );

    const returnFactor = Math.max(0, 1 + (tradeReturnPct / 100));
    equityIndex *= returnFactor;
    peakEquityIndex = Math.max(peakEquityIndex, equityIndex);
    const currentDrawdownPct = peakEquityIndex > 0
      ? ((peakEquityIndex - equityIndex) / peakEquityIndex) * 100
      : 100;
    maxDrawdownPct = Math.max(maxDrawdownPct, currentDrawdownPct);
  }

  return {
    totalSignals: trades.length,
    closedTrades: closed.length,
    cancelledTrades: trades.filter(t => t.status === 'CANCELLED').length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? round((wins.length / closed.length) * 100, 2) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : grossProfit > 0 ? 99 : 0,
    averageReturnPct: closed.length ? round(average(closed.map(t => t.netReturnPct)), 3) : 0,
    averageR: closed.length ? round(average(closed.map(t => t.rMultiple)), 3) : 0,
    medianR: closed.length ? round(median(closed.map(t => t.rMultiple)), 3) : 0,
    maxDrawdownPct: round(clamp(maxDrawdownPct, 0, 100), 3),
    drawdownMethod: 'compounded_equity_peak_to_trough',
    startingEquityIndex: 100,
    endingEquityIndex: round(equityIndex, 4),
    legacyAdditiveDrawdownPct: round(legacyAdditiveDrawdownPct, 3),
    sameBarStopFirstCount: closed.filter(t => t.sameBarConflict).length
  };
}

function trainingScore(m) {
  if (m.closedTrades <= 0) return -9999;
  return (Math.min(m.profitFactor, 3) * 12)
    + (m.averageR * 35)
    + (m.winRatePct * 0.12)
    + (Math.log10(m.closedTrades + 1) * 8)
    - (m.maxDrawdownPct * 1.5);
}

function buildRegime(latestFeatures) {
  const valid = latestFeatures.filter(f => Number.isFinite(f.sma20) && Number.isFinite(f.sma50));
  const above20Pct = valid.length ? (valid.filter(f => f.close > f.sma20).length / valid.length) * 100 : 0;
  const above50Pct = valid.length ? (valid.filter(f => f.close > f.sma50).length / valid.length) * 100 : 0;
  const advancersPct = valid.length ? (valid.filter(f => Number(f.return1) > 0).length / valid.length) * 100 : 0;
  const medianReturn20 = median(valid.map(f => f.return20)) || 0;
  const medianAtrPct = median(valid.map(f => f.atrPct)) || 0;
  let code = 'BALANCED';
  let labelAr = 'سوق متوازن/جانبي';
  if (medianAtrPct >= 5.5) { code = 'HIGH_VOLATILITY'; labelAr = 'تذبذب مرتفع'; }
  else if (above50Pct >= 55 && above20Pct >= 55 && advancersPct >= 50 && medianReturn20 > 0) { code = 'BULLISH'; labelAr = 'اتجاه سوق صاعد'; }
  else if (above50Pct <= 40 && above20Pct <= 40 && advancersPct < 45 && medianReturn20 < 0) { code = 'BEARISH'; labelAr = 'اتجاه سوق هابط'; }
  return {
    code,
    labelAr,
    basedOn: 'equal-weight market breadth proxy from stored daily histories',
    symbolsMeasured: valid.length,
    aboveSma20Pct: round(above20Pct, 2),
    aboveSma50Pct: round(above50Pct, 2),
    advancersPct: round(advancersPct, 2),
    medianReturn20Pct: round(medianReturn20, 3),
    medianAtrPct: round(medianAtrPct, 3)
  };
}

function eligibilityMap(raw, symbolMap) {
  const map = new Map();
  for (const item of raw?.items || []) map.set(safeTicker(item.ticker), item);
  for (const item of mapEntries(symbolMap)) {
    const ticker = safeTicker(item.ticker);
    if (!ticker || map.has(ticker)) continue;
    map.set(ticker, {
      ticker,
      active: item.active !== false && item.excludeFromDecision !== true,
      delisted: item.instrumentStatus === 'delisted',
      status: 'fallback_from_symbol_map',
      decisionEligible: false,
      paperTradingEligible: false,
      confidence: 0,
      companyNameAr: item.companyNameAr || item.nameAr || null,
      companyNameEn: item.companyNameEn || item.nameEn || null,
      sector: item.sector || item.sectorName || item.sectorAr || null
    });
  }
  return map;
}

function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(POLICY_PATH, null);
  if (!policy) throw new Error('Missing data/v13-4-quant-policy.json');
  if (!fs.existsSync(HISTORY_DIR)) throw new Error('Missing data/history directory');

  const symbolMap = readJson(SYMBOL_MAP_PATH, {});
  const eligibilityRaw = readJson(ELIGIBILITY_PATH, { items: [] });
  const summary = readJson(SUMMARY_PATH, {});
  const eligibility = eligibilityMap(eligibilityRaw, symbolMap);
  const blockedTickers = new Set(policy.safety.blockedTickers.map(safeTicker));
  const blockedStatuses = new Set(policy.safety.blockedEligibilityStatuses || []);

  const histories = new Map();
  const metadata = new Map();
  for (const file of fs.readdirSync(HISTORY_DIR).filter(name => name.endsWith('.json'))) {
    const ticker = safeTicker(path.basename(file, '.json'));
    if (!ticker) continue;
    const raw = readJson(path.join(HISTORY_DIR, file), null);
    const rows = normalizeHistory(raw);
    if (rows.length < Number(policy.research.minimumHistorySessions)) continue;
    histories.set(ticker, rows);
    const mapItem = mapEntries(symbolMap).find(item => safeTicker(item.ticker) === ticker) || {};
    const elig = eligibility.get(ticker) || {};
    metadata.set(ticker, {
      ticker,
      companyNameAr: elig.companyNameAr || mapItem.companyNameAr || mapItem.nameAr || null,
      companyNameEn: elig.companyNameEn || mapItem.companyNameEn || mapItem.nameEn || null,
      sector: elig.sector || mapItem.sector || mapItem.sectorName || mapItem.sectorAr || null,
      eligibility: elig,
      historyConfidence: Number(raw?.averageConfidence || elig.confidence || 0),
      sessions: rows.length
    });
  }
  if (!histories.size) throw new Error('No valid histories with sufficient sessions');

  const proxy = buildMarketProxy(histories);
  const featuresByTicker = new Map();
  const allDates = new Set();
  for (const [ticker, rows] of histories) {
    const features = prepareIndicators(rows, proxy);
    featuresByTicker.set(ticker, features);
    for (const f of features) allDates.add(f.date);
  }
  const orderedDates = [...allDates].sort(compareDates);
  const latestSession = dateOnly(summary.latestMarketSession) || orderedDates.at(-1);

  const latestFeatureRows = [];
  const featureStoreSymbols = [];
  for (const [ticker, features] of featuresByTicker) {
    const latest = features.filter(f => compareDates(f.date, latestSession) <= 0).at(-1);
    if (!latest) continue;
    latestFeatureRows.push(latest);
    const meta = metadata.get(ticker);
    featureStoreSymbols.push({
      ticker,
      companyNameAr: meta.companyNameAr,
      companyNameEn: meta.companyNameEn,
      sector: meta.sector,
      sessions: meta.sessions,
      lastSession: latest.date,
      historyConfidence: round(meta.historyConfidence, 2),
      eligibilityStatus: meta.eligibility.status || 'unknown',
      decisionEligible: meta.eligibility.decisionEligible === true,
      paperTradingEligible: meta.eligibility.paperTradingEligible === true,
      latest: Object.fromEntries(Object.entries(latest).filter(([key]) => key !== 'index').map(([key, value]) => [key, round(value, 4)]))
    });
  }
  const regime = buildRegime(latestFeatureRows);

  const tradesByStrategyVariant = {};
  const strategySummaries = [];
  for (const [strategyId, strategy] of Object.entries(policy.strategies)) {
    tradesByStrategyVariant[strategyId] = {};
    for (const variant of strategy.variants) {
      const trades = [];
      for (const [ticker, rows] of histories) {
        const meta = metadata.get(ticker);
        if (blockedTickers.has(ticker) || meta.eligibility.active === false || meta.eligibility.delisted === true || blockedStatuses.has(meta.eligibility.status)) continue;
        const features = featuresByTicker.get(ticker);
        let i = Number(policy.research.featureWarmupSessions);
        while (i < rows.length - 1) {
          const feature = features[i];
          const evaluation = strategyEvaluation(strategyId, variant, feature, policy);
          if (!evaluation.passed) { i += 1; continue; }
          const plan = tradePlan(feature, strategyId, policy);
          const trade = simulateTrade(rows, i, plan, policy, {
            ticker,
            strategyId,
            strategyLabelAr: strategy.labelAr,
            variantId: variant.id,
            signalScore: evaluation.score
          });
          if (trade) {
            trades.push(trade);
            const exitIndex = rows.findIndex(r => r.date === trade.exitDate);
            i = Math.max(i + 1, exitIndex + 1);
          } else i += 1;
        }
      }
      const m = metrics(trades);
      tradesByStrategyVariant[strategyId][variant.id] = trades;
      strategySummaries.push({
        strategyId,
        strategyLabelAr: strategy.labelAr,
        variantId: variant.id,
        metrics: m,
        sampleTrades: trades.slice(-25)
      });
    }
  }

  const folds = [];
  const minTrain = Number(policy.research.walkForwardMinimumTrainingSessions);
  const blockSize = Number(policy.research.walkForwardValidationSessions);
  for (let trainEndIndex = minTrain - 1; trainEndIndex < orderedDates.length - 1; trainEndIndex += blockSize) {
    const testStartIndex = trainEndIndex + 1;
    const testEndIndex = Math.min(orderedDates.length - 1, testStartIndex + blockSize - 1);
    if (testStartIndex > testEndIndex) break;
    const fold = {
      fold: folds.length + 1,
      trainStart: orderedDates[0],
      trainEnd: orderedDates[trainEndIndex],
      testStart: orderedDates[testStartIndex],
      testEnd: orderedDates[testEndIndex],
      selections: []
    };
    for (const [strategyId, strategy] of Object.entries(policy.strategies)) {
      let selected = null;
      for (const variant of strategy.variants) {
        const allTrades = tradesByStrategyVariant[strategyId][variant.id] || [];
        const trainingTrades = allTrades.filter(t => t.signalDate <= fold.trainEnd && t.exitDate <= fold.trainEnd);
        const m = metrics(trainingTrades);
        const eligibleCount = m.closedTrades >= Number(policy.research.minimumTrainingTradesPerVariant);
        const score = eligibleCount ? trainingScore(m) : -9999;
        if (!selected || score > selected.trainingScore) selected = { variantId: variant.id, trainingMetrics: m, trainingScore: score, eligibleCount };
      }
      const selectedTrades = selected ? tradesByStrategyVariant[strategyId][selected.variantId] || [] : [];
      const validationTrades = selectedTrades.filter(t => t.signalDate >= fold.testStart && t.signalDate <= fold.testEnd);
      fold.selections.push({
        strategyId,
        strategyLabelAr: strategy.labelAr,
        selectedVariantId: selected?.variantId || null,
        trainingEligible: selected?.eligibleCount || false,
        trainingScore: round(selected?.trainingScore, 3),
        trainingMetrics: selected?.trainingMetrics || metrics([]),
        validationMetrics: metrics(validationTrades),
        validationTrades
      });
    }
    folds.push(fold);
  }

  const modelStrategies = [];
  for (const [strategyId, strategy] of Object.entries(policy.strategies)) {
    const selections = folds.map(f => f.selections.find(s => s.strategyId === strategyId)).filter(Boolean);
    const validationTrades = selections.flatMap(s => s.validationTrades || []);
    const validationMetrics = metrics(validationTrades);
    const variantFrequency = new Map();
    for (const s of selections) if (s.selectedVariantId) variantFrequency.set(s.selectedVariantId, (variantFrequency.get(s.selectedVariantId) || 0) + 1);
    const selectedVariantId = [...variantFrequency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || strategy.variants[0].id;
    const researchValidated = validationMetrics.closedTrades >= Number(policy.validation.researchMinimumTrades)
      && validationMetrics.profitFactor >= Number(policy.validation.researchMinimumProfitFactor)
      && validationMetrics.averageR > Number(policy.validation.researchMinimumAverageR)
      && validationMetrics.maxDrawdownPct <= Number(policy.validation.researchMaximumDrawdownPct);
    const productionEligible = validationMetrics.closedTrades >= Number(policy.validation.productionMinimumTrades)
      && validationMetrics.profitFactor >= Number(policy.validation.productionMinimumProfitFactor)
      && validationMetrics.averageR >= Number(policy.validation.productionMinimumAverageR)
      && validationMetrics.maxDrawdownPct <= Number(policy.validation.productionMaximumDrawdownPct);
    modelStrategies.push({
      strategyId,
      strategyLabelAr: strategy.labelAr,
      selectedVariantId,
      selectedVariant: strategy.variants.find(v => v.id === selectedVariantId),
      folds: selections.length,
      validationMetrics,
      researchValidated,
      productionEligible,
      status: productionEligible ? 'PRODUCTION_PAPER_ELIGIBLE' : researchValidated ? 'RESEARCH_VALIDATED' : 'RESEARCH_ONLY'
    });
  }

  const paperCandidates = [];
  const watchCandidates = [];
  const rejectionCounts = new Map();
  const latestAnalyses = [];
  const gateTraceV139 = [];
  const bearishBlock = policy.recommendations.blockPaperCandidatesInBearishRegime && regime.code === 'BEARISH';
  const volatilityBlock = policy.recommendations.blockPaperCandidatesInHighVolatilityRegime && regime.code === 'HIGH_VOLATILITY';

  for (const [ticker, features] of featuresByTicker) {
    const meta = metadata.get(ticker);
    const feature = features.filter(f => f.date === latestSession).at(-1);
    if (!feature) {
      rejectionCounts.set('history_not_fresh_to_latest_session', (rejectionCounts.get('history_not_fresh_to_latest_session') || 0) + 1);
      gateTraceV139.push({
        ticker,
        companyNameAr: meta.companyNameAr,
        companyNameEn: meta.companyNameEn,
        sector: meta.sector,
        sessionId: latestSession,
        stage: 'HARD_REJECT',
        failedGate: 'history_freshness',
        failedGateLabelAr: 'التاريخ غير محدث حتى آخر جلسة',
        historySessions: meta.sessions,
        eligibilityStatus: meta.eligibility.status || 'unknown'
      });
      continue;
    }
    if (blockedTickers.has(ticker) || meta.eligibility.active === false || meta.eligibility.delisted === true || blockedStatuses.has(meta.eligibility.status)) {
      rejectionCounts.set('blocked_by_safety_eligibility', (rejectionCounts.get('blocked_by_safety_eligibility') || 0) + 1);
      gateTraceV139.push({
        ticker,
        companyNameAr: meta.companyNameAr,
        companyNameEn: meta.companyNameEn,
        sector: meta.sector,
        sessionId: latestSession,
        stage: 'HARD_REJECT',
        failedGate: 'safety_eligibility',
        failedGateLabelAr: 'محجوب بواسطة الأهلية أو السلامة',
        historySessions: meta.sessions,
        eligibilityStatus: meta.eligibility.status || 'unknown',
        decisionEligible: meta.eligibility.decisionEligible === true
      });
      continue;
    }
    if (meta.sessions < Number(policy.research.minimumDecisionSessions)) {
      rejectionCounts.set('history_below_decision_minimum', (rejectionCounts.get('history_below_decision_minimum') || 0) + 1);
      gateTraceV139.push({
        ticker,
        companyNameAr: meta.companyNameAr,
        companyNameEn: meta.companyNameEn,
        sector: meta.sector,
        sessionId: latestSession,
        stage: 'HARD_REJECT',
        failedGate: 'minimum_history',
        failedGateLabelAr: 'عدد الجلسات أقل من حد القرار',
        historySessions: meta.sessions,
        requiredHistorySessions: Number(policy.research.minimumDecisionSessions),
        eligibilityStatus: meta.eligibility.status || 'unknown'
      });
      continue;
    }

    let best = null;
    for (const model of modelStrategies) {
      const evaluation = strategyEvaluation(model.strategyId, model.selectedVariant, feature, policy);
      const robustness = model.productionEligible ? 12 : model.researchValidated ? 6 : 0;
      const regimeAdjustment = regime.code === 'BULLISH' ? 5 : regime.code === 'BEARISH' ? -10 : regime.code === 'HIGH_VOLATILITY' ? -12 : 0;
      const qualityAdjustment = clamp((meta.historyConfidence - 65) / 5, -5, 7);
      const recommendationScore = round(clamp(evaluation.score + robustness + regimeAdjustment + qualityAdjustment), 1);
      const candidate = { model, evaluation, recommendationScore };
      if (!best || candidate.recommendationScore > best.recommendationScore) best = candidate;
    }
    if (!best) continue;

    const plan = tradePlan(feature, best.model.strategyId, policy);
    const eligibilityDecision = meta.eligibility.decisionEligible === true || meta.eligibility.status === 'fallback_from_symbol_map';
    const regimeAllowed = !bearishBlock && !volatilityBlock;
    const scorePaperPass = best.recommendationScore >= Number(policy.recommendations.minimumPaperScore);
    const scoreWatchPass = best.recommendationScore >= Number(policy.recommendations.minimumWatchScore);
    const paperAllowed = best.evaluation.passed
      && best.model.researchValidated
      && eligibilityDecision
      && regimeAllowed
      && scorePaperPass;
    const status = paperAllowed ? 'PAPER_CANDIDATE' : 'WATCH_CONDITIONAL';
    const item = {
      ticker,
      companyNameAr: meta.companyNameAr,
      companyNameEn: meta.companyNameEn,
      sector: meta.sector,
      signalDate: latestSession,
      status,
      statusLabelAr: paperAllowed ? 'مرشح تداول ورقي' : 'مراقبة مشروطة',
      strategyId: best.model.strategyId,
      strategyLabelAr: best.model.strategyLabelAr,
      variantId: best.model.selectedVariantId,
      recommendationScore: best.recommendationScore,
      rawSignalScore: best.evaluation.score,
      strategyValidationStatus: best.model.status,
      marketRegime: regime.code,
      price: round(feature.close, 4),
      plan,
      indicators: {
        return5Pct: round(feature.return5, 3),
        return20Pct: round(feature.return20, 3),
        relativeStrength20Pct: round(feature.relativeStrength20, 3),
        rsi14: round(feature.rsi14, 2),
        atrPct: round(feature.atrPct, 3),
        volumeRatio20: round(feature.volumeRatio20, 3),
        averageTurnover20Egp: round(feature.avgTurnover20, 0),
        sma20: round(feature.sma20, 4),
        sma50: round(feature.sma50, 4),
        support20: round(feature.support20, 4),
        resistance20: round(feature.resistance20, 4)
      },
      dataQuality: {
        historySessions: meta.sessions,
        historyConfidence: round(meta.historyConfidence, 2),
        eligibilityStatus: meta.eligibility.status || 'unknown',
        latestHistorySession: feature.date
      },
      passedConditions: best.evaluation.conditions.filter(c => c.pass).map(c => c.labelAr),
      failedConditions: best.evaluation.failedConditions,
      reasonAr: paperAllowed
        ? `اجتاز نموذج ${best.model.strategyLabelAr} واختبار Walk-Forward البحثي ضمن سوق ${regime.labelAr}.`
        : best.evaluation.passed
          ? `الإشارة الفنية متحققة، لكنها بقيت للمراقبة بسبب حالة النموذج أو السوق أو الأهلية.`
          : `أقرب نموذج حالي هو ${best.model.strategyLabelAr}، لكن بعض الشروط لم تكتمل.`
    };
    latestAnalyses.push(item);
    gateTraceV139.push({
      ticker,
      companyNameAr: meta.companyNameAr,
      companyNameEn: meta.companyNameEn,
      sector: meta.sector,
      sessionId: latestSession,
      stage: paperAllowed ? 'STRICT_PAPER' : best.evaluation.passed ? 'SIGNAL_PASSED_BUT_GATED' : 'SIGNAL_CONDITIONS_FAILED',
      strictPaperAllowed: paperAllowed,
      signalPassed: best.evaluation.passed,
      failedConditionCount: best.evaluation.failedConditions.length,
      conditions: best.evaluation.conditions,
      failedConditions: best.evaluation.failedConditions,
      strategyId: best.model.strategyId,
      strategyLabelAr: best.model.strategyLabelAr,
      variantId: best.model.selectedVariantId,
      strategyValidationStatus: best.model.status,
      strategyResearchValidated: best.model.researchValidated,
      strategyProductionEligible: best.model.productionEligible,
      strategyValidationMetrics: best.model.validationMetrics,
      recommendationScore: best.recommendationScore,
      rawSignalScore: best.evaluation.score,
      eligibilityDecision,
      eligibilityStatus: meta.eligibility.status || 'unknown',
      regimeAllowed,
      bearishBlock,
      volatilityBlock,
      marketRegime: regime.code,
      scorePaperPass,
      scoreWatchPass,
      historySessions: meta.sessions,
      historyConfidence: round(meta.historyConfidence, 2),
      price: round(feature.close, 4),
      plan,
      indicators: item.indicators,
      status,
      statusLabelAr: item.statusLabelAr
    });
    if (paperAllowed) paperCandidates.push(item);
    else if (best.recommendationScore >= Number(policy.recommendations.minimumWatchScore)) watchCandidates.push(item);
    else rejectionCounts.set('score_below_watch_threshold', (rejectionCounts.get('score_below_watch_threshold') || 0) + 1);
  }

  paperCandidates.sort((a, b) => b.recommendationScore - a.recommendationScore || a.ticker.localeCompare(b.ticker));
  watchCandidates.sort((a, b) => b.recommendationScore - a.recommendationScore || a.ticker.localeCompare(b.ticker));
  const finalPaper = paperCandidates.slice(0, Number(policy.recommendations.maximumPaperCandidates));
  const finalWatch = watchCandidates.slice(0, Number(policy.recommendations.maximumWatchCandidates));

  const featureStore = {
    schemaVersion: '13.4.0',
    generatedAt,
    latestMarketSession: latestSession,
    noLookahead: true,
    symbolsAnalyzed: featureStoreSymbols.length,
    featureDefinitions: {
      returns: ['1', '3', '5', '10', '20 sessions'],
      trend: ['SMA5', 'SMA10', 'SMA20', 'SMA50', 'EMA9', 'EMA21'],
      momentum: ['RSI14', 'MACD 12/26/9'],
      risk: ['ATR14', 'ATR%'],
      liquidity: ['average volume 20', 'volume ratio 20', 'average turnover 20'],
      levels: ['support 20', 'resistance 20'],
      relativeStrength: 'stock return 20 minus equal-weight market breadth proxy return 20'
    },
    symbols: featureStoreSymbols.sort((a, b) => a.ticker.localeCompare(b.ticker))
  };

  const backtests = {
    schemaVersion: '13.4.0',
    generatedAt,
    latestMarketSession: latestSession,
    assumptions: {
      signalTiming: 'after_close',
      entryTiming: 'next_session_open_plus_slippage',
      entrySlippagePct: policy.research.entrySlippagePct,
      roundTripCostPct: policy.research.roundTripCostPct,
      maximumHoldingSessions: policy.research.maximumHoldingSessions,
      sameBarConflictRule: policy.research.sameBarConflictRule,
      overlappingTrades: 'prevented per ticker/strategy/variant',
      noLookahead: true
    },
    strategies: strategySummaries
  };

  const walkForward = {
    schemaVersion: '13.4.0',
    generatedAt,
    methodology: 'anchored expanding-window walk-forward; parameters selected on past trades only and evaluated on the next chronological block',
    minimumTrainingSessions: minTrain,
    validationBlockSessions: blockSize,
    folds,
    strategyValidation: modelStrategies
  };

  const model = {
    schemaVersion: '13.4.0',
    generatedAt,
    latestMarketSession: latestSession,
    liveExecutionEnabled: false,
    recommendationMode: 'NEXT_SESSION_AND_3_TO_10_SESSION_SWING_PAPER_ONLY',
    marketRegime: regime,
    strategies: modelStrategies,
    promotionRules: policy.validation,
    warningAr: 'النتائج تاريخية وورقية ولا تضمن أرباحًا مستقبلية. لا يوجد تنفيذ حقيقي.'
  };

  const recommendations = {
    schemaVersion: '13.4.0',
    generatedAt,
    sessionId: latestSession,
    liveExecutionEnabled: false,
    status: finalPaper.length ? 'PAPER_CANDIDATES_AVAILABLE' : 'WATCH_ONLY',
    statusLabelAr: finalPaper.length ? 'مرشحو تداول ورقي متاحون' : 'مراقبة فقط',
    marketRegime: regime,
    counts: {
      symbolsAnalyzed: featureStoreSymbols.length,
      latestEligibleAnalyses: latestAnalyses.length,
      paperCandidates: finalPaper.length,
      watchCandidates: finalWatch.length,
      blockedOrRejected: [...rejectionCounts.values()].reduce((a, b) => a + b, 0)
    },
    paperCandidates: finalPaper,
    watchCandidates: finalWatch,
    executionRules: {
      actualTrading: false,
      entryStartsNextSession: true,
      validEntrySessions: policy.recommendations.validEntrySessions,
      maximumHoldingSessions: policy.research.maximumHoldingSessions,
      sameBarConflictRule: policy.research.sameBarConflictRule,
      costsIncludedPct: policy.research.roundTripCostPct
    },
    warningAr: 'هذه مخرجات بحث وتداول ورقي، وليست ضمانًا للنجاح أو أمر شراء فعلي.'
  };

  const audit = {
    schemaVersion: '13.4.0',
    generatedAt,
    latestMarketSession: latestSession,
    controls: {
      noLookahead: true,
      chronologicalWalkForward: true,
      futureDataAtSignal: false,
      sameBarConflictRule: 'stop_first',
      costsIncluded: true,
      liveExecutionEnabled: false,
      retroactiveSignalEditing: false
    },
    universe: {
      historyFilesRead: fs.readdirSync(HISTORY_DIR).filter(name => name.endsWith('.json')).length,
      historiesAccepted: histories.size,
      featuresBuilt: featureStoreSymbols.length,
      latestAnalyses: latestAnalyses.length
    },
    blockedTickers: [...blockedTickers],
    rejectionSummary: [...rejectionCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    paperCandidateTickers: finalPaper.map(item => item.ticker),
    watchCandidateTickers: finalWatch.map(item => item.ticker),
    modelStatuses: modelStrategies.map(s => ({ strategyId: s.strategyId, status: s.status, validationMetrics: s.validationMetrics }))
  };

  writeJsonAtomic(OUTPUTS.featureStore, featureStore);
  writeJsonAtomic(OUTPUTS.marketRegime, { schemaVersion: '13.4.0', generatedAt, latestMarketSession: latestSession, ...regime });
  writeJsonAtomic(OUTPUTS.backtests, backtests);
  writeJsonAtomic(OUTPUTS.walkForward, walkForward);
  writeJsonAtomic(OUTPUTS.model, model);
  writeJsonAtomic(OUTPUTS.recommendations, recommendations);
  writeJsonAtomic(OUTPUTS.audit, audit);
  writeJsonAtomic(OUTPUTS.gateTraceV139, {
    schemaVersion: '13.9.0',
    generatedAt,
    latestMarketSession: latestSession,
    drawdownMethod: 'compounded_equity_peak_to_trough',
    productionPolicyUnchanged: true,
    rows: gateTraceV139.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))
  });

  console.log(`V13.4 histories accepted: ${histories.size}`);
  console.log(`V13.4 latest session: ${latestSession}`);
  console.log(`V13.4 regime: ${regime.code}`);
  console.log(`V13.4 paper candidates: ${finalPaper.length}`);
  console.log(`V13.4 watch candidates: ${finalWatch.length}`);
}

try { main(); }
catch (error) {
  console.error(`V13.4 quant engine failed: ${error.stack || error.message}`);
  process.exit(1);
}
