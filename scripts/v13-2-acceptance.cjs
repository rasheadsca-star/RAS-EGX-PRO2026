#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const PREVIEW = path.join(ROOT, 'preview-v12', 'data');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fail(message) {
  console.error(`ACCEPTANCE FAILURE: ${message}`);
  process.exitCode = 1;
}

const eligibility = readJson(path.join(DATA, 'history-eligibility.json'));
const decision = readJson(path.join(PREVIEW, 'v13-2-decision.json'));
const ledger = readJson(path.join(PREVIEW, 'v13-2-paper-ledger.json'));
const metrics = readJson(path.join(PREVIEW, 'v13-2-paper-metrics.json'));

if (decision.schemaVersion !== '13.2.0') fail('decision schemaVersion must be 13.2.0');
if (ledger.schemaVersion !== '13.2.0') fail('ledger schemaVersion must be 13.2.0');
if (metrics.schemaVersion !== '13.2.0') fail('metrics schemaVersion must be 13.2.0');
if (decision.liveExecutionEnabled !== false) fail('live execution must remain disabled by default');
if (!Array.isArray(decision.topPaperCandidates)) fail('topPaperCandidates must be an array');
if (!Array.isArray(ledger.trades)) fail('ledger trades must be an array');

const eligibilityMap = new Map((eligibility.items || []).map((item) => [item.ticker, item]));
for (const candidate of decision.topPaperCandidates) {
  const item = eligibilityMap.get(candidate.ticker);
  if (!item?.paperTradingEligible) fail(`${candidate.ticker} is shown as paper candidate without V13.1 paper eligibility`);
  if (!candidate.paperPass) fail(`${candidate.ticker} is shown as paper candidate without passing paper gates`);
  if (![candidate.entryLow, candidate.entryHigh, candidate.stopLoss, candidate.target1].every(Number.isFinite)) {
    fail(`${candidate.ticker} has an incomplete explicit plan`);
  }
  if (!(candidate.stopLoss < candidate.entryLow && candidate.entryLow <= candidate.entryHigh && candidate.target1 > candidate.entryHigh)) {
    fail(`${candidate.ticker} has an illogical plan`);
  }
}

for (const candidate of decision.topDecisionCandidates || []) {
  const item = eligibilityMap.get(candidate.ticker);
  if (!item?.decisionEligible) fail(`${candidate.ticker} is shown in decision shortlist without V13.1 decision eligibility`);
  if (!candidate.decisionPass) fail(`${candidate.ticker} is shown in decision shortlist without passing decision gates`);
}

const knownUnsafe = new Set(['SAIB', 'NDRL', 'SPHT', 'EGSA', 'FAITA', 'ESRS']);
for (const ticker of knownUnsafe) {
  if ((decision.topDecisionCandidates || []).some((item) => item.ticker === ticker)) fail(`${ticker} must not enter the decision shortlist`);
  if ((decision.topPaperCandidates || []).some((item) => item.ticker === ticker)) fail(`${ticker} must not enter paper candidates`);
}
const gpplDecision = (decision.topDecisionCandidates || []).some((item) => item.ticker === 'GPPL');
if (gpplDecision) fail('GPPL must not enter decision shortlist before 100 sessions');

const ids = new Set();
for (const trade of ledger.trades) {
  if (ids.has(trade.id)) fail(`duplicate trade id: ${trade.id}`);
  ids.add(trade.id);
  if (String(trade.signalSession).localeCompare(String(ledger.activationSession)) <= 0) {
    fail(`${trade.id} is retroactive or created on activation session`);
  }
  const item = eligibilityMap.get(trade.ticker);
  if (!item?.paperTradingEligible) fail(`${trade.id} uses a ticker not eligible for paper trading`);
  if (!['PENDING', 'OPEN', 'CLOSED', 'EXPIRED'].includes(trade.status)) fail(`${trade.id} has invalid status ${trade.status}`);
  if (!(trade.stopLoss < trade.entryLow && trade.entryLow <= trade.entryHigh && trade.target1 > trade.entryHigh)) {
    fail(`${trade.id} has an illogical stored plan`);
  }
  if (trade.status === 'CLOSED' && !Number.isFinite(trade.netReturnPct)) fail(`${trade.id} closed without net return`);
}

if (metrics.totalTrades !== ledger.trades.length) fail('metrics totalTrades does not match ledger');
if (metrics.closedTrades !== ledger.trades.filter((trade) => trade.status === 'CLOSED').length) fail('metrics closedTrades mismatch');
if (decision.decision.activationSession !== ledger.activationSession) fail('activation session mismatch');

if (!process.exitCode) {
  console.log('V13.2 acceptance tests passed.');
  console.log(`Paper candidates: ${decision.topPaperCandidates.length}`);
  console.log(`Decision candidates: ${(decision.topDecisionCandidates || []).length}`);
  console.log(`Ledger trades: ${ledger.trades.length}`);
}
