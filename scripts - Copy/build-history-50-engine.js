/*
EGX Pro Hub V7.2 — Auto Rolling 50 Sessions Engine

Purpose:
- Build and maintain data/history.json from daily collected market snapshots.
- Validate history coverage per symbol.
- Compute indicators: EMA20, EMA50, RSI14, ATR14, VolumeRatio20, returns and volatility.
- Enhance recommendations with history fields.
- Never claim 50 sessions unless a symbol has 50 distinct session dates.

Important:
This engine can accumulate 50 daily snapshots going forward.
It cannot magically backfill true 50 historical sessions unless existing history/imported data is present.
*/

const fs = require("fs");
const path = require("path");

const DATA_DIR = "data";
const MAX_SESSIONS = 75;
const REQUIRED_50 = 50;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[,%٬،]/g, "");
  let mult = 1;
  if (/[mM]$/.test(s)) { mult = 1e6; s = s.slice(0, -1); }
  if (/[bB]$/.test(s)) { mult = 1e9; s = s.slice(0, -1); }
  if (/[kK]$/.test(s)) { mult = 1e3; s = s.slice(0, -1); }
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

function todayEgypt() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function symbolOf(r) {
  return String(r.symbol || r.ticker || r.code || r.Symbol || "").trim().toUpperCase();
}

function extractRows() {
  const recs = readJson("data/recommendations.json", {});
  const cache = readJson("data/full-market-cache.json", {});
  const market = readJson("data/market.json", {});

  let rows = [];
  if (Array.isArray(recs.all) && recs.all.length) rows = recs.all;
  else if (Array.isArray(cache.rows) && cache.rows.length) rows = cache.rows;
  else if (Array.isArray(market.rows) && market.rows.length) rows = market.rows;
  else if (Array.isArray(market.data) && market.data.length) rows = market.data;

  return rows
    .map((r) => ({ ...r, symbol: symbolOf(r) }))
    .filter((r) => r.symbol);
}

function normalizeExistingHistory(history) {
  const by = {};

  function add(symbol, arr) {
    symbol = String(symbol || "").toUpperCase();
    if (!symbol || !Array.isArray(arr)) return;
    by[symbol] = by[symbol] || [];
    for (const p of arr) {
      const pt = normalizePoint(p);
      if (pt && pt.close > 0 && pt.date) by[symbol].push(pt);
    }
  }

  if (history && history.sessionsBySymbol) {
    for (const [s, arr] of Object.entries(history.sessionsBySymbol)) add(s, arr);
  }
  if (history && history.prices) {
    for (const [s, arr] of Object.entries(history.prices)) add(s, arr);
  }
  if (history && history.history) {
    for (const [s, arr] of Object.entries(history.history)) add(s, arr);
  }
  if (history && history.symbols) {
    for (const [s, arr] of Object.entries(history.symbols)) add(s, arr);
  }

  for (const [s, arr] of Object.entries(by)) {
    by[s] = dedupeSort(arr).slice(-MAX_SESSIONS);
  }

  return by;
}

function normalizePoint(p) {
  if (typeof p === "number") {
    return { date: null, open: p, high: p, low: p, close: p, volume: null, valueTraded: null, sourceQuality: "legacy_number" };
  }

  const date = String(p.date || p.sessionDate || p.t || p.time || p.timestamp || p.Date || "").slice(0, 10);
  const close = toNum(p.close ?? p.price ?? p.value ?? p.last ?? p.Last ?? p.Close ?? p["إغلاق"] ?? p["السعر"]);
  const open = toNum(p.open ?? p.Open ?? p["فتح"]) ?? close;
  const high = toNum(p.high ?? p.High ?? p.max ?? p["أعلى"]) ?? Math.max(open || close, close || open);
  const low = toNum(p.low ?? p.Low ?? p.min ?? p["أدنى"]) ?? Math.min(open || close, close || open);
  const volume = toNum(p.volume ?? p.Volume ?? p.vol ?? p.tradedVolume ?? p["الحجم"]);
  const valueTraded = toNum(p.valueTraded ?? p.turnover ?? p.tradedValue ?? p.value ?? p["قيمة التداول"]);

  if (!close) return null;
  return {
    date,
    open: open || close,
    high: Math.max(high || close, open || close, close),
    low: Math.min(low || close, open || close, close),
    close,
    volume,
    valueTraded,
    sourceQuality: p.sourceQuality || p.source || "legacy_import"
  };
}

