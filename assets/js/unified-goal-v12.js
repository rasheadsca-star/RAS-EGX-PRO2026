(() => {
  'use strict';
  const DATA_URL = 'data/unified-goal-v12.json';
  const VERSION = '12.0.0';
  const state = { data: null, tab: 'dashboard', query: '', status: 'ALL', loading: false };

  const arStatus = {
    LIVE_READY: 'تنفيذ مشروط', PAPER_CANDIDATE: 'تداول ورقي', VALIDATED_WAIT: 'مكتمل وينتظر إثبات الأداء', EXCLUDED: 'مستبعد'
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function num(value, digits = 2) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('ar-EG', { maximumFractionDigits: digits }) : '—';
  }
  function pct(value) { return Number.isFinite(Number(value)) ? `${num(value, 1)}%` : '—'; }
  function money(value) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 }) : '—'; }
  function dateTime(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }); } catch { return value; }
  }
  function badge(status) { return `<span class="ug12-badge ug12-${esc(status)}">${esc(arStatus[status] || status)}</span>`; }
  function gateIcon(pass) { return pass ? '<span class="ug12-pass">✓</span>' : '<span class="ug12-fail">✕</span>'; }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    renderLoading();
    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
      render();
    } catch (error) {
      renderError(error);
    } finally { state.loading = false; }
  }

  function createShell() {
    if (document.getElementById('ug12-launcher')) return;
    const launcher = document.createElement('button');
    launcher.id = 'ug12-launcher';
    launcher.type = 'button';
    launcher.innerHTML = '<span>◉</span><b>مركز القرار V12</b>';
    launcher.addEventListener('click', open);

    const overlay = document.createElement('div');
    overlay.id = 'ug12-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="ug12-shell" dir="rtl">
        <header class="ug12-header">
          <div><div class="ug12-title">EGX Pro — مركز القرار الموحد</div><div class="ug12-subtitle">PRO2026 + واجهة GOAL + تحقق صارم + تداول ورقي وقياس نتائج</div></div>
          <div class="ug12-actions"><span class="ug12-version">V${VERSION}</span><button id="ug12-reload" type="button">تحديث</button><button id="ug12-close" type="button" aria-label="إغلاق">×</button></div>
        </header>
        <nav class="ug12-tabs" id="ug12-tabs"></nav>
        <main id="ug12-content" class="ug12-content"></main>
      </div>`;
    document.body.append(launcher, overlay);
    document.getElementById('ug12-close').addEventListener('click', close);
    document.getElementById('ug12-reload').addEventListener('click', load);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }

  function open() {
    const overlay = document.getElementById('ug12-overlay');
    overlay.classList.add('ug12-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('ug12-lock');
    if (!state.data) load(); else render();
  }
  function close() {
    const overlay = document.getElementById('ug12-overlay');
    overlay.classList.remove('ug12-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('ug12-lock');
  }

  const tabs = [
    ['dashboard', 'لوحة القرار'], ['today', 'قرار اليوم'], ['opportunities', 'الفرص'],
    ['excluded', 'المستبعدة ولماذا'], ['paper', 'التداول الورقي'],
    ['accuracy', 'قياس الدقة'], ['quality', 'جودة البيانات']
  ];

  function renderTabs() {
    const el = document.getElementById('ug12-tabs');
    el.innerHTML = tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('');
    el.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { state.tab = button.dataset.tab; render(); }));
  }

  function renderLoading() {
    const content = document.getElementById('ug12-content');
    if (content) content.innerHTML = '<div class="ug12-state"><div class="ug12-spinner"></div><h3>جارٍ بناء مركز القرار...</h3></div>';
  }
  function renderError(error) {
    const content = document.getElementById('ug12-content');
    content.innerHTML = `<div class="ug12-state ug12-error"><h3>تعذر تحميل ملف V12</h3><p>${esc(error.message)}</p><p>شغّل Workflow: <b>Unified GOAL V12</b> مرة واحدة بعد رفع الحزمة.</p><button type="button" id="ug12-retry">إعادة المحاولة</button></div>`;
    document.getElementById('ug12-retry')?.addEventListener('click', load);
  }

  function kpi(label, value, note = '') {
    return `<article class="ug12-kpi"><span>${esc(label)}</span><strong>${value}</strong>${note ? `<small>${esc(note)}</small>` : ''}</article>`;
  }

  function decisionHero(data) {
    const d = data.decision || {};
    return `<section class="ug12-decision ug12-tone-${esc(d.tone || 'warning')}">
      <div><span class="ug12-eyebrow">القرار الموحد للجلسة ${esc(data.sessionId || '')}</span><h1>${esc(d.label || 'غير متاح')}</h1><p>${esc(d.reason || '')}</p></div>
      <div class="ug12-decision-counts"><b>${d.liveReadyCount || 0}</b><span>تنفيذي</span><b>${d.paperCandidateCount || 0}</b><span>ورقي</span></div>
    </section>`;
  }

  function card(row) {
    const failed = (row.failedReasons || []).slice(0, 2);
    return `<article class="ug12-stock-card">
      <div class="ug12-stock-head"><div><b>${esc(row.symbol)}</b><small>${esc(row.name || '')}</small></div>${badge(row.finalStatus)}</div>
      <div class="ug12-stock-price"><strong>${num(row.price, 3)}</strong><span class="${Number(row.changePct) >= 0 ? 'up' : 'down'}">${pct(row.changePct)}</span></div>
      <div class="ug12-mini-grid"><span>الدخول <b>${num(row.plan?.entryLow, 3)}–${num(row.plan?.entryHigh, 3)}</b></span><span>الهدف <b>${num(row.plan?.target1, 3)}</b></span><span>الإيقاف <b>${num(row.plan?.stopLoss, 3)}</b></span><span>R/R <b>${num(row.plan?.riskReward)}</b></span></div>
      <div class="ug12-score"><span style="width:${Math.max(0, Math.min(100, Number(row.score || 0)))}%"></span></div>
      <div class="ug12-card-foot"><span>درجة ${num(row.score, 1)}</span><span>تاريخ ${row.historySessions || 0} جلسة</span></div>
      ${failed.length ? `<div class="ug12-card-warning">${failed.map(esc).join('<br>')}</div>` : ''}
    </article>`;
  }

  function dashboard(data) {
    const top = (data.opportunities || []).filter(r => r.finalStatus !== 'EXCLUDED').slice(0, 3);
    return `${decisionHero(data)}
      <section class="ug12-kpis">
        ${kpi('تقدم الاعتماد', pct(data.goLive?.progressPct), data.goLive?.ready ? 'بوابة الأداء ناجحة' : 'لم يثبت الأداء بعد')}
        ${kpi('تغطية السعر', pct(data.coverage?.pricePct))}
        ${kpi('تاريخ 50 جلسة', pct(data.coverage?.history50Pct))}
        ${kpi('الدعم والمقاومة', pct(data.coverage?.levelsPct))}
        ${kpi('صفقات مغلقة', num(data.measurement?.closedTrades, 0))}
        ${kpi('Profit Factor', num(data.measurement?.profitFactor))}
      </section>
      <section class="ug12-section"><div class="ug12-section-title"><div><h2>أعلى المرشحين</h2><p>لا تتحول إلى شراء حقيقي قبل نجاح جميع بوابات الاعتماد.</p></div><span>${top.length} / 3</span></div>
      <div class="ug12-card-grid">${top.length ? top.map(card).join('') : '<div class="ug12-empty">لا توجد فرص اجتازت الحد الأدنى.</div>'}</div></section>
      <section class="ug12-section"><div class="ug12-section-title"><div><h2>لماذا التطبيق غير تنفيذي؟</h2><p>حالة بوابات إثبات الأداء على مستوى النظام بالكامل.</p></div></div>${gateList(data.goLive?.gates || [])}</section>`;
  }

  function gateList(gates) {
    return `<div class="ug12-gates">${gates.map(g => `<div class="ug12-gate ${g.pass ? 'ok' : 'bad'}">${gateIcon(g.pass)}<div><b>${esc(g.label)}</b><small>${esc(g.detail)}</small></div></div>`).join('')}</div>`;
  }

  function today(data) {
    const d = data.decision || {};
    const candidates = (data.opportunities || []).filter(r => ['LIVE_READY', 'PAPER_CANDIDATE', 'VALIDATED_WAIT'].includes(r.finalStatus)).slice(0, 5);
    return `${decisionHero(data)}<section class="ug12-section"><div class="ug12-section-title"><div><h2>خطة التعامل اليوم</h2><p>قرار واحد واضح بدل عرض إشارات متعارضة.</p></div></div>
      <div class="ug12-today-steps">
        <div><b>1</b><span>التنفيذ الحقيقي</span><strong>${d.liveReadyCount ? 'مسموح بشروط الدخول' : 'مغلق تلقائيًا'}</strong></div>
        <div><b>2</b><span>التداول الورقي</span><strong>${d.paperCandidateCount || 0} مرشح</strong></div>
        <div><b>3</b><span>حد أقصى للعرض</span><strong>أفضل 3 فرص فقط</strong></div>
        <div><b>4</b><span>إلغاء الفرصة</span><strong>عند فشل أي بوابة أو كسر الإيقاف</strong></div>
      </div></section>
      <section class="ug12-section"><div class="ug12-card-grid">${candidates.map(card).join('') || '<div class="ug12-empty">لا توجد مرشحات.</div>'}</div></section>`;
  }

  function toolbar() {
    return `<div class="ug12-toolbar"><input id="ug12-search" type="search" placeholder="ابحث بالرمز أو الشركة" value="${esc(state.query)}"><select id="ug12-status"><option value="ALL">كل الحالات</option>${Object.entries(arStatus).map(([v, l]) => `<option value="${v}" ${state.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  }
  function bindToolbar() {
    document.getElementById('ug12-search')?.addEventListener('input', event => { state.query = event.target.value; render(); });
    document.getElementById('ug12-status')?.addEventListener('change', event => { state.status = event.target.value; render(); });
  }
  function filteredRows(data, includeExcluded = true) {
    const q = state.query.trim().toUpperCase();
    return (data.opportunities || []).filter(r => includeExcluded || r.finalStatus !== 'EXCLUDED')
      .filter(r => state.status === 'ALL' || r.finalStatus === state.status)
      .filter(r => !q || String(r.symbol).includes(q) || String(r.name || '').toUpperCase().includes(q));
  }

  function opportunities(data) {
    const rows = filteredRows(data, false);
    return `${toolbar()}<section class="ug12-section ug12-table-section"><div class="ug12-section-title"><div><h2>الفرص التي لم تُستبعد</h2><p>التنفيذي، التداول الورقي، والأسهم المكتملة التي تنتظر إثبات الأداء.</p></div><span>${rows.length}</span></div>${stockTable(rows)}</section>`;
  }

  function stockTable(rows) {
    return `<div class="ug12-table-wrap"><table><thead><tr><th>السهم</th><th>الحالة</th><th>السعر</th><th>الدخول</th><th>الهدف</th><th>الإيقاف</th><th>R/R</th><th>السيولة</th><th>التاريخ</th><th>الجودة</th><th>الدرجة</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.symbol)}</b><small>${esc(r.name || '')}</small></td><td>${badge(r.finalStatus)}</td><td>${num(r.price, 3)}</td><td>${num(r.plan?.entryLow, 3)}–${num(r.plan?.entryHigh, 3)}</td><td>${num(r.plan?.target1, 3)}</td><td>${num(r.plan?.stopLoss, 3)}</td><td>${num(r.plan?.riskReward)}</td><td>${money(r.turnover)}</td><td>${r.historySessions || 0}</td><td>${pct(r.dataQuality)}</td><td><b>${num(r.score, 1)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  function excluded(data) {
    const rows = filteredRows(data, true).filter(r => r.finalStatus === 'EXCLUDED');
    return `${toolbar()}<section class="ug12-section"><div class="ug12-section-title"><div><h2>المستبعدة ولماذا</h2><p>كل استبعاد مرتبط ببوابة محددة، وليس بانطباع عام.</p></div><span>${rows.length}</span></div>
      <div class="ug12-excluded-list">${rows.map(r => `<details><summary><span><b>${esc(r.symbol)}</b> ${esc(r.name || '')}</span><span>درجة ${num(r.score, 1)}</span></summary>${gateList(r.gates || [])}</details>`).join('') || '<div class="ug12-empty">لا توجد أسهم مستبعدة ضمن الفلتر.</div>'}</div></section>`;
  }

  function paper(data) {
    const p = data.paperTrading || {};
    const trades = [...(p.open || []), ...(p.pending || []), ...(p.recentClosed || [])];
    return `<section class="ug12-kpis">
      ${kpi('مفتوحة', num(p.metrics?.openTrades, 0))}${kpi('بانتظار الدخول', num(p.metrics?.pendingTrades, 0))}${kpi('مغلقة', num(p.metrics?.closedTrades, 0))}${kpi('نسبة النجاح', pct(p.metrics?.winRatePct))}${kpi('متوسط العائد', pct(p.metrics?.averageNetReturnPct))}${kpi('أقصى تراجع', pct(p.metrics?.maxDrawdownPct))}
    </section><section class="ug12-section"><div class="ug12-note"><b>منهج القياس:</b> ${esc(p.assumptions?.execution || '')} التكلفة المفترضة ذهابًا وعودة: ${pct(p.assumptions?.roundTripCostPct)}.</div>
    <div class="ug12-table-wrap"><table><thead><tr><th>السهم</th><th>الحالة</th><th>جلسة الإنشاء</th><th>الدخول</th><th>آخر/خروج</th><th>الهدف</th><th>الإيقاف</th><th>العائد الصافي</th><th>R</th><th>سبب الإغلاق</th></tr></thead><tbody>${trades.map(t => `<tr><td><b>${esc(t.symbol)}</b></td><td>${esc(t.status)}</td><td>${esc(t.createdSession || '')}</td><td>${num(t.entryPrice || t.entryLow, 3)}</td><td>${num(t.exitPrice || t.lastPrice, 3)}</td><td>${num(t.target1, 3)}</td><td>${num(t.stopLoss, 3)}</td><td class="${Number(t.netReturnPct) >= 0 ? 'up' : 'down'}">${pct(t.netReturnPct)}</td><td>${num(t.rMultiple)}</td><td>${esc(t.exitReason || '—')}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function accuracy(data) {
    const m = data.measurement || {};
    return `<section class="ug12-kpis">${kpi('العينة المغلقة', num(m.closedTrades, 0), `المطلوب ${data.configuration?.goLiveMinimumClosedTrades || 30}`)}${kpi('الرابحة', num(m.wins, 0))}${kpi('الخاسرة', num(m.losses, 0))}${kpi('Win Rate', pct(m.winRatePct))}${kpi('Profit Factor', num(m.profitFactor))}${kpi('متوسط R', num(m.averageR))}</section>
      <section class="ug12-section"><div class="ug12-section-title"><div><h2>بوابة الانتقال من الورقي إلى الحقيقي</h2><p>${esc(m.measurementNote || '')}</p></div><strong>${pct(data.goLive?.progressPct)}</strong></div>${gateList(data.goLive?.gates || [])}</section>
      <section class="ug12-section"><div class="ug12-warning-box"><b>قاعدة إلزامية:</b> نسبة الثقة المعروضة هي قوة بيانات وإشارة، وليست احتمال ربح مثبتًا، إلى أن تنجح عينة القياس كاملة.</div></section>`;
  }

  function quality(data) {
    const c = data.coverage || {};
    return `<section class="ug12-kpis">${kpi('الأسهم المقروءة', num(c.totalRows, 0))}${kpi('السعر', pct(c.pricePct))}${kpi('تاريخ 20 جلسة', pct(c.history20Pct))}${kpi('تاريخ 50 جلسة', pct(c.history50Pct))}${kpi('المستويات', pct(c.levelsPct))}${kpi('السيولة', pct(c.liquidityPct))}</section>
      <section class="ug12-section"><div class="ug12-section-title"><div><h2>مصدر البناء</h2><p>الواجهة لا تعيد اختراع التحليل؛ تقرأ ناتج PRO2026 وتطبّق طبقة قرار مغلقة عند الفشل.</p></div></div>
      <div class="ug12-info-grid"><div><span>ملف الترتيب</span><b>${esc(data.source?.rankingFile || 'غير موجود')}</b></div><div><span>آخر تحديث للمصدر</span><b>${esc(dateTime(data.source?.sourceUpdatedAt))}</b></div><div><span>رموز فريدة</span><b>${num(data.source?.uniqueSymbols, 0)}</b></div><div><span>رموز بتاريخ مكتشف</span><b>${num(data.source?.historySymbolsDetected, 0)}</b></div><div><span>توليد V12</span><b>${esc(dateTime(data.generatedAt))}</b></div><div><span>الوضع</span><b>${esc(data.mode || '')}</b></div></div></section>
      <section class="ug12-section"><div class="ug12-section-title"><div><h2>البوابات الإلزامية لكل سهم</h2><p>السعر، الحداثة، المصادر، 50 جلسة، المستويات، السيولة، الخطة، R/R، الجودة، الإشارة، والشذوذ.</p></div></div></section>`;
  }

  function render() {
    if (!state.data) return;
    renderTabs();
    const content = document.getElementById('ug12-content');
    const views = { dashboard, today, opportunities, excluded, paper, accuracy, quality };
    content.innerHTML = (views[state.tab] || dashboard)(state.data);
    bindToolbar();
  }

  function init() {
    createShell();
    const params = new URLSearchParams(location.search);
    if (params.get('goal') === 'v12' || location.hash === '#goal-v12') open();
  }

  window.EGXUnifiedGoalV12 = { open, close, reload: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
