'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDir, readJson, writeJsonAtomic } = require('./lib/utils.cjs');

function historyPath(repoRoot, ticker) {
  return path.join(repoRoot, 'data', 'history', `${ticker}.json`);
}

function readHistory(repoRoot, ticker) {
  return readJson(historyPath(repoRoot, ticker), null);
}

function writeHistory(repoRoot, ticker, document) {
  if (!Array.isArray(document.sessions) || document.sessions.length === 0) {
    throw new Error(`Refusing to replace ${ticker} history with an empty file`);
  }
  const file = historyPath(repoRoot, ticker);
  ensureDir(path.dirname(file));
  writeJsonAtomic(file, document);
  return file;
}

function preserveFailedHistory(repoRoot, ticker, errorMessage) {
  const existing = readHistory(repoRoot, ticker);
  if (!existing) return null;
  const next = {
    ...existing,
    staleData: true,
    updateFailed: true,
    lastUpdateError: errorMessage,
  };
  writeJsonAtomic(historyPath(repoRoot, ticker), next);
  return next;
}

module.exports = { historyPath, readHistory, writeHistory, preserveFailedHistory };
