/**
 * Black-box tests for the on-demand single-item search fetch
 * (js/table-search.js: idsFromRowKey, expandFetchIds, matchedPrimaryIds).
 *
 * The feature: pressing Enter in a table's search box, on a not-yet-scanned
 * table, fetches ONLY the matched item(s) + their recipe materials instead of a
 * full market scan. These three pure helpers do the id work:
 *
 *   idsFromRowKey(key)        → the game-id tokens inside a data-row-key
 *   matchedPrimaryIds(...)    → ids of the DOM rows matching the query
 *   expandFetchIds(ids)       → those ids grown to include recipe materials
 *
 * No live DOM, no network — simulated catalogs (globalThis) + a tiny fake DOM.
 *
 * Run: node tests/search-fetch.test.cjs
 */

const assert = require("assert");

// Catalogs the id-expansion consults, declared as bare globals BEFORE requiring
// the module (the module reads them via `typeof X !== "undefined"`).
globalThis.recipeCache = {
  T4_PLANKS: [{ matId: "T4_WOOD" }, { matId: "T3_PLANKS" }],
};
globalThis.MOUNT_RECIPES = [
  { id: "T5_MOUNT_HORSE", materials: [{ matId: "T5_FARM_HORSE_GROWN" }, { matId: "T5_LEATHER" }] },
];
globalThis.BREEDING_ITEMS = [
  { babyId: "T5_FARM_HORSE_BABY", grownId: "T5_FARM_HORSE_GROWN" },
];
globalThis.TRANSPORT_ITEMS = [
  { rawId: "T4_ORE", refinedId: "T4_METALBAR", secondaryMatId: "T3_METALBAR" },
];
// Real catalog shape (js/data-farming.js): the seed/animal is `id`, the harvested
// good is `outputId`. There is no seedId/cropId.
globalThis.FARMING_PRODUCTION = [
  { type: "crop", id: "T4_FARM_CARROT_SEED", outputId: "T4_CARROT" },
];
globalThis.CHAIN_RECIPES = {
  T1_FISHSAUCE: { inputs: [{ matId: "T1_FISHCHOPS" }, { matId: "T4_SEAWEED" }] },
};
// Gear materials live on the catalog entry, NOT in BUNDLED_RECIPES — this is
// the case the recipeCache path alone missed (bows rendered with no mats).
globalThis.CRAFTING_ITEMS = [
  { id: "T5_2H_BOW", name: "Bow", materials: [{ matId: "T5_PLANKS", count: 16 }] },
];
globalThis.GEAR_RECIPES = [
  { id: "T5_2H_BOW", name: "Bow", materials: [{ matId: "T5_PLANKS", count: 16 }] },
];
globalThis.CONSUMABLES = [];
// getRefiningChainIds — the transport refine chain for a refined id.
globalThis.getRefiningChainIds = (refinedId) =>
  refinedId === "T4_METALBAR" ? ["T3_METALBAR", "T3_ORE"] : [];
// fetchCraftingRecipe — normally async + network; here it's a no-op resolve
// (materials come from the pre-seeded recipeCache above).
globalThis.fetchCraftingRecipe = async () => null;
// Enchant helpers (js/data-enchanting.js): slot of an id, null when the id is
// not enchantable equipment. Faked here — only the contract matters.
globalThis.getTierFromId = (id) => {
  const m = id.match(/^T(\d)/);
  return m ? parseInt(m[1], 10) : 0;
};
globalThis.getEquipmentSlot = (id) =>
  /^T\d_(2H_|MAIN_|ARMOR_|BAG|BACKPACK|HEAD_|SHOES_|CAPE|OFF_)/.test(id) ? "slot" : null;
// Synthetic-id detector (mirrors api.js): "__" separator → not a real item.
globalThis.isSyntheticId = (name) => typeof name === "string" && name.includes("__");
// Transmute recipe feed (js/data-transmute.js). A transmute row prices a SOURCE
// and a TARGET, and a query only ever names one of them ("relic" never matches
// the Soul that "Soul → Relic" starts from), so both ends must be fetched.
// Trimmed to the T4/T5 relic neighbourhood — only the contract matters.
globalThis.getTransmuteRecipes = () => [
  { sourceId: "T4_SOUL", targetId: "T4_RELIC", sourceCount: 1, silverCost: 2890 },
  { sourceId: "T4_RELIC", targetId: "T4_SHARD_AVALONIAN", sourceCount: 1, silverCost: 2890 },
  { sourceId: "T4_RELIC", targetId: "T5_RELIC", sourceCount: 5, silverCost: 0 },
  { sourceId: "T4_RUNE", targetId: "T4_SOUL", sourceCount: 1, silverCost: 723 },
  { sourceId: "T4_RUNE", targetId: "T5_RUNE", sourceCount: 5, silverCost: 0 },
  { sourceId: "T4_ORE", targetId: "T5_ORE", sourceCount: 1, silverCost: 781 },
];

