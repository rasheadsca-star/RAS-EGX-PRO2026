#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const Q = path.join(ROOT, 'data', 'quant');
const required = [
  'adaptive-strategy-calibration.json',
  'strategy-health.json',
  'paper-recommendation-ledger.json',
  'paper-recommendation-metrics.json',
  'adaptive-daily-recommendations.json',
  'v13-5-audit.json'
];

function fail(message) {
  console.error(`V13.5 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

function read(name) {
  const file = path.join(Q, name);
  if (!fs.existsSync(file) || fs.statSync(file).size < 20) fail(`missing or empty ${name}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`invalid JSON ${name}: ${error.message}`); }
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const docs = Object.fromEntries(required.map(name => [name, read(name)]));
for (const [name, doc] of Object.entries(docs)) {
  if (doc.schemaVersion !== '13.5.0') fail(`${name} has unexpected schema ${doc.schemaVersion}`);
  if (doc.liveExecutionEnabled !== false && name !== 'v13-5-audit.json') fail(`${name} must keep live execution disabled`);
}

const calibration = docs['adaptive-strategy-calibration.json'];
const health = docs['strategy-health.json'];
const ledger = docs['paper-recommendation-ledger.json'];
const metrics = docs['paper-recommendation-metrics.json'];
const recs = docs['adaptive-daily-recommendations.json'];
const audit = docs['v13-5-audit.json'];

if (ledger.activationMode !== 'BASELINE_ONLY_NO_RETROACTIVE_SIGNALS') fail('ledger activation mode is unsafe');
if (!Array.isArray(ledger.signals)) fail('ledger signals are missing');
if (!Array.isArray(calibration.strategies) || calibration.strategies.length !== 3) fail('three calibrated strategies are required');
if (!Array.isArray(health.strategies) || health.strategies.length !== 3) fail('three strategy health rows are required');
if (!audit.controls?.noLookahead || !audit.controls?.noRetroactiveSignalCreation || !audit.controls?.immutableOriginalPlans) fail('core safety controls are missing');
if (audit.controls?.sameBarConflictRule !== 'stop_first') fail('same-bar rule must be stop_first');
if (!audit.controls?.entryStartsNextSession) fail('entry must start after the signal session');

const allowedStrategyStates = new Set(['ACTIVE_PAPER', 'ACTIVE_WITH_CAUTION', 'RESEARCH_ONLY', 'PAUSED_BY_PAPER_CIRCUIT_BREAKER']);
for (const strategy of health.strategies) {
  if (!allowedStrategyStates.has(strategy.status)) fail(`unsupported strategy state ${strategy.status}`);
  if (!(Number(strategy.minimumAdaptivePaperScore) >= 68 && Number(strategy.minimumAdaptivePaperScore) <= 85)) fail(`${strategy.strategyId} score threshold is outside safety bounds`);
  if (strategy.status === 'PAUSED_BY_PAPER_CIRCUIT_BREAKER' && strategy.riskScale !== 0) fail(`${strategy.strategyId} paused strategy must have zero risk scale`);
}

const healthMap = new Map(health.strategies.map(s => [s.strategyId, s]));
const blocked = new Set(['SAIB', 'NDRL', 'SPHT', 'EGSA', 'FAITA', 'ESRS']);
for (const candidate of recs.paperCandidates || []) {
  if (blocked.has(String(candidate.ticker || '').toUpperCase())) fail(`blocked ticker leaked into adaptive candidates: ${candidate.ticker}`);
  const h = healthMap.get(candidate.strategyId);
  if (!h || !['ACTIVE_PAPER', 'ACTIVE_WITH_CAUTION'].includes(h.status)) fail(`${candidate.ticker} uses a non-active strategy`);
  if (Number(candidate.recommendationScore) < Number(h.minimumAdaptivePaperScore)) fail(`${candidate.ticker} is below adaptive score threshold`);
  if (candidate.status !== 'PAPER_READY') fail(`${candidate.ticker} has unsafe adaptive status ${candidate.status}`);
  if (!(Number(candidate.adaptive?.proximityPct) >= 0 && Number(candidate.adaptive?.proximityPct) <= 100)) fail(`${candidate.ticker} has invalid proximity`);
}

