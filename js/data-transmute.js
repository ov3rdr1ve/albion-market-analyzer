/**
 * Transmute Data & Helpers
 *
 * The Transmute table models in-game Transmuting — buy a source item, pay a
 * silver transmute fee, sell the upgraded result:
 *   - Materials, type-up: 1:1 same-tier Rune→Soul→Relic→Avalonian Shard.
 *   - Materials, tier-up: 5:1 T(n)→T(n+1) of the SAME type, free (silver 0).
 *   - Resources: tier-up (T(n)→T(n+1)) and enchant-up (T(n).e→T(n).(e+1)) of the
 *     same raw resource (Wood/Ore/Fiber/Hide). Stone is tier-up at enchant 0 ONLY:
 *     enchanted raw rock exists & trades, but the game excludes stone from the
 *     enchant axis AND from tier-up at enchanted levels (wiki "For stone" table is
 *     a single enchant-0 column). See [[project_stone_no_enchant]].
 *
 * Each builder returns recipe descriptors the renderer consumes directly:
 *   { kind, tier, sourceId, targetId, sourceCount, silverCost,
 *     transition: { label, … }, color }
 * `tier` is the SOURCE tier (drives the Tier column / sort / filter).
 * `sourceCount` is how many source units one target costs — 1 everywhere except
 * the material tier-ups, which are 5:1.
 * `transition.label` must be unique per `tier` so transmute-table row keys
 * (`${tier}|${label}|${section}`) stay collision-free.
 *
 * Resource labels come from resourceShortName() (js/resource-names.js, loaded
 * first in index.html), e.g. "4 ore → 5 ore", "6.1 logs → 6.2 logs".
 */

// ─────────────────────────────────────────────────────────────────────────────
// Materials — same-tier type upgrades (Rune→Soul→Relic→Avalonian Shard) and
// same-type tier upgrades (5× T(n) → 1× T(n+1))
// ─────────────────────────────────────────────────────────────────────────────

const TRANSMUTE_TRANSITIONS = [
  { from: "RUNE", to: "SOUL", label: "Rune → Soul" },
  { from: "SOUL", to: "RELIC", label: "Soul → Relic" },
  { from: "RELIC", to: "SHARD_AVALONIAN", label: "Relic → Aval. Shard" },
];

// Silver cost for 1:1 type upgrades (from in-game data, doubles per tier).
// Soul→Relic and Relic→Shard cost 4× Rune→Soul.
const TRANSMUTE_SILVER_COST = {
  RUNE_SOUL:                { 4: 723, 5: 1445, 6: 2890, 7: 5780, 8: 11560 },
  SOUL_RELIC:               { 4: 2890, 5: 5780, 6: 11560, 7: 23120, 8: 46240 },
  RELIC_SHARD_AVALONIAN:    { 4: 2890, 5: 5780, 6: 11560, 7: 23120, 8: 46240 },
};

const TRANSMUTE_MATERIAL_COLORS = {
  RUNE_SOUL: "#7ab8c4",
  SOUL_RELIC: "#b07ac4",
  RELIC_SHARD_AVALONIAN: "#c4c47a",
};

// Tier-up families and their display names. Avalonian Shards climb the tier
// ladder exactly like Runes/Souls/Relics do — the wiki only documents the rune
// and soul cases, but items.xml carries the recipe for all four.
const TRANSMUTE_MATERIAL_FAMILIES = [
  { family: "RUNE", name: "Rune", color: "#7ab8c4" },
  { family: "SOUL", name: "Soul", color: "#b07ac4" },
  { family: "RELIC", name: "Relic", color: "#c4c47a" },
  { family: "SHARD_AVALONIAN", name: "Aval. Shard", color: "#7ac48f" },
];

// A tier-up consumes 5 of the lower tier and charges NO silver:
//   <simpleitem uniquename="T5_RELIC" …>
//     <craftingrequirements time="0.01" silver="0">
//       <craftresource uniquename="T4_RELIC" count="5" maxreturnamount="0" />
// Same shape for every family and every step T4→T5 … T7→T8. No craftingfocus
// attribute → no focus; silver 0 → no station fee (transmute nutrition scales
// with the fixed transmute silver, see transmuteNutrition).
const TRANSMUTE_MATERIAL_TIERUP_COUNT = 5;

