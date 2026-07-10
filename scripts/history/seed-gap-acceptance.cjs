#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateSession } = require('./history-validator.cjs');
const { readJson, safeTicker } = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const REPORT_PATH = path.join(DATA, 'history-gap-completion-report.json');
const MIN_IMPROVED = Math.max(0, Number(process.env.GAP_MIN_IMPROVED || 0));

function fail(message) {
  console.error(`V12.7 acceptance failed: ${message}`);
  process.exitCode = 1;
}

function main() {
  const report = readJson(REPORT_PATH, null);
  if (!report || report.schemaVersion !== '12.7.0') {
    fail('missing or invalid data/history-gap-completion-report.json');
    return;
  }

  if (!Array.isArray(report.selectedTickers) || report.selectedTickers.length < 1) {
    fail('report has no selected tickers');
    return;
  }

  const improvedCount = Number(report.counts?.improved || 0);
  if (improvedCount < MIN_IMPROVED) {
    fail(`only ${improvedCount} symbols improved; minimum required is ${MIN_IMPROVED}`);
  }

  const resultByTicker = new Map((report.results || []).map((item) => [safeTicker(item.ticker), item]));
  for (const rawTicker of report.selectedTickers) {
    const ticker = safeTicker(rawTicker);
    const result = resultByTicker.get(ticker);
    if (!result) {
      fail(`${ticker}: missing result record`);
      continue;
    }

    const file = path.join(DATA, 'history', `${ticker}.json`);
    if (!fs.existsSync(file)) {
      fail(`${ticker}: existing seed history file disappeared`);
      continue;
    }

    const document = readJson(file, null);
    const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
    if (!sessions.length) {
      fail(`${ticker}: history became empty`);
      continue;
    }
    if (sessions.length > 100) fail(`${ticker}: more than 100 stored sessions`);

    const dates = sessions.map((item) => item.date);
    if (new Set(dates).size !== dates.length) fail(`${ticker}: duplicated session dates`);
    const sorted = [...dates].sort();
    if (JSON.stringify(sorted) !== JSON.stringify(dates)) fail(`${ticker}: sessions are not ascending`);

    for (const session of sessions) {
      const checked = validateSession(session);
      if (!checked.valid) fail(`${ticker} ${session.date}: ${checked.errors.join(',')}`);
      if (session.primarySource === 'yahoo_gap_completion') {
        const confidence = Number(session.confidence?.overall || 0);
        if (confidence > 75) fail(`${ticker} ${session.date}: gap confidence exceeds 75`);
        if (session.officialVerified) fail(`${ticker} ${session.date}: gap row incorrectly marked official`);
      }
    }

    if (['completed_100_current', 'improved_partial'].includes(result.status)) {
      if (!(Number(result.appendedSessions) > 0)) fail(`${ticker}: improved status without appended sessions`);
      if (document.schemaVersion !== '12.7.0') fail(`${ticker}: improved file does not have schemaVersion 12.7.0`);
      if (document.symbolVerification?.policy !== 'seed_overlap_continuity') fail(`${ticker}: missing overlap continuity policy`);
      if (!document.gapCompletion?.overlap?.verified) fail(`${ticker}: gap completion lacks verified overlap`);
    }
  }

  const summary = readJson(path.join(DATA, 'history-summary.json'), null);
  if (!summary?.coverage) fail('history-summary.json was not rebuilt');

  if (!process.exitCode) {
    console.log(`V12.7 acceptance passed: selected=${report.selectedTickers.length}, improved=${improvedCount}, failed=${report.counts?.failed || 0}`);
  }
}

main();
