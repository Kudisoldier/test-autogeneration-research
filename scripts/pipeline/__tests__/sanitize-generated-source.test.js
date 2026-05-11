const {
  sanitizeGeneratedTestSource,
  stripPlaywrightWaitForTimeout,
  normalizeE2ePlaywrightBaseUrl,
  stripLeadingGarbageIdentifierLines,
} = require('../sanitize-generated-source.js');

describe('stripLeadingGarbageIdentifierLines', () => {
  it('removes a lone single-letter line before imports', () => {
    const src = `x
import React from 'react';
`;
    expect(stripLeadingGarbageIdentifierLines(src)).toBe(`import React from 'react';
`);
  });

  it('removes multiple garbage preamble lines', () => {
    const src = `x
jsx
import React from 'react';
`;
    expect(stripLeadingGarbageIdentifierLines(src)).toBe(`import React from 'react';
`);
  });

  it('does not strip describe when it starts a real test block', () => {
    const src = `describe('FeedbackForm', () => {
  it('works', () => {});
});
`;
    expect(stripLeadingGarbageIdentifierLines(src)).toBe(src);
  });

  it('does not strip import lines', () => {
    const src = `import React from 'react';
import { render } from '@testing-library/react';
`;
    expect(stripLeadingGarbageIdentifierLines(src)).toBe(src);
  });
});

describe('sanitizeGeneratedTestSource', () => {
  it('strips BOM and lone x then trims', () => {
    const src = `\uFEFFx\nimport React from 'react';\n`;
    expect(sanitizeGeneratedTestSource(src)).toBe(`import React from 'react';`);
  });

  it('removes page.waitForTimeout lines', () => {
    const src = `await page.waitForTimeout(500);\nawait expect(x).toBe(1);\n`;
    expect(stripPlaywrightWaitForTimeout(src).trim()).toBe(`await expect(x).toBe(1);`);
  });

  it('removes full-line await page.waitForTimeout', () => {
    const src = `  await page.waitForTimeout(300);\nawait expect(x).toBeVisible();\n`;
    expect(stripPlaywrightWaitForTimeout(src).trim()).toBe(`await expect(x).toBeVisible();`);
  });

  it('rewrites localhost:5173 to 127.0.0.1:3000 for e2e output paths only', () => {
    const src = `await page.goto('http://localhost:5173/');\n`;
    expect(normalizeE2ePlaywrightBaseUrl(src, 'tests/e2e/x.spec.js')).toContain('127.0.0.1:3000');
    expect(normalizeE2ePlaywrightBaseUrl(src, 'server/__tests__/x.test.js')).toBe(src);
  });

  it('sanitize applies port rewrite when relOut is tests/e2e', () => {
    const src = `await page.goto("http://localhost:5173");\n`;
    const out = sanitizeGeneratedTestSource(src, { relOut: 'tests/e2e/foo.spec.js' });
    expect(out).toContain('127.0.0.1:3000');
    expect(out).not.toContain('5173');
  });
});
