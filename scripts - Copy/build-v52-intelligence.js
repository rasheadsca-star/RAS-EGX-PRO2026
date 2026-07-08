/*
  EGX Pro Hub — V5.2 Intelligence Builder
  Safe add-on script. Reads V4.2 outputs and creates V5.2 reports.
  It does NOT reset scan-state.json or full-market-cache.json.
*/
const fs = require('fs');
const path = require('path');

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function round(v, d = 2) { return Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null; }
function arr(v) { return Array.isArray(v) ? v : []; }
function pct(part, total) { return total ? Math.round((part / total) * 100) : 0; }

function scoreOpportunity(row) {
  const confidence = n(row.finalConfidence ?? row.confidence, 0);
  const liquidity = n(row.liquidityScore, 0);
  const quality = n(row.dataQualityScore, 0);
  const risk = n(row.riskScore, 0);
  const rr = n(row.riskReward, 0);
  let score = confidence * 0.35 + liquidity * 0.20 + quality * 0.15 + Math.min(rr * 25, 100) * 0.15 + Math.max(0, 100 - risk) * 0.15;
  if (row.signal === 'WATCH_BUY') score += 8;
  if (row.signal === 'RISK_REDUCE') score -= 20;
  if (row.stale) score -= 18;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function classify(row) {
  if (!row || !row.symbol) return 'unknown';
  if (row.stale) return 'stale_data';
  if (row.signal === 'RISK_REDUCE' || n(row.riskScore) >= 70) return 'risk_reduce';
  if (row.signal === 'WATCH_BUY' && scoreOpportunity(row) >= 65) return 'strong_watch';
  if (row.signal === 'WATCH_BUY') return 'conditional_watch';
  if (row.signal === 'WATCH') return 'watch';
  if (n(row.dataQualityScore) < 45) return 'low_data_quality';
  return 'wait';
}

function buildAlerts(rows, audit, sourceHealth, generatedAt) {
  const alerts = [];
  const missing = arr(audit.missingFromCache);
  const failed = arr(sourceHealth.failedSymbols);

  if (missing.includes('ETRS')) {
    alerts.push({
      level: 'warning',
      type: 'universe_missing_cache',
      symbol: 'ETRS',
      title_ar: 'ETRS موجود/مطلوب لكنه لم يدخل الكاش بعد',
      message_ar: 'السهم يحتاج تشغيل Workflow حتى يدخل Batch القادم. لا تعمل Reset للكاش.',
      action_ar: 'شغّل Update EGX Market Data مرة أو أكثر.'
    });
  }

  if (missing.length) {
    alerts.push({
      level: missing.length > 25 ? 'warning' : 'info',
      type: 'universe_coverage',
      title_ar: 'أسهم لم تدخل الكاش بعد',
      message_ar: `${missing.length} رمز موجود في الكون ولم يظهر في الكاش حتى الآن.`,
      symbols: missing.slice(0, 50)
    });
  }

  if (failed.length) {
    alerts.push({
      level: 'warning',
      type: 'batch_failures',
      title_ar: 'رموز فشلت في آخر تشغيل',
      message_ar: `${failed.length} رمز فشل في القراءة من الصفحات العامة.`,
      symbols: failed.slice(0, 50)
    });
  }

  rows
    .filter(r => classify(r) === 'strong_watch')
    .slice(0, 10)
    .forEach(r => alerts.push({
      level: 'info',
      type: 'strong_watch',
      symbol: r.symbol,
      title_ar: `${r.symbol} مراقبة قوية`,
      message_ar: `${r.decision || 'مراقبة'} — ثقة ${r.finalConfidence ?? r.confidence ?? 0}، سيولة ${r.liquidityScore ?? 0}.`,
      price: r.price ?? null,
      entryFrom: r.entryFrom ?? null,
      entryTo: r.entryTo ?? null,
      target1: r.target1 ?? null,
      stopLoss: r.stopLoss ?? null
    }));

  rows
    .filter(r => classify(r) === 'risk_reduce')
    .slice(0, 10)
    .forEach(r => alerts.push({
      level: 'danger',
      type: 'risk_reduce',
      symbol: r.symbol,
      title_ar: `${r.symbol} مخاطرة مرتفعة`,
      message_ar: r.reason || 'إشارة حذر بسبب ضغط سعري أو كسر دعم أو جودة بيانات ضعيفة.',
      price: r.price ?? null
    }));

  return { ok: true, generatedAt, disclaimer_ar: 'هذه تنبيهات مراقبة مبنية على بيانات عامة ومتأخرة وليست أوامر تداول.', count: alerts.length, alerts };
}

function buildRiskDashboard(rows, audit, sourceHealth, generatedAt) {
  const groups = {
    strongWatch: [],
    conditionalWatch: [],
    watch: [],
    wait: [],
    lowDataQuality: [],
    riskReduce: [],
    staleData: []
  };
  for (const row of rows) {
    const c = classify(row);
    if (c === 'strong_watch') groups.strongWatch.push(row);
    else if (c === 'conditional_watch') groups.conditionalWatch.push(row);
    else if (c === 'watch') groups.watch.push(row);
    else if (c === 'risk_reduce') groups.riskReduce.push(row);
    else if (c === 'low_data_quality') groups.lowDataQuality.push(row);
    else if (c === 'stale_data') groups.staleData.push(row);
    else groups.wait.push(row);
  }

  const total = rows.length;
  const avgQuality = total ? Math.round(rows.reduce((s, r) => s + n(r.dataQualityScore), 0) / total) : 0;
  const avgConfidence = total ? Math.round(rows.reduce((s, r) => s + n(r.finalConfidence ?? r.confidence), 0) / total) : 0;

  return {
    ok: true,
    generatedAt,
    disclaimer_ar: 'لوحة مخاطر للمراقبة فقط. البيانات عامة ومتأخرة.',
    summary: {
      totalRows: total,
      avgQuality,
      avgConfidence,
      universeCoveragePct: sourceHealth.universeCoveragePct || audit?.summary?.universeCoveragePct || 0,
      missingFromCache: audit?.summary?.missingFromCache || 0,
      failedSymbols: arr(sourceHealth.failedSymbols).length,
      strongWatchPct: pct(groups.strongWatch.length, total),
      riskReducePct: pct(groups.riskReduce.length, total),
      lowQualityPct: pct(groups.lowDataQuality.length, total)
    },
    groups: Object.fromEntries(Object.entries(groups).map(([k, list]) => [k, list.slice(0, 50).map(r => ({
      symbol: r.symbol,
      name: r.name || r.name_ar || r.name_en || r.symbol,
      price: r.price ?? null,
      finalConfidence: r.finalConfidence ?? r.confidence ?? null,
      liquidityScore: r.liquidityScore ?? null,
      riskScore: r.riskScore ?? null,
      dataQualityScore: r.dataQualityScore ?? null,
      signal: r.signal || null,
      reason: r.reason || null
    }))]))
  };
}

function buildProReport(rows, audit, sourceHealth, generatedAt) {
  const enriched = rows.map(r => ({ ...r, opportunityScore: scoreOpportunity(r), classification: classify(r) }));
  const top = enriched
    .filter(r => ['strong_watch', 'conditional_watch', 'watch'].includes(r.classification))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 25)
    .map(r => ({
      symbol: r.symbol,
      name: r.name || r.name_ar || r.name_en || r.symbol,
      classification: r.classification,
      opportunityScore: r.opportunityScore,
      price: r.price ?? null,
      changePct: r.changePct ?? null,
      confidence: r.finalConfidence ?? r.confidence ?? null,
      liquidityScore: r.liquidityScore ?? null,
      dataQualityScore: r.dataQualityScore ?? null,
      entryFrom: r.entryFrom ?? null,
      entryTo: r.entryTo ?? null,
      target1: r.target1 ?? null,
      target2: r.target2 ?? null,
      stopLoss: r.stopLoss ?? null,
      riskReward: r.riskReward ?? null,
      decision: r.decision || r.recommendation || 'مراقبة',
      reason: r.reason || ''
    }));

  return {
    ok: true,
    generatedAt,
    version: 'V5.2 Command Center Intelligence',
    source: 'V4.2 full-market batch cache + public delayed Mubasher pages',
    disclaimer_ar: 'الترشيحات تحليل ومراقبة وليست أوامر شراء أو بيع. البيانات عامة ومتأخرة.',
    executiveSummary_ar: [
      `عدد الأسهم داخل الكاش الحالي: ${rows.length}.`,
      `تغطية الكون الحالية: ${sourceHealth.universeCoveragePct || audit?.summary?.universeCoveragePct || 0}%.`,
      `عدد الرموز المنتظرة في الكاش: ${audit?.summary?.missingFromCache || 0}.`,
      top.length ? `أفضل فرصة مراقبة حالية حسب النموذج: ${top[0].symbol}.` : 'لا توجد فرص مراقبة قوية كافية حاليًا.'
    ],
    universe: audit?.summary || {},
    sourceHealth,
    topOpportunities: top,
    etrsStatus: audit?.etrs || null,
    notes_ar: [
      'لا تعمل Reset لملفات scan-state/full-market-cache إلا عند الطلب الصريح.',
      'عند إضافة رموز جديدة يتم اكتشافها في symbol-audit ثم تدخل الكاش مع تشغيلات Workflow التالية.',
      'غياب سهم من الكاش لا يعني عدم وجوده في السوق؛ قد يكون منتظرًا في Batch قادم أو فشل رابط مباشر.'
    ]
  };
}

