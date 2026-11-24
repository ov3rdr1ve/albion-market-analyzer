/**
 * Test: Energy Manipulator Favor-cost data + silver-per-Favor math.
 *
 * Favor is the Conqueror's Challenge currency spent at the Energy Manipulator
 * (Mattina) in every Royal City + Caerleon. It buys:
 *   - Siphoned Energy at 150 Favor / 1 Energy, which transmutes into
 *     Runes / Souls / Relics (T4-T8) or the four exclusive combat mounts.
 *   - Conqueror's Chests at 6,750 Favor each (loot → expected silver yield).
 *
 * Energy→token costs are the in-game transmutation rates (wiki-verified):
 *   Rune  T4-8: 1 / 1 / 1 / 2 / 6
 *   Soul  T4-8: 1 / 1 / 2 / 6 / 18
 *   Relic T4-8: 1 / 2 / 6 / 18 / 54
 *
 * Run: node tests/favor-costs.test.cjs
 */

const path = require("path");
const assert = require("assert");

const fav = require(path.join(__dirname, "..", "js", "data-favor-costs.js"));
const {
  FAVOR_PER_ENERGY,
  CONQUEROR_CHEST_FAVOR,
  CONQUEROR_CHEST_ID,
  ENERGY_EXCHANGE_COSTS,
  AVALONIAN_SHARD_FAVOR,
  TOMES_FOR_FAVOR,
  TOME_FAME,
  CREST_FAVOR_COSTS,
  DEMON_CREST_FAVOR_COSTS,
  FAVOR_CREST_FAMILIES,
  ANTIQUARIAN_BABIES,
  BRECILIEN_BABIES,
  FAERIE_FIRE,
  MOUNT_EXCHANGES,
  favorForEnergy,
  getEnergyTokenFavorCost,
  getAvalonianShardFavorCost,
  getBabyFavorCost,
  famePerFavor,
  getCrestFavorCost,
  getFamilyCrestFavorCost,
  calculateSilverPerFavor,
  getFavorSpendItemIds,
} = fav;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Energy Manipulator Favor-cost tests\n");

// --- Constants ---
test("150 Favor buys 1 Siphoned Energy", () => {
  assert.strictEqual(FAVOR_PER_ENERGY, 150);
});
test("Conqueror's Chest costs 6,750 Favor", () => {
  assert.strictEqual(CONQUEROR_CHEST_FAVOR, 6750);
});
test("Conqueror's Chest id is the favor-purchase loot chest", () => {
  assert.strictEqual(CONQUEROR_CHEST_ID, "UNIQUE_LOOTCHEST_CONQUEROR_FAVOR_PURCHASE");
});

// --- Energy exchange cost table (energy units per token) ---
const energyCases = [
  ["RUNE", 4, 1], ["RUNE", 5, 1], ["RUNE", 6, 1], ["RUNE", 7, 2], ["RUNE", 8, 6],
  ["SOUL", 4, 1], ["SOUL", 5, 1], ["SOUL", 6, 2], ["SOUL", 7, 6], ["SOUL", 8, 18],
  ["RELIC", 4, 1], ["RELIC", 5, 2], ["RELIC", 6, 6], ["RELIC", 7, 18], ["RELIC", 8, 54],
];
energyCases.forEach(([type, tier, energy]) => {
  test(`${type} T${tier} costs ${energy} energy`, () => {
    assert.strictEqual(ENERGY_EXCHANGE_COSTS[type][tier], energy);
  });
});

// --- favorForEnergy ---
test("favorForEnergy multiplies by 150", () => {
  assert.strictEqual(favorForEnergy(1), 150);
  assert.strictEqual(favorForEnergy(2000), 300000);
  assert.strictEqual(favorForEnergy(10000), 1500000);
});
test("favorForEnergy of 0 is 0", () => {
  assert.strictEqual(favorForEnergy(0), 0);
});