// tableSources() names every table's id-collection function eagerly, so all of
// them must exist for ANY table's lookup to resolve. Only the transmute one is
// exercised here; the rest are empty stand-ins.
[
  "getCraftPlannerItemIds", "getFlippingItemIds", "getFlippingSearchIds",
  "getSkinsItemIds", "getTransportItemIds", "getLaborersItemIds", "getBuildingsItemIds",
  "getConsumableItemIds", "getMountsItemIds", "getFactionSpendingItemIds",
  "getFarmingItemIds", "getGatheringItemIds",
  "getJournalItemIds",
].forEach((fn) => { globalThis[fn] = () => []; });

// The enchanting catalog (data-enchanting.js: getAllEnchantItemIds) emits each
// base id followed by its @1-@3 steps, and every enchanting ROW prices two
// adjacent levels (.0→.1, .1→.2, .2→.3). Its variants are displayed, not
// collapsed, so they must keep their place next to their base — a base-first
// reshuffle would fetch bases only and leave every row half-priced.
globalThis.getAllEnchantItemIds = () => {
  const ids = [];
  for (let tier = 4; tier <= 8; tier++) {
    const base = `T${tier}_MAIN_HAMMER`;
    ids.push(base);
    for (let e = 1; e <= 3; e++) ids.push(`${base}@${e}`);
  }
  for (let tier = 4; tier <= 8; tier++) ids.push(`T${tier}_RUNE`, `T${tier}_SOUL`, `T${tier}_RELIC`);
  return ids;
};

// The crafting catalog (utils.js: getCraftingItemIds) emits, per gear item, the
// base id followed immediately by its @1-@4 enchant variants — so a broad query
// like "hammer" matches ~5x more ids than the table shows rows for (the variants
// are collapsed until the base row is expanded). Sized like the real hammer
// family: 12 families x 5 tiers = 60 base ids, 300 total.
const HAMMER_FAMILIES = [
  "MAIN_HAMMER", "2H_HAMMER", "2H_POLEHAMMER", "2H_HAMMER_UNDEAD",
  "2H_DUALHAMMER_HELL", "2H_HAMMER_AVALON", "MAIN_HAMMER_HELL",
  "MAIN_HAMMER_UNDEAD", "MAIN_HAMMER_AVALON", "2H_HAMMER_KEEPER",
  "2H_HAMMER_MORGANA", "MAIN_HAMMER_MORGANA",
];
const CRAFT_BASE_HAMMER_IDS = [];
globalThis.getCraftingItemIds = () => {
  const ids = [];
  HAMMER_FAMILIES.forEach((fam) => {
    for (let tier = 4; tier <= 8; tier++) {
      const base = `T${tier}_${fam}`;
      ids.push(base);
      for (let e = 1; e <= 4; e++) ids.push(`${base}@${e}`);
    }
  });
  ids.push("T4_METALBAR", "T4_PLANKS"); // materials never match "hammer"
  return ids;
};
globalThis.getCraftingItemIds().forEach((id) => {
  if (!id.includes("@") && /HAMMER/.test(id)) CRAFT_BASE_HAMMER_IDS.push(id);
});

// Rerolling's id universe (js/data-rerolling.js): base T4-T8 equipment only.
globalThis.getQualityItemIds = () => ["T5_2H_BOW", "T6_2H_BOW", "T5_MAIN_SWORD"];

// Artifact Rolling's id universe (utils.js: getRollingItemIds): the fragments a
// meld consumes plus the artifacts it can produce. Crystal Shards and Fire
// Dragon Scales are absent on purpose — they are an Energy Manipulator exchange
// and scan with the Crafting table (js/data-energy-exchange.js).
globalThis.getRollingItemIds = () => [
  "T4_RUNE", "T4_SOUL", "T4_RELIC", "T4_SHARD_AVALONIAN",
  "T4_ARTEFACT_MAIN_SWORD_UNDEAD", "T5_ARTEFACT_MAIN_SWORD_UNDEAD",
];

// The Volume table has no dedicated catalog — its Enter-fetch universe is the
// same full-scan set the market scan uses (utils.js: getAllRequiredItemIds).
globalThis.getAllRequiredItemIds = () => [
  "T8_HIDE", "T4_HIDE", "T8_LEATHER", "T4_ORE", "T5_2H_BOW",
];

