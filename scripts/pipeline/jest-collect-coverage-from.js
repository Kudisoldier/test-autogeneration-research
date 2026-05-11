const path = require('path');

function normalizeRel(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/**
 * Jest resolves `collectCoverageFrom` relative to `rootDir` (the config file's directory).
 * For `client/jest.config.js`, rootDir is `client/`, so repo-relative `client/src/...` never
 * matches and coverage is empty / pct Unknown.
 *
 * @param {string} jestConfigAbs absolute path to jest.config.js
 * @param {string | null} coverageSourceRel repo-relative source path (e.g. client/src/… or server/…)
 * @returns {string | null} path suitable for `--collectCoverageFrom`
 */
function collectCoverageFromForJest(jestConfigAbs, coverageSourceRel) {
  const rel = normalizeRel(coverageSourceRel);
  if (!rel) return null;
  const cfgNorm = path.normalize(String(jestConfigAbs || '')).replace(/\\/g, '/');
  const isClientJest = /(^|\/)client\/jest\.config\.js$/.test(cfgNorm);
  if (isClientJest && rel.startsWith('client/')) return rel.slice('client/'.length);
  return rel;
}

module.exports = { collectCoverageFromForJest, normalizeRel };