// --- getEnergyTokenFavorCost (energy * 150) ---
test("Adept's Rune (T4) = 150 Favor", () => {
  assert.strictEqual(getEnergyTokenFavorCost("RUNE", 4), 150);
});
test("Grandmaster's Soul (T7) = 6 energy = 900 Favor", () => {
  assert.strictEqual(getEnergyTokenFavorCost("SOUL", 7), 900);
});
test("Elder's Relic (T8) = 54 energy = 8,100 Favor", () => {
  assert.strictEqual(getEnergyTokenFavorCost("RELIC", 8), 8100);
});
test("Unknown token type/tier returns 0", () => {
  assert.strictEqual(getEnergyTokenFavorCost("RUNE", 3), 0);
  assert.strictEqual(getEnergyTokenFavorCost("AVALON", 4), 0);
});

// --- Avalonian Shard direct-Favor prices (in-game; no energy recipe) ---
const avalonCases = [[4, 90], [5, 500], [6, 675], [7, 1700], [8, 3400]];
avalonCases.forEach(([tier, favor]) => {
  test(`Avalonian Shard T${tier} = ${favor} Favor (direct purchase)`, () => {
    assert.strictEqual(AVALONIAN_SHARD_FAVOR[tier], favor);
    assert.strictEqual(getAvalonianShardFavorCost(tier), favor);
  });
});
test("getAvalonianShardFavorCost returns 0 for unknown tier", () => {
  assert.strictEqual(getAvalonianShardFavorCost(3), 0);
  assert.strictEqual(getAvalonianShardFavorCost(9), 0);
});

// --- Tomes of Insight (non-tradable fame books, fame-per-Favor) ---
test("Mattina sells the Elder's (T8) Tome of Insight for 2,000 Favor", () => {
  const t8 = TOMES_FOR_FAVOR.find((t) => t.id === "T8_SKILLBOOK_NONTRADABLE");
  assert.ok(t8, "T8 tome missing");
  assert.strictEqual(t8.tier, 8);
  assert.strictEqual(t8.favorCost, 2000);
  assert.strictEqual(t8.fame, 200000);
});
test("TOME_FAME ladder matches the non-tradable fame values", () => {
  assert.deepStrictEqual(TOME_FAME, { 4: 10000, 5: 20000, 6: 50000, 7: 100000, 8: 200000 });
});
test("famePerFavor = fame ÷ Favor cost (Elder's Tome → 100 fame/Favor)", () => {
  assert.strictEqual(famePerFavor(200000, 2000), 100);
  assert.strictEqual(famePerFavor(0, 2000), 0);
  assert.strictEqual(famePerFavor(200000, 0), 0);
});

// --- Crests (Avalonian + Smuggler cape BPs) sold for Favor ---
const crestCases = [[4, 90], [5, 500], [6, 675], [7, 1700], [8, 3400]];
crestCases.forEach(([tier, favor]) => {
  test(`Crest T${tier} = ${favor} Favor`, () => {
    assert.strictEqual(CREST_FAVOR_COSTS[tier], favor);
    assert.strictEqual(getCrestFavorCost(tier), favor);
  });
});
test("getCrestFavorCost returns 0 for unknown tier", () => {
  assert.strictEqual(getCrestFavorCost(3), 0);
  assert.strictEqual(getCrestFavorCost(9), 0);
});

