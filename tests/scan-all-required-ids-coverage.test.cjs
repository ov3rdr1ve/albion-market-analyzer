/**
 * Test: "Scan Market Now" (getAllRequiredItemIds) must also fetch the id sources
 * that used to be priced only by per-table buttons / lazy fetches:
 *  - Faction Spending ids, the full flipping universe (incl. luxury TREASURE_*),
 *    FLIP_EXTRA_IDS, and the Craft Planner @1..@4 variant ids.
 * Black-box: load the real catalogs into a vm sandbox with DOM stubs, no network.
 *
 * Run: node tests/scan-all-required-ids-coverage.test.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const loaderSrc = read("js/catalog-loader.js");
const catalogFiles = [...loaderSrc.matchAll(/^\s*"(js\/[^"]+)",/gm)].map((m) => m[1]);
const html = readIndexHtml();
const tagFiles = [...html.matchAll(/<script src="(js\/[^"]+)"/g)]
  .map((m) => m[1])
  .filter((x) => !x.includes("vendor") &&
    !/i18n|boot-timing|catalog-loader|roads|team-sync|render-monitor|window-|app\.js|app-|scan-handlers|tooltips/.test(x));
const files = [...catalogFiles, ...tagFiles.filter((t) => !catalogFiles.includes(t))];
files.push("js/app-catalog-merge.js");
if (fs.existsSync(path.join(root, "js/scan-extra-ids.js")) && !files.includes("js/scan-extra-ids.js")) {
  files.push("js/scan-extra-ids.js");
}

function makeSandbox() {
  const doc = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
    body: { appendChild() {} }, documentElement: {},
  };
  const ctx = {
    tx: (a) => a, console: { log() {}, warn() {}, error() {} }, document: doc,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout, clearTimeout, Math, JSON, Set, Map, Date, Object, Array, String, Number,
    RegExp, Promise, Error, parseInt, parseFloat, isNaN, Intl, navigator: {},
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of files) {
    try { vm.runInContext(read(f), ctx, { filename: f }); } catch (e) { /* tolerate DOM-only files */ }
  }
  vm.runInContext("mergeCatalogsIntoTables()", ctx);
  return ctx;
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function missingFrom(set, ids) { return [...new Set(ids)].filter((x) => !set.has(x)); }

const ctx = makeSandbox();
const run = (s) => vm.runInContext(s, ctx);
const all = run("getAllRequiredItemIds()");
const allSet = new Set(all);

console.log("\n=== getAllRequiredItemIds covers the folded sources ===");

const sources = [
  ["faction spending ids", "getFactionSpendingItemIds()"],
  ["full flipping universe", "getFlippingItemIds()"],
  ["luxury TREASURE_* ids", "LUXURY_FLIP_ITEMS.map(i=>i.id)"],
  ["FLIP_EXTRA_IDS", "FLIP_EXTRA_IDS"],
  ...[1, 2, 3, 4].map((n) => [`planner variant ids @${n}`, `_cpCollectVariantIds({enchLevel:${n}})`]),
];
for (const [name, expr] of sources) {
  test(name + " are all included", () => {
    const ids = run(expr);
    ok(ids.length > 0, "source is empty, test is vacuous: " + expr);
    const miss = missingFrom(allSet, ids);
    ok(miss.length === 0, miss.length + " missing, e.g. " + miss.slice(0, 5).join(", "));
  });
}

test("luxury ids include TREASURE_*", () => {
  ok(allSet.has(run("LUXURY_FLIP_ITEMS.find(i=>/^TREASURE_/.test(i.id)).id")), "no TREASURE_* id present");
});

for (let n = 1; n <= 4; n++) {
  test(`T8_ARMOR_GATHERER_WOOD@${n} included`, () => ok(allSet.has("T8_ARMOR_GATHERER_WOOD@" + n), "missing"));
}

test("no duplicates", () => ok(all.length === allSet.size, (all.length - allSet.size) + " duplicates"));
test("folded sources add no synthetic __ ids", () => {
  // Pre-existing composite ids (e.g. T1_FISHCHOPS__T1_FISH_...) come from other
  // collectors; the folded sources must not add any beyond those.
  const c = makeSandbox();
  vm.runInContext("try { getScanExtraItemIds = undefined; } catch (e) {}", c);
  const before = new Set(vm.runInContext("getAllRequiredItemIds()", c));
  const bad = all.filter((x) => String(x).includes("__") && !before.has(x));
  ok(bad.length === 0, bad.slice(0, 5).join(", "));
});



console.log("\n=== regression: old ids still present ===");
const samples = [
  ["crafting", "CRAFTING_ITEMS[0].id"],
  ["transport", "getTransportItemIds()[0]"],
  ["gathering", "getGatheringItemIds()[0]"],
];
for (const [name, expr] of samples) {
  test(name + " sample still present", () => {
    const id = run(expr);
    ok(id && allSet.has(id), "missing " + id);
  });
}

console.log("\n=== missing optional globals do not throw ===");
for (const g of ["FLIP_EXTRA_IDS", "getFactionSpendingItemIds", "_cpCollectVariantIds", "getFlippingItemIds", "getScanExtraItemIds"]) {
  test("without " + g, () => {
    const c = makeSandbox();
    vm.runInContext(`try { ${g} = undefined; } catch (e) {}`, c);
    const r = vm.runInContext("getAllRequiredItemIds()", c);
    ok(Array.isArray(r) && r.length > 0, "did not return an array");
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
