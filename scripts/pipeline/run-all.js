#!/usr/bin/env node
/**
 * Run plan → generate → verify in sequence.
 *
 * Usage:
 *   node scripts/pipeline/run-all.js --manifest specs/pipeline/examples/unit_ui.manifest.json --model qwen/qwen-2.5-7b-instruct:free
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const { program } = require('commander');

const repoRoot = path.resolve(__dirname, '..', '..');

function parseRunDir(planStdout) {
  const m = planStdout.match(/Run directory:\s*(.+)/);
  if (!m) return null;
  return m[1].trim();
}

function escapeArg(s) {
  return JSON.stringify(s);
}

/** Research / stress mode: skip verify+report; generator sees PIPELINE_E2E_FLAKY_RESEARCH for flaky-biased e2e. */
function e2eFlakyResearchEnabled(opts) {
  if (opts.e2eFlakyResearch) return true;
  const v = String(process.env.PIPELINE_E2E_FLAKY_RESEARCH || '')
    .toLowerCase()
    .trim();
  return v === '1' || v === 'true' || v === 'yes';
}

async function main() {
  program
    .requiredOption('--manifest <path>', 'context_manifest.json path')
    .requiredOption('--model <id>', 'OpenRouter model id')
    .option('--run-id <id>', 'Optional run folder name under research-output/runs/')
    .option('--preset <name>', 'strict | balanced | exploratory')
    .option('--planner-temperature <n>', undefined, parseFloat)
    .option('--planner-top-p <n>', undefined, parseFloat)
    .option('--planner-max-tokens <n>', (v) => parseInt(v, 10))
    .option('--generator-temperature <n>', undefined, parseFloat)
    .option('--generator-top-p <n>', undefined, parseFloat)
    .option('--generator-max-tokens <n>', (v) => parseInt(v, 10))
    .option('--reporter-model <id>', 'OpenRouter model id for reporter (defaults to --model)')
    .option('--reporter-temperature <n>', undefined, parseFloat)
    .option('--reporter-top-p <n>', undefined, parseFloat)
    .option('--reporter-max-tokens <n>', (v) => parseInt(v, 10))
    .option('--no-json-mode', 'Pass through to planner')
    .option('--selector-policy <p>', 'auto | data-testid | role-first | none')
    .option('--no-plan-markdown', 'Pass to planner')
    .option('--no-plan-case-comments', 'Pass to planner and generator')
    .option('--run-tests', 'Pass to verify stage')
    .option('--no-report', 'Skip the reporter stage even when --run-tests is set')
    .option(
      '--e2e-flaky-research',
      'Skip verify and report; set PIPELINE_E2E_FLAKY_RESEARCH=1 for generate (e2e flaky-timing research only; not merge gates)'
    )
    .parse();

  const o = program.opts();
  const extraRunId = o.runId ? ` --run-id ${escapeArg(o.runId)}` : '';
  const noJson = o.noJsonMode ? ' --no-json-mode' : '';
  const preset = o.preset ? ` --preset ${escapeArg(o.preset)}` : '';
  const pt = o.plannerTemperature != null ? ` --planner-temperature ${o.plannerTemperature}` : '';
  const ptp = o.plannerTopP != null ? ` --planner-top-p ${o.plannerTopP}` : '';
  const pmt = o.plannerMaxTokens != null ? ` --planner-max-tokens ${o.plannerMaxTokens}` : '';
  const gt = o.generatorTemperature != null ? ` --generator-temperature ${o.generatorTemperature}` : '';
  const gtp = o.generatorTopP != null ? ` --generator-top-p ${o.generatorTopP}` : '';
  const gmt = o.generatorMaxTokens != null ? ` --generator-max-tokens ${o.generatorMaxTokens}` : '';
  const sel = o.selectorPolicy ? ` --selector-policy ${escapeArg(o.selectorPolicy)}` : '';
  const noMd = o.noPlanMarkdown ? ' --no-plan-markdown' : '';
  const noPc = o.noPlanCaseComments ? ' --no-plan-case-comments' : '';

  const planCmd = `node scripts/pipeline/run-plan.js --manifest ${escapeArg(o.manifest)} --model ${escapeArg(o.model)}${extraRunId}${noJson}${preset}${pt}${ptp}${pmt}${sel}${noMd}${noPc}`;
  const planStdout = execSync(planCmd, { cwd: repoRoot, encoding: 'utf-8' });
  console.log(planStdout);

  const runDir = parseRunDir(planStdout);
  if (!runDir) {
    console.error('Could not parse Run directory from planner output.');
    process.exit(1);
  }

  const flakyResearch = e2eFlakyResearchEnabled(o);
  const genEnv = flakyResearch ? { ...process.env, PIPELINE_E2E_FLAKY_RESEARCH: '1' } : process.env;

  const genCmd = `node scripts/pipeline/run-generate.js --run-dir ${escapeArg(runDir)} --model ${escapeArg(o.model)}${preset}${gt}${gtp}${gmt}${sel}${noPc}`;
  execSync(genCmd, { cwd: repoRoot, stdio: 'inherit', env: genEnv });

  if (flakyResearch) {
    const verifyLogPath = path.join(repoRoot, runDir, 'verify.log');
    fs.mkdirSync(path.dirname(verifyLogPath), { recursive: true });
    fs.writeFileSync(
      verifyLogPath,
      'SKIP verify (--e2e-flaky-research / PIPELINE_E2E_FLAKY_RESEARCH)\n',
      'utf-8'
    );
    console.log('\n[pipeline] SKIP verify + report (e2e flaky research mode)\n');
  } else {
    const verifyArgs = o.runTests ? ' --run-tests' : '';
    execSync(`node scripts/pipeline/run-verify.js --run-dir ${escapeArg(runDir)}${verifyArgs}`, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
  }

  const shouldReport = o.runTests && o.report !== false && !flakyResearch;
  if (shouldReport) {
    const reporterModel = o.reporterModel || o.model;
    const rt = o.reporterTemperature != null ? ` --reporter-temperature ${o.reporterTemperature}` : '';
    const rtp = o.reporterTopP != null ? ` --reporter-top-p ${o.reporterTopP}` : '';
    const rmt = o.reporterMaxTokens != null ? ` --reporter-max-tokens ${o.reporterMaxTokens}` : '';
    const reportCmd = `node scripts/pipeline/run-report.js --run-dir ${escapeArg(runDir)} --model ${escapeArg(reporterModel)}${preset}${rt}${rtp}${rmt}`;
    execSync(reportCmd, { cwd: repoRoot, stdio: 'inherit', env: process.env });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
