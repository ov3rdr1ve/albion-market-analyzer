/**
 * Test: fetchWithRetry retries transient server errors, not just 429.
 *
 * Regression: AODP's prices endpoint intermittently returns 500 on heavy
 * batches (e.g. the Transmute scan's ~125 resource ids) while the identical
 * request succeeds moments later. The old fetchWithRetry returned on any
 * non-429 status, so a single transient 500 aborted the whole scan with
 * "API Error: 500". shouldRetryStatus now also covers 500/502/503/504.
 *
 * Black-box on the pure predicate: retryable statuses vs terminal ones.
 *
 * Run: node tests/api-retry-status.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const apiSrc = fs.readFileSync(path.join(__dirname, "..", "js", "api.js"), "utf8");
const mod = new Module("api-retry-status-test");
const sandbox = `
const fetch = () => Promise.resolve({ ok: false, status: 0 });
const document = { getElementById: () => null };
`;
mod._compile(sandbox + apiSrc, "api.js");
const { shouldRetryStatus } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("fetchWithRetry status policy\n");

test("shouldRetryStatus is exported", () =>
  assert.strictEqual(typeof shouldRetryStatus, "function"));

test("429 is retryable (rate limit)", () =>
  assert.strictEqual(shouldRetryStatus(429), true));

test("transient 5xx are retryable", () => {
  [500, 502, 503, 504].forEach((s) =>
    assert.strictEqual(shouldRetryStatus(s), true, `status ${s} should retry`));
});

test("success + client errors are terminal (no retry)", () => {
  [200, 204, 400, 401, 403, 404, 422].forEach((s) =>
    assert.strictEqual(shouldRetryStatus(s), false, `status ${s} should NOT retry`));
});

test("501 (not implemented) is not retried — permanent server refusal", () =>
  assert.strictEqual(shouldRetryStatus(501), false));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
