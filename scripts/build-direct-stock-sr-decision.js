#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function rowsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.items)) return value.items;
  return [];
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
    num(row.support1) < num(row.resistance1) &&
    row.supportResistanceVerified === true;
}
function first(...values) {
  return values.find(value => value !== null && value !== undefined && value !== '') ?? null;
}

const market = read('data/market.json', { rows: [] });
const ranking = read('data/final-opportunity-ranking.json', { rows: [] });
const marketRows = rowsOf(market);
const rankingRows = rowsOf(ranking);
const marketMap = new Map(marketRows.map(row => [symbol(row.symbol), row]));

const opportunities = rankingRows
  .filter(row => symbol(row.symbol) && num(row.price) > 0)
  .map((row, index) => {
    const marketRow = marketMap.get(symbol(row.symbol)) || {};
    const srVerified = validSR(marketRow);
    const otherGateAllows = row.executionAllowed === true || marketRow.executionAllowed === true;
    const executionAllowed = Boolean(srVerified && otherGateAllows && row.precisionRisk !== true);
    const blocked = row.grade === 'Blocked' || row.precisionRisk === true;
    const opportunityState = executionAllowed
      ? 'EXECUTABLE'
      : blocked
        ? 'BLOCKED'
        : 'CONDITIONAL_WATCH';

    return {
      rank: index + 1,
      symbol: symbol(row.symbol),
      name: first(row.name, marketRow.name_ar, marketRow.name, marketRow.name_en, row.symbol),
      grade: row.grade || 'Watch',
      opportunityState,
      label: executionAllowed ? 'تنفيذ مشروط' : blocked ? 'مستبعد' : 'مراقبة مشروطة',
      price: num(first(row.price, marketRow.price, marketRow.lastPrice)),
      entryFrom: num(first(row.entryFrom, row.entryLow, row.entry)),
      entryTo: num(first(row.entryTo, row.entryHigh, row.entry)),
      target1: num(row.target1),
      target2: num(row.target2),
      stopLoss: num(row.stopLoss),
      support1: num(marketRow.support1),
      support2: num(marketRow.support2),
      resistance1: num(marketRow.resistance1),
      resistance2: num(marketRow.resistance2),
      pivot: num(first(marketRow.pivot, marketRow.pivotPoint)),
      srVerified,
      provisionalPlan: !srVerified,
      confidence: Math.round(num(first(row.targetProbability, row.finalScore, row.confidence)) || 0),
      finalScore: num(row.finalScore),
      targetProbability: num(row.targetProbability),
      rr: num(first(row.rr, row.riskReward)),
      executionAllowed,
      monitorOnly: !executionAllowed,
      why: executionAllowed
        ? 'اجتازت دعم/مقاومة مباشر وبقية بوابات التنفيذ الحالية.'
        : srVerified
          ? 'الدعم والمقاومة موثقان، لكن بقية بوابات التنفيذ لم تكتمل.'
          : 'لا توجد مستويات دعم ومقاومة موثقة لهذا السهم في التشغيل الحالي.',
      supportResistanceSource: marketRow.supportResistanceSource || null,
      supportResistanceUpdatedAt: marketRow.supportResistanceUpdatedAt || null,
    };
  })
  .sort((a, b) => {
    const stateRank = { EXECUTABLE: 3, CONDITIONAL_WATCH: 2, BLOCKED: 1 };
    return stateRank[b.opportunityState] - stateRank[a.opportunityState] ||
      b.confidence - a.confidence ||
      (b.finalScore || 0) - (a.finalScore || 0);
  })
  .map((row, index) => ({ ...row, rank: index + 1 }))
  .slice(0, 100);

const executable = opportunities.filter(row => row.opportunityState === 'EXECUTABLE');
const watch = opportunities.filter(row => row.opportunityState === 'CONDITIONAL_WATCH');
const blocked = opportunities.filter(row => row.opportunityState === 'BLOCKED');
const srCount = marketRows.filter(validSR).length;
const srCoverage = marketRows.length
  ? Number((srCount / marketRows.length * 100).toFixed(2))
  : 0;

const output = {
  ok: true,
  engine: 'direct_mubasher_stock_pages_v15_3_3',
  generatedAt: new Date().toISOString(),
  mainDecision: executable.length
    ? `توجد ${executable.length} فرصة تنفيذية مشروطة بعد دمج دعم ومقاومة مباشر`
    : `توجد ${opportunities.length} فرصة مرتبة للمتابعة ولا توجد توصية تنفيذية آمنة الآن`,
  caution: 'الدعم والمقاومة من صفحات كل سهم في مباشر. التنفيذ يظل مشروطًا بالسعر والسيولة والجودة.',
  summary: {
    rankedCount: opportunities.length,
    executionCount: executable.length,
    conditionalWatchCount: watch.length,
    blockedCount: blocked.length,
    marketRows: marketRows.length,
    supportResistanceVerifiedCount: srCount,
    supportResistanceCoveragePct: srCoverage,
  },
  rankedOpportunities: opportunities,
  executableOpportunities: executable.slice(0, 20),
  conditionalWatch: watch.slice(0, 50),
  blockedPreview: blocked.slice(0, 20),
};

write('data/today-decision-center.json', output);
console.log(output.mainDecision, output.summary);
