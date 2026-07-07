/* EGX Pro Hub V5.2 Command Center — safe UI add-on */
(function () {
  'use strict';

  const VERSION = '5.2.1-universe-repair';
  const DATA_FILES = {
    health: 'data/source-health.json',
    audit: 'data/symbol-audit.json',
    pro: 'data/pro-report.json',
    alerts: 'data/alerts.json',
    session: 'data/session-report.json',
    risk: 'data/risk-dashboard.json',
    news: 'data/news-report.json',
    recommendations: 'data/recommendations.json'
  };

  const state = { data: {}, loadedAt: null };

  function byId(id) { return document.getElementById(id); }
  function safeNum(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmt(v, digits = 2) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: digits });
  }
  function arDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ar-EG');
  }
  async function loadJson(url) {
    const cacheBust = `v=${Date.now()}`;
    const sep = url.includes('?') ? '&' : '?';
    try {
      const res = await fetch(`${url}${sep}${cacheBust}`, { cache: 'no-store' });
      if (!res.ok) return { ok: false, missing: true, status: res.status, file: url };
      const json = await res.json();
      return json && typeof json === 'object' ? json : { ok: false, invalid: true, file: url };
    } catch (error) {
      return { ok: false, error: error.message, file: url };
    }
  }
  async function loadAll() {
    const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, url]) => [key, await loadJson(url)]));
    state.data = Object.fromEntries(entries);
    state.loadedAt = new Date().toISOString();
    render();
  }

  function injectStyles() {
    if (byId('egx-v52-command-center-style')) return;
    const style = document.createElement('style');
    style.id = 'egx-v52-command-center-style';
    style.textContent = `
      :root { --egx-v52-bg:#07111f; --egx-v52-panel:#0c1b2e; --egx-v52-soft:#122942; --egx-v52-card:#102239; --egx-v52-text:#eef6ff; --egx-v52-muted:#9bb0c9; --egx-v52-border:rgba(143,183,232,.22); --egx-v52-good:#21d07a; --egx-v52-warn:#ffcc66; --egx-v52-bad:#ff6b6b; --egx-v52-info:#67b7ff; }
      #egx-v52-command-center { direction: rtl; color: var(--egx-v52-text); background: linear-gradient(135deg, rgba(7,17,31,.98), rgba(13,34,58,.96)); border:1px solid var(--egx-v52-border); border-radius:24px; box-shadow:0 22px 70px rgba(0,0,0,.34); padding:18px; margin:22px auto; max-width:1280px; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; position:relative; overflow:hidden; }
      #egx-v52-command-center * { box-sizing:border-box; }
      #egx-v52-command-center:before { content:''; position:absolute; inset:-120px auto auto -100px; width:260px; height:260px; background:radial-gradient(circle, rgba(103,183,255,.28), transparent 65%); pointer-events:none; }
      .egx-v52-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap; position:relative; z-index:1; }
      .egx-v52-title { margin:0; font-size:clamp(22px,3vw,34px); line-height:1.2; font-weight:900; letter-spacing:-.02em; }
      .egx-v52-sub { color:var(--egx-v52-muted); margin:8px 0 0; line-height:1.7; }
      .egx-v52-actions { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .egx-v52-btn { border:1px solid var(--egx-v52-border); color:var(--egx-v52-text); background:rgba(255,255,255,.07); padding:10px 14px; border-radius:14px; cursor:pointer; font-weight:800; }
      .egx-v52-btn:hover { background:rgba(255,255,255,.12); }
      .egx-v52-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-top:16px; position:relative; z-index:1; }
      .egx-v52-card { background:rgba(16,34,57,.78); border:1px solid var(--egx-v52-border); border-radius:18px; padding:14px; min-height:112px; }
      .egx-v52-label { color:var(--egx-v52-muted); font-size:13px; margin-bottom:7px; }
      .egx-v52-value { font-size:28px; font-weight:950; line-height:1.1; }
      .egx-v52-note { color:var(--egx-v52-muted); font-size:12px; margin-top:8px; line-height:1.5; }
      .egx-v52-good { color:var(--egx-v52-good); } .egx-v52-warn { color:var(--egx-v52-warn); } .egx-v52-bad { color:var(--egx-v52-bad); } .egx-v52-info { color:var(--egx-v52-info); }
      .egx-v52-sections { display:grid; grid-template-columns:1.35fr .85fr; gap:14px; margin-top:14px; position:relative; z-index:1; }
      .egx-v52-panel { background:rgba(12,27,46,.78); border:1px solid var(--egx-v52-border); border-radius:20px; padding:14px; min-width:0; }
      .egx-v52-panel h3 { margin:0 0 12px; font-size:18px; }
      .egx-v52-table-wrap { overflow:auto; border-radius:14px; border:1px solid rgba(143,183,232,.12); }
      .egx-v52-table { width:100%; border-collapse:collapse; min-width:680px; }
      .egx-v52-table th, .egx-v52-table td { padding:10px; border-bottom:1px solid rgba(143,183,232,.12); text-align:right; vertical-align:top; }
      .egx-v52-table th { color:var(--egx-v52-muted); font-size:12px; background:rgba(255,255,255,.04); position:sticky; top:0; }
      .egx-v52-pill { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:999px; background:rgba(255,255,255,.07); border:1px solid rgba(143,183,232,.14); font-size:12px; font-weight:800; white-space:nowrap; }
      .egx-v52-list { display:flex; flex-direction:column; gap:9px; }
      .egx-v52-alert { padding:11px; border-radius:14px; border:1px solid rgba(143,183,232,.16); background:rgba(255,255,255,.055); line-height:1.55; }
      .egx-v52-alert strong { display:block; margin-bottom:4px; }
      .egx-v52-muted { color:var(--egx-v52-muted); }
      .egx-v52-missing { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; max-height:126px; overflow:auto; }
      .egx-v52-footer { margin-top:14px; color:var(--egx-v52-muted); font-size:12px; line-height:1.7; position:relative; z-index:1; }
      @media (max-width: 980px) { .egx-v52-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .egx-v52-sections { grid-template-columns:1fr; } }
      @media (max-width: 560px) { #egx-v52-command-center { margin:14px 8px; border-radius:18px; padding:14px; } .egx-v52-grid { grid-template-columns:1fr; } .egx-v52-actions { width:100%; } .egx-v52-btn { flex:1; } }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = byId('egx-v52-command-center');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'egx-v52-command-center';
    root.setAttribute('data-egx-version', VERSION);

    const anchors = [
      byId('app'),
      document.querySelector('main'),
      document.querySelector('.container'),
      document.body.firstElementChild
    ].filter(Boolean);

    if (anchors[0] && anchors[0] !== document.body) {
      anchors[0].parentNode.insertBefore(root, anchors[0].nextSibling);
    } else {
      document.body.appendChild(root);
    }
    return root;
  }

  function dataRows() {
    const pro = state.data.pro || {};
    const rec = state.data.recommendations || {};
    return Array.isArray(pro.topOpportunities) && pro.topOpportunities.length
      ? pro.topOpportunities
      : Array.isArray(rec.topBuyCandidates) && rec.topBuyCandidates.length
        ? rec.topBuyCandidates
        : Array.isArray(rec.all) ? rec.all.slice(0, 25) : [];
  }

  function card(label, value, note, tone) {
    return `<div class="egx-v52-card"><div class="egx-v52-label">${esc(label)}</div><div class="egx-v52-value ${tone || ''}">${value}</div><div class="egx-v52-note">${esc(note || '')}</div></div>`;
  }

  function renderTopTable(rows) {
    if (!rows.length) return '<div class="egx-v52-muted">لا توجد فرص كافية للعرض بعد. شغّل Workflow بعد رفع ملفات V5.2.</div>';
    return `<div class="egx-v52-table-wrap"><table class="egx-v52-table"><thead><tr><th>السهم</th><th>التصنيف</th><th>السعر</th><th>الثقة</th><th>السيولة</th><th>دخول</th><th>هدف 1</th><th>وقف</th><th>سبب</th></tr></thead><tbody>${rows.slice(0, 18).map(r => `
      <tr>
        <td><strong>${esc(r.symbol)}</strong><br><span class="egx-v52-muted">${esc(r.name || r.name_ar || r.name_en || '')}</span></td>
        <td><span class="egx-v52-pill">${esc(r.classification || r.decision || r.recommendation || r.signal || 'مراقبة')}</span></td>
        <td>${fmt(r.price)}</td>
        <td>${fmt(r.confidence ?? r.finalConfidence ?? r.opportunityScore, 0)}</td>
        <td>${fmt(r.liquidityScore, 0)}</td>
        <td>${fmt(r.entryFrom)} → ${fmt(r.entryTo)}</td>
        <td>${fmt(r.target1)}</td>
        <td>${fmt(r.stopLoss)}</td>
        <td>${esc(r.reason || r.setup || '')}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function renderAlerts(alerts) {
    const list = Array.isArray(alerts.alerts) ? alerts.alerts : [];
    if (!list.length) return '<div class="egx-v52-muted">لا توجد تنبيهات V5.2 حتى الآن.</div>';
    return `<div class="egx-v52-list">${list.slice(0, 10).map(a => {
      const tone = a.level === 'danger' ? 'egx-v52-bad' : a.level === 'warning' ? 'egx-v52-warn' : 'egx-v52-info';
      return `<div class="egx-v52-alert"><strong class="${tone}">${esc(a.title_ar || a.type || 'تنبيه')}</strong><span>${esc(a.message_ar || '')}</span>${Array.isArray(a.symbols) && a.symbols.length ? `<div class="egx-v52-missing">${a.symbols.slice(0, 24).map(s => `<span class="egx-v52-pill">${esc(s)}</span>`).join('')}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  function render() {
    injectStyles();
    const root = ensureRoot();
    const h = state.data.health || {};
    const audit = state.data.audit || {};
    const pro = state.data.pro || {};
    const alerts = state.data.alerts || {};
    const risk = state.data.risk || {};
    const rows = dataRows();
    const missing = Array.isArray(audit.missingFromCache) ? audit.missingFromCache : [];
    const etrs = audit.etrs || {};
    const coverage = safeNum(h.universeCoveragePct || audit?.summary?.universeCoveragePct, 0);
    const cacheRows = safeNum(h.cacheRows || audit?.summary?.cachedRows, rows.length);
    const totalUniverse = safeNum(h.totalUniverse || audit?.summary?.totalConfiguredOrDiscovered, 0);
    const failedCount = Array.isArray(h.failedSymbols) ? h.failedSymbols.length : 0;
    const topSymbol = rows[0]?.symbol || '—';

    const coverageTone = coverage >= 80 ? 'egx-v52-good' : coverage >= 40 ? 'egx-v52-warn' : 'egx-v52-bad';
    const etrsTone = etrs.cached ? 'egx-v52-good' : etrs.configured ? 'egx-v52-warn' : 'egx-v52-bad';

    root.innerHTML = `
      <div class="egx-v52-head">
        <div>
          <h2 class="egx-v52-title">🧠 EGX Pro Hub V5.2 Command Center</h2>
          <p class="egx-v52-sub">مركز قيادة الذكاء والسوق — يعمل فوق V4.2 بدون Reset للكاش. الإصدار: ${esc(VERSION)}</p>
        </div>
        <div class="egx-v52-actions">
          <button class="egx-v52-btn" id="egx-v52-refresh">تحديث اللوحة</button>
          <button class="egx-v52-btn" id="egx-v52-open-actions">فتح Workflow</button>
        </div>
      </div>
      <div class="egx-v52-grid">
        ${card('تغطية الكون', `${fmt(coverage, 0)}%`, `Cached ${cacheRows} / Universe ${totalUniverse}`, coverageTone)}
        ${card('حالة ETRS', etrs.cached ? 'داخل الكاش' : etrs.configured ? 'ينتظر Batch' : 'غير موجود', etrs.status || 'symbol audit required', etrsTone)}
        ${card('أفضل فرصة مراقبة', esc(topSymbol), rows[0]?.decision || rows[0]?.classification || 'حسب V5.2 Intelligence', 'egx-v52-info')}
        ${card('فشل آخر تشغيل', fmt(failedCount, 0), failedCount ? 'راجع source-health.failedSymbols' : 'لا توجد رموز فاشلة ظاهرة', failedCount ? 'egx-v52-warn' : 'egx-v52-good')}
      </div>
      <div class="egx-v52-sections">
        <div class="egx-v52-panel">
          <h3>🚀 فرص المراقبة المؤسسية</h3>
          ${renderTopTable(rows)}
        </div>
        <div class="egx-v52-panel">
          <h3>⚠️ التنبيهات وحالة الكون</h3>
          ${renderAlerts(alerts)}
          <h3 style="margin-top:16px">🧩 Missing From Cache</h3>
          ${missing.length ? `<div class="egx-v52-missing">${missing.slice(0, 80).map(s => `<span class="egx-v52-pill">${esc(s)}</span>`).join('')}</div>` : '<div class="egx-v52-muted">لا توجد قائمة missing متاحة أو التغطية مكتملة.</div>'}
        </div>
      </div>
      <div class="egx-v52-footer">
        آخر تحديث بيانات: ${esc(arDate(h.generatedAt || pro.generatedAt || state.loadedAt))} — مصدر البيانات: صفحات Mubasher العامة المتأخرة. الترشيحات تحليل ومراقبة وليست أوامر تداول. لا ترفع scan-state/full-market-cache يدويًا إلا عند Reset صريح.
      </div>
    `;

    const refresh = byId('egx-v52-refresh');
    if (refresh) refresh.addEventListener('click', loadAll);
    const workflow = byId('egx-v52-open-actions');
    if (workflow) workflow.addEventListener('click', () => {
      window.open('https://github.com/rasheadsca-star/RAS-EGX0.1/actions/workflows/update-market-data.yml', '_blank', 'noopener');
    });
  }

  function boot() {
    injectStyles();
    ensureRoot().innerHTML = '<div class="egx-v52-head"><div><h2 class="egx-v52-title">🧠 EGX Pro Hub V5.2 Command Center</h2><p class="egx-v52-sub">جار تحميل ملفات الذكاء والسوق...</p></div></div>';
    loadAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
