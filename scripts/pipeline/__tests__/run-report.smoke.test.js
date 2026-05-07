const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const CANNED_REPORT = `## Executive summary

- One generated test file with 1 plan case.
- 1 of 1 plan cases passed.

**Overall: tests are reliable**

## Plan coverage matrix

| Case ID | Title | Status | Mapped Jest tests | Linked requirements | Linked operations |
|---|---|---|---|---|---|
| case-a | demo | passed | suite test a | - | - |

## Per-failure analysis

None.

## Coverage gaps

None.

## Risks and flakiness notes

None.
`;

jest.mock('../../openrouter-client.js', () => ({
  generateTestWithRetry: jest.fn().mockResolvedValue(CANNED_REPORT),
}));

const { runReport } = require('../run-report.js');
const openrouterClient = require('../../openrouter-client.js');

async function setupRunDir() {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pipeline-report-test-'));
  const runDir = path.join(tmpDir, 'run-x');
  await fsp.mkdir(runDir, { recursive: true });

  const testFileRel = 'server/__tests__/dummy.pipeline.example.test.js';
  const generatedTestPath = path.join(runDir, 'generated', testFileRel);
  await fsp.mkdir(path.dirname(generatedTestPath), { recursive: true });
  await fsp.writeFile(
    generatedTestPath,
    `describe('suite', () => {
  // plan-case: case-a
  test('test a', () => {});
});
`,
    'utf-8'
  );

  const manifest = {
    schema_version: '1',
    test_level: 'unit_server',
    target: 'demo',
    generation: { preset: 'balanced' },
    policies: { max_prompt_chars: { total: 200000, per_file: 80000 } },
    files: [
      { path: 'server/utils/validation.js', role: 'both' },
    ],
    output_policy: { primary_test_file: testFileRel },
  };
  await fsp.writeFile(path.join(runDir, 'context_manifest.json'), JSON.stringify(manifest, null, 2));

  const plan = {
    schema_version: '1',
    test_level: 'unit_server',
    target: 'demo',
    cases: [
      {
        id: 'case-a',
        title: 'demo',
        steps: ['call'],
        assertions: ['returns ok'],
      },
    ],
  };
  await fsp.writeFile(path.join(runDir, 'test_plan.json'), JSON.stringify(plan, null, 2));

  const jestRows = [
    {
      rel: testFileRel,
      runs: true,
      passes: true,
      testCount: 1,
      passCount: 1,
      failCount: 0,
      assertionResults: [
        {
          fullName: 'suite test a',
          title: 'test a',
          ancestorTitles: ['suite'],
          status: 'passed',
          failureMessages: [],
          location: null,
        },
      ],
    },
  ];
  await fsp.writeFile(path.join(runDir, 'jest-results.json'), JSON.stringify(jestRows, null, 2));

  await fsp.writeFile(
    path.join(runDir, 'plan.meta.json'),
    JSON.stringify({ stage: 'plan', model: 'm-plan', seconds: 1.5 }, null, 2)
  );
  await fsp.writeFile(
    path.join(runDir, 'generate.meta.json'),
    JSON.stringify({ stage: 'generate', model: 'm-gen', seconds: 2.5 }, null, 2)
  );
  await fsp.writeFile(
    path.join(runDir, 'evaluation-report.json'),
    JSON.stringify({ summary: { total: 1, passes: 1, totalTests: 1, totalPassed: 1 } }, null, 2)
  );

  return { tmpDir, runDir, testFileRel };
}

describe('runReport (smoke)', () => {
  beforeEach(() => {
    openrouterClient.generateTestWithRetry.mockClear();
    openrouterClient.generateTestWithRetry.mockResolvedValue(CANNED_REPORT);
  });

  it('writes report.md and report.meta.json with coverage totals', async () => {
    const { runDir } = await setupRunDir();
    const result = await runReport({ runDir, model: 'mock/model', preset: 'balanced' });

    expect(result.reportPath).toBe(path.join(runDir, 'report.md'));
    expect(result.metaPath).toBe(path.join(runDir, 'report.meta.json'));
    expect(result.totals.total).toBe(1);
    expect(result.totals.passed).toBe(1);

    const md = await fsp.readFile(result.reportPath, 'utf-8');
    expect(md).toMatch(/Executive summary/);
    expect(md).toMatch(/Plan coverage matrix/);

    const metaRaw = await fsp.readFile(result.metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw);
    expect(meta.stage).toBe('report');
    expect(meta.model).toBe('mock/model');
    expect(meta.coverage_totals.total).toBe(1);
    expect(meta.coverage_totals.passed).toBe(1);

    const call = openrouterClient.generateTestWithRetry.mock.calls[0];
    expect(call[0]).toBe('mock/model');
    expect(typeof call[1]).toBe('string');
    expect(call[1]).toMatch(/## COVERAGE_MATRIX/);
    expect(call[1]).toMatch(/## RUN_META/);
    expect(call[2]).toMatchObject({
      systemPrompt: expect.any(String),
      temperature: expect.any(Number),
    });
  });

  it('throws a validation error when test_plan.json is missing required fields', async () => {
    const { runDir } = await setupRunDir();
    await fsp.writeFile(
      path.join(runDir, 'test_plan.json'),
      JSON.stringify({ schema_version: '1' }, null, 2)
    );
    await expect(runReport({ runDir, model: 'mock/model' })).rejects.toThrow(/Plan validation failed/);
  });

  it('throws when the LLM returns empty content', async () => {
    openrouterClient.generateTestWithRetry.mockResolvedValueOnce('   ');
    const { runDir } = await setupRunDir();
    await expect(runReport({ runDir, model: 'mock/model' })).rejects.toThrow(/empty content/);
  });
});
