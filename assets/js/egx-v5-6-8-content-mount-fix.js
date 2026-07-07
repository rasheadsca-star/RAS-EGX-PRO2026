/* EGX Pro Hub V5.6.8 Content Mount Fix
   - Final rescue shell: one unified UI, working sidebar, visible content.
   - Reads existing data/*.json only. No workflow/cache reset.
*/
(function () {
  'use strict';

  const VERSION = 'V5.6.8';
  const DATA_FILES = {
    market: 'data/market.json',
    cache: 'data/full-market-cache.json',
    recs: 'data/recommendations.json',
    pro: 'data/pro-report.json',
    tech: 'data/technical-50-report.json',
    history50: 'data/history-50.json',
    sectors: 'data/sector-report.json',
    investor: 'data/investor-flow-report.json',
    news: 'data/smart-news-report.json',
    newsAlerts: 'data/alerts-v56-news.json',
    alerts: 'data/alerts.json',
    reports: 'data/session-report.json',
    health: 'data/source-health.json',
    audit: 'data/symbol-audit.json',
    universe: 'data/universe-index.json'
  };

  const state = {
    active: 'opportunities',
    theme: localStorage.getItem('egx-theme') || 'light',
    data: {},
    rows: [],
    query: '',
    pageSize: 50,
    chartSymbol: null
  };

  const NAV = [
    ['dashboard', '🏠', 'لوحة السوق'],
    ['ranking', '🏆', 'ترتيب السوق'],
    ['opportunities', '🎯', 'قائمة الفرص'],
    ['portfolio', '💼', 'إدارة المحفظة'],
    ['market', '📋', 'كل السوق'],
    ['sectors', '🏭', 'القطاعات'],
    ['investors', '👥', 'نوع المتعاملين'],
    ['chart', '📈', 'Chart Lab'],
    ['news', '📰', 'الأخبار'],
    ['alerts', '🚨', 'التنبيهات'],
    ['reports', '📑', 'التقارير'],
    ['health', '✅', 'صحة البيانات']
  ];

  function enDigits(value) {
    if (value === null || value === undefined) return '-';
    return String(value)
      .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    const s = enDigits(String(v)).replace(/[%،,\s]/g, '').replace(/[^0-9.\-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function fmt(v, digits = 2) {
    const n = num(v);
    if (n === null) return '-';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
  }

  function fmtPct(v) {
    const n = num(v);
    if (n === null) return '-';
    return `${n > 0 ? '+' : ''}${fmt(n, 2)}%`;
  }

  function safeText(v) {
    return enDigits(v ?? '-').toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function asArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (Array.isArray(x.items)) return x.items;
    if (Array.isArray(x.rows)) return x.rows;
    if (Array.isArray(x.data)) return x.data;
    if (Array.isArray(x.market)) return x.market;
    if (Array.isArray(x.recommendations)) return x.recommendations;
    if (Array.isArray(x.symbols)) return x.symbols;
    if (typeof x === 'object') {
      const arrays = Object.values(x).filter(Array.isArray);
      return arrays.length ? arrays.flat() : [];
    }
    return [];
  }

  function pick(obj, keys, fallback = null) {
    if (!obj || typeof obj !== 'object') return fallback;
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return fallback;
  }

  function symbolOf(o) {
    return String(pick(o, ['symbol', 'ticker', 'code', 'Symbol', 'Ticker', 'رمز', 'الرمز'], '')).trim().toUpperCase();
  }

  function normSymbol(s) { return String(s || '').trim().toUpperCase(); }

  async function loadJSON(url) {
    try {
      const r = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function loadData() {
    const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([k, url]) => [k, await loadJSON(url)]));
    state.data = Object.fromEntries(entries);
    state.rows = buildRows();
    if (!state.chartSymbol && state.rows.length) state.chartSymbol = state.rows[0].symbol;
  }

  function indexBySymbol(arr) {
    const m = new Map();
    asArray(arr).forEach(x => {
      const s = symbolOf(x);
      if (s && !m.has(s)) m.set(s, x);
    });
    return m;
  }

  function findTechFor(symbol) {
    const t = state.data.tech;
    const arr = asArray(t);
    let item = arr.find(x => normSymbol(pick(x, ['symbol', 'ticker', 'code'])) === symbol);
    if (item) return item;
    if (t && typeof t === 'object') {
      const bySym = t[symbol] || t[symbol.toLowerCase()];
      if (bySym && typeof bySym === 'object') return bySym;
    }
    return {};
  }

  function newsImpactFor(symbol, name) {
    const newsRows = [...asArray(state.data.news), ...asArray(state.data.newsAlerts)];
    const s = symbol.toLowerCase();
    const n = String(name || '').toLowerCase();
    let score = 50;
    let count = 0;
    for (const item of newsRows.slice(0, 200)) {
      const txt = JSON.stringify(item || {}).toLowerCase();
      if ((s && txt.includes(s)) || (n && n.length > 4 && txt.includes(n))) {
        count++;
        if (/استحواذ|توزيع|توزيعات|نتائج|ارباح|أرباح|خزينة|زيادة رأس|خفض رأس|عقد|توسعات|approval|dividend|earnings|treasury|acquisition/i.test(txt)) score += 12;
        if (/خسائر|غرامة|ايقاف|إيقاف|تحقيق|تحذير|loss|suspend|fine/i.test(txt)) score -= 14;
      }
    }
    return Math.max(0, Math.min(100, score + Math.min(count * 3, 15)));
  }

  function recommendationLabel(row, score, change) {
    const explicit = pick(row, ['recommendation', 'signal', 'action', 'statusText', 'status', 'توصية', 'التوصية'], '');
    const e = String(explicit || '').trim();
    if (e && !/inside|cache|داخل الكاش|active/i.test(e)) return e;
    if (score >= 82 && change >= 0) return 'مراقبة لشراء';
    if (score >= 70) return 'مراقبة';
    if (score >= 55) return 'انتظار تأكيد';
    if (score >= 42) return 'تخفيف';
    return 'خروج / تجنب';
  }

  function reasonFor(r) {
    const existing = pick(r.rawRec, ['reason', 'why', 'explanation', 'recommendationReason', 'سبب', 'سبب التوصية'], '');
    if (existing) return existing;
    const parts = [];
    if (r.confidence >= 75) parts.push('ثقة مرتفعة');
    if (r.technicalScore >= 70) parts.push('إشارة فنية جيدة');
    if (r.liquidityScore >= 65) parts.push('سيولة نشطة');
    if (r.newsScore >= 65) parts.push('أخبار/محفزات داعمة');
    if (r.dataQuality >= 80) parts.push('جودة بيانات جيدة');
    if (!parts.length) parts.push('يحتاج تأكيد قبل المتابعة');
    return parts.join(' + ');
  }

  function scoreLiquidity(v) {
    const n = num(v) || 0;
    if (n >= 100000000) return 95;
    if (n >= 50000000) return 85;
    if (n >= 10000000) return 70;
    if (n >= 3000000) return 55;
    if (n > 0) return 40;
    return 25;
  }

  function buildRows() {
    const marketArr = asArray(state.data.market);
    const cacheArr = asArray(state.data.cache);
    const recArr = asArray(state.data.recs);
    const proArr = asArray(state.data.pro);
    const universeArr = asArray(state.data.universe);
    const base = new Map();
    for (const src of [universeArr, cacheArr, marketArr, recArr, proArr]) {
      for (const item of asArray(src)) {
        const s = symbolOf(item);
        if (!s) continue;
        base.set(s, { ...(base.get(s) || {}), ...item });
      }
    }
    const recMap = indexBySymbol(recArr);
    const proMap = indexBySymbol(proArr);
    const marketMap = indexBySymbol([...marketArr, ...cacheArr]);

    return Array.from(base.entries()).map(([symbol, raw]) => {
      const rawRec = recMap.get(symbol) || {};
      const rawPro = proMap.get(symbol) || {};
      const rawMarket = marketMap.get(symbol) || {};
      const tech = findTechFor(symbol);
      const merged = { ...raw, ...rawMarket, ...rawPro, ...rawRec };
      const name = pick(merged, ['name', 'name_ar', 'nameAr', 'company', 'companyName', 'arabicName', 'الاسم'], symbol);
      const price = num(pick(merged, ['lastPrice', 'last', 'price', 'close', 'currentPrice', 'last_price', 'السعر', 'آخر سعر']));
      const change = num(pick(merged, ['changePercent', 'changePct', 'pctChange', 'change', 'change_percentage', 'التغير'], 0)) || 0;
      const volume = num(pick(merged, ['volume', 'tradeVolume', 'حجم', 'الحجم'], 0)) || 0;
      const liquidity = num(pick(merged, ['liquidity', 'turnover', 'value', 'tradeValue', 'tradedValue', 'السيولة'], 0)) || 0;
      const support = num(pick(merged, ['support', 'support1', 'nearestSupport', 'دعم', 'الدعم'], pick(tech, ['support', 'support1', 'nearestSupport'], null))) || (price ? price * 0.94 : null);
      const resistance = num(pick(merged, ['resistance', 'resistance1', 'nearestResistance', 'مقاومة', 'المقاومة'], pick(tech, ['resistance', 'resistance1', 'nearestResistance'], null))) || (price ? price * 1.07 : null);
      const entry = num(pick(merged, ['entry', 'entryPrice', 'buyZone', 'entryPoint', 'سعر الدخول'], null)) || (support ? support * 1.01 : price ? price * 0.99 : null);
      const target1 = num(pick(merged, ['target', 'target1', 'tp1', 'هدف', 'الهدف'], null)) || resistance || (price ? price * 1.06 : null);
      const target2 = num(pick(merged, ['target2', 'tp2'], null)) || (target1 ? target1 * 1.05 : null);
      const stopLoss = num(pick(merged, ['stopLoss', 'stop', 'sl', 'وقف الخسارة'], null)) || (support ? support * 0.97 : price ? price * 0.94 : null);
      const confidence = Math.max(0, Math.min(100, num(pick(merged, ['confidence', 'confidenceScore', 'score', 'ثقة', 'الثقة'], null)) || 50));
      const dataQuality = Math.max(0, Math.min(100, num(pick(merged, ['dataQuality', 'quality', 'data_quality'], pick(state.data.health || {}, ['avgDataQuality'], 75))) || 75));
      const technicalScore = Math.max(0, Math.min(100, num(pick(merged, ['technicalScore', 'technical', 'techScore'], pick(tech, ['score', 'technicalScore'], null))) || (change > 0 ? 65 + Math.min(change * 2, 20) : 45)));
      const financialScore = Math.max(0, Math.min(100, num(pick(merged, ['financialScore', 'financial', 'fundamentalScore'], null)) || 55));
      const newsScore = newsImpactFor(symbol, name);
      const liquidityScore = scoreLiquidity(liquidity);
      const priorityScore = Math.round(
        confidence * 0.30 + dataQuality * 0.18 + technicalScore * 0.22 + financialScore * 0.10 + newsScore * 0.12 + liquidityScore * 0.08
      );
      const result = {
        symbol, name, price, change, volume, liquidity, support, resistance, entry,
        targets: [target1, target2].filter(x => x !== null), stopLoss,
        confidence, dataQuality, technicalScore, financialScore, newsScore, liquidityScore, priorityScore,
        recommendation: recommendationLabel(merged, priorityScore, change), rawRec, raw: merged
      };
      result.reason = reasonFor(result);
      return result;
    }).sort((a, b) => b.priorityScore - a.priorityScore || b.confidence - a.confidence || b.liquidity - a.liquidity);
  }

  function injectCSS() {
    if (document.getElementById('egx568-style')) return;
    const style = document.createElement('style');
    style.id = 'egx568-style';
    style.textContent = `
      :root{--egx-bg:#eef4f8;--egx-card:#ffffff;--egx-text:#0f172a;--egx-muted:#64748b;--egx-line:#dbe5ee;--egx-blue:#2563eb;--egx-green:#009b72;--egx-red:#dc2626;--egx-amber:#d97706;--egx-side:#071426;--egx-side-text:#f8fafc;--egx-shadow:0 16px 42px rgba(15,23,42,.12)}
      body.egx-dark{--egx-bg:#07111f;--egx-card:#0b1a2b;--egx-text:#e5edf6;--egx-muted:#9fb0c6;--egx-line:#22364e;--egx-side:#06101e;--egx-side-text:#f8fafc;--egx-shadow:0 16px 44px rgba(0,0,0,.35)}
      html,body{margin:0!important;min-height:100%!important;background:var(--egx-bg)!important;color:var(--egx-text)!important;font-family:"Segoe UI",Tahoma,Arial,sans-serif!important;direction:rtl!important;overflow:auto!important}
      #egx568-root{display:grid;grid-template-columns:245px 1fr;min-height:100vh;background:var(--egx-bg)}
      .egx568-side{background:var(--egx-side);color:var(--egx-side-text);padding:18px 12px;position:sticky;top:0;height:100vh;box-sizing:border-box;overflow:auto;box-shadow:-10px 0 30px rgba(0,0,0,.18);z-index:5}
      .egx568-logo{display:flex;gap:10px;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:14px;margin-bottom:14px}.egx568-logo h1{font-size:22px;line-height:1.1;margin:0}.egx568-logo small{color:#b6c8dc}.egx568-badge{background:linear-gradient(135deg,#10b981,#fde047);color:#062113;border-radius:18px;padding:12px 9px;font-weight:900}
      .egx568-nav{display:flex;flex-direction:column;gap:7px}.egx568-nav button{border:0;background:transparent;color:var(--egx-side-text);text-align:right;border-radius:13px;padding:11px 12px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:8px}.egx568-nav button:hover,.egx568-nav button.active{background:#fff;color:#061426}.egx568-theme{margin-top:14px;width:100%;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:white;border-radius:12px;padding:10px;cursor:pointer;font-weight:800}
      .egx568-main{padding:18px 18px 28px;min-width:0}.egx568-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.egx568-title h2{font-size:24px;margin:0 0 4px}.egx568-title p{margin:0;color:var(--egx-muted);font-size:13px}.egx568-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.egx568-pill{background:var(--egx-card);border:1px solid var(--egx-line);border-radius:999px;padding:9px 12px;font-weight:800;box-shadow:var(--egx-shadow);font-size:13px}.egx568-search{min-width:260px;border:1px solid var(--egx-line);background:var(--egx-card);color:var(--egx-text);border-radius:12px;padding:11px 13px;outline:none}.egx568-select{border:1px solid var(--egx-line);background:var(--egx-card);color:var(--egx-text);border-radius:12px;padding:10px}
      .egx568-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:12px 0}.egx568-card{background:var(--egx-card);border:1px solid var(--egx-line);border-radius:18px;padding:14px;box-shadow:var(--egx-shadow)}.egx568-card .k{color:var(--egx-muted);font-weight:800;font-size:12px}.egx568-card .v{font-size:24px;font-weight:900;margin-top:6px}.pos{color:var(--egx-green)!important}.neg{color:var(--egx-red)!important}.warn{color:var(--egx-amber)!important}
      .egx568-section{background:var(--egx-card);border:1px solid var(--egx-line);border-radius:18px;box-shadow:var(--egx-shadow);overflow:hidden}.egx568-section-head{padding:14px 16px;border-bottom:1px solid var(--egx-line);display:flex;justify-content:space-between;gap:12px;align-items:center}.egx568-section-head h3{margin:0;font-size:18px}.egx568-note{font-size:12px;color:var(--egx-muted);font-weight:700}.egx568-table-wrap{overflow:auto;max-height:calc(100vh - 260px)}table.egx568-table{width:100%;border-collapse:separate;border-spacing:0;min-width:1320px;font-size:13px}table.egx568-table th{position:sticky;top:0;background:var(--egx-card);z-index:2;color:var(--egx-muted);font-size:12px;text-align:right;padding:12px;border-bottom:1px solid var(--egx-line);white-space:nowrap}table.egx568-table td{padding:11px 12px;border-bottom:1px solid var(--egx-line);white-space:nowrap;vertical-align:top}.sym{font-weight:900;color:var(--egx-blue);direction:ltr;text-align:left}.score{display:inline-flex;min-width:42px;justify-content:center;border-radius:999px;padding:5px 8px;background:#eaf3ff;color:#0b55c8;font-weight:900}.egx-dark .score{background:#0d2b54;color:#93c5fd}.rec{font-weight:900;border-radius:999px;padding:5px 9px;display:inline-block;background:#e9fbf5;color:#087a5c}.risk{background:#fff2f2;color:#b91c1c}.reason{max-width:360px;white-space:normal;line-height:1.55;color:var(--egx-text)}.targets{direction:ltr;text-align:right}.egx568-empty{padding:46px;text-align:center;color:var(--egx-muted);font-weight:800}
      .egx568-grid2{display:grid;grid-template-columns:1.2fr .8fr;gap:12px}.egx568-list{display:grid;gap:8px}.egx568-item{padding:12px;border:1px solid var(--egx-line);border-radius:14px;background:rgba(148,163,184,.08)}.egx568-chart{width:100%;height:320px;background:linear-gradient(180deg,rgba(37,99,235,.08),transparent);border-radius:16px;border:1px solid var(--egx-line)}
      @media(max-width:980px){#egx568-root{grid-template-columns:1fr}.egx568-side{position:relative;height:auto}.egx568-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.egx568-grid2{grid-template-columns:1fr}.egx568-top{align-items:flex-start;flex-direction:column}.egx568-search{min-width:0;width:100%}}
    `;
    document.head.appendChild(style);
  }

  function metricCards() {
    const health = state.data.health || {};
    const audit = state.data.audit || {};
    const total = pick(health, ['totalUniverse'], state.rows.length) || state.rows.length;
    const cached = pick(health, ['cacheRows', 'rowsRead'], 0);
    const coverage = pick(health, ['universeCoveragePct'], total ? Math.round((cached / total) * 100) : 0);
    const opp = state.rows.filter(r => r.priorityScore >= 65).length;
    return `
      <div class="egx568-cards">
        <div class="egx568-card"><div class="k">كل أسهم السوق</div><div class="v">${fmt(total, 0)}</div></div>
        <div class="egx568-card"><div class="k">داخل الكاش</div><div class="v pos">${fmt(cached, 0)}</div></div>
        <div class="egx568-card"><div class="k">تغطية السوق</div><div class="v">${fmt(coverage, 0)}%</div></div>
        <div class="egx568-card"><div class="k">فرص أولوية</div><div class="v warn">${fmt(opp, 0)}</div></div>
      </div>`;
  }

  function filteredRows() {
    const q = state.query.trim().toLowerCase();
    let rows = state.rows;
    if (q) rows = rows.filter(r => `${r.symbol} ${r.name} ${r.recommendation} ${r.reason}`.toLowerCase().includes(q));
    return rows;
  }

  function tableRows(rows) {
    return rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="sym">${safeText(r.symbol)}</td>
        <td>${safeText(r.name)}</td>
        <td><span class="rec ${/خروج|تخفيف/.test(r.recommendation) ? 'risk' : ''}">${safeText(r.recommendation)}</span></td>
        <td><span class="score">${fmt(r.priorityScore, 0)}</span></td>
        <td>${fmt(r.confidence, 0)}%</td>
        <td>${fmt(r.dataQuality, 0)}%</td>
        <td>${fmt(r.technicalScore, 0)}%</td>
        <td>${fmt(r.financialScore, 0)}%</td>
        <td>${fmt(r.newsScore, 0)}%</td>
        <td>${fmt(r.price, 2)}</td>
        <td class="${r.change >= 0 ? 'pos' : 'neg'}">${fmtPct(r.change)}</td>
        <td>${fmt(r.liquidity, 0)}</td>
        <td>${fmt(r.volume, 0)}</td>
        <td>${fmt(r.support, 2)}</td>
        <td>${fmt(r.resistance, 2)}</td>
        <td>${fmt(r.entry, 2)}</td>
        <td class="targets">${r.targets.map(x => fmt(x, 2)).join(' / ') || '-'}</td>
        <td class="neg">${fmt(r.stopLoss, 2)}</td>
        <td class="reason">${safeText(r.reason)}</td>
      </tr>`).join('');
  }

  function opportunitiesSection(title = 'قائمة الفرص') {
    const rows = filteredRows().slice(0, Number(state.pageSize));
    return `
      ${metricCards()}
      <section class="egx568-section">
        <div class="egx568-section-head">
          <div><h3>${title}</h3><div class="egx568-note">مرتبة تنازليًا حسب الثقة + جودة البيانات + الفني + المالي + الأخبار + السيولة. تحليل ومراقبة فقط.</div></div>
          <div class="egx568-tools">
            <input class="egx568-search" id="egx568-search" value="${safeText(state.query)}" placeholder="بحث بالرمز أو الاسم أو سبب التوصية...">
            <select class="egx568-select" id="egx568-page-size">
              ${[25,50,100,250,500].map(n => `<option value="${n}" ${Number(state.pageSize)===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="egx568-table-wrap">
          <table class="egx568-table">
            <thead><tr>
              <th>#</th><th>الرمز</th><th>الاسم</th><th>التوصية</th><th>الأولوية</th><th>الثقة</th><th>جودة البيانات</th><th>فني</th><th>مالي</th><th>أخبار</th><th>آخر سعر</th><th>التغير</th><th>السيولة</th><th>التداول</th><th>الدعم</th><th>المقاومة</th><th>سعر الدخول</th><th>الأهداف</th><th>وقف الخسارة</th><th>سبب التوصية</th>
            </tr></thead>
            <tbody>${rows.length ? tableRows(rows) : `<tr><td colspan="20" class="egx568-empty">لا توجد بيانات كافية للعرض الآن</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderDashboard() {
    const top = state.rows.slice(0, 8);
    return `${metricCards()}<div class="egx568-grid2"><section class="egx568-section"><div class="egx568-section-head"><h3>أفضل فرص المراقبة</h3><span class="egx568-note">أعلى 8 حسب الأولوية</span></div><div class="egx568-table-wrap"><table class="egx568-table" style="min-width:900px"><thead><tr><th>الرمز</th><th>الاسم</th><th>التوصية</th><th>الأولوية</th><th>الدخول</th><th>الأهداف</th><th>وقف الخسارة</th></tr></thead><tbody>${top.map(r => `<tr><td class="sym">${r.symbol}</td><td>${safeText(r.name)}</td><td><span class="rec">${safeText(r.recommendation)}</span></td><td><span class="score">${fmt(r.priorityScore,0)}</span></td><td>${fmt(r.entry,2)}</td><td>${r.targets.map(x=>fmt(x,2)).join(' / ')}</td><td class="neg">${fmt(r.stopLoss,2)}</td></tr>`).join('')}</tbody></table></div></section><section class="egx568-section"><div class="egx568-section-head"><h3>ملاحظات سريعة</h3></div><div class="egx568-list" style="padding:14px"><div class="egx568-item">استخدم قائمة الفرص للترتيب الفني الكامل.</div><div class="egx568-item">Chart Lab يعتمد على history-50 عند توفره.</div><div class="egx568-item">البيانات عامة ومتأخرة وليست أوامر تداول.</div></div></section></div>`;
  }

  function renderMarket() { return opportunitiesSection('كل السوق'); }
  function renderRanking() { return opportunitiesSection('ترتيب السوق'); }
  function renderPortfolio() {
    return `<section class="egx568-section"><div class="egx568-section-head"><h3>إدارة المحفظة</h3><span class="egx568-note">مساحة تحليل المحفظة وربطها بالفرص</span></div><div class="egx568-empty">سيتم عرض مراكز المحفظة هنا عند توفر ملف/إدخال المحفظة. يمكن استخدام ترتيب الأولويات لتحديد المتابعة، التخفيف، أو الانتظار.</div></section>`;
  }

  function simpleList(title, data, empty = 'لا توجد بيانات كافية') {
    const arr = asArray(data);
    if (!arr.length && data && typeof data === 'object') {
      return `<section class="egx568-section"><div class="egx568-section-head"><h3>${title}</h3></div><pre style="direction:ltr;text-align:left;white-space:pre-wrap;margin:0;padding:18px;overflow:auto">${safeText(JSON.stringify(data, null, 2))}</pre></section>`;
    }
    return `<section class="egx568-section"><div class="egx568-section-head"><h3>${title}</h3></div><div class="egx568-list" style="padding:14px">${arr.length ? arr.slice(0,80).map(x => `<div class="egx568-item">${safeText(pick(x,['title','headline','name','symbol','message','text'], JSON.stringify(x)))}</div>`).join('') : `<div class="egx568-empty">${empty}</div>`}</div></section>`;
  }

  function renderSectors() { return simpleList('القطاعات والسيولة', state.data.sectors); }
  function renderInvestors() { return simpleList('نوع المتعاملين', state.data.investor, 'بيانات نوع المتعاملين لم تكتمل بعد أو تحتاج مصدر يومي'); }
  function renderNews() { return simpleList('الأخبار المؤثرة', state.data.news, 'لا توجد أخبار مؤثرة مجمعة بعد'); }
  function renderAlerts() { return simpleList('التنبيهات', [...asArray(state.data.alerts), ...asArray(state.data.newsAlerts)], 'لا توجد تنبيهات عاجلة الآن'); }
  function renderReports() { return simpleList('التقارير', state.data.reports); }
  function renderHealth() { return simpleList('صحة البيانات والكاش', { sourceHealth: state.data.health, symbolAudit: state.data.audit, universeIndex: state.data.universe }); }

  function historyPoints(symbol) {
    const h = state.data.history50;
    if (!h) return [];
    if (Array.isArray(h)) {
      return h.filter(x => normSymbol(pick(x, ['symbol','ticker','code'])) === symbol).map(x => num(pick(x, ['close','price','lastPrice','value']))).filter(x => x !== null);
    }
    const v = h[symbol] || h[symbol.toLowerCase()];
    const arr = asArray(v);
    return arr.map(x => typeof x === 'number' ? x : num(pick(x, ['close','price','lastPrice','value']))).filter(x => x !== null);
  }

  function renderChart() {
    const options = state.rows.slice(0, 250).map(r => `<option value="${r.symbol}" ${state.chartSymbol===r.symbol?'selected':''}>${r.symbol} - ${safeText(r.name)}</option>`).join('');
    const pts = historyPoints(state.chartSymbol || '');
    let chart = `<div class="egx568-empty">لا يوجد تاريخ كافٍ لهذا السهم حتى الآن. شغّل Workflow يوميًا أو استخدم مصدر تاريخي موثوق.</div>`;
    if (pts.length >= 2) {
      const w = 860, h = 300, pad = 24;
      const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
      const coords = pts.map((p, i) => {
        const x = pad + i * ((w - pad*2) / Math.max(pts.length - 1, 1));
        const y = h - pad - ((p - min) / span) * (h - pad*2);
        return `${x},${y}`;
      }).join(' ');
      chart = `<svg class="egx568-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${coords}" fill="none" stroke="var(--egx-blue)" stroke-width="4"/><polyline points="${coords} ${w-pad},${h-pad} ${pad},${h-pad}" fill="rgba(37,99,235,.12)" stroke="none"/><text x="${pad}" y="22" fill="var(--egx-muted)" font-size="13">${safeText(state.chartSymbol)} · ${pts.length} جلسة</text></svg>`;
    }
    return `<section class="egx568-section"><div class="egx568-section-head"><h3>Chart Lab</h3><select class="egx568-select" id="egx568-chart-symbol">${options}</select></div><div style="padding:14px">${chart}</div></section>`;
  }

  function activeTitle() {
    return (NAV.find(x => x[0] === state.active) || NAV[0])[2];
  }

  function renderContent() {
    switch (state.active) {
      case 'dashboard': return renderDashboard();
      case 'ranking': return renderRanking();
      case 'opportunities': return opportunitiesSection('قائمة الفرص');
      case 'portfolio': return renderPortfolio();
      case 'market': return renderMarket();
      case 'sectors': return renderSectors();
      case 'investors': return renderInvestors();
      case 'chart': return renderChart();
      case 'news': return renderNews();
      case 'alerts': return renderAlerts();
      case 'reports': return renderReports();
      case 'health': return renderHealth();
      default: return renderDashboard();
    }
  }

  function shell() {
    document.body.classList.toggle('egx-dark', state.theme === 'dark');
    return `
      <div id="egx568-root">
        <aside class="egx568-side">
          <div class="egx568-logo"><div><h1>EGX Pro Hub</h1><small>Unified Workspace · ${VERSION}</small></div><div class="egx568-badge">EGX</div></div>
          <nav class="egx568-nav">${NAV.map(([id, icon, label]) => `<button type="button" data-egx-tab="${id}" class="${state.active===id?'active':''}"><span>${icon}</span><span>${label}</span></button>`).join('')}</nav>
          <button class="egx568-theme" id="egx568-theme">${state.theme === 'dark' ? '☀️ الوضع النهاري' : '🌙 الوضع الليلي'}</button>
          <div class="egx568-note" style="margin-top:12px;color:#b6c8dc">بيانات عامة/متأخرة · تحليل ومراقبة فقط</div>
        </aside>
        <main class="egx568-main">
          <div class="egx568-top">
            <div class="egx568-title"><h2>${activeTitle()}</h2><p>واجهة موحدة بدون تكرار، مع أرقام إنجليزية وترتيب أولويات واضح.</p></div>
            <div class="egx568-tools"><span class="egx568-pill">${fmt(state.rows.length,0)} سهم</span><span class="egx568-pill pos">${fmt(state.rows.filter(r=>r.price).length,0)} بسعر</span><span class="egx568-pill">${new Date().toLocaleString('en-US')}</span></div>
          </div>
          <div id="egx568-content">${renderContent()}</div>
        </main>
      </div>`;
  }

  function bind() {
    document.querySelectorAll('[data-egx-tab]').forEach(btn => btn.addEventListener('click', () => {
      state.active = btn.getAttribute('data-egx-tab');
      render();
    }));
    const theme = document.getElementById('egx568-theme');
    if (theme) theme.addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('egx-theme', state.theme);
      render();
    });
    const search = document.getElementById('egx568-search');
    if (search) search.addEventListener('input', (e) => {
      state.query = e.target.value;
      const content = document.getElementById('egx568-content');
      if (content) content.innerHTML = renderContent();
      bind();
      const s = document.getElementById('egx568-search');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    });
    const size = document.getElementById('egx568-page-size');
    if (size) size.addEventListener('change', (e) => { state.pageSize = Number(e.target.value); render(); });
    const chart = document.getElementById('egx568-chart-symbol');
    if (chart) chart.addEventListener('change', (e) => { state.chartSymbol = e.target.value; render(); });
  }

  function render() {
    injectCSS();
    document.body.innerHTML = shell();
    bind();
  }

  async function init() {
    injectCSS();
    document.body.classList.toggle('egx-dark', state.theme === 'dark');
    document.body.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;font-family:Segoe UI,Tahoma,Arial;background:var(--egx-bg);color:var(--egx-text);direction:rtl"><div style="background:var(--egx-card);border:1px solid var(--egx-line);border-radius:20px;padding:28px;box-shadow:var(--egx-shadow);font-weight:900">جاري تحميل EGX Pro Hub ${VERSION}...</div></div>`;
    await loadData();
    render();
    window.egx568ForceRender = render;
  }

  // Run last and keep screen alive if older scripts clear content later.
  setTimeout(init, 80);
  setInterval(() => {
    if (!document.getElementById('egx568-root')) render();
  }, 2500);
})();
