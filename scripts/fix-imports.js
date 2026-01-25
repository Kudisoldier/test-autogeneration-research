#!/usr/bin/env node

/**
 * Fix Import Paths Script
 * 
 * Automatically fixes incorrect import paths in generated test files
 * 
 * Usage:
 *   node scripts/fix-imports.js [file-path]
 *   node scripts/fix-imports.js --all
 */

const fs = require('fs').promises;
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

/**
 * Fix import paths in a test file
 */
async function fixImportsInFile(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let modified = false;
    
    // Determine file location to fix paths correctly
    const isComponentTest = filePath.includes('components/__tests__');
    const isUtilTest = filePath.includes('utils/__tests__');
    
    if (isComponentTest || filePath.includes('/unit/') || filePath.includes('/components/')) {
      // Fix: '../utils/...' should be '../../utils/...' for component tests
      // Check if file is in a structure like: .../unit/FeedbackForm.test.jsx (component test)
      if (filePath.includes('FeedbackForm') || filePath.includes('FeedbackList') || isComponentTest) {
        const oldPattern = /from\s+['"]\.\.\/utils\//g;
        if (oldPattern.test(content)) {
          content = content.replace(oldPattern, "from '../../utils/");
          modified = true;
        }
        
        // Also fix jest.mock paths
        const mockPattern = /jest\.mock\(['"]\.\.\/utils\//g;
        if (mockPattern.test(content)) {
          content = content.replace(mockPattern, "jest.mock('../../utils/");
          modified = true;
        }
      }
      
      // Fix: '../ComponentName' should stay as is (correct)
      // Fix: '../FeedbackForm' should stay as is (correct)
    } else if (isUtilTest) {
      // Fix: '../../utils/...' should be '../...' (one level up from utils/__tests__)
      const wrongPattern = /from\s+['"]\.\.\/\.\.\/utils\//g;
      if (wrongPattern.test(content)) {
        content = content.replace(wrongPattern, "from '../");
        modified = true;
      }
    }
    
    if (modified) {
      await fs.writeFile(filePath, content, 'utf-8');
      console.log(`✓ Fixed imports in: ${filePath.replace(projectRoot + '/', '')}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`✗ Error fixing ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Recursively find all test files
 */
async function findAllTestFiles(dir = path.join(projectRoot, 'research-output')) {
  const files = [];
  
  try {
    const items = await fs.readdir(dir);
    
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = await fs.stat(itemPath);
      
      if (stat.isDirectory()) {
        const subFiles = await findAllTestFiles(itemPath);
        files.push(...subFiles);
      } else if (item.match(/\.test\.(js|jsx)$/)) {
        files.push(itemPath);
      }
    }
  } catch (error) {
    // Ignore errors
  }
  
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const fixAll = args.includes('--all');
  
  if (fixAll) {
    console.log('Finding all test files in research-output...\n');
    const files = await findAllTestFiles();
    
    if (files.length === 0) {
      console.log('No test files found.');
      return;
    }
    
    console.log(`Found ${files.length} test file(s).\n`);
    
    let fixedCount = 0;
    for (const file of files) {
      if (await fixImportsInFile(file)) {
        fixedCount++;
      }
    }
    
    console.log(`\n✓ Fixed imports in ${fixedCount} file(s).`);
  } else if (args.length > 0) {
    // Fix specific file
    const filePath = path.resolve(projectRoot, args[0]);
    await fixImportsInFile(filePath);
  } else {
    console.log('Usage:');
    console.log('  node scripts/fix-imports.js [file-path]');
    console.log('  node scripts/fix-imports.js --all');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { fixImportsInFile };
