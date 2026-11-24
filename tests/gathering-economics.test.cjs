/**
 * Test: gathering profitability model.
 *
 * The Gathering table compares raw-resource gathering activities (Mining,
 * Quarrying, Lumberjacking, Skinning, Harvesting) by what the market currently
 * pays per gathered unit, normalized two ways a gatherer cares about:
 *   - Silver / kg  — hard fact. Weight = 0.1 × 1.5^tier (Albion Wiki "Resource";
 *     T4 = 0.51kg … T8 = 2.56kg). Gatherers are weight-limited, so silver/kg is
 *     the haul-efficiency comparator and re-ranks lower tiers UP (weight grows
 *     ~1.5x/tier, price grows slower).
 *   - Silver / hour (est.) — net per unit × an ESTIMATED units/hour that
 *     decreases with tier (slower node respawn, lower density, slower gather
 *     speed, danger-gated). The curve is tunable; the ranking it produces is the
 *     headline "which gathering activity is most profitable right now".
 *
 * Gathering has NO material input cost (you harvest for free), so only the
 * sell-side market tax (PREMIUM_TAX) applies — no buy-side setup fee.
 *
 * Black-box / TDD: written before the implementation. Pure input→output only,
 * no DOM, no live API.
 *
 * Run: node tests/gathering-economics.test.cjs
 */

const assert = require("assert");
const { PREMIUM_TAX, getResourceWeightKg, calcGatheringEconomics, calcFishingEconomics, calcTrackingEconomics } = require("../js/calculations.js");
const {
  GATHERING_PROFESSIONS,
  GATHER_UNITS_PER_HOUR,
  FISH_UNITS_PER_HOUR,
  FISH_RARE_SHARE,
  SEAWEED_UNITS_PER_HOUR,
  FISH_RARE_BIOMES,
  FISH_WEIGHT_KG,
  FISH_RARE_WEIGHT_KG,
  SEAWEED_WEIGHT_KG,
  fishingRareTier,
  TRACK_TIERS,
  TRACK_CREATURES,
  TRACK_ARTIFACT_FACTIONS,
  REMAINS_WEIGHT_KG,
  TRACK_ARTIFACT_WEIGHT_KG,
  trackArtifactTier,
  TRACK_KILLS_PER_HOUR,
  TRACK_REMAINS_PER_KILL,
  TRACK_ARTIFACT_SHARE,
  TRACK_RARE_QUARRY_SHARE,
  TRACK_BM_LOOT_GROSS,
  GATHERING_TIERS,
  ENCHANTABLE_TYPES,
  ROYAL_ENCHANT_RATE,
  BLACK_ZONE_ENCHANT_RATE,
  ZONE_ENCHANT_RATE,
  getEnchantDist,
  getGatheringResources,
  getGatheringItemIds,
} = require("../js/data-gathering.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== calcGatheringEconomics — core math ===");

test("net per unit applies the sell-side market tax only (no buy setup fee)", () => {
  const r = calcGatheringEconomics({ sellPrice: 1000, tier: 4, unitsPerHour: 480 });
  assert.strictEqual(r.netPerUnit, 1000 * (1 - PREMIUM_TAX));
});

test("weight comes from the 0.1×1.5^tier formula (T4 = 0.51kg)", () => {
  const r = calcGatheringEconomics({ sellPrice: 1000, tier: 4, unitsPerHour: 480 });
  assert.strictEqual(r.weightKg, getResourceWeightKg(4));
  assert.strictEqual(r.weightKg, 0.51);
});

test("silver/kg = net per unit ÷ weight", () => {
  const r = calcGatheringEconomics({ sellPrice: 1000, tier: 4, unitsPerHour: 480 });
  const expected = (1000 * (1 - PREMIUM_TAX)) / 0.51;
  assert.ok(Math.abs(r.silverPerKg - expected) < 1e-6,
    `expected ${expected}, got ${r.silverPerKg}`);
});

test("silver/hour = net per unit × units/hour", () => {
  const r = calcGatheringEconomics({ sellPrice: 1000, tier: 4, unitsPerHour: 480 });
  assert.strictEqual(r.silverPerHour, 1000 * (1 - PREMIUM_TAX) * 480);
});

test("explicit weightKg override is used instead of the tier formula (fish are lighter)", () => {
  const r = calcGatheringEconomics({ sellPrice: 1000, tier: 8, unitsPerHour: 200, weightKg: 0.73 });
  assert.strictEqual(r.weightKg, 0.73, "override weight should be returned verbatim");
  assert.ok(r.weightKg < getResourceWeightKg(8), "fish weight should sit below the 0.1×1.5^tier weight");
  const net = 1000 * (1 - PREMIUM_TAX);
  assert.ok(Math.abs(r.silverPerKg - net / 0.73) < 1e-6, `silver/kg ${r.silverPerKg} should use the override weight`);
});

test("weightKg override is ignored when ≤ 0 / null → falls back to the tier formula", () => {
  assert.strictEqual(calcGatheringEconomics({ sellPrice: 100, tier: 5, weightKg: 0 }).weightKg, getResourceWeightKg(5));
  assert.strictEqual(calcGatheringEconomics({ sellPrice: 100, tier: 5, weightKg: null }).weightKg, getResourceWeightKg(5));
  assert.strictEqual(calcGatheringEconomics({ sellPrice: 100, tier: 5 }).weightKg, getResourceWeightKg(5));
});

console.log("\n=== calcGatheringEconomics — normalization behaviour ===");