function makeSnapshot(row, date, previousPoint) {
  const close = toNum(row.price ?? row.lastPrice ?? row.last ?? row.close ?? row.currentPrice);
  if (!close || close <= 0) return null;

  const changePct = toNum(row.changePct ?? row.changePercent ?? row.change_percentage);
  const impliedPrev = changePct !== null && changePct !== -100 ? close / (1 + changePct / 100) : null;
  const open = previousPoint?.close || impliedPrev || close;
  const support = toNum(row.support1 ?? row.support ?? row.s1);
  const resistance = toNum(row.resistance1 ?? row.resistance ?? row.r1);

  const baseHigh = Math.max(open, close, resistance && resistance < close * 1.12 ? resistance : 0);
  const baseLow = Math.min(open, close, support && support > close * 0.88 ? support : close);

  return {
    date,
    open,
    high: baseHigh * 1.002,
    low: baseLow * 0.998,
    close,
    volume: toNum(row.volume ?? row.tradedVolume),
    valueTraded: toNum(row.valueTraded ?? row.tradedValue ?? row.turnover ?? row.value),
    changePct,
    source: "daily_public_snapshot",
    sourceQuality: "snapshot_ohlc_derived_from_public_market_data",
    collectedAt: new Date().toISOString()
  };
}

function dedupeSort(arr) {
  const map = new Map();
  for (const p of arr) {
    if (!p || !p.date || !toNum(p.close)) continue;
    map.set(p.date, { ...p, close: toNum(p.close), open: toNum(p.open) || toNum(p.close), high: toNum(p.high) || toNum(p.close), low: toNum(p.low) || toNum(p.close) });
  }
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values, period = 14) {
  if (!values || values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function atr(points, period = 14) {
  if (!points || points.length <= period) return null;
  const trs = [];
  for (let i = 1; i < points.length; i++) {
    const high = toNum(points[i].high) || toNum(points[i].close);
    const low = toNum(points[i].low) || toNum(points[i].close);
    const prevClose = toNum(points[i - 1].close);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function std(values) {
  if (!values.length) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, x) => s + Math.pow(x - avg, 2), 0) / values.length);
}

function computeIndicators(points) {
  const closes = points.map(p => toNum(p.close)).filter(n => n && n > 0);
  const volumes = points.map(p => toNum(p.volume)).filter(n => n && n > 0);
  const last = closes[closes.length - 1];

  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1] * 100);

  const vol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-20).length);
  const vol50 = volumes.slice(-50).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-50).length);

  return {
    sessionsAvailable: points.length,
    historyComplete50: points.length >= REQUIRED_50,
    historyUsedInAnalysis: points.length >= 20,
    history50UsedInRecommendation: points.length >= REQUIRED_50,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    rsi14: rsi(closes, 14),
    atr14: atr(points, 14),
    volumeRatio20: vol50 ? vol20 / vol50 : null,
    return20: closes.length >= 21 ? (last - closes[closes.length - 21]) / closes[closes.length - 21] * 100 : null,
    return50: closes.length >= 50 ? (last - closes[closes.length - 50]) / closes[closes.length - 50] * 100 : null,
    volatility20: rets.length >= 20 ? std(rets.slice(-20)) : null
  };
}

