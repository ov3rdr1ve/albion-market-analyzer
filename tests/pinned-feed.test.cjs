/**
 * Test: a feed tier pinned via the food-mode price editor stays the breeding
 * row's feed across recomputes (reported: "food price doesn't pin, it just
 * switches to next cheapest"). Covers the PinnedFeed store round-trip,
 * findCheapestFeed honoring the pin ahead of the cheapest-tier ranking, and
 * the app.js commit/✗ wiring (source-lift guards).
 *
 * Run: node tests/pinned-feed.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const { readIndexHtml } = require("./helpers/page-source.cjs");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Pinned feed store + findCheapestFeed pin tests\n");

// ── PinnedFeed store (js/pinned-feed.js), compiled against storage shims ──
// The module reads the global `localStorage` at call time, so each harness
// pins its own storage shape: a working shim, a corrupt-JSON shim, and no
// storage at all.
const pinnedSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "pinned-feed.js"),
  "utf8"
);

function compilePinnedFeed(storagePrelude, label) {
  const mod = new Module(label);
  mod._compile(
    storagePrelude + pinnedSrc + "\nmodule.exports = PinnedFeed;",
    "pinned-feed.js"
  );
  return mod.exports;
}

const workingShim = `
  const __store = {};
  const localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(__store, k) ? __store[k] : null,
    setItem: (k, v) => { __store[k] = String(v); },
    removeItem: (k) => { delete __store[k]; },
  };
`;
const corruptShim = `
  const localStorage = { getItem: () => "{not json", setItem() {}, removeItem() {} };
`;
const noStorageShim = "var localStorage = undefined;";

test("store: set then get returns the pinned tier for the category", () => {
  const PinnedFeed = compilePinnedFeed(workingShim, "pinned-feed-working");
  PinnedFeed.set("meat", "T6_MEAT");
  assert.strictEqual(PinnedFeed.get("meat"), "T6_MEAT");
});

test("store: get on an unpinned category is null", () => {
  const PinnedFeed = compilePinnedFeed(workingShim, "pinned-feed-empty");
  assert.strictEqual(PinnedFeed.get("meat"), null);
});

test("store: clear removes the pin and reports true; second clear reports false", () => {
  const PinnedFeed = compilePinnedFeed(workingShim, "pinned-feed-clear");
  PinnedFeed.set("plants", "T3_WHEAT");
  assert.strictEqual(PinnedFeed.clear("plants"), true);
  assert.strictEqual(PinnedFeed.get("plants"), null);
  assert.strictEqual(PinnedFeed.clear("plants"), false);
});

test("store: clear on one category leaves other categories alone", () => {
  const PinnedFeed = compilePinnedFeed(workingShim, "pinned-feed-isolated");
  PinnedFeed.set("meat", "T3_MEAT");
  PinnedFeed.set("plants", "T3_WHEAT");
  PinnedFeed.clear("meat");
  assert.strictEqual(PinnedFeed.get("meat"), null);
  assert.strictEqual(PinnedFeed.get("plants"), "T3_WHEAT");
});

test("store: set with empty category or tier is a no-op", () => {
  const PinnedFeed = compilePinnedFeed(workingShim, "pinned-feed-noop");
  PinnedFeed.set("", "T3_MEAT");
  PinnedFeed.set("meat", "");
  assert.strictEqual(PinnedFeed.get(""), null);
  assert.strictEqual(PinnedFeed.get("meat"), null);
});

test("store: corrupt JSON in storage reads as no pins (no throw)", () => {
  const PinnedFeed = compilePinnedFeed(corruptShim, "pinned-feed-corrupt");
  assert.strictEqual(PinnedFeed.get("meat"), null);
});

test("store: no localStorage at all — get is null, set/clear do not throw", () => {
  const PinnedFeed = compilePinnedFeed(noStorageShim, "pinned-feed-nostorage");
  assert.strictEqual(PinnedFeed.get("meat"), null);
  assert.doesNotThrow(() => PinnedFeed.set("meat", "T3_MEAT"));
  assert.doesNotThrow(() => PinnedFeed.clear("meat"));
  assert.strictEqual(PinnedFeed.get("meat"), null);
});

// ── findCheapestFeed integration ──
// Same harness as tests/breeding-metadata-and-row.test.cjs: compile the top of
// render-mounts.js with stubbed price lookups, plus a controllable PinnedFeed
// so tests can pin a tier per category the way the food-mode editor does.
const renderMountsSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-mounts.js"),
  "utf8"
);
const helperSource = renderMountsSrc.slice(
  0,
  renderMountsSrc.indexOf("function renderMountsTable")
);
const dataMountsSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-mounts.js"),
  "utf8"
);
const rrrEligibleSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "rrr-eligible.js"),
  "utf8"
);

const helperStubs = `
let testCityForce = {};
let testPinnedFeed = {};
let testOverrides = {};
function getIQRBounds() { return null; }
function getOverridePrice(id, city) { return testOverrides[id]?.[city] ?? null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function __setTestCityForce(map) { testCityForce = map || {}; }
const PinnedFeed = { get: (c) => testPinnedFeed[c] ?? null };
function __setTestPinnedFeed(map) { testPinnedFeed = map || {}; }
function __setTestOverrides(map) { testOverrides = map || {}; }
function getBuyPrice(itemData, city, bounds, id) {
  const ov = getOverridePrice(id, city);
  if (ov !== null && ov > 0) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getTierFromId(itemId) {
  const match = String(itemId || "").match(/^T(\\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}
`;

const helperMod = new Module("render-mounts-helpers");
helperMod._compile(
  helperStubs + rrrEligibleSrc + dataMountsSrc + helperSource +
  "\nmodule.exports = { findCheapestFeed, FOOD_ITEMS, __setTestCityForce, __setTestPinnedFeed, __setTestOverrides };",
  "render-mounts.js"
);
const {
  findCheapestFeed, __setTestCityForce, __setTestPinnedFeed, __setTestOverrides,
} = helperMod.exports;

// Shared market: T3 is cheapest per nutrition, T6 mid, T8 dearest.
function meatMarket() {
  return {
    T3_MEAT: { Bridgewatch: { buy_price: 100 } },
    T6_MEAT: { Bridgewatch: { buy_price: 400 } },
    T8_MEAT: { Bridgewatch: { buy_price: 900 } },
  };
}

test("pin: pinned non-cheapest tier wins over the cheapest tier (the reported bug)", () => {
  __setTestCityForce({}); __setTestPinnedFeed({ meat: "T6_MEAT" }); __setTestOverrides({});
  const feed = findCheapestFeed(meatMarket(), "meat", ["Bridgewatch"], "Bridgewatch", 380, 6);
  assert.strictEqual(feed.id, "T6_MEAT");
  assert.strictEqual(feed.price, 400);
  assert.strictEqual(feed.city, "Bridgewatch");
  assert.strictEqual(feed.totalCost, 380 * 400);
});

test("no pin: cheapest per-nutrition tier still wins (regression)", () => {
  __setTestCityForce({}); __setTestPinnedFeed({}); __setTestOverrides({});
  const feed = findCheapestFeed(meatMarket(), "meat", ["Bridgewatch"], "Bridgewatch", 380, 6);
  assert.strictEqual(feed.id, "T3_MEAT");
  assert.strictEqual(feed.price, 100);
});

test("pin: pinned tier with no price anywhere falls back to cheapest ranking", () => {
  // The pin itself is not dropped — the store keeps it for when data returns —
  // but the row still shows a number. T4_MEAT has no entry in the market map.
  __setTestCityForce({}); __setTestPinnedFeed({ meat: "T4_MEAT" }); __setTestOverrides({});
  const feed = findCheapestFeed(meatMarket(), "meat", ["Bridgewatch"], "Bridgewatch", 380, 6);
  assert.strictEqual(feed.id, "T3_MEAT");
  assert.strictEqual(feed.price, 100);
});

test("pin: pinned tier with an override uses the override price", () => {
  __setTestCityForce({}); __setTestPinnedFeed({ meat: "T6_MEAT" });
  __setTestOverrides({ T6_MEAT: { Bridgewatch: 123 } });
  const feed = findCheapestFeed(meatMarket(), "meat", ["Bridgewatch"], "Bridgewatch", 380, 6);
  assert.strictEqual(feed.id, "T6_MEAT");
  assert.strictEqual(feed.price, 123);
  assert.strictEqual(feed.totalCost, 380 * 123);
});

test("pin: pinned tier honors a forced buy city inside the section", () => {
  __setTestPinnedFeed({ meat: "T8_MEAT" }); __setTestOverrides({});
  __setTestCityForce({ T8_MEAT: { buy: "Martlock" } });
  const market = {
    T8_MEAT: { Lymhurst: { buy_price: 100 }, Martlock: { buy_price: 30000 } },
  };
  const feed = findCheapestFeed(market, "meat", ["Lymhurst", "Martlock"], "Lymhurst", 380, 8);
  assert.strictEqual(feed.city, "Martlock");
  assert.strictEqual(feed.price, 30000);
  __setTestCityForce({});
});

test("pin: forced city outside the section is ignored for the pinned tier too", () => {
  __setTestPinnedFeed({ meat: "T8_MEAT" }); __setTestOverrides({});
  __setTestCityForce({ T8_MEAT: { buy: "Caerleon" } });
  const market = {
    T8_MEAT: { Martlock: { buy_price: 30000 }, Caerleon: { buy_price: 50 } },
  };
  const feed = findCheapestFeed(market, "meat", ["Lymhurst", "Martlock"], "Lymhurst", 380, 8);
  assert.strictEqual(feed.city, "Martlock");
  assert.strictEqual(feed.price, 30000);
  __setTestCityForce({});
});

test("pin: stale id not in the category is ignored (cheapest wins)", () => {
  __setTestCityForce({}); __setTestOverrides({});
  __setTestPinnedFeed({ meat: "T99_BOGUS_MEAT" });
  const feed = findCheapestFeed(meatMarket(), "meat", ["Bridgewatch"], "Bridgewatch", 380, 6);
  assert.strictEqual(feed.id, "T3_MEAT");
});

test("pin: mounts category recounts pieces from the pinned tier's nutrition", () => {
  // Mount feed nutrition is tier-dependent, so the pinned evaluation must
  // recompute pieces the way the ranking loop does. T3 horse = 170/piece;
  // nutritionMax 1000 -> ceil(1000/170) = 6 pieces.
  __setTestCityForce({}); __setTestOverrides({});
  __setTestPinnedFeed({ mounts: "T3_MOUNT_HORSE" });
  const market = {
    T3_MOUNT_HORSE: { Martlock: { buy_price: 5000 } },
    T8_MOUNT_HORSE: { Martlock: { buy_price: 1000000 } }, // cheaper per nutrition
  };
  const feed = findCheapestFeed(market, "mounts", ["Martlock"], "Martlock", 10, 3, 1000);
  assert.strictEqual(feed.id, "T3_MOUNT_HORSE");
  assert.strictEqual(feed.pieces, 6);
  assert.strictEqual(feed.totalCost, 6 * 5000);
});

// ── app.js + index.html wiring (source-lift guards) ──

test("app.js persistOverrides pins the tier on commit and clears it on intentional empty", () => {
  const appSrc = appSource();
  const persistSrc = appSrc.slice(
    appSrc.indexOf("const persistOverrides"),
    appSrc.indexOf("const rerenderAfterEdit"),
  );
  assert.ok(persistSrc.includes("PinnedFeed.set(foodCategory, effectiveItemId)"),
    "persistOverrides must store the picked tier via PinnedFeed.set");
  assert.ok(persistSrc.includes("PinnedFeed.clear(foodCategory)"),
    "persistOverrides intentional-empty branch must drop the pin");
});

test("app.js ✗ clear drops the category pin", () => {
  const appSrc = appSource();
  const clearStart = appSrc.indexOf('clearBtn.addEventListener("click"');
  const clearSrc = appSrc.slice(clearStart, clearStart + 5000);
  assert.ok(clearStart > 0, "clear button handler not found");
  assert.ok(clearSrc.includes("PinnedFeed.clear(foodCategory)"),
    "✗ handler must clear the pinned feed tier");
});

test("index.html loads js/pinned-feed.js before js/render-mounts.js", () => {
  const html = readIndexHtml();
  const idxPinned = html.indexOf("js/pinned-feed.js");
  const idxMounts = html.indexOf("js/render-mounts.js");
  assert.ok(idxPinned > 0, "pinned-feed.js script tag missing from index.html");
  assert.ok(idxMounts > idxPinned, "pinned-feed.js must load before render-mounts.js");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
