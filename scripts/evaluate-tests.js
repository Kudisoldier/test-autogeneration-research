#!/usr/bin/env node

/**
 * Test Evaluation Script
 * 
 * Evaluates generated tests by:
 * 1. Checking syntax correctness
 * 2. Running tests
 * 3. Analyzing coverage
 * 4. Generating evaluation report
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const FLAKY_RUNS = Math.max(
  1,
  parseInt(process.env.FLAKY_RUNS || process.env.EVALUATION_FLAKY_RUNS || '3', 10) || 3
);
const COMPUTE_COVERAGE = (process.env.COMPUTE_COVERAGE || process.env.EVALUATION_COVERAGE || '1') !== '0';

/**
 * Evaluate a single test file
 * @param {boolean} computeCoverage - Whether to compute coverage (only for first run in flaky tests)
 */
async function evaluateTestFileOnce(testFilePath, modelName, testType, computeCoverage = true) {
  const results = {
    file: testFilePath,
    model: modelName,
    type: testType,
    exists: false,
    syntaxValid: false,
    runs: false,
    passes: false,
    errors: [],
    testCount: 0,
    passCount: 0,
    failCount: 0,
    coverage: null,
    coverageDelta: null,
    coverageBaseline: null,
    coverageGenerated: null,
    coverageSourceFile: null,
    logPath: null,
    rootCause: null,
    ttgSeconds: null,
  };

  try {
    // Check if file exists
    await fs.access(testFilePath);
    results.exists = true;

    // Load generation metadata if present (TTG, etc.)
    try {
      const metaRaw = await fs.readFile(testFilePath + '.meta.json', 'utf-8');
      const meta = JSON.parse(metaRaw);
      if (typeof meta.ttgSeconds === 'number') results.ttgSeconds = meta.ttgSeconds;
    } catch (e) {
      // ignore missing/invalid meta
    }

    // Check syntax (basic check)
    try {
      let content = await fs.readFile(testFilePath, 'utf-8');
      
      // Remove markdown code blocks if present
      content = content.replace(/^```(?:javascript|js|ts|tsx)?\n?/gm, '');
      content = content.replace(/\n?```$/gm, '');
      content = content.trim();
      
      // Basic syntax checks
      if (testFilePath.endsWith('.jsx') || testFilePath.endsWith('.js')) {
        // Check for common syntax issues
        if (content.includes('import ') || content.includes('export ')) {
          // ES6 modules - check for proper structure
          results.syntaxValid = !content.match(/import\s+.*from\s+['"]\.\.\/\.\.\/[^'"]*['"]/g) || 
                                 content.includes('require(');
        } else {
          results.syntaxValid = true;
        }
      }

      // Check for test structure - count actual test cases
      const testMatches = content.match(/(?:test|it)\(/g);
      const describeMatches = content.match(/describe\(/g);
      if (testMatches) {
        results.testCount = testMatches.length;
      } else if (describeMatches) {
        // If only describe blocks, estimate 1 test per describe
        results.testCount = describeMatches.length;
      }
      
      // Check if syntax is valid (basic check - no obvious syntax errors)
      try {
        // Try to parse as JavaScript (basic validation)
        if (!content.includes('```') && !content.trim().startsWith('```')) {
          results.syntaxValid = true;
        }
      } catch (e) {
        // Syntax check failed
      }

      // Try to run the test
      try {
        // Copy test to appropriate location temporarily based on test type and file name
        let targetPath;
        const testFileName = path.basename(testFilePath);
        
        if (testType === 'unit') {
          if (testFileName.includes('Form') || testFileName.includes('List')) {
            targetPath = path.join(projectRoot, 'client', 'src', 'components', '__tests__', testFileName);
          } else {
            targetPath = path.join(projectRoot, 'client', 'src', 'utils', '__tests__', testFileName);
          }
        } else if (testType === 'integration') {
          if (testFileName.includes('api') || testFilePath.includes('api')) {
            targetPath = path.join(projectRoot, 'server', '__tests__', testFileName);
          } else {
            targetPath = path.join(projectRoot, 'server', 'utils', '__tests__', testFileName);
          }
        } else if (testType === 'e2e') {
          // Playwright E2E tests live under root tests/e2e
          targetPath = path.join(projectRoot, 'tests', 'e2e', testFileName);
        } else {
          // Unknown test type
          return results;
        }
        
        // Create directory if needed
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        // Copy file (with cleaned content if markdown was removed)
        // For E2E tests, force IPv4 loopback to avoid localhost -> ::1 issues.
        // Also inject coverage collection fixture if coverage is requested
        let contentToWrite = content;
        if (testType === 'e2e') {
          contentToWrite = contentToWrite
            .replace(/http:\/\/localhost:3000/g, 'http://127.0.0.1:3000')
            .replace(/http:\/\/localhost:3001/g, 'http://127.0.0.1:3001');
          
          // Inject coverage collection fixture if coverage is requested
          // This replaces the standard @playwright/test import with our custom test-with-coverage
          // The test-with-coverage.js file is in tests/e2e/, so we need to use the correct relative path
          if (COMPUTE_COVERAGE && computeCoverage) {
            // Determine relative path from test file to test-with-coverage.js
            // Test files are in research-output/*/e2e/, test-with-coverage.js is in tests/e2e/
            const testDir = path.dirname(targetPath);
            const coverageFixturePath = path.relative(testDir, path.join(projectRoot, 'tests', 'e2e', 'test-with-coverage.js'));
            const coverageFixtureRel = coverageFixturePath.replace(/\\/g, '/');
            
            // Replace import statement to use test-with-coverage fixture
            // Ensure .js extension is included for ES modules
            const fixturePathWithExt = coverageFixtureRel.endsWith('.js') ? coverageFixtureRel : `${coverageFixtureRel}.js`;
            contentToWrite = contentToWrite.replace(
              /import\s+{\s*test\s*,\s*expect\s*}\s+from\s+['"]@playwright\/test['"];?/g,
              `import { test, expect } from '${fixturePathWithExt}';`
            );
            
            // Verify fixture file exists
            const fixtureAbsPath = path.join(projectRoot, 'tests', 'e2e', 'test-with-coverage.js');
            if (!fsSync.existsSync(fixtureAbsPath)) {
              if (process.env.DEBUG_COVERAGE) {
                console.log(`[DEBUG] WARNING: Coverage fixture not found at ${fixtureAbsPath}`);
              }
            } else {
              if (process.env.DEBUG_COVERAGE) {
                console.log(`[DEBUG] Coverage fixture exists: ${fixtureAbsPath}`);
                console.log(`[DEBUG] Injected coverage fixture path: ${fixturePathWithExt}`);
                console.log(`[DEBUG] Test file location: ${targetPath}`);
                
                // Verify import was replaced
                if (contentToWrite.includes(fixturePathWithExt) || contentToWrite.includes('test-with-coverage')) {
                  console.log(`[DEBUG] Import successfully replaced in test file`);
                } else {
                  console.log(`[DEBUG] WARNING: Import may not have been replaced. First 200 chars: ${contentToWrite.substring(0, 200)}`);
                }
              }
            }
            
            // Also handle require syntax
            contentToWrite = contentToWrite.replace(
              /const\s+{\s*test\s*,\s*expect\s*}\s+=\s+require\s*\(\s*['"]@playwright\/test['"]\s*\);?/g,
              `const { test, expect } = require('${coverageFixtureRel}');`
            );
            
            if (process.env.DEBUG_COVERAGE) {
              console.log(`[DEBUG] Injected coverage fixture: ${coverageFixtureRel}`);
            }
          }
        }
        await fs.writeFile(targetPath, contentToWrite, 'utf-8');
        
        // Compute baseline coverage (WITHOUT this test) before running it
        let baselinePct = 0;
        if (COMPUTE_COVERAGE && computeCoverage && testType !== 'e2e') {
          try {
            const sourceFile = getSourceFileForTest(testFilePath, testType);
            if (sourceFile) {
              const sourceFilePath = path.join(projectRoot, sourceFile);
              if (fsSync.existsSync(sourceFilePath)) {
                // Temporarily rename test to exclude it from baseline
                const tempTestPath = targetPath + '.tmp.exclude';
                let testWasRenamed = false;
                try {
                  if (fsSync.existsSync(targetPath)) {
                    await fs.rename(targetPath, tempTestPath);
                    testWasRenamed = true;
                  }
                  baselinePct = await runCoverageForSourceFile(
                    sourceFile,
                    testType,
                    `baseline-${testType}-${path.basename(testFilePath)}`
                  );
                } catch (e) {
                  baselinePct = 0;
                } finally {
                  if (testWasRenamed && fsSync.existsSync(tempTestPath)) {
                    await fs.rename(tempTestPath, targetPath).catch(() => {});
                  }
                }
                results.coverageBaseline = baselinePct;
                results.coverageSourceFile = sourceFile;
              }
            }
          } catch (e) {
            baselinePct = 0;
            results.coverageBaseline = 0;
          }
        }
        
        // Try to run test (with coverage if requested)
        if (testType === 'unit') {
          // Run client tests (with coverage if requested)
          try {
            const testFileName = path.basename(testFilePath);
            // Use temporary file to avoid buffer limitations
            const outputFile = path.join(projectRoot, '.test-output.tmp');
            
            // Build test command with coverage if requested
            let testCmd = `cd ${path.join(projectRoot, 'client')} && npm test -- --testPathPattern="${testFileName}"`;
            
            if (COMPUTE_COVERAGE && computeCoverage) {
              // Create unique coverage directory for this test run
              const coverageTs = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
              const coverageDir = path.join(projectRoot, '.coverage-tmp', 'unit', coverageTs);
              fsSync.mkdirSync(coverageDir, { recursive: true });
              const coverageDirRel = path.relative(path.join(projectRoot, 'client'), coverageDir);
              testCmd += ` --coverage --coverageReporters=json-summary --coverageDirectory "${coverageDirRel}"`;
              
              // Store coverage directory for later reading
              results._coverageDir = coverageDir;
            }
            
            try {
              execSync(
                `${testCmd} > "${outputFile}" 2>&1`,
                { encoding: 'utf-8', timeout: 60000, stdio: 'pipe' }
              );
            } catch (execError) {
              // Command may have failed, but output file might still exist
            }
            
            let output = '';
            try {
              output = await fs.readFile(outputFile, 'utf-8');
              await fs.unlink(outputFile).catch(() => {}); // Clean up
            } catch (readError) {
              // Output file doesn't exist or couldn't be read
              output = '';
            }
            
            // Persist raw Jest output for debugging (similar to e2e)
            try {
              const evalLogDir = path.join(path.dirname(testFilePath), '.eval-logs');
              await fs.mkdir(evalLogDir, { recursive: true });
              const evalLogPath = path.join(evalLogDir, `${path.basename(testFilePath)}.jest.log`);
              await fs.writeFile(evalLogPath, output, 'utf-8');
              results.logPath = evalLogPath.replace(projectRoot + path.sep, '');
            } catch (e) {
              // ignore log write errors
            }
            
            results.runs = true;
            // Parse test results - Jest output format: "Tests: 7 passed, 7 total"
            const passMatch = output.match(/Tests:\s+(\d+)\s+passed/i) || output.match(/(\d+)\s+passed/i);
            const failMatch = output.match(/Tests:\s+\d+\s+passed,\s+(\d+)\s+failed/i) || output.match(/(\d+)\s+failed/i);
            const totalMatch = output.match(/Tests:\s+\d+\s+passed(?:,\s+\d+\s+failed)?,\s+(\d+)\s+total/i);
            
            if (passMatch) {
              results.passCount = parseInt(passMatch[1]);
            }
            if (failMatch) {
              results.failCount = parseInt(failMatch[1]);
            }
            
            // If test suite passed but no explicit count found, check for PASS status
            if (!passMatch && output.includes('PASS') && !output.includes('FAIL')) {
              // Try to extract from test count if available
              if (results.testCount > 0) {
                results.passCount = results.testCount;
              } else if (totalMatch) {
                results.passCount = parseInt(totalMatch[1]);
              } else {
                results.passCount = 1; // At least one test passed
              }
            }
            
            results.passes = results.failCount === 0 && results.passCount > 0;
            
            // Read coverage from test run if available
            if (COMPUTE_COVERAGE && computeCoverage && results._coverageDir) {
              try {
                const sourceFile = results.coverageSourceFile || getSourceFileForTest(testFilePath, testType);
                if (sourceFile) {
                  // Wait for Jest to finish writing coverage files
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  generatedPct = readCoverageSummaryPct(results._coverageDir, sourceFile);
                  results.coverageGenerated = typeof generatedPct === 'number' && Number.isFinite(generatedPct) ? generatedPct : 0;
                  results.coverageDelta = results.coverageGenerated - (results.coverageBaseline || 0);
                  
                  if (process.env.DEBUG_COVERAGE) {
                    console.log(`[DEBUG] Coverage from test run: baseline=${results.coverageBaseline}%, generated=${results.coverageGenerated}%, delta=${results.coverageDelta}%`);
                  }
                }
              } catch (e) {
                if (process.env.DEBUG_COVERAGE) {
                  console.log(`[DEBUG] Error reading coverage from test run: ${e.message}`);
                }
              }
            }
            
            if (!results.passes && results.logPath) {
              results.errors.push(`Full log: ${results.logPath}`);
            }
          } catch (error) {
            results.runs = true;
            // Handle ENOBUFS and other buffer-related errors
            if (error.message && error.message.includes('ENOBUFS')) {
              results.errors.push(`Test execution: Output buffer exceeded. Test file may be too large or produce too much output.`);
            } else {
              const output = (error.stdout || error.stderr || error.message || '').toString();
              const passMatch = output.match(/(?:Tests?:?\s+)?(\d+)\s+passed/i);
              const failMatch = output.match(/(?:Tests?:?\s+)?(\d+)\s+failed/i);
              
              if (passMatch) results.passCount = parseInt(passMatch[1]);
              if (failMatch) results.failCount = parseInt(failMatch[1]);
              
              // If test suite passed but no explicit count, use testCount
              if (!passMatch && output.includes('PASS') && !output.includes('FAIL')) {
                results.passCount = results.testCount || 1;
              }
              
              results.passes = results.failCount === 0 && results.passCount > 0;
              
              if (!results.passes) {
                const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
                results.errors.push(`Test execution: ${errorMsg}`);
              }
            }
          }
        } else if (testType === 'integration') {
          // Run server tests (with coverage if requested)
          try {
            // Use temporary file to avoid buffer limitations
            const outputFile = path.join(projectRoot, '.test-output.tmp');
            const testFileName = path.basename(testFilePath);
            
            let baselinePct = 0;
            let generatedPct = 0;
            const sourceFile = COMPUTE_COVERAGE && computeCoverage ? getSourceFileForTest(testFilePath, testType) : null;
            
            // Step 1: Compute baseline coverage (WITHOUT this test)
            if (COMPUTE_COVERAGE && computeCoverage && sourceFile) {
              const sourceFilePath = path.join(projectRoot, sourceFile);
              if (fsSync.existsSync(sourceFilePath)) {
                // Temporarily rename test to exclude it from baseline
                const tempTestPath = targetPath + '.tmp.exclude';
                let testWasRenamed = false;
                try {
                  if (fsSync.existsSync(targetPath)) {
                    await fs.rename(targetPath, tempTestPath);
                    testWasRenamed = true;
                  }
                  
                  // Run all tests with coverage (this test is excluded because it's renamed)
                  const baselineCoverageTs = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                  const baselineCoverageDir = path.join(projectRoot, '.coverage-tmp', 'integration', baselineCoverageTs);
                  fsSync.mkdirSync(baselineCoverageDir, { recursive: true });
                  const baselineCoverageDirRel = path.relative(projectRoot, baselineCoverageDir);
                  
                  const baselineCmd = `cd ${projectRoot} && npm run test:server -- --coverage --coverageReporters=json-summary --coverageDirectory "${baselineCoverageDirRel}" --passWithNoTests`;
                  
                  try {
                    execSync(`${baselineCmd} > "${outputFile}.baseline" 2>&1 || true`, { encoding: 'utf-8', timeout: 180000, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    baselinePct = readCoverageSummaryPct(baselineCoverageDir, sourceFile);
                  } catch (e) {
                    baselinePct = 0;
                  }
                } catch (e) {
                  baselinePct = 0;
                } finally {
                  // Restore test file
                  if (testWasRenamed && fsSync.existsSync(tempTestPath)) {
                    await fs.rename(tempTestPath, targetPath).catch(() => {});
                  }
                }
                results.coverageBaseline = baselinePct;
                results.coverageSourceFile = sourceFile;
              }
            }
            
            // Step 2: Run this specific test with coverage
            // Build test command with coverage if requested
            let testCmd = `cd ${projectRoot} && npm run test:server -- --testPathPattern="${testFileName}"`;
            
            if (COMPUTE_COVERAGE && computeCoverage) {
              // Create unique coverage directory for this test run
              const coverageTs = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
              const coverageDir = path.join(projectRoot, '.coverage-tmp', 'integration', coverageTs);
              fsSync.mkdirSync(coverageDir, { recursive: true });
              const coverageDirRel = path.relative(projectRoot, coverageDir);
              testCmd += ` --coverage --coverageReporters=json-summary --coverageDirectory "${coverageDirRel}"`;
              
              // Store coverage directory for later reading
              results._coverageDir = coverageDir;
            }
            
            try {
              // Run test and capture output to file
              // Use || true to ensure command doesn't fail even if tests fail
              execSync(
                `${testCmd} > "${outputFile}" 2>&1 || true`,
                { encoding: 'utf-8', timeout: 60000, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
              );
            } catch (execError) {
              // Command may have failed, but output file might still exist
              // Don't throw - we'll read the output file anyway
            }
            
            let output = '';
            try {
              output = await fs.readFile(outputFile, 'utf-8');
              await fs.unlink(outputFile).catch(() => {}); // Clean up
            } catch (readError) {
              // Output file doesn't exist or couldn't be read
              output = '';
            }
            
            // Check if we actually got output (test ran)
            if (output.length === 0) {
              results.runs = false;
              results.errors.push('Test did not produce any output');
              return results; // Exit early if no output
            }
            
            // Persist raw Jest output for debugging (similar to e2e)
            try {
              const evalLogDir = path.join(path.dirname(testFilePath), '.eval-logs');
              await fs.mkdir(evalLogDir, { recursive: true });
              const evalLogPath = path.join(evalLogDir, `${path.basename(testFilePath)}.jest.log`);
              await fs.writeFile(evalLogPath, output, 'utf-8');
              results.logPath = evalLogPath.replace(projectRoot + path.sep, '');
            } catch (e) {
              // ignore log write errors
            }
            
            results.runs = true;
            
            // Debug: Log a snippet of output to help troubleshoot (remove after fixing)
            // console.log('Integration test output snippet:', output.substring(0, 500));
            
            // Parse test results - Jest output format can be:
            // "Tests: 7 passed, 7 total" (all passed)
            // "Tests: 1 failed, 7 passed, 8 total" (some failed - failed comes first)
            // "Tests: 7 passed, 1 failed, 8 total" (some failed - passed comes first, less common)
            // "7 passed, 1 failed, 8 total" (without "Tests:" prefix)
            // "PASS" or "FAIL" with counts elsewhere
            
            // Try multiple patterns to match Jest output
            // First try: "Tests: X failed, Y passed, Z total" (failed first - most common when failures exist)
            let passMatch = output.match(/Tests:\s+(?:\d+\s+failed,\s+)?(\d+)\s+passed/i);
            let failMatch = output.match(/Tests:\s+(\d+)\s+failed(?:,\s+\d+\s+passed)?/i);
            let totalMatch = output.match(/Tests:.*?(\d+)\s+total/i);
            
            // If not found, try: "Tests: X passed, Y failed, Z total" (passed first)
            if (!passMatch) {
              passMatch = output.match(/Tests:\s+(\d+)\s+passed(?:,\s+\d+\s+failed)?/i);
            }
            if (!failMatch) {
              failMatch = output.match(/Tests:.*?(\d+)\s+failed/i);
            }
            
            // If still not found with "Tests:" prefix, try without prefix
            if (!passMatch) {
              passMatch = output.match(/(\d+)\s+passed(?:,\s+\d+\s+failed)?(?:,\s+\d+\s+total)?/i);
            }
            if (!failMatch) {
              failMatch = output.match(/(\d+)\s+failed/i);
            }
            if (!totalMatch) {
              totalMatch = output.match(/(\d+)\s+total/i);
            }
            
            if (passMatch) {
              results.passCount = parseInt(passMatch[1]);
            }
            if (failMatch) {
              results.failCount = parseInt(failMatch[1]);
            }
            
            // If test suite passed but no explicit count found, check for PASS status
            if (!passMatch && output.includes('PASS') && !output.includes('FAIL')) {
              // Try to extract from test count if available
              if (results.testCount > 0) {
                results.passCount = results.testCount;
              } else if (totalMatch) {
                results.passCount = parseInt(totalMatch[1]);
              } else {
                results.passCount = 1; // At least one test passed
              }
            }
            
            // If we have a total but no pass/fail counts, try to infer from testCount
            if (totalMatch && !passMatch && !failMatch && results.testCount > 0) {
              const total = parseInt(totalMatch[1]);
              if (output.includes('PASS') && !output.includes('FAIL')) {
                results.passCount = total;
              } else if (output.includes('FAIL')) {
                // If it failed, we can't infer pass count without more info
                // But we know total, so if testCount matches, use it
                if (results.testCount === total) {
                  // Can't determine pass/fail split without more info
                }
              }
            }
            
            results.passes = results.failCount === 0 && results.passCount > 0;
            
            // Read coverage from test run if available
            if (COMPUTE_COVERAGE && computeCoverage && results._coverageDir) {
              try {
                const sourceFile = results.coverageSourceFile || getSourceFileForTest(testFilePath, testType);
                if (sourceFile) {
                  // Wait for Jest to finish writing coverage files
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  generatedPct = readCoverageSummaryPct(results._coverageDir, sourceFile);
                  results.coverageGenerated = typeof generatedPct === 'number' && Number.isFinite(generatedPct) ? generatedPct : 0;
                  results.coverageDelta = results.coverageGenerated - (results.coverageBaseline || 0);
                  
                  if (process.env.DEBUG_COVERAGE) {
                    console.log(`[DEBUG] Coverage from test run (integration): baseline=${results.coverageBaseline}%, generated=${results.coverageGenerated}%, delta=${results.coverageDelta}%`);
                  }
                }
              } catch (e) {
                if (process.env.DEBUG_COVERAGE) {
                  console.log(`[DEBUG] Error reading coverage from test run (integration): ${e.message}`);
                }
              }
            }
            
            if (!results.passes && results.logPath) {
              results.errors.push(`Full log: ${results.logPath}`);
            }
          } catch (error) {
            // Try to read output file even if execSync threw an error
            let output = '';
            try {
              output = await fs.readFile(outputFile, 'utf-8');
              await fs.unlink(outputFile).catch(() => {}); // Clean up
            } catch (readError) {
              // If file doesn't exist, try to get output from error
              output = (error.stdout || error.stderr || error.message || '').toString();
            }
            
            if (output.length > 0) {
              results.runs = true;
              
              // Parse test results from output
              const passMatch = output.match(/Tests:\s+(\d+)\s+passed/i) || 
                               output.match(/(\d+)\s+passed(?:,\s+\d+\s+failed)?(?:,\s+\d+\s+total)?/i);
              const failMatch = output.match(/Tests:\s+\d+\s+passed,\s+(\d+)\s+failed/i) || 
                               output.match(/(\d+)\s+failed/i);
              const totalMatch = output.match(/Tests:\s+\d+\s+passed(?:,\s+\d+\s+failed)?,\s+(\d+)\s+total/i) ||
                                output.match(/(\d+)\s+total/i);
              
              if (passMatch) results.passCount = parseInt(passMatch[1]);
              if (failMatch) results.failCount = parseInt(failMatch[1]);
              
              // If test suite passed but no explicit count, use testCount
              if (!passMatch && output.includes('PASS') && !output.includes('FAIL')) {
                if (results.testCount > 0) {
                  results.passCount = results.testCount;
                } else if (totalMatch) {
                  results.passCount = parseInt(totalMatch[1]);
                } else {
                  results.passCount = 1;
                }
              }
              
              results.passes = results.failCount === 0 && results.passCount > 0;
            } else {
              results.runs = false;
            }
            
            if (!results.passes && results.runs) {
              const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
              results.errors.push(`Test execution: ${errorMsg}`);
              if (results.logPath) {
                results.errors.push(`Full log: ${results.logPath}`);
              }
            }
          }
        } else if (testType === 'e2e') {
          // Run Playwright E2E tests (with coverage if requested)
          try {
            const outputFile = path.join(projectRoot, '.test-output.e2e.tmp');
            const repoDir = projectRoot;
            const e2eRelativePath = path.posix.join('tests/e2e', testFileName);
            const pwRunner = getPlaywrightRunnerIdentity();
            const pwArtifactsDir = getPlaywrightArtifactsDir(pwRunner);

            let baselinePct = 0;
            let generatedPct = 0;
            const sourceFile = COMPUTE_COVERAGE && computeCoverage ? getSourceFileForTest(testFilePath, testType) : null;
            
            // Step 1: Compute baseline coverage (WITHOUT this test)
            // For E2E, we need to run the app with coverage, run all other E2E tests, then collect coverage
            if (COMPUTE_COVERAGE && computeCoverage && sourceFile) {
              const sourceFilePath = path.join(projectRoot, sourceFile);
              if (fsSync.existsSync(sourceFilePath)) {
                // Temporarily rename test to exclude it from baseline
                const tempTestPath = targetPath + '.tmp.exclude';
                let testWasRenamed = false;
                try {
                  if (fsSync.existsSync(targetPath)) {
                    await fs.rename(targetPath, tempTestPath);
                    testWasRenamed = true;
                  }
                  
                  // Run all E2E tests with coverage (this test is excluded because it's renamed)
                  // For E2E coverage, we use Playwright's Coverage API (Chromium only) or vite-plugin-istanbul
                  // For simplicity, we'll use Playwright's built-in coverage API
                  const baselineCoverageTs = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                  const baselineCoverageDir = path.join(projectRoot, '.coverage-tmp', 'e2e', baselineCoverageTs);
                  fsSync.mkdirSync(baselineCoverageDir, { recursive: true });
                  
                  // Run all E2E tests (excluding this one) and collect coverage
                  // Note: Playwright coverage API only works with Chromium
                  const baselineCmd = `cd ${projectRoot} && npx --no-install playwright test --reporter=line --output "${pwArtifactsDir}" --project=chromium --passWithNoTests || true`;
                  
                  try {
                    execSync(`${baselineCmd} > "${outputFile}.baseline" 2>&1`, {
                      encoding: 'utf-8',
                      timeout: 180000,
                      stdio: 'pipe',
                      maxBuffer: 10 * 1024 * 1024,
                      env: {
                        ...process.env,
                        ...(pwRunner.runAsUser ? {} : { HOME: getSafeHomeForPlaywright() }),
                      },
                    });
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // For E2E baseline coverage, we cannot collect real coverage without modifying tests
                    // Set baseline to 0% as placeholder
                    if (process.env.DEBUG_COVERAGE) {
                      console.log(`[DEBUG] E2E baseline coverage: sourceFile=${sourceFile}`);
                      console.log(`[DEBUG] E2E baseline coverage: Cannot collect real E2E coverage without test modification. Setting to 0%.`);
                    }
                    baselinePct = 0;
                  } catch (e) {
                    baselinePct = 0;
                  }
                } catch (e) {
                  baselinePct = 0;
                } finally {
                  // Restore test file
                  if (testWasRenamed && fsSync.existsSync(tempTestPath)) {
                    await fs.rename(tempTestPath, targetPath).catch(() => {});
                  }
                }
                results.coverageBaseline = baselinePct;
                results.coverageSourceFile = sourceFile;
              }
            }

            // Step 2: Run this specific E2E test with coverage
            try {
              // Use a simple reporter we can parse from stdout.
              // NOTE: Playwright config may run multiple projects (chromium/firefox/webkit),
              // so counts can be > number of test() blocks in the file.
              let basePlaywrightCmd = `npx --no-install playwright test --reporter=line --output "${pwArtifactsDir}" "${e2eRelativePath}"`;
              
              // Add coverage collection if requested
              if (COMPUTE_COVERAGE && computeCoverage) {
                const coverageTs = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
                const coverageDir = path.join(projectRoot, '.coverage-tmp', 'e2e', coverageTs);
                fsSync.mkdirSync(coverageDir, { recursive: true });
                results._coverageDir = coverageDir;
                
                // Use Chromium project only for coverage (Playwright Coverage API only works with Chromium)
                // Set E2E_COVERAGE_DIR environment variable so Playwright fixture can collect coverage
                basePlaywrightCmd = `npx --no-install playwright test --reporter=line --output "${pwArtifactsDir}" --project=chromium "${e2eRelativePath}"`;
              }
              
              const playwrightCmd = wrapCommandForUser(basePlaywrightCmd, repoDir, pwRunner);

              execSync(
                // IMPORTANT:
                // - run from repo root so E2E tests are resolved from tests/e2e
                // - use npx --no-install to force local @playwright/test from this repo
                `{ ${playwrightCmd}; echo "__PW_EXIT_CODE__$?"; } > "${outputFile}" 2>&1`,
                {
                  encoding: 'utf-8',
                  timeout: 180000,
                  stdio: 'pipe',
                  maxBuffer: 10 * 1024 * 1024,
                  env: {
                    ...process.env,
                    // Set E2E_COVERAGE_DIR so Playwright fixture can collect coverage automatically
                    ...(results._coverageDir ? { E2E_COVERAGE_DIR: results._coverageDir } : {}),
                    // If we are truly root (no sudo user), use a root-owned HOME.
                    // If we are running Playwright under the original sudo user, do not override HOME.
                    ...(pwRunner.runAsUser ? {} : { HOME: getSafeHomeForPlaywright() }),
                  },
                }
              );
            } catch (execError) {
              // Command may have failed, but output file might still exist
            }

            let output = '';
            try {
              output = await fs.readFile(outputFile, 'utf-8');
              await fs.unlink(outputFile).catch(() => {}); // Clean up
            } catch (readError) {
              output = '';
            }

            if (output.length === 0) {
              results.runs = false;
              results.errors.push('E2E test did not produce any output');
              return results;
            }

            results.runs = true;

            // Persist raw Playwright output for debugging
            try {
              const evalLogDir = path.join(path.dirname(testFilePath), '.eval-logs');
              await fs.mkdir(evalLogDir, { recursive: true });
              const evalLogPath = path.join(evalLogDir, `${path.basename(testFilePath)}.playwright.log`);
              await fs.writeFile(evalLogPath, output, 'utf-8');
              results.logPath = evalLogPath.replace(projectRoot + path.sep, '');
            } catch (e) {
              // ignore log write errors
            }

            // Extract exit code marker (so we can detect infra failures even without summary)
            const exitCodeMatch = output.match(/__PW_EXIT_CODE__(\d+)/);
            const pwExitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : null;

            // Parse Playwright summary (best effort)
            const failMatch = output.match(/(\d+)\s+failed/i);
            const passMatch = output.match(/(\d+)\s+passed/i);
            const skippedMatch = output.match(/(\d+)\s+skipped/i);
            const flakyMatch = output.match(/(\d+)\s+flaky/i);

            if (passMatch) results.passCount = parseInt(passMatch[1], 10);
            if (failMatch) results.failCount = parseInt(failMatch[1], 10);

            const parsedSkipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
            const parsedFlaky = flakyMatch ? parseInt(flakyMatch[1], 10) : 0;

            // If we got counts from output, prefer them over the static regex-based count
            if (passMatch || failMatch || skippedMatch || flakyMatch) {
              const total = (results.passCount || 0) + (results.failCount || 0) + parsedSkipped + parsedFlaky;
              if (total > 0) results.testCount = total;
            }

            results.passes = results.failCount === 0 && results.passCount > 0;

            if (!results.passes && (results.failCount || 0) > 0) {
              results.errors.push(`E2E failures: ${results.failCount}`);
            }

            // Extract a short root-cause snippet for console report
            results.rootCause = extractPlaywrightRootCause(output);
            if (results.rootCause) {
              results.errors.push(`Root cause:\n${results.rootCause}`);
            }
            
            // Read coverage from test run if available
            // For E2E tests, we use Playwright Coverage API to collect real browser coverage
            // We run the test with coverage collection enabled via a wrapper script
            if (COMPUTE_COVERAGE && computeCoverage && results._coverageDir) {
              try {
                const sourceFile = results.coverageSourceFile || getSourceFileForTest(testFilePath, testType);
                
                if (process.env.DEBUG_COVERAGE) {
                  console.log(`[DEBUG] E2E coverage: testFilePath=${testFilePath}, sourceFile=${sourceFile}, coverageDir=${results._coverageDir}`);
                }
                
                if (sourceFile) {
                  // Wait for test to complete and coverage files to be written
                  await new Promise(resolve => setTimeout(resolve, 5000));
                  
                  // Collect coverage using Playwright Coverage API
                  // The coverage should be collected by the test-with-coverage fixture
                  
                  // Check for Playwright coverage files
                  const coverageFiles = [];
                  try {
                    if (process.env.DEBUG_COVERAGE) {
                      console.log(`[DEBUG] Checking coverage directory: ${results._coverageDir}`);
                    }
                    
                    if (fsSync.existsSync(results._coverageDir)) {
                      const files = fsSync.readdirSync(results._coverageDir);
                      if (process.env.DEBUG_COVERAGE) {
                        console.log(`[DEBUG] Files in coverage directory: ${files.join(', ')}`);
                      }
                      coverageFiles.push(...files.filter(f => f.startsWith('coverage-') && f.endsWith('.json')));
                    } else {
                      if (process.env.DEBUG_COVERAGE) {
                        console.log(`[DEBUG] Coverage directory does not exist: ${results._coverageDir}`);
                      }
                    }
                  } catch (e) {
                    if (process.env.DEBUG_COVERAGE) {
                      console.log(`[DEBUG] Error reading coverage directory: ${e.message}`);
                    }
                  }
                  
                  if (coverageFiles.length > 0) {
                    // Process Playwright coverage files
                    let totalCoverage = 0;
                    let coverageCount = 0;
                    
                    for (const coverageFile of coverageFiles) {
                      const coveragePath = path.join(results._coverageDir, coverageFile);
                      try {
                        const coveragePct = await processPlaywrightCoverage(coveragePath, sourceFile, results._coverageDir);
                        if (typeof coveragePct === 'number' && Number.isFinite(coveragePct)) {
                          totalCoverage += coveragePct;
                          coverageCount++;
                        }
                      } catch (e) {
                        if (process.env.DEBUG_COVERAGE) {
                          console.log(`[DEBUG] Error processing coverage file ${coverageFile}: ${e.message}`);
                        }
                      }
                    }
                    
                    generatedPct = coverageCount > 0 ? totalCoverage / coverageCount : 0;
                    results.coverageGenerated = generatedPct;
                    results.coverageDelta = results.coverageGenerated - (results.coverageBaseline || 0);
                    
                    if (process.env.DEBUG_COVERAGE) {
                      console.log(`[DEBUG] E2E coverage: Found ${coverageFiles.length} coverage files, average coverage=${generatedPct}%`);
                      console.log(`[DEBUG] Coverage from E2E test run: baseline=${results.coverageBaseline}%, generated=${results.coverageGenerated}%, delta=${results.coverageDelta}%`);
                    }
                  } else {
                    // No coverage files found - coverage wasn't collected
                    // This means we need to run the test with coverage collection
                    // For now, set to 0 as placeholder
                    if (process.env.DEBUG_COVERAGE) {
                      console.log(`[DEBUG] E2E coverage: No coverage files found. Coverage collection needs to be integrated.`);
                    }
                    results.coverageGenerated = 0;
                    results.coverageDelta = 0;
                  }
                } else {
                  if (process.env.DEBUG_COVERAGE) {
                    console.log(`[DEBUG] E2E coverage: sourceFile is null, cannot compute coverage`);
                  }
                }
              } catch (e) {
                if (process.env.DEBUG_COVERAGE) {
                  console.log(`[DEBUG] Error reading E2E coverage: ${e.message}`);
                  console.log(`[DEBUG] Error stack: ${e.stack}`);
                }
              }
            }
            
            if (results.logPath) {
              results.errors.push(`Full log: ${results.logPath}`);
            }

            // If we couldn't parse passed/failed counts, fallback to exit code marker.
            // This covers cases like webServer EPERM where Playwright exits before running tests.
            if (!passMatch && !failMatch) {
              if (pwExitCode !== null && pwExitCode !== 0) {
                results.failCount = Math.max(results.failCount || 0, 1);
                results.passes = false;
                results.errors.push('E2E run failed before producing a test summary (see output above for details)');
              } else {
                results.errors.push('Could not parse Playwright summary (no passed/failed counts found)');
              }
            }
          } catch (error) {
            results.runs = true;
            const errorMsg = error.message ? error.message.substring(0, 200) : 'Unknown error';
            results.errors.push(`E2E execution: ${errorMsg}`);
          }
        }
        
        // Clean up temporary file
        try {
          await fs.unlink(targetPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      } catch (error) {
        results.errors.push(`Execution error: ${error.message}`);
      }
    } catch (error) {
      results.errors.push(`Read error: ${error.message}`);
    }
  } catch (error) {
    results.errors.push(`File not found: ${testFilePath}`);
  }

  return results;
}

function stripMarkdownCodeFences(content) {
  let out = content;
  out = out.replace(/^```(?:javascript|js|ts|tsx|jsx)?\n?/gm, '');
  out = out.replace(/\n?```$/gm, '');
  return out.trim();
}

function getExecTargetPathForType(testType, testFilePath) {
  const testFileName = path.basename(testFilePath);
  if (testType === 'unit') {
    if (testFileName.includes('Form') || testFileName.includes('List')) {
      return path.join(projectRoot, 'client', 'src', 'components', '__tests__', testFileName);
    }
    return path.join(projectRoot, 'client', 'src', 'utils', '__tests__', testFileName);
  }
  if (testType === 'integration') {
    if (testFileName.includes('api') || testFilePath.includes('api')) {
      return path.join(projectRoot, 'server', '__tests__', testFileName);
    }
    return path.join(projectRoot, 'server', 'utils', '__tests__', testFileName);
  }
  if (testType === 'e2e') {
    return path.join(projectRoot, 'tests', 'e2e', testFileName);
  }
  return null;
}

function sanitizeForFilename(input) {
  return String(input)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

async function withTemporaryTestCopies(testType, sourceResults, fn, options = {}) {
  const { uniqueNames = false } = options;
  const touched = [];
  const backups = new Map(); // path -> string|null
  try {
    for (const item of sourceResults) {
      try {
        const src = item.file;
        const originalBase = path.basename(src);
        const baseTarget = getExecTargetPathForType(testType, src);
        if (!baseTarget) continue;

        const targetDir = path.dirname(baseTarget);
        const targetBase = uniqueNames
          ? `${sanitizeForFilename(item.model || 'unknown')}__${originalBase}`
          : originalBase;
        const targetPath = path.join(targetDir, targetBase);

        // Backup existing file if present
        try {
          const existing = await fs.readFile(targetPath, 'utf-8');
          backups.set(targetPath, existing);
        } catch (e) {
          backups.set(targetPath, null);
        }

        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        let content = await fs.readFile(src, 'utf-8');
        content = stripMarkdownCodeFences(content);

        // E2E: normalize localhost (same logic as main execution)
        if (testType === 'e2e') {
          content = content
            .replace(/http:\/\/localhost:3000/g, 'http://127.0.0.1:3000')
            .replace(/http:\/\/localhost:3001/g, 'http://127.0.0.1:3001');
        }

        await fs.writeFile(targetPath, content, 'utf-8');
        touched.push(targetPath);
      } catch (e) {
        // Skip files that cannot be copied/prepared for coverage
        continue;
      }
    }

    return await fn();
  } finally {
    // Restore backups
    for (const p of touched) {
      const prev = backups.get(p);
      if (typeof prev === 'string') {
        // eslint-disable-next-line no-await-in-loop
        await fs.writeFile(p, prev, 'utf-8');
      } else {
        // eslint-disable-next-line no-await-in-loop
        await fs.unlink(p).catch(() => {});
      }
    }
  }
}

function readCoverageSummaryPct(coverageDir, sourceFile = null) {
  try {
    // Jest may create coverage-summary.json directly in coverageDir or in a subdirectory
    // Try direct path first
    let summaryPath = path.join(coverageDir, 'coverage-summary.json');
    if (!fsSync.existsSync(summaryPath)) {
      // Try to find it recursively (Jest might create it in a subdirectory)
      const findSummary = (dir) => {
        try {
          const items = fsSync.readdirSync(dir);
          for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = fsSync.statSync(itemPath);
            if (stat.isFile() && item === 'coverage-summary.json') {
              return itemPath;
            }
            if (stat.isDirectory()) {
              const found = findSummary(itemPath);
              if (found) return found;
            }
          }
        } catch (e) {
          // ignore
        }
        return null;
      };
      const found = findSummary(coverageDir);
      if (found) summaryPath = found;
    }
    
    if (!fsSync.existsSync(summaryPath)) {
      if (process.env.DEBUG_COVERAGE) {
        console.log(`[DEBUG] coverage-summary.json not found in ${coverageDir}, returning 0`);
      }
      return 0; // Return 0 instead of null if file doesn't exist
    }
    
    const raw = fsSync.readFileSync(summaryPath, 'utf-8');
    const json = JSON.parse(raw);
    
    // Try to get coverage for specific source file if provided
    let pct = null;
    
    if (sourceFile && json && typeof json === 'object') {
      // Try to find the source file in coverage data
      // sourceFile is like "client/src/components/FeedbackForm.jsx"
      // Coverage keys are absolute paths like "/Users/.../client/src/components/FeedbackForm.jsx"
      const sourceFileAbs = path.resolve(projectRoot, sourceFile);
      const sourceFileBase = path.basename(sourceFile);
      const sourceFileRel = sourceFile.replace(/\\/g, '/');
      const sourceFileAbsNormalized = sourceFileAbs.replace(/\\/g, '/');
      
      // Try multiple matching strategies
      // Coverage keys are absolute paths like "/Users/.../client/src/components/FeedbackForm.jsx"
      const sourceFileKeys = Object.keys(json).filter(k => {
        if (k === 'total') return false;
        const kNormalized = k.replace(/\\/g, '/');
        // Match by:
        // 1. Exact absolute path match (normalized) - most reliable
        // 2. Ends with relative path from project root
        // 3. Contains filename and matching directory structure
        const exactMatch = kNormalized === sourceFileAbsNormalized;
        const endsWithRel = kNormalized.endsWith('/' + sourceFileRel) || kNormalized.endsWith(sourceFileRel);
        const filenameMatch = kNormalized.includes(sourceFileBase) && 
                ((sourceFileRel.includes('components') && kNormalized.includes('components')) ||
                 (sourceFileRel.includes('utils') && kNormalized.includes('utils')) ||
                 (sourceFileRel.includes('server') && kNormalized.includes('server')));
        return exactMatch || endsWithRel || filenameMatch;
      });
      
      if (sourceFileKeys.length > 0) {
        // Use the first matching source file (prefer exact match)
        const exactMatch = sourceFileKeys.find(k => {
          const kNorm = k.replace(/\\/g, '/');
          return kNorm === sourceFileAbsNormalized || kNorm.endsWith('/' + sourceFileRel);
        });
        const sourceKey = exactMatch || sourceFileKeys[0];
        pct = json[sourceKey]?.lines?.pct;
        
        if (process.env.DEBUG_COVERAGE) {
          console.log(`[DEBUG] Found coverage for ${sourceFile}: key=${sourceKey}, pct=${pct}`);
        }
      } else {
        // If no match found, try to use total coverage
        // This can happen if collectCoverageFrom includes multiple files or Jest aggregates
        pct = json?.total?.lines?.pct;
      }
    } else {
      // No sourceFile specified, use total
      pct = json?.total?.lines?.pct;
    }
    
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      return pct;
    }
    if (typeof pct === 'string' && pct.toLowerCase() === 'unknown') {
      return 0;
    }
    // If we couldn't find coverage for specific file, try to use total coverage as fallback
    // This can happen if collectCoverageFrom includes multiple files or Jest aggregates
    if (sourceFile && json?.total?.lines?.pct !== undefined) {
      const totalPct = json.total.lines.pct;
      if (typeof totalPct === 'number' && Number.isFinite(totalPct)) {
        if (process.env.DEBUG_COVERAGE) {
          console.log(`[DEBUG] Using total coverage ${totalPct}% for ${sourceFile} (specific file not found)`);
        }
        return totalPct;
      }
    }
    // If we still couldn't find coverage, return 0 instead of null to show something
    // This helps debug - if we see 0, we know coverage was computed but file wasn't found
    // If we see null, coverage computation failed
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Coverage not found for ${sourceFile || 'total'} in ${coverageDir}, returning 0`);
    }
    return 0; // Return 0 instead of null to ensure we always have a number
  } catch (e) {
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Error reading coverage from ${coverageDir}: ${e.message}`);
    }
    return 0; // Return 0 instead of null
  }
}

function runCoverageForType(testType, label) {
  const ts = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  // IMPORTANT: keep coverage output inside workspace (sandbox write restriction)
  const outDir = path.join(projectRoot, '.coverage-tmp', testType, String(ts));
  fsSync.mkdirSync(outDir, { recursive: true });

  const logPath = path.join(outDir, `run-${label}.log`);

  if (testType === 'unit') {
    try {
      execSync(
        `cd "${path.join(projectRoot, 'client')}" && npm test -- --coverage --coverageReporters=json-summary --coverageDirectory "${outDir}" --passWithNoTests > "${logPath}" 2>&1 || true`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      // ignore
    }
    return { pct: readCoverageSummaryPct(outDir), outDir };
  }

  if (testType === 'integration') {
    try {
      execSync(
        `cd "${projectRoot}" && npm run test:server -- --coverage --coverageReporters=json-summary --coverageDirectory "${outDir}" --passWithNoTests > "${logPath}" 2>&1 || true`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      // ignore
    }
    return { pct: readCoverageSummaryPct(outDir), outDir };
  }

  // E2E coverage not supported in this harness (requires instrumentation)
  return { pct: null, outDir: null };
}

async function computeCoverageDeltaByType(results) {
  const out = {};
  if (!COMPUTE_COVERAGE) return out;

  for (const type of ['unit', 'integration']) {
    // Baseline coverage (current repo state)
    let baselinePct = null;
    let generatedPct = null;
    try {
      const baseline = runCoverageForType(type, 'baseline');
      baselinePct = baseline.pct;
      out[type] = out[type] || {};
      out[type].baselineLogDir = baseline.outDir ? baseline.outDir.replace(projectRoot + path.sep, '') : null;
    } catch (e) {
      baselinePct = null;
    }

    const sources = results
      .filter(r => r.type === type && r.exists)
      .map(r => ({ file: r.file, model: r.model }));

    try {
      generatedPct = await withTemporaryTestCopies(
        type,
        sources,
        async () => {
          const generated = runCoverageForType(type, 'generated');
          out[type] = out[type] || {};
          out[type].generatedLogDir = generated.outDir ? generated.outDir.replace(projectRoot + path.sep, '') : null;
          return generated.pct;
        },
        { uniqueNames: true }
      );
    } catch (e) {
      generatedPct = null;
    }

    const b = typeof baselinePct === 'number' ? baselinePct : 0;
    const g = typeof generatedPct === 'number' ? generatedPct : null;
    out[type] = {
      ...(out[type] || {}),
      baselineLinesPct: typeof baselinePct === 'number' ? baselinePct : null,
      generatedLinesPct: g,
      deltaLinesPct: g === null ? null : (g - b),
    };
  }

  out.e2e = { baselineLinesPct: null, generatedLinesPct: null, deltaLinesPct: null };
  return out;
}

/**
 * Determine which source file a test file is testing
 */
/**
 * Process Playwright coverage data and convert to Istanbul format
 * Returns coverage percentage for the specified source file
 */
async function processPlaywrightCoverage(coverageFile, sourceFile, outputDir) {
  try {
    const coverageData = JSON.parse(fsSync.readFileSync(coverageFile, 'utf-8'));
    
    // Find coverage entry for the source file
    const sourceFileAbs = path.resolve(projectRoot, sourceFile);
    const sourceFileBase = path.basename(sourceFile);
    const sourceFileRel = sourceFile.replace(/\\/g, '/');
    
    let matchedEntry = null;
    let maxMatchScore = 0;
    
    for (const entry of coverageData) {
      if (!entry.url || !entry.source) continue;
      
      // Extract file path from URL
      // URL format: http://127.0.0.1:3000/src/components/FeedbackForm.jsx
      let filePath = entry.url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
      
      // Map to actual file system path
      if (filePath.startsWith('src/')) {
        filePath = `client/${filePath}`;
      }
      
      // Calculate match score
      const filePathAbs = path.resolve(projectRoot, filePath);
      const filePathBase = path.basename(filePath);
      
      let score = 0;
      if (filePathAbs === sourceFileAbs) score = 100; // Exact match
      else if (filePath.endsWith('/' + sourceFileRel) || filePath === sourceFileRel) score = 90;
      else if (filePathBase === sourceFileBase && filePath.includes(sourceFileRel.split('/').slice(-2).join('/'))) score = 80;
      else if (filePathBase === sourceFileBase) score = 50;
      
      if (score > maxMatchScore) {
        maxMatchScore = score;
        matchedEntry = entry;
      }
    }
    
    if (!matchedEntry) {
      return 0;
    }
    
    // Calculate coverage percentage
    const source = matchedEntry.source;
    const ranges = matchedEntry.ranges || [];
    
    // Count total lines
    const totalLines = source.split('\n').length;
    
    // Count covered lines
    const coveredLines = new Set();
    for (const range of ranges) {
      const startLine = source.substring(0, range.startOffset).split('\n').length - 1;
      const endLine = source.substring(0, range.endOffset).split('\n').length - 1;
      for (let i = startLine; i <= endLine; i++) {
        coveredLines.add(i);
      }
    }
    
    const coveredLinesCount = coveredLines.size;
    const coveragePct = totalLines > 0 ? (coveredLinesCount / totalLines) * 100 : 0;
    
    // Also save in Istanbul format for consistency
    const istanbulCoverage = {
      total: {
        lines: { total: totalLines, covered: coveredLinesCount, skipped: 0, pct: coveragePct },
        statements: { total: totalLines, covered: coveredLinesCount, skipped: 0, pct: coveragePct },
        functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
      },
      [sourceFileAbs]: {
        lines: { total: totalLines, covered: coveredLinesCount, skipped: 0, pct: coveragePct },
        statements: { total: totalLines, covered: coveredLinesCount, skipped: 0, pct: coveragePct },
        functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
        branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
      }
    };
    
    const istanbulFile = path.join(outputDir, 'coverage-summary.json');
    fsSync.writeFileSync(istanbulFile, JSON.stringify(istanbulCoverage, null, 2));
    
    return coveragePct;
  } catch (e) {
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Error processing Playwright coverage: ${e.message}`);
    }
    return 0;
  }
}

function getSourceFileForTest(testFilePath, testType) {
  const testFileName = path.basename(testFilePath);
  
  if (testType === 'unit') {
    if (testFileName.includes('FeedbackForm')) {
      return 'client/src/components/FeedbackForm.jsx';
    } else if (testFileName.includes('FeedbackList')) {
      return 'client/src/components/FeedbackList.jsx';
    } else if (testFileName.includes('validation')) {
      return 'client/src/utils/validation.js';
    } else if (testFileName.includes('api')) {
      return 'client/src/utils/api.js';
    } else if (testFileName.includes('format')) {
      return 'client/src/utils/format.js';
    }
  } else if (testType === 'integration') {
    if (testFileName.includes('api')) {
      // Integration API tests cover server/index.js (API endpoints)
      return 'server/index.js';
    } else if (testFileName.includes('validation')) {
      return 'server/utils/validation.js';
    } else if (testFileName.includes('storage')) {
      return 'server/utils/storage.js';
    }
  } else if (testType === 'e2e') {
    // E2E tests typically cover frontend components that are tested through the browser
    if (testFileName.includes('feedback-form') || testFileName.includes('FeedbackForm')) {
      return 'client/src/components/FeedbackForm.jsx';
    } else if (testFileName.includes('feedback-list') || testFileName.includes('FeedbackList')) {
      return 'client/src/components/FeedbackList.jsx';
    }
  }
  
  return null;
}

/**
 * Compute coverage delta for each test file individually
 * Coverage is already computed in evaluateTestFileOnce, so we just aggregate it here
 */
async function computeCoverageDeltaByModelType(results) {
  const out = {};
  if (!COMPUTE_COVERAGE) return out;

  // Process each test file individually
  // Coverage is already computed in evaluateTestFileOnce, so we just use those values
  for (const result of results) {
    if (!result.exists) continue; // Skip non-existent files (but include e2e)
    
    const testFileName = path.basename(result.file);
    const fileKey = `${result.model}::${result.type}::${testFileName}`;
    
    // Use coverage values already computed in evaluateTestFileOnce
    const baselinePct = typeof result.coverageBaseline === 'number' ? result.coverageBaseline : (result.coverageBaseline === null ? 0 : 0);
    const generatedPct = typeof result.coverageGenerated === 'number' ? result.coverageGenerated : (result.coverageGenerated === null ? 0 : 0);
    const deltaPct = typeof result.coverageDelta === 'number' ? result.coverageDelta : (result.coverageDelta === null ? 0 : 0);
    const sourceFile = result.coverageSourceFile || getSourceFileForTest(result.file, result.type);
    
    // Debug: log if coverage values are missing
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] computeCoverageDeltaByModelType for ${fileKey}: baseline=${baselinePct}, generated=${generatedPct}, delta=${deltaPct}, hasBaseline=${result.coverageBaseline !== undefined}, hasGenerated=${result.coverageGenerated !== undefined}`);
    }
    
    out[fileKey] = {
      model: result.model,
      type: result.type,
      testFile: testFileName,
      sourceFile: sourceFile,
      baselineLinesPct: baselinePct,
      generatedLinesPct: generatedPct,
      deltaLinesPct: deltaPct,
    };
  }
  
  return out;
}

/**
 * Compute coverage for a test: baseline (without test) and generated (with test)
 */
async function computeCoverageForTest(sourceFile, testType, testTargetPath, testSourcePath, modelName) {
  const testFileName = path.basename(testSourcePath);
  
  // Step 1: Compute baseline coverage (WITHOUT this test)
  // Temporarily rename the test file so Jest doesn't see it
  // This is more reliable than testPathIgnorePatterns when there are no other tests
  let baselinePct = 0;
  const tempTestPath = testTargetPath + '.tmp.exclude';
  let testWasRenamed = false;
  
  try {
    // Rename test file to exclude it from baseline
    if (fsSync.existsSync(testTargetPath)) {
      await fs.rename(testTargetPath, tempTestPath);
      testWasRenamed = true;
    }
    
    // Run coverage with all other tests (this test is now renamed, so Jest won't see it)
    baselinePct = await runCoverageForSourceFile(
      sourceFile,
      testType,
      `baseline-${testType}-${testFileName}`
    );
  } catch (e) {
    baselinePct = 0;
  } finally {
    // Restore test file
    if (testWasRenamed && fsSync.existsSync(tempTestPath)) {
      await fs.rename(tempTestPath, testTargetPath).catch(() => {});
    }
  }
  
  // Step 2: Compute generated coverage (WITH this test)
  // Test file is now present, so it will be included
  let generatedPct = 0;
  try {
    // Verify test file exists before computing coverage
    if (!fsSync.existsSync(testTargetPath)) {
      if (process.env.DEBUG_COVERAGE) {
        console.log(`[DEBUG] Test file ${testTargetPath} does not exist for generated coverage!`);
      }
      generatedPct = 0;
    } else {
      if (process.env.DEBUG_COVERAGE) {
        console.log(`[DEBUG] Computing generated coverage with test file: ${testTargetPath}`);
        // Verify test file content is different for different models
        const testContent = await fs.readFile(testTargetPath, 'utf-8');
        console.log(`[DEBUG] Test file size: ${testContent.length} bytes, first 100 chars: ${testContent.substring(0, 100)}`);
      }
      generatedPct = await runCoverageForSourceFile(sourceFile, testType, `generated-${modelName}-${testType}-${testFileName}`);
    }
  } catch (e) {
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Error computing generated coverage: ${e.message}`);
    }
    generatedPct = 0;
  }
  
  // Ensure we have numbers
  baselinePct = typeof baselinePct === 'number' && Number.isFinite(baselinePct) ? baselinePct : 0;
  generatedPct = typeof generatedPct === 'number' && Number.isFinite(generatedPct) ? generatedPct : 0;
  
  if (process.env.DEBUG_COVERAGE) {
    console.log(`[DEBUG] Coverage for ${testFileName}: baseline=${baselinePct}%, generated=${generatedPct}%, delta=${generatedPct - baselinePct}%`);
  }
  
  return {
    baseline: baselinePct,
    generated: generatedPct,
    delta: generatedPct - baselinePct
  };
}

/**
 * Run coverage for a specific source file
 * @param {string} sourceFile - Source file path relative to project root
 * @param {string} testType - Type of test (unit/integration)
 * @param {string} label - Label for logging
 */
async function runCoverageForSourceFile(sourceFile, testType, label) {
  const ts = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let outDir = path.join(projectRoot, '.coverage-tmp', testType, String(ts));
  
  // Ensure directory exists and is writable
  // Fix permissions if needed (in case directory was created by root)
  try {
    // First, try to fix permissions on .coverage-tmp if it exists
    const coverageTmpDir = path.join(projectRoot, '.coverage-tmp');
    if (fsSync.existsSync(coverageTmpDir)) {
      try {
        execSync(`chmod -R 755 "${coverageTmpDir}" 2>/dev/null || true`, { stdio: 'pipe' });
      } catch (e) {
        // ignore permission fix errors
      }
    }
    
    fsSync.mkdirSync(outDir, { recursive: true, mode: 0o755 });
  } catch (e) {
    // If mkdir fails due to permissions, use tmp directory instead
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      const os = require('os');
      outDir = path.join(os.tmpdir(), 'nir3-coverage', testType, String(ts));
      fsSync.mkdirSync(outDir, { recursive: true });
    } else {
      throw e;
    }
  }
  
  const logPath = path.join(outDir, `run-${label}.log`);
  
  if (testType === 'unit') {
    // For unit tests, collect coverage only for the specific source file
    // Path should be relative to client directory (where jest runs from)
    // sourceFile is like "client/src/components/FeedbackForm.jsx"
    // We need "src/components/FeedbackForm.jsx" (relative to client/)
    const sourceFilePattern = sourceFile.replace(/^client[\/\\]/, '').replace(/\\/g, '/');
    // Use relative path for coverageDirectory (relative to client directory)
    const coverageDirRel = path.relative(path.join(projectRoot, 'client'), outDir);
    const workingDir = path.join(projectRoot, 'client');
    
    // Build test command - run all tests and collect coverage
    // Don't use --collectCoverageFrom - it doesn't work reliably. Instead, collect coverage for all files
    // and extract the specific file's coverage from the results
    // Note: excludeTestPath is no longer used (we rename the test file instead)
    const testCmd = `cd "${workingDir}" && npm test -- --coverage --coverageReporters=json-summary --coverageDirectory "${coverageDirRel}" --passWithNoTests`;
    
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Running coverage command: ${testCmd}`);
    }
    
    try {
      execSync(
        `${testCmd} > "${logPath}" 2>&1 || true`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      // ignore
    }
    
    // Check log for test execution
    if (process.env.DEBUG_COVERAGE) {
      try {
        const logContent = fsSync.readFileSync(logPath, 'utf-8');
        const testCount = (logContent.match(/(\d+)\s+passed/i) || [])[1] || '0';
        const testFound = !logContent.includes('No tests found');
        console.log(`[DEBUG] Coverage run log: tests found=${testFound}, passed=${testCount}`);
        // Don't show warning for baseline coverage runs (when test is temporarily renamed)
        // This is expected behavior - baseline coverage intentionally excludes the test being evaluated
      } catch (e) {
        // ignore
      }
    }
    
    // Wait for Jest to finish writing the file
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Jest may create coverage-summary.json in different places
    const summaryPath = path.join(outDir, 'coverage-summary.json');
    let summaryFound = false;
    
    // Check if Jest created it in the specified directory
    if (fsSync.existsSync(summaryPath)) {
      summaryFound = true;
    } else {
      // Check if Jest created it in coverage/ subdirectory of working directory
      const defaultCoveragePath = path.join(workingDir, 'coverage', 'coverage-summary.json');
      
      if (fsSync.existsSync(defaultCoveragePath)) {
        // Copy it to our output directory
        await fs.copyFile(defaultCoveragePath, summaryPath).catch(() => {});
        summaryFound = true;
      } else {
        // Check if Jest created it in a subdirectory of outDir
        const coverageSubdir = path.join(outDir, 'coverage');
        const summaryInSubdir = path.join(coverageSubdir, 'coverage-summary.json');
        
        if (fsSync.existsSync(summaryInSubdir)) {
          await fs.copyFile(summaryInSubdir, summaryPath).catch(() => {});
          summaryFound = true;
        }
      }
    }
    
    // If still not found, Jest didn't run any tests - create empty coverage
    if (!summaryFound) {
      const sourceFileAbs = path.resolve(projectRoot, sourceFile);
      const emptyCoverage = {
        total: {
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branchesTrue: { total: 0, covered: 0, skipped: 0, pct: 0 }
        },
        [sourceFileAbs]: {
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branchesTrue: { total: 0, covered: 0, skipped: 0, pct: 0 }
        }
      };
      await fs.writeFile(summaryPath, JSON.stringify(emptyCoverage, null, 2), 'utf-8');
    }
    
    // Read coverage percentage
    const pct = readCoverageSummaryPct(outDir, sourceFile);
    return typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
  }
  
  if (testType === 'integration') {
    // For integration tests, collect coverage for server files
    // Path should be relative to project root (where jest runs from)
    // sourceFile is like "server/index.js" or "server/utils/validation.js"
    const sourceFilePattern = sourceFile.replace(/\\/g, '/');
    // Use relative path for coverageDirectory (relative to project root)
    const coverageDirRel = path.relative(projectRoot, outDir);
    const workingDir = projectRoot;
    
    // Build test command - run all tests and collect coverage
    // Don't use --collectCoverageFrom - it doesn't work reliably. Instead, collect coverage for all files
    // and extract the specific file's coverage from the results
    let testCmd = `cd "${workingDir}" && npm run test:server -- --coverage --coverageReporters=json-summary --coverageDirectory "${coverageDirRel}" --passWithNoTests`;
    
    // If we need to exclude a specific test file (for baseline), use testPathIgnorePatterns
    if (excludeTestPath) {
      const testFileName = path.basename(excludeTestPath);
      // Exclude the specific test file by using testPathIgnorePatterns
      // Use a pattern that matches the test file name exactly
      testCmd += ` --testPathIgnorePatterns="(.*/)?${testFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$"`;
    }
    
    if (process.env.DEBUG_COVERAGE) {
      console.log(`[DEBUG] Running coverage command (integration): ${testCmd}`);
    }
    
    try {
      execSync(
        `${testCmd} > "${logPath}" 2>&1 || true`,
        { stdio: 'pipe', encoding: 'utf-8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      // ignore
    }
    
    // Check log for test execution
    if (process.env.DEBUG_COVERAGE) {
      try {
        const logContent = fsSync.readFileSync(logPath, 'utf-8');
        const testCount = (logContent.match(/(\d+)\s+passed/i) || [])[1] || '0';
        const testFound = !logContent.includes('No tests found');
        console.log(`[DEBUG] Coverage run log (integration): tests found=${testFound}, passed=${testCount}`);
        // Don't show warning for baseline coverage runs (when test is temporarily renamed)
        // This is expected behavior - baseline coverage intentionally excludes the test being evaluated
      } catch (e) {
        // ignore
      }
    }
    
    // Wait for Jest to finish writing the file
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Jest may create coverage-summary.json in different places
    const summaryPath = path.join(outDir, 'coverage-summary.json');
    let summaryFound = false;
    
    // Check if Jest created it in the specified directory
    if (fsSync.existsSync(summaryPath)) {
      summaryFound = true;
    } else {
      // Check if Jest created it in coverage/ subdirectory of working directory
      const defaultCoveragePath = path.join(workingDir, 'coverage', 'coverage-summary.json');
      
      if (fsSync.existsSync(defaultCoveragePath)) {
        // Copy it to our output directory
        await fs.copyFile(defaultCoveragePath, summaryPath).catch(() => {});
        summaryFound = true;
      } else {
        // Check if Jest created it in a subdirectory of outDir
        const coverageSubdir = path.join(outDir, 'coverage');
        const summaryInSubdir = path.join(coverageSubdir, 'coverage-summary.json');
        
        if (fsSync.existsSync(summaryInSubdir)) {
          await fs.copyFile(summaryInSubdir, summaryPath).catch(() => {});
          summaryFound = true;
        }
      }
    }
    
    // If still not found, Jest didn't run any tests - create empty coverage
    if (!summaryFound) {
      const sourceFileAbs = path.resolve(projectRoot, sourceFile);
      const emptyCoverage = {
        total: {
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branchesTrue: { total: 0, covered: 0, skipped: 0, pct: 0 }
        },
        [sourceFileAbs]: {
          lines: { total: 0, covered: 0, skipped: 0, pct: 0 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 0 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branches: { total: 0, covered: 0, skipped: 0, pct: 0 },
          branchesTrue: { total: 0, covered: 0, skipped: 0, pct: 0 }
        }
      };
      await fs.writeFile(summaryPath, JSON.stringify(emptyCoverage, null, 2), 'utf-8');
    }
    
    // Read coverage percentage
    const pct = readCoverageSummaryPct(outDir, sourceFile);
    return typeof pct === 'number' && Number.isFinite(pct) ? pct : 0;
  }
  
  return 0;
}

/**
 * Evaluate a single test file multiple times to detect flakiness.
 *
 * Flaky definition (as requested):
 * - if the number of passed tests changes across runs (passCount differs)
 * Also considers failCount / overall pass boolean changes.
 */
async function evaluateTestFile(testFilePath, modelName, testType) {
  const runs = FLAKY_RUNS;
  const runResults = [];
  
  // Coverage is computed only once (in first run) since it doesn't change between runs
  let firstRunCoverage = null;

  for (let i = 0; i < runs; i++) {
    // eslint-disable-next-line no-await-in-loop
    const result = await evaluateTestFileOnce(testFilePath, modelName, testType, i === 0);
    
    // Store coverage from first run
    if (i === 0 && result.coverageDelta !== null) {
      firstRunCoverage = {
        coverageDelta: result.coverageDelta,
        coverageBaseline: result.coverageBaseline,
        coverageGenerated: result.coverageGenerated,
        coverageSourceFile: result.coverageSourceFile,
      };
    }
    
    // Use coverage from first run for all subsequent runs
    if (i > 0 && firstRunCoverage) {
      result.coverageDelta = firstRunCoverage.coverageDelta;
      result.coverageBaseline = firstRunCoverage.coverageBaseline;
      result.coverageGenerated = firstRunCoverage.coverageGenerated;
      result.coverageSourceFile = firstRunCoverage.coverageSourceFile;
    }
    
    runResults.push(result);
  }

  const base = runResults[0] || {
    file: testFilePath,
    model: modelName,
    type: testType,
    exists: false,
    syntaxValid: false,
    runs: false,
    passes: false,
    errors: [],
    testCount: 0,
    passCount: 0,
    failCount: 0,
    coverage: null,
    coverageDelta: null,
    coverageBaseline: null,
    coverageGenerated: null,
    coverageSourceFile: null,
  };

  const history = runResults.map(r => ({
    runs: !!r.runs,
    passes: !!r.passes,
    testCount: Number.isFinite(r.testCount) ? r.testCount : 0,
    passCount: Number.isFinite(r.passCount) ? r.passCount : 0,
    failCount: Number.isFinite(r.failCount) ? r.failCount : 0,
  }));

  const signatures = new Set(
    history.map(h => JSON.stringify({ runs: h.runs, passes: h.passes, passCount: h.passCount, failCount: h.failCount }))
  );
  const flaky = signatures.size > 1;

  // Aggregate counts in a conservative way (worst-case across runs)
  const ranHistory = history.filter(h => h.runs);
  if (ranHistory.length > 0) {
    base.testCount = Math.max(...ranHistory.map(h => h.testCount), base.testCount || 0);
    base.passCount = Math.min(...ranHistory.map(h => h.passCount), base.passCount || 0);
    base.failCount = Math.max(...ranHistory.map(h => h.failCount), base.failCount || 0);
  }

  base.runs = ranHistory.length > 0;
  base.passes = (ranHistory.length === runs) && ranHistory.every(h => h.passes);

  base.repeatRuns = runs;
  base.runHistory = history;
  base.flaky = flaky;

  base.totalRunCount = runs;
  // Sum of per-run fail counts for unstable files only (legacy flakyFailureCount; equals repeatRunFailureSum when flaky).
  base.flakyFailureCount = flaky
    ? history.reduce((sum, h) => sum + (h.failCount || 0), 0)
    : 0;
  // Sum of per-run fail counts across all outer repeats (flakyTestRate numerator).
  base.repeatRunFailureSum = history.reduce((sum, h) => sum + (h.failCount || 0), 0);

  if (flaky) {
    const passCountsText = history.map(h => (h.runs ? h.passCount : 'NR')).join(', ');
    base.errors = base.errors || [];
    base.errors.push(`Flaky (runs=${runs}): passed counts per run = [${passCountsText}]`);
  }

  return base;
}

function stripAnsi(input) {
  if (!input) return '';
  // Basic ANSI escape stripping (colors + cursor controls)
  return input
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '');
}

function getPlaywrightRunnerIdentity() {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const sudoUser = process.env.SUDO_USER || null;

  // If evaluation is run with sudo, prefer running Playwright as the original user
  // so browsers/cache exist and we don't create root-owned artifacts in the repo.
  if (uid === 0 && sudoUser) {
    return { runAsUser: sudoUser, uid: null };
  }

  return { runAsUser: null, uid };
}

function getPlaywrightArtifactsDir(runner) {
  // Always put artifacts in a temp folder to avoid permission issues between sudo/user.
  const base = path.join(os.tmpdir(), 'nir3-playwright-artifacts');
  const tag = runner.runAsUser ? `user-${runner.runAsUser}` : `uid-${runner.uid ?? 'na'}`;
  return path.join(base, tag);
}

function wrapCommandForUser(cmd, cwd, runner) {
  // Return a shell snippet that runs cmd in cwd, possibly via sudo -u.
  // We keep quoting minimal but safe for paths without quotes.
  const cdAndCmd = `cd "${cwd}" && ${cmd}`;
  if (runner.runAsUser) {
    // -H sets HOME for the target user, ensuring Playwright uses that user's browser cache.
    return `sudo -u "${runner.runAsUser}" -H sh -lc '${cdAndCmd.replace(/'/g, `'\"'\"'`)}'`;
  }
  return `sh -lc '${cdAndCmd.replace(/'/g, `'\"'\"'`)}'`;
}

function getSafeHomeForPlaywright() {
  // When running under sudo/root with HOME pointing to a user-owned dir,
  // Firefox/WebKit can refuse to launch. Force a root-owned HOME.
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid === 0) {
      const candidates = process.platform === 'darwin'
        ? ['/var/root', '/root']
        : ['/root', '/var/root'];
      for (const c of candidates) {
        if (fsSync.existsSync(c)) return c;
      }
      return '/root';
    }
  } catch (e) {
    // ignore
  }
  return process.env.HOME || '';
}

function extractPlaywrightRootCause(output) {
  const clean = stripAnsi(output);
  const lines = clean.split('\n');

  const findIndex = (pred) => {
    for (let i = 0; i < lines.length; i++) if (pred(lines[i])) return i;
    return -1;
  };

  // Prefer webServer startup errors (very common in this repo due to EPERM on :3000)
  let start = findIndex(l => l.includes('[WebServer] error when starting dev server'));
  if (start === -1) start = findIndex(l => l.startsWith('[WebServer] Error:'));
  if (start === -1) start = findIndex(l => l.includes('Process from config.webServer was not able to start'));

  // Otherwise: first Error: block
  if (start === -1) start = findIndex(l => l.startsWith('Error:'));

  // Otherwise: first failing test line (line reporter)
  if (start === -1) start = findIndex(l => /\sfailed\s/i.test(l) && !/__PW_EXIT_CODE__/.test(l));

  // Fallback: tail
  if (start === -1) start = Math.max(0, lines.length - 30);

  const snippetLines = lines.slice(start, start + 30);
  const snippet = snippetLines.join('\n').trim();
  if (!snippet) return null;

  // Keep snippet bounded
  return snippet.length > 2000 ? snippet.slice(0, 2000).trimEnd() + '\n…' : snippet;
}

/**
 * Evaluate all generated tests
 */
/**
 * Recursively find test files in directory
 */
async function findTestFiles(dir, basePath = '') {
  const testFiles = [];
  
  try {
    const items = await fs.readdir(dir);
    
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const relativePath = path.join(basePath, item);
      const stat = await fs.stat(itemPath);
      
      if (stat.isDirectory()) {
        // Recursively search in subdirectories
        const subFiles = await findTestFiles(itemPath, relativePath);
        testFiles.push(...subFiles);
      } else if (item.endsWith('.test.js') || item.endsWith('.test.jsx') || item.endsWith('.spec.js')) {
        testFiles.push({
          path: itemPath,
          relativePath: relativePath,
          name: item
        });
      }
    }
  } catch (error) {
    // Ignore errors reading directories
  }
  
  return testFiles;
}

async function evaluateAllTests(outputDir = 'research-output') {
  // Allow passing either:
  // - relative directory (e.g. "research-output")
  // - absolute directory (e.g. "/Users/.../research-output")
  // Also guard against macOS absolute paths accidentally missing leading "/"
  let outputPath;
  if (path.isAbsolute(outputDir)) {
    outputPath = outputDir;
  } else if (outputDir.startsWith(`Users${path.sep}`)) {
    // Treat as absolute path missing leading slash
    outputPath = path.sep + outputDir;
  } else {
    outputPath = path.join(projectRoot, outputDir);
  }
  const results = [];

  try {
    if (!await fs.access(outputPath).then(() => true).catch(() => false)) {
      console.log(`Output directory ${outputPath} does not exist.`);
      return results;
    }

    // Find all test files recursively
    const testFiles = await findTestFiles(outputPath);
    
    if (testFiles.length === 0) {
      console.log('No test files found in research-output directory.');
      return results;
    }

    console.log(`Found ${testFiles.length} test file(s) to evaluate...\n`);

    for (const testFile of testFiles) {
      // Extract model and type from path
      // Path format: research-output/{model}/{type}/{file} or research-output/{provider}/{model}/{type}/{file}
      const pathParts = testFile.relativePath.split(path.sep);
      let model = pathParts[0] || 'unknown';
      let testType = 'unknown';
      
      // Try to find test type (unit, integration, e2e)
      for (const part of pathParts) {
        if (part === 'unit' || part === 'integration' || part === 'e2e') {
          testType = part;
          break;
        }
      }
      
      // If nested structure (provider/model), combine them
      if (pathParts.length > 2 && pathParts[0] !== testType) {
        model = pathParts.slice(0, -2).join('/');
      } else if (pathParts.length > 1) {
        model = pathParts[0];
      }

      console.log(`Evaluating: ${testFile.relativePath}...`);
      
      const result = await evaluateTestFile(testFile.path, model, testType);
      results.push(result);
    }
  } catch (error) {
    console.error('Error reading output directory:', error.message);
    console.error(error.stack);
  }

  return results;
}

/**
 * When every detail row sets `totalRunCount` (pipeline uses 1; `evaluateTestFile` uses FLAKY_RUNS),
 * report `repeatRuns` as the max across files. If any row omits it (legacy), keep default FLAKY_RUNS.
 */
function inferRepeatRunsFromDetailResults(results) {
  if (!Array.isArray(results) || results.length === 0) return FLAKY_RUNS;
  const counts = [];
  for (const r of results) {
    const c = r && r.totalRunCount;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 1) return FLAKY_RUNS;
    counts.push(c);
  }
  return Math.max(1, ...counts);
}

/** True when results came from multi-run flaky sampling (each file run more than once). */
function inferFlakyMultiRunEvaluation(results) {
  if (!Array.isArray(results) || results.length === 0) return false;
  for (const r of results) {
    const c = r && r.totalRunCount;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 1) return false;
  }
  return Math.max(...results.map((r) => r.totalRunCount)) > 1;
}

/**
 * Sum of failed test-case counts across outer repeats (one term per run).
 * Used for flakyTestRate = repeatRunFailures / totalTestRuns.
 * Legacy rows without `repeatRunFailureSum` infer: flaky rows use flakyFailureCount (same sum we stored for flaky files);
 * non-flaky multi-run assume stable failCount per run → totalRunCount * failCount.
 */
function repeatRunFailureSumFromRow(r) {
  if (!r) return 0;
  if (typeof r.repeatRunFailureSum === 'number' && Number.isFinite(r.repeatRunFailureSum) && r.repeatRunFailureSum >= 0) {
    return r.repeatRunFailureSum;
  }
  const runs = typeof r.totalRunCount === 'number' && r.totalRunCount >= 1 ? r.totalRunCount : 1;
  const fc = Number.isFinite(r.failCount) ? r.failCount : 0;
  if (r.flaky && typeof r.flakyFailureCount === 'number' && Number.isFinite(r.flakyFailureCount) && r.flakyFailureCount >= 0) {
    return r.flakyFailureCount;
  }
  return runs * fc;
}

/**
 * Generate evaluation report
 */
function generateReport(results) {
  const repeatRunsInferred = inferRepeatRunsFromDetailResults(results);
  const flakyMultiRunEvaluation = inferFlakyMultiRunEvaluation(results);

  const totalFileRuns = results.reduce((sum, r) => sum + (r.totalRunCount || FLAKY_RUNS || 1), 0);
  // Calculate total test runs: sum of testCount from all runs of all tests
  const totalTestRuns = results.reduce((sum, r) => {
    const runs = r.totalRunCount || FLAKY_RUNS || 1;
    const avgTestCount = r.testCount || 0;
    return sum + (runs * avgTestCount);
  }, 0);
  const flakyFiles = results.filter(r => r.flaky).length;
  const flakyFailures = results.reduce((sum, r) => sum + (r.flakyFailureCount || 0), 0);
  const repeatRunFailures = results.reduce((sum, r) => sum + repeatRunFailureSumFromRow(r), 0);
  const successRateFiles = results.length > 0 ? (results.filter(r => r.passes).length / results.length) * 100 : 0;
  const ttgValues = results.map(r => r.ttgSeconds).filter(v => typeof v === 'number' && Number.isFinite(v));
  const avgTTGSeconds = ttgValues.length > 0 ? (ttgValues.reduce((a, b) => a + b, 0) / ttgValues.length) : null;

  const report = {
    summary: {
      total: results.length,
      exists: results.filter(r => r.exists).length,
      syntaxValid: results.filter(r => r.syntaxValid).length,
      runs: results.filter(r => r.runs).length,
      passes: results.filter(r => r.passes).length,
      successRateFiles, // SR (file-level)
      ttgSecondsAvg: avgTTGSeconds, // TTG (seconds)
      flakyFiles,
      flakyFileRate: results.length > 0 ? ((flakyFiles / results.length) * 100) : 0,
      flakyFailures,
      repeatRunFailures,
      totalRuns: totalFileRuns,
      totalTestRuns,
      flakyTestRate: totalTestRuns > 0 ? (repeatRunFailures / totalTestRuns) * 100 : 0, // fail-instances across outer runs / all test executions
      repeatRuns: repeatRunsInferred,
      flakyMultiRunEvaluation,
      totalTests: results.reduce((sum, r) => sum + r.testCount, 0),
      totalPassed: results.reduce((sum, r) => sum + r.passCount, 0),
      totalFailed: results.reduce((sum, r) => sum + r.failCount, 0),
    },
    byModel: {},
    byModelType: {}, // Group by model + type
    byType: {},
    details: results,
  };

  // Group by model
  results.forEach(result => {
    if (!report.byModel[result.model]) {
      report.byModel[result.model] = {
        total: 0,
        passes: 0,
        flakyFiles: 0,
        flakyFailures: 0,
        repeatRunFailures: 0,
        totalRuns: 0,
        totalTestRuns: 0,
        successRateFiles: 0,
        ttgSecondsAvg: null,
        testCount: 0,
        passCount: 0,
        failCount: 0,
      };
    }
    report.byModel[result.model].total++;
    if (result.passes) report.byModel[result.model].passes++;
    if (result.flaky) report.byModel[result.model].flakyFiles++;
    report.byModel[result.model].flakyFailures += (result.flakyFailureCount || 0);
    report.byModel[result.model].repeatRunFailures += repeatRunFailureSumFromRow(result);
    const runs = result.totalRunCount || FLAKY_RUNS || 1;
    report.byModel[result.model].totalRuns += runs;
    report.byModel[result.model].totalTestRuns += (runs * (result.testCount || 0));
    // For aggregated testCount/passCount/failCount, use the latest run values (not min/max from flaky detection)
    // This gives more accurate percentages
    if (result.runHistory && result.runHistory.length > 0) {
      const lastRun = result.runHistory[result.runHistory.length - 1];
      report.byModel[result.model].testCount += (lastRun.testCount || result.testCount || 0);
      report.byModel[result.model].passCount += (lastRun.passCount || result.passCount || 0);
      report.byModel[result.model].failCount += (lastRun.failCount || result.failCount || 0);
    } else {
      report.byModel[result.model].testCount += result.testCount;
      report.byModel[result.model].passCount += result.passCount;
      report.byModel[result.model].failCount += result.failCount;
    }
  });

  // Group by model + type
  results.forEach(result => {
    const key = `${result.model}::${result.type}`;
    if (!report.byModelType[key]) {
      report.byModelType[key] = {
        model: result.model,
        type: result.type,
        total: 0,
        passes: 0,
        flakyFiles: 0,
        flakyFailures: 0,
        repeatRunFailures: 0,
        totalRuns: 0,
        totalTestRuns: 0,
        successRateFiles: 0,
        ttgSecondsAvg: null,
        testCount: 0,
        passCount: 0,
        failCount: 0,
      };
    }
    report.byModelType[key].total++;
    if (result.passes) report.byModelType[key].passes++;
    if (result.flaky) report.byModelType[key].flakyFiles++;
    report.byModelType[key].flakyFailures += (result.flakyFailureCount || 0);
    report.byModelType[key].repeatRunFailures += repeatRunFailureSumFromRow(result);
    const runs = result.totalRunCount || FLAKY_RUNS || 1;
    report.byModelType[key].totalRuns += runs;
    report.byModelType[key].totalTestRuns += (runs * (result.testCount || 0));
    // For aggregated testCount/passCount/failCount, use the latest run values
    // Ensure consistency: use values from the same run
    if (result.runHistory && result.runHistory.length > 0) {
      const lastRun = result.runHistory[result.runHistory.length - 1];
      const runTestCount = lastRun.testCount || result.testCount || 0;
      const runPassCount = lastRun.passCount || result.passCount || 0;
      const runFailCount = lastRun.failCount || result.failCount || 0;
      // If testCount > passCount + failCount, the difference should be counted as failed
      const consistentFailCount = Math.max(runFailCount, runTestCount - runPassCount);
      report.byModelType[key].testCount += runTestCount;
      report.byModelType[key].passCount += runPassCount;
      report.byModelType[key].failCount += consistentFailCount;
    } else {
      const testCount = result.testCount || 0;
      const passCount = result.passCount || 0;
      const failCount = result.failCount || 0;
      // If testCount > passCount + failCount, the difference should be counted as failed
      const consistentFailCount = Math.max(failCount, testCount - passCount);
      report.byModelType[key].testCount += testCount;
      report.byModelType[key].passCount += passCount;
      report.byModelType[key].failCount += consistentFailCount;
    }
    // TTG aggregation
    if (typeof result.ttgSeconds === 'number' && Number.isFinite(result.ttgSeconds)) {
      if (!report.byModelType[key]._ttgSum) {
        report.byModelType[key]._ttgSum = 0;
        report.byModelType[key]._ttgCount = 0;
      }
      report.byModelType[key]._ttgSum += result.ttgSeconds;
      report.byModelType[key]._ttgCount++;
    }
  });

  // Group by type
  results.forEach(result => {
    if (!report.byType[result.type]) {
      report.byType[result.type] = {
        total: 0,
        passes: 0,
        flakyFiles: 0,
        flakyFailures: 0,
        repeatRunFailures: 0,
        totalRuns: 0,
        totalTestRuns: 0,
        successRateFiles: 0,
        ttgSecondsAvg: null,
        testCount: 0,
        passCount: 0,
        failCount: 0,
      };
    }
    report.byType[result.type].total++;
    if (result.passes) report.byType[result.type].passes++;
    if (result.flaky) report.byType[result.type].flakyFiles++;
    report.byType[result.type].flakyFailures += (result.flakyFailureCount || 0);
    report.byType[result.type].repeatRunFailures += repeatRunFailureSumFromRow(result);
    const runs = result.totalRunCount || FLAKY_RUNS || 1;
    report.byType[result.type].totalRuns += runs;
    report.byType[result.type].totalTestRuns += (runs * (result.testCount || 0));
    // For aggregated testCount/passCount/failCount, use the latest run values (not min/max from flaky detection)
    if (result.runHistory && result.runHistory.length > 0) {
      const lastRun = result.runHistory[result.runHistory.length - 1];
      report.byType[result.type].testCount += (lastRun.testCount || result.testCount || 0);
      report.byType[result.type].passCount += (lastRun.passCount || result.passCount || 0);
      report.byType[result.type].failCount += (lastRun.failCount || result.failCount || 0);
    } else {
      report.byType[result.type].testCount += result.testCount;
      report.byType[result.type].passCount += result.passCount;
      report.byType[result.type].failCount += result.failCount;
    }
  });

  // Add computed metrics (rates, TTG averages) for byModelType
  Object.values(report.byModelType).forEach(stats => {
    stats.successRateFiles = stats.total > 0 ? (stats.passes / stats.total) * 100 : 0; // SR
    stats.flakyFileRate = stats.total > 0 ? (stats.flakyFiles / stats.total) * 100 : 0;
    stats.flakyTestRate =
      stats.totalTestRuns > 0 ? (stats.repeatRunFailures / stats.totalTestRuns) * 100 : 0; // repeat-run fail instances / total test runs
    if (stats._ttgCount) {
      stats.ttgSecondsAvg = stats._ttgSum / stats._ttgCount;
      delete stats._ttgSum;
      delete stats._ttgCount;
    }
  });

  // Add computed metrics (rates, TTG averages) for byModel
  Object.values(report.byModel).forEach(stats => {
    stats.successRateFiles = stats.total > 0 ? (stats.passes / stats.total) * 100 : 0; // SR
    stats.flakyFileRate = stats.total > 0 ? (stats.flakyFiles / stats.total) * 100 : 0;
    stats.flakyTestRate =
      stats.totalTestRuns > 0 ? (stats.repeatRunFailures / stats.totalTestRuns) * 100 : 0; // repeat-run fail instances / total test runs
  });
  Object.values(report.byType).forEach(stats => {
    stats.successRateFiles = stats.total > 0 ? (stats.passes / stats.total) * 100 : 0; // SR
    stats.flakyFileRate = stats.total > 0 ? (stats.flakyFiles / stats.total) * 100 : 0;
    stats.flakyTestRate =
      stats.totalTestRuns > 0 ? (stats.repeatRunFailures / stats.totalTestRuns) * 100 : 0; // repeat-run fail instances / total test runs
  });

  // TTG averages per model/type (best effort: only for files with meta)
  results.forEach(r => {
    if (typeof r.ttgSeconds === 'number' && Number.isFinite(r.ttgSeconds)) {
      const m = report.byModel[r.model];
      const t = report.byType[r.type];
      if (m) {
        m._ttgSum = (m._ttgSum || 0) + r.ttgSeconds;
        m._ttgCount = (m._ttgCount || 0) + 1;
      }
      if (t) {
        t._ttgSum = (t._ttgSum || 0) + r.ttgSeconds;
        t._ttgCount = (t._ttgCount || 0) + 1;
      }
    }
  });
  Object.values(report.byModel).forEach(stats => {
    if (stats._ttgCount) stats.ttgSecondsAvg = stats._ttgSum / stats._ttgCount;
    delete stats._ttgSum;
    delete stats._ttgCount;
  });
  Object.values(report.byType).forEach(stats => {
    if (stats._ttgCount) stats.ttgSecondsAvg = stats._ttgSum / stats._ttgCount;
    delete stats._ttgSum;
    delete stats._ttgCount;
  });

  return report;
}

/**
 * Print report to console
 */
function printReport(report) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST GENERATION EVALUATION REPORT');
  console.log('='.repeat(60) + '\n');

  console.log('SUMMARY:');
  console.log(`  Total files evaluated: ${report.summary.total}`);
  console.log(`  Files exist: ${report.summary.exists}`);
  console.log(`  Syntax valid: ${report.summary.syntaxValid}`);
  console.log(`  Tests run: ${report.summary.runs}`);
  console.log(`  Tests pass: ${report.summary.passes}`);
  console.log(`  Total test cases: ${report.summary.totalTests}`);
  console.log(`  Passed: ${report.summary.totalPassed}`);
  console.log(`  Failed: ${report.summary.totalFailed}`);
  console.log(`  Success rate: ${report.summary.totalTests > 0 ? ((report.summary.totalPassed / report.summary.totalTests) * 100).toFixed(1) : 0}%`);
  if (report.summary.repeatRuns != null) {
    console.log(`  Repeat runs per file (max): ${report.summary.repeatRuns}`);
  }
  if (report.summary.flakyMultiRunEvaluation != null) {
    console.log(`  Flaky multi-run evaluation: ${report.summary.flakyMultiRunEvaluation ? 'yes' : 'no'}`);
  }

  console.log('\nBY MODEL:');
  Object.entries(report.byModel).forEach(([model, stats]) => {
    console.log(`  ${model}:`);
    console.log(`    Files: ${stats.total}, Passing: ${stats.passes}`);
    console.log(`    Tests: ${stats.testCount}, Passed: ${stats.passCount}, Failed: ${stats.failCount}`);
  });

  console.log('\nBY TYPE:');
  Object.entries(report.byType).forEach(([type, stats]) => {
    console.log(`  ${type}:`);
    console.log(`    Files: ${stats.total}, Passing: ${stats.passes}`);
    console.log(`    Tests: ${stats.testCount}, Passed: ${stats.passCount}, Failed: ${stats.failCount}`);
  });

  console.log('\nDETAILED RESULTS:');
  report.details.forEach(result => {
    const status = result.passes ? '✓' : result.runs ? '✗' : result.exists ? '⚠' : '✗';
    console.log(`  ${status} ${result.model}/${result.type}/${path.basename(result.file)}`);
    if (result.errors.length > 0) {
      result.errors.forEach(error => {
        console.log(`      Error: ${error}`);
      });
    }
  });
}

// Main execution
async function main() {
  const outputDir = process.argv[2] || 'research-output';
  
  console.log('Evaluating generated tests...\n');
  
  const results = await evaluateAllTests(outputDir);
  const report = generateReport(results);
  // Coverage delta (CC) per test type (unit/integration). E2E: N/A.
  // Make coverage computation optional and non-blocking for faster report generation
  if (COMPUTE_COVERAGE) {
    try {
      console.log('\nComputing code coverage (this may take a while)...');
      report.byTypeCoverage = await computeCoverageDeltaByType(results);
      // Also compute coverage per model+type for more accurate metrics
      report.byModelTypeCoverage = await computeCoverageDeltaByModelType(results);
    } catch (e) {
      console.warn('Warning: Code coverage computation failed:', e.message);
      report.byTypeCoverage = {};
      report.byModelTypeCoverage = {};
    }
  } else {
    report.byTypeCoverage = {};
    report.byModelTypeCoverage = {};
  }
  
  // Save report to file
  const outputPath = path.isAbsolute(outputDir)
    ? outputDir
    : outputDir.startsWith(`Users${path.sep}`)
      ? path.sep + outputDir
      : path.join(projectRoot, outputDir);
  const reportPath = path.join(outputPath, 'evaluation-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport saved to: ${reportPath}`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  evaluateAllTests,
  generateReport,
  evaluateTestFile,
  evaluateTestFileOnce,
  FLAKY_RUNS,
  inferRepeatRunsFromDetailResults,
  inferFlakyMultiRunEvaluation,
  repeatRunFailureSumFromRow,
};
