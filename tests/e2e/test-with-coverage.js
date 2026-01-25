/**
 * Custom test fixture with automatic coverage collection
 * This extends Playwright's test with automatic coverage collection
 * when E2E_COVERAGE_DIR environment variable is set
 * 
 * ES Module version for use with import statements
 */

import { test as baseTest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extend test with automatic coverage collection
const test = baseTest.extend({
  page: async ({ page }, use, testInfo) => {
    const coverageDir = process.env.E2E_COVERAGE_DIR;
    
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Coverage fixture: coverageDir=${coverageDir}, project=${testInfo.project.name}`);
    }
    
    if (coverageDir && testInfo.project.name === 'chromium') {
      // Only collect coverage for Chromium (Coverage API only works with Chromium)
      await page.coverage.startJSCoverage({
        resetOnNavigation: false,
        reportAnonymousScripts: true
      });
      
      if (process.env.DEBUG_COVERAGE) {
        console.log(`[DEBUG] Coverage collection started for test: ${testInfo.title}`);
      }
      
      try {
        await use(page);
      } finally {
        // Stop coverage and save to file
        const coverage = await page.coverage.stopJSCoverage();
        
        if (process.env.DEBUG_COVERAGE) {
          console.log(`[DEBUG] Coverage collection stopped. Entries: ${coverage ? coverage.length : 0}`);
        }
        
        if (coverage && coverage.length > 0) {
          fs.mkdirSync(coverageDir, { recursive: true });
          // Use a more reliable test identifier
          const testId = testInfo.testId || `${testInfo.title.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`;
          const coverageFile = path.join(coverageDir, `coverage-${testId}.json`);
          fs.writeFileSync(coverageFile, JSON.stringify(coverage, null, 2));
          
          if (process.env.DEBUG_COVERAGE) {
            console.log(`[DEBUG] Coverage saved to: ${coverageFile}`);
          }
        } else {
          if (process.env.DEBUG_COVERAGE) {
            console.log(`[DEBUG] No coverage data collected`);
          }
        }
      }
    } else {
      // No coverage collection, just use the page normally
      await use(page);
    }
  },
});

export { test, expect: baseTest.expect };
