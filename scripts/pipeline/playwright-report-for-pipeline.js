'use strict';

/**
 * Map Playwright JSON reporter output to the same shape as `runJestOnStagedFile`
 * so verify can feed `evaluation-report.json` / `jest-results.json` / coverage matrix.
 */

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
  walkPlaywrightSuite,
  looksLikeSpecFilename,
  mapPlaywrightOutcomeToJestLike,
};
