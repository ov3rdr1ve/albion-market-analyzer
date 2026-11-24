/**
 * Test: Pricing Model preference persistence across page reloads.
 *
 * Original bug: selecting "Market Orders" reset to "Instant" on refresh,
 * because the radios — unlike every sibling control (show-all, caerleon routes,
 * use-focus, station-fee) — were never written to localStorage on change nor
 * restored on load, so the HTML `checked` default always won after a reload.
 *
 * The control is now TWO radio groups, one per leg (buyOrderType /
 * sellOrderType), each with its own storage key. A pre-split install stored a
 * single "orderType"; it must seed whichever side has no key of its own, so an
 * upgrade lands on the mode the user already had — on BOTH legs, which is what
 * that one toggle meant.
 *
 * getOrderType comes from the real js/utils.js; the restore/save block mirrors
 * js/app.js (which cannot be loaded standalone — it wires the whole page).
 *
 * Run: node tests/order-type-persistence.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ── localStorage stub ───────────────────────────────────────────────────────
let _localStorage = {};
const localStorageStub = {
  getItem(k) { return _localStorage[k] ?? null; },
  setItem(k, v) { _localStorage[k] = String(v); },
  removeItem(k) { delete _localStorage[k]; },
};

// ── Radio-group model mirroring index.html ──────────────────────────────────
// HTML default: the two `instant` radios are `checked`.
const GROUPS = [
  { name: "buyOrderType", key: "buyOrderType", instantId: "buy-instant", marketId: "buy-market" },
  { name: "sellOrderType", key: "sellOrderType", instantId: "sell-instant", marketId: "sell-market" },
];

function freshRadios() {
  return GROUPS.flatMap((g) => [
    { id: g.marketId, name: g.name, value: "market", checked: false },
    { id: g.instantId, name: g.name, value: "instant", checked: true },
  ]);
}

let radios = freshRadios();

const documentStub = {
  getElementById(id) { return radios.find((r) => r.id === id) ?? null; },
  querySelector() { return null; },
  querySelectorAll(selector) {
    const m = /^input\[name="(.+)"\]$/.exec(selector);
    return m ? radios.filter((r) => r.name === m[1]) : [];
  },
};

// ── The real getOrderType / getBuyOrderType / getSellOrderType ──────────────
const sandbox = { document: documentStub, localStorage: localStorageStub, console };
sandbox.window = sandbox;
vm.runInContext(
  ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n")
    + "\n;globalThis.__exp = { getOrderType };",
  vm.createContext(sandbox),
  { filename: "utils.js" },
);
const { getOrderType } = sandbox.__exp;

// ── Restore + save, mirroring the block in js/app.js ────────────────────────
function restoreOrderTypes() {
  const legacy = localStorageStub.getItem("orderType");
  GROUPS.forEach(({ name, key }) => {
    const group = documentStub.querySelectorAll(`input[name="${name}"]`);
    if (!group.length) return;
    let saved = localStorageStub.getItem(key);
    if (saved !== "market" && saved !== "instant") {
      saved = (legacy === "market" || legacy === "instant") ? legacy : null;
      if (saved) localStorageStub.setItem(key, saved);
    }
    if (saved) group.forEach((radio) => { radio.checked = radio.value === saved; });
  });
}

/** Simulate the user picking a mode on one leg (the radio "change" handler). */
function select(side, value) {
  const { name, key } = GROUPS.find((g) => g.key === `${side}OrderType`);
  radios.filter((r) => r.name === name).forEach((radio) => {
    radio.checked = radio.value === value;
    if (radio.checked) localStorageStub.setItem(key, radio.value);
  });
}

/** A full page reload: the DOM reverts to the HTML defaults, then restore runs. */
function simulateReload() {
  radios = freshRadios();
  restoreOrderTypes();
}

// ── Test runner ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  _localStorage = {};
  radios = freshRadios();
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Order Type Persistence Tests\n");

