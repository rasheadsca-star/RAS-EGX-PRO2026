const state = {
  market: null,
  sourceHealth: null,
  validation: null,
  dailyReport: null,
  currentView: "dashboard",
  filters: { q: "", signal: "ALL", minConfidence: 0 }
};

const viewMeta = {
  dashboard: ["لوحة السوق", "مركز القرار وسلامة البيانات والفرص الأعلى ثقة."],
  opportunities: ["الفرص التفصيلية", "جدول كامل لكل الأسهم مع سبب القرار والثقة."],
  liquidity: ["مراقب السيولة", "ترتيب الأسهم حسب قيمة التداول وحجم التداول."],
  volume: ["مراقب حجم التداول", "قراءة نشاط الحجم والسيولة المتاحة من مباشر."],
  support: ["الدعم والمقاومة", "Pivot والدعم والمقاومة والمسافات الحرجة."],
  decision: ["القرار الاستثماري", "Real Confidence Fusion: جودة + سيولة + حركة سعر + دعم/مقاومة + مصدر."],
  validation: ["مطابقة مباشر", "حالة قراءة رموز مباشر والأخطاء والروابط."],
  sources: ["صحة المصادر", "Source Health Center للبيانات العامة المتأخرة."],
  alerts: ["التنبيهات", "تنبيهات داخلية من البيانات الحالية."],
  watchlists: ["قوائم المراقبة", "شرح تعديل watchlist من config/watchlist.json."],
  dailyReport: ["التقرير اليومي", "ملخص يومي مولد من data/daily-report.json."],
  settings: ["الإعدادات", "حدود النسخة المجانية وطريقة التشغيل."]
};

function $(id){ return document.getElementById(id); }

function fmt(v, digits=2){
  if(v === null || v === undefined || Number.isNaN(Number(v))) return "--";
  return Number(v).toLocaleString(undefined,{maximumFractionDigits:digits});
}
function pct(v){
  if(v === null || v === undefined || Number.isNaN(Number(v))) return "--";
  return Number(v).toFixed(2) + "%";
}
function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function ageMinutes(iso){
  if(!iso) return Infinity;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}
function isStale(){
  const minutes = ageMinutes(state.market?.updatedAt);
  return minutes > 180;
}
function signalArabic(signal){
  return {
    WATCH_BUY:"مراقبة شراء",
    WATCH:"مراقبة",
    WAIT:"انتظار",
    RISK_REDUCE:"حذر / تخفيف",
    INVALID:"بيانات غير كافية"
  }[signal] || signal || "--";
}

async function fetchJson(path, fallback){
  try{
    const res = await fetch(path + "?ts=" + Date.now());
    if(!res.ok) throw new Error(path + " HTTP " + res.status);
    return await res.json();
  }catch(error){
    return { ...fallback, loadError: error.message };
  }
}

async function loadData(){
  const [market, sourceHealth, validation, dailyReport] = await Promise.all([
    fetchJson("data/market.json", { ok:false, rows:[], summary:{}, errors:[], message:"تعذر تحميل market.json" }),
    fetchJson("data/source-health.json", { ok:false, warning:"تعذر تحميل source-health.json" }),
    fetchJson("data/validation-report.json", { ok:false, warnings:["تعذر تحميل validation-report.json"] }),
    fetchJson("data/daily-report.json", { notes:["تعذر تحميل daily-report.json"] })
  ]);

  state.market = market;
  state.sourceHealth = sourceHealth;
  state.validation = validation;
  state.dailyReport = dailyReport;
  renderShell();
  renderCurrent();
}

function rows(){
  return state.market?.rows || [];
}

function filteredRows(){
  const q = state.filters.q.toUpperCase();
  return rows()
    .filter(row => !q || String(row.symbol || "").includes(q) || String(row.name || "").toUpperCase().includes(q))
    .filter(row => state.filters.signal === "ALL" || row.signal === state.filters.signal)
    .filter(row => (row.finalConfidence || row.confidence || 0) >= state.filters.minConfidence)
    .sort((a,b) => (b.finalConfidence || b.confidence || 0) - (a.finalConfidence || a.confidence || 0));
}

