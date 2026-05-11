const {
  summarizePlaywrightJsonReport,
  aggregateE2ePipelineRuns,
  looksLikeSpecFilename,
} = require('../playwright-report-for-pipeline.js');

describe('playwright-report-for-pipeline', () => {
  it('skips file-suite title when building fullName (matches plan-case parser)', () => {
    const data = {
      suites: [
        {
          title: '_probe.spec.js',
          file: '_probe.spec.js',
          specs: [],
          suites: [
            {
              title: 'Outer describe',
              file: '_probe.spec.js',
              line: 3,
              column: 6,
              specs: [
                {
                  title: 'inner test',
                  ok: true,
                  tags: [],
                  tests: [
                    {
                      timeout: 30000,
                      annotations: [],
                      expectedStatus: 'passed',
                      projectId: 'chromium',
                      projectName: 'chromium',
                      results: [{ status: 'passed', duration: 1, errors: [] }],
                      status: 'expected',
                    },
                  ],
                  id: 'x',
                  file: '_probe.spec.js',
                  line: 4,
                  column: 7,
                },
              ],
            },
          ],
        },
      ],
    };

    const s = summarizePlaywrightJsonReport(data);
    expect(s.runs).toBe(true);
    expect(s.passes).toBe(true);
    expect(s.testCount).toBe(1);
    expect(s.passCount).toBe(1);
    expect(s.failCount).toBe(0);
    expect(s.assertionResults).toHaveLength(1);
    expect(s.assertionResults[0].fullName).toBe('Outer describe inner test');
    expect(s.assertionResults[0].status).toBe('passed');
  });

  it('marks unexpected outcome as failed with messages', () => {
    const data = {
      suites: [
        {
          title: 'f.spec.js',
          file: 'f.spec.js',
          specs: [
            {
              title: 'bad',
              ok: false,
              tags: [],
              tests: [
                {
                  timeout: 30000,
                  annotations: [],
                  expectedStatus: 'passed',
                  projectId: 'chromium',
                  projectName: 'chromium',
                  results: [
                    {
                      status: 'failed',
                      duration: 1,
                      errors: [{ message: 'expect(received).toBe(expected)' }],
                    },
                  ],
                  status: 'unexpected',
                },
              ],
              id: 'y',
              file: 'f.spec.js',
              line: 1,
              column: 1,
            },
          ],
        },
      ],
    };

    const s = summarizePlaywrightJsonReport(data);
    expect(s.passes).toBe(false);
    expect(s.failCount).toBeGreaterThan(0);
    expect(s.assertionResults[0].status).toBe('failed');
    expect(s.assertionResults[0].failureMessages.length).toBeGreaterThan(0);
  });

  it('detects spec-like suite titles', () => {
    expect(looksLikeSpecFilename('foo.spec.js')).toBe(true);
    expect(looksLikeSpecFilename('foo.spec.ts')).toBe(true);
    expect(looksLikeSpecFilename('Outer describe')).toBe(false);
  });
});

describe('aggregateE2ePipelineRuns', () => {
  it('flags flaky when outcomes differ across runs', () => {
    const agg = aggregateE2ePipelineRuns(
      [
        { runs: true, passes: false, testCount: 2, passCount: 1, failCount: 1, assertionResults: [] },
        { runs: true, passes: true, testCount: 2, passCount: 2, failCount: 0, assertionResults: [] },
        { runs: true, passes: true, testCount: 2, passCount: 2, failCount: 0, assertionResults: [] },
      ],
      3
    );
    expect(agg.flaky).toBe(true);
    expect(agg.totalRunCount).toBe(3);
    expect(agg.flakyFailureCount).toBe(1);
    expect(agg.passes).toBe(false);
    expect(agg.errors.length).toBe(1);
  });

  it('not flaky when all runs identical and passes', () => {
    const ok = {
      runs: true,
      passes: true,
      testCount: 1,
      passCount: 1,
      failCount: 0,
      assertionResults: [{ fullName: 't', status: 'passed' }],
    };
    const agg = aggregateE2ePipelineRuns([ok, ok, ok], 3);
    expect(agg.flaky).toBe(false);
    expect(agg.flakyFailureCount).toBe(0);
    expect(agg.passes).toBe(true);
    expect(agg.assertionResults).toHaveLength(1);
  });
});
