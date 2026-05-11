const {
  parsePlanCaseAssignments,
  buildCoverageMatrix,
  buildReporterUserContent,
} = require('../build-report-context.js');

describe('parsePlanCaseAssignments', () => {
  it('attaches a // plan-case comment to the next test() block', () => {
    const src = `
describe('Outer', () => {
  // plan-case: case-a
  it('does thing A', () => {});
});
`;
    const r = parsePlanCaseAssignments(src);
    expect(r.tests).toHaveLength(1);
    expect(r.tests[0]).toMatchObject({
      title: 'does thing A',
      ancestorTitles: ['Outer'],
      fullName: 'Outer does thing A',
      planCaseIds: ['case-a'],
    });
    expect(r.caseToTests['case-a']).toEqual(['Outer does thing A']);
  });

  it('propagates a plan-case placed before describe to all nested tests', () => {
    const src = `
// plan-case: case-shared
describe('Group', () => {
  test('one', () => {});
  test('two', () => {});
});
`;
    const r = parsePlanCaseAssignments(src);
    expect(r.tests.map((t) => t.fullName)).toEqual(['Group one', 'Group two']);
    expect(r.caseToTests['case-shared']).toEqual(['Group one', 'Group two']);
  });

  it('handles same-line trailing plan-case comments', () => {
    const src = `
describe('S', () => {
  test('x', () => {}); // plan-case: case-trailing
});
`;
    const r = parsePlanCaseAssignments(src);
    expect(r.tests).toHaveLength(1);
    expect(r.tests[0].planCaseIds).toEqual(['case-trailing']);
  });

  it('returns no mapping when there are no plan-case comments', () => {
    const src = `
test('a', () => {});
test('b', () => {});
`;
    const r = parsePlanCaseAssignments(src);
    expect(r.tests).toHaveLength(2);
    expect(r.caseToTests).toEqual({});
    expect(r.knownCaseIds).toEqual([]);
  });

  it('does not leak plan-case ids across sibling describe scopes', () => {
    const src = `
describe('A', () => {
  // plan-case: case-only-in-a
  test('a1', () => {});
});
describe('B', () => {
  test('b1', () => {});
});
`;
    const r = parsePlanCaseAssignments(src);
    const a1 = r.tests.find((t) => t.fullName === 'A a1');
    const b1 = r.tests.find((t) => t.fullName === 'B b1');
    expect(a1.planCaseIds).toEqual(['case-only-in-a']);
    expect(b1.planCaseIds).toEqual([]);
  });
});

