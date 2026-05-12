#!/usr/bin/env node
/**
 * Runs flaky-rate-probe.spec.js three times (same outer repeat pattern as run-verify e2e),
 * aggregates with aggregateE2ePipelineRuns + generateReport, prints summary.flaky* metrics.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { summarizePlaywrightJsonReport, aggregateE2ePipelineRuns } = require('./pipeline/playwright-report-for-pipeline.js');
const { generateReport } = require('./evaluate-tests.js');

const projectRoot = path.join(__dirname, '..');
const specRel = 'tests/e2e/flaky-rate-probe.spec.js';
const counterPath = path.join(os.tmpdir(), 'nir3-e2e-flaky-rate-probe.txt');

try {
  fs.unlinkSync(counterPath);
} catch {
  /* ignore */
}

const relEsc = specRel.replace(/"/g, '\\"');
const cmd = `npx playwright test "${relEsc}" --reporter=json --project=chromium --retries=0`;

const runResults = [];
for (let i = 0; i < 3; i++) {
  let stdout = '';
  try {
    stdout = execSync(cmd, {
      encoding: 'utf8',
      cwd: projectRoot,
      env: { ...process.env, FLAKY_RATE_PROBE: '1' },
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (e) {
    stdout = (e.stdout && e.stdout.toString()) || '';
    if (!stdout) {
      console.error(e.stderr?.toString() || e.message);
      process.exit(1);
    }
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch (err) {
    console.error('Failed to parse Playwright JSON report:', err.message);
    process.exit(1);
  }

  const s = summarizePlaywrightJsonReport(data);
  runResults.push({
    runs: s.runs,
    passes: s.passes,
    testCount: s.testCount,
    passCount: s.passCount,
    failCount: s.failCount,
    assertionResults: s.assertionResults,
  });
}

const agg = aggregateE2ePipelineRuns(runResults, 3);
const row = {
  file: path.join(projectRoot, specRel),
  model: 'probe',
  type: 'e2e',
  testFileName: path.basename(specRel),
  exists: true,
  syntaxValid: true,
  runs: agg.runs,
  passes: agg.passes,
  errors: Array.isArray(agg.errors) ? agg.errors : [],
  testCount: agg.testCount,
  passCount: agg.passCount,
  failCount: agg.failCount,
  coverage: null,
  coverageDelta: null,
  coverageBaseline: null,
  coverageGenerated: null,
  coverageWithTest: null,
  coverageSourceFile: null,
  logPath: null,
  rootCause: null,
  ttgSeconds: 0,
  flaky: agg.flaky,
  flakyFailureCount: agg.flakyFailureCount,
  repeatRunFailureSum: agg.repeatRunFailureSum,
  totalRunCount: agg.totalRunCount,
  output: agg.output || '',
  errorOutput: agg.errorOutput || '',
};

const report = generateReport([row]);
const { summary } = report;
console.log('Aggregated flaky metrics (single spec, 3 outer runs):');
console.log(
  JSON.stringify(
    {
      flakyFiles: summary.flakyFiles,
      flakyFailures: summary.flakyFailures,
      repeatRunFailures: summary.repeatRunFailures,
      flakyTestRate: summary.flakyTestRate,
      totalTestRuns: summary.totalTestRuns,
      flakyMultiRunEvaluation: summary.flakyMultiRunEvaluation,
      repeatRuns: summary.repeatRuns,
      passes: summary.passes,
    },
    null,
    2
  )
);
