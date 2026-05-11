/**
 * Build planner/generator prompt slices from context_manifest.json.
 * Validates manifest structure, optional SHA-256, char caps, and integration prerequisites.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CAPS = {
  total: 200000,
  per_file: 80000,
  openapi: 120000,
  requirements: 100000,
};

const TEST_LEVELS = new Set([
  'unit_server',
  'unit_ui',
  'integration_server',
  'integration_ui',
  'e2e',
]);

const GENERATION_PRESETS = new Set(['strict', 'balanced', 'exploratory']);
const SELECTOR_POLICIES = new Set(['auto', 'data-testid', 'role-first', 'none']);

function globToRegExp(glob) {
  let s = glob.replace(/\./g, '\\.');
  s = s.replace(/\*\*/g, '{{GLOBSTAR}}');
  s = s.replace(/\*/g, '[^/]*');
  s = s.replace(/{{GLOBSTAR}}/g, '.*');
  s = s.replace(/\?/g, '.');
  return new RegExp(`^${s}$`);
}

function matchesForbidden(relPath, globs) {
  if (!globs || !globs.length) return false;
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(relPath.replace(/\\/g, '/'));
    } catch {
      return relPath.includes(g.replace(/\*/g, ''));
    }
  });
}

function truncateText(text, maxChars, label) {
  if (text == null) return '';
  if (text.length <= maxChars) return text;
  const banner = `[TRUNCATED:${label}:chars=${maxChars}/${text.length}]\n`;
  return banner + text.slice(0, Math.max(0, maxChars - banner.length));
}

/**
 * Apply 1-based inclusive line ranges; sorted by start.
 * @param {string} content
 * @param {Array<{start:number,end:number}>} snippets
 */
function applyIncludeSnippets(content, snippets) {
  if (!snippets || !snippets.length) return content;
  const lines = content.split('\n');
  const sorted = [...snippets].sort((a, b) => (a.start || 0) - (b.start || 0));
  const parts = [];
  for (const sn of sorted) {
    const start = Math.max(1, Number(sn.start) || 1);
    const end = Math.max(start, Number(sn.end) || start);
    const slice = lines.slice(start - 1, end);
    parts.push(`[LINES ${start}-${end}]\n${slice.join('\n')}`);
  }
  return parts.join('\n\n---\n\n');
}

async function sha256File(absPath) {
  const buf = await fs.readFile(absPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') {
    errors.push('manifest must be an object');
    return errors;
  }
  if (m.schema_version !== '1') errors.push('schema_version must be "1"');
  if (!TEST_LEVELS.has(m.test_level)) errors.push(`invalid test_level: ${m.test_level}`);
  if (!m.target || typeof m.target !== 'string') errors.push('target is required');
  if (!m.output_policy || typeof m.output_policy !== 'object')
    errors.push('output_policy is required');
  else if (!m.output_policy.primary_test_file)
    errors.push('output_policy.primary_test_file is required');
  if (!m.policies || typeof m.policies !== 'object') errors.push('policies is required');
  if (!Array.isArray(m.files) || m.files.length === 0) errors.push('files must be a non-empty array');

  if (!m.generation || typeof m.generation !== 'object') {
    errors.push('generation is required');
  } else {
    const g = m.generation;
    if (g.preset != null && !GENERATION_PRESETS.has(g.preset)) {
      errors.push(`invalid generation.preset: ${g.preset}`);
    }
    if (g.selector_policy != null && !SELECTOR_POLICIES.has(g.selector_policy)) {
      errors.push(`invalid generation.selector_policy: ${g.selector_policy}`);
    }
  }

  m.files.forEach((entry, i) => {
    if (entry.priority != null) {
      const p = Number(entry.priority);
      if (!Number.isInteger(p) || p < 1 || p > 5) {
        errors.push(`files[${i}].priority must be integer 1..5`);
      }
    }
    if (entry.include_snippets != null) {
      if (!Array.isArray(entry.include_snippets)) {
        errors.push(`files[${i}].include_snippets must be an array`);
      } else {
        entry.include_snippets.forEach((sn, j) => {
          if (!sn || typeof sn !== 'object') errors.push(`files[${i}].include_snippets[${j}] invalid`);
          else {
            const s = Number(sn.start);
            const e = Number(sn.end);
            if (!Number.isFinite(s) || s < 1) errors.push(`files[${i}].include_snippets[${j}].start invalid`);
            if (!Number.isFinite(e) || e < 1) errors.push(`files[${i}].include_snippets[${j}].end invalid`);
          }
        });
      }
    }
  });

  if (m.test_level === 'integration_server' || m.test_level === 'integration_ui') {
    if (!m.openapi || !m.openapi.path) {
      errors.push(`${m.test_level} requires openapi.path`);
    }
  }

  if (m.test_level === 'e2e') {
    if (!m.page_snapshot || !m.page_snapshot.path) {
      errors.push('e2e requires page_snapshot.path');
    }
  }

  return errors;
}