function buildSessionReport(rows, alerts, audit, sourceHealth, generatedAt) {
  const total = rows.length;
  const watchBuy = rows.filter(r => r.signal === 'WATCH_BUY').length;
  const riskReduce = rows.filter(r => r.signal === 'RISK_REDUCE').length;
  const lowQuality = rows.filter(r => n(r.dataQualityScore) < 45).length;
  return {
    ok: true,
    generatedAt,
    mode: 'public_delayed_session_monitor',
    disclaimer_ar: 'تقرير جلسة للمراقبة فقط وليس توصية تنفيذ.',
    summary_ar: `تم تحليل ${total} سهم من الكاش الحالي. مراقبة شراء: ${watchBuy}. حذر/تخفيف: ${riskReduce}. جودة بيانات منخفضة: ${lowQuality}.`,
    numbers: {
      cachedRows: total,
      watchBuy,
      riskReduce,
      lowQuality,
      alerts: alerts.count,
      universeCoveragePct: sourceHealth.universeCoveragePct || audit?.summary?.universeCoveragePct || 0,
      missingFromCache: audit?.summary?.missingFromCache || 0
    },
    topWatch: rows
      .map(r => ({ ...r, opportunityScore: scoreOpportunity(r) }))
      .sort((a, b) => b.opportunityScore - a.opportunityScore)
      .slice(0, 15)
      .map(r => ({ symbol: r.symbol, price: r.price ?? null, opportunityScore: r.opportunityScore, decision: r.decision || r.recommendation || '', reason: r.reason || '' })),
    riskWatch: rows
      .filter(r => r.signal === 'RISK_REDUCE' || n(r.riskScore) >= 70)
      .slice(0, 15)
      .map(r => ({ symbol: r.symbol, price: r.price ?? null, riskScore: r.riskScore ?? null, reason: r.reason || '' }))
  };
}

