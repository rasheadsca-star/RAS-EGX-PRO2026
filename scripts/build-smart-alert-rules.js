/*
EGX Pro Hub V8.9.1 — Smart Alert Rules
Purpose: produce fewer, clearer, actionable alerts. No manual data input.
*/
const fs = require('fs');
const path = require('path');
function read(file, fallback){ try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function write(file, obj){ fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(obj,null,2), 'utf8'); }
function n(v){ const x = Number(String(v ?? '').replace(/[,٪%]/g,'')); return Number.isFinite(x) ? x : 0; }
function uniqBy(arr, keyFn){ const seen = new Set(); return arr.filter(x => { const k = keyFn(x); if(seen.has(k)) return false; seen.add(k); return true; }); }
function main(){
  const ranking = read('data/final-opportunity-ranking.json', {rows:[]});
  const price = read('data/price-reconciliation-report.json', {summary:{}, rows:[]});
  const hist = read('data/history-backfill-plan.json', {});
  const sourceFetch = read('data/source-fetch-report.json', {});
  const newsIntel = read('data/news-intelligence.json', {bySymbol:{}, items:[]});
  const rules = [];
  const now = new Date().toISOString();
  function add(rule){
    const id = rule.id || [rule.category, rule.level, rule.type, rule.symbol || 'market', rule.title].join(':');
    rules.push({id, generatedAt: now, ...rule});
  }

  const conflicts = (price.rows||[]).filter(x => x.hasConflict);
  if(conflicts.length){
    conflicts.slice(0,15).forEach(x => add({
      level:'critical', priority:'عاجل', category:'price', type:'price_conflict', symbol:x.symbol,
      title:'تعارض سعر يحتاج مراجعة',
      trigger:`اختلاف بين مصادر السعر: ${x.conflictSummary || ''}`,
      action:'لا تعتمد على نقطة دخول/هدف لهذا السهم قبل مراجعة السعر',
      reason:'تعارض السعر يؤثر مباشرة على الدخول والوقف والأهداف'
    }));
  }

  const stale = (price.rows||[]).filter(x => x.isStale);
  if(stale.length){
    add({
      level: stale.length > 25 ? 'warning' : 'info',
      priority: stale.length > 25 ? 'مهم' : 'معلومة',
      category:'price', type:'stale_price_summary', symbol:null,
      title:`${stale.length} أسعار تحتاج تحديث/تحقق`,
      trigger:`أمثلة: ${stale.slice(0,12).map(x=>x.symbol).join(', ')}`,
      action:'شغّل Workflow مرة واحدة فقط أو انتظر تحديث المصدر؛ لا تكرر التشغيل بلا داعٍ',
      reason:'تم تجميع الأسعار القديمة في تنبيه واحد لتقليل الضوضاء'
    });
  }

  const rows = Array.isArray(ranking.rows) ? ranking.rows : [];
  rows.filter(r => r.grade === 'P1' || r.grade === 'P2').slice(0,12).forEach((r, i) => {
    add({
      level: r.grade === 'P1' ? 'opportunity' : 'watch',
      priority: r.grade === 'P1' ? 'مراقبة قوية' : 'مراقبة',
      category:'ranking', type:'ranked_opportunity', symbol:r.symbol,
      title:`${r.grade} — فرصة مرتبة #${i+1}`,
      trigger:`الثقة ${n(r.targetProbability)}% | R/R ${n(r.rr).toFixed(2)} | عائد متوقع ${n(r.expectedReturnPct).toFixed(1)}%`,
      action:'راجع سعر الدخول والوقف قبل أي قرار، والبيانات عامة ومتأخرة',
      reason:r.why || 'مرشح من محرك الأولويات'
    });
  });

  rows.filter(r => r.grade === 'Blocked').slice(0,10).forEach(r => add({
    level:'warning', priority:'مهم', category:'ranking', type:'blocked_candidate', symbol:r.symbol,
    title:'مرشح مقيّد لا يرفع للأولوية',
    trigger:(r.blocks||[]).join('، ') || r.why || '',
    action:'اتركه للمراقبة فقط حتى تزول القيود',
    reason:'القيود تخفض صلاحية السهم كفرصة تنفيذية'
  }));

  const avg = n(hist.avgSessions);
  const full = n(hist.full50Symbols);
  const total = n(hist.totalSymbols);
  if(total && full < Math.max(1, total * 0.2)){
    add({
      level:'warning', priority:'مهم', category:'history', type:'history_incomplete', symbol:null,
      title:'تاريخ 50 جلسة غير مكتمل',
      trigger:`مكتمل ${full}/${total} — متوسط ${avg.toFixed(1)}/50 جلسة`,
      action:'شغّل history_maintenance=true فقط عند الحاجة وليس في كل تحديث يومي',
      reason:'التحليل التاريخي الطويل لا يجب أن يرفع الثقة قبل اكتمال السجل'
    });
  }

  const coverage = n(sourceFetch.coveragePct);
  if(sourceFetch.ok && coverage >= 80 && coverage < 95){
    add({
      level:'info', priority:'معلومة', category:'source', type:'partial_but_accepted_fetch', symbol:null,
      title:'الجلب الخارجي مقبول جزئيًا',
      trigger:`تغطية ${coverage.toFixed(1)}% من الكون`,
      action:'لا تعمل Reset؛ شغّل Workflow مرة لاحقًا إذا احتجت تحديثًا إضافيًا',
      reason:'التغطية كافية للتشغيل اليومي لكنها ليست كاملة 100%'
    });
  }

  const linked = newsIntel.bySymbol && typeof newsIntel.bySymbol === 'object' ? Object.keys(newsIntel.bySymbol).length : 0;
  if((newsIntel.items||[]).length && linked < 15){
    add({
      level:'info', priority:'معلومة', category:'news', type:'news_linking_low', symbol:null,
      title:'الأخبار موجودة لكن ربطها بالأسهم محدود',
      trigger:`أخبار مصنفة: ${(newsIntel.items||[]).length} | رموز مرتبطة: ${linked}`,
      action:'تحسين قاموس ربط الأخبار بالرموز والقطاعات في مرحلة لاحقة',
      reason:'وجود أخبار كثيرة لا يعني تأثيرًا مباشرًا على كل سهم'
    });
  }

  const clean = uniqBy(rules, x => x.id);
  const order = {critical:5, warning:4, opportunity:3, watch:2, info:1};
  clean.sort((a,b)=>(order[b.level]||0)-(order[a.level]||0));
  const summary = {
    critical: clean.filter(x=>x.level==='critical').length,
    warning: clean.filter(x=>x.level==='warning').length,
    opportunity: clean.filter(x=>x.level==='opportunity').length,
    watch: clean.filter(x=>x.level==='watch').length,
    info: clean.filter(x=>x.level==='info').length
  };
  write('data/smart-alert-rules.json', {
    ok:true,
    engine:'v8_9_1_smart_alert_rules_calibrated',
    generatedAt:now,
    total:clean.length,
    summary,
    rules:clean,
    note:'Calibrated alerts: one stale-price summary instead of dozens of noisy per-symbol urgent alerts.'
  });
  console.log('Smart alert rules', summary);
}
main();