function historyScore(ind) {
  if (!ind || !ind.historyUsedInAnalysis) return null;
  let score = 50;

  if (ind.ema20 && ind.ema50) score += ind.ema20 > ind.ema50 ? 14 : -12;
  if (ind.rsi14 !== null && ind.rsi14 !== undefined) {
    if (ind.rsi14 >= 45 && ind.rsi14 <= 70) score += 12;
    else if (ind.rsi14 > 78) score -= 10;
    else if (ind.rsi14 < 35) score -= 8;
  }
  if (ind.volumeRatio20) score += ind.volumeRatio20 > 1.25 ? 10 : ind.volumeRatio20 < 0.75 ? -6 : 2;
  if (ind.return20) score += Math.max(-12, Math.min(12, ind.return20 * 0.5));
  if (ind.volatility20) score -= Math.min(10, ind.volatility20 * 1.2);
  if (ind.historyComplete50) score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function validateHistory(bySymbol) {
  const perSymbol = {};
  const warnings = [];
  let complete50 = 0, anyHistory = 0, totalSessions = 0;

  for (const [symbol, arr] of Object.entries(bySymbol)) {
    const dates = arr.map(p => p.date);
    const uniqueDates = new Set(dates);
    const invalid = arr.filter(p => !p.date || !toNum(p.close) || toNum(p.close) <= 0);
    const duplicates = dates.length - uniqueDates.size;
    const sessions = arr.length;
    const complete = sessions >= REQUIRED_50;
    if (complete) complete50++;
    if (sessions > 0) anyHistory++;
    totalSessions += sessions;

    if (sessions < REQUIRED_50) warnings.push(`${symbol}: only ${sessions}/50 sessions available`);
    if (duplicates) warnings.push(`${symbol}: ${duplicates} duplicate session dates removed/seen`);
    if (invalid.length) warnings.push(`${symbol}: ${invalid.length} invalid points`);

    perSymbol[symbol] = {
      sessionsAvailable: sessions,
      historyComplete50: complete,
      duplicateDates: duplicates,
      invalidPoints: invalid.length,
      firstDate: arr[0]?.date || null,
      lastDate: arr[arr.length - 1]?.date || null
    };
  }

  const symbols = Object.keys(bySymbol).length;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    requiredSessions: REQUIRED_50,
    totalSymbolsWithHistory: symbols,
    symbolsWithAnyHistory: anyHistory,
    symbolsWithComplete50: complete50,
    averageSessionsPerSymbol: symbols ? Math.round(totalSessions / symbols) : 0,
    warning: complete50 === 0
      ? "No symbol has 50 sessions yet. Recommendations must not claim full 50-session analysis."
      : "Some symbols may still have incomplete history. Check perSymbol.",
    perSymbol,
    warnings: warnings.slice(0, 300)
  };
}

function enhanceRecommendations(indicators) {
  const recFile = "data/recommendations.json";
  const recs = readJson(recFile, null);
  if (!recs || !Array.isArray(recs.all)) return null;

  let changed = 0;
  recs.all = recs.all.map((r) => {
    const symbol = symbolOf(r);
    const ind = indicators[symbol];
    if (!ind) return {
      ...r,
      historySessionsAvailable: 0,
      historyComplete50: false,
      historyUsedInAnalysis: false,
      history50UsedInRecommendation: false
    };

    const hScore = historyScore(ind);
    const oldConf = toNum(r.finalConfidence ?? r.confidence ?? r.score) ?? null;
    let newConf = oldConf;

    if (oldConf !== null && hScore !== null) {
      if (ind.historyComplete50) newConf = Math.round(oldConf * 0.75 + hScore * 0.25);
      else if (ind.historyUsedInAnalysis) newConf = Math.round(oldConf * 0.90 + hScore * 0.10);
    }

    const suffix = ind.historyComplete50
      ? " | تاريخ 50 جلسة مستخدم في التقييم"
      : ind.historyUsedInAnalysis
        ? ` | تاريخ جزئي ${ind.sessionsAvailable}/50 مستخدم بحذر`
        : ` | لا يوجد سجل تاريخي كافٍ (${ind.sessionsAvailable}/50)`;

    changed++;
    return {
      ...r,
      finalConfidence: newConf ?? r.finalConfidence,
      historySessionsAvailable: ind.sessionsAvailable,
      historyComplete50: ind.historyComplete50,
      historyUsedInAnalysis: ind.historyUsedInAnalysis,
      history50UsedInRecommendation: ind.history50UsedInRecommendation,
      historyScore: hScore,
      ema20: ind.ema20,
      ema50: ind.ema50,
      rsi14: ind.rsi14,
      atr14: ind.atr14,
      volumeRatio20: ind.volumeRatio20,
      return20: ind.return20,
      return50: ind.return50,
      volatility20: ind.volatility20,
      reason: String(r.reason || "").includes("تاريخ")
        ? r.reason
        : `${r.reason || ""}${suffix}`.trim()
    };
  });

  recs.historyEngine = {
    version: "v7_2_auto_rolling_50_sessions_engine",
    updatedAt: new Date().toISOString(),
    enhancedRows: changed,
    rule: "Only rows with historyComplete50=true can claim full 50-session history analysis."
  };

  writeJson(recFile, recs);
  return changed;
}