// --- Demon Crests (The Antiquarian) — own, steeper Favor schedule ---
const demonCases = [[4, 300], [5, 600], [6, 900], [7, 1200], [8, 1500]];
demonCases.forEach(([tier, favor]) => {
  test(`Demon Crest T${tier} = ${favor} Favor (The Antiquarian)`, () => {
    assert.strictEqual(DEMON_CREST_FAVOR_COSTS[tier], favor);
  });
});
test("FAVOR_CREST_FAMILIES carries Avalonian, Smuggler, Demon and Brecilien ladders", () => {
  const byStem = Object.fromEntries(FAVOR_CREST_FAMILIES.map((f) => [f.idStem, f]));
  assert.ok(byStem.CAPEITEM_AVALON, "Avalonian family present");
  assert.ok(byStem.CAPEITEM_SMUGGLER, "Smuggler family present");
  assert.ok(byStem.CAPEITEM_DEMON, "Demon family present");
  assert.ok(byStem.CAPEITEM_FW_BRECILIEN, "Brecilien family present");
  assert.strictEqual(byStem.CAPEITEM_DEMON.category, "Demon Crest");
  assert.strictEqual(byStem.CAPEITEM_DEMON.favorCosts, DEMON_CREST_FAVOR_COSTS);
});
test("each crest family maps to its own Faction-Spending vendor group", () => {
  const byStem = Object.fromEntries(FAVOR_CREST_FAMILIES.map((f) => [f.idStem, f]));
  assert.strictEqual(byStem.CAPEITEM_AVALON.faction, "Energy Manipulator");
  assert.strictEqual(byStem.CAPEITEM_SMUGGLER.faction, "Smuggler's Den");
  assert.strictEqual(byStem.CAPEITEM_DEMON.faction, "The Antiquarian");
  assert.strictEqual(byStem.CAPEITEM_FW_BRECILIEN.faction, "Brecilien");
});

// --- Brecilien crests (Eralia Wayfarer) — shared Favor schedule, NOT FP ---
test("Brecilien crest family uses the shared CREST_FAVOR_COSTS ladder + Eralia note", () => {
  const brec = FAVOR_CREST_FAMILIES.find((f) => f.idStem === "CAPEITEM_FW_BRECILIEN");
  assert.ok(brec, "Brecilien family missing");
  assert.strictEqual(brec.category, "Brecilien Crest");
  assert.strictEqual(brec.favorCosts, CREST_FAVOR_COSTS);
  assert.ok(/Eralia/.test(brec.note), "note should credit Eralia Wayfarer");
  assert.strictEqual(getFamilyCrestFavorCost(brec, 4), 90);
  assert.strictEqual(getFamilyCrestFavorCost(brec, 8), 3400);
});
test("getFamilyCrestFavorCost reads each family's own schedule", () => {
  const demon = FAVOR_CREST_FAMILIES.find((f) => f.idStem === "CAPEITEM_DEMON");
  const avalon = FAVOR_CREST_FAMILIES.find((f) => f.idStem === "CAPEITEM_AVALON");
  assert.strictEqual(getFamilyCrestFavorCost(demon, 8), 1500);
  assert.strictEqual(getFamilyCrestFavorCost(avalon, 8), 3400);
  // falls back to the shared schedule when a family has no own map
  assert.strictEqual(getFamilyCrestFavorCost({}, 4), 90);
  assert.strictEqual(getFamilyCrestFavorCost(demon, 3), 0);
});

// --- Antiquarian spiderling babies (tradable, sold raw for Favor) ---
test("ANTIQUARIAN_BABIES: Hellspinner (675) and Soulspinner (11,250)", () => {
  const byId = Object.fromEntries(ANTIQUARIAN_BABIES.map((b) => [b.id, b]));
  assert.strictEqual(byId["T5_FARM_SPIDER_HELL_BABY"].favorCost, 675);
  assert.strictEqual(byId["T5_FARM_SPIDER_HELL_BABY"].name, "Hellspinner Baby");
  assert.strictEqual(byId["T8_FARM_SPIDER_HELL_BABY"].favorCost, 11250);
  assert.strictEqual(byId["T8_FARM_SPIDER_HELL_BABY"].name, "Soulspinner Baby");
});

