/**
 * Integration (TLD) smoke test: renderCraftPlannerTable drives the REAL
 * craft-planner-pricing + refining-chain + data-craft-planner modules with a
 * synthetic two-item catalogue and a renderTableData capture, asserting the
 * row set and the key cells (combined profit, refine savings, journal tag,
 * best-focus-step label) render without throwing and resolve every global helper.
 *
 * Run: node --test tests/craft-planner-render-furniture-paths.test.cjs
 *
 * Enchant expansion, house-tier furniture, collapsible sublist, transmute / artifact tags, best-path lines, dropped sell pin. Shared setup: tests/helpers/craft-planner-render-setup.cjs.
 */
const {
  assert, renderCraftPlannerTable, captured, _cpMatLine, expandCraftPlannerItems, _cpNameTd,
  setHouseTier, __setForce, __setCrossRoute, __expand, __collapseAll, test, getRowKeyLocal, FS,
  market, finish,
} = require("./helpers/craft-planner-render-setup.cjs");

// ── Enchant (.1–.4) expansion ──────────────────────────────────────────────
// The planner expands each ENCHANTABLE equipment recipe into its base row plus
// four enchant variants; furniture / hideout kits / consumables have no enchant
// ladder and stay a single base row.
test("equipment recipe expands to base + .1–.4 enchant variants", () => {
  const out = expandCraftPlannerItems([
    { id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor [T8]", matId: "T8_METALBAR", matCount: 16, craftType: "plate_armor" },
  ]);
  assert.strictEqual(out.length, 5, "base + 4 enchant rows, got " + out.length);
  assert.deepStrictEqual(out.map((i) => i.id), [
    "T8_ARMOR_PLATE_SET1", "T8_ARMOR_PLATE_SET1@1", "T8_ARMOR_PLATE_SET1@2",
    "T8_ARMOR_PLATE_SET1@3", "T8_ARMOR_PLATE_SET1@4",
  ]);
});

test("enchant variant enchants the resource matId and tags the name .n", () => {
  const out = expandCraftPlannerItems([
    { id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor [T8]", matId: "T8_METALBAR", matCount: 16, craftType: "plate_armor" },
  ]);
  const v2 = out.find((i) => i.id === "T8_ARMOR_PLATE_SET1@2");
  assert.strictEqual(v2.matId, "T8_METALBAR_LEVEL2@2", "AODP _LEVELn@n mat id");
  assert.strictEqual(v2.name, "Soldier Armor [T8.2]", "name tier tag becomes [T8.2]");
  assert.strictEqual(v2.craftType, "plate_armor", "craftType carried through");
  assert.strictEqual(v2.matCount, 16, "matCount unchanged");
});

test("materials[] resource lines are enchanted; non-resource lines stay flat", () => {
  const out = expandCraftPlannerItems([
    { id: "T8_2H_HOLYSTAFF", name: "Great Holy Staff [T8]", matId: "T8_PLANKS", matCount: 20,
      materials: [{ matId: "T8_PLANKS", count: 20 }, { matId: "T8_ARTEFACT_2H_HOLYSTAFF", count: 1 }] },
  ]);
  const v1 = out.find((i) => i.id === "T8_2H_HOLYSTAFF@1");
  assert.deepStrictEqual(v1.materials, [
    { matId: "T8_PLANKS_LEVEL1@1", count: 20 },
    { matId: "T8_ARTEFACT_2H_HOLYSTAFF", count: 1 },
  ]);
});

test("furniture / hideout / non-equipment stay a single base row (no enchant)", () => {
  const out = expandCraftPlannerItems([
    { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", matId: "T8_PLANKS", matCount: 30 },
    { id: "UNIQUE_HIDEOUT", name: "Hideout Construction Kit", matId: "T2_STONEBLOCK", matCount: 3000 },
  ]);
  assert.strictEqual(out.length, 2, "no enchant rows for furniture/hideout");
  assert.ok(out.every((i) => !String(i.id).includes("@")), "no @ variants generated");
});

// ── Furniture the house cannot hold ────────────────────────────────────────
// A building holds furniture of its OWN tier or lower and nothing above, so a
// T8 bed is not a plan for a T6 house. The rule is not in items.xml — see
// js/house-tier.js — and the preference defaults to T8, so nothing is hidden
// until the user names a smaller house.
const FURNITURE_CATALOG = [
  { id: "T4_FURNITUREITEM_BED", name: "Adept's Bed", matId: "T4_PLANKS", matCount: 8 },
  { id: "T6_FURNITUREITEM_TABLE", name: "Master's Table", matId: "T6_PLANKS", matCount: 30 },
  { id: "T7_FURNITUREITEM_BED", name: "Grandmaster's Bed", matId: "T7_PLANKS", matCount: 8 },
  { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", matId: "T8_PLANKS", matCount: 30 },
  { id: "T8_FURNITUREITEM_TROPHY_FISHING_BOSS", name: "Trophy Shark", matId: "T8_FISH", matCount: 1 },
  { id: "T8_FURNITUREITEM_REPAIRKIT", name: "Elder's Repair Kit", matId: "T8_PLANKS", matCount: 8 },
];
const furnitureIds = (tier) => {
  setHouseTier(tier);
  const out = expandCraftPlannerItems(FURNITURE_CATALOG).map((i) => i.id);
  setHouseTier(8);
  return out;
};

test("a T8 house hides nothing — the default must not change any row set", () => {
  assert.deepStrictEqual(furnitureIds(8), FURNITURE_CATALOG.map((i) => i.id));
});

test("a T6 house drops the T7 and T8 furniture it cannot place", () => {
  assert.deepStrictEqual(furnitureIds(6), [
    "T4_FURNITUREITEM_BED", "T6_FURNITUREITEM_TABLE",
  ]);
});

test("the rule reaches every furniture family, not only beds and tables", () => {
  // Trophy Shark and repair kits are indoor placeables under the same rule.
  const kept = furnitureIds(4);
  assert.deepStrictEqual(kept, ["T4_FURNITUREITEM_BED"]);
});

test("a T2 house keeps no furniture from a T4-and-up catalogue", () => {
  assert.deepStrictEqual(furnitureIds(2), []);
});

test("non-furniture rows are never touched by the house tier", () => {
  setHouseTier(2);
  const out = expandCraftPlannerItems([
    { id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor [T8]", matId: "T8_METALBAR", matCount: 16, craftType: "plate_armor" },
    { id: "UNIQUE_HIDEOUT", name: "Hideout Construction Kit", matId: "T2_STONEBLOCK", matCount: 3000 },
  ]).map((i) => i.id);
  setHouseTier(8);
  assert.ok(out.includes("T8_ARMOR_PLATE_SET1"), "a T8 plate set is not furniture");
  assert.ok(out.includes("UNIQUE_HIDEOUT"), "a hideout kit is not house furniture");
  assert.strictEqual(out.length, 6, "base + 4 enchant rows + the kit");
});

test("raising the house tier brings the hidden rows back", () => {
  // Only the ROWS are filtered; the scan id set is untouched, so the returning
  // rows come back priced rather than blank.
  assert.strictEqual(furnitureIds(6).length, 2);
  assert.strictEqual(furnitureIds(8).length, FURNITURE_CATALOG.length);
});

test("hand-written @n catalogue entries are dropped and regenerated (no duplicates)", () => {
  const out = expandCraftPlannerItems([
    { id: "T4_ARMOR_CLOTH_SET1", name: "Scholar Robe [T4]", matId: "T4_CLOTH", matCount: 16, craftType: "cloth_armor" },
    { id: "T4_ARMOR_CLOTH_SET1@1", name: "Scholar Robe [T4.1]", matId: "T4_CLOTH_LEVEL1@1", matCount: 16 },
  ]);
  const ids = out.map((i) => i.id);
  assert.strictEqual(ids.length, new Set(ids).size, "no duplicate ids: " + ids.join(","));
  assert.strictEqual(ids.filter((id) => id === "T4_ARMOR_CLOTH_SET1@1").length, 1, "exactly one @1 row");
});

// ── Collapsible enchant sublist (mirrors the Crafting table) ────────────────
// A base equipment row carries a ▶/▼ toggle keyed to the craft-planner table;
// enchant variant rows indent under it. (Row hide/group is sorting.js's job,
// covered in collapsible-enchants.test.cjs — here we assert the row markup.)
test("_cpNameTd: base equipment row gets a collapsed ▶ toggle for craft-planner-table", () => {
  __collapseAll();
  const td = _cpNameTd({ id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor [T8]" });
  assert.ok(/data-expand-craft="T8_ARMOR_PLATE_SET1"/.test(td), "toggle keyed to base id");
  assert.ok(/data-expand-table="craft-planner-table"/.test(td), "toggle targets the planner table");
  assert.ok(td.includes("▶") && !td.includes("▼"), "collapsed shows ▶");
});

test("_cpNameTd: expanded base row shows ▼", () => {
  __expand("T8_ARMOR_PLATE_SET1");
  const td = _cpNameTd({ id: "T8_ARMOR_PLATE_SET1", name: "Soldier Armor [T8]" });
  assert.ok(td.includes("▼"), "expanded shows ▼");
  __collapseAll();
});

test("_cpNameTd: enchant variant row indents and has no toggle", () => {
  const td = _cpNameTd({ id: "T8_ARMOR_PLATE_SET1@2", name: "Soldier Armor [T8.2]" });
  assert.ok(/padding-left:1\.5em/.test(td), "variant row is indented");
  assert.ok(!/data-expand-craft/.test(td), "variant row has no toggle of its own");
});

test("_cpNameTd: non-equipment (furniture) row has no toggle", () => {
  const td = _cpNameTd({ id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table" });
  assert.ok(!/data-expand-craft/.test(td), "furniture doesn't enchant → no toggle");
});

test("rendered base equipment row carries the expand toggle", () => {
  __collapseAll();
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  assert.ok(/data-expand-craft="T8_ARMOR_PLATE_SET1"[^>]*data-expand-table="craft-planner-table"/.test(html),
    "expected the plate-armor base row to render its craft-planner expand toggle");
});

// ── Transmute path in the Materials column ────────────────────────────────
// Reported: the planner's Materials column only ever said "buy the bar" or
// "(refine ▲)". A raw bought a node lower and transmuted up never showed,
// even though the Refining / Transports table has had that path for a while.

// T8 wood is dear, T7 wood is cheap → self-refining T8 planks wins, and the
// refine's raw leg is cheaper reached by transmuting T7 wood up than by buying
// T8 wood outright.
const transmuteMarket = {
  T8_PLANKS:   { [FS]: { buy_price: 60_000, sell_price: 61_000, volume_24h: 500 } },
  T8_WOOD:     { [FS]: { buy_price: 900_000 } },
  T7_WOOD:     { [FS]: { buy_price: 200 } },
  T7_PLANKS:   { [FS]: { buy_price: 500 } },
  T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
  T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 600000, volume_24h: 80 } },
  T8_ARMOR_PLATE_SET1:    { [FS]: { sell_price: 80000, volume_24h: 120 } },
};

test("a chain fed by a transmuted raw is tagged in the Materials cell", () => {
  renderCraftPlannerTable(transmuteMarket);
  const html = captured.html.join("\n");
  assert.ok(/refine wood ▲/.test(html), "precondition: the material is self-refined");
  assert.ok(/via transmute/.test(html),
    "expected a '(via transmute)' tag on the self-refined material");
});

test("the tag names the node actually bought and the city it comes from", () => {
  renderCraftPlannerTable(transmuteMarket);
  const html = captured.html.join("\n");
  assert.ok(/title="[^"]*T7_WOOD[^"]*"/.test(html), "the tooltip must name the bought start node");
  assert.ok(/title="[^"]*Fort Sterling[^"]*"/.test(html), "the tooltip must name its city");
});

test("no transmute tag when buying the raw outright is cheaper", () => {
  renderCraftPlannerTable({ ...transmuteMarket, T8_WOOD: { [FS]: { buy_price: 300 } } });
  const html = captured.html.join("\n");
  assert.ok(/refine wood ▲/.test(html), "precondition: the material is still self-refined");
  assert.ok(!/via transmute/.test(html), "a cheap raw must not be routed through a transmute");
});

test("_cpMatLine renders a direct transmute sourcing without an undefined city", () => {
  // Defensive branch: no planner MATERIAL transmutes today (refined ids can't),
  // but such a sourcing must never fall into the market branch.
  const line = _cpMatLine({
    matId: "T8_WOOD", count: 5,
    sourcing: {
      perUnit: 1500, source: "transmute",
      transmute: { startId: "T7_WOOD", startCity: FS, startPrice: 200, steps: [{}] },
    },
  }, FS);
  assert.ok(/via transmute/.test(line), "expected the transmute tag");
  assert.ok(/T7_WOOD/.test(line), "expected the bought start node");
  assert.ok(!/undefined/.test(line), `city fell through as undefined: ${line}`);
});

// ── Artifact substitute in the Materials column ───────────────────────────

test("_cpMatLine names the substitute and the slot it fills", () => {
  const line = _cpMatLine({
    matId: "T8_ARTEFACT_TOKEN_FAVOR_2", origMatId: "T8_ARTEFACT_2H_HOLYSTAFF_HELL", count: 1,
    isArtifact: true,
    sourcing: { perUnit: 120_000, source: "market", city: FS },
  }, FS);
  assert.ok(/T8_ARTEFACT_TOKEN_FAVOR_2/.test(line), "expected the id actually bought");
  assert.ok(/substitute/.test(line), "expected a substitute tag");
  assert.ok(/T8_ARTEFACT_2H_HOLYSTAFF_HELL/.test(line), "the tag must name the slot it fills");
});

test("_cpMatLine adds no substitute tag when the material is its own source", () => {
  const line = _cpMatLine({
    matId: "T8_PLANKS", origMatId: "T8_PLANKS", count: 20,
    sourcing: { perUnit: 1000, source: "market", city: FS },
  }, FS);
  assert.ok(!/substitute/.test(line), `unexpected substitute tag: ${line}`);
});

// ── the "best path" line ────────────────────────────────────────────────────
//
// It used to be an expandable panel row opened from a "▸ best path" toggle. The
// expander is gone: a row has exactly one path, so every material prints its own
// route inline instead of hiding it behind a click.

test("no row offers a paths toggle or emits a panel row any more", () => {
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  assert.ok(!html.includes("data-paths-toggle"), "the toggle is gone");
  assert.ok(!html.includes("cp-paths-row"), "the panel row is gone");
});

test("every material prints one best-path line, in a priced and a no-data row", () => {
  renderCraftPlannerTable(market);
  const checked = [captured.rows.find((r) => !r.noData), captured.rows.find((r) => r.noData)]
    .filter(Boolean);
  assert.ok(checked.length, "the fixture produced no rows to check");
  checked.forEach((row) => {
    const key = getRowKeyLocal(row);
    const rowHtml = captured.html.find((h) => h.includes(`data-row-key="${key}"`));
    assert.ok(rowHtml, `no markup for ${key}`);
    const mats = rowHtml.slice(rowHtml.indexOf('class="cell-mats"'));
    const lines = (mats.match(/class="cp-best-path"/g) || []).length;
    assert.strictEqual(lines, row.sourcing.length,
      `expected one best-path line per material for ${key}`);
    assert.ok(mats.includes("best path:"), `expected the label on ${key}`);
  });
});

test("the whole planner renders without a formatter exception", () => {
  renderCraftPlannerTable(market);
  assert.ok(!captured.html.join("\n").includes("ERR:"), "no formatter exceptions");
});

// A board's "Jump to" aims a crafting play here by ITEM ID, because the planner
// keys rows `id|section` and keeps one row per (item, section) — a key carried
// over from the Crafting table (`id|craftCity`) would not match. The Materials
// and Journal cells print item ids of their own (a combine cape's material line
// is literally another row's id), so the anchor has to be on the <tr> itself or
// the jump lands on the wrong row.
test("every row carries its item id on the <tr>, for the board's Jump", () => {
  renderCraftPlannerTable(market);
  const priced = captured.rows.find((r) => !r.noData);
  const noData = captured.rows.find((r) => r.noData);
  const checked = [priced, noData].filter(Boolean);
  assert.ok(checked.length, "the fixture produced no rows to check");
  checked.forEach((row) => {
    const key = getRowKeyLocal(row);
    const rowHtml = captured.html.find((h) => h.includes(`data-row-key="${key}"`));
    assert.ok(rowHtml, `no markup for ${key}`);
    const tr = rowHtml.slice(rowHtml.indexOf("<tr"), rowHtml.indexOf(">") + 1);
    assert.ok(tr.includes(`data-item-id="${row.item.id}"`),
      `the <tr> for ${key} must carry the item id, got: ${tr}`);
  });

});

// ── a sell pin the craft city cannot reach ──────────────────────────────────
//
// Typing a price pins its city (setCityForce, js/app.js). The Black Market is
// only sellable from Caerleon, so a royal row has to drop that pin — and say
// so, because My Crafting List replays this very row, where an override that
// silently stops applying reads as an override that was lost.

const BM = "Black Market";
const ROYAL_CITIES_T = ["Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
function realCrossRoute(buyCity, sellCity) {
  if (!buyCity || !sellCity) return true;
  if (sellCity === BM && buyCity !== "Caerleon") return true;
  if (ROYAL_CITIES_T.includes(buyCity) && sellCity === "Caerleon") return true;
  if (buyCity === "Caerleon" && ROYAL_CITIES_T.includes(sellCity)) return true;
  return false;
}

test("a dropped sell pin is named on the row that dropped it", () => {
  __setCrossRoute(realCrossRoute);
  __setForce({ T8_FURNITUREITEM_TABLE: { sell: BM } });
  try {
    renderCraftPlannerTable(market);
    const rows = captured.rows
      .map((r, i) => ({ r, html: captured.html[i] }))
      .filter(({ r }) => r.item.id === "T8_FURNITUREITEM_TABLE");
    // The fixture prices only Fort Sterling, so the item's Caerleon candidate
    // never prices (its zone pool is {Caerleon}) — it stays in the row set as
    // the dead section's gate-hidden placeholder, and the item renders one
    // PRICED royal row: the assertion is about the row that survived — the
    // note is carried exactly when THAT row's craft city had to drop the pin.
    assert.strictEqual(rows.length, 2, "priced royal row + dead Caerleon twin");
    const priced = rows.filter(({ r }) => !r.noData);
    assert.strictEqual(priced.length, 1, "one priced row per item");
    assert.strictEqual(
      rows.filter(({ r }) => r.craftCity === "Caerleon" && r.noData).length, 1,
      "the dead Caerleon twin stays as a placeholder");
    const { r, html } = priced[0];
    if (r.craftCity === "Caerleon") {
      assert.strictEqual(r.sellPinDropped, null, "Caerleon reaches the Black Market");
      assert.ok(!html.includes("pinned at Black Market"),
        "the row that honours the pin must not carry the note");
    } else {
      assert.strictEqual(r.sellPinDropped, BM, "a royal row cannot reach the Black Market");
      assert.ok(html.includes("pinned at Black Market"),
        "expected the dropped-pin note in the royal row: " + html.slice(0, 400));
    }
  } finally {
    __setForce({});
    __setCrossRoute(null);
  }
});

test("no pin means no note anywhere", () => {
  __setCrossRoute(realCrossRoute);
  try {
    renderCraftPlannerTable(market);
    assert.ok(!captured.html.join("\n").includes("pinned at"),
      "an unpinned table must render no pin notes");
  } finally {
    __setCrossRoute(null);
  }
});

finish();
