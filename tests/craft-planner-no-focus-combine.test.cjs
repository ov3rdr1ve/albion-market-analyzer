/**
 * Test: Crafting Planner rows that genuinely have NO Profit / 10k Focus.
 *
 * The user's My Crafting List (2026-10-03) showed a dash for Master's Royal
 * Sandals [T6] and Elder's Demon Cape [T8.4] under Profit / 10k Focus, Journal
 * Fill, Laborer Journal and Best Focus. That is the game data, not a bug: both
 * are COMBINE crafts (finished base item + Royal Sigils / Demon Crest + tokens)
 * with craftingfocus="0" and maxreturnamount="0" on every input, and neither
 * appears in any journal's <craftitemfame> list. This pins that reading of
 * items.xml, and that the dash now explains itself on hover.
 *
 * Run: node tests/craft-planner-no-focus-combine.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const ITEMS_XML = fs.readFileSync(path.join(ROOT, "data", "dumps", "items.xml"), "utf8");
const FOCUS_COSTS = JSON.parse(fs.readFileSync(path.join(ROOT, "js/focus-costs.json"), "utf8"));
const { CRAFT_JOURNAL_BY_ITEM } = require("../js/data-craft-journal-fame.js");

/** The <...item uniquename="id" ...> ... </...item> block for one item. */
function itemBlock(id) {
  const at = ITEMS_XML.indexOf(`uniquename="${id}"`);
  assert.ok(at > 0, `${id} not in items.xml`);
  const open = ITEMS_XML.lastIndexOf("<", at);
  const tag = ITEMS_XML.slice(open + 1, at).trim().split(/\s/)[0];
  const end = ITEMS_XML.indexOf(`</${tag}>`, at);
  return ITEMS_XML.slice(open, end);
}

// The two rows from the screenshot, base ids (T8.4 is the @4 enchant of the
// same item — its <enchantment level="4"> block lives inside this one).
const COMBINES = ["T6_SHOES_CLOTH_ROYAL", "T8_CAPEITEM_DEMON"];

console.log("\n=== items.xml: zero-focus combine crafts ===");

for (const id of COMBINES) {
  test(`${id}: every recipe (all enchants) is craftingfocus=0 with no returnable input`, () => {
    const block = itemBlock(id);
    const reqs = block.match(/<craftingrequirements\b[^>]*>/g) || [];
    assert.ok(reqs.length >= 5, `expected base + enchant recipes, got ${reqs.length}`);
    for (const r of reqs) assert.match(r, /craftingfocus="0"/);
    const res = block.match(/<craftresource\b[^>]*>/g) || [];
    for (const r of res) assert.match(r, /maxreturnamount="0"/, r);
  });

  test(`${id}: no focus cost and no crafting journal in the app's data`, () => {
    for (const v of ["", "@1", "@2", "@3", "@4"]) assert.ok(!FOCUS_COSTS[id + v], `${id + v} has a focus cost`);
    assert.ok(!(id in CRAFT_JOURNAL_BY_ITEM), `${id} maps to a journal`);
  });
}

test("their base items DO cost focus (the focus is paid crafting the base)", () => {
  assert.strictEqual(FOCUS_COSTS.T6_SHOES_CLOTH_SET1, 1313);
  assert.ok(FOCUS_COSTS["T8_CAPE@4"] > 0);
});

console.log("\n=== The dash explains itself ===");

const ctx = { console, module: undefined, FOCUS_COSTS };
vm.createContext(ctx);
// Real focus-cost lookup (enchant fallback included) and the real cell renderer.
vm.runInContext(`
  function getBaseFocusCost(itemId) { return FOCUS_COSTS[itemId] || FOCUS_COSTS[String(itemId).replace(/@\\d+$/, "")] || 0; }
  function getCraftFocusCost(itemId) { return getBaseFocusCost(itemId); }
  function formatSilver(n) { return String(Math.round(n)); }
  function tx(en) { return en; }
`, ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/focus-play.js"), "utf8"), ctx);
// Only the per-10k cell is needed; pull it out rather than booting the renderer.
const RENDER = fs.readFileSync(path.join(ROOT, "js/render-craft-planner.js"), "utf8");
const cellSrc = RENDER.slice(RENDER.indexOf("function _cpPer10kCell(row)"));
// The function ends at the first column-0 brace. Matched with an optional \r:
// a Windows checkout (core.autocrlf) has CRLF endings, and a plain "\n}\n"
// search missed, sliced to "fu" and threw "fu is not defined".
const cellEnd = /\r?\n\}\r?\n/.exec(cellSrc);
vm.runInContext(cellSrc.slice(0, cellEnd.index + cellEnd[0].length), ctx);

for (const [id, tier] of [["T6_SHOES_CLOTH_ROYAL", 6], ["T8_CAPEITEM_DEMON@4", 8]]) {
  test(`${id}: dash with the combine-craft tooltip`, () => {
    const html = ctx._cpPer10kCell({ item: { id }, tier, profitPer10kFocus: null, focusPerCraft: 0 });
    assert.match(html, />—<\/td>$/);
    assert.match(html, /title="No focus to spend here: this is a combine craft/);
  });
}

test("a focus-craftable row that still dashes gets no combine tooltip", () => {
  const html = ctx._cpPer10kCell({ item: { id: "T6_SHOES_CLOTH_SET1" }, tier: 6, profitPer10kFocus: null, focusPerCraft: 0 });
  assert.ok(!/title=/.test(html), html);
});

test("an enchanted-via-station row gets no combine tooltip", () => {
  const html = ctx._cpPer10kCell({ item: { id: "T8_CAPEITEM_DEMON@4" }, tier: 8, enchantedVia: {}, profitPer10kFocus: null, focusPerCraft: 0 });
  assert.ok(!/title=/.test(html), html);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
