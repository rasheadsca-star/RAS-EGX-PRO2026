#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

function readJson(rel, fallback) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } }
function writeJson(rel, data) { const file = path.join(ROOT, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function num(v, f = null) { if (v === null || v === undefined || v === '') return f; if (typeof v === 'number' && Number.isFinite(v)) return v; const n = Number(String(v).replace(/[,%\s]/g, '').replace(/−/g, '-')); return Number.isFinite(n) ? n : f; }
function avg(a) { const xs = a.filter(x => Number.isFinite(x)); return xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : null; }
function std(a) { const m = avg(a); if (m === null) return null; const xs = a.filter(x => Number.isFinite(x)); return Math.sqrt(xs.reduce((s,x)=>s+(x-m)*(x-m),0)/Math.max(1,xs.length-1)); }
function pctChange(a,b) { return a && b ? ((b-a)/a*100) : null; }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function quantile(xs, q) { const a = xs.filter(Number.isFinite).sort((x,y)=>x-y); if (!a.length) return null; const pos = (a.length - 1) * q; const lo = Math.floor(pos), hi = Math.ceil(pos); return lo === hi ? a[lo] : a[lo] + (a[hi]-a[lo])*(pos-lo); }

const history = readJson('data/history-50.json', { symbols: {} });
const sectorReport = readJson('data/sector-report.json', {});
const sourceHealth = readJson('data/source-health.json', {});

const sectors = new Map();
for (const r of [].concat(sectorReport.sectors || [], sectorReport.sectorRows || [], sectorReport.ranking || [])) {
  if (r && r.sector) sectors.set(r.sector, r);
}

const symbols = [];
for (const [symbol, rawPoints] of Object.entries(history.symbols || {})) {
  const points = Array.isArray(rawPoints) ? rawPoints.filter(p => num(p.close) !== null).sort((a,b)=>String(a.date).localeCompare(String(b.date))) : [];
  if (!points.length) continue;
  const closes = points.map(p => num(p.close)).filter(Number.isFinite);
  const volumes = points.map(p => num(p.volume, 0) || 0);
  const turnovers = points.map(p => num(p.turnover, 0) || 0);
  const returns = closes.slice(1).map((c,i) => pctChange(closes[i], c)).filter(Number.isFinite);
  const last = closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : null;
  const sma20 = avg(closes.slice(-20));
  const sma50 = avg(closes.slice(-50));
  const volPct = std(returns);
  const avgVolume20 = avg(volumes.slice(-20)) || 0;
  const avgTurnover20 = avg(turnovers.slice(-20)) || 0;
  const support = quantile(closes.slice(-50), 0.15);
  const resistance = quantile(closes.slice(-50), 0.85);
  const trendScore = sma20 && sma50 ? clamp((sma20 / sma50 - 1) * 500 + 50, 0, 100) : (closes.length >= 2 ? clamp((pctChange(closes[0], last) || 0) + 50, 0, 100) : 50);
  const liquidityScore = clamp(Math.log10(Math.max(1, avgTurnover20)) * 9, 0, 100);
  const riskScore = volPct === null ? 50 : clamp(volPct * 12, 0, 100);
  const confidence = clamp((Math.min(50, closes.length) / 50 * 35) + (liquidityScore * .25) + (trendScore * .25) + ((100 - riskScore) * .15), 0, 100);
  let signal = 'مراقبة';
  if (closes.length < 10) signal = 'تاريخ غير كافٍ';
  else if (trendScore >= 65 && liquidityScore >= 45 && riskScore <= 65) signal = 'زخم مؤكد للمراقبة';
  else if (last <= support * 1.03) signal = 'قريب من دعم';
  else if (last >= resistance * 0.97) signal = 'قريب من مقاومة';
  else if (riskScore > 75) signal = 'مرتفع التذبذب';

  symbols.push({
    symbol,
    points: closes.length,
    firstDate: points[0]?.date,
    lastDate: points[points.length - 1]?.date,
    lastPrice: last,
    dailyChangePct: pctChange(prev, last),
    change50Pct: pctChange(closes[0], last),
    sma20,
    sma50,
    support,
    resistance,
    volatilityPct: volPct,
    avgVolume20,
    avgTurnover20,
    trendScore,
    liquidityScore,
    riskScore,
    confidence,
    signal
  });
}

symbols.sort((a,b) => (b.confidence || 0) - (a.confidence || 0));
const report = {
  version: '5.6.0',
  generatedAt: new Date().toISOString(),
  sourceHealth: {
    scanMode: sourceHealth.scanMode,
    lastSuccessAt: sourceHealth.lastSuccessAt,
    totalUniverse: sourceHealth.totalUniverse,
    cacheRows: sourceHealth.cacheRows
  },
  historyStatus: history.status || {},
  summary: {
    symbols: symbols.length,
    withAtLeast20Sessions: symbols.filter(s => s.points >= 20).length,
    with50Sessions: symbols.filter(s => s.points >= 50).length,
    topConfidence: symbols[0]?.symbol || null
  },
  symbols,
  topMonitoring: symbols.filter(s => s.points >= 10).slice(0, 20),
  insufficientHistory: symbols.filter(s => s.points < 10).map(s => s.symbol)
};
writeJson('data/technical-50-report.json', report);
console.log(`technical-50-report generated: ${symbols.length} symbols`);
