#!/usr/bin/env node
/*
EGX Pro Hub V11 — Trust Execution Governor
Single source of truth for executable decisions. All other ranking/watchlist files are analytical inputs only.
*/
const fs = require('fs');
const path = require('path');
function read(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function write(file, obj){ fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(obj,null,2)+'\n','utf8'); }
function num(v, d=0){ if(v===null || v===undefined || v==='') return d; const n = Number(String(v).replace(/[,%٬،]/g,'').replace(/[%٪]/g,'').replace(/[^\d.+\-eE]/g,'')); return Number.isFinite(n) ? n : d; }
function round(v, dp=2){ const m = 10 ** dp; return Math.round(num(v) * m) / m; }
function clamp(v,min=0,max=100){ return Math.max(min, Math.min(max, num(v))); }
function key(s){ return String(s||'').trim().toUpperCase(); }
function arr(x){ return Array.isArray(x) ? x : []; }
function mapRows(rows){ const m = {}; arr(rows).forEach(r => { const k = key(r.symbol || r.ticker || r.code); if(k) m[k] = r; }); return m; }
function pick(...xs){ for(const x of xs){ if(x !== undefined && x !== null && x !== '') return x; } return null; }
function pct(n){ return Number(round(n,2)); }
function isUnknownSector(s){ const x=String(s||'').trim(); return !x || x==='-' || x==='غير مصنف' || /unknown/i.test(x); }
function planValidation(r, price){
  const p = num(price, 0);
  let entryFrom = num(pick(r.entryFrom, r.entryLow, r.entry_low, r.buyFrom), 0);
  let entryTo = num(pick(r.entryTo, r.entryHigh, r.entry_high, r.buyTo), 0);
  const target1 = num(pick(r.target1, r.target, r.firstTarget, r.tp1), 0);
  const target2 = num(pick(r.target2, r.tp2), 0);
  const stopLoss = num(pick(r.stopLoss, r.stop_loss, r.sl), 0);
  const errors = [];
  if(entryFrom && entryTo && entryFrom > entryTo){ const t=entryFrom; entryFrom=entryTo; entryTo=t; }
  if(!p || p <= 0) errors.push('لا يوجد سعر نهائي صالح');
  if(!entryFrom || !entryTo || !target1 || !stopLoss) errors.push('خطة الدخول/الهدف/الوقف غير مكتملة');
  const vals = [entryFrom, entryTo, target1, target2 || target1, stopLoss].filter(Boolean);
  vals.forEach(v => { if(v <= 0) errors.push('الخطة تحتوي رقمًا صفرًا أو سالبًا'); });
  const entryMid = entryFrom && entryTo ? (entryFrom + entryTo) / 2 : 0;
  if(p && vals.some(v => v < p * 0.70 || v > p * 1.30)) errors.push('الخطة تحتوي رقمًا بعيدًا أكثر من 30% عن السعر');
  if(p && entryFrom && entryTo && ((entryTo - entryFrom) / p * 100) > 5) errors.push('نطاق الدخول أوسع من 5% من السعر');
  if(entryMid && stopLoss && stopLoss >= entryMid) errors.push('وقف الخسارة أعلى من أو يساوي متوسط الدخول');
  if(entryMid && target1 && target1 <= entryMid) errors.push('الهدف الأول أقل من أو يساوي متوسط الدخول');
  const riskPct = entryMid && stopLoss ? Math.max(0, (entryMid - stopLoss) / entryMid * 100) : 0;
  const rewardPct = entryMid && target1 ? Math.max(0, (target1 - entryMid) / entryMid * 100) : 0;
  const riskReward = riskPct > 0 ? rewardPct / riskPct : 0;
  const entryDistancePct = p && entryFrom && entryTo ? (p < entryFrom ? (entryFrom-p)/entryFrom*100 : p > entryTo ? (p-entryTo)/entryTo*100 : 0) : null;
  const insideOrNearEntry = entryDistancePct !== null && entryDistancePct <= 1;
  return {
    planValid: errors.length === 0,
    planErrors: [...new Set(errors)],
    entryFrom: entryFrom || null,
    entryTo: entryTo || null,
    entryMid: entryMid ? pct(entryMid) : null,
    target1: target1 || null,
    target2: target2 || null,
    stopLoss: stopLoss || null,
    rewardPct: pct(rewardPct),
    riskPct: pct(riskPct),
    riskReward: pct(riskReward),
    entryDistancePct: entryDistancePct === null ? null : pct(entryDistancePct),
    insideOrNearEntry
  };
}
function signalClass(r){
  const s = String([r.signal, r.recommendation, r.action, r.decision, r.grade].filter(Boolean).join(' ')).toLowerCase();
  if(/risk|sell|تخفيف|بيع|خروج|مخاطر|blocked/.test(s)) return 'risk';
  if(/buy|شراء|دخول|فرصة|p1|p2|watch_buy|near/.test(s)) return 'buy';
  return 'watch';
}
function getHistorySessions(sym, rk, hi, hh, hb, integrity){
  return Math.max(
    num(rk.historySessions,0),
    num(hi?.sessionsAvailable,0),
    num(hh?.sessionsAvailable,0),
    num(hb?.sessionsAvailable,0),
    num(integrity?.sessions,0)
  );
}
function dataScore(base, rk){ return clamp(pick(base.dataQualityScore, rk.dataQualityScore, rk.confidence, 70)); }
function technicalScore(base, rk, signal){
  return clamp(pick(signal?.technicalScore, base.technicalScore, base.priceActionScore, rk.targetProbability, base.finalConfidence, 55));
}
function liquidityScore(base, signal){
  const explicit = pick(signal?.liquidityScore, base.liquidityScore);
  if(explicit !== null) return clamp(explicit);
  const tv = num(pick(base.valueTraded, base.turnover),0);
  return clamp(Math.log10(tv + 1) * 12);
}
function newsSectorScore(sym, sector, news){
  const linked = arr(news?.bySymbol?.[sym]).concat(arr(news?.items).filter(x => key(x.symbol) === sym));
  let score = isUnknownSector(sector) ? 20 : 60;
  if(linked.length){
    const avg = linked.reduce((a,x)=>a+num(x.impactScore,0),0)/linked.length;
    score += Math.max(-30, Math.min(30, avg));
  }
  return {score: clamp(score), linkedNewsCount: linked.length};
}
function sourceBlocked(gateway){
  const text = String([gateway.status,gateway.level,gateway.mode].filter(Boolean).join(' '));
  return Boolean(gateway.fallbackUsed || gateway.lastGoodSnapshotUsed || /failed|degraded|fallback|last.good/i.test(text));
}
function main(){
  const rec = read('data/recommendations.json',{});
  const market = read('data/market.json',{rows:[]});
  const ranking = read('data/final-opportunity-ranking.json',{rows:[]});
  const priceRecon = read('data/price-reconciliation-report.json',{rows:[]});
  const priceAudit = read('data/price-source-audit.json',{rows:[]});
  const priceTruth = read('data/price-truth-layer.json',{rows:[],summary:{}});
  const liquidityGate = read('data/liquidity-gate-report.json',{rows:[],summary:{}});
  const tradePlanReport = read('data/trade-plan-validation-report.json',{rows:[],summary:{}});
  const historyTrust = read('data/history-trust-recovery.json',{rows:[],summary:{}});
  const historyIndicators = read('data/history-indicators.json',{indicators:{}});
  const historyHealth = read('data/history-health.json',{perSymbol:{}});
  const historyBackfill = read('data/history-backfill-plan.json',{rows:[]});
  const historyIntegrity = read('data/history-integrity-report.json',{symbols:[]});
  const signalQuality = read('data/signal-quality-report.json',{rows:[]});
  const sectorMap = read('config/egx-sector-map.json',{symbolToSector:{}}).symbolToSector || {};
  const sectorSuggestions = read('data/egx-sector-map-suggestions.json',{suggestions:[]});
  const news = read('data/news-intelligence.json',{});
  const gateway = read('data/source-gateway-report.json',{});
  const sourceHealth = read('data/source-health.json',{});
  const rankMap = mapRows(ranking.rows);
  const priceMap = mapRows(priceRecon.rows);
  const auditMap = mapRows(priceAudit.rows);
  const truthMap = mapRows(priceTruth.rows);
  const liqMap = mapRows(liquidityGate.rows);
  const tradePlanMap = mapRows(tradePlanReport.rows);
  const historyTrustMap = mapRows(historyTrust.rows);
  const marketMap = mapRows(market.rows);
  const hbMap = mapRows(historyBackfill.rows);
  const intMap = mapRows(historyIntegrity.symbols);
  const sigMap = mapRows(signalQuality.rows);
  const sugMap = {}; arr(sectorSuggestions.suggestions).forEach(x=>{ const k=key(x.symbol); if(k && !sugMap[k]) sugMap[k]=x; });
  const baseRows = arr(rec.all).length ? arr(rec.all) : arr(market.rows);
  const seen = new Set();
  const inputRows = baseRows.concat(arr(market.rows)).filter(r=>{ const k=key(r.symbol); if(!k || seen.has(k)) return false; seen.add(k); return true; });
  const isSourceBlocked = sourceBlocked(gateway);
  const now = new Date().toISOString();
  const rows = inputRows.map(raw=>{
    const sym = key(raw.symbol);
    const mk = marketMap[sym] || {};
    const rk = rankMap[sym] || {};
    const pr = priceMap[sym] || {};
    const au = auditMap[sym] || {};
    const pt = truthMap[sym] || {};
    const liq = liqMap[sym] || {};
    const tpv = tradePlanMap[sym] || {};
    const ht = historyTrustMap[sym] || {};
    const sig = sigMap[sym] || {};
    const base = {...raw, ...mk, ...rk};
    const finalPrice = num(pick(pt.price, pr.finalPrice, au.price, rk.price, mk.price, raw.price),0);
    const sector = pick(sectorMap[sym], raw.sector, raw.sector_ar, raw.industry, mk.sector, sugMap[sym]?.suggestedSector, 'غير مصنف');
    const sessions = Math.max(getHistorySessions(sym, rk, historyIndicators.indicators?.[sym], historyHealth.perSymbol?.[sym], hbMap[sym], intMap[sym]), num(ht.sessions,0));
    const plan = tpv.symbol ? {
      planValid: Boolean(tpv.planValid),
      planErrors: arr(tpv.planErrors),
      entryFrom: tpv.entryFrom ?? null, entryTo: tpv.entryTo ?? null, entryMid: tpv.entryMid ?? null,
      target1: tpv.target1 ?? null, target2: tpv.target2 ?? null, stopLoss: tpv.stopLoss ?? null,
      rewardPct: num(tpv.rewardPct,0), riskPct: num(tpv.riskPct,0), riskReward: num(tpv.riskReward,0),
      entryDistancePct: tpv.entryDistancePct ?? null, insideOrNearEntry: Boolean(tpv.insideOrNearEntry)
    } : planValidation({...raw, ...rk}, finalPrice);
    const truthState = String(pt.priceTruthState || '').toUpperCase();
    const hasPriceTruth = Boolean(truthState);
    const priceConflict = hasPriceTruth ? truthState === 'CONFLICT' : Boolean(pr.hasConflict || au.conflict || rk.priceState === 'conflict');
    const stale = hasPriceTruth ? truthState === 'STALE' : Boolean(pr.isStale || au.stale || rk.priceState === 'stale');
    const precisionRisk = hasPriceTruth ? truthState === 'PRECISION_RISK' : Boolean(pr.precisionRisk || au.precisionRisk || rk.precisionRisk || rk.priceState === 'precision_risk');
    const noTruthPrice = Boolean(truthState === 'NO_PRICE');
    const priceIntegrity = (pt.executionPriceOk === true) ? 100 : priceConflict || precisionRisk || noTruthPrice ? 0 : stale ? 40 : 100;
    const dScore = dataScore(base, rk);
    const tScore = technicalScore(base, rk, sig);
    const lScore = liq.symbol ? clamp(liq.liquidityScore,0,100) : liquidityScore(base, sig);
    const rrScore = clamp((plan.riskReward / 1.5) * 100);
    const ns = newsSectorScore(sym, sector, news);
    const hScore = sessions >= 50 ? 100 : sessions >= 20 ? 70 : sessions >= 10 ? 40 : 10;
    let confidence =
      dScore * 0.25 + priceIntegrity * 0.20 + tScore * 0.15 + lScore * 0.15 + rrScore * 0.15 + ns.score * 0.05 + hScore * 0.05;
    const confidenceDeductions = [];
    if(isUnknownSector(sector)){ confidence -= 7; confidenceDeductions.push('خصم قطاع غير مصنف'); }
    let maxConfidence = 95;
    if(sessions < 10) maxConfidence = Math.min(maxConfidence,45);
    else if(sessions < 20) maxConfidence = Math.min(maxConfidence,60);
    else if(sessions < 50) maxConfidence = Math.min(maxConfidence,75);
    if(priceConflict || precisionRisk) maxConfidence = Math.min(maxConfidence,30);
    if(stale) maxConfidence = Math.min(maxConfidence,50);
    if(isSourceBlocked) maxConfidence = Math.min(maxConfidence,55);
    if(liq.liquidityDecision === 'WATCH_ONLY') maxConfidence = Math.min(maxConfidence,65);
    if(liq.liquidityDecision === 'BLOCKED_ILLIQUID') maxConfidence = Math.min(maxConfidence,55);
    confidence = Math.round(clamp(confidence, 0, maxConfidence));
    if(sessions < 50) confidence = Math.min(confidence, 99);
    const blockReasons = [];
    if(priceConflict) blockReasons.push('تعارض سعر بين المصادر');
    if(precisionRisk) blockReasons.push('دقة السعر غير كافية للتنفيذ');
    if(!finalPrice || noTruthPrice) blockReasons.push('لا يوجد سعر نهائي صالح');
    if(stale) blockReasons.push('السعر قديم أو عمر البيانات غير مناسب للتنفيذ');
    if(!plan.planValid) blockReasons.push(...plan.planErrors);
    if(signalClass(base) === 'risk') blockReasons.push('إشارة مخاطر أو تخفيف');
    const executionNotes = [];
    if(sessions < 10) executionNotes.push(`التاريخ المتاح ${sessions}/50: مراقبة فقط ولا تنفيذ`);
    else if(sessions < 20) executionNotes.push(`التاريخ المتاح ${sessions}/50: لا يسمح بشراء تنفيذي`);
    else if(sessions < 50) executionNotes.push(`التاريخ ${sessions}/50: الثقة مخفضة`);
    if(isSourceBlocked) executionNotes.push('تم استخدام مصدر بديل/لقطة أخيرة أو بوابة بيانات غير كاملة: يمنع التنفيذ المباشر');
    if(ns.linkedNewsCount === 0) executionNotes.push('لا توجد أخبار مرتبطة مباشرة بالسهم مؤثرة على القرار');
    if(liq.liquidityDecision === 'WATCH_ONLY') executionNotes.push('السيولة تسمح بالمراقبة فقط ولا تكفي لتنفيذ آمن');
    if(liq.liquidityDecision === 'BLOCKED_ILLIQUID') executionNotes.push('السيولة ضعيفة وتمنع أي شراء تنفيذي');
    const hardBlocked = blockReasons.length > 0;
    const buyIntent = signalClass(base) === 'buy' || ['P1','P2'].includes(String(rk.grade||''));
    const intradayLiquidityOk = liq.symbol ? liq.executionLiquidityOk === true : lScore >= 65;
    const conditionalLiquidityOk = liq.symbol ? (liq.executionLiquidityOk === true || liq.conditionalLiquidityOk === true) : lScore >= 55;
    const enoughLiquidity = conditionalLiquidityOk;
    const rrOk = plan.riskReward >= 1.5;
    const historyAllowsBuy = sessions >= 20;
    let finalDecision = 'NO_TRADE';
    let decisionArabic = 'غير مناسب حاليًا';
    let executionAllowed = false;
    let decisionClass = 'no';
    const reasonParts = [];
    if(hardBlocked){
      finalDecision = 'BLOCKED'; decisionArabic = 'ممنوع التنفيذ'; decisionClass = 'blocked';
      reasonParts.push(blockReasons.slice(0,3).join('، '));
    } else if(!historyAllowsBuy || isSourceBlocked){
      finalDecision = 'WATCH'; decisionArabic = 'مراقبة فقط'; decisionClass = 'watch';
      reasonParts.push(executionNotes.slice(0,2).join('، ') || 'بيانات غير كافية للتنفيذ');
    } else if(buyIntent && rrOk && intradayLiquidityOk && plan.insideOrNearEntry && !stale && confidence >= 70){
      finalDecision = 'BUY_TODAY_INTRADAY'; decisionArabic = 'شراء اليوم للمضاربة داخل الجلسة'; decisionClass = 'today'; executionAllowed = true;
      reasonParts.push('السعر داخل أو قريب من نطاق الدخول، R/R مناسب، والسيولة مقبولة');
    } else if(buyIntent && rrOk && conditionalLiquidityOk && confidence >= 65 && plan.entryDistancePct !== null && plan.entryDistancePct <= 5){
      finalDecision = 'BUY_TOMORROW_CONDITIONAL'; decisionArabic = 'شراء غدًا مشروط'; decisionClass = 'tomorrow'; executionAllowed = true;
      reasonParts.push('شراء غدًا مشروط: لا تدخل إلا إذا افتتح أو عاد السهم إلى نطاق الدخول مع تأكيد السيولة');
    } else if(buyIntent || confidence >= 55 || enoughLiquidity){
      finalDecision = 'WATCH'; decisionArabic = 'مراقبة فقط'; decisionClass = 'watch';
      if(!rrOk) reasonParts.push('العائد/المخاطرة أقل من 1.5');
      if(!plan.insideOrNearEntry) reasonParts.push('السعر ليس داخل نطاق الدخول');
      if(!enoughLiquidity) reasonParts.push('السيولة لا تكفي للتنفيذ الآمن');
      if(!reasonParts.length) reasonParts.push('فرصة قابلة للمراقبة وليست شراء الآن');
    } else {
      finalDecision = 'NO_TRADE'; decisionArabic = 'لا تدخل'; decisionClass = 'no';
      reasonParts.push('ضعف العائد/المخاطرة أو السيولة أو الاتجاه لا يبرر الدخول');
    }
    const priorityWeight = {BUY_TODAY_INTRADAY:5, BUY_TOMORROW_CONDITIONAL:4, WATCH:3, NO_TRADE:2, BLOCKED:1}[finalDecision] || 0;
    const finalScore = Math.round(clamp(confidence + priorityWeight * 2 + Math.min(5, plan.riskReward || 0), 0, confidence));
    const executionBlockReason = executionAllowed ? '' : [...new Set(blockReasons.concat(executionNotes))].join('، ');
    return {
      symbol: sym,
      name: pick(raw.name_ar, raw.name, raw.name_en, mk.name_ar, mk.name_en, rk.name, ''),
      sector,
      price: finalPrice,
      priceDisplay: finalPrice ? (finalPrice < 1 ? finalPrice.toFixed(3) : round(finalPrice,2).toFixed(2)) : null,
      changePct: num(pick(mk.changePct, raw.changePct, rk.changePct),0),
      volume: num(pick(mk.volume, raw.volume, rk.volume),0),
      turnover: num(pick(mk.valueTraded, mk.turnover, raw.valueTraded, raw.turnover, rk.turnover),0),
      finalDecision,
      decisionArabic,
      decisionClass,
      executionAllowed,
      executionBlockReason,
      finalConfidence: confidence,
      maxConfidence,
      finalScore,
      dataQuality: round(dScore,1),
      priceIntegrity: round(priceIntegrity,1),
      technicalTrend: round(tScore,1),
      liquidity: round(lScore,1),
      newsSector: round(ns.score,1),
      historicalValidation: hScore,
      historySessions: sessions,
      historyRequired: 50,
      historyEnoughForExecution: sessions >= 20,
      priceState: priceConflict ? 'conflict' : precisionRisk ? 'precision_risk' : stale ? 'stale' : noTruthPrice ? 'no_price' : 'ok',
      precisionRisk,
      stale,
      priceConflict,
      sourceUsed: pick(pt.selectedSource, pr.sourceUsed, au.sourceUsed, mk.source, raw.source, rk.sourceUsed, ''),
      priceTruthState: truthState || (priceConflict ? 'CONFLICT' : precisionRisk ? 'PRECISION_RISK' : stale ? 'STALE' : 'OK'),
      priceTruthFreshSources: num(pt.freshSourceCount,0),
      stalePriceComparisonsIgnored: num(pt.staleComparisonsIgnored,0),
      liquidityDecision: liq.liquidityDecision || '',
      liquidityReason: liq.reason || '',
      currentTurnover: num(liq.currentTurnover, pick(mk.valueTraded, mk.turnover, raw.valueTraded, raw.turnover, 0)),
      avg20Turnover: num(liq.avg20Turnover,0),
      sourceAgeMinutes: num(pr.sourceAgeMinutes, null),
      planValidation: plan,
      entryFrom: plan.entryFrom,
      entryTo: plan.entryTo,
      entryMid: plan.entryMid,
      target1: plan.target1,
      target2: plan.target2,
      stopLoss: plan.stopLoss,
      riskReward: plan.riskReward,
      rewardPct: plan.rewardPct,
      riskPct: plan.riskPct,
      entryDistancePct: plan.entryDistancePct,
      linkedNewsCount: ns.linkedNewsCount,
      gradeInput: rk.grade || raw.grade || '',
      inputSources: ['recommendations','market','final_ranking','price_reconciliation','history','news_sector'].filter(Boolean),
      blockReasons: [...new Set(blockReasons)],
      confidenceDeductions,
      why: [...new Set(reasonParts.filter(Boolean))].join('، '),
      userMessage: finalDecision === 'BUY_TODAY_INTRADAY' ? 'شراء اليوم للمضاربة داخل الجلسة فقط مع الالتزام بالهدف والوقف.' : finalDecision === 'BUY_TOMORROW_CONDITIONAL' ? 'شراء غدًا مشروط: لا تدخل إلا إذا افتتح أو عاد السهم إلى نطاق الدخول مع تأكيد السيولة.' : finalDecision === 'WATCH' ? 'مراقبة فقط: لا توجد إشارة شراء تنفيذية الآن.' : finalDecision === 'BLOCKED' ? 'ممنوع التنفيذ: السعر أو البيانات أو الخطة غير موثوقة.' : 'لا تدخل حاليًا: العائد/المخاطرة غير كافٍ.'
    };
  }).sort((a,b)=>{
    const order={BUY_TODAY_INTRADAY:5,BUY_TOMORROW_CONDITIONAL:4,WATCH:3,NO_TRADE:2,BLOCKED:1};
    return (order[b.finalDecision]-order[a.finalDecision]) || b.finalConfidence-a.finalConfidence || b.riskReward-a.riskReward || b.turnover-a.turnover;
  });
  const blockedByReason = {};
  rows.filter(r=>r.finalDecision==='BLOCKED').forEach(r=>{ (r.blockReasons.length?r.blockReasons:['غير محدد']).forEach(x=>blockedByReason[x]=(blockedByReason[x]||0)+1); });
  const summary = {
    total: rows.length,
    executableToday: rows.filter(r=>r.finalDecision==='BUY_TODAY_INTRADAY').length,
    conditionalTomorrow: rows.filter(r=>r.finalDecision==='BUY_TOMORROW_CONDITIONAL').length,
    watch: rows.filter(r=>r.finalDecision==='WATCH').length,
    noTrade: rows.filter(r=>r.finalDecision==='NO_TRADE').length,
    blocked: rows.filter(r=>r.finalDecision==='BLOCKED').length,
    executionAllowed: rows.filter(r=>r.executionAllowed).length,
    historyEnoughForExecution: rows.filter(r=>r.historySessions>=20).length,
    fullHistory50: rows.filter(r=>r.historySessions>=50).length,
    priceConflicts: rows.filter(r=>r.priceConflict).length,
    precisionRisk: rows.filter(r=>r.precisionRisk).length,
    stale: rows.filter(r=>r.stale).length,
    unknownSector: rows.filter(r=>isUnknownSector(r.sector)).length,
    priceTruthReliableCoveragePct: priceTruth.summary?.reliableCoveragePct || null,
    priceTruthConflicts: priceTruth.summary?.conflict ?? null,
    liquidityExecutionOk: liquidityGate.summary?.executionOk || 0,
    liquidityConditionalOk: liquidityGate.summary?.conditionalOk || 0,
    validTradePlans: tradePlanReport.summary?.valid || 0,
    historyReady50: historyTrust.summary?.ready50 || 0,
    blockedByReason,
    dataMode: 'public_delayed',
    executionReadiness: rows.some(r=>r.executionAllowed) ? 'CONDITIONAL_EXECUTION_REVIEW' : 'WATCH_ONLY_NO_EXECUTION',
    conclusion: rows.some(r=>r.executionAllowed) ? 'توجد فرص مشروطة للمراجعة وليست أوامر شراء تلقائية.' : 'البيانات الحالية تصلح للمراقبة فقط ولا تسمح بتوصية شراء تنفيذية آمنة.'
  };
  const topThree = rows.filter(r=>r.finalDecision!=='BLOCKED' && r.finalDecision!=='NO_TRADE').slice(0,3);
  const report = {
    ok: true,
    engine: 'v11_trust_execution_governor',
    generatedAt: now,
    singleSourceOfTruth: 'data/unified-decision-board.json',
    summary,
    gateway: {
      status: gateway.status || gateway.mode || '',
      level: gateway.level || '',
      marketRows: gateway.marketRows || arr(market.rows).length,
      coveragePct: gateway.coveragePct || sourceHealth.coveragePct || sourceHealth.reliableCoveragePct || null,
      fallbackUsed: Boolean(gateway.fallbackUsed),
      lastGoodSnapshotUsed: Boolean(gateway.lastGoodSnapshotUsed)
    },
    trustRules: {
      decisions: ['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL','WATCH','NO_TRADE','BLOCKED'],
      confidenceWeights: {dataQuality:25, priceIntegrity:20, technicalTrend:15, liquidity:15, riskReward:15, newsSector:5, historicalValidation:5},
      hardGates: ['price conflict','precision risk','invalid plan','stale/fallback prevents direct execution','history < 20 prevents buy','liquidity gate prevents buy','confidence capped by history']
    },
    topThree,
    rows,
    trustLiftInputs: {priceTruthLayer: 'data/price-truth-layer.json', historyTrustRecovery: 'data/history-trust-recovery.json', liquidityGate: 'data/liquidity-gate-report.json', tradePlanValidation: 'data/trade-plan-validation-report.json'},
    note: 'V11.1 Trust Execution Governor: this file is the only source of user-facing final decisions. Ranking/watchlist/trigger reports are inputs and must not compete with this board.'
  };
  write('data/unified-decision-board.json', report);
  write('data/v11-trust-execution-report.json', {
    ok:true,
    generatedAt: now,
    summary,
    topThree: topThree.map(r=>({symbol:r.symbol, decision:r.finalDecision, confidence:r.finalConfidence, why:r.why})),
    acceptance: {
      noP1P2OnPriceConflict: rows.every(r => !(r.priceConflict && ['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision))),
      noBuyTodayUnder20History: rows.every(r => !(r.finalDecision==='BUY_TODAY_INTRADAY' && r.historySessions < 20)),
      noConfidence100Under50History: rows.every(r => !(r.finalConfidence >= 100 && r.historySessions < 50)),
      noStopAboveEntry: rows.every(r => !r.planValidation?.planValid || num(r.stopLoss) < num(r.entryMid)),
      noTargetBelowEntry: rows.every(r => !r.planValidation?.planValid || num(r.target1) > num(r.entryMid)),
      noWideOrNegativeEntryRanges: rows.every(r => r.planValidation?.planValid || !['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision)),
      unifiedBoardOnly: true,
      fallbackPreventsDirectExecution: isSourceBlocked ? rows.every(r => !['BUY_TODAY_INTRADAY','BUY_TOMORROW_CONDITIONAL'].includes(r.finalDecision)) : true
    }
  });
  console.log('V11 Trust Execution Governor', summary);
}
main();