// The two price fetchers (js/api.js). Inert by default; the tests that care
// which one a table calls swap in their own capturing stub.
globalThis.fetchPricesBatch = async () => ({});
globalThis.fetchPricesBatchWithQualities = async () => ({});

// The Transmute table's scan-id universe (js/data-transmute.js) — the same
// function its scan button uses, so the two can't drift.
globalThis.getTransmuteItemIds = () => [
  "T4_RUNE", "T4_SOUL", "T4_RELIC", "T5_RELIC", "T4_SHARD_AVALONIAN", "T4_ORE", "T5_ORE",
  "T4_ROCK", "T5_ROCK",
];
// Localized display names (utils.js). Queries are typed against these, not ids.
// Resource families render as short labels ("4 rock"), NOT their proper names, so
// a query like "stone" only matches through the family aliases below.
globalThis.getItemDisplayName = (id) => ({
  T4_RUNE: "Adept's Rune",
  T4_SOUL: "Adept's Soul",
  T4_RELIC: "Adept's Relic",
  T5_RELIC: "Expert's Relic",
  T4_SHARD_AVALONIAN: "Avalonian Shard",
  T4_ORE: "4 ore",
  T5_ORE: "5 ore",
  T4_ROCK: "4 rock",
  T5_ROCK: "5 rock",
}[id] || id);
// Family search synonyms (resource-names.js). "stone"→rock, "metal"→ore, etc.
globalThis.resourceSearchAliases = (id) => {
  if (/_ROCK\b/.test(id)) return "rock stone";
  if (/_ORE\b/.test(id)) return "ore metal";
  return "";
};

// Scan results are folded into lastMarketData through the captured-price store
// so a fetch cannot erase what the live monitor captured (captured-prices-store.js).
globalThis.applyScanPatch = require("../js/captured-prices-store.js").applyScanPatch;
globalThis.applyQualityScanPatch = require("../js/captured-prices-store.js").applyQualityScanPatch;

const { idsFromRowKey } = require("../js/table-search.js");
const {
  expandFetchIds,
  matchedPrimaryIds,
  matchedCatalogIds,
  fetcherFor,
  MAX_SEARCH_FETCH_ITEMS,
  fetchCapNotice,
  prioritizeFetchIds,
  unpricedRowsNotice,
} = require("../js/table-search-fetch.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  PASS: ${name}`); passed++; })
    .catch((e) => { console.error(`  FAIL: ${name} — ${e.message}`); failed++; });
}

console.log("Search-fetch id helper tests\n");

// ── idsFromRowKey ───────────────────────────────────────────────────────────

test("idsFromRowKey: plain item key", () => {
  assert.deepStrictEqual(idsFromRowKey("T6_2H_BOW|Martlock"), ["T6_2H_BOW"]);
});

test("idsFromRowKey: keeps @n enchant suffix", () => {
  assert.deepStrictEqual(idsFromRowKey("T5_2H_BOW@4|Martlock"), ["T5_2H_BOW@4"]);
});

test("idsFromRowKey: laborer key (mode prefix) yields the journal id, not the mode", () => {
  assert.deepStrictEqual(
    idsFromRowKey("acquire|T8_JOURNAL_HIDE_FULL"),
    ["T8_JOURNAL_HIDE_FULL"],
  );
});

test("idsFromRowKey: transport key yields both raw and refined, skips city", () => {
  assert.deepStrictEqual(
    idsFromRowKey("T4_ORE|T4_METALBAR|Thetford|"),
    ["T4_ORE", "T4_METALBAR"],
  );
});

test("idsFromRowKey: lowercase section-only key has no ids", () => {
  assert.deepStrictEqual(idsFromRowKey("royal|caerleon|"), []);
});

test("idsFromRowKey: non-tier caps id (skins unlock token) still matches", () => {
  assert.deepStrictEqual(
    idsFromRowKey("UNIQUE_UNLOCK_MOUNT_VANITY"),
    ["UNIQUE_UNLOCK_MOUNT_VANITY"],
  );
});

test("idsFromRowKey: empty / null → []", () => {
  assert.deepStrictEqual(idsFromRowKey(""), []);
  assert.deepStrictEqual(idsFromRowKey(null), []);
});

// ── expandFetchIds ──────────────────────────────────────────────────────────

test("expandFetchIds: crafting output pulls in recipe materials", async () => {
  const out = await expandFetchIds(["T4_PLANKS"]);
  assert.ok(out.includes("T4_PLANKS"));
  assert.ok(out.includes("T4_WOOD"));
  assert.ok(out.includes("T3_PLANKS"));
});

test("expandFetchIds: mount output pulls in its recipe materials", async () => {
  const out = await expandFetchIds(["T5_MOUNT_HORSE"]);
  assert.ok(out.includes("T5_FARM_HORSE_GROWN"));
  assert.ok(out.includes("T5_LEATHER"));
});

