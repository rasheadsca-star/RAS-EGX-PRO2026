#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

function read(relative) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) throw new Error(`Missing ${relative}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function fail(message) {
  console.error(`V13.11 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const required = [
  'data/v13-11-daily-decision-policy.json',
  'data/quant/daily-decision-workspace-v13-11.json',
  'data/quant/stock-intelligence-index.json',
  'data/quant/portfolio-risk-universe.json',
  'preview-v13/app/daily-decision.html',
  'preview-v13/app/index.html',
  'scripts/quant/v13-11-daily-decision.cjs'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}

const output = read('data/quant/daily-decision-workspace-v13-11.json');
const tiered = read('data/quant/tiered-confidence-recommendations-v13-10.json');

if (output.schemaVersion !== '13.11.0') fail(`unexpected schema ${output.schemaVersion}`);
if (output.liveExecutionEnabled !== false) fail('live execution must remain false');
if (output.automaticPaperRegistration !== false) fail('automatic paper registration must remain false');
if (!Array.isArray(output.candidates)) fail('candidates must be an array');
if (!Array.isArray(output.topCandidates)) fail('topCandidates must be an array');
if (output.topCandidates.length > 3) fail('topCandidates exceeds 3');

const tickers = output.candidates.map(x => x.ticker);
if (new Set(tickers).size !== tickers.length) fail('duplicate tickers found');

for (let i = 1; i < output.candidates.length; i += 1) {
  const previous = output.candidates[i - 1];
  const current = output.candidates[i];
  if (previous.tierPriority < current.tierPriority) fail('tier ordering is invalid');
  if (previous.tierPriority === current.tierPriority && Number(previous.decisionScore) < Number(current.decisionScore)) {
    fail('score ordering is invalid');
  }
}

for (const item of output.candidates) {
  if (item.tier === 'TIER_B_PRIORITY_WATCH' && item.actionablePaper !== false) {
    fail(`${item.ticker} Tier B cannot be actionable`);
  }
  if (item.actionablePaper && item.planValid) {
    if (!(Number(item.plan.entryHigh) > Number(item.plan.stopLoss))) fail(`${item.ticker} invalid entry/stop`);
  }
  if (item.stockDetailPath !== `../../data/quant/stocks/${item.ticker}.json`) {
    fail(`${item.ticker} invalid stock detail path`);
  }
}

const strictOriginal = (tiered.strictPaperCandidates || []).map(x => x.ticker).sort();
const strictOutput = output.candidates.filter(x => x.tier === 'STRICT_PAPER').map(x => x.ticker).sort();
if (JSON.stringify(strictOriginal) !== JSON.stringify(strictOutput)) {
  fail('strict candidates changed');
}

const page = fs.readFileSync(path.join(ROOT, 'preview-v13/app/daily-decision.html'), 'utf8');
for (const text of [
  'V13.11',
  'قرار اليوم',
  'أفضل 3 فرص',
  'الرسم البياني',
  'خطة الدخول والمخاطر',
  'حفظ في سجل القرارات'
]) {
  if (!page.includes(text)) fail(`daily page missing ${text}`);
}
if (page.length < 10000) fail('daily page unexpectedly small');
if (/navigator\.serviceWorker|service-worker\.js/.test(page)) fail('daily page must not modify service worker');

const index = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const text of ['EGX Pro V13.11', 'daily-decision.html', 'قرار اليوم V13.11']) {
  if (!index.includes(text)) fail(`index missing ${text}`);
}
if (!index.includes('class="view active" id="view-daily1311"')) fail('V13.11 is not the default view');

console.log('V13.11 acceptance tests passed.');
