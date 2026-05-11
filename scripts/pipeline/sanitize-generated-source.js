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
 * @param {string} source raw model output after markdown fence removal
 * @returns {string}
 */
function sanitizeGeneratedTestSource(source) {
  let s = stripBom(source);
  s = stripLeadingGarbageIdentifierLines(s);
  return s.trim();
}

module.exports = {
  sanitizeGeneratedTestSource,
  stripBom,
  stripLeadingGarbageIdentifierLines,
};
