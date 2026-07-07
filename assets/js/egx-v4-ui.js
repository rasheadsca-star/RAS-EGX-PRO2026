/*
EGX Pro Hub V4 Frontend Overlay
- Arabic search that does not freeze.
- Recommendations table.
- Entry, targets, stop loss.
- Mini charts from data/history.json.
- Local portfolio analyzer.
No external libraries.
*/

(function () {
  "use strict";

  const S = {
    market: null,
    recs: null,
    history: null,
    rows: [],
    q: "",
    filter: "all"
  };

  function fmt(v, d = 2) {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "-";
    return Number(v).toLocaleString("ar-EG", { maximumFractionDigits: d, minimumFractionDigits: d });
  }

  function fmt0(v) {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "-";
    return Number(v).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
  }

  function normalizeArabic(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[أإآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[ًٌٍَُِّْـ]/g, "")
      .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function loadJson(url, fallback) {
    try {
      const r = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return fallback;
      return await r.json();
    } catch {
      return fallback;
    }
  }

  function injectStyles() {
    if (document.getElementById("egxV4Styles")) return;
    const css = `
      #egxV4Panel{direction:rtl;background:#081120;color:#eaf2ff;border:1px solid #1f3356;border-radius:18px;margin:14px 8px;padding:14px;font-family:Tahoma,Arial,sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.25)}
      #egxV4Panel *{box-sizing:border-box}
      .egx-v4-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
      .egx-v4-title{font-size:20px;font-weight:900}
      .egx-v4-badges{display:flex;gap:8px;flex-wrap:wrap}
      .egx-v4-badge{padding:7px 10px;border-radius:999px;background:#10203a;border:1px solid #29436f;color:#cfe2ff;font-size:12px}
      .egx-v4-controls{display:grid;grid-template-columns:1fr 190px 160px;gap:10px;margin:10px 0 14px}
      .egx-v4-input,.egx-v4-select,.egx-v4-btn, .egx-v4-textarea{background:#0c1729;color:#fff;border:1px solid #30486f;border-radius:12px;padding:11px 12px;outline:none}
      .egx-v4-input{font-size:15px}
      .egx-v4-input:focus,.egx-v4-select:focus,.egx-v4-textarea:focus{border-color:#1d9bf0;box-shadow:0 0 0 3px rgba(29,155,240,.12)}
      .egx-v4-btn{cursor:pointer;background:#1168a8;border-color:#1684d8;font-weight:800}
      .egx-v4-btn:hover{filter:brightness(1.08)}
      .egx-v4-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .egx-v4-card{background:#0b1628;border:1px solid #1f3356;border-radius:14px;padding:12px}
      .egx-v4-card b{display:block;font-size:18px;margin-top:4px}
      .egx-v4-table-wrap{overflow:auto;border:1px solid #1f3356;border-radius:14px}
      .egx-v4-table{width:100%;border-collapse:collapse;min-width:1120px}
      .egx-v4-table th,.egx-v4-table td{padding:10px 8px;border-bottom:1px solid #1c2d4d;text-align:right;font-size:13px;white-space:nowrap}
      .egx-v4-table th{background:#0d1b31;color:#dbeafe;position:sticky;top:0;z-index:1}
      .egx-v4-table tr:hover td{background:#0d1b31}
      .egx-v4-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:999px;font-size:12px;font-weight:800}
      .egx-v4-buy{background:#063b23;color:#7dffb2;border:1px solid #0a7d45}
      .egx-v4-watch{background:#2b2408;color:#ffe28a;border:1px solid #8a6f09}
      .egx-v4-risk{background:#3b0b16;color:#ff9fb2;border:1px solid #b91c3a}
      .egx-v4-invalid{background:#262b36;color:#b8c2d6;border:1px solid #3d475a}
      .egx-v4-small{font-size:12px;color:#9fb3d1}
      .egx-v4-chart-btn{padding:6px 9px;border-radius:10px;border:1px solid #315780;background:#10233f;color:#dff0ff;cursor:pointer}
      #egxV4Modal{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:none;align-items:center;justify-content:center;padding:18px;direction:rtl}
      #egxV4Modal .box{width:min(880px,96vw);background:#081120;border:1px solid #2c4772;border-radius:18px;padding:14px;color:#fff}
      #egxV4Modal .modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
      #egxV4Modal .close{background:#3b0b16;color:#fff;border:1px solid #a11;border-radius:10px;padding:8px 12px;cursor:pointer}
      .egx-v4-portfolio{display:none;margin-top:12px}
      .egx-v4-portfolio.open{display:block}
      .egx-v4-textarea{width:100%;min-height:95px;resize:vertical;font-family:Consolas,Tahoma,monospace;direction:ltr;text-align:left}
      @media (max-width:900px){.egx-v4-controls{grid-template-columns:1fr}.egx-v4-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media (max-width:560px){.egx-v4-grid{grid-template-columns:1fr}.egx-v4-title{font-size:17px}}
    `;
    const style = document.createElement("style");
    style.id = "egxV4Styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function rowText(r) {
    return normalizeArabic([
      r.symbol, r.name, r.name_en, r.name_ar, r.decision, r.recommendation, r.signal, r.reason, r.setup,
      ...(Array.isArray(r.aliases) ? r.aliases : [])
    ].filter(Boolean).join(" "));
  }

  function filteredRows() {
    const q = normalizeArabic(S.q);
    return S.rows.filter((r) => {
      const passQ = !q || rowText(r).includes(q);
      const passF =
        S.filter === "all" ||
        (S.filter === "buy" && Number(r.priority) <= 2) ||
        (S.filter === "watch" && r.signal === "WATCH") ||
        (S.filter === "risk" && r.signal === "RISK_REDUCE") ||
        (S.filter === "valid" && r.signal !== "INVALID");
      return passQ && passF;
    });
  }

  function signalClass(r) {
    if (Number(r.priority) <= 2 || r.signal === "WATCH_BUY") return "egx-v4-buy";
    if (r.signal === "RISK_REDUCE") return "egx-v4-risk";
    if (r.signal === "INVALID") return "egx-v4-invalid";
    return "egx-v4-watch";
  }

  function render() {
    const rows = filteredRows();
    const summary = S.market && S.market.summary ? S.market.summary : {};
    const updatedAt = S.market && S.market.updatedAt ? new Date(S.market.updatedAt).toLocaleString("ar-EG") : "-";
    const html = `
      <div class="egx-v4-head">
        <div>
          <div class="egx-v4-title">🚀 EGX Pro Hub V4 — التوصيات والبحث العربي والشارت</div>
          <div class="egx-v4-small">بيانات عامة متأخرة وليست أوامر تداول. آخر تحديث: ${updatedAt}</div>
        </div>
        <div class="egx-v4-badges">
          <span class="egx-v4-badge">المقروء: ${fmt0(summary.count || S.rows.length)}</span>
          <span class="egx-v4-badge">ترشيحات شراء: ${fmt0(summary.buyCandidates || 0)}</span>
          <span class="egx-v4-badge">متوسط الثقة: ${fmt0(summary.avgConfidence || 0)}%</span>
          <span class="egx-v4-badge">المعروض: ${fmt0(rows.length)}</span>
        </div>
      </div>

      <div class="egx-v4-controls">
        <input id="egxV4Search" class="egx-v4-input" dir="auto" autocomplete="off" placeholder="ابحث بالعربي أو بالرمز: القلعة، فوري، التجاري، COMI" value="${escapeHtml(S.q)}">
        <select id="egxV4Filter" class="egx-v4-select">
          <option value="all"${S.filter==="all"?" selected":""}>كل الأسهم</option>
          <option value="buy"${S.filter==="buy"?" selected":""}>ترشيحات شراء</option>
          <option value="watch"${S.filter==="watch"?" selected":""}>مراقبة</option>
          <option value="risk"${S.filter==="risk"?" selected":""}>حذر / تخفيف</option>
          <option value="valid"${S.filter==="valid"?" selected":""}>بيانات صالحة فقط</option>
        </select>
        <button id="egxV4PortfolioBtn" class="egx-v4-btn">تحليل المحفظة</button>
      </div>

      <div class="egx-v4-grid">
        <div class="egx-v4-card">أفضلية الشراء<b>${fmt0((summary.buyCandidates || 0))}</b></div>
        <div class="egx-v4-card">متوسط الجودة<b>${fmt0(summary.avgQuality || 0)}%</b></div>
        <div class="egx-v4-card">حذر / تخفيف<b>${fmt0(summary.riskReduce || 0)}</b></div>
        <div class="egx-v4-card">إجمالي الكونفج<b>${fmt0(summary.requestedSymbols || 0)}</b></div>
      </div>

      <div class="egx-v4-table-wrap">
        <table class="egx-v4-table">
          <thead>
            <tr>
              <th>الأولوية</th><th>الرمز</th><th>الاسم</th><th>السعر</th><th>التغير</th>
              <th>القرار</th><th>دخول من</th><th>دخول إلى</th><th>هدف 1</th><th>هدف 2</th><th>وقف خسارة</th>
              <th>ثقة</th><th>جودة</th><th>سبب</th><th>شارت</th>
            </tr>
          </thead>
          <tbody>
            ${rows.slice(0, 200).map((r, i) => `
              <tr data-symbol="${escapeHtml(r.symbol)}">
                <td>${Number(r.priority) <= 2 ? "🔥 " : ""}${fmt0(r.priority || i + 1)}</td>
                <td><b>${escapeHtml(r.symbol)}</b></td>
                <td>${escapeHtml(r.name_ar || r.name_en || r.name || "")}</td>
                <td>${fmt(r.price)}</td>
                <td>${fmt(r.changePct)}%</td>
                <td><span class="egx-v4-pill ${signalClass(r)}">${escapeHtml(r.recommendation || r.decision || "")}</span></td>
                <td>${fmt(r.entryFrom)}</td>
                <td>${fmt(r.entryTo)}</td>
                <td>${fmt(r.target1)}</td>
                <td>${fmt(r.target2)}</td>
                <td>${fmt(r.stopLoss)}</td>
                <td>${fmt0(r.finalConfidence)}%</td>
                <td>${fmt0(r.dataQualityScore)}%</td>
                <td title="${escapeHtml(r.reason || "")}">${escapeHtml(String(r.reason || "").slice(0, 70))}</td>
                <td><button class="egx-v4-chart-btn" data-chart="${escapeHtml(r.symbol)}">شارت</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div id="egxV4Portfolio" class="egx-v4-portfolio">
        <div class="egx-v4-card">
          <b>تحليل المحفظة</b>
          <div class="egx-v4-small">اكتب كل سهم في سطر بالشكل: SYMBOL,QUANTITY,AVG_COST مثل: COMI,100,78.5</div>
          <textarea id="egxV4PortfolioText" class="egx-v4-textarea" placeholder="COMI,100,78.5&#10;CCAP,5000,5.43"></textarea>
          <button id="egxV4AnalyzePortfolio" class="egx-v4-btn" style="margin-top:8px">حلل المحفظة</button>
          <div id="egxV4PortfolioResult"></div>
        </div>
      </div>
    `;
    const panel = document.getElementById("egxV4Panel");
    panel.innerHTML = html;
    bind();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  let searchTimer = null;
  function bind() {
    const search = document.getElementById("egxV4Search");
    const filter = document.getElementById("egxV4Filter");
    if (search) {
      search.focus({ preventScroll: true });
      const len = search.value.length;
      search.setSelectionRange(len, len);
      search.addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        const val = e.target.value;
        searchTimer = setTimeout(() => {
          S.q = val;
          render();
        }, 120);
      });
    }
    if (filter) filter.addEventListener("change", (e) => { S.filter = e.target.value; render(); });
    document.querySelectorAll("[data-chart]").forEach((btn) => btn.addEventListener("click", () => openChart(btn.dataset.chart)));
    const portBtn = document.getElementById("egxV4PortfolioBtn");
    const port = document.getElementById("egxV4Portfolio");
    if (portBtn && port) portBtn.addEventListener("click", () => port.classList.toggle("open"));
    const txt = document.getElementById("egxV4PortfolioText");
    const saved = localStorage.getItem("egx_v4_portfolio") || "";
    if (txt && !txt.value) txt.value = saved;
    const analyze = document.getElementById("egxV4AnalyzePortfolio");
    if (analyze) analyze.addEventListener("click", analyzePortfolio);
  }

  function historyFor(symbol) {
    const arr = S.history && S.history.prices && Array.isArray(S.history.prices[symbol]) ? S.history.prices[symbol] : [];
    return arr.filter((x) => x && x.price).slice(-80);
  }

  function svgChart(row, hist) {
    const w = 820, h = 360, pad = 42;
    const values = hist.length ? hist.map((x) => Number(x.price)) : [row.stopLoss, row.support1, row.price, row.target1, row.target2].filter(Boolean).map(Number);
    if (!values.length) values.push(1, 1.1);
    const min = Math.min(...values, row.stopLoss || Infinity, row.support1 || Infinity) * 0.98;
    const max = Math.max(...values, row.target2 || 0, row.resistance1 || 0) * 1.02;
    const y = (v) => h - pad - ((v - min) / Math.max(0.01, max - min)) * (h - pad * 2);
    const x = (i) => pad + (i / Math.max(1, values.length - 1)) * (w - pad * 2);

    const points = (hist.length ? hist.map((p) => Number(p.price)) : values).map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const levels = [
      ["السعر", row.price],
      ["دخول", row.entryTo],
      ["هدف 1", row.target1],
      ["هدف 2", row.target2],
      ["وقف", row.stopLoss]
    ].filter(([, v]) => v);

    return `
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="360" style="background:#071020;border:1px solid #1f3356;border-radius:14px">
        <line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" stroke="#29436f"/>
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}" stroke="#29436f"/>
        ${levels.map(([label, val]) => `
          <line x1="${pad}" y1="${y(val)}" x2="${w-pad}" y2="${y(val)}" stroke="#3b82f6" stroke-dasharray="5,5" opacity=".65"/>
          <text x="${w-pad-4}" y="${y(val)-5}" fill="#dbeafe" font-size="12" text-anchor="end">${label}: ${fmt(val)}</text>
        `).join("")}
        <polyline fill="none" stroke="#22c55e" stroke-width="3" points="${points}"/>
        ${values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="#93c5fd"/>`).join("")}
      </svg>
    `;
  }

  function openChart(symbol) {
    const row = S.rows.find((r) => r.symbol === symbol);
    if (!row) return;
    let modal = document.getElementById("egxV4Modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "egxV4Modal";
      document.body.appendChild(modal);
    }
    const hist = historyFor(symbol);
    modal.innerHTML = `
      <div class="box">
        <div class="modal-head">
          <div>
            <b>${escapeHtml(row.symbol)} — ${escapeHtml(row.name_ar || row.name_en || row.name || "")}</b>
            <div class="egx-v4-small">${escapeHtml(row.recommendation || row.decision || "")} | ثقة ${fmt0(row.finalConfidence)}%</div>
          </div>
          <button class="close">إغلاق</button>
        </div>
        ${svgChart(row, hist)}
        <div class="egx-v4-grid" style="margin-top:10px">
          <div class="egx-v4-card">دخول<b>${fmt(row.entryFrom)} - ${fmt(row.entryTo)}</b></div>
          <div class="egx-v4-card">هدف 1<b>${fmt(row.target1)}</b></div>
          <div class="egx-v4-card">هدف 2<b>${fmt(row.target2)}</b></div>
          <div class="egx-v4-card">وقف خسارة<b>${fmt(row.stopLoss)}</b></div>
        </div>
      </div>
    `;
    modal.style.display = "flex";
    modal.querySelector(".close").onclick = () => { modal.style.display = "none"; };
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; }, { once: true });
  }

  function analyzePortfolio() {
    const txt = document.getElementById("egxV4PortfolioText");
    const out = document.getElementById("egxV4PortfolioResult");
    if (!txt || !out) return;
    localStorage.setItem("egx_v4_portfolio", txt.value);
    const lines = txt.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((line) => {
      const [symbolRaw, qtyRaw, avgRaw] = line.split(/[,\t;]/).map((x) => String(x || "").trim());
      const symbol = String(symbolRaw || "").toUpperCase();
      const qty = Number(qtyRaw || 0);
      const avg = Number(avgRaw || 0);
      const rec = S.rows.find((r) => r.symbol === symbol);
      const price = rec && rec.price ? Number(rec.price) : null;
      const value = price ? price * qty : null;
      const cost = avg * qty;
      const pnl = value !== null ? value - cost : null;
      const pnlPct = value !== null && cost ? (pnl / cost) * 100 : null;
      let action = "غير متاح";
      if (rec) {
        if (rec.signal === "RISK_REDUCE") action = "راجع التخفيض / وقف الخسارة";
        else if (Number(rec.priority) <= 2 && pnlPct !== null && pnlPct < 0) action = "احتفاظ مشروط أو تعزيز صغير قرب الدعم";
        else if (Number(rec.priority) <= 2) action = "احتفاظ / مراقبة هدف";
        else if (rec.signal === "WATCH") action = "احتفاظ بحذر";
        else action = rec.decision || "انتظار";
      }
      return { symbol, qty, avg, price, value, cost, pnl, pnlPct, action, rec };
    });

    const totalValue = rows.reduce((s, r) => s + (r.value || 0), 0);
    const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
    const totalPnl = totalValue - totalCost;
    out.innerHTML = `
      <div class="egx-v4-small" style="margin:10px 0">القيمة: ${fmt(totalValue)} | التكلفة: ${fmt(totalCost)} | الربح/الخسارة: ${fmt(totalPnl)} (${fmt(totalCost ? totalPnl/totalCost*100 : 0)}%)</div>
      <div class="egx-v4-table-wrap">
        <table class="egx-v4-table">
          <thead><tr><th>الرمز</th><th>الكمية</th><th>متوسطك</th><th>السعر</th><th>القيمة</th><th>ربح/خسارة</th><th>توصية إدارة</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.symbol)}</td><td>${fmt0(r.qty)}</td><td>${fmt(r.avg)}</td><td>${fmt(r.price)}</td><td>${fmt(r.value)}</td><td>${fmt(r.pnl)} (${fmt(r.pnlPct)}%)</td><td>${escapeHtml(r.action)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }

  async function init() {
    injectStyles();
    S.market = await loadJson("data/market.json", { rows: [], summary: {} });
    S.recs = await loadJson("data/recommendations.json", {});
    S.history = await loadJson("data/history.json", { prices: {} });

    const rows = Array.isArray(S.recs.all) && S.recs.all.length ? S.recs.all : (Array.isArray(S.market.rows) ? S.market.rows : []);
    S.rows = rows.slice().sort((a, b) => (Number(a.priority || 99) - Number(b.priority || 99)) || (Number(b.finalConfidence || 0) - Number(a.finalConfidence || 0)));

    let panel = document.getElementById("egxV4Panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "egxV4Panel";
      const target = document.querySelector("main, .main, .content, #app") || document.body;
      target.prepend(panel);
    }
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