test("expandFetchIds: breeding baby pulls in its grown sibling", async () => {
  const out = await expandFetchIds(["T5_FARM_HORSE_BABY"]);
  assert.ok(out.includes("T5_FARM_HORSE_BABY"));
  assert.ok(out.includes("T5_FARM_HORSE_GROWN"));
});

test("expandFetchIds: transport refined pulls raw, secondary and refine chain", async () => {
  const out = await expandFetchIds(["T4_METALBAR"]);
  ["T4_METALBAR", "T4_ORE", "T3_METALBAR", "T3_ORE"].forEach((id) =>
    assert.ok(out.includes(id), `missing ${id}`),
  );
});

test("expandFetchIds: enchantable gear pulls its .1-.3 siblings + rune/soul/relic", async () => {
  const out = await expandFetchIds(["T5_2H_BOW"]);
  ["T5_2H_BOW", "T5_2H_BOW@1", "T5_2H_BOW@2", "T5_2H_BOW@3", "T5_RUNE", "T5_SOUL", "T5_RELIC"].forEach(
    (id) => assert.ok(out.includes(id), `missing ${id}`),
  );
});

test("expandFetchIds: non-equipment id pulls no enchant mats", async () => {
  const out = await expandFetchIds(["T4_PLANKS"]);
  ["T4_RUNE", "T4_SOUL", "T4_RELIC"].forEach((id) =>
    assert.ok(!out.includes(id), `${id} should not be fetched for a resource`),
  );
});

test("expandFetchIds: farming crop pulls its seed", async () => {
  const out = await expandFetchIds(["T4_CARROT"]);
  assert.ok(out.includes("T4_FARM_CARROT_SEED"));
});

test("expandFetchIds: farming seed pulls its crop", async () => {
  const out = await expandFetchIds(["T4_FARM_CARROT_SEED"]);
  assert.ok(out.includes("T4_CARROT"));
});

test("expandFetchIds: consumable chain inputs are included", async () => {
  const out = await expandFetchIds(["T1_FISHSAUCE"]);
  assert.ok(out.includes("T1_FISHCHOPS"));
  assert.ok(out.includes("T4_SEAWEED"));
});

test("expandFetchIds: journal id pulls its empty⇄full sibling", async () => {
  const out = await expandFetchIds(["T8_JOURNAL_HIDE_FULL"]);
  assert.ok(out.includes("T8_JOURNAL_HIDE_FULL"));
  assert.ok(out.includes("T8_JOURNAL_HIDE_EMPTY"));
});

test("expandFetchIds: synthetic ids are dropped", async () => {
  const out = await expandFetchIds(["T1_FISHCHOPS__T3_FISH_FRESHWATER"]);
  assert.strictEqual(out.length, 0);
});

test("expandFetchIds: pure-lookup id with no recipe returns just itself", async () => {
  const out = await expandFetchIds(["T5_SEAWEED"]);
  assert.deepStrictEqual(out, ["T5_SEAWEED"]);
});

// ── expandFetchIds: transmute counterparts ──────────────────────────────────
// Searching "relic" matches only the RELIC ids. Every transmute row those ids
// take part in also needs its other end priced, or the row renders "no data" and
// gets dropped — which is exactly what made Enter look like it did nothing on
// the Transmute table.

test("expandFetchIds: relic pulls the transmute counterparts on BOTH sides", async () => {
  const out = await expandFetchIds(["T4_RELIC"]);
  ["T4_RELIC", "T4_SOUL", "T4_SHARD_AVALONIAN", "T5_RELIC"].forEach((id) =>
    assert.ok(out.includes(id), `missing ${id}`),
  );
});

test("expandFetchIds: rune pulls its type-up target and tier-up target", async () => {
  const out = await expandFetchIds(["T4_RUNE"]);
  ["T4_RUNE", "T4_SOUL", "T5_RUNE"].forEach((id) =>
    assert.ok(out.includes(id), `missing ${id}`),
  );
});

test("expandFetchIds: transmute expansion is one hop, not the whole ladder", async () => {
  const out = await expandFetchIds(["T4_RELIC"]);
  assert.ok(!out.includes("T4_RUNE"), "T4_RUNE is two hops from T4_RELIC");
});

test("expandFetchIds: a resource id pulls its transmute tier-up counterpart", async () => {
  const out = await expandFetchIds(["T4_ORE"]);
  assert.ok(out.includes("T5_ORE"), "missing T5_ORE");
});

