#!/usr/bin/env node

/**
 * Test Generation Script
 * 
 * Generates tests using different LLM models via OpenRouter
 * 
 * Usage:
 *   node scripts/generate-tests.js --model gpt-4-turbo --type unit --target FeedbackForm
 *   node scripts/generate-tests.js --model claude-3.5-sonnet --type integration --target api
 *   node scripts/generate-tests.js --model gemini-pro --type e2e --target feedback-form
 *   node scripts/generate-tests.js --all --type unit
 */

const {
  generateTestForTarget,
  MODELS,
  getAvailableModels,
  saveTestFile,
} = require('./openrouter-client.js');
const { program } = require('commander');
const path = require('path');
const fs = require('fs').promises;

// Map user-friendly model names to OpenRouter model IDs
const MODEL_MAP = {
  'gpt-4-turbo': MODELS.GPT4_TURBO,
  'gpt-4': MODELS.GPT4,
  'gpt-3.5-turbo': MODELS.GPT35_TURBO,
  'claude-3.5-sonnet': MODELS.CLAUDE_3_5_SONNET,
  'claude-3-opus': MODELS.CLAUDE_3_OPUS,
  'claude-3-haiku': MODELS.CLAUDE_3_HAIKU,
  'gemini-pro': MODELS.GEMINI_PRO,
  'gemini-pro-1.5': MODELS.GEMINI_PRO_1_5,
  'llama-3-70b': MODELS.LLAMA_3_70B,
  'llama-3-8b': MODELS.LLAMA_3_8B,
  'mistral-large': MODELS.MISTRAL_LARGE,
  'mixtral-8x7b': MODELS.MIXTRAL_8X7B,
  'deepseek-chat': MODELS.DEEPSEEK_CHAT,
  'qwen-2.5-72b': MODELS.QWEN_2_5_72B,
  // Free models (verified available)
  'llama-3.2-3b-free': MODELS.LLAMA_3_2_3B_FREE,
  'llama-3.1-8b-free': MODELS.LLAMA_3_1_8B_FREE,
  'qwen-2.5-7b-free': MODELS.QWEN_2_5_7B_FREE,
  // Note: Use npm run list:models -- --free to see available free models
  // You can also use full model IDs directly like: qwen/qwen-3-coder
};

// Test targets configuration
const TEST_TARGETS = {
  unit: {
    'FeedbackForm': {
      file: 'client/src/components/__tests__/FeedbackForm.test.jsx',
      description: 'FeedbackForm component unit tests',
    },
    'FeedbackList': {
      file: 'client/src/components/__tests__/FeedbackList.test.jsx',
      description: 'FeedbackList component unit tests',
    },
    'validation': {
      file: 'client/src/utils/__tests__/validation.test.js',
      description: 'Validation utilities unit tests',
    },
  },
  integration: {
    'api': {
      file: 'server/__tests__/api.test.js',
      description: 'API endpoints integration tests',
    },
    'validation': {
      file: 'server/utils/__tests__/validation.test.js',
      description: 'Server validation utilities tests',
    },
  },
  e2e: {
    'feedback-form': {
      file: 'tests/e2e/feedback-form.spec.js',
      description: 'Feedback form E2E tests',
    },
  },
};

program
  .name('generate-tests')
  .description('Generate tests using OpenRouter API with different LLM models')
  .version('1.0.0');

