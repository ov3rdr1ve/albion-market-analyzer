/**
 * Tests for solving the AODP proof-of-work OFF the main thread.
 *
 * The ingest challenge is real work — measured against the live endpoint it is
 * a 41-bit target costing 0.2–2 s of sha256 per upload. Run inline, that is 0.2
 * to 2 seconds during which the Electron main process answers nothing: no
 * window input, no IPC, no capture callbacks. The app froze every time a market
 * window was captured.
 *
 * So the solver moves to a worker thread. What matters, black-box:
 *   - the answer is still a valid solution to the challenge,
 *   - the main thread keeps running while it is being found,
 *   - a hopeless challenge comes back null instead of spinning forever,
 *   - solvers can be asked for several at once, and closed.
 *
 * No network: challenges are made up locally. The worker only ever touches
 * node builtins.
 *
 * Run: node tests/aodp-pow-async.test.cjs
 */

const assert = require("assert");
const { isPowSolution } = require("../js/aodp-pow.js");
const { createPowSolver } = require("../js/aodp-pow-async.js");

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// A target no hex text can ever match: the ASCII of every hex character begins
// 0011 (digits) or 0110 (a-f), so a run of ones is unreachable. Gives a solve
// of a known, bounded length — exactly `maxAttempts` hashes — without waiting
// on luck.
const IMPOSSIBLE = "1".repeat(16);

test("a solution comes back that satisfies the challenge", async () => {
  const solver = createPowSolver();
  try {
    const pow = { key: "test-key", wanted: "0011" };
    const solution = await solver.solve(pow);
    assert.strictEqual(typeof solution, "string");
    assert.ok(isPowSolution(pow, solution), "the worker's answer verifies on this side");
  } finally { solver.close(); }
});

test("an empty target is satisfied by any candidate", async () => {
  const solver = createPowSolver();
  try {
    const solution = await solver.solve({ key: "k", wanted: "" });
    assert.strictEqual(typeof solution, "string");
    assert.ok(solution.length > 0);
  } finally { solver.close(); }
});

// The point of the change.
test("the main thread keeps running while the challenge is being solved", async () => {
  const solver = createPowSolver();
  try {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    await solver.solve({ key: "k", wanted: IMPOSSIBLE }, { maxAttempts: 300000 });
    clearInterval(timer);
    assert.ok(ticks >= 3, `the event loop ran during the solve (${ticks} ticks)`);
  } finally { solver.close(); }
});

test("a hopeless challenge gives up and returns null", async () => {
  const solver = createPowSolver();
  try {
    const solution = await solver.solve({ key: "k", wanted: IMPOSSIBLE }, { maxAttempts: 2000 });
    assert.strictEqual(solution, null);
  } finally { solver.close(); }
});

test("a malformed challenge is null, not a crash", async () => {
  const solver = createPowSolver();
  try {
    assert.strictEqual(await solver.solve(null), null);
    assert.strictEqual(await solver.solve({ wanted: "0011" }), null);
  } finally { solver.close(); }
});

test("several challenges can be in flight at once", async () => {
  const solver = createPowSolver();
  try {
    const pows = [{ key: "a", wanted: "0011" }, { key: "b", wanted: "0011" }, { key: "c", wanted: "" }];
    const solutions = await Promise.all(pows.map((p) => solver.solve(p)));
    solutions.forEach((s, i) => assert.ok(isPowSolution(pows[i], s), `challenge ${i} verified`));
  } finally { solver.close(); }
});

// The retired thread's `exit` event arrives after the next one has started, so
// a handler that does not check which thread it belongs to cancels live work.
test("solving still works after the worker has been closed and asked again", async () => {
  const solver = createPowSolver();
  try {
    await solver.solve({ key: "a", wanted: "" });
    solver.close();
    const pow = { key: "b", wanted: "0011" };
    const solution = await solver.solve(pow);
    // Checked by type as well as by the challenge: every hex character's ASCII
    // begins 0011, so a short target is satisfied even by a null candidate and
    // isPowSolution alone would pass on a solver that answered nothing.
    assert.strictEqual(typeof solution, "string");
    assert.ok(isPowSolution(pow, solution));
  } finally { solver.close(); }
});

test("closing the solver leaves no thread behind", async () => {
  const solver = createPowSolver();
  await solver.solve({ key: "a", wanted: "" });
  solver.close();
  await new Promise((r) => setTimeout(r, 300));
  const handles = typeof process._getActiveHandles === "function" ? process._getActiveHandles() : [];
  const ports = handles.filter((h) => h && h.constructor && h.constructor.name === "MessagePort");
  assert.strictEqual(ports.length, 0, "no worker port still open");
});

// The uploader used to call the solver and use what came back directly, which
// silently uploaded a Promise as the solution once the solver went async.
test("the uploader awaits a solver that returns a promise", async () => {
  const { createAodpUploader } = require("../js/aodp-uploader.js");
  const posted = [];
  const uploader = createAodpUploader({
    fetch: async (url, options) => {
      if (url.endsWith("/pow")) return { ok: true, status: 200, json: async () => ({ key: "k", wanted: "" }) };
      posted.push(options.body);
      return { ok: true, status: 200 };
    },
    solve: async () => "deferred-solution",
    getServerIp: () => "5.188.125.49",
    newIdentifier: () => "id",
  });
  const result = await uploader.upload({ x: 1 }, "marketorders.ingest");
  assert.strictEqual(result.ok, true);
  assert.match(posted[0], /solution=deferred-solution/);
});

test("a solver that yields nothing fails the upload rather than posting junk", async () => {
  const { createAodpUploader } = require("../js/aodp-uploader.js");
  const uploader = createAodpUploader({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ key: "k", wanted: "1111" }) }),
    solve: async () => null,
    getServerIp: () => "5.188.125.49",
  });
  assert.deepStrictEqual(await uploader.upload({ x: 1 }, "t"), { ok: false, reason: "unsolved" });
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  PASS: ${name}`); passed++; }
    catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  // exitCode, not exit(): a pending worker makes stdout a pipe that exit()
  // would truncate, and a green run that prints nothing is not a green run.
  process.exitCode = failed ? 1 : 0;
})();
