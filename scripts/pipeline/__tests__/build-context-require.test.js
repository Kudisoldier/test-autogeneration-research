const { commonJsRequireFromTestToModule } = require('../build-context.js');

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