// --- Brecilien Mystic Owl babies (Eralia Wayfarer, Favor) ---
test("BRECILIEN_BABIES: Mystic Owlet (675) and Elite Mystic Owlet (11,250)", () => {
  const byId = Object.fromEntries(BRECILIEN_BABIES.map((b) => [b.id, b]));
  assert.strictEqual(byId["T5_FARM_OWL_FW_BRECILIEN_BABY"].favorCost, 675);
  assert.strictEqual(byId["T5_FARM_OWL_FW_BRECILIEN_BABY"].name, "Mystic Owlet");
  assert.strictEqual(byId["T8_FARM_OWL_FW_BRECILIEN_BABY"].favorCost, 11250);
  assert.strictEqual(byId["T8_FARM_OWL_FW_BRECILIEN_BABY"].name, "Elite Mystic Owlet");
});
test("getBabyFavorCost returns the owl Favor costs, 0 for FP/unknown babies", () => {
  assert.strictEqual(getBabyFavorCost("T5_FARM_OWL_FW_BRECILIEN_BABY"), 675);
  assert.strictEqual(getBabyFavorCost("T8_FARM_OWL_FW_BRECILIEN_BABY"), 11250);
  // FP faction babies are not Favor-priced.
  assert.strictEqual(getBabyFavorCost("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"), 0);
  assert.strictEqual(getBabyFavorCost("nonsense"), 0);
  assert.strictEqual(getBabyFavorCost(null), 0);
});

// --- Faerie Fire (Mists token, sold raw for Favor) ---
test("FAERIE_FIRE: QUESTITEM_TOKEN_MISTS, 675 Favor", () => {
  assert.strictEqual(FAERIE_FIRE.id, "QUESTITEM_TOKEN_MISTS");
  assert.strictEqual(FAERIE_FIRE.favorCost, 675);
  assert.strictEqual(FAERIE_FIRE.name, "Faerie Fire");
});

// --- calculateSilverPerFavor ---
test("calculateSilverPerFavor returns silver / favor", () => {
  assert.strictEqual(calculateSilverPerFavor(300000, 150), 2000);
  assert.ok(Math.abs(calculateSilverPerFavor(150000, 8100) - 18.5185) < 0.001);
});
test("calculateSilverPerFavor returns 0 when favor is 0 or negative", () => {
  assert.strictEqual(calculateSilverPerFavor(10000, 0), 0);
  assert.strictEqual(calculateSilverPerFavor(10000, -1), 0);
});
test("Conqueror's Chest 1M silver / 6750 Favor ≈ 148.1 silver/Favor", () => {
  assert.ok(Math.abs(calculateSilverPerFavor(1000000, 6750) - 148.148) < 0.01);
});

// --- MOUNT_EXCHANGES ---
test("MOUNT_EXCHANGES has the 4 Energy Manipulator combat mounts", () => {
  assert.strictEqual(MOUNT_EXCHANGES.length, 4);
});
const mountById = Object.fromEntries(MOUNT_EXCHANGES.map((m) => [m.id, m]));
test("Siege Ballista: 2500 energy, base Master's Transport Ox, 3 mats ×20", () => {
  const m = mountById["T6_MOUNT_SIEGE_BALLISTA"];
  assert.ok(m, "Siege Ballista missing");
  assert.strictEqual(m.energy, 2500);
  assert.strictEqual(m.baseMountId, "T6_MOUNT_OX");
  assert.strictEqual(m.favorCost, 375000);
  const mats = Object.fromEntries(m.mats.map((x) => [x.id, x.count]));
  assert.deepStrictEqual(mats, { T6_METALBAR: 20, T6_LEATHER: 20, T6_PLANKS: 20 });
});
test("Flame Basilisk: 5000 energy, base Saddled Swamp Dragon, 20 Opulent Cloth", () => {
  const m = mountById["T7_MOUNT_SWAMPDRAGON_BATTLE"];
  assert.ok(m);
  assert.strictEqual(m.energy, 5000);
  assert.strictEqual(m.baseMountId, "T7_MOUNT_SWAMPDRAGON");
  assert.strictEqual(m.favorCost, 750000);
  assert.deepStrictEqual(m.mats, [{ id: "T7_CLOTH", count: 20 }]);
});
test("Venom Basilisk: 5000 energy, base Saddled Swamp Dragon, 20 Meteorite Steel Bar", () => {
  const m = mountById["T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE"];
  assert.ok(m);
  assert.strictEqual(m.energy, 5000);
  assert.strictEqual(m.baseMountId, "T7_MOUNT_SWAMPDRAGON");
  assert.deepStrictEqual(m.mats, [{ id: "T7_METALBAR", count: 20 }]);
});
test("Elder's Command Mammoth: 10000 energy, base Elder's Transport Mammoth, 20 Fortified Leather", () => {
  const m = mountById["T8_MOUNT_MAMMOTH_BATTLE@1"];
  assert.ok(m);
  assert.strictEqual(m.energy, 10000);
  assert.strictEqual(m.baseMountId, "T8_MOUNT_MAMMOTH_TRANSPORT");
  assert.strictEqual(m.favorCost, 1500000);
  assert.deepStrictEqual(m.mats, [{ id: "T8_LEATHER", count: 20 }]);
});

