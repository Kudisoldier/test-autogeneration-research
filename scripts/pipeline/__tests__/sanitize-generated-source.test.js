const {
  sanitizeGeneratedTestSource,
  stripPlaywrightWaitForTimeout,
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
});
