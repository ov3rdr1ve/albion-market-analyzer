/**
 * Favor costs for the Energy Manipulator (Mattina) — the Conqueror's Challenge
 * vendor in every Royal City + Caerleon. Favor is a PvP-activity currency.
 *
 * Mattina spends Favor on exactly two things:
 *   1. Siphoned Energy — 150 Favor buys 1 Energy (in-game verified, not on the
 *      wiki). Energy then transmutes into Runes / Souls / Relics (T4-T8) or the
 *      four exclusive combat mounts.
 *   2. Conqueror's Chests — 6,750 Favor each (raised from 5,500 in the Abyssal
 *      Depths patch). A loot table, valued like the faction Iron Chest by an
 *      overrideable expected silver yield.
 *
 * The Crystallized Spirit/Dread/Magic/Divinity tokens (Rune/Soul/Relic/Avalonian
 * substitutes) are Conqueror's Chest drops, NOT a fixed-Favor purchase — so they
 * are NOT modelled here as a per-token Favor price; their only Favor valuation is
 * through the chest's expected yield.
 *
 * Energy→token transmutation rates (wiki: Siphoned_Energy / Energy_Manipulator):
 *   Rune  T4-8: 1 / 1 / 1 / 2 / 6
 *   Soul  T4-8: 1 / 1 / 2 / 6 / 18
 *   Relic T4-8: 1 / 2 / 6 / 18 / 54
 * Avalonian Shards are NOT energy-purchasable (Avalonian-content drop only).
 */

const FAVOR_PER_ENERGY = 150; // Favor to buy 1 Siphoned Energy at the Energy Manipulator
const CONQUEROR_CHEST_FAVOR = 6750;
const CONQUEROR_CHEST_ID = "UNIQUE_LOOTCHEST_CONQUEROR_FAVOR_PURCHASE";
// Siphoned Energy is itself market-tradeable, so the simplest Favor sink is to
// buy 1 Energy (150 Favor) and resell it raw.
const SIPHONED_ENERGY_ID = "UNIQUE_GVGTOKEN_GENERIC";

// Expected silver value of one Conqueror's Chest's contents. RNG loot, so this
// is a placeholder default — overridden per-row by clicking the yield cell
// (same mechanism as the faction Iron Chest). 0 = "unset, prompt the user".
const DEFAULT_CONQUEROR_CHEST_YIELD = 0;

// energy units consumed per transmuted token, by [type][tier]
const ENERGY_EXCHANGE_COSTS = {
  RUNE:  { 4: 1, 5: 1, 6: 1, 7: 2, 8: 6 },
  SOUL:  { 4: 1, 5: 1, 6: 2, 7: 6, 8: 18 },
  RELIC: { 4: 1, 5: 2, 6: 6, 7: 18, 8: 54 },
};

// Display label per energy-token type (used in the Category column).
const ENERGY_TOKEN_LABELS = { RUNE: "Rune", SOUL: "Soul", RELIC: "Relic" };

// Avalonian Shards (T4-T8) have NO Siphoned-Energy recipe — the Energy
// Manipulator sells them for a flat Favor price instead. Costs are in-game
// verified (id family T{n}_SHARD_AVALONIAN — "Adept's … Elder's Avalonian
// Shard"). This is why the wiki's energy-transmute list only covers
// Rune/Soul/Relic.
const AVALONIAN_SHARD_FAVOR = { 4: 90, 5: 500, 6: 675, 7: 1700, 8: 3400 };

// ── Tomes of Insight (combat fame books) sold for Favor ──────────────────────
// Mattina sells the Elder's (T8) Tome of Insight for a flat 2,000 Favor. The
// tome is NON-TRADABLE (no market sell price), so it's valued by FAME-per-Favor
// rather than silver-per-Favor: combat fame granted ÷ Favor cost. Fame totals
// are the in-game/wiki values (T4 10K … T8 200K, non-tradable ladder). Only the
// T8 is currently offered, but the list is structured so more tiers can be
// added if Mattina's stock changes — just append { id, tier, favorCost }.
const TOME_FAME = { 4: 10000, 5: 20000, 6: 50000, 7: 100000, 8: 200000 };
const TOMES_FOR_FAVOR = [
  { id: "T8_SKILLBOOK_NONTRADABLE", tier: 8, favorCost: 2000 },
];
TOMES_FOR_FAVOR.forEach((t) => { t.fame = TOME_FAME[t.tier] || 0; });