// ── Defaults ───────────────────────────────────────────────────────────────
test("Default (nothing saved): both legs stay instant after reload", () => {
  simulateReload();
  assert.strictEqual(getOrderType("buy"), "instant");
  assert.strictEqual(getOrderType("sell"), "instant");
});

test("Default writes nothing to localStorage", () => {
  simulateReload();
  assert.strictEqual(localStorageStub.getItem("buyOrderType"), null);
  assert.strictEqual(localStorageStub.getItem("sellOrderType"), null);
});

// ── The original bug, now once per leg ─────────────────────────────────────
["buy", "sell"].forEach((side) => {
  test(`Selecting Market Orders on the ${side} leg persists across reload`, () => {
    select(side, "market");
    assert.strictEqual(getOrderType(side), "market", "selection applies immediately");
    simulateReload();
    assert.strictEqual(getOrderType(side), "market", "must survive refresh");
  });

  test(`Selecting Market Orders writes ${side}OrderType=market`, () => {
    select(side, "market");
    assert.strictEqual(localStorageStub.getItem(`${side}OrderType`), "market");
  });

  test(`${side} leg survives multiple consecutive reloads`, () => {
    select(side, "market");
    simulateReload();
    simulateReload();
    simulateReload();
    assert.strictEqual(getOrderType(side), "market");
  });

  test(`Switching the ${side} leg back to Instant persists`, () => {
    select(side, "market");
    simulateReload();
    assert.strictEqual(getOrderType(side), "market");
    select(side, "instant");
    assert.strictEqual(localStorageStub.getItem(`${side}OrderType`), "instant");
    simulateReload();
    assert.strictEqual(getOrderType(side), "instant");
  });
});

// ── The legs are independent ───────────────────────────────────────────────
test("Setting the buy leg leaves the sell leg alone", () => {
  select("buy", "market");
  simulateReload();
  assert.strictEqual(getOrderType("buy"), "market");
  assert.strictEqual(getOrderType("sell"), "instant");
  assert.strictEqual(localStorageStub.getItem("sellOrderType"), null);
});

test("A mixed mode round-trips", () => {
  select("buy", "market");
  select("sell", "instant");
  simulateReload();
  assert.strictEqual(getOrderType("buy"), "market");
  assert.strictEqual(getOrderType("sell"), "instant");
});

test("Restore checks exactly one radio per group", () => {
  select("buy", "market");
  simulateReload();
  const checked = radios.filter((r) => r.checked).map((r) => r.id).sort();
  assert.deepStrictEqual(checked, ["buy-market", "sell-instant"]);
});

// ── Migration from the pre-split single key ────────────────────────────────
test("A stored legacy orderType=market seeds BOTH legs", () => {
  localStorageStub.setItem("orderType", "market");
  simulateReload();
  assert.strictEqual(getOrderType("buy"), "market");
  assert.strictEqual(getOrderType("sell"), "market");
  assert.strictEqual(localStorageStub.getItem("buyOrderType"), "market");
  assert.strictEqual(localStorageStub.getItem("sellOrderType"), "market");
});

test("A per-leg key already set wins over the legacy key", () => {
  localStorageStub.setItem("orderType", "market");
  localStorageStub.setItem("sellOrderType", "instant");
  simulateReload();
  assert.strictEqual(getOrderType("buy"), "market");
  assert.strictEqual(getOrderType("sell"), "instant");
});

test("A garbage legacy value is ignored", () => {
  localStorageStub.setItem("orderType", "garbage");
  simulateReload();
  assert.strictEqual(getOrderType("buy"), "instant");
  assert.strictEqual(getOrderType("sell"), "instant");
});

// ── Robustness ─────────────────────────────────────────────────────────────
[["garbage", "garbage"], ["", "empty-string"]].forEach(([bad, label]) => {
  test(`A ${label} per-leg value falls back to the instant default`, () => {
    localStorageStub.setItem("buyOrderType", bad);
    simulateReload();
    assert.strictEqual(getOrderType("buy"), "instant");
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
