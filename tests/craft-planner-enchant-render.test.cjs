/**
 * Test (TLD): the Crafting Planner rows booked as bought-then-enchanted
 * (row.enchantedVia, js/craft-planner-enchant-route.js).
 *
 * When buying the @(n-1) item and enchanting it up beats crafting it from
 * enchanted resources, the row renders differently:
 *   • the Materials cell shows TWO lines — the base item and the rune/soul/
 *     relic — on the same _cpMatLineBody markup (editable price spans), with
 *     the enchant "best path" line under them;
 *   • Journal Fill, Laborer Journal, Best Focus and Profit / 10k render their
 *     dim dash (the enchant route crafts nothing, so it fills no journal and
 *     takes no focus);
 *   • the profit breakout shows just "craft" (no refine / journal parts).
 *
 * Drives the REAL render + pricing + enchant-route modules through the shared
 * harness (stitched sources, renderTableData capture, no DOM). No live API.
 *
 * Run: node tests/craft-planner-enchant-render.test.cjs
 */

const assert = require("assert");
const {
  renderCraftPlannerTable, captured, _cpEnchantViaCell, cpEnchantPathLine,
} = require("./helpers/craft-planner-render-harness.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS = "Fort Sterling";
// T8 plate armor @1: the craft route buys the enchanted bar dear; the enchant
// route buys the plain armor + a T8 rune (ARMOR slot → 192). Enchant must win.

// Plain object literal with the ids the enchant route needs.
function enchantMarket() {
  return {
    T8_ARMOR_PLATE_SET1: { [FS]: { buy_price: 1000, volume_24h: 500 } },
    T8_RUNE: { [FS]: { buy_price: 100, volume_24h: 500 } },
    "T8_METALBAR_LEVEL1@1": { [FS]: { buy_price: 9000, volume_24h: 500 } },
    "T8_ARMOR_PLATE_SET1@1": { [FS]: { sell_price: 80000, volume_24h: 120 } },
  };
}

// The priced .1 row (the .2-.4 siblings stay no-data: unpriced).
function enchantedRow() {
  renderCraftPlannerTable(enchantMarket());
  const i = captured.rows.findIndex((r) => !r.noData && r.item
    && r.item.id === "T8_ARMOR_PLATE_SET1@1");
  assert.ok(i >= 0, "fixture sanity: expected a priced T8_ARMOR_PLATE_SET1@1 row");
  return { row: captured.rows[i], html: captured.html[i] };
}

console.log("craft-planner enchantedVia rows (TLD)\n");

test("the planner books the enchant route on the .1 row", () => {
  const { row } = enchantedRow();
  assert.ok(row.enchantedVia, "expected enchantedVia");
  assert.strictEqual(row.enchantedVia.baseId, "T8_ARMOR_PLATE_SET1");
  assert.strictEqual(row.enchantedVia.matId, "T8_RUNE");
  assert.strictEqual(row.enchantedVia.matCount, 192);
});

test("the Materials cell renders exactly two mat lines + the enchant path line", () => {
  const { html } = enchantedRow();
  assert.strictEqual((html.match(/class="cp-mat-line"/g) || []).length, 2,
    "expected the base line and the rune line only");
  assert.ok(html.includes("enchant it yourself"), "expected the enchant path line");
  assert.ok(html.includes("buy T8_ARMOR_PLATE_SET1 + 192× T8_RUNE"),
    "expected the path to name what to buy");
  assert.ok(!html.includes("(refine") && !html.includes("refine it yourself"),
    "no craft-route sourcing lines may survive");
});

test("both mat lines keep the click-to-edit price spans", () => {
  const { html } = enchantedRow();
  assert.ok(html.includes("data-item-id='T8_ARMOR_PLATE_SET1'"), "base span editable");
  assert.ok(html.includes("data-item-id='T8_RUNE'"), "rune span editable");
});

test("journal, laborer, focus and 10k cells render their dim dash", () => {
  const { row, html } = enchantedRow();
  assert.strictEqual(row.journal, null);
  assert.strictEqual(row.laborerJournal, null);
  assert.strictEqual(row.bestFocusStep, null);
  assert.strictEqual(row.profitPer10kFocus, null);
  // Journal Fill, Laborer Journal and Best Focus share the dash span markup;
  // Profit / 10k renders it inside a <td>.
  const dashes = html.match(/color:#6b7280;font-style:italic/g) || [];
  assert.ok(dashes.length >= 4, `expected 4+ dash cells, got ${dashes.length}`);
  assert.ok(!html.includes("Blacksmith"), "no journal tag may survive");
});

test("the profit breakout shows just craft (no refine / journal parts)", () => {
  const { html } = enchantedRow();
  assert.ok(!html.includes("+ refine"), "refineSavings is zeroed");
  assert.ok(!html.includes("+ journal"), "journal fill is zeroed");
  assert.ok(!html.includes("= craft"), "a lone craft part needs no breakout");
});

test("the cost cell carries the enchant cost, not the craft cost", () => {
  const { row } = enchantedRow();
  const expected = (1000 + 192 * 100) * 1.025;
  assert.ok(Math.abs(row.refineCraftCost - expected) < 1e-9,
    `expected ${expected}, got ${row.refineCraftCost}`);
  assert.ok(row.refineCraftCost < 16 * 9000, "well under the craft route's bars");
});

test("_cpEnchantViaCell degrades on junk input, cpEnchantPathLine on null", () => {
  assert.strictEqual(cpEnchantPathLine(null), "");
  const fake = {
    enchantedVia: {
      baseId: "T5_MAIN_SWORD", baseCity: FS, basePrice: 100,
      matId: "T5_RUNE", matCount: 288, matCity: FS, matPrice: 10, cost: 400,
    },
    craftCity: FS,
  };
  const html = _cpEnchantViaCell(fake);
  assert.strictEqual((html.match(/class="cp-mat-line"/g) || []).length, 2);
  assert.ok(html.includes("enchant it yourself"));
});

// A .3 row whose relic leg is transmuted up from a cheaper Soul.
function transmutedRelicRow() {
  renderCraftPlannerTable({
    "T8_ARMOR_PLATE_SET1@2": { [FS]: { buy_price: 1000, volume_24h: 500 } },
    T8_RELIC: { [FS]: { buy_price: 900_000, volume_24h: 500 } },
    T8_SOUL: { [FS]: { buy_price: 100, volume_24h: 500 } },
    "T8_METALBAR_LEVEL3@3": { [FS]: { buy_price: 90_000_000, volume_24h: 500 } },
    "T8_ARMOR_PLATE_SET1@3": { [FS]: { sell_price: 99_000_000, volume_24h: 120 } },
  });
  const i = captured.rows.findIndex((r) => !r.noData && r.item
    && r.item.id === "T8_ARMOR_PLATE_SET1@3");
  assert.ok(i >= 0, "fixture sanity: expected a priced T8_ARMOR_PLATE_SET1@3 row");
  return { row: captured.rows[i], html: captured.html[i] };
}

test("a transmuted relic leg shops the Soul and tags the path (via transmute)", () => {
  const { row, html } = transmutedRelicRow();
  assert.ok(row.enchantedVia && row.enchantedVia.matSourcing, "expected a transmuted relic leg");
  assert.strictEqual(row.enchantedVia.matSourcing.buyId, "T8_SOUL");
  assert.ok(html.includes("data-item-id='T8_SOUL'"), "the mat line must edit the bought Soul");
  assert.ok(html.includes("192x T8_SOUL"), "the mat line names the bought count");
  assert.ok(html.includes("enchant it yourself"), "enchant path line kept");
  assert.ok(html.includes("(via transmute)"), "transmute tag missing");
});

test("a market relic leg carries no transmute tag", () => {
  const { html } = enchantedRow();
  assert.ok(!html.includes("via transmute"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
