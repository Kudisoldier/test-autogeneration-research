const {
  generateReport,
  FLAKY_RUNS,
  inferRepeatRunsFromDetailResults,
  inferFlakyMultiRunEvaluation,
} = require('../../evaluate-tests.js');

function detailRow(overrides = {}) {
  return {
    file: '/repo/tests/e2e/x.spec.js',
    model: 'm',
    type: 'e2e',
    exists: true,
    syntaxValid: true,
    runs: true,
    passes: true,
    errors: [],
    testCount: 7,
    passCount: 7,
    failCount: 0,
    flaky: false,
    flakyFailureCount: 0,
    totalRunCount: 1,
    ttgSeconds: 1.2,
    ...overrides,
  };
}

describe('generateReport repeatRuns / flaky metrics', () => {
  it('uses repeatRuns 1 when all detail rows have totalRunCount 1 (pipeline verify)', () => {
    const report = generateReport([detailRow(), detailRow({ file: '/other.spec.js' })]);
    expect(report.summary.repeatRuns).toBe(1);
    expect(report.summary.flakyMultiRunEvaluation).toBe(false);
    expect(report.summary.flakyTestRate).toBe(0);
    expect(report.summary.totalTestRuns).toBe(14);
  });

  it('uses max totalRunCount when all rows define it', () => {
    const report = generateReport([
      detailRow({ totalRunCount: 1, type: 'unit' }),
      detailRow({ totalRunCount: 3, file: '/b.test.js', type: 'unit' }),
    ]);
    expect(report.summary.repeatRuns).toBe(3);
    expect(report.summary.flakyMultiRunEvaluation).toBe(true);
  });

  it('falls back to FLAKY_RUNS when any row omits totalRunCount', () => {
    const legacy = detailRow();
    delete legacy.totalRunCount;
    const report = generateReport([legacy]);
    expect(report.summary.repeatRuns).toBe(FLAKY_RUNS);
    expect(inferRepeatRunsFromDetailResults([legacy])).toBe(FLAKY_RUNS);
    expect(inferFlakyMultiRunEvaluation([legacy])).toBe(false);
  });

  it('marks flaky multi-run when all rows have totalRunCount > 1', () => {
    expect(inferFlakyMultiRunEvaluation([detailRow({ totalRunCount: 3 })])).toBe(true);
    expect(inferFlakyMultiRunEvaluation([detailRow({ totalRunCount: 1 })])).toBe(false);
  });
});
