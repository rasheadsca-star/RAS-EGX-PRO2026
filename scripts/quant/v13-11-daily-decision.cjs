#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const Q = path.join(ROOT, 'data', 'quant');
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-11-daily-decision-policy.json'),
  tiered: path.join(Q, 'tiered-confidence-recommendations-v13-10.json'),
  stocks: path.join(Q, 'stock-intelligence-index.json'),
  risk: path.join(Q, 'portfolio-risk-universe.json'),
  output: path.join(Q, 'daily-decision-workspace-v13-11.json')
};

function readJson(file, required = false) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (required) throw new Error(`Missing or invalid ${path.relative(ROOT, file)}: ${error.message}`);
    return null;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value, 0)));
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function A(value) {
  return Array.isArray(value) ? value : [];
}
function tierMeta(tier) {
  if (tier === 'STRICT_PAPER') {
    return {
      priority: 3,
      labelAr: 'توصية ورقية أساسية صارمة',
      actionCode: 'PAPER_READY',
      actionLabelAr: 'صالح للمحاكاة الورقية الأساسية',
      actionablePaper: true
    };
  }
  if (tier === 'TIER_A_EXPERIMENTAL_PAPER') {
    return {
      priority: 2,
      labelAr: 'الطبقة A — ورقي تجريبي',
      actionCode: 'EXPERIMENTAL_PAPER',
      actionLabelAr: 'صالح لمحاكاة ورقية منخفضة المخاطر',
      actionablePaper: true
    };
  }
  return {
    priority: 1,
    labelAr: 'الطبقة B — مراقبة أولوية',
    actionCode: 'WATCH_ONLY',
    actionLabelAr: 'مراقبة فقط — لا تسجل صفقة',
    actionablePaper: false
  };
}
function normalizedPlan(raw) {
  const plan = raw?.plan || {};
  return {
    entryLow: n(plan.entryLow),
    entryHigh: n(plan.entryHigh),
    stopLoss: n(plan.stopLoss),
    target1: n(plan.target1),
    target2: n(plan.target2),
    riskReward1: n(plan.riskReward1),
    maximumHoldingSessions: n(plan.maximumHoldingSessions)
  };
}
function validPlan(plan) {
  return n(plan.entryLow, 0) > 0
    && n(plan.entryHigh, 0) >= n(plan.entryLow, 0)
    && n(plan.stopLoss, 0) > 0
    && n(plan.entryHigh, 0) > n(plan.stopLoss, 0)
    && n(plan.target1, 0) > n(plan.entryLow, 0);
}
function compositeScore(item, policy) {
  const p = policy.ranking;
  const tierWeight = n(p.tierWeights?.[item.tier], 0);
  const recommendation = n(item.recommendationScore, 0) * n(p.recommendationScoreWeight, 0.38);
  const technical = n(item.stock?.technicalScore, 0) * n(p.technicalScoreWeight, 0.16);
  const liquidity = n(item.riskProfile?.liquidityPercentile, 0) * n(p.liquidityPercentileWeight, 0.10);
  const inverseRisk = (100 - n(item.riskProfile?.riskScore, 50)) * n(p.inverseRiskWeight, 0.08);
  const rr = Math.min(n(p.maximumRiskRewardForScore, 3), Math.max(0, n(item.plan.riskReward1, 0)))
    * n(p.riskRewardWeight, 6);
  const softPenalty = n(item.softFailureCount, 0) * n(p.softFailurePenalty, 5);
  return clamp(tierWeight + recommendation + technical + liquidity + inverseRisk + rr - softPenalty);
}
function confidenceLabel(score) {
  if (score >= 82) return { code: 'VERY_HIGH', labelAr: 'مرتفعة جدًا' };
  if (score >= 72) return { code: 'HIGH', labelAr: 'مرتفعة' };
  if (score >= 62) return { code: 'MEDIUM', labelAr: 'متوسطة' };
  return { code: 'WATCH', labelAr: 'مراقبة' };
}
function selectionReason(item) {
  if (item.tier === 'STRICT_PAPER') {
    return 'اجتاز بوابات الإنتاج الصارمة، مع خطة دخول ووقف وأهداف صالحة.';
  }
  if (item.tier === 'TIER_A_EXPERIMENTAL_PAPER') {
    const failures = A(item.softFailures).map(x => x.labelAr || x.id).filter(Boolean);
    return failures.length
      ? `اجتاز كل الشروط الإلزامية، وينقصه شرط مرن واحد: ${failures.join('، ')}.`
      : 'اجتاز كل الشروط الإلزامية ومؤهل للطبقة التجريبية منخفضة المخاطر.';
  }
  const failures = A(item.softFailures).map(x => x.labelAr || x.id).filter(Boolean);
  return failures.length
    ? `مراقبة أولوية؛ يحتاج تحسن: ${failures.join('، ')}.`
    : 'مراقبة أولوية؛ لم يصل بعد إلى طبقة التداول الورقي.';
}
function normalize(raw, tier, stockMap, riskMap, sessionId, policy) {
  const ticker = safeTicker(raw.ticker);
  if (!ticker) return null;
  const meta = tierMeta(tier);
  const stock = stockMap.get(ticker) || {};
  const riskProfile = riskMap.get(ticker) || {};
  const plan = normalizedPlan(raw);
  const softFailures = A(raw.softFailures).map(x =>
    typeof x === 'string' ? { labelAr: x } : x
  );
  const hardFailures = A(raw.hardFailures).map(x =>
    typeof x === 'string' ? { labelAr: x } : x
  );
  const item = {
    ticker,
    companyNameAr: raw.companyNameAr || stock.companyNameAr || '',
    companyNameEn: raw.companyNameEn || stock.companyNameEn || '',
    sector: raw.sector || stock.sector || riskProfile.sector || 'غير مصنف',
    sessionId: raw.sessionId || stock.sessionId || sessionId || null,
    tier,
    tierPriority: meta.priority,
    tierLabelAr: meta.labelAr,
    actionCode: meta.actionCode,
    actionLabelAr: meta.actionLabelAr,
    actionablePaper: meta.actionablePaper,
    statusLabelAr: raw.statusLabelAr || meta.labelAr,
    strategyId: raw.strategyId || null,
    strategyLabelAr: raw.strategyLabelAr || stock.strategyLabelAr || null,
    recommendationScore: n(raw.recommendationScore),
    rawSignalScore: n(raw.rawSignalScore),
    hardFailureCount: n(raw.hardFailureCount, hardFailures.length),
    softFailureCount: n(raw.softFailureCount, softFailures.length),
    hardFailures,
    softFailures,
    plan,
    planValid: validPlan(plan),
    exactFresh: (raw.sessionId || stock.sessionId || null) === sessionId,
    stock: {
      price: n(stock.price),
      change1Pct: n(stock.change1Pct),
      technicalScore: n(stock.technicalScore),
      trendCode: stock.trendCode || null,
      trendLabelAr: stock.trendLabelAr || null,
      rsi14: n(stock.rsi14),
      averageTurnover20Egp: n(stock.averageTurnover20Egp),
      volumeRatio20: n(stock.volumeRatio20),
      support20: n(stock.support20),
      resistance20: n(stock.resistance20),
      historySessions: n(stock.historySessions),
      eligibilityStatus: stock.eligibilityStatus || null
    },
    riskProfile: {
      riskScore: n(riskProfile.riskScore),
      riskCode: riskProfile.riskCode || null,
      riskLabelAr: riskProfile.riskLabelAr || null,
      volatility20Pct: n(riskProfile.volatility20Pct),
      var95OneDayPct: n(riskProfile.var95OneDayPct),
      maxDrawdown100Pct: n(riskProfile.maxDrawdown100Pct),
      beta60: n(riskProfile.beta60),
      liquidityPercentile: n(riskProfile.liquidityPercentile),
      averageTurnover20Egp: n(riskProfile.averageTurnover20Egp, stock.averageTurnover20Egp),
      topCorrelated: A(riskProfile.topCorrelated)
    },
    stockDetailPath: `../../data/quant/stocks/${ticker}.json`,
    reasonAr: raw.reasonAr || null
  };
  item.decisionScore = round(compositeScore(item, policy), 1);
  item.confidence = confidenceLabel(item.decisionScore);
  item.selectionReasonAr = selectionReason(item);
  return item;
}

