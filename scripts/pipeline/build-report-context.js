/**
 * Build a deterministic context bundle for the reporter stage:
 *   - Parse `// plan-case: <id>` comments in the generated test file and associate
 *     each id with the enclosing/next `test|it|describe` block.
 *   - Cross-reference plan case ids with Jest per-test results (`jest-results.json`)
 *     to produce a coverage matrix the LLM consumes alongside the raw artifacts.
 *
 * No LLM calls; pure data. Safe to unit test in isolation.
 */

const PLAN_CASE_LINE_RE = /\/\/\s*plan-case:\s*([a-zA-Z0-9_-]+)/g;
const DESCRIBE_RE = /\b(?:describe)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
const TEST_RE = /\b(?:test|it)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

/**
 * Walk source line-by-line, tracking describe scope via a brace-depth stack so a
 * `// plan-case: <id>` comment is attached to the next test/describe (and propagates
 * from a describe to all nested tests).
 *
 * @param {string} source generated test file content
 * @returns {{
 *   tests: Array<{ fullName: string, title: string, ancestorTitles: string[], planCaseIds: string[] }>,
 *   caseToTests: Record<string, string[]>,
 *   knownCaseIds: string[]
 * }}
 */
function parsePlanCaseAssignments(source) {
  const lines = String(source || '').split('\n');
  const tests = [];
  const stack = [];
  let pendingIds = [];
  let depth = 0;

  for (const line of lines) {
    const depthBefore = depth;

    while (stack.length && depthBefore <= stack[stack.length - 1].depth) {
      stack.pop();
    }

    const planMatches = [...line.matchAll(new RegExp(PLAN_CASE_LINE_RE.source, 'g'))];
    for (const m of planMatches) pendingIds.push(m[1]);

    const dm = line.match(DESCRIBE_RE);
    if (dm) {
      const title = decodeStringLiteral(dm[2]);
      stack.push({ title, ids: new Set(pendingIds), depth: depthBefore });
      pendingIds = [];
    }

    const tm = line.match(TEST_RE);
    if (tm && !dm) {
      const title = decodeStringLiteral(tm[2]);
      const ids = new Set(pendingIds);
      for (const s of stack) for (const id of s.ids) ids.add(id);
      const ancestorTitles = stack.map((s) => s.title).filter((t) => typeof t === 'string');
      const fullName = [...ancestorTitles, title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      tests.push({
        fullName,
        title,
        ancestorTitles,
        planCaseIds: [...ids],
      });
      pendingIds = [];
    }

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    depth += opens - closes;
  }

  const caseToTests = {};
  const knownCaseIds = new Set();
  for (const t of tests) {
    for (const id of t.planCaseIds) {
      knownCaseIds.add(id);
      if (!caseToTests[id]) caseToTests[id] = [];
      if (!caseToTests[id].includes(t.fullName)) caseToTests[id].push(t.fullName);
    }
  }

  return { tests, caseToTests, knownCaseIds: [...knownCaseIds] };
}

function decodeStringLiteral(raw) {
  return String(raw || '')
    .replace(/\\(['"`\\])/g, '$1')
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compose the per-plan-case coverage matrix. Each case from the plan gets a status
 * derived from the linked Jest assertionResults across all generated test files.
 *
 * Status priority: any failed -> 'failed'; otherwise all passed -> 'passed';
 * pending only -> 'pending'; mapped tests but Jest didn't run them -> 'not_run';
 * no `// plan-case` mapping found -> 'not_implemented'.
 *
 * @param {object} plan
 * @param {Array<{ rel:string, runs:boolean, passes:boolean, assertionResults: Array<object> }>} jestRows
 * @param {{ tests:Array, caseToTests:Record<string,string[]> }} parseResult
 * @returns {{
 *   coverageMatrix: Array<object>,
 *   totals: { total:number, implemented:number, passed:number, failed:number, notRun:number, notImplemented:number, pending:number }
 * }}
 */
function buildCoverageMatrix(plan, jestRows, parseResult) {
  const cases = Array.isArray(plan && plan.cases) ? plan.cases : [];
  const rows = Array.isArray(jestRows) ? jestRows : [];

  const allAssertions = [];
  let anyRuns = false;
  for (const r of rows) {
    if (r && r.runs === true) anyRuns = true;
    const ars = Array.isArray(r && r.assertionResults) ? r.assertionResults : [];
    for (const a of ars) {
      const fullName = typeof a.fullName === 'string' && a.fullName.length
        ? a.fullName.replace(/\s+/g, ' ').trim()
        : [...(a.ancestorTitles || []), a.title || ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      allAssertions.push({
        rel: r.rel,
        fullName,
        title: a.title || '',
        ancestorTitles: a.ancestorTitles || [],
        status: a.status || 'unknown',
        failureMessages: Array.isArray(a.failureMessages) ? a.failureMessages : [],
      });
    }
  }

  const byFullName = new Map();
  for (const a of allAssertions) {
    if (!byFullName.has(a.fullName)) byFullName.set(a.fullName, []);
    byFullName.get(a.fullName).push(a);
  }

  const coverageMatrix = [];
  const totals = {
    total: cases.length,
    implemented: 0,
    passed: 0,
    failed: 0,
    notRun: 0,
    notImplemented: 0,
    pending: 0,
  };

  for (const c of cases) {
    const id = c && c.id;
    const links = (c && c.links) || {};
    const mappedTestNames = (parseResult.caseToTests && parseResult.caseToTests[id]) || [];
    const matchedAssertions = [];
    for (const fn of mappedTestNames) {
      const found = byFullName.get(fn);
      if (found && found.length) matchedAssertions.push(...found);
    }

    let status;
    let failureMessages = [];

    if (mappedTestNames.length === 0) {
      status = 'not_implemented';
      totals.notImplemented += 1;
    } else if (!anyRuns && matchedAssertions.length === 0) {
      status = 'not_run';
      totals.implemented += 1;
      totals.notRun += 1;
    } else if (matchedAssertions.length === 0) {
      status = 'not_run';
      totals.implemented += 1;
      totals.notRun += 1;
    } else {
      totals.implemented += 1;
      const statuses = matchedAssertions.map((a) => a.status);
      if (statuses.some((s) => s === 'failed')) {
        status = 'failed';
        totals.failed += 1;
        for (const a of matchedAssertions) {
          if (a.status === 'failed' && a.failureMessages.length) {
            failureMessages.push(...a.failureMessages);
          }
        }
      } else if (statuses.every((s) => s === 'passed')) {
        status = 'passed';
        totals.passed += 1;
      } else if (statuses.every((s) => s === 'pending' || s === 'skipped' || s === 'todo')) {
        status = 'pending';
        totals.pending += 1;
      } else {
        status = 'failed';
        totals.failed += 1;
      }
    }

    coverageMatrix.push({
      id: id || null,
      title: (c && c.title) || '',
      status,
      mapped_tests: mappedTestNames,
      matched_jest_tests: matchedAssertions.map((a) => ({
        fullName: a.fullName,
        status: a.status,
      })),
      failureMessages,
      linked_requirement_ids: Array.isArray(links.requirement_ids) ? links.requirement_ids : [],
      linked_operation_ids: Array.isArray(links.operation_ids) ? links.operation_ids : [],
      flakiness_risks: Array.isArray(c && c.flakiness_risks) ? c.flakiness_risks : [],
    });
  }

  return { coverageMatrix, totals };
}

/**
 * Compose the user-content sections for the reporter LLM call. Pure string builder;
 * does not call any model. Caller passes the manifest context bundle separately.
 *
 * @param {object} args
 * @param {object} args.runMeta
 * @param {object} args.plan
 * @param {Array<object>} args.coverageMatrix
 * @param {object} args.totals
 * @param {string} args.testFileRel
 * @param {string} args.testFileContent
 * @param {Array<object>} args.jestRows
 * @param {string} args.codeContextBundle
 */
function buildReporterUserContent(args) {
  const {
    runMeta,
    plan,
    coverageMatrix,
    totals,
    testFileRel,
    testFileContent,
    jestRows,
    codeContextBundle,
  } = args;

  const slimJest = (Array.isArray(jestRows) ? jestRows : []).map((r) => ({
    rel: r.rel,
    runs: r.runs === true,
    passes: r.passes === true,
    testCount: r.testCount || 0,
    passCount: r.passCount || 0,
    failCount: r.failCount || 0,
    assertionResults: (Array.isArray(r.assertionResults) ? r.assertionResults : []).map((a) => ({
      fullName: a.fullName,
      title: a.title,
      ancestorTitles: a.ancestorTitles || [],
      status: a.status,
      failureMessages: Array.isArray(a.failureMessages)
        ? a.failureMessages.map((m) => truncate(m, 4000))
        : [],
    })),
  }));

  const sections = [];
  sections.push(
    `## RUN_META\n\n\`\`\`json\n${JSON.stringify(runMeta || {}, null, 2)}\n\`\`\`\n`
  );
  sections.push(
    `## PLAN\n\n\`\`\`json\n${JSON.stringify(plan || {}, null, 2)}\n\`\`\`\n`
  );
  sections.push(
    `## COVERAGE_MATRIX (JSON)\n\n\`\`\`json\n${JSON.stringify(
      { totals, cases: coverageMatrix },
      null,
      2
    )}\n\`\`\`\n`
  );
  sections.push(
    `## TEST_FILE: ${testFileRel || '(unknown)'}\n\n\`\`\`\n${truncate(testFileContent || '', 60000)}\n\`\`\`\n`
  );
  sections.push(
    `## JEST_RESULTS (per-test JSON)\n\n\`\`\`json\n${JSON.stringify(slimJest, null, 2)}\n\`\`\`\n`
  );
  if (codeContextBundle) {
    sections.push(`## CODE_AND_CONTRACT_CONTEXT\n\n${codeContextBundle}\n`);
  }
  return sections.join('\n');
}

function truncate(s, maxLen) {
  if (typeof s !== 'string') return '';
  if (s.length <= maxLen) return s;
  return `[TRUNCATED ${s.length - maxLen} chars]\n` + s.slice(0, maxLen);
}

module.exports = {
  parsePlanCaseAssignments,
  buildCoverageMatrix,
  buildReporterUserContent,
  PLAN_CASE_LINE_RE,
};
