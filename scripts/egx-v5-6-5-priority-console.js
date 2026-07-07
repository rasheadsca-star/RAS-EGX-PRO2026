(function () {
  'use strict';

  const ROOT_ID = 'egx-v56-hard-root';
  const STYLE_ID = 'egx-v565-priority-console-style';
  const VERSION = 'V5.6.5';

  const DATA = {
    health: 'data/source-health.json',
    audit: 'data/symbol-audit.json',
    universe: 'data/universe-index.json',
    market: 'data/market.json',
    cache: 'data/full-market-cache.json',
    recommendations: 'data/recommendations.json',
    pro: 'data/pro-report.json',
    tech: 'data/technical-50-report.json',
    history: 'data/history-50.json',
    sectors: 'data/sector-report.json',
    investors: 'data/investor-flow-report.json',
    news: 'data/smart-news-report.json',
    newsAlerts: 'data/alerts-v56-news.json',
    alerts: 'data/alerts.json',
    risk: 'data/risk-dashboard.json',
    session: 'data/session-report.json'
  };

  const state = {
    active: 'priority',
    q: '',
    recFilter: 'all',
    sectorFilter: 'all',
    page: 1,
    pageSize: 50,
    selected: '',
    chartSymbol: '',
    range: '50',
    docs: {},
    rows: [],
    sectors: [],
    news: [],
    alerts: []
  };

  const nav = [
    ['dashboard', '🏠', 'لوحة السوق'],
    ['priority', '🏆', 'ترتيب الأولويات'],
    ['opportunities', '🎯', 'قائمة الفرص'],
    ['entry', '📌', 'نقاط الدخول والأهداف'],
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

  const ar = 'ar-EG';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sym = (v) => String(v ?? '').trim().toUpperCase();
  const lower = (v) => String(v ?? '').trim().toLowerCase();
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const cleaned = String(v).replace(/,/g, '').replace(/%/g, '').replace(/[٫]/g, '.').replace(/[^0-9+\-.]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (v, d = 2) => {
    const n = num(v);
    return n === null ? '—' : n.toLocaleString(ar, { maximumFractionDigits: d });
  };
  const fmt0 = (v) => fmt(v, 0);
  const pct = (v) => {
    const n = num(v);
    return n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString(ar, { maximumFractionDigits: 2 })}%`;
  };
  const cls = (v) => {
    const n = num(v);
    if (n === null || n === 0) return 'neu';
    return n > 0 ? 'pos' : 'neg';
  };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const first = (obj, keys, fallback = '') => {
    if (!obj || typeof obj !== 'object') return fallback;
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return fallback;
  };
  const arr = (x) => {
    if (Array.isArray(x)) return x;
    if (!x || typeof x !== 'object') return [];
    for (const k of ['rows', 'data', 'items', 'symbols', 'cache', 'market', 'recommendations', 'opportunities', 'records', 'list', 'top', 'alerts', 'news', 'companies', 'sectors']) {
      if (Array.isArray(x[k])) return x[k];
    }
    for (const v of Object.values(x)) {
      if (Array.isArray(v) && (!v[0] || typeof v[0] === 'object')) return v;
    }
    return [];
  };

  async function fetchJson(path) {
    try {
      const res = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      return await res.json();
    } catch (e) {
      return { __error: String(e && e.message ? e.message : e) };
    }
  }

  function bySymbol(doc) {
    const m = new Map();
    const a = arr(doc);
    if (a.length) {
      a.forEach(x => {
        const code = sym(first(x, ['symbol', 'code', 'ticker', 'Symbol', 'securityCode', 'stock', 'id']));
        if (code) m.set(code, x);
      });
      return m;
    }
    if (doc && typeof doc === 'object') {
      Object.entries(doc).forEach(([k, v]) => {
        if (v && typeof v === 'object') m.set(sym(first(v, ['symbol', 'code', 'ticker'], k)), v);
      });
    }
    return m;
  }

  function normalizeBase(x, source) {
    if (!x || typeof x !== 'object') return null;
    const code = sym(first(x, ['symbol', 'code', 'ticker', 'Symbol', 'securityCode', 'stock', 'id']));
    if (!code || code.length > 16 || code.includes(' ')) return null;
    return {
      symbol: code,
      name: String(first(x, ['nameAr', 'name_ar', 'arabicName', 'name', 'nameEn', 'name_en', 'companyName', 'company', 'securityName', 'Name'], code)).trim() || code,
      sector: String(first(x, ['sector', 'sectorAr', 'sector_ar', 'sectorName', 'Sector', 'industry', 'industryName'], 'غير مصنف')).trim() || 'غير مصنف',
      price: num(first(x, ['last', 'price', 'lastPrice', 'close', 'Close', 'currentPrice', 'value'])),
      change: num(first(x, ['changePct', 'changePercent', 'pctChange', 'change_percentage', 'changeRate', 'change'])),
      volume: num(first(x, ['volume', 'Volume', 'tradedVolume', 'tradesVolume', 'qty', 'quantity'])),
      turnover: num(first(x, ['turnover', 'Turnover', 'valueTraded', 'tradedValue', 'liquidity', 'amount', 'valueTradedEGP'])),
      trades: num(first(x, ['trades', 'transactions', 'deals', 'noOfTrades'])),
      confidence: num(first(x, ['confidence', 'score', 'confidenceScore', 'trust', 'rating', 'technicalScore'])),
      raw: x,
      source
    };
  }

  function mergeRows() {
    const maps = {
      universe: bySymbol(state.docs.universe),
      market: bySymbol(state.docs.market),
      cache: bySymbol(state.docs.cache),
      recommendations: bySymbol(state.docs.recommendations),
      pro: bySymbol(state.docs.pro),
      tech: bySymbol(state.docs.tech)
    };

    const symbols = new Set();
    Object.values(maps).forEach(m => m.forEach((_, k) => symbols.add(k)));
    const audit = state.docs.audit || {};
    ['allSymbols', 'symbols', 'cachedSymbols', 'missingFromCache', 'waitingNextBatch', 'failedSymbols'].forEach(k => {
      if (Array.isArray(audit[k])) audit[k].forEach(v => symbols.add(sym(typeof v === 'string' ? v : first(v, ['symbol', 'code', 'ticker']))));
    });

    const rows = [];
    symbols.forEach(code => {
      if (!code) return;
      const sources = ['universe', 'cache', 'market', 'tech', 'pro', 'recommendations'];
      let merged = { symbol: code, name: code, sector: 'غير مصنف', raw: {} };
      sources.forEach(src => {
        const x = maps[src].get(code);
        const n = normalizeBase(x, src);
        if (!n) return;
        merged = {
          ...merged,
          ...Object.fromEntries(Object.entries(n).filter(([k, v]) => v !== null && v !== undefined && v !== '')),
          raw: { ...(merged.raw || {}), ...(x || {}) },
          source: src
        };
        if (n.name && n.name !== code) merged.name = n.name;
        if (n.sector && n.sector !== 'غير مصنف') merged.sector = n.sector;
      });

      const raw = merged.raw || {};
      const levels = calcLevels(merged, raw);
      const confidence = calcConfidence(merged, levels, raw);
      const rec = calcRecommendation(merged, levels, confidence, raw);
      const reasons = calcReasons(merged, levels, confidence, rec, raw);
      const priority = calcPriority(merged, levels, confidence, rec);
      const status = calcStatus(code, audit, merged);
      rows.push({ ...merged, levels, confidence, recommendation: rec, reasons, priority, status });
    });

    rows.sort((a, b) => (b.priority - a.priority) || (b.confidence - a.confidence) || String(a.symbol).localeCompare(String(b.symbol)));
    return rows;
  }

  function calcStatus(code, audit, r) {
    const inList = (k) => Array.isArray(audit[k]) && audit[k].some(x => sym(typeof x === 'string' ? x : first(x, ['symbol', 'code', 'ticker'])) === code);
    if (inList('failedSymbols')) return 'failed';
    if (inList('missingFromCache') || inList('waitingNextBatch')) return 'waiting';
    if (inList('cachedSymbols') || r.price !== null || r.turnover !== null || r.volume !== null) return 'cached';
    return 'universe';
  }

  function calcLevels(row, raw) {
    const price = num(row.price ?? first(raw, ['price', 'last', 'lastPrice', 'close', 'currentPrice']));
    const support1 = num(first(raw, ['support', 'support1', 's1', 'nearestSupport', 'stopSupport']));
    const support2 = num(first(raw, ['support2', 's2']));
    const resistance1 = num(first(raw, ['resistance', 'resistance1', 'r1', 'nearestResistance']));
    const resistance2 = num(first(raw, ['resistance2', 'r2']));
    const explicitEntry = num(first(raw, ['entry', 'entryPoint', 'buyZone', 'entryPrice']));
    const explicitEntryLow = num(first(raw, ['entryLow', 'buyZoneLow', 'entryFrom']));
    const explicitEntryHigh = num(first(raw, ['entryHigh', 'buyZoneHigh', 'entryTo']));
    const explicitStop = num(first(raw, ['stopLoss', 'stop', 'sl', 'riskStop', 'exitBelow']));
    const explicitTarget1 = num(first(raw, ['target', 'target1', 'tp1', 'firstTarget']));
    const explicitTarget2 = num(first(raw, ['target2', 'tp2', 'secondTarget']));
    const explicitTarget3 = num(first(raw, ['target3', 'tp3', 'thirdTarget']));

    let entryLow = explicitEntryLow;
    let entryHigh = explicitEntryHigh;
    let entryType = 'نطاق مراقبة';

    if ((entryLow === null || entryHigh === null) && explicitEntry !== null) {
      entryLow = explicitEntry * 0.99;
      entryHigh = explicitEntry * 1.01;
      entryType = 'حول نقطة دخول محددة';
    }
    if ((entryLow === null || entryHigh === null) && price !== null && support1 !== null) {
      if (price >= support1 && price <= support1 * 1.08) {
        entryLow = support1 * 1.005;
        entryHigh = Math.min(price * 1.008, support1 * 1.04);
        entryType = 'قرب دعم';
      } else if (price > support1 * 1.08) {
        entryLow = price * 0.985;
        entryHigh = price * 1.005;
        entryType = 'انتظار تهدئة';
      } else {
        entryLow = price * 0.995;
        entryHigh = support1 * 1.015;
        entryType = 'استرداد دعم';
      }
    }
    if ((entryLow === null || entryHigh === null) && price !== null) {
      entryLow = price * 0.99;
      entryHigh = price * 1.01;
      entryType = 'حول السعر الحالي';
    }

    const entryMid = (entryLow !== null && entryHigh !== null) ? (entryLow + entryHigh) / 2 : null;
    let stop = explicitStop;
    if (stop === null && support1 !== null) stop = support1 * 0.985;
    if (stop === null && entryLow !== null) stop = entryLow * 0.97;

    let target1 = explicitTarget1;
    if (target1 === null && resistance1 !== null) target1 = resistance1 * 0.995;
    if (target1 === null && entryMid !== null) target1 = entryMid * 1.055;

    let target2 = explicitTarget2;
    if (target2 === null && resistance2 !== null) target2 = resistance2 * 0.995;
    if (target2 === null && entryMid !== null && target1 !== null) target2 = entryMid + (target1 - entryMid) * 1.55;

    let target3 = explicitTarget3;
    if (target3 === null && entryMid !== null && target1 !== null) target3 = entryMid + (target1 - entryMid) * 2.25;

    const breakout = resistance1 !== null ? resistance1 * 1.01 : null;
    const risk = (entryMid !== null && stop !== null) ? entryMid - stop : null;
    const reward = (entryMid !== null && target1 !== null) ? target1 - entryMid : null;
    const rr = (risk !== null && reward !== null && risk > 0) ? reward / risk : null;
    const distanceToSupport = (price !== null && support1 !== null && price !== 0) ? ((price - support1) / price) * 100 : null;
    const distanceToResistance = (price !== null && resistance1 !== null && price !== 0) ? ((resistance1 - price) / price) * 100 : null;

    return { price, support1, support2, resistance1, resistance2, entryLow, entryHigh, entryMid, entryType, breakout, target1, target2, target3, stop, rr, distanceToSupport, distanceToResistance };
  }

  function calcConfidence(row, levels, raw) {
    const explicit = num(first(raw, ['confidence', 'score', 'confidenceScore', 'trust', 'rating', 'technicalScore']));
    if (explicit !== null) return Math.round(clamp(explicit, 0, 100));
    let score = 48;
    const change = num(row.change);
    const turnover = num(row.turnover);
    const volume = num(row.volume);
    if (turnover !== null && turnover > 0) score += clamp(Math.log10(turnover + 1) * 5, 0, 28);
    else if (volume !== null && volume > 0) score += clamp(Math.log10(volume + 1) * 4, 0, 18);
    if (change !== null && change > 0) score += clamp(change * 1.2, 0, 10);
    if (change !== null && change < -3) score -= 7;
    if (levels.rr !== null && levels.rr >= 1.5) score += 10;
    else if (levels.rr !== null && levels.rr >= 1) score += 5;
    else if (levels.rr !== null && levels.rr < 0.8) score -= 8;
    if (levels.distanceToSupport !== null && levels.distanceToSupport >= 0 && levels.distanceToSupport <= 6) score += 7;
    if (levels.distanceToResistance !== null && levels.distanceToResistance >= 0 && levels.distanceToResistance <= 2) score -= 5;
    return Math.round(clamp(score, 0, 96));
  }

  function calcRecommendation(row, levels, confidence, raw) {
    const text = lower(first(raw, ['recommendation', 'action', 'signal', 'status', 'decision', 'watchStatus']));
    if (/exit|sell|خروج|بيع/.test(text)) return { label: 'خروج', key: 'exit', cls: 'exit' };
    if (/reduce|trim|تخفيف/.test(text)) return { label: 'تخفيف', key: 'reduce', cls: 'reduce' };
    if (/wait|hold|انتظار/.test(text)) return { label: 'انتظار تأكيد', key: 'wait', cls: 'wait' };
    if (/strong|شراء|buy|accumulate|مراقبة قوية/.test(text)) return { label: 'مراقبة لشراء', key: 'watch-buy', cls: 'buy' };

    const ch = num(row.change);
    if (levels.rr !== null && levels.rr < 0.75) return { label: 'انتظار', key: 'wait', cls: 'wait' };
    if (confidence >= 76 && (levels.rr === null || levels.rr >= 1.1)) return { label: 'مراقبة لشراء', key: 'watch-buy', cls: 'buy' };
    if (confidence >= 62) return { label: 'مراقبة', key: 'watch', cls: 'watch' };
    if (ch !== null && ch < -5 && confidence < 50) return { label: 'تخفيف', key: 'reduce', cls: 'reduce' };
    return { label: 'انتظار تأكيد', key: 'wait', cls: 'wait' };
  }

  function calcReasons(row, levels, confidence, rec, raw) {
    const explicit = first(raw, ['reason', 'reasons', 'explanation', 'why', 'note', 'commentary', 'summary'], '');
    if (Array.isArray(explicit) && explicit.length) return explicit.map(String).slice(0, 5);
    if (explicit && typeof explicit === 'string' && explicit.length > 8) return [explicit];
    const reasons = [];
    const turnover = num(row.turnover);
    const volume = num(row.volume);
    const change = num(row.change);
    if (turnover !== null && turnover > 0) reasons.push(`سيولة متداولة ${fmt0(turnover)} جنيه تقريبًا تدعم أولوية المتابعة.`);
    else if (volume !== null && volume > 0) reasons.push(`حجم تداول ${fmt0(volume)} سهم، ويحتاج تأكيد سيولة بالقيمة.`);
    if (change !== null && change > 0) reasons.push(`الأداء اليومي إيجابي بنسبة ${pct(change)}.`);
    if (change !== null && change < 0) reasons.push(`الأداء اليومي سلبي بنسبة ${pct(change)} ويحتاج تأكيد ارتداد.`);
    if (levels.support1 !== null && levels.distanceToSupport !== null && levels.distanceToSupport >= 0 && levels.distanceToSupport <= 6) reasons.push(`السعر قريب من دعم ${fmt(levels.support1)}، ما يجعل المخاطرة قابلة للقياس.`);
    if (levels.resistance1 !== null) reasons.push(`أقرب مقاومة/منطقة هدف عند ${fmt(levels.resistance1)}.`);
    if (levels.rr !== null) reasons.push(`نسبة العائد إلى المخاطرة حوالي ${levels.rr.toFixed(2)}x.`);
    if (confidence >= 70) reasons.push(`نسبة الثقة ${confidence}% وهي أعلى من متوسط فرص المراقبة.`);
    if (!reasons.length) reasons.push('البيانات الحالية محدودة؛ يفضل الانتظار لاكتمال السيولة والدعم/المقاومة.' );
    return reasons.slice(0, 5);
  }

  function calcPriority(row, levels, confidence, rec) {
    let p = confidence;
    const turnover = num(row.turnover);
    const volume = num(row.volume);
    const change = num(row.change);
    if (turnover !== null && turnover > 0) p += clamp(Math.log10(turnover + 1) * 4, 0, 35);
    else if (volume !== null && volume > 0) p += clamp(Math.log10(volume + 1) * 2, 0, 15);
    if (change !== null) p += clamp(change * 0.8, -12, 12);
    if (levels.rr !== null) p += clamp((levels.rr - 1) * 10, -14, 18);
    if (levels.distanceToSupport !== null && levels.distanceToSupport >= 0 && levels.distanceToSupport <= 6) p += 8;
    if (rec.key === 'watch-buy') p += 10;
    if (rec.key === 'exit') p -= 25;
    if (rec.key === 'reduce') p -= 12;
    return Math.round(clamp(p, 0, 150));
  }

  function buildSectors() {
    let sectors = arr(state.docs.sectors).map(x => ({
      sector: String(first(x, ['sector', 'name', 'sectorName', 'label'], 'غير مصنف')),
      turnover: num(first(x, ['turnover', 'liquidity', 'value', 'totalTurnover', 'marketValue'])),
      volume: num(first(x, ['volume', 'totalVolume'])),
      count: num(first(x, ['stocks', 'symbols', 'count', 'symbolCount'])),
      allocation: num(first(x, ['allocation', 'weight', 'suggestedWeight', 'portfolioWeight']))
    })).filter(x => x.sector);
    if (!sectors.length) {
      const m = new Map();
      state.rows.forEach(r => {
        const k = r.sector || 'غير مصنف';
        if (!m.has(k)) m.set(k, { sector: k, turnover: 0, volume: 0, count: 0, allocation: 0 });
        const s = m.get(k);
        s.turnover += r.turnover || 0;
        s.volume += r.volume || 0;
        s.count += 1;
      });
      sectors = [...m.values()];
      const total = sectors.reduce((a, b) => a + (b.turnover || 0), 0) || 1;
      sectors.forEach(s => s.allocation = (s.turnover || 0) / total * 100);
    }
    return sectors.sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
  }

  function historyFor(code) {
    const h = state.docs.history || {};
    let a = [];
    if (Array.isArray(h)) a = h.filter(x => sym(first(x, ['symbol', 'code', 'ticker'])) === code);
    else if (h && typeof h === 'object') a = h[code] || h[code.toLowerCase()] || arr(h).filter(x => sym(first(x, ['symbol', 'code', 'ticker'])) === code);
    a = (a || []).map((p, i) => ({
      date: first(p, ['date', 'session', 'day', 't'], String(i + 1)),
      close: num(first(p, ['close', 'price', 'last', 'value'])),
      volume: num(first(p, ['volume', 'tradedVolume', 'qty'])) || 0
    })).filter(p => p.close !== null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (state.range === 'all') return a;
    return a.slice(-Number(state.range || 50));
  }

  async function load() {
    const pairs = await Promise.all(Object.entries(DATA).map(async ([k, p]) => [k, await fetchJson(p)]));
    state.docs = Object.fromEntries(pairs);
    state.rows = mergeRows();
    state.sectors = buildSectors();
    state.news = arr(state.docs.news);
    state.alerts = [...arr(state.docs.newsAlerts), ...arr(state.docs.alerts), ...arr(state.docs.risk)];
    state.selected = state.rows[0]?.symbol || '';
    state.chartSymbol = state.selected;
  }

  function injectCss() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#f3f6fa!important;direction:rtl!important}
      body>*:not(#${ROOT_ID}):not(script):not(style):not(link):not(meta):not(title){display:none!important;visibility:hidden!important;pointer-events:none!important}
      #${ROOT_ID},#${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID}{position:fixed;inset:0;z-index:2147483600;display:flex;background:#f3f6fa;color:#111827;font-family:Cairo,Tahoma,Arial,sans-serif;direction:rtl;overflow:hidden}
      .egx-side{width:300px;flex:0 0 300px;background:#07111f;color:#eaf2ff;padding:18px 12px;overflow:auto;border-left:1px solid rgba(255,255,255,.08);box-shadow:-18px 0 40px rgba(15,23,42,.18)}
      .egx-brand{display:flex;gap:12px;align-items:center;padding:8px 8px 18px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:12px}.egx-logo{width:50px;height:50px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(135deg,#2dd4bf,#facc15);color:#06101d;font-weight:1000;font-size:22px}.egx-brand h1{font-size:20px;line-height:1.08;margin:0}.egx-brand p{margin:6px 0 0;color:#9fb0c8;font-size:12px}
      .egx-nav{display:flex;flex-direction:column;gap:6px}.egx-nav button{border:0;background:transparent;color:#dae8fb;border-radius:14px;padding:12px 13px;display:flex;align-items:center;gap:10px;text-align:right;font-size:14px;font-weight:800;cursor:pointer;transition:.15s}.egx-nav button:hover{background:rgba(255,255,255,.08)}.egx-nav button.active{background:#ffffff;color:#08111f;box-shadow:0 10px 26px rgba(0,0,0,.18)}.egx-nav .ico{width:24px;text-align:center}
      .egx-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}.egx-top{min-height:72px;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);border-bottom:1px solid #dce5ef;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 22px}.egx-title h2{margin:0;color:#0f172a;font-size:22px}.egx-title p{margin:5px 0 0;color:#64748b;font-size:13px}.egx-badges{display:flex;gap:8px;flex-wrap:wrap}.egx-pill{display:inline-flex;gap:6px;align-items:center;border:1px solid #d7e2ec;background:#fff;border-radius:999px;padding:8px 11px;font-weight:900;color:#334155;font-size:12px}.egx-content{padding:18px;overflow:auto;min-height:0}
      .grid{display:grid;gap:14px}.kpis{grid-template-columns:repeat(4,minmax(160px,1fr))}.two{grid-template-columns:1.25fr .75fr}.three{grid-template-columns:repeat(3,1fr)}.four{grid-template-columns:repeat(4,1fr)}@media(max-width:1100px){.egx-side{width:250px;flex-basis:250px}.kpis,.two,.three,.four{grid-template-columns:1fr}.egx-top{align-items:flex-start;flex-direction:column}}
      .card{background:#fff;border:1px solid #dbe5ef;border-radius:22px;box-shadow:0 16px 44px rgba(15,23,42,.07);overflow:hidden}.pad{padding:18px}.card h3{margin:0 0 12px;color:#0f172a;font-size:18px}.muted{color:#64748b}.mini{display:grid;gap:8px}.item{display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid #eef2f6;padding:10px 0}.item:last-child{border-bottom:0}.kpi{padding:17px}.kpi span{display:block;color:#64748b;font-size:12px;font-weight:800}.kpi b{display:block;margin-top:6px;font-size:24px;color:#0f172a}.kpi small{color:#94a3b8}.pos{color:#0f9f6e!important}.neg{color:#dc2626!important}.neu{color:#64748b!important}.mono{white-space:pre-wrap;background:#0f172a;color:#dbeafe;border-radius:16px;padding:14px;overflow:auto;max-height:470px;direction:ltr;text-align:left}
      .tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.input,.select{height:42px;border:1px solid #cbd8e5;background:#fff;border-radius:14px;padding:0 13px;color:#0f172a;font-weight:800;min-width:170px}.input{min-width:270px}.btn{border:0;border-radius:13px;padding:10px 13px;font-weight:900;cursor:pointer;background:#0b63ce;color:#fff}.btn.light{background:#eef5ff;color:#0b63ce;border:1px solid #cfe1f8}.btn.ghost{background:#f8fafc;color:#334155;border:1px solid #dbe5ef}
      .tablewrap{overflow:auto;border:1px solid #dce6f0;border-radius:18px;background:#fff}.tablewrap table{width:100%;border-collapse:separate;border-spacing:0;min-width:1300px}.tablewrap th{position:sticky;top:0;z-index:1;background:#f8fbfe;color:#475569;text-align:right;font-size:12px;padding:12px;border-bottom:1px solid #dce6f0;white-space:nowrap}.tablewrap td{padding:12px;border-bottom:1px solid #edf2f7;vertical-align:top;color:#111827}.tablewrap tr:hover td{background:#f9fcff}.symbol{font-family:Arial,Tahoma,sans-serif;font-weight:1000;color:#0b63ce;letter-spacing:.3px}.num{font-family:Arial,Tahoma,sans-serif;font-weight:900;direction:ltr;text-align:right}.reason-cell{min-width:320px;max-width:460px;line-height:1.6}.target-cell{line-height:1.65;min-width:170px}.small{font-size:12px;color:#64748b}
      .badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:1000;border:1px solid transparent;white-space:nowrap}.badge.buy{background:#e7f9ef;color:#067647;border-color:#b9ebcf}.badge.watch{background:#eaf2ff;color:#0b63ce;border-color:#cfe1f8}.badge.wait{background:#fff7df;color:#9a6700;border-color:#f4dfa1}.badge.reduce{background:#fff1e8;color:#b45309;border-color:#ffd0b1}.badge.exit{background:#ffebed;color:#b91c1c;border-color:#ffc8cf}.badge.failed{background:#fee2e2;color:#991b1b}.badge.waiting{background:#fff7ed;color:#9a3412}.badge.cached{background:#ecfdf5;color:#047857}.badge.universe{background:#eef2ff;color:#3730a3}
      .priority-grid{display:grid;grid-template-columns:repeat(3,minmax(250px,1fr));gap:14px;margin-bottom:14px}@media(max-width:1300px){.priority-grid{grid-template-columns:1fr}}
      .opp-card{padding:16px;border:1px solid #dce6f0;border-radius:20px;background:linear-gradient(180deg,#fff,#f9fcff);box-shadow:0 12px 30px rgba(15,23,42,.06)}.opp-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.opp-symbol{font-size:24px;font-weight:1000;color:#0b63ce}.opp-name{font-size:13px;color:#64748b;margin-top:4px}.opp-score{font-size:28px;font-weight:1000;color:#0f172a}.opp-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.fact{border:1px solid #e2e8f0;border-radius:14px;padding:10px;background:#fff}.fact small{display:block;color:#64748b;font-size:11px}.fact b{display:block;margin-top:5px}.reason-list{margin:10px 0 0;padding:0;list-style:none}.reason-list li{padding:7px 0;border-top:1px dashed #e2e8f0;color:#334155;line-height:1.55}.drawer{border:1px solid #cfe1f8;background:#f8fbff;border-radius:22px;padding:16px;margin:0 0 14px}.drawer h3{margin-top:0}.drawer-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}@media(max-width:1100px){.drawer-grid{grid-template-columns:1fr}}
      .bar{height:10px;background:#eef2f7;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#0b63ce,#2dd4bf);border-radius:99px}.alert{border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:16px;padding:12px;margin:8px 0}.alert.danger{border-color:#fecaca;background:#fff1f2;color:#991b1b}.alert.good{border-color:#bbf7d0;background:#f0fdf4;color:#166534}.chart{width:100%;height:430px;border:1px solid #dce6f0;border-radius:18px;background:#fff;display:block}.empty{padding:28px;border:1px dashed #cbd5e1;border-radius:18px;background:#f8fafc;color:#64748b;text-align:center}.disclaimer{font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;margin-top:14px;padding-top:10px}
    `;
    document.head.appendChild(style);
  }

  function kpi(title, value, hint, cname = '') {
    return `<div class="card kpi"><span>${esc(title)}</span><b class="${cname}">${esc(value)}</b><small>${esc(hint || '')}</small></div>`;
  }

  function statusBadge(s) {
    const key = String(s || '').toLowerCase();
    const label = key === 'cached' ? 'داخل الكاش' : key === 'waiting' ? 'ينتظر Batch' : key === 'failed' ? 'فشل' : 'ضمن الكون';
    return `<span class="badge ${esc(key || 'universe')}">${label}</span>`;
  }

  function filteredRows(base = state.rows) {
    const q = lower(state.q);
    return base.filter(r => {
      const text = lower([r.symbol, r.name, r.sector, r.recommendation?.label, r.reasons?.join(' ')].join(' '));
      const okQ = !q || text.includes(q);
      const okRec = state.recFilter === 'all' || r.recommendation?.key === state.recFilter || r.recommendation?.cls === state.recFilter;
      const okSec = state.sectorFilter === 'all' || r.sector === state.sectorFilter;
      return okQ && okRec && okSec;
    });
  }

  function opportunityRows() {
    return state.rows.filter(r => r.status === 'cached' && r.price !== null && !['exit'].includes(r.recommendation.key)).sort((a,b)=>b.priority-a.priority);
  }

  function topPriorityRows() {
    return opportunityRows().slice(0, 12);
  }

  function controls() {
    const sectors = ['all', ...new Set(state.rows.map(r => r.sector || 'غير مصنف'))].sort();
    const options = [
      ['all', 'كل التوصيات'],
      ['watch-buy', 'مراقبة لشراء'],
      ['watch', 'مراقبة'],
      ['wait', 'انتظار'],
      ['reduce', 'تخفيف'],
      ['exit', 'خروج']
    ];
    return `<div class="tools"><input id="egx-q" class="input" placeholder="بحث بالرمز أو الاسم أو سبب التوصية..." value="${esc(state.q)}"><select id="egx-rec-filter" class="select">${options.map(([v,t]) => `<option value="${v}" ${state.recFilter===v?'selected':''}>${t}</option>`).join('')}</select><select id="egx-sector-filter" class="select">${sectors.map(s => `<option value="${esc(s)}" ${state.sectorFilter===s?'selected':''}>${s === 'all' ? 'كل القطاعات' : esc(s)}</option>`).join('')}</select><select id="egx-page-size" class="select">${[25,50,75,100,250].map(n => `<option value="${n}" ${state.pageSize===n?'selected':''}>${n} / صفحة</option>`).join('')}</select></div>`;
  }

  function oppCard(r, i) {
    const l = r.levels;
    return `<article class="opp-card"><div class="opp-head"><div><div class="opp-symbol">${i + 1}. ${esc(r.symbol)}</div><div class="opp-name">${esc(r.name)} · ${esc(r.sector)}</div></div><div style="text-align:left"><div class="opp-score">${fmt0(r.priority)}</div><span class="badge ${esc(r.recommendation.cls)}">${esc(r.recommendation.label)}</span></div></div><div class="opp-facts"><div class="fact"><small>آخر سعر</small><b>${fmt(l.price)}</b></div><div class="fact"><small>السيولة</small><b>${fmt0(r.turnover)}</b></div><div class="fact"><small>الثقة</small><b>${fmt0(r.confidence)}%</b></div></div><div class="opp-facts"><div class="fact"><small>دخول</small><b>${fmt(l.entryLow)} - ${fmt(l.entryHigh)}</b></div><div class="fact"><small>هدف 1</small><b>${fmt(l.target1)}</b></div><div class="fact"><small>وقف</small><b>${fmt(l.stop)}</b></div></div><ul class="reason-list">${r.reasons.slice(0,3).map(x => `<li>${esc(x)}</li>`).join('')}</ul><div style="margin-top:12px"><button class="btn light" data-select="${esc(r.symbol)}">تفاصيل السهم</button><button class="btn ghost" data-chart="${esc(r.symbol)}">الشارت</button></div></article>`;
  }

  function detailDrawer() {
    const r = state.rows.find(x => x.symbol === state.selected) || state.rows[0];
    if (!r) return '';
    const l = r.levels;
    return `<div class="drawer"><div class="drawer-grid"><div><h3>${esc(r.symbol)} — ${esc(r.name)}</h3><p class="muted">${esc(r.sector)} · ${r.status === 'cached' ? 'داخل الكاش' : 'ضمن المتابعة'}</p><div class="grid four">${kpi('التوصية', r.recommendation.label, 'تحليل ومراقبة', r.recommendation.cls === 'exit' ? 'neg' : r.recommendation.cls === 'buy' ? 'pos' : '')}${kpi('الثقة', fmt0(r.confidence) + '%', 'Confidence')}${kpi('أولوية المتابعة', fmt0(r.priority), 'Priority')}${kpi('R/R', l.rr === null ? '—' : l.rr.toFixed(2) + 'x', 'عائد/مخاطرة')}</div><h3 style="margin-top:16px">سبب التوصية</h3><ul class="reason-list">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div><div><h3>مستويات السهم</h3><div class="mini"><div class="item"><span>آخر سعر</span><b class="num">${fmt(l.price)}</b></div><div class="item"><span>الدعم 1 / الدعم 2</span><b class="num">${fmt(l.support1)} / ${fmt(l.support2)}</b></div><div class="item"><span>المقاومة 1 / المقاومة 2</span><b class="num">${fmt(l.resistance1)} / ${fmt(l.resistance2)}</b></div><div class="item"><span>نطاق الدخول</span><b class="num">${fmt(l.entryLow)} - ${fmt(l.entryHigh)}</b></div><div class="item"><span>سيناريو الاختراق</span><b class="num">${fmt(l.breakout)}</b></div><div class="item"><span>الأهداف</span><b class="num">${fmt(l.target1)} / ${fmt(l.target2)} / ${fmt(l.target3)}</b></div><div class="item"><span>وقف الخسارة</span><b class="num">${fmt(l.stop)}</b></div><div class="item"><span>السيولة / الحجم</span><b class="num">${fmt0(r.turnover)} / ${fmt0(r.volume)}</b></div></div></div></div><div class="disclaimer">هذه قراءة تحليلية للمتابعة وإدارة المخاطر وليست أمر شراء أو بيع.</div></div>`;
  }

  function priorityTable(rows) {
    return `<div class="tablewrap"><table><thead><tr><th>الأولوية</th><th>السهم</th><th>الشركة / القطاع</th><th>التوصية</th><th>الثقة</th><th>آخر سعر</th><th>التغير</th><th>السيولة</th><th>حجم التداول</th><th>الدعم</th><th>المقاومة</th><th>نقاط الدخول</th><th>الأهداف</th><th>وقف الخسارة</th><th>سبب التوصية</th><th>تفاصيل</th></tr></thead><tbody>${rows.map(r => {
      const l = r.levels;
      return `<tr><td class="num"><b>${fmt0(r.priority)}</b></td><td><span class="symbol">${esc(r.symbol)}</span></td><td><b>${esc(r.name)}</b><br><span class="small">${esc(r.sector)}</span></td><td><span class="badge ${esc(r.recommendation.cls)}">${esc(r.recommendation.label)}</span></td><td class="num">${fmt0(r.confidence)}%</td><td class="num">${fmt(l.price)}</td><td class="num ${cls(r.change)}">${pct(r.change)}</td><td class="num">${fmt0(r.turnover)}</td><td class="num">${fmt0(r.volume)}</td><td class="num">${fmt(l.support1)}</td><td class="num">${fmt(l.resistance1)}</td><td class="target-cell">${fmt(l.entryLow)} - ${fmt(l.entryHigh)}<br><span class="small">${esc(l.entryType)}</span></td><td class="target-cell">1) ${fmt(l.target1)}<br>2) ${fmt(l.target2)}<br>3) ${fmt(l.target3)}</td><td class="num neg">${fmt(l.stop)}</td><td class="reason-cell">${r.reasons.map(x => `• ${esc(x)}`).join('<br>')}</td><td><button class="btn light" data-select="${esc(r.symbol)}">فتح</button></td></tr>`;
    }).join('') || `<tr><td colspan="16"><div class="empty">لا توجد نتائج</div></td></tr>`}</tbody></table></div>`;
  }

  function pagedRows(rows) {
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = clamp(state.page, 1, pages);
    const slice = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const pager = `<div class="tools" style="margin-top:12px"><button id="egx-prev" class="btn light">السابق</button><span class="egx-pill">صفحة ${state.page} من ${pages}</span><button id="egx-next" class="btn light">التالي</button><span class="muted">${fmt0(rows.length)} نتيجة</span></div>`;
    return { slice, pager };
  }

  function dashboard() {
    const cached = state.rows.filter(r => r.status === 'cached').length;
    const waiting = state.rows.filter(r => r.status === 'waiting').length;
    const top = topPriorityRows();
    const topSector = state.sectors[0]?.sector || '—';
    return `<div class="grid kpis">${kpi('أسهم الكون', fmt0(state.rows.length), 'Universe')}${kpi('داخل الكاش', fmt0(cached), 'جاهز للتحليل', 'pos')}${kpi('ينتظر Batch', fmt0(waiting), 'يكتمل مع تشغيل Workflow')}${kpi('أقوى قطاع', topSector, 'حسب السيولة')}</div><div style="height:14px"></div>${detailDrawer()}<div class="grid two"><div class="card pad"><h3>أفضل أولويات المتابعة</h3><div class="priority-grid">${top.slice(0,6).map(oppCard).join('') || '<div class="empty">لا توجد فرص كافية</div>'}</div></div><div class="card pad"><h3>توزيع السيولة بين القطاعات</h3>${sectorBars(10)}</div></div>`;
  }

  function priority() {
    const rows = filteredRows(opportunityRows());
    const { slice, pager } = pagedRows(rows);
    return `<div class="card pad"><h3>نافذة ترتيب الأولويات وتفاصيل كل سهم</h3><p class="muted">الترتيب يجمع السعر، السيولة، التداول، الدعم والمقاومة، نقاط الدخول، الأهداف، وقف الخسارة، سبب التوصية، ونسبة الثقة في مكان واحد.</p>${controls()}</div>${detailDrawer()}<div class="priority-grid">${rows.slice(0,3).map(oppCard).join('')}</div><div class="card pad">${priorityTable(slice)}${pager}</div>`;
  }

  function opportunities() {
    const rows = filteredRows(opportunityRows().filter(r => ['watch-buy', 'watch'].includes(r.recommendation.key)));
    const { slice, pager } = pagedRows(rows);
    return `<div class="card pad"><h3>قائمة الفرص</h3>${controls()}${priorityTable(slice)}${pager}<div class="disclaimer">الفرص للمتابعة والتحليل فقط وليست أوامر تداول.</div></div>`;
  }

  function entry() {
    const rows = filteredRows(opportunityRows());
    const { slice, pager } = pagedRows(rows);
    return `<div class="card pad"><h3>نقاط الدخول والأهداف ووقف الخسارة</h3>${controls()}<div class="tablewrap"><table><thead><tr><th>السهم</th><th>التوصية</th><th>الثقة</th><th>السعر</th><th>نطاق الدخول</th><th>اختراق</th><th>هدف 1</th><th>هدف 2</th><th>هدف 3</th><th>وقف الخسارة</th><th>R/R</th><th>سبب مختصر</th></tr></thead><tbody>${slice.map(r => { const l=r.levels; return `<tr><td><span class="symbol">${esc(r.symbol)}</span><br><span class="small">${esc(r.name)}</span></td><td><span class="badge ${esc(r.recommendation.cls)}">${esc(r.recommendation.label)}</span></td><td class="num">${fmt0(r.confidence)}%</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(l.entryLow)} - ${fmt(l.entryHigh)}</td><td class="num">${fmt(l.breakout)}</td><td class="num">${fmt(l.target1)}</td><td class="num">${fmt(l.target2)}</td><td class="num">${fmt(l.target3)}</td><td class="num neg">${fmt(l.stop)}</td><td class="num">${l.rr === null ? '—' : l.rr.toFixed(2) + 'x'}</td><td class="reason-cell">${esc(r.reasons[0] || '')}</td></tr>`; }).join('')}</tbody></table></div>${pager}</div>`;
  }

  function market() {
    const rows = filteredRows(state.rows);
    const { slice, pager } = pagedRows(rows);
    return `<div class="card pad"><h3>كل السوق</h3>${controls()}<div class="tablewrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>القطاع</th><th>السعر</th><th>التغير</th><th>الحجم</th><th>السيولة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${slice.map(r => `<tr><td><span class="symbol">${esc(r.symbol)}</span></td><td>${esc(r.name)}</td><td>${esc(r.sector)}</td><td class="num">${fmt(r.price)}</td><td class="num ${cls(r.change)}">${pct(r.change)}</td><td class="num">${fmt0(r.volume)}</td><td class="num">${fmt0(r.turnover)}</td><td>${statusBadge(r.status)}</td><td><button class="btn light" data-select="${esc(r.symbol)}">تفاصيل</button></td></tr>`).join('')}</tbody></table></div>${pager}</div>`;
  }

  function portfolio() {
    const sectorAlloc = state.sectors.slice(0, 12);
    return `<div class="grid two"><div class="card pad"><h3>إدارة المحفظة</h3><div class="alert good">التوزيع المقترح يعتمد على سيولة القطاعات وقوة فرص المتابعة، ويحتاج لاحقًا إدخال محفظتك الفعلية للمقارنة.</div><div class="mini">${sectorAlloc.map(s => `<div class="item"><span>${esc(s.sector)}</span><b>${fmt(s.allocation,1)}%</b></div>`).join('') || '<div class="empty">لا توجد قطاعات</div>'}</div></div><div class="card pad"><h3>قطاعات تستحق المتابعة</h3>${sectorBars(12)}</div></div>`;
  }

  function sectors() {
    return `<div class="grid two"><div class="card pad"><h3>ترتيب القطاعات</h3><div class="tablewrap"><table><thead><tr><th>القطاع</th><th>عدد الأسهم</th><th>السيولة</th><th>الحجم</th><th>توزيع مقترح</th></tr></thead><tbody>${state.sectors.map(s => `<tr><td><b>${esc(s.sector)}</b></td><td class="num">${fmt0(s.count)}</td><td class="num">${fmt0(s.turnover)}</td><td class="num">${fmt0(s.volume)}</td><td class="num">${fmt(s.allocation,1)}%</td></tr>`).join('') || `<tr><td colspan="5"><div class="empty">لا توجد بيانات قطاعات</div></td></tr>`}</tbody></table></div></div><div class="card pad"><h3>توزيع السيولة</h3>${sectorBars(16)}</div></div>`;
  }

  function sectorBars(n) {
    const total = state.sectors.reduce((a,b)=>a+(b.turnover||0),0) || 1;
    return `<div class="mini">${state.sectors.slice(0,n).map(s => { const p = (s.turnover || 0) / total * 100; return `<div class="item"><span>${esc(s.sector)}</span><b>${fmt(p,1)}%</b></div><div class="bar"><i style="width:${clamp(p,1,100)}%"></i></div>`; }).join('') || '<div class="empty">لا توجد بيانات</div>'}</div>`;
  }

  function investors() {
    const rows = arr(state.docs.investors);
    const st = first(state.docs.investors, ['status','state','sourceStatus'], rows.length ? 'ready' : 'needs_source');
    return `<div class="grid two"><div class="card pad"><h3>نوع المتعاملين</h3>${String(st).includes('needs') ? '<div class="alert">البيانات تحتاج مصدر يومي أو قراءة آلية مستقرة من EGX.</div>' : ''}<div class="tablewrap"><table><thead><tr><th>الفئة</th><th>شراء</th><th>بيع</th><th>صافي</th><th>التأثير</th></tr></thead><tbody>${rows.map(x => { const buy=num(first(x,['buy','buyValue','purchases'])); const sell=num(first(x,['sell','sellValue','sales'])); const net=num(first(x,['net','netValue'],(buy||0)-(sell||0))); return `<tr><td><b>${esc(first(x,['category','type','name','label'],'—'))}</b></td><td class="num">${fmt0(buy)}</td><td class="num">${fmt0(sell)}</td><td class="num ${cls(net)}">${fmt0(net)}</td><td>${net>0?'دعم':net<0?'ضغط':'محايد'}</td></tr>`; }).join('') || `<tr><td colspan="5"><div class="empty">لا توجد بيانات نوع متعاملين</div></td></tr>`}</tbody></table></div></div><div class="card pad"><h3>قراءة التأثير</h3><div class="mini"><div class="item"><span>إشارة السوق</span><b>${esc(first(state.docs.investors,['signal','marketSignal','summary'],'تظهر فور توفر البيانات'))}</b></div><div class="item"><span>عدد الفئات</span><b>${fmt0(rows.length)}</b></div></div></div></div>`;
  }

  function chart() {
    const symbols = state.rows.map(r=>r.symbol);
    const r = state.rows.find(x => x.symbol === state.chartSymbol) || state.rows[0] || {};
    const pts = historyFor(r.symbol || state.chartSymbol);
    return `<div class="card pad"><div class="tools"><select id="egx-chart-symbol" class="select">${symbols.map(s => `<option value="${esc(s)}" ${state.chartSymbol===s?'selected':''}>${esc(s)} — ${esc((state.rows.find(r=>r.symbol===s)||{}).name||s)}</option>`).join('')}</select><select id="egx-range" class="select">${[['20','آخر 20 جلسة'],['50','آخر 50 جلسة'],['all','كل المتاح']].map(([v,t])=>`<option value="${v}" ${state.range===v?'selected':''}>${t}</option>`).join('')}</select><span class="egx-pill">${esc(r.name || '')}</span><span class="egx-pill ${cls(r.change)}">${pct(r.change)}</span></div>${pts.length >= 2 ? svg(pts, r.symbol || state.chartSymbol) : '<div class="empty">لا توجد نقاط تاريخية كافية لهذا السهم حتى الآن.</div>'}</div>${detailDrawer()}`;
  }

  function svg(points, code) {
    const w=1000,h=430,L=58,R=24,T=34,CH=280,VT=335,VH=62;
    const prices=points.map(x=>x.close), vols=points.map(x=>x.volume||0), mn=Math.min(...prices), mx=Math.max(...prices), vm=Math.max(...vols,1);
    const x=i=>L+(i/Math.max(1,points.length-1))*(w-L-R);
    const y=v=>T+(mx===mn?.5:(mx-v)/(mx-mn))*CH;
    const line=points.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(2)} ${y(d.close).toFixed(2)}`).join(' ');
    const area=`${line} L ${x(points.length-1)} ${T+CH} L ${x(0)} ${T+CH} Z`;
    const grid=[0,.25,.5,.75,1].map(t=>{const yy=T+t*CH,val=mx-t*(mx-mn);return `<line x1="${L}" y1="${yy}" x2="${w-R}" y2="${yy}" stroke="#dbe6f1"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#64748b">${fmt(val)}</text>`}).join('');
    const bars=points.map((d,i)=>{const bw=Math.max(3,(w-L-R)/points.length*.55),bh=((d.volume||0)/vm)*VH;return `<rect x="${x(i)-bw/2}" y="${VT+VH-bh}" width="${bw}" height="${bh}" rx="2" fill="#64748b" opacity=".48"/>`}).join('');
    const chg=points[0].close?((points[points.length-1].close-points[0].close)/points[0].close)*100:0;
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="egx565Area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0b63ce" stop-opacity=".28"/><stop offset="100%" stop-color="#0b63ce" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="#fff"/><text x="${w-R}" y="22" text-anchor="end" font-size="15" font-weight="900" fill="#0f172a">${esc(code)} · ${fmt(points[points.length-1].close)} · ${pct(chg)}</text>${grid}<path d="${area}" fill="url(#egx565Area)"/><path d="${line}" fill="none" stroke="#0b63ce" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>${bars}<line x1="${L}" y1="${VT+VH}" x2="${w-R}" y2="${VT+VH}" stroke="#dbe6f1"/><text x="${L}" y="418" font-size="12" fill="#64748b">${esc(String(points[0].date).slice(0,10))}</text><text x="${w-R}" y="418" text-anchor="end" font-size="12" fill="#64748b">${esc(String(points[points.length-1].date).slice(0,10))}</text></svg>`;
  }

  function news() {
    return `<div class="card pad"><h3>الأخبار المؤثرة</h3><div class="mini">${state.news.slice(0,100).map(x=>`<div class="item"><span>${esc(first(x,['title','headline','summary','text'],'خبر'))}</span><b>${esc(first(x,['source','publisher','site'],'—'))}</b></div>`).join('') || '<div class="empty">لا توجد أخبار</div>'}</div></div>`;
  }
  function alerts() {
    return `<div class="card pad"><h3>التنبيهات</h3>${state.alerts.slice(0,100).map(x=>`<div class="alert ${String(first(x,['impact','level','severity'],'')).includes('high')?'danger':''}"><b>${esc(first(x,['title','headline','message','summary','symbol'],'تنبيه'))}</b><br><span class="muted">${esc(first(x,['source','type','level','impact'],'متابعة'))}</span></div>`).join('') || '<div class="empty">لا توجد تنبيهات</div>'}</div>`;
  }
  function reports() {
    const available = Object.entries(DATA).map(([k,p]) => ({ k,p, ok: state.docs[k] && !state.docs[k].__error }));
    return `<div class="grid two"><div class="card pad"><h3>التقارير المتاحة</h3><div class="mini">${available.map(x=>`<div class="item"><span>${esc(x.p)}</span><b class="${x.ok?'pos':'neg'}">${x.ok?'متاح':'غير متاح'}</b></div>`).join('')}</div></div><div class="card pad"><h3>ملخص جلسة</h3><div class="mono">${esc(JSON.stringify(state.docs.session && !state.docs.session.__error ? state.docs.session : {}, null, 2)).slice(0,7000)}</div></div></div>`;
  }
  function health() {
    const h=state.docs.health||{}, a=state.docs.audit||{};
    const waiting=Array.isArray(a.waitingNextBatch)?a.waitingNextBatch.length:Array.isArray(a.missingFromCache)?a.missingFromCache.length:state.rows.filter(r=>r.status==='waiting').length;
    const failed=Array.isArray(a.failedSymbols)?a.failedSymbols.length:state.rows.filter(r=>r.status==='failed').length;
    return `<div class="grid kpis">${kpi('Total Universe', fmt0(first(h,['totalUniverse','configuredSymbols','parsedSymbols'],state.rows.length)), '')}${kpi('Cache Rows', fmt0(first(h,['cacheRows','rowsRead'],state.rows.filter(r=>r.status==='cached').length)), '')}${kpi('Waiting Batch', fmt0(waiting), '')}${kpi('Failed Symbols', fmt0(failed), failed?'تحتاج مراجعة':'لا توجد أخطاء', failed?'neg':'pos')}</div><div style="height:14px"></div><div class="card pad"><h3>حالة ملفات البيانات</h3><div class="mini">${Object.entries(DATA).map(([k,p])=>`<div class="item"><span>${esc(p)}</span><b class="${state.docs[k] && !state.docs[k].__error?'pos':'neg'}">${state.docs[k] && !state.docs[k].__error?'متاح':'غير متاح'}</b></div>`).join('')}</div></div>`;
  }

  function view() {
    switch (state.active) {
      case 'dashboard': return dashboard();
      case 'priority': return priority();
      case 'opportunities': return opportunities();
      case 'entry': return entry();
      case 'portfolio': return portfolio();
      case 'market': return market();
      case 'sectors': return sectors();
      case 'investors': return investors();
      case 'chart': return chart();
      case 'news': return news();
      case 'alerts': return alerts();
      case 'reports': return reports();
      case 'health': return health();
      default: return priority();
    }
  }

  function titleFor() {
    const item = nav.find(x => x[0] === state.active) || nav[1];
    return item[2];
  }

  function shell() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const cached = state.rows.filter(r => r.status === 'cached').length;
    const watchBuy = state.rows.filter(r => r.recommendation?.key === 'watch-buy').length;
    root.innerHTML = `<aside class="egx-side"><div class="egx-brand"><div class="egx-logo">EGX</div><div><h1>EGX Pro Hub</h1><p>Priority Intelligence · ${VERSION}</p></div></div><nav class="egx-nav">${nav.map(([id,ico,t]) => `<button type="button" class="${state.active===id?'active':''}" data-tab="${id}"><span class="ico">${ico}</span><span>${t}</span></button>`).join('')}</nav></aside><main class="egx-main"><header class="egx-top"><div class="egx-title"><h2>${esc(titleFor())}</h2><p>نافذة موحدة للأولويات، التوصيات، المستويات، الأخبار، والقطاعات.</p></div><div class="egx-badges"><span class="egx-pill">الأسهم: ${fmt0(state.rows.length)}</span><span class="egx-pill">داخل الكاش: ${fmt0(cached)}</span><span class="egx-pill">مراقبة لشراء: ${fmt0(watchBuy)}</span></div></header><section class="egx-content">${view()}</section></main>`;
    bind(root);
  }

  function bind(root) {
    root.querySelectorAll('[data-tab]').forEach(btn => btn.onclick = () => { state.active = btn.dataset.tab; state.page = 1; shell(); });
    root.querySelectorAll('[data-select]').forEach(btn => btn.onclick = () => { state.selected = btn.dataset.select; shell(); });
    root.querySelectorAll('[data-chart]').forEach(btn => btn.onclick = () => { state.chartSymbol = btn.dataset.chart; state.selected = btn.dataset.chart; state.active = 'chart'; shell(); });
    const q = root.querySelector('#egx-q'); if (q) q.oninput = e => { state.q = e.target.value; state.page = 1; shell(); };
    const rf = root.querySelector('#egx-rec-filter'); if (rf) rf.onchange = e => { state.recFilter = e.target.value; state.page = 1; shell(); };
    const sf = root.querySelector('#egx-sector-filter'); if (sf) sf.onchange = e => { state.sectorFilter = e.target.value; state.page = 1; shell(); };
    const ps = root.querySelector('#egx-page-size'); if (ps) ps.onchange = e => { state.pageSize = Number(e.target.value) || 50; state.page = 1; shell(); };
    const prev = root.querySelector('#egx-prev'); if (prev) prev.onclick = () => { state.page = Math.max(1, state.page - 1); shell(); };
    const next = root.querySelector('#egx-next'); if (next) next.onclick = () => { state.page += 1; shell(); };
    const cs = root.querySelector('#egx-chart-symbol'); if (cs) cs.onchange = e => { state.chartSymbol = e.target.value; state.selected = e.target.value; shell(); };
    const rg = root.querySelector('#egx-range'); if (rg) rg.onchange = e => { state.range = e.target.value; shell(); };
  }

  let started = false;
  async function start() {
    if (started) return;
    started = true;
    injectCss();
    document.querySelectorAll('#egx-v562-root,#egx-v56-hard-root').forEach(el => el.remove());
    const root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
    root.innerHTML = '<div style="margin:auto;text-align:center;font-family:Tahoma,Arial"><b>جاري تحميل EGX Pro Hub...</b><br><span style="color:#64748b">Priority Console</span></div>';
    await load();
    shell();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 250));
  else setTimeout(start, 250);
  setTimeout(start, 1600);
})();
