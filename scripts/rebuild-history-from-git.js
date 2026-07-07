/*
EGX Pro Hub V7.4 — Git Date Recovery Fix

Problem fixed:
V7.3 could recover many rows from old repository snapshots, but if the JSON files had repeated
generatedAt / lastSuccessAt values, many snapshots collapsed into only 1-2 unique session dates.

V7.4 uses the Git commit date as the default session date for recovered repository snapshots.
This is safer for "past recovery" because each committed snapshot represents what the app stored
at that time. It still deduplicates by symbol + date and never fabricates extra dates.

Inputs scanned from Git history:
- data/recommendations.json
- data/full-market-cache.json
- data/market.json

Outputs:
- data/history.json
- data/git-history-recovery-status.json
*/

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const MAX_SESSIONS = 75;
const FILES = [
  "data/recommendations.json",
  "data/full-market-cache.json",
  "data/market.json"
];

function sh(args, fallback = "") {
  try {
    return cp.execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 50 * 1024 * 1024
    }).trim();
  } catch {
    return fallback;
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function showJson(commit, file) {
  try {
    const txt = cp.execFileSync("git", ["show", `${commit}:${file}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 50 * 1024 * 1024
    });
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(/[,%٬،]/g, "").replace(/[^\d.+\-eE]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function symbolOf(r) {
  return String(r.symbol || r.ticker || r.code || r.Symbol || "").trim().toUpperCase();
}

function dateOnly(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function extractRows(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.all)) return obj.all;
  if (Array.isArray(obj.rows)) return obj.rows;
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.market && Array.isArray(obj.market.rows)) return obj.market.rows;
  if (obj.cache && Array.isArray(obj.cache.rows)) return obj.cache.rows;
  return [];
}

function extractFileDate(obj) {
  return dateOnly(
    obj?.generatedAt ||
    obj?.sessionDate ||
    obj?.lastSuccessAt ||
    obj?.source?.lastSuccessAt ||
    obj?.meta?.generatedAt ||
    obj?.market?.generatedAt
  );
}

function commitInfo() {
  const raw = sh(["log", "--format=%H|%cI", "--", ...FILES], "");
  if (!raw) return [];
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [hash, dateIso] = line.split("|");
      return { hash, commitDate: dateOnly(dateIso), dateIso };
    })
    .filter(x => x.hash && x.commitDate)
    .reverse(); // oldest -> newest
}

function makePoint(row, date, commit, file, fileDate) {
  const symbol = symbolOf(row);
  const close = num(row.price ?? row.lastPrice ?? row.last ?? row.close ?? row.currentPrice);
  if (!symbol || !date || !close) return null;

  const changePct = num(row.changePct ?? row.changePercent ?? row.change_percentage);
  const previous = changePct !== null && changePct !== -100 ? close / (1 + changePct / 100) : null;
  const open = num(row.open ?? row.openPrice) ?? previous ?? close;
  const high = num(row.high ?? row.highPrice) ?? Math.max(open, close);
  const low = num(row.low ?? row.lowPrice) ?? Math.min(open, close);
  const volume = num(row.volume ?? row.tradedVolume);
  const valueTraded = num(row.valueTraded ?? row.tradedValue ?? row.turnover ?? row.value);

  return {
    symbol,
    date,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume,
    valueTraded,
    changePct,
    source: "git_snapshot_recovery_v7_4",
    sourceFile: file,
    sourceCommit: commit.slice(0, 10),
    sourceCommitDate: date,
    sourceFileDate: fileDate || null,
    sourceQuality: "recovered_from_repository_snapshot_using_git_commit_date",
    recoveredAt: new Date().toISOString()
  };
}

function normalizeExistingHistory(history) {
  const out = {};

  function add(symbol, arr) {
    symbol = String(symbol || "").trim().toUpperCase();
    if (!symbol || !Array.isArray(arr)) return;
    out[symbol] = out[symbol] || [];
    for (const p of arr) {
      const close = num(p.close ?? p.price ?? p.value);
      const date = dateOnly(p.date || p.sessionDate);
      if (!date || !close) continue;
      out[symbol].push({
        ...p,
        symbol,
        date,
        open: num(p.open) ?? close,
        high: num(p.high) ?? close,
        low: num(p.low) ?? close,
        close,
        volume: num(p.volume),
        valueTraded: num(p.valueTraded)
      });
    }
  }

  if (history.sessionsBySymbol) for (const [s, a] of Object.entries(history.sessionsBySymbol)) add(s, a);
  if (history.prices) for (const [s, a] of Object.entries(history.prices)) add(s, a);
  if (history.history) for (const [s, a] of Object.entries(history.history)) add(s, a);

  for (const s of Object.keys(out)) out[s] = dedupe(out[s]).slice(-MAX_SESSIONS);
  return out;
}

function dedupe(arr) {
  const m = new Map();
  for (const p of arr) {
    if (!p || !p.date || !p.close) continue;
    m.set(p.date, p);
  }
  return [...m.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function main() {
  const status = {
    ok: true,
    engine: "v7_4_git_date_recovery_fix",
    generatedAt: new Date().toISOString(),
    commitsScanned: 0,
    filesScanned: 0,
    snapshotsRecovered: 0,
    rowsRecovered: 0,
    symbolsRecovered: 0,
    uniqueSessionDatesRecovered: 0,
    symbolsWithComplete50AfterRecovery: 0,
    averageSessionsAfterRecovery: 0,
    dateRule: "Git commit date is used as recovered session date by default to avoid repeated generatedAt collapsing history.",
    message: ""
  };

  const commits = commitInfo();
  status.commitsScanned = commits.length;

  if (!commits.length) {
    status.ok = false;
    status.message = "No Git history available. Ensure actions/checkout uses fetch-depth: 0.";
    writeJson("data/git-history-recovery-status.json", status);
    console.log(status.message);
    return;
  }

  const history = normalizeExistingHistory(readJson("data/history.json", {}));
  const recoveredBySymbol = {};
  const uniqueDates = new Set();
  const fileDateStats = {};

  for (const info of commits) {
    for (const file of FILES) {
      const obj = showJson(info.hash, file);
      if (!obj) continue;

      status.filesScanned++;

      const rows = extractRows(obj);
      if (!rows.length) continue;

      const fileDate = extractFileDate(obj);
      if (fileDate) fileDateStats[fileDate] = (fileDateStats[fileDate] || 0) + 1;

      const sessionDate = info.commitDate;
      status.snapshotsRecovered++;
      uniqueDates.add(sessionDate);

      for (const r of rows) {
        const pt = makePoint(r, sessionDate, info.hash, file, fileDate);
        if (!pt) continue;
        history[pt.symbol] = history[pt.symbol] || [];
        history[pt.symbol].push(pt);
        recoveredBySymbol[pt.symbol] = (recoveredBySymbol[pt.symbol] || 0) + 1;
        status.rowsRecovered++;
      }
    }
  }

  for (const s of Object.keys(history)) history[s] = dedupe(history[s]).slice(-MAX_SESSIONS);

  const symbols = Object.keys(history);
  status.symbolsRecovered = Object.keys(recoveredBySymbol).length;
  status.uniqueSessionDatesRecovered = uniqueDates.size;
  status.symbolsWithComplete50AfterRecovery = symbols.filter(s => history[s].length >= 50).length;
  status.averageSessionsAfterRecovery = Math.round(
    symbols.reduce((sum, s) => sum + history[s].length, 0) / Math.max(1, symbols.length)
  );
  status.recoveredBySymbol = recoveredBySymbol;
  status.fileDateStats = fileDateStats;
  status.message = `Recovered ${status.rowsRecovered} rows from ${status.snapshotsRecovered} repository snapshots across ${status.uniqueSessionDatesRecovered} unique Git dates.`;

  writeJson("data/history.json", {
    version: "v7_4_git_date_recovery_fix",
    generatedAt: new Date().toISOString(),
    requiredSessions: 50,
    maxStoredSessions: MAX_SESSIONS,
    importantNote: "Recovered from actual repository snapshots using Git commit dates. build-history-50-engine.js will validate and compute indicators after this step.",
    sessionsBySymbol: history
  });

  writeJson("data/git-history-recovery-status.json", status);
  console.log("Git date recovery complete:", status);
}

main();
