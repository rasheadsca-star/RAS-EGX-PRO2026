#!/usr/bin/env node
'use strict';

/**
 * EGX Pro Unified GOAL V12.1 Safe Preview
 * - Reads the existing PRO2026 outputs without replacing the existing engines.
 * - Applies fail-closed stock gates.
 * - Maintains a persistent paper-trading ledger.
 * - Produces one UI-ready decision file.
 * - Writes ONLY inside preview-v12/data. It never edits index.html or service-worker.js.
 *
 * No third-party packages are required.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PREVIEW_DIR = path.join(ROOT, 'preview-v12');
const PREVIEW_DATA_DIR = path.join(PREVIEW_DIR, 'data');
const VERSION = '12.1.0';
const OUTPUT_FILE = path.join(PREVIEW_DATA_DIR, 'unified-goal-v12.json');
const LEDGER_FILE = path.join(PREVIEW_DATA_DIR, 'paper-ledger.json');
const CONFIG_FILE = path.join(PREVIEW_DIR, 'config', 'decision-gates.json');

const DEFAULT_CONFIG = Object.freeze({
  minimumHistoryLive: 50,
  minimumHistoryPaper: 20,
  minimumTurnoverEgp: 1_000_000,
  minimumLiquidityScore: 60,
  minimumDataQualityLive: 75,
  minimumDataQualityPaper: 65,
  minimumConfidenceLive: 70,
  minimumConfidencePaper: 60,
  minimumSourceStrength: 70,
  minimumRiskRewardLive: 1.5,
  minimumRiskRewardPaper: 1.25,
  maximumPriceAgeHours: 96,
  maximumStrongPriceAgeHours: 36,
  maximumSourceDifferencePct: 1.5,
  maximumEntryDistancePct: 8,
  minimumStopDistancePct: 1,
  maximumStopDistancePct: 12,
  minimumTargetUpsidePct: 2,
  maximumTargetUpsidePct: 25,
  maximumAbsoluteDailyChangePct: 20,
  maximumPaperCandidatesPerSession: 5,
  paperPendingExpirySessions: 5,
  paperTimeExitSessions: 10,
  paperRoundTripCostPct: 0.4,
  goLiveMinimumClosedTrades: 50,
  goLiveMinimumWinRatePct: 50,
  goLiveMinimumProfitFactor: 1.2,
  goLiveMaximumDrawdownPct: 10,
  goLiveMinimumHistoryCoveragePct: 95,
  goLiveMinimumLevelsCoveragePct: 90,
  goLiveMinimumPriceCoveragePct: 95
});
let CONFIG = { ...DEFAULT_CONFIG };

const SOURCE_CANDIDATES = [
  'data/final-opportunity-ranking.json',
  'data/final-multisource-ranking.json',
  'data/unified-decision-board.json',
  'data/actionable-watchlist.json',
  'data/market.json',
  'market.json',
  'data/full-market-cache.json'
];

const ENRICHMENT_CANDIDATES = [
  'data/full-market-cache.json',
  'data/market.json',
  'market.json',
  'data/final-multisource-ranking.json',
  'data/actionable-watchlist.json',
  'data/unified-decision-board.json',
  'data/liquidity-monitor.json',
  'data/support-resistance.json'
];

function exists(file) {
  try { return fs.existsSync(path.join(ROOT, file)); } catch { return false; }
}

function readJson(file, fallback = null) {
  try {
    const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
    return JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function n(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    value = value.replace(/,/g, '').replace(/%/g, '').trim();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value, min)));
}

function round(value, digits = 2) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isFinite(Number(value))) return null;
  const f = 10 ** digits;
  return Math.round(Number(value) * f) / f;
}

function pctScore(value, fallback = 0) {
  let parsed = n(value, fallback);
  if (parsed === null) parsed = fallback;
  if (parsed > 0 && parsed <= 1) parsed *= 100;
  return clamp(parsed, 0, 100);
}

function first(obj, aliases, fallback = null) {
  for (const alias of aliases) {
    const parts = alias.split('.');
    let cursor = obj;
    let ok = true;
    for (const part of parts) {
      if (cursor && Object.prototype.hasOwnProperty.call(cursor, part)) cursor = cursor[part];
      else { ok = false; break; }
    }
    if (ok && cursor !== null && cursor !== undefined && cursor !== '') return cursor;
  }
  return fallback;
}

function stripMarkup(value) {
  const text = String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:M|L|C|H|V|S|Q|T|A|Z)\s*-?\d+(?:\.\d+)?(?:[\s,]+-?\d+(?:\.\d+)?){2,}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
}

function symbolOf(obj, fallback = '') {
  return stripMarkup(first(obj, [
    'symbol', 'ticker', 'code', 'stockSymbol', 'stock_code', 'symbolCode',
    'instrument.symbol', 'security.symbol', 'meta.symbol'
  ], fallback)).toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function looksLikeStockRow(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const symbol = symbolOf(obj);
  const price = n(first(obj, ['price', 'lastPrice', 'last', 'close', 'currentPrice', 'marketPrice', 'last_price']));
  return Boolean(symbol) && (price !== null || first(obj, ['signal', 'recommendation', 'decision', 'score', 'finalScore']) !== null);
}

function arrayScore(arr) {
  if (!Array.isArray(arr) || !arr.length) return -1;
  const sample = arr.slice(0, 30);
  const stocks = sample.filter(looksLikeStockRow).length;
  return stocks * 100 + Math.min(arr.length, 500);
}

function extractBestRows(input) {
  if (Array.isArray(input) && arrayScore(input) > 0) return input;
  const preferred = [
    'rows', 'ranking', 'items', 'opportunities', 'stocks', 'results', 'candidates',
    'recommendations', 'records', 'universe', 'data', 'list', 'topOpportunities'
  ];
  let best = [];
  let bestScore = -1;
  const seen = new Set();

  function walk(node, depth) {
    if (!node || depth > 5 || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const score = arrayScore(node);
      if (score > bestScore) { best = node; bestScore = score; }
      for (const item of node.slice(0, 20)) walk(item, depth + 1);
      return;
    }
    for (const key of preferred) {
      if (Array.isArray(node[key])) {
        const score = arrayScore(node[key]) + 20;
        if (score > bestScore) { best = node[key]; bestScore = score; }
      }
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  }
  walk(input, 0);
  return bestScore > 0 ? best : [];
}


function collectStockRows(input, maxRows = 5000) {
  const out = [];
  const seen = new Set();
  function walk(node, keyHint = '', depth = 0) {
    if (!node || depth > 8 || typeof node !== 'object' || seen.has(node) || out.length >= maxRows) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, '', depth + 1);
      return;
    }
    const fallbackSymbol = /^[A-Z0-9.-]{2,15}$/i.test(keyHint) ? keyHint : '';
    const candidate = fallbackSymbol && !symbolOf(node) ? { symbol: fallbackSymbol, ...node } : node;
    if (looksLikeStockRow(candidate)) out.push(candidate);
    for (const [key, value] of Object.entries(node)) walk(value, key, depth + 1);
  }
  walk(input);
  return out;
}

function detectSource() {
  for (const file of SOURCE_CANDIDATES) {
    if (!exists(file)) continue;
    const json = readJson(file);
    let rows = extractBestRows(json);
    if (!rows.length) rows = collectStockRows(json);
    if (rows.length) return { file, json, rows };
  }
  return { file: null, json: {}, rows: [] };
}


function mergeMissing(base, extra) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(extra || {})) {
    const current = out[key];
    if ((current === null || current === undefined || current === '') && value !== null && value !== undefined && value !== '') {
      out[key] = value;
    }
  }
  return out;
}

function buildEnrichmentMap(primaryFile) {
  const map = new Map();
  for (const file of ENRICHMENT_CANDIDATES) {
    if (file === primaryFile || !exists(file)) continue;
    const json = readJson(file);
    const primaryRows = extractBestRows(json);
    const rows = [...primaryRows, ...collectStockRows(json)].slice(0, 10000);
    for (const row of rows) {
      const symbol = symbolOf(row);
      if (!symbol) continue;
      map.set(symbol, mergeMissing(map.get(symbol), row));
    }
  }
  return map;
}

function fileMtimeIso(relativeFile) {
  try { return fs.statSync(path.join(ROOT, relativeFile)).mtime.toISOString(); } catch { return null; }
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hoursOld(iso, now) {
  if (!iso) return null;
  return round((now.getTime() - new Date(iso).getTime()) / 3_600_000, 1);
}

function recursiveHistoryMap() {
  const files = [
    'data/history-integrity-v2.json', 'data/history-health.json', 'data/history-50.json',
    'data/history-report.json', 'data/history-integrity-report.json', 'data/history-indicators.json'
  ];
  const map = new Map();
  const seen = new Set();

  function set(symbol, count) {
    symbol = String(symbol || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
    count = n(count, 0);
    if (!symbol || count <= 0) return;
    map.set(symbol, Math.max(map.get(symbol) || 0, count));
  }

  function walk(node, keyHint = '', depth = 0) {
    if (!node || depth > 7 || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      if (/^[A-Z0-9.-]{2,15}$/.test(keyHint) && node.length && typeof node[0] === 'object') set(keyHint, node.length);
      for (const item of node) walk(item, '', depth + 1);
      return;
    }
    const symbol = symbolOf(node, /^[A-Z0-9.-]{2,15}$/.test(keyHint) ? keyHint : '');
    const directCount = first(node, [
      'validSessions', 'sessionCount', 'sessionsCount', 'historyLength', 'barsCount',
      'pointsCount', 'tradingSessions', 'sessions', 'count'
    ]);
    const arrays = ['bars', 'candles', 'prices', 'history', 'series', 'records', 'sessions'];
    let arrayCount = 0;
    for (const key of arrays) if (Array.isArray(node[key])) arrayCount = Math.max(arrayCount, node[key].length);
    if (symbol) set(symbol, Math.max(n(directCount, 0), arrayCount));
    for (const [key, value] of Object.entries(node)) walk(value, key, depth + 1);
  }

  for (const file of files) {
    const json = readJson(file);
    if (json) walk(json);
  }
  return map;
}

function sourceTimestamp(source) {
  return isoOrNull(first(source.json, [
    'generatedAt', 'updatedAt', 'lastUpdated', 'asOf', 'timestamp', 'meta.generatedAt',
    'meta.updatedAt', 'summary.generatedAt', 'snapshot.generatedAt'
  ])) || fileMtimeIso(source.file || '');
}

function gate(id, label, pass, detail, weight = 1) {
  return { id, label, pass: Boolean(pass), detail: String(detail || ''), weight };
}

function normalizeRow(raw, index, historyMap, sourceUpdatedAt, now) {
  const symbol = symbolOf(raw, `ROW${index + 1}`);
  const name = stripMarkup(first(raw, ['name', 'nameAr', 'companyName', 'company', 'securityName', 'arabicName'], ''));
  const price = n(first(raw, ['price', 'lastPrice', 'last', 'close', 'currentPrice', 'marketPrice', 'last_price']));
  const rawHigh = n(first(raw, ['high', 'dayHigh', 'sessionHigh', 'highPrice', 'ohlc.high', 'today.high']));
  const rawLow = n(first(raw, ['low', 'dayLow', 'sessionLow', 'lowPrice', 'ohlc.low', 'today.low']));
  const validOhlc = rawHigh !== null && rawLow !== null && rawHigh >= rawLow
    && (price === null || (rawLow <= price && price <= rawHigh));
  const sessionHigh = validOhlc ? rawHigh : null;
  const sessionLow = validOhlc ? rawLow : null;
  const changePct = n(first(raw, ['changePct', 'changePercent', 'change_percentage', 'pctChange', 'dailyChangePct', 'change']));
  const volume = n(first(raw, ['volume', 'tradedVolume', 'tradeVolume', 'quantity', 'totalVolume']), 0);
  const turnover = n(first(raw, [
    'turnover', 'tradedValue', 'valueTraded', 'traded_value', 'value', 'tradeValue',
    'liquidityValue', 'totalValue', 'turnoverValue', 'averageTurnover20', 'avgTurnover20',
    'averageDailyValue', 'avgValue', 'liquidity.turnover'
  ]), 0);
  const liquidityScore = pctScore(first(raw, ['liquidityScore', 'liquidity.score', 'scores.liquidity', 'liquidityGrade', 'liquidity'], 0));
  const confidence = pctScore(first(raw, [
    'targetProbability', 'finalConfidence', 'confidence', 'confidenceScore',
    'scores.confidence', 'probability', 'finalScore'
  ], 0));
  const dataQuality = pctScore(first(raw, [
    'dataQualityScore', 'dataQuality', 'qualityScore', 'scores.quality', 'quality',
    'safetyGovernorScore', 'coverageScore'
  ], 0));
  const sourceStrength = pctScore(first(raw, [
    'sourceStrengthScore', 'sourceStrength', 'sourceScore', 'scores.source',
    'priceTruthScore', 'sourceConfidence'
  ], 0));
  const sourceCount = n(first(raw, [
    'sourceConfirmationCount', 'sourceCount', 'sourcesCount', 'evidence.sourceCount',
    'priceSources.length', 'confirmationCount'
  ]), 0);
  const sourceDifferencePct = n(first(raw, ['sourceDifferencePct', 'priceDifferencePct', 'reconciliation.differencePct', 'priceTruth.differencePct']));
  const sourceDecision = stripMarkup(first(raw, ['sourceEvidenceDecision', 'priceState', 'coverageStatus', 'safetyGovernorStatus'], ''));

  const support1 = n(first(raw, ['support1', 'support', 'levels.support1', 'technical.support1', 's1']));
  const resistance1 = n(first(raw, ['resistance1', 'resistance', 'levels.resistance1', 'technical.resistance1', 'r1']));
  const pivot = n(first(raw, ['pivot', 'pivotPoint', 'levels.pivot', 'technical.pivot']));

  let entryLow = n(first(raw, ['entryLow', 'entryFrom', 'entryMin', 'tradePlan.entryLow', 'plan.entryLow', 'buyFrom']));
  let entryHigh = n(first(raw, ['entryHigh', 'entryTo', 'entryMax', 'tradePlan.entryHigh', 'plan.entryHigh', 'buyTo']));
  const singleEntry = n(first(raw, ['entry', 'entryPrice', 'tradePlan.entry', 'plan.entry', 'buyPrice']));
  if (entryLow === null && singleEntry !== null) entryLow = singleEntry;
  if (entryHigh === null && singleEntry !== null) entryHigh = singleEntry;

  let stopLoss = n(first(raw, ['stopLoss', 'stop', 'sl', 'tradePlan.stopLoss', 'plan.stopLoss']));
  let target1 = n(first(raw, ['target1', 'target', 'tp1', 'takeProfit', 'tradePlan.target1', 'plan.target1']));
  const target2 = n(first(raw, ['target2', 'tp2', 'tradePlan.target2', 'plan.target2']));

  const originalPlanPoints = [entryLow, entryHigh, stopLoss, target1].filter(v => v !== null).length;
  let planDerived = false;
  if (price !== null) {
    if (entryLow === null) { entryLow = price; planDerived = true; }
    if (entryHigh === null) { entryHigh = price * 1.005; planDerived = true; }
    if (stopLoss === null) {
      stopLoss = support1 !== null && support1 < price ? support1 * 0.995 : price * 0.96;
      planDerived = true;
    }
    if (target1 === null) {
      target1 = resistance1 !== null && resistance1 > price && resistance1 <= price * 1.25 ? resistance1 : price * 1.06;
      planDerived = true;
    }
  }

  const historySessions = Math.max(
    n(first(raw, ['historySessions', 'validSessions', 'sessionCount', 'historyLength', 'technical.historySessions']), 0),
    historyMap.get(symbol) || 0
  );

  const priceUpdatedAt = isoOrNull(first(raw, [
    'priceUpdatedAt', 'updatedAt', 'lastUpdated', 'timestamp', 'asOf', 'price.updatedAt', 'meta.updatedAt'
  ])) || sourceUpdatedAt;
  const priceAgeHours = hoursOld(priceUpdatedAt, now);

  const entryMid = entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : price;
  const risk = entryMid !== null && stopLoss !== null ? entryMid - stopLoss : null;
  const reward = entryMid !== null && target1 !== null ? target1 - entryMid : null;
  const computedRiskReward = risk > 0 && reward > 0 ? reward / risk : null;
  const reportedRiskReward = n(first(raw, ['rr', 'riskReward', 'risk_reward', 'tradePlan.riskReward', 'plan.riskReward']));
  const riskReward = computedRiskReward !== null ? computedRiskReward : reportedRiskReward;
  const stopDistancePct = entryMid && stopLoss !== null ? ((entryMid - stopLoss) / entryMid) * 100 : null;
  const targetUpsidePct = entryMid && target1 !== null ? ((target1 - entryMid) / entryMid) * 100 : null;
  const entryDistancePct = price && entryMid !== null ? (Math.abs(entryMid - price) / price) * 100 : null;
  const levelsValid = price !== null && support1 !== null && resistance1 !== null && support1 < price && price < resistance1;
  const pivotValid = pivot !== null && price !== null && pivot > 0 && pivot < price * 1.3 && pivot > price * 0.7;
  const priceValid = price !== null && price > 0;
  const fresh = priceAgeHours !== null && priceAgeHours <= CONFIG.maximumPriceAgeHours;
  const sourceTrusted = sourceCount >= 2
    || sourceStrength >= CONFIG.minimumSourceStrength
    || (sourceDifferencePct !== null && sourceDifferencePct <= CONFIG.maximumSourceDifferencePct)
    || /CONFIRM|TRUST|SAFE|VALID|STRONG/i.test(sourceDecision);
  const liquid = turnover >= CONFIG.minimumTurnoverEgp || liquidityScore >= CONFIG.minimumLiquidityScore;
  const anomalyFree = priceValid
    && (changePct === null || Math.abs(changePct) <= CONFIG.maximumAbsoluteDailyChangePct)
    && stopDistancePct !== null && stopDistancePct >= CONFIG.minimumStopDistancePct && stopDistancePct <= CONFIG.maximumStopDistancePct
    && targetUpsidePct !== null && targetUpsidePct >= CONFIG.minimumTargetUpsidePct && targetUpsidePct <= CONFIG.maximumTargetUpsidePct
    && entryDistancePct !== null && entryDistancePct <= CONFIG.maximumEntryDistancePct;
  const planLogical = entryLow !== null && entryHigh !== null && stopLoss !== null && target1 !== null
    && entryLow <= entryHigh && stopLoss < entryLow && target1 > entryHigh;

  const gates = [
    gate('price', 'السعر', priceValid, priceValid ? `سعر صالح ${round(price, 3)}` : 'السعر غير متاح أو غير صالح', 1.2),
    gate('freshness', 'حداثة السعر', fresh, priceAgeHours === null ? 'لا يوجد توقيت موثوق' : `عمر السعر ${priceAgeHours} ساعة`, 1),
    gate('source', 'توافق المصادر', sourceTrusted, `عدد المصادر ${sourceCount || 0}، قوة المصدر ${sourceStrength}%${sourceDifferencePct === null ? '' : `، فرق ${round(sourceDifferencePct)}%`}${sourceDecision ? `، حالة ${sourceDecision}` : ''}`, 1.1),
    gate('history', 'التاريخ', historySessions >= CONFIG.minimumHistoryLive, `${historySessions} جلسة من ${CONFIG.minimumHistoryLive}`, 1.2),
    gate('levels', 'الدعم والمقاومة', levelsValid, levelsValid ? (pivotValid ? 'الدعم والمقاومة وPivot منطقية' : 'الدعم والمقاومة صالحان؛ Pivot غير متاح كعنصر مساعد') : 'الدعم أو المقاومة مفقودان أو غير منطقيين', 1.2),
    gate('liquidity', 'السيولة', liquid, `قيمة التداول ${Math.round(turnover || 0).toLocaleString('en-US')}، درجة السيولة ${liquidityScore}%`, 1),
    gate('plan', 'خطة الصفقة', planLogical && originalPlanPoints >= 4, planLogical ? (originalPlanPoints >= 4 ? 'خطة أصلية مكتملة' : 'الخطة منطقية لكن بعض عناصرها مشتقة أو ناقصة') : 'الدخول/الهدف/الإيقاف غير منطقي', 1.1),
    gate('rr', 'العائد للمخاطرة', riskReward !== null && riskReward >= CONFIG.minimumRiskRewardLive, riskReward === null ? 'غير قابل للحساب' : `${round(riskReward)} : 1`, 1.1),
    gate('quality', 'جودة البيانات', dataQuality >= CONFIG.minimumDataQualityLive, `${dataQuality}%`, 0.9),
    gate('confidence', 'قوة الإشارة', confidence >= CONFIG.minimumConfidenceLive, `${confidence}% (ليست احتمال نجاح مثبتًا)`, 0.7),
    gate('anomaly', 'فحص الشذوذ', anomalyFree, anomalyFree ? 'لا توجد حركة أو خطة شاذة' : 'حركة يومية أو هدف أو وقف غير طبيعي', 1.2)
  ];

  const stockStrictPass = gates.every(g => g.pass);
  const paperEligible = priceValid && fresh && sourceTrusted
    && historySessions >= CONFIG.minimumHistoryPaper
    && levelsValid && liquid && planLogical && originalPlanPoints >= 3 && anomalyFree
    && riskReward !== null && riskReward >= CONFIG.minimumRiskRewardPaper
    && dataQuality >= CONFIG.minimumDataQualityPaper
    && confidence >= CONFIG.minimumConfidencePaper;

  const passedWeight = gates.filter(g => g.pass).reduce((sum, g) => sum + g.weight, 0);
  const totalWeight = gates.reduce((sum, g) => sum + g.weight, 0);
  const gateScore = totalWeight ? (passedWeight / totalWeight) * 100 : 0;
  const rrScore = riskReward === null ? 0 : clamp((riskReward / 2.5) * 100);
  const historyScore = clamp((historySessions / CONFIG.minimumHistoryLive) * 100);
  let score = round(
    confidence * 0.24 + dataQuality * 0.19 + liquidityScore * 0.12 + sourceStrength * 0.10
    + historyScore * 0.12 + rrScore * 0.08 + gateScore * 0.15
    - (planDerived ? 4 : 0),
    1
  );
  if (!priceValid || !fresh || !sourceTrusted) score = Math.min(score, 25);
  else if (!anomalyFree) score = Math.min(score, 49);
  else if (!levelsValid || !liquid || !planLogical) score = Math.min(score, 55);

  const failedReasons = gates.filter(g => !g.pass).map(g => `${g.label}: ${g.detail}`);
  const sourceSignal = stripMarkup(first(raw, ['decision', 'recommendation', 'signal', 'status', 'action'], ''));

  return {
    symbol, name, price: round(price, 4), sessionHigh: round(sessionHigh, 4), sessionLow: round(sessionLow, 4),
    changePct: round(changePct), volume, turnover,
    liquidityScore, confidence, dataQuality, sourceStrength, sourceCount, sourceDecision,
    support1: round(support1, 4), resistance1: round(resistance1, 4), pivot: round(pivot, 4),
    historySessions, priceUpdatedAt, priceAgeHours, sourceSignal,
    plan: {
      entryLow: round(entryLow, 4), entryHigh: round(entryHigh, 4),
      stopLoss: round(stopLoss, 4), target1: round(target1, 4), target2: round(target2, 4),
      riskReward: round(riskReward), reportedRiskReward: round(reportedRiskReward),
      stopDistancePct: round(stopDistancePct), targetUpsidePct: round(targetUpsidePct),
      entryDistancePct: round(entryDistancePct), derived: planDerived,
      originalPoints: originalPlanPoints
    },
    stockStrictPass, paperEligible, score, gates, failedReasons
  };
}

function cairoSessionId(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function loadLedger() {
  const existing = readJson(LEDGER_FILE, null);
  if (existing && Array.isArray(existing.trades)) return existing;
  return {
    schemaVersion: VERSION,
    createdAt: new Date().toISOString(),
    assumptions: {
      execution: 'تفعيل من الجلسة التالية للإشارة باستخدام High/Low اليومي عند توافره، وإلا يستخدم الإغلاق كبديل محافظ. عند لمس الهدف والإيقاف في الجلسة نفسها يُحتسب الإيقاف أولًا.',
      roundTripCostPct: CONFIG.paperRoundTripCostPct,
      positionRiskPct: 1,
      note: 'نتائج تداول ورقي وليست أرباحًا حقيقية أو ضمانًا للأداء.'
    },
    trades: []
  };
}

function closeTrade(trade, price, reason, sessionId, nowIso) {
  const grossReturnPct = ((price - trade.entryPrice) / trade.entryPrice) * 100;
  const netReturnPct = grossReturnPct - CONFIG.paperRoundTripCostPct;
  const riskPct = ((trade.entryPrice - trade.stopLoss) / trade.entryPrice) * 100;
  trade.status = 'CLOSED';
  trade.exitPrice = round(price, 4);
  trade.exitReason = reason;
  trade.closedSession = sessionId;
  trade.closedAt = nowIso;
  trade.grossReturnPct = round(grossReturnPct);
  trade.netReturnPct = round(netReturnPct);
  trade.rMultiple = riskPct > 0 ? round(netReturnPct / riskPct) : null;
  return trade;
}

function updateLedger(ledger, candidates, sessionId, nowIso) {
  const bySymbol = new Map(candidates.map(row => [row.symbol, row]));
  ledger.assumptions = {
    execution: 'تفعيل من الجلسة التالية للإشارة باستخدام High/Low اليومي عند توافره، وإلا يستخدم الإغلاق كبديل محافظ. عند لمس الهدف والإيقاف في الجلسة نفسها يُحتسب الإيقاف أولًا.',
    roundTripCostPct: CONFIG.paperRoundTripCostPct,
    positionRiskPct: 1,
    note: 'نتائج تداول ورقي مسجلة بعد صدور الإشارة، وليست أرباحًا حقيقية أو ضمانًا للأداء.'
  };

  for (const trade of ledger.trades) {
    if (!['PENDING', 'OPEN'].includes(trade.status)) continue;
    const row = bySymbol.get(trade.symbol);
    if (!row || !Number.isFinite(row.price)) continue;

    trade.lastPrice = row.price;
    trade.lastMarkedAt = nowIso;
    const isNewSession = trade.lastObservedSession !== sessionId;
    if (!isNewSession) continue; // يمنع استخدام بيانات جلسة الإشارة أو تكرار القياس في نفس اليوم.

    trade.observedSessions = (trade.observedSessions || 0) + 1;
    trade.lastObservedSession = sessionId;
    const hasOhlc = Number.isFinite(row.sessionHigh) && Number.isFinite(row.sessionLow);
    const dayHigh = hasOhlc ? row.sessionHigh : row.price;
    const dayLow = hasOhlc ? row.sessionLow : row.price;

    if (trade.status === 'PENDING') {
      const entryTouched = dayLow <= trade.entryHigh && dayHigh >= trade.entryLow;
      if (entryTouched) {
        trade.status = 'OPEN';
        trade.entryPrice = hasOhlc ? trade.entryHigh : row.price;
        trade.openedSession = sessionId;
        trade.openedAt = nowIso;
        trade.observedSessions = 0;
        trade.executionModel = hasOhlc ? 'NEXT_SESSION_DAILY_OHLC_CONSERVATIVE' : 'NEXT_SESSION_CLOSE_PROXY';
        // محافظ: إذا لُمس الإيقاف في جلسة الدخول، تُغلق الصفقة عليه. لا نحتسب الهدف في جلسة الدخول لعدم معرفة ترتيب الحركة داخل الجلسة.
        if (hasOhlc && dayLow <= trade.stopLoss) {
          closeTrade(trade, trade.stopLoss, 'STOP_ON_ENTRY_SESSION_CONSERVATIVE', sessionId, nowIso);
        }
      } else if ((trade.observedSessions || 0) >= CONFIG.paperPendingExpirySessions) {
        trade.status = 'EXPIRED';
        trade.exitReason = 'لم يدخل السعر نطاق الشراء خلال مدة الصلاحية';
        trade.closedSession = sessionId;
        trade.closedAt = nowIso;
      }
      continue;
    }

    const mtm = ((row.price - trade.entryPrice) / trade.entryPrice) * 100;
    trade.markToMarketPct = round(mtm - CONFIG.paperRoundTripCostPct);
    const stopTouched = dayLow <= trade.stopLoss;
    const targetTouched = dayHigh >= trade.target1;
    if (stopTouched) closeTrade(trade, trade.stopLoss, targetTouched ? 'BOTH_TOUCHED_STOP_FIRST' : (hasOhlc ? 'STOP_DAILY_LOW' : 'STOP_CLOSE_PROXY'), sessionId, nowIso);
    else if (targetTouched) closeTrade(trade, trade.target1, hasOhlc ? 'TARGET1_DAILY_HIGH' : 'TARGET1_CLOSE_PROXY', sessionId, nowIso);
    else if ((trade.observedSessions || 0) >= CONFIG.paperTimeExitSessions) closeTrade(trade, row.price, 'TIME_EXIT_10_SESSIONS', sessionId, nowIso);
  }

  const activeSymbols = new Set(ledger.trades.filter(t => ['PENDING', 'OPEN'].includes(t.status)).map(t => t.symbol));
  const createdThisSession = new Set(ledger.trades.filter(t => t.createdSession === sessionId).map(t => t.symbol));
  const eligible = candidates.filter(row => row.paperEligible && !activeSymbols.has(row.symbol) && !createdThisSession.has(row.symbol))
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.maximumPaperCandidatesPerSession);

  for (const row of eligible) {
    ledger.trades.push({
      id: `${sessionId}-${row.symbol}-${String(ledger.trades.length + 1).padStart(4, '0')}`,
      engineVersion: VERSION,
      symbol: row.symbol,
      name: row.name,
      status: 'PENDING',
      createdSession: sessionId,
      createdAt: nowIso,
      openedSession: null,
      openedAt: null,
      entryLow: row.plan.entryLow,
      entryHigh: row.plan.entryHigh,
      entryPrice: null,
      stopLoss: row.plan.stopLoss,
      target1: row.plan.target1,
      riskRewardAtSignal: row.plan.riskReward,
      signalScore: row.score,
      confidenceAtSignal: row.confidence,
      dataQualityAtSignal: row.dataQuality,
      historySessionsAtSignal: row.historySessions,
      lastPrice: row.price,
      lastObservedSession: sessionId,
      observedSessions: 0,
      gateSnapshot: row.gates,
      executionModel: 'WAIT_NEXT_SESSION'
    });
  }

  ledger.updatedAt = nowIso;
  ledger.schemaVersion = VERSION;
  return ledger;
}

function calculateMetrics(ledger) {
  const closed = ledger.trades.filter(t => t.status === 'CLOSED' && Number.isFinite(t.netReturnPct));
  const wins = closed.filter(t => t.netReturnPct > 0);
  const losses = closed.filter(t => t.netReturnPct <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.netReturnPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netReturnPct, 0));
  const avgNet = closed.length ? closed.reduce((s, t) => s + t.netReturnPct, 0) / closed.length : 0;
  const avgR = closed.length ? closed.reduce((s, t) => s + (n(t.rMultiple, 0)), 0) / closed.length : 0;

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let currentLossStreak = 0;
  let maxLossStreak = 0;
  const ordered = closed.slice().sort((a, b) => String(a.closedAt).localeCompare(String(b.closedAt)));
  for (const trade of ordered) {
    equity *= 1 + n(trade.rMultiple, 0) * 0.01;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    if (trade.netReturnPct <= 0) {
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    } else currentLossStreak = 0;
  }

  return {
    totalTrades: ledger.trades.length,
    pendingTrades: ledger.trades.filter(t => t.status === 'PENDING').length,
    openTrades: ledger.trades.filter(t => t.status === 'OPEN').length,
    expiredTrades: ledger.trades.filter(t => t.status === 'EXPIRED').length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: closed.length ? round((wins.length / closed.length) * 100, 1) : 0,
    averageNetReturnPct: round(avgNet),
    averageR: round(avgR),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? 99 : 0),
    maxDrawdownPct: round(maxDrawdown),
    maxConsecutiveLosses: maxLossStreak,
    measured: closed.length > 0,
    measurementNote: closed.length
      ? 'مقاس على تداول ورقي باستخدام سعر الإغلاق كبديل محافظ.'
      : 'لم تُغلق صفقات كافية بعد؛ لا توجد دقة مثبتة.'
  };
}

function buildGoLiveGates(metrics, coverage) {
  const gates = [
    gate('closedTrades', 'حجم العينة', metrics.closedTrades >= CONFIG.goLiveMinimumClosedTrades, `${metrics.closedTrades} / ${CONFIG.goLiveMinimumClosedTrades}`, 1.4),
    gate('winRate', 'نسبة الصفقات الرابحة', metrics.winRatePct >= CONFIG.goLiveMinimumWinRatePct, `${metrics.winRatePct}% / ${CONFIG.goLiveMinimumWinRatePct}%`, 1),
    gate('profitFactor', 'Profit Factor', metrics.profitFactor >= CONFIG.goLiveMinimumProfitFactor, `${metrics.profitFactor} / ${CONFIG.goLiveMinimumProfitFactor}`, 1.2),
    gate('expectancy', 'متوسط العائد', metrics.averageNetReturnPct > 0 && metrics.averageR > 0, `${metrics.averageNetReturnPct}%، ${metrics.averageR}R`, 1.2),
    gate('drawdown', 'أقصى تراجع', metrics.closedTrades > 0 && metrics.maxDrawdownPct <= CONFIG.goLiveMaximumDrawdownPct, `${metrics.maxDrawdownPct}% / حد ${CONFIG.goLiveMaximumDrawdownPct}%`, 1.2),
    gate('historyCoverage', 'تغطية 50 جلسة', coverage.history50Pct >= CONFIG.goLiveMinimumHistoryCoveragePct, `${coverage.history50Pct}% / ${CONFIG.goLiveMinimumHistoryCoveragePct}%`, 1.3),
    gate('levelsCoverage', 'تغطية المستويات', coverage.levelsPct >= CONFIG.goLiveMinimumLevelsCoveragePct, `${coverage.levelsPct}% / ${CONFIG.goLiveMinimumLevelsCoveragePct}%`, 1.2),
    gate('priceCoverage', 'تغطية السعر', coverage.pricePct >= CONFIG.goLiveMinimumPriceCoveragePct, `${coverage.pricePct}% / ${CONFIG.goLiveMinimumPriceCoveragePct}%`, 1.2)
  ];
  const totalWeight = gates.reduce((s, g) => s + g.weight, 0);
  const passedWeight = gates.filter(g => g.pass).reduce((s, g) => s + g.weight, 0);
  return {
    ready: gates.every(g => g.pass),
    progressPct: round((passedWeight / totalWeight) * 100, 1),
    gates
  };
}

function buildCoverage(rows) {
  const total = rows.length || 1;
  return {
    totalRows: rows.length,
    pricePct: round((rows.filter(r => Number.isFinite(r.price) && r.price > 0).length / total) * 100, 1),
    history20Pct: round((rows.filter(r => r.historySessions >= CONFIG.minimumHistoryPaper).length / total) * 100, 1),
    history50Pct: round((rows.filter(r => r.historySessions >= CONFIG.minimumHistoryLive).length / total) * 100, 1),
    levelsPct: round((rows.filter(r => r.gates.find(g => g.id === 'levels')?.pass).length / total) * 100, 1),
    liquidityPct: round((rows.filter(r => r.gates.find(g => g.id === 'liquidity')?.pass).length / total) * 100, 1),
    sourcePct: round((rows.filter(r => r.gates.find(g => g.id === 'source')?.pass).length / total) * 100, 1),
    strictStockPct: round((rows.filter(r => r.stockStrictPass).length / total) * 100, 1)
  };
}

function assertIsolatedOutput(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (!rel.startsWith('preview-v12/data/')) {
    throw new Error(`Safety violation: attempted output outside preview-v12/data: ${rel}`);
  }
}

function main() {
  const now = new Date();
  const nowIso = now.toISOString();
  const sessionId = cairoSessionId(now);
  CONFIG = Object.freeze({ ...DEFAULT_CONFIG, ...(readJson(CONFIG_FILE, {}) || {}) });
  assertIsolatedOutput(OUTPUT_FILE);
  assertIsolatedOutput(LEDGER_FILE);
  fs.mkdirSync(PREVIEW_DATA_DIR, { recursive: true });

  const source = detectSource();
  const historyMap = recursiveHistoryMap();
  const enrichmentMap = buildEnrichmentMap(source.file);
  const sourceUpdatedAt = sourceTimestamp(source);
  const normalized = source.rows
    .map((row, index) => {
      const symbol = symbolOf(row);
      const enriched = { ...(enrichmentMap.get(symbol) || {}), ...row };
      return normalizeRow(enriched, index, historyMap, sourceUpdatedAt, now);
    })
    .filter(row => row.symbol && !/^ROW\d+$/.test(row.symbol));

  const unique = Array.from(new Map(normalized.map(row => [row.symbol, row])).values());
  const coverage = buildCoverage(unique);
  let ledger = loadLedger();
  ledger = updateLedger(ledger, unique, sessionId, nowIso);
  const metrics = calculateMetrics(ledger);
  const goLive = buildGoLiveGates(metrics, coverage);

  const opportunities = unique.map(row => ({
    ...row,
    liveReady: row.stockStrictPass && goLive.ready,
    finalStatus: row.stockStrictPass && goLive.ready ? 'LIVE_READY' : row.paperEligible ? 'PAPER_CANDIDATE' : row.stockStrictPass ? 'VALIDATED_WAIT' : 'EXCLUDED'
  })).sort((a, b) => b.score - a.score);

  const live = opportunities.filter(r => r.finalStatus === 'LIVE_READY');
  const paper = opportunities.filter(r => r.finalStatus === 'PAPER_CANDIDATE');
  const validatedWait = opportunities.filter(r => r.finalStatus === 'VALIDATED_WAIT');
  const excluded = opportunities.filter(r => r.finalStatus === 'EXCLUDED');

  let decision;
  if (live.length) {
    decision = {
      code: 'CONDITIONAL_EXECUTION', label: 'تنفيذ مشروط', tone: 'positive',
      reason: `${live.length} فرصة اجتازت بوابات السهم وبوابات إثبات الأداء. التنفيذ يظل مشروطًا بسعر الدخول وإدارة المخاطر.`
    };
  } else if (paper.length || validatedWait.length) {
    decision = {
      code: 'PAPER_ONLY', label: 'مراقبة وتداول ورقي فقط', tone: 'warning',
      reason: goLive.ready
        ? 'توجد أسهم سليمة جزئيًا لكنها لم تجتز جميع بوابات السهم.'
        : 'التطبيق لم يثبت دقته بعينة كافية بعد؛ يمنع تحويل المرشحين إلى توصيات شراء حقيقية.'
    };
  } else {
    decision = {
      code: 'NO_BUY', label: 'لا شراء آمن الآن', tone: 'negative',
      reason: unique.length ? 'لا يوجد سهم اجتاز الحد الأدنى للتداول الورقي اليوم.' : 'لم يتم العثور على ملف ترتيب صالح؛ تم إغلاق بوابة التنفيذ تلقائيًا.'
    };
  }

  const output = {
    schemaVersion: VERSION,
    generatedAt: nowIso,
    sessionId,
    mode: goLive.ready ? 'VALIDATED_LIVE_GATED' : 'PAPER_VALIDATION',
    disclaimer: 'معاينة مستقلة ببيانات عامة ومتأخرة. لا تنفذ أوامر ولا تضمن الأرباح.',
    deployment: { mode: 'ISOLATED_PREVIEW', stableApplicationTouched: false, writeScope: 'preview-v12/data only' },
    source: {
      rankingFile: source.file,
      sourceUpdatedAt,
      rowsRead: source.rows.length,
      uniqueSymbols: unique.length,
      historySymbolsDetected: historyMap.size,
      enrichedSymbolsDetected: enrichmentMap.size
    },
    configuration: CONFIG,
    decision: {
      ...decision,
      liveReadyCount: live.length,
      paperCandidateCount: paper.length,
      validatedWaitCount: validatedWait.length,
      excludedCount: excluded.length,
      topSymbols: [...live, ...paper, ...validatedWait].slice(0, 3).map(r => r.symbol)
    },
    coverage,
    goLive,
    measurement: metrics,
    opportunities,
    excluded: excluded.map(r => ({
      symbol: r.symbol, name: r.name, price: r.price, score: r.score,
      reasons: r.failedReasons, gates: r.gates
    })),
    paperTrading: {
      assumptions: ledger.assumptions,
      metrics,
      pending: ledger.trades.filter(t => t.status === 'PENDING').slice(-20).reverse(),
      open: ledger.trades.filter(t => t.status === 'OPEN').slice(-20).reverse(),
      recentClosed: ledger.trades.filter(t => t.status === 'CLOSED').slice(-30).reverse(),
      recentExpired: ledger.trades.filter(t => t.status === 'EXPIRED').slice(-15).reverse()
    }
  };

  writeJson(LEDGER_FILE, ledger);
  writeJson(OUTPUT_FILE, output);

  console.log(`[V12 PREVIEW] source=${source.file || 'NONE'} rows=${unique.length} paper=${paper.length} live=${live.length}`);
  console.log(`[V12 PREVIEW] decision=${decision.code} goLive=${goLive.ready} progress=${goLive.progressPct}%`);
  console.log(`[V12 PREVIEW] wrote ${path.relative(ROOT, OUTPUT_FILE)} and ${path.relative(ROOT, LEDGER_FILE)}`);
}

try { main(); }
catch (error) {
  console.error('[V12 PREVIEW] FAILED:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
