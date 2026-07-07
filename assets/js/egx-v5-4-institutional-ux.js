/* EGX Pro Hub V5.4 Institutional Workspace
   Purpose: calmer UX, full-universe visibility, professional SVG chart lab.
   Safe layer: reads public JSON/CSV only; does NOT write cache or reset V4.2.
*/
(function () {
  'use strict';

  const VERSION = '5.4.0-institutional-workspace';
  const ROOT_ID = 'egx-v54-workspace';
  const DATA_FILES = {
    health: 'data/source-health.json',
    audit: 'data/symbol-audit.json',
    universeIndex: 'data/universe-index.json',
    cache: 'data/full-market-cache.json',
    market: 'data/market.json',
    recommendations: 'data/recommendations.json',
    pro: 'data/pro-report.json',
    alerts: 'data/alerts.json',
    risk: 'data/risk-dashboard.json',
    session: 'data/session-report.json',
    history: 'data/history.json',
    configCsv: 'config/egx-symbols.csv'
  };

  const state = {
    data: {},
    rows: [],
    filtered: [],
    selectedSymbol: localStorage.getItem('egx.v54.selectedSymbol') || 'COMI',
    activeTab: localStorage.getItem('egx.v54.activeTab') || 'overview',
    query: '',
    status: 'all',
    sort: 'symbol',
    page: 1,
    pageSize: Number(localStorage.getItem('egx.v54.pageSize') || 50),
    chartRange: localStorage.getItem('egx.v54.chartRange') || 'all',
    chartMetric: localStorage.getItem('egx.v54.chartMetric') || 'price',
    loadedAt: null
  };

  const AR = typeof Intl !== 'undefined' ? new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }) : null;
  const EN = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }) : null;
  const COMPACT = typeof Intl !== 'undefined' ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }) : null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
    const n = Number(String(value).replace(/,/g, '').replace(/%/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }

  function fmt(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return (AR || EN).format(Number(n.toFixed(digits)));
  }

  function fmtCompact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return (COMPACT || EN).format(n);
  }

  function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : ''}${fmt(n, 2)}%`;
  }

  function dateText(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
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

  function discoverSymbolRecords(text) {
    const records = [];
    if (!text || !text.trim()) return records;

    const clean = text.replace(/\r/g, '\n').replace(/\uFEFF/g, '').replace(/\s+/g, ' ').trim();
    const headerless = clean.replace(/^symbol\s*,\s*name_ar\s*,\s*name_en\s*,\s*aliases\s*/i, '');

    // Record boundary: a ticker appears at the start or after whitespace and is immediately followed by a comma.
    // Supports tickers like ACTF.CA while avoiding Arabic/English text fragments.
    const re = /(?:^|\s)([A-Z]{2,7}(?:\.[A-Z]{1,3})?)(?=\s*,)/g;
    const matches = [];
    let m;
    while ((m = re.exec(headerless)) !== null) {
      const symbol = String(m[1]).toUpperCase();
      if (['SYMBOL', 'NAME', 'ALIASES', 'FOR', 'AND', 'THE'].includes(symbol)) continue;
      matches.push({ symbol, start: m.index + (m[0].startsWith(' ') ? 1 : 0) });
    }

    for (let i = 0; i < matches.length; i += 1) {
      const start = matches[i].start;
      const end = i + 1 < matches.length ? matches[i + 1].start : headerless.length;
      const chunk = headerless.slice(start, end).trim().replace(/\s+$/g, '');
      if (!chunk) continue;
      const cells = parseCsvLine(chunk);
      const symbol = String(cells[0] || matches[i].symbol).trim().toUpperCase();
      if (!symbol || !/^[A-Z0-9.]{2,12}$/.test(symbol)) continue;
      records.push({
        symbol,
        name_ar: cells[1] || '',
        name_en: cells[2] || '',
        aliases: cells.slice(3).join(',').trim(),
        configured: true,
        active: true
      });
    }

    return dedupeRows(records);
  }

  function parseSymbolsCsv(text) {
    if (!text || !text.trim()) return [];

    const rawLines = text.replace(/\r/g, '\n').split('\n').map(x => x.trim()).filter(Boolean);
    const header = rawLines.length ? parseCsvLine(rawLines[0]).map(h => h.trim().toLowerCase()) : [];
    const normalRows = [];

    if (header.some(h => ['symbol', 'ticker', 'code'].includes(h)) && rawLines.length > 100) {
      const idx = (names, fallback) => {
        for (const name of names) {
          const i = header.indexOf(name);
          if (i >= 0) return i;
        }
        return fallback;
      };
      const iSymbol = idx(['symbol', 'ticker', 'code'], 0);
      const iAr = idx(['name_ar', 'arabic_name', 'company_ar'], 1);
      const iEn = idx(['name_en', 'name', 'company_en', 'company'], 2);
      const iAliases = idx(['aliases', 'alias'], 3);
      const iSector = idx(['sector', 'sector_en', 'industry'], -1);
      const iActive = idx(['active', 'enabled'], -1);

      for (let i = 1; i < rawLines.length; i += 1) {
        const cells = parseCsvLine(rawLines[i]);
        const symbol = String(cells[iSymbol] || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
        if (!symbol || symbol === 'SYMBOL') continue;
        const activeRaw = iActive >= 0 ? String(cells[iActive] || '').trim().toLowerCase() : 'true';
        normalRows.push({
          symbol,
          name_ar: cells[iAr] || '',
          name_en: cells[iEn] || '',
          aliases: cells[iAliases] || '',
          sector: iSector >= 0 ? cells[iSector] || '' : '',
          configured: true,
          active: !['false', '0', 'no', 'inactive', 'delisted'].includes(activeRaw)
        });
      }
    }

    const discovered = discoverSymbolRecords(text);
    const best = discovered.length > normalRows.length ? discovered : normalRows;
    return dedupeRows(best);
  }

  function dedupeRows(rows) {
    const map = new Map();
    rows.forEach(row => {
      const symbol = symbolOf(row);
      if (!symbol) return;
      map.set(symbol, Object.assign({}, map.get(symbol) || {}, row, { symbol }));
    });
    return Array.from(map.values());
  }

  function likelyStockArray(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    const candidates = [
      json.rows, json.data, json.market, json.stocks, json.symbols, json.items,
      json.cache, json.recommendations, json.all, json.records, json.universe,
      json.topBuyCandidates, json.topOpportunities, json.opportunities
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.some(x => symbolOf(x))) return c;
    }
    if (typeof json === 'object') {
      const values = Object.values(json);
      if (values.length && values.some(v => v && typeof v === 'object' && symbolOf(v))) return values;
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

  function normalizeRow(row) {
    const price = firstDefined(row, ['price', 'lastPrice', 'last', 'close', 'lastTradePrice', 'currentPrice', 'last_price']);
    const changePct = firstDefined(row, ['changePct', 'changePercent', 'pctChange', 'percentChange', 'change_percent', 'change_percentage']);
    const volume = firstDefined(row, ['volume', 'tradeVolume', 'tradedVolume', 'vol', 'qty']);
    const value = firstDefined(row, ['turnover', 'value', 'tradedValue', 'tradeValue']);
    const confidence = firstDefined(row, ['confidence', 'finalConfidence', 'opportunityScore', 'score', 'realConfidence']);
    const decision = firstDefined(row, ['classification', 'decision', 'recommendation', 'signal', 'status']);
    const name = firstDefined(row, ['name_ar', 'arabicName', 'name', 'name_en', 'companyName', 'company']);
    const sector = firstDefined(row, ['sector', 'sector_ar', 'sector_en', 'industry']);
    const failed = Boolean(row.failed || row.status === 'failed' || row.error);
    const cached = Boolean(row.cached || (row.sources || []).includes('cache'));
    const configured = row.configured !== false && Boolean(row.configured || (row.sources || []).includes('config') || row.sources?.includes('universeIndex'));
    const recommended = Boolean(row.recommended || (row.sources || []).includes('recommendations') || (row.sources || []).includes('pro'));

    let coverageStatus = 'unknown';
    if (failed) coverageStatus = 'failed';
    else if (cached) coverageStatus = 'cached';
    else if (configured || row.missingFromCache) coverageStatus = 'waiting';

    return Object.assign({}, row, {
      symbol: symbolOf(row),
      name: name || '',
      sector: sector || '',
      priceNum: num(price, NaN),
      changePctNum: num(changePct, NaN),
      volumeNum: num(volume, NaN),
      valueNum: num(value, NaN),
      confidenceNum: num(confidence, NaN),
      decision: decision || '',
      configured,
      cached,
      failed,
      recommended,
      coverageStatus
    });
  }

  function buildUniverse() {
    const map = new Map();

    const indexRows = likelyStockArray(state.data.universeIndex);
    indexRows.forEach(row => mergeRow(map, Object.assign({}, row, { configured: row.configured !== false }), 'universeIndex'));

    const configured = parseSymbolsCsv(state.data.configCsvText || '');
    configured.forEach(row => mergeRow(map, row, 'config'));

    likelyStockArray(state.data.cache).forEach(row => mergeRow(map, Object.assign({}, row, { cached: true }), 'cache'));
    likelyStockArray(state.data.market).forEach(row => mergeRow(map, Object.assign({}, row, { marketVisible: true }), 'market'));
    likelyStockArray(state.data.recommendations).forEach(row => mergeRow(map, Object.assign({}, row, { recommended: true }), 'recommendations'));
    likelyStockArray(state.data.pro).forEach(row => mergeRow(map, Object.assign({}, row, { recommended: true, proVisible: true }), 'pro'));

    const auditMissing = Array.isArray(state.data.audit?.missingFromCache) ? state.data.audit.missingFromCache : [];
    auditMissing.forEach(symbol => mergeRow(map, { symbol, configured: true, missingFromCache: true }, 'audit'));

    const failed = new Set(Array.isArray(state.data.health?.failedSymbols) ? state.data.health.failedSymbols.map(s => String(s).toUpperCase()) : []);
    Array.from(failed).forEach(symbol => mergeRow(map, { symbol, failed: true, configured: true }, 'health'));

    const rows = Array.from(map.values()).map(row => normalizeRow(row));
    rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return rows;
  }

  function getStats() {
    const totalConfiguredFromHealth = num(state.data.health?.totalUniverse, NaN);
    const configured = Number.isFinite(totalConfiguredFromHealth) && totalConfiguredFromHealth > state.rows.length
      ? totalConfiguredFromHealth
      : state.rows.filter(r => r.configured).length || state.rows.length;
    const cached = state.rows.filter(r => r.cached).length || num(state.data.health?.cacheRows, 0);
    const failed = state.rows.filter(r => r.failed).length || (Array.isArray(state.data.health?.failedSymbols) ? state.data.health.failedSymbols.length : 0);
    const waiting = Math.max(0, configured - cached - failed);
    const coverage = configured ? Math.round((cached / configured) * 100) : 0;
    const etrs = state.rows.find(r => r.symbol === 'ETRS');
    const physicalLines = (state.data.configCsvText || '').replace(/\r/g, '\n').split('\n').filter(Boolean).length;
    const parsedCsv = parseSymbolsCsv(state.data.configCsvText || '').length;
    return { configured, cached, failed, waiting, coverage, etrs, physicalLines, parsedCsv };
  }

  function injectStyles() {
    if (document.getElementById('egx-v54-style')) return;
    const style = document.createElement('style');
    style.id = 'egx-v54-style';
    style.textContent = `
      :root {
        --egx54-bg: #eef3f8;
        --egx54-ink: #102033;
        --egx54-muted: #65758b;
        --egx54-soft: #f7fafc;
        --egx54-card: rgba(255,255,255,.92);
        --egx54-line: rgba(16,32,51,.10);
        --egx54-brand: #0e4c92;
        --egx54-brand2: #22a6b3;
        --egx54-good: #087f5b;
        --egx54-bad: #c92a2a;
        --egx54-warn: #d97706;
        --egx54-shadow: 0 24px 70px rgba(16,32,51,.12);
      }
      body { background: var(--egx54-bg) !important; }
      #${ROOT_ID} { direction: rtl; color: var(--egx54-ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, Arial, sans-serif; max-width: 1440px; margin: 18px auto 28px; padding: 0 18px; box-sizing: border-box; }
      #${ROOT_ID} * { box-sizing: border-box; }
      .egx54-shell { border-radius: 34px; overflow: hidden; background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(238,246,252,.88)); border: 1px solid rgba(14,76,146,.13); box-shadow: var(--egx54-shadow); }
      .egx54-hero { position: relative; padding: 26px; color: #fff; background: radial-gradient(circle at 15% 20%, rgba(34,166,179,.55), transparent 26%), linear-gradient(135deg, #081526, #0e315d 52%, #0d6673); overflow: hidden; }
      .egx54-hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,.08), transparent 42%), repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 90px); pointer-events: none; }
      .egx54-hero-inner { position: relative; z-index: 1; display: grid; grid-template-columns: 1.4fr .9fr; gap: 20px; align-items: center; }
      .egx54-kicker { display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.18); font-size: 12px; font-weight: 800; letter-spacing: .02em; }
      .egx54-title { margin: 14px 0 8px; font-size: clamp(28px, 4vw, 54px); line-height: 1.05; font-weight: 950; }
      .egx54-subtitle { max-width: 790px; margin: 0; color: rgba(255,255,255,.82); font-size: 15px; line-height: 1.8; }
      .egx54-hero-actions { margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap; }
      .egx54-btn { appearance: none; border: 0; cursor: pointer; border-radius: 15px; padding: 11px 15px; font-weight: 900; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; transition: transform .18s ease, box-shadow .18s ease, background .18s ease; text-decoration: none; }
      .egx54-btn:hover { transform: translateY(-1px); }
      .egx54-btn.primary { background: #fff; color: #0e315d; box-shadow: 0 16px 38px rgba(0,0,0,.18); }
      .egx54-btn.ghost { background: rgba(255,255,255,.12); color: #fff; border: 1px solid rgba(255,255,255,.18); }
      .egx54-hero-panel { border-radius: 24px; padding: 18px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.18); backdrop-filter: blur(14px); }
      .egx54-coverage-ring { --p: 0; width: 138px; height: 138px; border-radius: 50%; margin: auto; background: conic-gradient(#32d296 calc(var(--p)*1%), rgba(255,255,255,.22) 0); display: grid; place-items: center; box-shadow: inset 0 0 0 11px rgba(255,255,255,.07); }
      .egx54-coverage-ring > div { width: 104px; height: 104px; border-radius: 50%; background: rgba(8,21,38,.72); display: grid; place-items: center; text-align: center; }
      .egx54-coverage-ring strong { font-size: 30px; line-height: 1; }
      .egx54-coverage-ring span { font-size: 11px; color: rgba(255,255,255,.72); }
      .egx54-grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 720px; }
      .egx54-side { background: rgba(247,250,252,.72); border-left: 1px solid var(--egx54-line); padding: 18px; }
      .egx54-side-title { font-weight: 950; font-size: 13px; color: var(--egx54-muted); margin: 8px 8px 12px; }
      .egx54-nav { display: grid; gap: 8px; }
      .egx54-nav button { width: 100%; text-align: right; border: 1px solid transparent; background: transparent; color: var(--egx54-ink); padding: 13px 14px; border-radius: 16px; font-weight: 900; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
      .egx54-nav button:hover { background: rgba(14,76,146,.07); }
      .egx54-nav button.active { background: #fff; border-color: rgba(14,76,146,.14); box-shadow: 0 10px 30px rgba(14,76,146,.10); color: var(--egx54-brand); }
      .egx54-main { padding: 20px; min-width: 0; }
      .egx54-card { background: var(--egx54-card); border: 1px solid var(--egx54-line); border-radius: 24px; box-shadow: 0 12px 34px rgba(16,32,51,.06); overflow: hidden; }
      .egx54-card.pad { padding: 18px; }
      .egx54-card-head { padding: 16px 18px; border-bottom: 1px solid var(--egx54-line); display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
      .egx54-card-title { margin: 0; font-size: 18px; font-weight: 950; }
      .egx54-card-desc { margin: 4px 0 0; color: var(--egx54-muted); font-size: 12px; line-height: 1.7; }
      .egx54-kpis { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
      .egx54-kpi { padding: 15px; border-radius: 22px; background: #fff; border: 1px solid var(--egx54-line); box-shadow: 0 10px 25px rgba(16,32,51,.05); }
      .egx54-kpi small { color: var(--egx54-muted); font-weight: 850; display: block; margin-bottom: 7px; }
      .egx54-kpi strong { font-size: 25px; line-height: 1; font-weight: 950; }
      .egx54-kpi .hint { margin-top: 7px; color: var(--egx54-muted); font-size: 11px; }
      .egx54-two { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(320px, .88fr); gap: 16px; }
      .egx54-toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .egx54-input, .egx54-select { border: 1px solid var(--egx54-line); background: #fff; color: var(--egx54-ink); border-radius: 15px; padding: 11px 12px; min-height: 42px; font-weight: 800; outline: none; }
      .egx54-input { min-width: min(100%, 260px); }
      .egx54-select { cursor: pointer; }
      .egx54-table-wrap { overflow: auto; max-height: 610px; }
      .egx54-table { width: 100%; border-collapse: separate; border-spacing: 0; min-width: 860px; }
      .egx54-table th { position: sticky; top: 0; z-index: 2; background: #f8fafc; color: var(--egx54-muted); font-size: 12px; text-align: right; padding: 12px; border-bottom: 1px solid var(--egx54-line); white-space: nowrap; }
      .egx54-table td { padding: 12px; border-bottom: 1px solid rgba(16,32,51,.07); font-size: 13px; vertical-align: middle; }
      .egx54-table tr:hover td { background: rgba(14,76,146,.035); }
      .egx54-symbol { font-weight: 950; direction: ltr; text-align: left; display: inline-flex; gap: 8px; align-items: center; }
      .egx54-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--egx54-muted); display: inline-block; }
      .egx54-dot.cached { background: var(--egx54-good); }
      .egx54-dot.waiting { background: var(--egx54-warn); }
      .egx54-dot.failed { background: var(--egx54-bad); }
      .egx54-badge { display: inline-flex; align-items: center; justify-content: center; padding: 5px 8px; border-radius: 999px; font-size: 11px; font-weight: 950; border: 1px solid transparent; white-space: nowrap; }
      .egx54-badge.cached { color: #087f5b; background: rgba(8,127,91,.10); border-color: rgba(8,127,91,.17); }
      .egx54-badge.waiting { color: #b45309; background: rgba(217,119,6,.12); border-color: rgba(217,119,6,.18); }
      .egx54-badge.failed { color: #c92a2a; background: rgba(201,42,42,.10); border-color: rgba(201,42,42,.16); }
      .egx54-badge.info { color: var(--egx54-brand); background: rgba(14,76,146,.10); border-color: rgba(14,76,146,.15); }
      .egx54-positive { color: var(--egx54-good); font-weight: 950; }
      .egx54-negative { color: var(--egx54-bad); font-weight: 950; }
      .egx54-muted { color: var(--egx54-muted); }
      .egx54-pagination { padding: 12px 16px; display: flex; justify-content: space-between; gap: 12px; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--egx54-line); }
      .egx54-mini-btn { border: 1px solid var(--egx54-line); background: #fff; color: var(--egx54-ink); border-radius: 12px; padding: 8px 10px; font-weight: 950; cursor: pointer; }
      .egx54-mini-btn:disabled { opacity: .45; cursor: not-allowed; }
      .egx54-chart-shell { min-height: 540px; display: grid; grid-template-rows: auto 1fr; }
      .egx54-chart-toolbar { padding: 14px 16px; border-bottom: 1px solid var(--egx54-line); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
      .egx54-chart-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .egx54-chart-title strong { font-size: 22px; direction: ltr; }
      .egx54-range { display: flex; gap: 6px; padding: 4px; background: #edf2f7; border-radius: 14px; }
      .egx54-range button { border: 0; border-radius: 11px; padding: 8px 10px; background: transparent; font-weight: 950; cursor: pointer; color: var(--egx54-muted); }
      .egx54-range button.active { background: #fff; color: var(--egx54-brand); box-shadow: 0 6px 18px rgba(16,32,51,.10); }
      .egx54-chart-area { padding: 10px 14px 16px; min-height: 460px; }
      .egx54-chart-svg { width: 100%; height: 420px; display: block; background: linear-gradient(180deg, #fff, #f8fafc); border: 1px solid rgba(16,32,51,.08); border-radius: 22px; overflow: hidden; }
      .egx54-chart-note { margin-top: 10px; color: var(--egx54-muted); font-size: 12px; line-height: 1.7; }
      .egx54-empty { min-height: 260px; display: grid; place-items: center; text-align: center; padding: 22px; color: var(--egx54-muted); }
      .egx54-empty strong { color: var(--egx54-ink); display: block; font-size: 17px; margin-bottom: 8px; }
      .egx54-list { display: grid; gap: 10px; }
      .egx54-list-item { border: 1px solid var(--egx54-line); border-radius: 18px; padding: 13px; background: #fff; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
      .egx54-list-item strong { direction: ltr; }
      .egx54-callout { padding: 15px; border-radius: 20px; background: rgba(14,76,146,.08); border: 1px solid rgba(14,76,146,.12); color: #123; line-height: 1.8; font-size: 13px; }
      .egx54-legacy-toggle { margin-top: 14px; }
      .egx54-legacy-toggle button { width: 100%; }
      .egx54-hidden-legacy body > *:not(#${ROOT_ID}):not(script):not(style) { display: none !important; }
      @media (max-width: 1100px) { .egx54-hero-inner, .egx54-grid, .egx54-two { grid-template-columns: 1fr; } .egx54-side { border-left: 0; border-bottom: 1px solid var(--egx54-line); } .egx54-nav { grid-template-columns: repeat(2, minmax(0,1fr)); } .egx54-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); } }
      @media (max-width: 720px) { #${ROOT_ID} { padding: 0 10px; margin-top: 10px; } .egx54-hero { padding: 20px; } .egx54-main { padding: 12px; } .egx54-nav { grid-template-columns: 1fr; } .egx54-kpis { grid-template-columns: 1fr; } .egx54-title { font-size: 30px; } }
    `;
    document.head.appendChild(style);
  }

  function mountShell() {
    let root = document.getElementById(ROOT_ID);
    if (root) root.remove();
    root = document.createElement('section');
    root.id = ROOT_ID;
    const first = document.body.firstElementChild;
    document.body.insertBefore(root, first || null);
    return root;
  }

  function root() { return document.getElementById(ROOT_ID); }

  function navButton(id, label, count) {
    return `<button type="button" data-tab="${id}" class="${state.activeTab === id ? 'active' : ''}"><span>${label}</span>${count !== undefined ? `<small>${count}</small>` : ''}</button>`;
  }

  function renderShell() {
    const r = root();
    if (!r) return;
    const s = getStats();
    const etrsLabel = s.etrs ? statusLabel(s.etrs) : 'غير ظاهر';

    r.innerHTML = `
      <div class="egx54-shell">
        <header class="egx54-hero">
          <div class="egx54-hero-inner">
            <div>
              <span class="egx54-kicker">V5.4 Institutional Workspace · Full universe first</span>
              <h1 class="egx54-title">EGX Pro Hub بصورة أهدأ، أوضح، وأكثر احترافية</h1>
              <p class="egx54-subtitle">تنظيم جديد للواجهة، فحص تغطية كل أسهم السوق، جدول كامل ببحث وصفحات، ومعمل شارت احترافي بدون لمس V4.2 أو تصفير ملفات الكاش.</p>
              <div class="egx54-hero-actions">
                <button type="button" class="egx54-btn primary" data-action="tab" data-tab="universe">افتح كل الأسهم</button>
                <button type="button" class="egx54-btn ghost" data-action="tab" data-tab="chart">افتح الشارت الاحترافي</button>
                <button type="button" class="egx54-btn ghost" data-action="reload">تحديث البيانات</button>
              </div>
            </div>
            <div class="egx54-hero-panel">
              <div class="egx54-coverage-ring" style="--p:${s.coverage}"><div><strong>${fmt(s.coverage, 0)}%</strong><span>تغطية الكاش</span></div></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px;font-size:12px;color:rgba(255,255,255,.82);">
                <div>Universe: <b>${fmt(s.configured, 0)}</b></div>
                <div>Cached: <b>${fmt(s.cached, 0)}</b></div>
                <div>Waiting: <b>${fmt(s.waiting, 0)}</b></div>
                <div>ETRS: <b>${esc(etrsLabel)}</b></div>
              </div>
            </div>
          </div>
        </header>
        <div class="egx54-grid">
          <aside class="egx54-side">
            <div class="egx54-side-title">مساحات العمل</div>
            <nav class="egx54-nav">
              ${navButton('overview', 'الرئيسية الذكية')}
              ${navButton('universe', 'كل الأسهم', s.configured)}
              ${navButton('opportunities', 'الفرص المختصرة')}
              ${navButton('chart', 'Chart Lab')}
              ${navButton('quality', 'صحة البيانات')}
            </nav>
            <div class="egx54-legacy-toggle">
              <button class="egx54-mini-btn" data-action="toggleLegacy">إخفاء/إظهار الواجهات القديمة</button>
            </div>
            <div class="egx54-callout" style="margin-top:14px;">الترتيب الجديد لا يلغي الواجهات السابقة؛ هو طبقة عمل منظمة فوقها. البيانات عامة ومتأخرة وليست أوامر تداول.</div>
          </aside>
          <main class="egx54-main" data-main></main>
        </div>
      </div>
    `;

    bindShellEvents();
    renderTab();
  }


  function bindShellEvents() {
    const r = root();
    if (!r) return;
    $$('[data-action="tab"]', r).forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
    $$('.egx54-nav [data-tab]', r).forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
    const reload = $('[data-action="reload"]', r);
    if (reload) reload.addEventListener('click', () => init(true));
    const legacy = $('[data-action="toggleLegacy"]', r);
    if (legacy) legacy.addEventListener('click', toggleLegacy);
  }

  function toggleLegacy() {
    const key = 'egx.v54.hideLegacy';
    const next = localStorage.getItem(key) !== 'true';
    localStorage.setItem(key, String(next));
    applyLegacyMode();
  }

  function applyLegacyMode() {
    const hide = localStorage.getItem('egx.v54.hideLegacy') === 'true';
    document.documentElement.classList.toggle('egx54-hidden-legacy', hide);
  }

  function setTab(tab) {
    state.activeTab = tab || 'overview';
    localStorage.setItem('egx.v54.activeTab', state.activeTab);
    $$('.egx54-nav [data-tab]', root()).forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.activeTab));
    renderTab();
  }

  function main() { return $('[data-main]', root()); }

  function renderTab() {
    if (state.activeTab === 'universe') return renderUniverse();
    if (state.activeTab === 'opportunities') return renderOpportunities();
    if (state.activeTab === 'chart') return renderChartLab();
    if (state.activeTab === 'quality') return renderQuality();
    return renderOverview();
  }

  function statusLabel(row) {
    if (!row) return 'غير ظاهر';
    if (row.failed) return 'فشل قراءة';
    if (row.cached) return 'داخل الكاش';
    if (row.configured || row.missingFromCache) return 'ينتظر Batch';
    return 'غير معروف';
  }

  function statusBadge(row) {
    const cls = row.failed ? 'failed' : row.cached ? 'cached' : 'waiting';
    return `<span class="egx54-badge ${cls}">${esc(statusLabel(row))}</span>`;
  }

  function renderOverview() {
    const s = getStats();
    const m = main();
    if (!m) return;
    const topRows = state.rows
      .filter(r => r.cached || r.recommended)
      .sort((a, b) => (num(b.confidenceNum, -1) - num(a.confidenceNum, -1)) || (num(b.volumeNum, 0) - num(a.volumeNum, 0)))
      .slice(0, 8);
    const waiting = state.rows.filter(r => r.coverageStatus === 'waiting').slice(0, 8);

    m.innerHTML = `
      <div class="egx54-kpis">
        ${kpi('كل أسهم الكون', s.configured, `CSV parsed: ${s.parsedCsv}`)}
        ${kpi('داخل الكاش', s.cached, 'تزيد مع تشغيل Workflow')}
        ${kpi('ينتظر Batch', s.waiting, 'ليس نقصًا إذا كان في الكون')}
        ${kpi('فشل قراءة', s.failed, 'يحتاج متابعة لو زاد')}
        ${kpi('ETRS', statusLabel(s.etrs), 'Egyptian Transport')}
      </div>
      <div class="egx54-two">
        <section class="egx54-card">
          <div class="egx54-card-head">
            <div><h2 class="egx54-card-title">مختصر السوق المنظم</h2><p class="egx54-card-desc">الواجهة الجديدة تعرض ملخصًا أولًا، ثم التفاصيل عند الطلب بدل الزحمة.</p></div>
            <button class="egx54-mini-btn" data-action="tab" data-tab="universe">افتح كل الأسهم</button>
          </div>
          <div class="egx54-table-wrap" style="max-height:430px;">
            <table class="egx54-table">
              <thead><tr><th>السهم</th><th>الاسم</th><th>السعر</th><th>التغير</th><th>الثقة</th><th>الحالة</th></tr></thead>
              <tbody>${topRows.map(rowHtml).join('') || emptyRow(6, 'لا توجد فرص/بيانات كاش كافية حتى الآن')}</tbody>
            </table>
          </div>
        </section>
        <section class="egx54-card pad">
          <h2 class="egx54-card-title">مؤشر اكتمال السوق</h2>
          <p class="egx54-card-desc">الهدف ليس عرض 100 سهم فقط؛ الهدف عرض كل الكون مع توضيح ما دخل الكاش وما ينتظر الدور.</p>
          <div style="margin:18px 0;height:12px;border-radius:999px;background:#e2e8f0;overflow:hidden;"><div style="height:100%;width:${Math.min(100, s.coverage)}%;background:linear-gradient(90deg,var(--egx54-brand),var(--egx54-brand2));border-radius:999px;"></div></div>
          <div class="egx54-list">
            <div class="egx54-list-item"><span>أسهم تنتظر Batch</span><strong>${fmt(s.waiting, 0)}</strong></div>
            <div class="egx54-list-item"><span>ETRS</span><strong>${statusBadge(s.etds || s.etdrs || s.etfrs || s.etrs || { symbol: 'ETRS' })}</strong></div>
            <div class="egx54-list-item"><span>CSV physical lines</span><strong>${fmt(s.physicalLines, 0)}</strong></div>
            <div class="egx54-list-item"><span>Parsed symbols</span><strong>${fmt(s.parsedCsv, 0)}</strong></div>
          </div>
          <div class="egx54-callout" style="margin-top:14px;">لو السهم موجود كـ Waiting فهذا يعني أنه داخل الكون لكن لم يدخل الكاش بعد. لا نعمل Reset؛ نشغل Workflow على دفعات حتى ترتفع التغطية.</div>
        </section>
      </div>
      <div class="egx54-card pad" style="margin-top:16px;">
        <h2 class="egx54-card-title">أسهم تنتظر الظهور في الكاش</h2>
        <p class="egx54-card-desc">أول عينة فقط، والقائمة الكاملة في تبويب كل الأسهم.</p>
        <div class="egx54-list">${waiting.map(r => `<div class="egx54-list-item"><span><strong>${esc(r.symbol)}</strong> ${esc(r.name || '')}</span>${statusBadge(r)}</div>`).join('') || '<div class="egx54-empty"><strong>لا توجد أسهم Waiting ظاهرة</strong><span>قد يكون الكون كله داخل الكاش أو ملف التدقيق غير مولد بعد.</span></div>'}</div>
      </div>
    `;
    bindShellEvents();
  }

  function kpi(label, value, hint) {
    return `<div class="egx54-kpi"><small>${esc(label)}</small><strong>${typeof value === 'number' ? fmt(value, 0) : esc(value || '—')}</strong>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
  }

  function rowHtml(r) {
    const chClass = Number(r.changePctNum) >= 0 ? 'egx54-positive' : 'egx54-negative';
    return `<tr data-symbol="${esc(r.symbol)}" style="cursor:pointer">
      <td><span class="egx54-symbol"><span class="egx54-dot ${r.coverageStatus}"></span>${esc(r.symbol)}</span></td>
      <td>${esc(r.name || r.name_ar || r.name_en || '—')}<div class="egx54-muted" style="font-size:11px;">${esc(r.sector || '')}</div></td>
      <td>${fmt(r.priceNum)}</td>
      <td class="${Number.isFinite(r.changePctNum) ? chClass : ''}">${pct(r.changePctNum)}</td>
      <td>${Number.isFinite(r.confidenceNum) ? fmt(r.confidenceNum, 0) : '—'}</td>
      <td>${statusBadge(r)}</td>
    </tr>`;
  }

  function emptyRow(cols, text) {
    return `<tr><td colspan="${cols}" class="egx54-empty"><strong>${esc(text)}</strong></td></tr>`;
  }

  function applyFilters() {
    const q = state.query.trim().toLowerCase();
    let rows = state.rows.slice();
    if (q) {
      rows = rows.filter(r => [r.symbol, r.name, r.name_ar, r.name_en, r.aliases, r.sector, r.decision].join(' ').toLowerCase().includes(q));
    }
    if (state.status !== 'all') {
      if (state.status === 'cached') rows = rows.filter(r => r.cached);
      if (state.status === 'waiting') rows = rows.filter(r => r.coverageStatus === 'waiting');
      if (state.status === 'failed') rows = rows.filter(r => r.failed);
      if (state.status === 'opportunities') rows = rows.filter(r => r.recommended || Number.isFinite(r.confidenceNum));
    }
    rows.sort(sorter(state.sort));
    state.filtered = rows;
    return rows;
  }

  function sorter(sort) {
    const byNum = (key) => (a, b) => (num(b[key], -Infinity) - num(a[key], -Infinity)) || a.symbol.localeCompare(b.symbol);
    if (sort === 'confidence') return byNum('confidenceNum');
    if (sort === 'change') return byNum('changePctNum');
    if (sort === 'volume') return byNum('volumeNum');
    if (sort === 'price') return byNum('priceNum');
    if (sort === 'status') return (a, b) => a.coverageStatus.localeCompare(b.coverageStatus) || a.symbol.localeCompare(b.symbol);
    return (a, b) => a.symbol.localeCompare(b.symbol);
  }

  function renderUniverse() {
    const m = main();
    if (!m) return;
    const rows = applyFilters();
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const pageRows = rows.slice(start, start + state.pageSize);

    m.innerHTML = `
      <section class="egx54-card">
        <div class="egx54-card-head">
          <div><h2 class="egx54-card-title">كل أسهم السوق — بدون حد 100</h2><p class="egx54-card-desc">عرض كامل مع بحث وصفحات، لذلك لا تتحول الشاشة إلى كتلة مزدحمة.</p></div>
          <div class="egx54-toolbar">
            <input class="egx54-input" data-field="query" placeholder="ابحث: ETRS / ايجيترانس / بنك..." value="${esc(state.query)}" />
            <select class="egx54-select" data-field="status">
              ${option('all','كل الأسهم', state.status)}
              ${option('cached','داخل الكاش', state.status)}
              ${option('waiting','ينتظر Batch', state.status)}
              ${option('opportunities','فرص/درجات', state.status)}
              ${option('failed','فشل قراءة', state.status)}
            </select>
            <select class="egx54-select" data-field="sort">
              ${option('symbol','ترتيب بالرمز', state.sort)}
              ${option('confidence','الأعلى ثقة', state.sort)}
              ${option('change','الأعلى تغيرًا', state.sort)}
              ${option('volume','الأعلى حجمًا', state.sort)}
              ${option('price','الأعلى سعرًا', state.sort)}
              ${option('status','حسب الحالة', state.sort)}
            </select>
            <select class="egx54-select" data-field="pageSize">
              ${[25,50,100,250].map(n => option(String(n), `${n} / صفحة`, String(state.pageSize))).join('')}
            </select>
          </div>
        </div>
        <div class="egx54-table-wrap">
          <table class="egx54-table">
            <thead><tr><th>السهم</th><th>الاسم</th><th>السعر</th><th>التغير</th><th>الحجم</th><th>الثقة</th><th>المصادر</th><th>الحالة</th></tr></thead>
            <tbody>${pageRows.map(r => tableRow(r)).join('') || emptyRow(8, 'لا توجد نتائج مطابقة')}</tbody>
          </table>
        </div>
        <div class="egx54-pagination">
          <div>عرض ${fmt(start + 1,0)}–${fmt(Math.min(start + state.pageSize, rows.length),0)} من ${fmt(rows.length,0)}</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="egx54-mini-btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>السابق</button>
            <strong>${fmt(state.page,0)} / ${fmt(pages,0)}</strong>
            <button class="egx54-mini-btn" data-page="next" ${state.page >= pages ? 'disabled' : ''}>التالي</button>
          </div>
        </div>
      </section>
    `;
    bindUniverseEvents();
  }

  function option(value, label, selected) {
    return `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(label)}</option>`;
  }

  function tableRow(r) {
    const chClass = Number(r.changePctNum) >= 0 ? 'egx54-positive' : 'egx54-negative';
    return `<tr data-symbol="${esc(r.symbol)}" style="cursor:pointer">
      <td><span class="egx54-symbol"><span class="egx54-dot ${r.coverageStatus}"></span>${esc(r.symbol)}</span></td>
      <td>${esc(r.name || r.name_ar || r.name_en || '—')}<div class="egx54-muted" style="font-size:11px;">${esc(r.aliases || r.sector || '')}</div></td>
      <td>${fmt(r.priceNum)}</td>
      <td class="${Number.isFinite(r.changePctNum) ? chClass : ''}">${pct(r.changePctNum)}</td>
      <td>${fmtCompact(r.volumeNum)}</td>
      <td>${Number.isFinite(r.confidenceNum) ? fmt(r.confidenceNum,0) : '—'}</td>
      <td>${esc((r.sources || []).join(' · ') || '—')}</td>
      <td>${statusBadge(r)}</td>
    </tr>`;
  }

  function bindUniverseEvents() {
    const m = main();
    if (!m) return;
    const query = $('[data-field="query"]', m);
    if (query) query.addEventListener('input', debounce(() => { state.query = query.value; state.page = 1; renderUniverse(); }, 220));
    $$('[data-field="status"], [data-field="sort"], [data-field="pageSize"]', m).forEach(el => {
      el.addEventListener('change', () => {
        const f = el.dataset.field;
        if (f === 'status') state.status = el.value;
        if (f === 'sort') state.sort = el.value;
        if (f === 'pageSize') { state.pageSize = Number(el.value); localStorage.setItem('egx.v54.pageSize', String(state.pageSize)); }
        state.page = 1;
        renderUniverse();
      });
    });
    $$('[data-page]', m).forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.page === 'prev') state.page = Math.max(1, state.page - 1);
      if (btn.dataset.page === 'next') state.page += 1;
      renderUniverse();
    }));
    $$('tr[data-symbol]', m).forEach(tr => tr.addEventListener('click', () => {
      state.selectedSymbol = tr.dataset.symbol;
      localStorage.setItem('egx.v54.selectedSymbol', state.selectedSymbol);
      setTab('chart');
    }));
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function renderOpportunities() {
    const m = main();
    if (!m) return;
    const rows = state.rows
      .filter(r => r.recommended || Number.isFinite(r.confidenceNum) || r.decision)
      .sort(sorter('confidence'))
      .slice(0, 30);
    m.innerHTML = `
      <section class="egx54-card">
        <div class="egx54-card-head"><div><h2 class="egx54-card-title">الفرص المختصرة</h2><p class="egx54-card-desc">عرض مرتب بدل الزحمة. ليست أوامر شراء/بيع؛ فقط مراقبة وتحليل.</p></div></div>
        <div class="egx54-table-wrap"><table class="egx54-table"><thead><tr><th>السهم</th><th>الاسم</th><th>السعر</th><th>التغير</th><th>الثقة</th><th>التصنيف</th><th>الحالة</th></tr></thead><tbody>${rows.map(r => `<tr data-symbol="${esc(r.symbol)}"><td><span class="egx54-symbol"><span class="egx54-dot ${r.coverageStatus}"></span>${esc(r.symbol)}</span></td><td>${esc(r.name || '—')}</td><td>${fmt(r.priceNum)}</td><td>${pct(r.changePctNum)}</td><td>${Number.isFinite(r.confidenceNum) ? fmt(r.confidenceNum,0) : '—'}</td><td>${esc(r.decision || 'مراقبة')}</td><td>${statusBadge(r)}</td></tr>`).join('') || emptyRow(7, 'لا توجد فرص كافية حتى الآن')}</tbody></table></div>
      </section>
    `;
    $$('tr[data-symbol]', m).forEach(tr => tr.addEventListener('click', () => { state.selectedSymbol = tr.dataset.symbol; localStorage.setItem('egx.v54.selectedSymbol', state.selectedSymbol); setTab('chart'); }));
  }

  function renderChartLab() {
    const m = main();
    if (!m) return;
    const selected = state.rows.find(r => r.symbol === state.selectedSymbol) || state.rows[0] || { symbol: state.selectedSymbol };
    state.selectedSymbol = selected.symbol;
    const options = state.rows.slice().sort((a,b) => a.symbol.localeCompare(b.symbol)).map(r => `<option value="${esc(r.symbol)}" ${r.symbol === selected.symbol ? 'selected' : ''}>${esc(r.symbol)} — ${esc((r.name || '').slice(0, 42))}</option>`).join('');
    const series = getHistorySeries(selected.symbol);
    const filtered = filterSeries(series, state.chartRange);
    m.innerHTML = `
      <section class="egx54-card egx54-chart-shell">
        <div class="egx54-chart-toolbar">
          <div class="egx54-chart-title"><strong>${esc(selected.symbol)}</strong><span>${esc(selected.name || selected.name_ar || selected.name_en || '')}</span>${statusBadge(selected)}</div>
          <div class="egx54-toolbar">
            <select class="egx54-select" data-chart-symbol>${options}</select>
            <div class="egx54-range">${['1m','3m','6m','all'].map(r => `<button type="button" data-range="${r}" class="${state.chartRange === r ? 'active' : ''}">${rangeLabel(r)}</button>`).join('')}</div>
          </div>
        </div>
        <div class="egx54-chart-area">
          ${renderProfessionalChart(selected, filtered)}
          <div class="egx54-chart-note">الشارت يستخدم التاريخ المتاح في <b>data/history.json</b> أو اللقطات المتاحة. لو ظهرت رسالة نقص بيانات فهذا ليس عيبًا في الرسم؛ معناه أن التطبيق يحتاج تجميع تاريخ يومي أكثر لكل سهم.</div>
        </div>
      </section>
    `;
    bindChartEvents();
  }

  function rangeLabel(r) {
    return r === '1m' ? '1M' : r === '3m' ? '3M' : r === '6m' ? '6M' : 'ALL';
  }

  function bindChartEvents() {
    const m = main();
    if (!m) return;
    const sel = $('[data-chart-symbol]', m);
    if (sel) sel.addEventListener('change', () => {
      state.selectedSymbol = sel.value;
      localStorage.setItem('egx.v54.selectedSymbol', state.selectedSymbol);
      renderChartLab();
    });
    $$('[data-range]', m).forEach(btn => btn.addEventListener('click', () => {
      state.chartRange = btn.dataset.range;
      localStorage.setItem('egx.v54.chartRange', state.chartRange);
      renderChartLab();
    }));
  }

  function getHistorySeries(symbol) {
    const hist = state.data.history;
    const out = [];
    const sym = String(symbol).toUpperCase();

    function pushPoint(p) {
      if (!p || typeof p !== 'object') return;
      const ps = symbolOf(p) || sym;
      if (ps !== sym) return;
      const price = firstDefined(p, ['close', 'price', 'last', 'lastPrice', 'value', 'currentPrice']);
      const volume = firstDefined(p, ['volume', 'tradeVolume', 'tradedVolume', 'vol']);
      const date = firstDefined(p, ['date', 'time', 'timestamp', 'generatedAt', 'lastUpdate', 'sessionDate']);
      const priceNum = num(price, NaN);
      if (!Number.isFinite(priceNum)) return;
      out.push({ date: date || '', t: date ? new Date(date).getTime() : out.length, price: priceNum, volume: num(volume, 0) });
    }

    if (Array.isArray(hist)) hist.forEach(pushPoint);
    else if (hist && typeof hist === 'object') {
      if (Array.isArray(hist[sym])) hist[sym].forEach(p => pushPoint(Object.assign({ symbol: sym }, p)));
      if (Array.isArray(hist.rows)) hist.rows.forEach(pushPoint);
      if (Array.isArray(hist.data)) hist.data.forEach(pushPoint);
      if (hist.symbols && Array.isArray(hist.symbols[sym])) hist.symbols[sym].forEach(p => pushPoint(Object.assign({ symbol: sym }, p)));
    }

    // Fallback: one current point only. We do not fake a trend.
    if (!out.length) {
      const row = state.rows.find(r => r.symbol === sym);
      if (row && Number.isFinite(row.priceNum)) out.push({ date: state.data.health?.generatedAt || new Date().toISOString(), t: Date.now(), price: row.priceNum, volume: row.volumeNum || 0, snapshot: true });
    }

    out.sort((a,b) => (a.t || 0) - (b.t || 0));
    return out;
  }

  function filterSeries(series, range) {
    if (!Array.isArray(series) || !series.length || range === 'all') return series || [];
    const days = range === '1m' ? 31 : range === '3m' ? 93 : range === '6m' ? 186 : 99999;
    const max = Math.max(...series.map(p => p.t || 0).filter(Boolean));
    if (!Number.isFinite(max)) return series;
    const from = max - days * 24 * 60 * 60 * 1000;
    return series.filter(p => !p.t || p.t >= from);
  }

  function renderProfessionalChart(row, series) {
    if (!series || series.length < 2) {
      return `<div class="egx54-empty"><div><strong>لا توجد سلسلة تاريخية كافية لرسم شارت احترافي لـ ${esc(row.symbol)}</strong><span>السهم ظاهر كبيانات حالية، لكن الرسم الاحترافي يحتاج نقاط تاريخية متعددة من Workflow. السعر الحالي: ${fmt(row.priceNum)}</span></div></div>`;
    }

    const w = 1000, h = 420;
    const pad = { l: 72, r: 24, t: 28, b: 70 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const prices = series.map(p => p.price).filter(Number.isFinite);
    const volumes = series.map(p => p.volume).filter(Number.isFinite);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const span = Math.max(0.0001, maxP - minP);
    const yMin = minP - span * 0.08;
    const yMax = maxP + span * 0.08;
    const maxV = Math.max(1, ...volumes);
    const x = i => pad.l + (series.length === 1 ? 0 : (i / (series.length - 1)) * plotW);
    const y = p => pad.t + ((yMax - p) / (yMax - yMin)) * (plotH * 0.72);
    const volY = v => pad.t + plotH - (v / maxV) * (plotH * 0.2);
    const baseVolY = pad.t + plotH;
    const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
    const area = `${line} L${x(series.length - 1).toFixed(1)},${(pad.t + plotH * .78).toFixed(1)} L${x(0).toFixed(1)},${(pad.t + plotH * .78).toFixed(1)} Z`;
    const grid = [];
    const labels = [];
    for (let i = 0; i <= 5; i += 1) {
      const yy = pad.t + (i / 5) * (plotH * 0.72);
      const val = yMax - (i / 5) * (yMax - yMin);
      grid.push(`<line x1="${pad.l}" y1="${yy}" x2="${w-pad.r}" y2="${yy}" stroke="rgba(16,32,51,.08)" />`);
      labels.push(`<text x="${pad.l - 12}" y="${yy + 4}" text-anchor="end" font-size="12" fill="#64748b">${fmt(val)}</text>`);
    }
    const step = Math.max(1, Math.floor(series.length / 6));
    const xLabels = series.map((p, i) => {
      if (i % step !== 0 && i !== series.length - 1) return '';
      const label = p.date ? shortDate(p.date) : String(i + 1);
      return `<text x="${x(i)}" y="${h - 28}" text-anchor="middle" font-size="12" fill="#64748b">${esc(label)}</text>`;
    }).join('');
    const bars = series.map((p, i) => {
      const bw = Math.max(2, plotW / series.length * .55);
      const bx = x(i) - bw / 2;
      const by = volY(num(p.volume, 0));
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, baseVolY - by).toFixed(1)}" rx="2" fill="rgba(14,76,146,.18)" />`;
    }).join('');
    const last = series[series.length - 1];
    const first = series[0];
    const change = first?.price ? ((last.price - first.price) / first.price) * 100 : NaN;
    const stroke = change >= 0 ? '#087f5b' : '#c92a2a';

    return `
      <svg class="egx54-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(row.symbol)} price chart">
        <defs>
          <linearGradient id="egx54Area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${stroke}" stop-opacity=".28"/><stop offset="100%" stop-color="${stroke}" stop-opacity=".02"/></linearGradient>
          <filter id="egx54Glow"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="${stroke}" flood-opacity=".18"/></filter>
        </defs>
        <rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/>
        ${grid.join('')}
        ${labels.join('')}
        ${bars}
        <path d="${area}" fill="url(#egx54Area)"/>
        <path d="${line}" fill="none" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#egx54Glow)"/>
        <circle cx="${x(series.length - 1)}" cy="${y(last.price)}" r="5" fill="#fff" stroke="${stroke}" stroke-width="3"/>
        <line x1="${pad.l}" y1="${pad.t + plotH * .78}" x2="${w-pad.r}" y2="${pad.t + plotH * .78}" stroke="rgba(16,32,51,.10)"/>
        ${xLabels}
        <text x="${w - pad.r}" y="24" text-anchor="end" font-size="15" font-weight="800" fill="#102033">${esc(row.symbol)} · آخر سعر ${fmt(last.price)} · ${pct(change)}</text>
        <text x="${w - pad.r}" y="46" text-anchor="end" font-size="12" fill="#64748b">Volume bars below · Public delayed data</text>
      </svg>
    `;
  }

  function shortDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  function renderQuality() {
    const m = main();
    if (!m) return;
    const s = getStats();
    const rawHealth = state.data.health || {};
    const csvWarning = s.physicalLines < 100 && s.parsedCsv >= 100;
    const failed = state.rows.filter(r => r.failed).slice(0, 20);
    m.innerHTML = `
      <div class="egx54-kpis">
        ${kpi('totalUniverse', s.configured, rawHealth.scanMode || '')}
        ${kpi('cacheRows', s.cached, `Coverage ${s.coverage}%`)}
        ${kpi('CSV lines', s.physicalLines, csvWarning ? 'Compressed/malformed but recoverable' : 'Normal')}
        ${kpi('Parsed symbols', s.parsedCsv, 'V5.4 robust parser')}
        ${kpi('Last success', rawHealth.lastSuccessAt ? dateText(rawHealth.lastSuccessAt) : '—', rawHealth.mode || '')}
      </div>
      <section class="egx54-card pad">
        <h2 class="egx54-card-title">تدقيق اكتمال السوق</h2>
        <p class="egx54-card-desc">هذه الشاشة توضح الفرق بين: موجود في الكون، موجود في الكاش، ينتظر Batch، أو فشل قراءة.</p>
        <div class="egx54-callout" style="margin-top:14px;">${csvWarning ? 'ملاحظة مهمة: ملف config/egx-symbols.csv الحالي مضغوط/غير منظم كسطر لكل سهم. V5.4 يقرأه بذكاء، لكن الأفضل لاحقًا توليد universe-index.json أو إعادة تنسيق CSV بشكل طبيعي.' : 'تنسيق CSV يبدو مقبولًا.'}</div>
      </section>
      <section class="egx54-card" style="margin-top:16px;">
        <div class="egx54-card-head"><div><h2 class="egx54-card-title">أخطاء القراءة</h2><p class="egx54-card-desc">لو ظهرت هنا رموز كثيرة نراجع روابط Mubasher أو parser.</p></div></div>
        <div class="egx54-table-wrap"><table class="egx54-table"><thead><tr><th>السهم</th><th>الاسم</th><th>المصادر</th><th>الحالة</th></tr></thead><tbody>${failed.map(r => `<tr><td>${esc(r.symbol)}</td><td>${esc(r.name || '—')}</td><td>${esc((r.sources || []).join(' · '))}</td><td>${statusBadge(r)}</td></tr>`).join('') || emptyRow(4, 'لا توجد أخطاء قراءة ظاهرة')}</tbody></table></div>
      </section>
    `;
  }

  async function init(force) {
    injectStyles();
    mountShell();
    applyLegacyMode();
    const r = root();
    r.innerHTML = `<div class="egx54-shell"><div class="egx54-empty"><div><strong>جار تحميل EGX Pro Hub V5.4...</strong><span>قراءة الكون والكاش والشارت بدون Reset.</span></div></div></div>`;

    const [health, audit, universeIndex, cache, market, recommendations, pro, alerts, risk, session, history, configCsvText] = await Promise.all([
      loadJson(DATA_FILES.health),
      loadJson(DATA_FILES.audit),
      loadJson(DATA_FILES.universeIndex),
      loadJson(DATA_FILES.cache),
      loadJson(DATA_FILES.market),
      loadJson(DATA_FILES.recommendations),
      loadJson(DATA_FILES.pro),
      loadJson(DATA_FILES.alerts),
      loadJson(DATA_FILES.risk),
      loadJson(DATA_FILES.session),
      loadJson(DATA_FILES.history),
      loadText(DATA_FILES.configCsv)
    ]);
    state.data = { health, audit, universeIndex, cache, market, recommendations, pro, alerts, risk, session, history, configCsvText };
    state.rows = buildUniverse();
    state.loadedAt = new Date();
    if (!state.rows.find(r => r.symbol === state.selectedSymbol) && state.rows[0]) state.selectedSymbol = state.rows[0].symbol;
    renderShell();
  }

  function boot() {
    if (!document.body) return setTimeout(boot, 50);
    init(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.EGX_V54 = { init, state, version: VERSION };
})();
