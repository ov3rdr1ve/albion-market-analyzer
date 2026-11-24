/**
 * Test: the Faction Point Calculator's first paint waits for the catalogs.
 *
 * Bug: every faction × tier read "Can't compute — this cape isn't FP-fundable"
 *      on first load. js/render-fp-calculator.js runs before
 *      js/catalog-loader.js (index.html script order), and catalogsReady is
 *      assigned in a microtask after that, so the init guard saw no promise,
 *      rendered at once with GEAR_CAPES / getFpCost still missing, and nothing
 *      re-rendered once they landed.
 *
 * Black-box: run the REAL js/render-fp-calculator.js in a vm sandbox with a
 * fake DOM and a hand-driven timer queue; load the real catalog scripts
 * (gear-capes.js, data-faction-fp-costs.js) into the same context LATER, the
 * way the loader injects them after first paint. No live APIs.
 *
 * Run: node tests/fp-calculator-init.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const CALC_SRC = J("render-fp-calculator.js");
// The catalog wait is the shared helper (js/catalog-ready.js), loaded before it.
const HELPER_SRC = J("catalog-ready.js");
const CATALOG_SRC = [J("gear-capes.js"), J("data-faction-fp-costs.js")];
const NOT_FUNDABLE = /isn't FP-fundable/;
const LOADING = /Loading catalogs/;

/** A fresh page: the calculator's controls + result box, before any catalog. */
function page({ budget = "200000", city = "THETFORD", tier = "8" } = {}) {
  const els = {
    "fp-calc-budget": { value: budget, addEventListener() {} },
    "fp-calc-city": { value: city, addEventListener() {} },
    "fp-calc-tier": { value: tier, addEventListener() {} },
    "fp-calc-result": { innerHTML: "" },
  };
  const timers = [];
  const sandbox = {
    document: {
      readyState: "interactive", // deferred scripts run while the page is interactive
      getElementById: (id) => els[id] || null,
      addEventListener() {},
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(HELPER_SRC, sandbox);
  vm.runInContext(CALC_SRC, sandbox);
  return {
    sandbox,
    out: els["fp-calc-result"],
    tick: () => timers.splice(0).forEach((fn) => fn()),
    loadCatalogs: () => CATALOG_SRC.forEach((src) => vm.runInContext(src, sandbox)),
    pendingTimers: () => timers.length,
  };
}
const flush = () => new Promise((r) => setImmediate(r));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function assertThetfordT8(html) {
  assert.ok(!NOT_FUNDABLE.test(html), "must not show the not-fundable error");
  assert.match(html, /<b class="profit-high">4<\/b> complete capes/, "4 capes");
  assert.match(html, /Crests to buy<\/td><td><b>4<\/b>/, "4 crests");
  assert.match(html, /to buy<\/td><td><b>40<\/b>/, "40 hearts");
  assert.match(html, /FP left over<\/td><td><\/td><td>20,000 FP/, "20,000 FP left");
}

(async () => {
  console.log("\n=== first paint before the catalogs ===");

  await test("first paint shows a loading state, never the not-fundable error", async () => {
    const p = page();
    assert.match(p.out.innerHTML, LOADING);
    assert.ok(!NOT_FUNDABLE.test(p.out.innerHTML));
  });

  await test("the loader's promise appears later → the calculator re-renders when it resolves", async () => {
    const p = page();
    // catalog-loader.js runs after us and assigns catalogsReady in a microtask.
    let resolve;
    p.sandbox.catalogsReady = new Promise((r) => { resolve = r; });
    p.tick();
    await flush();
    assert.match(p.out.innerHTML, LOADING, "still loading while the promise is pending");
    p.loadCatalogs();
    resolve(true);
    await flush();
    assertThetfordT8(p.out.innerHTML);
  });

  await test("catalogsReady still null (loader ran, microtask pending) → no crash, keeps waiting", async () => {
    const p = page();
    p.sandbox.catalogsReady = null;
    p.tick();
    await flush();
    assert.match(p.out.innerHTML, LOADING);
    assert.ok(p.pendingTimers() > 0, "must keep waiting for the promise");
    p.sandbox.catalogsReady = Promise.resolve(true);
    p.loadCatalogs();
    p.tick();
    await flush();
    assertThetfordT8(p.out.innerHTML);
  });

  await test("no loader at all but the catalogs are present → renders the plan", async () => {
    const p = page();
    p.loadCatalogs();
    p.tick();
    await flush();
    assertThetfordT8(p.out.innerHTML);
  });

  await test("the loader resolves but the cape catalog failed → a load error, not 'isn't FP-fundable'", async () => {
    const p = page();
    p.sandbox.catalogsReady = Promise.resolve(false);
    p.tick();
    await flush();
    assert.ok(!NOT_FUNDABLE.test(p.out.innerHTML), p.out.innerHTML);
    assert.ok(!LOADING.test(p.out.innerHTML), "must not spin forever");
  });

  console.log("\n=== after the catalogs: every royal city × tier computes ===");

  const cities = ["THETFORD", "LYMHURST", "FORTSTERLING", "BRIDGEWATCH", "MARTLOCK"];
  for (const city of cities) {
    for (const tier of ["4", "5", "6", "7", "8"]) {
      await test(`${city} T${tier}: no not-fundable message once loaded`, async () => {
        const p = page({ city, tier });
        p.sandbox.catalogsReady = Promise.resolve(true);
        p.loadCatalogs();
        p.tick();
        await flush();
        assert.ok(!NOT_FUNDABLE.test(p.out.innerHTML), p.out.innerHTML);
        assert.match(p.out.innerHTML, /complete cape/);
      });
    }
  }

  await test("a genuinely unfundable cape (unknown city) still says so", async () => {
    const p = page({ city: "CAERLEON" });
    p.sandbox.catalogsReady = Promise.resolve(true);
    p.loadCatalogs();
    p.tick();
    await flush();
    assert.match(p.out.innerHTML, NOT_FUNDABLE);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
