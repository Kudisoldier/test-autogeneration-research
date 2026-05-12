import { test, expect } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Intentional cross-run variance for pipeline flaky metrics (FTR / flaky files).
 *
 * Pipeline runs the same spec N times (default 3) with `--retries=0` and flags a file
 * flaky when (runs, passes, passCount, failCount) differs across those invocations.
 *
 * Usage:
 *   rm -f "${TMPDIR:-/tmp}/nir3-e2e-flaky-rate-probe.txt"
 *   FLAKY_RATE_PROBE=1 npx playwright test tests/e2e/flaky-rate-probe.spec.js --project=chromium --retries=0
 * (repeat 3× to mirror outer repeats), or:
 *   npm run test:e2e-flaky-probe
 *
 * Without FLAKY_RATE_PROBE=1 this test is skipped so normal `npm run test:e2e` stays green.
 */
test.describe.configure({ mode: 'serial' });

const COUNTER_PATH = path.join(os.tmpdir(), 'nir3-e2e-flaky-rate-probe.txt');

test('fails only on the 2nd outer Playwright run (pass / fail / pass)', () => {
  test.skip(!process.env.FLAKY_RATE_PROBE, 'Set FLAKY_RATE_PROBE=1 to enable this probe');

  let n = 0;
  try {
    const raw = fs.readFileSync(COUNTER_PATH, 'utf8').trim();
    n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) n = 0;
  } catch {
    n = 0;
  }

  fs.writeFileSync(COUNTER_PATH, String(n + 1), 'utf8');

  // After increment: 1st invocation saw n=0 → pass; 2nd saw n=1 → fail; 3rd saw n=2 → pass
  if (n % 3 === 1) {
    expect(1).toBe(2);
  }
});