test("for equal unit price, a LOWER tier wins on silver/kg (lighter haul)", () => {
  const t4 = calcGatheringEconomics({ sellPrice: 1000, tier: 4, unitsPerHour: 0 });
  const t8 = calcGatheringEconomics({ sellPrice: 1000, tier: 8, unitsPerHour: 0 });
  assert.ok(t4.silverPerKg > t8.silverPerKg,
    `T4 ${t4.silverPerKg} should beat T8 ${t8.silverPerKg} per kg at equal price`);
});

test("weight is strictly increasing across tiers (T2..T8)", () => {
  for (let t = 3; t <= 8; t++) {
    const lo = calcGatheringEconomics({ sellPrice: 100, tier: t - 1, unitsPerHour: 0 });
    const hi = calcGatheringEconomics({ sellPrice: 100, tier: t, unitsPerHour: 0 });
    assert.ok(hi.weightKg > lo.weightKg, `weight T${t} should exceed T${t - 1}`);
  }
});

console.log("\n=== calcGatheringEconomics — edge cases ===");

test("no market data (sellPrice 0) → zero value, weight still known, no NaN", () => {
  const r = calcGatheringEconomics({ sellPrice: 0, tier: 6, unitsPerHour: 360 });
  assert.strictEqual(r.netPerUnit, 0);
  assert.strictEqual(r.silverPerKg, 0);
  assert.strictEqual(r.silverPerHour, 0);
  assert.strictEqual(r.weightKg, getResourceWeightKg(6));
});

test("units/hour 0 → silver/hour 0 (no NaN), silver/kg still computed", () => {
  const r = calcGatheringEconomics({ sellPrice: 500, tier: 5, unitsPerHour: 0 });
  assert.strictEqual(r.silverPerHour, 0);
  assert.ok(r.silverPerKg > 0);
});

test("negative / missing sellPrice is clamped to 0", () => {
  const r = calcGatheringEconomics({ sellPrice: -5, tier: 5, unitsPerHour: 100 });
  assert.strictEqual(r.netPerUnit, 0);
  assert.strictEqual(r.silverPerHour, 0);
});

console.log("\n=== calcGatheringEconomics — enchanted-drop blend (silver/hour) ===");

// The headline silver/hour blends in the enchanted resources you ALSO pull from
// T4+ nodes: each gathered unit is flat with prob (1−ΣP), or an enchant-level-k
// variant worth enchantPrices[k] with prob enchantDist[k]. net/unit and
// silver/kg stay FLAT facts about the listed resource.
const DIST = { 1: 0.1, 2: 0.01, 3: 0.001, 4: 0.0001 };

test("backward compatible: no enchant args → blended equals flat, silver/hour unchanged", () => {
  const r = calcGatheringEconomics({ sellPrice: 1000, tier: 4, unitsPerHour: 480 });
  assert.strictEqual(r.blendedNetPerUnit, r.netPerUnit);
  assert.strictEqual(r.silverPerHour, r.netPerUnit * 480);
  assert.strictEqual(r.enchantUpliftPct, 0);
});

test("silver/hour blends enchanted drops ABOVE the flat-only baseline", () => {
  const flat = calcGatheringEconomics({ sellPrice: 100, tier: 6, unitsPerHour: 100 });
  const blended = calcGatheringEconomics({
    sellPrice: 100, tier: 6, unitsPerHour: 100,
    enchantPrices: { 1: 300, 2: 900, 3: 3000, 4: 9000 },
    enchantDist: DIST,
  });
  const pEnch = 0.1 + 0.01 + 0.001 + 0.0001;
  const enchGross = 0.1 * 300 + 0.01 * 900 + 0.001 * 3000 + 0.0001 * 9000;
  const expNet = (100 * (1 - pEnch) + enchGross) * (1 - PREMIUM_TAX);
  assert.ok(blended.silverPerHour > flat.silverPerHour, "blend must beat flat-only");
  assert.ok(Math.abs(blended.blendedNetPerUnit - expNet) < 1e-6, `blendedNet ${blended.blendedNetPerUnit}`);
  assert.ok(Math.abs(blended.silverPerHour - expNet * 100) < 1e-6, `silver/hour ${blended.silverPerHour}`);
  assert.ok(blended.enchantUpliftPct > 0, "uplift % should be positive");
  // net/unit stays the FLAT fact; silver/kg AND silver/hour reflect the blend.
  assert.strictEqual(blended.netPerUnit, flat.netPerUnit);
  assert.ok(blended.silverPerKg > flat.silverPerKg, "silver/kg should lift with enchant haul-value");
  assert.ok(Math.abs(blended.silverPerKg - expNet / getResourceWeightKg(6)) < 1e-6, `silver/kg ${blended.silverPerKg}`);
});

test("silver/kg reflects enchant haul-value — same weight, more silver", () => {
  const flat = calcGatheringEconomics({ sellPrice: 100, tier: 6, unitsPerHour: 0 });
  const blended = calcGatheringEconomics({
    sellPrice: 100, tier: 6, unitsPerHour: 0,
    enchantPrices: { 1: 300, 2: 900, 3: 3000, 4: 9000 },
    enchantDist: DIST,
  });
  assert.strictEqual(blended.weightKg, flat.weightKg);                 // enchanted units weigh the same
  assert.ok(blended.silverPerKg > flat.silverPerKg, "enchant lifts silver/kg");
  assert.ok(Math.abs(blended.silverPerKg - blended.blendedNetPerUnit / blended.weightKg) < 1e-9,
    `silver/kg ${blended.silverPerKg} should equal blended net ÷ weight`);
});

