const path = require('path');
const { collectCoverageFromForJest } = require('../jest-collect-coverage-from.js');

describe('collectCoverageFromForJest', () => {
  const clientCfg = path.join('/repo', 'client', 'jest.config.js');
  const rootCfg = path.join('/repo', 'jest.config.js');

  it('strips client/ prefix when using client jest config', () => {
    expect(collectCoverageFromForJest(clientCfg, 'client/src/components/FeedbackForm.jsx')).toBe(
      'src/components/FeedbackForm.jsx'
    );
  });

  it('leaves server paths unchanged for root jest config', () => {
    expect(collectCoverageFromForJest(rootCfg, 'server/foo/bar.js')).toBe('server/foo/bar.js');
  });

  it('returns null for empty source', () => {
    expect(collectCoverageFromForJest(clientCfg, null)).toBe(null);
    expect(collectCoverageFromForJest(clientCfg, '')).toBe(null);
  });
});