test("expandFetchIds: gear id pulls materials from the CRAFTING_ITEMS catalog (not BUNDLED_RECIPES)", async () => {
  const out = await expandFetchIds(["T5_2H_BOW"]);
  assert.ok(out.includes("T5_2H_BOW"));
  assert.ok(out.includes("T5_PLANKS"), "base gear material must be fetched");
});

test("expandFetchIds: @n gear variant pulls the enchanted resource its recipe needs", async () => {
  const out = await expandFetchIds(["T5_2H_BOW@2"]);
  assert.ok(out.includes("T5_2H_BOW@2"));
  assert.ok(out.includes("T5_PLANKS"), "base resource still fetched");
  assert.ok(out.includes("T5_PLANKS_LEVEL2@2"), "enchanted resource variant fetched");
});

// ── matchedCatalogIds: the Transmute table is Enter-fetchable ────────────────
// The Transmute table used to be left out of the Enter-fetch id map, so Enter
// was a silent no-op there and only "Scan" ever produced rows. Its catalog is
// getTransmuteItemIds — real game ids, matchable by name like any other table.

test("matchedCatalogIds: 'relic' matches the transmute table's relic ids", () => {
  const ids = matchedCatalogIds("transmute-table", ["relic"], "", "");
  assert.ok(ids.includes("T4_RELIC"), "missing T4_RELIC");
  assert.ok(ids.includes("T5_RELIC"), "missing T5_RELIC");
});

test("matchedCatalogIds: 'relic' does not drag in unrelated transmute ids", () => {
  const ids = matchedCatalogIds("transmute-table", ["relic"], "", "");
  ["T4_ORE", "T5_ORE", "T4_RUNE"].forEach((id) =>
    assert.ok(!ids.includes(id), `${id} should not match "relic"`),
  );
});

test("matchedCatalogIds: transmute tier dropdown narrows to that tier", () => {
  const ids = matchedCatalogIds("transmute-table", ["relic"], "5", "");
  assert.deepStrictEqual(ids, ["T5_RELIC"]);
});

test("matchedCatalogIds: unknown table → []", () => {
  assert.deepStrictEqual(matchedCatalogIds("no-such-table", ["relic"], "", ""), []);
});

// The Artifact Rolling table has a search box too (its rows are collapse-owned,
// see table-search.js), so Enter must fetch the fragments/artifacts it prices.
test("matchedCatalogIds: rolling matches its fragment ids", () => {
  assert.deepStrictEqual(matchedCatalogIds("rolling-table", ["relic"], "", ""), ["T4_RELIC"]);
});

test("matchedCatalogIds: rolling tier dropdown narrows the artifact ids", () => {
  assert.deepStrictEqual(
    matchedCatalogIds("rolling-table", ["artefact"], "5", ""),
    ["T5_ARTEFACT_MAIN_SWORD_UNDEAD"],
  );
});

// Family synonyms: rock renders as "4 rock", never "stone" — the search hay must
// still fold in resourceSearchAliases or "stone" is a silent no-op (the bug the
// user hit typing "stone" in the Transmute table).
test("matchedCatalogIds: 'stone' matches the transmute rock ids via family alias", () => {
  const ids = matchedCatalogIds("transmute-table", ["stone"], "", "");
  assert.ok(ids.includes("T4_ROCK"), "missing T4_ROCK");
  assert.ok(ids.includes("T5_ROCK"), "missing T5_ROCK");
});

test("matchedCatalogIds: 'metal' matches ore via family alias, not rock", () => {
  const ids = matchedCatalogIds("transmute-table", ["metal"], "", "");
  assert.ok(ids.includes("T4_ORE") && ids.includes("T5_ORE"), "ore missing");
  ["T4_ROCK", "T5_ROCK"].forEach((id) =>
    assert.ok(!ids.includes(id), `${id} should not match "metal"`),
  );
});

test("matchedCatalogIds: 'stone' + tier dropdown narrows to that tier", () => {
  assert.deepStrictEqual(matchedCatalogIds("transmute-table", ["stone"], "5", ""), ["T5_ROCK"]);
});

// ── matchedCatalogIds: base ids outrank collapsed @n variants ────────────────
// The Enter-fetch is capped (MAX_SEARCH_FETCH_ITEMS) so a 1-char query can't
// fire a several-hundred-item request. In catalog order each base id is
// followed by its four enchant variants, so the cap used to be spent ~80% on
// rows the crafting table doesn't even display (variants stay collapsed until
// the base is expanded): typing "hammer" priced 12 of 60 base hammers and left
// the rest showing an empty Sell price until a full Scan. Base ids must come
// first, and the cap must be big enough to cover a whole gear family.

