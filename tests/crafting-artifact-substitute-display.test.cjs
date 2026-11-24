/**
 * Test: artifact MELDING is not a Crafting-table row, and a Crystallized-token
 * substitution is visible on the rows that do use an artifact.
 *
 * 1. Catalog — every artifact carries a 50-fragment craftingrequirements block
 *    in items.xml, but none of it is gear-station work: a Rune/Soul/Relic/
 *    Avalonian block is the MELD recipe (the Artifact Foundry returns a RANDOM
 *    artifact of that fragment type/class, priced by the Artifact Rolling
 *    table), and a Crystal/Dragon block is an Energy Manipulator exchange
 *    (js/data-energy-exchange.js). Either way GEAR_RECIPES must contain no
 *    T{n}_ARTEFACT_* item of its own.
 *
 * 2. Display — the artifact slot of a gear craft also accepts a Crystallized
 *    token of the same tier, and the router already buys whichever is cheaper.
 *    The material line must NAME the item actually bought (and hang the price
 *    override on it), otherwise a token-sourced craft reads as if it bought the
 *    artifact and the substitution is invisible.
 *
 * UI-first (TLD): renders the REAL renderCraftingTable through a captured
 * renderTableData and asserts the emitted cells.
 *
 * Run: node tests/crafting-artifact-substitute-display.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function loadFile(rel) { return fs.readFileSync(path.join(__dirname, "..", rel), "utf8"); }

// ── 1. Catalog: no artifact material is a Crafting-table row ───────────────
console.log("\n=== GEAR_RECIPES excludes artifact melds and exchanges ===");

const GEAR_FILES = [
  "gear-cloth-armor.js", "gear-leather-armor.js", "gear-leather-dragon.js", "gear-plate-armor.js",
  "gear-melee-light.js", "gear-melee-heavy.js", "gear-ranged.js",
  "gear-staves-a.js", "gear-staves-b.js", "gear-staves-c.js",
  "gear-offhand.js", "gear-capes.js", "gear-tools.js", "gear-gatherer.js",
  "gear-crystal-weapons.js", "gear-crystal-weapons-b.js", "gear.js",
];
const gearMod = new Module("gear-catalog-test");
gearMod._compile(
  loadFile("js/data-artifacts.js") +
    GEAR_FILES.map((f) => loadFile("js/" + f)).join("\n") +
    "\nmodule.exports = { GEAR_RECIPES, ARTIFACT_MAPPING };",
  "gear-catalog.js",
);
const { GEAR_RECIPES, ARTIFACT_MAPPING } = gearMod.exports;

test("no GEAR_RECIPES entry produces an artifact material", () => {
  const bad = GEAR_RECIPES.filter((i) => /^T\d+_ARTEFACT_/.test(i.id));
  assert.strictEqual(bad.length, 0,
    `melding rows leaked into the Crafting table: ${bad.slice(0, 5).map((i) => i.id).join(", ")}`);
});

test("no GEAR_RECIPES entry is grouped as an artifact craft", () => {
  const bad = GEAR_RECIPES.filter((i) => i.group === "artifact-craft" || i.craftType === "artifact");
  assert.strictEqual(bad.length, 0, `found ${bad.length} artifact-craft rows`);
});

test("crystal GEAR that CONSUMES an artifact still ships", () => {
  const crystalGear = GEAR_RECIPES.filter((i) =>
    (i.materials || []).some((m) => /^T\d+_ARTEFACT_.*_CRYSTAL$/.test(m.matId)));
  assert.ok(crystalGear.length > 0, "crystal weapon crafts must stay in the Crafting table");
});

test("crystal artifacts stay in ARTIFACT_MAPPING for the exchange catalog", () => {
  const crystal = Object.values(ARTIFACT_MAPPING).filter((a) => a.tier === "Crystal");
  assert.ok(crystal.length >= 15, `expected the crystal artifact lines, got ${crystal.length}`);
});

// ── 2. Render: the substituted material names itself ──────────────────────
const ARTIFACT = "T4_ARTEFACT_MAIN_CURSEDSTAFF_UNDEAD"; // Rune tier -> TOKEN_FAVOR_1
const TOKEN = "T4_ARTEFACT_TOKEN_FAVOR_1";

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = CITIES;
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;
const BASE_CITY_BONUS = 0.18;
const CRAFT_SPEC_BONUS = 0.15;
const FOCUS_BONUS = 0.59;
const CITY_CRAFT_SPEC = {};

// One artifact craft (curse staff) — the artifact slot accepts a Crystallized
// Spirit, so the row should buy whichever of the two is cheaper.
const CRAFTING_ITEMS = [
  { id:"T4_MAIN_CURSEDSTAFF_UNDEAD", name:"Lifecurse Staff", craftType:"cursestaff",
    materials:[{ matId:"T4_PLANKS", count:8 }, { matId:"${ARTIFACT}", count:1 }] },
];

let expandedCraftItems = new Set();
let recipeCache = {};
function isBlackRedZoneEnabled() { return true; }
function isValidSourceCity() { return true; }
function isInvalidCrossRoute() { return false; }
function isFocusEnabled() { return false; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function getBuyPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].buy_price) || 0; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function calcRRR(b) { return b <= 0 ? 0 : b / (1 + b); }
function getCraftRRR(city, ct, f) { let b = BASE_CITY_BONUS; if (f) b += FOCUS_BONUS; return calcRRR(b); }
function getFocusCost() { return 500; }
function getCraftFocusCost() { return 500; }
function calcStationFeeSilver() { return 0; }
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1],10) : 4; }
function calculateProfitPerFocus(profit, focusCost) { return focusCost > 0 ? profit / focusCost : 0; }
function marginalSilverPerFocus(matCost, baseRrr, focusRrr, focusCost) { return focusCost > 0 ? (matCost * (focusRrr - baseRrr) * (1 + SETUP_FEE)) / focusCost : 0; }
function calculateProfitPer10kFocus(profit, focusCost) { return focusCost > 0 ? profit * Math.floor(10000/focusCost) : 0; }
function matsNeededFor10kFocus(focusCost, per, applyRrr, rrr) { const c = Math.floor(10000/focusCost); return Math.round(c * (applyRrr ? per * (1-(rrr||0)) : per)); }
function getCityVol() { return 100; }
function formatSilver(n) { if (n == null) return "N/A"; return Math.round(n).toLocaleString(); }
function formatFocusCost(n) { if (n == null || !Number.isFinite(n)) return "N/A"; const a = Math.abs(n); if (a >= 100) return Math.round(n).toLocaleString(); return String(Number(n.toFixed(a >= 10 ? 1 : 2))); }
function getItemDisplayName(id) { return id; }
function dispName(id, name) { return name; }
function getCraftStation() { return ""; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row) { return (row.item && row.item.id || "") + "|" + (row.craftCity || ""); }
function matPriceSpan(id, city, price) { return "<span class='mat' data-item-id='" + id + "'>@ " + (price > 0 ? price : "no data") + " ea</span>"; }
// Read-only aggregate cost cell (js/app.js aggregateCostTd) — the Input Cost
// column is a sum, so it is not a click-to-override price cell.
function aggregateCostTd(c, cls) { return '<td class="' + (cls || "silver-val cell-num") + '">' + (Number(c) > 0 ? c : "—") + '</td>'; }
function priceTd(p) { return '<td class="silver-val">' + (p > 0 ? p : "no data") + '</td>'; }
function profitTd(mi) { return '<td class="pct">' + (mi.margin || 0).toFixed(1) + '</td>'; }
function pureProfitTd(mi) { return '<td class="silver-val pure">' + Math.round(mi.profit || 0) + '</td>'; }
function brecilienFeeBadge() { return ""; }
function getLaborerJournalFill() { return null; }
const captured = {};
function renderTableData(id, rows, fmt) {
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
`;

globalThis.tx = globalThis.tx || ((en) => en);

const mod = new Module("crafting-artifact-substitute-test");
mod._compile(
  sandbox +
    loadFile("js/data-artifacts.js") +
    loadFile("js/gear-token-substitute.js") +
    loadFile("js/route-cell.js") +
    loadFile("js/focus-play.js") +
    loadFile("js/render-crafting.js") +
    "\nmodule.exports = { renderCraftingTable, captured };",
  "render-crafting.js",
);
const { renderCraftingTable, captured } = mod.exports;

const FS = "Fort Sterling";
function priceMap(entries) {
  const out = {};
  for (const e of entries) {
    if (!out[e.id]) out[e.id] = {};
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

const BASE = [
  { id: "T4_PLANKS", city: FS, buy: 200, sell: 210 },
  { id: "T4_MAIN_CURSEDSTAFF_UNDEAD", city: FS, buy: 40000, sell: 42000 },
];

function renderWith(artifactBuy, tokenBuy) {
  const rows = [...BASE, { id: ARTIFACT, city: FS, buy: artifactBuy, sell: artifactBuy + 100 }];
  if (tokenBuy != null) rows.push({ id: TOKEN, city: FS, buy: tokenBuy, sell: tokenBuy + 100 });
  renderCraftingTable(priceMap(rows));
  const i = captured.rows.findIndex(
    (r) => r.item && r.item.id === "T4_MAIN_CURSEDSTAFF_UNDEAD" && r.marginInfo.margin !== -1);
  return { row: captured.rows[i], html: captured.html[i] || "" };
}

console.log("\n=== Crafting table: Crystallized-token substitution is visible ===");

test("token cheaper — the material line names the TOKEN", () => {
  const { html } = renderWith(9000, 3000);
  assert.ok(html.includes(TOKEN), `token name missing from the materials cell:\n${html}`);
});

test("token cheaper — the line says what it stands in for", () => {
  const { html } = renderWith(9000, 3000);
  assert.ok(html.includes("instead of") && html.includes(ARTIFACT),
    `substitution tag missing:\n${html}`);
});

test("token cheaper — the price override hangs on the token, not the artifact", () => {
  const { html } = renderWith(9000, 3000);
  assert.ok(html.includes(`data-item-id='${TOKEN}'`), "matPriceSpan should key the bought id");
  assert.ok(!html.includes(`data-item-id='${ARTIFACT}'`), "artifact should not own the price cell");
});

test("token cheaper — the craft is costed at the token price", () => {
  const cheap = renderWith(9000, 3000);
  const dear = renderWith(9000, null);
  assert.ok(cheap.row.totalInputCost < dear.row.totalInputCost,
    "substituting the cheaper token must lower the input cost");
});

test("artifact cheaper — the line keeps naming the ARTIFACT", () => {
  const { html } = renderWith(3000, 9000);
  assert.ok(html.includes(ARTIFACT), "artifact name missing");
  assert.ok(!html.includes("instead of"), `no substitution happened, tag should be absent:\n${html}`);
  assert.ok(html.includes(`data-item-id='${ARTIFACT}'`), "artifact owns the price cell");
});

test("ordinary materials never grow a substitution tag", () => {
  const { html } = renderWith(9000, 3000);
  const plankLine = html.split("<br>").find((l) => l.includes("T4_PLANKS"));
  assert.ok(plankLine, "plank line rendered");
  assert.ok(!plankLine.includes("instead of"), `plank line should be untouched: ${plankLine}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