for (const candidate of recs.conditionalWatch || []) {
  if (!['NEAR_TRIGGER', 'CONDITIONAL_WATCH'].includes(candidate.status)) fail(`${candidate.ticker} has invalid watch status`);
  if (!(Number(candidate.adaptive?.proximityPct) >= 0 && Number(candidate.adaptive?.proximityPct) <= 100)) fail(`${candidate.ticker} has invalid watch proximity`);
  if (!Array.isArray(candidate.adaptive?.missingRequirementsAr)) fail(`${candidate.ticker} missing requirements are unavailable`);
}

const ids = new Set();
for (const signal of ledger.signals) {
  if (ids.has(signal.id)) fail(`duplicate signal id ${signal.id}`);
  ids.add(signal.id);
  if (blocked.has(String(signal.ticker || '').toUpperCase())) fail(`blocked ticker leaked into ledger: ${signal.ticker}`);
  if (signal.liveExecutionEnabled !== false) fail(`${signal.id} must keep live execution disabled`);
  if (!['PENDING_ENTRY', 'OPEN', 'CLOSED', 'CANCELLED', 'EXPIRED'].includes(signal.status)) fail(`${signal.id} has unsupported status ${signal.status}`);
  if (!(signal.signalDate > ledger.activationSession || ledger.activationMode !== 'BASELINE_ONLY_NO_RETROACTIVE_SIGNALS')) fail(`${signal.id} was created retroactively on or before activation`);
  const p = signal.originalPlan || {};
  if (![p.entryLow, p.entryHigh, p.stopLoss, p.target1, p.target2].every(Number.isFinite)) fail(`${signal.id} has incomplete original plan`);
  if (!(p.entryLow <= p.entryHigh && p.stopLoss < p.entryLow && p.target1 > p.entryHigh && p.target2 > p.target1)) fail(`${signal.id} has illogical original plan`);
  const expected = crypto.createHash('sha256').update(JSON.stringify({ ticker: signal.ticker, strategyId: signal.strategyId, signalDate: signal.signalDate, plan: signal.originalPlan })).digest('hex');
  if (signal.originalPlanFingerprint !== expected) fail(`${signal.id} original plan fingerprint mismatch`);
  if (signal.entryDate && !(signal.entryDate > signal.signalDate)) fail(`${signal.id} entered on or before its signal date`);
  if (signal.status === 'OPEN' && (!signal.entryDate || !Number.isFinite(Number(signal.entryPrice)))) fail(`${signal.id} open trade lacks entry`);
  if (signal.status === 'CLOSED' && (!signal.exitDate || !Number.isFinite(Number(signal.exitPrice)) || !Number.isFinite(Number(signal.netReturnPct)))) fail(`${signal.id} closed trade is incomplete`);
  if (signal.sameBarConflict && signal.outcome !== 'STOP_FIRST_SAME_BAR') fail(`${signal.id} violated stop-first same-bar rule`);
  for (const [horizon, snapshot] of Object.entries(signal.snapshots || {})) {
    if (![1, 3, 5, 10].includes(Number(horizon))) fail(`${signal.id} has unsupported snapshot horizon ${horizon}`);
    if (!snapshot.sessionDate || !Number.isFinite(Number(snapshot.netReturnPct))) fail(`${signal.id} has invalid snapshot ${horizon}`);
  }
}

if (metrics.sessionId !== recs.sessionId || ledger.lastProcessedSession !== recs.sessionId) fail('session alignment between ledger, metrics and recommendations failed');
if (Number(metrics.overall?.totalSignals) !== ledger.signals.length) fail('overall signal count does not match ledger');
if (Number(recs.counts?.adaptivePaperCandidates) !== (recs.paperCandidates || []).length) fail('adaptive paper count mismatch');
if (Number(recs.counts?.conditionalWatch) !== (recs.conditionalWatch || []).length) fail('conditional watch count mismatch');
if (audit.activation?.baselineOnly && (audit.processing?.newSignalIds || []).length) fail('activation run created retroactive signals');

console.log('V13.5 acceptance tests passed.');
console.log(`Strategies active: ${health.activeStrategies}; paused: ${health.pausedStrategies}`);
console.log(`Adaptive paper candidates: ${(recs.paperCandidates || []).length}`);
console.log(`Conditional watch: ${(recs.conditionalWatch || []).length}`);
console.log(`Ledger signals: ${ledger.signals.length}`);
