/**
 * Test: the catalog scripts load after first paint (js/catalog-loader.js).
 *
 * index.html used to carry 63 catalog scripts (js/data*.js, js/gear-*.js, the
 * item-name / resource-name / recipe / focus / item-value / black-market
 * tables) as deferred tags. Deferred still blocks dom-ready — and boot gated
 * every table on DOMContentLoaded — so ~2.7MB of catalogs held first paint for
 * seconds on every start. They are gone from the markup; js/catalog-loader.js
 * injects them after paint, in list order, a small batch at a time, and hands
 * out the promise boot waits on.
 *
 * The list is 67 entries now: the 63 catalogs, plus the four former markup
 * tags that READ the catalogs at eval time and so must ride the loader to keep
 * their position — js/gather-fame-rates.js (reads GATHER_UNITS_PER_HOUR right
 * after js/data-gathering.js declares it), and js/gear.js /
 * js/refining-chain-recipes.js / js/render-rerolling.js (spread / forEach
 * catalog consts at top level), which sit after every catalog. Moving them
 * into the list without the order would be worse than leaving them out: the
 * whole point is that a top-level reference to a not-yet-declared catalog
 * const kills the script — and with it, app.js's merge pass.
 *
 * Contract:
 *   CATALOG_SCRIPTS  — the 67 paths, catalogs first in their historical order,
 *                      the four consumers in the positions above.
 *   loadCatalogs(o)  — starts (or joins) the one load; first call may pass
 *                      { batch, onProgress(done, total), yieldFn }.
 *   catalogsReady    — the load's promise (assigned once the load starts).
 *   catalogsState()  — { total, loaded, failed, done, readyMs }.
 *
 * Black-box: the module is required against a fake document (createElement /
 * appendChild capture, manual onload/onerror) and fake timers, never the real
 * DOM, no jsdom, no Electron. The renderer simulation runs every listed file
 * through node vm — one shared context, one script per file, no
 * require/module/exports — which is the closest faithful model of the
 * renderer's classic scripts (see the core case below for what was verified).
 *
 * Run: node tests/catalog-loader.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const LOADER = path.join(ROOT, "js", "catalog-loader.js");

// The four former deferred tags whose eval reads catalog consts. They must be
// IN the load sequence and at the right depth, or the renderer throws the
// ReferenceErrors this suite exists to prevent.
const CONSUMER_SCRIPTS = [
  "js/gather-fame-rates.js",
  "js/gear.js",
  "js/refining-chain-recipes.js",
  "js/render-rerolling.js",
];

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
  finally { restoreEnv(); }
}

// The fake document/timers of the most recent makeEnv() are uninstalled after
// every case, failed or not — a leaked fake would hijack the next group's
// eval-start microtask.
let _activeEnv = null;
function restoreEnv() {
  if (_activeEnv) {
    _activeEnv.restore();
    _activeEnv = null;
  }
}

// ── fake DOM + fake timers ──────────────────────────────────────────────────
// Each group gets a fresh module evaluation: delete the require cache, install
// the fakes, require. The module starts its load at evaluation, so the fakes
// must be in place first.

function makeEnv() {
  const env = makeEnvRaw();
  _activeEnv = env;
  return env;
}

function makeEnvRaw() {
  const appended = [];
  const doc = {
    readyState: "loading",
    head: {},
    createElement(tag) {
      return { tagName: tag, src: "", defer: null, async: true, onload: null, onerror: null, _atAppend: null };
    },
  };
  doc.head.appendChild = (el) => {
    // Snapshot the handler state at the append: the loader must have both
    // handlers wired BEFORE the element can possibly load.
    el._atAppend = { onload: typeof el.onload, onerror: typeof el.onerror, async: el.async, defer: el.defer };
    appended.push(el);
  };

  const env = {
    doc, appended,
    timeouts: [],
    real: {
      setTimeout: global.setTimeout,
      setImmediate: global.setImmediate,
      scheduler: global.scheduler,
    },
    fireTimeouts() {
      const pending = env.timeouts.splice(0);
      pending.forEach((fn) => fn());
    },
    flush() {
      // Real setImmediate: runs after every queued microtask, so promise chains
      // (batch settles, the eval-start microtask) have all run.
      return new Promise((resolve) => env.real.setImmediate(resolve));
    },
    // Installs the fakes and requires the module fresh. The fakes STAY
    // installed for the whole test case — the module reads `document` and
    // `setTimeout` at injection/yield time, not at require time — so every
    // test calls env.restore() when it is done.
    load() {
      delete require.cache[require.resolve(LOADER)];
      global.document = env.doc;
      global.setTimeout = (fn) => { env.timeouts.push(fn); return env.timeouts.length; };
      global.scheduler = undefined;
      return require(LOADER);
    },
    restore() {
      delete global.document;
      global.setTimeout = env.real.setTimeout;
      if (env.real.scheduler === undefined) delete global.scheduler;
      else global.scheduler = env.real.scheduler;
    },
  };
  return env;
}

// Fire load/error for everything appended but unsettled, run the loader's
// yields, and repeat until all of CATALOG_SCRIPTS has been injected and every
// injected element has settled. Returns the number of pump rounds.
async function pump(env, loader, { failSrcs = [] } = {}) {
  const settled = new Set();
  let rounds = 0;
  while (rounds++ < 200) {
    env.appended.forEach((el) => {
      if (settled.has(el)) return;
      settled.add(el);
      const fire = failSrcs.includes(el.src) ? el.onerror : el.onload;
      if (typeof fire === "function") fire();
    });
    env.fireTimeouts();
    await env.flush();
    if (
      env.appended.length === loader.CATALOG_SCRIPTS.length &&
      settled.size === env.appended.length &&
      env.timeouts.length === 0
    ) return rounds;
  }
  return rounds;
}

// A require with NO document at all — the Node-harness shape, where the module
// must resolve catalogsReady instead of starting an injection it cannot do.
// Deferred through getLoader() so a missing module fails every case loudly
// instead of crashing the file before it can report.
function rawLoad() {
  delete require.cache[require.resolve(LOADER)];
  const hadDoc = typeof global.document !== "undefined";
  if (hadDoc) delete global.document;
  try {
    return require(LOADER);
  } finally {
    // nothing to restore — Node never has a global document
  }
}

let _mod = null, _modErr = null;
function getLoader() {
  if (_mod) return _mod;
  if (!_modErr) {
    try { _mod = rawLoad(); } catch (e) { _modErr = e; }
  }
  if (_modErr) throw new Error(`js/catalog-loader.js unavailable: ${_modErr.message}`);
  return _mod;
}

async function main() {
  // ── the list ──────────────────────────────────────────────────────────────

  console.log("\n=== CATALOG_SCRIPTS ===");

  await test("module exists and exports the four names", () => {
    const bare = getLoader();
    assert.strictEqual(typeof bare.loadCatalogs, "function");
    assert.strictEqual(typeof bare.catalogsState, "function");
    assert.ok(bare.catalogsReady && typeof bare.catalogsReady.then === "function", "catalogsReady is a promise");
    assert.ok(Array.isArray(bare.CATALOG_SCRIPTS));
  });

  await test("CATALOG_SCRIPTS has exactly 67 entries", () => {
    assert.strictEqual(getLoader().CATALOG_SCRIPTS.length, 67);
  });

  await test("CATALOG_SCRIPTS entries are unique", () => {
    const scripts = getLoader().CATALOG_SCRIPTS;
    assert.strictEqual(new Set(scripts).size, 67, "no duplicates");
  });

  await test("every entry is a catalog-prefixed js/ path", () => {
    // The four consumers extend the families: gather-fame-rates is a data
    // table in all but prefix; gear / refining-chain-recipes / render-rerolling
    // are the eval-time catalog readers this change folded into the loader.
    const re = /^js\/(data|gear-|gear\.js$|item-names|resource-names|recipes|gather-fame-rates|refining-chain-recipes|render-rerolling|focus-spec-(items|nodes)|focus-costs|item-values|black-market-items)/;
    const bad = getLoader().CATALOG_SCRIPTS.filter((s) => !re.test(s));
    assert.deepStrictEqual(bad, [], `off-list entries: ${bad.join(", ")}`);
  });

  await test("every listed file exists in the repo", () => {
    const missing = getLoader().CATALOG_SCRIPTS.filter((s) => !fs.existsSync(path.join(ROOT, s)));
    assert.deepStrictEqual(missing, [], `missing: ${missing.join(", ")}`);
  });

  await test("the load order keeps every consumer behind what it reads", () => {
    const scripts = getLoader().CATALOG_SCRIPTS;
    assert.strictEqual(scripts.length, 67, "the full list rides the loader");
    assert.strictEqual(new Set(scripts).size, 67, "and it is duplicate-free");
    const at = (s) => scripts.indexOf(s);
    assert.ok(at("js/data-gathering.js") >= 0, "data-gathering is in the list");
    // gather-fame-rates reads GATHER_UNITS_PER_HOUR at eval: it must run
    // immediately after the file that declares it, and before data-journals
    // (whose _fameRates() may resolve the same globals lexically).
    assert.ok(
      at("js/data-gathering.js") < at("js/gather-fame-rates.js"),
      "gather-fame-rates comes after data-gathering",
    );
    assert.ok(
      at("js/gather-fame-rates.js") < at("js/data-journals.js"),
      "gather-fame-rates comes before data-journals",
    );
    // The three top-level readers sit after EVERY catalog — the last three
    // entries, in this order, so a gear spread or a RESOURCE_DEFS.forEach can
    // never meet an undeclared const.
    assert.deepStrictEqual(
      scripts.slice(-3),
      ["js/gear.js", "js/refining-chain-recipes.js", "js/render-rerolling.js"],
      "gear, refining-chain-recipes, render-rerolling are the last three, in order",
    );
  });

  await test("index.html carries none of the four moved tags; the loader stays before app.js", () => {
    const html = readIndexHtml();
    for (const src of CONSUMER_SCRIPTS) {
      assert.ok(!html.includes(`<script src="${src}"`), `${src} must not be a markup tag any more`);
    }
    assert.ok(
      html.indexOf("js/catalog-loader.js") < html.indexOf("js/app.js"),
      "the loader tag stays before app.js",
    );
  });

  // ── the renderer simulation ───────────────────────────────────────────────
  //
  // The core case — the one that would have caught the lazy-catalog crash.
  // Each listed file is evaluated as its own script, IN LOAD ORDER, in ONE vm
  // context whose sandbox has no require / module / exports — the renderer's
  // shape. Sequential vm.runInContext calls against one context share the
  // global lexical scope exactly like the browser's classic scripts; this was
  // verified while writing the suite:
  //   - a `const` declared by one call reads back from the next call,
  //   - re-declaring it in a later call throws SyntaxError (as a second
  //     classic script would),
  //   - typeof on a name no script has declared is "undefined",
  //   - a top-level function declaration is visible across calls and lands on
  //     the context global.
  // So a top-level reference to a not-yet-declared catalog const — the exact
  // failure `npx electron .` reported (GEAR_CLOTH_ARMOR, RESOURCE_DEFS,
  // QUALITY_TRANSITIONS) — or a stray `require` (gather-fame-rates' ternary
  // took that branch once data-gathering went lazy) throws here, in file
  // order, with the offending filename.

  console.log("\n=== Renderer simulation ===");

  await test("every file in load order evals with zero exceptions in a renderer-like sandbox", () => {
    const scripts = getLoader().CATALOG_SCRIPTS;
    for (const need of CONSUMER_SCRIPTS) {
      assert.ok(scripts.includes(need), `${need} must be injected by the loader, not left to the markup`);
    }
    const sandbox = { console };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const errors = [];
    for (const src of scripts) {
      const code = fs.readFileSync(path.join(ROOT, src), "utf8");
      try {
        vm.runInContext(code + "\n", sandbox, { filename: src });
      } catch (e) {
        errors.push(`${src}: ${e.name}: ${e.message}`);
      }
    }
    assert.deepStrictEqual(errors, [], "every file in the sequence evals clean");
  });

  await test("the simulation has teeth: a consumer ahead of its catalog throws", () => {
    // Control for the case above — the same sandbox, but gear.js first. It
    // must throw the exact ReferenceError the live app showed, proving the
    // harness would catch a wrong order rather than passing vacuously.
    const scripts = getLoader().CATALOG_SCRIPTS.filter((s) => s !== "js/gear.js");
    const sandbox = { console };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const order = ["js/gear.js", ...scripts];
    let caught = null;
    for (const src of order) {
      try {
        vm.runInContext(fs.readFileSync(path.join(ROOT, src), "utf8") + "\n", sandbox, { filename: src });
      } catch (e) {
        caught = { src, name: e.name, message: e.message };
        break;
      }
    }
    assert.ok(caught, "gear.js ahead of the gear-* catalogs must throw");
    assert.strictEqual(caught.src, "js/gear.js");
    assert.strictEqual(caught.name, "ReferenceError");
    assert.ok(/GEAR_CLOTH_ARMOR/.test(caught.message), `and names the missing const: ${caught.message}`);
  });

  // ── the injection: order, batching, handlers ─────────────────────────────

  console.log("\n=== Injection ===");

  await test("injects all 67 in list order, at most `batch` in flight (default 6)", async () => {
    const env = makeEnv();
    const loader = env.load();
    await env.flush(); // let the eval-start microtask begin the load
    assert.strictEqual(env.appended.length, 6, "first batch of 6 appended");

    const settledCount = () => env.appended.filter((el) => el._settled).length;
    let maxInFlight = 0;
    const settled = new Set();
    while (env.appended.length < loader.CATALOG_SCRIPTS.length || settled.size < env.appended.length) {
      env.appended.forEach((el) => {
        if (settled.has(el)) return;
        settled.add(el);
        el._settled = true;
        el.onload();
      });
      maxInFlight = Math.max(maxInFlight, env.appended.length - settled.size);
      env.fireTimeouts();
      await env.flush();
      assert.ok(
        env.appended.length - settledCount() <= 6,
        "never more than 6 unsettled scripts in the document",
      );
      if (maxInFlight > 100) throw new Error("runaway loop");
    }

    assert.deepStrictEqual(
      env.appended.map((el) => el.src),
      loader.CATALOG_SCRIPTS,
      "injected in exactly the listed order",
    );
    assert.ok(maxInFlight <= 6, `batches stay within 6 (max in flight was ${maxInFlight})`);
  });

  await test("onload AND onerror are wired before appendChild, async=false", async () => {
    const env = makeEnv();
    const loader = env.load();
    await pump(env, loader);
    const bad = env.appended.filter(
      (el) => el._atAppend.onload !== "function" || el._atAppend.onerror !== "function",
    );
    assert.deepStrictEqual(bad, [], "every element had both handlers at append time");
    const scrambled = env.appended.filter((el) => el._atAppend.async !== false);
    assert.deepStrictEqual(scrambled, [], "async=false so the list order is the run order");
  });

  // ── completion, failures, progress ────────────────────────────────────────

  console.log("\n=== Completion ===");

  await test("resolves only after ALL settle; a failed file does not reject; catalogsState reports it", async () => {
    const env = makeEnv();
    const loader = env.load();
    const p = loader.loadCatalogs({ yieldFn: () => Promise.resolve() });
    const fails = [loader.CATALOG_SCRIPTS[3], loader.CATALOG_SCRIPTS[40]];

    const errors = [];
    const realError = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    try {
      await pump(env, loader, { failSrcs: fails });
      await p; // must not reject
    } finally {
      console.error = realError;
    }

    const st = loader.catalogsState();
    assert.strictEqual(st.total, 67);
    assert.strictEqual(st.done, true);
    assert.strictEqual(st.loaded, 65);
    assert.deepStrictEqual(st.failed.sort(), fails.sort(), "the failed paths are listed");
    assert.ok(errors.some((l) => l.includes(fails[0])), "the failure is logged");
  });

  await test("progress fires once per settled batch with (done, total)", async () => {
    const env = makeEnv();
    const loader = env.load();
    const progress = [];
    loader.loadCatalogs({
      batch: 2,
      onProgress: (done, total) => progress.push([done, total]),
      yieldFn: () => Promise.resolve(),
    });
    await pump(env, loader);

    assert.strictEqual(progress.length, 34, "one call per batch (ceil(67/2))");
    progress.forEach(([done, total]) => {
      assert.strictEqual(total, 67);
      assert.ok(done > 0 && done <= 67, `done in range: ${done}`);
    });
    for (let i = 1; i < progress.length; i++) {
      assert.ok(progress[i][0] > progress[i - 1][0], "done climbs batch over batch");
    }
    assert.deepStrictEqual(progress[progress.length - 1], [67, 67], "the last call is the full count");
  });

  await test("a yield that throws cannot stall the load", async () => {
    const env = makeEnv();
    const loader = env.load();
    let throws = 0;
    const p = loader.loadCatalogs({
      yieldFn: () => { throws++; throw new Error("yield boom"); },
    });
    await pump(env, loader);
    await p;
    assert.strictEqual(env.appended.length, loader.CATALOG_SCRIPTS.length, "every script still injected");
    assert.strictEqual(loader.catalogsState().done, true);
    assert.ok(throws > 0, "the yield was actually used");
  });

  // ── the singleton ─────────────────────────────────────────────────────────

  console.log("\n=== Singleton ===");

  await test("loadCatalogs() twice returns the same promise and injects nothing twice", async () => {
    const env = makeEnv();
    const loader = env.load();
    await env.flush();
    const p1 = loader.loadCatalogs();
    const before = env.appended.length;
    const p2 = loader.loadCatalogs();
    const p3 = loader.loadCatalogs({ batch: 1 });
    assert.strictEqual(p1, p2, "same promise");
    assert.strictEqual(p1, p3, "even with fresh options");
    assert.strictEqual(env.appended.length, before, "no duplicate injection");
    assert.strictEqual(loader.catalogsReady, p1, "catalogsReady is that promise");
    await pump(env, loader);
    assert.strictEqual(env.appended.length, loader.CATALOG_SCRIPTS.length);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main();