function getTransmuteSilverCost(fromType, toType, tier) {
  const key = `${fromType}_${toType}`;
  return TRANSMUTE_SILVER_COST[key]?.[tier] || 0;
}

function getMaterialTransmuteRecipes() {
  const recipes = [];

  // Type-up: 1:1, same tier, silver fee.
  for (let tier = 4; tier <= 8; tier++) {
    TRANSMUTE_TRANSITIONS.forEach((t) => {
      recipes.push({
        kind: "material",
        tier,
        sourceId: `T${tier}_${t.from}`,
        targetId: `T${tier}_${t.to}`,
        sourceCount: 1,
        silverCost: getTransmuteSilverCost(t.from, t.to, tier),
        transition: { from: t.from, to: t.to, label: t.label },
        color: TRANSMUTE_MATERIAL_COLORS[`${t.from}_${t.to}`] || "#c4a07a",
      });
    });
  }

  // Tier-up: 5:1, same type, free.
  TRANSMUTE_MATERIAL_FAMILIES.forEach(({ family, name, color }) => {
    for (let tier = 4; tier <= 7; tier++) {
      recipes.push({
        kind: "material",
        family,
        tier,
        sourceId: `T${tier}_${family}`,
        targetId: `T${tier + 1}_${family}`,
        sourceCount: TRANSMUTE_MATERIAL_TIERUP_COUNT,
        silverCost: 0,
        transition: {
          from: family,
          to: family,
          label: `${TRANSMUTE_MATERIAL_TIERUP_COUNT}× ${name} → T${tier + 1} ${name}`,
        },
        color,
      });
    }
  });

  return recipes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resources — tier-up & enchant-up of raw resources (Wild Blood Update values)
// ─────────────────────────────────────────────────────────────────────────────

// These four families share identical item values per tier, so the transmute fee
// depends only on tier/enchant, not on which resource. Stone (ROCK) is handled
// separately: the game allows ONLY enchant-0 tier-up for stone — no enchant-up and
// no tier-up at enchanted levels — even though enchanted raw rock itself exists and
// trades. So stone is excluded from this list and its enchant axis entirely.
const TRANSMUTE_RESOURCE_FAMILIES = ["WOOD", "ORE", "FIBER", "HIDE"];

// Tier-up fee, keyed by the RESULTING tier then enchant level (Wood/Ore/Fiber/Hide).
// Read off the in-game transmute window (hide ladder re-verified 2026-07-25).
// Do NOT "correct" these from items.xml: items.xml gives T5_HIDE silver=1180,
// identical to T5_ROCK, but the game charges 781 for hide and 1367 for stone —
// the dump is stale on the non-stone families. Stone is the only family whose
// items.xml value still tracks the charge (× ~1.157).
const TRANSMUTE_TIERUP_COST = {
  5: { 0: 781,  1: 1563,  2: 3125,  3: 6250,   4: 25000 },
  6: { 0: 1250, 1: 2500,  2: 5000,  3: 16500,  4: 66000 },
  7: { 0: 2500, 1: 5000,  2: 15750, 3: 51975,  4: 207900 },
  8: { 0: 5000, 1: 15000, 2: 47250, 3: 155925, 4: 779625 },
};

// Enchant-up fee, keyed by tier then the RESULTING enchant (Wood/Ore/Fiber/Hide).
const TRANSMUTE_ENCHANTUP_COST = {
  4: { 1: 1500,  2: 3000,  3: 6000,   4: 24000 },
  5: { 1: 2000,  2: 4000,  3: 8000,   4: 32000 },
  6: { 1: 3000,  2: 6000,  3: 19800,  4: 79200 },
  7: { 1: 4800,  2: 15120, 3: 49896,  4: 199584 },
  8: { 1: 14400, 2: 45360, 3: 149688, 4: 784440 },
};

// Stone tier-up fee (enchant 0 only — the game's "For stone" table is a single
// enchant-0 column), keyed by the resulting tier.
// Read off the in-game transmute window 2026-07-25. The old values (1180, 2640,
// 5640, 14080) were the RAW items.xml `silver` attributes, which the client
// scales by ~1.157 before charging (1180×1.157=1365, 14080×1.157=16293) — so
// stone was undercharged ~13.6% at every tier.
const TRANSMUTE_STONE_TIERUP_COST = { 5: 1367, 6: 3057, 7: 6527, 8: 16292 };

const TRANSMUTE_RESOURCE_COLORS = {
  WOOD: "#9ccb7a", ORE: "#9fb0bf", FIBER: "#c79bd4", HIDE: "#c9a07a", ROCK: "#a8a29e",
};

// Market-format resource id: enchant 0 is bare, enchant n is _LEVELn@n — the form
// the AODP and the rest of the app use for raw + refined resources.
function transmuteResourceId(family, tier, enchant) {
  return enchant ? `T${tier}_${family}_LEVEL${enchant}@${enchant}` : `T${tier}_${family}`;
}

function makeResourceRecipe(family, srcTier, srcEnch, tgtTier, tgtEnch, silverCost) {
  const sourceId = transmuteResourceId(family, srcTier, srcEnch);
  const targetId = transmuteResourceId(family, tgtTier, tgtEnch);
  return {
    kind: "resource",
    family,
    tier: srcTier,
    sourceId,
    targetId,
    sourceCount: 1,
    silverCost,
    transition: { label: `${resourceShortName(sourceId)} → ${resourceShortName(targetId)}` },
    color: TRANSMUTE_RESOURCE_COLORS[family] || "#c4a07a",
  };
}

function getResourceTransmuteRecipes() {
  const recipes = [];

  TRANSMUTE_RESOURCE_FAMILIES.forEach((family) => {
    // Tier-up: T(n) → T(n+1) at the same enchant, for every enchant level.
    for (let tgtTier = 5; tgtTier <= 8; tgtTier++) {
      for (let ench = 0; ench <= 4; ench++) {
        const c = TRANSMUTE_TIERUP_COST[tgtTier]?.[ench];
        if (c == null) continue;
        recipes.push(makeResourceRecipe(family, tgtTier - 1, ench, tgtTier, ench, c));
      }
    }
    // Enchant-up: T(n).e → T(n).(e+1) at the same tier.
    for (let tier = 4; tier <= 8; tier++) {
      for (let tgtEnch = 1; tgtEnch <= 4; tgtEnch++) {
        const c = TRANSMUTE_ENCHANTUP_COST[tier]?.[tgtEnch];
        if (c == null) continue;
        recipes.push(makeResourceRecipe(family, tier, tgtEnch - 1, tier, tgtEnch, c));
      }
    }
  });

  // Stone: tier-up only, enchant 0.
  for (let tgtTier = 5; tgtTier <= 8; tgtTier++) {
    const c = TRANSMUTE_STONE_TIERUP_COST[tgtTier];
    if (c == null) continue;
    recipes.push(makeResourceRecipe("ROCK", tgtTier - 1, 0, tgtTier, 0, c));
  }

  return recipes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource chains — multi-step (≥2) transmute paths
// ─────────────────────────────────────────────────────────────────────────────

// Three chain shapes: pure-tier (fixed enchant), pure-enchant (fixed tier), and
// mixed (both tier AND enchant climb). A chain buys the start node, pays the
// SUMMED per-step fees, and sells the end node — structurally a single-step row
// with sourceId=start, targetId=end and silverCost=Σ fees, so the renderer prices
// it with the same logic. The renderer groups candidates by `groupKey`
// (axis|targetId, axis ∈ tier|enchant|mixed) and shows the single most profitable
// start per (axis, end product) — so each end product can surface one best row per
// shape. Fees reuse the single-step tables, summed along the path; for mixed
// chains the cheapest path is found with a DP (see makeMixedChain).

function _chainStepFee(family, axis, fixed, fromIdx) {
  // fixed = tier for the enchant axis, enchant for the tier axis. fromIdx is the
  // lower coordinate of the step; the fee is keyed by the RESULTING coordinate.
  if (axis === "enchant") return TRANSMUTE_ENCHANTUP_COST[fixed]?.[fromIdx + 1];
  return family === "ROCK"
    ? TRANSMUTE_STONE_TIERUP_COST[fromIdx + 1]
    : TRANSMUTE_TIERUP_COST[fromIdx + 1]?.[fixed];
}

// Build one chain from `startIdx` to `endIdx` (inclusive node coords) along an
// axis. Returns null if any step is unsupported (e.g. a stone enchant step).
function makeChain(family, axis, fixed, startIdx, endIdx) {
  const nodeId = (idx) =>
    axis === "enchant"
      ? transmuteResourceId(family, fixed, idx)   // fixed tier, idx = enchant
      : transmuteResourceId(family, idx, fixed);  // fixed enchant, idx = tier

  const steps = [];
  let silverCost = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const fee = _chainStepFee(family, axis, fixed, i);
    if (fee == null) return null;
    steps.push({ fromId: nodeId(i), toId: nodeId(i + 1), fee });
    silverCost += fee;
  }

  const sourceId = steps[0].fromId;
  const targetId = steps[steps.length - 1].toId;
  // Word ("logs"/"ore"/…) read off the short name so labels stay localised
  // without depending on RESOURCE_WORDS leaking across module scopes.
  const word = resourceShortName(sourceId).split(" ").pop();
  const coords = [];
  for (let i = startIdx; i <= endIdx; i++) {
    coords.push(axis === "enchant" ? `${fixed}.${i}` : (fixed ? `${i}.${fixed}` : `${i}`));
  }

  return {
    kind: "chain",
    axis,
    family,
    tier: axis === "enchant" ? fixed : startIdx,   // SOURCE tier
    sourceId,
    targetId,
    steps,
    silverCost,
    groupKey: `${axis}|${targetId}`,
    transition: { label: `${coords.join(" → ")} ${word}` },
    color: TRANSMUTE_RESOURCE_COLORS[family] || "#c4a07a",
  };
}

// Build the CHEAPEST mixed-axis chain from (srcTier,srcEnch) to (tgtTier,tgtEnch)
// where BOTH coordinates strictly increase. Each step is +1 tier OR +1 enchant;
// per-step fees reuse the single-step tables (via _chainStepFee). Tier-up and
// enchant-up fees differ by the node they pass through, so step order matters —
// a small grid DP over the rectangle finds the min-fee route, which is then
// reconstructed into the same descriptor shape makeChain() returns. Wood/ore/
// fiber/hide only — the game has no stone enchant transmutation, so ROCK never
// reaches a mixed (tier+enchant) end.
function makeMixedChain(family, srcTier, srcEnch, tgtTier, tgtEnch) {
  const key = (t, e) => `${t},${e}`;
  const cost = { [key(srcTier, srcEnch)]: 0 };
  const via = {};                                       // arrival move: "tier" | "enchant"
  for (let t = srcTier; t <= tgtTier; t++) {
    for (let e = srcEnch; e <= tgtEnch; e++) {
      if (t === srcTier && e === srcEnch) continue;
      let best = Infinity, move = null;
      if (t > srcTier && cost[key(t - 1, e)] != null) {   // arrived by tier-up
        const f = _chainStepFee(family, "tier", e, t - 1);
        if (f != null && cost[key(t - 1, e)] + f < best) { best = cost[key(t - 1, e)] + f; move = "tier"; }
      }
      if (e > srcEnch && cost[key(t, e - 1)] != null) {   // arrived by enchant-up
        const f = _chainStepFee(family, "enchant", t, e - 1);
        if (f != null && cost[key(t, e - 1)] + f < best) { best = cost[key(t, e - 1)] + f; move = "enchant"; }
      }
      if (move) { cost[key(t, e)] = best; via[key(t, e)] = move; }
    }
  }
  if (cost[key(tgtTier, tgtEnch)] == null) return null;

  // Walk back along `via` to recover the node path, then re-emit it forwards.
  const nodes = [];
  for (let t = tgtTier, e = tgtEnch; ; ) {
    nodes.push([t, e]);
    if (t === srcTier && e === srcEnch) break;
    if (via[key(t, e)] === "tier") t -= 1; else e -= 1;
  }
  nodes.reverse();

  const steps = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const [t0, e0] = nodes[i], [t1, e1] = nodes[i + 1];
    const fee = t1 > t0
      ? _chainStepFee(family, "tier", e0, t0)
      : _chainStepFee(family, "enchant", t0, e0);
    steps.push({ fromId: transmuteResourceId(family, t0, e0), toId: transmuteResourceId(family, t1, e1), fee });
  }

  const sourceId = steps[0].fromId;
  const targetId = steps[steps.length - 1].toId;
  const word = resourceShortName(sourceId).split(" ").pop();
  const coords = nodes.map(([t, e]) => (e ? `${t}.${e}` : `${t}`));

  return {
    kind: "chain",
    axis: "mixed",
    family,
    tier: srcTier,                                      // SOURCE tier
    sourceId,
    targetId,
    steps,
    silverCost: cost[key(tgtTier, tgtEnch)],
    groupKey: `mixed|${targetId}`,
    transition: { label: `${coords.join(" → ")} ${word}` },
    color: TRANSMUTE_RESOURCE_COLORS[family] || "#c4a07a",
  };
}