function famePerFavor(fame, favorCost) {
  if (!fame || !favorCost || favorCost <= 0) return 0;
  return fame / favorCost;
}

// ── Crests (artifact cape blueprints) sold for Favor ─────────────────────────
// Three Conqueror's-Challenge / Antiquarian NPCs sell tradable cape-blueprint
// "crests" for Favor:
//   - Mattina (Energy Manipulator) sells the Avalonian crest ladder.
//   - Maggy Slade (Shadow Hand) sells the Smuggler crest ladder.
//   - The Antiquarian (Antiquarian's Den) sells the Demon crest ladder.
// Avalonian and Smuggler share one Favor schedule (CREST_FAVOR_COSTS —
// coincidentally the same as the Avalonian Shard prices above). The Antiquarian
// charges its OWN, steeper schedule for Demon crests (DEMON_CREST_FAVOR_COSTS,
// in-game verified). Each family therefore carries its own `favorCosts` map.
// Crests are tradable, so they're valued by direct market sale (silver/Favor).
const CREST_FAVOR_COSTS = { 4: 90, 5: 500, 6: 675, 7: 1700, 8: 3400 };
const DEMON_CREST_FAVOR_COSTS = { 4: 300, 5: 600, 6: 900, 7: 1200, 8: 1500 };
// Brecilien (Mists) crests are ALSO a direct-Favor purchase, from Eralia
// Wayfarer at Brecilien — NOT the royal-city FP ladder they used to be modelled
// under. In-game verified 2026-07-01 (screenshot): they share the standard
// CREST_FAVOR_COSTS Favor schedule (90/500/675/1700/3400). The wiki's per-tier
// Brecilien crest pages still show a stale "15000 FP" value — the live vendor
// window is authoritative.
// `faction` is the Faction-Spending dropdown group each crest filters under —
// one per Favor vendor (Energy Manipulator / Smuggler's Den / The Antiquarian /
// Brecilien), not the lumped "Favor" group they used to share.
const FAVOR_CREST_FAMILIES = [
  { idStem: "CAPEITEM_AVALON",       category: "Avalonian Crest", note: "Energy Manipulator (Mattina)",        faction: "Energy Manipulator", favorCosts: CREST_FAVOR_COSTS },
  { idStem: "CAPEITEM_SMUGGLER",     category: "Smuggler Crest",  note: "Shadow Hand (Maggy Slade)",           faction: "Smuggler's Den",     favorCosts: CREST_FAVOR_COSTS },
  { idStem: "CAPEITEM_DEMON",        category: "Demon Crest",     note: "The Antiquarian (Antiquarian's Den)", faction: "The Antiquarian",    favorCosts: DEMON_CREST_FAVOR_COSTS },
  { idStem: "CAPEITEM_FW_BRECILIEN", category: "Brecilien Crest", note: "Brecilien (Eralia Wayfarer)",         faction: "Brecilien",          favorCosts: CREST_FAVOR_COSTS },
];

function getCrestFavorCost(tier) {
  return CREST_FAVOR_COSTS[tier] || 0;
}

// Favor cost of a crest for a given family (falls back to the shared schedule
// for the Avalonian/Smuggler ladders that don't define their own).
function getFamilyCrestFavorCost(fam, tier) {
  const schedule = (fam && fam.favorCosts) || CREST_FAVOR_COSTS;
  return schedule[tier] || 0;
}

