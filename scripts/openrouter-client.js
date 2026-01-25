/**
 * OpenRouter API Client for Test Generation
 * 
 * This utility provides a client for interacting with OpenRouter API
 * to generate tests using different LLM models.
 */

const dotenv = require('dotenv');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

dotenv.config();

// Get project root directory (one level up from scripts/)
const projectRoot = path.resolve(__dirname, '..');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * Available models for test generation research
 */
const MODELS = {
  // OpenAI Models
  GPT4_TURBO: 'openai/gpt-4-turbo',
  GPT4: 'openai/gpt-4',
  GPT35_TURBO: 'openai/gpt-3.5-turbo',
  
  // Anthropic Models
  CLAUDE_3_5_SONNET: 'anthropic/claude-3.5-sonnet',
  CLAUDE_3_OPUS: 'anthropic/claude-3-opus',
  CLAUDE_3_HAIKU: 'anthropic/claude-3-haiku',
  
  // Google Models
  GEMINI_PRO: 'google/gemini-pro',
  GEMINI_PRO_1_5: 'google/gemini-pro-1.5',
  
  // Meta Models
  LLAMA_3_70B: 'meta-llama/llama-3-70b-instruct',
  LLAMA_3_8B: 'meta-llama/llama-3-8b-instruct',
  
  // Mistral Models
  MISTRAL_LARGE: 'mistralai/mistral-large',
  MIXTRAL_8X7B: 'mistralai/mixtral-8x7b-instruct',
  
  // Other Models
  DEEPSEEK_CHAT: 'deepseek/deepseek-chat',
  QWEN_2_5_72B: 'qwen/qwen-2.5-72b-instruct',
  
  // Free Models (using :free variant)
  LLAMA_3_2_3B_FREE: 'meta-llama/llama-3.2-3b-instruct:free',
  LLAMA_3_1_8B_FREE: 'meta-llama/llama-3.1-8b-instruct:free',
  QWEN_2_5_7B_FREE: 'qwen/qwen-2.5-7b-instruct:free',
  // Note: qwen-3-coder may not have :free variant, check with list:models
};

/**
 * Get available models from OpenRouter API
 * 
 * @param {boolean} freeOnly - If true, return only free models
 * @returns {Promise<Array>} Array of available models
 */
async function getAvailableModels(freeOnly = false) {
  try {
    const response = await axios.get(OPENROUTER_MODELS_URL, {
      timeout: 10000,
    });

    if (!response.data || !response.data.data) {
      return [];
    }

    let models = response.data.data;

    // Filter free models if requested
    if (freeOnly) {
      models = models.filter(model => {
        // Check if model has free pricing (pricing.prompt === "0" and pricing.completion === "0")
        const pricing = model.pricing;
        return pricing && 
               (pricing.prompt === "0" || pricing.prompt === 0) && 
               (pricing.completion === "0" || pricing.completion === 0);
      });
    }

    // Sort by name
    models.sort((a, b) => {
      const nameA = a.id || a.name || '';
      const nameB = b.id || b.name || '';
      return nameA.localeCompare(nameB);
    });

    return models.map(model => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description,
      context_length: model.context_length,
      architecture: model.architecture,
      top_provider: model.top_provider,
      pricing: model.pricing,
      isFree: model.pricing && 
              (model.pricing.prompt === "0" || model.pricing.prompt === 0) && 
              (model.pricing.completion === "0" || model.pricing.completion === 0),
    }));
  } catch (error) {
    console.error('Error fetching models from OpenRouter:', error.message);
    // Return empty array on error, fallback to hardcoded models
    return [];
  }
}

/**
 * Generate test code using OpenRouter API
 * 
 * @param {string} model - Model identifier from MODELS
 * @param {string} prompt - Prompt for test generation
 * @param {Object} options - Additional options
 * @returns {Promise<string>} Generated test code
 */