function getResourceTransmuteChains() {
  const chains = [];

  // Enchant chains: fixed tier, enchant start..end ≥2 apart (Wood/Ore/Fiber/Hide).
  TRANSMUTE_RESOURCE_FAMILIES.forEach((family) => {
    for (let tier = 4; tier <= 8; tier++) {
      for (let s = 0; s <= 4; s++) {
        for (let e = s + 2; e <= 4; e++) {
          const c = makeChain(family, "enchant", tier, s, e);
          if (c) chains.push(c);
        }
      }
    }
  });

  // Tier chains: fixed enchant, tier start..end ≥2 apart. Stone is enchant 0 only.
  [...TRANSMUTE_RESOURCE_FAMILIES, "ROCK"].forEach((family) => {
    const maxEnch = family === "ROCK" ? 0 : 4;
    for (let ench = 0; ench <= maxEnch; ench++) {
      for (let s = 4; s <= 8; s++) {
        for (let e = s + 2; e <= 8; e++) {
          const c = makeChain(family, "tier", ench, s, e);
          if (c) chains.push(c);
        }
      }
    }
  });

  // Mixed chains: BOTH tier and enchant strictly increase, cheapest path per
  // (start,end). Wood/ore/fiber/hide only — the game has no stone enchant
  // transmutation, so stone never has a mixed (tier+enchant) chain.
  TRANSMUTE_RESOURCE_FAMILIES.forEach((family) => {
    for (let ts = 4; ts < 8; ts++) {
      for (let te = ts + 1; te <= 8; te++) {
        for (let es = 0; es < 4; es++) {
          for (let ee = es + 1; ee <= 4; ee++) {
            const c = makeMixedChain(family, ts, es, te, ee);
            if (c) chains.push(c);
          }
        }
      }
    }
  });

  return chains;
}

