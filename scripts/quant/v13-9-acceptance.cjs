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
  console.error(`V13.9 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const required = [
  'scripts/quant/v13-4-quant-engine.cjs',
  'scripts/quant/v13-9-recommendation-audit.cjs',
  'data/v13-9-audit-calibration-policy.json',
  'data/quant/recommendation-gate-trace-v13-9.json',
  'data/quant/recommendation-engine-audit-v13-9.json',
  'data/quant/calibrated-shadow-recommendations-v13-9.json',
  'preview-v13/app/recommendation-audit.html',
  'preview-v13/app/index.html'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}

const patched = fs.readFileSync(path.join(ROOT, 'scripts/quant/v13-4-quant-engine.cjs'), 'utf8');
if (!patched.includes("compounded_equity_peak_to_trough")) fail('V13.4 drawdown patch is missing');
if (!patched.includes("recommendation-gate-trace-v13-9.json")) fail('V13.9 gate trace is missing');

const audit = read('data/quant/recommendation-engine-audit-v13-9.json');
const shadow = read('data/quant/calibrated-shadow-recommendations-v13-9.json');
const model = read('data/quant/recommendation-model.json');

if (audit.schemaVersion !== '13.9.0') fail(`unexpected audit schema ${audit.schemaVersion}`);
if (shadow.schemaVersion !== '13.9.0') fail(`unexpected shadow schema ${shadow.schemaVersion}`);
if (audit.liveExecutionEnabled !== false || shadow.liveExecutionEnabled !== false) fail('live execution must remain false');
if (audit.productionThresholdsRelaxed !== false) fail('production thresholds must not be relaxed');
if (audit.productionRecommendationsOverwritten !== false) fail('production recommendations must not be overwritten');
if (shadow.automaticRegistration !== false) fail('experimental signals must not auto-register');
if (!Array.isArray(audit.funnel) || audit.funnel.length < 8) fail('audit funnel is incomplete');
if (!Array.isArray(audit.strategies)) fail('strategy audit missing');
if (!Array.isArray(shadow.candidates)) fail('shadow candidates must be an array');

for (const strategy of model.strategies || []) {
  const m = strategy.validationMetrics || {};
  if (m.drawdownMethod !== 'compounded_equity_peak_to_trough') {
    fail(`${strategy.strategyId} uses ${m.drawdownMethod || 'unknown'} drawdown`);
  }
  if (!(Number(m.maxDrawdownPct) >= 0 && Number(m.maxDrawdownPct) <= 100)) {
    fail(`${strategy.strategyId} invalid maximum drawdown ${m.maxDrawdownPct}`);
  }
}

for (const candidate of shadow.candidates) {
  if (candidate.status !== 'EXPERIMENTAL_PAPER_SHADOW') fail(`${candidate.ticker} invalid status`);
  if (candidate.automaticRegistration !== false) fail(`${candidate.ticker} automatic registration enabled`);
  if (!(Number(candidate.plan?.entryHigh) > Number(candidate.plan?.stopLoss))) fail(`${candidate.ticker} invalid plan`);
}

const page = fs.readFileSync(path.join(ROOT, 'preview-v13/app/recommendation-audit.html'), 'utf8');
if (page.length < 7000) fail('audit page unexpectedly small');
for (const text of ['V13.9', 'قمع القرار', 'تدقيق الاستراتيجيات', 'الفرص التجريبية']) {
  if (!page.includes(text)) fail(`audit page missing ${text}`);
}

const index = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const text of ['EGX Pro V13.9', 'recommendation-audit.html', 'تدقيق محرك التوصيات']) {
  if (!index.includes(text)) fail(`unified index missing ${text}`);
}

console.log('V13.9 acceptance tests passed.');
