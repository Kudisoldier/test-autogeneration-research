#!/usr/bin/env node
/**
 * Stage 4: report — run-dir artifacts (plan, generated test, jest-results, manifest)
 * -> human-readable `report.md` written by an LLM via OpenRouter.
 *
 * Usage:
 *   node scripts/pipeline/run-report.js --run-dir research-output/runs/run-123 \
 *     --model qwen/qwen-2.5-7b-instruct:free
 *
 * Exit codes: 1 usage / API error, 2 missing inputs.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const {
  buildContextBundle,
  validateManifest,
  validatePlan,
} = require('./build-context.js');
const {
  parsePlanCaseAssignments,
  buildCoverageMatrix,
  buildReporterUserContent,
} = require('./build-report-context.js');
const { resolveGenerationConfig, cliFlagsFromOpts } = require('./config.js');
const openrouterClient = require('../openrouter-client.js');

const projectRoot = path.resolve(__dirname, '..', '..');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

async function loadReporterSystem() {
  const p = path.join(PROMPTS_DIR, 'reporter.system.md');
  return fs.readFile(p, 'utf-8');
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function readJsonOptional(filePath, fallback = null) {
  try {
    return await readJson(filePath);
  } catch {
    return fallback;
  }
}

function stripMarkdownFence(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(?:markdown|md)?\s*\n?/i, '');
  t = t.replace(/\n?```\s*$/i, '');
  return t.trim();
}

/**
 * Programmatic entry point. Returns `{ reportPath, metaPath, totals, seconds }`.
 * Throws an Error on failure (caller maps to exit code).
 *
 * @param {object} opts
 * @param {string} opts.runDir absolute path
 * @param {string} opts.model OpenRouter model id
 * @param {string} [opts.preset]
 * @param {number} [opts.reporterTemperature]
 * @param {number} [opts.reporterTopP]
 * @param {number} [opts.reporterMaxTokens]
 */
async function runReport(opts) {
  const runDir = path.resolve(opts.runDir);

  const manifestPath = path.join(runDir, 'context_manifest.json');
  const planPath = path.join(runDir, 'test_plan.json');
  const jestResultsPath = path.join(runDir, 'jest-results.json');
  const planMetaPath = path.join(runDir, 'plan.meta.json');
  const generateMetaPath = path.join(runDir, 'generate.meta.json');
  const evaluationReportPath = path.join(runDir, 'evaluation-report.json');

  const manifest = await readJson(manifestPath);
  const plan = await readJson(planPath);

  const mErr = validateManifest(manifest);
  if (mErr.length) {
    throw new Error(`Manifest validation failed: ${mErr.join('; ')}`);
  }
  const pErr = validatePlan(plan);
  if (pErr.length) {
    throw new Error(`Plan validation failed: ${pErr.join('; ')}`);
  }

  const jestRows = (await readJsonOptional(jestResultsPath, [])) || [];
  const planMeta = (await readJsonOptional(planMetaPath, {})) || {};
  const generateMeta = (await readJsonOptional(generateMetaPath, {})) || {};
  const evaluationReport = await readJsonOptional(evaluationReportPath, null);

  const resolved = resolveGenerationConfig(manifest, cliFlagsFromOpts(opts), 'report');

  const testFileRel = manifest.output_policy.primary_test_file.replace(/\\/g, '/');
  const generatedTestPath = path.join(runDir, 'generated', testFileRel);
  const testFileContent = await fs.readFile(generatedTestPath, 'utf-8');

  const parseResult = parsePlanCaseAssignments(testFileContent);
  const { coverageMatrix, totals } = buildCoverageMatrix(plan, jestRows, parseResult);

  let codeContextBundle = '';
  try {
    codeContextBundle = await buildContextBundle(projectRoot, manifest, 'generator');
  } catch (e) {
    console.warn(`Reporter: code context bundle unavailable: ${e.message}`);
  }

  const runMeta = {
    run_dir: runDir,
    test_level: manifest.test_level,
    target: manifest.target,
    plan_model: planMeta.model || null,
    generator_model: generateMeta.model || null,
    plan_seconds: typeof planMeta.seconds === 'number' ? planMeta.seconds : null,
    generate_seconds: typeof generateMeta.seconds === 'number' ? generateMeta.seconds : null,
    evaluation_summary: evaluationReport && evaluationReport.summary ? evaluationReport.summary : null,
  };

  const userContent = buildReporterUserContent({
    runMeta,
    plan,
    coverageMatrix,
    totals,
    testFileRel,
    testFileContent,
    jestRows,
    codeContextBundle,
  });

  const systemPrompt = await loadReporterSystem();

  const startedAt = Date.now();
  const raw = await openrouterClient.generateTestWithRetry(
    opts.model,
    userContent,
    {
      systemPrompt,
      temperature: resolved.reporter.temperature,
      topP: resolved.reporter.top_p,
      maxTokens: resolved.reporter.max_tokens,
    },
    3
  );

  const reportMd = stripMarkdownFence(raw || '').trim();
  if (!reportMd) {
    throw new Error('Reporter returned empty content.');
  }

  const reportPath = path.join(runDir, 'report.md');
  await fs.writeFile(reportPath, reportMd + '\n', 'utf-8');

  const seconds = (Date.now() - startedAt) / 1000;
  const meta = {
    stage: 'report',
    model: opts.model,
    run_dir: runDir,
    output_file: reportPath,
    seconds,
    generatedAt: new Date().toISOString(),
    resolved_generation: resolved,
    coverage_totals: totals,
  };
  const metaPath = path.join(runDir, 'report.meta.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  return { reportPath, metaPath, totals, seconds };
}

async function main() {
  program
    .requiredOption('--run-dir <path>', 'Run directory containing pipeline artifacts')
    .requiredOption('--model <id>', 'OpenRouter model id for the reporter')
    .option('--preset <name>', 'strict | balanced | exploratory')
    .option('--reporter-temperature <n>', 'Override reporter temperature', parseFloat)
    .option('--reporter-top-p <n>', 'Override reporter top_p', parseFloat)
    .option('--reporter-max-tokens <n>', 'Override reporter max_tokens', (v) => parseInt(v, 10))
    .parse();

  const opts = program.opts();

  try {
    const { reportPath } = await runReport(opts);
    console.log(`Wrote: ${reportPath}`);
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      console.error(`Reporter input missing: ${e.message}`);
      process.exit(2);
    }
    if (e && /validation failed/i.test(e.message)) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(`Reporter error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runReport };
