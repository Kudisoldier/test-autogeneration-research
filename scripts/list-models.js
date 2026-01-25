#!/usr/bin/env node

/**
 * List available models from OpenRouter API
 * 
 * Usage:
 *   node scripts/list-models.js
 *   node scripts/list-models.js --free
 *   node scripts/list-models.js --free --json
 */

const { getAvailableModels } = require('./openrouter-client.js');
const { program } = require('commander');

program
  .name('list-models')
  .description('List available models from OpenRouter API')
  .version('1.0.0')
  .option('--free', 'Show only free models')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      console.log('Fetching models from OpenRouter API...\n');
      
      const models = await getAvailableModels(options.free);
      
      if (models.length === 0) {
        console.log('No models found. Using fallback to hardcoded models.');
        process.exit(0);
      }

      if (options.json) {
        console.log(JSON.stringify(models, null, 2));
      } else {
        console.log(`Found ${models.length} model${models.length !== 1 ? 's' : ''}:\n`);
        
        models.forEach((model, index) => {
          const freeBadge = model.isFree ? ' [FREE]' : '';
          console.log(`${index + 1}. ${model.id}${freeBadge}`);
          if (model.name && model.name !== model.id) {
            console.log(`   Name: ${model.name}`);
          }
          if (model.description) {
            console.log(`   Description: ${model.description.substring(0, 100)}...`);
          }
          if (model.context_length) {
            console.log(`   Context: ${model.context_length.toLocaleString()} tokens`);
          }
          if (model.top_provider) {
            console.log(`   Provider: ${model.top_provider.name}`);
          }
          if (model.pricing) {
            const promptPrice = model.pricing.prompt === "0" || model.pricing.prompt === 0 ? "Free" : `$${model.pricing.prompt}/1M`;
            const completionPrice = model.pricing.completion === "0" || model.pricing.completion === 0 ? "Free" : `$${model.pricing.completion}/1M`;
            console.log(`   Pricing: ${promptPrice} prompt, ${completionPrice} completion`);
          }
          console.log('');
        });
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