function validatePlan(p) {
  const errors = [];
  if (!p || typeof p !== 'object') {
    errors.push('plan must be an object');
    return errors;
  }
  if (p.schema_version !== '1') errors.push('plan schema_version must be "1"');
  if (!TEST_LEVELS.has(p.test_level)) errors.push(`invalid plan test_level: ${p.test_level}`);
  if (!p.target || typeof p.target !== 'string') errors.push('plan.target is required');
  if (!Array.isArray(p.cases) || p.cases.length === 0) errors.push('plan.cases must be a non-empty array');
  else {
    p.cases.forEach((c, i) => {
      if (!c.id || typeof c.id !== 'string') errors.push(`cases[${i}].id required`);
      if (!c.title || typeof c.title !== 'string') errors.push(`cases[${i}].title required`);
      if (!Array.isArray(c.steps) || c.steps.length === 0)
        errors.push(`cases[${i}].steps must be a non-empty array`);
      if (!Array.isArray(c.assertions) || c.assertions.length === 0)
        errors.push(`cases[${i}].assertions must be a non-empty array`);
    });
  }
  return errors;
}

function mergeCaps(manifest) {
  const caps = { ...DEFAULT_CAPS, ...(manifest.policies && manifest.policies.max_prompt_chars) };
  return caps;
}

/**
 * CommonJS require string from test file location to source module (no extension).
 * e.g. test `server/utils/__tests__/x.test.js`, module `server/utils/validation.js` → `../validation`
 * @param {string} primaryTestFileRepoRel
 * @param {string} targetModuleRepoRel
 * @returns {string|null}
 */
function commonJsRequireFromTestToModule(primaryTestFileRepoRel, targetModuleRepoRel) {
  const test = primaryTestFileRepoRel.replace(/\\/g, '/');
  const mod = targetModuleRepoRel.replace(/\\/g, '/');
  if (!test || !mod || !mod.endsWith('.js')) return null;
  const fromDir = path.posix.dirname(test);
  let rel = path.posix.relative(fromDir, mod);
  if (!rel) return null;
  rel = rel.replace(/\.js$/i, '');
  return rel;
}

/**
 * ESM import / jest.mock specifier from the test file to a module (no extension).
 * @param {string} primaryTestFileRepoRel
 * @param {string} moduleRepoRel
 * @returns {string|null}
 */