test("no enchant prices (stone / thin market) collapses to the flat price — no uplift", () => {
  const r = calcGatheringEconomics({
    sellPrice: 100, tier: 6, unitsPerHour: 100,
    enchantPrices: {},              // e.g. rock: no enchanted version exists
    enchantDist: DIST,
  });
  assert.strictEqual(r.enchantUpliftPct, 0);
  assert.ok(Math.abs(r.blendedNetPerUnit - r.netPerUnit) < 1e-9);
  assert.ok(Math.abs(r.silverPerHour - r.netPerUnit * 100) < 1e-6);
});

test("a missing individual enchant price falls back to flat (never invents value)", () => {
  const r = calcGatheringEconomics({
    sellPrice: 100, tier: 6, unitsPerHour: 0,
    enchantPrices: { 1: 500 },      // only .1 priced; .2–.4 missing → treated as flat
    enchantDist: DIST,
  });
  const pEnch = 0.1 + 0.01 + 0.001 + 0.0001;
  const enchGross = 0.1 * 500 + 0.01 * 100 + 0.001 * 100 + 0.0001 * 100;
  const expNet = (100 * (1 - pEnch) + enchGross) * (1 - PREMIUM_TAX);
  assert.ok(Math.abs(r.blendedNetPerUnit - expNet) < 1e-6, `blendedNet ${r.blendedNetPerUnit}`);
});

test("below T4 the distribution is empty → silver/hour is pure flat", () => {
  const r = calcGatheringEconomics({
    sellPrice: 100, tier: 3, unitsPerHour: 100,
    enchantPrices: { 1: 9999 },     // even with a price, T3 dist is all-zero
    enchantDist: getEnchantDist(3),
  });
  assert.strictEqual(r.enchantUpliftPct, 0);
  assert.ok(Math.abs(r.silverPerHour - r.netPerUnit * 100) < 1e-6);
});

console.log("\n=== data-gathering — catalogue (land + merged fishing + tracking) ===");

// Loose validity for every id a row asks to be priced (catches undefined/garbage).
const MARKET_ID_RE = /^T[1-8]_[A-Z0-9_]+(@[1-4])?$/;

test("35 land + 8 fishing (7 tiers + seaweed) + 3 Ancient Lands + 3 tracking = 49 rows", () => {
  assert.strictEqual(getGatheringResources().length, 49, `got ${getGatheringResources().length}`);
});

test("every row has a kind, an in-range tier, a profession label and non-empty marketIds", () => {
  getGatheringResources().forEach((r) => {
    assert.ok(["land", "fishing", "seaweed", "tracking"].includes(r.kind), `bad kind ${r.kind}`);
    assert.ok(r.tier >= 1 && r.tier <= 8, `tier ${r.tier} out of range`);
    assert.ok(r.profession && typeof r.profession.label === "string" && r.profession.label, "missing profession");
    assert.ok(r.unitsPerHour > 0, "units/hour should be positive");
    assert.ok(Array.isArray(r.marketIds) && r.marketIds.length > 0, "marketIds missing");
    r.marketIds.forEach((id) => assert.ok(MARKET_ID_RE.test(id), `bad market id ${id}`));
  });
});

test("land: 5 families × 7 tiers, single unenchanted rawId, tier-formula weight", () => {
  const land = getGatheringResources().filter((r) => r.kind === "land");
  assert.strictEqual(land.length, 35);
  const byType = {};
  land.forEach((r) => {
    byType[r.type] = (byType[r.type] || 0) + 1;
    assert.ok(/^T[2-8]_(ORE|WOOD|HIDE|FIBER|ROCK)$/.test(r.rawId), `bad land id ${r.rawId}`);
    assert.strictEqual(r.unitsPerHour, GATHER_UNITS_PER_HOUR[r.tier], `${r.rawId} rate`);
    assert.strictEqual(r.weightKg, null, `${r.rawId} should leave weightKg null (tier formula)`);
  });
  ["ore", "wood", "hide", "fiber", "rock"].forEach((t) =>
    assert.strictEqual(byType[t], 7, `family ${t} should have 7 tiers, got ${byType[t]}`));
});

test("profession labels map families → in-game gathering skills (incl. Fishing)", () => {
  assert.strictEqual(GATHERING_PROFESSIONS.ore.label, "Mining");
  assert.strictEqual(GATHERING_PROFESSIONS.rock.label, "Quarrying");
  assert.strictEqual(GATHERING_PROFESSIONS.wood.label, "Lumberjacking");
  assert.strictEqual(GATHERING_PROFESSIONS.hide.label, "Skinning");
  assert.strictEqual(GATHERING_PROFESSIONS.fiber.label, "Harvesting");
  assert.strictEqual(GATHERING_PROFESSIONS.fish.label, "Fishing");
  assert.strictEqual(GATHERING_PROFESSIONS.tracking.label, "Tracking");
  assert.strictEqual(GATHERING_PROFESSIONS.tracking.tool, "Tracking Toolkit");
});

console.log("\n=== data-gathering — merged fishing rows ===");

