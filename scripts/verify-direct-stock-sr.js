#!/usr/bin/env node
'use strict';

const fs = require('fs');
const market = JSON.parse(fs.readFileSync('data/market.json', 'utf8'));
const decision = JSON.parse(fs.readFileSync('data/today-decision-center.json', 'utf8'));
const report = JSON.parse(fs.readFileSync('data/support-resistance-verification.json', 'utf8'));

const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const validSR = row =>
  num(row?.support1) > 0 &&
  num(row?.resistance1) > 0 &&
  num(row.support1) < num(row.resistance1) &&
  row.supportResistanceVerified === true;

const marketRows = Array.isArray(market.rows) ? market.rows : [];
const verifiedRows = marketRows.filter(validSR);
const badExecutable = (decision.rankedOpportunities || [])
  .filter(row => row.opportunityState === 'EXECUTABLE' && row.srVerified !== true);

if (!report.ok || report.merged <= 0) {
  throw new Error('No verified direct stock support/resistance rows were merged.');
}
if (badExecutable.length) {
  throw new Error(`Executable rows without verified S/R: ${badExecutable.map(row => row.symbol).join(', ')}`);
}

console.log('FINAL DIRECT-STOCK SR VERIFICATION PASSED', {
  marketRows: marketRows.length,
  verifiedRows: verifiedRows.length,
  coveragePct: report.coveragePct,
  ranked: decision.summary?.rankedCount || 0,
  executable: decision.summary?.executionCount || 0,
});
