/* EGX Pro Hub V5.3 Smart Market UI — organized full-universe interface, no cache reset */
(function () {
  'use strict';

  const VERSION = '5.3.0-smart-market-ui';
  const DATA_FILES = {
    health: 'data/source-health.json',
    audit: 'data/symbol-audit.json',
    cache: 'data/full-market-cache.json',
    market: 'data/market.json',
    recommendations: 'data/recommendations.json',
    pro: 'data/pro-report.json',
    alerts: 'data/alerts.json',
    session: 'data/session-report.json',
    risk: 'data/risk-dashboard.json',
    configCsv: 'config/egx-symbols.csv'
  };

  const state = {
    data: {},
    universe: [],
    filtered: [],
    tab: localStorage.getItem('egx.v53.tab') || 'overview',
    query: '',
    filter: 'all',
    sort: 'symbol',
    page: 1,
    pageSize: Number(localStorage.getItem('egx.v53.pageSize') || 50),
    loadedAt: null
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function num(value, fallback = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }

  function fmt(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: digits });
  }

  function dateText(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ar-EG');
  }

  function symbolOf(row) {
    return String(row?.symbol || row?.ticker || row?.code || row?.mubasherSymbol || row?.Symbol || row?.SYMBOL || '')
      .trim()
      .toUpperCase();
  }

  function firstDefined(row, keys) {
    for (const key of keys) {
      if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
    }
    return undefined;
  }

  async function loadJson(url) {
    try {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return { __missing: true, __status: res.status, __file: url };
      return await res.json();
    } catch (error) {
      return { __error: error.message, __file: url };
    }
  }

  async function loadText(url) {
    try {
      const sep = url.includes('?') ? '&' : '?';
      const res = await fetch(`${url}${sep}v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return '';
      return await res.text();
    } catch (_) {
      return '';
    }
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && quoted && next === '"') { cur += '"'; i += 1; continue; }
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === ',' && !quoted) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function parseSymbolsCsv(text) {
    const rows = [];
    if (!text || !text.trim()) return rows;

    const normalized = text.replace(/\r/g, '\n').replace(/\n\n+/g, '\n');
    const lines = normalized.split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) return rows;

    const header = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const hasHeader = header.some(h => ['symbol', 'ticker', 'code'].includes(h));
    const start = hasHeader ? 1 : 0;
    const idx = (names, fallback) => {
      for (const name of names) {
        const i = header.indexOf(name);
        if (i >= 0) return i;
      }
      return fallback;
    };

    const iSymbol = idx(['symbol', 'ticker', 'code'], 0);
    const iNameEn = idx(['name_en', 'name', 'company_en', 'company'], 1);
    const iNameAr = idx(['name_ar', 'arabic_name', 'company_ar'], 2);
    const iSector = idx(['sector', 'sector_en', 'industry'], 3);
    const iActive = idx(['active', 'enabled'], -1);

    for (let i = start; i < lines.length; i += 1) {
      const cells = parseCsvLine(lines[i]);
      let symbol = String(cells[iSymbol] || '').trim().toUpperCase();
      symbol = symbol.replace(/[^A-Z0-9._-]/g, '');
      if (!symbol || symbol.length < 2 || symbol.length > 12) continue;
      if (symbol === 'SYMBOL' || symbol === 'TICKER' || symbol === 'CODE') continue;
      const activeRaw = iActive >= 0 ? String(cells[iActive] || '').trim().toLowerCase() : 'true';
      const active = !['false', '0', 'no', 'inactive', 'delisted'].includes(activeRaw);
      rows.push({
        symbol,
        name: cells[iNameEn] || cells[iNameAr] || '',
        name_en: cells[iNameEn] || '',
        name_ar: cells[iNameAr] || '',
        sector: cells[iSector] || '',
        configured: true,
        active
      });
    }

    // Fallback for malformed/compressed CSV: discover ticker-like tokens near commas/newlines.
    if (rows.length < 150) {
      const discovered = new Set(rows.map(r => r.symbol));
      const regex = /(?:^|[\n,;\s])([A-Z]{2,6}[A-Z0-9]{0,4})(?=\s*[,;\n])/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const symbol = m[1].trim().toUpperCase();
        if (symbol && !discovered.has(symbol) && !['TRUE', 'FALSE', 'NAME', 'SECTOR', 'SYMBOL'].includes(symbol)) {
          rows.push({ symbol, name: '', name_en: '', name_ar: '', sector: '', configured: true, active: true });
          discovered.add(symbol);
        }
      }
    }

    return rows;
  }

  function likelyStockArray(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    const candidates = [
      json.rows,
      json.data,
      json.market,
      json.stocks,
      json.symbols,
      json.items,
      json.cache,
      json.recommendations,
      json.all,
      json.topBuyCandidates,
      json.topOpportunities,
      json.opportunities
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.some(x => symbolOf(x))) return c;
    }
    if (typeof json === 'object') {
      const values = Object.values(json);
      if (values.length && values.every(v => v && typeof v === 'object') && values.some(v => symbolOf(v))) return values;
    }
    return [];
  }

  function mergeRow(map, row, source) {
    if (!row || typeof row !== 'object') return;
    const symbol = symbolOf(row);
    if (!symbol) return;
    const old = map.get(symbol) || { symbol };
    const merged = Object.assign({}, old, row, { symbol });
    merged.sources = Array.from(new Set([...(old.sources || []), source]));
    map.set(symbol, merged);
  }

  function buildUniverse() {
    const map = new Map();
    const configured = parseSymbolsCsv(state.data.configCsvText || '');
    configured.forEach(row => mergeRow(map, row, 'config'));

    const cacheRows = likelyStockArray(state.data.cache);
    cacheRows.forEach(row => mergeRow(map, Object.assign({}, row, { cached: true }), 'cache'));

    const marketRows = likelyStockArray(state.data.market);
    marketRows.forEach(row => mergeRow(map, Object.assign({}, row, { marketVisible: true }), 'market'));

    const recRows = likelyStockArray(state.data.recommendations);
    recRows.forEach(row => mergeRow(map, Object.assign({}, row, { recommended: true }), 'recommendations'));

    const proRows = likelyStockArray(state.data.pro);
    proRows.forEach(row => mergeRow(map, Object.assign({}, row, { proVisible: true }), 'pro'));

    const missing = Array.isArray(state.data.audit?.missingFromCache) ? state.data.audit.missingFromCache : [];
    missing.forEach(symbol => mergeRow(map, { symbol, configured: true, cached: false, missingFromCache: true }, 'audit'));

    const failed = new Set(Array.isArray(state.data.health?.failedSymbols) ? state.data.health.failedSymbols.map(s => String(s).toUpperCase()) : []);
    const rows = Array.from(map.values()).map(row => {
      const price = firstDefined(row, ['price', 'lastPrice', 'last', 'close', 'lastTradePrice', 'currentPrice']);
      const changePct = firstDefined(row, ['changePct', 'changePercent', 'pctChange', 'percentChange', 'change_percent']);
      const volume = firstDefined(row, ['volume', 'tradeVolume', 'tradedVolume', 'vol']);
      const confidence = firstDefined(row, ['confidence', 'finalConfidence', 'opportunityScore', 'score']);
      const decision = firstDefined(row, ['classification', 'decision', 'recommendation', 'signal', 'status']);
      return Object.assign({}, row, {
        symbol: symbolOf(row),
        name: row.name || row.name_en || row.name_ar || row.companyName || row.company || '',
        sector: row.sector || row.industry || '',
        price: price !== undefined ? num(price, NaN) : NaN,
        changePct: changePct !== undefined ? num(changePct, NaN) : NaN,
        volume: volume !== undefined ? num(volume, NaN) : NaN,
        confidence: confidence !== undefined ? num(confidence, NaN) : NaN,
        decision: decision || 'مراقبة',
        cached: Boolean(row.cached || row.sources?.includes('cache')),
        configured: Boolean(row.configured || row.sources?.includes('config')),
        failed: failed.has(symbolOf(row))
      });
    });

    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    state.universe = rows;
    applyFilters();
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    let rows = state.universe.slice();
    if (q) {
      rows = rows.filter(r => [r.symbol, r.name, r.name_en, r.name_ar, r.sector, r.decision]
        .map(x => String(x || '').toLowerCase())
        .some(x => x.includes(q)));
    }
    if (state.filter === 'cached') rows = rows.filter(r => r.cached);
    if (state.filter === 'waiting') rows = rows.filter(r => r.configured && !r.cached);
    if (state.filter === 'failed') rows = rows.filter(r => r.failed);
    if (state.filter === 'opportunities') rows = rows.filter(r => r.recommended || r.proVisible || Number.isFinite(r.confidence));

    const sort = state.sort;
    rows.sort((a, b) => {
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol);
      if (sort === 'price') return (Number.isFinite(b.price) ? b.price : -Infinity) - (Number.isFinite(a.price) ? a.price : -Infinity);
      if (sort === 'change') return (Number.isFinite(b.changePct) ? b.changePct : -Infinity) - (Number.isFinite(a.changePct) ? a.changePct : -Infinity);
      if (sort === 'volume') return (Number.isFinite(b.volume) ? b.volume : -Infinity) - (Number.isFinite(a.volume) ? a.volume : -Infinity);
      if (sort === 'confidence') return (Number.isFinite(b.confidence) ? b.confidence : -Infinity) - (Number.isFinite(a.confidence) ? a.confidence : -Infinity);
      return a.symbol.localeCompare(b.symbol);
    });
    state.filtered = rows;
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) state.page = pages;
  }

  function injectStyles() {
    if (byId('egx-v53-style')) return;
    const style = document.createElement('style');
    style.id = 'egx-v53-style';
    style.textContent = `
      :root {
        --v53-bg:#07111f; --v53-panel:#0d1b2f; --v53-card:#10243c; --v53-soft:#132c49;
        --v53-text:#eef7ff; --v53-muted:#9eb4cf; --v53-border:rgba(148,190,240,.18);
        --v53-good:#21d07a; --v53-warn:#ffcc66; --v53-bad:#ff6b6b; --v53-info:#67b7ff;
      }
      #egx-v53-smart-ui { direction:rtl; max-width:1320px; margin:22px auto; padding:18px; color:var(--v53-text); font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif; background:linear-gradient(135deg, rgba(7,17,31,.98), rgba(11,29,50,.96)); border:1px solid var(--v53-border); border-radius:26px; box-shadow:0 24px 80px rgba(0,0,0,.32); position:relative; overflow:hidden; }
      #egx-v53-smart-ui * { box-sizing:border-box; }
      #egx-v53-smart-ui:before { content:''; position:absolute; inset:-160px -140px auto auto; width:340px; height:340px; background:radial-gradient(circle, rgba(103,183,255,.18), transparent 68%); pointer-events:none; }
      .v53-top { position:relative; display:flex; justify-content:space-between; gap:14px; align-items:flex-start; flex-wrap:wrap; }
      .v53-title { margin:0; font-size:clamp(23px,3vw,36px); line-height:1.2; font-weight:950; letter-spacing:-.025em; }
      .v53-sub { margin:8px 0 0; color:var(--v53-muted); line-height:1.75; max-width:850px; }
      .v53-actions { display:flex; gap:9px; flex-wrap:wrap; }
      .v53-btn, .v53-select, .v53-input { border:1px solid var(--v53-border); background:rgba(255,255,255,.07); color:var(--v53-text); border-radius:14px; padding:10px 13px; font-weight:800; outline:none; }
      .v53-btn { cursor:pointer; }
      .v53-btn:hover { background:rgba(255,255,255,.12); }
      .v53-input { min-width:260px; font-weight:700; }
      .v53-select option { color:#0c1728; }
      .v53-kpis { position:relative; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-top:16px; }
      .v53-kpi { background:rgba(16,36,60,.82); border:1px solid var(--v53-border); border-radius:18px; padding:13px; min-height:102px; }
      .v53-label { color:var(--v53-muted); font-size:12px; margin-bottom:8px; }
      .v53-value { font-size:26px; font-weight:950; line-height:1.1; }
      .v53-note { color:var(--v53-muted); font-size:12px; margin-top:8px; line-height:1.55; }
      .v53-tabs { position:relative; display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; padding:8px; background:rgba(255,255,255,.045); border:1px solid var(--v53-border); border-radius:18px; }
      .v53-tab { border:0; color:var(--v53-muted); background:transparent; padding:10px 12px; border-radius:12px; cursor:pointer; font-weight:900; }
      .v53-tab.active { color:var(--v53-text); background:rgba(103,183,255,.16); box-shadow:inset 0 0 0 1px rgba(103,183,255,.22); }
      .v53-content { position:relative; margin-top:14px; }
      .v53-panel { background:rgba(13,27,47,.82); border:1px solid var(--v53-border); border-radius:20px; padding:14px; min-width:0; }
      .v53-panel h3 { margin:0 0 12px; font-size:18px; }
      .v53-grid2 { display:grid; grid-template-columns:1.15fr .85fr; gap:12px; }
      .v53-grid3 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
      .v53-tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
      .v53-table-wrap { overflow:auto; border:1px solid rgba(148,190,240,.14); border-radius:16px; max-height:680px; }
      .v53-table { width:100%; border-collapse:collapse; min-width:920px; }
      .v53-table th, .v53-table td { padding:10px; border-bottom:1px solid rgba(148,190,240,.12); text-align:right; vertical-align:middle; white-space:nowrap; }
      .v53-table th { position:sticky; top:0; z-index:1; background:#10243c; color:var(--v53-muted); font-size:12px; }
      .v53-row-name { white-space:normal; min-width:220px; }
      .v53-pill { display:inline-flex; align-items:center; gap:6px; padding:5px 9px; border-radius:999px; border:1px solid rgba(148,190,240,.16); background:rgba(255,255,255,.06); font-size:12px; font-weight:900; }
      .v53-good { color:var(--v53-good); } .v53-warn { color:var(--v53-warn); } .v53-bad { color:var(--v53-bad); } .v53-info { color:var(--v53-info); } .v53-muted { color:var(--v53-muted); }
      .v53-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .v53-card { padding:12px; border-radius:16px; background:rgba(255,255,255,.055); border:1px solid rgba(148,190,240,.14); line-height:1.65; }
      .v53-card strong { display:block; margin-bottom:4px; }
      .v53-footer { position:relative; color:var(--v53-muted); font-size:12px; line-height:1.7; margin-top:14px; }
      .v53-pager { display:flex; gap:8px; align-items:center; justify-content:space-between; flex-wrap:wrap; margin-top:12px; color:var(--v53-muted); }
      .v53-hide-old #egx-v52-command-center { display:none !important; }
      @media (max-width: 1100px) { .v53-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } .v53-grid2, .v53-grid3 { grid-template-columns:1fr; } }
      @media (max-width: 620px) { #egx-v53-smart-ui { margin:12px 8px; padding:12px; border-radius:20px; } .v53-kpis { grid-template-columns:1fr; } .v53-input { min-width:100%; } .v53-actions,.v53-tools { width:100%; } .v53-btn,.v53-select { flex:1; } }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = byId('egx-v53-smart-ui');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'egx-v53-smart-ui';
    root.setAttribute('data-egx-version', VERSION);

    const old = byId('egx-v52-command-center');
    if (old && old.parentNode) {
      old.parentNode.insertBefore(root, old);
      old.style.display = 'none';
      document.documentElement.classList.add('v53-hide-old');
      return root;
    }

    const anchors = [byId('app'), document.querySelector('main'), document.querySelector('.container'), document.body.firstElementChild].filter(Boolean);
    if (anchors[0] && anchors[0] !== document.body) anchors[0].parentNode.insertBefore(root, anchors[0].nextSibling);
    else document.body.appendChild(root);
    return root;
  }

  function kpi(label, value, note, tone = '') {
    return `<div class="v53-kpi"><div class="v53-label">${esc(label)}</div><div class="v53-value ${tone}">${value}</div><div class="v53-note">${esc(note || '')}</div></div>`;
  }

  function summary() {
    const total = state.universe.length;
    const cached = state.universe.filter(x => x.cached).length;
    const waiting = state.universe.filter(x => x.configured && !x.cached).length;
    const failed = state.universe.filter(x => x.failed).length;
    const coverage = total ? Math.round((cached / total) * 100) : num(state.data.health?.universeCoveragePct, 0);
    const shown = state.filtered.length;
    const etrs = state.universe.find(x => x.symbol === 'ETRS');
    return { total, cached, waiting, failed, coverage, shown, etrs };
  }

  function renderHeader() {
    const s = summary();
    const coverageTone = s.coverage >= 80 ? 'v53-good' : s.coverage >= 40 ? 'v53-warn' : 'v53-bad';
    const etrsText = s.etrs ? (s.etrs.cached ? 'داخل الكاش' : 'ينتظر Batch') : 'غير ظاهر';
    const etrsTone = s.etrs?.cached ? 'v53-good' : s.etrs ? 'v53-warn' : 'v53-bad';
    return `
      <div class="v53-top">
        <div>
          <h2 class="v53-title">🧠 EGX Pro Hub V5.3 Smart Market UI</h2>
          <p class="v53-sub">واجهة منظمة تعرض الكون الكامل للأسهم مع بحث، فلترة، صفحات، وحالة الكاش — بدون لمس V4.2 وبدون Reset لملفات scan-state أو full-market-cache.</p>
        </div>
        <div class="v53-actions">
          <button class="v53-btn" data-action="refresh">تحديث البيانات</button>
          <button class="v53-btn" data-action="workflow">تشغيل Workflow</button>
        </div>
      </div>
      <div class="v53-kpis">
        ${kpi('كل أسهم الكون', fmt(s.total, 0), 'من config + cache + market + audit')}
        ${kpi('داخل الكاش', fmt(s.cached, 0), 'الأسهم المقروءة بالفعل من Batch Cache', 'v53-good')}
        ${kpi('ينتظر Batch', fmt(s.waiting, 0), 'موجود في الكون ولم يدخل الكاش بعد', s.waiting ? 'v53-warn' : 'v53-good')}
        ${kpi('تغطية فعلية', `${fmt(s.coverage, 0)}%`, `المعروض بعد الفلتر: ${s.shown}`, coverageTone)}
        ${kpi('ETRS', etrsText, 'Egytrans / Egyptian Transport', etrsTone)}
      </div>
    `;
  }

  function renderTabs() {
    const tabs = [
      ['overview', 'الرئيسية الذكية'],
      ['universe', 'كل الأسهم'],
      ['opportunities', 'الفرص'],
      ['alerts', 'التنبيهات والمخاطر'],
      ['health', 'صحة البيانات']
    ];
    return `<div class="v53-tabs">${tabs.map(([id, label]) => `<button class="v53-tab ${state.tab === id ? 'active' : ''}" data-tab="${id}">${esc(label)}</button>`).join('')}</div>`;
  }

  function rowToneNumber(n) {
    if (!Number.isFinite(n)) return '';
    if (n > 0) return 'v53-good';
    if (n < 0) return 'v53-bad';
    return 'v53-muted';
  }

  function renderUniverseTable() {
    applyFilters();
    const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    const start = (state.page - 1) * state.pageSize;
    const pageRows = state.filtered.slice(start, start + state.pageSize);
    return `
      <div class="v53-panel">
        <h3>🧩 كل أسهم السوق — ليس أول 100 فقط</h3>
        <div class="v53-tools">
          <input class="v53-input" id="v53-search" placeholder="ابحث بالرمز أو الاسم أو القطاع مثل ETRS" value="${esc(state.query)}" />
          <select class="v53-select" id="v53-filter">
            <option value="all" ${state.filter === 'all' ? 'selected' : ''}>كل الأسهم</option>
            <option value="cached" ${state.filter === 'cached' ? 'selected' : ''}>داخل الكاش فقط</option>
            <option value="waiting" ${state.filter === 'waiting' ? 'selected' : ''}>ينتظر Batch</option>
            <option value="opportunities" ${state.filter === 'opportunities' ? 'selected' : ''}>لها تحليل/فرص</option>
            <option value="failed" ${state.filter === 'failed' ? 'selected' : ''}>فشلت قراءتها</option>
          </select>
          <select class="v53-select" id="v53-sort">
            <option value="symbol" ${state.sort === 'symbol' ? 'selected' : ''}>ترتيب بالرمز</option>
            <option value="confidence" ${state.sort === 'confidence' ? 'selected' : ''}>الأعلى ثقة</option>
            <option value="change" ${state.sort === 'change' ? 'selected' : ''}>الأعلى تغيرًا</option>
            <option value="volume" ${state.sort === 'volume' ? 'selected' : ''}>الأعلى حجمًا</option>
            <option value="price" ${state.sort === 'price' ? 'selected' : ''}>الأعلى سعرًا</option>
          </select>
          <select class="v53-select" id="v53-page-size">
            <option value="25" ${state.pageSize === 25 ? 'selected' : ''}>25 / صفحة</option>
            <option value="50" ${state.pageSize === 50 ? 'selected' : ''}>50 / صفحة</option>
            <option value="100" ${state.pageSize === 100 ? 'selected' : ''}>100 / صفحة</option>
            <option value="250" ${state.pageSize === 250 ? 'selected' : ''}>250 / صفحة</option>
          </select>
        </div>
        <div class="v53-table-wrap">
          <table class="v53-table">
            <thead><tr><th>الرمز</th><th>الاسم</th><th>القطاع</th><th>الحالة</th><th>السعر</th><th>% التغير</th><th>الحجم</th><th>الثقة</th><th>التصنيف</th><th>المصدر</th></tr></thead>
            <tbody>
              ${pageRows.map(r => `
                <tr>
                  <td><strong>${esc(r.symbol)}</strong></td>
                  <td class="v53-row-name">${esc(r.name || r.name_ar || r.name_en || '—')}</td>
                  <td>${esc(r.sector || '—')}</td>
                  <td>${r.cached ? '<span class="v53-pill v53-good">Cached</span>' : r.configured ? '<span class="v53-pill v53-warn">Next Batch</span>' : '<span class="v53-pill">Observed</span>'} ${r.failed ? '<span class="v53-pill v53-bad">Failed</span>' : ''}</td>
                  <td>${fmt(r.price)}</td>
                  <td class="${rowToneNumber(r.changePct)}">${Number.isFinite(r.changePct) ? fmt(r.changePct, 2) + '%' : '—'}</td>
                  <td>${fmt(r.volume, 0)}</td>
                  <td>${Number.isFinite(r.confidence) ? fmt(r.confidence, 0) : '—'}</td>
                  <td><span class="v53-pill">${esc(r.decision || 'مراقبة')}</span></td>
                  <td>${esc((r.sources || []).join(' + ') || '—')}</td>
                </tr>
              `).join('') || '<tr><td colspan="10" class="v53-muted">لا توجد نتائج مطابقة للبحث/الفلتر.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="v53-pager">
          <div>يعرض ${fmt(start + 1, 0)} - ${fmt(Math.min(start + pageRows.length, state.filtered.length), 0)} من ${fmt(state.filtered.length, 0)} سهم</div>
          <div class="v53-actions">
            <button class="v53-btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>السابق</button>
            <span class="v53-pill">صفحة ${fmt(state.page, 0)} / ${fmt(totalPages, 0)}</span>
            <button class="v53-btn" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>التالي</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderOverview() {
    const s = summary();
    const top = state.universe.filter(r => r.recommended || r.proVisible || Number.isFinite(r.confidence)).sort((a, b) => (b.confidence || 0) - (a.confidence || 0)).slice(0, 8);
    const waiting = state.universe.filter(r => r.configured && !r.cached).slice(0, 24);
    return `
      <div class="v53-grid2">
        <div class="v53-panel">
          <h3>🚦 ملخص تنفيذي</h3>
          <div class="v53-cards">
            <div class="v53-card"><strong>لماذا كنت ترى 100 فقط؟</strong><span class="v53-muted">غالبًا لأن واجهة الجدول كانت محددة بـ 100 عنصر أو تعرض أفضل النتائج فقط. V5.3 يعرض الكون الكامل بصفحات.</span></div>
            <div class="v53-card"><strong>أين بقية الأسهم؟</strong><span class="v53-muted">إما داخل config ولم تدخل Batch Cache بعد، أو داخل الكاش لكن لم تكن معروضة بسبب Limit الواجهة.</span></div>
            <div class="v53-card"><strong>بدون Reset</strong><span class="v53-muted">نحافظ على scan-state/full-market-cache ونضيف طبقة عرض ذكية فقط.</span></div>
            <div class="v53-card"><strong>الخطوة التالية</strong><span class="v53-muted">تشغيل Workflow عدة مرات حتى تزيد التغطية، مع متابعة تبويب صحة البيانات.</span></div>
          </div>
        </div>
        <div class="v53-panel">
          <h3>📌 أسهم تنتظر Batch</h3>
          ${waiting.length ? `<div class="v53-cards">${waiting.map(r => `<div class="v53-card"><strong>${esc(r.symbol)}</strong><span class="v53-muted">${esc(r.name || r.sector || 'موجود في الكون ولم يدخل الكاش بعد')}</span></div>`).join('')}</div>` : '<div class="v53-muted">لا توجد أسهم waiting ظاهرة الآن.</div>'}
        </div>
      </div>
      <div style="margin-top:12px">${renderMiniOpportunities(top)}</div>
    `;
  }

  function renderMiniOpportunities(rows) {
    return `<div class="v53-panel"><h3>🚀 أفضل فرص المراقبة المختصرة</h3>${rows.length ? `<div class="v53-table-wrap"><table class="v53-table"><thead><tr><th>الرمز</th><th>الاسم</th><th>السعر</th><th>التغير</th><th>الثقة</th><th>التصنيف</th></tr></thead><tbody>${rows.map(r => `<tr><td><strong>${esc(r.symbol)}</strong></td><td class="v53-row-name">${esc(r.name || '—')}</td><td>${fmt(r.price)}</td><td class="${rowToneNumber(r.changePct)}">${Number.isFinite(r.changePct) ? fmt(r.changePct, 2) + '%' : '—'}</td><td>${Number.isFinite(r.confidence) ? fmt(r.confidence, 0) : '—'}</td><td><span class="v53-pill">${esc(r.decision || 'مراقبة')}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="v53-muted">لا توجد فرص كافية بعد. شغّل Workflow بعد رفع ملفات الذكاء.</div>'}</div>`;
  }

  function renderOpportunities() {
    const rows = state.universe.filter(r => r.recommended || r.proVisible || Number.isFinite(r.confidence)).sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return renderMiniOpportunities(rows.slice(0, 40));
  }

  function renderAlertsRisk() {
    const alerts = Array.isArray(state.data.alerts?.alerts) ? state.data.alerts.alerts : [];
    const risk = state.data.risk || {};
    return `<div class="v53-grid2">
      <div class="v53-panel"><h3>⚠️ التنبيهات</h3>${alerts.length ? `<div class="v53-cards">${alerts.slice(0, 16).map(a => `<div class="v53-card"><strong>${esc(a.title_ar || a.type || 'تنبيه')}</strong><span class="v53-muted">${esc(a.message_ar || a.message || '')}</span></div>`).join('')}</div>` : '<div class="v53-muted">لا توجد تنبيهات حالية.</div>'}</div>
      <div class="v53-panel"><h3>🛡️ لوحة المخاطر</h3><pre style="white-space:pre-wrap; overflow:auto; margin:0; color:var(--v53-muted); font-family:ui-monospace,Consolas,monospace; font-size:12px">${esc(JSON.stringify(risk, null, 2).slice(0, 3500) || 'لا يوجد risk-dashboard.json بعد')}</pre></div>
    </div>`;
  }

  function renderHealth() {
    const h = state.data.health || {};
    const audit = state.data.audit || {};
    return `<div class="v53-grid2">
      <div class="v53-panel"><h3>🩺 Source Health</h3><div class="v53-cards">
        <div class="v53-card"><strong>scanMode</strong><span class="v53-muted">${esc(h.scanMode || '—')}</span></div>
        <div class="v53-card"><strong>cacheRows</strong><span class="v53-muted">${fmt(h.cacheRows, 0)}</span></div>
        <div class="v53-card"><strong>totalUniverse</strong><span class="v53-muted">${fmt(h.totalUniverse, 0)}</span></div>
        <div class="v53-card"><strong>lastSuccessAt</strong><span class="v53-muted">${esc(dateText(h.lastSuccessAt || h.generatedAt))}</span></div>
      </div></div>
      <div class="v53-panel"><h3>🧩 Symbol Audit</h3><pre style="white-space:pre-wrap; overflow:auto; margin:0; color:var(--v53-muted); font-family:ui-monospace,Consolas,monospace; font-size:12px">${esc(JSON.stringify(audit, null, 2).slice(0, 3500) || 'لا يوجد symbol-audit.json بعد')}</pre></div>
    </div>`;
  }

  function renderContent() {
    if (state.tab === 'universe') return renderUniverseTable();
    if (state.tab === 'opportunities') return renderOpportunities();
    if (state.tab === 'alerts') return renderAlertsRisk();
    if (state.tab === 'health') return renderHealth();
    return renderOverview();
  }

  function render() {
    injectStyles();
    const root = ensureRoot();
    root.innerHTML = `${renderHeader()}${renderTabs()}<div class="v53-content">${renderContent()}</div><div class="v53-footer">آخر تحميل: ${esc(dateText(state.loadedAt))} — البيانات عامة ومتأخرة من Mubasher Public Pages، والتحليلات للمراقبة وليست أوامر تداول.</div>`;
    bindEvents(root);
  }

  function bindEvents(root) {
    $$('[data-tab]', root).forEach(btn => btn.addEventListener('click', () => {
      state.tab = btn.getAttribute('data-tab');
      localStorage.setItem('egx.v53.tab', state.tab);
      state.page = 1;
      render();
    }));

    const search = byId('v53-search');
    if (search) search.addEventListener('input', () => { state.query = search.value; state.page = 1; applyFilters(); render(); });
    const filter = byId('v53-filter');
    if (filter) filter.addEventListener('change', () => { state.filter = filter.value; state.page = 1; applyFilters(); render(); });
    const sort = byId('v53-sort');
    if (sort) sort.addEventListener('change', () => { state.sort = sort.value; state.page = 1; applyFilters(); render(); });
    const pageSize = byId('v53-page-size');
    if (pageSize) pageSize.addEventListener('change', () => { state.pageSize = Number(pageSize.value) || 50; localStorage.setItem('egx.v53.pageSize', String(state.pageSize)); state.page = 1; applyFilters(); render(); });

    $$('[data-page]', root).forEach(btn => btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-page');
      const pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
      if (action === 'prev') state.page = Math.max(1, state.page - 1);
      if (action === 'next') state.page = Math.min(pages, state.page + 1);
      render();
    }));

    $$('[data-action]', root).forEach(btn => btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'refresh') loadAll();
      if (action === 'workflow') window.open('https://github.com/rasheadsca-star/RAS-EGX0.1/actions/workflows/update-market-data.yml', '_blank', 'noopener');
    }));
  }

  async function loadAll() {
    injectStyles();
    const root = ensureRoot();
    root.innerHTML = `<div class="v53-top"><div><h2 class="v53-title">🧠 EGX Pro Hub V5.3 Smart Market UI</h2><p class="v53-sub">جار تحميل الكون الكامل والبيانات...</p></div></div>`;
    const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([key, url]) => {
      if (key === 'configCsv') return ['configCsvText', await loadText(url)];
      return [key, await loadJson(url)];
    }));
    state.data = Object.fromEntries(entries);
    state.loadedAt = new Date().toISOString();
    buildUniverse();
    render();
  }

  function boot() {
    loadAll();
    // If V5.2 loads slightly after this file, hide it again and keep V5.3 as the organized surface.
    setTimeout(() => {
      const old = byId('egx-v52-command-center');
      if (old) old.style.display = 'none';
    }, 1400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