// ─────────────────────────────────────────────────────────────────────────────
// Station usage fee — nutrition per transmute
// ─────────────────────────────────────────────────────────────────────────────

// Transmuting at a crafting station charges the fixed transmute silver PLUS the
// station usage fee, exactly like crafting. The usage fee = (station rate / 100)
// × nutrition, and transmute nutrition scales with the FIXED transmute silver,
// NOT the resource itemvalue (raw hide itemvalue is 4–124 — far too small to
// yield the observed fees).
//
// Calibrated 2026-07-18 against the full T4–T8 hide grid read off a 930/100
// station: the station fee is a steady ~15.7% of the fixed silver across every
// tier/enchant step. Anchored to the largest step, 7.4→8.4 (fixed 779,625 → fee
// 122,050), so fee = (930/100) × silver × 0.016833 hits it exactly; every other
// step lands within ~130 silver (<0.1%). The old 0.00504 assumed a T8 1-mat
// itemvalue of 224 → undercharged the fee ~3.4×.
const TRANSMUTE_NUTRITION_PER_SILVER = 0.016833;

function transmuteNutrition(silverCost) {
  return (silverCost || 0) * TRANSMUTE_NUTRITION_PER_SILVER;
}

// ── Exact resource station-fee grid ──────────────────────────────────────────
// The station usage fee for a resource transmute step is NOT a flat % of the
// fixed silver — it drifts across the tier/enchant grid (verified in-game on the
// full T4–T8 hide ladder). These are the measured fees at a REFERENCE station
// rate of 930/100 nutrition; they scale linearly with the #station-fee field.
// Shared by wood/ore/fiber/hide (identical item values per tier). Stone (ROCK)
// and the crystal materials have no measured grid → they keep the linear model.
// Keyed by the RESULTING tier then enchant of the step.
const TRANSMUTE_STATION_FEE_REF_RATE = 930;
const TRANSMUTE_TIERUP_STATIONFEE = {
  5: { 0: 127, 1: 255,  2: 510,  3: 1020,  4: 3979 },
  6: { 0: 203, 1: 407,  2: 813,  3: 2641,  4: 10430 },
  7: { 0: 403, 1: 807,  2: 2511, 3: 8215,  4: 32647 },
  8: { 0: 807, 1: 2394, 2: 7478, 3: 24539, 4: 122050 },
};
const TRANSMUTE_ENCHANTUP_STATIONFEE = {
  4: { 1: 247,  2: 497,  3: 999,   4: 3874 },
  5: { 1: 323,  2: 646,  3: 1293,  4: 5081 },
  6: { 1: 485,  2: 969,  3: 3156,  4: 12489 },
  7: { 1: 776,  2: 2412, 3: 7891,  4: 31349 },
  8: { 1: 2300, 2: 7183, 3: 23566, 4: 81185 },
};

