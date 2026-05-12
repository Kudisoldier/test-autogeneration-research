'use strict';

const fs = require('fs');
const path = require('path');

const rulesPath = path.join(__dirname, '..', 'verify-rules.json');
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

function findRule(id) {
  return rules.forbidden.find((r) => r.id === id);
}

describe('verify-rules e2e TypeScript guards', () => {
  const colonRule = findRule('no_ts_colon_types_e2e');
  const promiseGenRule = findRule('no_ts_promise_generic_e2e');

  it('flags colon type annotations on bindings', () => {
    const re = new RegExp(colonRule.pattern, 'm');
    expect(re.test('let resolveDelay: () => void;')).toBe(true);
    expect(re.test('const x: number = 1;')).toBe(true);
  });

  it('does not flag plain object literals', () => {
    const re = new RegExp(colonRule.pattern, 'm');
    expect(re.test('const options = { delay: 400 };')).toBe(false);
    expect(re.test("await route.fulfill({ status: 201 });")).toBe(false);
  });

  it('flags Promise generic constructor', () => {
    const re = new RegExp(promiseGenRule.pattern, 'm');
    expect(re.test('new Promise<void>((resolve) => {')).toBe(true);
    expect(re.test('new Promise<string>(() => {});')).toBe(true);
  });

  it('allows Promise without type argument', () => {
    const re = new RegExp(promiseGenRule.pattern, 'm');
    expect(re.test('new Promise((resolve) => { resolve(); });')).toBe(false);
  });
});
