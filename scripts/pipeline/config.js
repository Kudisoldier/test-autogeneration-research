/**
 * Resolve planner/generator options: preset defaults <- manifest.generation <- CLI.
 */

const PRESETS = require('./presets.json');

const PRESET_NAMES = new Set(['strict', 'balanced', 'exploratory']);
const SELECTOR_POLICIES = new Set(['auto', 'data-testid', 'role-first', 'none']);

/**
 * @param {object} manifest
 * @param {object} [cliFlags]
 * @param {'plan'|'generate'|'report'} stage - which CLI overrides apply
 *   (plan: planner+json; generate: generator only; report: reporter only)
 */
function resolveGenerationConfig(manifest, cliFlags = {}, stage = 'plan') {
  const gen = manifest.generation || {};
  const presetName =
    cliFlags.preset != null && PRESET_NAMES.has(cliFlags.preset)
      ? cliFlags.preset
      : gen.preset != null && PRESET_NAMES.has(gen.preset)
        ? gen.preset
        : 'balanced';

  const base = PRESETS[presetName] || PRESETS.balanced;

  const planner = {
    temperature: base.planner.temperature,
    top_p: base.planner.top_p,
    max_tokens: base.planner.max_tokens,
    json_mode: base.planner.json_mode !== false,
    ...(gen.planner && typeof gen.planner === 'object' ? gen.planner : {}),
  };

  const generator = {
    temperature: base.generator.temperature,
    top_p: base.generator.top_p,
    max_tokens: base.generator.max_tokens,
    ...(gen.generator && typeof gen.generator === 'object' ? gen.generator : {}),
  };

  const reporterBase = base.reporter || PRESETS.balanced.reporter || {
    temperature: 0.2,
    top_p: 1.0,
    max_tokens: 6000,
  };
  const reporter = {
    temperature: reporterBase.temperature,
    top_p: reporterBase.top_p,
    max_tokens: reporterBase.max_tokens,
    ...(gen.reporter && typeof gen.reporter === 'object' ? gen.reporter : {}),
  };

  if (stage === 'plan') {
    if (cliFlags.plannerTemperature != null) planner.temperature = cliFlags.plannerTemperature;
    if (cliFlags.plannerTopP != null) planner.top_p = cliFlags.plannerTopP;
    if (cliFlags.plannerMaxTokens != null) planner.max_tokens = cliFlags.plannerMaxTokens;
    if (cliFlags.noJsonMode === true) planner.json_mode = false;
  }

  if (stage === 'generate') {
    if (cliFlags.generatorTemperature != null) generator.temperature = cliFlags.generatorTemperature;
    if (cliFlags.generatorTopP != null) generator.top_p = cliFlags.generatorTopP;
    if (cliFlags.generatorMaxTokens != null) generator.max_tokens = cliFlags.generatorMaxTokens;
  }

  if (stage === 'report') {
    if (cliFlags.reporterTemperature != null) reporter.temperature = cliFlags.reporterTemperature;
    if (cliFlags.reporterTopP != null) reporter.top_p = cliFlags.reporterTopP;
    if (cliFlags.reporterMaxTokens != null) reporter.max_tokens = cliFlags.reporterMaxTokens;
  }

  let selector_policy = gen.selector_policy || 'auto';
  if (cliFlags.selectorPolicy != null && SELECTOR_POLICIES.has(cliFlags.selectorPolicy)) {
    selector_policy = cliFlags.selectorPolicy;
  }
  if (!SELECTOR_POLICIES.has(selector_policy)) {
    throw new Error(`Invalid selector_policy: ${selector_policy}`);
  }

  let require_plan_case_comments = gen.require_plan_case_comments !== false;
  if (cliFlags.noPlanCaseComments === true) require_plan_case_comments = false;

  let emit_plan_markdown = gen.emit_plan_markdown !== false;
  if (cliFlags.noPlanMarkdown === true) emit_plan_markdown = false;

  validateNumeric('planner.temperature', planner.temperature, 0, 2);
  validateNumeric('planner.top_p', planner.top_p, 0, 1, true);
  validateInt('planner.max_tokens', planner.max_tokens, 1000);

  validateNumeric('generator.temperature', generator.temperature, 0, 2);
  validateNumeric('generator.top_p', generator.top_p, 0, 1, true);
  validateInt('generator.max_tokens', generator.max_tokens, 1000);

  validateNumeric('reporter.temperature', reporter.temperature, 0, 2);
  validateNumeric('reporter.top_p', reporter.top_p, 0, 1, true);
  validateInt('reporter.max_tokens', reporter.max_tokens, 1000);

  return {
    preset: presetName,
    planner,
    generator,
    reporter,
    selector_policy,
    require_plan_case_comments,
    emit_plan_markdown,
  };
}

function validateNumeric(label, v, min, max, exclusiveMinZero = false) {
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${label} must be a number`);
  if (v < min || v > max) throw new Error(`${label} must be between ${min} and ${max}`);
  if (exclusiveMinZero && v <= 0) throw new Error(`${label} must be > 0`);
}

function validateInt(label, v, min) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.floor(v) !== v) {
    throw new Error(`${label} must be an integer`);
  }
  if (v < min) throw new Error(`${label} must be >= ${min}`);
}

/**
 * Parse commander-style opts into cliFlags for resolveGenerationConfig.
 * @param {object} opts program.opts()
 */
function cliFlagsFromOpts(opts) {
  return {
    preset: opts.preset,
    plannerTemperature: opts.plannerTemperature,
    plannerTopP: opts.plannerTopP,
    plannerMaxTokens: opts.plannerMaxTokens,
    noJsonMode: opts.noJsonMode === true,
    generatorTemperature: opts.generatorTemperature,
    generatorTopP: opts.generatorTopP,
    generatorMaxTokens: opts.generatorMaxTokens,
    reporterTemperature: opts.reporterTemperature,
    reporterTopP: opts.reporterTopP,
    reporterMaxTokens: opts.reporterMaxTokens,
    selectorPolicy: opts.selectorPolicy,
    noPlanMarkdown: opts.noPlanMarkdown === true,
    noPlanCaseComments: opts.noPlanCaseComments === true,
  };
}

module.exports = {
  resolveGenerationConfig,
  cliFlagsFromOpts,
  PRESET_NAMES,
  SELECTOR_POLICIES,
};