test("fishing = 7 merged tier rows (T2–T8) + 1 seaweed row", () => {
  // Ancient Lands rows share the "fishing" kind (they reuse the same row
  // builder and economics) but are their own activity — see
  // tests/ancient-lands-fishing-row.test.cjs. Only the open-world rows here.
  const fishing = getGatheringResources().filter((r) => r.kind === "fishing" && !r.ancient);
  const seaweed = getGatheringResources().filter((r) => r.kind === "seaweed");
  assert.strictEqual(fishing.length, 7, `fishing tiers ${fishing.length}`);
  assert.strictEqual(seaweed.length, 1, `seaweed ${seaweed.length}`);
  assert.deepStrictEqual(fishing.map((r) => r.tier), GATHERING_TIERS);
});

test("fishingRareTier maps each tier to its rare band (T4→3, T6→5, T8→7; T2 none)", () => {
  assert.strictEqual(fishingRareTier(2), null);
  assert.strictEqual(fishingRareTier(3), 3);
  assert.strictEqual(fishingRareTier(4), 3);
  assert.strictEqual(fishingRareTier(5), 5);
  assert.strictEqual(fishingRareTier(6), 5);
  assert.strictEqual(fishingRareTier(7), 7);
  assert.strictEqual(fishingRareTier(8), 7);
});

test("each merged Fishing row carries both commons, its band's rares, and rates/weights", () => {
  getGatheringResources().filter((r) => r.kind === "fishing" && !r.ancient).forEach((r) => {
    assert.strictEqual(r.profession.label, "Fishing");
    assert.strictEqual(r.freshCommonId, `T${r.tier}_FISH_FRESHWATER_ALL_COMMON`);
    assert.strictEqual(r.saltCommonId, `T${r.tier}_FISH_SALTWATER_ALL_COMMON`);
    assert.strictEqual(r.commonWeightKg, FISH_WEIGHT_KG[r.tier], `${r.tier} common weight`);
    assert.ok(r.commonWeightKg < getResourceWeightKg(r.tier), "common fish lighter than 0.1×1.5^tier");
    assert.strictEqual(r.unitsPerHour, FISH_UNITS_PER_HOUR[r.tier], `${r.tier} rate`);
    const rt = fishingRareTier(r.tier);
    assert.strictEqual(r.rareTier, rt);
    if (rt) {
      assert.strictEqual(r.freshRareIds.length, FISH_RARE_BIOMES.length, "6 freshwater biome rares");
      assert.ok(r.freshRareIds.every((id) => id.startsWith(`T${rt}_FISH_FRESHWATER_`) && id.endsWith("_RARE")));
      assert.strictEqual(r.saltRareId, `T${rt}_FISH_SALTWATER_ALL_RARE`);
      assert.strictEqual(r.rareWeightKg, FISH_RARE_WEIGHT_KG[rt], `${r.tier} rare weight`);
      assert.strictEqual(r.rareShare, FISH_RARE_SHARE);
    } else {
      assert.strictEqual(r.freshRareIds.length, 0, "T2 has no rare");
      assert.strictEqual(r.saltRareId, null);
      assert.strictEqual(r.rareShare, 0);
    }
  });
});

test("seaweed: a single T1 byproduct row (1 kg, flat rate)", () => {
  const sw = getGatheringResources().filter((r) => r.kind === "seaweed");
  assert.strictEqual(sw.length, 1, `expected 1 seaweed row, got ${sw.length}`);
  const r = sw[0];
  assert.strictEqual(r.rawId, "T1_SEAWEED");
  assert.strictEqual(r.tier, 1);
  assert.strictEqual(r.weightKg, SEAWEED_WEIGHT_KG);
  assert.strictEqual(r.unitsPerHour, SEAWEED_UNITS_PER_HOUR);
  assert.ok(r.marketIds.includes("T1_SEAWEED"));
});

test("all fishing/seaweed rows are non-enchantable with no enchant ids", () => {
  getGatheringResources().filter((r) => r.type === "fish").forEach((r) => {
    assert.strictEqual(r.enchantable, false, "fish must not be enchantable");
    assert.strictEqual(Object.keys(r.enchantIds || {}).length, 0, "fish leaked enchant ids");
  });
});

console.log("\n=== data-gathering — merged tracking rows ===");

test("tracking = 3 merged rows, one per remains tier (T3/T5/T7)", () => {
  const tracking = getGatheringResources().filter((r) => r.kind === "tracking");
  assert.strictEqual(tracking.length, 3, `tracking rows ${tracking.length}`);
  assert.deepStrictEqual(tracking.map((r) => r.tier), TRACK_TIERS);
  assert.deepStrictEqual(TRACK_TIERS, [3, 5, 7]);
});

test("trackArtifactTier maps T3→T4 (artifacts start at T4); T5→T5, T7→T7", () => {
  assert.strictEqual(trackArtifactTier(3), 4);
  assert.strictEqual(trackArtifactTier(5), 5);
  assert.strictEqual(trackArtifactTier(7), 7);
});

test("the 5 tracked animals are PANTHER/WEREWOLF/IMP/ELEMENTAL/EAGLE — Direbear & Ent excluded", () => {
  assert.deepStrictEqual([...TRACK_CREATURES].sort(), ["EAGLE", "ELEMENTAL", "IMP", "PANTHER", "WEREWOLF"]);
  assert.ok(!TRACK_CREATURES.includes("DIREBEAR"), "Direbear is a legacy ingredient, not a tracked animal");
  assert.ok(!TRACK_CREATURES.includes("ENT"), "Ent is a legacy ingredient, not a tracked animal");
});

