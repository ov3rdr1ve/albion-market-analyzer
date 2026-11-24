/**
 * Test: the Black Market only trades EQUIPMENT.
 *
 * Reported: the Black Market Opportunities board offered "sell Potatoes
 * [T6 Ingredient] at the Black Market" — the Black Market has no consumables
 * order book at all. Measured against a real saved scan (9 873 items), every
 * one of the 4 890 ids the Black Market actually quotes falls in eight
 * marketplace categories: melee, magic, ranged, offhand, armor, accessories
 * (bags + capes), gatherergear and tools. Not one consumable, resource,
 * journal, mount, farming product or trophy carries a Black Market number.
 *
 * The bucket AODP returns for the other ~5 000 ids is all zeroes
 * (tests/bm-board-scan.test.cjs documents that), so the price gate normally
 * hides them — but a stale cell, a captured reading mis-attributed to
 * location 3003, or a hand-typed override puts a number in that bucket and
 * every table that lists the Black Market as a sell city will route to it.
 * So the gate is on the ITEM, not on the number.
 *
 * Two layers are checked here:
 *   - isBlackMarketTradable, the predicate itself;
 *   - getSellPrice / getQualitySellPrice in the REAL js/utils.js, which must
 *     answer 0 for a Black Market leg on an untradable item however good the
 *     entry looks — including when an override carries the price.
 *
 * No market API, no database — synthetic order books only.
 *
 * Run: node tests/black-market-tradable.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BM = "Black Market";

// ── The predicate, on its own ───────────────────────────────────────────────
const {
  isBlackMarketTradable, BM_TRADED_CATEGORIES,
} = require("../js/black-market-items.js");

const PREDICATE_CASES = [
  // [item id, tradable, why]
  ["T6_POTATO", false, "products|farming — the reported row"],
  ["T6_MEAL_STEW", false, "consumables|cooked"],
  ["T7_FISH_FRESHWATER_HIGHLANDS_RARE", false, "consumables|fish — Thunderfall Lurcher"],
  ["T5_POTION_HEAL", false, "consumables|potion"],
  ["T6_CLOTH", false, "resources|cloth"],
  ["T5_CLOTH_LEVEL3@3", false, "an enchanted refined resource is still a resource"],
  ["T8_JOURNAL_WARRIOR_EMPTY", false, "products|journal"],
  ["T8_MOUNT_HORSE", false, "mounts|ridinghorse"],
  ["T6_FARM_POTATO_SEED", false, "farming|seed"],
  ["T5_FURNITUREITEM_TROPHY_GENERAL", false, "trophies|generaltrophy"],
  ["T4_ARTEFACT_2H_ARCANESTAFF_HELL", false, "a raw artifact is not a dropped weapon"],
  ["T2_LABOURER_CONTRACT_FIBER", false, "labourers|fibercontract"],

  ["T4_CAPE", true, "accessories|cape"],
  ["T8_CAPEITEM_FW_MARTLOCK", true, "a faction cape is a cape"],
  ["T6_BAG", true, "accessories|bag"],
  ["T8_MAIN_SWORD", true, "melee|sword"],
  ["T8_MAIN_SWORD@3", true, "enchant level does not change the category"],
  ["T7_2H_BOW", true, "ranged|bow"],
  ["T6_MAIN_FIRESTAFF", true, "magic|firestaff"],
  ["T5_OFF_SHIELD", true, "offhand|shield"],
  ["T4_ARMOR_PLATE_SET1", true, "armor|plate_armor"],
  ["T6_HEAD_CLOTH_SET2", true, "armor|cloth_helmet"],
  ["T5_2H_TOOL_PICK", true, "tools|pickaxe"],
  ["T6_BACKPACK_GATHERER_ORE", true, "gatherergear|oregatherer_backpack"],
];

PREDICATE_CASES.forEach(([id, want, why]) => {
  assert.strictEqual(
    isBlackMarketTradable(id), want,
    `${id}: expected tradable=${want} (${why})`,
  );
});

// A per-quality view key (js/flip-route-quality.js) is the same item.
assert.strictEqual(isBlackMarketTradable("T8_MAIN_SWORD#Q3"), true,
  "a #Qn view of a sword is still a sword");
assert.strictEqual(isBlackMarketTradable("T6_POTATO#Q2"), false,
  "a #Qn view of a potato is still a potato");

// Nothing at all is not tradable — but it must not throw either.
[null, undefined, "", 0, 12, {}].forEach((id) => {
  assert.strictEqual(isBlackMarketTradable(id), false, `${String(id)} is not an item`);
});

// An id the category map has never heard of PASSES. The gate removes rows that
// cannot be real; it must not delete a genuine gear play because the generated
// map lagged an items.xml refresh. Such an id still needs a Black Market price
// to reach a table at all.
assert.strictEqual(isBlackMarketTradable("T9_SOMETHING_NOT_SHIPPED_YET"), true,
  "an unknown category is not a verdict");

// The allowlist is the eight categories the live book was measured to hold.
assert.deepStrictEqual(
  [...BM_TRADED_CATEGORIES].sort(),
  ["accessories", "armor", "gatherergear", "magic", "melee", "offhand", "ranged", "tools"],
);

// ── The real js/utils.js price readers ──────────────────────────────────────
const elements = { "sort-instant": { checked: true } }; // instant: read the bid
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
sandbox.document = { getElementById: (id) => elements[id] || null };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const ctx = vm.createContext(sandbox);
const load = (file) => vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js", file), "utf8"), ctx, { filename: file },
);
// Browser load order: the category map, then the predicate, then utils.
load("data-item-categories.js");
load("black-market-items.js");
(load("utils.js") + load("utils-item-ids.js") + load("utils-overrides.js") + load("utils-focus-fees.js"));
vm.runInContext(
  "globalThis.__exp = { getSellPrice, getQualitySellPrice, getIQRBounds, priceOverrides };",
  ctx,
);
const { getSellPrice, getQualitySellPrice, getIQRBounds } = sandbox.__exp;

const book = (buy, sell) => ({
  buy_price: buy, sell_price: sell,
  buy_date: "2026-08-25T00:00:00", sell_date: "2026-08-25T00:00:00",
  volume_24h: 400000,
});

// The reported shape: a Black Market bucket carrying a number for a consumable.
const potato = { [BM]: book(530, 560), Caerleon: book(437, 460) };
const cape = { [BM]: book(48960, 52000), Caerleon: book(31779, 33000) };

assert.strictEqual(
  getSellPrice(potato, BM, getIQRBounds(potato), "T6_POTATO"), 0,
  "a consumable has no Black Market price however good the bucket looks",
);
assert.strictEqual(
  getSellPrice(potato, "Caerleon", getIQRBounds(potato), "T6_POTATO"), 437,
  "the gate is on the Black Market leg only — city prices are untouched",
);
assert.strictEqual(
  getSellPrice(cape, BM, getIQRBounds(cape), "T4_CAPEITEM_FW_BRIDGEWATCH"), 48960,
  "gear still reads its Black Market bid",
);

// An override cannot revive an order book that does not exist.
sandbox.__exp.priceOverrides["T6_POTATO"] = { [BM]: { sellOrder: 999, use: "sell" } };
assert.strictEqual(
  getSellPrice(potato, BM, getIQRBounds(potato), "T6_POTATO"), 0,
  "a hand-typed Black Market price for a consumable is still not a market",
);
delete sandbox.__exp.priceOverrides["T6_POTATO"];

// Per-quality reader, same rule.
const qmap = {
  T6_POTATO: { 2: { [BM]: book(530, 560), Caerleon: book(437, 460) } },
  T8_MAIN_SWORD: { 2: { [BM]: book(1200000, 1300000) } },
};
assert.strictEqual(getQualitySellPrice(qmap, "T6_POTATO", 2, BM), 0);
assert.strictEqual(getQualitySellPrice(qmap, "T6_POTATO", 2, "Caerleon"), 437);
assert.strictEqual(getQualitySellPrice(qmap, "T8_MAIN_SWORD", 2, BM), 1200000);

// A caller with no item id (aggregate rows) must not be silently zeroed.
assert.strictEqual(
  getSellPrice(cape, BM, null, null), 48960,
  "no item id means no category to judge — read the book",
);

console.log("black-market-tradable: all assertions passed");
