
(function () {
  'use strict';

  const ROOT_ID = 'egx-v56-hard-root';
  const VERSION = 'V5.6.1';
  const PATHS = {
    health: 'data/source-health.json',
    universe: 'data/universe-index.json',
    audit: 'data/symbol-audit.json',
    sectors: 'data/sector-report.json',
    investors: 'data/investor-flow-report.json',
    tech: 'data/technical-50-report.json',
    history: 'data/history-50.json',
    news: 'data/smart-news-report.json',
    alerts: 'data/alerts-v56-news.json',
    cache: 'data/full-market-cache.json',
    market: 'data/market.json',
    recs: 'data/recommendations.json',
    risk: 'data/risk-dashboard.json'
  };

  const S = {
    tab: 'overview', q: '', status: 'all', sector: 'all', page: 1, size: 50,
    symbol: '', range: 'all', data: {}, rows: [], sectors: []
  };

  const tabs = [
    ['overview','🏠','لوحة السوق'], ['market','📋','كل السوق'], ['sectors','🏭','القطاعات'],
    ['investors','👥','نوع المتعاملين'], ['chart','📈','Chart Lab'],
    ['news','📰','الأخبار والتنبيهات'], ['health','✅','صحة البيانات']
  ];

  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = v => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/,/g,'').replace(/%/g,'').replace(/[^0-9\-.]/g,''));
    return Number.isFinite(n) ? n : null;
  };
  const fmt = (v,d=2) => { const n=num(v); return n===null?'—':n.toLocaleString('ar-EG',{maximumFractionDigits:d}); };
  const pct = v => { const n=num(v); return n===null?'—':`${n>=0?'+':''}${n.toLocaleString('ar-EG',{maximumFractionDigits:2})}%`; };
  const sign = v => { const n=num(v); return n===null||n===0?'neutral':n>0?'pos':'neg'; };
  const sym = v => String(v||'').trim().toUpperCase();

  function first(o, keys, fallback='') {
    if (!o || typeof o !== 'object') return fallback;
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
    return fallback;
  }
  function arr(x) {
    if (Array.isArray(x)) return x;
    if (!x || typeof x !== 'object') return [];
    for (const k of ['rows','data','items','symbols','market','cache','recommendations','opportunities','records','list'])
      if (Array.isArray(x[k])) return x[k];
    for (const v of Object.values(x)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    return [];
  }
  async function json(path) {
    try {
      const r = await fetch(path + '?v=' + Date.now(), {cache:'no-store'});
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return await r.json();
    } catch (e) { return {__error:String(e.message||e)}; }
  }

  function row(raw, source) {
    if (!raw || typeof raw !== 'object') return null;
    const code = sym(first(raw,['symbol','code','ticker','Symbol','securityCode','stock','id']));
    if (!code || code.length > 12) return null;
    return {
      symbol: code,
      name: String(first(raw,['nameAr','name_ar','arabicName','name','nameEn','name_en','company','companyName','securityName','Name'],code)).trim(),
      sector: String(first(raw,['sector','sectorAr','sector_ar','Sector','industry','industryName'],'غير مصنف')).trim(),
      price: num(first(raw,['last','price','lastPrice','close','Close','currentPrice','value'])),
      change: num(first(raw,['changePct','changePercent','pctChange','change_percentage','changeRate','change'])),
      volume: num(first(raw,['volume','Volume','tradedVolume','tradesVolume','qty'])),
      turnover: num(first(raw,['turnover','Turnover','valueTraded','tradedValue','liquidity','amount'])),
      confidence: num(first(raw,['confidence','score','confidenceScore','trust','rating'])),
      status: String(first(raw,['status','cacheStatus','state'], source==='cache'||source==='market'?'cached':'universe')).toLowerCase(),
      source
    };
  }

  function buildRows() {
    const all = [];
    for (const [source,obj] of [['universe',S.data.universe],['cache',S.data.cache],['market',S.data.market],['recs',S.data.recs],['tech',S.data.tech]]) {
      arr(obj).forEach(x => { const r = row(x, source); if (r) all.push(r); });
    }
    const a = S.data.audit || {};
    for (const key of ['allSymbols','symbols','missingFromCache','waitingNextBatch','failedSymbols','cachedSymbols']) {
      if (Array.isArray(a[key])) a[key].forEach(x => {
        let r = typeof x === 'string' ? {symbol:sym(x), name:sym(x), sector:'غير مصنف', status:key, source:'audit'} : row(x,'audit');
        if (r && r.symbol) {
          if (key === 'missingFromCache' || key === 'waitingNextBatch') r.status = 'waiting';
          if (key === 'failedSymbols') r.status = 'failed';
          if (key === 'cachedSymbols') r.status = 'cached';
          all.push(r);
        }
      });
    }
    const map = new Map();
    const priority = {cache:6, market:5, recs:4, tech:3, universe:2, audit:1};
    for (const r of all) {
      const old = map.get(r.symbol);
      if (!old) { map.set(r.symbol, r); continue; }
      const score = (priority[r.source]||0) + ['price','change','volume','turnover'].filter(k => r[k]!==null && r[k]!==undefined).length;
      const oldScore = (priority[old.source]||0) + ['price','change','volume','turnover'].filter(k => old[k]!==null && old[k]!==undefined).length;
      map.set(r.symbol, {
        ...old,
        ...(score >= oldScore ? r : {}),
        name: r.name && r.name !== r.symbol ? r.name : old.name,
        sector: r.sector && r.sector !== 'غير مصنف' ? r.sector : old.sector,
        status: old.status === 'cached' || r.status === 'cached' ? 'cached' : (r.status || old.status)
      });
    }
    return [...map.values()].sort((a,b)=>a.symbol.localeCompare(b.symbol));
  }

  function buildSectors() {
    let rows = arr(S.data.sectors).map(x => ({
      sector: String(first(x,['sector','name','sectorName','label'],'غير مصنف')),
      turnover: num(first(x,['turnover','liquidity','value','totalTurnover','marketValue'])),
      volume: num(first(x,['volume','totalVolume'])),
      stocks: num(first(x,['stocks','symbols','count','symbolCount'])),
      allocation: num(first(x,['allocation','weight','suggestedWeight','portfolioWeight']))
    })).filter(x=>x.sector);
    if (!rows.length) {
      const g = new Map();
      S.rows.forEach(r => {
        const k = r.sector || 'غير مصنف';
        if (!g.has(k)) g.set(k,{sector:k,turnover:0,volume:0,stocks:0,allocation:0});
        const s = g.get(k); s.turnover += r.turnover || 0; s.volume += r.volume || 0; s.stocks++;
      });
      rows = [...g.values()];
      const total = rows.reduce((a,b)=>a+(b.turnover||0),0);
      rows.forEach(r => r.allocation = total ? (r.turnover/total)*100 : 0);
    }
    return rows.sort((a,b)=>(b.turnover||0)-(a.turnover||0));
  }

  async function load() {
    const pairs = await Promise.all(Object.entries(PATHS).map(async ([k,p]) => [k, await json(p)]));
    S.data = Object.fromEntries(pairs); S.rows = buildRows(); S.sectors = buildSectors();
    if (!S.symbol && S.rows.length) S.symbol = S.rows[0].symbol;
  }

  function css() {
    if (document.getElementById('egx-v56-hard-style')) return;
    const st = document.createElement('style'); st.id='egx-v56-hard-style';
    st.textContent = `
      html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#edf3f8!important;direction:rtl!important}
      body>*:not(#${ROOT_ID}):not(script):not(style):not(link):not(meta):not(title){display:none!important;visibility:hidden!important;pointer-events:none!important}
      #${ROOT_ID},#${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID}{position:fixed;inset:0;z-index:2147483000;display:flex;background:#edf3f8;color:#0f172a;font-family:Cairo,Tahoma,Arial,sans-serif;direction:rtl;overflow:hidden}
      .egx-side{width:286px;flex:0 0 286px;background:linear-gradient(180deg,#061426,#0c2137 55%,#0b1829);color:#eaf4ff;padding:22px 16px;overflow:auto;border-left:1px solid rgba(255,255,255,.08);box-shadow:-18px 0 40px rgba(15,23,42,.18)}
      .brand{display:flex;gap:12px;align-items:center;margin-bottom:22px;padding-bottom:18px;border-bottom:1px solid rgba(255,255,255,.1)}.logo{width:52px;height:52px;border-radius:18px;background:linear-gradient(135deg,#1fc7b6,#b7d12c);display:grid;place-items:center;font-weight:900;color:#062032}.brand h1{margin:0;font-size:22px;line-height:1.05}.brand p{margin:6px 0 0;color:#9fb3c8;font-size:12px}
      .nav{display:flex;flex-direction:column;gap:8px}.nav button{border:0;background:transparent;color:#dbeafe;padding:13px 14px;border-radius:16px;text-align:right;display:flex;gap:10px;align-items:center;cursor:pointer;font-weight:800;font-size:14px}.nav button:hover{background:rgba(255,255,255,.08)}.nav button.active{background:#fff;color:#071525;box-shadow:0 14px 30px rgba(0,0,0,.18)}
      .note{margin-top:20px;color:#8ba4bc;font-size:11px;line-height:1.7}.main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}.top{height:78px;display:flex;align-items:center;justify-content:space-between;padding:18px 26px;background:rgba(255,255,255,.92);border-bottom:1px solid #d9e3ee}.top h2{margin:0;font-size:24px}.top p{margin:5px 0 0;color:#61738a;font-size:12px}.content{flex:1;overflow:auto;padding:22px 26px 34px}
      .grid{display:grid;gap:16px}.kpi{grid-template-columns:repeat(4,minmax(160px,1fr))}.two{grid-template-columns:1.1fr .9fr}.card{background:#fff;border:1px solid #dce6f1;border-radius:22px;box-shadow:0 16px 38px rgba(15,23,42,.07);overflow:hidden}.pad{padding:18px}.card h3{margin:0 0 12px;font-size:17px}.muted{color:#697b91;font-size:12px}.kbox{padding:18px;min-height:116px;display:flex;flex-direction:column;justify-content:space-between}.kbox span{color:#61738a;font-size:12px;font-weight:700}.kbox strong{font-size:28px;line-height:1;color:#0b1728}.pos{color:#047857!important}.neg{color:#b91c1c!important}.neutral{color:#475569!important}
      .bar{height:9px;border-radius:99px;background:#e2e8f0;overflow:hidden;min-width:110px}.bar i{display:block;height:100%;background:linear-gradient(90deg,#0b63ce,#1fc7b6)}.mini{display:grid;gap:10px}.item{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;background:#f8fbff;border:1px solid #e2ebf5;border-radius:16px}
      .tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.input,.select{border:1px solid #cbd8e7;background:#fff;color:#102033;border-radius:14px;padding:11px 13px;min-height:42px;outline:none;font-weight:700}.input{min-width:260px;flex:1}.btn{border:1px solid #cbd8e7;background:#fff;color:#0f2137;padding:10px 14px;border-radius:14px;font-weight:800;cursor:pointer}.btn.primary{background:#0b63ce;color:#fff;border-color:#0b63ce}
      .tablewrap{overflow:auto;border-radius:18px;border:1px solid #dbe5f0;background:#fff;max-height:calc(100vh - 250px)}table{width:100%;border-collapse:separate;border-spacing:0;min-width:900px}th{position:sticky;top:0;z-index:2;background:#f4f8fc;color:#42546b;font-size:12px;padding:13px 12px;border-bottom:1px solid #dbe5f0;text-align:right;white-space:nowrap}td{padding:12px;border-bottom:1px solid #eef3f8;color:#102033;font-size:13px;white-space:nowrap}tr:hover td{background:#f8fbff}.symbol{font-weight:900;color:#0b63ce;direction:ltr;display:inline-block;min-width:54px;text-align:left}.pill{display:inline-flex;align-items:center;justify-content:center;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:900;border:1px solid transparent}.cached{background:#e8f8f1;color:#047857;border-color:#b7efd9}.waiting{background:#fff7e6;color:#a45a00;border-color:#ffd99b}.failed{background:#feecec;color:#b91c1c;border-color:#fecaca}.info{background:#eaf2ff;color:#0b63ce;border-color:#cfe2ff}.pages{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap}
      .empty{padding:32px;text-align:center;color:#60758f;background:#f8fbff;border:1px dashed #cbd8e7;border-radius:18px}.alert{padding:13px 14px;border-radius:16px;border:1px solid #fed7aa;background:#fff7ed;color:#7c2d12;margin-bottom:10px;font-weight:800}.danger{border-color:#fecaca;background:#fff1f2;color:#991b1b}.chart{width:100%;height:360px;display:block;direction:ltr}
      @media(max-width:1050px){html,body{overflow:auto!important}#${ROOT_ID}{position:relative;min-height:100vh;flex-direction:column;overflow:auto}.egx-side{width:100%;flex:0 0 auto}.nav{flex-direction:row;overflow:auto}.nav button{min-width:150px;justify-content:center}.main{height:auto;overflow:visible}.content{overflow:visible;padding:16px}.kpi,.two{grid-template-columns:1fr}}
    `;
    document.head.appendChild(st);
  }

  const kpi = (l,v,s,c='') => `<div class="card kbox"><span>${esc(l)}</span><strong class="${c}">${esc(v)}</strong><small class="muted">${esc(s||'')}</small></div>`;
  const empty = m => `<div class="empty">${esc(m)}</div>`;
  const option = (v,l,sel) => `<option value="${esc(v)}" ${String(v)===String(sel)?'selected':''}>${esc(l)}</option>`;
  function status(s){s=String(s||'').toLowerCase(); if(s.includes('fail'))return '<span class="pill failed">فشل</span>'; if(s.includes('wait')||s.includes('missing'))return '<span class="pill waiting">ينتظر Batch</span>'; if(s.includes('cache'))return '<span class="pill cached">داخل الكاش</span>'; return '<span class="pill info">متاح</span>';}
  function topLine(){const h=S.data.health||{};return `الكون: ${fmt(first(h,['totalUniverse','configuredSymbols','parsedSymbols'],S.rows.length),0)} · داخل الكاش: ${fmt(first(h,['cacheRows','rowsRead','cachedSymbols'],S.rows.filter(r=>r.status==='cached').length),0)}`}
  function label(){return (tabs.find(t=>t[0]===S.tab)||tabs[0])[2]}

  function shell(){
    const root = document.getElementById(ROOT_ID) || document.body.appendChild(Object.assign(document.createElement('div'),{id:ROOT_ID}));
    root.innerHTML = `<aside class="egx-side"><div class="brand"><div class="logo">EGX</div><div><h1>EGX Pro Hub</h1><p>Unified Intelligence Workspace · ${VERSION}</p></div></div><nav class="nav">${tabs.map(t=>`<button data-tab="${t[0]}" class="${S.tab===t[0]?'active':''}"><span>${t[1]}</span><span>${t[2]}</span></button>`).join('')}</nav><div class="note">بيانات عامة ومتأخرة. التحليل للمراقبة والدراسة وليس أمر تداول.</div></aside><main class="main"><header class="top"><div><h2>${label()}</h2><p>${topLine()}</p></div><div><button class="btn" id="refresh">تحديث البيانات</button><button class="btn primary" data-tab="chart">فتح الشارت</button></div></header><section class="content" id="view"></section></main>`;
    root.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{S.tab=b.dataset.tab;S.page=1;shell();});
    root.querySelector('#refresh').onclick=async()=>{await load();shell();};
    view();
  }

  function filtered(){const q=S.q.trim().toLowerCase();return S.rows.filter(r=>{const txt=`${r.symbol} ${r.name} ${r.sector}`.toLowerCase();if(q&&!txt.includes(q))return false;if(S.sector!=='all'&&r.sector!==S.sector)return false;if(S.status==='cached'&&r.status!=='cached')return false;if(S.status==='waiting'&&!String(r.status).includes('waiting'))return false;if(S.status==='failed'&&!String(r.status).includes('failed'))return false;return true;});}

  function view(){
    const el=document.getElementById('view'); if(!el)return;
    const map={overview,market,sectors,investors,chart,news,health}; el.innerHTML=(map[S.tab]||overview)(); bind();
  }

  function overview(){const h=S.data.health||{};const total=num(first(h,['totalUniverse','configuredSymbols','parsedSymbols'],S.rows.length))||S.rows.length;const cached=num(first(h,['cacheRows','rowsRead','cachedSymbols'],S.rows.filter(r=>r.status==='cached').length))||0;const cov=total?cached/total*100:0;const ts=S.sectors[0];const newsCount=allNews().length;const top=[...S.rows].sort((a,b)=>(b.turnover||0)-(a.turnover||0)).slice(0,8);return `<div class="grid kpi">${kpi('كل أسهم السوق',fmt(total,0),'إجمالي الكون')}${kpi('داخل الكاش',fmt(cached,0),`تغطية ${fmt(cov,1)}%`,cov>=90?'pos':'neutral')}${kpi('أقوى قطاع سيولة',ts?ts.sector:'—',ts?`سيولة ${fmt(ts.turnover,0)}`:'')}${kpi('تنبيهات الأخبار',fmt(newsCount,0),newsCount?'تحتاج مراجعة':'لا توجد تنبيهات',newsCount?'neg':'pos')}</div><div class="grid two" style="margin-top:16px"><div class="card pad"><h3>أعلى الأسهم سيولة</h3><div class="mini">${top.map(r=>`<div class="item"><div><b class="symbol">${esc(r.symbol)}</b> ${esc(r.name)}</div><strong>${fmt(r.turnover||r.volume,0)}</strong></div>`).join('')||empty('لا توجد بيانات')}</div></div><div class="card pad"><h3>توزيع القطاعات</h3><div class="mini">${S.sectors.slice(0,8).map(sectorItem).join('')||empty('لا توجد بيانات')}</div></div></div>`;}
  function sectorItem(s){const t=S.sectors.reduce((a,b)=>a+(b.turnover||0),0);const p=t?(s.turnover||0)/t*100:(s.allocation||0);return `<div class="item"><span>${esc(s.sector)}</span><div style="display:flex;gap:10px;align-items:center"><div class="bar"><i style="width:${Math.max(3,Math.min(100,p))}%"></i></div><b>${fmt(p,1)}%</b></div></div>`}

  function market(){const sectors=[...new Set(S.rows.map(r=>r.sector).filter(Boolean))].sort();const rows=filtered();const pages=Math.max(1,Math.ceil(rows.length/S.size));if(S.page>pages)S.page=pages;const start=(S.page-1)*S.size;const page=rows.slice(start,start+S.size);return `<div class="card pad"><div class="tools"><input class="input" id="q" placeholder="بحث بالرمز أو الاسم أو القطاع" value="${esc(S.q)}"><select class="select" id="st">${option('all','كل الحالات',S.status)}${option('cached','داخل الكاش',S.status)}${option('waiting','ينتظر Batch',S.status)}${option('failed','فشل قراءة',S.status)}</select><select class="select" id="sec">${option('all','كل القطاعات',S.sector)}${sectors.map(x=>option(x,x,S.sector)).join('')}</select><select class="select" id="size">${[25,50,100,250].map(n=>option(n,`${n} سهم`,S.size)).join('')}</select></div>${table(page)}<div class="pages"><div class="muted">عرض ${fmt(start+1,0)} - ${fmt(Math.min(start+S.size,rows.length),0)} من ${fmt(rows.length,0)}</div><div><button class="btn" id="prev" ${S.page<=1?'disabled':''}>السابق</button><span class="muted" style="padding:0 10px">صفحة ${fmt(S.page,0)} / ${fmt(pages,0)}</span><button class="btn" id="next" ${S.page>=pages?'disabled':''}>التالي</button></div></div></div>`;}
  function table(rows){return `<div class="tablewrap"><table><thead><tr><th>السهم</th><th>الاسم</th><th>القطاع</th><th>السعر</th><th>التغير</th><th>الحجم</th><th>السيولة</th><th>الحالة</th><th>شارت</th></tr></thead><tbody>${rows.map(r=>`<tr><td><span class="symbol">${esc(r.symbol)}</span></td><td>${esc(r.name)}</td><td>${esc(r.sector)}</td><td>${fmt(r.price)}</td><td class="${sign(r.change)}">${pct(r.change)}</td><td>${fmt(r.volume,0)}</td><td>${fmt(r.turnover,0)}</td><td>${status(r.status)}</td><td><button class="btn" data-chart="${esc(r.symbol)}">فتح</button></td></tr>`).join('')||`<tr><td colspan="9">${empty('لا توجد نتائج')}</td></tr>`}</tbody></table></div>`}

  function sectors(){const total=S.sectors.reduce((a,b)=>a+(b.turnover||0),0);return `<div class="grid two"><div class="card pad"><h3>ترتيب القطاعات حسب السيولة</h3><div class="tablewrap"><table><thead><tr><th>القطاع</th><th>عدد الأسهم</th><th>السيولة</th><th>الحجم</th><th>النصيب</th><th>توزيع مقترح</th></tr></thead><tbody>${S.sectors.map(s=>{const p=total?(s.turnover||0)/total*100:(s.allocation||0);return `<tr><td><b>${esc(s.sector)}</b></td><td>${fmt(s.stocks,0)}</td><td>${fmt(s.turnover,0)}</td><td>${fmt(s.volume,0)}</td><td>${fmt(p,1)}%</td><td>${fmt(s.allocation||p,1)}%</td></tr>`}).join('')||`<tr><td colspan="6">${empty('لا توجد بيانات')}</td></tr>`}</tbody></table></div></div><div class="card pad"><h3>توزيع السيولة</h3><div class="mini">${S.sectors.slice(0,12).map(sectorItem).join('')||empty('لا توجد بيانات')}</div></div></div>`;}

  function investors(){const r=S.data.investors||{};const rows=arr(r);const needs=String(first(r,['status','sourceStatus','state'],rows.length?'ready':'needs_source')).includes('needs');return `<div class="grid two"><div class="card pad"><h3>نوع المتعاملين</h3>${needs?'<div class="alert">بيانات نوع المتعاملين غير متاحة آليًا حاليًا من المصدر.</div>':''}<div class="tablewrap"><table><thead><tr><th>الفئة</th><th>شراء</th><th>بيع</th><th>صافي</th><th>تأثير</th></tr></thead><tbody>${rows.map(x=>{const buy=num(first(x,['buy','buyValue','purchases']));const sell=num(first(x,['sell','sellValue','sales']));const net=num(first(x,['net','netValue'],(buy||0)-(sell||0)));return `<tr><td><b>${esc(first(x,['category','type','name','label'],'—'))}</b></td><td>${fmt(buy,0)}</td><td>${fmt(sell,0)}</td><td class="${sign(net)}">${fmt(net,0)}</td><td>${net>0?'دعم':net<0?'ضغط':'محايد'}</td></tr>`}).join('')||`<tr><td colspan="5">${empty('لا توجد بيانات نوع متعاملين بعد')}</td></tr>`}</tbody></table></div></div><div class="card pad"><h3>قراءة مختصرة</h3><div class="mini"><div class="item"><span>إشارة السوق</span><b>${esc(first(r,['signal','marketSignal','summary'],'تظهر القراءة فور توفر البيانات'))}</b></div><div class="item"><span>عدد الفئات</span><b>${fmt(rows.length,0)}</b></div></div></div></div>`;}

  function chart(){const symbols=S.rows.map(r=>r.symbol);const row=S.rows.find(r=>r.symbol===S.symbol)||{};const pts=hist(S.symbol,S.range);return `<div class="card pad"><div class="tools"><select class="select" id="cs">${symbols.map(s=>option(s,`${s} — ${(S.rows.find(r=>r.symbol===s)||{}).name||s}`,S.symbol)).join('')}</select><select class="select" id="cr">${option('20','آخر 20 جلسة',S.range)}${option('50','آخر 50 جلسة',S.range)}${option('all','كل المتاح',S.range)}</select><span class="pill info">${esc(row.name||'')}</span><span class="pill ${sign(row.change)}">${pct(row.change)}</span></div><div class="card pad">${pts.length>=2?svg(pts,S.symbol):empty('لا توجد نقاط تاريخية كافية لهذا السهم حتى الآن. سيكتمل الشارت مع تشغيلات الـ Workflow القادمة.')}</div></div><div class="card pad" style="margin-top:16px"><h3>المؤشرات الفنية</h3>${tech(S.symbol)}</div>`;}
  function hist(code,range){const h=S.data.history||{};let a=[];if(Array.isArray(h))a=h.filter(x=>sym(first(x,['symbol','code','ticker']))===code);else if(h&&typeof h==='object')a=h[code]||h[code.toLowerCase()]||arr(h).filter(x=>sym(first(x,['symbol','code','ticker']))===code);a=(a||[]).map((p,i)=>({date:first(p,['date','session','day','t'],String(i+1)),close:num(first(p,['close','price','last','value'])),volume:num(first(p,['volume','tradedVolume','qty']))||0})).filter(p=>p.close!==null).sort((a,b)=>String(a.date).localeCompare(String(b.date)));if(range!=='all')a=a.slice(-Number(range));return a;}
  function svg(p,code){const w=980,h=360,L=46,R=18,T=22,CH=230,VT=274,VH=54;const pr=p.map(x=>x.close),vo=p.map(x=>x.volume||0),mn=Math.min(...pr),mx=Math.max(...pr),vm=Math.max(...vo,1);const x=i=>L+(i/Math.max(1,p.length-1))*(w-L-R);const y=v=>T+(mx===mn?.5:(mx-v)/(mx-mn))*CH;const line=p.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(2)} ${y(d.close).toFixed(2)}`).join(' ');const area=`${line} L ${x(p.length-1)} ${T+CH} L ${x(0)} ${T+CH} Z`;const grid=[0,.25,.5,.75,1].map(t=>{const yy=T+t*CH,val=mx-t*(mx-mn);return `<line x1="${L}" y1="${yy}" x2="${w-R}" y2="${yy}" stroke="#d9e3ee"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#64748b">${fmt(val)}</text>`}).join('');const bars=p.map((d,i)=>{const bw=Math.max(3,(w-L-R)/p.length*.58),bh=((d.volume||0)/vm)*VH;return `<rect x="${x(i)-bw/2}" y="${VT+VH-bh}" width="${bw}" height="${bh}" rx="2" fill="#94a3b8" opacity=".55"/>`}).join('');const last=p[p.length-1],firstp=p[0],chg=firstp.close?((last.close-firstp.close)/firstp.close)*100:0;return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="egxArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0b63ce" stop-opacity=".28"/><stop offset="100%" stop-color="#0b63ce" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="#fff"/><text x="${w-R}" y="18" text-anchor="end" font-size="14" font-weight="800" fill="#0b1728">${esc(code)} · ${fmt(last.close)} · ${pct(chg)}</text>${grid}<path d="${area}" fill="url(#egxArea)"/><path d="${line}" fill="none" stroke="#0b63ce" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${bars}<line x1="${L}" y1="${VT+VH}" x2="${w-R}" y2="${VT+VH}" stroke="#d9e3ee"/><text x="${L}" y="348" font-size="12" fill="#64748b">${esc(String(firstp.date).slice(0,10))}</text><text x="${w-R}" y="348" text-anchor="end" font-size="12" fill="#64748b">${esc(String(last.date).slice(0,10))}</text></svg>`;}
  function tech(code){let rows=arr(S.data.tech),item=rows.find(x=>sym(first(x,['symbol','code','ticker']))===code);if(!item&&S.data.tech&&typeof S.data.tech==='object')item=S.data.tech[code]||S.data.tech[code.toLowerCase()];if(!item)return empty('لا توجد مؤشرات فنية كافية لهذا السهم');return `<div class="grid kpi">${[['SMA20',first(item,['sma20','SMA20'])],['SMA50',first(item,['sma50','SMA50'])],['دعم',first(item,['support','support1'])],['مقاومة',first(item,['resistance','resistance1'])],['تذبذب',first(item,['volatility'])],['الثقة',first(item,['confidence','score'])]].map(x=>kpi(x[0],fmt(x[1]),'')).join('')}</div>`}

  function allNews(){return [...arr(S.data.alerts),...arr(S.data.news)];}
  function news(){const n=allNews();return `<div class="card pad"><h3>الأخبار والتنبيهات</h3>${n.length?n.slice(0,80).map(x=>{const title=first(x,['title','headline','summary','text'],'خبر');const src=first(x,['source','publisher','site'],'مصدر عام');const imp=first(x,['impact','level','severity'],'متابعة');const url=first(x,['url','link'],'');return `<div class="alert ${String(imp).toLowerCase().includes('high')||String(imp).includes('عالي')?'danger':''}"><b>${esc(title)}</b><br><span class="muted">${esc(src)} · ${esc(imp)}</span>${url?` · <a href="${esc(url)}" target="_blank" rel="noopener">فتح</a>`:''}</div>`}).join(''):empty('لا توجد أخبار مؤثرة مجمعة حاليًا')}</div>`;}
  function health(){const h=S.data.health||{},a=S.data.audit||{};const waiting=Array.isArray(a.waitingNextBatch)?a.waitingNextBatch.length:Array.isArray(a.missingFromCache)?a.missingFromCache.length:0;const failed=Array.isArray(a.failedSymbols)?a.failedSymbols.length:0;return `<div class="grid kpi">${kpi('Total Universe',fmt(first(h,['totalUniverse','configuredSymbols','parsedSymbols'],S.rows.length),0),'')}${kpi('Cache Rows',fmt(first(h,['cacheRows','rowsRead','cachedSymbols'],S.rows.filter(r=>r.status==='cached').length),0),'')}${kpi('Waiting Batch',fmt(waiting,0),'')}${kpi('Failed Symbols',fmt(failed,0),failed?'تحتاج مراجعة':'لا توجد أخطاء',failed?'neg':'pos')}</div><div class="card pad" style="margin-top:16px"><h3>حالة الملفات</h3><div class="mini">${Object.keys(PATHS).map(k=>`<div class="item"><span>${esc(k)}</span><b class="${S.data[k]&&!S.data[k].__error?'pos':'neg'}">${S.data[k]&&!S.data[k].__error?'متاح':'غير متاح'}</b></div>`).join('')}</div></div>`;}

  function bind(){const root=document.getElementById(ROOT_ID);const q=root.querySelector('#q');if(q)q.oninput=e=>{S.q=e.target.value;S.page=1;view()};const st=root.querySelector('#st');if(st)st.onchange=e=>{S.status=e.target.value;S.page=1;view()};const sec=root.querySelector('#sec');if(sec)sec.onchange=e=>{S.sector=e.target.value;S.page=1;view()};const sz=root.querySelector('#size');if(sz)sz.onchange=e=>{S.size=Number(e.target.value)||50;S.page=1;view()};const prev=root.querySelector('#prev');if(prev)prev.onclick=()=>{S.page=Math.max(1,S.page-1);view()};const next=root.querySelector('#next');if(next)next.onclick=()=>{S.page++;view()};const cs=root.querySelector('#cs');if(cs)cs.onchange=e=>{S.symbol=e.target.value;view()};const cr=root.querySelector('#cr');if(cr)cr.onchange=e=>{S.range=e.target.value;view()};root.querySelectorAll('[data-chart]').forEach(b=>b.onclick=()=>{S.symbol=b.dataset.chart;S.tab='chart';shell()});}

  let started=false; async function init(){if(started)return;started=true;css();const root=document.getElementById(ROOT_ID)||document.body.appendChild(Object.assign(document.createElement('div'),{id:ROOT_ID}));root.innerHTML='<div style="margin:auto;text-align:center;font-family:Tahoma,Arial"><b>جاري تحميل EGX Pro Hub...</b><br><span style="color:#64748b">V5.6.1</span></div>';await load();shell();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,250));else setTimeout(init,250);setTimeout(init,1500);
})();
