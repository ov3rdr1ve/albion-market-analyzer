/**
 * Shared sandbox harness for the Building Costs render tests.
 *
 * The browser loads every js/*.js file as a plain global; here the same sources
 * are stitched into one Module scope with stubbed price/override/localStorage
 * helpers and a renderTableData capture, so the row math and markup under test
 * are the real ones and nothing reaches a network or a database. The REAL
 * js/data-buildings.js catalog is loaded, so the shapes are the shipped ones.
 *
 * Split out of tests/buildings-render.test.cjs purely for file size (the repo
 * caps source files at 800 lines).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..", "..");
function loadFile(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

// Pull one function's real source out of a file by brace matching. Used for
// findBestBuyCity: the city the table prices an item at is exactly what the
// override bug was about, so a stubbed picker would test nothing.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0, i = src.indexOf("{", start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`${name}: unbalanced braces`);
}
const UTILS = (loadFile("js/utils.js") + loadFile("js/utils-item-ids.js") + loadFile("js/utils-overrides.js") + loadFile("js/utils-focus-fees.js"));

const sandbox = `
let testGold = 5000;                     // gold price → Global Discount factor
function __setGold(v) { testGold = v; }
function getGlobalDiscountFactor() { return Math.min(1, Math.max(0, testGold / 5000)); }
function applyGlobalDiscount(silver) { return silver * getGlobalDiscountFactor(); }

let testOverrides = {};
function __setOverrides(m) { testOverrides = m || {}; }
function getOverridePrice(id, city) { return testOverrides[id + ":" + city] ?? null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getOverrideField() { return null; }
function getOverrideVolume() { return null; }
function volumeAt() { return 9999; }              // volume never gates this table

// The city force the price editor writes next to an override. Every other table
// honours it; this one did not, which is why an edited price appeared to vanish.
let testForces = {};
function __setCityForce(m) { testForces = m || {}; }
function getCityForce(id, side) { return testForces[id + ":" + side] ?? null; }

function getItemDisplayName(id) { return id; }
function formatSilver(n) { return n === null || n === undefined ? "N/A" : Math.round(n).toLocaleString(); }
function tx(en) { return en; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return (row.building && row.building.id) || ""; }

// The real inline price-editor markup helper from js/app.js, so the assertions
// about click-to-edit prices exercise the same contract the app renders.
function matPriceSpan(matId, city, price) {
  const ov = getOverridePrice(matId, city) !== null;
  return \`<span class="price-editable mat-price-inline" data-item-id="\${matId}" data-city="\${city || ""}" \` +
    \`data-raw-price="\${price}" data-city-list="buy">@ \${formatSilver(price)} ea\${ov ? " ⚡" : ""}</span>\`;
}

// The laborer catalog the selector and the trophy line read. Only the fields
// this table touches; the Node tests do not load js/data-laborers.js.
const LABORERS = [
  { slug: "WOOD", name: "Lumberjack", contractSlug: "WOOD", modes: ["Resource"] },
  { slug: "STONE", name: "Stonecutter", contractSlug: "STONE", modes: ["Resource"] },
  { slug: "FISHING", name: "Fisherman", contractSlug: "FISHERMAN", modes: ["Resource"] },
  { slug: "MERCENARY", name: "Mercenary", contractSlug: "MERCENARY", modes: ["Mercenary"] },
  { slug: "WARRIOR", name: "Blacksmith", contractSlug: "WARRIOR", modes: ["Crafting"] },
];

// The table's laborer picker. Stubbed just far enough that the real selector
// IIFE runs against it, so the options it appends can be asserted.
let testLaborerSlug = "";
function __setLaborer(slug) { testLaborerSlug = slug || ""; }
const laborerSelect = {
  id: "buildings-laborer-select",
  get value() { return testLaborerSlug; },
  set value(v) { testLaborerSlug = v || ""; },
  options: [],
  dataset: {},
  appendChild(o) { this.options.push(o); },
  addEventListener() {},
};
// The pick is remembered across restarts, so the selector reads storage at init.
// Preloaded with a laborer here to prove the restore actually happens.
const __lsStore = { buildingsLaborer: "STONE" };
const localStorage = {
  getItem: (k) => (k in __lsStore ? __lsStore[k] : null),
  setItem: (k, v) => { __lsStore[k] = String(v); },
  removeItem: (k) => { delete __lsStore[k]; },
};
// The picker's change handler is delegated on the document, so the stub records
// listeners and __fireLaborerChange replays one — that path (not a listener bound
// to the element) is what the app now relies on.
const __docListeners = {};
const document = {
  readyState: "complete",
  createElement: () => ({}),
  getElementById: (id) => (id === "buildings-laborer-select" ? laborerSelect : null),
  addEventListener: (type, fn) => { (__docListeners[type] = __docListeners[type] || []).push(fn); },
};
function laborerSelectOptionCount() { return laborerSelect.options.length; }
function __fireLaborerChange(slug) {
  laborerSelect.value = slug || "";
  (__docListeners.change || []).forEach((fn) => fn({ target: laborerSelect }));
}
function __hasDelegatedChangeHandler() { return (__docListeners.change || []).length > 0; }

const captured = {};
function renderTableData(id, rows, fmt) {
  captured.tableId = id;
  captured.rows = rows;
  captured.fmt = fmt;
  captured.html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
`;

const mod = new Module("render-buildings-test");
mod._compile(
  sandbox +
    extractFn(UTILS, "findBestBuyCity") + "\n" +
    loadFile("js/data-buildings.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/buildings-upgrade-path.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/buildings-furnishing.js").replace(/if \(typeof module[\s\S]*$/, "") +
    loadFile("js/render-buildings.js").replace(/if \(typeof module[\s\S]*$/, "") +
    // Captured before the per-test reset wipes it: the selector restores the
    // stored pick while render-buildings.js is being evaluated, not later.
    "\nconst __restoredLaborer = laborerSelect.value;" +
    "\nmodule.exports = { renderBuildingsTable, buildBuildingRow, captured, BUILDINGS, " +
    "BUILDING_FAMILIES, getBuildingFurnitureByType, BUILDING_CONTRACT_SLUGS, " +
    "BUILDING_LABORER_FURNITURE, planFurnishing, getBuildingUpgradePath, " +
    "rollupUpgradeMaterials, __setGold, __setOverrides, __setLaborer, __setCityForce, " +
    "laborerSelectOptionCount, __restoredLaborer, __lsStore, BUILDINGS_LABORER_KEY, " +
    "__fireLaborerChange, __hasDelegatedChangeHandler, LABORERS, " +
    "_bldContract };",
  "render-buildings.js",
);
const { renderBuildingsTable, buildBuildingRow, captured, BUILDINGS, BUILDING_FAMILIES,
  getBuildingFurnitureByType, BUILDING_CONTRACT_SLUGS, BUILDING_LABORER_FURNITURE,
  planFurnishing, getBuildingUpgradePath, rollupUpgradeMaterials,
  __setGold, __setOverrides, __setLaborer, __setCityForce,
  laborerSelectOptionCount, __restoredLaborer, __lsStore, BUILDINGS_LABORER_KEY,
  __fireLaborerChange, __hasDelegatedChangeHandler, LABORERS,
  _bldContract } = mod.exports;

module.exports = { renderBuildingsTable, buildBuildingRow, captured, BUILDINGS, BUILDING_FAMILIES,
  getBuildingFurnitureByType, BUILDING_CONTRACT_SLUGS, BUILDING_LABORER_FURNITURE,
  planFurnishing, getBuildingUpgradePath, rollupUpgradeMaterials,
  __setGold, __setOverrides, __setLaborer, __setCityForce,
  laborerSelectOptionCount, __restoredLaborer, __lsStore, BUILDINGS_LABORER_KEY,
  __fireLaborerChange, __hasDelegatedChangeHandler, LABORERS, _bldContract };
