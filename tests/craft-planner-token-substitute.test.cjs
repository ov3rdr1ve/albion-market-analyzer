/**
 * Test: the Craft Planner prices artifact SUBSTITUTES, not just the artifact.
 *
 * An artifact slot also accepts a Crystallized token of the same tier (and, on
 * three gear lines, an expiring "decay" twin) — same recipe, same focus. The
 * Crafting table has priced both and bought the cheaper since
 * js/gear-token-substitute.js landed (render-crafting.js), but the planner
 * always paid the artifact's own price, so the two tables disagreed on the cost
 * of the same craft.
 *
 * Rules pinned here:
 *  - cheapest candidate wins; the material's own id is the default and wins ties;
 *  - a substitute is still an artifact: consumed in full, no craft RRR, and it
 *    does not add to the fame-bearing material count;
 *  - a dead FORCED buy city on the material itself kills the row — the force
 *    means "source it here", not "source something else";
 *  - an unpriced artifact with a priced token is craftable (the row survives).
 *
 * Black-box over the real computeCraftPlannerRow with synthetic prices.
 * No live API or DB.
 *
 * Run: node tests/craft-planner-token-substitute.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = { "Fort Sterling":"wood", Lymhurst:"fiber", Bridgewatch:"rock", Thetford:"ore", Martlock:"hide" };
const RESOURCE_DEFS = [
  { type:"wood", raw:"WOOD", refined:"PLANKS",   tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"ore",  raw:"ORE",  refined:"METALBAR", tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];
let testCityForce = {}, testOverrides = {};
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
function isFocusEnabled() { return false; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
function getOverrideVolume() { return null; }
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b=BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getCraftRRR(city, ct, f) { let b=BASE_CITY_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return 24; }
function getCraftFocusCost() { return 8000; }
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1],10) : 4; }
function isInvalidCrossRoute() { return false; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function __setOverrides(m){ testOverrides = m || {}; }
function __setForce(m){ testCityForce = m || {}; }
function __reset(){ __setOverrides({}); __setForce({}); }
`;

// autocrlf checkouts read CRLF; normalize so the `\n}\n` lift matches anywhere.
const load = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
const MARGINAL_SPF_SRC = load("js/refining-route.js")
  .match(/function marginalSilverPerFocus\([\s\S]*?\n}\n/)[0];

const mod = new Module("craft-planner-token-substitute");
mod._compile(
  sandbox + MARGINAL_SPF_SRC +
    load("js/focus-play.js") +
    load("js/refining-chain-recipes.js") +
    load("js/refining-chain-pricing.js") +
    load("js/refining-chain-focus.js") +
    load("js/data-craft-journal-fame.js") +
    load("js/data-craft-planner.js") +
    load("js/data-laborers.js") +
    load("js/laborers-pricing.js") +
    load("js/render-laborers.js") +
    load("js/laborer-journal-value.js") +
    load("js/data-artifacts.js") +          // ARTIFACT_MAPPING, keyed by suffix
    load("js/gear-token-substitute.js") +
    load("js/craft-planner-quality.js") +       // quality-book reads in the sell loop
    load("js/craft-planner-pricing.js") +
    "\nmodule.exports = { computeCraftPlannerRow, getCraftMatCandidates," +
    " getArtifactTokenId, __setOverrides, __setForce, __reset };",
  "craft-planner-token-substitute.js"
);
const {
  computeCraftPlannerRow, getCraftMatCandidates, getArtifactTokenId,
  __setOverrides, __setForce, __reset,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    (out[e.id] ||= {})[e.city || FS] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";
const ARTIFACT = "T8_ARTEFACT_2H_HOLYSTAFF_HELL";
const TOKEN = getArtifactTokenId(ARTIFACT);

const ITEM = { id: "T8_2H_HOLYSTAFF_HELL", name: "Great Hallowfall", craftType: "holystaff" };
const MATS = [{ matId: "T8_PLANKS", count: 20 }, { matId: ARTIFACT, count: 1 }];

function market({ artifact = 500_000, token = null } = {}) {
  const rows = [
    { id: "T8_PLANKS", buy: 1_000 },
    { id: "T8_WOOD", buy: 900_000 },      // self-refining must not win here
    { id: "T7_PLANKS", buy: 900_000 },
    { id: ITEM.id, sell: 9_000_000 },
  ];
  if (artifact != null) rows.push({ id: ARTIFACT, buy: artifact });
  if (token != null) rows.push({ id: TOKEN, buy: token });
  return priceMap(rows);
}
const row = (md) => computeCraftPlannerRow(ITEM, MATS, md, FS);
const artifactLine = (r) => r.sourcing.find((s) => s.origMatId === ARTIFACT || s.matId === ARTIFACT);

console.log("\n=== Preconditions ===");
test("the fixture artifact really does have a token twin", () => {
  assert.ok(TOKEN, `no Crystallized token maps to ${ARTIFACT}`);
  assert.deepStrictEqual(getCraftMatCandidates(ARTIFACT), [ARTIFACT, TOKEN]);
});

console.log("\n=== Cheapest candidate wins ===");

test("a cheaper token replaces the artifact", () => {
  const r = row(market({ artifact: 500_000, token: 120_000 }));
  const line = artifactLine(r);
  assert.ok(line, "the artifact slot vanished from the sourcing");
  assert.strictEqual(line.matId, TOKEN, "expected the token to fill the slot");
  assert.strictEqual(line.origMatId, ARTIFACT, "the slot must remember the material it stands in for");
  assert.strictEqual(line.sourcing.perUnit, 120_000);
});

test("a cheaper artifact keeps the artifact", () => {
  const line = artifactLine(row(market({ artifact: 90_000, token: 500_000 })));
  assert.strictEqual(line.matId, ARTIFACT);
  assert.strictEqual(line.sourcing.perUnit, 90_000);
});

test("an equal price keeps the material's own id (own id wins ties)", () => {
  const line = artifactLine(row(market({ artifact: 200_000, token: 200_000 })));
  assert.strictEqual(line.matId, ARTIFACT);
});

test("no token listing at all → the artifact, unchanged", () => {
  const line = artifactLine(row(market({ artifact: 200_000, token: null })));
  assert.strictEqual(line.matId, ARTIFACT);
  assert.strictEqual(line.sourcing.perUnit, 200_000);
});

test("a non-artifact material is never substituted", () => {
  const r = row(market({ artifact: 90_000 }));
  const planks = r.sourcing.find((s) => s.matId === "T8_PLANKS");
  assert.ok(planks, "the plank line vanished");
  assert.ok(!planks.origMatId || planks.origMatId === "T8_PLANKS");
});

console.log("\n=== The substitute is still an artifact ===");

test("consumed in full — no craft RRR discount on the token", () => {
  const dear = row(market({ artifact: 500_000, token: 200_000 }));
  const cheap = row(market({ artifact: 500_000, token: 100_000 }));
  // 1x each, RRR-exempt: the whole 100,000 difference lands on the cost, times setup.
  const delta = dear.refineCraftCost - cheap.refineCraftCost;
  assert.ok(Math.abs(delta - 100_000 * (1 + 0.025)) < 1e-6,
    `expected a full-price delta of ${100_000 * 1.025}, got ${delta}`);
});

test("substituting does not change crafting fame (artifacts don't count)", () => {
  const a = row(market({ artifact: 500_000, token: 120_000 }));
  const b = row(market({ artifact: 90_000, token: 500_000 }));
  assert.strictEqual(a.journal.famePerCraft, b.journal.famePerCraft);
});

test("the cheaper slot lowers the row's cost and raises its profit", () => {
  const sub = row(market({ artifact: 500_000, token: 120_000 }));
  const noSub = row(market({ artifact: 500_000, token: null }));
  assert.ok(sub.refineCraftCost < noSub.refineCraftCost, "the substitute must be cheaper");
  assert.ok(sub.combinedProfit > noSub.combinedProfit, "and that must reach the profit column");
});

console.log("\n=== Availability ===");

test("an unpriced artifact with a priced token still builds a row", () => {
  const r = row(market({ artifact: null, token: 120_000 }));
  assert.ok(!r.noData, "the row should be craftable through the token");
  assert.strictEqual(artifactLine(r).matId, TOKEN);
});

test("neither priced → no-data row", () => {
  assert.ok(row(market({ artifact: null, token: null })).noData);
});

console.log("\n=== City force ===");

test("a dead forced buy city on the artifact kills the row, it does not fall back", () => {
  __setForce({ [ARTIFACT]: { buy: "Thetford" } });   // no Thetford listing
  const r = row(market({ artifact: 500_000, token: 120_000 }));
  assert.ok(r.noData, "a force means 'source it here', not 'source something else'");
});

test("a live force pins WHERE the artifact is bought, and it is used when it wins", () => {
  const md = market({ artifact: 500_000, token: 900_000 });
  md[ARTIFACT].Thetford = { buy_price: 400_000, volume_24h: 9999 };
  __setForce({ [ARTIFACT]: { buy: "Thetford" } });
  const line = artifactLine(row(md));
  assert.strictEqual(line.matId, ARTIFACT);
  assert.strictEqual(line.sourcing.city, "Thetford");
  assert.strictEqual(line.sourcing.perUnit, 400_000);
});

test("a live force does not shield a dearer artifact from a cheaper token", () => {
  // Matches render-crafting.js: the force says where to buy THAT id, it is not
  // a veto on the substitution. Only a DEAD force stops the row.
  const md = market({ artifact: 500_000, token: 120_000 });
  md[ARTIFACT].Thetford = { buy_price: 400_000, volume_24h: 9999 };
  __setForce({ [ARTIFACT]: { buy: "Thetford" } });
  assert.strictEqual(artifactLine(row(md)).matId, TOKEN);
});

console.log("\n=== Overrides ===");

test("a hand-typed token price is what the planner buys at", () => {
  __setOverrides({ [`${TOKEN}:${FS}`]: 50_000 });
  const line = artifactLine(row(market({ artifact: 500_000, token: 300_000 })));
  assert.strictEqual(line.matId, TOKEN);
  assert.strictEqual(line.sourcing.perUnit, 50_000);
});

test("an override anywhere on the winning substitute marks the row", () => {
  __setOverrides({ [`${TOKEN}:${FS}`]: 50_000 });
  assert.strictEqual(row(market({ artifact: 500_000, token: 300_000 })).hasOverride, true);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
