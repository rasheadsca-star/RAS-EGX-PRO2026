/*
EGX Pro Hub V5.1 Global Intelligence Layer
Works on top of V5 / V4.2.
Adds:
- Global Intelligence panel
- Export CSV / JSON / HTML report
- Watchlist focus
- Smart alerts
- Session report viewer
- News/report placeholder viewer
No external libraries.
*/

(function () {
  "use strict";

  const STATE = {
    market: {},
    recs: {},
    source: {},
    proReport: {},
    alerts: {},
    rows: [],
    watchlist: [],
    query: ""
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m]));
  }

  function fmt(v, d = 2) {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "-";
    return Number(v).toLocaleString("ar-EG", { maximumFractionDigits: d, minimumFractionDigits: d });
  }

  function fmt0(v) {
    if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "-";
    return Number(v).toLocaleString("ar-EG", { maximumFractionDigits: 0 });
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[أإآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[ًٌٍَُِّْـ]/g, "")
      .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function loadJson(path, fallback) {
    try {
      const r = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return fallback;
      return await r.json();
    } catch {
      return fallback;
    }
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function rowsSorted() {
    return STATE.rows.slice().sort((a, b) => {
      const pa = Number(a.priority || 99), pb = Number(b.priority || 99);
      if (pa !== pb) return pa - pb;
      return Number(b.finalConfidence || 0) - Number(a.finalConfidence || 0);
    });
  }

  function rowText(r) {
    return norm([
      r.symbol, r.name, r.name_ar, r.name_en, r.recommendation,
      r.decision, r.reason, ...(Array.isArray(r.aliases) ? r.aliases : [])
    ].filter(Boolean).join(" "));
  }

  function filteredFocusRows() {
    const q = norm(STATE.query);
    const hasWatch = STATE.watchlist.length > 0;
    return rowsSorted().filter(r => {
      const qOk = !q || rowText(r).includes(q);
      const wOk = !hasWatch || STATE.watchlist.includes(String(r.symbol || "").toUpperCase());
      return qOk && wOk;
    });
  }

  function calcPulse() {
    const valid = STATE.rows.filter(r => r.signal !== "INVALID");
    const buy = valid.filter(r => Number(r.priority || 99) <= 2).length;
    const risk = valid.filter(r => r.signal === "RISK_REDUCE").length;
    const up = valid.filter(r => Number(r.changePct || 0) > 0).length;
    const breadth = valid.length ? Math.round((up / valid.length) * 100) : 0;
    const conf = valid.length ? Math.round(valid.reduce((s, r) => s + Number(r.finalConfidence || 0), 0) / valid.length) : 0;
    const status = breadth >= 60 && buy >= risk ? "إيجابي انتقائي" : breadth < 40 || risk > buy * 1.5 ? "حذر" : "متوازن";
    return { valid: valid.length, buy, risk, up, breadth, conf, status };
  }

  function buildLocalAlerts() {
    const alerts = [];
    for (const r of STATE.rows) {
      const price = Number(r.price || 0);
      if (!price || r.signal === "INVALID") continue;

      if (Number(r.priority || 99) <= 2 && r.entryFrom && r.entryTo) {
        const a = Number(r.entryFrom), b = Number(r.entryTo);
        if (price >= a * 0.985 && price <= b * 1.015) {
          alerts.push({ level: "success", symbol: r.symbol, title: "داخل منطقة الدخول", text: `${r.symbol}: السعر ${fmt(price)} قريب من دخول ${fmt(a)} - ${fmt(b)}.` });
        }
      }

      if (r.target1 && price >= Number(r.target1) * 0.985) {
        alerts.push({ level: "info", symbol: r.symbol, title: "قريب من هدف 1", text: `${r.symbol}: قريب من هدف ${fmt(r.target1)}.` });
      }

      if (r.stopLoss && price <= Number(r.stopLoss) * 1.015) {
        alerts.push({ level: "danger", symbol: r.symbol, title: "قريب من وقف الخسارة", text: `${r.symbol}: قريب من وقف ${fmt(r.stopLoss)}.` });
      }

      if (r.signal === "RISK_REDUCE") {
        alerts.push({ level: "danger", symbol: r.symbol, title: "حذر / تخفيف", text: r.reason || "إشارة مخاطرة." });
      }
    }
    return alerts.slice(0, 60);
  }

  function exportCSV() {
    const rows = filteredFocusRows();
    const headers = ["priority","symbol","name_ar","price","changePct","recommendation","entryFrom","entryTo","target1","target2","stopLoss","riskReward","confidence","quality","reason"];
    const csv = [
      headers.join(","),
      ...rows.map(r => headers.map(h => {
        let v = h === "confidence" ? r.finalConfidence : h === "quality" ? r.dataQualityScore : r[h];
        v = String(v ?? "").replace(/"/g, '""');
        return `"${v}"`;
      }).join(","))
    ].join("\n");
    downloadFile("egx-pro-hub-v5-opportunities.csv", csv, "text/csv;charset=utf-8");
  }

  function exportJSON() {
    downloadFile("egx-pro-hub-v5-opportunities.json", JSON.stringify(filteredFocusRows(), null, 2), "application/json;charset=utf-8");
  }

  function exportHTMLReport() {
    const p = calcPulse();
    const top = rowsSorted().filter(r => Number(r.priority || 99) <= 2).slice(0, 15);
    const risk = rowsSorted().filter(r => r.signal === "RISK_REDUCE").slice(0, 15);
    const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><title>EGX Pro Hub Report</title>
<style>
body{font-family:Tahoma,Arial,sans-serif;background:#f4f7fb;color:#111827;padding:28px;line-height:1.8}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 8px 22px rgba(15,23,42,.06)}
table{width:100%;border-collapse:collapse;background:#fff}th,td{border:1px solid #e5e7eb;padding:8px;text-align:right;font-size:13px}th{background:#eaf2ff}
.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#eaf2ff;font-weight:bold}
</style></head>
<body>
<h1>EGX Pro Hub V5.1 — تقرير السوق</h1>
<div class="card">
<p><b>حالة السوق:</b> ${esc(p.status)}</p>
<p><b>تغطية السوق:</b> ${fmt0(STATE.source.universeCoveragePct || 0)}% — ${fmt0(STATE.source.cacheRows || STATE.rows.length)} من ${fmt0(STATE.source.totalUniverse || STATE.rows.length)} سهم.</p>
<p><b>متوسط الثقة:</b> ${fmt0(p.conf)}% — <b>اتساع الصعود:</b> ${fmt0(p.breadth)}%</p>
<p><b>تنبيه:</b> البيانات عامة ومتأخرة وليست توصية مالية ملزمة.</p>
</div>
<div class="card"><h2>أفضل الفرص</h2>${htmlTable(top)}</div>
<div class="card"><h2>قائمة الحذر</h2>${htmlTable(risk)}</div>
</body></html>`;
    downloadFile("egx-pro-hub-v5-report.html", html, "text/html;charset=utf-8");
  }

  function htmlTable(rows) {
    if (!rows.length) return "<p>لا توجد بيانات.</p>";
    return `<table><thead><tr><th>الرمز</th><th>السعر</th><th>القرار</th><th>دخول</th><th>هدف 1</th><th>وقف</th><th>ثقة</th></tr></thead><tbody>${
      rows.map(r => `<tr><td>${esc(r.symbol)}</td><td>${fmt(r.price)}</td><td>${esc(r.recommendation || r.decision || "")}</td><td>${fmt(r.entryFrom)} - ${fmt(r.entryTo)}</td><td>${fmt(r.target1)}</td><td>${fmt(r.stopLoss)}</td><td>${fmt0(r.finalConfidence)}%</td></tr>`).join("")
    }</tbody></table>`;
  }

  function setWatchlistFromText(text) {
    STATE.watchlist = String(text || "")
      .split(/[\s,;،\n\r]+/)
      .map(x => x.trim().toUpperCase())
      .filter(Boolean);
    localStorage.setItem("egx_v51_watchlist", JSON.stringify(STATE.watchlist));
    render();
  }

  function loadWatchlist() {
    try {
      const w = JSON.parse(localStorage.getItem("egx_v51_watchlist") || "[]");
      STATE.watchlist = Array.isArray(w) ? w : [];
    } catch {
      STATE.watchlist = [];
    }
  }

  function injectStyle() {
    if (document.getElementById("egxV51Style")) return;
    const style = document.createElement("style");
    style.id = "egxV51Style";
    style.textContent = `
      #egxV51{direction:rtl;margin:14px 8px 22px;padding:16px;border-radius:24px;color:#eaf2ff;background:linear-gradient(135deg,#061224,#0b1c34 55%,#07101e);border:1px solid rgba(56,189,248,.28);box-shadow:0 26px 70px rgba(0,0,0,.35);font-family:Tahoma,Arial,sans-serif}
      #egxV51 *{box-sizing:border-box}
      .v51top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
      .v51top h2{margin:0;font-size:24px;font-weight:950}
      .v51muted{color:#9fb5d5;font-size:12px;line-height:1.7}
      .v51badges{display:flex;gap:8px;flex-wrap:wrap}
      .v51badge{background:#0b1b33;border:1px solid #294a78;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:800}
      .v51grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:12px 0}
      .v51card{background:#08182d;border:1px solid rgba(97,137,202,.24);border-radius:18px;padding:12px}
      .v51card span{display:block;color:#9fb5d5;font-size:12px}.v51card b{display:block;margin-top:5px;font-size:20px}
      .v51controls{display:grid;grid-template-columns:1fr 210px 210px;gap:10px;margin:12px 0}
      .v51input,.v51btn,.v51textarea{background:#071326;color:#fff;border:1px solid #28456f;border-radius:14px;padding:11px;outline:none}
      .v51btn{background:#126aaa;border-color:#1684d8;font-weight:900;cursor:pointer}
      .v51btn.dark{background:#10233f;border-color:#315780}
      .v51layout{display:grid;grid-template-columns:1.25fr .75fr;gap:12px}
      .v51tablewrap{overflow:auto;border:1px solid rgba(97,137,202,.26);border-radius:18px;background:rgba(5,13,27,.58)}
      .v51table{width:100%;border-collapse:collapse;min-width:980px}
      .v51table th,.v51table td{padding:10px 8px;border-bottom:1px solid rgba(97,137,202,.18);white-space:nowrap;text-align:right;font-size:13px}
      .v51table th{background:#0b1a31;color:#dbeafe}
      .v51tag{display:inline-block;padding:5px 8px;border-radius:999px;font-size:12px;font-weight:900}
      .success{background:#063b23;color:#80ffb7}.danger{background:#3b0b16;color:#ff9fb2}.info{background:#092d4a;color:#a7dcff}.warn{background:#332707;color:#ffe18a}
      .v51list{display:grid;gap:8px;max-height:470px;overflow:auto}
      .v51item{background:#08182d;border:1px solid rgba(97,137,202,.22);border-radius:14px;padding:10px}
      .v51item h4{margin:0 0 5px;font-size:14px}.v51item p{margin:0;color:#a7bad7;font-size:12px;line-height:1.6}
      .v51actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
      @media(max-width:1050px){.v51layout{grid-template-columns:1fr}.v51grid{grid-template-columns:repeat(2,minmax(0,1fr))}.v51controls{grid-template-columns:1fr}}
      @media(max-width:560px){.v51grid{grid-template-columns:1fr}.v51top h2{font-size:20px}}
    `;
    document.head.appendChild(style);
  }

  function tagLevel(level) {
    if (level === "danger") return "danger";
    if (level === "success") return "success";
    if (level === "info") return "info";
    return "warn";
  }

  function render() {
    const p = calcPulse();
    const rows = filteredFocusRows().slice(0, 120);
    const top = rowsSorted().filter(r => Number(r.priority || 99) <= 2).slice(0, 10);
    const alerts = buildLocalAlerts().slice(0, 16);
    const panel = document.getElementById("egxV51");
    const last = STATE.source.generatedAt ? new Date(STATE.source.generatedAt).toLocaleString("ar-EG") : "-";

    panel.innerHTML = `
      <div class="v51top">
        <div>
          <h2>🌍 EGX Pro Hub V5.1 Global Intelligence</h2>
          <div class="v51muted">طبقة ذكاء تنفيذية للتقارير، التنبيهات، التصدير، Watchlist، ومتابعة الفرص. آخر تحديث: ${esc(last)}</div>
        </div>
        <div class="v51badges">
          <span class="v51badge">Universe ${fmt0(STATE.source.totalUniverse || STATE.rows.length)}</span>
          <span class="v51badge">Coverage ${fmt0(STATE.source.universeCoveragePct || 0)}%</span>
          <span class="v51badge">Cache ${fmt0(STATE.source.cacheRows || STATE.rows.length)}</span>
          <span class="v51badge">Quality ${fmt0(STATE.source.avgDataQuality || 0)}%</span>
        </div>
      </div>

      <div class="v51grid">
        <div class="v51card"><span>حالة السوق</span><b>${esc(p.status)}</b></div>
        <div class="v51card"><span>فرص شراء</span><b>${fmt0(p.buy)}</b></div>
        <div class="v51card"><span>حذر</span><b>${fmt0(p.risk)}</b></div>
        <div class="v51card"><span>اتساع الصعود</span><b>${fmt0(p.breadth)}%</b></div>
        <div class="v51card"><span>متوسط الثقة</span><b>${fmt0(p.conf)}%</b></div>
      </div>

      <div class="v51actions">
        <button class="v51btn" id="v51ExportCsv">Export CSV</button>
        <button class="v51btn" id="v51ExportJson">Export JSON</button>
        <button class="v51btn" id="v51ExportHtml">HTML Report</button>
        <button class="v51btn dark" id="v51ClearWatch">Clear Watchlist</button>
      </div>

      <div class="v51controls">
        <input id="v51Search" class="v51input" dir="auto" autocomplete="off" placeholder="بحث عربي/إنجليزي/رمز" value="${esc(STATE.query)}">
        <input id="v51WatchInput" class="v51input" dir="ltr" placeholder="Watchlist: COMI CCAP FWRY" value="${esc(STATE.watchlist.join(" "))}">
        <button class="v51btn" id="v51ApplyWatch">تطبيق Watchlist</button>
      </div>

      <div class="v51layout">
        <div>
          <div class="v51tablewrap">
            <table class="v51table">
              <thead><tr><th>الأولوية</th><th>الرمز</th><th>الاسم</th><th>السعر</th><th>القرار</th><th>دخول</th><th>هدف</th><th>وقف</th><th>ثقة</th><th>سبب</th></tr></thead>
              <tbody>${rows.map((r, i) => `
                <tr>
                  <td>${Number(r.priority || 99) <= 2 ? "🔥" : ""} ${fmt0(r.priority || i + 1)}</td>
                  <td><b>${esc(r.symbol)}</b></td>
                  <td>${esc(r.name_ar || r.name_en || r.name || "")}</td>
                  <td>${fmt(r.price)}</td>
                  <td>${esc(r.recommendation || r.decision || "")}</td>
                  <td>${fmt(r.entryFrom)} - ${fmt(r.entryTo)}</td>
                  <td>${fmt(r.target1)} / ${fmt(r.target2)}</td>
                  <td>${fmt(r.stopLoss)}</td>
                  <td>${fmt0(r.finalConfidence)}%</td>
                  <td title="${esc(r.reason || "")}">${esc(String(r.reason || "").slice(0, 70))}</td>
                </tr>`).join("")}</tbody>
            </table>
          </div>
        </div>
        <div>
          <div class="v51card">
            <h3 style="margin:0 0 10px">Executive Brief</h3>
            <div class="v51item"><p>السوق: ${esc(p.status)}. التغطية ${fmt0(STATE.source.universeCoveragePct || 0)}% من ${fmt0(STATE.source.totalUniverse || STATE.rows.length)} سهم.</p></div>
            <div class="v51item"><p>أفضل فرص: ${top.map(r => `${r.symbol} (${fmt0(r.finalConfidence)}%)`).join("، ") || "لا توجد"}.</p></div>
          </div>

          <div class="v51card" style="margin-top:12px">
            <h3 style="margin:0 0 10px">Smart Alerts</h3>
            <div class="v51list">${alerts.map(a => `
              <div class="v51item"><h4><span class="v51tag ${tagLevel(a.level)}">${esc(a.symbol)}</span> ${esc(a.title)}</h4><p>${esc(a.text)}</p></div>`).join("") || `<div class="v51item"><p>لا توجد تنبيهات حرجة حاليًا.</p></div>`}</div>
          </div>
        </div>
      </div>
    `;

    bind();
  }

  function bind() {
    const search = document.getElementById("v51Search");
    if (search) {
      let t = null;
      search.addEventListener("input", e => {
        clearTimeout(t);
        const value = e.target.value;
        t = setTimeout(() => {
          STATE.query = value;
          render();
        }, 120);
      });
    }

    const applyWatch = document.getElementById("v51ApplyWatch");
    if (applyWatch) applyWatch.addEventListener("click", () => {
      setWatchlistFromText(document.getElementById("v51WatchInput")?.value || "");
    });

    const clearWatch = document.getElementById("v51ClearWatch");
    if (clearWatch) clearWatch.addEventListener("click", () => setWatchlistFromText(""));

    document.getElementById("v51ExportCsv")?.addEventListener("click", exportCSV);
    document.getElementById("v51ExportJson")?.addEventListener("click", exportJSON);
    document.getElementById("v51ExportHtml")?.addEventListener("click", exportHTMLReport);
  }

  async function init() {
    injectStyle();
    loadWatchlist();

    const [market, recs, source, fullCache, proReport, alerts] = await Promise.all([
      loadJson("data/market.json", { rows: [] }),
      loadJson("data/recommendations.json", { all: [] }),
      loadJson("data/source-health.json", {}),
      loadJson("data/full-market-cache.json", { rows: [] }),
      loadJson("data/pro-report.json", {}),
      loadJson("data/alerts.json", {})
    ]);

    STATE.market = market || {};
    STATE.recs = recs || {};
    STATE.source = source || {};
    STATE.proReport = proReport || {};
    STATE.alerts = alerts || {};

    STATE.rows =
      (Array.isArray(recs.all) && recs.all.length && recs.all) ||
      (Array.isArray(fullCache.rows) && fullCache.rows.length && fullCache.rows) ||
      (Array.isArray(market.rows) && market.rows) ||
      [];

    let panel = document.getElementById("egxV51");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "egxV51";
      const v5 = document.getElementById("egxV5Terminal");
      if (v5 && v5.parentNode) v5.parentNode.insertBefore(panel, v5.nextSibling);
      else (document.querySelector("main, .main, .content, #app") || document.body).prepend(panel);
    }

    render();
    console.log("EGX V5.1 Global Intelligence loaded:", STATE.rows.length);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
