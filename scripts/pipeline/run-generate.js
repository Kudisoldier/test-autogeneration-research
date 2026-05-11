#!/usr/bin/env node
/**
 * Stage 2: generator — context_manifest.json + test_plan.json → generated/<repo-relative test file>
 *
 * Usage:
 *   node scripts/pipeline/run-generate.js --run-dir research-output/runs/run-123 --model qwen/qwen-2.5-7b-instruct:free
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const {
  buildGeneratorUserPrompt,
  validateManifest,
  validatePlan,
  buildDynamicPromptTail,
  fixEsmSpecifierDepthForNestedTests,
} = require('./build-context.js');
const { resolveGenerationConfig, cliFlagsFromOpts } = require('./config.js');
const { generateTestWithRetry } = require('../openrouter-client.js');
const { sanitizeGeneratedTestSource } = require('./sanitize-generated-source.js');

const projectRoot = path.resolve(__dirname, '..', '..');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

async function loadGeneratorSystem(testLevel) {
  const p = path.join(PROMPTS_DIR, 'generator.system.md');
  const raw = await fs.readFile(p, 'utf-8');
  return raw.replace(/\{\{TEST_LEVEL\}\}/g, testLevel);
}

async function main() {
  program
    .requiredOption('--run-dir <path>', 'Run directory containing context_manifest.json and test_plan.json')
    .requiredOption('--model <id>', 'OpenRouter model id')
    .option('--preset <name>', 'strict | balanced | exploratory')
    .option('--generator-temperature <n>', 'Override generator temperature', parseFloat)
    .option('--generator-top-p <n>', 'Override generator top_p', parseFloat)
    .option('--generator-max-tokens <n>', 'Override generator max_tokens', (v) => parseInt(v, 10))
    .option('--selector-policy <p>', 'auto | data-testid | role-first | none')
    .option('--no-plan-case-comments', 'Set require_plan_case_comments=false')
    .parse();

  const opts = program.opts();
  const runDir = path.resolve(opts.runDir);

  const manifestPath = path.join(runDir, 'context_manifest.json');
  const planPath = path.join(runDir, 'test_plan.json');

  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  const plan = JSON.parse(await fs.readFile(planPath, 'utf-8'));

  const mErr = validateManifest(manifest);
  if (mErr.length) {
    console.error('Manifest validation failed:', mErr.join('; '));
    process.exit(2);
  }
  const pErr = validatePlan(plan);
  if (pErr.length) {
    console.error('Plan validation failed:', pErr.join('; '));
    process.exit(2);
  }

  let resolved;
  try {
    resolved = resolveGenerationConfig(manifest, cliFlagsFromOpts(opts), 'generate');
  } catch (e) {
    console.error('Generation config error:', e.message);
    process.exit(2);
  }

  const userPrompt = await buildGeneratorUserPrompt(projectRoot, manifest, plan, resolved);
  const baseSystem = await loadGeneratorSystem(manifest.test_level);
  const systemPrompt = baseSystem + buildDynamicPromptTail('generator', manifest, resolved);

  const startedAt = Date.now();
  let code;
  try {
    code = await generateTestWithRetry(
      opts.model,
      userPrompt,
      {
        temperature: resolved.generator.temperature,
        maxTokens: resolved.generator.max_tokens,
        topP: resolved.generator.top_p,
        systemPrompt,
      },
      3
    );
  } catch (e) {
    console.error('Generator API error:', e.message);
    process.exit(1);
  }

  let cleaned = code.trim();
  cleaned = cleaned.replace(/^```(?:javascript|js|ts|tsx|jsx)?\n?/gm, '');
  cleaned = cleaned.replace(/\n?```$/gm, '');
  cleaned = cleaned.trim();

  const relOut = manifest.output_policy.primary_test_file.replace(/\\/g, '/');
  cleaned = sanitizeGeneratedTestSource(cleaned, { relOut });
  cleaned = fixEsmSpecifierDepthForNestedTests(cleaned, relOut, manifest.files || []);

  const absOut = path.join(runDir, 'generated', relOut);
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await fs.writeFile(absOut, cleaned, 'utf-8');

  const meta = {
    stage: 'generate',
    model: opts.model,
    output_file: absOut,
    seconds: (Date.now() - startedAt) / 1000,
    generatedAt: new Date().toISOString(),
    resolved_generation: resolved,
    require_plan_case_comments: resolved.require_plan_case_comments,
    selector_policy: resolved.selector_policy,
  };
  await fs.writeFile(path.join(runDir, 'generate.meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`Wrote: ${absOut}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
