#!/usr/bin/env node
/*
  EGX Pro Hub V5.5 Sector & Investor Flow Intelligence
  - Generates:
      data/sector-report.json
      data/investor-flow-report.json
  - Reads public/delayed generated data and optional manual/official investor-flow input.
  - Does NOT touch data/scan-state.json or data/full-market-cache.json.
*/
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const files = {
  universe: path.join(ROOT, 'data', 'universe-index.json'),
  cache: path.join(ROOT, 'data', 'full-market-cache.json'),
  market: path.join(ROOT, 'data', 'market.json'),
  recs: path.join(ROOT, 'data', 'recommendations.json'),
  pro: path.join(ROOT, 'data', 'pro-report.json'),
  health: path.join(ROOT, 'data', 'source-health.json'),
  sectorMap: path.join(ROOT, 'config', 'egx-sector-map.json'),
  investorFlowInputData: path.join(ROOT, 'data', 'investor-flow-daily.json'),
  investorFlowInputConfig: path.join(ROOT, 'config', 'investor-flow-daily.json'),
  sectorOut: path.join(ROOT, 'data', 'sector-report.json'),
  investorOut: path.join(ROOT, 'data', 'investor-flow-report.json')
};

function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return fallback; }
}

function readJson(file, fallback = null) {
  try { return JSON.parse(readText(file)); } catch (_) { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function symbolOf(row) {
  return String(row?.symbol || row?.ticker || row?.code || row?.mubasherSymbol || row?.Symbol || row?.SYMBOL || '').trim().toUpperCase();
}

function first(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return undefined;
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const n = Number(String(value).replace(/,/g, '').replace(/%/g, '').replace(/[\u0660-\u0669]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim());
  return Number.isFinite(n) ? n : fallback;
}

function arrFrom(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  const candidates = [json.rows, json.data, json.market, json.stocks, json.symbols, json.items, json.cache, json.recommendations, json.all, json.records, json.topOpportunities, json.opportunities];
  for (const c of candidates) if (Array.isArray(c) && c.some(x => symbolOf(x))) return c;
  if (json && typeof json === 'object') {
    const values = Object.values(json);
    if (values.some(v => v && typeof v === 'object' && symbolOf(v))) return values;
  }
  return [];
}

function mergeBySymbol(...arrays) {
  const map = new Map();
  for (const rows of arrays) {
    for (const row of rows || []) {
      const symbol = symbolOf(row);
      if (!symbol) continue;
      map.set(symbol, Object.assign({}, map.get(symbol) || {}, row, { symbol }));
    }
  }
  return Array.from(map.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function normalizeSectorName(value) {
  const text = String(value || '').trim();
  if (!text || ['-', '—', 'n/a', 'na', 'null', 'undefined'].includes(text.toLowerCase())) return '';
  const map = {
    banks: 'بنوك وخدمات مالية مصرفية',
    banking: 'بنوك وخدمات مالية مصرفية',
    'financial services': 'خدمات مالية غير مصرفية',
    realestate: 'عقارات وإنشاءات',
    'real estate': 'عقارات وإنشاءات',
    cement: 'أسمنت ومواد بناء',
    petrochemicals: 'بتروكيماويات وكيماويات',
    chemicals: 'بتروكيماويات وكيماويات',
    healthcare: 'رعاية صحية ودواء',
    pharma: 'رعاية صحية ودواء',
    technology: 'تكنولوجيا ومدفوعات',
    telecom: 'اتصالات وإعلام وتكنولوجيا',
    food: 'أغذية ومشروبات',
    transport: 'نقل وخدمات لوجستية',
    textiles: 'منسوجات وملابس',
    tourism: 'سياحة وترفيه'
  };
  return map[text.toLowerCase().replace(/\s+/g, ' ')] || text;
}

function classifySector(row, sectorConfig) {
  const symbol = symbolOf(row);
  const existing = normalizeSectorName(first(row, ['sector', 'sector_ar', 'sector_en', 'industry', 'industryName', 'category']));
  if (existing) return { sector: existing, source: 'row' };

  const exact = sectorConfig?.symbolToSector?.[symbol];
  if (exact) return { sector: exact, source: 'symbol-map' };

  const text = `${row.name_ar || ''} ${row.name_en || ''} ${row.name || ''} ${row.company || ''} ${row.aliases || ''}`.toLowerCase();
  for (const rule of sectorConfig?.namePatterns || []) {
    for (const pattern of rule.patterns || []) {
      if (pattern && text.includes(String(pattern).toLowerCase())) return { sector: rule.sector, source: 'name-pattern' };
    }
  }

  return { sector: 'غير مصنف', source: 'unclassified' };
}

function metricsFor(row) {
  const price = num(first(row, ['price', 'last', 'lastPrice', 'close', 'last_price', 'currentPrice']), 0);
  const changePct = num(first(row, ['changePct', 'changePercent', 'percentChange', 'pctChange', 'change_percent', 'change']), 0);
  const volume = num(first(row, ['volume', 'tradedVolume', 'qty', 'quantity', 'tradesVolume']), 0);
  let tradedValue = num(first(row, ['value', 'tradedValue', 'turnover', 'tradeValue', 'amount', 'marketValue']), 0);
  if (!tradedValue && price && volume) tradedValue = price * volume;
  const confidence = num(first(row, ['confidence', 'confidenceScore', 'score', 'finalScore', 'opportunityScore']), 0);
  return { price, changePct, volume, tradedValue, confidence };
}

function round(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

function buildSectorReport() {
  const universe = readJson(files.universe, {});
  const cache = readJson(files.cache, []);
  const market = readJson(files.market, []);
  const recs = readJson(files.recs, []);
  const pro = readJson(files.pro, []);
  const health = readJson(files.health, {});
  const sectorConfig = readJson(files.sectorMap, { symbolToSector: {}, namePatterns: [] });

  const rows = mergeBySymbol(arrFrom(universe), arrFrom(cache), arrFrom(market), arrFrom(recs), arrFrom(pro));
  const stockRows = rows.map(row => {
    const cls = classifySector(row, sectorConfig);
    const m = metricsFor(row);
    return Object.assign({}, row, m, { sector: cls.sector, sectorSource: cls.source });
  });

  const sectorMap = new Map();
  for (const row of stockRows) {
    const sector = row.sector || 'غير مصنف';
    const prev = sectorMap.get(sector) || {
      sector,
      symbols: [],
      activeSymbols: 0,
      advancing: 0,
      declining: 0,
      unchanged: 0,
      totalValue: 0,
      totalVolume: 0,
      weightedChangeSum: 0,
      confidenceSum: 0,
      confidenceCount: 0,
      unclassifiedCount: 0,
      topSymbols: []
    };
    prev.symbols.push(row.symbol);
    if (row.tradedValue > 0 || row.volume > 0) prev.activeSymbols += 1;
    if (row.changePct > 0.05) prev.advancing += 1;
    else if (row.changePct < -0.05) prev.declining += 1;
    else prev.unchanged += 1;
    prev.totalValue += row.tradedValue;
    prev.totalVolume += row.volume;
    prev.weightedChangeSum += row.changePct * Math.max(row.tradedValue, 1);
    if (row.confidence) { prev.confidenceSum += row.confidence; prev.confidenceCount += 1; }
    if (row.sectorSource === 'unclassified') prev.unclassifiedCount += 1;
    prev.topSymbols.push({ symbol: row.symbol, name_ar: row.name_ar || row.name || '', name_en: row.name_en || '', value: row.tradedValue, changePct: row.changePct, volume: row.volume, confidence: row.confidence });
    sectorMap.set(sector, prev);
  }

  const totalMarketValue = Array.from(sectorMap.values()).reduce((s, x) => s + x.totalValue, 0);
  const maxValue = Math.max(1, ...Array.from(sectorMap.values()).map(x => x.totalValue));
  const maxVolume = Math.max(1, ...Array.from(sectorMap.values()).map(x => x.totalVolume));

  const sectors = Array.from(sectorMap.values()).map(s => {
    const breadth = s.symbols.length ? ((s.advancing - s.declining) / s.symbols.length) * 100 : 0;
    const avgChange = s.totalValue > 0 ? s.weightedChangeSum / Math.max(s.totalValue, 1) : 0;
    const liquidityShare = totalMarketValue ? (s.totalValue / totalMarketValue) * 100 : 0;
    const liquidityScore = Math.min(100, (s.totalValue / maxValue) * 100);
    const volumeScore = Math.min(100, (s.totalVolume / maxVolume) * 100);
    const momentumScore = Math.max(0, Math.min(100, 50 + avgChange * 8 + breadth * 0.25));
    const participationScore = Math.max(0, Math.min(100, (s.activeSymbols / Math.max(s.symbols.length, 1)) * 100));
    const avgConfidence = s.confidenceCount ? s.confidenceSum / s.confidenceCount : 0;
    const rotationScore = round(liquidityScore * 0.35 + volumeScore * 0.15 + momentumScore * 0.3 + participationScore * 0.1 + Math.min(100, avgConfidence) * 0.1, 2);
    const phase = rotationScore >= 70 && avgChange >= 0 ? 'قيادة محتملة' : rotationScore >= 55 ? 'مراقبة نشطة' : avgChange < 0 && liquidityShare > 10 ? 'تجميع/تصريف يحتاج تأكيد' : 'هادئ';
    const topSymbols = s.topSymbols.sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 8);
    return Object.assign({}, s, {
      symbolsCount: s.symbols.length,
      avgChangePct: round(avgChange, 2),
      liquiditySharePct: round(liquidityShare, 2),
      breadthScore: round(breadth, 2),
      liquidityScore: round(liquidityScore, 2),
      volumeScore: round(volumeScore, 2),
      momentumScore: round(momentumScore, 2),
      participationScore: round(participationScore, 2),
      avgConfidence: round(avgConfidence, 2),
      rotationScore,
      phase,
      totalValue: round(s.totalValue, 2),
      totalVolume: round(s.totalVolume, 2),
      topSymbols
    });
  }).sort((a, b) => b.rotationScore - a.rotationScore);

  const classifiedRows = stockRows.filter(r => r.sector !== 'غير مصنف').length;
  const sectorCoveragePct = stockRows.length ? round((classifiedRows / stockRows.length) * 100, 2) : 0;
  const liquidSectors = sectors.filter(s => s.sector !== 'غير مصنف' && s.totalValue > 0).slice(0, 7);
  const baseScores = liquidSectors.map(s => Math.max(1, s.rotationScore));
  const scoreSum = baseScores.reduce((a, b) => a + b, 0) || 1;
  let allocation = liquidSectors.map((s, i) => ({
    sector: s.sector,
    suggestedWeightPct: Math.max(5, Math.min(30, round((baseScores[i] / scoreSum) * 100, 2))),
    reason: `${s.phase}؛ سيولة ${s.liquiditySharePct}%؛ تغير مرجح ${s.avgChangePct}%`
  }));
  const allocSum = allocation.reduce((sum, a) => sum + a.suggestedWeightPct, 0) || 1;
  allocation = allocation.map(a => Object.assign({}, a, { suggestedWeightPct: round((a.suggestedWeightPct / allocSum) * 100, 2) }));

  const report = {
    version: '5.5.0-sector-investor-flow',
    generatedAt: new Date().toISOString(),
    source: 'public-delayed-generated-files',
    note: 'تحليل ومراقبة فقط وليس أوامر تداول. لا يلمس scan-state أو full-market-cache.',
    diagnostics: {
      stockRows: stockRows.length,
      totalUniverseFromHealth: health.totalUniverse || null,
      cacheRowsFromHealth: health.cacheRows || null,
      sectorCoveragePct,
      unclassifiedCount: stockRows.length - classifiedRows,
      unclassifiedSymbols: stockRows.filter(r => r.sector === 'غير مصنف').map(r => r.symbol).slice(0, 120)
    },
    summary: {
      totalSectors: sectors.length,
      totalMarketValue: round(totalMarketValue, 2),
      mostLiquidSector: sectors[0]?.sector || '—',
      nextSector: sectors.find(s => s.sector !== 'غير مصنف')?.sector || '—',
      nextSectorReason: sectors.find(s => s.sector !== 'غير مصنف')?.phase || 'بيانات غير كافية',
      sectorCoveragePct
    },
    sectors,
    liquidityDistribution: sectors.map(s => ({ sector: s.sector, value: s.totalValue, sharePct: s.liquiditySharePct, activeSymbols: s.activeSymbols })),
    optimalPortfolioBySector: allocation,
    dataQualityActions: sectorCoveragePct < 90 ? [
      'استكمال config/egx-sector-map.json للأسهم غير المصنفة حتى لا تظهر في قطاع غير مصنف.',
      'تشغيل Workflow عدة مرات لاستكمال الكاش بدون Reset.',
      'مراجعة الرموز ذات السيولة صفر للتأكد هل هي خارج التداول أو لم تدخل Batch بعد.'
    ] : []
  };

  writeJson(files.sectorOut, report);
  console.log(`[EGX V5.5] sector-report.json generated: ${sectors.length} sectors, coverage=${sectorCoveragePct}%`);
}

function normalizeCategory(row) {
  const text = `${row.category || ''} ${row.type || ''} ${row.investorType || ''} ${row.label || ''} ${row.label_ar || ''}`.toLowerCase();
  if (text.includes('institution') || text.includes('مؤسس')) return 'مؤسسات';
  if (text.includes('individual') || text.includes('retail') || text.includes('فرد') || text.includes('افراد') || text.includes('أفراد')) return 'أفراد';
  return row.category_ar || row.category || 'غير محدد';
}

function normalizeNationality(row) {
  const text = `${row.nationality || ''} ${row.group || ''} ${row.label || ''} ${row.label_ar || ''}`.toLowerCase();
  if (text.includes('egypt') || text.includes('مصري')) return 'مصريون';
  if (text.includes('arab') || text.includes('عرب') || text.includes('عربي')) return 'عرب';
  if (text.includes('foreign') || text.includes('non-arab') || text.includes('اجانب') || text.includes('أجانب')) return 'أجانب';
  return row.nationality_ar || row.nationality || 'غير محدد';
}

function buildInvestorReport() {
  const input = readJson(files.investorFlowInputData, null) || readJson(files.investorFlowInputConfig, null);
  const sectorReport = readJson(files.sectorOut, {});
  const rows = Array.isArray(input?.rows) ? input.rows : [];

  if (!rows.length) {
    const report = {
      version: '5.5.0-sector-investor-flow',
      generatedAt: new Date().toISOString(),
      status: 'needs_investor_flow_source',
      source: 'not-yet-available-in-repo',
      note: 'لم يتم العثور على data/investor-flow-daily.json أو config/investor-flow-daily.json. التقرير جاهز للعرض لكن يحتاج بيانات نوع المتعاملين من مصدر رسمي/يدوي.',
      whyItMatters: [
        'صافي شراء المؤسسات يدعم استمرارية الصعود أكثر من تداول أفراد قصير الأجل.',
        'صافي شراء الأجانب أو العرب مع سيولة مرتفعة قد يؤكد دخول أموال جديدة.',
        'صافي بيع قوي من المؤسسات مع صعود سعري قد يعني ارتفاع هش يحتاج إدارة مخاطر.'
      ],
      requiredInputFile: 'data/investor-flow-daily.json',
      template: {
        date: 'YYYY-MM-DD',
        unit: 'EGP',
        rows: [
          { category: 'individuals', label_ar: 'أفراد مصريون', nationality: 'مصريون', buyValue: 0, sellValue: 0 },
          { category: 'institutions', label_ar: 'مؤسسات مصرية', nationality: 'مصريون', buyValue: 0, sellValue: 0 },
          { category: 'individuals', label_ar: 'أفراد عرب', nationality: 'عرب', buyValue: 0, sellValue: 0 },
          { category: 'institutions', label_ar: 'مؤسسات عربية', nationality: 'عرب', buyValue: 0, sellValue: 0 },
          { category: 'individuals', label_ar: 'أفراد أجانب', nationality: 'أجانب', buyValue: 0, sellValue: 0 },
          { category: 'institutions', label_ar: 'مؤسسات أجنبية', nationality: 'أجانب', buyValue: 0, sellValue: 0 }
        ]
      },
      marketContext: {
        nextSector: sectorReport?.summary?.nextSector || '—',
        mostLiquidSector: sectorReport?.summary?.mostLiquidSector || '—'
      }
    };
    writeJson(files.investorOut, report);
    console.log('[EGX V5.5] investor-flow-report.json generated with needs_source status');
    return;
  }

  const normalized = rows.map(row => {
    const buyValue = num(first(row, ['buyValue', 'buy', 'purchases', 'buying', 'buy_amount']), 0);
    const sellValue = num(first(row, ['sellValue', 'sell', 'sales', 'selling', 'sell_amount']), 0);
    const netValue = buyValue - sellValue;
    const category = normalizeCategory(row);
    const nationality = normalizeNationality(row);
    const label = row.label_ar || row.label || `${category} ${nationality}`;
    return { label, category, nationality, buyValue, sellValue, netValue };
  });

  const totalBuy = normalized.reduce((s, r) => s + r.buyValue, 0);
  const totalSell = normalized.reduce((s, r) => s + r.sellValue, 0);
  const totalTraded = totalBuy + totalSell;
  const netTotal = totalBuy - totalSell;
  const byCategoryMap = new Map();
  const byNationalityMap = new Map();

  function add(map, key, row) {
    const p = map.get(key) || { label: key, buyValue: 0, sellValue: 0, netValue: 0 };
    p.buyValue += row.buyValue;
    p.sellValue += row.sellValue;
    p.netValue += row.netValue;
    map.set(key, p);
  }

  normalized.forEach(row => { add(byCategoryMap, row.category, row); add(byNationalityMap, row.nationality, row); });
  const enrich = x => Object.assign({}, x, { netSharePct: totalTraded ? round((x.netValue / totalTraded) * 100, 2) : 0 });
  const byCategory = Array.from(byCategoryMap.values()).map(enrich).sort((a,b) => b.netValue - a.netValue);
  const byNationality = Array.from(byNationalityMap.values()).map(enrich).sort((a,b) => b.netValue - a.netValue);
  const strongestBuyer = normalized.slice().sort((a,b) => b.netValue - a.netValue)[0];
  const strongestSeller = normalized.slice().sort((a,b) => a.netValue - b.netValue)[0];

  let marketSignal = 'متوازن';
  if (byCategory.find(x => x.label === 'مؤسسات')?.netValue > 0 && byNationality.find(x => x.label === 'أجانب')?.netValue > 0) marketSignal = 'دخول مؤسسي/أجنبي داعم';
  else if (byCategory.find(x => x.label === 'مؤسسات')?.netValue < 0 && netTotal < 0) marketSignal = 'ضغط بيع مؤسسي يحتاج حذر';
  else if (byCategory.find(x => x.label === 'أفراد')?.netValue > 0 && byCategory.find(x => x.label === 'مؤسسات')?.netValue < 0) marketSignal = 'صعود قد يكون مضاربيًا ويحتاج تأكيد';

  const report = {
    version: '5.5.0-sector-investor-flow',
    generatedAt: new Date().toISOString(),
    status: 'ok',
    source: input.source || 'manual/official-input',
    date: input.date || null,
    unit: input.unit || 'EGP',
    note: 'تحليل ومراقبة فقط وليس أوامر تداول.',
    summary: {
      totalBuy: round(totalBuy, 2),
      totalSell: round(totalSell, 2),
      netTotal: round(netTotal, 2),
      strongestBuyer: strongestBuyer?.label || '—',
      strongestSeller: strongestSeller?.label || '—',
      marketSignal
    },
    byCategory,
    byNationality,
    rows: normalized.map(enrich),
    portfolioImpact: [
      marketSignal.includes('داعم') ? 'يمكن رفع وزن القطاعات صاحبة السيولة والاتجاه بشرط وجود وقف مخاطر.' : 'لا ترفع المخاطر قبل تأكيد اتجاه المتعاملين.',
      `القطاع المرشح التالي حسب تقرير القطاعات: ${sectorReport?.summary?.nextSector || '—'}.`,
      'لا تعتمد على نوع المتعاملين وحده؛ اربطه بالسيولة والاتجاه وحالة السهم داخل القطاع.'
    ]
  };
  writeJson(files.investorOut, report);
  console.log(`[EGX V5.5] investor-flow-report.json generated: ${marketSignal}`);
}

function main() {
  buildSectorReport();
  buildInvestorReport();
}

main();
