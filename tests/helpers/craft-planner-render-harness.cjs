/**
 * Shared sandbox harness for the craft-planner render tests.
 *
 * The browser loads every js/*.js file as a plain global; here the same sources
 * are stitched into one Module scope with stubbed market/price/spec helpers and a
 * renderTableData capture, so the render path under test is the real one while
 * nothing reaches a network or a database.
 *
 * Split out of tests/craft-planner-render.test.cjs purely for file size (the repo
 * caps source files at 800 lines). The stubs are deliberately loose — the point
 * is that the REAL pricing, chain and journal modules resolve every global they
 * reach for, on a catalogue small enough to reason about.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
// A localStorage stand-in so the House Tier preference (js/house-tier.js) can be
// driven from a test. Every other module reads it as an EMPTY store, which is
// exactly what they saw when the symbol was absent.
let __store = {};
const localStorage = {
  getItem: (k) => (k in __store ? __store[k] : null),
  setItem: (k, v) => { __store[k] = String(v); },
  removeItem: (k) => { delete __store[k]; },
};
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

// Two-item catalogue: a furniture table (TOOLMAKER journal) and plate armor
// (WARRIOR journal). A no-data item (unpriced) exercises the placeholder row.
const CRAFTING_ITEMS = [
  { id:"T8_FURNITUREITEM_TABLE", name:"Elder's Table", matId:"T8_PLANKS", matCount:30, craftType:null,
    materials:[{ matId:"T8_PLANKS", count:30 }] },
  { id:"T8_ARMOR_PLATE_SET1", name:"Soldier Armor", matId:"T8_METALBAR", matCount:16, craftType:"plate_armor",
    materials:[{ matId:"T8_METALBAR", count:16 }] },
  { id:"T8_2H_HOLYSTAFF", name:"Great Holy Staff", matId:"T8_PLANKS", matCount:20, craftType:"holystaff",
    materials:[{ matId:"T8_PLANKS", count:20 }] }, // left unpriced → no-data row
];

let expandedCraftItems = new Set();
function isBlackRedZoneEnabled() { return false; }
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
// Per-quality sell reader for the Reroll EV column — mirrors js/utils.js
// getQualitySellPrice's data path under "market" order (asks), with the same
// missing-cell → 0 contract. The map is mutable so a test can fill qualities.
let lastQualityMarketData = {};
function getOrderType() { return "market"; }
function getQualitySellPrice(qualityData, itemId, quality, city) {
  if (city === "Black Market") return 0;
  const data = qualityData?.[itemId]?.[quality]?.[city];
  return (data && (data.sell_price || data.buy_price)) || 0;
}
// Sell-city pins and zone reachability. Both default to "nothing pinned,
// everything reachable" so existing expectations are unchanged; the sell-pin
// tests install a pin and the real cross-route rule.
let testCityForce = {}, testCrossRoute = () => false;
function getCityForce(itemId, side) { return testCityForce[itemId]?.[side] ?? null; }
function isInvalidCrossRoute(buyCity, sellCity) { return testCrossRoute(buyCity, sellCity); }
function __setForce(m) { testCityForce = m || {}; }
function __setCrossRoute(fn) { testCrossRoute = fn || (() => false); }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getRefineRRR(city, t, f) { let b=BASE_CITY_BONUS; if (CITY_REFINE_SPEC[city]===t) b+=REFINE_SPEC_BONUS; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
// Craft spec defaults to 0; raising it shrinks what focusing the craft buys,
// which is the configuration where focusing a refine step wins instead.
let testCraftSpec = 0;
function __setCraftSpec(v) { testCraftSpec = v || 0; }
function getCraftRRR(city, ct, f) { let b=BASE_CITY_BONUS+testCraftSpec; if (f) b+=FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return 24; }          // cheap refine focus (max-spec-like)
function getCraftFocusCost() { return 8000; }   // expensive craft focus (furniture-like)
let testFocus = false;
function isFocusEnabled() { return testFocus; }
function __setFocus(v) { testFocus = !!v; }
function calcStationFeeSilver() { return 0; }
function refineStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1],10) : 4; }

// Render-layer helpers (borrowed from render-crafting.js + app.js in prod).
function getSpecCraftCity() { return null; }
function getNoSpecLabel() { return ""; }
function getCraftCandidates(specCity, bmrOn) { return ["Fort Sterling", "Caerleon"]; }
function getCraftingMaterials(item) { return item.materials || [{ matId: item.matId, count: item.matCount }]; }
function formatSilver(n) { if (n==null) return "N/A"; return Math.round(n).toLocaleString(); }
// Mirror the real getItemDisplayName's contract: its first line calls
// id.match(...), so passing undefined/null throws a TypeError — exactly the
// crash that blanked planner rows when the note named a craft-kind global's
// (absent) matId. Returns the id for strings so existing assertions still match.
function getItemDisplayName(id) { id.match(/$/); return id; }
function getProfitClass() { return "profit-low"; }
function brecilienFeeBadge() { return ""; }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='"+id+"'>@ "+(price>0?price:"no data")+" ea</span>"; }
// Read-only aggregate cost cell — a faithful mirror of js/app.js aggregateCostTd:
// an em dash when the figure is missing or not positive, otherwise the
// formatSilver'd number with the "this is a sum, edit a material" tooltip.
// (Was a lossy raw-number print, which made the rendered format unassertable.)
function aggregateCostTd(cost, cls) {
  const n = Number(cost);
  const klass = cls || "silver-val cell-num";
  if (!isFinite(n) || n <= 0) return '<td class="' + klass + '" style="color:#6b7280;font-style:italic">—</td>';
  return '<td class="' + klass + '" title="' + tx("Materials above plus fees. To change it, edit a material price in the Materials column.", "r_tip_aggregate_cost") + '">' + formatSilver(n) + '</td>';
}
// The 9th arg (note) is the under-the-number line js/app.js renders inside the
// cell — the planner uses it for a dropped sell pin. The 7th (quality) becomes
// data-quality exactly as js/app.js priceTd emits it (any non-null quality), so
// the price editor would open that quality's book.
function priceTd(p, itemId, city, side, extraClass, showCity, quality, sideOverride, note) { return '<td class="silver-val price-editable" data-item-id="'+(itemId||'')+'" data-city="'+(city||'')+'" data-city-list="'+(side||'sell')+'"'+(quality!=null?' data-quality="'+quality+'"':'')+'>'+(p>0?p:'no data — click to set')+(note||'')+'</td>'; }
function volTd(v) { return "<td class='vol'>"+v+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return (row.item && row.item.id || "") + "|" + (row.craftCity||"") + "|" + (row.section||""); }
const captured = {};
function renderTableData(id, rows, fmt) { captured.tableId = id; captured.rows = rows; captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
`;

// autocrlf checkouts read CRLF; normalize so the `\n}\n` lift below matches.
function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n"); }
// The craft focus step shares marginalSilverPerFocus with the Crafting table's
// Silver/Focus column. Lift the real definition out of refining-route.js rather
// than the rest of that file, which the planner does not need.
const MARGINAL_SPF_SRC = (() => {
  const m = loadFile("js/refining-route.js").match(/function marginalSilverPerFocus\([\s\S]*?\n}\n/);
  if (!m) throw new Error("marginalSilverPerFocus not found in js/refining-route.js");
  return m[0];
})();
// i18n globals live in js/i18n.js in the browser; passthrough stubs here so
// English (default) expectations are unchanged.
globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
const mod = new Module("craft-planner-render-test");
mod._compile(
  sandbox +
    MARGINAL_SPF_SRC +
    // The per-table City pick (js/table-sell-city.js). Nothing picked = today's
    // behaviour, so the existing row expectations are untouched.
    loadFile("js/table-sell-city.js") +
    // The Route column's click-to-override city names. Loaded for real rather
    // than stubbed: the whole point of the assertions on it is the markup.
    loadFile("js/route-cell.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/refining-chain-recipes.js") +
    loadFile("js/refining-chain-pricing.js") +
    loadFile("js/refining-chain-focus.js") +
    // The planner opts its chains into the raw-transmute substitution
    // (CP_CHAIN_OPTS), so the render path has to see the real fee tables.
    loadFile("js/data-transmute.js") +
    loadFile("js/refining-transmute-substitute.js") +
    loadFile("js/data-craft-journal-fame.js") +
    loadFile("js/data-craft-planner.js") +
    loadFile("js/data-laborers.js") +
    // The planner hides furniture the stored house cannot hold.
    loadFile("js/house-tier.js") +
    loadFile("js/laborers-pricing.js") +
    loadFile("js/render-laborers.js") +
    loadFile("js/laborer-journal-value.js") +
    // The buy-@(n-1)-and-enchant-up acquisition route priced on .1-.3 rows.
    loadFile("js/data-enchanting.js") +
    loadFile("js/fragment-transmute-sourcing.js") +
    loadFile("js/craft-planner-enchant-route.js") +
    // The Reroll EV sell-side column (data first: the module reads its tables
    // at call time, but the sources must be in the scope before it runs).
    loadFile("js/data-rerolling.js") +
    loadFile("js/craft-planner-reroll-ev.js") +
    // Quality-map readers (pricing side) + the Sell-cell quality note builders
    // (render side), which _cpPaintRows calls for every row.
    loadFile("js/craft-planner-quality.js") +
    loadFile("js/craft-planner-pricing.js") +
    // The one-row-per-item decision (dedupeCraftPlannerRows + alt summaries).
    loadFile("js/craft-planner-dedupe.js") +
    // The "best path" line printed under every material in the Materials cell.
    loadFile("js/render-chain-breakdown.js") +
    loadFile("js/render-craft-planner-paths.js") +
    loadFile("js/render-craft-planner.js") +
    "\nmodule.exports = { setTableSellCity, clearTableSellCities, renderCraftPlannerTable, captured, _cpFocusCell, _cpMatLine, _cpJumpToRefine, __setFocus, __setCraftSpec, getCraftJournalFill, _cpBestSell, expandCraftPlannerItems, _cpNameTd, setHouseTier, __setForce, __setCrossRoute, __expand: (id) => expandedCraftItems.add(id), __collapseAll: () => expandedCraftItems.clear(), _cpEnchantViaCell, cpEnchantPathLine, rerollEvCell, computeRerollEvUplift, __setQualityMap: (m) => { lastQualityMarketData = m || {}; } };",
  "render-craft-planner.js"
);
const { setTableSellCity, clearTableSellCities, renderCraftPlannerTable, captured, _cpFocusCell, _cpMatLine, _cpJumpToRefine, __setFocus, __setCraftSpec, getCraftJournalFill, _cpBestSell, expandCraftPlannerItems, _cpNameTd, setHouseTier, __setForce, __setCrossRoute, __expand, __collapseAll, _cpEnchantViaCell, cpEnchantPathLine, rerollEvCell, computeRerollEvUplift, __setQualityMap } = mod.exports;

module.exports = { setTableSellCity, clearTableSellCities, renderCraftPlannerTable, captured, _cpFocusCell, _cpMatLine, _cpJumpToRefine, __setFocus, __setCraftSpec, getCraftJournalFill, _cpBestSell, expandCraftPlannerItems, _cpNameTd, setHouseTier, __setForce, __setCrossRoute, __expand, __collapseAll, _cpEnchantViaCell, cpEnchantPathLine, rerollEvCell, computeRerollEvUplift, __setQualityMap };