test("matchedCatalogIds: base ids come before @n variants", () => {
  const ids = matchedCatalogIds("crafting-table", ["hammer"], "", "");
  const firstVariant = ids.findIndex((id) => id.includes("@"));
  const lastBase = ids.map((id) => id.includes("@")).lastIndexOf(false);
  assert.ok(firstVariant > 0, "expected some variants in the match set");
  assert.ok(lastBase < firstVariant, "a base id came after the first @n variant");
});

test("matchedCatalogIds: the fetch cap covers every base id of a gear family", () => {
  const ids = matchedCatalogIds("crafting-table", ["hammer"], "", "");
  const capped = new Set(ids.slice(0, MAX_SEARCH_FETCH_ITEMS));
  CRAFT_BASE_HAMMER_IDS.forEach((id) =>
    assert.ok(capped.has(id), `${id} fell outside the fetch cap`),
  );
});

test("matchedCatalogIds: variants still match when the enchant picker asks for them", () => {
  const ids = matchedCatalogIds("crafting-table", ["hammer"], "6", "2");
  assert.ok(ids.length > 0, "enchant filter matched nothing");
  ids.forEach((id) => assert.ok(id.endsWith("@2"), `${id} is not a .2 variant`));
  assert.ok(ids.includes("T6_MAIN_HAMMER@2"));
});

// …but ONLY where the table hides its variants. The enchanting table displays
// them — each row prices two adjacent levels — so its catalog order (base, then
// that base's steps) must survive: reshuffling would spend the cap on bases and
// leave every enchanting row missing the level it enchants INTO.
test("matchedCatalogIds: enchanting keeps each base's @n steps next to it", () => {
  const ids = matchedCatalogIds("enchanting-table", ["hammer"], "", "");
  assert.deepStrictEqual(ids.slice(0, 4), [
    "T4_MAIN_HAMMER", "T4_MAIN_HAMMER@1", "T4_MAIN_HAMMER@2", "T4_MAIN_HAMMER@3",
  ]);
});

test("matchedCatalogIds: tier picker alone keeps that tier's bases first", () => {
  const ids = matchedCatalogIds("crafting-table", ["hammer"], "5", "");
  assert.ok(ids.every((id) => id.startsWith("T5_")), "off-tier id leaked in");
  assert.strictEqual(ids[0].includes("@"), false, "a variant sorted ahead of the bases");
});

// ── The fetch cap, and telling the user when it bites ────────────────────────
// Whole families in the real catalogs run past 200 rows — 266 journals in the
// Laborers table, 227 leather items in Flipping, 224 in the Craft Planner — and
// every id past the cap renders as an empty-priced row. The cap has to clear
// those, and when it still bites the user must be told instead of silently
// getting a half-priced table.

test("MAX_SEARCH_FETCH_ITEMS clears the largest real single-query families", () => {
  assert.ok(
    MAX_SEARCH_FETCH_ITEMS >= 266,
    `cap ${MAX_SEARCH_FETCH_ITEMS} clips the 266-journal Laborers family`,
  );
});

test("fetchCapNotice: silent when the match set fits the cap", () => {
  assert.strictEqual(fetchCapNotice(MAX_SEARCH_FETCH_ITEMS), null);
  assert.strictEqual(fetchCapNotice(1), null);
});

test("fetchCapNotice: names both counts when the cap bites", () => {
  const msg = fetchCapNotice(MAX_SEARCH_FETCH_ITEMS + 500);
  assert.ok(msg, "expected a notice");
  assert.ok(msg.includes(String(MAX_SEARCH_FETCH_ITEMS)), "notice omits the fetched count");
  assert.ok(msg.includes(String(MAX_SEARCH_FETCH_ITEMS + 500)), "notice omits the match count");
});

// ── prioritizeFetchIds: spend the cap on what isn't priced yet ───────────────
// The row filter matches rendered TEXT, so a crafting row shows up for "leather"
// because its recipe lists Stiff Leather — 1006 rows for a query whose catalog
// match is 219 ids. One press can never cover that, so a second press must make
// progress instead of re-fetching the same first 300: ids already in the price
// store go last.

test("prioritizeFetchIds: unpriced ids come before ids already in the store", () => {
  const store = { T4_LEATHER: {}, T5_LEATHER: {} };
  const out = prioritizeFetchIds("laborers-table", ["T4_LEATHER", "T4_HIDE", "T5_LEATHER", "T5_HIDE"], store);
  assert.deepStrictEqual(out, ["T4_HIDE", "T5_HIDE", "T4_LEATHER", "T5_LEATHER"]);
});

