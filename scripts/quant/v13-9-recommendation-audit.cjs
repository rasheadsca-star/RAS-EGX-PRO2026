#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const Q = path.join(ROOT, 'data', 'quant');

const FILES = {
  policy: path.join(ROOT, 'data', 'v13-9-audit-calibration-policy.json'),
  trace: path.join(Q, 'recommendation-gate-trace-v13-9.json'),
  model: path.join(Q, 'recommendation-model.json'),
  recommendations: path.join(Q, 'daily-recommendations.json'),
  auditV134: path.join(Q, 'recommendation-audit.json'),
  backtests: path.join(Q, 'strategy-backtests.json'),
  strategyHealth: path.join(Q, 'strategy-health.json'),
  outputAudit: path.join(Q, 'recommendation-engine-audit-v13-9.json'),
  outputShadow: path.join(Q, 'calibrated-shadow-recommendations-v13-9.json')
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

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function countBy(items, selector) {
  const map = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function strategyShadowPass(strategy, policy) {
  const m = strategy?.validationMetrics || {};
  const p = policy.shadowPaper;
  return number(m.closedTrades) >= number(p.minimumClosedTrades)
    && number(m.profitFactor) >= number(p.minimumProfitFactor)
    && number(m.averageR) >= number(p.minimumAverageR)
    && number(m.maxDrawdownPct, 999) <= number(p.maximumDrawdownPct);
}

function strategyFailureReasons(strategy, limits) {
  const m = strategy?.validationMetrics || {};
  const reasons = [];
  if (number(m.closedTrades) < number(limits.minimumClosedTrades)) reasons.push(`الصفقات ${number(m.closedTrades)} < ${number(limits.minimumClosedTrades)}`);
  if (number(m.profitFactor) < number(limits.minimumProfitFactor)) reasons.push(`Profit Factor ${round(m.profitFactor)} < ${limits.minimumProfitFactor}`);
  if (number(m.averageR) < number(limits.minimumAverageR)) reasons.push(`Average R ${round(m.averageR)} < ${limits.minimumAverageR}`);
  if (number(m.maxDrawdownPct, 999) > number(limits.maximumDrawdownPct)) reasons.push(`Maximum Drawdown ${round(m.maxDrawdownPct)}% > ${limits.maximumDrawdownPct}%`);
  return reasons;
}

function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(FILES.policy, true);
  const traceDoc = readJson(FILES.trace, true);
  const model = readJson(FILES.model, true);
  const recs = readJson(FILES.recommendations, true);
  const auditV134 = readJson(FILES.auditV134, true);
  const backtests = readJson(FILES.backtests, true);
  const strategyHealth = readJson(FILES.strategyHealth, false);
  const rows = Array.isArray(traceDoc.rows) ? traceDoc.rows : [];
  const strategies = Array.isArray(model.strategies) ? model.strategies : [];
  const strategyMap = new Map(strategies.map(item => [item.strategyId, item]));

  const historyFilesRead = number(auditV134?.universe?.historyFilesRead);
  const historiesAccepted = number(auditV134?.universe?.historiesAccepted);
  const acceptedCoveragePct = historyFilesRead > 0
    ? (historiesAccepted / historyFilesRead) * 100
    : 0;

  const hardRejected = rows.filter(row => row.stage === 'HARD_REJECT');
  const evaluated = rows.filter(row => row.stage !== 'HARD_REJECT');
  const fresh = rows.filter(row => row.failedGate !== 'history_freshness');
  const safetyPassed = rows.filter(row => !['history_freshness', 'safety_eligibility'].includes(row.failedGate));
  const minimumHistoryPassed = evaluated;
  const signalPassed = evaluated.filter(row => row.signalPassed === true);
  const eligibilityPassed = signalPassed.filter(row => row.eligibilityDecision === true);
  const regimePassed = eligibilityPassed.filter(row => row.regimeAllowed === true);
  const researchValidatedSignal = regimePassed.filter(row => row.strategyResearchValidated === true);
  const scorePaperPassed = researchValidatedSignal.filter(row => row.scorePaperPass === true);
  const strictPaper = evaluated.filter(row => row.strictPaperAllowed === true);

  const strategyAudit = strategies.map(strategy => {
    const strictRules = {
      minimumClosedTrades: model?.promotionRules?.researchMinimumTrades ?? 5,
      minimumProfitFactor: model?.promotionRules?.researchMinimumProfitFactor ?? 1.05,
      minimumAverageR: model?.promotionRules?.researchMinimumAverageR ?? 0,
      maximumDrawdownPct: model?.promotionRules?.researchMaximumDrawdownPct ?? 15
    };
    const shadowPass = strategyShadowPass(strategy, policy);
    const m = strategy.validationMetrics || {};
    return {
      strategyId: strategy.strategyId,
      strategyLabelAr: strategy.strategyLabelAr,
      selectedVariantId: strategy.selectedVariantId,
      currentStatus: strategy.status,
      researchValidated: strategy.researchValidated === true,
      productionEligible: strategy.productionEligible === true,
      validationMetrics: m,
      drawdownValid: number(m.maxDrawdownPct, 999) >= 0 && number(m.maxDrawdownPct, 999) <= 100,
      drawdownMethod: m.drawdownMethod || 'unknown',
      legacyAdditiveDrawdownPct: number(m.legacyAdditiveDrawdownPct),
      strictFailureReasons: strategyFailureReasons(strategy, strictRules),
      shadowPass,
      shadowFailureReasons: strategyFailureReasons(strategy, policy.shadowPaper)
    };
  });

  const shadowEligibleStrategyIds = new Set(strategyAudit.filter(s => s.shadowPass).map(s => s.strategyId));

  const shadowCandidates = evaluated
    .filter(row =>
      row.signalPassed === true
      && row.eligibilityDecision === true
      && row.regimeAllowed === true
      && shadowEligibleStrategyIds.has(row.strategyId)
      && number(row.recommendationScore) >= number(policy.shadowPaper.minimumRecommendationScore)
      && number(row.failedConditionCount) <= number(policy.shadowPaper.maximumFailedConditions)
      && row.strictPaperAllowed !== true
      && number(row.plan?.entryHigh) > number(row.plan?.stopLoss)
    )
    .sort((a, b) =>
      number(b.recommendationScore) - number(a.recommendationScore)
      || number(a.strategyValidationMetrics?.maxDrawdownPct, 999) - number(b.strategyValidationMetrics?.maxDrawdownPct, 999)
      || String(a.ticker).localeCompare(String(b.ticker))
    )
    .slice(0, number(policy.shadowPaper.maximumCandidates))
    .map(row => ({
      ticker: row.ticker,
      companyNameAr: row.companyNameAr,
      companyNameEn: row.companyNameEn,
      sector: row.sector,
      sessionId: row.sessionId,
      status: 'EXPERIMENTAL_PAPER_SHADOW',
      statusLabelAr: policy.shadowPaper.labelAr,
      strategyId: row.strategyId,
      strategyLabelAr: row.strategyLabelAr,
      variantId: row.variantId,
      recommendationScore: row.recommendationScore,
      rawSignalScore: row.rawSignalScore,
      strategyValidationMetrics: row.strategyValidationMetrics,
      marketRegime: row.marketRegime,
      plan: row.plan,
      indicators: row.indicators,
      riskScale: policy.shadowPaper.riskScale,
      maximumRiskPerTradePct: policy.shadowPaper.riskPerTradePct,
      automaticRegistration: false,
      reasonAr: 'اجتاز إشارة اليوم والأهلية والسوق، واجتاز حدًا بحثيًا محافظًا أقل من الإنتاج. مخصص للتسجيل الورقي التجريبي فقط.'
    }));

  const nearMisses = evaluated
    .filter(row => row.strictPaperAllowed !== true)
    .sort((a, b) =>
      number(a.failedConditionCount, 99) - number(b.failedConditionCount, 99)
      || Number(b.signalPassed === true) - Number(a.signalPassed === true)
      || number(b.recommendationScore) - number(a.recommendationScore)
      || String(a.ticker).localeCompare(String(b.ticker))
    )
    .slice(0, number(policy.audit.nearMissLimit))
    .map(row => ({
      ticker: row.ticker,
      companyNameAr: row.companyNameAr,
      sector: row.sector,
      recommendationScore: row.recommendationScore,
      signalPassed: row.signalPassed,
      failedConditionCount: row.failedConditionCount,
      failedConditions: row.failedConditions || [],
      strategyId: row.strategyId,
      strategyLabelAr: row.strategyLabelAr,
      strategyValidationStatus: row.strategyValidationStatus,
      researchValidated: row.strategyResearchValidated,
      eligibilityDecision: row.eligibilityDecision,
      regimeAllowed: row.regimeAllowed,
      scorePaperPass: row.scorePaperPass,
      statusLabelAr: row.statusLabelAr
    }));

  const failedConditionRows = evaluated.flatMap(row =>
    (row.conditions || []).filter(condition => condition.pass !== true).map(condition => ({
      code: condition.code || condition.id || condition.labelAr,
      labelAr: condition.labelAr || condition.code || 'شرط غير معروف',
      ticker: row.ticker
    }))
  );

  const blockerSummary = [
    ...countBy(hardRejected, row => row.failedGateLabelAr || row.failedGate).map(item => ({
      type: 'hard_gate',
      labelAr: item.key,
      count: item.count
    })),
    ...countBy(failedConditionRows, row => row.labelAr).map(item => ({
      type: 'signal_condition',
      labelAr: item.key,
      count: item.count
    })),
    ...countBy(signalPassed.filter(row => row.strategyResearchValidated !== true), row => `حالة الاستراتيجية: ${row.strategyValidationStatus || 'غير معروفة'}`).map(item => ({
      type: 'strategy_validation',
      labelAr: item.key,
      count: item.count
    }))
  ].sort((a, b) => b.count - a.count).slice(0, number(policy.audit.topBlockersLimit));

  const invalidDrawdownStrategies = strategyAudit.filter(strategy => !strategy.drawdownValid);
  const legacyOver100 = strategyAudit.filter(strategy => strategy.legacyAdditiveDrawdownPct > 100);

  const exploratory = evaluated.filter(row =>
    row.eligibilityDecision === true
    && row.regimeAllowed === true
    && number(row.recommendationScore) >= number(policy.exploratoryDiagnostics.minimumRecommendationScore)
    && number(row.failedConditionCount, 99) <= number(policy.exploratoryDiagnostics.maximumFailedConditions)
  );

  const scenarioComparison = [
    {
      code: 'STRICT_CURRENT',
      labelAr: 'الإنتاج الحالي',
      candidateCount: strictPaper.length,
      usage: 'التداول الورقي الأساسي وفق كل بوابات V13.4',
      thresholdsChanged: false
    },
    {
      code: 'CONSERVATIVE_SHADOW',
      labelAr: 'تجريبي ورقي محافظ',
      candidateCount: shadowCandidates.length,
      usage: 'قياس تجريبي منفصل بمخاطرة منخفضة، لا يغير الإنتاج',
      thresholdsChanged: true
    },
    {
      code: 'EXPLORATORY_DIAGNOSTIC',
      labelAr: 'تشخيص قريب من الشروط',
      candidateCount: exploratory.length,
      usage: 'تحليل فقط، ليس توصية ولا صفقة ورقية تلقائية',
      thresholdsChanged: true
    }
  ];

  let verdictCode = 'NO_STRICT_CANDIDATE_NORMAL';
  let verdictAr = 'عدم وجود توصية صارمة قد يكون طبيعيًا لهذه الجلسة.';
  if (acceptedCoveragePct < number(policy.audit.minimumAcceptedHistoryCoveragePct)) {
    verdictCode = 'DATA_COVERAGE_BOTTLENECK';
    verdictAr = 'التغطية التاريخية المقبولة أقل من الحد المستهدف، لذلك يجب إصلاح البيانات قبل تخفيف الشروط.';
  } else if (signalPassed.length === 0) {
    verdictCode = 'NO_CURRENT_MARKET_SIGNAL';
    verdictAr = 'البيانات متاحة، لكن لا يوجد سهم اجتاز جميع شروط إشارة اليوم.';
  } else if (researchValidatedSignal.length === 0) {
    verdictCode = 'STRATEGY_VALIDATION_BOTTLENECK';
    verdictAr = 'توجد إشارات فنية مكتملة، لكن الاستراتيجيات لم تجتز بوابة الجودة التاريخية.';
  } else if (scorePaperPassed.length === 0) {
    verdictCode = 'SCORING_THRESHOLD_BOTTLENECK';
    verdictAr = 'توجد إشارات واستراتيجيات مؤهلة، لكن درجات التوصية أقل من حد الإنتاج.';
  } else if (strictPaper.length === 0) {
    verdictCode = 'ELIGIBILITY_OR_REGIME_BOTTLENECK';
    verdictAr = 'توجد فرص قريبة، لكن الأهلية أو حالة السوق تمنع تحويلها إلى مرشح ورقي أساسي.';
  } else {
    verdictCode = 'STRICT_CANDIDATES_AVAILABLE';
    verdictAr = 'توجد مرشحات تداول ورقي أساسية اجتازت جميع البوابات.';
  }

  const auditOutput = {
    schemaVersion: '13.9.0',
    generatedAt,
    sessionId: recs.sessionId || traceDoc.latestMarketSession || model.latestMarketSession || null,
    liveExecutionEnabled: false,
    productionThresholdsRelaxed: false,
    productionRecommendationsOverwritten: false,
    drawdownCorrection: {
      requiredMethod: 'compounded_equity_peak_to_trough',
      strategiesChecked: strategyAudit.length,
      invalidDrawdownStrategies: invalidDrawdownStrategies.length,
      legacyAdditiveOver100Strategies: legacyOver100.length,
      passed: invalidDrawdownStrategies.length === 0
    },
    coverage: {
      historyFilesRead,
      historiesAccepted,
      acceptedCoveragePct: round(acceptedCoveragePct, 2),
      minimumTargetPct: policy.audit.minimumAcceptedHistoryCoveragePct
    },
    funnel: [
      { code: 'HISTORY_FILES', labelAr: 'ملفات التاريخ المقروءة', count: historyFilesRead },
      { code: 'HISTORIES_ACCEPTED', labelAr: 'تاريخ مقبول للتحليل', count: historiesAccepted },
      { code: 'LATEST_FRESH', labelAr: 'محدث حتى آخر جلسة', count: fresh.length },
      { code: 'SAFETY_ELIGIBLE', labelAr: 'اجتاز السلامة والأهلية الأولية', count: safetyPassed.length },
      { code: 'DECISION_HISTORY', labelAr: 'يمتلك الحد الأدنى لجلسات القرار', count: minimumHistoryPassed.length },
      { code: 'SIGNAL_PASSED', labelAr: 'اجتاز إشارة اليوم', count: signalPassed.length },
      { code: 'ELIGIBILITY_PASSED', labelAr: 'أهلية القرار مكتملة', count: eligibilityPassed.length },
      { code: 'REGIME_PASSED', labelAr: 'حالة السوق تسمح', count: regimePassed.length },
      { code: 'STRATEGY_VALIDATED', labelAr: 'الاستراتيجية مجتازة تاريخيًا', count: researchValidatedSignal.length },
      { code: 'SCORE_PASSED', labelAr: 'الدرجة اجتازت حد الإنتاج', count: scorePaperPassed.length },
      { code: 'STRICT_PAPER', labelAr: 'مرشح ورقي أساسي', count: strictPaper.length }
    ],
    verdict: {
      code: verdictCode,
      labelAr: verdictAr
    },
    strategies: strategyAudit,
    blockerSummary,
    scenarioComparison,
    nearMisses,
    shadowCandidateTickers: shadowCandidates.map(item => item.ticker),
    currentCounts: recs.counts || {},
    adaptiveStrategyHealthAvailable: Boolean(strategyHealth),
    safety: policy.safety
  };

  const shadowOutput = {
    schemaVersion: '13.9.0',
    generatedAt,
    sessionId: auditOutput.sessionId,
    liveExecutionEnabled: false,
    automaticRegistration: false,
    status: shadowCandidates.length ? 'EXPERIMENTAL_PAPER_CANDIDATES_AVAILABLE' : 'NO_EXPERIMENTAL_CANDIDATES',
    statusLabelAr: shadowCandidates.length ? 'مرشحو تداول ورقي تجريبي متاحون' : 'لا توجد فرص تجريبية مؤهلة',
    strictPaperCandidateCount: strictPaper.length,
    experimentalPaperCandidateCount: shadowCandidates.length,
    candidates: shadowCandidates,
    policy: policy.shadowPaper,
    warningAr: 'هذه طبقة تجريبية منفصلة لا تخفف حدود الإنتاج ولا تسجل صفقة تلقائيًا ولا تسمح بالتنفيذ الحقيقي.'
  };

  writeJson(FILES.outputAudit, auditOutput);
  writeJson(FILES.outputShadow, shadowOutput);

  console.log(`V13.9 verdict: ${verdictCode}`);
  console.log(`V13.9 strict paper: ${strictPaper.length}`);
  console.log(`V13.9 experimental shadow: ${shadowCandidates.length}`);
  console.log(`V13.9 signal passed: ${signalPassed.length}`);
}

try {
  main();
} catch (error) {
  console.error(`V13.9 audit failed: ${error.stack || error.message}`);
  process.exit(1);
}
