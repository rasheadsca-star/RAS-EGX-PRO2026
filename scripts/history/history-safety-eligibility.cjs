#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const HISTORY_DIR = path.join(DATA, 'history');
const POLICY_PATH = path.join(DATA, 'history-safety-policy.json');
const MAP_PATH = path.join(DATA, 'symbol-map.json');
const SUMMARY_PATH = path.join(DATA, 'history-summary.json');
const TARGETED_REPORT_PATH = path.join(DATA, 'history-targeted-seven-report.json');
const STARTA_REPORT_PATH = path.join(DATA, 'history-starta-gap-report.json');

const ELIGIBILITY_PATH = path.join(DATA, 'history-eligibility.json');
const SAFETY_REPORT_PATH = path.join(DATA, 'history-safety-report.json');
const DECISION_LIST_PATH = path.join(DATA, 'decision-eligible-symbols.json');
const REVIEW_QUEUE_PATH = path.join(DATA, 'history-review-queue.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}

function mapEntries(raw) {
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw || {}).map(([key, value]) => ({ ...(value || {}), ticker: value?.ticker || key }));
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function diffDays(later, earlier) {
  const a = toDate(later);
  const b = toDate(earlier);
  if (!a || !b) return null;
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function historyFile(ticker) {
  return path.join(HISTORY_DIR, `${ticker}.json`);
}

function loadHistory(ticker) {
  return readJson(historyFile(ticker), null);
}

function reportMap(report) {
  return new Map((report?.results || []).map((item) => [safeTicker(item.ticker), item]));
}

function getSessionCount(history) {
  if (Array.isArray(history?.sessions)) return history.sessions.length;
  return Number(history?.availableSessions || 0);
}

function getLastSession(history) {
  return history?.lastSession || history?.sessions?.at?.(-1)?.date || null;
}

function getConfidence(history) {
  const direct = Number(history?.averageConfidence);
  if (Number.isFinite(direct) && direct > 0) return round(direct, 2);
  const values = (history?.sessions || [])
    .map((session) => Number(session?.confidence?.overall ?? session?.confidence ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 2) : 0;
}

function riskyBridgeEvidence(targetedResult, history, policy) {
  const evidence = targetedResult?.evidence || history?.v13TargetedRepair?.sparseEvidence || null;
  if (!evidence) return null;
  const method = String(evidence.method || history?.v13TargetedRepair?.sparseEvidence?.method || '');
  const overlapCount = Number(evidence?.exact?.overlapCount ?? 0);
  const bridgeDifference = Number(evidence?.bridge?.closeDifferencePct);
  const bridgeAccepted = evidence?.bridge?.accepted === true || method.includes('bridge');
  const threshold = Number(policy.maximumNoOverlapBridgeDifferencePct || 2);
  if (bridgeAccepted && overlapCount === 0 && Number.isFinite(bridgeDifference) && bridgeDifference > threshold) {
    return {
      method,
      overlapCount,
      closeDifferencePct: round(bridgeDifference, 4),
      thresholdPct: threshold,
      reason: 'no_overlap_bridge_exceeds_safety_limit',
    };
  }
  return null;
}

function manualAdjustmentEvidence(targetedResult) {
  if (targetedResult?.status !== 'manual_approval_required') return null;
  return {
    factor: Number(targetedResult?.adjustment?.factor) || null,
    observations: Number(targetedResult?.adjustment?.observations) || 0,
    maxDeviationPct: Number(targetedResult?.adjustment?.maxDeviationPct) || null,
    sourceUrl: targetedResult?.sourceUrl || null,
    reason: 'corporate_action_or_adjusted_close_review_required',
  };
}

function determineStatus(context) {
  const {
    active,
    delisted,
    sessions,
    recent,
    manualAdjustment,
    riskyBridge,
  } = context;

  if (!active || delisted) return 'inactive_delisted';
  if (manualAdjustment) return 'manual_adjustment_review';
  if (riskyBridge) return 'complete_but_under_review';
  if (sessions <= 0) return 'missing_history';
  if (sessions >= 100 && recent) return 'complete_recent';
  if (sessions >= 100 && !recent) return 'complete_but_stale';
  if (sessions >= 50 && recent) return 'partial_recent';
  if (sessions >= 50 && !recent) return 'partial_and_stale';
  return 'insufficient_history';
}

function priorityForStatus(status) {
  return ({
    complete_but_under_review: 1,
    manual_adjustment_review: 1,
    complete_but_stale: 2,
    partial_and_stale: 2,
    partial_recent: 3,
    insufficient_history: 4,
    missing_history: 5,
    inactive_delisted: 9,
  })[status] ?? 6;
}

function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(POLICY_PATH, null);
  if (!policy) throw new Error('Missing or invalid data/history-safety-policy.json');

  const summary = readJson(SUMMARY_PATH, {});
  const latestMarketSession = summary.latestMarketSession || readJson(TARGETED_REPORT_PATH, {})?.latestMarketSession || null;
  if (!latestMarketSession) throw new Error('latestMarketSession is unavailable');

  const symbolMapRaw = readJson(MAP_PATH, {});
  const targetedReport = readJson(TARGETED_REPORT_PATH, { results: [] });
  const startaReport = readJson(STARTA_REPORT_PATH, { results: [] });
  const targetedByTicker = reportMap(targetedReport);
  const startaByTicker = reportMap(startaReport);

  const items = [];

  for (const entryRaw of mapEntries(symbolMapRaw)) {
    const ticker = safeTicker(entryRaw?.ticker);
    if (!ticker) continue;
    const history = loadHistory(ticker);
    const targetedResult = targetedByTicker.get(ticker) || null;
    const startaResult = startaByTicker.get(ticker) || null;
    const sessions = getSessionCount(history);
    const lastSession = getLastSession(history);
    const marketLagCalendarDays = diffDays(latestMarketSession, lastSession);
    const recent = marketLagCalendarDays !== null && marketLagCalendarDays <= Number(policy.maximumMarketLagCalendarDays || 21);
    const active = entryRaw.active !== false && entryRaw.excludeFromDecision !== true;
    const delisted = entryRaw.instrumentStatus === 'delisted' || history?.instrumentStatus === 'delisted' || targetedResult?.status === 'inactive_delisted';
    const symbolVerified = history?.symbolVerified !== false && entryRaw.symbolVerified !== false;
    const confidence = getConfidence(history);
    const manualAdjustment = manualAdjustmentEvidence(targetedResult);
    const riskyBridge = riskyBridgeEvidence(targetedResult, history, policy);
    const status = determineStatus({ active, delisted, sessions, recent, manualAdjustment, riskyBridge });

    const reasons = [];
    if (!active) reasons.push('instrument_not_active');
    if (delisted) reasons.push('instrument_delisted');
    if (!symbolVerified) reasons.push('symbol_not_verified');
    if (!recent && sessions > 0) reasons.push(`history_stale:${marketLagCalendarDays ?? 'unknown'}_calendar_days`);
    if (sessions < Number(policy.minimumSessionsForDecision || 100)) reasons.push(`sessions_below_decision_minimum:${sessions}`);
    if (confidence < Number(policy.minimumConfidenceForDecision || 65)) reasons.push(`confidence_below_decision_minimum:${confidence}`);
    if (manualAdjustment) reasons.push(manualAdjustment.reason);
    if (riskyBridge) reasons.push(`${riskyBridge.reason}:${riskyBridge.closeDifferencePct}%`);

    const decisionEligible =
      status === 'complete_recent' &&
      active &&
      !delisted &&
      symbolVerified &&
      confidence >= Number(policy.minimumConfidenceForDecision || 65);

    const paperTradingEligible =
      ['complete_recent', 'partial_recent'].includes(status) &&
      active &&
      !delisted &&
      symbolVerified &&
      confidence >= Number(policy.minimumConfidenceForDecision || 65);

    const verificationSources = Array.isArray(history?.verificationSources) ? history.verificationSources : [];
    const independentVerification = history?.officiallyVerifiedLatestSession === true || verificationSources.length >= 2;
    const highConfidenceEligible =
      decisionEligible &&
      independentVerification &&
      confidence >= Number(policy.minimumConfidenceForHighConfidence || 90);

    items.push({
      ticker,
      companyNameAr: entryRaw.companyNameAr || entryRaw.nameAr || null,
      companyNameEn: entryRaw.companyNameEn || entryRaw.nameEn || null,
      isin: entryRaw.isin || history?.isin || null,
      active,
      delisted,
      sessions,
      firstSession: history?.firstSession || history?.sessions?.[0]?.date || null,
      lastSession,
      latestMarketSession,
      marketLagCalendarDays,
      recent,
      confidence,
      symbolVerified,
      status,
      statusLabelAr: policy.statuses?.[status] || status,
      decisionEligible,
      paperTradingEligible,
      highConfidenceEligible,
      historicalAnalysisEligible: sessions >= 20,
      monitoringEligible: active && !delisted && sessions > 0,
      independentVerification,
      primarySource: history?.primarySource || null,
      verificationSources,
      reasons: unique(reasons),
      evidence: {
        riskyBridge,
        manualAdjustment,
        targetedStatus: targetedResult?.status || null,
        targetedAction: targetedResult?.action || null,
        startaStatus: startaResult?.status || null,
      },
    });
  }

  items.sort((a, b) => a.ticker.localeCompare(b.ticker));
  const activeItems = items.filter((item) => item.active && !item.delisted);
  const decisionEligibleItems = items.filter((item) => item.decisionEligible);
  const paperEligibleItems = items.filter((item) => item.paperTradingEligible);
  const highConfidenceItems = items.filter((item) => item.highConfidenceEligible);
  const reviewItems = items
    .filter((item) => !item.decisionEligible && item.status !== 'inactive_delisted')
    .sort((a, b) => priorityForStatus(a.status) - priorityForStatus(b.status) || a.ticker.localeCompare(b.ticker));

  const statusCounts = {};
  for (const item of items) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;

  const numericComplete100 = activeItems.filter((item) => item.sessions >= 100).length;
  const decisionSafeComplete100 = decisionEligibleItems.filter((item) => item.sessions >= 100).length;

  const eligibility = {
    schemaVersion: '13.1.0',
    generatedAt,
    latestMarketSession,
    policyVersion: policy.schemaVersion || '13.1.0',
    counts: {
      symbolsMapped: items.length,
      activeSymbols: activeItems.length,
      numericComplete100,
      decisionEligible: decisionEligibleItems.length,
      paperTradingEligible: paperEligibleItems.length,
      highConfidenceEligible: highConfidenceItems.length,
      reviewQueue: reviewItems.length,
      statusCounts,
    },
    items,
  };

  const safetyFindings = [];
  for (const item of items) {
    if (item.evidence?.riskyBridge) {
      safetyFindings.push({
        severity: 'critical',
        ticker: item.ticker,
        finding: 'unsafe_no_overlap_bridge',
        action: 'excluded_from_decision_until_independent_review',
        evidence: item.evidence.riskyBridge,
      });
    }
    if (item.status === 'manual_adjustment_review') {
      safetyFindings.push({
        severity: 'high',
        ticker: item.ticker,
        finding: 'stable_adjustment_factor_requires_review',
        action: 'no_automatic_price_adjustment',
        evidence: item.evidence.manualAdjustment,
      });
    }
    if (item.status === 'complete_but_stale') {
      safetyFindings.push({
        severity: 'high',
        ticker: item.ticker,
        finding: 'complete_history_is_stale',
        action: 'excluded_from_daily_decision',
        evidence: { lastSession: item.lastSession, lagDays: item.marketLagCalendarDays },
      });
    }
  }

  const safetyReport = {
    schemaVersion: '13.1.0',
    generatedAt,
    latestMarketSession,
    policy,
    coverage: {
      denominator: activeItems.length,
      numericComplete100,
      numericComplete100Pct: activeItems.length ? round(numericComplete100 / activeItems.length * 100, 2) : 0,
      decisionSafeComplete100,
      decisionSafeComplete100Pct: activeItems.length ? round(decisionSafeComplete100 / activeItems.length * 100, 2) : 0,
      paperTradingEligible: paperEligibleItems.length,
      highConfidenceEligible: highConfidenceItems.length,
    },
    statusCounts,
    findings: safetyFindings,
    knownCases: Object.fromEntries(
      ['SAIB', 'GPPL', 'NDRL', 'SPHT', 'EGSA', 'FAITA', 'ESRS']
        .map((ticker) => [ticker, items.find((item) => item.ticker === ticker) || null])
    ),
    warnings: [
      'Numeric 100-session completion does not automatically mean decision eligibility.',
      'A no-overlap bridge above the configured price-difference limit is quarantined from the decision engine.',
      'Manual adjustment factors are never applied by this workflow.',
      'High-confidence eligibility requires independent verification and the configured confidence threshold.',
    ],
  };

  const decisionList = {
    schemaVersion: '13.1.0',
    generatedAt,
    latestMarketSession,
    eligibilityType: 'history_data_gate_only',
    warning: 'This list only confirms historical-data eligibility. It is not a buy recommendation.',
    total: decisionEligibleItems.length,
    tickers: decisionEligibleItems.map((item) => item.ticker),
    items: decisionEligibleItems.map((item) => ({
      ticker: item.ticker,
      sessions: item.sessions,
      lastSession: item.lastSession,
      confidence: item.confidence,
      status: item.status,
    })),
  };

  const reviewQueue = {
    schemaVersion: '13.1.0',
    generatedAt,
    latestMarketSession,
    total: reviewItems.length,
    items: reviewItems.map((item) => ({
      ticker: item.ticker,
      status: item.status,
      statusLabelAr: item.statusLabelAr,
      priority: priorityForStatus(item.status),
      sessions: item.sessions,
      lastSession: item.lastSession,
      marketLagCalendarDays: item.marketLagCalendarDays,
      confidence: item.confidence,
      reasons: item.reasons,
      requiredAction: ({
        complete_but_under_review: 'independent_source_or_corporate_action_review',
        manual_adjustment_review: 'official_or_independent_adjustment_review',
        complete_but_stale: 'recent_session_refresh',
        partial_and_stale: 'recent_gap_completion_with_verified_identity',
        partial_recent: 'continue_collection_until_100_sessions',
        insufficient_history: 'approved_backfill',
        missing_history: 'build_history_file',
      })[item.status] || 'manual_review',
      evidence: item.evidence,
    })),
  };

  writeJsonAtomic(ELIGIBILITY_PATH, eligibility);
  writeJsonAtomic(SAFETY_REPORT_PATH, safetyReport);
  writeJsonAtomic(DECISION_LIST_PATH, decisionList);
  writeJsonAtomic(REVIEW_QUEUE_PATH, reviewQueue);

  console.log(`V13.1 eligibility rebuilt for ${items.length} mapped symbols.`);
  console.log(`Active: ${activeItems.length}`);
  console.log(`Numeric complete 100: ${numericComplete100}`);
  console.log(`Decision eligible: ${decisionEligibleItems.length}`);
  console.log(`Paper trading eligible: ${paperEligibleItems.length}`);
  console.log(`High-confidence eligible: ${highConfidenceItems.length}`);
  console.log(`Review queue: ${reviewItems.length}`);
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
