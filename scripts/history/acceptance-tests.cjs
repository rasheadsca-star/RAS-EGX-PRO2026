#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { cairoDate, readJson, safeTicker } = require('./lib/utils.cjs');
const { validateSession } = require('./history-validator.cjs');

const repoRoot = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const minSuccess = Math.max(1, Number(process.env.HISTORY_MIN_SUCCESS || process.argv[2] || 1));
const mode = String(process.env.HISTORY_MODE || 'sample');
const repairTicker = safeTicker(process.env.HISTORY_TICKER || '');
const mapRaw = readJson(path.join(repoRoot, 'data', 'symbol-map.json'), null);
if (!mapRaw) throw new Error('Missing data/symbol-map.json');
const allEntries = (Array.isArray(mapRaw) ? mapRaw : Object.values(mapRaw)).filter((entry) => entry.active !== false);
const lastRun = readJson(path.join(repoRoot, 'data', 'history-last-run.json'), null);

let selectedTickers = Array.isArray(lastRun?.selectedTickers) ? lastRun.selectedTickers.map(safeTicker).filter(Boolean) : [];
if (!selectedTickers.length) {
  if (mode === 'repair_symbol') selectedTickers = [repairTicker];
  else if (mode === 'sample') selectedTickers = allEntries.filter((entry) => entry.sample).slice(0, 10).map((entry) => safeTicker(entry.ticker));
  else selectedTickers = allEntries.slice(0, Math.max(minSuccess, 20)).map((entry) => safeTicker(entry.ticker));
}

if (!selectedTickers.length) throw new Error(`No symbols selected for acceptance mode=${mode}`);

const fatalErrors = [];
const warnings = [];
let successful = 0;
for (const ticker of selectedTickers) {
  const file = path.join(repoRoot, 'data', 'history', `${ticker}.json`);
  if (!fs.existsSync(file)) {
    warnings.push(`${ticker}: history file missing`);
    continue;
  }
  const document = readJson(file, null);
  const sessions = document?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    fatalErrors.push(`${ticker}: sessions empty`);
    continue;
  }
  if (sessions.length > 100) fatalErrors.push(`${ticker}: more than 100 stored sessions`);
  const dates = sessions.map((session) => session.date);
  if (new Set(dates).size !== dates.length) fatalErrors.push(`${ticker}: duplicate dates`);
  if ([...dates].sort().join('|') !== dates.join('|')) fatalErrors.push(`${ticker}: dates not ascending`);
  if (dates.some((date) => date > cairoDate())) fatalErrors.push(`${ticker}: future date`);
  for (const session of sessions) {
    const result = validateSession(session);
    if (!result.valid) fatalErrors.push(`${ticker} ${session.date}: ${result.errors.join(',')}`);
    if (session.volume === 0 && (session.warnings || []).includes('volume_missing')) {
      fatalErrors.push(`${ticker} ${session.date}: missing volume was converted to zero`);
    }
  }
  if (!document.symbolVerified) fatalErrors.push(`${ticker}: Yahoo symbol identity not verified`);
  successful += 1;
}

const summary = readJson(path.join(repoRoot, 'data', 'history-summary.json'), null);
if (!summary) fatalErrors.push('history-summary.json missing');
else {
  const denominator = Number(summary.coverage?.denominator || 0);
  if (denominator !== allEntries.length) fatalErrors.push(`summary denominator ${denominator} does not match active map ${allEntries.length}`);
  if (summary.coverage?.sessions20Count > denominator) fatalErrors.push('summary sessions20Count exceeds denominator');
  if (summary.coverage?.sessions50Count > denominator) fatalErrors.push('summary sessions50Count exceeds denominator');
  if (summary.coverage?.sessions100Count > denominator) fatalErrors.push('summary sessions100Count exceeds denominator');
  if (summary.coverage?.sessions100Count > summary.coverage?.sessions50Count) fatalErrors.push('summary sessions100Count exceeds sessions50Count');
  if (summary.coverage?.sessions50Count > summary.coverage?.sessions20Count) fatalErrors.push('summary sessions50Count exceeds sessions20Count');
}

const state = readJson(path.join(repoRoot, 'data', 'history-batch-state.json'), null);
if (!state) fatalErrors.push('history-batch-state.json missing');
else {
  if (Number(state.totalSymbols) !== allEntries.length) fatalErrors.push('batch state totalSymbols does not match map');
  if (!(Number(state.totalBatches) >= 1)) fatalErrors.push('batch state totalBatches invalid');
}

if (successful < minSuccess) {
  fatalErrors.unshift(`Only ${successful} selected symbols have valid files; minimum required is ${minSuccess}`);
}

if (warnings.length) {
  console.warn('V12.3 acceptance warnings:');
  for (const warning of warnings) console.warn(`- ${warning}`);
}
if (fatalErrors.length) {
  console.error('V12.3 acceptance tests failed:');
  for (const error of fatalErrors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`V12.3 acceptance tests passed for ${successful}/${selectedTickers.length} selected symbols. Full mapped denominator: ${allEntries.length}.`);
