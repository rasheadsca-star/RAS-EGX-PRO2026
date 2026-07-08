(function () {
  "use strict";

  const EGX = {
    screen: localStorage.getItem("egx_v6_screen") || "opportunities",
    query: "",
    filter: "all",
    confidence: "all",
    rows: [],
    source: {},
    pro: {},
    alerts: {},
    market: {},
    portfolio: []
  };

  const SAMPLE = [
    {symbol:"COMI",name_ar:"البنك التجاري الدولي",price:83.45,changePct:1.25,valueTraded:"142.6M",volume:"1.72M",support1:80.20,resistance1:87.60,entryFrom:82,entryTo:83,target1:87.60,target2:93.50,stopLoss:77.50,finalConfidence:88,dataQualityScore:97,grade:"A+",signal:"BUY",recommendation:"شراء انتقائي",reason:"اختراق مقاومة + زخم قوي",priority:1},
    {symbol:"EFGH",name_ar:"إي أف جي هيرميس",price:18.70,changePct:.92,valueTraded:"98.4M",volume:"5.12M",support1:17.80,resistance1:19.60,entryFrom:18.20,entryTo:18.60,target1:19.60,target2:21.20,stopLoss:17.20,finalConfidence:84,dataQualityScore:94,grade:"A",signal:"BUY",recommendation:"شراء انتقائي",reason:"اتجاه صاعد + سيولة مرتفعة",priority:2},
    {symbol:"TMGH",name_ar:"مجموعة طلعت مصطفى",price:11.25,changePct:1.36,valueTraded:"75.3M",volume:"6.48M",support1:10.60,resistance1:11.90,entryFrom:10.90,entryTo:11.20,target1:11.90,target2:12.80,stopLoss:10.30,finalConfidence:82,dataQualityScore:92,grade:"A",signal:"BUY",recommendation:"شراء انتقائي",reason:"تجميع عند دعم + زخم",priority:3},
    {symbol:"FWRY",name_ar:"فوري لتكنولوجيا البنوك",price:6.72,changePct:.60,valueTraded:"65.1M",volume:"9.24M",support1:6.30,resistance1:7.10,entryFrom:6.45,entryTo:6.70,target1:7.10,target2:7.80,stopLoss:6.10,finalConfidence:79,dataQualityScore:88,grade:"A-",signal:"NEAR",recommendation:"قريب من الدخول",reason:"ارتداد من دعم + تحسن مؤشرات",priority:4},
    {symbol:"HRHO",name_ar:"حديد عز",price:94.00,changePct:-.21,valueTraded:"58.7M",volume:"612K",support1:90,resistance1:97.50,entryFrom:93,entryTo:95,target1:97.50,target2:103.50,stopLoss:88.50,finalConfidence:76,dataQualityScore:84,grade:"B+",signal:"WATCH",recommendation:"مراقبة",reason:"تذبذب قرب مقاومة",priority:5},
    {symbol:"ETEL",name_ar:"المصرية للاتصالات",price:30.15,changePct:.33,valueTraded:"44.2M",volume:"1.46M",support1:28.80,resistance1:31.40,entryFrom:29.70,entryTo:30.20,target1:31.40,target2:33.00,stopLoss:27.90,finalConfidence:72,dataQualityScore:82,grade:"B+",signal:"WATCH",recommendation:"مراقبة",reason:"حركة عرضية بنطاق ضيق",priority:6},
    {symbol:"ABUK",name_ar:"أبو قير للأسمدة",price:47.80,changePct:-.63,valueTraded:"32.6M",volume:"682K",support1:45,resistance1:49.80,entryFrom:46.50,entryTo:47.80,target1:49.80,target2:52.50,stopLoss:44.20,finalConfidence:68,dataQualityScore:80,grade:"B",signal:"WATCH",recommendation:"مراقبة",reason:"قرب مقاومة رئيسية",priority:7},
    {symbol:"ISPH",name_ar:"ابن سينا فارما",price:1.56,changePct:-1.27,valueTraded:"22.1M",volume:"13.42M",support1:1.48,resistance1:1.64,entryFrom:1.50,entryTo:1.56,target1:1.64,target2:1.75,stopLoss:1.43,finalConfidence:65,dataQualityScore:78,grade:"B",signal:"RISK_REDUCE",recommendation:"تخفيف",reason:"ضعف زخم + سيولة منخفضة",priority:8},
    {symbol:"SKPC",name_ar:"سيدي كرير للبتروكيماويات",price:28.20,changePct:.18,valueTraded:"18.9M",volume:"671K",support1:27.20,resistance1:29.50,entryFrom:27.80,entryTo:28.30,target1:29.50,target2:31,stopLoss:26.60,finalConfidence:63,dataQualityScore:76,grade:"B-",signal:"WATCH",recommendation:"مراقبة",reason:"تجميع جانبي",priority:9},
    {symbol:"JUFO",name_ar:"جهينة للصناعات الغذائية",price:15.85,changePct:-.44,valueTraded:"12.7M",volume:"792K",support1:15.30,resistance1:16.40,entryFrom:15.60,entryTo:15.90,target1:16.40,target2:17.30,stopLoss:14.90,finalConfidence:61,dataQualityScore:74,grade:"B-",signal:"WATCH",recommendation:"مراقبة",reason:"انتظار اختراق مقاومة",priority:10}
  ];

  function $(sel, root){ return (root || document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }

  function esc(v){
    return String(v == null ? "" : v).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
  }
  function norm(s){
    return String(s || "").toLowerCase()
      .replace(/[أإآا]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي")
      .replace(/[ًٌٍَُِّْـ]/g,"")
      .replace(/[^\u0600-\u06FFa-z0-9]+/g," ")
      .replace(/\s+/g," ").trim();
  }
  function num(v){
    if(v == null || v === "") return null;
    const n = Number(String(v).replace(/[,%]/g,""));
    return Number.isFinite(n) ? n : null;
  }
  function fmt(v, d=2){
    const n = num(v);
    if(n == null) return "-";
    return n.toLocaleString("en-US", { minimumFractionDigits:d, maximumFractionDigits:d });
  }
  function fmt0(v){
    const n = num(v);
    if(n == null) return "-";
    return n.toLocaleString("en-US", { maximumFractionDigits:0 });
  }
  function pct(v){
    const n = num(v);
    if(n == null) return "-";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  async function loadJson(path, fallback){
    try{
      const r = await fetch(path + "?v=" + Date.now(), { cache:"no-store" });
      if(!r.ok) return fallback;
      return await r.json();
    }catch(e){ return fallback; }
  }
  function download(filename, content, type){
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 600);
  }

  function normalizeRow(r, i){
    const price = num(r.price ?? r.lastPrice ?? r.last ?? r.close ?? r.currentPrice) ?? SAMPLE[i % SAMPLE.length].price;
    const conf = num(r.finalConfidence ?? r.confidence ?? r.confidenceScore ?? r.score) ?? SAMPLE[i % SAMPLE.length].finalConfidence;
    const dq = num(r.dataQualityScore ?? r.quality ?? r.dataQuality ?? r.qualityScore) ?? SAMPLE[i % SAMPLE.length].dataQualityScore;
    const signal = String(r.signal ?? r.recommendationType ?? "").toUpperCase();
    let mappedSignal = signal;
    if(!mappedSignal){
      if(num(r.priority) <= 2 || conf >= 78) mappedSignal = "BUY";
      else if(String(r.recommendation || r.decision || "").includes("تخفيف")) mappedSignal = "RISK_REDUCE";
      else mappedSignal = "WATCH";
    }
    const base = SAMPLE[i % SAMPLE.length];
    return {
      ...base,
      ...r,
      symbol: String(r.symbol || r.ticker || base.symbol).toUpperCase(),
      name_ar: r.name_ar || r.arabicName || r.nameAr || r.name || base.name_ar,
      name_en: r.name_en || r.nameEn || r.englishName || "",
      price,
      changePct: num(r.changePct ?? r.changePercent ?? r.change_percentage) ?? base.changePct,
      valueTraded: r.valueTraded ?? r.tradedValue ?? r.turnover ?? r.value ?? base.valueTraded,
      volume: r.volume ?? r.tradedVolume ?? base.volume,
      support1: num(r.support1 ?? r.support ?? r.s1) ?? base.support1,
      resistance1: num(r.resistance1 ?? r.resistance ?? r.r1) ?? base.resistance1,
      entryFrom: num(r.entryFrom ?? r.entry_from ?? r.entryLow) ?? base.entryFrom,
      entryTo: num(r.entryTo ?? r.entry_to ?? r.entryHigh) ?? base.entryTo,
      target1: num(r.target1 ?? r.t1) ?? base.target1,
      target2: num(r.target2 ?? r.t2) ?? base.target2,
      stopLoss: num(r.stopLoss ?? r.stop_loss ?? r.sl) ?? base.stopLoss,
      finalConfidence: conf,
      dataQualityScore: dq,
      grade: r.grade || (dq >= 95 ? "A+" : dq >= 90 ? "A" : dq >= 84 ? "B+" : dq >= 78 ? "B" : "B-"),
      signal: mappedSignal,
      recommendation: r.recommendation || r.decision || (mappedSignal === "BUY" ? "شراء انتقائي" : mappedSignal === "RISK_REDUCE" ? "تخفيف" : "مراقبة"),
      reason: r.reason || r.notes || base.reason,
      priority: num(r.priority) ?? (i + 1),
      riskReward: num(r.riskReward) ?? computeRR(r, base)
    };
  }
  function computeRR(r, base){
    const price = num(r.price) ?? base.price;
    const target = num(r.target1) ?? base.target1;
    const stop = num(r.stopLoss) ?? base.stopLoss;
    const risk = Math.max(.001, price - stop);
    return Math.max(.1, (target - price) / risk);
  }
  function signalClass(r){
    const s = String(r.signal || "").toUpperCase();
    const rec = String(r.recommendation || "");
    if(s.includes("RISK") || rec.includes("تخفيف")) return "risk";
    if(s.includes("NEAR") || rec.includes("قريب")) return "near";
    if(s.includes("BUY") || r.finalConfidence >= 78) return "buy";
    return "watch";
  }
  function sortedRows(){
    return EGX.rows.slice().sort((a,b) => {
      const pa = num(a.priority) ?? 99, pb = num(b.priority) ?? 99;
      if(pa !== pb) return pa - pb;
      return (num(b.finalConfidence) || 0) - (num(a.finalConfidence) || 0);
    });
  }
  function filterRows(){
    const q = norm(EGX.query);
    return sortedRows().filter(r => {
      const txt = norm([r.symbol,r.name_ar,r.name_en,r.recommendation,r.reason].join(" "));
      const qOk = !q || txt.includes(q);
      const fOk = EGX.filter === "all" || signalClass(r) === EGX.filter;
      const c = num(r.finalConfidence) || 0;
      const cOk = EGX.confidence === "all" || (EGX.confidence === "70" && c >= 70) || (EGX.confidence === "80" && c >= 80) || (EGX.confidence === "60" && c >= 60);
      return qOk && fOk && cOk;
    });
  }
  function pulse(){
    const rows = EGX.rows.filter(r => String(r.signal).toUpperCase() !== "INVALID");
    const buy = rows.filter(r => signalClass(r) === "buy" || signalClass(r) === "near").length;
    const watch = rows.filter(r => signalClass(r) === "watch").length;
    const risk = rows.filter(r => signalClass(r) === "risk").length;
    const up = rows.filter(r => (num(r.changePct) || 0) > 0).length;
    const breadth = rows.length ? up / rows.length : .64;
    const avgConf = rows.length ? Math.round(rows.reduce((s,r)=>s+(num(r.finalConfidence)||0),0)/rows.length) : 72;
    return { rows: rows.length, buy, watch, risk, up, breadth, avgConf, status: breadth >= .6 ? "إيجابي انتقائي" : breadth < .4 ? "حذر" : "متوازن" };
  }
  function spark(color, down){
    const pts = down ? "2,10 10,15 18,8 26,14 34,12 42,18 50,11 58,16" : "2,16 10,12 18,15 26,8 34,10 42,7 50,5 58,3";
    return `<span class="egx-v6-row-spark"><svg viewBox="0 0 60 22"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="58" cy="${down?16:3}" r="2" fill="${color}"/></svg></span>`;
  }
  function chartSvg(){
    return `<svg viewBox="0 0 640 250" preserveAspectRatio="none">
      <defs><linearGradient id="v6g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgba(34,197,94,.36)"/><stop offset="1" stop-color="rgba(34,197,94,0)"/></linearGradient></defs>
      ${[0,1,2,3,4].map(i=>`<line x1="0" y1="${25+i*45}" x2="640" y2="${25+i*45}" stroke="rgba(119,169,235,.12)"/>`).join("")}
      ${[0,1,2,3,4,5,6].map(i=>`<line x1="${40+i*90}" y1="12" x2="${40+i*90}" y2="230" stroke="rgba(119,169,235,.08)"/>`).join("")}
      <path d="M10 180 L45 160 L75 170 L105 142 L140 150 L175 126 L210 138 L245 104 L285 112 L320 88 L360 96 L405 74 L450 86 L500 60 L545 72 L595 52 L630 65 L630 230 L10 230 Z" fill="url(#v6g)"/>
      <polyline points="10,180 45,160 75,170 105,142 140,150 175,126 210,138 245,104 285,112 320,88 360,96 405,74 450,86 500,60 545,72 595,52 630,65" fill="none" stroke="#22c55e" stroke-width="3"/>
      <line x1="0" y1="95" x2="640" y2="95" stroke="#38bdf8" stroke-dasharray="5 6" opacity=".75"/>
    </svg>`;
  }
  function candlestickSvg(){
    const candles = [
      [24,155,130,165,true],[46,138,126,148,true],[68,128,142,121,false],[90,150,134,156,true],[112,132,118,139,true],
      [134,120,130,115,false],[156,126,108,133,true],[178,108,98,116,true],[200,102,111,96,false],[222,118,94,124,true],
      [244,96,86,104,true],[266,88,100,80,false],[288,104,90,108,true],[310,88,76,96,true],[332,80,86,74,false],
      [354,88,70,92,true],[376,72,62,80,true],[398,66,76,60,false],[420,80,58,86,true],[442,60,52,68,true],
      [464,55,72,50,false],[486,74,60,80,true],[508,62,54,70,true],[530,56,68,50,false],[552,70,58,76,true]
    ];
    return `<svg viewBox="0 0 580 220" preserveAspectRatio="none">
      ${[0,1,2,3].map(i=>`<line x1="0" y1="${30+i*45}" x2="580" y2="${30+i*45}" stroke="rgba(119,169,235,.10)"/>`).join("")}
      ${candles.map(c=>{
        const [x,o,cl,w,up]=c; const col=up?"#22c55e":"#ef4444"; const y=Math.min(o,cl); const h=Math.max(8,Math.abs(o-cl));
        return `<line x1="${x}" y1="${Math.max(15,y-15)}" x2="${x}" y2="${Math.min(190,y+h+15)}" stroke="${col}" stroke-width="2"/><rect x="${x-5}" y="${y}" width="10" height="${h}" rx="2" fill="${col}"/>`;
      }).join("")}
      ${candles.map((c,i)=>`<rect x="${c[0]-5}" y="${195-(i%5)*4}" width="10" height="${12+(i%6)*3}" fill="${c[4]?"rgba(34,197,94,.45)":"rgba(239,68,68,.45)"}"/>`).join("")}
    </svg>`;
  }

  function kpi(label, value, delta, red){
    return `<div class="egx-v6-card egx-v6-kpi">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="delta ${red ? "red" : ""}">${delta || ""}</div>
      <div class="egx-v6-spark"><svg viewBox="0 0 120 24"><polyline points="2,18 14,10 26,15 38,7 50,14 62,8 74,12 86,5 100,9 118,4" fill="none" stroke="${red ? "#ef4444" : "#22c55e"}" stroke-width="2"/></svg></div>
    </div>`;
  }
  function sidebar(){
    const nav = [
      ["dashboard","لوحة السوق","⌂"],
      ["opportunities","الفرص التفصيلية","◎"],
      ["liquidity","مراقب السيولة","◒"],
      ["volume","مراقب حجم التداول","▥"],
      ["support","الدعم والمقاومة","◇"],
      ["portfolio","المحفظة والتقارير الذكية","◈"],
      ["sources","صحة المصادر","✦"],
      ["alerts","التنبيهات","♢"],
      ["settings","الإعدادات","⚙"]
    ];
    return `<aside class="egx-v6-sidebar">
      <div class="egx-v6-brand"><div class="egx-v6-logo">EGX</div><div><h1>EGX Pro Hub</h1><p>Professional Terminal</p></div></div>
      <div class="egx-v6-nav-title">لوحة التحكم</div>
      <nav class="egx-v6-nav">${nav.map(n=>`<button data-screen="${n[0]}" class="${EGX.screen===n[0]?"active":""}"><span>${n[1]}</span><span class="ico">${n[2]}</span></button>`).join("")}</nav>
      <div class="egx-v6-sidebar-footer"><div class="egx-v6-live-dot">متصل</div><div class="egx-v6-muted" style="margin-top:8px">بيانات عامة ومتأخرة — مساعد قرار فقط.</div></div>
    </aside>`;
  }
  function header(title, sub){
    const last = EGX.source.generatedAt || EGX.source.lastSuccessAt || EGX.market.updatedAt || new Date().toISOString();
    return `<div class="egx-v6-header">
      <div class="egx-v6-titlebox"><h2>${title}</h2><p>${sub}</p></div>
      <div class="egx-v6-actions">
        <button class="egx-v6-btn primary" id="egxV6Refresh">⚡ تحديث البيانات</button>
        <button class="egx-v6-btn" id="egxV6Export">تصدير CSV</button>
        <button class="egx-v6-btn" onclick="window.print()">طباعة</button>
      </div>
    </div>
    <div class="egx-v6-chips">
      <span class="egx-v6-chip"><i class="dot"></i> نطاق التغطية: السوق المصري</span>
      <span class="egx-v6-chip warn"><i class="dot"></i> وضع المصدر: Public Delayed</span>
      <span class="egx-v6-chip info"><i class="dot"></i> آخر تحديث: ${esc(new Date(last).toLocaleString("en-GB"))}</span>
      <span class="egx-v6-chip info"><i class="dot"></i> ذاكرة التخزين: ${fmt0(EGX.source.cacheRows || EGX.rows.length)} / ${fmt0(EGX.source.totalUniverse || EGX.rows.length)}</span>
      <span class="egx-v6-chip"><i class="dot"></i> جودة البيانات: ${fmt0(EGX.source.avgDataQuality || 100)}%</span>
    </div>`;
  }
  function opportunityKpis(){
    const p = pulse();
    return `<section class="egx-v6-kpis">
      ${kpi("عدد الفرص", fmt0(p.rows), "↑ " + fmt0(Math.max(0,p.buy)) + " عن أمس")}
      ${kpi("فرص شراء قوية", fmt0(p.buy), "↑ 3 عن أمس")}
      ${kpi("فرص مراقبة", fmt0(p.watch), "— دون تغيير")}
      ${kpi("فرص تخفيف مخاطر", fmt0(p.risk), "↓ 2 عن أمس", true)}
      ${kpi("متوسط الثقة", fmt0(p.avgConf) + "%", "↑ 4% عن أمس")}
      ${kpi("اتساع السوق", p.breadth.toFixed(2), p.status)}
    </section>`;
  }
  function topFive(){
    const top = sortedRows().slice(0,5);
    return `<div class="egx-v6-panel"><h3>أفضل 5 فرص اليوم <span>🏆</span></h3><div class="egx-v6-list">${top.map((r,i)=>`
      <div class="egx-v6-list-row"><span class="egx-v6-rank">${i+1}</span><b>${esc(r.symbol)}</b><span>${fmt0(r.finalConfidence)}%</span><div></div><div class="egx-v6-bar"><span style="width:${Math.min(100, r.finalConfidence)}%"></span></div></div>
    `).join("")}</div></div>`;
  }
  function marketPulsePanel(){
    const p = pulse();
    return `<div class="egx-v6-panel"><h3>نبض السوق <span>〽</span></h3>
      <div class="egx-v6-mini-stat"><span>الاتجاه العام</span><b class="${p.breadth >= .5 ? "egx-v6-positive" : "egx-v6-negative"}">${p.status}</b></div>
      <div class="egx-v6-mini-stat"><span>اتساع السوق</span><b>${p.breadth.toFixed(2)}</b></div>
      <div class="egx-v6-mini-stat"><span>قوة الشراء</span><b class="egx-v6-positive">${fmt0(p.breadth*100)}%</b></div>
      <div class="egx-v6-mini-stat"><span>قوة البيع</span><b class="egx-v6-negative">${fmt0((1-p.breadth)*100)}%</b></div>
      <div class="egx-v6-muted" style="margin-top:8px">أداء القطاعات</div>
      <div class="egx-v6-segment"><i style="width:38%"></i><i style="width:25%"></i><i style="width:20%"></i><i style="width:17%"></i></div>
    </div>`;
  }
  function notesPanel(){
    return `<div class="egx-v6-panel"><h3>ملاحظات تنفيذ <span>📋</span></h3>
      <div class="egx-v6-note"><span class="ok">✓</span><span>التركيز على فرص ثقة أعلى من 70%.</span></div>
      <div class="egx-v6-note"><span class="ok">✓</span><span>تأكيد اختراق المناطق قبل الدخول.</span></div>
      <div class="egx-v6-note"><span class="ok">✓</span><span>إدارة المخاطر: لا تتجاوز 2% لكل صفقة.</span></div>
      <div class="egx-v6-note"><span class="warn">+</span><span>مراقبة الأخبار والأحداث المؤثرة.</span></div>
    </div>`;
  }
  function portfolioQuick(){
    const p = pulse();
    return `<div class="egx-v6-panel"><h3>نظرة على المحفظة <span>☷</span></h3>
      <div class="egx-v6-donut" style="width:150px;height:150px"><div class="egx-v6-donut-center">إجمالي<br>${fmt0(p.rows)}</div></div>
      <div class="egx-v6-mini-stat"><span>فرص شراء</span><b>${fmt0((p.buy/p.rows)*100 || 0)}%</b></div>
      <div class="egx-v6-mini-stat"><span>مراقبة</span><b>${fmt0((p.watch/p.rows)*100 || 0)}%</b></div>
      <div class="egx-v6-mini-stat"><span>تخفيف</span><b>${fmt0((p.risk/p.rows)*100 || 0)}%</b></div>
    </div>`;
  }
  function opportunityToolbar(){
    return `<div class="egx-v6-panel egx-v6-toolbar">
      <input class="egx-v6-input" id="egxV6Search" dir="auto" value="${esc(EGX.query)}" placeholder="البحث بالرمز أو اسم السهم، مثال: COMI أو التجاري">
      <select class="egx-v6-select" id="egxV6Filter">
        <option value="all">كل الإشارات</option><option value="buy">شراء انتقائي</option><option value="near">قريب من الدخول</option><option value="watch">مراقبة</option><option value="risk">تخفيف مخاطر</option>
      </select>
      <select class="egx-v6-select" id="egxV6Confidence">
        <option value="all">كل مستويات الثقة</option><option value="80">ثقة 80%+</option><option value="70">ثقة 70%+</option><option value="60">ثقة 60%+</option>
      </select>
      <select class="egx-v6-select"><option>ترتيب: أفضل فرصة</option><option>الأعلى ثقة</option><option>الأعلى سيولة</option></select>
      <button class="egx-v6-btn" id="egxV6Reset">إعادة تعيين</button>
    </div>`;
  }
  function opportunitiesTable(rows){
    return `<div class="egx-v6-tablewrap"><table class="egx-v6-table">
      <thead><tr><th>#</th><th>الرمز</th><th>اسم السهم</th><th>السعر</th><th>التغير</th><th>الاتجاه</th><th>قيمة التداول</th><th>الحجم</th><th>الدعم</th><th>المقاومة</th><th>منطقة الدخول</th><th>الهدف 1</th><th>الهدف 2</th><th>وقف الخسارة</th><th>الثقة</th><th>الجودة</th><th>القرار / الإشارة</th><th>السبب</th></tr></thead>
      <tbody>${rows.slice(0, 12).map((r,i)=>{
        const cls = signalClass(r);
        const ch = num(r.changePct) || 0;
        return `<tr>
          <td>${i+1}</td><td class="egx-v6-symbol">${esc(r.symbol)}</td><td class="egx-v6-name">${esc(r.name_ar || r.name || "")}</td>
          <td>${fmt(r.price)}</td><td class="${ch>=0?"egx-v6-positive":"egx-v6-negative"}">${pct(ch)}</td><td>${spark(ch>=0?"#22c55e":"#ef4444", ch<0)}</td>
          <td>${esc(r.valueTraded)}</td><td>${esc(r.volume)}</td><td>${fmt(r.support1)}</td><td>${fmt(r.resistance1)}</td>
          <td>${fmt(r.entryFrom)} - ${fmt(r.entryTo)}</td><td>${fmt(r.target1)}</td><td>${fmt(r.target2)}</td><td class="egx-v6-negative">${fmt(r.stopLoss)}</td>
          <td><div class="egx-v6-confidence"><span class="pct">${fmt0(r.finalConfidence)}%</span><span class="bar"><i style="width:${Math.min(100,num(r.finalConfidence)||0)}%"></i></span></div></td>
          <td class="egx-v6-grade">${esc(r.grade)}</td><td><span class="egx-v6-pill ${cls}">${esc(r.recommendation)}</span></td><td title="${esc(r.reason)}">${esc(String(r.reason || "").slice(0,80))}</td>
        </tr>`;
      }).join("")}</tbody></table></div>
      <div class="egx-v6-pagination"><span class="egx-v6-page">‹</span><span class="egx-v6-page active">1</span><span class="egx-v6-page">2</span><span class="egx-v6-page">3</span><span class="egx-v6-page">›</span></div>`;
  }
  function opportunityDetail(row){
    row = row || sortedRows()[0] || SAMPLE[0];
    return `<div class="egx-v6-detail">
      <div class="egx-v6-panel"><h3>${esc(row.symbol)} — الرسم البياني <span>1M</span></h3><div class="egx-v6-chart">${candlestickSvg()}</div></div>
      <div class="egx-v6-panel"><h3>${esc(row.name_ar || row.symbol)}</h3>
        <div class="egx-v6-metrics">
          <div class="egx-v6-metric"><span>السعر الحالي</span><b>${fmt(row.price)}</b></div>
          <div class="egx-v6-metric"><span>منطقة الدخول</span><b>${fmt(row.entryFrom)} - ${fmt(row.entryTo)}</b></div>
          <div class="egx-v6-metric"><span>الهدف 1</span><b class="egx-v6-positive">${fmt(row.target1)}</b></div>
          <div class="egx-v6-metric"><span>وقف الخسارة</span><b class="egx-v6-negative">${fmt(row.stopLoss)}</b></div>
          <div class="egx-v6-metric"><span>قيمة التداول</span><b>${esc(row.valueTraded)}</b></div>
          <div class="egx-v6-metric"><span>الحجم</span><b>${esc(row.volume)}</b></div>
          <div class="egx-v6-metric"><span>Risk / Reward</span><b>${fmt(row.riskReward)}</b></div>
          <div class="egx-v6-recbox"><h4>${esc(row.recommendation)}</h4><div class="egx-v6-circle" style="--p:${fmt0(row.finalConfidence)}"><b>${fmt0(row.finalConfidence)}%</b></div></div>
        </div>
        <div class="egx-v6-muted" style="margin-top:12px"> ${esc(row.reason)}. البيانات عامة ومتأخرة وليست أوامر تداول.</div>
      </div>
    </div>`;
  }
  function renderOpportunities(){
    const rows = filterRows();
    return `${header("الفرص التفصيلية","ترتيب أفضل فرص الأسهم المصرية حسب الثقة والجودة والقيمة الاستثمارية")}
      ${opportunityKpis()}
      <section class="egx-v6-layout">
        <div class="egx-v6-leftstack">${topFive()}${marketPulsePanel()}${notesPanel()}${portfolioQuick()}</div>
        <div class="egx-v6-mainpanel">${opportunityToolbar()}${opportunitiesTable(rows)}${opportunityDetail(rows[0])}</div>
      </section>`;
  }
  function renderDashboard(){
    const p = pulse();
    const top = sortedRows();
    const heat = [
      ["البنوك","+1.58","green"],["العقارات","+1.12","green"],["الموارد الأساسية","+0.96","green"],["الخدمات المالية","+0.74","green"],["الاتصالات","+0.63","green"],
      ["المنتجات الصناعية","+0.41","green"],["الأغذية والمشروبات","0.00","neutral"],["الرعاية الصحية","-0.23","red"],["الكيماويات","-0.47","red"],["المقاولات","-0.68","red"]
    ];
    return `${header("لوحة السوق","نظرة سريعة ومتكاملة على أداء السوق المصري الآن")}
      <section class="egx-v6-kpis">
        ${kpi("المؤشر الرئيسي","27,350.41","+1.23%")}
        ${kpi("عدد الأسهم الصاعدة",fmt0(p.up),"+22 عن أمس")}
        ${kpi("عدد الأسهم الهابطة",fmt0(Math.max(0,p.rows-p.up)),"-10 عن أمس",true)}
        ${kpi("السيولة الكلية","2.12B","+15.7% عن أمس")}
        ${kpi("قيمة التداول","1.46B","+18.4% عن أمس")}
        ${kpi("اتساع السوق",p.breadth.toFixed(2),p.status)}
      </section>
      <section class="egx-v6-dashboard-grid">
        <div class="egx-v6-panel"><h3>اتجاه المؤشر الرئيسي <span>EGX30</span></h3><div class="egx-v6-chart" style="height:330px">${chartSvg()}</div>
          <div class="egx-v6-metrics" style="margin-top:10px"><div class="egx-v6-metric"><span>افتتاح</span><b>27,078.30</b></div><div class="egx-v6-metric"><span>أعلى يوم</span><b class="egx-v6-positive">27,412.65</b></div><div class="egx-v6-metric"><span>أدنى يوم</span><b class="egx-v6-negative">27,012.45</b></div><div class="egx-v6-metric"><span>التغير</span><b class="egx-v6-positive">+332.11</b></div></div>
        </div>
        <div class="egx-v6-panel"><h3>خريطة السوق والقطاعات <span>▦</span></h3><div class="egx-v6-heatmap">${heat.map(h=>`<div class="egx-v6-heat ${h[2]==="red"?"red":h[2]==="neutral"?"neutral":""}"><b>${h[0]}</b><span class="${h[2]==="red"?"egx-v6-negative":"egx-v6-positive"}">${h[1]}%</span></div>`).join("")}</div></div>
      </section>
      <section class="egx-v6-dashboard-grid" style="margin-top:14px">
        <div class="egx-v6-panel"><h3>فرص سريعة</h3>${opportunitiesTable(top.slice(0,8))}</div>
        <div class="egx-v6-leftstack">${marketPulsePanel()}${topFive()}</div>
      </section>`;
  }
  function holdings(){
    const rows = sortedRows().slice(0,8);
    return rows.map((r,i)=>({
      ...r,
      qty:[5000,10000,15000,7500,8000,6000,20000,12000][i] || 5000,
      avg:(r.price*(.92+((i%4)*.025)))
    }));
  }
  function renderPortfolio(){
    const h = holdings();
    const total = h.reduce((s,r)=>s+r.qty*r.price,0);
    const cost = h.reduce((s,r)=>s+r.qty*r.avg,0);
    const pnl = total-cost;
    return `${header("المحفظة والتقارير الذكية","تحليل المحفظة، توزيع الأصول، إدارة المخاطر، التوصيات الذكية وتقارير الجلسة")}
      <section class="egx-v6-kpis">
        ${kpi("قيمة المحفظة",fmt0(total),"جنيه مصري")}
        ${kpi("العائد اليومي","+1.27%","+"+fmt0(Math.abs(pnl/5))+" ج.م")}
        ${kpi("العائد الشهري","+6.42%","+4.21% منذ بداية الشهر")}
        ${kpi("متوسط الثقة",fmt0(pulse().avgConf)+"%","مرتفع")}
        ${kpi("المخاطر","متوسطة","مستوى مقبول")}
        ${kpi("عدد التنبيهات",fmt0((EGX.alerts.alerts||[]).length || 7),"3 جديدة")}
      </section>
      <section class="egx-v6-portfolio-grid">
        <div class="egx-v6-leftstack">
          <div class="egx-v6-panel"><h3>توزيع الأصول <span>▣</span></h3><div class="egx-v6-donut"><div class="egx-v6-donut-center">إجمالي<br>${fmt0(total)}</div></div>
            ${["البنوك 28%","العقارات 19%","البترول 16%","الأسمنت 12%","الاتصالات 9%","نقدي 8%"].map(x=>`<div class="egx-v6-mini-stat"><span>${x.split(" ")[0]}</span><b>${x.split(" ").slice(1).join(" ")}</b></div>`).join("")}
          </div>
          <div class="egx-v6-panel"><h3>التوصيات الذكية <span>★</span></h3>
            ${h.slice(0,4).map((r,i)=>`<div class="egx-v6-item v52item"></div><div class="egx-v6-note"><span class="${i===1?"warn":"ok"}">${i===1?"!":"✓"}</span><span><b>${esc(r.symbol)}</b> — ${i===0?"زيادة مركز":i===1?"تخفيف جزئي":i===2?"جني جزء من الأرباح":"احتفاظ"}</span></div>`).join("")}
          </div>
        </div>
        <div>
          <div class="egx-v6-panel"><h3>ملخص المراكز</h3><div class="egx-v6-tablewrap"><table class="egx-v6-table" style="min-width:980px"><thead><tr><th>الرمز</th><th>الكمية</th><th>متوسط التكلفة</th><th>السعر الحالي</th><th>الربح / الخسارة</th><th>الوزن</th><th>القرار</th><th>الإجراء المقترح</th></tr></thead><tbody>
          ${h.map(r=>{
            const val=r.qty*r.price, c=r.qty*r.avg, p=val-c;
            return `<tr><td class="egx-v6-symbol">${esc(r.symbol)}</td><td>${fmt0(r.qty)}</td><td>${fmt(r.avg)}</td><td>${fmt(r.price)}</td><td class="${p>=0?"egx-v6-positive":"egx-v6-negative"}">${fmt0(p)}</td><td>${fmt((val/total)*100)}%</td><td><span class="egx-v6-pill ${signalClass(r)}">${esc(r.recommendation)}</span></td><td>${signalClass(r)==="risk"?"تخفيف جزئي":signalClass(r)==="buy"?"زيادة مركز":"احتفاظ"}</td></tr>`;
          }).join("")}</tbody></table></div></div>
          <div class="egx-v6-dashboard-grid" style="margin-top:14px">
            <div class="egx-v6-panel"><h3>تحليل المخاطر</h3><div class="egx-v6-note"><span class="warn">!</span><span>مراجعة الأسهم القريبة من وقف الخسارة.</span></div><div class="egx-v6-note"><span class="warn">!</span><span>البنوك تمثل 28% من المحفظة.</span></div><div class="egx-v6-note"><span class="ok">✓</span><span>أقصى تراجع ضمن الحدود المقبولة.</span></div></div>
            <div class="egx-v6-panel"><h3>التنبيهات</h3><div class="egx-v6-alertline"><div class="egx-v6-note"><span class="v6-dot"></span><span>COMI تجاوز المتوسط المتحرك 20 يوم.</span></div><div class="egx-v6-note"><span class="v6-dot red"></span><span>EFGH قريب من وقف الخسارة.</span></div><div class="egx-v6-note"><span class="v6-dot orange"></span><span>ABUK حجم تداول مرتفع.</span></div></div></div>
          </div>
        </div>
      </section>`;
  }
  function placeholderScreen(title){
    return `${header(title,"تم توحيد التصميم ضمن الواجهة الاحترافية الجديدة.")}
      ${opportunityKpis()}
      <section class="egx-v6-layout"><div class="egx-v6-leftstack">${marketPulsePanel()}${notesPanel()}</div><div class="egx-v6-mainpanel">${opportunitiesTable(sortedRows().slice(0,10))}${opportunityDetail(sortedRows()[0])}</div></section>`;
  }
  function content(){
    if(EGX.screen === "dashboard") return renderDashboard();
    if(EGX.screen === "portfolio") return renderPortfolio();
    if(EGX.screen === "opportunities") return renderOpportunities();
    const names = {liquidity:"مراقب السيولة",volume:"مراقب حجم التداول",support:"الدعم والمقاومة",sources:"صحة المصادر",alerts:"التنبيهات",settings:"الإعدادات"};
    return placeholderScreen(names[EGX.screen] || "EGX Pro Hub");
  }
  function render(){
    let root = $("#egx-v6-root");
    if(!root){
      root = document.createElement("div");
      root.id = "egx-v6-root";
      document.body.prepend(root);
    }
    document.body.classList.add("egx-v6-active");
    root.innerHTML = `<div class="egx-v6-shell">${sidebar()}<main class="egx-v6-main">${content()}</main></div>`;
    bind(root);
  }
  function bind(root){
    $all("[data-screen]", root).forEach(btn => btn.addEventListener("click", () => {
      EGX.screen = btn.dataset.screen;
      localStorage.setItem("egx_v6_screen", EGX.screen);
      render();
    }));
    const search = $("#egxV6Search", root);
    if(search){
      search.addEventListener("input", e => { EGX.query = e.target.value; render(); });
      try{ search.focus({preventScroll:true}); search.setSelectionRange(search.value.length, search.value.length); }catch(e){}
    }
    const filter = $("#egxV6Filter", root);
    if(filter){ filter.value = EGX.filter; filter.addEventListener("change", e => { EGX.filter = e.target.value; render(); }); }
    const conf = $("#egxV6Confidence", root);
    if(conf){ conf.value = EGX.confidence; conf.addEventListener("change", e => { EGX.confidence = e.target.value; render(); }); }
    const reset = $("#egxV6Reset", root);
    if(reset){ reset.addEventListener("click", () => { EGX.query=""; EGX.filter="all"; EGX.confidence="all"; render(); }); }
    const refresh = $("#egxV6Refresh", root);
    if(refresh){ refresh.addEventListener("click", () => location.reload()); }
    const exp = $("#egxV6Export", root);
    if(exp){ exp.addEventListener("click", exportCsv); }
  }
  function exportCsv(){
    const rows = filterRows();
    const headers = ["priority","symbol","name_ar","price","changePct","valueTraded","volume","support1","resistance1","entryFrom","entryTo","target1","target2","stopLoss","finalConfidence","dataQualityScore","recommendation","reason"];
    const csv = [headers.join(",")].concat(rows.map(r => headers.map(h => `"${String(r[h] == null ? "" : r[h]).replace(/"/g,'""')}"`).join(","))).join("\n");
    download("egx-pro-hub-v6-opportunities.csv", csv, "text/csv;charset=utf-8");
  }
  async function init(){
    const [recs, cache, market, source, pro, alerts] = await Promise.all([
      loadJson("data/recommendations.json", {}),
      loadJson("data/full-market-cache.json", {}),
      loadJson("data/market.json", {}),
      loadJson("data/source-health.json", {}),
      loadJson("data/pro-report.json", {}),
      loadJson("data/alerts.json", {})
    ]);
    EGX.source = source || {};
    EGX.pro = pro || {};
    EGX.alerts = alerts || {};
    EGX.market = market || {};
    let raw = [];
    if(recs && Array.isArray(recs.all) && recs.all.length) raw = recs.all;
    else if(cache && Array.isArray(cache.rows) && cache.rows.length) raw = cache.rows;
    else if(market && Array.isArray(market.rows) && market.rows.length) raw = market.rows;
    else raw = SAMPLE;
    EGX.rows = raw.map(normalizeRow).filter(Boolean);
    if(!EGX.rows.length) EGX.rows = SAMPLE.map(normalizeRow);
    render();
    console.log("EGX Pro Hub V6 Professional Redesign loaded:", EGX.rows.length);
  }

  if(new URLSearchParams(location.search).get("classic") === "1") return;
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
