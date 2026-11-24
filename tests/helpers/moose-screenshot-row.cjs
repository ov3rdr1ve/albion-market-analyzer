/**
 * The user's Moose [T6] breeding row, priced by the REAL mounts renderer from
 * the prices in his 1,440-moose Crafting List screenshot, plus the real
 * Crafting List extractor and per-10k patcher compiled into the same scope.
 * Shared by tests/breeding-per10k-moose-screenshot.test.cjs and the full
 * list render in tests/craft-list-self-found-per10k-focus.test.cjs.
 */
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "..", "js", f), "utf8");
const strip = (src) => src.replace(/if \(typeof module !== "undefined"[\s\S]*$/, "");

const stubs = `
const _els = { "use-focus": { checked: false }, "premium-account": { checked: true } };
// One-column thead: the list's per-10k patcher finds its cell by data-sort.
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null,
  querySelectorAll: () => [{ getAttribute: () => "profitPer10kFocus" }] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function matPriceSpan(id, c, p){ return "<span>"+p+"</span>"; }
function getProfitClass(){ return ""; }
function tx(enText, slug){ return enText; }
function dispName(id, fallbackName){ return fallbackName; }
function addTdForKey(){ return "<td></td>"; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], CONSUMABLES = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const sources =
  J("focus-play.js") + J("data-faction-fp-costs.js") + J("focus-costs.js") +
  J("data-mounts.js") + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") + J("mp-bonus.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) + J("sorting-row-key.js") +
  J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js") +
  J("render-mounts-craft-row.js") +
  strip(J("faction-focus-value.js")) +
  strip(J("render-faction-spending.js")) +
  strip(J("craft-list-extractors.js")) + strip(J("craft-list-extractors-faction.js")) +
  strip(J("craft-list-per10k.js"));

const mod = new Module("breeding-per10k-moose-screenshot");
mod._compile(
  stubs + sources + `
module.exports = { tableState, renderMountsTable, _els, setCityForce,
  CRAFT_LIST_EXTRACTORS: typeof CRAFT_LIST_EXTRACTORS !== "undefined" ? CRAFT_LIST_EXTRACTORS : null,
  extractCraftListRow: typeof extractCraftListRow === "function" ? extractCraftListRow : null,
  clTwinProfits, patchPer10kCell, combinedPer10k,
  getBreedDataByBaby: typeof getBreedDataByBaby === "function" ? getBreedDataByBaby : null,
  fees: () => ({ setup: SETUP_FEE, tax: PREMIUM_TAX }) };`,
  "breeding-per10k-moose-screenshot.js",
);
const X = mod.exports;

const priced = (b, sl, v) => ({ buy_price: b, sell_price: sl, volume_24h: v });
const BABY = "T6_FARM_GIANTSTAG_MOOSE_BABY";
const MD = {
  [BABY]: { Thetford: priced(233619, 240000, 500) },
  T2_BEAN: { Thetford: priced(374, 400, 50000) },
  T6_LEATHER: { Thetford: priced(4602, 4800, 50000) },
  T6_MOUNT_GIANTSTAG_MOOSE: { Brecilien: priced(529993, 529993, 903) },
};

X._els["use-focus"].checked = false; // the screenshot's Profit has no offspring in it
X.renderMountsTable(MD);
const row = X.tableState["mounts-table"].data
  .find((r) => r.isBreeding && r.item && r.item.babyId === BABY && r.buyMat && r.buyMat.price > 0);

module.exports = { X, row, BABY, MD };