async function generateTest(model, prompt, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set in .env file');
  }

  const {
    temperature = 0.7,
    maxTokens = 16000, // Increased for longer test files
    systemPrompt = getDefaultSystemPrompt(),
  } = options;

  try {
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature,
        max_tokens: maxTokens,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/your-repo',
          'X-Title': 'Test Generation Research',
        },
        timeout: 60000, // 60 seconds timeout
      }
    );

    if (response.data.error) {
      // Handle rate limiting (429) with retry
      if (response.status === 429 || response.data.error.code === 429) {
        const retryAfter = response.headers['retry-after'] || 5;
        throw new Error(`RATE_LIMIT:${retryAfter}:${response.data.error.message}`);
      }
      throw new Error(`OpenRouter API error: ${response.data.error.message}`);
    }

    return response.data.choices[0]?.message?.content || '';
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new Error(`OpenRouter API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // The request was made but no response was received
      throw new Error(`Network error: No response from OpenRouter API. ${error.message}`);
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`Error: ${error.message}`);
    }
  }
}

/**
 * Get default system prompt for test generation
 */
function getDefaultSystemPrompt() {
  return `You are an expert test engineer specializing in generating comprehensive test suites for web applications.

Your task is to generate high-quality test code following best practices:
- Use appropriate testing frameworks (Jest, React Testing Library, Playwright, Supertest)
- Write clear, maintainable, and well-documented tests
- Cover both happy paths and edge cases
- Use data-testid attributes for element selection
- Follow the test specification provided
- Generate complete, runnable test files
- IMPORTANT: Use correct import paths based on test file location:
  * Tests in components/__tests__/ should use: import X from '../ComponentName' and import Y from '../../utils/module'
  * Tests in utils/__tests__/ should use: import X from '../module'
  * Always use relative paths with correct number of '../' based on directory depth
- Generate the COMPLETE file - ensure all test cases are fully implemented, including closing braces and proper file structure

Return only the test code without explanations or markdown formatting unless specifically requested.`;
}

/**
 * Load test specification
 */
async function loadTestSpecification() {
  const specPath = path.join(projectRoot, 'TEST_SPECIFICATION.md');
  return await fs.readFile(specPath, 'utf-8');
}

/**
 * Load test generation guide
 */
async function loadTestGenerationGuide() {
  const guidePath = path.join(projectRoot, 'TEST_GENERATION_GUIDE.md');
  return await fs.readFile(guidePath, 'utf-8');
}

/**
 * Load source code file for context
 */
async function loadSourceCode(filePath) {
  const fullPath = path.join(projectRoot, filePath);
  return await fs.readFile(fullPath, 'utf-8');
}

/**
 * Save generated test to file
 */
async function saveTestFile(filePath, content) {
  const fullPath = path.join(projectRoot, filePath);
  const dir = path.dirname(fullPath);
  
  // Clean content - remove markdown code blocks if present
  let cleanedContent = content.trim();
  
  // Remove markdown code blocks
  cleanedContent = cleanedContent.replace(/^```(?:javascript|js|ts|tsx|jsx)?\n?/gm, '');
  cleanedContent = cleanedContent.replace(/\n?```$/gm, '');
  cleanedContent = cleanedContent.trim();
  
  // Check if file appears incomplete (missing closing braces)
  const openBraces = (cleanedContent.match(/\{/g) || []).length;
  const closeBraces = (cleanedContent.match(/\}/g) || []).length;
  const openParens = (cleanedContent.match(/\(/g) || []).length;
  const closeParens = (cleanedContent.match(/\)/g) || []).length;
  
  if (openBraces > closeBraces || openParens > closeParens) {
    console.warn(`⚠ Warning: Generated file may be incomplete (unmatched braces/parens)`);
  }
  
  // Create directory if it doesn't exist
  await fs.mkdir(dir, { recursive: true });
  
  // Save file
  await fs.writeFile(fullPath, cleanedContent, 'utf-8');
  
  return fullPath;
}

/**
 * Generate test with retry logic for rate limits
 */
async function generateTestWithRetry(model, prompt, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await generateTest(model, prompt, options);
    } catch (error) {
      if (error.message.startsWith('RATE_LIMIT:')) {
        const [, retryAfter, message] = error.message.split(':');
        const waitTime = parseInt(retryAfter) * 1000;
        
        if (attempt < maxRetries) {
          console.log(`Rate limited. Waiting ${retryAfter} seconds before retry ${attempt + 1}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }
      throw error;
    }
  }
}

/**
 * Generate test for a specific component/endpoint
 * 
 * @param {string} model - Model to use
 * @param {string} testType - Type of test (unit, integration, e2e)
 * @param {string} target - Target component/endpoint
 * @param {Object} options - Additional options
 */
async function generateTestForTarget(model, testType, target, options = {}) {
  const spec = await loadTestSpecification();
  const guide = await loadTestGenerationGuide();
  
  let sourceCode = '';
  let prompt = '';
  
  // Load relevant source code based on target
  if (testType === 'unit' || testType === 'e2e') {
    if (target.includes('FeedbackForm')) {
      sourceCode = await loadSourceCode('client/src/components/FeedbackForm.jsx');
    } else if (target.includes('FeedbackList')) {
      sourceCode = await loadSourceCode('client/src/components/FeedbackList.jsx');
    } else if (target.includes('validation')) {
      sourceCode = await loadSourceCode('client/src/utils/validation.js');
    }
  } else if (testType === 'integration') {
    sourceCode = await loadSourceCode('server/index.js');
  }
  
  // Build prompt based on test type
  if (testType === 'unit') {
    prompt = buildUnitTestPrompt(target, sourceCode, spec, guide);
  } else if (testType === 'integration') {
    prompt = buildIntegrationTestPrompt(target, sourceCode, spec, guide);
  } else if (testType === 'e2e') {
    prompt = buildE2ETestPrompt(target, sourceCode, spec, guide);
  }
  
  console.log(`Generating ${testType} test for ${target} using ${model}...`);
  const testCode = await generateTestWithRetry(model, prompt, options);
  
  return testCode;
}

