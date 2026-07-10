#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateSession } = require('./history-validator.cjs');
const { readJson, safeTicker } = require('./lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const report = readJson(path.join(DATA, 'history-starta-gap-report.json'), null);
const config = readJson(path.join(DATA, 'history-starta-gap-config.json'), null);
const mode = String(process.env.STARTA_GAP_MODE || 'safe_apply');
const minimum = Number(process.env.STARTA_GAP_MIN_IMPROVED || 0);
const errors = [];

if (!report || report.schemaVersion !== '12.9.0') errors.push('missing_or_invalid_report');
if (!config || !Array.isArray(config.targets)) errors.push('missing_or_invalid_config');
if (report?.mode !== mode) errors.push(`report_mode_mismatch:${report?.mode}:${mode}`);
if (mode !== 'diagnose' && Number(report?.counts?.improved || 0) < minimum) errors.push(`improved_below_minimum:${report?.counts?.improved || 0}<${minimum}`);

for (const result of report?.results || []) {
  const ticker = safeTicker(result.ticker);
  if (!ticker) { errors.push('result_missing_ticker'); continue; }
  if (result.status !== 'improved') continue;
  const file = path.join(DATA, 'history', `${ticker}.json`);
  if (!fs.existsSync(file)) { errors.push(`${ticker}:history_file_missing`); continue; }
  const document = readJson(file, null);
  const sessions = Array.isArray(document?.sessions) ? document.sessions : [];
  if (!sessions.length || sessions.length > 100) errors.push(`${ticker}:invalid_session_count:${sessions.length}`);
  const dates = sessions.map((item) => item.date);
  if (new Set(dates).size !== dates.length) errors.push(`${ticker}:duplicate_dates`);
  const sorted = [...dates].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(dates)) errors.push(`${ticker}:dates_not_sorted`);
  for (const session of sessions) {
    const checked = validateSession(session);
    if (!checked.valid) errors.push(`${ticker}:${session.date}:${checked.errors.join(',')}`);
  }
  if (document.officiallyVerifiedLatestSession === true) errors.push(`${ticker}:incorrect_official_verification_flag`);
  if (!Array.isArray(document.verificationSources) || !document.verificationSources.includes('starta_egx_database_identity')) errors.push(`${ticker}:missing_source_identity_marker`);
}

if (errors.length) {
  console.error('V12.9 acceptance failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`V12.9 acceptance passed. mode=${mode}; improved=${report?.counts?.improved || 0}; failed=${report?.counts?.failed || 0}`);