test("each tracking row carries the 5 creature remains + 5 faction artifacts and loot tunables", () => {
  getGatheringResources().filter((r) => r.kind === "tracking").forEach((r) => {
    assert.strictEqual(r.profession.label, "Tracking");
    assert.strictEqual(r.type, "tracking");
    // staple: one Rare Animal Remains per tracked animal at this tier
    assert.strictEqual(r.remainsIds.length, TRACK_CREATURES.length, "5 creature remains");
    assert.strictEqual(TRACK_CREATURES.length, 5);
    assert.deepStrictEqual(r.remainsIds, TRACK_CREATURES.map((c) => `T${r.tier}_ALCHEMY_RARE_${c}`));
    assert.strictEqual(r.remainsWeightKg, REMAINS_WEIGHT_KG);
    assert.ok(r.remainsWeightKg < getResourceWeightKg(r.tier), "remains lighter than a mined unit");
    // bonus: one Shapeshifter artifact per faction at the mapped artifact tier
    const at = trackArtifactTier(r.tier);
    assert.strictEqual(r.artifactTier, at);
    assert.strictEqual(r.artifactIds.length, TRACK_ARTIFACT_FACTIONS.length, "5 faction artifacts");
    assert.ok(r.artifactIds.every((id) => id.startsWith(`T${at}_ARTEFACT_2H_SHAPESHIFTER_`)));
    assert.strictEqual(r.artifactWeightKg, TRACK_ARTIFACT_WEIGHT_KG);
    // per-kill / rate tunables
    assert.strictEqual(r.remainsPerKill, TRACK_REMAINS_PER_KILL);
    assert.strictEqual(r.artifactShare, TRACK_ARTIFACT_SHARE);
    assert.strictEqual(r.killsPerHour, TRACK_KILLS_PER_HOUR[r.tier]);
    assert.strictEqual(r.rareQuarryShare, TRACK_RARE_QUARRY_SHARE);
    assert.strictEqual(r.bmLootGross, TRACK_BM_LOOT_GROSS);
    // units/hour = remains/hour = kills/hour × remains/kill
    assert.strictEqual(r.unitsPerHour, TRACK_KILLS_PER_HOUR[r.tier] * TRACK_REMAINS_PER_KILL);
    // tracking never enchants, and prices both remains + artifacts
    assert.strictEqual(r.enchantable, false);
    assert.strictEqual(Object.keys(r.enchantIds || {}).length, 0);
    assert.deepStrictEqual(r.marketIds, [...r.remainsIds, ...r.artifactIds]);
  });
});

console.log("\n=== data-gathering — units/hour curve ===");

test("GATHER_UNITS_PER_HOUR covers T2–T8 and is strictly DECREASING", () => {
  for (let t = 3; t <= 8; t++) {
    assert.ok(GATHER_UNITS_PER_HOUR[t] > 0, `T${t} rate must be positive`);
    assert.ok(GATHER_UNITS_PER_HOUR[t] < GATHER_UNITS_PER_HOUR[t - 1],
      `T${t} (${GATHER_UNITS_PER_HOUR[t]}) should be < T${t - 1} (${GATHER_UNITS_PER_HOUR[t - 1]})`);
  }
});

test("FISH_UNITS_PER_HOUR covers T2–T8 and is strictly DECREASING", () => {
  for (let t = 3; t <= 8; t++) {
    assert.ok(FISH_UNITS_PER_HOUR[t] > 0, `T${t} fish rate must be positive`);
    assert.ok(FISH_UNITS_PER_HOUR[t] < FISH_UNITS_PER_HOUR[t - 1],
      `fish T${t} (${FISH_UNITS_PER_HOUR[t]}) should be < T${t - 1} (${FISH_UNITS_PER_HOUR[t - 1]})`);
  }
});

test("FISH_RARE_SHARE is a sane probability in (0,1)", () => {
  assert.ok(FISH_RARE_SHARE > 0 && FISH_RARE_SHARE < 1, `got ${FISH_RARE_SHARE}`);
});

console.log("\n=== calcFishingEconomics — merged fishing blend ===");

test("no rare → silver/hour = common net × units/hour (pure common)", () => {
  const r = calcFishingEconomics({ commonGross: 2000, commonWeightKg: 0.31, rareShare: 0, unitsPerHour: 350 });
  const net = 2000 * (1 - PREMIUM_TAX);
  assert.ok(Math.abs(r.netPerUnit - net) < 1e-9, `net ${r.netPerUnit}`);
  assert.strictEqual(r.weightKg, 0.31);
  assert.ok(Math.abs(r.silverPerHour - net * 350) < 1e-6, `silver/hour ${r.silverPerHour}`);
  assert.ok(Math.abs(r.silverPerKg - net / 0.31) < 1e-6, `silver/kg ${r.silverPerKg}`);
  assert.strictEqual(r.rareShareUsed, 0);
});

test("rare bonus is folded into silver/hour & silver/kg, ABOVE the common-only baseline", () => {
  const base = calcFishingEconomics({ commonGross: 2000, commonWeightKg: 0.31, rareShare: 0.08, unitsPerHour: 350 });
  const blended = calcFishingEconomics({
    commonGross: 2000, commonWeightKg: 0.31,
    rareGross: 30000, rareWeightKg: 0.78, rareShare: 0.08, unitsPerHour: 350,
  });
  const commonNet = 2000 * (1 - PREMIUM_TAX);
  const rareNet = 30000 * (1 - PREMIUM_TAX);
  const blendedNet = commonNet * 0.92 + rareNet * 0.08;
  const blendedWeight = 0.31 * 0.92 + 0.78 * 0.08;
  assert.ok(Math.abs(blended.blendedNetPerUnit - blendedNet) < 1e-6, `blendedNet ${blended.blendedNetPerUnit}`);
  assert.ok(Math.abs(blended.silverPerHour - blendedNet * 350) < 1e-6, `silver/hour ${blended.silverPerHour}`);
  assert.ok(Math.abs(blended.silverPerKg - blendedNet / blendedWeight) < 1e-6, `silver/kg ${blended.silverPerKg}`);
  assert.ok(blended.silverPerHour > base.silverPerHour, "rare bonus must lift silver/hour above common-only");
  // net/unit & weight stay the STAPLE common catch — the bonus shows only in /kg & /hr
  assert.ok(Math.abs(blended.netPerUnit - commonNet) < 1e-9, "net/unit stays the common catch");
  assert.strictEqual(blended.weightKg, 0.31, "weight stays the common catch");
  assert.strictEqual(blended.rareShareUsed, 0.08);
});

