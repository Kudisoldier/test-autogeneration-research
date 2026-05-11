const { resolveGenerationConfig } = require('../config.js');
const {
  commonJsRequireFromTestToModule,
  esmRelativeImportFromTestToModule,
  fixEsmSpecifierDepthForNestedTests,
  buildDynamicPromptTail,
  isPipelineE2eFlakyResearchEnabled,
} = require('../build-context.js');

const minimalE2eManifest = {
  schema_version: '1',
  test_level: 'e2e',
  target: 'feedback-form',
  page_snapshot: { path: 'specs/pipeline/examples/sample-page-snapshot.txt', format: 'a11y' },
  output_policy: { primary_test_file: 'tests/e2e/x.spec.js' },
  policies: { max_prompt_chars: {}, forbidden_path_globs: [] },
  files: [{ path: 'client/src/components/FeedbackForm.jsx', role: 'both' }],
  generation: { require_plan_case_comments: false },
};

describe('isPipelineE2eFlakyResearchEnabled', () => {
  it('is false when env unset', () => {
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    try {
      expect(isPipelineE2eFlakyResearchEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });

  it('is true for 1, true, yes (case-insensitive)', () => {
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    try {
      process.env.PIPELINE_E2E_FLAKY_RESEARCH = 'TRUE';
      expect(isPipelineE2eFlakyResearchEnabled()).toBe(true);
      process.env.PIPELINE_E2E_FLAKY_RESEARCH = 'yes';
      expect(isPipelineE2eFlakyResearchEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });
});

describe('buildDynamicPromptTail (e2e flaky research)', () => {
  const resolved = resolveGenerationConfig(minimalE2eManifest, {}, 'generate');

  it('includes flaky timing instructions and not the waitForTimeout ban when research env is on', () => {
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    process.env.PIPELINE_E2E_FLAKY_RESEARCH = '1';
    try {
      const tail = buildDynamicPromptTail('generator', minimalE2eManifest, resolved);
      expect(tail).toContain('FLAKY RESEARCH MODE');
      expect(tail).toContain('Timing variance is intentional');
      expect(tail).not.toContain('Avoid `page.waitForTimeout`');
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });

  it('asks to avoid waitForTimeout when research env is off', () => {
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    try {
      const tail = buildDynamicPromptTail('generator', minimalE2eManifest, resolved);
      expect(tail).toContain('Avoid `page.waitForTimeout`');
      expect(tail).not.toContain('FLAKY RESEARCH MODE');
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });
});

describe('commonJsRequireFromTestToModule', () => {
  it('resolves __tests__ sibling to parent dir module', () => {
    expect(
      commonJsRequireFromTestToModule(
        'server/utils/__tests__/validation.pipeline.example.test.js',
        'server/utils/validation.js'
      )
    ).toBe('../validation');
  });

  it('resolves server/__tests__ to server entry', () => {
    expect(commonJsRequireFromTestToModule('server/__tests__/api.test.js', 'server/index.js')).toBe('../index');
  });
});

describe('esmRelativeImportFromTestToModule', () => {
  it('uses one extra parent when test is under __tests__ vs component', () => {
    expect(
      esmRelativeImportFromTestToModule(
        'client/src/components/__tests__/FeedbackForm.pipeline.example.test.jsx',
        'client/src/utils/validation.js'
      )
    ).toBe('../../utils/validation');
  });

  it('resolves sibling component from __tests__', () => {
    expect(
      esmRelativeImportFromTestToModule(
        'client/src/components/__tests__/FeedbackForm.pipeline.example.test.jsx',
        'client/src/components/FeedbackForm.jsx'
      )
    ).toBe('../FeedbackForm');
  });
});

describe('fixEsmSpecifierDepthForNestedTests', () => {
  const testRel = 'client/src/components/__tests__/FeedbackForm.pipeline.example.test.jsx';
  const files = [
    { path: 'client/src/components/FeedbackForm.jsx' },
    { path: 'client/src/utils/validation.js' },
    { path: 'client/src/utils/api.js' },
    { path: 'client/src/utils/constants.js' },
  ];

  it('rewrites jest.mock paths copied from the SUT directory', () => {
    const src = `jest.mock('../utils/validation', () => ({}));\njest.mock("../utils/api", () => ({}));\n`;
    const out = fixEsmSpecifierDepthForNestedTests(src, testRel, files);
    expect(out).toContain("jest.mock('../../utils/validation'");
    expect(out).toContain('jest.mock("../../utils/api"');
    expect(out).not.toContain("jest.mock('../utils/validation'");
  });

  it('fixes ../utils when utils modules are not listed in manifest.files', () => {
    const src = `jest.mock('../utils/api', () => ({}));\nimport { submitFeedback } from '../utils/api';\n`;
    const out = fixEsmSpecifierDepthForNestedTests(src, testRel, []);
    expect(out).toContain("jest.mock('../../utils/api'");
    expect(out).toContain("from '../../utils/api'");
    expect(out).not.toContain("from '../utils/api'");
  });
});
