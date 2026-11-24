/**
 * Test: the Flipping table covers ALL available items, not just the curated
 * FLIPPING_ITEMS sample.
 *
 * Regression: the flipping table previously read only
 * [FLIPPING_ITEMS, ARTIFACT_FLIP_ITEMS, RESOURCE_FLIP_ITEMS], so whole
 * categories (capes, bags, consumables, the full weapon/armor catalog, every
 * mount) never appeared. getAllFlippingItems() now unions every tradeable
 * catalog the app knows about.
 *
 * Black-box: load the real catalogs end-to-end (same files/order as
 * index.html), build the list, and assert category coverage + invariants. No
 * live API / DOM — document/localStorage are stubbed.
 *
 * Run: node tests/flipping-all-items.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

const stubs = `
const document = { getElementById: () => null, addEventListener: () => {}, querySelector: () => null };
const window = { addEventListener: () => {} };
const localStorage = { getItem: () => null, setItem: () => {} };
`;

const src =
  stubs +
  J("item-names.js") + J("resource-names.js") + J("data-artifacts.js") + J("data.js") +
  J("data-consumables.js") + J("data-mounts.js") +
  J("gear-cloth-armor.js") + J("gear-leather-armor.js") + J("gear-leather-dragon.js") + J("gear-plate-armor.js") +
  J("gear-melee-light.js") + J("gear-melee-heavy.js") + J("gear-ranged.js") +
  J("gear-staves-a.js") + J("gear-staves-b.js") + J("gear-staves-c.js") +
  J("gear-offhand.js") + J("gear-capes.js") + J("gear-tools.js") + J("gear-gatherer.js") +
  J("gear-crystal-weapons.js") + J("gear-crystal-weapons-b.js") + J("gear-token-substitute.js") +
  J("gear.js") + J("data-flip-extras.js") + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  "\nbuildArtifactFlipItems(); buildResourceFlipItems();" +
  "\nmodule.exports = { getAllFlippingItems, getFlippingItemIds, FLIPPING_ITEMS, GEAR_RECIPES, MOUNT_RECIPES, CONSUMABLES," +
  " FLIP_EXTRA_IDS, getItemDisplayName };";

const mod = new Module("flipping-all-items");
mod.paths = Module._nodeModulePaths(process.cwd());
mod._compile(src, "flipping-all-items.js");
const {
  getAllFlippingItems, getFlippingItemIds, FLIPPING_ITEMS, GEAR_RECIPES,
  MOUNT_RECIPES, CONSUMABLES, FLIP_EXTRA_IDS, getItemDisplayName,
} = mod.exports;

const items = getAllFlippingItems();
const ids = new Set(items.map((i) => i.id));

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// ── Category coverage (the reported bug) ────────────────────────────────────
check("includes capes", () => {
  assert.ok([...ids].some((id) => /_CAPE/.test(id)), "no cape ids present");
  assert.ok(ids.has("T6_CAPEITEM_FW_LYMHURST"), "missing a known faction cape");
});
// Asserting one tier was what let "T5/T7 bags are missing" go unnoticed for so
// long — the catalog was in fact complete and the picker was hiding them (see
// tests/flipping-city-pick-reroutes.test.cjs), but nothing here could have said
// so. Pin the whole family: Bags run T2-T8, Satchels of Insight T4-T8.
check("includes every bag and satchel tier", () => {
  for (let t = 2; t <= 8; t++) assert.ok(ids.has(`T${t}_BAG`), `missing T${t}_BAG`);
  for (let t = 4; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_BAG_INSIGHT`), `missing T${t}_BAG_INSIGHT`);
  }
});
check("includes consumables", () => {
  assert.ok(ids.has("T6_POTION_HEAL"), "missing a known potion");
  CONSUMABLES.slice(0, 5).forEach((c) => assert.ok(ids.has(c.id), `missing consumable ${c.id}`));
});
check("includes every gear recipe", () => {
  GEAR_RECIPES.forEach((g) => assert.ok(ids.has(g.id), `missing gear ${g.id}`));
});
check("includes every mount", () => {
  MOUNT_RECIPES.forEach((m) => assert.ok(ids.has(m.id), `missing mount ${m.id}`));
});
check("retains the curated misc items (runes/souls/journals/maps)", () => {
  FLIPPING_ITEMS.forEach((i) => assert.ok(ids.has(i.id), `dropped curated ${i.id}`));
});

// ── families the app models only as revenue lines elsewhere ─────────────────
// These are tradeable and priced by a full scan, but had no array feeding the
// flipping union, so they never showed up as flips (reported: fish trophies).
check("includes every laborer trophy, all eight lines T2-T8", () => {
  ["FIBER", "FISH", "GENERAL", "HIDE", "MERCENARY", "ORE", "ROCK", "WOOD"].forEach((line) => {
    for (let t = 2; t <= 8; t++) {
      const id = `T${t}_FURNITUREITEM_TROPHY_${line}`;
      assert.ok(ids.has(id), `missing trophy ${id}`);
    }
  });
  // The Trophy Shark is the one craftable trophy (any laborer, +5 happiness).
  assert.ok(ids.has("T8_FURNITUREITEM_TROPHY_FISHING_BOSS"), "missing the Trophy Shark");
});
check("includes craftable furniture (beds, chests, tables, repair kits)", () => {
  for (let t = 2; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_FURNITUREITEM_BED`), `missing T${t} bed`);
    assert.ok(ids.has(`T${t}_FURNITUREITEM_TABLE`), `missing T${t} table`);
  }
  // Chests only exist T2-T5 in the game files.
  for (let t = 2; t <= 5; t++) assert.ok(ids.has(`T${t}_FURNITUREITEM_CHEST`), `missing T${t} chest`);
  for (let t = 4; t <= 8; t++) assert.ok(ids.has(`T${t}_FURNITUREITEM_REPAIRKIT`), `missing T${t} repair kit`);
});
check("includes the tradeable tomes", () => {
  assert.ok(ids.has("T4_SKILLBOOK_STANDARD"), "missing the Tome of Insight");
  ["FIBER", "HIDE", "ORE", "ROCK", "WOOD"].forEach((line) => {
    for (let t = 4; t <= 8; t++) {
      assert.ok(ids.has(`T${t}_SKILLBOOK_GATHER_${line}`), `missing T${t} ${line} tome`);
    }
  });
});
check("includes saltwater fish (common catch + the boss shark)", () => {
  for (let t = 1; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_FISH_SALTWATER_ALL_COMMON`), `missing T${t} common saltwater fish`);
  }
  assert.ok(ids.has("T8_FISH_SALTWATER_ALL_BOSS_SHARK"), "missing the shark");
});
check("does NOT include unreleased furniture (no localized name, no market)", () => {
  // BATTLEVAULT / WARDROBE and T6-T8 chests carry recipes in items.xml but no
  // EN-US name and no market data — they are not obtainable in game.
  ["T4_FURNITUREITEM_BATTLEVAULT", "T3_FURNITUREITEM_WARDROBE", "T8_FURNITUREITEM_CHEST"].forEach(
    (id) => assert.ok(!ids.has(id), `${id} should not be listed`),
  );
});

// ── Families that had no source at all until this fix ──────────────────
// Every id below is a real tradeable market item that could never render a
// Flipping row because no catalog owned it (reported: "Undead Crest").
const CREST_FAMILIES = [
  "AVALON", "DEMON", "HERETIC", "KEEPER", "MORGANA", "SMUGGLER", "UNDEAD",
  "FW_BRECILIEN", "FW_BRIDGEWATCH", "FW_CAERLEON", "FW_FORTSTERLING",
  "FW_LYMHURST", "FW_MARTLOCK", "FW_THETFORD",
];
const JOURNAL_LINES = [
  "WOOD", "STONE", "ORE", "FIBER", "HIDE", "FISHING",
  "WARRIOR", "HUNTER", "MAGE", "TOOLMAKER", "MERCENARY",
  "TROPHY_GENERAL", "TROPHY_MERCENARY", "TROPHY_HIDE", "TROPHY_WOOD",
  "TROPHY_STONE", "TROPHY_ORE", "TROPHY_FIBER", "TROPHY_FISHING",
];
const REMAINS_LINES = ["PANTHER", "ENT", "DIREBEAR", "WEREWOLF", "IMP", "ELEMENTAL", "EAGLE"];

check("includes every crest (cape blueprint), 14 families T4-T8", () => {
  CREST_FAMILIES.forEach((fam) => {
    for (let t = 4; t <= 8; t++) {
      assert.ok(ids.has(`T${t}_CAPEITEM_${fam}_BP`), `missing crest T${t}_CAPEITEM_${fam}_BP`);
    }
  });
});
check("the crest and the cape it crafts are separate rows", () => {
  // The crest is the blueprint material; the cape is the crafted item. Both
  // trade, and only the cape enchants.
  assert.ok(ids.has("T4_CAPEITEM_UNDEAD_BP"), "missing the Undead crest");
  assert.ok(ids.has("T4_CAPEITEM_UNDEAD"), "missing the crafted Undead cape");
  assert.strictEqual(getItemDisplayName("T4_CAPEITEM_UNDEAD_BP"), "Adept's Undead Crest");
});
check("includes the Black Leather artifact (Hell war gloves)", () => {
  // Real T4-T8 artifact that ARTIFACT_MAPPING never listed, so
  // buildArtifactFlipItems() could not emit it.
  for (let t = 4; t <= 8; t++) {
    const id = `T${t}_ARTEFACT_2H_IRONGAUNTLETS_HELL`;
    assert.ok(ids.has(id), `missing artifact ${id}`);
  }
});
check("includes every journal, empty and full, 19 lines T2-T8", () => {
  JOURNAL_LINES.forEach((line) => {
    for (let t = 2; t <= 8; t++) {
      assert.ok(ids.has(`T${t}_JOURNAL_${line}_EMPTY`), `missing T${t}_JOURNAL_${line}_EMPTY`);
      assert.ok(ids.has(`T${t}_JOURNAL_${line}_FULL`), `missing T${t}_JOURNAL_${line}_FULL`);
    }
  });
});
check("does NOT include partially-full journals", () => {
  // `T4_JOURNAL_WOOD` is the carried, partially-filled journal - it cannot be
  // listed on the market at all; only Empty and Full trade.
  JOURNAL_LINES.forEach((line) => {
    assert.ok(!ids.has(`T4_JOURNAL_${line}`), `T4_JOURNAL_${line} should not be listed`);
  });
});
check("includes dungeon maps and hellgate rituals", () => {
  for (let t = 3; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_RANDOM_DUNGEON_SOLO_TOKEN_1`), `missing T${t} solo map`);
  }
  for (let t = 4; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_RANDOM_DUNGEON_TOKEN_1`), `missing T${t} group map`);
  }
  for (let t = 6; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_RANDOM_DUNGEON_ELITE_TOKEN_1`), `missing T${t} large-group map`);
  }
  ["T5_CORRUPTED_NONLETHAL_MAP", "T6_CORRUPTED_LETHAL_MAP",
   "T5_HELLGATE_2V2_NON_LETHAL_1_MAP", "T8_HELLGATE_10V10_LETHAL_1_MAP"].forEach((id) => {
    assert.ok(ids.has(id), `missing ${id}`);
  });
});
check("includes animal remains and arcane extract", () => {
  REMAINS_LINES.forEach((line) => {
    [3, 5, 7].forEach((t) => {
      assert.ok(ids.has(`T${t}_ALCHEMY_RARE_${line}`), `missing T${t}_ALCHEMY_RARE_${line}`);
    });
  });
  assert.ok(ids.has("T1_ALCHEMY_COMMON"), "missing the common remains");
  for (let lvl = 1; lvl <= 3; lvl++) {
    assert.ok(ids.has(`T1_ALCHEMY_EXTRACT_LEVEL${lvl}`), `missing arcane extract ${lvl}`);
  }
});
check("includes essence, faded and arcane, T4-T8", () => {
  for (let t = 4; t <= 8; t++) {
    assert.ok(ids.has(`T${t}_ESSENCE`), `missing T${t}_ESSENCE`);
    assert.ok(ids.has(`T${t}_ESSENCE_POTION`), `missing T${t}_ESSENCE_POTION`);
  }
});
check("includes the mount upgrade kits", () => {
  ["T5_MOUNTUPGRADE_HORSE_CURSE", "T8_MOUNTUPGRADE_HORSE_CURSE",
   "T5_MOUNTUPGRADE_HORSE_MORGANA", "T8_MOUNTUPGRADE_HORSE_MORGANA",
   "T8_MOUNTUPGRADE_COUGAR_KEEPER"].forEach((id) => {
    assert.ok(ids.has(id), `missing ${id}`);
  });
});
check("includes the faction and zone tokens", () => {
  ["KEEPER", "MORGANA", "UNDEAD", "AVALON", "MISTS", "SMUGGLER"].forEach((f) => {
    assert.ok(ids.has(`QUESTITEM_TOKEN_${f}`), `missing QUESTITEM_TOKEN_${f}`);
  });
});
check("does NOT include decayed crystal artifacts (no localized name, no market)", () => {
  ["T4_ARTEFACT_2H_BOW_CRYSTAL_DECAY", "T8_ARTEFACT_MAIN_CURSEDSTAFF_CRYSTAL_DECAY"].forEach(
    (id) => assert.ok(!ids.has(id), `${id} should not be listed`),
  );
});

// ── Invariants ──────────────────────────────────────────────────────────────
check("no duplicate ids", () => {
  assert.strictEqual(items.length, ids.size, "duplicate ids leaked through");
});
check("every item has a non-raw display name", () => {
  const bad = items.filter((i) => !i.name || i.name === i.id);
  assert.strictEqual(bad.length, 0, `${bad.length} items fell back to raw id, e.g. ${bad.slice(0, 3).map((i) => i.id)}`);
});
check("curated names win over catalog defaults", () => {
  // T4_2H_BOW exists in both FLIPPING_ITEMS ("Bow [T4]") and GEAR_RECIPES.
  const bow = items.find((i) => i.id === "T4_2H_BOW");
  const curated = FLIPPING_ITEMS.find((i) => i.id === "T4_2H_BOW");
  if (curated) assert.strictEqual(bow.name, curated.name, "curated name not preserved");
});
check("getFlippingItemIds matches getAllFlippingItems ids", () => {
  assert.deepStrictEqual(getFlippingItemIds(), items.map((i) => i.id));
});
check("the universe is large (full catalog, not the ~150-item sample)", () => {
  assert.ok(items.length > 1000, `expected >1000 items, got ${items.length}`);
});

check("every FLIP_EXTRA_IDS entry resolves to a real display name", () => {
  const raw = FLIP_EXTRA_IDS.filter((id) => getItemDisplayName(id) === id);
  assert.strictEqual(raw.length, 0, `${raw.length} extras render as their raw id, e.g. ${raw.slice(0, 3)}`);
});
check("every FLIP_EXTRA_IDS entry is a real items.xml id", () => {
  // Guards the hand-maintained lists against typos and against ids invented
  // from a pattern. Journals are the one family items.xml keys without the
  // market's _EMPTY/_FULL suffix (it carries `T2_JOURNAL_WOOD` alone).
  const xml = fs.readFileSync(path.join(__dirname, "..", "data", "dumps", "items.xml"), "utf8");
  const known = new Set();
  const re = /uniquename="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) known.add(m[1]);
  const unknown = FLIP_EXTRA_IDS.filter((id) => !known.has(id.replace(/_(EMPTY|FULL)$/, "")));
  assert.strictEqual(unknown.length, 0, `not in items.xml: ${unknown.slice(0, 5)}`);
});
check("no duplicate ids inside FLIP_EXTRA_IDS", () => {
  assert.strictEqual(new Set(FLIP_EXTRA_IDS).size, FLIP_EXTRA_IDS.length, "FLIP_EXTRA_IDS repeats an id");
});

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — flipping-all-items (${items.length} items)`);
process.exit(failures === 0 ? 0 : 1);
