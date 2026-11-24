/**
 * Test: farming focus cost is PER CROP, and a pasture row spends none.
 *
 * The Destiny Board gives every crop and herb its own Cultivator/Farmer node
 * ("Potato Farmer" +200 Focus Cost Efficiency per level, "Pumpkin Farmer" the
 * same) on top of ONE shared mastery (Crop Farmer / Herbalist, +100 per level).
 * So levelling potatoes must leave the pumpkin row's focus cost untouched:
 *
 *   focus/cycle = 1000 x 0.5 ^ (FCE / 10000),  FCE = sum(bonus x 100 x level)
 *
 * Defaults are mastery 100, specialization 0 (js/focus-spec.js defaultSpecLevel),
 * which is 10,000 FCE = 500 focus per cycle; both maxed is 30,000 = 125.
 *
 * A pasture (byproduct) row is the other half of this: its `id` is the FEED
 * crop, which the cycle BUYS rather than grows, so it has no watering step and
 * js/render-farming.js charges it no focus at all. Those feed ids are crop ids
 * (T6_POTATO), not seed ids, so they carry no specialization either.
 *
 * Black box over the shipped modules — no DOM, no market data, no live calls.
 *
 * Run: node tests/farming-focus-spec-per-crop.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// Newlines normalised: the working tree is checked out CRLF on Windows while
// the source patterns below are written with plain LF — the same reason
// tests/table-width-stability.test.cjs normalises.
const read = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8").split("\r\n").join("\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// The browser loads these as plain globals; stitch the same sources into one
// scope over a stubbed localStorage so each run starts from a clean store.
function loadFarmingFocus(store = {}) {
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
  return new Function(
    "localStorage",
    `${read("js/focus-spec-nodes.js")}
     ${read("js/focus-spec-items.js")}
     ${read("js/focus-spec.js")}
     ${read("js/data-farming.js")}
     return { FARMING_PRODUCTION, FARMING_FOCUS_BASE, FARMING_FOCUS_PER_SEED,
              getFarmingFocusCost, specNodesForItem, getItemFCE,
              setSpecLevel, withSpecScope, FOCUS_SPEC_ITEM_FAMILY };`
  )(localStorage);
}

const SCOPE = "farming-table";
// focus/cycle at a given (mastery, specialization) pair — the formula above.
const expected = (mastery, spec) =>
  Math.round(1000 * Math.pow(0.5, (mastery * 100 + spec * 200) / 10000));

console.log("Farming Focus Spec (per crop) Tests\n");

// ── One shared mastery + one node of its own, per crop and per herb ─────────

console.log("\n=== every crop/herb seed carries its own specialization ===");

const api = loadFarmingFocus();
const PLOTS = api.FARMING_PRODUCTION.filter((r) => r.type !== "byproduct");
const MASTERY = { crop: "FARM_CROPS", herb: "FARM_HERBS" };

PLOTS.forEach((item) => {
  test(`${item.id}: [${MASTERY[item.type]} x1, own node x2]`, () => {
    const nodes = api.specNodesForItem(item.id);
    assert.strictEqual(nodes.length, 2, `expected 2 nodes, got ${JSON.stringify(nodes)}`);
    assert.deepStrictEqual(nodes[0], [MASTERY[item.type], 1]);
    assert.strictEqual(nodes[1][1], 2, "the crop-specific node is +200 FCE per level");
    assert.ok(
      nodes[1][0].startsWith(`${MASTERY[item.type]}_`),
      `${nodes[1][0]} is not a ${MASTERY[item.type]} specialization`,
    );
  });
});

test("no two plots share a specialization node", () => {
  const own = PLOTS.map((item) => api.specNodesForItem(item.id)[1][0]);
  assert.strictEqual(new Set(own).size, own.length, `duplicated node in ${own.join(", ")}`);
});

// ── The number the table prints ────────────────────────────────────────────

console.log("\n=== focus per cycle = 1000 x 0.5^(FCE/10000) ===");

[
  ["T6_FARM_POTATO_SEED", 0, 500, "defaults: mastery 100, specialization 0"],
  ["T6_FARM_POTATO_SEED", 9, 441, "the in-game screenshot: Potato Farmer 9 = +1800 FCE"],
  ["T6_FARM_POTATO_SEED", 100, 125, "both maxed (30,000 FCE) — the game's floor"],
  ["T8_FARM_PUMPKIN_SEED", 100, 125, "same floor on the T8 crop"],
  ["T3_FARM_COMFREY_SEED", 100, 125, "herbs run the same 1 + 2 pair"],
].forEach(([seedId, specLevel, focus, why]) => {
  test(`${seedId} @ spec ${specLevel} = ${focus} focus/cycle (${why})`, () => {
    const a = loadFarmingFocus();
    const ownNode = a.specNodesForItem(seedId)[1][0];
    a.setSpecLevel(SCOPE, ownNode, specLevel);
    assert.strictEqual(a.withSpecScope(SCOPE, () => a.getFarmingFocusCost(seedId)), focus);
    assert.strictEqual(expected(100, specLevel), focus, "formula and fixture disagree");
  });
});

test("the max-spec fallback constant still reads 125", () => {
  assert.strictEqual(api.FARMING_FOCUS_BASE, 1000);
  assert.strictEqual(api.FARMING_FOCUS_PER_SEED, 125);
});

// ── The point of the exercise: crops do not share a specialization ──────────

console.log("\n=== levelling one crop never re-prices another ===");

test("Potato Farmer 100 leaves Pumpkin at its default cost", () => {
  const a = loadFarmingFocus();
  const before = a.withSpecScope(SCOPE, () => a.getFarmingFocusCost("T8_FARM_PUMPKIN_SEED"));
  a.setSpecLevel(SCOPE, "FARM_CROPS_POTATO", 100);
  assert.strictEqual(a.withSpecScope(SCOPE, () => a.getFarmingFocusCost("T6_FARM_POTATO_SEED")), 125);
  assert.strictEqual(a.withSpecScope(SCOPE, () => a.getFarmingFocusCost("T8_FARM_PUMPKIN_SEED")), before);
  assert.strictEqual(before, 500);
});

test("the shared mastery DOES move every crop", () => {
  const a = loadFarmingFocus();
  a.setSpecLevel(SCOPE, "FARM_CROPS", 0);
  PLOTS.filter((item) => item.type === "crop").forEach((item) => {
    assert.strictEqual(
      a.withSpecScope(SCOPE, () => a.getFarmingFocusCost(item.id)), 1000,
      `${item.id} ignored the Crop Farmer mastery`,
    );
  });
});

test("Herbalist and Crop Farmer are independent branches", () => {
  const a = loadFarmingFocus();
  a.setSpecLevel(SCOPE, "FARM_HERBS", 0);
  assert.strictEqual(a.withSpecScope(SCOPE, () => a.getFarmingFocusCost("T3_FARM_COMFREY_SEED")), 1000);
  assert.strictEqual(a.withSpecScope(SCOPE, () => a.getFarmingFocusCost("T6_FARM_POTATO_SEED")), 500);
});

test("levels are per scope — the mounts table does not read the farming ones", () => {
  const a = loadFarmingFocus();
  a.setSpecLevel(SCOPE, "FARM_CROPS_POTATO", 100);
  assert.strictEqual(a.withSpecScope("mounts-table", () => a.getFarmingFocusCost("T6_FARM_POTATO_SEED")), 500);
});

// ── A pasture row buys its feed, so it waters nothing ───────────────────────

console.log("\n=== pasture rows spend no focus ===");

const BYPRODUCTS = api.FARMING_PRODUCTION.filter((r) => r.type === "byproduct");

test("there are pasture rows to check", () => {
  assert.ok(BYPRODUCTS.length > 0);
});

BYPRODUCTS.forEach((item) => {
  test(`${item.id} (feed for ${item.sourceAnimal}) has no specialization`, () => {
    assert.strictEqual(item.id, item.feedId, "a pasture row's id is its feed crop");
    assert.deepStrictEqual(api.specNodesForItem(item.id), []);
    assert.strictEqual(api.FOCUS_SPEC_ITEM_FAMILY[item.id], undefined);
  });
});

const renderSrc = read("js/render-farming.js");

test("render-farming charges a byproduct row 0 focus per cycle", () => {
  const m = renderSrc.match(/const focusPerCycle\s*=([\s\S]{0,320}?);\n/);
  assert.ok(m, "focusPerCycle is no longer assigned in one statement");
  assert.ok(
    /item\.type\s*===\s*"byproduct"\s*\r?\n?\s*\?\s*0/.test(m[1]),
    `a pasture row must short-circuit to 0, got: ${m[1].trim()}`,
  );
  // The per-seed charge is looked up just above and scaled by the plot's slots
  // there — see tests/farming-focus-per-seed.test.cjs for that multiplication.
  assert.ok(/const focusPerSeed\s*=[\s\S]{0,200}?getFarmingFocusCost\(item\.id\)/.test(renderSrc),
    "plots still price their own watering");
});

test("render-farming gives a byproduct row no focus play either", () => {
  assert.ok(
    /bestFocusPlay\s*=\s*\(item\.type\s*!==\s*"byproduct"/.test(renderSrc),
    "the byproduct guard on pickBestFocusPlay is gone",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