function renderShell(){
  const market = state.market || {};
  const badge = $("sourceBadge");
  const notice = $("notice");
  const stale = isStale();

  if(market.ok && !stale){
    badge.textContent = "Public Delayed OK";
    badge.className = "status-pill";
    notice.className = "notice good";
    notice.textContent = `${market.message || "تم تحميل البيانات."} آخر تحديث: ${market.updatedAt ? new Date(market.updatedAt).toLocaleString() : "--"}`;
  } else if(market.ok && stale) {
    badge.textContent = "بيانات قديمة";
    notice.className = "notice warn";
    notice.textContent = `البيانات قديمة. آخر تحديث: ${market.updatedAt ? new Date(market.updatedAt).toLocaleString() : "--"}. افتح Actions وشغّل Update EGX Market Data.`;
  } else {
    badge.textContent = "لا توجد بيانات";
    notice.className = "notice bad";
    notice.textContent = market.message || market.loadError || "لم يتم تحميل بيانات صالحة.";
  }
}

function setView(view){
  state.currentView = view;
  document.querySelectorAll(".nav").forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  document.querySelectorAll(".view").forEach(section => section.classList.toggle("active", section.id === view));
  const meta = viewMeta[view] || viewMeta.dashboard;
  $("viewTitle").textContent = meta[0];
  $("viewSubtitle").textContent = meta[1];
  renderCurrent();
}

