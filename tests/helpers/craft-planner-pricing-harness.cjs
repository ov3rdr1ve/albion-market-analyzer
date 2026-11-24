/**
 * Shared sandbox harness for the craft-planner pricing tests.
 *
 * computeCraftPlannerRow reaches for a long list of browser globals (prices,
 * overrides, city forces, RRR, focus, station fees). They are stubbed here so
 * the REAL pricing, refining-chain and laborer-journal modules run against a
 * catalogue small enough to reason about, with no network and no database.
 *
 * Split out of tests/craft-planner-pricing.test.cjs purely for file size (the
 * repo caps source files at 800 lines).
 */
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
const CRAFT_SPEC_BONUS = 0.40;
const FOCUS_BONUS = 0.59;
const CITY_REFINE_SPEC = { "Fort Sterling":"wood", Lymhurst:"fiber", Bridgewatch:"rock", Thetford:"ore", Martlock:"hide" };
const RESOURCE_DEFS = [
  { type:"wood", raw:"WOOD", refined:"PLANKS",    tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"ore",  raw:"ORE",  refined:"METALBAR",  tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"hide", raw:"HIDE", refined:"LEATHER",   tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"fiber",raw:"FIBER",refined:"CLOTH",     tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
  { type:"rock", raw:"ROCK", refined:"STONEBLOCK",tiers:[[4,"","",2],[5,"","",3],[6,"","",4],[7,"","",5],[8,"","",5]] },
];

let testBmrEnabled = false, testCityForce = {}, testOverrides = {}, testFocusOn = false;
function isBlackRedZoneEnabled() { return testBmrEnabled; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function isFocusEnabled() { return testFocusOn; }
function getOverridePrice(itemId, city) { return testOverrides[itemId + ":" + city] ?? null; }
// Mirrors js/utils.js qualityOverrideKey: a per-quality override lives under
// "<id>#Q<n>", so __setOverrides({"<id>#Q4:<city>": v}) is a quality-4 edit.
function qualityOverrideKey(itemId, quality) { return quality == null ? itemId : itemId + "#Q" + quality; }
let testVolOverrides = {};
function getOverrideVolume(itemId, city) { return testVolOverrides[itemId + ":" + city] ?? null; }
function __setVolumeOverrides(m){ testVolOverrides = m || {}; }
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
function getRefineRRR(city, resourceType, useFocus) {
  let bonus = BASE_CITY_BONUS;
  if (CITY_REFINE_SPEC[city] === resourceType) bonus += REFINE_SPEC_BONUS;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
// Craft spec defaults to 0 → deterministic base RRR. __setCraftSpec raises it,
// which SHRINKS what focusing the craft buys (focus adds a fixed +59 to an
// already-large bonus), and that is the configuration where focusing a refine
// step instead can leave the end product more profitable.
let testCraftSpec = 0;
function getCraftRRR(city, craftType, useFocus) {
  let bonus = BASE_CITY_BONUS + testCraftSpec;
  if (useFocus) bonus += FOCUS_BONUS;
  return calcRRR(bonus);
}
// Realistic-shaped focus costs: refining is CHEAP per focus (max-spec ~tens),
// crafting (esp. furniture) is EXPENSIVE — this is what makes spending focus on a
// refine sometimes beat spending it on the craft (silver saved per focus).
function getFocusCost(itemId, tier) { return 24; }
let testCraftFocus = 8000;
function getCraftFocusCost(itemId, tier) { return testCraftFocus; }
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1],10) : 4; }
// Zone reachability. Defaults to "everything reaches everything" so the pricing
// tests can quote any sell city; __setCrossRoute installs the real rule (the
// Black Market is only sellable from Caerleon, royal<->Caerleon needs BMR) for
// the tests that are ABOUT reachability.
let testCrossRoute = () => false;
function isInvalidCrossRoute(buyCity, sellCity) { return testCrossRoute(buyCity, sellCity); }
function __setCrossRoute(fn) { testCrossRoute = fn || (() => false); }
let testStationFee = 0;
function calcStationFeeSilver() { return testStationFee; }
function refineStationFeeSilver() { return testStationFee; }
// The quality-keyed book the renderer holds as the global lastQualityMarketData
// (js/app.js, filled by a full-market scan): map[itemId][quality][city] ->
// {buy_price, sell_price}. The planner reads it typeof-guarded, the same way it
// reads the other optional collaborators; tests inject it here exactly as the
// renderer would hold it.
let lastQualityMarketData = {};
function __setQualityMarketData(m) { lastQualityMarketData = m || {}; }
function __setBMR(v){ testBmrEnabled=!!v; }
function __setOverrides(m){ testOverrides=m||{}; }
function __setForce(m){ testCityForce=m||{}; }
function __setStationFee(v){ testStationFee=v||0; }
function __setFocus(v){ testFocusOn=!!v; }
function __setCraftFocus(v){ testCraftFocus = v; }
function __setCraftSpec(v){ testCraftSpec = v || 0; }
function __reset(){ __setVolumeOverrides({}); __setBMR(false); __setOverrides({}); __setForce({}); __setStationFee(0); __setFocus(false); __setCraftFocus(8000); __setCraftSpec(0); __setCrossRoute(null); __setQualityMarketData({}); clearTableSellCities(); }
`;

function loadFile(rel) {
  // git's autocrlf checks the tree out with CRLF; normalize so the
  // `\n}\n`-style source lifts below match on any checkout.
  return fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
}

// The craft focus step is valued with the SAME marginalSilverPerFocus the
// Crafting table's Silver/Focus column uses. Lift the real definition out of
// refining-route.js (whose other globals the planner does not need) rather than
// hand-copying it, so a change there cannot silently drift from what is asserted.
const MARGINAL_SPF_SRC = (() => {
  const src = loadFile("js/refining-route.js");
  const m = src.match(/function marginalSilverPerFocus\([\s\S]*?\n}\n/);
  if (!m) throw new Error("marginalSilverPerFocus not found in js/refining-route.js");
  return m[0];
})();

// The bar arithmetic behind Profit / 10k Focus, lifted from calculations.js for
// the same reason: the planner's figure must be the one every table uses.
const FOCUS_BAR_SRC = (() => {
  const src = (loadFile("js/calculations.js") + loadFile("js/calculations-margins.js"));
  const parts = [
    /const FOCUS_BAR = \d+;\n/,
    /function focusBarCrafts\([\s\S]*?\n}\n/,
    /function calculateProfitPer10kFocus\([\s\S]*?\n}\n/,
    /function formatBarCrafts\([\s\S]*?\n}\n/,
  ].map((re) => {
    const m = src.match(re);
    if (!m) throw new Error(`${re} not found in js/calculations.js`);
    return m[0];
  });
  return parts.join("");
})();

// The volume the Sell cell prints, lifted from utils.js (override first).
const CITY_VOL_SRC = (() => {
  const m = (loadFile("js/utils.js") + loadFile("js/utils-item-ids.js") + loadFile("js/utils-overrides.js") + loadFile("js/utils-focus-fees.js")).match(/function getCityVol\([\s\S]*?\n}\n/);
  if (!m) throw new Error("getCityVol not found in js/utils.js");
  return m[0];
})();

const mod = new Module("craft-planner-pricing-test");
mod._compile(
  sandbox +
    MARGINAL_SPF_SRC +
    FOCUS_BAR_SRC +
    CITY_VOL_SRC +
    // The per-table City pick: with nothing picked its effectiveSellCities is
    // exactly the old "pin ?? every city" rule, so every existing expectation
    // is unchanged and the filter tests can drive the real helper.
    loadFile("js/table-sell-city.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-chain-focus.js") +
    loadFile("js/data-craft-journal-fame.js") +
    loadFile("js/data-craft-planner.js") +
    // Laborer-fed journal value (the "work the journal" alternative to selling
    // it) — the planner row prices both plays.
    loadFile("js/data-laborers.js") +
    loadFile("js/laborers-pricing.js") +
    loadFile("js/render-laborers.js") +
    loadFile("js/laborer-journal-value.js") +
    // Enchant-slot helpers + the buy-the-@(n-1)-and-enchant-up acquisition route
    // the planner prices as an alternative to crafting from enchanted resources.
    loadFile("js/data-enchanting.js") +
    // Its rune/soul/relic leg may be transmuted up from a cheaper node.
    loadFile("js/data-transmute.js") +
    loadFile("js/fragment-transmute-sourcing.js") +
    loadFile("js/craft-planner-enchant-route.js") +
    // Quality-map readers the sell loop and the no-sell rows call at runtime
    // (lastQualityMarketData is typeof-guarded inside them).
    loadFile("js/craft-planner-quality.js") +
    loadFile("js/craft-planner-pricing.js") +
    "\nmodule.exports = { computeCraftPlannerRow, getCraftJournalFill, " +
    "getRefineFocusValue, getRefineSellFocus, computeCraftPlannerGlobalFocus, " +
    "computeEnchantAcquisition, ENCHANT_TRANSITIONS, getEquipmentSlot, TRANSMUTE_SILVER_COST, " +
    "getEnchantMatCount, getEnchantedItemId, getEnchantMatId, " +
    // Read-only helpers so a test can re-derive what the row priced: the RRR it
    // should have used, and the focused cost of one ladder at one tier.
    "getCraftRRR, getRefineRRR, _chainCostWithFocusAtTier, refinesPerOutputAtTier, " +
    "findCheapestMarketBuyForRefine, " +
    "setTableSellCity, getTableSellCity, sellCityFilterChanged, clearTableSellCities, " +
    "effectiveSellCities, sellPinOverriddenByFilter, sellCityOptionsFor, tableRepricesOnCityPick, " +
    "buyCityOptionsFor, setTableBuyCity, getTableBuyCity, buyCityFilterChanged, effectiveFlipCities, "
    + "effectiveBuyCities, " +
    "__setBMR, __setOverrides, __setForce, __setStationFee, __setFocus, __setCraftFocus, " +
    "__setCraftSpec, __setCrossRoute, __setVolumeOverrides, __setQualityMarketData, __reset };",
  "craft-planner-pricing.js"
);
const M = mod.exports;
module.exports = M;