module.exports = {
  generateTest,
  MODELS,
  getAvailableModels,
  loadTestSpecification,
  loadTestGenerationGuide,
  loadSourceCode,
  saveTestFile,
  generateTestForTarget,
};

function buildUnitTestPrompt(target, sourceCode, spec, guide) {
  // Determine correct import paths based on target
  let importPathInfo = '';
  if (target.includes('FeedbackForm') || target.includes('FeedbackList')) {
    importPathInfo = `
IMPORT PATHS (CRITICAL - Tests are in components/__tests__/ folder):
- Component import: import FeedbackForm from '../FeedbackForm'
- Utils imports: import { validateField } from '../../utils/validation'
- Utils imports: import { submitFeedback } from '../../utils/api'
- Constants imports: import { INITIAL_FORM_DATA } from '../../utils/constants'
- Use '../../' to go up two levels from __tests__/ to src/, then down to utils/
`;
  } else if (target.includes('validation')) {
    importPathInfo = `
IMPORT PATHS (CRITICAL - Tests are in utils/__tests__/ folder):
- Utils imports: import { validateField } from '../validation'
- Use '../' to go up one level from __tests__/ to utils/
`;
  }

  return `Generate a comprehensive unit test file for: ${target}

${importPathInfo}

SOURCE CODE:
\`\`\`
${sourceCode}
\`\`\`

TEST SPECIFICATION:
\`\`\`
${spec}
\`\`\`

GENERATION GUIDE:
\`\`\`
${guide}
\`\`\`

CRITICAL REQUIREMENTS:
1. Generate a COMPLETE test file - ensure the file is fully finished with all closing braces
2. Use CORRECT import paths as specified above (use '../../' for components/__tests__/, '../' for utils/__tests__/)
3. Use Jest and React Testing Library (for components) or Jest (for utilities)
4. Cover all test scenarios mentioned in the specification
5. Use data-testid attributes for element selection
6. Include proper setup, teardown, and assertions
7. Ensure the file ends properly with closing braces for all blocks
8. Return only the test code, no explanations, no markdown code blocks

Generate the COMPLETE test file now:`;
}

function buildIntegrationTestPrompt(target, sourceCode, spec, guide) {
  return `Generate a comprehensive integration test file for: ${target}

IMPORT PATHS (CRITICAL - Tests are in server/__tests__/ or server/utils/__tests__/ folder):
- Server imports: const app = require('../index')
- Utils imports: const { clearFeedbacks } = require('../utils/storage')
- Use '../' to go up one level from __tests__/ to server/ or utils/

SOURCE CODE:
\`\`\`
${sourceCode}
\`\`\`

TEST SPECIFICATION:
\`\`\`
${spec}
\`\`\`

GENERATION GUIDE:
\`\`\`
${guide}
\`\`\`

CRITICAL REQUIREMENTS:
1. Generate a COMPLETE test file - ensure the file is fully finished with all closing braces
2. Use CORRECT import paths as specified above
3. Generate a complete integration test file using Jest and Supertest
4. Test all API endpoints mentioned in the specification
5. Include proper request/response validation
6. Test error cases and edge cases
7. Use clearFeedbacks() to reset state between tests
8. Ensure the file ends properly with closing braces for all blocks
9. Return only the test code, no explanations, no markdown code blocks

Generate the COMPLETE test file now:`;
}

function buildE2ETestPrompt(target, sourceCode, spec, guide) {
  return `Generate a comprehensive E2E test file for: ${target}

IMPORT PATHS (CRITICAL - Tests are in client/tests/e2e/ folder):
- Playwright imports: import { test, expect } from '@playwright/test'
- Use standard Playwright imports, no relative paths needed for framework

SOURCE CODE:
\`\`\`
${sourceCode}
\`\`\`

TEST SPECIFICATION:
\`\`\`
${spec}
\`\`\`

GENERATION GUIDE:
\`\`\`
${guide}
\`\`\`

CRITICAL REQUIREMENTS:
1. Generate a COMPLETE test file - ensure the file is fully finished with all closing braces
2. Generate a complete E2E test file using Playwright
3. Test complete user flows mentioned in the specification
4. Use data-testid attributes for element selection
5. Include proper waits and assertions
6. Test both happy paths and error scenarios
7. Ensure the file ends properly with closing braces for all blocks
8. Return only the test code, no explanations, no markdown code blocks

Generate the COMPLETE test file now:`;
}