test("prioritizeFetchIds: within the unpriced group a collapse table still puts bases first", () => {
  const out = prioritizeFetchIds(
    "crafting-table",
    ["T4_MAIN_HAMMER@1", "T4_MAIN_HAMMER", "T5_MAIN_HAMMER@2", "T5_MAIN_HAMMER"],
    {},
  );
  assert.deepStrictEqual(out, [
    "T4_MAIN_HAMMER", "T5_MAIN_HAMMER", "T4_MAIN_HAMMER@1", "T5_MAIN_HAMMER@2",
  ]);
});

test("prioritizeFetchIds: a table that displays its variants keeps catalog order", () => {
  const ids = ["T4_MAIN_HAMMER", "T4_MAIN_HAMMER@1", "T5_MAIN_HAMMER", "T5_MAIN_HAMMER@1"];
  assert.deepStrictEqual(prioritizeFetchIds("enchanting-table", ids, {}), ids);
});

test("prioritizeFetchIds: an empty store leaves the order untouched", () => {
  const ids = ["T4_HIDE", "T5_HIDE"];
  assert.deepStrictEqual(prioritizeFetchIds("laborers-table", ids, {}), ids);
  assert.deepStrictEqual(prioritizeFetchIds("laborers-table", ids, null), ids);
});

test("prioritizeFetchIds: dedupes while preserving first position", () => {
  const out = prioritizeFetchIds("laborers-table", ["T4_HIDE", "T5_HIDE", "T4_HIDE"], {});
  assert.deepStrictEqual(out, ["T4_HIDE", "T5_HIDE"]);
});

// A row the filter shows but the fetch couldn't reach renders with an empty Sell
// price — the exact symptom of the reported bug. Say so rather than leave it
// looking like a broken fetch.
test("unpricedRowsNotice: silent when every visible row got priced", () => {
  assert.strictEqual(unpricedRowsNotice(0), null);
});

test("unpricedRowsNotice: names the leftover count and the way forward", () => {
  const msg = unpricedRowsNotice(730);
  assert.ok(msg && msg.includes("730"), "notice omits the leftover count");
  assert.ok(/enter/i.test(msg) || /scan/i.test(msg), "notice gives no next step");
});

// Every leftover id was already requested and came back empty: another press
// fetches the same nothing, so the notice must stop promising progress.
test("unpricedRowsNotice: exhausted rows are reported as having no market data", () => {
  const msg = unpricedRowsNotice(4, true);
  assert.ok(msg && msg.includes("4"), "notice omits the leftover count");
  assert.ok(/no market data/i.test(msg), "notice does not say the data is missing");
  assert.ok(!/press enter again/i.test(msg), "notice still promises a next batch");
});

test("unpricedRowsNotice: exhausted with nothing left is still silent", () => {
  assert.strictEqual(unpricedRowsNotice(0, true), null);
});

// ── matchedCatalogIds: the Volume table is Enter-fetchable ───────────────────
// Volume kept its own search box and was left out of the Enter-fetch id map, so
// "hide" + T8 only ever filtered already-scanned rows and found nothing when the
// full scan hadn't pulled T8_HIDE. Its catalog is getAllRequiredItemIds.

test("matchedCatalogIds: 'hide' + T8 matches the volume table's T8_HIDE", () => {
  const ids = matchedCatalogIds("volume-table", ["hide"], "8", "");
  assert.deepStrictEqual(ids, ["T8_HIDE"]);
});

test("matchedCatalogIds: 'hide' (no tier) matches every hide tier", () => {
  const ids = matchedCatalogIds("volume-table", ["hide"], "", "");
  assert.ok(ids.includes("T8_HIDE"));
  assert.ok(ids.includes("T4_HIDE"));
});

test("fetcherFor: volume table uses the plain fetch into lastMarketData and expands", () => {
  const f = fetcherFor("volume-table");
  assert.strictEqual(f.expand, true);
  globalThis.lastMarketData = {};
  f.merge({ T8_HIDE: { Martlock: { sell_price_min: 5 } } });
  assert.deepStrictEqual(Object.keys(globalThis.lastMarketData), ["T8_HIDE"]);
});

// ── fetcherFor: the rerolling table is on its OWN price store ────────────────
// Every table but one reads best-quality prices from lastMarketData via
// fetchPricesBatch. Rerolling prices q1-q5 per city into lastQualityMarketData
// (mirroring its scan button), so the default fetch/store combination leaves its
// renderer with nothing and Enter looks like a no-op.

test("matchedCatalogIds: 'bow' matches the rerolling table's catalog", () => {
  const ids = matchedCatalogIds("rerolling-table", ["bow"], "", "");
  assert.deepStrictEqual(ids.sort(), ["T5_2H_BOW", "T6_2H_BOW"]);
});

