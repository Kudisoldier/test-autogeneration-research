const {
  sanitizeGeneratedTestSource,
  stripPlaywrightWaitForTimeout,
  sourceUsesForbiddenPlaywrightWaitForTimeout,
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

  it('removes multiline page.waitForTimeout with nested parens in arg', () => {
    const src = `await page.waitForTimeout(
  100 + Math.min(1, 2)
);
await expect(x).toBe(1);
`;
    const out = stripPlaywrightWaitForTimeout(src).trim();
    expect(out).toBe(`await expect(x).toBe(1);`);
  });

  it('sourceUsesForbiddenPlaywrightWaitForTimeout ignores line comments', () => {
    const src = `// doc: never page.waitForTimeout(500) in prod
await expect(page).toBeTruthy();
`;
    expect(sourceUsesForbiddenPlaywrightWaitForTimeout(src)).toBe(false);
  });

  it('sourceUsesForbiddenPlaywrightWaitForTimeout detects real calls', () => {
    expect(sourceUsesForbiddenPlaywrightWaitForTimeout('await page.waitForTimeout(1);')).toBe(true);
    expect(sourceUsesForbiddenPlaywrightWaitForTimeout('void frame.waitForTimeout(2);')).toBe(true);
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

  it('removes waitForTimeout in sanitize by default', () => {
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    try {
      const src = `await page.waitForTimeout(500);\nawait expect(x).toBe(1);\n`;
      expect(sanitizeGeneratedTestSource(src)).not.toContain('waitForTimeout');
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });

  it('isPipelineE2eFlakyResearchEnv reads PIPELINE_E2E_FLAKY_RESEARCH', () => {
    const { isPipelineE2eFlakyResearchEnv } = require('../sanitize-generated-source.js');
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    try {
      delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      expect(isPipelineE2eFlakyResearchEnv()).toBe(false);
      process.env.PIPELINE_E2E_FLAKY_RESEARCH = '1';
      expect(isPipelineE2eFlakyResearchEnv()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });

  it('keeps waitForTimeout when PIPELINE_E2E_FLAKY_RESEARCH=1', () => {
    const prev = process.env.PIPELINE_E2E_FLAKY_RESEARCH;
    process.env.PIPELINE_E2E_FLAKY_RESEARCH = '1';
    try {
      const src = `await page.waitForTimeout(500);\nawait expect(x).toBe(1);\n`;
      expect(sanitizeGeneratedTestSource(src)).toContain('waitForTimeout');
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_E2E_FLAKY_RESEARCH;
      else process.env.PIPELINE_E2E_FLAKY_RESEARCH = prev;
    }
  });
});
