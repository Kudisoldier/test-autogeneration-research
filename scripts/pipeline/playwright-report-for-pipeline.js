'use strict';

/**
 * Map Playwright JSON reporter output to the same shape as `runJestOnStagedFile`
 * so verify can feed `evaluation-report.json` / `jest-results.json` / coverage matrix.
 *
 * `aggregateE2ePipelineRuns` merges N single-run summaries using the same rules as
 * `evaluateTestFile` in `evaluate-tests.js` (signature variance → flaky, FTR numerator).
 */

function tail(s, maxLen) {
  if (!s || typeof s !== 'string') return '';
  return s.length <= maxLen ? s : s.slice(-maxLen);
}

/**
 * @param {Array<object>} runResults same shape as single-run playwright summary + coverage nulls
 * @param {number} repeatRuns attempted outer runs (e.g. 3)
 * @returns {object} jest-compatible summary including flaky, flakyFailureCount, totalRunCount, errors
 */
function aggregateE2ePipelineRuns(runResults, repeatRuns) {
  const runsN = Math.max(1, Number(repeatRuns) || 1);
  const history = (Array.isArray(runResults) ? runResults : []).map((r) => ({
    runs: !!r.runs,
    passes: !!r.passes,
    testCount: Number.isFinite(r.testCount) ? r.testCount : 0,
    passCount: Number.isFinite(r.passCount) ? r.passCount : 0,
    failCount: Number.isFinite(r.failCount) ? r.failCount : 0,
  }));

  const signatures = new Set(
    history.map((h) =>
      JSON.stringify({ runs: h.runs, passes: h.passes, passCount: h.passCount, failCount: h.failCount })
    )
  );
  const flaky = signatures.size > 1;

  const ranHistory = history.filter((h) => h.runs);
  let testCount = 0;
  let passCount = 0;
  let failCount = 0;
  if (ranHistory.length > 0) {
    testCount = Math.max(...ranHistory.map((h) => h.testCount));
    passCount = Math.min(...ranHistory.map((h) => h.passCount));
    failCount = Math.max(...ranHistory.map((h) => h.failCount));
  }

  const runs = ranHistory.length > 0;
  const passes = ranHistory.length === runsN && ranHistory.every((h) => h.passes);

  const flakyFailureCount = flaky
    ? history.reduce((sum, h) => sum + (Number.isFinite(h.failCount) ? h.failCount : 0), 0)
    : 0;

  const errors = [];
  if (flaky) {
    const passCountsText = history.map((h) => (h.runs ? h.passCount : 'NR')).join(', ');
    errors.push(`Flaky (runs=${runsN}): passed counts per run = [${passCountsText}]`);
  }

  let assertionResults = [];
  for (let i = runResults.length - 1; i >= 0; i--) {
    const r = runResults[i];
    if (r && r.runs && Array.isArray(r.assertionResults)) {
      assertionResults = r.assertionResults;
      break;
    }
  }

  const output = (Array.isArray(runResults) ? runResults : [])
    .map((r, i) => `--- playwright run ${i + 1}/${runsN} ---\n${r && r.output ? r.output : ''}`)
    .join('\n');
  const errorOutput = (Array.isArray(runResults) ? runResults : [])
    .map((r, i) => `--- run ${i + 1} ---\n${r && r.errorOutput ? r.errorOutput : ''}`)
    .join('\n');

  return {
    runs,
    passes,
    testCount,
    passCount,
    failCount,
    coverageGenerated: null,
    coverageWithTest: null,
    coverageBaseline: null,
    coverageDelta: null,
    coverageSourceFile: null,
    assertionResults,
    output: tail(output, 8000),
    errorOutput: tail(errorOutput, 8000),
    flaky,
    flakyFailureCount,
    totalRunCount: runsN,
    errors,
  };
}

function looksLikeSpecFilename(title) {
  if (!title || typeof title !== 'string') return false;
  return /\.(spec|test)\.[cm]?[jt]sx?$/i.test(title.trim());
}

/**
 * @param {object} suite
 * @param {string[]} describePath
 * @param {(fullName: string, title: string, ancestorTitles: string[], test: object) => void} onTest
 */
function walkPlaywrightSuite(suite, describePath, onTest) {
  const skipTitle = looksLikeSpecFilename(suite.title);
  const path =
    !suite.title || skipTitle ? describePath : [...describePath, String(suite.title).trim()];
  for (const spec of suite.specs || []) {
    const specTitle = typeof spec.title === 'string' ? spec.title.trim() : '';
    const fullName = [...path, specTitle]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (const t of spec.tests || []) {
      onTest(fullName, specTitle, path, t);
    }
  }
  for (const child of suite.suites || []) {
    walkPlaywrightSuite(child, path, onTest);
  }
}

/**
 * @param {string} outcome Playwright JSONReportTest.status
 * @returns {'passed'|'failed'|'skipped'}
 */
function mapPlaywrightOutcomeToJestLike(outcome) {
  if (outcome === 'expected' || outcome === 'flaky') return 'passed';
  if (outcome === 'skipped') return 'skipped';
  if (outcome === 'unexpected') return 'failed';
  return 'failed';
}

/**
 * @param {object} test JSONReportTest
 * @returns {string[]}
 */
function failureMessagesFromPlaywrightTest(test) {
  const msgs = [];
  const results = Array.isArray(test && test.results) ? test.results : [];
  for (const r of results) {
    const errors = Array.isArray(r.errors) ? r.errors : [];
    for (const e of errors) {
      if (typeof e === 'string') msgs.push(e);
      else if (e && typeof e.message === 'string') msgs.push(e.message);
      else if (e && typeof e.text === 'string') msgs.push(e.text);
    }
    if (r.error && typeof r.error.message === 'string') msgs.push(r.error.message);
  }
  return msgs;
}

/**
 * @param {object} data parsed Playwright JSON report
 * @returns {{
 *   runs: boolean,
 *   passes: boolean,
 *   testCount: number,
 *   passCount: number,
 *   failCount: number,
 *   assertionResults: Array<object>,
 * }}
 */
function summarizePlaywrightJsonReport(data) {
  const assertionResults = [];
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  const suites = Array.isArray(data && data.suites) ? data.suites : [];
  for (const root of suites) {
    walkPlaywrightSuite(root, [], (fullName, title, ancestorTitles, test) => {
      const outcome = typeof test.status === 'string' ? test.status : '';
      const mapped = mapPlaywrightOutcomeToJestLike(outcome);
      if (mapped === 'passed') passCount += 1;
      else if (mapped === 'skipped') skipCount += 1;
      else failCount += 1;

      assertionResults.push({
        fullName,
        title,
        ancestorTitles: [...ancestorTitles],
        status: mapped === 'passed' ? 'passed' : mapped === 'skipped' ? 'skipped' : 'failed',
        failureMessages: mapped === 'failed' ? failureMessagesFromPlaywrightTest(test) : [],
        location: null,
      });
    });
  }

  const testCount = passCount + failCount + skipCount;
  const passes = failCount === 0 && skipCount === 0 && (passCount > 0 || testCount === 0);

  return {
    runs: true,
    passes,
    testCount,
    passCount,
    failCount: failCount + skipCount,
    assertionResults,
  };
}

module.exports = {
  summarizePlaywrightJsonReport,
  aggregateE2ePipelineRuns,
  walkPlaywrightSuite,
  looksLikeSpecFilename,
  mapPlaywrightOutcomeToJestLike,
};