test("no rare PRICE collapses the blend to pure common (never invents value)", () => {
  const r = calcFishingEconomics({
    commonGross: 2000, commonWeightKg: 0.31, rareGross: 0, rareWeightKg: 0.78, rareShare: 0.08, unitsPerHour: 350,
  });
  const net = 2000 * (1 - PREMIUM_TAX);
  assert.strictEqual(r.rareShareUsed, 0);
  assert.ok(Math.abs(r.silverPerHour - net * 350) < 1e-6);
  assert.ok(Math.abs(r.silverPerKg - net / 0.31) < 1e-6);
});

test("no common price → zero silver, no NaN", () => {
  const r = calcFishingEconomics({ commonGross: 0, commonWeightKg: 0.31, rareShare: 0.08, unitsPerHour: 350 });
  assert.strictEqual(r.silverPerHour, 0);
  assert.strictEqual(r.silverPerKg, 0);
  assert.strictEqual(r.netPerUnit, 0);
});

console.log("\n=== calcTrackingEconomics — per-kill loot blend ===");

const TRACK_BASE = {
  remainsGross: 2000, remainsWeightKg: 0.05, remainsPerKill: 3,
  artifactWeightKg: 2, killsPerHour: 10,
};

test("remains only (no artifact, no BM) → net/unit & weight are the staple remains", () => {
  const r = calcTrackingEconomics({ ...TRACK_BASE });
  const remainsNet = 2000 * (1 - PREMIUM_TAX);
  assert.ok(Math.abs(r.netPerUnit - remainsNet) < 1e-9, `net/unit ${r.netPerUnit}`);
  assert.strictEqual(r.weightKg, 0.05);
  // pure remains ⇒ blended == staple, silver/hour = net × remains/hour, silver/kg = net ÷ weight
  assert.ok(Math.abs(r.blendedNetPerUnit - remainsNet) < 1e-9, `blended ${r.blendedNetPerUnit}`);
  assert.strictEqual(r.unitsPerHour, 30); // 10 kills × 3 remains
  assert.ok(Math.abs(r.silverPerHour - remainsNet * 30) < 1e-6, `silver/hour ${r.silverPerHour}`);
  assert.ok(Math.abs(r.silverPerKg - remainsNet / 0.05) < 1e-6, `silver/kg ${r.silverPerKg}`);
  assert.strictEqual(r.artifactShareUsed, 0);
  assert.strictEqual(r.bmLootPerKillUsed, 0);
});

test("artifact bonus is folded into silver/hour & silver/kg, ABOVE remains-only", () => {
  const base = calcTrackingEconomics({ ...TRACK_BASE });
  const r = calcTrackingEconomics({ ...TRACK_BASE, artifactGross: 50000, artifactShare: 0.15 });
  const remainsNet = 2000 * (1 - PREMIUM_TAX);
  const artNet = 50000 * (1 - PREMIUM_TAX);
  const killValue = remainsNet * 3 + artNet * 0.15;
  const killWeight = 0.05 * 3 + 2 * 0.15;
  assert.ok(Math.abs(r.blendedNetPerUnit - killValue / 3) < 1e-6, `blended ${r.blendedNetPerUnit}`);
  assert.ok(Math.abs(r.silverPerHour - killValue * 10) < 1e-6, `silver/hour ${r.silverPerHour}`);
  assert.ok(Math.abs(r.silverPerKg - killValue / killWeight) < 1e-6, `silver/kg ${r.silverPerKg}`);
  assert.ok(r.silverPerHour > base.silverPerHour, "artifact must lift silver/hour (more total value)");
  // NB: silver/kg may rise OR fall — the 2 kg artifact is heavy, so it lifts /kg only
  // when its value-per-kg beats the (extremely light, 0.05 kg) remains; here it dilutes.
  // silver/hour stays consistent with the renderer's blended × units identity
  assert.ok(Math.abs(r.silverPerHour - r.blendedNetPerUnit * r.unitsPerHour) < 1e-6, "silver/hour = blended × units");
  // net/unit & weight stay the staple remains (bonus shows only in /kg & /hr)
  assert.ok(Math.abs(r.netPerUnit - remainsNet) < 1e-9, "net/unit stays the remains");
  assert.strictEqual(r.weightKg, 0.05, "weight stays the remains");
  assert.strictEqual(r.artifactShareUsed, 0.15);
});

test("no artifact PRICE collapses the bonus to 0 (never invent value)", () => {
  const r = calcTrackingEconomics({ ...TRACK_BASE, artifactGross: 0, artifactShare: 0.15 });
  const remainsNet = 2000 * (1 - PREMIUM_TAX);
  assert.strictEqual(r.artifactShareUsed, 0);
  assert.ok(Math.abs(r.silverPerHour - remainsNet * 30) < 1e-6, "pure remains when artifact unpriced");
  assert.ok(Math.abs(r.silverPerKg - remainsNet / 0.05) < 1e-6);
});

