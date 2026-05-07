#!/usr/bin/env node
/**
 * Stage 1: planner — context_manifest.json → test_plan.json (+ test_plan.md, plan.meta.json)
 *
 * Usage:
 *   node scripts/pipeline/run-plan.js --manifest specs/pipeline/examples/unit_ui.manifest.json --model qwen/qwen-2.5-7b-instruct:free
 *
 * Exit codes: 1 usage/API error, 2 manifest/plan validation
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');
const {
  buildContextBundle,
  validateManifest,
  validatePlan,
  buildDynamicPromptTail,
  renderTestPlanMarkdown,
  getOpenapiSubsetMeta,
} = require('./build-context.js');
const { resolveGenerationConfig, cliFlagsFromOpts } = require('./config.js');
const { generateJsonWithRetry } = require('../openrouter-client.js');

const projectRoot = path.resolve(__dirname, '..', '..');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

const PLAN_SCHEMA_HINT = `Return a single JSON object (no markdown) with exactly:
- schema_version: "1"
- test_level: must match the manifest
- target: string
- cases: array (min 1). Each item: id (string), title (string), steps (string array, min 1), assertions (string array, min 1); optional: preconditions, negative_paths, data, links { requirement_ids, operation_ids }, flakiness_risks
- optional: fixtures (array), framework_hints (object)`;

async function loadPlannerSystem(testLevel) {
  const p = path.join(PROMPTS_DIR, 'planner.system.md');
  const raw = await fs.readFile(p, 'utf-8');
  return raw.replace(/\{\{TEST_LEVEL\}\}/g, testLevel);
}

async function main() {
  program
    .requiredOption('--model <id>', 'OpenRouter model id')
    .option('--manifest <path>', 'Source context_manifest.json (copied into run dir)')
    .option('--run-dir <path>', 'Existing run directory (must contain context_manifest.json if --manifest omitted)')
    .option('--run-id <id>', 'Run folder name under research-output/runs/')
    .option('--output-root <path>', 'Default: research-output', path.join(projectRoot, 'research-output'))
    .option('--preset <name>', 'strict | balanced | exploratory')
    .option('--planner-temperature <n>', 'Override planner temperature', parseFloat)
    .option('--planner-top-p <n>', 'Override planner top_p', parseFloat)
    .option('--planner-max-tokens <n>', 'Override planner max_tokens', (v) => parseInt(v, 10))
    .option('--no-json-mode', 'Do not send response_format json_object (for incompatible models)')
    .option('--selector-policy <p>', 'auto | data-testid | role-first | none')
    .option('--no-plan-markdown', 'Do not write test_plan.md')
    .option('--no-plan-case-comments', 'Set require_plan_case_comments=false for downstream generate')
    .parse();

  const opts = program.opts();
  const outputRoot = path.resolve(opts.outputRoot);

  let runDir;
  if (opts.runDir) {
    runDir = path.resolve(opts.runDir);
  } else if (opts.manifest) {
    const runId = opts.runId || `run-${Date.now()}`;
    runDir = path.join(outputRoot, 'runs', runId);
  } else {
    console.error('Provide --manifest (creates a new run dir) or --run-dir (existing run with context_manifest.json).');
    process.exit(2);
  }

  await fs.mkdir(runDir, { recursive: true });

  const destManifest = path.join(runDir, 'context_manifest.json');
  if (opts.manifest) {
    const src = path.resolve(process.cwd(), opts.manifest);
    await fs.copyFile(src, destManifest);
  } else {
    try {
      await fs.access(destManifest);
    } catch {
      console.error('No --manifest given and context_manifest.json missing in --run-dir.');
      process.exit(2);
    }
  }

  const manifest = JSON.parse(await fs.readFile(destManifest, 'utf-8'));
  const mErr = validateManifest(manifest);
  if (mErr.length) {
    console.error('Manifest validation failed:', mErr.join('; '));
    process.exit(2);
  }

  let resolved;
  try {
    resolved = resolveGenerationConfig(manifest, cliFlagsFromOpts(opts), 'plan');
  } catch (e) {
    console.error('Generation config error:', e.message);
    process.exit(2);
  }

  const bundle = await buildContextBundle(projectRoot, manifest, 'planner');
  const baseSystem = await loadPlannerSystem(manifest.test_level);
  const systemPrompt = baseSystem + buildDynamicPromptTail('planner', manifest, resolved);
  const userContent = `## CONTEXT_BUNDLE\n\n${bundle}\n\n## OUTPUT_CONTRACT\n\n${PLAN_SCHEMA_HINT}\n`;

  const plannerOpts = {
    temperature: resolved.planner.temperature,
    maxTokens: resolved.planner.max_tokens,
    jsonObject: resolved.planner.json_mode !== false,
    topP: resolved.planner.top_p,
  };

  const startedAt = Date.now();
  let raw;
  try {
    raw = await generateJsonWithRetry(opts.model, { systemPrompt, userContent }, plannerOpts);
  } catch (e) {
    console.error('Planner API error:', e.message);
    process.exit(1);
  }

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (e) {
    console.warn('First JSON parse failed; attempting one repair call...', e.message);
    const repairUser = `${userContent}\n\n## PREVIOUS_INVALID_OUTPUT\n\n${raw.slice(0, 12000)}\n\nReturn only fixed valid JSON.`;
    raw = await generateJsonWithRetry(opts.model, { systemPrompt, userContent: repairUser }, {
      temperature: 0.1,
      maxTokens: resolved.planner.max_tokens,
      jsonObject: resolved.planner.json_mode !== false,
      topP: 1,
    });
    try {
      plan = JSON.parse(raw);
    } catch (e2) {
      console.error('JSON parse failed after repair:', e2.message);
      process.exit(2);
    }
  }

  const pErr = validatePlan(plan);
  if (pErr.length) {
    console.warn('Plan validation failed; attempting one repair...', pErr.join('; '));
    const repairUser = `${userContent}\n\n## VALIDATION_ERRORS\n\n${pErr.join('\n')}\n\n## INVALID_PLAN_JSON\n\n${JSON.stringify(plan).slice(0, 12000)}\n\nReturn only corrected JSON.`;
    raw = await generateJsonWithRetry(opts.model, { systemPrompt, userContent: repairUser }, {
      temperature: 0.1,
      maxTokens: resolved.planner.max_tokens,
      jsonObject: resolved.planner.json_mode !== false,
      topP: 1,
    });
    try {
      plan = JSON.parse(raw);
    } catch (e) {
      console.error('Repair parse failed:', e.message);
      process.exit(2);
    }
    const pErr2 = validatePlan(plan);
    if (pErr2.length) {
      console.error('Plan still invalid:', pErr2.join('; '));
      process.exit(2);
    }
  }

  const planPath = path.join(runDir, 'test_plan.json');
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');

  if (resolved.emit_plan_markdown) {
    const mdPath = path.join(runDir, 'test_plan.md');
    await fs.writeFile(mdPath, renderTestPlanMarkdown(plan), 'utf-8');
    console.log(`Wrote: ${mdPath}`);
  }

  const meta = {
    stage: 'plan',
    model: opts.model,
    run_dir: runDir,
    manifest_path: destManifest,
    seconds: (Date.now() - startedAt) / 1000,
    generatedAt: new Date().toISOString(),
    resolved_generation: resolved,
  };

  if (manifest.test_level === 'integration_server' || manifest.test_level === 'integration_ui') {
    const om = await getOpenapiSubsetMeta(projectRoot, manifest);
    meta.openapi_subset = {
      matched_operation_ids: om.matchedOperationIds,
      used_subset: om.usedSubset,
    };
  }

  await fs.writeFile(path.join(runDir, 'plan.meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`Run directory: ${runDir}`);
  console.log(`Wrote: ${planPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