function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(FILES.policy, true);
  const tiered = readJson(FILES.tiered, true);
  const stocks = readJson(FILES.stocks, true);
  const risk = readJson(FILES.risk, true);

  const sessionId = tiered.sessionId || stocks.sessionId || risk.sessionId || null;
  const stockMap = new Map(A(stocks.stocks).map(x => [safeTicker(x.ticker), x]));
  const riskMap = new Map(A(risk.profiles).map(x => [safeTicker(x.ticker), x]));

  const raw = [
    ...A(tiered.strictPaperCandidates).map(x => ({ raw: x, tier: 'STRICT_PAPER' })),
    ...A(tiered.tierAExperimentalPaper).map(x => ({ raw: x, tier: 'TIER_A_EXPERIMENTAL_PAPER' })),
    ...A(tiered.tierBPriorityWatch).map(x => ({ raw: x, tier: 'TIER_B_PRIORITY_WATCH' }))
  ];

  const dedup = new Map();
  for (const source of raw) {
    const item = normalize(source.raw, source.tier, stockMap, riskMap, sessionId, policy);
    if (!item) continue;
    const existing = dedup.get(item.ticker);
    if (!existing || item.tierPriority > existing.tierPriority ||
        (item.tierPriority === existing.tierPriority && n(item.decisionScore) > n(existing.decisionScore))) {
      dedup.set(item.ticker, item);
    }
  }

  const candidates = [...dedup.values()]
    .sort((a, b) =>
      b.tierPriority - a.tierPriority
      || n(b.decisionScore) - n(a.decisionScore)
      || n(b.recommendationScore) - n(a.recommendationScore)
      || n(b.plan.riskReward1) - n(a.plan.riskReward1)
      || a.ticker.localeCompare(b.ticker)
    )
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const actionable = candidates.filter(x =>
    x.actionablePaper && x.planValid && x.exactFresh && x.hardFailureCount === 0
  );
  const watch = candidates.filter(x => !x.actionablePaper);
  const topCount = Math.max(1, n(policy.ranking.topCandidates, 3));
  const topCandidates = candidates.slice(0, topCount);
  const primaryCandidate = actionable[0] || watch[0] || null;

  let dailyStatus = 'NO_CANDIDATES';
  let dailyStatusLabelAr = 'لا توجد فرصة حالية';
  let dailyActionAr = 'لا تسجل صفقة؛ انتظر جلسة جديدة.';
  if (actionable.length) {
    dailyStatus = actionable[0].tier === 'STRICT_PAPER' ? 'STRICT_PAPER_AVAILABLE' : 'EXPERIMENTAL_PAPER_AVAILABLE';
    dailyStatusLabelAr = actionable[0].tier === 'STRICT_PAPER'
      ? 'توجد توصية ورقية أساسية'
      : 'توجد فرصة ورقية تجريبية';
    dailyActionAr = actionable[0].tier === 'STRICT_PAPER'
      ? 'ابدأ بمراجعة المرشح الصارم الأول، ثم سجل محاكاة ورقية فقط.'
      : 'راجع مرشح الطبقة A الأول، واستخدم مخاطرة مخفضة ومحاكاة ورقية فقط.';
  } else if (watch.length) {
    dailyStatus = 'WATCH_ONLY';
    dailyStatusLabelAr = 'مراقبة فقط';
    dailyActionAr = 'لا توجد فرصة مؤهلة للتداول الورقي؛ راقب الطبقة B ولا تسجل شراء.';
  }

  const output = {
    schemaVersion: '13.11.0',
    generatedAt,
    sessionId,
    liveExecutionEnabled: false,
    automaticPaperRegistration: false,
    dailyStatus,
    dailyStatusLabelAr,
    dailyActionAr,
    marketRegime: tiered.marketRegime || null,
    freshness: tiered.freshness || {},
    counts: {
      strictPaper: candidates.filter(x => x.tier === 'STRICT_PAPER').length,
      tierAExperimental: candidates.filter(x => x.tier === 'TIER_A_EXPERIMENTAL_PAPER').length,
      tierBWatch: candidates.filter(x => x.tier === 'TIER_B_PRIORITY_WATCH').length,
      actionablePaper: actionable.length,
      totalCandidates: candidates.length
    },
    primaryCandidate,
    topCandidates,
    candidates,
    allocationPolicy: policy.allocation,
    safety: policy.safety,
    warningAr: 'هذه الصفحة توحد القرار والتحليل والمخاطر للتداول الورقي فقط. لا ترسل أوامر ولا تضمن الربح.'
  };

  writeJson(FILES.output, output);
  console.log(`V13.11 status=${dailyStatus}, candidates=${candidates.length}, actionable=${actionable.length}`);
}

try { main(); }
catch (error) {
  console.error(`V13.11 build failed: ${error.stack || error.message}`);
  process.exit(1);
}