test("Black Market loot lifts silver/hour but adds NO weight to silver/kg denominator", () => {
  const noBm = calcTrackingEconomics({ ...TRACK_BASE });
  const r = calcTrackingEconomics({ ...TRACK_BASE, bmLootPerKill: 7200 });
  const remainsNet = 2000 * (1 - PREMIUM_TAX);
  const bmNet = 7200 * (1 - PREMIUM_TAX);
  const killValue = remainsNet * 3 + bmNet;
  assert.ok(Math.abs(r.silverPerHour - killValue * 10) < 1e-6, `silver/hour ${r.silverPerHour}`);
  // /kg denominator is remains-only weight (BM loot is weightless silver)
  assert.ok(Math.abs(r.silverPerKg - killValue / (0.05 * 3)) < 1e-6, `silver/kg ${r.silverPerKg}`);
  assert.ok(r.silverPerHour > noBm.silverPerHour, "BM loot lifts silver/hour");
  assert.ok(Math.abs(r.bmLootPerKillUsed - 7200) < 1e-9);
});

test("no remains price → zero staple, no NaN", () => {
  const r = calcTrackingEconomics({ remainsGross: 0, remainsWeightKg: 0.05, remainsPerKill: 3, killsPerHour: 10 });
  assert.strictEqual(r.netPerUnit, 0);
  assert.strictEqual(r.silverPerHour, 0);
  assert.strictEqual(r.silverPerKg, 0);
  assert.strictEqual(r.weightKg, 0.05);
});

console.log("\n=== data-gathering — tracking tunables ===");

test("TRACK_KILLS_PER_HOUR covers T3/T5/T7 and is strictly DECREASING", () => {
  assert.ok(TRACK_KILLS_PER_HOUR[3] > TRACK_KILLS_PER_HOUR[5], "T3 > T5");
  assert.ok(TRACK_KILLS_PER_HOUR[5] > TRACK_KILLS_PER_HOUR[7], "T5 > T7");
  assert.ok(TRACK_KILLS_PER_HOUR[7] > 0, "T7 positive");
});

test("tracking shares are sane probabilities in (0,1); remains/kill positive", () => {
  assert.ok(TRACK_ARTIFACT_SHARE > 0 && TRACK_ARTIFACT_SHARE < 1, `artifact share ${TRACK_ARTIFACT_SHARE}`);
  assert.ok(TRACK_RARE_QUARRY_SHARE > 0 && TRACK_RARE_QUARRY_SHARE < 1, `quarry share ${TRACK_RARE_QUARRY_SHARE}`);
  assert.ok(TRACK_REMAINS_PER_KILL > 0, "remains/kill positive");
  assert.ok(REMAINS_WEIGHT_KG > 0 && TRACK_ARTIFACT_WEIGHT_KG > REMAINS_WEIGHT_KG, "artifact heavier than remains");
});

console.log("\n=== data-gathering — enchant distribution ===");

test("getEnchantDist is all-zero below T4 (no enchanted resources spawn there)", () => {
  [2, 3].forEach((t) => {
    const d = getEnchantDist(t);
    [1, 2, 3, 4].forEach((k) => assert.strictEqual(d[k], 0, `T${t}.${k} should be 0`));
  });
});

test("getEnchantDist falls off ~10x per enchant level at T4+ (.1 > .2 > .3 > .4 > 0)", () => {
  [4, 6, 8].forEach((t) => {
    const d = getEnchantDist(t, 0.2);
    assert.strictEqual(d[1], 0.2, "P(.1) should equal the zone rate");
    assert.ok(Math.abs(d[2] - 0.02) < 1e-12, `P(.2) ${d[2]}`);
    assert.ok(Math.abs(d[3] - 0.002) < 1e-12, `P(.3) ${d[3]}`);
    assert.ok(d[1] > d[2] && d[2] > d[3] && d[3] > d[4] && d[4] > 0, "strictly decreasing, positive");
  });
});

test("ZONE_ENCHANT_RATE default is a sane probability in (0,1)", () => {
  assert.ok(ZONE_ENCHANT_RATE > 0 && ZONE_ENCHANT_RATE < 1, `got ${ZONE_ENCHANT_RATE}`);
});

test("default zone rate reflects BLACK ZONES (Outlands) — above the royal rate", () => {
  assert.ok(BLACK_ZONE_ENCHANT_RATE > ROYAL_ENCHANT_RATE,
    "black/red zones spawn more enchanted resources than royal zones");
  assert.strictEqual(ZONE_ENCHANT_RATE, BLACK_ZONE_ENCHANT_RATE,
    "the default reflects black-zone gathering (where most gathering runs happen)");
  assert.ok(ROYAL_ENCHANT_RATE > 0 && BLACK_ZONE_ENCHANT_RATE < 1, "both rates sane in (0,1)");
});

console.log("\n=== data-gathering — enchant ids ===");

