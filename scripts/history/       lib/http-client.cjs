'use strict';

const https = require('https');
const http = require('http');
const { sleep } = require('./utils.cjs');

const DEFAULT_HEADERS = {
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  'User-Agent': 'RAS-EGX-PRO2026-History/12.2 (+https://github.com/rasheadsca-star/RAS-EGX-PRO2026)',
};

function requestOnce(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'http:' ? http : https;
    const request = transport.request(parsed, {
      method: 'GET',
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirectCount < 4) {
        response.resume();
        resolve(requestOnce(new URL(location, parsed).toString(), options, redirectCount + 1));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status, headers: response.headers, body, url: parsed.toString() });
      });
    });

    const timeoutMs = Number(options.timeoutMs || 18000);
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`)));
    request.on('error', reject);
    request.end();
  });
}

async function getJson(urls, options = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 3));
  const errors = [];

  for (const url of list) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await requestOnce(url, options);
        if (response.status >= 200 && response.status < 300) {
          try {
            return { json: JSON.parse(response.body), response, attempts: attempt };
          } catch (error) {
            throw new Error(`Invalid JSON from ${url}: ${error.message}`);
          }
        }
        throw new Error(`HTTP ${response.status} from ${url}`);
      } catch (error) {
        errors.push(`${url} attempt ${attempt}: ${error.message}`);
        if (attempt < maxAttempts) {
          const waitMs = Math.min(8000, Number(options.backoffMs || 900) * (2 ** (attempt - 1)));
          await sleep(waitMs);
        }
      }
    }
  }

  const failure = new Error(`All HTTP attempts failed. ${errors.join(' | ')}`);
  failure.causes = errors;
  throw failure;
}

module.exports = { getJson };