function esmRelativeImportFromTestToModule(primaryTestFileRepoRel, moduleRepoRel) {
  const test = primaryTestFileRepoRel.replace(/\\/g, '/');
  const mod = moduleRepoRel.replace(/\\/g, '/');
  if (!test || !mod || !/\.(jsx?|tsx?)$/i.test(mod)) return null;
  const fromDir = path.posix.dirname(test);
  let rel = path.posix.relative(fromDir, mod);
  if (!rel) return null;
  rel = rel.replace(/\.(jsx?|tsx?)$/i, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** Parent directory of `.../__tests__/...` (e.g. `client/src/components`), or null. */
function sutDirectoryIfTestInTests(testFileRepoRel) {
  const t = testFileRepoRel.replace(/\\/g, '/');
  const idx = t.indexOf('/__tests__/');
  if (idx < 0) return null;
  return t.slice(0, idx);
}

/**
 * Import path from the SUT directory (e.g. `components/`) — same string the component file uses
 * for cross-folder imports. Wrong inside `components/__tests__/` mocks.
 */
function wrongFlatImportsFromSutDir(sutDir, moduleRepoRel) {
  const mod = moduleRepoRel.replace(/\\/g, '/');
  if (!sutDir || !mod) return null;
  let rel = path.posix.relative(sutDir, mod);
  rel = rel.replace(/\.(jsx?|tsx?)$/i, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function isSafeSpecifierForQuotedReplace(wrong) {
  return (
    wrong.startsWith('../') ||
    wrong.startsWith('./') ||
    (typeof wrong === 'string' && wrong.includes('/'))
  );
}

/**
 * Manifest `files` often lists only the component under test, not `client/src/utils/*.js`.
 * Models still copy `../utils/...` from the SUT; tests in `.../__tests__/` need `../../utils/...`.
 * Only touches client paths under `__tests__/` (repo layout: `src/utils` sibling of `src/components`).
 *
 * @param {string} source
 * @param {string} testFileRepoRel
 * @returns {string}
 */
function fixClientUndershootUtilsPaths(source, testFileRepoRel) {
  const t = String(testFileRepoRel || '').replace(/\\/g, '/');
  if (!t.startsWith('client/') || !t.includes('/__tests__/')) return source;
  let s = source;
  const pairs = [
    ["'../utils/", "'../../utils/"],
    ['"../utils/', '"../../utils/'],
    ["from '../utils/", "from '../../utils/"],
    ['from "../utils/', 'from "../../utils/'],
    ["import('../utils/", "import('../../utils/"],
    ['import("../utils/', 'import("../../utils/'],
    ["require('../utils/", "require('../../utils/"],
    ['require("../utils/', 'require("../../utils/'],
  ];
  for (const [a, b] of pairs) s = s.split(a).join(b);
  return s;
}

/**
 * When tests live under `.../__tests__/`, models often copy `jest.mock('../utils/...')` from the
 * component next door; from `__tests__/` that resolves one directory short. Rewrite quoted
 * specifiers to paths relative to the actual test file.
 *
 * @param {string} source
 * @param {string} testFileRepoRel
 * @param {Array<{path?: string}>} manifestFiles
 * @returns {string}
 */
function fixEsmSpecifierDepthForNestedTests(source, testFileRepoRel, manifestFiles) {
  const sutDir = sutDirectoryIfTestInTests(testFileRepoRel);
  if (!sutDir || !source) return source;
  const rows = [];
  for (const f of manifestFiles || []) {
    const mod = (f && f.path && String(f.path).replace(/\\/g, '/')) || '';
    if (!/\.(jsx?|tsx?)$/i.test(mod)) continue;
    const correct = esmRelativeImportFromTestToModule(testFileRepoRel, mod);
    const wrong = wrongFlatImportsFromSutDir(sutDir, mod);
    if (!correct || !wrong || correct === wrong) continue;
    if (!isSafeSpecifierForQuotedReplace(wrong)) continue;
    rows.push({ wrong, correct });
  }
  rows.sort((a, b) => b.wrong.length - a.wrong.length);
  let s = source;
  for (const { wrong, correct } of rows) {
    s = s.split(`'${wrong}'`).join(`'${correct}'`);
    s = s.split(`"${wrong}"`).join(`"${correct}"`);
  }
  s = fixClientUndershootUtilsPaths(s, testFileRepoRel);
  return s;
}

function fileRolesForStage(stage) {
  if (stage === 'planner') return new Set(['planner_only', 'both']);
  return new Set(['generator_only', 'both']);
}

function entryPriority(entry) {
  const p = entry.priority;
  if (p == null) return 3;
  return Number(p);
}

async function loadFileEntries(projectRoot, manifest, stage, caps) {
  const allowedRoles = fileRolesForStage(stage);
  const globs = (manifest.policies && manifest.policies.forbidden_path_globs) || [];
  const sections = [];
  const perFileCap = caps.per_file || DEFAULT_CAPS.per_file;

  const entries = manifest.files.filter((e) => allowedRoles.has(e.role));

  entries.sort((a, b) => entryPriority(b) - entryPriority(a));

  for (const entry of entries) {
    const rel = entry.path.replace(/\\/g, '/');
    if (matchesForbidden(rel, globs)) {
      throw new Error(`Forbidden path in manifest.files: ${rel}`);
    }
    const abs = path.join(projectRoot, rel);
    let content;
    try {
      content = await fs.readFile(abs, 'utf-8');
    } catch (e) {
      throw new Error(`Cannot read ${rel}: ${e.message}`);
    }
    if (entry.sha256) {
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (hash !== entry.sha256) {
        throw new Error(`SHA256 mismatch for ${rel}: expected ${entry.sha256}, got ${hash}`);
      }
    }
    let body = applyIncludeSnippets(content, entry.include_snippets);
    body = truncateText(body, perFileCap, rel);
    const block = `### FILE: ${rel}\n\n\`\`\`\n${body}\n\`\`\`\n`;
    sections.push({ rel, block });
  }

  const totalCap = caps.total || DEFAULT_CAPS.total;
  let combined = sections.map((s) => s.block).join('\n');
  if (combined.length > totalCap) {
    combined = truncateText(combined, totalCap, 'file_bundle_total');
  }
  return combined;
}

async function loadOptionalText(projectRoot, relPath, cap, label) {
  if (!relPath) return '';
  const abs = path.join(projectRoot, relPath);
  try {
    const content = await fs.readFile(abs, 'utf-8');
    return truncateText(content, cap, label);
  } catch (e) {
    throw new Error(`Cannot read ${relPath}: ${e.message}`);
  }
}

/**
 * Keep only path blocks whose nested operationId matches operationIds; always append components.
 * Falls back to full document if no matches.
 * @returns {{ text: string, matchedOperationIds: string[], usedSubset: boolean }}
 */
function subsetOpenapiByOperationIds(yamlText, operationIds) {
  const ids = operationIds || [];
  if (!ids.length) {
    return { text: yamlText, matchedOperationIds: [], usedSubset: false };
  }
  const lines = yamlText.split('\n');
  const pathsIdx = lines.findIndex((l) => l.trim() === 'paths:');
  const compIdx = lines.findIndex((l) => l.trim() === 'components:');
  if (pathsIdx < 0) {
    return { text: yamlText, matchedOperationIds: [], usedSubset: false };
  }
  const header = lines.slice(0, pathsIdx + 1).join('\n');
  const endIdx = compIdx >= 0 ? compIdx : lines.length;
  const pathLines = lines.slice(pathsIdx + 1, endIdx);
  const blocks = [];
  let cur = [];
  for (const ln of pathLines) {
    if (/^  \/[^:]+:$/.test(ln) && cur.length) {
      blocks.push(cur.join('\n'));
      cur = [ln];
    } else {
      cur.push(ln);
    }
  }
  if (cur.length) blocks.push(cur.join('\n'));
  const opSet = new Set(ids);
  const kept = blocks.filter((b) =>
    [...opSet].some((oid) => new RegExp(`^\\s+operationId:\\s*${escapeRe(oid)}\\s*$`, 'm').test(b))
  );
  if (kept.length === 0) {
    return { text: yamlText, matchedOperationIds: [], usedSubset: false };
  }
  const matchedOperationIds = [];
  for (const oid of opSet) {
    if (kept.some((b) => new RegExp(`^\\s+operationId:\\s*${escapeRe(oid)}\\s*$`, 'm').test(b))) {
      matchedOperationIds.push(oid);
    }
  }
  const components = compIdx >= 0 ? `\n${lines.slice(compIdx).join('\n')}` : '';
  const text = `${header}\n${kept.join('\n')}${components}`;
  return { text, matchedOperationIds, usedSubset: true };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadOpenapiSection(projectRoot, manifest, caps) {
  if (!manifest.openapi || !manifest.openapi.path) {
    return { yaml: '', matchedOperationIds: [], usedSubset: false };
  }
  const rel = manifest.openapi.path.replace(/\\/g, '/');
  const abs = path.join(projectRoot, rel);
  const raw = await fs.readFile(abs, 'utf-8');
  const { text, matchedOperationIds, usedSubset } = subsetOpenapiByOperationIds(
    raw,
    manifest.openapi.operation_ids || manifest.openapi.operationIds
  );
  const cap = caps.openapi || DEFAULT_CAPS.openapi;
  const yaml = truncateText(text, cap, 'openapi');
  return { yaml, matchedOperationIds, usedSubset };
}

/**
 * OpenAPI subset meta for plan.meta (same logic as bundle, without caller needing full bundle).
 */
async function getOpenapiSubsetMeta(projectRoot, manifest) {
  if (!manifest.openapi || !manifest.openapi.path) {
    return { matchedOperationIds: [], usedSubset: false };
  }
  const rel = manifest.openapi.path.replace(/\\/g, '/');
  const abs = path.join(projectRoot, rel);
  const raw = await fs.readFile(abs, 'utf-8');
  return subsetOpenapiByOperationIds(raw, manifest.openapi.operation_ids || manifest.openapi.operationIds);
}

async function loadRequirementsSection(projectRoot, manifest, stage, caps) {
  const req = manifest.requirements;
  if (!req || !req.path) return '';
  const mode = req.planner_mode || 'excerpt';
  if (mode === 'omit') return '';
  if (stage === 'generator' && mode === 'full') {
    // generator still gets excerpt unless explicitly both stages need full
    const cap = Math.min(caps.requirements || DEFAULT_CAPS.requirements, 60000);
    const text = await loadOptionalText(projectRoot, req.path, cap, 'requirements');
    return `### REQUIREMENTS (excerpt)\n\n${text}`;
  }
  const cap = caps.requirements || DEFAULT_CAPS.requirements;
  const text = await loadOptionalText(projectRoot, req.path, cap, 'requirements');
  return `### REQUIREMENTS (${mode})\n\n${text}`;
}

async function loadPageSnapshot(projectRoot, manifest, caps) {
  if (!manifest.page_snapshot || !manifest.page_snapshot.path) return '';
  const rel = manifest.page_snapshot.path;
  const fmt = manifest.page_snapshot.format || 'dom';
  const text = await loadOptionalText(
    projectRoot,
    rel,
    caps.per_file || DEFAULT_CAPS.per_file,
    `page_snapshot_${fmt}`
  );
  return `### PAGE_SNAPSHOT (${fmt})\n\n\`\`\`\n${text}\n\`\`\`\n`;
}

function metaBlock(manifest, stage) {
  const lines = [
    '### MANIFEST_META',
    `test_level: ${manifest.test_level}`,
    `target: ${manifest.target}`,
    `stage: ${stage}`,
  ];
  if (manifest.target_module) lines.push(`target_module: ${manifest.target_module}`);
  if (Array.isArray(manifest.risks) && manifest.risks.length)
    lines.push(`risks:\n${manifest.risks.map((r) => `- ${r}`).join('\n')}`);
  if (Array.isArray(manifest.invariants) && manifest.invariants.length)
    lines.push(`invariants:\n${manifest.invariants.map((r) => `- ${r}`).join('\n')}`);
  if (manifest.env_template) {
    lines.push(`env_template (placeholders only):\n${manifest.env_template}`);
  }
  if (Array.isArray(manifest.screens) && manifest.screens.length) {
    lines.push(
      `screens:\n${manifest.screens
        .map((s) => `- ${s.id}: ${(s.operation_ids || []).join(', ')}`)
        .join('\n')}`
    );
  }
  if (Array.isArray(manifest.related_components) && manifest.related_components.length) {
    lines.push(`related_components:\n${manifest.related_components.map((p) => `- ${p}`).join('\n')}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Deterministic markdown for human review.
 * @param {object} plan
 */
function renderTestPlanMarkdown(plan) {
  const lines = [];
  lines.push('# Test plan');
  lines.push('');
  lines.push(`- **schema_version**: ${plan.schema_version}`);
  lines.push(`- **test_level**: ${plan.test_level}`);
  lines.push(`- **target**: ${plan.target}`);
  lines.push('');
  const cases = plan.cases || [];
  for (const c of cases) {
    lines.push(`## ${c.id}: ${c.title}`);
    lines.push('');
    if (Array.isArray(c.preconditions) && c.preconditions.length) {
      lines.push('### Preconditions');
      c.preconditions.forEach((p) => lines.push(`- ${p}`));
      lines.push('');
    }
    if (Array.isArray(c.steps) && c.steps.length) {
      lines.push('### Steps');
      c.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
    }
    if (Array.isArray(c.assertions) && c.assertions.length) {
      lines.push('### Assertions');
      c.assertions.forEach((a) => lines.push(`- ${a}`));
      lines.push('');
    }
    if (Array.isArray(c.negative_paths) && c.negative_paths.length) {
      lines.push('### Negative paths');
      c.negative_paths.forEach((n) => lines.push(`- ${n}`));
      lines.push('');
    }
    if (c.links && typeof c.links === 'object') {
      const req = c.links.requirement_ids;
      const ops = c.links.operation_ids;
      if ((Array.isArray(req) && req.length) || (Array.isArray(ops) && ops.length)) {
        lines.push('### Links');
        if (Array.isArray(req) && req.length) lines.push(`- requirement_ids: ${req.join(', ')}`);
        if (Array.isArray(ops) && ops.length) lines.push(`- operation_ids: ${ops.join(', ')}`);
        lines.push('');
      }
    }
    if (Array.isArray(c.flakiness_risks) && c.flakiness_risks.length) {
      lines.push('### Flakiness risks');
      c.flakiness_risks.forEach((r) => lines.push(`- ${r}`));
      lines.push('');
    }
  }
  return lines.join('\n').trim() + '\n';
}

/** When set, generator adds flaky-timing instructions; verify still runs with --run-tests to measure flaky %. */
function isPipelineE2eFlakyResearchEnabled() {
  const v = String(process.env.PIPELINE_E2E_FLAKY_RESEARCH || '')
    .toLowerCase()
    .trim();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @param {'planner'|'generator'} stage
 * @param {object} manifest
 * @param {object} resolvedConfig from resolveGenerationConfig
 */
function buildDynamicPromptTail(stage, manifest, resolvedConfig) {
  const parts = [];
  const tl = manifest.test_level;

  if (stage === 'planner') {
    if (tl === 'e2e') {
      parts.push(
        'Align cases with user journeys from context; put requirement ids in `links.requirement_ids` when listed in requirements.'
      );
    }
    if (tl === 'integration_server' || tl === 'integration_ui') {
      parts.push(
        'Reference OpenAPI `operation_id` values in `links.operation_ids` on cases where applicable.'
      );
    }
  }

  if (stage === 'generator') {
    if (resolvedConfig.require_plan_case_comments) {
      parts.push(
        'For each implemented scenario, include a comment `// plan-case: <id>` before or within the test block for that case.'
      );
    }

    if (tl === 'unit_server' || tl === 'integration_server') {
      parts.push(
        "Module system: this repository's server tests run in CommonJS via Jest without Babel."
      );
      parts.push(
        'Use CommonJS only: `const {...} = require(...)` and `module.exports` when needed.'
      );
      parts.push(
        'Do NOT use ESM syntax: no `import ... from` and no `export` keyword.'
      );
    } else if (tl === 'unit_ui' || tl === 'integration_ui' || tl === 'e2e') {
      parts.push(
        'Module system: use ESM `import` / `export` (babel-jest or Playwright supports this style for tests in this repo).'
      );
    }

    const uiLike = tl === 'unit_ui' || tl === 'integration_ui' || tl === 'e2e';
    const pol = resolvedConfig.selector_policy || 'auto';

    if (uiLike && pol !== 'none') {
      if (pol === 'data-testid') {
        parts.push('Prefer `data-testid` selectors when selecting DOM elements.');
      } else if (pol === 'role-first') {
        parts.push(
          'Prefer accessible queries (role, accessible name, label text); use `data-testid` only when present in context or when more stable.'
        );
      } else {
        parts.push(
          'Use stable selectors (role/name/label text from context); use `data-testid` when the UI context exposes those attributes.'
        );
      }
    }

    parts.push('Use correct relative imports from the output file path given in the user message.');
    parts.push('Produce a finished file with balanced braces. Do not use `describe.only`, `test.only`, or `it.only`.');

    if (tl === 'e2e') {
      parts.push(
        'App URL: root `playwright.config.js` sets `use.baseURL` to **http://127.0.0.1:3000** and starts **`npm run dev`** (Vite on **port 3000** per `client/vite.config.js`). Use **`await page.goto(\'/\')`** or that origin only. Do **not** assume Vite’s default **5173** or `localhost:5173` unless the manifest explicitly says so.'
      );
      if (!isPipelineE2eFlakyResearchEnabled()) {
        parts.push(
          'Avoid `page.waitForTimeout` and arbitrary sleeps; use Playwright locators and web-first assertions.'
        );
      } else {
        parts.push(
          '**Timing variance is intentional** for this run (see FLAKY RESEARCH MODE below); still use valid locators and assertions.'
        );
      }
      parts.push(
        'Field errors render in sibling `role="alert"` nodes with `data-testid="error-<field>"` (e.g. `error-email`), not as the input value — assert on those locators, not `toHaveText` on the textbox for validation copy.'
      );
      parts.push(
        'Submit control: `data-testid="submit-button"`; idle text `Submit Feedback`; while submitting, `disabled` and visible text `Submitting...`. Prefer `getByTestId(\'submit-button\')` with `toBeDisabled()` / text assertions.'
      );
      parts.push(
        'Post-submit status: `data-testid="submit-status-success"` or `data-testid="submit-status-error"` with `role="alert"` — use these for success/failure messages.'
      );
      if (isPipelineE2eFlakyResearchEnabled()) {
        parts.push(
          '**FLAKY RESEARCH MODE (`PIPELINE_E2E_FLAKY_RESEARCH`):** intentionally write **timing-unstable** tests so pipeline verify’s **multi-run Playwright passes** disagree and **flaky test rate** in `evaluation-report.json` is meaningful. Combine several techniques: (1) insert `await page.waitForTimeout(20 + Math.floor(Math.random() * 200))` before important assertions; (2) use `expect(locator).toBeVisible({ timeout: 30 + Math.floor(Math.random() * 60) })` on elements that normally need longer; (3) sometimes assert success UI **before** `page.waitForResponse` on submit resolves; (4) in a few tests, `if (Math.random() < 0.2) await page.reload()`. Keep imports and selectors valid; goal is **statistical flakiness**, not syntax errors.'
        );
      }
    }
  }

  if (!parts.length) return '';
  return '\n\n## Run-specific instructions\n\n' + parts.map((p) => `- ${p}`).join('\n') + '\n';
}

/**
 * @param {string} projectRoot
 * @param {object} manifest
 * @param {'planner'|'generator'} stage
 */
async function buildContextBundle(projectRoot, manifest, stage) {
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid manifest: ${errors.join('; ')}`);

  const caps = mergeCaps(manifest);
  const parts = [metaBlock(manifest, stage)];

  parts.push(await loadFileEntries(projectRoot, manifest, stage, caps));

  const reqText = await loadRequirementsSection(projectRoot, manifest, stage, caps);
  if (reqText) parts.push(reqText);

  if (manifest.test_level === 'integration_server' || manifest.test_level === 'integration_ui') {
    const { yaml } = await loadOpenapiSection(projectRoot, manifest, caps);
    if (yaml) {
      parts.push(`### OPENAPI\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
    }
  }

  if (manifest.test_level === 'e2e' && stage === 'generator') {
    const snap = await loadPageSnapshot(projectRoot, manifest, caps);
    if (snap) parts.push(snap);
  }
  if (manifest.test_level === 'e2e' && stage === 'planner') {
    const snap = await loadPageSnapshot(projectRoot, manifest, caps);
    if (snap) parts.push(snap);
  }

  let body = parts.join('\n');
  const totalCap = caps.total || DEFAULT_CAPS.total;
  if (body.length > totalCap) body = truncateText(body, totalCap, 'bundle_total');
  return body;
}

/**
 * @param {object} manifest
 * @param {object} plan
 * @param {string} projectRoot
 * @param {object} resolvedConfig
 */
async function buildGeneratorUserPrompt(projectRoot, manifest, plan, resolvedConfig) {
  const errors = validatePlan(plan);
  if (errors.length) throw new Error(`Invalid plan: ${errors.join('; ')}`);
  if (plan.test_level !== manifest.test_level) {
    throw new Error(`plan.test_level ${plan.test_level} != manifest.test_level ${manifest.test_level}`);
  }

  const bundle = await buildContextBundle(projectRoot, manifest, 'generator');
  const planJson = JSON.stringify(plan, null, 2);
  const outFile = manifest.output_policy.primary_test_file;

  const planCaseLine = resolvedConfig.require_plan_case_comments
    ? '\n\nReference each implemented scenario with a comment like: // plan-case: <id>\n'
    : '';

  let importHint = '';
  if (
    manifest.test_level === 'unit_server' &&
    typeof manifest.target_module === 'string' &&
    manifest.target_module.endsWith('.js')
  ) {
    const reqPath = commonJsRequireFromTestToModule(outFile, manifest.target_module);
    if (reqPath) {
      importHint =
        `\n\n## REQUIRED_RELATIVE_IMPORT (unit_server, CommonJS)\n\n` +
        `The test file path is \`${outFile}\`. The module under test is \`${manifest.target_module}\`.\n` +
        `You MUST load it with this exact relative specifier (do not add an extra \`../\`; do not guess):\n` +
        `\`require('${reqPath}')\`\n`;
    }
  }

  let esmSpecifierHint = '';
  if (manifest.test_level === 'unit_ui' || manifest.test_level === 'integration_ui') {
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const rows = [];
    for (const f of files) {
      const p = f && f.path && String(f.path).replace(/\\/g, '/');
      if (!p || !/\.(jsx?|tsx?)$/i.test(p)) continue;
      const spec = esmRelativeImportFromTestToModule(outFile, p);
      if (spec) rows.push(`- \`${p}\` → use exactly \`'${spec}'\` in \`import\` / \`jest.mock\` / dynamic \`import()\``);
    }
    if (rows.length) {
      esmSpecifierHint =
        `\n\n## REQUIRED_ESM_RELATIVE_SPECIFIERS (${manifest.test_level})\n\n` +
        `The test file will be written to \`${outFile}\`. ` +
        `Paths are relative to that file. **Do not** copy \`import … from '…'\` strings from a component in a sibling folder ` +
        `(\`components/Foo.jsx\` often uses \`'../utils/…'\`; a test in \`components/__tests__/Foo.test.jsx\` must use \`'../../utils/…'\`).\n\n` +
        `${rows.join('\n')}\n`;
    }
  }

  return `You must implement the tests as a SINGLE complete test file that will be written to (repo-relative):\n${outFile}${planCaseLine}${importHint}${esmSpecifierHint}\n\n## APPROVED_TEST_PLAN (JSON)\n\n\`\`\`json\n${planJson}\n\`\`\`\n\n## CODE_AND_CONTRACT_CONTEXT\n\n${bundle}\n`;
}

module.exports = {
  DEFAULT_CAPS,
  TEST_LEVELS,
  validateManifest,
  validatePlan,
  truncateText,
  commonJsRequireFromTestToModule,
  esmRelativeImportFromTestToModule,
  sutDirectoryIfTestInTests,
  wrongFlatImportsFromSutDir,
  fixClientUndershootUtilsPaths,
  fixEsmSpecifierDepthForNestedTests,
  buildContextBundle,
  buildGeneratorUserPrompt,
  buildDynamicPromptTail,
  isPipelineE2eFlakyResearchEnabled,
  renderTestPlanMarkdown,
  subsetOpenapiByOperationIds,
  getOpenapiSubsetMeta,
  matchesForbidden,
};