program
  .option('-m, --model <model>', 'Model to use (e.g., gpt-4-turbo, claude-3.5-sonnet)')
  .option('-t, --type <type>', 'Test type (unit, integration, e2e)')
  .option('--target <target>', 'Test target (e.g., FeedbackForm, api)')
  .option('--all', 'Generate all tests for the specified type')
  .option('--output-dir <dir>', 'Output directory for generated tests (default: research-output/)')
  .option('--temperature <temp>', 'Temperature for generation (0-1)', '0.7')
  .option('--max-tokens <tokens>', 'Max tokens for generation', '16000')
  .option('--use-api-models', 'Use models from OpenRouter API instead of hardcoded list')
  .option('--free-only', 'When using API models, only use free models')
  .action(async (options) => {
    try {
      const outputDir = options.outputDir || 'research-output';
      const temperature = parseFloat(options.temperature);
      const maxTokens = parseInt(options.maxTokens) || 16000; // Default 16000 for longer files

      if (!options.type) {
        console.error('Error: --type is required');
        process.exit(1);
      }

      if (!options.all && !options.target) {
        console.error('Error: Either --target or --all is required');
        process.exit(1);
      }

      if (!options.all && !options.model) {
        console.error('Error: --model is required when using --target');
        process.exit(1);
      }

      const testType = options.type;
      const targets = options.all
        ? Object.keys(TEST_TARGETS[testType] || {})
        : [options.target];

      if (options.all) {
        // Try to get models from API, fallback to hardcoded
        let models = Object.keys(MODEL_MAP);
        
        if (options.useApiModels) {
          console.log('Fetching available models from OpenRouter API...');
          try {
            const apiModels = await getAvailableModels(options.freeOnly);
            if (apiModels.length > 0) {
              models = apiModels.map(m => m.id);
              console.log(`Found ${models.length} models from API\n`);
            } else {
              console.log('Using hardcoded models (API unavailable)\n');
            }
          } catch (error) {
            console.log('Using hardcoded models (API error)\n');
          }
        } else {
          console.log(`Generating ${testType} tests for all models...\n`);
        }

        for (const modelName of models) {
          // If using API models, modelName is already the model ID
          const modelId = options.useApiModels ? modelName : MODEL_MAP[modelName];
          if (!modelId) {
            console.warn(`Warning: Unknown model ${modelName}, skipping...`);
            continue;
          }
          console.log(`\n=== Using model: ${modelName} ===\n`);

          for (const target of targets) {
            const targetConfig = TEST_TARGETS[testType][target];
            if (!targetConfig) {
              console.warn(`Warning: Unknown target ${target} for type ${testType}`);
              continue;
            }

            try {
              const startedAt = Date.now();
              const testCode = await generateTestForTarget(
                modelId,
                testType,
                target,
                { temperature, maxTokens }
              );
              const ttgSeconds = (Date.now() - startedAt) / 1000;

              const outputPath = path.join(
                outputDir,
                modelName,
                testType,
                path.basename(targetConfig.file)
              );

              await saveTestFile(outputPath, testCode);
              const metaPath = outputPath + '.meta.json';
              await fs.writeFile(
                metaPath,
                JSON.stringify({
                  modelName,
                  modelId,
                  testType,
                  target,
                  outputPath,
                  temperature,
                  maxTokens,
                  ttgSeconds,
                  generatedAt: new Date().toISOString(),
                }, null, 2),
                'utf-8'
              );
              console.log(`✓ Generated: ${outputPath}`);
            } catch (error) {
              console.error(`✗ Error generating test for ${target} with ${modelName}:`, error.message);
            }
          }
        }
      } else {
        // Generate test for single model
        // Check if it's a full model ID (contains /) or a mapped name
        let modelId;
        if (options.model.includes('/')) {
          // It's a full model ID, use it directly
          modelId = options.model;
        } else {
          // It's a mapped name, look it up
          modelId = MODEL_MAP[options.model];
          if (!modelId) {
            console.error(`Error: Unknown model ${options.model}`);
            console.log('Available models:', Object.keys(MODEL_MAP).join(', '));
            console.log('Or use full model ID like: qwen/qwen-3-coder:free');
            process.exit(1);
          }
        }

        for (const target of targets) {
          const targetConfig = TEST_TARGETS[testType][target];
          if (!targetConfig) {
            console.error(`Error: Unknown target ${target} for type ${testType}`);
            process.exit(1);
          }

          try {
            console.log(`Generating ${testType} test for ${target} using ${options.model}...`);
            const startedAt = Date.now();
            const testCode = await generateTestForTarget(
              modelId,
              testType,
              target,
              { temperature, maxTokens }
            );
            const ttgSeconds = (Date.now() - startedAt) / 1000;

            const outputPath = path.join(
              outputDir,
              options.model,
              testType,
              path.basename(targetConfig.file)
            );

            await saveTestFile(outputPath, testCode);
            const metaPath = outputPath + '.meta.json';
            await fs.writeFile(
              metaPath,
              JSON.stringify({
                modelName: options.model,
                modelId,
                testType,
                target,
                outputPath,
                temperature,
                maxTokens,
                ttgSeconds,
                generatedAt: new Date().toISOString(),
              }, null, 2),
              'utf-8'
            );
            console.log(`✓ Test generated: ${outputPath}`);
          } catch (error) {
            console.error(`✗ Error:`, error.message);
            process.exit(1);
          }
        }
      }

      console.log('\n✓ Test generation complete!');
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  });

program.parse();
