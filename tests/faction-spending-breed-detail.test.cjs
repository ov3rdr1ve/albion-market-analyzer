/**
 * Test: Faction Spending baby row exposes a collapsible breed-inputs sub-row.
 *
 * Covers:
 *  - getBreedDataByBaby() returns enriched data (saddled price, food, mats)
 *    pulled from the mounts-table render state
 *  - buildFactionSpendRow stores breedData + breedSilverPerFp on the row
 *  - _renderBreedDetailRow produces editable spans:
 *      • saddled mount price uses data-city-list="sell"
 *      • food + non-FP saddler mats use data-city-list="buy"
 *      • FP-only saddler mats (hearts) render as text, NOT editable spans
 *  - Detail row is hidden by default (style="display:none") and gets a
 *    .breed-toggle button so users can expand without leaving the table
 *  - Expanded state in _expandedBreedBabies survives a re-render
 *
 * Run: node tests/faction-spending-breed-detail.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const fpCostsSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "data-faction-fp-costs.js"),
  "utf8"
);
const renderSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "render-faction-spending.js"),
  "utf8"
);

// --- Build a sandbox module that loads render-faction-spending with stubs ---
const stubs = `
${fpCostsSrc}
// stub the few things render-faction-spending touches at module-init time
let _renderedRows = [];
let _renderTableArgs = null;
const tableState = {
  "mounts-table": { data: [] },
  "faction-spending-table": { data: [] },
};
function renderTableData(tbodyId, rows, formatter) {
  _renderTableArgs = { tbodyId, rows };
  _renderedRows = rows.map((r, i) => formatter(r, i));
  tableState[tbodyId].data = rows;
}
function findBestSellCity(marketData, itemId, cities) {
  // Pick first city with sell_price; mirror live behavior closely enough
  for (const c of cities) {
    const p = marketData?.[itemId]?.[c]?.sell_price || 0;
    if (p > 0) return { city: c, price: p };
  }
  return { city: null, price: 0 };
}
function netSilverAfterFees(gross) { return Math.max(0, Math.floor(gross * 0.91)); }
function calculateSilverPerFp(silver, fp) { return fp > 0 ? silver / fp : 0; }
function getOverridePrice() { return null; }
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {
  "T5_MOUNT_SWAMPDRAGON_FW_THETFORD": "Saddled Swamp Salamander [T5]",
  "T5_MEAT": "Raw Goose [T5]",
  "T5_LEATHER": "T5 Cured Leather",
  "T1_FACTION_SWAMP_TOKEN_1": "Vineheart",
};
function formatSilver(n) { return String(Math.round(n)); }
function priceTd(price, itemId, city) {
  return \`<td class="silver-val price-editable" data-item-id="\${itemId}" data-city="\${city}" data-raw-price="\${price}">\${price}</td>\`;
}
function volTd(v, itemId, city) {
  return \`<td class="vol-cell vol-editable" data-item-id="\${itemId}" data-city="\${city}">\${v}</td>\`;
}
function matPriceSpan(matId, city, price) {
  return \`<span class="price-editable mat-price-inline" data-item-id="\${matId}" data-city="\${city}" data-raw-price="\${price}" data-city-list="buy">@ \${price} ea</span>\`;
}
const CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Caerleon","Brecilien","Black Market"];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = CITIES.filter((c) => c !== "Black Market");
const FACTION_CHESTS = [];
// no document — render-faction-spending guards on \`typeof document !== "undefined"\`
`;

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
const mod = new Module("render-faction-spending-test");
mod._compile(
  stubs +
    renderSrc +
    `
    module.exports = {
      getBreedDataByBaby,
      buildFactionSpendRow,
      _renderBreedDetailRow,
      _expandedBreedBabies,
      tableState,
      get _renderedRows() { return _renderedRows; },
    };`,
  "render-faction-spending.js"
);

const {
  getBreedDataByBaby,
  buildFactionSpendRow,
  _renderBreedDetailRow,
  _expandedBreedBabies,
  tableState,
} = mod.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Faction Spending breed-detail-row tests\n");

// Synth a mounts-table row for the swamp salamander
const swampMountsRow = {
  item: {
    babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY",
    grownId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN",
  },
  recipe: {
    id: "T5_MOUNT_SWAMPDRAGON_FW_THETFORD",
    materials: [
      { matId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", count: 1 },
      { matId: "T5_LEATHER", count: 20 },
      { matId: "T1_FACTION_SWAMP_TOKEN_1", count: 5 },
    ],
  },
  sellItemId: "T5_MOUNT_SWAMPDRAGON_FW_THETFORD",
  sellPot: { city: "Fort Sterling", price: 480000 },
  feed: {
    id: "T5_MEAT", city: "Fort Sterling", price: 1200, pieces: 29,
    silverPerNutrition: 12, hasData: true,
  },
  feedCost: 34800,
  saddlerMatPrices: {
    "T5_LEATHER": { price: 1500, city: "Fort Sterling" },
    "T1_FACTION_SWAMP_TOKEN_1": { price: 30000, city: "Thetford" },
  },
  saddlerCity: "Fort Sterling",
  saddlerRrr: 0.3,
  silverPerFp: 25.21,
  section: "royal",
};
tableState["mounts-table"].data = [swampMountsRow];

// === getBreedDataByBaby ===
test("getBreedDataByBaby returns rich object keyed by babyId", () => {
  const map = getBreedDataByBaby();
  const bd = map["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"];
  assert.ok(bd, "missing baby entry");
  assert.strictEqual(bd.silverPerFp, 25.21);
  assert.strictEqual(bd.sellItemId, "T5_MOUNT_SWAMPDRAGON_FW_THETFORD");
  assert.strictEqual(bd.sellPrice, 480000);
  assert.strictEqual(bd.sellCity, "Fort Sterling");
  assert.strictEqual(bd.feed.id, "T5_MEAT");
  assert.strictEqual(bd.feed.pieces, 29);
  assert.ok(bd.recipe);
  assert.strictEqual(bd.grownId, "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN");
});

test("getBreedDataByBaby returns empty when no breeding rows", () => {
  const saved = tableState["mounts-table"].data;
  tableState["mounts-table"].data = [];
  const map = getBreedDataByBaby();
  assert.deepStrictEqual(map, {});
  tableState["mounts-table"].data = saved;
});

test("getBreedDataByBaby keeps highest silverPerFp when multiple variants", () => {
  const royal = { ...swampMountsRow, section: "royal", silverPerFp: 25.21, sellPot: { ...swampMountsRow.sellPot, price: 480000 } };
  const caerleon = { ...swampMountsRow, section: "caerleon", silverPerFp: 30.0, sellPot: { city: "Caerleon", price: 600000 } };
  tableState["mounts-table"].data = [royal, caerleon];
  const map = getBreedDataByBaby();
  const bd = map["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"];
  assert.strictEqual(bd.silverPerFp, 30.0);
  assert.strictEqual(bd.sellCity, "Caerleon");
  tableState["mounts-table"].data = [swampMountsRow]; // restore
});

// === buildFactionSpendRow with breedData ===
test("buildFactionSpendRow stores breedData + breedSilverPerFp on baby row", () => {
  const md = {
    "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY": {
      "Thetford": { sell_price: 47000, buy_price: 45000, volume_24h: 800 },
    },
  };
  const breedData = getBreedDataByBaby()["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"];
  const row = buildFactionSpendRow(
    "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY",
    md,
    { tradeable: true, category: "Baby T5", breedData }
  );
  assert.ok(row);
  assert.strictEqual(row.breedSilverPerFp, 25.21);
  assert.strictEqual(row.breedData, breedData);
});

test("buildFactionSpendRow row without breedData has 0 breedSilverPerFp", () => {
  const md = {
    "T1_FACTION_SWAMP_TOKEN_1": {
      "Thetford": { sell_price: 30000, buy_price: 28000, volume_24h: 200 },
    },
  };
  const row = buildFactionSpendRow(
    "T1_FACTION_SWAMP_TOKEN_1",
    md,
    { tradeable: true, category: "Heart" }
  );
  assert.ok(row);
  assert.strictEqual(row.breedSilverPerFp, 0);
  assert.strictEqual(row.breedData, null);
});

// === _renderBreedDetailRow ===
const breedData = getBreedDataByBaby()["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"];
const sampleRow = {
  itemId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY",
  breedData,
  breedSilverPerFp: 25.21,
};

test("_renderBreedDetailRow returns empty string when breedData missing", () => {
  const html = _renderBreedDetailRow({ itemId: "X", breedData: null });
  assert.strictEqual(html, "");
});

test("_renderBreedDetailRow renders a tr.breed-detail-row with data-baby-id", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/<tr class="breed-detail-row" data-baby-id="T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"/.test(html), html);
});

test("_renderBreedDetailRow uses display:none when not in expanded set", () => {
  _expandedBreedBabies.delete("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY");
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/style="display:none"/.test(html), "expected display:none, got: " + html.slice(0, 200));
});

test("_renderBreedDetailRow uses display:table-row when expanded", () => {
  _expandedBreedBabies.add("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY");
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/style="display:table-row"/.test(html), "expected display:table-row");
  _expandedBreedBabies.delete("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"); // cleanup
});

test("saddled mount price uses data-city-list=\"sell\" (not buy)", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/data-item-id="T5_MOUNT_SWAMPDRAGON_FW_THETFORD"[^>]*data-city-list="sell"/.test(html),
    "expected sell-side editable span for saddled mount");
});

test("food renders a buy-side editable span", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/data-item-id="T5_MEAT"[^>]*data-city-list="buy"/.test(html),
    "expected buy-side editable span for food");
});

test("non-FP saddler mat (T5_LEATHER) renders a buy-side editable span", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/data-item-id="T5_LEATHER"[^>]*data-city-list="buy"/.test(html),
    "expected buy-side editable span for leather");
});

test("FP-priced saddler mat (Vineheart) renders an editable buy-side silver span", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/data-item-id="T1_FACTION_SWAMP_TOKEN_1"[^>]*data-city-list="buy"/.test(html),
    "Vineheart should now have a buy-side editable silver span");
});

test("FP-priced saddler mat (Vineheart) annotates the FP alternative as 'or X FP each'", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/or 3,000 FP each/.test(html),
    "expected '(or 3,000 FP each)' annotation alongside Vineheart silver price");
});

test("grown-mount input is excluded from saddler-mats list (produced in-house)", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(!/T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN/.test(html),
    "grown mount should not appear in detail row");
});

test("renders four labelled sections: Baby, Saddled, Food, Saddler materials", () => {
  const html = _renderBreedDetailRow(sampleRow);
  assert.ok(/Baby \(per cycle\)/.test(html), "missing 'Baby (per cycle)' label");
  assert.ok(/Saddled mount sell price/.test(html), "missing 'Saddled mount sell price' label");
  assert.ok(/Food per cycle/.test(html), "missing 'Food per cycle' label");
  assert.ok(/Saddler materials/.test(html), "missing 'Saddler materials' label");
});

test("Baby section shows baby name + sell-side editable silver price", () => {
  // sampleRow needs sellPrice + sellCity + fpCost populated like a real built row
  const rowWithSell = {
    ...sampleRow,
    sellPrice: 47436,
    sellCity: "Fort Sterling",
    fpCost: 3000,
  };
  const html = _renderBreedDetailRow(rowWithSell);
  // Editable span on the baby uses the same sell-side data-city-list as the
  // saddled mount (both are sellable items the user lists for silver).
  assert.ok(/data-item-id="T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"[^>]*data-city-list="sell"/.test(html),
    "expected sell-side editable span for baby in the Baby (per cycle) section");
});

test("Baby section annotates FP alternative as 'or X FP from NPC'", () => {
  const rowWithSell = {
    ...sampleRow,
    sellPrice: 47436,
    sellCity: "Fort Sterling",
    fpCost: 3000,
  };
  const html = _renderBreedDetailRow(rowWithSell);
  assert.ok(/or 3,000 FP from NPC/.test(html),
    "expected '(or 3,000 FP from NPC)' annotation in Baby section");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