// The runner below fires tests without awaiting them, so async bodies
// interleave: each fetch test captures into its OWN array and swaps only the one
// global it exercises (the two never overlap).
test("fetcherFor: rerolling fetches all five qualities", async () => {
  const calls = [];
  const prev = globalThis.fetchPricesBatchWithQualities;
  globalThis.fetchPricesBatchWithQualities = async (ids, qualities) => {
    calls.push({ ids, qualities });
    return {};
  };
  try {
    await fetcherFor("rerolling-table").fetch(["T5_2H_BOW"]);
  } finally {
    globalThis.fetchPricesBatchWithQualities = prev;
  }
  assert.deepStrictEqual(calls, [{ ids: ["T5_2H_BOW"], qualities: [1, 2, 3, 4, 5] }]);
});

test("fetcherFor: rerolling merges into lastQualityMarketData, not lastMarketData", () => {
  globalThis.lastMarketData = {};
  globalThis.lastQualityMarketData = {};
  fetcherFor("rerolling-table").merge({ T5_2H_BOW: { 3: { Martlock: { buy_price: 7 } } } });
  assert.deepStrictEqual(Object.keys(globalThis.lastQualityMarketData), ["T5_2H_BOW"]);
  assert.deepStrictEqual(Object.keys(globalThis.lastMarketData), [], "must not touch lastMarketData");
});

test("fetcherFor: rerolling merge seeds a null store instead of throwing", () => {
  globalThis.lastQualityMarketData = null; // the pre-scan state (app.js inits null)
  fetcherFor("rerolling-table").merge({ T5_2H_BOW: { 3: {} } });
  assert.deepStrictEqual(Object.keys(globalThis.lastQualityMarketData), ["T5_2H_BOW"]);
});

test("fetcherFor: rerolling does NOT expand to recipe materials", () => {
  // Expanding would fetch planks/runes the reroll rows never price — at five
  // qualities each.
  assert.strictEqual(fetcherFor("rerolling-table").expand, false);
});

test("fetcherFor: every other table uses the plain fetch and expands", async () => {
  const calls = [];
  const prev = globalThis.fetchPricesBatch;
  globalThis.fetchPricesBatch = async (ids) => { calls.push({ ids }); return {}; };
  const f = fetcherFor("crafting-table");
  assert.strictEqual(f.expand, true);
  try {
    await f.fetch(["T5_2H_BOW"]);
  } finally {
    globalThis.fetchPricesBatch = prev;
  }
  assert.deepStrictEqual(calls, [{ ids: ["T5_2H_BOW"] }]);
});

test("fetcherFor: every other table merges into lastMarketData", () => {
  globalThis.lastMarketData = {};
  globalThis.lastQualityMarketData = {};
  fetcherFor("crafting-table").merge({ T5_PLANKS: { Martlock: { buy_price: 3 } } });
  assert.deepStrictEqual(Object.keys(globalThis.lastMarketData), ["T5_PLANKS"]);
  assert.deepStrictEqual(Object.keys(globalThis.lastQualityMarketData), [], "must not touch the quality store");
});

// ── matchedPrimaryIds (fake DOM) ──────────────────────────────────────────────

function makeRow(text, rowKey, cls = []) {
  const classes = new Set(cls);
  return {
    textContent: text,
    classList: { contains: (c) => classes.has(c) },
    hasAttribute: () => false,
    getAttribute: (a) => (a === "data-row-key" ? rowKey : null),
  };
}

test("matchedPrimaryIds: returns ids only for rows matching the query terms", () => {
  const rows = [
    makeRow("Broadsword T6 Martlock", "T6_MAIN_SWORD|Martlock"),
    makeRow("Bow T6 Martlock", "T6_2H_BOW|Martlock"),
  ];
  global.document = {
    querySelector: (sel) => (sel === "#crafting-table tbody" ? { rows } : null),
  };
  const ids = matchedPrimaryIds("crafting-table", ["bow"], "", "");
  assert.deepStrictEqual(ids, ["T6_2H_BOW"]);
});

test("matchedPrimaryIds: empty terms match all data rows", () => {
  const rows = [
    makeRow("Broadsword", "T6_MAIN_SWORD|Martlock"),
    makeRow("Bow", "T6_2H_BOW|Martlock"),
  ];
  global.document = {
    querySelector: (sel) => (sel === "#crafting-table tbody" ? { rows } : null),
  };
  const ids = matchedPrimaryIds("crafting-table", [], "", "");
  assert.deepStrictEqual(ids.sort(), ["T6_2H_BOW", "T6_MAIN_SWORD"]);
});

test("matchedPrimaryIds: no tbody → []", () => {
  global.document = { querySelector: () => null };
  assert.deepStrictEqual(matchedPrimaryIds("crafting-table", ["bow"], "", ""), []);
});

process.on("exit", () => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
});
