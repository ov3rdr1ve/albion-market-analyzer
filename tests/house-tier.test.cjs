/**
 * Test: js/house-tier.js — the stored house tier and what it lets a house hold.
 *
 * THE RULE. In Albion a building can only hold furniture of its OWN tier or
 * lower: a T6 house takes T2-T6 furniture and nothing above it. Nothing in
 * items.xml states this — `<furnitureitem>` carries `placeableindoors` and its
 * own `tier`, but no building-tier requirement — so the cap has to be coded.
 *
 * WHAT THAT COSTS IN HAPPINESS. Trophy happiness is tier-flat (10 a specialist
 * trophy, 5 a general one) and only stacks across DISTINCT items, so the number
 * of trophies a house can hold is the number of TIERS it can hold: T2..TH, i.e.
 * H − 1 of each line. A T6 house therefore tops out at +50 matching / +25
 * general, not the +70 / +40 a T8 house reaches.
 *
 * The T8 general figure is 40 rather than 35 because the Founder's Looking Glass
 * is an eighth distinct `labourersaffected="all"` trophy — see
 * GENERAL_TROPHY_HAPPINESS_MAX in js/data-laborers.js.
 *
 * This is a TIER cap only. Furniture SLOTS bite too (a T8 house has 14 slots and
 * spends 4 on beds and a table), but that is the Building Costs table's job —
 * js/buildings-furnishing.js — and these ceilings deliberately ignore it, the
 * same way js/data-laborers.js already documents.
 *
 * Black-box: only the exported getters and the stored preference are touched.
 *
 * Run: node tests/house-tier.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// A localStorage stand-in the module reads through its own guard.
const sandbox = `
let __store = {};
const localStorage = {
  getItem: (k) => (k in __store ? __store[k] : null),
  setItem: (k, v) => { __store[k] = String(v); },
  removeItem: (k) => { delete __store[k]; },
};
function __setStore(next) { __store = next || {}; }
function __getStore() { return __store; }
`;

const EXPORTS =
  "\nmodule.exports = { HOUSE_TIER_KEY, HOUSE_TIER_DEFAULT, HOUSE_TIER_MIN, HOUSE_TIER_MAX, " +
  "getHouseTier, setHouseTier, getHouseTrophyCaps, initHouseTierControl, " +
  "GENERAL_TROPHY_HAPPINESS_MAX, MATCHING_TROPHY_HAPPINESS_MAX, __setStore, __getStore };";

function load(dom = "") {
  const m = new Module(`house-tier-${Math.random()}`);
  m._compile(
    sandbox + dom + loadFile("js/data-laborers.js") + loadFile("js/house-tier.js") + EXPORTS,
    "house-tier.js"
  );
  return m.exports;
}

const api = load();
const {
  HOUSE_TIER_KEY, HOUSE_TIER_DEFAULT, HOUSE_TIER_MIN, HOUSE_TIER_MAX,
  getHouseTier, setHouseTier, getHouseTrophyCaps,
  GENERAL_TROPHY_HAPPINESS_MAX, MATCHING_TROPHY_HAPPINESS_MAX, __setStore,
} = api;

const KEY = HOUSE_TIER_KEY;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __setStore({}); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── The stored preference ─────────────────────────────────────────────────
console.log("\n=== The stored preference ===");

test("the key is the one settings-transfer carries", () => {
  assert.strictEqual(HOUSE_TIER_KEY, "houseTier");
});

test("unset defaults to T8 — the app's max-everything convention", () => {
  // Anything else would silently hide rows and lower yields for every user who
  // has never opened the picker.
  assert.strictEqual(HOUSE_TIER_DEFAULT, 8);
  assert.strictEqual(getHouseTier(), 8);
});

test("the range is T2-T8 — no tiered house exists below T2", () => {
  assert.strictEqual(HOUSE_TIER_MIN, 2);
  assert.strictEqual(HOUSE_TIER_MAX, 8);
});

const STORED_CASES = [
  ["2", 2, "the smallest house"],
  ["6", 6, "the reported case"],
  ["8", 8, "the top of the ladder"],
  ["", 8, "a blank string is unset, not zero"],
  ["   ", 8, "whitespace is unset too"],
  ["banana", 8, "an unparseable value degrades to the default"],
  ["0", 2, "below the range clamps up, never to a tierless house"],
  ["1", 2, "T1 houses do not exist"],
  ["-4", 2, "a negative value clamps up"],
  ["9", 8, "above the range clamps down"],
  ["9999", 8, "far above the range clamps down"],
  ["6.7", 6, "a fractional value truncates rather than throwing"],
];

STORED_CASES.forEach(([stored, expected, why]) => {
  test(`stored ${JSON.stringify(stored)} reads back as T${expected} (${why})`, () => {
    __setStore({ [KEY]: stored });
    assert.strictEqual(getHouseTier(), expected);
  });
});

test("setHouseTier persists a value getHouseTier agrees with", () => {
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    setHouseTier(tier);
    assert.strictEqual(getHouseTier(), tier, `T${tier} did not round-trip`);
  });
});

test("setHouseTier clamps rather than storing something unusable", () => {
  setHouseTier(99);
  assert.strictEqual(getHouseTier(), 8);
  setHouseTier(-1);
  assert.strictEqual(getHouseTier(), 2);
});

test("setHouseTier with nothing usable clears back to the default", () => {
  setHouseTier(4);
  assert.strictEqual(getHouseTier(), 4);
  [null, undefined, "", NaN].forEach((bad) => {
    setHouseTier(4);
    setHouseTier(bad);
    assert.strictEqual(getHouseTier(), HOUSE_TIER_DEFAULT,
      `${String(bad)} should clear the preference`);
  });
});

// ── The trophy ceilings a house tier allows ───────────────────────────────
console.log("\n=== Trophy ceilings per house tier ===");

// [house tier, matching ceiling, general ceiling]
// matching = 10 × the specialist tiers T2..TH
// general  = 5 × the general tiers T2..TH, plus the Founder's Looking Glass at T8
const CAP_CASES = [
  [2, 10, 5],
  [3, 20, 10],
  [4, 30, 15],
  [5, 40, 20],
  [6, 50, 25],
  [7, 60, 30],
  [8, 70, 40],
];

CAP_CASES.forEach(([tier, matching, general]) => {
  test(`a T${tier} house tops out at +${matching} matching / +${general} general`, () => {
    assert.deepStrictEqual(getHouseTrophyCaps(tier), { matching, general });
  });
});

test("T8 reproduces the catalog constants exactly — no behaviour change by default", () => {
  const caps = getHouseTrophyCaps(8);
  assert.strictEqual(caps.general, GENERAL_TROPHY_HAPPINESS_MAX);
  assert.strictEqual(caps.matching, MATCHING_TROPHY_HAPPINESS_MAX);
});

test("no house tier can exceed the game's own ceilings", () => {
  [2, 3, 4, 5, 6, 7, 8, 99].forEach((tier) => {
    const caps = getHouseTrophyCaps(tier);
    assert.ok(caps.general <= GENERAL_TROPHY_HAPPINESS_MAX, `T${tier} general ${caps.general}`);
    assert.ok(caps.matching <= MATCHING_TROPHY_HAPPINESS_MAX, `T${tier} matching ${caps.matching}`);
  });
});

test("the ceilings rise monotonically with the house tier", () => {
  for (let tier = 3; tier <= 8; tier++) {
    const lo = getHouseTrophyCaps(tier - 1);
    const hi = getHouseTrophyCaps(tier);
    assert.ok(hi.matching > lo.matching, `T${tier} matching did not beat T${tier - 1}`);
    assert.ok(hi.general > lo.general, `T${tier} general did not beat T${tier - 1}`);
  }
});

test("an out-of-range or missing argument is clamped, never NaN", () => {
  assert.deepStrictEqual(getHouseTrophyCaps(1), getHouseTrophyCaps(2));
  assert.deepStrictEqual(getHouseTrophyCaps(99), getHouseTrophyCaps(8));
  assert.deepStrictEqual(getHouseTrophyCaps("banana"), getHouseTrophyCaps(8));
  assert.deepStrictEqual(getHouseTrophyCaps(), getHouseTrophyCaps(8));
});

test("with no argument it reads the stored tier, so callers need not pass one", () => {
  __setStore({ [KEY]: "6" });
  assert.deepStrictEqual(getHouseTrophyCaps(getHouseTier()), { matching: 50, general: 25 });
});

// ── The picker ────────────────────────────────────────────────────────────
console.log("\n=== The picker ===");

// Minimal DOM stub: the control only reads/writes <select>s carrying one class.
function pickerHarness(store) {
  const mk = (id) => ({
    id, value: "", _handlers: {},
    addEventListener(type, fn) { this._handlers[type] = fn; },
    change(next) { this.value = next; this._handlers.change(); },
  });
  const a = mk("house-tier-laborers");
  const b = mk("house-tier-craft-planner");
  const dom = `
const __els = globalThis.__houseTierEls;
const document = { querySelectorAll: () => __els, getElementById: () => null };
`;
  globalThis.__houseTierEls = [a, b];
  const m = new Module(`house-tier-picker-${Math.random()}`);
  m._compile(
    sandbox + dom + loadFile("js/data-laborers.js") + loadFile("js/house-tier.js") + EXPORTS,
    "house-tier-picker.js"
  );
  m.exports.__setStore(store || {});
  return { a, b, api: m.exports };
}

test("every picker opens on the stored tier", () => {
  const h = pickerHarness({ [KEY]: "5" });
  h.api.initHouseTierControl();
  assert.strictEqual(h.a.value, "5");
  assert.strictEqual(h.b.value, "5");
});

test("unset pickers open on T8, matching the default", () => {
  const h = pickerHarness({});
  h.api.initHouseTierControl();
  assert.strictEqual(h.a.value, "8");
  assert.strictEqual(h.b.value, "8");
});

test("changing one picker persists and syncs the other", () => {
  // Two tables share one house; a picker that disagreed with its twin would be
  // reporting a house the user does not own.
  const h = pickerHarness({});
  h.api.initHouseTierControl();
  h.a.change("6");
  assert.strictEqual(h.api.getHouseTier(), 6);
  assert.strictEqual(h.b.value, "6", "the Crafting Planner picker must follow");
  h.b.change("3");
  assert.strictEqual(h.api.getHouseTier(), 3);
  assert.strictEqual(h.a.value, "3", "the Laborers picker must follow");
});

test("changing a picker asks the caller to re-render", () => {
  const h = pickerHarness({});
  let renders = 0;
  h.api.initHouseTierControl(() => { renders++; });
  h.a.change("4");
  assert.strictEqual(renders, 1, "the tables must be re-rendered on every edit");
  h.b.change("7");
  assert.strictEqual(renders, 2);
});

test("an out-of-range entry is written back clamped, so the picker never lies", () => {
  const h = pickerHarness({});
  h.api.initHouseTierControl();
  h.a.change("99");
  assert.strictEqual(h.a.value, "8");
  assert.strictEqual(h.b.value, "8");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
