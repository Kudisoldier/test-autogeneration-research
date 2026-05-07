#!/usr/bin/env node
/**
 * Stage 3: verify — node --check + forbidden patterns + plan-case coverage on files under <run-dir>/generated
 * Optional --run-tests stages generated files into repo-relative paths, runs Jest with --json,
 * and writes `<run-dir>/evaluation-report.json` (model / TTG from `generate.meta.json` + `plan.meta.json`,
 * type bucket from `context_manifest.json` `test_level`). Jest assertion failures are recorded in the
 * report and do not fail verify; only staging / I/O errors exit 3.
 *
 * Usage:
 *   node scripts/pipeline/run-verify.js --run-dir research-output/runs/run-123
 *
 * Exit code 3 = verify failure (per plan)
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');
const path = require('path');
const { execSync } = require('child_process');
const { program } = require('commander');
const { generateReport } = require('../evaluate-tests.js');

const RULES_PATH = path.join(__dirname, 'verify-rules.json');
const PLAN_CASE_RE = /\/\/\s*plan-case:\s*([a-zA-Z0-9_-]+)/g;
const projectRoot = path.resolve(__dirname, '..', '..');

function simpleGlobMatch(relPosix, pattern) {
  const p = pattern.replace(/\\/g, '/');
  if (p === '**/*.js') return relPosix.endsWith('.js');
  if (p === '**/*.jsx') return relPosix.endsWith('.jsx');
  if (p === '**/*.spec.js') return relPosix.endsWith('.spec.js');
  if (p === '**/*.spec.jsx') return relPosix.endsWith('.spec.jsx');
  if (p === '**/e2e/**/*.js') return relPosix.includes('/e2e/') && relPosix.endsWith('.js');
  const re = new RegExp(
    '^' +
      p
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '{{S}}')
        .replace(/\*/g, '[^/]*')
        .replace(/{{S}}/g, '.*') +
      '$'
  );
  return re.test(relPosix);
}

async function walkGeneratedFiles(rootDir, baseRel = '') {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const ent of entries) {
    const abs = path.join(rootDir, ent.name);
    const rel = path.posix.join(baseRel.replace(/\\/g, '/'), ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkGeneratedFiles(abs, rel)));
    } else if (/\.(js|jsx)$/.test(ent.name)) {
      out.push({ abs, rel });
    }
  }
  return out;
}

