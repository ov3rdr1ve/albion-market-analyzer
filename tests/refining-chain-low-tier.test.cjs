/**
 * Test: the T2/T3 end of the refining ladder.
 *
 * The chain used to stop at T4 (`MIN_CHAIN_TIER = 4`), which meant a T2/T3
 * material could only ever be BOUGHT — the Crafting Planner's refine-vs-buy
 * comparison was dead for every low-tier craft (a T3 bag's cloth and leather).
 * T2/T3 refine in game, so they are modelled now, with one structural
 * difference the rest of the ladder never has: T2 is the bottom and consumes
 * its raw ALONE — there is no T1 refined product to be its secondary.
 *
 * Black-box over the real js/refining-chain-recipes.js + js/refining-chain-pricing.js:
 *   - recipe shape at T2 (no secondary) and T3 (secondary = T2 refined)
 *   - buildRefiningChain prices a secondary-less step without crashing
 *   - a T3 chain recurses into T2 when that is cheaper, and stops at market when
 *     the T2 bar is cheaper
 *   - chainSilverCostWithFocusAtTier walks a secondary-less node
 *   - getRefiningChainIds collects the low-tier leaves and never emits null
 *
 * Run: node tests/refining-chain-low-tier.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Same scaffolding shape as tests/refining-chain-pricing.test.cjs, with the
// T2/T3 tiers RESOURCE_DEFS really carries (js/data.js) left in.
const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const BASE_CITY_BONUS = 0.18;
const REFINE_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = {
  "Fort Sterling": "wood",
  Lymhurst: "fiber",
  Bridgewatch: "rock",
  Thetford: "ore",
  Martlock: "hide",
};
const MIN_RESOURCE_ENCHANT_TIER = 4;
const NON_ENCHANTABLE_REFINED_TYPES = new Set(["rock"]);
function refinedMaxEnchant(type, tier) {
  if (NON_ENCHANTABLE_REFINED_TYPES.has(type)) return 0;
  return tier >= MIN_RESOURCE_ENCHANT_TIER ? 4 : 0;
}
const RESOURCE_DEFS = [
  { type: "wood",  raw: "WOOD",  refined: "PLANKS",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type: "fiber", raw: "FIBER", refined: "CLOTH",
    tiers: [[2,"","",1],[3,"","",2],[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];

function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, resourceType, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === resourceType) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
function getFocusCost(itemId, tier) { return Math.round(30 * Math.pow(2, tier - 4)); }
// Station fee pinned to 0 so the assertions are pure input maths; the per-tier
// fee itself is covered by tests/refining-station-fee-enchant.test.cjs.
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("refining-chain-low-tier-test");
mod._compile(
  sandbox +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    "\nmodule.exports = { REFINING_RECIPES, MIN_CHAIN_TIER, getRefiningSourcing, " +
    "buildRefiningChain, chainSilverCostWithFocusAtTier, getRefiningChainIds, calcRRR, " +
    "BASE_CITY_BONUS, REFINE_SPEC_BONUS, SETUP_FEE };",
  "refining-chain-low-tier.js"
);
const {
  REFINING_RECIPES,
  MIN_CHAIN_TIER,
  getRefiningSourcing,
  buildRefiningChain,
  chainSilverCostWithFocusAtTier,
  getRefiningChainIds,
  calcRRR,
  BASE_CITY_BONUS,
  REFINE_SPEC_BONUS,
  SETUP_FEE,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy, sell_price: (e.buy || 0) + 1, volume_24h: 9999 };
  }
  return out;
}

const LY = "Lymhurst";        // fiber spec city
const FS = "Fort Sterling";   // wood spec city — non-spec for fiber
const NEAR = 1e-6;

// ── Catalogue shape ───────────────────────────────────────────────────────
console.log("\n=== Catalogue shape ===");

test("MIN_CHAIN_TIER is 2", () => {
  assert.strictEqual(MIN_CHAIN_TIER, 2);
});

test("T2 refines from raw alone; T3 takes the T2 refined product", () => {
  assert.strictEqual(REFINING_RECIPES.T2_CLOTH.secondaryMatId, null);
  assert.strictEqual(REFINING_RECIPES.T2_CLOTH.secondaryMatCount, 0);
  assert.strictEqual(REFINING_RECIPES.T2_CLOTH.rawRatio, 1);
  assert.strictEqual(REFINING_RECIPES.T3_CLOTH.secondaryMatId, "T2_CLOTH");
  assert.strictEqual(REFINING_RECIPES.T3_CLOTH.rawRatio, 2);
});

// ── T2: the secondary-less step ───────────────────────────────────────────
console.log("\n=== T2 refine (no secondary) ===");

test("buildRefiningChain('T2_CLOTH') prices with a single input line", () => {
  const md = priceMap([{ id: "T2_FIBER", city: FS, buy: 100 }]);
  const chain = buildRefiningChain("T2_CLOTH", md, FS, false, 0);
  assert.ok(chain, "expected a chain, got null");
  assert.strictEqual(chain.inputs.length, 1);
  assert.strictEqual(chain.inputs[0].matId, "T2_FIBER");
  assert.strictEqual(chain.inputs[0].count, 1);
  assert.strictEqual(chain.tier, 2);
});

test("T2 chain cost is raw x (1-rrr) x (1+setup) — nothing else in the basis", () => {
  const md = priceMap([{ id: "T2_FIBER", city: FS, buy: 100 }]);
  const chain = buildRefiningChain("T2_CLOTH", md, FS, false, 0);
  // Anchored at FS, but a fiber refine happens at LY's station either way
  // (getRefineCityFor), so the basis carries the fiber spec RRR.
  const rrr = calcRRR(BASE_CITY_BONUS + REFINE_SPEC_BONUS);
  const expected = 100 * 1 * (1 - rrr) * (1 + SETUP_FEE);
  assert.ok(Math.abs(chain.costPerOutput - expected) < NEAR,
    `expected ${expected}, got ${chain.costPerOutput}`);
});

test("the refine takes the spec city's RRR whichever city the caller anchors to", () => {
  const md = priceMap([
    { id: "T2_FIBER", city: FS, buy: 100 },
    { id: "T2_FIBER", city: LY, buy: 100 },
  ]);
  const fromFS = buildRefiningChain("T2_CLOTH", md, FS, false, 0);
  const fromLY = buildRefiningChain("T2_CLOTH", md, LY, false, 0);
  const specRrr = calcRRR(BASE_CITY_BONUS + REFINE_SPEC_BONUS);
  // A fiber refining station exists in every city but only Lymhurst's carries the
  // +40%, and hauling the cloth out is free — so anchoring elsewhere no longer
  // costs the bonus. See tests/refine-city-spec-pick.test.cjs.
  assert.strictEqual(fromFS.refineCity, LY);
  assert.strictEqual(fromLY.refineCity, LY);
  assert.strictEqual(fromFS.costPerOutput, fromLY.costPerOutput);
  assert.ok(Math.abs(fromLY.costPerOutput - 100 * (1 - specRrr) * (1 + SETUP_FEE)) < NEAR);
});

test("unpriced T2 raw kills the chain (caller falls back to market)", () => {
  const chain = buildRefiningChain("T2_CLOTH", priceMap([]), FS, false, 0);
  assert.strictEqual(chain, null);
});

test("chainSilverCostWithFocusAtTier walks a secondary-less node", () => {
  const md = priceMap([{ id: "T2_FIBER", city: FS, buy: 100 }]);
  const chain = buildRefiningChain("T2_CLOTH", md, FS, false, 0);
  const off = chainSilverCostWithFocusAtTier(chain, 0);   // focus nowhere
  const on = chainSilverCostWithFocusAtTier(chain, 2);    // focus at T2
  assert.ok(Math.abs(off - chain.costPerOutput) < NEAR);
  assert.ok(on < off, "focus at T2 must lower the cost");
});

// ── T3: recursion into T2 ─────────────────────────────────────────────────
console.log("\n=== T3 refine (secondary recurses) ===");

test("T3 buys its T2 bar when the bar is cheaper than refining one", () => {
  const md = priceMap([
    { id: "T3_FIBER", city: FS, buy: 200 },
    { id: "T2_CLOTH", city: FS, buy: 10 },   // dirt cheap bar
    { id: "T2_FIBER", city: FS, buy: 500 },  // refining it would cost far more
  ]);
  const chain = buildRefiningChain("T3_CLOTH", md, FS, false, 0);
  assert.strictEqual(chain.inputs.length, 2);
  assert.strictEqual(chain.inputs[1].matId, "T2_CLOTH");
  assert.strictEqual(chain.inputs[1].sourcing.source, "market");
});

test("T3 refines its own T2 secondary when that is cheaper", () => {
  const md = priceMap([
    { id: "T3_FIBER", city: FS, buy: 200 },
    { id: "T2_CLOTH", city: FS, buy: 5000 }, // absurd bar price
    { id: "T2_FIBER", city: FS, buy: 100 },
  ]);
  const chain = buildRefiningChain("T3_CLOTH", md, FS, false, 0);
  assert.strictEqual(chain.inputs[1].sourcing.source, "chain");
  assert.strictEqual(chain.inputs[1].sourcing.chain.tier, 2);
  assert.strictEqual(chain.inputs[1].sourcing.chain.inputs.length, 1);
});

test("a T3 chain still prices when only the T2 RAW is listed", () => {
  const md = priceMap([
    { id: "T3_FIBER", city: FS, buy: 200 },
    { id: "T2_FIBER", city: FS, buy: 100 },
  ]);
  const chain = buildRefiningChain("T3_CLOTH", md, FS, false, 0);
  assert.ok(chain, "an unlisted T2 bar must not kill the T3 chain");
  assert.strictEqual(chain.inputs[1].sourcing.source, "chain");
});

test("getRefiningSourcing picks the chain over an expensive T3 bar", () => {
  const md = priceMap([
    { id: "T3_CLOTH", city: FS, buy: 9000 },
    { id: "T3_FIBER", city: FS, buy: 200 },
    { id: "T2_CLOTH", city: FS, buy: 100 },
  ]);
  const r = getRefiningSourcing("T3_CLOTH", md, FS, false, 0);
  assert.strictEqual(r.source, "chain");
  assert.ok(r.perUnit < 9000);
});

test("getRefiningSourcing keeps the market bar when refining costs more", () => {
  const md = priceMap([
    { id: "T3_CLOTH", city: FS, buy: 50 },
    { id: "T3_FIBER", city: FS, buy: 900 },
    { id: "T2_CLOTH", city: FS, buy: 900 },
  ]);
  const r = getRefiningSourcing("T3_CLOTH", md, FS, false, 0);
  assert.strictEqual(r.source, "market");
  assert.strictEqual(r.perUnit, 50);
});

test("T4 can now recurse all the way down to T2", () => {
  const md = priceMap([
    { id: "T4_WOOD", city: FS, buy: 300 },
    { id: "T3_PLANKS", city: FS, buy: 9000 },
    { id: "T3_WOOD", city: FS, buy: 200 },
    { id: "T2_PLANKS", city: FS, buy: 9000 },
    { id: "T2_WOOD", city: FS, buy: 100 },
  ]);
  const chain = buildRefiningChain("T4_PLANKS", md, FS, false, 0);
  const t3 = chain.inputs[1].sourcing.chain;
  assert.strictEqual(t3.tier, 3);
  const t2 = t3.inputs[1].sourcing.chain;
  assert.strictEqual(t2.tier, 2);
  assert.strictEqual(t2.inputs.length, 1);
});

// ── Scan ids ──────────────────────────────────────────────────────────────
console.log("\n=== Scan ids ===");

test("getRefiningChainIds('T3_CLOTH') collects the whole low-tier ladder", () => {
  const ids = getRefiningChainIds("T3_CLOTH");
  assert.ok(ids.has("T3_FIBER"));
  assert.ok(ids.has("T2_CLOTH"));
  assert.ok(ids.has("T2_FIBER"));
});

// T1_FACTION_*_TOKEN_1 is a faction heart, not a resource — those are legal and
// expected on T4+ roots. What must never appear is a T1 RESOURCE id.
test("getRefiningChainIds never emits null or a T1 resource id", () => {
  for (const root of ["T2_CLOTH", "T3_CLOTH", "T8_PLANKS"]) {
    const ids = [...getRefiningChainIds(root)];
    assert.ok(!ids.includes(null), `${root} leaked a null id`);
    assert.ok(!ids.includes(undefined), `${root} leaked an undefined id`);
    const t1res = ids.filter((i) => /^T1_(WOOD|ORE|HIDE|FIBER|ROCK|PLANKS|METALBAR|LEATHER|CLOTH|STONEBLOCK)$/.test(i));
    assert.deepStrictEqual(t1res, [], `${root} leaked a T1 resource id`);
  }
});

test("a T2/T3 root asks for no faction heart — the token swap is T4 and above", () => {
  for (const root of ["T2_CLOTH", "T3_CLOTH"]) {
    const hearts = [...getRefiningChainIds(root)].filter((i) => /_FACTION_/.test(i));
    assert.deepStrictEqual(hearts, [], `${root} pulled a heart price nothing can spend`);
  }
});

test("a T2 root asks only for its own raw", () => {
  assert.deepStrictEqual([...getRefiningChainIds("T2_CLOTH")], ["T2_FIBER"]);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
