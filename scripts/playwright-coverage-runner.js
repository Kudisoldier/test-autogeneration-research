#!/usr/bin/env node

/**
 * Playwright Coverage Runner
 * 
 * Runs Playwright tests and collects JavaScript coverage using Playwright Coverage API
 * without modifying the test files themselves.
 * 
 * Uses Playwright's programmatic API to wrap test execution with coverage collection.
 */

const { chromium } = require('playwright');
const v8toIstanbul = require('v8-to-istanbul');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Collect coverage from a Playwright test file
 * @param {string} testFilePath - Path to the Playwright test file
 * @param {string} coverageDir - Directory to save coverage data
 * @param {string} sourceFile - Source file to measure coverage for (e.g., client/src/components/FeedbackForm.jsx)
 * @returns {Promise<number>} Coverage percentage for the source file
 */
async function collectCoverageFromTest(testFilePath, coverageDir, sourceFile) {
  const projectRoot = path.resolve(__dirname, '..');
  const testFileAbs = path.resolve(projectRoot, testFilePath);
  
  if (!fs.existsSync(testFileAbs)) {
    throw new Error(`Test file not found: ${testFileAbs}`);
  }
  
  // Create coverage directory
  fs.mkdirSync(coverageDir, { recursive: true });
  
  // Read the test file to understand what it does
  // We'll use Playwright's programmatic API to run the test with coverage
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Start coverage collection
  await page.coverage.startJSCoverage({
    resetOnNavigation: false,
    reportAnonymousScripts: true
  });
  
  try {
    // Start the dev server if not already running
    // The test will use the webServer from playwright.config.js, but we need to ensure it's running
    // For now, we'll assume the server is already running via webServer config
    
    // Run the Playwright test using Playwright's CLI
    // We can't easily intercept the test execution programmatically without modifying tests,
    // so we'll use a different approach: run the test and collect coverage from the page
    
    // Actually, the best approach is to use Playwright's test runner with a custom fixture
    // But since we can't modify tests, we'll use a workaround:
    // 1. Run the test normally via CLI
    // 2. But before that, we need to inject coverage collection
    
    // Alternative: Use Playwright's test runner programmatically
    // This requires importing @playwright/test and using its API
    
    // For now, let's use a simpler approach: run the test and collect coverage from the browser
    // We'll navigate to the app and let the test run, collecting coverage along the way
    
    // Actually, the best way is to use Playwright's test fixtures
    // But we need to modify playwright.config.js to add a fixture that collects coverage
    
    // Let's use a different approach: create a temporary wrapper that runs the test
    // with coverage collection enabled via environment variable or config
    
    // For now, return 0 as placeholder - we need to integrate with Playwright test runner
    return 0;
    
  } finally {
    // Stop coverage collection
    const coverage = await page.coverage.stopJSCoverage();
    await browser.close();
    
    if (coverage && coverage.length > 0) {
      // Convert Playwright coverage to Istanbul format
      const istanbulCoverage = {};
      
      for (const entry of coverage) {
        if (!entry.url || !entry.source) continue;
        
        // Extract file path from URL
        // URL format: http://127.0.0.1:3000/src/components/FeedbackForm.jsx
        let filePath = entry.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
        
        // Map to actual file system path
        if (filePath.startsWith('src/')) {
          filePath = `client/${filePath}`;
        }
        
        // Check if this is the source file we're interested in
        const sourceFileAbs = path.resolve(projectRoot, sourceFile);
        const filePathAbs = path.resolve(projectRoot, filePath);
        
        if (filePathAbs === sourceFileAbs || filePath.endsWith('/' + sourceFile.replace(/^client\//, ''))) {
          try {
            // Convert V8 coverage to Istanbul format
            const converter = v8toIstanbul('', 0, { source: entry.source });
            await converter.load();
            converter.applyCoverage(entry.functions);
            const istanbulData = converter.toIstanbul();
            
            // Calculate coverage percentage
            const totalLines = entry.source.split('\n').length;
            const ranges = entry.functions.flatMap(f => f.ranges || []);
            const coveredLines = new Set();
            
            for (const range of ranges) {
              const startLine = entry.source.substring(0, range.startOffset).split('\n').length - 1;
              const endLine = entry.source.substring(0, range.endOffset).split('\n').length - 1;
              for (let i = startLine; i <= endLine; i++) {
                coveredLines.add(i);
              }
            }
            
            const coveredLinesCount = coveredLines.size;
            const coveragePct = totalLines > 0 ? (coveredLinesCount / totalLines) * 100 : 0;
            
            // Save coverage data
            const coverageFile = path.join(coverageDir, 'playwright-coverage.json');
            fs.writeFileSync(coverageFile, JSON.stringify({
              [sourceFileAbs]: {
                lines: { total: totalLines, covered: coveredLinesCount, skipped: 0, pct: coveragePct },
                statements: { total: totalLines, covered: coveredLinesCount, skipped: 0, pct: coveragePct },
                functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
                branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
              }
            }, null, 2));
            
            return coveragePct;
          } catch (e) {
            console.error(`Error processing coverage for ${entry.url}: ${e.message}`);
          }
        }
      }
    }
    
    return 0;
  }
}

module.exports = { collectCoverageFromTest };
