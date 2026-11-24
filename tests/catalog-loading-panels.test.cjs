/**
 * Test: panels that paint on their own wait for the lazy catalogs, and show a
 * loading state until then.
 *
 * The catalogs (js/catalog-loader.js) are injected after first paint. A panel
 * that renders at DOMContentLoaded reads them before they exist, so it must:
 *   - show "Loading catalogs…" in its table, never "—"/no-data/can't-compute;
 *   - not paint from the catalogs until catalogsReady settles;
 *   - paint once it does (resolved OR rejected — a failed load still settles).
 * And the wait goes through the one shared helper (js/catalog-ready.js), not a
 * copy per panel.
 *
 * Black-box: each REAL panel file runs in a vm sandbox with a fake DOM and a
 * hand-driven catalogsReady promise. No live APIs.
 *
 * Run: node tests/catalog-loading-panels.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const HELPER_SRC = J("catalog-ready.js");
const LOADING = /Loading catalogs…/;
const NOT_READY_MARKERS = /Can't compute|No data|no data|isn't FP-fundable/;

/** A fake element: enough for innerHTML writes, children, and a tbody. */
function el(id, { cols = 0, tag = "div" } = {}) {
  const node = {
    id, tagName: tag.toUpperCase(), innerHTML: "", value: "", textContent: "",
    style: {}, dataset: {}, children: [], hidden: false, _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
  if (tag === "table") {
    const tbody = el(`${id}-tbody`, { tag: "tbody" });
    const headRow = el(`${id}-thead-tr`, { tag: "tr" });
    headRow.children = Array.from({ length: cols }, () => ({}));
    node.tbody = tbody;
    node.querySelector = (sel) => (sel === "tbody" ? tbody : sel === "thead tr" ? headRow : null);
  }
  return node;
}

/**
 * A fresh page with the given tables, the shared helper, and the panel file.
 * `catalogsReady` is a promise the test settles by hand; `withLoader: false`
 * leaves it undefined (no loader on the page).
 */
function page({ file, tables = {}, elements = {}, withLoader = true }) {
  const els = {};
  Object.entries(tables).forEach(([id, cols]) => { els[id] = el(id, { tag: "table", cols }); });
  Object.entries(elements).forEach(([id, tag]) => { els[id] = el(id, { tag }); });
  const dcl = [];
  const timers = [];
  let settle;
  const sandbox = {
    console: { log() {}, warn() {}, error: (...a) => { if (process.env.DEBUG_PANELS) console.error(...a); } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    setInterval: () => 0,
    tx: (en) => en, // js/i18n.js, English
    clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      readyState: "loading",
      getElementById: (id) => els[id] || null,
      querySelector: (sel) => {
        const m = /^#([\w-]+) tbody$/.exec(sel);
        return m && els[m[1]] ? els[m[1]].tbody : null;
      },
      querySelectorAll: () => [],
      createElement: (tag) => el("", { tag }),
      addEventListener: (type, fn) => { if (type === "DOMContentLoaded") dcl.push(fn); },
      body: el("body"),
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  if (withLoader) {
    vm.runInContext(
      "var catalogsReady = new Promise((res, rej) => { __settle = { res, rej }; });",
      sandbox,
    );
    settle = sandbox.__settle;
  }
  vm.runInContext(HELPER_SRC, sandbox);
  if (file !== "catalog-ready.js") vm.runInContext(J(file), sandbox);
  return {
    sandbox, els,
    tbody: (id) => els[id].tbody.innerHTML,
    domReady: () => { sandbox.document.readyState = "interactive"; dcl.splice(0).forEach((fn) => fn()); },
    resolve: async () => { settle.res(true); await flush(); },
    reject: async () => { settle.rej(new Error("catalog load failed")); await flush(); },
    tick: () => timers.splice(0).forEach((fn) => fn()),
    run: (src) => vm.runInContext(src, sandbox),
  };
}
const flush = () => new Promise((r) => setImmediate(r));
// A panel that only handles the success side leaves a rejection unhandled;
// count it as that test's failure instead of crashing the file.
let unhandled = null;
process.on("unhandledRejection", (e) => { unhandled = e; });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// Every self-painting table panel. `paintSpy` swaps the panel's catalog reads
// for a marker, so "did it paint" is observable without the real catalogs.
const PANELS = [
  {
    name: "City Bonuses",
    file: "render-city-bonuses.js",
    tables: { "city-bonuses-table": 8 },
    // The table's rows come from CITY_*_SPEC (js/data-city-bonuses.js).
    catalogs: "var CITY_CRAFT_SPEC = { Lymhurst: ['sword'] }; var CITY_REFINE_SPEC = {}; var CITY_BUTCHER_SPEC = {}; var CITY_FARM_SPEC = {};",
    painted: (p) => /Lymhurst/.test(p.tbody("city-bonuses-table")),
  },
  {
    name: "Black Zone Bonuses + Locations",
    file: "render-black-zone-bonuses.js",
    tables: { "black-zone-bonuses-table": 9, "black-zone-locations-table": 8 },
    // prettyCraftType is render-city-bonuses.js's (a sibling script, always there).
    catalogs: [J("data-black-zone.js"), J("data-city-bonuses.js"), "var prettyCraftType = (k) => k;"],
    painted: (p) => ["black-zone-bonuses-table", "black-zone-locations-table"].every(
      (id) => /<tr/.test(p.tbody(id)) && !LOADING.test(p.tbody(id))),
  },
  {
    name: "Brecilien Exit Fees",
    file: "render-brecilien-fees.js",
    tables: { "brecilien-fees-table": 6 },
    // Fees read ITEM_WEIGHTS / ITEM_FT_FACTORS (js/data-weights.js); before they
    // land the table priced every item from the fallback formula.
    catalogs: "var brecilienExitCostPerUnit = (id) => 4242;",
    painted: (p) => /4,242|4242/.test(p.tbody("brecilien-fees-table")),
  },
];

(async () => {
  console.log("\n=== self-painting panels before the catalogs ===");

  for (const panel of PANELS) {
    await test(`${panel.name}: first paint is the loading state, nothing from the catalogs`, async () => {
      const p = page(panel);
      p.domReady();
      await flush();
      for (const id of Object.keys(panel.tables)) {
        assert.match(p.tbody(id), LOADING, `${id} shows the loading state`);
        assert.ok(!NOT_READY_MARKERS.test(p.tbody(id)), `${id} must not say no-data / can't compute`);
      }
    });

    await test(`${panel.name}: paints once the catalogs resolve`, async () => {
      const p = page(panel);
      p.domReady();
      await flush();
      [].concat(panel.catalogs).forEach((src) => p.run(src));
      await p.resolve();
      assert.ok(panel.painted(p), "the real render replaced the loading state");
      for (const id of Object.keys(panel.tables)) assert.ok(!LOADING.test(p.tbody(id)), `${id} left loading`);
    });

    await test(`${panel.name}: still paints when the catalog load rejects`, async () => {
      const p = page(panel);
      p.domReady();
      await flush();
      [].concat(panel.catalogs).forEach((src) => p.run(src));
      unhandled = null;
      await p.reject();
      await flush();
      assert.strictEqual(unhandled, null, "the rejection is handled");
      assert.ok(panel.painted(p), "a failed load must not leave the panel stuck on loading");
    });

    await test(`${panel.name}: with no loader on the page, paints at DOMContentLoaded`, async () => {
      const p = page({ ...panel, withLoader: false });
      [].concat(panel.catalogs).forEach((src) => p.run(src));
      p.domReady();
      await flush();
      assert.ok(panel.painted(p));
    });
  }

  console.log("\n=== the ⚙ Specs panel opened before the node catalogue ===");

  /** The spec panel's two inner nodes, on a fake panel element. */
  function specPanel(p) {
    const body = el("spec-body"), sub = el("spec-sub");
    const panel = el("spec-panel");
    panel.querySelector = (sel) => (sel === ".spec-panel-body" ? body : sel === ".spec-panel-sub" ? sub : null);
    p.sandbox.__panel = panel;
    // focus-spec.js is a plain script loaded at parse time; the nodes are lazy.
    p.run(J("focus-spec.js"));
    return { panel, body };
  }

  await test("Specs panel: opened before the catalogue it says loading, not an empty scope", async () => {
    const p = page({ file: "spec-settings-panel.js" });
    const { body } = specPanel(p);
    p.run("_specPanelScope = 'crafting-table'; renderSpecPanelRows(__panel, 'crafting-table');");
    assert.match(body.innerHTML, LOADING);
    assert.ok(!/spec-node-row/.test(body.innerHTML));
  });

  await test("Specs panel: fills in once the catalogue lands while it is open", async () => {
    const p = page({ file: "spec-settings-panel.js" });
    const { body } = specPanel(p);
    p.run("_specPanelScope = 'crafting-table'; renderSpecPanelRows(__panel, 'crafting-table');");
    p.run(J("focus-spec-nodes.js"));
    await p.resolve();
    assert.match(body.innerHTML, /spec-node-row/, "node rows rendered");
    assert.ok(!LOADING.test(body.innerHTML));
  });

  await test("Specs panel: a closed panel is not re-rendered when the catalogue lands", async () => {
    const p = page({ file: "spec-settings-panel.js" });
    const { panel, body } = specPanel(p);
    p.run("_specPanelScope = 'crafting-table'; renderSpecPanelRows(__panel, 'crafting-table');");
    panel.hidden = true;
    p.run(J("focus-spec-nodes.js"));
    await p.resolve();
    assert.match(body.innerHTML, LOADING);
  });

  console.log("\n=== the shared helper ===");

  await test("whenCatalogsReady polls until the loader assigns its promise", async () => {
    const p = page({ file: "catalog-ready.js", withLoader: false });
    p.run("var catalogsReady = null;"); // loader ran, its microtask has not
    p.run("var hits = 0; whenCatalogsReady(() => { hits++; });");
    assert.strictEqual(p.sandbox.hits, 0);
    p.run("catalogsReady = Promise.resolve(true);");
    p.tick();
    await flush();
    assert.strictEqual(p.sandbox.hits, 1);
  });

  await test("whenCatalogsReady with no loader waits for present() before running", async () => {
    const p = page({ file: "catalog-ready.js", withLoader: false });
    p.run("var have = false, hits = 0; whenCatalogsReady(() => { hits++; }, { present: () => have });");
    assert.strictEqual(p.sandbox.hits, 0);
    p.run("have = true;");
    p.tick();
    assert.strictEqual(p.sandbox.hits, 1);
  });

  await test("whenCatalogsReady gives up after ~10s of polling and runs anyway", async () => {
    const p = page({ file: "catalog-ready.js", withLoader: false });
    p.run("var catalogsReady = null; var hits = 0; whenCatalogsReady(() => { hits++; });");
    for (let i = 0; i < 200 && p.sandbox.hits === 0; i++) p.tick();
    assert.strictEqual(p.sandbox.hits, 1);
  });

  await test("showCatalogLoading spans the table's header", async () => {
    const p = page({ file: "catalog-ready.js", tables: { t: 7 } });
    p.run("showCatalogLoading('t')");
    assert.match(p.tbody("t"), /colspan="7"/);
    assert.match(p.tbody("t"), LOADING);
  });

  // One helper, reused: no panel keeps a private copy of the wait loop.
  const USERS = [
    "render-fp-calculator.js", "render-city-bonuses.js", "render-black-zone-bonuses.js",
    "render-brecilien-fees.js", "render-roads.js", "render-buildings.js", "spec-settings-panel.js",
  ];
  for (const f of USERS) {
    await test(`${f} waits through whenCatalogsReady, not its own copy`, async () => {
      const src = J(f);
      assert.match(src, /whenCatalogsReady\(/, "uses the shared helper");
      assert.ok(!/catalogsReady\.then\(/.test(src), "no hand-rolled catalogsReady.then");
      assert.ok(!/function _\w*WhenCatalogsReady/.test(src), "no private copy of the helper");
    });
  }

  await test("index.html loads js/catalog-ready.js before every panel that uses it", async () => {
    const html = readIndexHtml();
    const at = (f) => html.indexOf(`src="js/${f}"`);
    assert.ok(at("catalog-ready.js") > 0, "catalog-ready.js is loaded");
    for (const f of USERS) assert.ok(at("catalog-ready.js") < at(f), `before ${f}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
