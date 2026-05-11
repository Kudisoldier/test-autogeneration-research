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
 * Mask line comments, block comments, and string/template literals with spaces (same length)
 * so searches only see executable-ish code. Not a full JS lexer; good enough for pipeline hygiene.
 *
 * @param {string} source
 * @returns {string}
 */
function maskJsCommentsAndStrings(source) {
  const a = source.split('');
  let i = 0;
  while (i < a.length) {
    if (a[i] === '/' && a[i + 1] === '/') {
      a[i] = ' ';
      a[i + 1] = ' ';
      i += 2;
      while (i < a.length && a[i] !== '\n') {
        a[i] = ' ';
        i++;
      }
      continue;
    }
    if (a[i] === '/' && a[i + 1] === '*') {
      a[i] = ' ';
      a[i + 1] = ' ';
      i += 2;
      while (i + 1 < a.length && !(a[i] === '*' && a[i + 1] === '/')) {
        if (a[i] !== '\n') a[i] = ' ';
        i++;
      }
      if (i + 1 < a.length && a[i] === '*' && a[i + 1] === '/') {
        a[i] = ' ';
        a[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    const q = a[i];
    if (q === '"' || q === "'") {
      a[i] = ' ';
      const delim = q;
      i++;
      while (i < a.length && a[i] !== delim) {
        if (a[i] === '\\') {
          a[i] = ' ';
          if (i + 1 < a.length) a[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (a[i] !== '\n') a[i] = ' ';
        i++;
      }
      if (i < a.length) {
        a[i] = ' ';
        i++;
      }
      continue;
    }
    if (q === '`') {
      a[i] = ' ';
      i++;
      while (i < a.length && a[i] !== '`') {
        if (a[i] === '\\') {
          a[i] = ' ';
          if (i + 1 < a.length) a[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (a[i] === '$' && a[i + 1] === '{') {
          a[i] = ' ';
          a[i + 1] = ' ';
          i += 2;
          let depth = 1;
          while (i < a.length && depth > 0) {
            if (a[i] === '{') depth++;
            else if (a[i] === '}') depth--;
            if (a[i] !== '\n') a[i] = ' ';
            i++;
          }
          continue;
        }
        if (a[i] !== '\n') a[i] = ' ';
        i++;
      }
      if (i < a.length) {
        a[i] = ' ';
        i++;
      }
      continue;
    }
    i++;
  }
  return a.join('');
}

function isIdentChar(c) {
  return c != null && /[A-Za-z0-9_$]/.test(c);
}

/**
 * @param {string} s
 * @param {number} openIdx index of '('
 * @returns {number} index of matching ')', or -1
 */
function matchingClosingParen(s, openIdx) {
  let depth = 1;
  let i = openIdx + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      i += 2;
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i + 1 < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i = Math.min(s.length, i + 2);
      continue;
    }
    const q = c;
    if (q === '"' || q === "'") {
      i++;
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') i += 2;
        else i++;
      }
      i = Math.min(s.length, i + 1);
      continue;
    }
    if (q === '`') {
      i++;
      while (i < s.length && s[i] !== '`') {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === '$' && s[i + 1] === '{') {
          i += 2;
          let d = 1;
          while (i < s.length && d > 0) {
            if (s[i] === '{') d++;
            else if (s[i] === '}') d--;
            i++;
          }
          continue;
        }
        i++;
      }
      i = Math.min(s.length, i + 1);
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * True if executable code appears to call Playwright's deprecated wait helpers.
 * Uses comment/string masking so docstrings like "avoid page.waitForTimeout(…)" are ignored.
 *
 * @param {string} source
 * @returns {boolean}
 */
function sourceUsesForbiddenPlaywrightWaitForTimeout(source) {
  const s = String(source || '');
  const masked = maskJsCommentsAndStrings(s);
  if (/(?:^|[^A-Za-z0-9_$])page\.waitForTimeout\s*\(/.test(masked)) return true;
  if (/(?:^|[^A-Za-z0-9_$])frame\.waitForTimeout\s*\(/.test(masked)) return true;
  if (/\bawait\s+waitForTimeout\s*\(/.test(masked)) return true;
  return false;
}

/**
 * Remove Playwright `page.waitForTimeout` / `frame.waitForTimeout` (forbidden by pipeline verify).
 * Handles multi-line calls and nested parentheses in the argument list.
 *
 * @param {string} source
 * @returns {string}
 */
function firstPlaywrightWaitForTimeoutHit(masked, s, keys) {
  let best = -1;
  let bestLen = 0;
  for (const key of keys) {
    let from = 0;
    while (from < masked.length) {
      const idx = masked.indexOf(key, from);
      if (idx === -1) break;
      const prev = idx > 0 ? masked[idx - 1] : '';
      if (isIdentChar(prev)) {
        from = idx + 1;
        continue;
      }
      const tail = idx + key.length;
      if (tail < masked.length && isIdentChar(masked[tail])) {
        from = idx + 1;
        continue;
      }
      let p = tail;
      while (p < s.length && /\s/.test(s[p])) p++;
      if (s[p] === '(' && (best === -1 || idx < best)) {
        best = idx;
        bestLen = key.length;
      }
      from = idx + 1;
    }
  }
  return best >= 0 ? { hit: best, keyLen: bestLen } : null;
}

function stripPlaywrightWaitForTimeout(source) {
  let s = String(source || '');
  const keys = ['page.waitForTimeout', 'frame.waitForTimeout'];
  while (true) {
    const masked = maskJsCommentsAndStrings(s);
    const found = firstPlaywrightWaitForTimeoutHit(masked, s, keys);
    if (!found) break;
    const { hit, keyLen } = found;
    let p = hit + keyLen;
    while (p < s.length && /\s/.test(s[p])) p++;
    const close = matchingClosingParen(s, p);
    if (close < 0) {
      s = s.slice(0, hit) + ' '.repeat(keyLen) + s.slice(hit + keyLen);
      continue;
    }
    let start = hit;
    const windowStart = Math.max(0, hit - 120);
    const before = s.slice(windowStart, hit);
    const awaitMatch = before.match(/\bawait\s*$/);
    if (awaitMatch) {
      start = windowStart + before.lastIndexOf('await');
    }
    let end = close + 1;
    while (end < s.length && /\s/.test(s[end])) end++;
    if (s[end] === ';') end++;
    s = s.slice(0, start) + s.slice(end);
  }
  s = s.replace(/\bawait\s+waitForTimeout\s*\([\s\S]*?\)\s*;?/g, '');
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
  sourceUsesForbiddenPlaywrightWaitForTimeout,
  normalizeE2ePlaywrightBaseUrl,
  stripBom,
  stripLeadingGarbageIdentifierLines,
};
