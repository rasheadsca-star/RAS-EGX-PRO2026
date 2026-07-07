/* EGX Pro Hub V5.5 Sector & Investor Flow Intelligence
   Purpose: sector rotation, liquidity distribution, portfolio sector allocation, investor type impact.
   Safe layer: reads JSON only; does NOT write cache or reset V4.2.
*/
(function () {
  'use strict';

  const VERSION = '5.5.0-sector-investor-flow';
  const ROOT_ID = 'egx-v55-sector-flow';
  const files = {
    sector: 'data/sector-report.json',
    investor: 'data/investor-flow-report.json',
    universe: 'data/universe-index.json',
    health: 'data/source-health.json'
  };

  const state = { tab: localStorage.getItem('egx.v55.tab') || 'sector', sectorLimit: 10 };
  const nf = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('ar-EG', { notation: 'compact', maximumFractionDigits: 1 });

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmt(v) {
    const n = Number(v);
    return Number.isFinite(n) ? nf.format(n) : '—';
  }

  function money(v) {
    const n = Number(v);
    return Number.isFinite(n) ? compact.format(n) : '—';
  }

  function pct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${n > 0 ? '+' : ''}${fmt(n)}%`;
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

  function injectStyles() {
    if ($('#egx-v55-styles')) return;
    const style = document.createElement('style');
    style.id = 'egx-v55-styles';
    style.textContent = `
      #${ROOT_ID}{direction:rtl;font-family:Inter,Tahoma,Arial,sans-serif;margin:18px auto;max-width:1180px;color:#0f172a}
      #${ROOT_ID} *{box-sizing:border-box}
      .v55-shell{border:1px solid rgba(15,23,42,.09);border-radius:28px;background:linear-gradient(145deg,#ffffff 0%,#f8fbff 54%,#f2f7ff 100%);box-shadow:0 24px 70px rgba(15,23,42,.09);overflow:hidden}
      .v55-hero{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;padding:24px 26px 18px;border-bottom:1px solid rgba(15,23,42,.08);background:radial-gradient(circle at 95% 0%,rgba(14,165,233,.16),transparent 34%),radial-gradient(circle at 4% 0%,rgba(16,185,129,.12),transparent 26%)}
      .v55-title h2{margin:0;font-size:25px;line-height:1.25;color:#0b1220;letter-spacing:-.02em}.v55-title p{margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.8;max-width:720px}
      .v55-badge{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(14,165,233,.22);background:rgba(255,255,255,.76);border-radius:999px;padding:8px 12px;color:#075985;font-weight:800;font-size:12px;white-space:nowrap}
      .v55-tabs{display:flex;gap:8px;flex-wrap:wrap;padding:14px 22px;background:rgba(255,255,255,.66);border-bottom:1px solid rgba(15,23,42,.07)}
      .v55-tab{border:1px solid rgba(15,23,42,.1);background:#fff;color:#334155;border-radius:999px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer;transition:.18s}.v55-tab:hover{transform:translateY(-1px);box-shadow:0 8px 22px rgba(15,23,42,.08)}.v55-tab.active{background:#0f172a;color:#fff;border-color:#0f172a}
      .v55-body{padding:22px}.v55-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:16px}.v55-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.v55-card{border:1px solid rgba(15,23,42,.08);background:rgba(255,255,255,.86);border-radius:20px;padding:16px;box-shadow:0 10px 28px rgba(15,23,42,.05)}.v55-card .label{font-size:12px;color:#64748b;font-weight:800}.v55-card .value{margin-top:8px;font-size:24px;font-weight:950;color:#0f172a}.v55-card .hint{margin-top:7px;font-size:12px;color:#64748b;line-height:1.5}
      .v55-panel{border:1px solid rgba(15,23,42,.08);background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,.05)}.v55-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid rgba(15,23,42,.07)}.v55-panel-head h3{margin:0;font-size:17px;color:#0f172a}.v55-panel-head p{margin:4px 0 0;color:#64748b;font-size:12px;line-height:1.5}.v55-panel-body{padding:16px 18px}
      .v55-sector-row{display:grid;grid-template-columns:minmax(160px,1.1fr) 1.5fr 78px 86px;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(15,23,42,.06)}.v55-sector-row:last-child{border-bottom:0}.v55-sector-name{font-weight:950;color:#0f172a}.v55-sector-meta{font-size:12px;color:#64748b;margin-top:4px}.v55-bar{height:11px;background:#e2e8f0;border-radius:99px;overflow:hidden}.v55-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#0ea5e9,#14b8a6)}.v55-score{font-weight:950;color:#0f172a;text-align:center}.v55-phase{font-size:11px;font-weight:900;border-radius:999px;padding:6px 8px;text-align:center;background:#ecfeff;color:#0f766e;border:1px solid #a5f3fc}.v55-phase.watch{background:#fff7ed;color:#c2410c;border-color:#fed7aa}.v55-phase.calm{background:#f8fafc;color:#64748b;border-color:#e2e8f0}
      .v55-dist{display:flex;flex-direction:column;gap:11px}.v55-dist-row{display:grid;grid-template-columns:120px 1fr 68px;gap:10px;align-items:center;font-size:12px}.v55-dist-name{font-weight:850;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.v55-dist-val{text-align:left;color:#0f172a;font-weight:900}
      .v55-alloc{display:grid;gap:10px}.v55-alloc-row{display:grid;grid-template-columns:1fr 72px;gap:12px;align-items:center;border:1px solid rgba(15,23,42,.08);border-radius:16px;padding:12px;background:#f8fafc}.v55-alloc-row b{font-size:13px;color:#0f172a}.v55-alloc-row span{display:block;margin-top:4px;color:#64748b;font-size:11px;line-height:1.55}.v55-weight{font-size:20px;font-weight:950;text-align:left;color:#0f766e}
      .v55-investor-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.v55-flow-row{display:grid;grid-template-columns:1fr 100px;gap:12px;align-items:center;border-bottom:1px solid rgba(15,23,42,.06);padding:10px 0}.v55-flow-row:last-child{border-bottom:0}.v55-flow-name{font-weight:900;color:#0f172a}.v55-flow-meta{font-size:12px;color:#64748b;margin-top:4px}.v55-net{font-weight:950;text-align:left}.v55-net.pos{color:#047857}.v55-net.neg{color:#dc2626}.v55-note{border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:16px;padding:14px;line-height:1.75;font-size:13px}.v55-actions{display:grid;gap:8px;margin-top:12px}.v55-action{border:1px solid rgba(15,23,42,.08);background:#fff;border-radius:14px;padding:10px 12px;color:#334155;font-size:12px;line-height:1.55}.v55-mini-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.v55-chip{border:1px solid rgba(14,165,233,.2);background:#f0f9ff;color:#075985;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:850}
      .v55-table{width:100%;border-collapse:separate;border-spacing:0 8px}.v55-table th{font-size:11px;text-align:right;color:#64748b;padding:0 10px}.v55-table td{background:#f8fafc;border-top:1px solid rgba(15,23,42,.06);border-bottom:1px solid rgba(15,23,42,.06);padding:12px 10px;font-size:12px}.v55-table td:first-child{border-right:1px solid rgba(15,23,42,.06);border-radius:0 14px 14px 0;font-weight:950}.v55-table td:last-child{border-left:1px solid rgba(15,23,42,.06);border-radius:14px 0 0 14px}
      @media(max-width:940px){.v55-grid,.v55-investor-grid{grid-template-columns:1fr}.v55-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.v55-sector-row{grid-template-columns:1fr}.v55-score,.v55-phase{text-align:right}.v55-hero{flex-direction:column}.v55-dist-row{grid-template-columns:95px 1fr 55px}}@media(max-width:560px){#${ROOT_ID}{margin:12px 8px}.v55-cards{grid-template-columns:1fr}.v55-body{padding:14px}.v55-hero{padding:18px}.v55-tabs{padding:12px}.v55-title h2{font-size:20px}}
    `;
    document.head.appendChild(style);
  }

  function card(label, value, hint) {
    return `<div class="v55-card"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint || '')}</div></div>`;
  }

  function phaseClass(phase) {
    if (/قيادة|داعم/.test(phase || '')) return '';
    if (/مراقبة|تجميع|تصريف/.test(phase || '')) return 'watch';
    return 'calm';
  }

  function renderSector(report) {
    if (!report || report.__missing) return `<div class="v55-note">ملف data/sector-report.json غير موجود بعد. أضف خطوة V5.5 في الـ Workflow وشغل Update EGX Market Data.</div>`;
    const sectors = Array.isArray(report.sectors) ? report.sectors : [];
    const top = sectors.filter(s => s.sector !== 'غير مصنف').slice(0, state.sectorLimit);
    const dist = Array.isArray(report.liquidityDistribution) ? report.liquidityDistribution.slice(0, 10) : [];
    const alloc = Array.isArray(report.optimalPortfolioBySector) ? report.optimalPortfolioBySector : [];
    const unclassified = report?.diagnostics?.unclassifiedSymbols || [];

    return `
      <div class="v55-cards">
        ${card('القطاع الأكثر سيولة', report?.summary?.mostLiquidSector || '—', `إجمالي قيمة متداولة: ${money(report?.summary?.totalMarketValue || 0)}`)}
        ${card('القطاع القادم للمراقبة', report?.summary?.nextSector || '—', report?.summary?.nextSectorReason || 'حسب السيولة والزخم')}
        ${card('تغطية القطاعات', `${fmt(report?.summary?.sectorCoveragePct || 0)}%`, 'كلما زادت قلت الأسهم غير المصنفة')}
        ${card('عدد القطاعات', fmt(report?.summary?.totalSectors || sectors.length || 0), 'بعد دمج الكاش والكون والفرص')}
      </div>
      <div class="v55-grid">
        <section class="v55-panel">
          <div class="v55-panel-head"><div><h3>ترتيب القطاعات النشطة</h3><p>Score مركب من السيولة، الزخم، الانتشار، والثقة.</p></div><button class="v55-tab" data-v55-more>عرض أكثر</button></div>
          <div class="v55-panel-body">
            ${top.map(s => `
              <div class="v55-sector-row">
                <div><div class="v55-sector-name">${esc(s.sector)}</div><div class="v55-sector-meta">${fmt(s.symbolsCount)} سهم · سيولة ${fmt(s.liquiditySharePct)}% · تغير ${pct(s.avgChangePct)}</div></div>
                <div class="v55-bar"><div class="v55-fill" style="width:${Math.max(3, Math.min(100, Number(s.rotationScore || 0)))}%"></div></div>
                <div class="v55-score">${fmt(s.rotationScore)}</div>
                <div class="v55-phase ${phaseClass(s.phase)}">${esc(s.phase || 'هادئ')}</div>
              </div>`).join('') || '<div class="v55-note">لا توجد بيانات قطاعات كافية بعد.</div>'}
          </div>
        </section>
        <section class="v55-panel">
          <div class="v55-panel-head"><div><h3>توزيع السيولة بين القطاعات</h3><p>يبين أين تتركز الحركة اليوم/آخر تشغيل.</p></div></div>
          <div class="v55-panel-body v55-dist">
            ${dist.map(s => `
              <div class="v55-dist-row">
                <div class="v55-dist-name" title="${esc(s.sector)}">${esc(s.sector)}</div>
                <div class="v55-bar"><div class="v55-fill" style="width:${Math.max(2, Math.min(100, Number(s.sharePct || 0)))}%"></div></div>
                <div class="v55-dist-val">${fmt(s.sharePct)}%</div>
              </div>`).join('') || '<div class="v55-note">لا توجد سيولة كافية للحساب.</div>'}
          </div>
        </section>
      </div>
      <div class="v55-grid" style="margin-top:16px">
        <section class="v55-panel">
          <div class="v55-panel-head"><div><h3>التوزيع الأمثل المقترح للمحفظة حسب القطاعات</h3><p>توزيع مراقبة وليس أمر شراء، مبني على القطاعات الأقوى حاليًا.</p></div></div>
          <div class="v55-panel-body v55-alloc">
            ${alloc.map(a => `
              <div class="v55-alloc-row"><div><b>${esc(a.sector)}</b><span>${esc(a.reason || '')}</span></div><div class="v55-weight">${fmt(a.suggestedWeightPct)}%</div></div>
            `).join('') || '<div class="v55-note">التوزيع يحتاج سيولة وقطاعات مصنفة أكثر.</div>'}
          </div>
        </section>
        <section class="v55-panel">
          <div class="v55-panel-head"><div><h3>استكمال السوق بدون نقص</h3><p>الأسهم غير المصنفة لا تمنع ظهورها، لكنها تقلل جودة تقرير القطاعات.</p></div></div>
          <div class="v55-panel-body">
            <div class="v55-note">لو ظهرت أسهم غير مصنفة، أضفها في <b>config/egx-sector-map.json</b> فقط. لا تعمل Reset ولا ترفع ملفات الكاش.</div>
            <div class="v55-mini-list">${unclassified.slice(0, 34).map(s => `<span class="v55-chip">${esc(s)}</span>`).join('') || '<span class="v55-chip">لا توجد عينة غير مصنفة</span>'}</div>
            <div class="v55-actions">${(report.dataQualityActions || []).map(x => `<div class="v55-action">${esc(x)}</div>`).join('')}</div>
          </div>
        </section>
      </div>
    `;
  }

  function renderInvestor(report) {
    if (!report || report.__missing) return `<div class="v55-note">ملف data/investor-flow-report.json غير موجود بعد. أضف خطوة V5.5 في الـ Workflow وشغل Update EGX Market Data.</div>`;
    if (report.status === 'needs_investor_flow_source') {
      return `
        <div class="v55-cards">
          ${card('حالة تقرير المتعاملين', 'يحتاج مصدر', 'التطبيق جاهز لكن بيانات نوع المتعاملين لم تدخل بعد')}
          ${card('القطاع المرشح', report?.marketContext?.nextSector || '—', 'من تقرير القطاعات الحالي')}
          ${card('الأكثر سيولة', report?.marketContext?.mostLiquidSector || '—', 'يربط السيولة بنوع المتعاملين لاحقًا')}
          ${card('الملف المطلوب', 'investor-flow-daily.json', 'داخل فولدر data')}
        </div>
        <section class="v55-panel">
          <div class="v55-panel-head"><div><h3>تقرير نوع المتعاملين جاهز — يحتاج إدخال البيانات</h3><p>عند توفر بيانات EGX الرسمية/اليدوية سيظهر صافي شراء وبيع المؤسسات والأفراد والمصريين والعرب والأجانب.</p></div></div>
          <div class="v55-panel-body">
            <div class="v55-note">ضع ملف <b>data/investor-flow-daily.json</b> بنفس شكل القالب الموجود في <b>config/investor-flow-manual-template.json</b>، أو نضيف لاحقًا جامع آلي من مصدر رسمي لو كان الوصول متاحًا.</div>
            <div class="v55-actions">${(report.whyItMatters || []).map(x => `<div class="v55-action">${esc(x)}</div>`).join('')}</div>
          </div>
        </section>
      `;
    }
    const cat = report.byCategory || [];
    const nat = report.byNationality || [];
    return `
      <div class="v55-cards">
        ${card('إشارة السوق', report?.summary?.marketSignal || '—', 'قراءة صافي تدفقات نوع المتعاملين')}
        ${card('أقوى مشتري', report?.summary?.strongestBuyer || '—', `صافي السوق: ${money(report?.summary?.netTotal || 0)}`)}
        ${card('أقوى بائع', report?.summary?.strongestSeller || '—', 'يستخدم لتقييم ضغط البيع')}
        ${card('تاريخ التقرير', report?.date || '—', report?.source || 'مصدر غير محدد')}
      </div>
      <div class="v55-investor-grid">
        <section class="v55-panel"><div class="v55-panel-head"><div><h3>مؤسسات مقابل أفراد</h3><p>صافي الشراء/البيع حسب طبيعة المتعامل.</p></div></div><div class="v55-panel-body">
          ${cat.map(r => `<div class="v55-flow-row"><div><div class="v55-flow-name">${esc(r.label)}</div><div class="v55-flow-meta">شراء ${money(r.buyValue)} · بيع ${money(r.sellValue)}</div></div><div class="v55-net ${r.netValue >= 0 ? 'pos' : 'neg'}">${money(r.netValue)}</div></div>`).join('')}
        </div></section>
        <section class="v55-panel"><div class="v55-panel-head"><div><h3>مصريون / عرب / أجانب</h3><p>تدفق السيولة حسب الجنسية.</p></div></div><div class="v55-panel-body">
          ${nat.map(r => `<div class="v55-flow-row"><div><div class="v55-flow-name">${esc(r.label)}</div><div class="v55-flow-meta">شراء ${money(r.buyValue)} · بيع ${money(r.sellValue)}</div></div><div class="v55-net ${r.netValue >= 0 ? 'pos' : 'neg'}">${money(r.netValue)}</div></div>`).join('')}
        </div></section>
      </div>
      <section class="v55-panel" style="margin-top:16px"><div class="v55-panel-head"><div><h3>تأثير ذلك على السوق والمحفظة</h3><p>قراءة عملية تربط نوع المتعاملين بتوزيع القطاعات.</p></div></div><div class="v55-panel-body v55-actions">${(report.portfolioImpact || []).map(x => `<div class="v55-action">${esc(x)}</div>`).join('')}</div></section>
    `;
  }

  function renderActionPlan(sector, investor) {
    const actions = [];
    actions.push('شغّل Workflow أكثر من مرة لاستكمال الكاش حتى لا تظل أسهم كثيرة في انتظار Batch.');
    actions.push('لا ترفع scan-state.json أو full-market-cache.json يدويًا إلا لو مطلوب Reset صريح.');
    if ((sector?.diagnostics?.sectorCoveragePct || 0) < 90) actions.push('استكمل config/egx-sector-map.json للأسهم غير المصنفة لتحسين تقرير القطاعات.');
    if (investor?.status === 'needs_investor_flow_source') actions.push('أضف data/investor-flow-daily.json أو نطور جامع آلي من صفحة EGX Investor Type إذا كان الوصول مستقرًا.');
    actions.push('بعد كل تعديل: Actions → Update EGX Market Data → Run workflow ثم Ctrl + F5 على الموقع.');
    return `<section class="v55-panel"><div class="v55-panel-head"><div><h3>خطة التنفيذ القادمة</h3><p>خطوات عملية لضمان سوق كامل وتقرير مؤسسي.</p></div></div><div class="v55-panel-body v55-actions">${actions.map(x => `<div class="v55-action">${esc(x)}</div>`).join('')}</div></section>`;
  }

  function html(data) {
    const { sector, investor, health } = data;
    const body = state.tab === 'sector' ? renderSector(sector) : state.tab === 'investor' ? renderInvestor(investor) : renderActionPlan(sector, investor);
    return `
      <div class="v55-shell">
        <div class="v55-hero">
          <div class="v55-title"><h2>📊 EGX Pro Hub V5.5 Sector & Investor Flow</h2><p>تقسيم السوق إلى قطاعات، ترتيب القطاعات الأكثر حركة وسيولة، تحديد القطاع القادم للمراقبة، توزيع السيولة، وتقرير نوع المتعاملين وتأثيره على السوق والمحفظة.</p></div>
          <div class="v55-badge">V5.5 · ${esc(health?.scanMode || 'public delayed')}</div>
        </div>
        <div class="v55-tabs">
          <button class="v55-tab ${state.tab === 'sector' ? 'active' : ''}" data-v55-tab="sector">القطاعات والسيولة</button>
          <button class="v55-tab ${state.tab === 'investor' ? 'active' : ''}" data-v55-tab="investor">نوع المتعاملين</button>
          <button class="v55-tab ${state.tab === 'actions' ? 'active' : ''}" data-v55-tab="actions">خطة الاستكمال</button>
        </div>
        <div class="v55-body">${body}</div>
      </div>
    `;
  }

  function mountPoint() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) return existing;
    const root = document.createElement('section');
    root.id = ROOT_ID;
    const after = document.getElementById('egx-v54-workspace') || document.getElementById('egx-v53-smart-market-ui') || document.querySelector('main') || document.body.lastElementChild;
    if (after && after.parentNode && after !== document.body.lastElementChild) after.parentNode.insertBefore(root, after.nextSibling);
    else document.body.appendChild(root);
    return root;
  }

  function bind(root, data) {
    $$('[data-v55-tab]', root).forEach(btn => btn.addEventListener('click', () => {
      state.tab = btn.getAttribute('data-v55-tab') || 'sector';
      localStorage.setItem('egx.v55.tab', state.tab);
      root.innerHTML = html(data);
      bind(root, data);
    }));
    const more = $('[data-v55-more]', root);
    if (more) more.addEventListener('click', () => {
      state.sectorLimit = state.sectorLimit === 10 ? 30 : 10;
      more.textContent = state.sectorLimit === 10 ? 'عرض أكثر' : 'عرض أقل';
      root.innerHTML = html(data);
      bind(root, data);
    });
  }

  async function init() {
    injectStyles();
    const root = mountPoint();
    root.innerHTML = `<div class="v55-shell"><div class="v55-body"><div class="v55-note">جاري تحميل تقرير القطاعات ونوع المتعاملين...</div></div></div>`;
    const data = {
      sector: await loadJson(files.sector),
      investor: await loadJson(files.investor),
      universe: await loadJson(files.universe),
      health: await loadJson(files.health)
    };
    root.innerHTML = html(data);
    bind(root, data);
    window.EGX_V55_SECTOR_INVESTOR_FLOW = { version: VERSION, data };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
