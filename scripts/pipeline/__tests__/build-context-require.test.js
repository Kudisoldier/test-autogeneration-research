const {
  commonJsRequireFromTestToModule,
  esmRelativeImportFromTestToModule,
  fixEsmSpecifierDepthForNestedTests,
} = require('../build-context.js');

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
});