// Fee at the reference rate for one resource step, or null when off-grid.
function transmuteGridStationFeeRef(kind, resultTier, resultEnchant) {
  const grid = kind === "tier" ? TRANSMUTE_TIERUP_STATIONFEE : TRANSMUTE_ENCHANTUP_STATIONFEE;
  return grid[resultTier]?.[resultEnchant] ?? null;
}

// Parse a market resource id (T7_HIDE, T8_HIDE_LEVEL4@4) into node coords.
function parseResourceNode(id) {
  const m = typeof id === "string" &&
    id.match(/^T([2-8])_(WOOD|ORE|FIBER|HIDE|ROCK)(?:_LEVEL([1-4])@[1-4])?$/);
  if (!m) return null;
  return { tier: parseInt(m[1], 10), family: m[2], enchant: m[3] ? parseInt(m[3], 10) : 0 };
}

// Nutrition to feed calcStationFeeSilver for one step. Resource wood/ore/fiber/
// hide steps read the measured grid (fee ÷ ref-rate/100); everything else falls
// back to the linear silver model. `fee` is that step's fixed transmute silver.
function transmuteStepNutrition(kind, resultTier, resultEnchant, family, fee) {
  if (family && family !== "ROCK") {
    const ref = transmuteGridStationFeeRef(kind, resultTier, resultEnchant);
    if (ref != null) return ref / (TRANSMUTE_STATION_FEE_REF_RATE / 100);
  }
  return transmuteNutrition(fee);
}

