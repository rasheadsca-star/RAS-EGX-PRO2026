/*
EGX Pro Hub V7.5 — Snapshot Evidence Engine

Purpose:
Use recovered repository snapshots as extra evidence to improve current recommendations,
WITHOUT pretending they are 50 trading sessions.

Why:
Git recovery may recover many stored market snapshots but only 1-2 unique trading dates.
Those snapshots are still useful as "evidence":
- Was the symbol repeatedly present?
- Did price/volume/value remain consistent?
- Did confidence/signal persist across snapshots?
- Was the stock repeatedly in the opportunity list?

Outputs:
- data/snapshot-evidence.json
- data/snapshot-evidence-status.json
- enhancements inside data/recommendations.json:
  snapshotEvidenceCount
  snapshotEvidenceUsed
  snapshotUniqueDates
  snapshotTrendPct
  snapshotStabilityScore
  snapshotEvidenceScore
  snapshotConfidenceAdjustment
  finalConfidence adjusted cautiously

This engine never sets historyComplete50=true.
*/

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const FILES = [
  "data/recommendations.json",
  "data/full-market-cache.json",
  "data/market.json"
];

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function git(args, fallback = "") {
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
function dateOnly(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function commitInfo() {
  const raw = git(["log", "--format=%H|%cI", "--", ...FILES], "");
  if (!raw) return [];
  return raw.split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [hash, iso] = line.split("|");
      return { hash, iso, date: dateOnly(iso) };
    })
    .filter(x => x.hash && x.iso)
    .reverse();
}
function mean(arr) {
  arr = arr.filter(x => x !== null && x !== undefined && Number.isFinite(x));
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
function stdev(arr) {
  arr = arr.filter(x => x !== null && x !== undefined && Number.isFinite(x));
  if (arr.length < 2) return null;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / arr.length);
}
function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function classifySignal(row) {
  const rec = String(row.recommendation || row.signal || row.decision || "").toLowerCase();
  if (/buy|شراء|زيادة/.test(rec)) return "buy";
  if (/risk|sell|تخفيف|بيع|خطر/.test(rec)) return "risk";
  if (/near|قريب|دخول/.test(rec)) return "near";
  return "watch";
}
function scoreEvidence(points) {
  const count = points.length;
  const uniqueDates = new Set(points.map(p => p.date).filter(Boolean)).size;
  const prices = points.map(p => p.price).filter(x => x);
  const values = points.map(p => p.valueTraded).filter(x => x);
  const confidences = points.map(p => p.confidence).filter(x => x !== null && x !== undefined);
  const last = prices[prices.length - 1] || null;
  const first = prices[0] || null;
  const trendPct = first && last ? (last - first) / first * 100 : null;
  const priceCv = prices.length >= 3 && mean(prices) ? (stdev(prices) || 0) / mean(prices) * 100 : null;
  const valueAvg = mean(values) || 0;
  const avgConfidence = mean(confidences);
  const signalCounts = {};
  points.forEach(p => signalCounts[p.signal] = (signalCounts[p.signal] || 0) + 1);
  const dominantSignal = Object.entries(signalCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "watch";
  const persistence = count ? (signalCounts[dominantSignal] || 0) / count * 100 : 0;

  let score = 45;
  score += clamp(count, 0, 75) * 0.35;              // repeated appearance
  score += clamp(uniqueDates, 0, 20) * 0.6;         // distinct days
  score += persistence >= 70 ? 10 : persistence >= 50 ? 5 : 0;
  if (avgConfidence !== null) score += (avgConfidence - 50) * 0.12;
  if (trendPct !== null) score += clamp(trendPct * 0.35, -10, 10);
  if (priceCv !== null) score -= clamp(priceCv * 0.55, 0, 8);
  if (valueAvg > 0) score += clamp(Math.log10(valueAvg + 1) - 6, 0, 8);

  score = Math.round(clamp(score, 0, 100));

  // Cautious adjustment: this is evidence, not 50-session history.
  let adjustment = 0;
  if (count >= 20) adjustment += 2;
  if (count >= 50) adjustment += 2;
  if (uniqueDates >= 2) adjustment += 1;
  if (dominantSignal === "buy" && score >= 70) adjustment += 3;
  if (dominantSignal === "near" && score >= 70) adjustment += 2;
  if (dominantSignal === "risk") adjustment -= 3;
  if (trendPct !== null && trendPct < -8) adjustment -= 3;
  if (trendPct !== null && trendPct > 8) adjustment += 2;
  adjustment = Math.round(clamp(adjustment, -6, 8));

  return {
    observationCount: count,
    uniqueDates,
    firstSnapshotAt: points[0]?.iso || null,
    lastSnapshotAt: points[points.length - 1]?.iso || null,
    firstPrice: first,
    lastPrice: last,
    snapshotTrendPct: trendPct,
    priceCv,
    averageValueTraded: valueAvg,
    averageConfidence: avgConfidence,
    dominantSignal,
    dominantSignalPersistencePct: persistence,
    snapshotStabilityScore: priceCv === null ? null : Math.round(clamp(100 - priceCv * 4, 0, 100)),
    snapshotEvidenceScore: score,
    snapshotConfidenceAdjustment: adjustment,
    snapshotEvidenceUsed: count >= 10
  };
}
function main() {
  const commits = commitInfo();
  const bySymbol = {};
  const status = {
    ok: true,
    engine: "v7_5_snapshot_evidence_engine",
    generatedAt: new Date().toISOString(),
    commitsScanned: commits.length,
    filesScanned: 0,
    observationsRead: 0,
    symbolsWithEvidence: 0,
    recommendationsEnhanced: 0,
    importantNote: "Snapshot evidence is not 50 trading sessions. It is used only as a cautious confidence support layer.",
    message: ""
  };

  for (const info of commits) {
    for (const file of FILES) {
      const obj = showJson(info.hash, file);
      if (!obj) continue;
      status.filesScanned++;
      const rows = extractRows(obj);
      if (!rows.length) continue;

      for (const r of rows) {
        const symbol = symbolOf(r);
        const price = num(r.price ?? r.lastPrice ?? r.last ?? r.close ?? r.currentPrice);
        if (!symbol || !price) continue;
        const confidence = num(r.finalConfidence ?? r.confidence ?? r.score);
        const valueTraded = num(r.valueTraded ?? r.tradedValue ?? r.turnover ?? r.value);
        const volume = num(r.volume ?? r.tradedVolume);
        bySymbol[symbol] = bySymbol[symbol] || [];
        bySymbol[symbol].push({
          symbol,
          iso: info.iso,
          date: info.date,
          price,
          confidence,
          valueTraded,
          volume,
          signal: classifySignal(r),
          recommendation: r.recommendation || r.signal || r.decision || null,
          file,
          commit: info.hash.slice(0, 10)
        });
        status.observationsRead++;
      }
    }
  }

  const evidence = {};
  for (const [symbol, points] of Object.entries(bySymbol)) {
    points.sort((a, b) => String(a.iso).localeCompare(String(b.iso)));
    evidence[symbol] = { symbol, ...scoreEvidence(points), points: points.slice(-80) };
  }
  status.symbolsWithEvidence = Object.keys(evidence).length;

  const recFile = "data/recommendations.json";
  const recs = readJson(recFile, null);
  if (recs && Array.isArray(recs.all)) {
    recs.all = recs.all.map(r => {
      const symbol = symbolOf(r);
      const ev = evidence[symbol];
      if (!ev || !ev.snapshotEvidenceUsed) return {
        ...r,
        snapshotEvidenceUsed: false,
        snapshotEvidenceCount: ev?.observationCount || 0,
        snapshotUniqueDates: ev?.uniqueDates || 0
      };

      const oldConf = num(r.finalConfidence ?? r.confidence ?? r.score) ?? 0;
      const newConf = Math.round(clamp(oldConf + ev.snapshotConfidenceAdjustment, 0, 100));
      status.recommendationsEnhanced++;

      const note = ` | Snapshot evidence: ${ev.observationCount} observations / ${ev.uniqueDates} dates, score ${ev.snapshotEvidenceScore}%. ليس 50 جلسة.`;

      return {
        ...r,
        finalConfidence: newConf,
        snapshotEvidenceUsed: true,
        snapshotEvidenceCount: ev.observationCount,
        snapshotUniqueDates: ev.uniqueDates,
        snapshotEvidenceScore: ev.snapshotEvidenceScore,
        snapshotConfidenceAdjustment: ev.snapshotConfidenceAdjustment,
        snapshotTrendPct: ev.snapshotTrendPct,
        snapshotStabilityScore: ev.snapshotStabilityScore,
        snapshotDominantSignal: ev.dominantSignal,
        snapshotDominantSignalPersistencePct: ev.dominantSignalPersistencePct,
        reason: String(r.reason || "").includes("Snapshot evidence")
          ? r.reason
          : `${r.reason || ""}${note}`.trim()
      };
    });

    recs.snapshotEvidenceEngine = {
      version: "v7_5_snapshot_evidence_engine",
      updatedAt: new Date().toISOString(),
      recommendationsEnhanced: status.recommendationsEnhanced,
      rule: "Snapshot evidence can adjust confidence cautiously but cannot mark a stock as historyComplete50."
    };

    fs.writeFileSync(recFile, JSON.stringify(recs, null, 2), "utf8");
  }

  status.message = `Built snapshot evidence for ${status.symbolsWithEvidence} symbols from ${status.observationsRead} observations. Enhanced ${status.recommendationsEnhanced} recommendations.`;

  writeJson("data/snapshot-evidence.json", {
    ok: true,
    engine: "v7_5_snapshot_evidence_engine",
    generatedAt: new Date().toISOString(),
    importantNote: status.importantNote,
    evidence
  });
  writeJson("data/snapshot-evidence-status.json", status);

  console.log("Snapshot evidence complete:", status);
}
main();
