/**
 * Remove common LLM preamble glitches from generated test source (e.g. a lone `x`
 * before imports, or a bare language tag) so Jest can load the file.
 */

const LANGUAGE_TAG_LINE = new Set([
  'javascript',
  'js',
  'typescript',
  'ts',
  'tsx',
  'jsx',
  'json',
  'markdown',
  'md',
]);

function stripBom(s) {
  return String(s || '').replace(/^\uFEFF/, '');
}

/**
 * Drop leading blank lines and lines that are only a single identifier + optional `;`
 * when that identifier is clearly not real module code (1-char tokens, language tags).
 *
 * @param {string} source
 * @returns {string}
 */
function stripLeadingGarbageIdentifierLines(source) {
  const lines = String(source || '').split('\n');
  while (lines.length) {
    const head = lines[0];
    if (/^\s*$/.test(head)) {
      lines.shift();
      continue;
    }
    const m = head.match(/^\s*([a-zA-Z_$][\w$]*)\s*;?\s*$/);
    if (!m) break;
    const id = m[1];
    const lower = id.toLowerCase();
    const strip = id.length === 1 || LANGUAGE_TAG_LINE.has(lower);
    if (!strip) break;
    lines.shift();
  }
  return lines.join('\n');
}

/**
 * Remove Playwright `waitForTimeout` / `page.waitForTimeout` (forbidden by pipeline verify).
 * Handles common single-line forms; multi-line calls are rare for this API.
 *
 * @param {string} source
 * @returns {string}
 */
function stripPlaywrightWaitForTimeout(source) {
  let s = String(source || '');
  s = s.replace(/\bawait\s+page\.waitForTimeout\s*\([^)]*\)\s*;?/g, '');
  s = s.replace(/\bpage\.waitForTimeout\s*\([^)]*\)\s*;?/g, '');
  s = s.replace(/\bawait\s+[^.\n]*\.waitForTimeout\s*\([^)]*\)\s*;?/g, '');
  return s;
}

/**
 * LLMs often assume Vite's default port 5173. This repo uses port **3000** for the client
 * (`client/vite.config.js`) and Playwright `baseURL` **http://127.0.0.1:3000** (root `playwright.config.js`).
 *
 * @param {string} source
 * @param {string} relOut repo-relative output path
 */
function normalizeE2ePlaywrightBaseUrl(source, relOut) {
  const posix = String(relOut || '').replace(/\\/g, '/');
  if (!posix.startsWith('tests/e2e/')) return source;
  let s = String(source || '');
  const correct = 'http://127.0.0.1:3000';
  const patterns = [
    [/http:\/\/localhost:5173\b/g, correct],
    [/http:\/\/127\.0\.0\.1:5173\b/g, correct],
    [/https:\/\/localhost:5173\b/g, correct],
    [/https:\/\/127\.0\.0\.1:5173\b/g, correct],
    [/['"]http:\/\/localhost:5173\/?['"]/g, `'${correct}/'`],
  ];
  for (const [re, repl] of patterns) {
    s = s.replace(re, repl);
  }
  s = s.replace(/\bBASE_URL\s*=\s*['"]http:\/\/localhost:5173\/?['"]/g, `BASE_URL = '${correct}'`);
  s = s.replace(/\bBASE_URL\s*=\s*['"]http:\/\/127\.0\.0\.1:5173\/?['"]/g, `BASE_URL = '${correct}'`);
  return s;
}

function isPipelineE2eFlakyResearchEnv() {
  const v = String(process.env.PIPELINE_E2E_FLAKY_RESEARCH || '')
    .toLowerCase()
    .trim();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @param {string} source raw model output after markdown fence removal
 * @param {{ relOut?: string }} [options]
 * @returns {string}
 */
function sanitizeGeneratedTestSource(source, options = {}) {
  let s = stripBom(source);
  s = stripLeadingGarbageIdentifierLines(s);
  if (!isPipelineE2eFlakyResearchEnv()) {
    s = stripPlaywrightWaitForTimeout(s);
  }
  s = normalizeE2ePlaywrightBaseUrl(s, options.relOut);
  return s.trim();
}

module.exports = {
  sanitizeGeneratedTestSource,
  stripPlaywrightWaitForTimeout,
  normalizeE2ePlaywrightBaseUrl,
  stripBom,
  stripLeadingGarbageIdentifierLines,
};
