/* EGX Pro Hub V5.6.7 — Rescue Unified Shell
   Purpose: recover from blank screen caused by older panels / hard-mode interactions.
   UI-only patch. Reads existing data/*.json. Does not write or reset cache/state.
*/
(function () {
  'use strict';

  const ROOT_ID = 'egx-v56-hard-root';
  const STYLE_ID = 'egx-v567-rescue-style';
  const THEME_KEY = 'egx-theme-mode-v567';
  const D = {
    market: 'data/market.json',
    cache: 'data/full-market-cache.json',
    recs: 'data/recommendations.json',
    pro: 'data/pro-report.json',
    tech: 'data/technical-50-report.json',
    health: 'data/source-health.json',
    universe: 'data/universe-index.json',
    audit: 'data/symbol-audit.json',
    sectors: 'data/sector-report.json',
    investors: 'data/investor-flow-report.json',
    risk: 'data/risk-dashboard.json',
    news: 'data/smart-news-report.json',
    alerts: 'data/alerts-v56-news.json',
    history: 'data/history-50.json'
  };

  const AR_DIGITS = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
  const en = v => String(v ?? '').replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d] || d);
  const esc = v => en(String(v ?? '')).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const sym = v => String(v || '').trim().toUpperCase();
  const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? (x.rows || x.data || x.items || x.market || x.cache || x.recommendations || x.opportunities || x.list || x.records || []) : []);
  const first = (o, keys, fb = '') => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return fb; };
  const num = (v, fb = 0) => {
    if (typeof v === 'number' && isFinite(v)) return v;
    const n = Number(en(v).replace(/[%،,\s]/g, '').replace(/[^0-9.+-]/g, ''));
    return isFinite(n) ? n : fb;
  };
  const clamp = (n,a,b) => Math.max(a, Math.min(b, n));
  const fmt = (v, d = 2) => { const n = num(v, NaN); return isFinite(n) ? n.toLocaleString('en-US', {maximumFractionDigits:d, minimumFractionDigits: n % 1 ? Math.min(d,2) : 0}) : '—'; };
  const pct = v => { const n = num(v, NaN); return isFinite(n) ? `${n > 0 ? '+' : ''}${n.toLocaleString('en-US',{maximumFractionDigits:2})}%` : '—'; };
  const signClass = v => num(v,0) > 0 ? 'pos' : (num(v,0) < 0 ? 'neg' : 'neutral');

  async function loadJson(path, fallback) {
    try {
      const r = await fetch(path + '?v=' + Date.now(), {cache: 'no-store'});
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return await r.json();
    } catch (e) {
      console.warn('[EGX V5.6.7]', path, e.message || e);
      return fallback;
    }
  }

  function bySymbol(data) {
    const m = new Map();
    arr(data).forEach(x => {
      const s = sym(first(x, ['symbol','code','ticker','Symbol','SYMBOL','securityCode','id']));
      if (s) m.set(s, {...(m.get(s) || {}), ...x});
    });
    return m;
  }

  function levels(r) {
    const price = num(first(r, ['price','last','lastPrice','close','currentPrice'], 0), 0);
    let support = num(first(r, ['support','support1','s1','nearestSupport'], 0), 0);
    let resistance = num(first(r, ['resistance','resistance1','r1','nearestResistance'], 0), 0);
    if (!support && price) support = price * 0.965;
    if (!resistance && price) resistance = price * 1.055;
    const entryLow = num(first(r, ['entryLow','entryMin','buyFrom'], 0), 0) || (price ? Math.min(price, support * 1.015) : 0);
    const entryHigh = num(first(r, ['entryHigh','entryMax','buyTo'], 0), 0) || (price ? Math.max(price, support * 1.035) : 0);
    const target1 = num(first(r, ['target1','firstTarget','tp1'], 0), 0) || resistance;
    const target2 = num(first(r, ['target2','secondTarget','tp2'], 0), 0) || (target1 ? target1 * 1.06 : 0);
    const target3 = num(first(r, ['target3','thirdTarget','tp3'], 0), 0) || (target2 ? target2 * 1.055 : 0);
    const stop = num(first(r, ['stopLoss','stop','riskStop'], 0), 0) || (support ? support * 0.975 : (price ? price * 0.94 : 0));
    return {price, support, resistance, entryLow, entryHigh, target1, target2, target3, stop};
  }

  function techScore(r) {
    let s = 48;
    const ch = num(first(r, ['changePct','changePercent','percentChange','change'], 0), 0);
    if (ch > 0) s += clamp(ch * 3, 0, 22);
    if (ch < 0) s += clamp(ch * 2, -16, 0);
    if (num(first(r, ['volume','tradedVolume'], 0), 0) > 0) s += 7;
    if (num(first(r, ['liquidity','turnover','tradedValue','value'], 0), 0) > 0) s += 8;
    if (first(r, ['support','resistance','support1','resistance1'], '')) s += 9;
    const rsi = num(first(r, ['rsi','RSI'], NaN), NaN);
    if (isFinite(rsi) && rsi >= 45 && rsi <= 68) s += 8;
    if (isFinite(rsi) && rsi > 78) s -= 10;
    return clamp(s, 0, 100);
  }

  function dataQuality(r, health) {
    const explicit = num(first(r, ['dataQuality','quality','avgDataQuality'], NaN), NaN);
    if (isFinite(explicit) && explicit > 0) return clamp(explicit, 0, 100);
    let s = 40;
    if (first(r, ['price','last','lastPrice','close'], '')) s += 16;
    if (first(r, ['volume','tradedVolume'], '')) s += 12;
    if (first(r, ['liquidity','turnover','tradedValue','value'], '')) s += 12;
    if (first(r, ['support','resistance','support1','resistance1'], '')) s += 12;
    const avg = num(first(health, ['avgDataQuality'], 0), 0);
    if (avg) s = Math.max(s, avg * 0.82);
    return clamp(s, 0, 100);
  }

  function newsImpact(symbol, sector, data) {
    const all = [...arr(data.news), ...arr(data.alerts), ...arr(data.news && data.news.alerts), ...arr(data.alerts && data.alerts.items)];
    const s = sym(symbol).toLowerCase();
    const sec = String(sector || '').toLowerCase();
    let score = 0, reasons = [];
    const words = ['استحواذ','توزيعات','أرباح','نتائج','زيادة رأس المال','خفض رأس المال','أسهم خزينة','صفقة','تخارج','طرح','فائدة','تضخم','تعويم'];
    for (const it of all) {
      const txt = `${first(it, ['symbol','symbols'], '')} ${first(it, ['sector'], '')} ${first(it, ['title','headline','summary','text','description'], '')}`.toLowerCase();
      if (!txt) continue;
      const hitSym = s && txt.includes(s), hitSec = sec && txt.includes(sec), hitWord = words.some(w => txt.includes(w.toLowerCase()));
      if (hitSym || hitSec || hitWord) {
        score += hitSym ? 30 : (hitSec ? 12 : 6);
        const imp = num(first(it, ['impactScore','score','priority'], 0), 0);
        if (imp) score += clamp(imp, 0, 30);
        if (hitSym || hitSec) reasons.push(first(it, ['title','headline','summary'], 'خبر مؤثر'));
      }
    }
    return {score: clamp(score, 0, 100), reason: reasons.slice(0, 2).join(' | ')};
  }

  function buildRows(data) {
    const maps = [bySymbol(data.cache), bySymbol(data.market), bySymbol(data.recs), bySymbol(data.pro), bySymbol(data.tech), bySymbol(data.universe)];
    const symbols = new Set(maps.flatMap(m => [...m.keys()]));
    return [...symbols].map(s => {
      const r = {symbol: s};
      maps.forEach(m => Object.assign(r, m.get(s) || {}));
      r.symbol = s;
      r.name = first(r, ['name_ar','nameAr','arabicName','name','companyName','nameEn','company'], s);
      r.sector = first(r, ['sector','sectorName','industry'], 'غير مصنف');
      r.price = first(r, ['price','last','lastPrice','close','currentPrice'], 0);
      r.changePct = first(r, ['changePct','changePercent','percentChange','change'], 0);
      r.volume = first(r, ['volume','tradedVolume'], 0);
      r.liquidity = first(r, ['liquidity','turnover','tradedValue','value'], 0);
      const lv = levels(r);
      const conf = clamp(num(first(r, ['confidence','confidenceScore','score','trust'], 0), 0) || techScore(r), 0, 100);
      const qual = dataQuality(r, data.health || {});
      const tech = clamp(num(first(r, ['technicalScore','technical','taScore'], 0), 0) || techScore(r), 0, 100);
      const financial = clamp(num(first(r, ['financialScore','fundamentalScore','faScore'], 0), 0) || (50 + (num(r.liquidity,0) > 0 ? 10 : 0)), 0, 100);
      const news = newsImpact(s, r.sector, data);
      const liq = clamp(num(r.liquidity, 0) > 0 ? 70 : 45, 0, 100);
      const priority = clamp(conf * .30 + qual * .20 + tech * .22 + financial * .10 + news.score * .10 + liq * .08, 0, 100);
      let recommendation = first(r, ['recommendation','action','signal','decision'], '');
      if (!recommendation) recommendation = priority >= 82 ? 'مراقبة لشراء' : priority >= 70 ? 'مراقبة قوية' : priority >= 58 ? 'مراقبة' : (num(r.changePct,0) < -4 ? 'تخفيف' : 'انتظار تأكيد');
      const reason = first(r, ['reason','recommendationReason','why','commentary'], '') || [
        conf >= 75 ? 'ثقة مرتفعة' : '',
        qual >= 75 ? 'جودة بيانات جيدة' : '',
        tech >= 70 ? 'إشارة فنية إيجابية' : '',
        financial >= 65 ? 'دعم مالي/أساسي مقبول' : '',
        news.score >= 35 ? (news.reason || 'خبر مؤثر') : '',
        num(r.liquidity,0) > 0 ? 'سيولة قابلة للمتابعة' : ''
      ].filter(Boolean).join('، ') || 'مراقبة مشروطة بتأكيد الاتجاه والسيولة.';
      return {...r, ...lv, confidence: conf, dataQuality: qual, technicalScore: tech, financialScore: financial, newsScore: news.score, priority, recommendation, reason};
    }).filter(r => r.symbol && num(r.price, 0) > 0).sort((a,b) => b.priority - a.priority || b.confidence - a.confidence || b.dataQuality - a.dataQuality);
  }

  function css() {
    document.getElementById(STYLE_ID)?.remove();
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
      html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;direction:rtl!important;background:var(--bg)!important;color:var(--text)!important}
      body.egx-light{--bg:#eef4f8;--panel:#fff;--panel2:#f7fafc;--text:#0f172a;--muted:#64748b;--border:#d8e2ea;--accent:#0f6bdc;--good:#00875a;--bad:#c9372c;--warn:#b7791f;--shadow:0 16px 42px rgba(15,23,42,.09)}
      body.egx-dark{--bg:#07111f;--panel:#0b1626;--panel2:#111d2f;--text:#e6edf7;--muted:#9fb0c7;--border:#21344f;--accent:#4aa3ff;--good:#31d095;--bad:#ff6b6b;--warn:#ffd166;--shadow:0 16px 60px rgba(0,0,0,.35)}
      body>*:not(#${ROOT_ID}):not(script):not(style):not(link):not(meta):not(title){display:none!important;visibility:hidden!important;pointer-events:none!important}
      #${ROOT_ID},#${ROOT_ID} *{box-sizing:border-box;font-family:Inter,Tahoma,Arial,sans-serif;font-variant-numeric:tabular-nums}#${ROOT_ID}{position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;background:var(--bg)!important;color:var(--text)!important;direction:rtl;overflow:hidden!important;visibility:visible!important;opacity:1!important}
      .side{width:270px;flex:0 0 270px;background:linear-gradient(180deg,#061426,#0c2137 55%,#0b1829);color:#eaf4ff;padding:20px 14px;overflow:auto;border-left:1px solid rgba(255,255,255,.08);box-shadow:-16px 0 36px rgba(15,23,42,.2)}.brand{display:flex;gap:10px;align-items:center;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,.12)}.logo{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#1fc7b6,#b7d12c);display:grid;place-items:center;font-weight:900;color:#062032}.brand h1{margin:0;font-size:20px;line-height:1.05}.brand p{margin:4px 0 0;color:#9fb3c8;font-size:11px}.nav{display:flex;flex-direction:column;gap:7px}.nav button{border:0;background:transparent;color:#dbeafe;padding:12px 13px;border-radius:14px;text-align:right;display:flex;gap:8px;align-items:center;cursor:pointer;font-weight:800;font-size:13px}.nav button:hover{background:rgba(255,255,255,.08)}.nav button.active{background:#fff;color:#071525;box-shadow:0 10px 22px rgba(0,0,0,.18)}.note{margin-top:18px;color:#8ba4bc;font-size:11px;line-height:1.7}
      .main{flex:1;min-width:0;display:flex;flex-direction:column;height:100vh;overflow:hidden}.top{height:76px;display:flex;align-items:center;justify-content:space-between;padding:15px 24px;background:color-mix(in srgb,var(--panel) 92%,transparent);border-bottom:1px solid var(--border)}.top h2{margin:0;font-size:22px}.top p{margin:4px 0 0;color:var(--muted);font-size:12px}.top-actions{display:flex;gap:8px;flex-wrap:wrap}.btn,.input,.select{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:12px;padding:9px 11px;font-size:12px;font-weight:700;outline:none}.btn{cursor:pointer}.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.content{flex:1;overflow:auto;padding:20px 24px 34px}.grid{display:grid;gap:14px}.kpis{grid-template-columns:repeat(5,minmax(130px,1fr))}.kpi{background:var(--panel);border:1px solid var(--border);border-radius:18px;padding:13px 15px;box-shadow:var(--shadow)}.kpi b{display:block;font-size:24px;line-height:1;color:var(--text)}.kpi span{display:block;margin-top:8px;color:var(--muted);font-size:12px;font-weight:700}.card{background:var(--panel);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.pad{padding:16px}.tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.tablewrap{overflow:auto;max-height:calc(100vh - 260px);border-top:1px solid var(--border)}table{width:100%;border-collapse:collapse;min-width:1540px}th,td{border-bottom:1px solid var(--border);padding:10px 11px;text-align:right;white-space:nowrap;font-size:12px}th{position:sticky;top:0;background:var(--panel2);z-index:2;color:var(--muted);font-weight:900}td{color:var(--text)}.symbol{font-weight:900;color:var(--accent);direction:ltr;display:inline-block}.num{direction:ltr;text-align:left}.pos{color:var(--good)!important}.neg{color:var(--bad)!important}.neutral{color:var(--muted)!important}.pill{display:inline-flex;border-radius:999px;padding:6px 9px;font-weight:900;font-size:11px;border:1px solid var(--border);white-space:nowrap}.buy{color:var(--good);background:color-mix(in srgb,var(--good) 12%,transparent)}.wait{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}.exit{color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}.bar{height:7px;background:var(--border);border-radius:999px;overflow:hidden;margin-top:5px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--warn),var(--good));border-radius:999px}.reason{color:var(--muted);line-height:1.55;min-width:260px;max-width:420px;white-space:normal}.empty{padding:34px;text-align:center;color:var(--muted)}.mini{display:grid;gap:10px}.item{display:flex;justify-content:space-between;gap:12px;padding:12px 13px;border:1px solid var(--border);border-radius:14px;background:var(--panel2)}.alert{padding:12px 13px;border:1px solid var(--border);border-radius:14px;background:var(--panel2);margin-bottom:9px;line-height:1.65}.chart{width:100%;height:420px;border:1px solid var(--border);border-radius:16px;overflow:hidden;background:#fff}.footer{padding:9px 14px;color:var(--muted);font-size:11px;border-top:1px solid var(--border)}
      @media(max-width:900px){.side{width:84px;flex-basis:84px}.brand h1,.brand p,.nav span,.note{display:none}.nav button{justify-content:center}.kpis{grid-template-columns:repeat(2,1fr)}.top{height:auto;align-items:flex-start;flex-direction:column}.input{width:100%}}
    `;
    document.head.appendChild(st);
  }

  function setTheme(mode) {
    const m = mode === 'dark' ? 'dark' : 'light';
    document.body.classList.toggle('egx-dark', m === 'dark');
    document.body.classList.toggle('egx-light', m === 'light');
    localStorage.setItem(THEME_KEY, m);
    const btn = document.querySelector('[data-theme-toggle]');
    if (btn) btn.textContent = m === 'dark' ? '☀️ الوضع النهاري' : '🌙 الوضع الليلي';
  }

  const state = {tab:'opps', q:'', action:'all', limit:50, rows:[], data:{}, chart:''};
  const tabs = [
    ['overview','🏠','لوحة السوق'], ['ranking','🏆','ترتيب السوق'], ['opps','🎯','قائمة الفرص'], ['portfolio','💼','إدارة المحفظة'],
    ['market','📋','كل السوق'], ['sectors','🏭','القطاعات'], ['investors','👥','نوع المتعاملين'], ['chart','📈','Chart Lab'],
    ['news','📰','الأخبار'], ['alerts','🚨','التنبيهات'], ['reports','📑','التقارير'], ['health','✅','صحة البيانات']
  ];

  function shell() {
    let root = document.getElementById(ROOT_ID);
    if (!root) { root = document.createElement('div'); root.id = ROOT_ID; document.body.appendChild(root); }
    root.innerHTML = `<aside class="side"><div class="brand"><div class="logo">EGX</div><div><h1>EGX<br>Pro Hub</h1><p>Unified Intelligence V5.6.7</p></div></div><nav class="nav">${tabs.map(t => `<button data-tab="${t[0]}" class="${state.tab===t[0]?'active':''}"><b>${t[1]}</b><span>${t[2]}</span></button>`).join('')}</nav><div class="note">بيانات عامة ومتأخرة. الترشيحات تحليل ومراقبة وليست أوامر تداول.</div></aside><main class="main"><header class="top"><div><h2>${tabs.find(t=>t[0]===state.tab)?.[2] || 'EGX Pro Hub'}</h2><p>واجهة إنقاذ موحدة تمنع الشاشة البيضاء وتجمع الأدوات المهمة في مكان واحد.</p></div><div class="top-actions"><button class="btn" data-theme-toggle>🌙 الوضع الليلي</button><button class="btn primary" data-refresh>تحديث العرض</button></div></header><section class="content" id="egx-v567-content"></section></main>`;
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; shell(); view(); });
    root.querySelector('[data-refresh]').onclick = () => boot(true);
    root.querySelector('[data-theme-toggle]').onclick = () => setTheme(document.body.classList.contains('egx-dark') ? 'light' : 'dark');
    setTheme(localStorage.getItem(THEME_KEY) || 'light');
  }

  function opportunityTable(rows, heading='قائمة الفرص') {
    let list = rows;
    const q = state.q.trim().toLowerCase();
    if (q) list = list.filter(r => `${r.symbol} ${r.name} ${r.recommendation} ${r.reason}`.toLowerCase().includes(q));
    if (state.action !== 'all') list = list.filter(r => String(r.recommendation).includes(state.action));
    list = list.slice(0, state.limit);
    return `<div class="card"><div class="pad"><div class="tools"><input class="input" data-q placeholder="بحث بالرمز أو الاسم أو سبب التوصية" value="${esc(state.q)}"><select class="select" data-action><option value="all">كل التوصيات</option><option value="شراء">مراقبة لشراء</option><option value="قوية">مراقبة قوية</option><option value="مراقبة">مراقبة</option><option value="انتظار">انتظار / تأكيد</option><option value="تخفيف">تخفيف</option><option value="خروج">خروج</option></select><select class="select" data-limit><option value="25">Top 25</option><option value="50">Top 50</option><option value="100">Top 100</option><option value="250">Top 250</option></select></div><b>${esc(heading)}</b><p style="margin:6px 0 0;color:var(--muted);font-size:12px">مرتبة تنازليًا حسب الثقة، جودة البيانات، التحليل الفني، التحليل المالي، الأخبار والسيولة.</p></div><div class="tablewrap"><table><thead><tr><th>#</th><th>الرمز</th><th>الاسم</th><th>التوصية</th><th>الأولوية</th><th>الثقة</th><th>جودة البيانات</th><th>فني</th><th>مالي</th><th>أخبار</th><th>آخر سعر</th><th>التغير</th><th>السيولة</th><th>التداول</th><th>الدعم</th><th>المقاومة</th><th>سعر الدخول</th><th>الأهداف</th><th>وقف الخسارة</th><th>سبب التوصية</th></tr></thead><tbody>${list.map((r,i)=>rowHtml(r,i)).join('') || `<tr><td colspan="20"><div class="empty">لا توجد نتائج مطابقة.</div></td></tr>`}</tbody></table></div><div class="footer">الأرقام بصيغة 123456789. لا يوجد عمود القطاع أو الحالة في قائمة الفرص.</div></div>`;
  }

  function rowHtml(r,i) {
    const recClass = /خروج|تخفيف|بيع/.test(r.recommendation) ? 'exit' : (/انتظار/.test(r.recommendation) ? 'wait' : 'buy');
    return `<tr><td class="num">${i+1}</td><td><span class="symbol">${esc(r.symbol)}</span></td><td>${esc(r.name)}</td><td><span class="pill ${recClass}">${esc(r.recommendation)}</span></td><td class="num">${fmt(r.priority,0)}<div class="bar"><i style="width:${clamp(r.priority,0,100)}%"></i></div></td><td class="num">${fmt(r.confidence,0)}%</td><td class="num">${fmt(r.dataQuality,0)}%</td><td class="num">${fmt(r.technicalScore,0)}%</td><td class="num">${fmt(r.financialScore,0)}%</td><td class="num">${fmt(r.newsScore,0)}%</td><td class="num">${fmt(r.price,2)}</td><td class="num ${signClass(r.changePct)}">${pct(r.changePct)}</td><td class="num">${fmt(r.liquidity,0)}</td><td class="num">${fmt(r.volume,0)}</td><td class="num">${fmt(r.support,2)}</td><td class="num">${fmt(r.resistance,2)}</td><td class="num">${fmt(r.entryLow,2)} - ${fmt(r.entryHigh,2)}</td><td class="num">${fmt(r.target1,2)} / ${fmt(r.target2,2)} / ${fmt(r.target3,2)}</td><td class="num neg">${fmt(r.stop,2)}</td><td><div class="reason">${esc(r.reason)}</div></td></tr>`;
  }

  function kpis() {
    const h = state.data.health || {};
    const r = state.rows;
    const high = r.filter(x => x.priority >= 75).length;
    return `<div class="grid kpis"><div class="kpi"><b>${fmt(first(h,['totalUniverse','configuredSymbols'], r.length),0)}</b><span>إجمالي الكون</span></div><div class="kpi"><b>${fmt(first(h,['cacheRows','rowsRead'], r.length),0)}</b><span>داخل الكاش</span></div><div class="kpi"><b>${fmt(r.length,0)}</b><span>أسهم قابلة للترتيب</span></div><div class="kpi"><b>${fmt(high,0)}</b><span>فرص أولوية مرتفعة</span></div><div class="kpi"><b>${fmt(r.reduce((s,x)=>s+x.priority,0)/Math.max(1,r.length),0)}%</b><span>متوسط الأولوية</span></div></div>`;
  }

  function sectorsView() {
    const sectors = arr(state.data.sectors);
    if (!sectors.length) return `<div class="card pad">${kpis()}<div class="empty">تقرير القطاعات غير متاح أو لم يتولد بعد.</div></div>`;
    return `<div class="card"><div class="pad"><h3>تقرير القطاعات والسيولة</h3></div><div class="tablewrap"><table style="min-width:900px"><thead><tr><th>القطاع</th><th>عدد الأسهم</th><th>السيولة</th><th>الحجم</th><th>النصيب</th><th>توزيع مقترح</th></tr></thead><tbody>${sectors.map(s => `<tr><td><b>${esc(first(s,['sector','name','sectorName'],'غير مصنف'))}</b></td><td class="num">${fmt(first(s,['stocks','count','symbols'],0),0)}</td><td class="num">${fmt(first(s,['turnover','liquidity','value','totalTurnover'],0),0)}</td><td class="num">${fmt(first(s,['volume','totalVolume'],0),0)}</td><td class="num">${fmt(first(s,['share','weight','allocation'],0),1)}%</td><td class="num">${fmt(first(s,['allocation','suggestedWeight','portfolioWeight'],0),1)}%</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function newsView(kind='news') {
    const list = kind === 'alerts' ? arr(state.data.alerts) : [...arr(state.data.news), ...arr(state.data.alerts)].slice(0,100);
    return `<div class="card pad"><h3>${kind === 'alerts' ? 'التنبيهات' : 'الأخبار والتنبيهات'}</h3>${list.length ? list.map(x => `<div class="alert"><b>${esc(first(x,['title','headline','summary','text'],'خبر'))}</b><br><span style="color:var(--muted)">${esc(first(x,['source','publisher','site'],'مصدر عام'))} · ${esc(first(x,['impact','level','severity'],'متابعة'))}</span></div>`).join('') : '<div class="empty">لا توجد أخبار أو تنبيهات مجمعة حاليًا.</div>'}</div>`;
  }

  function simpleView(title, text) { return `<div class="card pad"><h3>${esc(title)}</h3>${kpis()}<div class="alert" style="margin-top:14px">${esc(text)}</div>${opportunityTable(state.rows.slice(0,30), 'مختصر أهم الفرص')}</div>`; }

  function chartView() {
    const symbols = state.rows.map(r => r.symbol);
    if (!state.chart && symbols.length) state.chart = symbols[0];
    const row = state.rows.find(r => r.symbol === state.chart) || {};
    return `<div class="card pad"><div class="tools"><select class="select" data-chart-sym>${symbols.map(s => `<option value="${esc(s)}" ${s===state.chart?'selected':''}>${esc(s)} — ${esc((state.rows.find(r=>r.symbol===s)||{}).name || s)}</option>`).join('')}</select></div><h3>${esc(state.chart || 'Chart Lab')}</h3><div class="chart">${svgChart(state.chart)}</div><div class="grid kpis" style="margin-top:14px"><div class="kpi"><b>${fmt(row.price,2)}</b><span>آخر سعر</span></div><div class="kpi"><b class="${signClass(row.changePct)}">${pct(row.changePct)}</b><span>التغير</span></div><div class="kpi"><b>${fmt(row.support,2)}</b><span>الدعم</span></div><div class="kpi"><b>${fmt(row.resistance,2)}</b><span>المقاومة</span></div><div class="kpi"><b>${fmt(row.confidence,0)}%</b><span>الثقة</span></div></div></div>`;
  }
  function histPoints(code) {
    const h = state.data.history || {}; let a = [];
    if (Array.isArray(h)) a = h.filter(x => sym(first(x,['symbol','code','ticker'])) === code);
    else if (h && typeof h === 'object') a = h[code] || h[code?.toLowerCase()] || arr(h).filter(x => sym(first(x,['symbol','code','ticker'])) === code);
    return (a || []).map((p,i) => ({date:first(p,['date','session','day','t'],String(i+1)), close:num(first(p,['close','price','last','value']), NaN), volume:num(first(p,['volume','tradedVolume','qty'],0),0)})).filter(p=>isFinite(p.close)).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-50);
  }
  function svgChart(code) {
    const p = histPoints(code);
    if (p.length < 2) return `<div class="empty">لا توجد نقاط تاريخية كافية لهذا السهم حتى الآن. سيكتمل الشارت مع تشغيلات الـ Workflow القادمة.</div>`;
    const w=980,h=360,L=48,R=18,T=24,CH=230,VT=282,VH=48; const prices=p.map(x=>x.close), vols=p.map(x=>x.volume||0), mn=Math.min(...prices), mx=Math.max(...prices), vm=Math.max(...vols,1);
    const x=i=>L+(i/Math.max(1,p.length-1))*(w-L-R), y=v=>T+(mx===mn?.5:(mx-v)/(mx-mn))*CH;
    const line=p.map((d,i)=>`${i?'L':'M'} ${x(i).toFixed(2)} ${y(d.close).toFixed(2)}`).join(' ');
    const area=`${line} L ${x(p.length-1)} ${T+CH} L ${x(0)} ${T+CH} Z`;
    const grid=[0,.25,.5,.75,1].map(t=>{const yy=T+t*CH,val=mx-t*(mx-mn);return `<line x1="${L}" y1="${yy}" x2="${w-R}" y2="${yy}" stroke="#d9e3ee"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#64748b">${fmt(val)}</text>`}).join('');
    const bars=p.map((d,i)=>{const bw=Math.max(3,(w-L-R)/p.length*.58),bh=((d.volume||0)/vm)*VH;return `<rect x="${x(i)-bw/2}" y="${VT+VH-bh}" width="${bw}" height="${bh}" rx="2" fill="#94a3b8" opacity=".55"/>`}).join('');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:100%"><defs><linearGradient id="a567" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#0b63ce" stop-opacity=".28"/><stop offset="100%" stop-color="#0b63ce" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="#fff"/>${grid}<path d="${area}" fill="url(#a567)"/><path d="${line}" fill="none" stroke="#0b63ce" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${bars}</svg>`;
  }

  function view() {
    const c = document.getElementById('egx-v567-content'); if (!c) return;
    if (state.tab === 'overview') c.innerHTML = kpis() + `<div style="height:14px"></div>` + opportunityTable(state.rows.slice(0,40),'أهم الفرص المختصرة');
    else if (state.tab === 'ranking' || state.tab === 'opps') c.innerHTML = kpis() + `<div style="height:14px"></div>` + opportunityTable(state.rows, state.tab === 'ranking' ? 'ترتيب السوق والأولويات' : 'قائمة الفرص');
    else if (state.tab === 'portfolio') c.innerHTML = simpleView('إدارة المحفظة', 'قسم إدارة المحفظة جاهز للربط بملف محفظة/مدخلات المستخدم. حاليًا يعرض أفضل الفرص للمراجعة.');
    else if (state.tab === 'market') c.innerHTML = opportunityTable(state.rows, 'كل السوق — عرض تحليلي موحد');
    else if (state.tab === 'sectors') c.innerHTML = sectorsView();
    else if (state.tab === 'investors') c.innerHTML = simpleView('نوع المتعاملين', arr(state.data.investors).length ? 'تم تحميل بيانات نوع المتعاملين.' : 'بيانات نوع المتعاملين غير متاحة آليًا حاليًا أو تحتاج مصدر يومي.');
    else if (state.tab === 'chart') c.innerHTML = chartView();
    else if (state.tab === 'news') c.innerHTML = newsView('news');
    else if (state.tab === 'alerts') c.innerHTML = newsView('alerts');
    else if (state.tab === 'reports') c.innerHTML = simpleView('التقارير', 'ملفات التقارير موجودة داخل data ويتم عرض أهم نتائجها في الأقسام المناسبة.');
    else if (state.tab === 'health') c.innerHTML = `<div class="card pad"><h3>صحة البيانات والكاش</h3>${kpis()}<div class="mini" style="margin-top:14px">${Object.keys(D).map(k => `<div class="item"><span>${esc(k)}</span><b class="${state.data[k] ? 'pos':'neg'}">${state.data[k] ? 'متاح':'غير متاح'}</b></div>`).join('')}</div></div>`;
    bindContent();
  }
  function bindContent() {
    const root = document.getElementById(ROOT_ID);
    root.querySelectorAll('[data-q]').forEach(x => x.oninput = e => { state.q=e.target.value; view(); });
    root.querySelectorAll('[data-action]').forEach(x => { x.value=state.action; x.onchange = e => { state.action=e.target.value; view(); }; });
    root.querySelectorAll('[data-limit]').forEach(x => { x.value=String(state.limit); x.onchange = e => { state.limit=Number(e.target.value)||50; view(); }; });
    root.querySelectorAll('[data-chart-sym]').forEach(x => x.onchange = e => { state.chart=e.target.value; view(); });
  }

  async function boot(force) {
    css(); setTheme(localStorage.getItem(THEME_KEY) || 'light');
    let root = document.getElementById(ROOT_ID);
    if (!root) { root = document.createElement('div'); root.id = ROOT_ID; document.body.appendChild(root); }
    root.innerHTML = `<div style="margin:auto;text-align:center;color:var(--text);font-family:Tahoma,Arial"><b>جاري تحميل EGX Pro Hub...</b><br><span style="color:var(--muted)">Rescue Shell V5.6.7</span></div>`;
    const pairs = await Promise.all(Object.entries(D).map(async ([k,p]) => [k, await loadJson(p, null)]));
    state.data = Object.fromEntries(pairs);
    state.rows = buildRows(state.data);
    shell(); view();
  }

  window.EGX_RESCUE_V567_BOOT = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 60)); else setTimeout(boot, 60);
  setTimeout(() => { const r=document.getElementById(ROOT_ID); if (!r || !r.textContent.trim() || document.body.getBoundingClientRect().height === 0) boot(true); }, 1400);
})();
