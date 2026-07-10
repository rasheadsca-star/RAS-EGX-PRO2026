#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');

function readJson(name) {
  const filePath = path.join(DATA, name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`ACCEPTANCE FAILURE: ${message}`);
  process.exitCode = 1;
}

function itemByTicker(items, ticker) {
  return items.find((item) => item.ticker === ticker) || null;
}

const eligibility = readJson('history-eligibility.json');
const safety = readJson('history-safety-report.json');
const decision = readJson('decision-eligible-symbols.json');
const review = readJson('history-review-queue.json');

if (eligibility.schemaVersion !== '13.1.0') fail('eligibility schemaVersion must be 13.1.0');
if (safety.schemaVersion !== '13.1.0') fail('safety report schemaVersion must be 13.1.0');
if (decision.schemaVersion !== '13.1.0') fail('decision list schemaVersion must be 13.1.0');
if (review.schemaVersion !== '13.1.0') fail('review queue schemaVersion must be 13.1.0');

if (!Array.isArray(eligibility.items) || !eligibility.items.length) fail('eligibility items are empty');
if (!Array.isArray(decision.tickers)) fail('decision tickers must be an array');
if (!Array.isArray(review.items)) fail('review queue items must be an array');

const decisionSet = new Set(decision.tickers);
for (const item of eligibility.items) {
  if (item.decisionEligible !== decisionSet.has(item.ticker)) {
    fail(`decision list mismatch for ${item.ticker}`);
  }
  if (item.decisionEligible && item.status !== 'complete_recent') {
    fail(`${item.ticker} is decision eligible with unsafe status ${item.status}`);
  }
  if (item.decisionEligible && (!item.active || item.delisted || !item.recent || item.sessions < 100)) {
    fail(`${item.ticker} violates the decision eligibility gate`);
  }
  if (item.highConfidenceEligible && !item.decisionEligible) {
    fail(`${item.ticker} is high-confidence eligible without decision eligibility`);
  }
}

const known = {
  SAIB: itemByTicker(eligibility.items, 'SAIB'),
  GPPL: itemByTicker(eligibility.items, 'GPPL'),
  NDRL: itemByTicker(eligibility.items, 'NDRL'),
  SPHT: itemByTicker(eligibility.items, 'SPHT'),
  EGSA: itemByTicker(eligibility.items, 'EGSA'),
  FAITA: itemByTicker(eligibility.items, 'FAITA'),
  ESRS: itemByTicker(eligibility.items, 'ESRS'),
};

if (known.SAIB) {
  if (known.SAIB.decisionEligible) fail('SAIB must be excluded after the unsafe no-overlap bridge');
  if (known.SAIB.status !== 'complete_but_under_review') fail(`SAIB status must be complete_but_under_review, got ${known.SAIB.status}`);
}
if (known.GPPL) {
  if (known.GPPL.sessions < 50 || known.GPPL.sessions >= 100) fail(`GPPL expected partial history, got ${known.GPPL.sessions}`);
  if (known.GPPL.status !== 'partial_recent') fail(`GPPL status must be partial_recent, got ${known.GPPL.status}`);
  if (!known.GPPL.paperTradingEligible) fail('GPPL should remain paper-trading eligible');
  if (known.GPPL.decisionEligible) fail('GPPL must not be decision eligible before 100 sessions');
}
if (known.NDRL) {
  if (known.NDRL.status !== 'complete_but_stale') fail(`NDRL status must be complete_but_stale, got ${known.NDRL.status}`);
  if (known.NDRL.decisionEligible) fail('NDRL must be excluded from daily decisions while stale');
}
if (known.SPHT) {
  if (known.SPHT.status !== 'partial_and_stale') fail(`SPHT status must be partial_and_stale, got ${known.SPHT.status}`);
  if (known.SPHT.decisionEligible) fail('SPHT must be excluded from decisions while partial and stale');
}
for (const ticker of ['EGSA', 'FAITA']) {
  if (known[ticker]) {
    if (known[ticker].status !== 'manual_adjustment_review') fail(`${ticker} must require manual adjustment review`);
    if (known[ticker].decisionEligible || known[ticker].paperTradingEligible) fail(`${ticker} must be quarantined until reviewed`);
  }
}
if (known.ESRS) {
  if (known.ESRS.status !== 'inactive_delisted') fail(`ESRS status must be inactive_delisted, got ${known.ESRS.status}`);
  if (known.ESRS.decisionEligible || known.ESRS.paperTradingEligible) fail('ESRS must not be eligible');
}

if (eligibility.counts.decisionEligible !== decision.total) fail('decision eligible count mismatch');
if (review.total !== review.items.length) fail('review queue total mismatch');
if (safety.coverage.numericComplete100 < safety.coverage.decisionSafeComplete100) {
  fail('decision-safe complete count cannot exceed numeric complete count');
}

if (!process.exitCode) {
  console.log('V13.1 acceptance tests passed.');
  console.log(`Decision eligible: ${decision.total}`);
  console.log(`Review queue: ${review.total}`);
}
