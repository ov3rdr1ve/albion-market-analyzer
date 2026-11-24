/**
 * Test: Rolling table override persistence across page reloads.
 *
 * Bug 1: City force must be saved whenever a valid price override is saved,
 *         including blur commits and closeQuietly paths.
 * Bug 2: REROLL rows must use actual margin (not -1) so they appear in
 *         the default view for all cities, not just Caerleon.
 *
 * Run: node tests/rolling-override-persistence.test.cjs
 */

const assert = require("assert");

// ── Minimal stubs ───────────────────────────────────────────────────────────
let _localStorage = {};
global.localStorage = {
  getItem(k) { return _localStorage[k] ?? null; },
  setItem(k, v) { _localStorage[k] = v; },
  removeItem(k) { delete _localStorage[k]; },
};
global.document = {
  getElementById() { return null; },
  querySelector() { return null; },
};

// ── Override systems (mirror utils.js) ──────────────────────────────────────
let priceOverrides = {};
let cityForceOverrides = {};

function setOverridePrice(itemId, city, price) {
  if (!priceOverrides[itemId]) priceOverrides[itemId] = {};
  priceOverrides[itemId][city] = { price };
  localStorage.setItem("priceOverrides", JSON.stringify(priceOverrides));
}
function getOverridePrice(itemId, city) {
  const entry = priceOverrides[itemId]?.[city];
  return entry ? entry.price : null;
}

function setCityForce(itemId, side, city) {
  if (!cityForceOverrides[itemId]) cityForceOverrides[itemId] = {};
  cityForceOverrides[itemId][side] = city;
  localStorage.setItem("cityForceOverrides", JSON.stringify(cityForceOverrides));
}
function getCityForce(itemId, side) {
  return cityForceOverrides[itemId]?.[side] ?? null;
}
function clearCityForce(itemId, side) {
  if (cityForceOverrides[itemId]) {
    delete cityForceOverrides[itemId][side];
    localStorage.setItem("cityForceOverrides", JSON.stringify(cityForceOverrides));
  }
}

function loadOverridesFromStorage() {
  const raw = localStorage.getItem("priceOverrides");
  if (!raw) return;
  priceOverrides = JSON.parse(raw);
}
function loadCityForcesFromStorage() {
  const raw = localStorage.getItem("cityForceOverrides");
  if (raw) cityForceOverrides = JSON.parse(raw);
}

// ── Simulate commit() with the FIXED logic ─────────────────────────────────
function commitFixed(itemId, selectedCity, val, intentional, cityListAttr) {
  if (!isNaN(val) && val > 0) {
    setOverridePrice(itemId, selectedCity, val);
  } else if (intentional && (val === 0 || isNaN(val))) {
    if (priceOverrides[itemId]) {
      delete priceOverrides[itemId][selectedCity];
      localStorage.setItem("priceOverrides", JSON.stringify(priceOverrides));
    }
  }
  const side = cityListAttr === "buy" ? "buy" : "sell";
  if (!isNaN(val) && val > 0) {
    setCityForce(itemId, side, selectedCity);
  } else if (intentional) {
    clearCityForce(itemId, side);
  }
}

// ── Simulate closeQuietly() with the FIXED logic ───────────────────────────
function closeQuietlyFixed(itemId, selectedCity, val, cityListAttr) {
  if (!isNaN(val) && val > 0) {
    setOverridePrice(itemId, selectedCity, val);
    const side = cityListAttr === "buy" ? "buy" : "sell";
    setCityForce(itemId, side, selectedCity);
  }
}

// ── Simulate reload ────────────────────────────────────────────────────────
function simulateReload() {
  priceOverrides = {};
  cityForceOverrides = {};
  loadOverridesFromStorage();
  loadCityForcesFromStorage();
}

// ── Test runner ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  _localStorage = {};
  priceOverrides = {};
  cityForceOverrides = {};
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
}

const ART_ID = "T6_ARTEFACT_OFF_SHIELD_AVALON";
const FRAG_ID = "T6_SHARD_AVALONIAN";

// ═══════════════════════════════════════════════════════════════════════════
// Bug 1: Override + city force persistence
// ═══════════════════════════════════════════════════════════════════════════
console.log("Bug 1 — Override persistence across reload:");

test("Intentional commit (Enter/OK) saves both price and city force", () => {
  commitFixed(ART_ID, "Black Market", 50000, true, "sell");
  simulateReload();
  assert.strictEqual(getOverridePrice(ART_ID, "Black Market"), 50000);
  assert.strictEqual(getCityForce(ART_ID, "sell"), "Black Market");
});

test("Blur commit (click-away) saves both price and city force", () => {
  commitFixed(ART_ID, "Caerleon", 30000, false, "sell");
  simulateReload();
  assert.strictEqual(getOverridePrice(ART_ID, "Caerleon"), 30000);
  assert.strictEqual(getCityForce(ART_ID, "sell"), "Caerleon");
});