test("enchantable land rows expose enchant ids at T4+ (4 levels, but 3 for stone), none below T4", () => {
  getGatheringResources().forEach((r) => {
    const n = Object.keys(r.enchantIds || {}).length;
    if (ENCHANTABLE_TYPES.has(r.type) && r.tier >= 4) {
      const top = r.type === "rock" ? 3 : 4; // no pristine (.4) rock exists
      assert.strictEqual(n, top, `${r.rawId} should expose ${top} enchant ids`);
      assert.strictEqual(r.enchantIds[1], `${r.rawId}_LEVEL1@1`, `${r.rawId} enchant id format`);
      assert.strictEqual(r.enchantIds[top], `${r.rawId}_LEVEL${top}@${top}`);
      assert.strictEqual(r.enchantIds[4], r.type === "rock" ? undefined : `${r.rawId}_LEVEL4@4`);
    } else {
      assert.strictEqual(n, 0, `${r.rawId} should have no enchant ids`);
    }
  });
});

test("stone (Quarrying) enchants .1–.3 only; fish (Fishing) never enchants", () => {
  getGatheringResources().filter((r) => r.type === "rock").forEach((r) => {
    const levels = Object.keys(r.enchantIds || {});
    if (r.tier >= 4) {
      assert.deepStrictEqual(levels, ["1", "2", "3"], `${r.rawId} should cap at .3`);
      assert.strictEqual(r.enchantable, true, `${r.rawId} should be enchantable`);
    } else {
      assert.strictEqual(levels.length, 0, `${r.rawId} has no enchant below T4`);
    }
  });
  getGatheringResources().filter((r) => r.type === "fish").forEach((r) => {
    assert.strictEqual(Object.keys(r.enchantIds || {}).length, 0, `${r.rawId} leaked enchant ids`);
    assert.strictEqual(r.enchantable, false, `${r.rawId} must not be enchantable`);
  });
});

console.log("\n=== data-gathering — id getter ===");

test("getGatheringItemIds returns every row's marketIds, deduped (199 unique)", () => {
  const ids = getGatheringItemIds();
  const set = new Set(ids);
  assert.strictEqual(set.size, ids.length, "ids must be unique (deduped)");
  // every id any row needs priced is present
  getGatheringResources().forEach((r) =>
    (r.marketIds || []).forEach((id) => assert.ok(set.has(id), `missing market id ${id}`)));
  assert.ok(set.has("T4_ORE_LEVEL1@1"), "enchantable T4+ should add enchant ids");
  assert.ok(set.has("T8_FIBER_LEVEL4@4"));
  assert.ok(set.has("T5_FISH_FRESHWATER_ALL_COMMON"), "freshwater common fish should be fetched");
  assert.ok(set.has("T8_FISH_SALTWATER_ALL_COMMON"), "saltwater common fish should be fetched");
  assert.ok(set.has("T7_FISH_FRESHWATER_AVALON_RARE"), "avalon rare fish should be fetched");
  assert.ok(set.has("T3_FISH_SALTWATER_ALL_RARE"), "saltwater rare fish should be fetched");
  assert.ok(set.has("T1_SEAWEED"), "seaweed byproduct should be fetched");
  // tracking: rare animal remains (T3/T5/T7) + shapeshifter artifacts (T4/T5/T7)
  assert.ok(set.has("T5_ALCHEMY_RARE_WEREWOLF"), "T5 werewolf remains should be fetched");
  assert.ok(set.has("T7_ALCHEMY_RARE_PANTHER"), "T7 panther remains should be fetched");
  assert.ok(set.has("T4_ARTEFACT_2H_SHAPESHIFTER_AVALON"), "T3 row's bonus artifact maps to T4");
  assert.ok(set.has("T7_ARTEFACT_2H_SHAPESHIFTER_KEEPER"), "T7 shapeshifter artifact should be fetched");
  assert.ok(set.has("T4_ROCK_LEVEL1@1"), "enchanted raw stone IS gathered & traded");
  assert.ok(set.has("T8_ROCK_LEVEL3@3"), "stone enchants up to .3");
  assert.ok(!set.has("T4_ROCK_LEVEL4@4"), "no pristine (.4) rock exists");
  assert.ok(!set.has("T5_FISH_FRESHWATER_ALL_COMMON_LEVEL1@1"), "fish must NEVER get enchant ids");
  assert.ok(!set.has("T3_ORE_LEVEL1@1"), "no enchant ids below T4");
  assert.ok(!set.has("T3_ARTEFACT_2H_SHAPESHIFTER_AVALON"), "no T3 shapeshifter artifact (start at T4)");
  // 35 land + 95 land-enchant (4 fams × 5 tiers × 4 levels = 80, + stone 5 tiers ×
  // 3 levels = 15) + 14 commons + 21 rares + 1 seaweed = 166, plus tracking: 15
  // remains (5 tracked animals × T3/T5/T7) + 15 artifacts (5 factions × T4/T5/T7)
  // = 30 → 196, plus the 3 Ancient Lands leyfin → 199.
  assert.ok(set.has("T5_FISH_FRESHWATER_DRAGON_AREA_RARE"), "leyfin should be fetched");
  assert.strictEqual(ids.length, 199, `got ${ids.length}`);
});

test("known base ids are present (land + common/rare fish + seaweed)", () => {
  const ids = new Set(getGatheringItemIds());
  ["T4_ORE", "T8_HIDE", "T2_ROCK", "T6_WOOD", "T5_FIBER",
   "T6_FISH_FRESHWATER_ALL_COMMON", "T6_FISH_SALTWATER_ALL_COMMON",
   "T5_FISH_FRESHWATER_FOREST_RARE", "T7_FISH_SALTWATER_ALL_RARE", "T1_SEAWEED"].forEach((id) =>
    assert.ok(ids.has(id), `missing ${id}`));
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
