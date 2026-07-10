#!/usr/bin/env node
'use strict';

/**
 * V13.2 Eligibility-Gated Decision & Paper Trading
 *
 * Reads V13.1 historical eligibility, then applies a second layer of
 * opportunity/plan gates. It never emits a live buy recommendation by default.
 * The first run only activates the ledger. Signals begin on a later market
 * session and are evaluated from the following session, preventing look-ahead.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const PREVIEW_DATA = path.join(ROOT, 'preview-v12', 'data');
const POLICY_PATH = path.join(DATA, 'v13-2-decision-paper-policy.json');
const ELIGIBILITY_PATH = path.join(DATA, 'history-eligibility.json');
const DECISION_ELIGIBLE_PATH = path.join(DATA, 'decision-eligible-symbols.json');
const REVIEW_QUEUE_PATH = path.join(DATA, 'history-review-queue.json');
const HISTORY_SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const HISTORY_DIR = path.join(DATA, 'history');

const DECISION_OUTPUT = path.join(PREVIEW_DATA, 'v13-2-decision.json');
const LEDGER_OUTPUT = path.join(PREVIEW_DATA, 'v13-2-paper-ledger.json');
const METRICS_OUTPUT = path.join(PREVIEW_DATA, 'v13-2-paper-metrics.json');
const VERSION = '13.2.0';

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** digits;
  return Math.round(parsed * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, number(value, min)));
}

function percentScore(value, fallback = 0) {
  let parsed = number(value, fallback);
  if (parsed > 0 && parsed <= 1) parsed *= 100;
  return clamp(parsed, 0, 100);
}

function first(object, aliases, fallback = null) {
  for (const alias of aliases) {
    let cursor = object;
    let found = true;
    for (const key of alias.split('.')) {
      if (cursor && Object.prototype.hasOwnProperty.call(cursor, key)) cursor = cursor[key];
      else { found = false; break; }
    }
    if (found && cursor !== null && cursor !== undefined && cursor !== '') return cursor;
  }
  return fallback;
}

function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}

function cleanText(value, max = 180) {
  const text = String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function tickerOf(row, fallback = '') {
  return safeTicker(first(row, [
    'ticker', 'symbol', 'code', 'stockSymbol', 'stock_code',
    'instrument.symbol', 'security.symbol', 'meta.symbol'
  ], fallback));
}

function dateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function compareDates(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

function daysBetween(later, earlier) {
  const a = dateOnly(later);
  const b = dateOnly(earlier);
  if (!a || !b) return null;
  return Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / 86400000);
}

function gate(id, label, pass, detail) {
  return { id, label, pass: Boolean(pass), detail: String(detail || '') };
}

function arrayCandidateScore(array) {
  if (!Array.isArray(array) || !array.length) return -1;
  const sample = array.slice(0, 50);
  let rows = 0;
  for (const item of sample) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (tickerOf(item) && (
      number(first(item, ['price', 'lastPrice', 'close', 'currentPrice'])) !== null ||
      first(item, ['score', 'finalScore', 'confidence', 'recommendation', 'decision']) !== null
    )) rows += 1;
  }
  return rows * 100 + Math.min(array.length, 1000);
}

function extractRows(input) {
  if (!input || typeof input !== 'object') return [];
  let best = [];
  let bestScore = -1;
  const seen = new Set();
  const preferred = new Set([
    'rows', 'items', 'ranking', 'opportunities', 'stocks', 'results',
    'candidates', 'recommendations', 'records', 'universe', 'data', 'list'
  ]);

  function walk(node, keyHint = '', depth = 0) {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const score = arrayCandidateScore(node) + (preferred.has(keyHint) ? 25 : 0);
      if (score > bestScore) { bestScore = score; best = node; }
      for (const item of node.slice(0, 100)) walk(item, '', depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, key, depth + 1);
  }

  walk(input);
  return bestScore > 0 ? best : [];
}

function sourceDate(json) {
  return dateOnly(first(json, [
    'latestMarketSession', 'sessionDate', 'asOf', 'generatedAt', 'updatedAt',
    'meta.generatedAt', 'summary.generatedAt', 'snapshot.generatedAt'
  ]));
}

function detectCandidateSource(policy) {
  for (const relative of policy.candidateSourceFiles || []) {
    const full = path.join(ROOT, relative);
    if (!fs.existsSync(full)) continue;
    const json = readJson(full, null);
    const rows = extractRows(json);
    if (rows.length) return { file: relative, json, rows, sessionDate: sourceDate(json) };
  }
  return { file: null, json: {}, rows: [], sessionDate: null };
}

function normalizeCandidate(raw, eligibility, policy, sourceSession) {
  const ticker = tickerOf(raw);
  const price = number(first(raw, ['price', 'lastPrice', 'last', 'close', 'currentPrice', 'marketPrice', 'last_price']));
  let entryLow = number(first(raw, ['entryLow', 'entryFrom', 'entryMin', 'buyFrom', 'tradePlan.entryLow', 'plan.entryLow']));
  let entryHigh = number(first(raw, ['entryHigh', 'entryTo', 'entryMax', 'buyTo', 'tradePlan.entryHigh', 'plan.entryHigh']));
  const singleEntry = number(first(raw, ['entry', 'entryPrice', 'buyPrice', 'tradePlan.entry', 'plan.entry']));
  if (entryLow === null && singleEntry !== null) entryLow = singleEntry;
  if (entryHigh === null && singleEntry !== null) entryHigh = singleEntry;
  const stopLoss = number(first(raw, ['stopLoss', 'stop', 'sl', 'tradePlan.stopLoss', 'plan.stopLoss']));
  const target1 = number(first(raw, ['target1', 'target', 'tp1', 'takeProfit', 'tradePlan.target1', 'plan.target1']));
  const target2 = number(first(raw, ['target2', 'tp2', 'tradePlan.target2', 'plan.target2']));
  const confidence = percentScore(first(raw, [
    'targetProbability', 'finalConfidence', 'confidence', 'confidenceScore',
    'scores.confidence', 'probability', 'finalScore'
  ], 0));
  const dataQuality = percentScore(first(raw, [
    'dataQualityScore', 'dataQuality', 'qualityScore', 'scores.quality',
    'quality', 'coverageScore', 'safetyGovernorScore'
  ], 0));
  const liquidityScore = percentScore(first(raw, [
    'liquidityScore', 'scores.liquidity', 'liquidity.score', 'liquidityGrade'
  ], 0));
  const turnover = number(first(raw, [
    'turnover', 'tradedValue', 'valueTraded', 'traded_value', 'tradeValue',
    'liquidityValue', 'totalValue', 'averageTurnover20', 'avgTurnover20'
  ]), 0);
  const rowSession = dateOnly(first(raw, [
    'sessionDate', 'marketSession', 'date', 'asOf', 'priceDate', 'latestSession',
    'updatedAt', 'generatedAt'
  ])) || sourceSession;
  const entryMid = entryLow !== null && entryHigh !== null ? (entryLow + entryHigh) / 2 : null;
  const risk = entryMid !== null && stopLoss !== null ? entryMid - stopLoss : null;
  const reward = entryMid !== null && target1 !== null ? target1 - entryMid : null;
  const riskReward = risk > 0 && reward > 0 ? reward / risk : number(first(raw, ['rr', 'riskReward', 'risk_reward']));
  const planComplete = [entryLow, entryHigh, stopLoss, target1].every((value) => Number.isFinite(value));
  const planLogical = planComplete && price > 0 && entryLow <= entryHigh && stopLoss < entryLow && target1 > entryHigh;
  const liquid = turnover >= Number(policy.minimumTurnoverEgp || 0) || liquidityScore >= Number(policy.minimumLiquidityScore || 0);
  const sourceLag = daysBetween(eligibility.latestMarketSession, rowSession);
  const sourceFresh = rowSession !== null && sourceLag !== null && sourceLag >= -1 && sourceLag <= Number(policy.maximumSignalAgeCalendarDays || 4);

  const paperGates = [
    gate('historyEligibility', 'أهلية التاريخ للتداول الورقي', eligibility.paperTradingEligible === true, eligibility.statusLabelAr || eligibility.status),
    gate('price', 'السعر', price !== null && price > 0, price !== null ? `السعر ${round(price, 4)}` : 'السعر غير متاح'),
    gate('sourceFreshness', 'حداثة ملف الفرص', sourceFresh, rowSession ? `جلسة المصدر ${rowSession}، فرق ${sourceLag} يوم` : 'تاريخ مصدر الفرص غير متاح'),
    gate('explicitPlan', 'خطة صفقة أصلية', planComplete, planComplete ? 'الدخول والوقف والهدف متاحة' : 'الخطة ناقصة؛ لا يتم اشتقاق قيم تقديرية'),
    gate('planLogic', 'منطق الخطة', planLogical, planLogical ? 'الوقف أسفل الدخول والهدف أعلاه' : 'ترتيب الدخول/الوقف/الهدف غير صالح'),
    gate('riskReward', 'العائد للمخاطرة', riskReward !== null && riskReward >= Number(policy.minimumPaperRiskReward || 1.25), riskReward !== null ? `${round(riskReward)} : 1` : 'غير قابل للحساب'),
    gate('confidence', 'قوة الإشارة', confidence >= Number(policy.minimumPaperConfidence || 60), `${confidence}%`),
    gate('dataQuality', 'جودة البيانات', dataQuality >= Number(policy.minimumPaperDataQuality || 65), `${dataQuality}%`),
    gate('liquidity', 'السيولة', liquid, `القيمة ${Math.round(turnover).toLocaleString('en-US')}، الدرجة ${liquidityScore}%`)
  ];

  const decisionGates = [
    gate('decisionHistoryEligibility', 'أهلية التاريخ للقرار', eligibility.decisionEligible === true, eligibility.statusLabelAr || eligibility.status),
    gate('decisionRiskReward', 'عائد/مخاطرة القرار', riskReward !== null && riskReward >= Number(policy.minimumDecisionRiskReward || 1.5), riskReward !== null ? `${round(riskReward)} : 1` : 'غير قابل للحساب'),
    gate('decisionConfidence', 'قوة إشارة القرار', confidence >= Number(policy.minimumDecisionConfidence || 70), `${confidence}%`),
    gate('decisionDataQuality', 'جودة بيانات القرار', dataQuality >= Number(policy.minimumDecisionDataQuality || 75), `${dataQuality}%`)
  ];

  const paperPass = paperGates.every((item) => item.pass);
  const decisionPass = paperPass && decisionGates.every((item) => item.pass);
  const historyWeight = eligibility.sessions >= 100 ? 100 : Math.min(100, eligibility.sessions);
  const rrScore = riskReward === null ? 0 : Math.min(100, (riskReward / 2.5) * 100);
  const score = round(confidence * 0.28 + dataQuality * 0.24 + liquidityScore * 0.14 + historyWeight * 0.14 + rrScore * 0.12 + (decisionPass ? 8 : paperPass ? 4 : 0), 1);

  return {
    ticker,
    companyNameAr: eligibility.companyNameAr || cleanText(first(raw, ['nameAr', 'companyNameAr', 'arabicName', 'name']), 100) || null,
    companyNameEn: eligibility.companyNameEn || cleanText(first(raw, ['nameEn', 'companyNameEn', 'company']), 100) || null,
    price: round(price, 4),
    sourceSession: rowSession,
    sourceLagCalendarDays: sourceLag,
    entryLow: round(entryLow, 4),
    entryHigh: round(entryHigh, 4),
    stopLoss: round(stopLoss, 4),
    target1: round(target1, 4),
    target2: round(target2, 4),
    riskReward: round(riskReward, 3),
    confidence,
    dataQuality,
    liquidityScore,
    turnover,
    score,
    sourceSignal: cleanText(first(raw, ['recommendation', 'decision', 'signal', 'status', 'action']), 100),
    eligibility: {
      status: eligibility.status,
      statusLabelAr: eligibility.statusLabelAr,
      sessions: eligibility.sessions,
      lastSession: eligibility.lastSession,
      confidence: eligibility.confidence,
      decisionEligible: eligibility.decisionEligible,
      paperTradingEligible: eligibility.paperTradingEligible,
      highConfidenceEligible: eligibility.highConfidenceEligible
    },
    paperPass,
    decisionPass,
    paperGates,
    decisionGates,
    failedReasons: [...paperGates, ...decisionGates].filter((item) => !item.pass).map((item) => `${item.label}: ${item.detail}`)
  };
}


function effectiveEligibility(item, currentSession, policy) {
  const history = readJson(path.join(HISTORY_DIR, `${safeTicker(item.ticker)}.json`), null);
  const sessionsArray = Array.isArray(history?.sessions) ? history.sessions : [];
  const sessions = sessionsArray.length || Number(history?.availableSessions || item.sessions || 0);
  const lastSession = history?.lastSession || sessionsArray.at?.(-1)?.date || item.lastSession || null;
  const lag = daysBetween(currentSession, lastSession);
  const recent = lag !== null && lag >= 0 && lag <= Number(policy.maximumHistoryLagCalendarDays || 21);
  const decisionEligible = item.decisionEligible === true
    && sessions >= Number(policy.minimumHistorySessionsDecision || 100)
    && recent;
  const paperTradingEligible = item.paperTradingEligible === true
    && sessions >= Number(policy.minimumHistorySessionsPaper || 50)
    && recent;
  return {
    ...item,
    sessions,
    lastSession,
    recent,
    marketLagCalendarDays: lag,
    decisionEligible,
    paperTradingEligible,
    highConfidenceEligible: item.highConfidenceEligible === true && decisionEligible
  };
}

function loadHistory(ticker) {
  const history = readJson(path.join(HISTORY_DIR, `${ticker}.json`), null);
  if (!history) return [];
  const rows = Array.isArray(history.sessions) ? history.sessions : [];
  const map = new Map();
  for (const row of rows) {
    const date = dateOnly(row?.date || row?.sessionDate);
    const open = number(row?.open);
    const high = number(row?.high);
    const low = number(row?.low);
    const close = number(row?.close);
    const volume = row?.volume === null || row?.volume === undefined ? null : number(row.volume);
    if (!date || ![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) continue;
    if (high < low || high < open || high < close || low > open || low > close) continue;
    map.set(date, { date, open, high, low, close, volume });
  }
  return [...map.values()].sort((a, b) => compareDates(a.date, b.date));
}

function loadLedger(currentSession) {
  const existing = readJson(LEDGER_OUTPUT, null);
  if (existing?.schemaVersion === VERSION && Array.isArray(existing.trades)) return existing;
  const now = new Date().toISOString();
  return {
    schemaVersion: VERSION,
    activatedAt: now,
    activationSession: currentSession,
    lastProcessedSession: currentSession,
    updatedAt: now,
    assumptions: {
      direction: 'long_only',
      entryStartsAfterSignalSession: true,
      conservativeEntry: 'entryHigh when range is touched',
      sameBarConflict: 'stop_first',
      pendingExpirySessions: null,
      timeExitSessions: null,
      roundTripCostPct: null,
      noRetroactiveSignals: true
    },
    trades: []
  };
}

function checkpointReturn(basePrice, closePrice, costPct) {
  if (!(basePrice > 0) || !(closePrice > 0)) return null;
  return round(((closePrice - basePrice) / basePrice) * 100 - costPct, 3);
}

function setCheckpoint(trade, horizon, session, basePrice, costPct) {
  trade.checkpoints ||= {};
  if (trade.checkpoints[String(horizon)]) return;
  trade.checkpoints[String(horizon)] = {
    session: session.date,
    close: round(session.close, 4),
    netReturnPct: checkpointReturn(basePrice, session.close, costPct)
  };
}

function closeTrade(trade, session, exitPrice, reason, policy) {
  const grossReturnPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
  const riskPerShare = trade.entryPrice - trade.stopLoss;
  trade.status = 'CLOSED';
  trade.closedSession = session.date;
  trade.exitPrice = round(exitPrice, 4);
  trade.exitReason = reason;
  trade.grossReturnPct = round(grossReturnPct, 3);
  trade.netReturnPct = round(grossReturnPct - Number(policy.roundTripCostPct || 0), 3);
  trade.rMultiple = riskPerShare > 0 ? round((exitPrice - trade.entryPrice) / riskPerShare, 3) : null;
  trade.events.push({ session: session.date, type: 'CLOSE', reason, price: trade.exitPrice });
}

function evaluateTrade(trade, sessions, currentSession, policy) {
  const newSessions = sessions.filter((row) => compareDates(row.date, trade.lastEvaluatedSession || trade.signalSession) > 0 && compareDates(row.date, currentSession) <= 0);
  for (const session of newSessions) {
    trade.signalObservedSessions = Number(trade.signalObservedSessions || 0) + 1;
    for (const horizon of [1, 3, 5, 10]) {
      if (trade.signalObservedSessions === horizon) setCheckpoint(trade, horizon, session, trade.signalPrice, Number(policy.roundTripCostPct || 0));
    }

    if (trade.status === 'PENDING') {
      trade.pendingObservedSessions = Number(trade.pendingObservedSessions || 0) + 1;
      const touched = session.high >= trade.entryLow && session.low <= trade.entryHigh;
      if (touched) {
        trade.status = 'OPEN';
        trade.openedSession = session.date;
        trade.entryPrice = round(trade.entryHigh, 4);
        trade.openObservedSessions = 1;
        trade.events.push({ session: session.date, type: 'OPEN', price: trade.entryPrice, model: 'conservative_entry_high' });
        const stopTouched = session.low <= trade.stopLoss;
        const targetTouched = session.high >= trade.target1;
        if (stopTouched) closeTrade(trade, session, trade.stopLoss, targetTouched ? 'STOP_FIRST_SAME_SESSION' : 'STOP_LOSS', policy);
        else if (targetTouched) closeTrade(trade, session, trade.target1, 'TARGET_1', policy);
      } else if (trade.pendingObservedSessions >= Number(policy.pendingExpirySessions || 3)) {
        trade.status = 'EXPIRED';
        trade.expiredSession = session.date;
        trade.exitReason = 'ENTRY_NOT_FILLED';
        trade.events.push({ session: session.date, type: 'EXPIRE', reason: trade.exitReason });
      }
    } else if (trade.status === 'OPEN') {
      trade.openObservedSessions = Number(trade.openObservedSessions || 0) + 1;
      const stopTouched = session.low <= trade.stopLoss;
      const targetTouched = session.high >= trade.target1;
      if (stopTouched) closeTrade(trade, session, trade.stopLoss, targetTouched ? 'STOP_FIRST_SAME_SESSION' : 'STOP_LOSS', policy);
      else if (targetTouched) closeTrade(trade, session, trade.target1, 'TARGET_1', policy);
      else if (trade.openObservedSessions >= Number(policy.timeExitSessions || 10)) closeTrade(trade, session, session.close, 'TIME_EXIT', policy);
    }

    trade.lastEvaluatedSession = session.date;
    if (['CLOSED', 'EXPIRED'].includes(trade.status)) break;
  }
  return trade;
}

function updateLedger(ledger, candidates, currentSession, policy) {
  const now = new Date().toISOString();
  ledger.assumptions.pendingExpirySessions = Number(policy.pendingExpirySessions || 3);
  ledger.assumptions.timeExitSessions = Number(policy.timeExitSessions || 10);
  ledger.assumptions.roundTripCostPct = Number(policy.roundTripCostPct || 0.4);

  for (const trade of ledger.trades) {
    if (!['PENDING', 'OPEN'].includes(trade.status)) continue;
    evaluateTrade(trade, loadHistory(trade.ticker), currentSession, policy);
  }

  const sessionAdvanced = compareDates(currentSession, ledger.lastProcessedSession) > 0;
  const newSignals = [];
  if (sessionAdvanced) {
    const activeTickers = new Set(ledger.trades.filter((trade) => ['PENDING', 'OPEN'].includes(trade.status)).map((trade) => trade.ticker));
    const alreadyThisSession = new Set(ledger.trades.filter((trade) => trade.signalSession === currentSession).map((trade) => trade.ticker));
    const touchedThisSession = new Set(ledger.trades
      .filter((trade) => (trade.events || []).some((event) => event.session === currentSession))
      .map((trade) => trade.ticker));
    const selected = candidates
      .filter((candidate) => candidate.paperPass && !activeTickers.has(candidate.ticker) && !alreadyThisSession.has(candidate.ticker) && !touchedThisSession.has(candidate.ticker))
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(policy.maximumCandidatesPerSession || 5));

    for (const candidate of selected) {
      const trade = {
        id: `${currentSession}-${candidate.ticker}`,
        ticker: candidate.ticker,
        status: 'PENDING',
        signalSession: currentSession,
        signalPrice: candidate.price,
        entryLow: candidate.entryLow,
        entryHigh: candidate.entryHigh,
        stopLoss: candidate.stopLoss,
        target1: candidate.target1,
        target2: candidate.target2,
        plannedRiskReward: candidate.riskReward,
        candidateScore: candidate.score,
        eligibilityStatus: candidate.eligibility.status,
        decisionEligibleAtSignal: candidate.eligibility.decisionEligible,
        paperTradingEligibleAtSignal: candidate.eligibility.paperTradingEligible,
        lastEvaluatedSession: currentSession,
        pendingObservedSessions: 0,
        signalObservedSessions: 0,
        checkpoints: {},
        events: [{ session: currentSession, type: 'SIGNAL_CREATED', note: 'Entry evaluation begins from the next market session.' }]
      };
      ledger.trades.push(trade);
      newSignals.push(trade.id);
    }
  }

  ledger.lastProcessedSession = currentSession;
  ledger.updatedAt = now;
  return { ledger, newSignals, sessionAdvanced };
}

function calculateMetrics(ledger) {
  const closed = ledger.trades.filter((trade) => trade.status === 'CLOSED' && Number.isFinite(trade.netReturnPct));
  const wins = closed.filter((trade) => trade.netReturnPct > 0);
  const losses = closed.filter((trade) => trade.netReturnPct <= 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netReturnPct, 0));
  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  let equity = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  let lossStreak = 0;
  let maxConsecutiveLosses = 0;
  for (const trade of closed.slice().sort((a, b) => compareDates(a.closedSession, b.closedSession))) {
    equity *= 1 + trade.netReturnPct / 100;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
    if (trade.netReturnPct <= 0) {
      lossStreak += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, lossStreak);
    } else lossStreak = 0;
  }

  const checkpointMetrics = {};
  for (const horizon of [1, 3, 5, 10]) {
    const values = ledger.trades.map((trade) => trade.checkpoints?.[String(horizon)]?.netReturnPct).filter(Number.isFinite);
    checkpointMetrics[String(horizon)] = {
      samples: values.length,
      averageNetReturnPct: round(average(values), 3),
      positivePct: values.length ? round(values.filter((value) => value > 0).length / values.length * 100, 1) : 0
    };
  }

  return {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    activationSession: ledger.activationSession,
    lastProcessedSession: ledger.lastProcessedSession,
    totalTrades: ledger.trades.length,
    pendingTrades: ledger.trades.filter((trade) => trade.status === 'PENDING').length,
    openTrades: ledger.trades.filter((trade) => trade.status === 'OPEN').length,
    expiredTrades: ledger.trades.filter((trade) => trade.status === 'EXPIRED').length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    targetExits: closed.filter((trade) => trade.exitReason === 'TARGET_1').length,
    stopExits: closed.filter((trade) => String(trade.exitReason || '').includes('STOP')).length,
    timeExits: closed.filter((trade) => trade.exitReason === 'TIME_EXIT').length,
    winRatePct: closed.length ? round(wins.length / closed.length * 100, 1) : 0,
    averageNetReturnPct: round(average(closed.map((trade) => trade.netReturnPct)), 3),
    averageR: round(average(closed.map((trade) => trade.rMultiple).filter(Number.isFinite)), 3),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : (grossProfit > 0 ? 99 : 0),
    maxDrawdownPct: round(maxDrawdownPct, 3),
    maxConsecutiveLosses,
    checkpointMetrics,
    measured: closed.length > 0,
    note: closed.length ? 'نتائج تداول ورقي بعد التكاليف المفترضة.' : 'لم تُغلق صفقات بعد؛ لا توجد دقة مثبتة.'
  };
}

function performanceGate(metrics, policy) {
  const gates = [
    gate('sample', 'حجم العينة', metrics.closedTrades >= Number(policy.goLiveMinimumClosedTrades || 30), `${metrics.closedTrades} / ${policy.goLiveMinimumClosedTrades}`),
    gate('winRate', 'نسبة النجاح', metrics.winRatePct >= Number(policy.goLiveMinimumWinRatePct || 50), `${metrics.winRatePct}%`),
    gate('profitFactor', 'Profit Factor', metrics.profitFactor >= Number(policy.goLiveMinimumProfitFactor || 1.2), `${metrics.profitFactor}`),
    gate('averageR', 'متوسط R', metrics.averageR > Number(policy.goLiveMinimumAverageR || 0), `${metrics.averageR}R`),
    gate('drawdown', 'أقصى تراجع', metrics.closedTrades > 0 && metrics.maxDrawdownPct <= Number(policy.goLiveMaximumDrawdownPct || 10), `${metrics.maxDrawdownPct}%`)
  ];
  return { passed: gates.every((item) => item.pass), gates };
}

function main() {
  const policy = readJson(POLICY_PATH, null);
  const eligibility = readJson(ELIGIBILITY_PATH, null);
  const decisionEligibility = readJson(DECISION_ELIGIBLE_PATH, null);
  const reviewQueue = readJson(REVIEW_QUEUE_PATH, { items: [] });
  const historySummary = readJson(HISTORY_SUMMARY_PATH, {});
  if (!policy || !eligibility || !decisionEligibility) throw new Error('Missing V13.1 eligibility outputs or V13.2 policy.');
  if (eligibility.schemaVersion !== '13.1.0') throw new Error(`Unsupported history eligibility version: ${eligibility.schemaVersion}`);

  const currentSession = [eligibility.latestMarketSession, historySummary.latestMarketSession].filter(Boolean).sort().at(-1);
  if (!currentSession) throw new Error('latestMarketSession is unavailable in history-eligibility.json');
  const eligibilityMap = new Map((eligibility.items || []).map((item) => [safeTicker(item.ticker), item]));
  const source = detectCandidateSource(policy);
  const candidateMap = new Map();
  for (const raw of source.rows) {
    const ticker = tickerOf(raw);
    const baseEligibility = eligibilityMap.get(ticker);
    if (!ticker || !baseEligibility || baseEligibility.active === false || baseEligibility.delisted === true) continue;
    const eligible = effectiveEligibility(baseEligibility, currentSession, policy);
    const normalized = normalizeCandidate(raw, eligible, policy, source.sessionDate);
    const existing = candidateMap.get(ticker);
    if (!existing || normalized.score > existing.score) candidateMap.set(ticker, normalized);
  }

  const candidates = [...candidateMap.values()].sort((a, b) => b.score - a.score);
  const decisionCandidates = candidates.filter((candidate) => candidate.decisionPass);
  const paperCandidates = candidates.filter((candidate) => candidate.paperPass);
  const watchOnly = candidates.filter((candidate) => !candidate.paperPass);

  let ledger = loadLedger(currentSession);
  const activationOnly = ledger.trades.length === 0 && ledger.activationSession === currentSession && ledger.lastProcessedSession === currentSession && !fs.existsSync(LEDGER_OUTPUT);
  const update = updateLedger(ledger, paperCandidates, currentSession, policy);
  ledger = update.ledger;
  const metrics = calculateMetrics(ledger);
  const performance = performanceGate(metrics, policy);
  const independentCandidates = decisionCandidates.filter((candidate) => candidate.eligibility.highConfidenceEligible === true);
  const liveUnlocked = policy.allowLiveExecution === true && performance.passed && independentCandidates.length > 0;

  const decision = liveUnlocked ? {
    code: 'CONDITIONAL_EXECUTION',
    labelAr: 'تنفيذ مشروط',
    reasonAr: 'تم فتح التنفيذ المشروط وفق سياسة صريحة وبعد اجتياز الأداء والتحقق المستقل.'
  } : paperCandidates.length ? {
    code: 'PAPER_ONLY',
    labelAr: 'ترشيحات للتداول الورقي فقط',
    reasonAr: activationOnly
      ? 'تم تفعيل دفتر التداول الورقي اليوم. يبدأ إنشاء الإشارات من أول جلسة سوق لاحقة دون أي أثر رجعي.'
      : 'التنفيذ الحقيقي مغلق؛ تُستخدم المرشحات للقياس الورقي فقط.'
  } : {
    code: 'WATCH_ONLY',
    labelAr: 'مراقبة فقط',
    reasonAr: source.file ? 'لم يجتز أي سهم جميع بوابات التداول الورقي الحالية.' : 'لم يُعثر على ملف فرص صالح؛ أُغلقت البوابات تلقائيًا.'
  };

  const output = {
    schemaVersion: VERSION,
    generatedAt: new Date().toISOString(),
    sessionId: currentSession,
    mode: 'ELIGIBILITY_GATED_PAPER_VALIDATION',
    stableApplicationTouched: false,
    liveExecutionEnabled: liveUnlocked,
    disclaimerAr: 'هذه لوحة قياس وتداول ورقي، وليست توصية شراء أو ضمانًا للعائد.',
    source: {
      candidateFile: source.file,
      candidateSourceSession: source.sessionDate,
      rowsRead: source.rows.length,
      matchedSymbols: candidates.length
    },
    eligibility: {
      activeSymbols: eligibility.counts?.activeSymbols || 0,
      decisionEligibleHistory: eligibility.counts?.decisionEligible || decisionEligibility.total || 0,
      paperTradingEligibleHistory: eligibility.counts?.paperTradingEligible || 0,
      highConfidenceEligibleHistory: eligibility.counts?.highConfidenceEligible || 0,
      reviewQueue: eligibility.counts?.reviewQueue || reviewQueue.total || 0
    },
    decision: {
      ...decision,
      decisionCandidates: decisionCandidates.length,
      paperCandidates: paperCandidates.length,
      watchOnly: watchOnly.length,
      newPaperSignals: update.newSignals.length,
      sessionAdvanced: update.sessionAdvanced,
      activationSession: ledger.activationSession
    },
    performanceGate: performance,
    metrics,
    topDecisionCandidates: decisionCandidates.slice(0, 10),
    topPaperCandidates: paperCandidates.slice(0, 20),
    watchOnly: watchOnly.slice(0, 100),
    reviewCases: (reviewQueue.items || []).slice(0, 100),
    paperTrading: {
      newSignalIds: update.newSignals,
      pending: ledger.trades.filter((trade) => trade.status === 'PENDING').slice(-30).reverse(),
      open: ledger.trades.filter((trade) => trade.status === 'OPEN').slice(-30).reverse(),
      recentClosed: ledger.trades.filter((trade) => trade.status === 'CLOSED').slice(-50).reverse(),
      recentExpired: ledger.trades.filter((trade) => trade.status === 'EXPIRED').slice(-30).reverse()
    },
    safetyNotes: [
      'Only V13.1 paperTradingEligible symbols may create paper signals.',
      'Only V13.1 decisionEligible symbols may appear in the decision shortlist.',
      'No plan values are estimated when entry, stop, or target is missing.',
      'The first run activates the ledger and creates no retroactive trades.',
      'Trade entry is evaluated from the session after the signal.',
      'If stop and target are touched in the same session, the stop is recorded first.',
      'Live execution remains disabled by policy unless explicitly enabled after independent verification and measured performance.'
    ]
  };

  writeJsonAtomic(LEDGER_OUTPUT, ledger);
  writeJsonAtomic(METRICS_OUTPUT, metrics);
  writeJsonAtomic(DECISION_OUTPUT, output);

  console.log(`V13.2 source: ${source.file || 'none'} (${source.rows.length} rows)`);
  console.log(`V13.2 matched candidates: ${candidates.length}`);
  console.log(`V13.2 decision candidates: ${decisionCandidates.length}`);
  console.log(`V13.2 paper candidates: ${paperCandidates.length}`);
  console.log(`V13.2 new signals: ${update.newSignals.length}`);
  console.log(`V13.2 ledger: ${ledger.trades.length} trades; ${metrics.closedTrades} closed`);
  console.log(`V13.2 decision: ${decision.code}; live=${liveUnlocked}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