// ── Antiquarian spiderling babies sold for Favor ─────────────────────────────
// The Antiquarian also sells two tradable "Farmable - Animal" babies that raise
// into combat mounts. They're tradable creatures, so — like Siphoned Energy —
// the simplest Favor sink is to buy the baby and resell it raw (a floor value;
// raising it into the mount can be worth more). In-game verified Favor costs.
//   Hellspinner Baby  (T5) = 675 Favor
//   Soulspinner Baby  (T8) = 11,250 Favor (the rare abyss spiderling)
const ANTIQUARIAN_BABIES = [
  { id: "T5_FARM_SPIDER_HELL_BABY", name: "Hellspinner Baby", favorCost: 675 },
  { id: "T8_FARM_SPIDER_HELL_BABY", name: "Soulspinner Baby", favorCost: 11250 },
];

// ── Brecilien (Mists) faction rewards sold by Eralia Wayfarer for Favor ──────
// Mystic Owl babies — tradable creatures that raise into the Mystic Owl mount.
// Sold raw as a floor value, but they carry the full breed-vs-raw comparison
// (silver/Favor) pulled from the Mounts table, exactly like the FP faction
// babies did before Brecilien was (wrongly) modelled as an FP vendor. In-game
// verified 2026-07-01: Mystic Owlet 675 Favor, Elite Mystic Owlet 11,250 Favor.
const BRECILIEN_BABIES = [
  { id: "T5_FARM_OWL_FW_BRECILIEN_BABY", name: "Mystic Owlet",       favorCost: 675 },
  { id: "T8_FARM_OWL_FW_BRECILIEN_BABY", name: "Elite Mystic Owlet", favorCost: 11250 },
];
const BRECILIEN_BABY_FAVOR = Object.fromEntries(BRECILIEN_BABIES.map((b) => [b.id, b.favorCost]));
const ANTIQUARIAN_BABY_FAVOR = Object.fromEntries(ANTIQUARIAN_BABIES.map((b) => [b.id, b.favorCost]));

// Favor acquisition cost of a breedable baby (0 if it isn't a Favor purchase).
// Used by the Mounts table to denominate breeding in silver/Favor instead of
// silver/FP: Brecilien owls (Eralia Wayfarer) and Antiquarian spiderlings
// (Hellspinner/Soulspinner) are both bought with Favor, not Faction Points.
function getBabyFavorCost(id) {
  if (!id) return 0;
  return BRECILIEN_BABY_FAVOR[id] || ANTIQUARIAN_BABY_FAVOR[id] || 0;
}

// Faerie Fire — the Mists crafting token (used in Brecilien capes + the Mystic
// Owl mount). Eralia Wayfarer sells it for 675 Favor; it's tradable, so the
// Favor sink is to buy it and resell raw (silver/Favor), like Siphoned Energy.
const FAERIE_FIRE = { id: "QUESTITEM_TOKEN_MISTS", name: "Faerie Fire", favorCost: 675 };

// The four exclusive combat mounts. Each is an exchange: spend Energy + a base
// mount + fixed mats. favorCost = energy * FAVOR_PER_ENERGY (the silver mats &
// base mount are priced separately off the market).
const MOUNT_EXCHANGES = [
  {
    id: "T6_MOUNT_SIEGE_BALLISTA",
    name: "Siege Ballista",
    energy: 2500, // items.xml: UNIQUE_GVGTOKEN_GENERIC count=2500
    baseMountId: "T6_MOUNT_OX", // Master's Transport Ox
    mats: [
      { id: "T6_METALBAR", count: 20 }, // Runite Steel Bar
      { id: "T6_LEATHER", count: 20 },  // Hardened Leather
      { id: "T6_PLANKS", count: 20 },   // Bloodoak Planks
    ],
  },
  {
    id: "T7_MOUNT_SWAMPDRAGON_BATTLE",
    name: "Flame Basilisk",
    energy: 5000,
    baseMountId: "T7_MOUNT_SWAMPDRAGON", // Saddled Swamp Dragon
    mats: [{ id: "T7_CLOTH", count: 20 }], // Opulent Cloth
  },
  {
    id: "T7_MOUNT_ARMORED_SWAMPDRAGON_BATTLE",
    name: "Venom Basilisk",
    energy: 5000,
    baseMountId: "T7_MOUNT_SWAMPDRAGON", // Saddled Swamp Dragon
    mats: [{ id: "T7_METALBAR", count: 20 }], // Meteorite Steel Bar
  },
  {
    id: "T8_MOUNT_MAMMOTH_BATTLE@1",
    name: "Elder's Command Mammoth",
    energy: 10000,
    baseMountId: "T8_MOUNT_MAMMOTH_TRANSPORT", // Elder's Transport Mammoth
    mats: [{ id: "T8_LEATHER", count: 20 }], // Fortified Leather
  },
];
// Precompute favorCost so callers/tests don't repeat the multiply.
MOUNT_EXCHANGES.forEach((m) => { m.favorCost = m.energy * FAVOR_PER_ENERGY; });

