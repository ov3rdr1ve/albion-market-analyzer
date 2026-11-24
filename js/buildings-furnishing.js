/**
 * Furnishing a laborer house: which furniture, how many, and what it costs.
 *
 * A furniture slot is NOT generic. items.xml gives every laborer furniture item
 * a `labourersperfurnitureitem`, and the Building Costs table used to ignore it
 * — it filled all 70 slots of a guild hall with whichever single item was
 * cheapest, so a 15-laborer hall rendered as "70x <bed>". What the game
 * actually wants:
 *
 *   • BED    — serves 1 laborer. One per laborer, no exceptions.
 *   • TABLE  — serves 4 laborers below T5, 6 from T5 up. The community's "one
 *              table per 6" is only the top half of that.
 *   • TROPHY — serves 3 laborers, and its happiness stacks only across DISTINCT
 *              items: four copies of the same T8 trophy cover twelve laborers
 *              but still contribute +10, not +40.
 *
 * Bed + table of tier n contribute 50n each, i.e. exactly the 100n base
 * happiness a tier-n laborer wants, so they are mandatory AND sufficient for the
 * base. Everything above that is the trophy bonus, capped at 100.
 *
 * A BUILDING ONLY HOLDS FURNITURE OF ITS OWN TIER OR LOWER. A T6 house takes
 * T2-T6 trophies and nothing above, so every line offers `tier - 1` distinct
 * items, not seven. Trophy happiness does not vary with tier, so WITHIN that
 * window tier is purely a price question and the plan shops the cheapest —
 * which is why a T8 house (3 beds + 1 table + 10 trophies in 14 slots) lands on
 * 85/100 rather than the theoretical maximum, while a T6 house with the same
 * slot budget reaches only 75/100 and a T2 guild hall 15/100.
 *
 * The rule is not in the dumps: items.xml's `placeableindoors`/`placeableoutdoors`
 * say WHERE an item may stand, never in what tier of building, and buildings.xml
 * carries only `furniturelimit`/`laborerslimit`. So it is coded, here and in
 * js/house-tier.js for the tables that own no building.
 *
 * Sources: items.xml attributes above (the numbers are not restated here, they
 * are read out of BUILDING_LABORER_FURNITURE); wiki.albiononline.com/wiki/Laborer
 * for "base happiness is 100x laborer tier"; wiki.albiononline.com/wiki/House
 * for the tier rule.
 *
 * Pure — no DOM, no market access. `priceOf(id)` is injected by the caller and
 * returns { price, city }, price 0 when nothing lists the item.
 */

// Trophy line for a laborer, straight out of the catalog's `labourersaffected`.
// Reading it from items.xml sidesteps the slug mismatches that bite everywhere
// else in the app: the Stonecutter is laborer slug STONE but its trophy item is
// TROPHY_ROCK, and the Fisherman is FISHING / TROPHY_FISH. The dump already
// states TROPHY_ROCK affects "stone" and TROPHY_FISH affects "fishing", so
// matching on `affected` needs no translation table.
// Returns null for the crafter laborers (Blacksmith, Fletcher, Imbuer, Tinker),
// which genuinely have no specialist trophy — they get General Trophies only.
function getTrophySlugForLaborer(laborerSlug) {
  if (!laborerSlug) return null;
  const affected = String(laborerSlug).toLowerCase();
  const match = BUILDING_LABORER_FURNITURE.find(
    (f) => f.type === "trophy" && f.affected === affected);
  if (!match) return null;
  const m = match.id.match(/_TROPHY_([A-Z_]+)$/);
  return m ? m[1] : null;
}

// Cheapest-first list of the distinct trophies of one line, skipping any tier
// nothing lists — an unpriced tier is not a free tier, it is unbuyable — and any
// tier ABOVE the building, which cannot be placed in it at all.
function _trophyCandidates(affected, priceOf, maxTier) {
  return BUILDING_LABORER_FURNITURE
    .filter((f) => f.type === "trophy" && f.affected === affected && f.tier <= maxTier)
    .map((f) => {
      const { price, city } = priceOf(f.id) || {};
      return { ...f, price: price || 0, city: city || null };
    })
    .filter((f) => f.price > 0)
    .sort((a, b) => a.price - b.price || a.tier - b.tier);
}

/**
 * Plan the furniture for one building.
 *
 * @param {object} args
 *   tier           — the building's tier; fixes the bed and table tier and caps
 *                    the trophy tiers, since nothing above it can be placed.
 *   laborers       — how many laborers to house (the building's laborer limit).
 *   furnitureSlots — the building's furniture limit, the whole budget.
 *   laborerSlug    — LABORERS[].slug, picks the specialist trophy line.
 *   priceOf        — (itemId) => { price, city }.
 * @returns {{
 *   beds: { id, count, price, city }, tables: { id, count, price, city },
 *   trophies: Array<{ id, tier, copies, price, city, happiness }>,
 *   baseHappiness: number, trophyHappiness: number,
 *   furnitureCost: number, slotsUsed: number, slotsSpare: number,
 *   bedsAndTablesFit: boolean, allPriced: boolean,
 * }}
 */