function main() {
  ensureDir(DATA_DIR);

  const date = process.env.EGX_SESSION_DATE || todayEgypt();
  const existing = normalizeExistingHistory(readJson("data/history.json", {}));
  const rows = extractRows();

  for (const row of rows) {
    const symbol = symbolOf(row);
    if (!symbol) continue;
    const arr = existing[symbol] || [];
    const previous = arr[arr.length - 1] || null;
    const point = makeSnapshot(row, date, previous);
    if (!point) continue;
    arr.push(point);
    existing[symbol] = dedupeSort(arr).slice(-MAX_SESSIONS);
  }

  const indicators = {};
  const historyReport = {};
  for (const [symbol, points] of Object.entries(existing)) {
    const ind = computeIndicators(points);
    indicators[symbol] = {
      symbol,
      ...ind,
      historyScore: historyScore(ind),
      firstDate: points[0]?.date || null,
      lastDate: points[points.length - 1]?.date || null,
      sourceQuality: points[points.length - 1]?.sourceQuality || null
    };
    historyReport[symbol] = {
      symbol,
      sessionsAvailable: points.length,
      historyComplete50: points.length >= REQUIRED_50,
      lastClose: points[points.length - 1]?.close || null,
      lastDate: points[points.length - 1]?.date || null
    };
  }

  const validation = validateHistory(existing);
  const enhanced = enhanceRecommendations(indicators);

  writeJson("data/history.json", {
    version: "v7_2_auto_rolling_50_sessions_engine",
    generatedAt: new Date().toISOString(),
    sessionDate: date,
    requiredSessions: REQUIRED_50,
    maxStoredSessions: MAX_SESSIONS,
    importantNote: "This file is accumulated from daily public snapshots unless historical data was imported. Full 50-session analysis is valid only when historyComplete50=true.",
    sessionsBySymbol: existing
  });

  writeJson("data/history-indicators.json", {
    version: "v7_2_auto_rolling_50_sessions_engine",
    generatedAt: new Date().toISOString(),
    requiredSessions: REQUIRED_50,
    indicators
  });

  writeJson("data/history-health.json", validation);
  writeJson("data/history-validation-report.json", validation);
  writeJson("data/history-report.json", {
    ok: true,
    generatedAt: new Date().toISOString(),
    sessionDate: date,
    requiredSessions: REQUIRED_50,
    enhancedRecommendations: enhanced || 0,
    summary: {
      totalSymbols: validation.totalSymbolsWithHistory,
      symbolsWithComplete50: validation.symbolsWithComplete50,
      averageSessionsPerSymbol: validation.averageSessionsPerSymbol
    },
    rows: Object.values(historyReport)
  });

  writeJson("data/history-auto-status.json", {
    ok: true,
    engine: "v7_2_auto_rolling_50_sessions_engine",
    generatedAt: new Date().toISOString(),
    sessionDate: date,
    rowsReadFromCurrentMarket: rows.length,
    symbolsTracked: validation.totalSymbolsWithHistory,
    symbolsWithComplete50: validation.symbolsWithComplete50,
    averageSessionsPerSymbol: validation.averageSessionsPerSymbol,
    rule: "The engine automatically appends/updates one snapshot per symbol per trading date, deduplicates by date, stores up to 75 sessions, and uses exactly the latest 50 once available.",
    note: validation.symbolsWithComplete50 === 0
      ? "Still collecting future sessions. No recommendation should claim full 50-session analysis yet."
      : "Some symbols now have complete 50-session history and can be used in 50-session recommendations."
  });

  console.log("V7 History 50 Engine complete:", {
    date,
    rowsRead: rows.length,
    symbolsWithHistory: validation.totalSymbolsWithHistory,
    complete50: validation.symbolsWithComplete50,
    avgSessions: validation.averageSessionsPerSymbol,
    enhancedRecommendations: enhanced || 0
  });
}

main();