// --- getFavorSpendItemIds (everything the scan must price) ---
const favIds = getFavorSpendItemIds();
test("getFavorSpendItemIds includes all 15 Rune/Soul/Relic tokens", () => {
  ["RUNE", "SOUL", "RELIC"].forEach((k) => {
    for (let t = 4; t <= 8; t++) assert.ok(favIds.includes(`T${t}_${k}`), `missing T${t}_${k}`);
  });
});
test("getFavorSpendItemIds includes the 5 Avalonian Shards", () => {
  for (let t = 4; t <= 8; t++) assert.ok(favIds.includes(`T${t}_SHARD_AVALONIAN`), `missing T${t}_SHARD_AVALONIAN`);
});
test("getFavorSpendItemIds includes the Avalonian + Smuggler + Demon + Brecilien crest BPs (tradable)", () => {
  for (let t = 4; t <= 8; t++) {
    assert.ok(favIds.includes(`T${t}_CAPEITEM_AVALON_BP`), `missing T${t}_CAPEITEM_AVALON_BP`);
    assert.ok(favIds.includes(`T${t}_CAPEITEM_SMUGGLER_BP`), `missing T${t}_CAPEITEM_SMUGGLER_BP`);
    assert.ok(favIds.includes(`T${t}_CAPEITEM_DEMON_BP`), `missing T${t}_CAPEITEM_DEMON_BP`);
    assert.ok(favIds.includes(`T${t}_CAPEITEM_FW_BRECILIEN_BP`), `missing T${t}_CAPEITEM_FW_BRECILIEN_BP`);
  }
});
test("getFavorSpendItemIds includes the Antiquarian spider + Brecilien owl babies", () => {
  assert.ok(favIds.includes("T5_FARM_SPIDER_HELL_BABY"), "missing Hellspinner Baby");
  assert.ok(favIds.includes("T8_FARM_SPIDER_HELL_BABY"), "missing Soulspinner Baby");
  assert.ok(favIds.includes("T5_FARM_OWL_FW_BRECILIEN_BABY"), "missing Mystic Owlet");
  assert.ok(favIds.includes("T8_FARM_OWL_FW_BRECILIEN_BABY"), "missing Elite Mystic Owlet");
});
test("getFavorSpendItemIds includes Faerie Fire (Mists token)", () => {
  assert.ok(favIds.includes("QUESTITEM_TOKEN_MISTS"), "missing Faerie Fire");
});
test("getFavorSpendItemIds omits the non-tradable Tome (no market price needed)", () => {
  assert.ok(!favIds.includes("T8_SKILLBOOK_NONTRADABLE"), "tome should not be in the price scan");
});
test("getFavorSpendItemIds includes the 4 mount outputs + their base mounts + mats", () => {
  ["T6_MOUNT_SIEGE_BALLISTA", "T7_MOUNT_SWAMPDRAGON_BATTLE",
   "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE", "T8_MOUNT_MAMMOTH_BATTLE@1",
   "T6_MOUNT_OX", "T7_MOUNT_SWAMPDRAGON", "T8_MOUNT_MAMMOTH_TRANSPORT",
   "T6_METALBAR", "T6_LEATHER", "T6_PLANKS", "T7_CLOTH", "T7_METALBAR", "T8_LEATHER",
  ].forEach((id) => assert.ok(favIds.includes(id), `missing ${id}`));
});
test("getFavorSpendItemIds returns a deduped list", () => {
  assert.strictEqual(favIds.length, new Set(favIds).size);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