// Total station fee (silver, at the current #station-fee rate) for a transmute
// recipe: chains sum their per-step fees; single resource steps read the grid;
// materials/stone use the linear fallback.
function transmuteRouteStationFee(recipe) {
  if (typeof calcStationFeeSilver !== "function") return 0;
  const stepFee = (fromId, toId, fee) => {
    const from = parseResourceNode(fromId), to = parseResourceNode(toId);
    let kind = null, family = null, tier = recipe.tier, ench = 0;
    if (from && to) {
      kind = to.tier > from.tier ? "tier" : "enchant";
      family = to.family; tier = to.tier; ench = to.enchant;
    }
    return calcStationFeeSilver(tier, 1, transmuteStepNutrition(kind, tier, ench, family, fee));
  };
  if (recipe.steps && recipe.steps.length) {
    return recipe.steps.reduce((s, st) => s + stepFee(st.fromId, st.toId, st.fee), 0);
  }
  if (recipe.kind === "resource") return stepFee(recipe.sourceId, recipe.targetId, recipe.silverCost);
  // materials (type-up silver fee, tier-up silver 0) and anything off-grid.
  return calcStationFeeSilver(recipe.tier, 1, transmuteNutrition(recipe.silverCost));
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined feed for the renderer + scan
// ─────────────────────────────────────────────────────────────────────────────

function getTransmuteRecipes() {
  return getMaterialTransmuteRecipes().concat(getResourceTransmuteRecipes());
}

function getTransmuteItemIds() {
  const ids = new Set();
  getTransmuteRecipes().forEach((r) => { ids.add(r.sourceId); ids.add(r.targetId); });
  return Array.from(ids);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TRANSMUTE_TRANSITIONS,
    getTransmuteSilverCost,
    getMaterialTransmuteRecipes,
    getResourceTransmuteRecipes,
    getResourceTransmuteChains,
    getTransmuteRecipes,
    getTransmuteItemIds,
    TRANSMUTE_NUTRITION_PER_SILVER,
    transmuteNutrition,
    TRANSMUTE_STATION_FEE_REF_RATE,
    TRANSMUTE_TIERUP_STATIONFEE,
    TRANSMUTE_ENCHANTUP_STATIONFEE,
    transmuteGridStationFeeRef,
    parseResourceNode,
    transmuteStepNutrition,
    transmuteRouteStationFee,
  };
}