describe('buildCoverageMatrix', () => {
  const plan = {
    cases: [
      { id: 'pass-case', title: 'should pass', links: { requirement_ids: ['R1'] } },
      { id: 'fail-case', title: 'should fail' },
      { id: 'orphan-case', title: 'never implemented', flakiness_risks: ['network'] },
    ],
  };

  function makeJest(rows) {
    return rows;
  }

  it('marks a case passed when its mapped jest test passed', () => {
    const parsed = {
      tests: [{ fullName: 'G pass', title: 'pass', ancestorTitles: ['G'], planCaseIds: ['pass-case'] }],
      caseToTests: { 'pass-case': ['G pass'] },
      knownCaseIds: ['pass-case'],
    };
    const jestRows = makeJest([
      {
        rel: 'server/__tests__/x.test.js',
        runs: true,
        passes: true,
        assertionResults: [
          { fullName: 'G pass', title: 'pass', ancestorTitles: ['G'], status: 'passed', failureMessages: [] },
        ],
      },
    ]);
    const { coverageMatrix, totals } = buildCoverageMatrix(plan, jestRows, parsed);
    const row = coverageMatrix.find((c) => c.id === 'pass-case');
    expect(row.status).toBe('passed');
    expect(row.failureMessages).toEqual([]);
    expect(totals.passed).toBe(1);
  });

  it('marks a case failed and carries failureMessages through', () => {
    const parsed = {
      tests: [{ fullName: 'G fail', title: 'fail', ancestorTitles: ['G'], planCaseIds: ['fail-case'] }],
      caseToTests: { 'fail-case': ['G fail'] },
      knownCaseIds: ['fail-case'],
    };
    const jestRows = makeJest([
      {
        rel: 'server/__tests__/x.test.js',
        runs: true,
        passes: false,
        assertionResults: [
          {
            fullName: 'G fail',
            title: 'fail',
            ancestorTitles: ['G'],
            status: 'failed',
            failureMessages: ['Expected 1 to be 2'],
          },
        ],
      },
    ]);
    const { coverageMatrix, totals } = buildCoverageMatrix(plan, jestRows, parsed);
    const row = coverageMatrix.find((c) => c.id === 'fail-case');
    expect(row.status).toBe('failed');
    expect(row.failureMessages).toContain('Expected 1 to be 2');
    expect(totals.failed).toBe(1);
  });

  it('marks a case not_implemented when no plan-case comment matched', () => {
    const parsed = { tests: [], caseToTests: {}, knownCaseIds: [] };
    const { coverageMatrix, totals } = buildCoverageMatrix(plan, [], parsed);
    const row = coverageMatrix.find((c) => c.id === 'orphan-case');
    expect(row.status).toBe('not_implemented');
    expect(totals.notImplemented).toBeGreaterThanOrEqual(1);
  });

  it('marks a case not_run when jest never executed (e2e)', () => {
    const parsed = {
      tests: [{ fullName: 'E2E case', title: 'case', ancestorTitles: [], planCaseIds: ['pass-case'] }],
      caseToTests: { 'pass-case': ['E2E case'] },
      knownCaseIds: ['pass-case'],
    };
    const jestRows = makeJest([
      { rel: 'tests/e2e/foo.spec.js', runs: false, passes: false, assertionResults: [] },
    ]);
    const { coverageMatrix, totals } = buildCoverageMatrix(plan, jestRows, parsed);
    const row = coverageMatrix.find((c) => c.id === 'pass-case');
    expect(row.status).toBe('not_run');
    expect(totals.notRun).toBe(1);
  });

  it('marks a case passed when e2e runner produced matching assertion results', () => {
    const parsed = {
      tests: [
        {
          fullName: 'Outer describe inner test',
          title: 'inner test',
          ancestorTitles: ['Outer describe'],
          planCaseIds: ['pass-case'],
        },
      ],
      caseToTests: { 'pass-case': ['Outer describe inner test'] },
      knownCaseIds: ['pass-case'],
    };
    const jestRows = makeJest([
      {
        rel: 'tests/e2e/foo.spec.js',
        runs: true,
        passes: true,
        assertionResults: [
          {
            fullName: 'Outer describe inner test',
            title: 'inner test',
            ancestorTitles: ['Outer describe'],
            status: 'passed',
            failureMessages: [],
          },
        ],
      },
    ]);
    const { coverageMatrix, totals } = buildCoverageMatrix(plan, jestRows, parsed);
    const row = coverageMatrix.find((c) => c.id === 'pass-case');
    expect(row.status).toBe('passed');
    expect(totals.passed).toBe(1);
    expect(totals.notRun).toBe(0);
  });

  it('preserves linked requirement_ids and flakiness_risks on the matrix row', () => {
    const parsed = { tests: [], caseToTests: {}, knownCaseIds: [] };
    const { coverageMatrix } = buildCoverageMatrix(plan, [], parsed);
    const passRow = coverageMatrix.find((c) => c.id === 'pass-case');
    const orphanRow = coverageMatrix.find((c) => c.id === 'orphan-case');
    expect(passRow.linked_requirement_ids).toEqual(['R1']);
    expect(orphanRow.flakiness_risks).toEqual(['network']);
  });
});

describe('buildReporterUserContent', () => {
  it('emits all expected sections in order', () => {
    const out = buildReporterUserContent({
      runMeta: { test_level: 'unit_server' },
      plan: { cases: [{ id: 'a', title: 't', steps: ['s'], assertions: ['x'] }] },
      coverageMatrix: [{ id: 'a', status: 'passed' }],
      totals: { total: 1, passed: 1, failed: 0, notRun: 0, notImplemented: 0, pending: 0, implemented: 1 },
      testFileRel: 'server/__tests__/x.test.js',
      testFileContent: 'test("a", () => {}); // plan-case: a',
      jestRows: [{ rel: 'server/__tests__/x.test.js', runs: true, passes: true, assertionResults: [] }],
      codeContextBundle: '### FILE: server/x.js\n```\nmodule.exports = 1;\n```',
    });
    expect(out).toMatch(/## RUN_META/);
    expect(out).toMatch(/## PLAN/);
    expect(out).toMatch(/## COVERAGE_MATRIX/);
    expect(out).toMatch(/## TEST_FILE: server\/__tests__\/x.test.js/);
    expect(out).toMatch(/## JEST_RESULTS/);
    expect(out).toMatch(/## CODE_AND_CONTRACT_CONTEXT/);
    expect(out.indexOf('## RUN_META')).toBeLessThan(out.indexOf('## PLAN'));
    expect(out.indexOf('## PLAN')).toBeLessThan(out.indexOf('## COVERAGE_MATRIX'));
    expect(out.indexOf('## COVERAGE_MATRIX')).toBeLessThan(out.indexOf('## TEST_FILE'));
    expect(out.indexOf('## TEST_FILE')).toBeLessThan(out.indexOf('## JEST_RESULTS'));
    expect(out.indexOf('## JEST_RESULTS')).toBeLessThan(out.indexOf('## CODE_AND_CONTRACT_CONTEXT'));
  });

  it('omits CODE_AND_CONTRACT_CONTEXT when bundle is empty', () => {
    const out = buildReporterUserContent({
      runMeta: {},
      plan: { cases: [] },
      coverageMatrix: [],
      totals: {},
      testFileRel: 'x',
      testFileContent: '',
      jestRows: [],
      codeContextBundle: '',
    });
    expect(out).not.toMatch(/## CODE_AND_CONTRACT_CONTEXT/);
  });
});