async function loadRules() {
  const raw = await fs.readFile(RULES_PATH, 'utf-8');
  return JSON.parse(raw);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `node --check` only accepts JS the Node parser understands; it rejects `.jsx`
 * (ERR_UNKNOWN_FILE_EXTENSION) and often fails on ESM `import` in files treated as CJS.
 * Client tests are validated by Jest (babel-jest) when `--run-tests` is used.
 * @param {string} relPosix
 */
function shouldSkipNodeSyntaxCheck(relPosix) {
  if (relPosix.endsWith('.jsx')) return true;
  if (relPosix.startsWith('client/') && relPosix.endsWith('.js')) return true;
  return false;
}

/**
 * Copy generated files into their repo-relative paths so test imports resolve.
 * Returns async cleanup function restoring previous contents.
 * @param {Array<{abs:string, rel:string}>} files
 */
async function stageGeneratedFilesForTests(files) {
  const staged = [];
  for (const { abs, rel } of files) {
    const relPosix = rel.replace(/\\/g, '/');
    const dest = path.join(projectRoot, relPosix);
    const existed = await pathExists(dest);
    const previous = existed ? await fs.readFile(dest, 'utf-8') : null;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(abs, dest);
    staged.push({ rel: relPosix, dest, existed, previous });
  }

  return async () => {
    for (const entry of staged.reverse()) {
      if (entry.existed) {
        await fs.writeFile(entry.dest, entry.previous, 'utf-8');
      } else {
        try {
          await fs.unlink(entry.dest);
        } catch {
          // best effort cleanup
        }
      }
    }
  };
}

function tail(s, maxLen) {
  if (!s || typeof s !== 'string') return '';
  return s.length <= maxLen ? s : s.slice(-maxLen);
}

/** Map manifest `test_level` to legacy evaluation `type` buckets. */
function mapTestLevelToType(level) {
  if (!level || typeof level !== 'string') return 'unknown';
  if (level.startsWith('unit_')) return 'unit';
  if (level.startsWith('integration_')) return 'integration';
  if (level === 'e2e') return 'e2e';
  return 'unknown';
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @returns {{ testCount: number, passCount: number, failCount: number, passes: boolean }}
 */
function metricsFromJestData(data) {
  const pass = typeof data.numPassedTests === 'number' ? data.numPassedTests : 0;
  const fail = typeof data.numFailedTests === 'number' ? data.numFailedTests : 0;
  const pending = typeof data.numPendingTests === 'number' ? data.numPendingTests : 0;
  const testCount = pass + fail + pending;
  const passes = data.success === true && fail === 0 && pending === 0 && (pass > 0 || testCount === 0);
  return { testCount, passCount: pass, failCount: fail + pending, passes };
}

/**
 * Flatten Jest JSON `testResults[*].assertionResults` into a slim per-test array.
 */
function assertionResultsFromJestData(data) {
  const out = [];
  const trs = Array.isArray(data && data.testResults) ? data.testResults : [];
  for (const tr of trs) {
    const ars = Array.isArray(tr.assertionResults) ? tr.assertionResults : [];
    for (const a of ars) {
      const ancestors = Array.isArray(a.ancestorTitles) ? a.ancestorTitles : [];
      const title = typeof a.title === 'string' ? a.title : '';
      const fullName =
        typeof a.fullName === 'string' && a.fullName.length
          ? a.fullName
          : [...ancestors, title].filter(Boolean).join(' ');
      out.push({
        fullName,
        title,
        ancestorTitles: ancestors,
        status: typeof a.status === 'string' ? a.status : 'unknown',
        failureMessages: Array.isArray(a.failureMessages) ? a.failureMessages : [],
        location: a.location || null,
      });
    }
  }
  return out;
}

/**
 * Run Jest with JSON output for one staged file; never throws (records failure in return value).
 * @returns {{ runs: boolean, passes: boolean, testCount: number, passCount: number, failCount: number, output: string, errorOutput: string }}
 */
function runJestOnStagedFile(destAbs, jestConfigAbs, runDir, logLines) {
  const outFile = path.join(runDir, `.jest-pipeline-${crypto.randomBytes(8).toString('hex')}.json`);
  const cfg = jestConfigAbs.replace(/"/g, '\\"');
  const out = outFile.replace(/"/g, '\\"');
  const testPath = destAbs.replace(/"/g, '\\"');
  const cmd = `npx jest --config "${cfg}" --json --outputFile "${out}" -- "${testPath}"`;

  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execSync(cmd, {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    stdout = (e.stdout && e.stdout.toString()) || '';
    stderr = (e.stderr && e.stderr.toString()) || '';
    if (!stderr && e.message) stderr = e.message;
    exitCode = typeof e.status === 'number' ? e.status : 1;
  }

  logLines.push(`[jest exit=${exitCode}] ${path.relative(projectRoot, destAbs)}`);
  logLines.push(tail(stdout, 4000));
  if (stderr) logLines.push(`stderr: ${tail(stderr, 2000)}`);

  try {
    if (fsSync.existsSync(outFile)) {
      const raw = fsSync.readFileSync(outFile, 'utf8');
      fsSync.unlinkSync(outFile);
      const data = JSON.parse(raw);
      const parsed = metricsFromJestData(data);
      return {
        runs: true,
        passes: parsed.passes,
        testCount: parsed.testCount,
        passCount: parsed.passCount,
        failCount: parsed.failCount,
        assertionResults: assertionResultsFromJestData(data),
        output: tail(stdout, 4000),
        errorOutput: tail(stderr, 4000),
      };
    }
  } catch (e) {
    logLines.push(`FAIL parse jest json: ${e.message}`);
    try {
      if (fsSync.existsSync(outFile)) fsSync.unlinkSync(outFile);
    } catch {
      /* ignore */
    }
  }

  // No output file: try stdout as JSON (some Jest versions)
  try {
    const data = JSON.parse(stdout);
    const parsed = metricsFromJestData(data);
    return {
      runs: true,
      passes: parsed.passes,
      testCount: parsed.testCount,
      passCount: parsed.passCount,
      failCount: parsed.failCount,
      assertionResults: assertionResultsFromJestData(data),
      output: tail(stdout, 4000),
      errorOutput: tail(stderr, 4000),
    };
  } catch {
    /* fall through */
  }

  return {
    runs: false,
    passes: false,
    testCount: 0,
    passCount: 0,
    failCount: 0,
    assertionResults: [],
    output: tail(stdout, 4000),
    errorOutput: tail(stderr || `jest exit ${exitCode}, no JSON output`, 4000),
  };
}

/**
 * Build per-file evaluation rows + run Jest (except e2e manifest: not executed here).
 */
/**
 * @param {Array<{abs:string, rel:string, dest:string}>} stagedFiles
 */
function collectJestResultsForStagedFiles(stagedFiles, evalType, runDir, logLines) {
  const rows = [];
  for (const f of stagedFiles) {
    const rel = f.rel.replace(/\\/g, '/');

    if (evalType === 'e2e') {
      rows.push({
        abs: f.abs,
        jest: {
          runs: false,
          passes: false,
          testCount: 0,
          passCount: 0,
          failCount: 0,
          assertionResults: [],
          output: '',
          errorOutput: 'e2e execution not supported in pipeline:verify yet',
        },
        rel,
      });
      logLines.push(`SKIP jest (e2e) ${rel}`);
      continue;
    }

    let jestResult;
    if (rel.startsWith('server/')) {
      jestResult = runJestOnStagedFile(f.dest, path.join(projectRoot, 'jest.config.js'), runDir, logLines);
    } else if (rel.startsWith('client/')) {
      jestResult = runJestOnStagedFile(
        f.dest,
        path.join(projectRoot, 'client', 'jest.config.js'),
        runDir,
        logLines
      );
    } else {
      jestResult = {
        runs: false,
        passes: false,
        testCount: 0,
        passCount: 0,
        failCount: 0,
        assertionResults: [],
        output: '',
        errorOutput: `No Jest profile for generated path prefix: ${rel} (expected server/ or client/)`,
      };
      logLines.push(`SKIP jest (unknown prefix) ${rel}`);
    }

    rows.push({ abs: f.abs, jest: jestResult, rel });
    if (jestResult.runs && jestResult.passes) logLines.push(`OK jest ${rel}`);
    else if (jestResult.runs) logLines.push(`WARN jest failures ${rel}`);
    else logLines.push(`FAIL jest did not produce JSON ${rel}`);
  }
  return rows;
}

function buildEvaluationRow(abs, rel, model, evalType, ttgSeconds, jestSummary) {
  const j = jestSummary;
  return {
    file: abs,
    model,
    type: evalType,
    testFileName: path.basename(rel),
    exists: true,
    syntaxValid: true,
    runs: j.runs,
    passes: j.passes,
    errors: [],
    testCount: j.testCount,
    passCount: j.passCount,
    failCount: j.failCount,
    coverage: null,
    coverageDelta: null,
    coverageBaseline: null,
    coverageGenerated: null,
    coverageWithTest: null,
    coverageSourceFile: null,
    logPath: null,
    rootCause: null,
    ttgSeconds,
    flaky: false,
    flakyFailureCount: 0,
    totalRunCount: 1,
    output: j.output,
    errorOutput: j.errorOutput,
  };
}

function extractPlanCaseIdsFromText(text) {
  const found = new Set();
  let m;
  const re = new RegExp(PLAN_CASE_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return found;
}

async function loadRequirePlanCaseComments(runDir) {
  const genMetaPath = path.join(runDir, 'generate.meta.json');
  try {
    const raw = await fs.readFile(genMetaPath, 'utf-8');
    const meta = JSON.parse(raw);
    if (typeof meta.require_plan_case_comments === 'boolean') {
      return meta.require_plan_case_comments;
    }
  } catch {
    /* ignore */
  }
  const planMetaPath = path.join(runDir, 'plan.meta.json');
  try {
    const raw = await fs.readFile(planMetaPath, 'utf-8');
    const meta = JSON.parse(raw);
    if (meta.resolved_generation && typeof meta.resolved_generation.require_plan_case_comments === 'boolean') {
      return meta.resolved_generation.require_plan_case_comments;
    }
  } catch {
    /* ignore */
  }
  return true;
}

async function main() {
  program
    .requiredOption('--run-dir <path>', 'Run directory containing generated/')
    .option(
      '--run-tests',
      'Stage generated tests, run Jest (JSON), write evaluation-report.json (assertion failures do not fail verify)'
    )
    .parse();

  const runDir = path.resolve(program.opts().runDir);
  const genRoot = path.join(runDir, 'generated');
  const logLines = [];

  const files = await walkGeneratedFiles(genRoot);
  if (files.length === 0) {
    logLines.push(`No .js/.jsx files under ${genRoot}`);
    await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
    console.error('Verify failed: no generated JS files found.');
    process.exit(3);
  }

  let combinedContent = '';
  for (const { abs, rel } of files) {
    const relPosix = rel.replace(/\\/g, '/');
    if (shouldSkipNodeSyntaxCheck(relPosix)) {
      logLines.push(`SKIP node --check ${rel} (client/jsx: use Jest when --run-tests)`);
    } else {
      try {
        execSync(`node --check "${abs}"`, { stdio: 'pipe' });
        logLines.push(`OK node --check ${rel}`);
      } catch (e) {
        logLines.push(`FAIL node --check ${rel}: ${e.stderr?.toString() || e.message}`);
        await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
        console.error(`Syntax check failed: ${rel}`);
        process.exit(3);
      }
    }
    combinedContent += (await fs.readFile(abs, 'utf-8')) + '\n';
  }

  const rules = await loadRules();
  const forbidden = rules.forbidden || [];
  for (const { abs, rel } of files) {
    const content = await fs.readFile(abs, 'utf-8');
    const relPosix = rel.replace(/\\/g, '/');
    for (const rule of forbidden) {
      const globs = rule.globs || ['**/*.js'];
      if (!globs.some((g) => simpleGlobMatch(relPosix, g))) continue;
      const re = new RegExp(rule.pattern, 'm');
      if (re.test(content)) {
        logLines.push(`FAIL ${rule.id} in ${rel}: ${rule.message}`);
        await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
        console.error(`${rule.message} (${rule.id}) in ${rel}`);
        process.exit(3);
      }
    }
    logLines.push(`OK forbidden-scan ${rel}`);
  }

  const planPath = path.join(runDir, 'test_plan.json');
  let plan;
  try {
    plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
  } catch (e) {
    logLines.push(`FAIL read test_plan.json: ${e.message}`);
    await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
    console.error('Verify failed: test_plan.json missing or invalid.');
    process.exit(3);
  }

  const planIds = new Set((plan.cases || []).map((c) => c.id).filter(Boolean));
  const foundInCode = extractPlanCaseIdsFromText(combinedContent);
  const requireComments = await loadRequirePlanCaseComments(runDir);

  const unknown = [...foundInCode].filter((id) => !planIds.has(id));
  if (unknown.length) {
    logLines.push(`FAIL plan-case unknown ids: ${unknown.join(', ')}`);
    await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
    console.error(`Unknown plan-case id(s): ${unknown.join(', ')}`);
    process.exit(3);
  }
  logLines.push('OK plan-case: no unknown ids');

  if (requireComments) {
    const missing = [...planIds].filter((id) => !foundInCode.has(id));
    if (missing.length) {
      logLines.push(`FAIL plan-case-coverage: missing ${missing.join(', ')}`);
      await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
      console.error(`plan-case coverage: missing [${missing.join(', ')}]`);
      process.exit(3);
    }
    logLines.push(`OK plan-case-coverage: ${planIds.size}/${planIds.size}`);
  } else {
    logLines.push('SKIP plan-case-coverage (require_plan_case_comments=false)');
  }

  if (program.opts().runTests) {
    const manifest = (await readJsonIfExists(path.join(runDir, 'context_manifest.json'), {})) || {};
    const planMeta = (await readJsonIfExists(path.join(runDir, 'plan.meta.json'), {})) || {};
    const genMeta = (await readJsonIfExists(path.join(runDir, 'generate.meta.json'), {})) || {};

    const evalType = mapTestLevelToType(manifest.test_level);
    const model = genMeta.model || planMeta.model || 'unknown';
    const ttgSeconds =
      (typeof planMeta.seconds === 'number' ? planMeta.seconds : 0) +
      (typeof genMeta.seconds === 'number' ? genMeta.seconds : 0);

    let cleanup = null;
    try {
      cleanup = await stageGeneratedFilesForTests(files);
      const stagedFiles = files.map((f) => ({
        abs: f.abs,
        rel: f.rel.replace(/\\/g, '/'),
        dest: path.join(projectRoot, f.rel.replace(/\\/g, '/')),
      }));
      const jestRows = collectJestResultsForStagedFiles(stagedFiles, evalType, runDir, logLines);
      const results = jestRows.map((r) => buildEvaluationRow(r.abs, r.rel, model, evalType, ttgSeconds, r.jest));
      const report = generateReport(results);
      await fs.writeFile(path.join(runDir, 'evaluation-report.json'), JSON.stringify(report, null, 2), 'utf-8');

      const perTestRows = jestRows.map((r) => ({
        rel: r.rel,
        runs: r.jest.runs === true,
        passes: r.jest.passes === true,
        testCount: typeof r.jest.testCount === 'number' ? r.jest.testCount : 0,
        passCount: typeof r.jest.passCount === 'number' ? r.jest.passCount : 0,
        failCount: typeof r.jest.failCount === 'number' ? r.jest.failCount : 0,
        assertionResults: Array.isArray(r.jest.assertionResults) ? r.jest.assertionResults : [],
      }));
      await fs.writeFile(
        path.join(runDir, 'jest-results.json'),
        JSON.stringify(perTestRows, null, 2),
        'utf-8'
      );
      const s = report.summary;
      logLines.push(
        `OK evaluation-report: files ${s.passes}/${s.total} tests=${s.totalPassed}/${s.totalTests} avgTTG=${
          s.ttgSecondsAvg != null && Number.isFinite(s.ttgSecondsAvg) ? s.ttgSecondsAvg.toFixed(2) : 'n/a'
        }s`
      );
      logLines.push(
        'OK generated test execution (evaluation-report.json; jest assertion failures do not fail verify)'
      );
    } catch (e) {
      logLines.push(`FAIL staging or evaluation-report: ${e.message}`);
      await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
      console.error(e);
      process.exit(3);
    } finally {
      if (cleanup) await cleanup();
    }
  }

  await fs.writeFile(path.join(runDir, 'verify.log'), logLines.join('\n'), 'utf-8');
  console.log(`Verify passed (${files.length} files). Log: ${path.join(runDir, 'verify.log')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