function planFurnishing({ tier, laborers, furnitureSlots, laborerSlug, priceOf }) {
  const bed = getBuildingFurnitureByType("bed", tier)[0] || null;
  const table = getBuildingFurnitureByType("table", tier)[0] || null;

  const priced = (item) => {
    if (!item) return { id: null, count: 0, price: 0, city: null, happiness: 0 };
    const { price, city } = priceOf(item.id) || {};
    return { id: item.id, price: price || 0, city: city || null, happiness: item.happiness };
  };

  const beds = { ...priced(bed), count: 0 };
  const tables = { ...priced(table), count: 0 };
  const empty = {
    beds, tables, trophies: [], baseHappiness: 0, trophyHappiness: 0,
    furnitureCost: 0, slotsUsed: 0, slotsSpare: furnitureSlots,
    bedsAndTablesFit: true, allPriced: true,
  };
  if (!laborers || laborers <= 0 || !bed || !table) return empty;

  beds.count = Math.ceil(laborers / bed.perItem);
  tables.count = Math.ceil(laborers / table.perItem);

  // Mandatory furniture first. If it does not fit there is nothing to plan —
  // report it rather than silently trimming beds, since a laborer without a bed
  // is not a cheaper laborer, it is a laborer you cannot place.
  const mandatory = beds.count + tables.count;
  if (mandatory > furnitureSlots) {
    return {
      ...empty, beds, tables,
      baseHappiness: beds.happiness + tables.happiness,
      furnitureCost: 0, slotsUsed: 0, slotsSpare: furnitureSlots,
      bedsAndTablesFit: false,
      allPriced: beds.price > 0 && tables.price > 0,
    };
  }

  // Trophies fill what is left. One trophy serves `perItem` laborers, so each
  // DISTINCT trophy has to be bought in a block of `copies` to cover the whole
  // crew — a part-block would leave some laborers outside its effect while
  // still costing a slot, so blocks are taken whole or not at all.
  //
  // Only tiers the building can physically hold are on offer: `tier` caps the
  // ladder, so a T6 house is never planned with a T7 trophy it cannot place.
  const specialistSlug = String(laborerSlug || "").toLowerCase();
  // Specialists first: +10 a slot against the General Trophy's +5.
  const groups = [
    _trophyCandidates(specialistSlug, priceOf, tier),
    _trophyCandidates("all", priceOf, tier),
  ];

  const trophies = [];
  let remaining = furnitureSlots - mandatory;
  let rawHappiness = 0;
  groups.forEach((group) => {
    group.forEach((t) => {
      const copies = Math.ceil(laborers / t.perItem);
      if (copies <= 0 || remaining < copies) return;
      remaining -= copies;
      rawHappiness += t.happiness;
      trophies.push({
        id: t.id, tier: t.tier, copies, price: t.price, city: t.city,
        happiness: t.happiness, affected: t.affected,
      });
    });
  });

  const trophyCost = trophies.reduce((s, t) => s + t.price * t.copies, 0);
  const slotsUsed = mandatory + trophies.reduce((s, t) => s + t.copies, 0);

  return {
    beds, tables, trophies,
    baseHappiness: beds.happiness + tables.happiness,
    // The in-game bonus tops out at 100; the seven specialist and seven general
    // tiers add up to 105, so a fully trophied single laborer overshoots it.
    trophyHappiness: Math.min(100, rawHappiness),
    furnitureCost: beds.price * beds.count + tables.price * tables.count + trophyCost,
    slotsUsed,
    slotsSpare: furnitureSlots - slotsUsed,
    bedsAndTablesFit: true,
    // Trophies are optional, so an unpriced trophy tier is simply not bought.
    // An unpriced bed or table is fatal: there is no plan without them.
    allPriced: beds.price > 0 && tables.price > 0,
  };
}

// Display name for a whole trophy LINE, from any one of its item ids.
//
// The individual tiers have unrelated item names — the Wood Trophy ladder runs
// Birch Bonsai at T2 and something else entirely at T8 — so a group of tiers
// cannot borrow the name of any one of them, which is what made a guild hall's
// furniture cell read "35x Birch Bonsai T2–T8".
//
// Keyed on the id's trophy slug rather than on `affected`, because that is the
// half of the pair TROPHY_LABORERS also names the line after: the Stonecutter's
// trophy is TROPHY_ROCK, called the "Rock Trophy", but its `affected` is "stone".
// Deriving from the slug means the fallback below yields the same string as the
// catalog for every line instead of inventing a "Stone Trophy".
function getTrophyLineName(trophyId) {
  const m = String(trophyId || "").match(/_TROPHY_([A-Z_]+)$/);
  const slug = m ? m[1] : "";
  if (typeof TROPHY_LABORERS !== "undefined") {
    const line = TROPHY_LABORERS.find((l) => l.trophySlug === slug);
    if (line) return line.name;
  }
  return `${slug.charAt(0)}${slug.slice(1).toLowerCase()} Trophy`;
}

/**
 * Compact tier label for a set of trophy tiers: "T2–T8" when the tiers run
 * contiguously, an explicit list otherwise. The plan buys the CHEAPEST tiers, so
 * the picks are often non-contiguous and a range would misreport them.
 */
function formatTierRange(tiers) {
  const sorted = [...tiers].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return `T${sorted[0]}`;
  const contiguous = sorted.every((t, i) => i === 0 || t === sorted[i - 1] + 1);
  return contiguous
    ? `T${sorted[0]}–T${sorted[sorted.length - 1]}`
    : sorted.map((t) => `T${t}`).join(" ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    planFurnishing, getTrophySlugForLaborer, getTrophyLineName, formatTierRange,
  };
}
