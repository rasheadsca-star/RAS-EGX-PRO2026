#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const MARKET_PATH = 'data/market.json';
const SOURCE_PATH = 'data/mubasher-support-resistance-direct.json';
const REPORT_PATH = 'data/support-resistance-verification.json';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function symbol(value) {
  return String(value || '').toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function validSR(row) {
  return num(row?.support1) > 0 &&
    num(row?.resistance1) > 0 &&
    num(row.support1) < num(row.resistance1);
}
function clearOld(row) {
  row.support1 = null;
  row.support2 = null;
  row.resistance1 = null;
  row.resistance2 = null;
  row.pivot = null;
  row.pivotPoint = null;
  row.supportResistanceSource = null;
  row.supportResistanceUpdatedAt = null;
  row.supportResistanceVerified = false;
  if (row.sources?.mubasherDirectStockPage) delete row.sources.mubasherDirectStockPage;
}

const market = readJson(MARKET_PATH);
const source = readJson(SOURCE_PATH);
if (!source.ok || !Array.isArray(source.rows)) {
  throw new Error('Direct Mubasher S/R source is invalid.');
}

const marketRows = Array.isArray(market.rows) ? market.rows : [];
const bySymbol = new Map(source.rows.filter(validSR).map(row => [symbol(row.symbol), row]));

let merged = 0;
let unmatched = 0;
for (const row of marketRows) {
  clearOld(row);
  const sr = bySymbol.get(symbol(row.symbol));
  if (!sr) {
    unmatched += 1;
    continue;
  }

  row.pivot = num(sr.pivot);
  row.pivotPoint = row.pivot;
  row.support1 = num(sr.support1);
  row.support2 = num(sr.support2);
  row.resistance1 = num(sr.resistance1);
  row.resistance2 = num(sr.resistance2);
  row.supportResistanceSource = 'Mubasher individual stock page';
  row.supportResistanceUpdatedAt = sr.fetchedAt || source.generatedAt;
  row.supportResistanceVerified = true;
  row.sources = row.sources || {};
  row.sources.mubasherDirectStockPage = {
    currentRunOk: true,
    source: 'Mubasher individual stock support-resistance page',
    sourceUrl: sr.sourceUrl,
    fetchedAt: sr.fetchedAt,
    updatedAtText: sr.updatedAtText,
    pivot: row.pivot,
    support1: row.support1,
    support2: row.support2,
    resistance1: row.resistance1,
    resistance2: row.resistance2,
  };

  row.missingCoreFields = (row.missingCoreFields || [])
    .filter(value => !String(value).includes('الدعم والمقاومة'));
  if (row.mubasherPrimaryFeed) {
    row.mubasherPrimaryFeed.hasSupportResistance = true;
    row.mubasherPrimaryFeed.missing = (row.mubasherPrimaryFeed.missing || [])
      .filter(value => !String(value).includes('الدعم والمقاومة'));
    row.mubasherPrimaryFeed.supportResistance = {
      parsed: true,
      source: 'individual-stock-page',
      url: sr.sourceUrl,
      lastUpdate: sr.fetchedAt,
      pivotPoint: row.pivot,
      support1: row.support1,
      support2: row.support2,
      resistance1: row.resistance1,
      resistance2: row.resistance2,
    };
  }

  if (row.goalQualityGate) row.goalQualityGate.supportResistanceOk = true;
  merged += 1;
}

const validCount = marketRows.filter(validSR).length;
const coveragePct = marketRows.length
  ? Number((validCount / marketRows.length * 100).toFixed(2))
  : 0;

const report = {
  ok: merged > 0,
  generatedAt: new Date().toISOString(),
  method: source.method,
  sourceRows: source.rows.length,
  totalMarketRows: marketRows.length,
  merged,
  unmatched,
  validCount,
  coveragePct,
};

market.rows = marketRows;
market.supportResistanceSummary = report;
market.supportResistanceCoveragePct = coveragePct;

writeJson(MARKET_PATH, market);
writeJson(REPORT_PATH, report);

console.log(report);
if (!report.ok) process.exit(3);