function kpi(label, value, sub=""){
  return `<div class="card"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="muted">${esc(sub)}</div>` : ""}</div>`;
}

function signalBadge(signal){
  return `<span class="badge ${esc(signal)}">${esc(signalArabic(signal))}</span>`;
}

function confidenceBar(value){
  const n = Math.max(0, Math.min(100, Number(value || 0)));
  return `<div>${n}%<div class="progress"><span style="width:${n}%"></span></div></div>`;
}

function renderDashboard(){
  const m = state.market || {};
  const s = m.summary || {};
  const top = rows().filter(r => r.signal === "WATCH_BUY" || r.signal === "WATCH").slice(0, 8);

  $("dashboard").innerHTML = `
    <div class="grid kpis">
      ${kpi("آخر تحديث", m.updatedAt ? new Date(m.updatedAt).toLocaleTimeString() : "--", isStale() ? "بيانات قديمة" : "تحديث GitHub Actions")}
      ${kpi("عدد الأسهم", s.count || 0)}
      ${kpi("متوسط الثقة", (s.avgConfidence || 0) + "%")}
      ${kpi("جودة البيانات", (s.avgQuality || 0) + "%")}
      ${kpi("فرص مراقبة شراء", s.watchBuy || 0)}
      ${kpi("إشارات حذر", s.riskReduce || 0)}
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="section-title"><h3>أفضل فرص المراقبة</h3><span class="badge warn">ليست أوامر شراء</span></div>
        ${top.length ? top.map(renderOpportunityCard).join("") : `<div class="muted">لا توجد فرص مراقبة قوية حاليًا.</div>`}
      </div>
      <div class="panel">
        <div class="section-title"><h3>ملخص السوق</h3><span class="badge ok">Public Delayed</span></div>
        ${renderMarketSummary()}
      </div>
    </div>
  `;
}

function renderMarketSummary(){
  const market = state.market?.market || {};
  const summary = state.market?.summary || {};
  return `
    <p><b>المؤشر:</b> ${esc(market.index || "EGX30")} — <b>القيمة:</b> ${fmt(market.value)}</p>
    <p><b>الحجم:</b> ${fmt(market.volume)} — <b>قيمة التداول:</b> ${fmt(market.turnover)}</p>
    <p><b>وضع البيانات:</b> عامة ومتأخرة — <b>متوسط الثقة:</b> ${summary.avgConfidence || 0}%</p>
    <p class="muted">مصدر القراءة: ${esc(state.market?.source || "mubasher_public_pages_via_github_actions")}</p>
  `;
}

function renderOpportunityCard(row){
  return `
    <div class="alert ${row.signal === "WATCH_BUY" ? "good" : row.signal === "RISK_REDUCE" ? "risk" : "warn"}">
      <div class="section-title">
        <div><b>${esc(row.symbol)}</b> <span class="muted">${esc(row.name || "")}</span></div>
        ${signalBadge(row.signal)}
      </div>
      <div>${esc(row.reason || "")}</div>
      <div class="muted">السعر: ${fmt(row.price)} | الثقة: ${row.finalConfidence || row.confidence || 0}% | الجودة: ${row.dataQualityScore || 0}%</div>
    </div>
  `;
}

function renderToolbar(){
  return `
    <div class="toolbar">
      <input id="filterQ" placeholder="بحث بالرمز أو الاسم" value="${esc(state.filters.q)}"/>
      <select id="filterSignal">
        ${["ALL","WATCH_BUY","WATCH","WAIT","RISK_REDUCE","INVALID"].map(sig => `<option value="${sig}" ${state.filters.signal===sig?"selected":""}>${sig==="ALL"?"كل الإشارات":signalArabic(sig)}</option>`).join("")}
      </select>
      <input id="filterConfidence" type="number" min="0" max="100" value="${state.filters.minConfidence}" placeholder="أقل ثقة"/>
    </div>
  `;
}

function bindToolbar(){
  const q = $("filterQ"), sig = $("filterSignal"), min = $("filterConfidence");
  if(q) q.addEventListener("input", e => { state.filters.q = e.target.value; renderCurrent(); });
  if(sig) sig.addEventListener("change", e => { state.filters.signal = e.target.value; renderCurrent(); });
  if(min) min.addEventListener("input", e => { state.filters.minConfidence = Number(e.target.value || 0); renderCurrent(); });
}

function renderMainTable(targetId, sortedRows = filteredRows()){
  $(targetId).innerHTML = `
    ${renderToolbar()}
    <div class="panel">
      <div class="section-title"><h3>جدول التحليل</h3><span>${sortedRows.length} صف</span></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الرمز</th><th>السعر</th><th>التغير</th><th>الحجم</th><th>قيمة التداول</th>
              <th>Pivot</th><th>دعم 1</th><th>مقاومة 1</th><th>للدعم</th><th>للمقاومة</th>
              <th>الإشارة</th><th>الثقة</th><th>الجودة</th><th>السبب</th>
            </tr>
          </thead>
          <tbody>
            ${sortedRows.map(row => `
              <tr>
                <td><b>${esc(row.symbol)}</b><div class="muted">${esc(row.name || "")}</div></td>
                <td>${fmt(row.price)}</td>
                <td class="${(row.changePct || 0) >= 0 ? "good" : "bad"}">${pct(row.changePct)}</td>
                <td>${fmt(row.volume,0)}</td>
                <td>${fmt(row.turnover,0)}</td>
                <td>${fmt(row.pivot)}</td>
                <td>${fmt(row.support1)}</td>
                <td>${fmt(row.resistance1)}</td>
                <td>${pct(row.distanceToSupport)}</td>
                <td>${pct(row.distanceToResistance)}</td>
                <td>${signalBadge(row.signal)}</td>
                <td>${confidenceBar(row.finalConfidence || row.confidence || 0)}</td>
                <td>${row.dataQualityScore || 0}%</td>
                <td>${esc(row.reason || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
  bindToolbar();
}

function renderLiquidity(){
  const sorted = filteredRows().slice().sort((a,b) => (b.turnover || 0) - (a.turnover || 0));
  $("liquidity").innerHTML = `
    <div class="grid kpis">
      ${kpi("أعلى قيمة تداول", sorted[0]?.symbol || "--", fmt(sorted[0]?.turnover,0))}
      ${kpi("متوسط سيولة", rows().length ? Math.round(rows().reduce((a,b)=>a+(b.liquidityScore||0),0)/rows().length)+"%" : "--")}
      ${kpi("سيولة قوية", rows().filter(r => (r.liquidityScore || 0) >= 65).length)}
    </div>
  `;
  renderMainTable("liquidity", sorted);
}

function renderVolume(){
  const sorted = filteredRows().slice().sort((a,b) => (b.volume || 0) - (a.volume || 0));
  renderMainTable("volume", sorted);
}

function renderSupport(){
  const sorted = filteredRows().slice().sort((a,b) => Math.abs(a.distanceToSupport ?? 999) - Math.abs(b.distanceToSupport ?? 999));
  renderMainTable("support", sorted);
}

function renderDecision(){
  const data = filteredRows();
  $("decision").innerHTML = `
    <div class="three-col">
      <div class="panel"><h3>معادلة الثقة</h3><p class="muted">dataQuality 25% + liquidity 25% + priceAction 20% + supportResistance 20% + source 10% - riskPenalty</p></div>
      <div class="panel"><h3>أقوى قرار</h3>${data[0] ? renderOpportunityCard(data[0]) : "لا توجد بيانات"}</div>
      <div class="panel"><h3>أعلى مخاطرة</h3>${data.slice().sort((a,b)=>(b.riskScore||0)-(a.riskScore||0))[0] ? renderOpportunityCard(data.slice().sort((a,b)=>(b.riskScore||0)-(a.riskScore||0))[0]) : "لا توجد بيانات"}</div>
    </div>
    <br/>
  `;
  renderMainTable("decision", data);
}

function renderValidation(){
  const v = state.validation || {};
  $("validation").innerHTML = `
    <div class="grid kpis">
      ${kpi("الرموز المطلوبة", v.requestedSymbols || 0)}
      ${kpi("الرموز المقروءة", v.readSymbols || 0)}
      ${kpi("رموز ناقصة", (v.missingSymbols || []).length)}
      ${kpi("صالح للعرض", v.validForDisplay ? "نعم" : "لا")}
    </div>
    <div class="two-col">
      <div class="panel"><h3>التحذيرات</h3>${(v.warnings || []).map(w => `<div class="alert warn">${esc(w)}</div>`).join("") || "<p class='muted'>لا توجد تحذيرات.</p>"}</div>
      <div class="panel"><h3>أخطاء مباشر</h3>${(state.market?.errors || []).map(e => `<div class="alert risk"><b>${esc(e.symbol || "")}</b> ${esc(e.error || "")}</div>`).join("") || "<p class='muted'>لا توجد أخطاء.</p>"}</div>
    </div>
    <br/>
  `;
  renderMainTable("validation", rows());
}

function renderSources(){
  const h = state.sourceHealth || {};
  $("sources").innerHTML = `
    <div class="grid kpis">
      ${kpi("المصدر", h.sourceName || "--")}
      ${kpi("الحالة", h.ok ? "OK" : "FAILED")}
      ${kpi("آخر نجاح", h.lastSuccessAt ? new Date(h.lastSuccessAt).toLocaleString() : "--")}
      ${kpi("الصفوف", h.rowsRead || 0)}
      ${kpi("متوسط الجودة", (h.avgDataQuality || 0) + "%")}
      ${kpi("الوضع", h.mode || "public_delayed")}
    </div>
    <div class="panel">
      <h3>Source Health Center</h3>
      <p>${esc(h.warning || "")}</p>
      <p class="muted">الرموز الفاشلة: ${(h.failedSymbols || []).join(", ") || "لا توجد"}</p>
    </div>
  `;
}

function renderAlerts(){
  const alerts = [];
  rows().forEach(row => {
    if(row.signal === "RISK_REDUCE") alerts.push({type:"risk", text:`${row.symbol}: ${row.reason}`});
    if(row.distanceToSupport !== null && row.distanceToSupport < 0) alerts.push({type:"risk", text:`${row.symbol}: كسر دعم ${fmt(row.support1)}`});
    if(row.distanceToResistance !== null && row.distanceToResistance < 0) alerts.push({type:"good", text:`${row.symbol}: اختراق مقاومة ${fmt(row.resistance1)}`});
    if((row.liquidityScore || 0) >= 65) alerts.push({type:"good", text:`${row.symbol}: سيولة قوية`});
    if((row.dataQualityScore || 0) < 50) alerts.push({type:"warn", text:`${row.symbol}: جودة بيانات منخفضة`});
  });
  $("alerts").innerHTML = `<div class="panel"><h3>التنبيهات الداخلية</h3>${alerts.length ? alerts.map(a=>`<div class="alert ${a.type}">${esc(a.text)}</div>`).join("") : "<p class='muted'>لا توجد تنبيهات.</p>"}</div>`;
}

function renderWatchlists(){
  $("watchlists").innerHTML = `
    <div class="panel">
      <h3>تعديل قوائم المراقبة</h3>
      <p>في GitHub Pages لا يمكن تعديل ملف watchlist من الواجهة مباشرة. عدّل الملف التالي داخل الريبو:</p>
      <pre>config/watchlist.json</pre>
      <p class="muted">استخدم رموز مباشر مثل COMI للبنك التجاري الدولي، ثم شغّل Workflow: Update EGX Market Data.</p>
    </div>
  `;
}

function renderDailyReport(){
  const d = state.dailyReport || {};
  $("dailyReport").innerHTML = `
    <div class="two-col">
      <div class="panel"><h3>Top Watch Buy</h3>${(d.topWatchBuy || []).map(x=>`<div class="alert good"><b>${esc(x.symbol)}</b> ${esc(x.reason)} — ثقة ${x.finalConfidence}%</div>`).join("") || "<p class='muted'>لا توجد.</p>"}</div>
      <div class="panel"><h3>Risk Reduce</h3>${(d.riskReduce || []).map(x=>`<div class="alert risk"><b>${esc(x.symbol)}</b> ${esc(x.reason)} — ثقة ${x.finalConfidence}%</div>`).join("") || "<p class='muted'>لا توجد.</p>"}</div>
    </div>
    <br/>
    <div class="panel"><h3>ملاحظات</h3>${(d.notes || []).map(n=>`<p class="muted">${esc(n)}</p>`).join("")}</div>
  `;
}

function renderSettings(){
  $("settings").innerHTML = `
    <div class="panel">
      <h3>حدود النسخة المجانية</h3>
      <p>تعمل بدون Backend دائم. GitHub Actions يجمع البيانات كل 30 دقيقة من الصفحات العامة المتاحة.</p>
      <p>لا توجد بيانات مدفوعة، لا Login، لا CAPTCHA bypass، ولا لحظية حقيقية. البيانات Public / Delayed.</p>
      <h3>التحديث اليدوي</h3>
      <p>اضغط زر "تحديث البيانات" بالأعلى، ثم Run workflow داخل GitHub Actions.</p>
      <h3>التطوير القادم</h3>
      <p class="muted">API رسمي، تنبيهات Telegram، استيراد محفظة، Backtest من ملف تاريخي.</p>
    </div>
  `;
}

function renderCurrent(){
  if(!state.market) return;
  if(state.currentView === "dashboard") renderDashboard();
  else if(state.currentView === "opportunities") renderMainTable("opportunities");
  else if(state.currentView === "liquidity") renderLiquidity();
  else if(state.currentView === "volume") renderVolume();
  else if(state.currentView === "support") renderSupport();
  else if(state.currentView === "decision") renderDecision();
  else if(state.currentView === "validation") renderValidation();
  else if(state.currentView === "sources") renderSources();
  else if(state.currentView === "alerts") renderAlerts();
  else if(state.currentView === "watchlists") renderWatchlists();
  else if(state.currentView === "dailyReport") renderDailyReport();
  else if(state.currentView === "settings") renderSettings();
}

function exportCsv(){
  const columns = ["symbol","name","price","changePct","volume","turnover","pivot","support1","resistance1","distanceToSupport","distanceToResistance","signal","decision","finalConfidence","dataQualityScore","reason","sourceUrl","supportResistanceUrl"];
  const csv = [
    columns.join(","),
    ...rows().map(row => columns.map(col => `"${String(row[col] ?? "").replaceAll('"','""')}"`).join(","))
  ].join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "egx-pro-hub-web-report.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll(".nav").forEach(btn => btn.addEventListener("click", () => setView(btn.dataset.view)));
$("reloadData").addEventListener("click", loadData);
$("exportCsv").addEventListener("click", exportCsv);
$("printPage").addEventListener("click", () => window.print());

loadData();
setInterval(loadData, 60000);
