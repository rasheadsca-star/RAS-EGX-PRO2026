(function () {
  'use strict';

  const ROOT = 'egx-v56-hard-root';
  const VERSION = 'V5.6.2';
  const paths = {
    health: 'data/source-health.json',
    audit: 'data/symbol-audit.json',
    universe: 'data/universe-index.json',
    cache: 'data/full-market-cache.json',
    market: 'data/market.json',
    recs: 'data/recommendations.json',
    pro: 'data/pro-report.json',
    risk: 'data/risk-dashboard.json',
    sectors: 'data/sector-report.json',
    investors: 'data/investor-flow-report.json',
    history: 'data/history-50.json',
    tech: 'data/technical-50-report.json',
    news: 'data/smart-news-report.json',
    alerts: 'data/alerts-v56-news.json',
    session: 'data/session-report.json',
    daily: 'data/daily-report.json'
  };

  const state = {
    tab: 'dashboard', q: '', sector: 'all', status: 'all', page: 1, pageSize: 60,
    symbol: '', range: '50', data: {}, rows: [], sectors: [], alerts: [], news: []
  };

  const tabs = [
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

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/,/g, '').replace(/%/g, '').replace(/[^0-9\-.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (v, d = 2) => { const n = num(v); return n === null ? '—' : n.toLocaleString('ar-EG', { maximumFractionDigits: d }); };
  const pct = v => { const n = num(v); return n === null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}%`; };
  const cls = v => { const n = num(v); return n === null || n === 0 ? 'neu' : n > 0 ? 'pos' : 'neg'; };
  const sym = v => String(v || '').trim().toUpperCase();
  const first = (o, keys, fallback = '') => {
    if (!o || typeof o !== 'object') return fallback;
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
    return fallback;
  };
  const arr = x => {
    if (Array.isArray(x)) return x;
    if (!x || typeof x !== 'object') return [];
    for (const k of ['rows','data','items','symbols','cache','market','recommendations','opportunities','records','list','top','alerts','news']) if (Array.isArray(x[k])) return x[k];
    for (const v of Object.values(x)) if (Array.isArray(v) && (!v[0] || typeof v[0] === 'object')) return v;
    return [];
  };
  async function get(path) {
    try {
      const r = await fetch(path + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return await r.json();
    } catch (e) { return { __error: String(e.message || e) }; }
  }

  function normalizeRow(x, source) {
    if (!x || typeof x !== 'object') return null;
    const code = sym(first(x, ['symbol','code','ticker','Symbol','securityCode','stock','id']));
    if (!code || code.length > 14) return null;
    const name = String(first(x, ['nameAr','name_ar','arabicName','name','nameEn','name_en','company','companyName','securityName','Name'], code)).trim();
    const price = num(first(x, ['last','price','lastPrice','close','Close','currentPrice','value']));
    const change = num(first(x, ['changePct','changePercent','pctChange','change_percentage','changeRate','change']));
    const volume = num(first(x, ['volume','Volume','tradedVolume','tradesVolume','qty']));
    const turnover = num(first(x, ['turnover','Turnover','valueTraded','tradedValue','liquidity','amount']));
    const confidence = num(first(x, ['confidence','score','confidenceScore','trust','rating','technicalScore']));
    let status = String(first(x, ['status','cacheStatus','state'], source === 'cache' || source === 'market' ? 'cached' : source)).toLowerCase();
    if (status.includes('missing') || status.includes('waiting')) status = 'waiting';
    return { symbol: code, name, sector: String(first(x, ['sector','sectorAr','sector_ar','Sector','industry','industryName'], 'غير مصنف')).trim(), price, change, volume, turnover, confidence, status, source };
  }

  function mergeRows() {
    const input = [];
    [['universe', state.data.universe], ['cache', state.data.cache], ['market', state.data.market], ['recs', state.data.recs], ['pro', state.data.pro], ['tech', state.data.tech]].forEach(([src, obj]) => arr(obj).forEach(x => { const r = normalizeRow(x, src); if (r) input.push(r); }));
    const audit = state.data.audit || {};
    ['allSymbols','symbols','missingFromCache','waitingNextBatch','failedSymbols','cachedSymbols'].forEach(k => {
      if (!Array.isArray(audit[k])) return;
      audit[k].forEach(x => {
        const r = typeof x === 'string' ? { symbol: sym(x), name: sym(x), sector:'غير مصنف', price:null, change:null, volume:null, turnover:null, confidence:null, status:'universe', source:'audit' } : normalizeRow(x, 'audit');
        if (!r) return;
        if (k === 'missingFromCache' || k === 'waitingNextBatch') r.status = 'waiting';
        if (k === 'failedSymbols') r.status = 'failed';
        if (k === 'cachedSymbols') r.status = 'cached';
        input.push(r);
      });
    });
    const priority = { cache: 8, market: 7, pro: 6, recs: 5, tech: 4, universe: 2, audit: 1 };
    const map = new Map();
    input.forEach(r => {
      const old = map.get(r.symbol);
      if (!old) { map.set(r.symbol, r); return; }
      const s = (priority[r.source] || 0) + ['price','change','volume','turnover','confidence'].filter(k => r[k] !== null && r[k] !== undefined).length;
      const os = (priority[old.source] || 0) + ['price','change','volume','turnover','confidence'].filter(k => old[k] !== null && old[k] !== undefined).length;
      const base = s >= os ? { ...old, ...r } : { ...r, ...old };
      base.name = (r.name && r.name !== r.symbol) ? r.name : old.name;
      base.sector = (r.sector && r.sector !== 'غير مصنف') ? r.sector : old.sector;
      base.status = (old.status === 'cached' || r.status === 'cached') ? 'cached' : (r.status || old.status);
      map.set(r.symbol, base);
    });
    return [...map.values()].sort((a,b) => a.symbol.localeCompare(b.symbol));
  }

  function buildSectors() {
    let s = arr(state.data.sectors).map(x => ({
      sector: String(first(x, ['sector','name','sectorName','label'], 'غير مصنف')),
      turnover: num(first(x, ['turnover','liquidity','value','totalTurnover','marketValue'])),
      volume: num(first(x, ['volume','totalVolume'])),
      count: num(first(x, ['stocks','symbols','count','symbolCount'])),
      allocation: num(first(x, ['allocation','weight','suggestedWeight','portfolioWeight']))
    })).filter(x => x.sector);
    if (!s.length) {
      const m = new Map();
      state.rows.forEach(r => {
        const k = r.sector || 'غير مصنف';
        if (!m.has(k)) m.set(k, { sector:k, turnover:0, volume:0, count:0, allocation:0 });
        const z = m.get(k); z.turnover += r.turnover || 0; z.volume += r.volume || 0; z.count++;
      });
      s = [...m.values()];
      const total = s.reduce((a,b) => a + (b.turnover || 0), 0);
      s.forEach(x => x.allocation = total ? (x.turnover / total) * 100 : 0);
    }
    return s.sort((a,b) => (b.turnover || 0) - (a.turnover || 0));
  }

  async function load() {
    const pairs = await Promise.all(Object.entries(paths).map(async ([k,p]) => [k, await get(p)]));
    state.data = Object.fromEntries(pairs);
    state.rows = mergeRows();
    state.sectors = buildSectors();
    state.news = arr(state.data.news);
    state.alerts = [...arr(state.data.alerts), ...arr(state.data.risk).filter(x => first(x, ['message','title','symbol'], ''))];
    if (!state.symbol && state.rows.length) state.symbol = state.rows.find(r => r.price !== null)?.symbol || state.rows[0].symbol;
  }

  function css() {
    document.getElementById('egx-v562-style')?.remove();
    // Keep compatibility with V5.6.1 hard mode: use the same root id so old hiding CSS cannot blank the page.
    const s = document.createElement('style'); s.id = 'egx-v562-style';
    s.textContent = `
      html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#eef4f8!important;direction:rtl!important}
      body>*:not(#${ROOT}):not(script):not(style):not(link):not(meta):not(title){display:none!important;visibility:hidden!important;pointer-events:none!important}
      #${ROOT},#${ROOT} *{box-sizing:border-box}#${ROOT}{position:fixed;inset:0;z-index:2147483600;display:flex;background:#eef4f8;color:#101827;font-family:Cairo,Tahoma,Arial,sans-serif;direction:rtl;overflow:hidden}
      .side{width:290px;flex:0 0 290px;background:linear-gradient(180deg,#071426,#0b1f35 60%,#071426);color:#eaf3ff;border-left:1px solid rgba(255,255,255,.08);padding:20px 14px;overflow:auto;box-shadow:-16px 0 40px rgba(15,23,42,.18)}
      .brand{display:flex;gap:12px;align-items:center;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.1)}.logo{width:52px;height:52px;border-radius:17px;background:linear-gradient(135deg,#19c7b4,#d3c934);display:grid;place-items:center;color:#062032;font-weight:900}.brand h1{font-size:22px;line-height:1.05;margin:0}.brand p{margin:6px 0 0;color:#aebed1;font-size:12px}
      .nav{display:flex;flex-direction:column;gap:7px}.nav button{border:0;background:transparent;color:#dcecff;border-radius:15px;padding:12px 13px;display:flex;align-items:center;gap:10px;text-align:right;font-size:14px;font-weight:800;cursor:pointer}.nav button:hover{background:rgba(255,255,255,.08)}.nav button.active{background:#fff;color:#071426;box-shadow:0 12px 30px rgba(0,0,0,.18)}
      .main{flex:1;min-width:0;height:100vh;display:flex;flex-direction:column;overflow:hidden}.top{height:82px;background:rgba(255,255,255,.94);border-bottom:1px solid #dbe6f1;display:flex;justify-content:space-between;align-items:center;padding:18px 26px}.top h2{margin:0;font-size:25px}.top p{margin:4px 0 0;color:#65758a;font-size:12px}.content{flex:1;overflow:auto;padding:22px 26px 40px}.grid{display:grid;gap:16px}.kpis{grid-template-columns:repeat(4,minmax(160px,1fr))}.two{grid-template-columns:1.08fr .92fr}.three{grid-template-columns:repeat(3,1fr)}
      .card{background:#fff;border:1px solid #dce7f1;border-radius:22px;box-shadow:0 14px 38px rgba(15,23,42,.07);overflow:hidden}.pad{padding:18px}.card h3{font-size:17px;margin:0 0 12px}.muted{color:#66788e;font-size:12px}.kpi{padding:18px;min-height:112px;display:flex;flex-direction:column;justify-content:space-between}.kpi span{font-size:12px;color:#66788e;font-weight:800}.kpi strong{font-size:29px;color:#0e1726;line-height:1}.pos{color:#047857!important}.neg{color:#b91c1c!important}.neu{color:#334155!important}.pill{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;border:1px solid #dbe6f1;background:#f8fbfe}.pill.good{background:#e8fff5;color:#047857;border-color:#b8f2dc}.pill.warn{background:#fff8e6;color:#a16207;border-color:#f5d98b}.pill.bad{background:#fff1f1;color:#b91c1c;border-color:#ffc3c3}.tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.input,.select{height:42px;border:1px solid #d3e0ed;border-radius:14px;background:#fff;padding:0 13px;font-weight:800;color:#132238}.input{min-width:260px}.btn{border:1px solid #0b63ce;background:#0b63ce;color:#fff;border-radius:12px;padding:9px 13px;font-weight:900;cursor:pointer}.btn.light{background:#fff;color:#0b63ce}.tablewrap{overflow:auto;border:1px solid #e0e8f2;border-radius:16px}table{width:100%;border-collapse:collapse;min-width:960px;background:#fff}th,td{padding:11px 12px;border-bottom:1px solid #e8eef6;text-align:right;font-size:13px;white-space:nowrap}th{position:sticky;top:0;background:#f6f9fc;color:#52647a;z-index:1}.symbol{font-weight:950;color:#0b63ce}.bar{height:10px;background:#edf3f8;border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#0b63ce,#17b8a6);border-radius:999px}.mini{display:grid;gap:10px}.item{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px;border:1px solid #e0e8f2;border-radius:15px;background:#fbfdff}.item b{font-size:14px}.alert{padding:13px 14px;border-radius:15px;border:1px solid #fed7aa;background:#fff7ed;color:#7c2d12;margin-bottom:10px;font-weight:800}.alert.danger{border-color:#fecaca;background:#fff1f2;color:#991b1b}.alert.good{border-color:#bbf7d0;background:#f0fdf4;color:#166534}.chart{width:100%;height:380px;display:block}.empty{padding:36px;text-align:center;color:#66788e}.mono{font-family:ui-monospace,Consolas,monospace;direction:ltr;text-align:left;white-space:pre-wrap;background:#071426;color:#dbeafe;border-radius:16px;padding:16px;overflow:auto;max-height:420px}
      @media(max-width:980px){#${ROOT}{flex-direction:column}.side{width:100%;flex:0 0 auto;max-height:210px}.nav{display:grid;grid-template-columns:repeat(3,1fr)}.kpis,.two,.three{grid-template-columns:1fr}.top{height:auto;align-items:flex-start;gap:10px;flex-direction:column}.content{padding:14px}.input{min-width:100%}}
    `;
    document.head.appendChild(s);
  }

  const title = () => tabs.find(t => t[0] === state.tab)?.[2] || 'EGX Pro Hub';
  function kpi(name, value, note, c='') { return `<div class="card kpi"><span>${esc(name)}</span><strong class="${c}">${esc(value)}</strong><small class="muted">${esc(note || '')}</small></div>`; }
  function statusBadge(s) { s = String(s || '').toLowerCase(); if (s.includes('cached')) return '<span class="pill good">داخل الكاش</span>'; if (s.includes('failed')) return '<span class="pill bad">فشل</span>'; if (s.includes('waiting') || s.includes('missing')) return '<span class="pill warn">ينتظر Batch</span>'; return '<span class="pill">متاح</span>'; }
  function option(v, label, cur) { return `<option value="${esc(v)}" ${String(v)===String(cur)?'selected':''}>${esc(label)}</option>`; }
  function empty(t) { return `<div class="empty">${esc(t)}</div>`; }

  function shell() {
    const root = document.getElementById(ROOT) || Object.assign(document.body.appendChild(document.createElement('div')), { id: ROOT });
    root.innerHTML = `<aside class="side"><div class="brand"><div class="logo">EGX</div><div><h1>EGX Pro Hub</h1><p>Unified Intelligence Workspace · ${VERSION}</p></div></div><nav class="nav">${tabs.map(t => `<button data-tab="${t[0]}" class="${state.tab===t[0]?'active':''}"><span>${t[1]}</span><b>${t[2]}</b></button>`).join('')}</nav><p class="muted" style="margin-top:18px;line-height:1.7">بيانات عامة/متأخرة. التحليل للمراقبة وليس أمر تداول.</p></aside><main class="main"><header class="top"><div><h2>${esc(title())}</h2><p>سوق كامل · فرص · محفظة · قطاعات · متعاملين · شارت · أخبار · تنبيهات</p></div><div class="tools"><span class="pill good">${fmt(state.rows.length,0)} سهم</span><span class="pill">${fmt((state.data.health||{}).cacheRows || state.rows.filter(r=>r.status==='cached').length,0)} داخل الكاش</span></div></header><section class="content" id="egx-view">${view()}</section></main>`;
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; state.page = 1; shell(); });
    bind();
  }

  function view() {
    switch (state.tab) {
      case 'dashboard': return dashboard();
      case 'ranking': return ranking();
      case 'opportunities': return opportunities();
      case 'portfolio': return portfolio();
      case 'market': return market();
      case 'sectors': return sectors();
      case 'investors': return investors();
      case 'chart': return chart();
      case 'news': return news();
      case 'alerts': return alerts();
      case 'reports': return reports();
      case 'health': return health();
      default: return dashboard();
    }
  }

  function dashboard() {
    const h = state.data.health || {}, a = state.data.audit || {};
    const total = num(first(h, ['totalUniverse','configuredSymbols','parsedSymbols'], state.rows.length)) || state.rows.length;
    const cached = num(first(h, ['cacheRows','rowsRead','cachedSymbols'], state.rows.filter(r => r.status === 'cached').length)) || state.rows.filter(r => r.status === 'cached').length;
    const waiting = Array.isArray(a.waitingNextBatch) ? a.waitingNextBatch.length : Array.isArray(a.missingFromCache) ? a.missingFromCache.length : Math.max(0, total - cached);
    const topSector = state.sectors[0]?.sector || '—';
    return `<div class="grid kpis">${kpi('إجمالي السوق', fmt(total,0), 'Universe')}${kpi('داخل الكاش', fmt(cached,0), 'جاهز للتحليل', 'pos')}${kpi('ينتظر Batch', fmt(waiting,0), 'يكتمل بتشغيل Workflow')}${kpi('أقوى قطاع', topSector, 'حسب السيولة')}</div><div class="grid two" style="margin-top:16px"><div class="card pad"><h3>أفضل الفرص للمراقبة</h3>${opportunityList(8)}</div><div class="card pad"><h3>توزيع السيولة بين القطاعات</h3>${sectorBars(8)}</div></div><div class="grid two" style="margin-top:16px"><div class="card pad"><h3>تنبيهات مهمة</h3>${alertList(6)}</div><div class="card pad"><h3>آخر الأخبار المؤثرة</h3>${newsList(6)}</div></div>`;
  }

  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    return state.rows.filter(r => {
      const okQ = !q || [r.symbol, r.name, r.sector].join(' ').toLowerCase().includes(q);
      const okS = state.status === 'all' || String(r.status).includes(state.status);
      const okSec = state.sector === 'all' || r.sector === state.sector;
      return okQ && okS && okSec;
    });
  }
  function controls() {
    const sectors = ['all', ...new Set(state.rows.map(r => r.sector || 'غير مصنف'))].sort();
    return `<div class="tools"><input id="q" class="input" value="${esc(state.q)}" placeholder="بحث بالرمز أو الاسم أو القطاع"><select id="status" class="select">${option('all','كل الحالات',state.status)}${option('cached','داخل الكاش',state.status)}${option('waiting','ينتظر Batch',state.status)}${option('failed','فشل',state.status)}</select><select id="sector" class="select">${sectors.map(s => option(s, s === 'all' ? 'كل القطاعات' : s, state.sector)).join('')}</select><select id="pageSize" class="select">${[25,50,60,100,250].map(x => option(x, `${x} / صفحة`, state.pageSize)).join('')}</select></div>`;
  }
  function tableRows(rows) {
    return `<div class="tablewrap"><table><thead><tr><th>الرمز</th><th>الاسم</th><th>القطاع</th><th>السعر</th><th>التغير</th><th>الحجم</th><th>السيولة</th><th>الثقة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${rows.map(r => `<tr><td><span class="symbol">${esc(r.symbol)}</span></td><td>${esc(r.name)}</td><td>${esc(r.sector)}</td><td>${fmt(r.price)}</td><td class="${cls(r.change)}">${pct(r.change)}</td><td>${fmt(r.volume,0)}</td><td>${fmt(r.turnover,0)}</td><td>${fmt(r.confidence,0)}</td><td>${statusBadge(r.status)}</td><td><button class="btn light" data-chart="${esc(r.symbol)}">شارت</button></td></tr>`).join('') || `<tr><td colspan="10">${empty('لا توجد نتائج')}</td></tr>`}</tbody></table></div>`;
  }
  function market() {
    const all = filteredRows();
    const pages = Math.max(1, Math.ceil(all.length / state.pageSize));
    state.page = Math.min(state.page, pages);
    const rows = all.slice((state.page-1)*state.pageSize, state.page*state.pageSize);
    return `<div class="card pad"><h3>كل السوق</h3>${controls()}${tableRows(rows)}<div class="tools" style="margin-top:12px"><button id="prev" class="btn light">السابق</button><span class="pill">صفحة ${state.page} من ${pages}</span><button id="next" class="btn light">التالي</button><span class="muted">${fmt(all.length,0)} نتيجة</span></div></div>`;
  }
  function score(r) { return (r.confidence || 0) + Math.max(-20, Math.min(20, r.change || 0)) + Math.log10((r.turnover || r.volume || 1)) * 8; }
  function ranking() { const rows = [...state.rows].sort((a,b)=>score(b)-score(a)).slice(0,120); return `<div class="card pad"><h3>ترتيب السوق</h3><p class="muted">الترتيب يعتمد على السيولة والتغير والثقة الفنية المتاحة.</p>${tableRows(rows)}</div>`; }
  function opportunityRows() { return [...state.rows].filter(r => r.status === 'cached' && (r.price !== null || r.turnover || r.volume)).sort((a,b)=>score(b)-score(a)); }
  function opportunities() { return `<div class="card pad"><h3>قائمة الفرص</h3><p class="muted">فرص مراقبة وتحليل فقط، وليست أوامر شراء أو بيع.</p>${tableRows(opportunityRows().slice(0,80))}</div>`; }
  function opportunityList(n) { const rows = opportunityRows().slice(0,n); return rows.length ? rows.map(r => `<div class="item"><span><b class="symbol">${esc(r.symbol)}</b> · ${esc(r.name)}</span><b class="${cls(r.change)}">${pct(r.change)}</b></div>`).join('') : empty('لا توجد فرص كافية'); }

  function portfolio() {
    const sectorAlloc = state.sectors.slice(0,10);
    return `<div class="grid two"><div class="card pad"><h3>إدارة المحفظة</h3><div class="alert good">هذا القسم يجهز توزيعًا قطاعيًا مقترحًا حسب سيولة السوق. إدخال محفظتك الفعلية سيكون في خطوة لاحقة من ملف CSV/Excel أو نموذج داخل التطبيق.</div><div class="mini">${sectorAlloc.map(s => `<div class="item"><span>${esc(s.sector)}</span><b>${fmt(s.allocation,1)}%</b></div>`).join('') || empty('لا توجد قطاعات')}</div></div><div class="card pad"><h3>توزيع مقترح للسيولة</h3>${sectorBars(12)}</div></div>`;
  }
  function sectors() { return `<div class="grid two"><div class="card pad"><h3>ترتيب القطاعات</h3><div class="tablewrap"><table><thead><tr><th>القطاع</th><th>عدد الأسهم</th><th>السيولة</th><th>الحجم</th><th>توزيع مقترح</th></tr></thead><tbody>${state.sectors.map(s => `<tr><td><b>${esc(s.sector)}</b></td><td>${fmt(s.count,0)}</td><td>${fmt(s.turnover,0)}</td><td>${fmt(s.volume,0)}</td><td>${fmt(s.allocation,1)}%</td></tr>`).join('') || `<tr><td colspan="5">${empty('لا توجد بيانات قطاعات')}</td></tr>`}</tbody></table></div></div><div class="card pad"><h3>توزيع السيولة</h3>${sectorBars(15)}</div></div>`; }
  function sectorBars(n) { const total = state.sectors.reduce((a,b)=>a+(b.turnover||0),0) || 1; return `<div class="mini">${state.sectors.slice(0,n).map(s => { const p = total ? (s.turnover || 0) / total * 100 : (s.allocation || 0); return `<div class="item"><span>${esc(s.sector)}</span><b>${fmt(p,1)}%</b></div><div class="bar"><i style="width:${Math.max(1,Math.min(100,p))}%"></i></div>`; }).join('') || empty('لا توجد بيانات')}</div>`; }

  function investors() { const rows = arr(state.data.investors); const st = first(state.data.investors, ['status','state','sourceStatus'], rows.length ? 'ready' : 'needs_source'); return `<div class="grid two"><div class="card pad"><h3>نوع المتعاملين</h3>${String(st).includes('needs') ? '<div class="alert">البيانات تحتاج مصدر يومي أو قراءة آلية مستقرة من EGX.</div>' : ''}<div class="tablewrap"><table><thead><tr><th>الفئة</th><th>شراء</th><th>بيع</th><th>صافي</th><th>التأثير</th></tr></thead><tbody>${rows.map(x => { const buy = num(first(x,['buy','buyValue','purchases'])); const sell = num(first(x,['sell','sellValue','sales'])); const net = num(first(x,['net','netValue'], (buy||0)-(sell||0))); return `<tr><td><b>${esc(first(x,['category','type','name','label'],'—'))}</b></td><td>${fmt(buy,0)}</td><td>${fmt(sell,0)}</td><td class="${cls(net)}">${fmt(net,0)}</td><td>${net>0?'دعم':net<0?'ضغط':'محايد'}</td></tr>`; }).join('') || `<tr><td colspan="5">${empty('لا توجد بيانات نوع متعاملين')}</td></tr>`}</tbody></table></div></div><div class="card pad"><h3>تأثير على السوق والمحفظة</h3><div class="mini"><div class="item"><span>إشارة السوق</span><b>${esc(first(state.data.investors,['signal','marketSignal','summary'],'تظهر فور توفر البيانات'))}</b></div><div class="item"><span>عدد الفئات</span><b>${fmt(rows.length,0)}</b></div></div></div></div>`; }

  function history(code) { const h = state.data.history || {}; let a = []; if (Array.isArray(h)) a = h.filter(x => sym(first(x,['symbol','code','ticker'])) === code); else if (h && typeof h === 'object') a = h[code] || h[code.toLowerCase()] || arr(h).filter(x => sym(first(x,['symbol','code','ticker'])) === code); a = (a || []).map((p,i) => ({ date:first(p,['date','session','day','t'],String(i+1)), close:num(first(p,['close','price','last','value'])), volume:num(first(p,['volume','tradedVolume','qty'])) || 0 })).filter(p => p.close !== null).sort((a,b) => String(a.date).localeCompare(String(b.date))); return state.range === 'all' ? a : a.slice(-Number(state.range || 50)); }
  function chart() { const symbols = state.rows.map(r=>r.symbol); const r = state.rows.find(x => x.symbol === state.symbol) || {}; const pts = history(state.symbol); return `<div class="card pad"><div class="tools"><select id="chartSymbol" class="select">${symbols.map(s => option(s, `${s} — ${(state.rows.find(r=>r.symbol===s)||{}).name||s}`, state.symbol)).join('')}</select><select id="range" class="select">${option('20','آخر 20 جلسة',state.range)}${option('50','آخر 50 جلسة',state.range)}${option('all','كل المتاح',state.range)}</select><span class="pill">${esc(r.name || '')}</span><span class="pill ${cls(r.change)}">${pct(r.change)}</span></div>${pts.length >= 2 ? svg(pts, state.symbol) : empty('لا توجد نقاط تاريخية كافية لهذا السهم حتى الآن.')}</div><div class="card pad" style="margin-top:16px"><h3>مؤشرات فنية</h3>${tech(state.symbol)}</div>`; }
  function svg(p, code) { const w=1000,h=410,L=52,R=22,T=34,CH=260,VT=320,VH=58; const prices=p.map(x=>x.close), vols=p.map(x=>x.volume||0), mn=Math.min(...prices), mx=Math.max(...prices), vm=Math.max(...vols,1); const x=i=>L+(i/Math.max(1,p.length-1))*(w-L-R); const y=v=>T+(mx===mn?.5:(mx-v)/(mx-mn))*CH; const line=p.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(2)} ${y(d.close).toFixed(2)}`).join(' '); const area=`${line} L ${x(p.length-1)} ${T+CH} L ${x(0)} ${T+CH} Z`; const grid=[0,.25,.5,.75,1].map(t=>{const yy=T+t*CH,val=mx-t*(mx-mn);return `<line x1="${L}" y1="${yy}" x2="${w-R}" y2="${yy}" stroke="#dbe6f1"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#64748b">${fmt(val)}</text>`}).join(''); const bars=p.map((d,i)=>{const bw=Math.max(3,(w-L-R)/p.length*.55),bh=((d.volume||0)/vm)*VH;return `<rect x="${x(i)-bw/2}" y="${VT+VH-bh}" width="${bw}" height="${bh}" rx="2" fill="#94a3b8" opacity=".55"/>`}).join(''); const chg=p[0].close?((p[p.length-1].close-p[0].close)/p[0].close)*100:0; return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="area562" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0b63ce" stop-opacity=".26"/><stop offset="100%" stop-color="#0b63ce" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="#fff"/><text x="${w-R}" y="22" text-anchor="end" font-size="15" font-weight="900" fill="#0e1726">${esc(code)} · ${fmt(p[p.length-1].close)} · ${pct(chg)}</text>${grid}<path d="${area}" fill="url(#area562)"/><path d="${line}" fill="none" stroke="#0b63ce" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>${bars}<line x1="${L}" y1="${VT+VH}" x2="${w-R}" y2="${VT+VH}" stroke="#dbe6f1"/><text x="${L}" y="398" font-size="12" fill="#64748b">${esc(String(p[0].date).slice(0,10))}</text><text x="${w-R}" y="398" text-anchor="end" font-size="12" fill="#64748b">${esc(String(p[p.length-1].date).slice(0,10))}</text></svg>`; }
  function tech(code) { const rows = arr(state.data.tech); let t = rows.find(x => sym(first(x,['symbol','code','ticker'])) === code); if (!t && state.data.tech && typeof state.data.tech === 'object') t = state.data.tech[code] || state.data.tech[code.toLowerCase()]; if (!t) return empty('لا توجد مؤشرات كافية'); return `<div class="grid three">${[['SMA20',first(t,['sma20','SMA20'])],['SMA50',first(t,['sma50','SMA50'])],['دعم',first(t,['support','support1'])],['مقاومة',first(t,['resistance','resistance1'])],['تذبذب',first(t,['volatility'])],['ثقة',first(t,['confidence','score'])]].map(x=>kpi(x[0],fmt(x[1]),'')).join('')}</div>`; }

  function newsList(n) { const a = state.news.slice(0,n); return a.length ? a.map(x => `<div class="item"><span>${esc(first(x,['title','headline','summary','text'],'خبر'))}</span><b>${esc(first(x,['source','publisher','site'],'—'))}</b></div>`).join('') : empty('لا توجد أخبار'); }
  function news() { return `<div class="card pad"><h3>الأخبار</h3>${newsList(120)}</div>`; }
  function alertList(n) { const a = state.alerts.slice(0,n); return a.length ? a.map(x => `<div class="alert ${String(first(x,['impact','level','severity'],'')).includes('high')?'danger':''}"><b>${esc(first(x,['title','headline','message','summary','symbol'],'تنبيه'))}</b><br><span class="muted">${esc(first(x,['source','type','level','impact'],'متابعة'))}</span></div>`).join('') : empty('لا توجد تنبيهات'); }
  function alerts() { return `<div class="card pad"><h3>التنبيهات</h3>${alertList(120)}</div>`; }
  function reports() { const available = Object.entries(paths).filter(([k]) => !['cache'].includes(k)).map(([k,p]) => ({ k,p, ok: state.data[k] && !state.data[k].__error })); return `<div class="grid two"><div class="card pad"><h3>التقارير المتاحة</h3><div class="mini">${available.map(x => `<div class="item"><span>${esc(x.p)}</span><b class="${x.ok?'pos':'neg'}">${x.ok?'متاح':'غير متاح'}</b></div>`).join('')}</div></div><div class="card pad"><h3>ملخص جلسة</h3><div class="mono">${esc(JSON.stringify(state.data.session && !state.data.session.__error ? state.data.session : state.data.daily, null, 2)).slice(0,7000)}</div></div></div>`; }
  function health() { const h = state.data.health || {}, a = state.data.audit || {}; const waiting = Array.isArray(a.waitingNextBatch) ? a.waitingNextBatch.length : Array.isArray(a.missingFromCache) ? a.missingFromCache.length : 0; const failed = Array.isArray(a.failedSymbols) ? a.failedSymbols.length : 0; return `<div class="grid kpis">${kpi('Total Universe',fmt(first(h,['totalUniverse','configuredSymbols','parsedSymbols'],state.rows.length),0),'')}${kpi('Cache Rows',fmt(first(h,['cacheRows','rowsRead'],state.rows.filter(r=>r.status==='cached').length),0),'')}${kpi('Waiting Batch',fmt(waiting,0),'')}${kpi('Failed Symbols',fmt(failed,0),failed?'تحتاج مراجعة':'لا توجد أخطاء',failed?'neg':'pos')}</div><div class="card pad" style="margin-top:16px"><h3>حالة الملفات</h3><div class="mini">${Object.entries(paths).map(([k,p]) => `<div class="item"><span>${esc(p)}</span><b class="${state.data[k] && !state.data[k].__error?'pos':'neg'}">${state.data[k] && !state.data[k].__error?'متاح':'غير متاح'}</b></div>`).join('')}</div></div>`; }

  function bind() {
    const root = document.getElementById(ROOT);
    const q = root.querySelector('#q'); if (q) q.oninput = e => { state.q = e.target.value; state.page = 1; shell(); };
    const status = root.querySelector('#status'); if (status) status.onchange = e => { state.status = e.target.value; state.page = 1; shell(); };
    const sector = root.querySelector('#sector'); if (sector) sector.onchange = e => { state.sector = e.target.value; state.page = 1; shell(); };
    const pageSize = root.querySelector('#pageSize'); if (pageSize) pageSize.onchange = e => { state.pageSize = Number(e.target.value) || 60; state.page = 1; shell(); };
    const prev = root.querySelector('#prev'); if (prev) prev.onclick = () => { state.page = Math.max(1, state.page - 1); shell(); };
    const next = root.querySelector('#next'); if (next) next.onclick = () => { state.page++; shell(); };
    const cs = root.querySelector('#chartSymbol'); if (cs) cs.onchange = e => { state.symbol = e.target.value; shell(); };
    const rg = root.querySelector('#range'); if (rg) rg.onchange = e => { state.range = e.target.value; shell(); };
    root.querySelectorAll('[data-chart]').forEach(b => b.onclick = () => { state.symbol = b.dataset.chart; state.tab = 'chart'; shell(); });
  }

  let started = false;
  async function start() {
    if (started) return; started = true;
    css();
    document.querySelectorAll('#egx-v562-root,#egx-v56-hard-root').forEach(el => el.remove());
    const root = document.getElementById(ROOT) || Object.assign(document.body.appendChild(document.createElement('div')), { id: ROOT });
    root.innerHTML = '<div style="margin:auto;text-align:center;font-family:Tahoma,Arial"><b>جاري تحميل EGX Pro Hub...</b><br><span style="color:#64748b">V5.6.2</span></div>';
    await load();
    shell();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 350)); else setTimeout(start, 350);
  setTimeout(start, 1800);
})();