function favorForEnergy(energy) {
  if (!energy || energy <= 0) return 0;
  return energy * FAVOR_PER_ENERGY;
}

function getEnergyTokenFavorCost(type, tier) {
  const energy = ENERGY_EXCHANGE_COSTS[type] && ENERGY_EXCHANGE_COSTS[type][tier];
  return energy ? energy * FAVOR_PER_ENERGY : 0;
}

function getAvalonianShardFavorCost(tier) {
  return AVALONIAN_SHARD_FAVOR[tier] || 0;
}

function calculateSilverPerFavor(silverYield, favorCost) {
  if (!favorCost || favorCost <= 0) return 0;
  return silverYield / favorCost;
}

// Every item id the Faction Spending scan must price so Favor rows compute:
// the 15 Rune/Soul/Relic tokens, the 4 mount outputs, their base mounts, and
// their mats. The Conqueror's Chest is a fixed-yield (non-market) row, so it is
// intentionally excluded.
function getFavorSpendItemIds() {
  const ids = new Set();
  Object.keys(ENERGY_EXCHANGE_COSTS).forEach((type) => {
    for (let t = 4; t <= 8; t++) ids.add(`T${t}_${type}`);
  });
  for (let t = 4; t <= 8; t++) ids.add(`T${t}_SHARD_AVALONIAN`);
  // Crest cape-blueprints (Avalonian + Smuggler + Demon, T4-T8) are tradable, so
  // the scan must price them. Tomes are non-tradable (fame-valued), need no price.
  FAVOR_CREST_FAMILIES.forEach((fam) => {
    for (let t = 4; t <= 8; t++) ids.add(`T${t}_${fam.idStem}_BP`);
  });
  // Antiquarian + Brecilien babies are tradable creatures sold raw — price them.
  ANTIQUARIAN_BABIES.forEach((b) => ids.add(b.id));
  BRECILIEN_BABIES.forEach((b) => ids.add(b.id));
  // Faerie Fire (Mists token) is tradable — price it for the sold-raw row.
  ids.add(FAERIE_FIRE.id);
  ids.add(SIPHONED_ENERGY_ID);
  MOUNT_EXCHANGES.forEach((m) => {
    ids.add(m.id);
    ids.add(m.baseMountId);
    m.mats.forEach((mat) => ids.add(mat.id));
  });
  return Array.from(ids);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FAVOR_PER_ENERGY,
    CONQUEROR_CHEST_FAVOR,
    CONQUEROR_CHEST_ID,
    SIPHONED_ENERGY_ID,
    DEFAULT_CONQUEROR_CHEST_YIELD,
    ENERGY_EXCHANGE_COSTS,
    ENERGY_TOKEN_LABELS,
    AVALONIAN_SHARD_FAVOR,
    TOME_FAME,
    TOMES_FOR_FAVOR,
    CREST_FAVOR_COSTS,
    DEMON_CREST_FAVOR_COSTS,
    FAVOR_CREST_FAMILIES,
    ANTIQUARIAN_BABIES,
    BRECILIEN_BABIES,
    BRECILIEN_BABY_FAVOR,
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
  };
}
