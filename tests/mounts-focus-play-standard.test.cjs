/**
 * Test: the Mounts table's Silver/Focus and Best Focus columns follow the shared
 * standard (js/focus-play.js).
 *
 * A BREEDING row has two competing focus plays and they must actually compete:
 *   • nurture — an extra offspring, worth max(baby price, another cycle's margin)
 *               × the nurture gain, over the cycle's total nurture focus;
 *   • saddler — a higher return rate on the saddler craft's leather, over that
 *               craft's focus cost.
 * Whichever adds more silver to what the row finally SELLS wins, and the column
 * reports that winner's rate. Before the standard the column always reported
 * nurture; the saddler figure was computed and never shown.
 *
 * A CRAFT row (a mount built from bought materials) has one focusable step, and
 * its figure must be the MARGINAL one — the material value the higher return rate
 * hands back — not the craft's whole profit ÷ its focus cost.
 *
 * Black-box: drives the real renderMountsTable over synthetic market data and
 * reads the resulting row objects.
 *
 * Run: node tests/mounts-focus-play-standard.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const _els = {};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
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
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], CONSUMABLES = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

const mod = new Module("mounts-focus-play");
mod._compile(
  stubs +
    J("focus-play.js") +
    J("data-faction-fp-costs.js") +
    J("focus-costs.js") +
    J("data-mounts.js") +
    J("data-city-bonuses.js") +
    (J("calculations.js") + J("calculations-margins.js")) +
    J("travel-cost.js") +
    J("mp-bonus.js") +
    (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
    J("rrr-eligible.js") + J("render-mounts.js") + J("render-mounts-breeding-row.js") + J("render-mounts-craft-row.js") +
    "\nmodule.exports = { tableState, renderMountsTable, FOCUS_PLAY_UNITS };",
  "mounts-focus-play.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const row = (buy, sell, vol) => ({ buy_price: buy, sell_price: sell, volume_24h: vol });
const V = 1000;

// Riding Horse T8: baby → grown (fed) → saddled with 20x T8_LEATHER → T8_MOUNT_HORSE.
// leatherPrice drives the saddler play; babyPrice drives the nurture play.
function render({ babyPrice, leatherPrice, mountPrice, foodPrice = 300 }) {
  const md = {};
  const put = (id, b, s) => { (md[id] = md[id] || {})["Lymhurst"] = row(b, s, V); };
  put("T8_FARM_HORSE_BABY", babyPrice, babyPrice + 1000);
  put("T8_FARM_HORSE_GROWN", 100000, 110000);
  put("T8_LEATHER", leatherPrice, leatherPrice + 100);
  put("T8_MOUNT_HORSE", mountPrice, mountPrice + 20000);
  // Feed: any carrot-family crop the grower can eat.
  ["T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP", "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN"]
    .forEach((id) => put(id, foodPrice, foodPrice + 10));
  X.renderMountsTable(md);
  return md;
}
const breedingRow = () => X.tableState["mounts-table"].data.find(
  (r) => r.item && r.item.babyId === "T8_FARM_HORSE_BABY" && r.isBreeding && r.section === "royal");
const craftRow = () => X.tableState["mounts-table"].data.find(
  (r) => r.item && r.item.id === "T8_MOUNT_HORSE" && r.isCraft && r.section === "royal");

console.log("Mounts: Silver/Focus + Best Focus follow the shared standard\n");

console.log("=== Breeding rows: nurture vs saddler compete ===");

test("a breeding row carries a best focus play, and Silver/Focus is its rate", () => {
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 400000 });
  const r = breedingRow();
  assert.ok(r, "no breeding row rendered");
  assert.ok(r.bestFocusPlay, "no best focus play on the breeding row");
  assert.ok(Math.abs(r.profitPerFocus -
    r.bestFocusPlay.profitDelta / r.bestFocusPlay.focusCost) < 1e-9,
    "Silver/Focus must be the winning play's profitDelta / focusCost");
});

test("the winner is one of the two real plays for this row", () => {
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 400000 });
  const r = breedingRow();
  assert.ok(["nurture", "saddler"].includes(r.bestFocusPlay.kind),
    `unexpected kind ${r.bestFocusPlay.kind}`);
});

test("cheap leather + a valuable baby → NURTURE wins", () => {
  render({ babyPrice: 400000, leatherPrice: 200, mountPrice: 900000 });
  const r = breedingRow();
  assert.strictEqual(r.bestFocusPlay.kind, "nurture");
});

test("worthless baby + very expensive leather → the SADDLER craft wins", () => {
  // A baby that costs nothing and a cycle that barely profits leaves the nurture
  // play worth ~nothing, while 20x dear leather makes the saddler return rate the
  // best home for the focus. The old column could never report this.
  render({ babyPrice: 1, leatherPrice: 400000, mountPrice: 500000 });
  const r = breedingRow();
  assert.strictEqual(r.bestFocusPlay.kind, "saddler");
  assert.ok(r.bestFocusPlay.profitDelta > 0);
});

test("when the saddler play wins, the column reports ITS rate, not nurture's", () => {
  render({ babyPrice: 1, leatherPrice: 400000, mountPrice: 500000 });
  const r = breedingRow();
  assert.strictEqual(r.bestFocusPlay.kind, "saddler");
  // saddlerProfitPerFocus is still exposed for the row's own bookkeeping, and it
  // is exactly what the column now shows.
  assert.ok(Math.abs(r.profitPerFocus - r.saddlerProfitPerFocus) < 1e-9,
    `column ${r.profitPerFocus} vs saddler ${r.saddlerProfitPerFocus}`);
  assert.ok(Math.abs(r.bestFocusPlay.profitDelta -
    r.saddlerProfitPerFocus * r.saddlerFocusCost) < 1e-6);
});

test("when nurture wins, the saddler play is still priced and simply loses", () => {
  render({ babyPrice: 400000, leatherPrice: 200, mountPrice: 900000 });
  const r = breedingRow();
  assert.strictEqual(r.bestFocusPlay.kind, "nurture");
  assert.ok(r.saddlerFocusCost > 0, "the saddler craft does cost focus");
  assert.ok(r.bestFocusPlay.profitDelta >=
    r.saddlerProfitPerFocus * r.saddlerFocusCost - 1e-6,
    "the winner must add at least as much silver as the play it beat");
});

test("the play names the item the focus is spent on", () => {
  render({ babyPrice: 400000, leatherPrice: 200, mountPrice: 900000 });
  const r = breedingRow();
  assert.strictEqual(r.bestFocusPlay.itemId, "T8_FARM_HORSE_BABY");
});

test("a nurture play is quoted per CYCLE, not per craft", () => {
  render({ babyPrice: 400000, leatherPrice: 200, mountPrice: 900000 });
  assert.strictEqual(X.FOCUS_PLAY_UNITS[breedingRow().bestFocusPlay.kind], "/cycle");
});

console.log("\n=== Craft rows: one step, and the figure is marginal ===");

test("a craft row's Silver/Focus is the craft play's rate", () => {
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 400000 });
  const r = craftRow();
  assert.ok(r, "no craft row rendered");
  assert.ok(r.bestFocusPlay, "no best focus play on the craft row");
  assert.strictEqual(r.bestFocusPlay.kind, "craft");
  assert.ok(Math.abs(r.profitPerFocus -
    r.bestFocusPlay.profitDelta / r.bestFocusPlay.focusCost) < 1e-9);
});

test("the craft figure is FAR below the old profit ÷ focus average", () => {
  // The whole-profit average credited focus with profit the craft earns anyway.
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 900000 });
  const r = craftRow();
  const oldAverage = r.marginInfo.profit / r.focusCost;
  assert.ok(r.profitPerFocus < oldAverage,
    `marginal ${r.profitPerFocus} should be below the average ${oldAverage}`);
});

test("the sell price cannot move the craft figure (revenue cancels)", () => {
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 400000 });
  const cheap = craftRow().profitPerFocus;
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 1200000 });
  const dear = craftRow().profitPerFocus;
  assert.ok(Math.abs(cheap - dear) < 1e-9,
    `Silver/Focus moved with the sale: ${cheap} vs ${dear}`);
});

test("doubling the material price doubles the craft figure", () => {
  render({ babyPrice: 200000, leatherPrice: 9000, mountPrice: 400000 });
  const base = craftRow().profitPerFocus;
  render({ babyPrice: 200000, leatherPrice: 18000, mountPrice: 400000 });
  const doubled = craftRow().profitPerFocus;
  assert.ok(Math.abs(doubled - base * 2) < 1e-6,
    `expected ${base * 2}, got ${doubled}`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
