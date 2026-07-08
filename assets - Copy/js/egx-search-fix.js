/*
EGX Arabic Search Fix V3
طريقة الاستخدام السريعة:
1) ضع هذا الملف في assets/js/egx-search-fix.js.
2) في index.html قبل </body> أضف:
   <script src="assets/js/egx-search-fix.js"></script>

ماذا يفعل؟
- يدعم البحث العربي والإنجليزي والرمز.
- يمنع التهنيج عند كتابة حرف واحد.
- يعمل Debounce.
- لا يعيد تحميل البيانات مع كل حرف.
- يحاول ربط نفسه تلقائيًا بأي input بحث ظاهر في الصفحة.
*/

(function () {
  "use strict";

  const STATE = {
    rows: [],
    symbols: [],
    lastQuery: "",
    timer: null,
    minChars: 1
  };

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

  function rowSearchText(row) {
    return normalizeArabic([
      row.symbol,
      row.name,
      row.name_en,
      row.name_ar,
      row.decision,
      row.signal,
      row.reason,
      ...(Array.isArray(row.aliases) ? row.aliases : [])
    ].filter(Boolean).join(" "));
  }

  async function loadJson(url, fallback) {
    try {
      const response = await fetch(url + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) return fallback;
      return await response.json();
    } catch {
      return fallback;
    }
  }

  function getRowsFromWindow() {
    const candidates = [
      window.marketRows,
      window.EGX_ROWS,
      window.egxRows,
      window.__EGX_ROWS__,
      window.marketData && window.marketData.rows
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length) return c;
    }
    return [];
  }

  function findSearchInputs() {
    const selectors = [
      'input[type="search"]',
      'input[placeholder*="بحث"]',
      'input[placeholder*="Search"]',
      'input[aria-label*="بحث"]',
      'input[aria-label*="Search"]',
      '#searchInput',
      '#stockSearch',
      '.search-input'
    ];

    const set = new Set();
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (el && el.tagName === "INPUT") set.add(el);
      });
    });

    return Array.from(set);
  }

  function findTableRows() {
    return Array.from(document.querySelectorAll("tbody tr, .stock-row, .market-row, [data-symbol]"));
  }

  function applyDomFilter(query) {
    const q = normalizeArabic(query);
    const domRows = findTableRows();

    if (!domRows.length) return false;

    domRows.forEach((el) => {
      const symbol = el.getAttribute("data-symbol") || "";
      const text = normalizeArabic(symbol + " " + el.textContent);
      const show = !q || text.includes(q);
      el.style.display = show ? "" : "none";
    });

    return true;
  }

  function renderSearchResults(query, rows) {
    const q = normalizeArabic(query);
    const filtered = !q
      ? rows
      : rows.filter((row) => (row.__searchText || rowSearchText(row)).includes(q));

    const event = new CustomEvent("egx:search-results", {
      detail: {
        query,
        normalizedQuery: q,
        rows: filtered,
        count: filtered.length
      }
    });
    window.dispatchEvent(event);

    const counter = document.querySelector("[data-search-count], #searchCount, .search-count");
    if (counter) counter.textContent = String(filtered.length);

    return filtered;
  }

  function onSearch(query) {
    STATE.lastQuery = query;
    const q = normalizeArabic(query);

    if (q.length < STATE.minChars) {
      applyDomFilter("");
      renderSearchResults("", STATE.rows);
      return;
    }

    const domHandled = applyDomFilter(q);
    const filtered = renderSearchResults(q, STATE.rows);

    if (!domHandled) {
      console.log("EGX Arabic search filtered rows:", filtered.length);
    }
  }

  function bindInputs() {
    const inputs = findSearchInputs();

    inputs.forEach((input) => {
      if (input.dataset.egxArabicSearchBound === "1") return;
      input.dataset.egxArabicSearchBound = "1";

      input.setAttribute("dir", "auto");
      input.setAttribute("autocomplete", "off");

      input.addEventListener("input", function () {
        const value = input.value || "";
        clearTimeout(STATE.timer);
        STATE.timer = setTimeout(() => onSearch(value), 180);
      });
    });

    if (inputs.length) {
      console.log("EGX Arabic search bound inputs:", inputs.length);
    }
  }

  async function init() {
    const market = await loadJson("data/market.json", {});
    const symbols = await loadJson("data/symbols.json", { symbols: [] });

    STATE.rows = Array.isArray(market.rows) && market.rows.length ? market.rows : getRowsFromWindow();
    STATE.symbols = Array.isArray(symbols.symbols) ? symbols.symbols : [];

    const symbolMap = new Map(STATE.symbols.map((s) => [String(s.symbol || "").toUpperCase(), s]));

    STATE.rows = STATE.rows.map((row) => {
      const extra = symbolMap.get(String(row.symbol || "").toUpperCase()) || {};
      const merged = {
        ...extra,
        ...row,
        aliases: Array.from(new Set([...(extra.aliases || []), ...(row.aliases || [])]))
      };
      merged.__searchText = rowSearchText(merged);
      return merged;
    });

    window.EGX_SEARCH_ROWS = STATE.rows;
    window.EGX_ARABIC_SEARCH = {
      search: (q) => renderSearchResults(q, STATE.rows),
      normalizeArabic,
      rows: STATE.rows
    };

    bindInputs();

    const observer = new MutationObserver(() => bindInputs());
    observer.observe(document.body, { childList: true, subtree: true });

    console.log("EGX Arabic Search V3 ready. rows:", STATE.rows.length);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
