/**
 * The editor's ✗ must clear an override EVERYWHERE, in one click.
 *
 * An override is stored per (itemId, city), but no row reads it per city: every
 * table picks its city globally (findBestBuyCity / findBestSellCity) and an
 * override at ANY city bypasses the volume gate. So deleting only the city the
 * cell happened to render just promoted the next city's entry — the ⚡ marker
 * stayed, the number changed, and the user had to click ✗ once per city they had
 * ever edited. clearOverridePriceAllCities drops the whole item.
 *
 * Loads the REAL js/utils.js — no replica — with a fake localStorage. No DOM
 * beyond the order-type radio, no API, no storage on disk.
 *
 * Run: node tests/price-override-clear-all-cities.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");

const sandbox = `
const localStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const _radio = { id: "sort-instant", checked: false };
const document = {
  getElementById(id) { return id === "sort-instant" ? _radio : null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
};
const window = {};
`;

const src = sandbox
  + ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(ROOT, "js", n + ".js"), "utf8")).join("\n")
  + `
module.exports = {
  setOverrideEntry, clearOverridePrice, clearOverridePriceAllCities,
  getOverridePrice, getOverrideField, qualityOverrideKey,
  storedRaw: () => localStorage.getItem("priceOverrides"),
  writes: () => _writes,
  reload: () => {
    Object.keys(priceOverrides).forEach((k) => delete priceOverrides[k]);
    loadOverridesFromStorage();
  },
  reset: () => {
    Object.keys(priceOverrides).forEach((k) => delete priceOverrides[k]);
    localStorage._d = {};
    localStorage.setItem("priceOverridesVersion", OVERRIDE_SCHEMA_VERSION);
    _writes = 0;
  },
};`;

// Count storage writes so "no-op stays a no-op" is observable.
const counted = src.replace(
  "function saveOverridesToStorage() {",
  "let _writes = 0;\nfunction saveOverridesToStorage() {\n  _writes++;",
);

const m = new Module("price-override-clear-all-cities-test");
m._compile(counted, path.join(ROOT, "js", "price-override-clear-all-cities-test.js"));
const u = m.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { u.reset(); fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.error(`  FAIL: ${name} — ${e.message}`); }
}

const ROYAL = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const ALL = ["Caerleon", ...ROYAL, "Smuggler's Den"];
const ID = "T6_PLANKS";

const seed = (cities, entry) =>
  cities.forEach((c) => u.setOverrideEntry(ID, c, entry || { buyOrder: 1234, use: "auto" }));
const anyLeft = (cities) => cities.some((c) => u.getOverridePrice(ID, c) !== null);

console.log("\n=== One click clears every city ===");

[
  ["one city", ["Martlock"]],
  ["three cities", ["Martlock", "Caerleon", "Brecilien"]],
  ["every city", ALL],
].forEach(([label, cities]) => {
  test(`${label}: a single clearOverridePriceAllCities leaves nothing`, () => {
    seed(cities);
    assert.ok(anyLeft(cities), "precondition: the seed is readable");
    u.clearOverridePriceAllCities(ID);
    assert.strictEqual(anyLeft(ALL), false, "an override survived somewhere");
    ALL.forEach((c) => {
      assert.strictEqual(u.getOverrideField(ID, c, "buy"), null, `buy field left at ${c}`);
      assert.strictEqual(u.getOverrideField(ID, c, "sell"), null, `sell field left at ${c}`);
    });
  });
});

test("the per-city clear still only touches its own city (unchanged contract)", () => {
  seed(["Martlock", "Caerleon"]);
  u.clearOverridePrice(ID, "Martlock");
  assert.strictEqual(u.getOverridePrice(ID, "Martlock"), null);
  assert.strictEqual(u.getOverridePrice(ID, "Caerleon"), 1234);
});

console.log("\n=== Pins, both sides, other items ===");

test("buy-pinned, sell-pinned and auto entries all go", () => {
  u.setOverrideEntry(ID, "Martlock", { buyOrder: 100, use: "buy" });
  u.setOverrideEntry(ID, "Caerleon", { sellOrder: 200, use: "sell" });
  u.setOverrideEntry(ID, "Thetford", { buyOrder: 300, sellOrder: 400, use: "auto" });
  u.clearOverridePriceAllCities(ID);
  assert.strictEqual(anyLeft(ALL), false);
});

test("another item's overrides are untouched", () => {
  seed(["Martlock"]);
  u.setOverrideEntry("T6_METALBAR", "Martlock", { buyOrder: 999, use: "auto" });
  u.clearOverridePriceAllCities(ID);
  assert.strictEqual(u.getOverridePrice("T6_METALBAR", "Martlock"), 999);
});

test("a quality key clears without touching its siblings or the plain id", () => {
  const q3 = u.qualityOverrideKey(ID, 3);
  const q2 = u.qualityOverrideKey(ID, 2);
  u.setOverrideEntry(q3, "Martlock", { buyOrder: 30, use: "auto" });
  u.setOverrideEntry(q3, "Caerleon", { buyOrder: 31, use: "auto" });
  u.setOverrideEntry(q2, "Martlock", { buyOrder: 20, use: "auto" });
  u.setOverrideEntry(ID, "Martlock", { buyOrder: 10, use: "auto" });
  u.clearOverridePriceAllCities(q3);
  assert.strictEqual(u.getOverridePrice(q3, "Martlock"), null);
  assert.strictEqual(u.getOverridePrice(q3, "Caerleon"), null);
  assert.strictEqual(u.getOverridePrice(q2, "Martlock"), 20);
  assert.strictEqual(u.getOverridePrice(ID, "Martlock"), 10);
});

console.log("\n=== Storage ===");

test("the clear is persisted — a reload from storage shows nothing", () => {
  seed(["Martlock", "Caerleon", "Brecilien"]);
  u.clearOverridePriceAllCities(ID);
  u.reload();
  assert.strictEqual(anyLeft(ALL), false, "the cleared entries came back from storage");
});

test("clearing an item that has no override is a silent no-op (no write)", () => {
  seed(["Martlock"]);
  const before = u.writes();
  u.clearOverridePriceAllCities("T8_LEATHER");
  assert.strictEqual(u.writes(), before, "an unknown item must not rewrite storage");
  assert.strictEqual(u.getOverridePrice(ID, "Martlock"), 1234, "and must not touch other items");
});

test("clearing twice is idempotent", () => {
  seed(["Martlock", "Caerleon"]);
  u.clearOverridePriceAllCities(ID);
  const after = u.writes();
  u.clearOverridePriceAllCities(ID);
  assert.strictEqual(u.writes(), after, "the second clear has nothing to write");
  assert.strictEqual(anyLeft(ALL), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