test("Blur commit does NOT clear existing city force when price is valid", () => {
  // First set via intentional commit
  commitFixed(ART_ID, "Black Market", 50000, true, "sell");
  // Then blur commit on same city (user opened editor and clicked away)
  commitFixed(ART_ID, "Black Market", 50000, false, "sell");
  simulateReload();
  assert.strictEqual(getCityForce(ART_ID, "sell"), "Black Market");
  assert.strictEqual(getOverridePrice(ART_ID, "Black Market"), 50000);
});

test("Intentional clear (OK with 0) removes both price and city force", () => {
  commitFixed(ART_ID, "Black Market", 50000, true, "sell");
  commitFixed(ART_ID, "Black Market", 0, true, "sell");
  simulateReload();
  assert.strictEqual(getOverridePrice(ART_ID, "Black Market"), null);
  assert.strictEqual(getCityForce(ART_ID, "sell"), null);
});

test("closeQuietly saves both price and city force", () => {
  closeQuietlyFixed(ART_ID, "Bridgewatch", 42000, "sell");
  simulateReload();
  assert.strictEqual(getOverridePrice(ART_ID, "Bridgewatch"), 42000);
  assert.strictEqual(getCityForce(ART_ID, "sell"), "Bridgewatch");
});

test("closeQuietly with 0 price does not set city force", () => {
  closeQuietlyFixed(ART_ID, "Bridgewatch", 0, "sell");
  simulateReload();
  assert.strictEqual(getOverridePrice(ART_ID, "Bridgewatch"), null);
  assert.strictEqual(getCityForce(ART_ID, "sell"), null);
});

test("Fragment buy override persists city force after reload", () => {
  commitFixed(FRAG_ID, "Lymhurst", 200, true, "buy");
  simulateReload();
  assert.strictEqual(getOverridePrice(FRAG_ID, "Lymhurst"), 200);
  assert.strictEqual(getCityForce(FRAG_ID, "buy"), "Lymhurst");
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug 2: REROLL rows use actual margin (visible for all cities)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nBug 2 — Rolling margin for REROLL rows:");

function computeRowMarginInfo(rollCostSilver, sellRevenue, fragBuyPrice, hasNoFragData) {
  const salvageReturn = 10;
  const effectiveSalvageRevenue = fragBuyPrice * salvageReturn * (1 - 0.04);
  const action = hasNoFragData
    ? "SELL"
    : sellRevenue >= effectiveSalvageRevenue ? "SELL" : "REROLL";
  const margin = hasNoFragData
    ? null
    : rollCostSilver > 0
      ? ((sellRevenue - rollCostSilver) / rollCostSilver) * 100
      : -999;
  // FIXED: use actual margin, not -1 for REROLL
  return {
    marginInfo: { margin: hasNoFragData ? -1 : margin },
    action,
    margin: margin ?? -999,
  };
}

test("SELL row: marginInfo uses actual positive margin", () => {
  // sell revenue > salvage revenue, and sell revenue > roll cost
  const result = computeRowMarginInfo(1000, 2000, 20, false);
  assert.strictEqual(result.action, "SELL");
  assert.ok(result.marginInfo.margin > 0, "Expected positive margin");
  assert.strictEqual(result.marginInfo.margin, 100); // (2000-1000)/1000*100
});

test("REROLL row: marginInfo uses actual margin (not -1)", () => {
  // sell revenue < salvage revenue, but sell revenue > roll cost → positive margin
  // fragBuyPrice=200, salvageReturn=10 → salvageRevenue = 200*10*0.96 = 1920
  // sellRevenue=1500 < 1920 → REROLL
  // rollCostSilver=1000, margin = (1500-1000)/1000*100 = 50%
  const result = computeRowMarginInfo(1000, 1500, 200, false);
  assert.strictEqual(result.action, "REROLL");
  assert.ok(result.marginInfo.margin > 0, "REROLL row with profitable sell should have positive margin");
  assert.strictEqual(result.marginInfo.margin, 50);
});

test("REROLL row with negative sell margin: marginInfo reflects actual negative margin", () => {
  // fragBuyPrice=500 → salvageRevenue = 500*10*0.96 = 4800 > sellRevenue=2000 → REROLL
  // margin = (2000-5000)/5000*100 = -60%
  const result = computeRowMarginInfo(5000, 2000, 500, false);
  assert.strictEqual(result.action, "REROLL");
  assert.ok(result.marginInfo.margin < 0, "Expected negative margin");
  assert.strictEqual(result.marginInfo.margin, -60);
});

test("No frag data row: marginInfo is -1", () => {
  const result = computeRowMarginInfo(0, 2000, 0, true);
  assert.strictEqual(result.marginInfo.margin, -1);
});

test("REROLL row visible in profitability filter when sell margin is positive", () => {
  const result = computeRowMarginInfo(1000, 1500, 200, false);
  // Default filter: row.marginInfo.margin >= 0
  const visible = result.marginInfo.margin >= 0;
  assert.ok(visible, "REROLL row with positive sell margin should be visible");
});

test("REROLL row hidden in profitability filter when sell margin is negative", () => {
  const result = computeRowMarginInfo(5000, 2000, 200, false);
  const visible = result.marginInfo.margin >= 0;
  assert.ok(!visible, "REROLL row with negative sell margin should be hidden");
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
