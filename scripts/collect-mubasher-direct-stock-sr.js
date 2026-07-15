#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const MARKET_PATH = 'data/market.json';
const OUT_PATH = 'data/mubasher-support-resistance-direct.json';
const REPORT_PATH = 'data/mubasher-support-resistance-direct-report.json';

const CONCURRENCY = Number(process.env.EGX_SR_CONCURRENCY || 8);
const TIMEOUT_MS = Number(process.env.EGX_SR_TIMEOUT_MS || 25000);
const MIN_ROWS = Number(process.env.EGX_SR_MIN_ROWS || 80);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const digits = '٠١٢٣٤٥٦٧٨٩';
  const normalized = String(value)
    .replace(/[٠-٩]/g, d => String(digits.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/[٬،,\s%]/g, '')
    .replace(/[^\d.+\-eE]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
function symbol(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\.CA$/, '')
    .replace(/[^A-Z0-9.]/g, '');
}
function priceOf(row) {
  return num(row.price ?? row.lastPrice ?? row.currentPrice ?? row.last);
}
function validSR(row) {
  return num(row?.support1) > 0 &&
    num(row?.resistance1) > 0 &&
    num(row.support1) < num(row.resistance1);
}
function saneAgainstPrice(row, marketPrice) {
  if (!validSR(row)) return false;
  if (!(marketPrice > 0)) return true;
  const s1 = num(row.support1);
  const r1 = num(row.resistance1);
  return s1 / marketPrice >= 0.25 &&
    s1 / marketPrice <= 1.50 &&
    r1 / marketPrice >= 0.60 &&
    r1 / marketPrice <= 2.50;
}
function compactText(html) {
  const $ = cheerio.load(html);
  $('script,style,noscript,svg').remove();
  return $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}
function grab(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = num(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}
function parsePage(html, requestedSymbol, sourceUrl) {
  const text = compactText(html);
  const numberPattern = '([0-9٠-٩][0-9٠-٩.,٫٬]*)';

  const resistance2 = grab(text, [
    new RegExp(`Second resistance level\\s*\\(r2\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى مقاومة ثان\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);
  const resistance1 = grab(text, [
    new RegExp(`First resistance level\\s*\\(r1\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى مقاومة أول\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);
  const pivot = grab(text, [
    new RegExp(`Pivot point\\s*${numberPattern}`, 'i'),
    new RegExp(`نقطة الإرتكاز\\s*${numberPattern}`, 'i'),
    new RegExp(`نقطة الارتكاز\\s*${numberPattern}`, 'i'),
  ]);
  const support1 = grab(text, [
    new RegExp(`First support level\\s*\\((?:d1|s1)\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى دعم أول\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);
  const support2 = grab(text, [
    new RegExp(`Second support level\\s*\\((?:d1|d2|s2)\\)\\s*${numberPattern}`, 'i'),
    new RegExp(`مستوى دعم ثان\\s*\\([^)]*\\)\\s*${numberPattern}`, 'i'),
  ]);

  const updatedAt =
    text.match(/Last update:\s*([^.]*)\./i)?.[1]?.trim() ||
    text.match(/آخر تحديث:\s*(.*?)\s*بتوقيت السوق/i)?.[1]?.trim() ||
    null;

  const result = {
    symbol: requestedSymbol,
    pivot,
    support1,
    support2,
    resistance1,
    resistance2,
    updatedAtText: updatedAt,
    sourceUrl,
    source: 'Mubasher individual stock support-resistance page',
  };
  return validSR(result) ? result : null;
}
async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9,ar;q=0.7',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.length < 5000) throw new Error(`HTML too short: ${html.length}`);
      return { html, finalUrl: response.url, status: response.status };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
async function collectOne(row) {
  const s = symbol(row.symbol);
  const marketPrice = priceOf(row);
  const urls = [
    `https://english.mubasher.info/markets/EGX/stocks/${encodeURIComponent(s)}/support-resistance`,
    `https://www.mubasher.info/markets/EGX/stocks/${encodeURIComponent(s)}/support-resistance`,
  ];

  const errors = [];
  for (const url of urls) {
    try {
      const fetched = await fetchWithRetry(url);
      const parsed = parsePage(fetched.html, s, fetched.finalUrl || url);
      if (!parsed) {
        errors.push(`${url}: labels not parsed`);
        continue;
      }
      if (!saneAgainstPrice(parsed, marketPrice)) {
        errors.push(`${url}: levels failed price sanity`);
        continue;
      }
      return {
        ok: true,
        row: {
          ...parsed,
          marketPrice,
          fetchedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  return { ok: false, symbol: s, errors };
}
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
      if ((index + 1) % 20 === 0) {
        console.log(`Processed ${index + 1}/${items.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

(async () => {
  const market = readJson(MARKET_PATH);
  const marketRows = Array.isArray(market.rows) ? market.rows : [];
  const eligible = marketRows.filter(row => symbol(row.symbol) && priceOf(row) > 0);

  console.log(`Direct Mubasher S/R pages to fetch: ${eligible.length}`);
  const results = await mapLimit(eligible, CONCURRENCY, collectOne);
  const rows = results.filter(result => result?.ok).map(result => result.row);
  const failures = results.filter(result => result && !result.ok);

  const output = {
    ok: rows.length >= MIN_ROWS,
    generatedAt: new Date().toISOString(),
    method: 'individual-stock-server-rendered-pages',
    sourcePattern: 'https://english.mubasher.info/markets/EGX/stocks/{SYMBOL}/support-resistance',
    requested: eligible.length,
    count: rows.length,
    minimumRequiredRows: MIN_ROWS,
    coveragePct: eligible.length ? Number((rows.length / eligible.length * 100).toFixed(2)) : 0,
    rows,
  };
  const report = {
    ...output,
    rows: undefined,
    failureCount: failures.length,
    failures,
  };

  writeJson(OUT_PATH, output);
  writeJson(REPORT_PATH, report);

  console.log(`Verified individual S/R pages: ${rows.length}/${eligible.length} (${output.coveragePct}%)`);
  if (!output.ok) {
    console.error(`Insufficient verified rows: ${rows.length} < ${MIN_ROWS}`);
    process.exit(2);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
