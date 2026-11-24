/**
 * Test: laborer-journal-value — what a crafting journal is worth when you HAND
 * IT TO YOUR OWN LABORER instead of selling it on the market.
 *
 * The Crafting Planner's journal column values a filled journal as
 * (full sell − empty buy). This module models the other play: you keep one set
 * of empty journals, fill them with the crafting fame you earn anyway, feed them
 * to your laborer, and sell what the laborer returns. The empty journal comes
 * BACK with the loot, so it is never re-bought — journal market prices do not
 * enter the maths at all.
 *
 * Black-box: feed synthetic market data + a recipe, assert the payout per
 * journal, the ±2-tier journal choice, silver/fame, and the extra silver folded
 * into one craft.
 *
 * Run: node tests/laborer-journal-value.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const sandbox = `
const PREMIUM_TAX = 0.065;
function getIQRBounds() { return { upper: Infinity }; }
function getSellPrice(itemData, city) { return (itemData && itemData[city] && itemData[city].sell_price) || 0; }
function getTierFromId(id) { const m = id && id.match(/^T(\\d+)/); return m ? parseInt(m[1], 10) : 4; }
// Mirrors render-crafting.js — artifact-style mats award no crafting fame.
function isNonReturnableCraftMat(matId) {
  return matId.includes("ARTEFACT") || matId.includes("_FACTION_") || matId.includes("_MOUNT_");
}
`;

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const mod = new Module("laborer-journal-value-test");
mod._compile(
  sandbox +
    loadFile("js/data-laborers.js") +
    loadFile("js/data-craft-journal-fame.js") +
    loadFile("js/data-craft-planner.js") +
    loadFile("js/laborers-pricing.js") +
    loadFile("js/render-laborers.js") +
    loadFile("js/laborer-journal-value.js") +
    "\nmodule.exports = { getLaborerJournalFill, laborerJournalPayout, " +
    "getLaborerJournalYield, getLaborerJournalPayoutIds, LABORER_JOURNAL_ASSUMED_TIER };",
  "laborer-journal-value.js"
);
const {
  getLaborerJournalFill,
  laborerJournalPayout,
  getLaborerJournalYield,
  getLaborerJournalPayoutIds,
  LABORER_JOURNAL_ASSUMED_TIER,
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
    out[e.id][e.city] = { buy_price: e.buy || 0, sell_price: e.sell || 0, volume_24h: 9999 };
  }
  return out;
}

const FS = "Fort Sterling";
const TAX = 1 - 0.065;
const BASE_SHARE = 1889 / 2000; // enchant lootlist: base share at T4+

// A T8 plate chest: WARRIOR journal (Blacksmith), 32 metal bars.
const PLATE = { id: "T8_ARMOR_PLATE_SET1", name: "Elder's Plate Armor", craftType: "plate_armor" };
const PLATE_MATS = [{ matId: "T8_METALBAR", count: 32 }];

// Blacksmith returns METALBAR .70 / PLANKS .20 / CLOTH .10
function refinedPrices(tier, metal, planks, cloth) {
  return [
    { id: `T${tier}_METALBAR`, city: FS, sell: metal },
    { id: `T${tier}_PLANKS`, city: FS, sell: planks },
    { id: `T${tier}_CLOTH`, city: FS, sell: cloth },
  ];
}

// ── Yield rule ─────────────────────────────────────────────────────────────
console.log("\n=== Yield: a lower-tier journal runs at the 150% ceiling ===");

test("journal below the laborer tier yields 1.5", () => {
  assert.strictEqual(getLaborerJournalYield(6, 8), 1.5);
  assert.strictEqual(getLaborerJournalYield(2, 8), 1.5);
});

test("journal AT the laborer tier follows that laborer's own trophies", () => {
  // items.xml has no trophy targeting a crafting laborer, so a T8 Blacksmith on
  // a T8 journal collects the general 5s alone: 800 base + 40 = 840 → 120%.
  assert.ok(Math.abs(getLaborerJournalYield(8, 8, "WARRIOR") - 1.2) < 1e-9);
  ["HUNTER", "MAGE", "TOOLMAKER"].forEach((slug) => {
    assert.ok(Math.abs(getLaborerJournalYield(8, 8, slug) - 1.2) < 1e-9, slug);
  });
  // A gatherer or the mercenary also has its own +10 trophies, so it reaches
  // the 150% cap on an own-tier journal.
  ["ORE", "WOOD", "FIBER", "HIDE", "STONE", "FISHING", "MERCENARY"].forEach((slug) => {
    assert.ok(Math.abs(getLaborerJournalYield(8, 8, slug) - 1.5) < 1e-9, slug);
  });
});

test("an unnamed laborer gets the general trophies only, never a promised 1.5", () => {
  // The safe direction: understate a gatherer rather than promise a crafting
  // laborer a yield no trophy in the game can buy.
  assert.ok(Math.abs(getLaborerJournalYield(8, 8) - 1.2) < 1e-9);
  assert.ok(Math.abs(getLaborerJournalYield(5, 5, null) - 1.2) < 1e-9);
});

test("a lower-tier journal ignores the trophies entirely — it is already capped", () => {
  ["WARRIOR", "ORE", null, undefined].forEach((slug) => {
    assert.strictEqual(getLaborerJournalYield(6, 8, slug), 1.5, `slug ${slug}`);
  });
});

test("the assumed laborer is max tier (T8)", () => {
  assert.strictEqual(LABORER_JOURNAL_ASSUMED_TIER, 8);
});

// ── Payout per journal ─────────────────────────────────────────────────────
console.log("\n=== Payout: one full journal handed to the laborer ===");

test("T8 WARRIOR journal payout = baseloot × yield × mix × price × (1−tax)", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const p = laborerJournalPayout("WARRIOR", 8, md, FS);
  // baseloot T8 = 4.2, own-tier yield 1.2 (WARRIOR is a crafting laborer, so
  // the general trophies are all it can collect), base enchant share 0.94450
  // (the .1-.3 ids are unpriced here, so only the base share earns).
  const perUnit = 0.7 * 3000 + 0.2 * 1000 + 0.1 * 2000;
  const expected = 4.2 * 1.2 * BASE_SHARE * perUnit * TAX;
  assert.ok(p.hasData, "payout should have data");
  assert.ok(Math.abs(p.revenue - expected) < 0.01, `got ${p.revenue}, want ${expected}`);
});

test("a lower-tier journal is valued at the 1.5 ceiling", () => {
  const md = priceMap(refinedPrices(6, 900, 300, 600));
  const p = laborerJournalPayout("WARRIOR", 6, md, FS);
  const perUnit = 0.7 * 900 + 0.2 * 300 + 0.1 * 600;
  const expected = 5.3333 * 1.5 * BASE_SHARE * perUnit * TAX;
  assert.ok(Math.abs(p.revenue - expected) < 0.01, `got ${p.revenue}, want ${expected}`);
});

test("unpriced refined output → no data, zero revenue", () => {
  const p = laborerJournalPayout("WARRIOR", 8, {}, FS);
  assert.strictEqual(p.hasData, false);
  assert.strictEqual(p.revenue, 0);
});

test("a slug with no crafting laborer (gathering journal) has no payout", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const p = laborerJournalPayout("ORE", 8, md, FS);
  assert.strictEqual(p.hasData, false);
});

// ── What comes back, not just what it's worth ──────────────────────────────
// The payout total answers "how much silver"; `lines` answers "which refined
// materials, how many" — what a caller needs to print the return itself.
console.log("\n=== Payload breakdown (lines) ===");

test("one line per refined material in the mix, summing to the total revenue", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const p = laborerJournalPayout("WARRIOR", 8, md, FS);
  assert.ok(Array.isArray(p.lines), "lines should be an array");
  assert.strictEqual(p.lines.length, Object.keys(p.mix).length,
    "one line per mix entry, enchant twins folded in");
  const summed = p.lines.reduce((s, l) => s + l.silver, 0);
  assert.ok(Math.abs(summed - p.revenue) < 0.01, `${summed} != ${p.revenue}`);
});

test("each line names the base refined id and the quantity handed back", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const p = laborerJournalPayout("WARRIOR", 8, md, FS);
  const bar = p.lines.find((l) => l.itemId === "T8_METALBAR");
  assert.ok(bar, `expected a T8_METALBAR line, got ${p.lines.map((l) => l.itemId)}`);
  // baseloot T8 = 4.2 × own-tier yield 1.2 × the 0.7 metal share of the mix.
  assert.ok(Math.abs(bar.qty - 4.2 * 1.2 * 0.7) < 1e-9, `qty ${bar.qty}`);
  assert.ok(bar.qty > 0 && bar.silver > 0);
});

test("quantities are the whole enchant spread, priced silver only the priced part", () => {
  // Only the base ids are priced in this fixture, so silver rests on the base
  // share while qty still counts every unit the laborer returns.
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const p = laborerJournalPayout("WARRIOR", 8, md, FS);
  const bar = p.lines.find((l) => l.itemId === "T8_METALBAR");
  const barOnly = 4.2 * 1.2 * 0.7 * BASE_SHARE * 3000 * TAX;
  assert.ok(Math.abs(bar.silver - barOnly) < 0.01, `${bar.silver} != ${barOnly}`);
});

test("no crafting laborer → empty lines, never undefined", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  assert.deepStrictEqual(laborerJournalPayout("ORE", 8, md, FS).lines, []);
});

test("getLaborerJournalFill carries the mix and lines onto bestJournal", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const b = getLaborerJournalFill(PLATE, PLATE_MATS, FS, md).bestJournal;
  assert.ok(b.mix, "the mix should reach the caller");
  assert.ok(Array.isArray(b.lines) && b.lines.length > 0, "so should the lines");
  const summed = b.lines.reduce((s, l) => s + l.silver, 0);
  assert.ok(Math.abs(summed - b.payout) < 0.01, `${summed} != ${b.payout}`);
});

// ── Journal choice + per-craft value ───────────────────────────────────────
console.log("\n=== Fill: fame per craft × silver per fame ===");

test("a plate craft fills the WARRIOR journal", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const fill = getLaborerJournalFill(PLATE, PLATE_MATS, FS, md);
  assert.strictEqual(fill.slug, "WARRIOR");
  assert.strictEqual(fill.famePerCraft, 32 * 1395);
});

test("extra silver per craft = fame per craft × silver per fame", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const fill = getLaborerJournalFill(PLATE, PLATE_MATS, FS, md);
  const b = fill.bestJournal;
  assert.ok(b, "a journal should be priced");
  assert.ok(Math.abs(b.silverPerFame - b.payout / b.maxfame) < 1e-9);
  assert.ok(Math.abs(fill.extraSilverPerCraft - fill.famePerCraft * b.silverPerFame) < 0.01);
});

test("journal market prices are IRRELEVANT — the empty comes back from the laborer", () => {
  const base = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const withJournals = priceMap([
    ...refinedPrices(8, 3000, 1000, 2000),
    { id: "T8_JOURNAL_WARRIOR_EMPTY", city: FS, buy: 90000, sell: 90000 },
    { id: "T8_JOURNAL_WARRIOR_FULL", city: FS, buy: 1, sell: 1 },
  ]);
  const a = getLaborerJournalFill(PLATE, PLATE_MATS, FS, base);
  const b = getLaborerJournalFill(PLATE, PLATE_MATS, FS, withJournals);
  assert.ok(Math.abs(a.extraSilverPerCraft - b.extraSilverPerCraft) < 1e-9);
});

test("only the craft's OWN journal tier is worked — a richer T6 is ignored", () => {
  // T6 refined priced richly, T8 poorly. A T8 craft still cannot fill a T6
  // journal (items.xml lists only same-tier items under <craftitemfame>), so the
  // laborer play stays on T8 rather than quoting an unreachable journal.
  const md = priceMap([
    ...refinedPrices(8, 100, 100, 100),
    ...refinedPrices(6, 5000, 5000, 5000),
  ]);
  const fill = getLaborerJournalFill(PLATE, PLATE_MATS, FS, md);
  assert.strictEqual(fill.bestJournal.tier, 8);
});

test("a T5 journal is likewise out of reach for a T8 craft", () => {
  const md = priceMap([
    ...refinedPrices(8, 100, 100, 100),
    ...refinedPrices(5, 900000, 900000, 900000),
  ]);
  const fill = getLaborerJournalFill(PLATE, PLATE_MATS, FS, md);
  assert.strictEqual(fill.bestJournal.tier, 8);
});

test("no priced refined output anywhere → no journal, zero extra", () => {
  const fill = getLaborerJournalFill(PLATE, PLATE_MATS, FS, {});
  assert.strictEqual(fill.bestJournal, null);
  assert.strictEqual(fill.extraSilverPerCraft, 0);
});

test("a craft with no journal profession (food) returns null", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const soup = { id: "T8_MEAL_SOUP", name: "Soup", craftType: "food" };
  assert.strictEqual(getLaborerJournalFill(soup, [{ matId: "T8_FISH", count: 4 }], FS, md), null);
});

test("furniture fills the TOOLMAKER journal", () => {
  const md = priceMap([
    ...refinedPrices(8, 3000, 1000, 2000),
    { id: "T8_LEATHER", city: FS, sell: 2500 },
  ]);
  const table = { id: "T8_FURNITUREITEM_TABLE", name: "Elder's Table", craftType: null };
  const fill = getLaborerJournalFill(table, [{ matId: "T8_PLANKS", count: 30 }], FS, md);
  assert.strictEqual(fill.slug, "TOOLMAKER");
  assert.ok(fill.extraSilverPerCraft > 0);
});

test("artifact mats award no crafting fame", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const mats = [{ matId: "T8_METALBAR", count: 20 }, { matId: "T8_ARTEFACT_MAIN_SWORD", count: 1 }];
  const fill = getLaborerJournalFill(PLATE, mats, FS, md);
  assert.strictEqual(fill.famePerCraft, 20 * 1395);
});

test("an explicit non-artifact mat count overrides the recount", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const fill = getLaborerJournalFill(PLATE, PLATE_MATS, FS, md, 10);
  assert.strictEqual(fill.famePerCraft, 10 * 1395);
});

test("an enchanted craft earns DOUBLE fame per enchant level, at its own tier", () => {
  const md = priceMap(refinedPrices(8, 3000, 1000, 2000));
  const ench = { ...PLATE, id: "T6_ARMOR_PLATE_SET1@2", craftType: "plate_armor" };
  const fill = getLaborerJournalFill(ench, [{ matId: "T6_METALBAR_LEVEL2@2", count: 32 }], FS, md);
  // T6 mult (270) × 2^2, NOT the T8 row. The multiplier table is not a doubling,
  // so "+1 effective tier per enchant" gave 32 × 1395 — 29% too high. Measured in
  // game on a T4.2 craft: 24 mats × 22.5 × 2^2 = 2,160 (forum thread 167786).
  assert.strictEqual(fill.famePerCraft, 32 * 270 * 4);
});

// ── Scan ids ───────────────────────────────────────────────────────────────
console.log("\n=== Scan ids for the laborer payout ===");

test("payout ids cover every refined type × tier the mixes return", () => {
  const ids = new Set(getLaborerJournalPayoutIds());
  ["T8_METALBAR", "T8_PLANKS", "T8_CLOTH", "T8_LEATHER", "T2_METALBAR", "T6_CLOTH"].forEach((id) =>
    assert.ok(ids.has(id), `missing ${id}`),
  );
});

test("enchanted refined ids are included at T4+ and absent below", () => {
  const ids = new Set(getLaborerJournalPayoutIds());
  assert.ok(ids.has("T6_CLOTH_LEVEL2@2"), "missing T6_CLOTH_LEVEL2@2");
  assert.ok(ids.has("T8_METALBAR_LEVEL3@3"), "missing T8_METALBAR_LEVEL3@3");
  assert.ok(!ids.has("T3_PLANKS_LEVEL1@1"), "T3 enchant should not be listed");
});

test("no journal or contract ids leak into the payout id set", () => {
  const ids = getLaborerJournalPayoutIds();
  assert.ok(!ids.some((id) => id.includes("JOURNAL")), "journal ids are not needed");
  assert.ok(!ids.some((id) => id.includes("LABOURER_CONTRACT")), "contract ids are not needed");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