function buildNewsReport(newsConfig, generatedAt) {
  const sources = arr(newsConfig.sources || newsConfig);
  return {
    ok: true,
    generatedAt,
    mode: 'configured_sources_placeholder',
    disclaimer_ar: 'مصادر الأخبار مهيأة. الربط الكامل للأخبار يمكن تفعيله لاحقًا بدون التأثير على V4.2.',
    sourcesCount: sources.length,
    sources: sources.map(s => ({ name: s.name || s.title || 'source', url: s.url || '', type: s.type || 'web' })),
    items: [],
    notes_ar: [
      'V5.2 الحالي يبني تقارير الذكاء من بيانات السوق الموجودة.',
      'جلب الأخبار المباشر يفضل إضافته كخطوة مستقلة بعد تثبيت Universe Repair حتى لا يؤثر على Workflow.'
    ]
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const market = readJson('data/market.json', {});
  const fullCache = readJson('data/full-market-cache.json', {});
  const recs = readJson('data/recommendations.json', {});
  const audit = readJson('data/symbol-audit.json', {});
  const sourceHealth = readJson('data/source-health.json', {});
  const newsConfig = readJson('config/news-sources.json', { sources: [] });

  const rows = arr(fullCache.rows).length ? arr(fullCache.rows)
    : arr(market.rows).length ? arr(market.rows)
    : arr(recs.all);

  const alerts = buildAlerts(rows, audit, sourceHealth, generatedAt);
  const riskDashboard = buildRiskDashboard(rows, audit, sourceHealth, generatedAt);
  const proReport = buildProReport(rows, audit, sourceHealth, generatedAt);
  const sessionReport = buildSessionReport(rows, alerts, audit, sourceHealth, generatedAt);
  const newsReport = buildNewsReport(newsConfig, generatedAt);

  writeJson('data/alerts.json', alerts);
  writeJson('data/risk-dashboard.json', riskDashboard);
  writeJson('data/pro-report.json', proReport);
  writeJson('data/session-report.json', sessionReport);
  writeJson('data/news-report.json', newsReport);

  console.log(`V5.2 intelligence generated: rows=${rows.length}, alerts=${alerts.count}, top=${proReport.topOpportunities.length}`);
}

main();
