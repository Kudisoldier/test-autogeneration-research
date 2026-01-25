#!/usr/bin/env node

/**
 * Beautiful Report Display Script
 * 
 * Displays evaluation report in a beautiful, informative format
 * 
 * Usage:
 *   node scripts/show-report.js
 *   node scripts/show-report.js --json
 *   node scripts/show-report.js research-output/evaluation-report.json
 */

const fs = require('fs').promises;
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

function printHeader(title) {
  const width = 80;
  const padding = Math.floor((width - title.length - 2) / 2);
  const line = '═'.repeat(width);
  
  console.log(colorize(line, colors.cyan));
  console.log(colorize('═' + ' '.repeat(padding) + title + ' '.repeat(width - padding - title.length - 1) + '═', colors.cyan + colors.bright));
  console.log(colorize(line, colors.cyan));
  console.log('');
}

function printSection(title) {
  console.log(colorize(`\n${'─'.repeat(60)}`, colors.blue));
  console.log(colorize(`  ${title}`, colors.blue + colors.bright));
  console.log(colorize(`${'─'.repeat(60)}`, colors.blue));
}

function printMetric(label, value, format = 'default') {
  const padding = 30;
  const labelPadded = label.padEnd(padding);
  
  let formattedValue = value;
  let valueColor = colors.white;
  
  if (format === 'percentage') {
    const num = parseFloat(value);
    if (num >= 90) valueColor = colors.green;
    else if (num >= 70) valueColor = colors.yellow;
    else valueColor = colors.red;
    formattedValue = `${value}%`;
  } else if (format === 'boolean') {
    if (value) {
      formattedValue = colorize('✓ Yes', colors.green);
    } else {
      formattedValue = colorize('✗ No', colors.red);
    }
  } else if (format === 'number') {
    valueColor = colors.cyan;
    formattedValue = value.toString();
  }
  
  console.log(`  ${colorize(labelPadded, colors.dim)}${valueColor}${formattedValue}${colors.reset}`);
}

function printTable(headers, rows) {
  // Calculate column widths
  const colWidths = headers.map((header, i) => {
    const headerLen = header.length;
    const maxDataLen = Math.max(...rows.map(row => {
      const v = row[i];
      const s = (v === 0) ? '0' : String(v ?? '');
      return s.length;
    }));
    return Math.max(headerLen, maxDataLen) + 2;
  });
  
  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ ');
  console.log(colorize('  ' + '─'.repeat(headerRow.length + 4), colors.dim));
  console.log(colorize('  │ ' + headerRow + ' │', colors.cyan + colors.bright));
  console.log(colorize('  ' + '─'.repeat(headerRow.length + 4), colors.dim));
  
  // Print rows
  rows.forEach(row => {
    const rowData = row.map((cell, i) => {
      const cellStr = (cell === 0) ? '0' : String(cell ?? '');
      // Colorize based on content
      if (typeof cell === 'boolean') {
        return cell ? colorize('✓', colors.green) : colorize('✗', colors.red);
      }
      if (typeof cell === 'number' && i > 0) {
        return colorize(cellStr.padEnd(colWidths[i]), colors.cyan);
      }
      return cellStr.padEnd(colWidths[i]);
    }).join(' │ ');
    console.log('  │ ' + rowData + ' │');
  });
  
  console.log(colorize('  ' + '─'.repeat(headerRow.length + 4), colors.dim));
}

function getStatusIcon(passes, runs) {
  if (passes) return colorize('✓', colors.green);
  if (runs) return colorize('⚠', colors.yellow);
  return colorize('✗', colors.red);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function displayReport(reportPath) {
  try {
    const reportContent = await fs.readFile(reportPath, 'utf-8');
    const report = JSON.parse(reportContent);
    
    // Header
    printHeader('TEST GENERATION EVALUATION REPORT');
    
    // By Model and Type
    if (report.byModelType && Object.keys(report.byModelType).length > 0) {
      printSection('RESULTS BY MODEL AND TYPE');
      
      // Sort by model name, then by type (unit, integration, e2e)
      const typeOrder = { unit: 1, integration: 2, e2e: 3 };
      const modelTypeRows = Object.values(report.byModelType)
        .sort((a, b) => {
          if (a.model !== b.model) return a.model.localeCompare(b.model);
          return (typeOrder[a.type] || 99) - (typeOrder[b.type] || 99);
        })
        .map(stats => {
          // Ensure passCount + failCount = testCount for correct percentages
          // If testCount > passCount + failCount, the difference is considered as failed (or skipped, but we count as failed for percentage)
          const actualTestCount = stats.testCount || 0;
          const actualPassCount = stats.passCount || 0;
          
          const testSuccessRate = actualTestCount > 0
            ? ((actualPassCount / actualTestCount) * 100).toFixed(1) + '%'
            : 'N/A';
          const flakyTestRate = typeof stats.flakyTestRate === 'number' && Number.isFinite(stats.flakyTestRate)
            ? stats.flakyTestRate.toFixed(1) + '%'
            : 'N/A';
          const timeToGenerate = typeof stats.ttgSecondsAvg === 'number' && Number.isFinite(stats.ttgSecondsAvg)
            ? stats.ttgSecondsAvg.toFixed(2) + 's'
            : 'N/A';
          
          // Get coverage for this specific model+type from byModelTypeCoverage
          // Coverage is calculated per test file, so we need to aggregate it
          let coverageDelta = 'N/A';
          if (report.byModelTypeCoverage && report.details) {
            // Find all test files for this model+type and get their coverage
            const testFiles = report.details.filter(d => d.model === stats.model && d.type === stats.type);
            const coverageValues = testFiles
              .map(detail => {
                const fileKey = `${detail.model}::${detail.type}::${path.basename(detail.file)}`;
                const fileCoverage = report.byModelTypeCoverage[fileKey];
                return fileCoverage?.deltaLinesPct;
              })
              .filter(v => typeof v === 'number' && Number.isFinite(v));
            
            if (coverageValues.length > 0) {
              // Average coverage across all test files for this model+type
              const avgDelta = coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length;
              coverageDelta = (avgDelta >= 0 ? '+' : '') + avgDelta.toFixed(1) + ' pp';
            }
          }
          
          return [
            stats.model,
            stats.type.toUpperCase(),
            actualTestCount,
            actualPassCount,
            testSuccessRate,
            flakyTestRate,
            coverageDelta,
            timeToGenerate,
          ];
        });
      
      printTable(
        ['Model', 'Type', 'Tests', 'Passed', 'Test Success Rate', 'Flaky Test Rate', 'Code Coverage Delta', 'Time-to-Generate'],
        modelTypeRows
      );
    }
    
    
    // Footer
    console.log('');
    console.log(colorize('═'.repeat(80), colors.cyan));
    console.log(colorize(`Report generated from: ${reportPath.replace(projectRoot + '/', '')}`, colors.dim));
    console.log(colorize('═'.repeat(80), colors.cyan));
    console.log('');
    
  } catch (error) {
    console.error(colorize('Error reading report:', colors.red), error.message);
    process.exit(1);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes('--json');
  const customPath = args.find(arg => !arg.startsWith('--'));
  
  const reportPath = customPath 
    ? path.resolve(projectRoot, customPath)
    : path.join(projectRoot, 'research-output', 'evaluation-report.json');
  
  if (jsonOnly) {
    // Just output JSON
    const reportContent = await fs.readFile(reportPath, 'utf-8');
    console.log(reportContent);
  } else {
    // Beautiful formatted output
    await displayReport(reportPath);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { displayReport };
