/**
 * Module: fileUtils
 * Purpose: Shared file system helpers (read/write JSON, ensure directories).
 */

const fs = require('fs');
const path = require('path');

const ensureDirectory = dirPath => {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const ensureDir = ensureDirectory;

const readJsonFile = filePath => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const readJson = readJsonFile;

const writeJsonFile = (filePath, payload, options = {}) => {
  if (!filePath) return;
  const { ensureDir: shouldEnsureDir = true } = options;
  if (shouldEnsureDir) {
    ensureDirectory(path.dirname(filePath));
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
};

const writeJson = (filePath, payload) => writeJsonFile(filePath, payload, { ensureDir: true });

module.exports = {
  ensureDirectory,
  ensureDir,
  readJsonFile,
  readJson,
  writeJsonFile,
  writeJson
};
