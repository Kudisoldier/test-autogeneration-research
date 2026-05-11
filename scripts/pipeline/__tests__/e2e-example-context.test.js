const fs = require('fs');
const path = require('path');
const { buildContextBundle, validateManifest } = require('../build-context.js');

describe('example e2e manifest (specs/pipeline/examples/e2e.manifest.json)', () => {
  const projectRoot = path.join(__dirname, '..', '..', '..');

  it('validates and generator bundle includes UI sources + PAGE_SNAPSHOT contract', async () => {
    const manifestPath = path.join(projectRoot, 'specs/pipeline/examples/e2e.manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(validateManifest(manifest)).toEqual([]);
    const bundle = await buildContextBundle(projectRoot, manifest, 'generator');
    expect(bundle).toContain('### FILE: client/src/components/FeedbackForm.jsx');
    expect(bundle).toContain('### FILE: client/src/utils/validation.js');
    expect(bundle).toContain('### FILE: client/src/App.jsx');
    expect(bundle).toContain('### PAGE_SNAPSHOT (a11y)');
    expect(bundle).toContain('error-email');
    expect(bundle).toContain('submit-status-success');
    expect(bundle).toContain('Please enter a valid email address');
    expect(bundle).toContain('127.0.0.1:3000');
    expect(bundle).toMatch(/5173|port 3000/);
  });
});
