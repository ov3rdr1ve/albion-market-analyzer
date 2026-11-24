/**
 * Black Zone (Outlands) production bonuses.
 *
 * Reference data only — the profit tables still craft/refine in cities, since
 * hideouts have no marketplace price feed. Sources: Albion wiki "Resource
 * Return Rate" / "Hideout", plus patch 19.000.1 (which removed the hideout
 * refining specialization).
 *
 * Model:
 *   - Hideout LEVEL (1-3) buys building slots and NPCs. It does NOT change any
 *     production bonus. The two drivers are:
 *       Zone Quality  (1-6, higher toward the center of the Outlands)
 *       Power Level   (1-9, fed by Power Cores, decays over time)
 *   - General crafting bonus: Power Level only.
 *   - Specialized crafting bonus: Zone Quality × Power Level matrix.
 *     Which crafts are "specialized" follows the region's BIOME — the same
 *     list the royal city of that biome gets (see BIOME_TO_CITY).
 *   - Refining: flat 15 PB in the Outlands (10 in the Roads), no zone quality,
 *     no power level, no specialization.
 *   - Rests (Outlands towns) are flat: 15 refining, 18 crafting, 33 specialized.
 *   - No farming or butcher specialization exists outside the royal cities.
 *
 * All bonuses here are whole production-bonus POINTS (18 = "+18%"), matching
 * how the wiki tables read; calculations.js works in fractions, so
 * getBlackZoneRRR() divides by 100 before handing off to calcRRR().
 */

const ZONE_QUALITIES = [1, 2, 3, 4, 5, 6];
const POWER_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Power level 1-9 → general crafting production bonus (no zone-quality part).
const HIDEOUT_GENERAL_PB = [0, 6, 11, 15, 18, 20, 22, 24, 26];

// Zone quality → production bonus per power level 1-9, for crafts the region's
// biome specializes in. Roads of Avalon hideouts use the quality-1 row.
const HIDEOUT_SPEC_PB = {
  1: [1, 10.75, 19.5, 27.25, 34, 39.75, 45.5, 51.25, 57],
  2: [6, 15.75, 24.5, 32.25, 39, 44.75, 50.5, 56.25, 62],
  3: [11, 20.75, 29.5, 37.25, 44, 49.75, 55.5, 61.25, 67],
  4: [16, 25.75, 34.5, 42.25, 49, 54.75, 60.5, 66.25, 72],
  5: [21, 30.75, 39.5, 47.25, 54, 59.75, 65.5, 71.25, 77],
  6: [26, 35.75, 44.5, 52.25, 59, 64.75, 70.5, 76.25, 82],
};

const HIDEOUT_REFINE_PB = 15;
const ROADS_REFINE_PB = 10;

// Arthur's / Merlyn's / Morgana's Rest — flat, no quality or power scaling.
const REST_BONUS = { refine: 15, craftBase: 18, craftSpec: 33 };

// An Outlands region's craft specialization is its biome's — identical to the
// royal city sitting in that biome, so the chip lists come from CITY_CRAFT_SPEC.
const BIOME_TO_CITY = {
  Highland: "Martlock",
  Steppe: "Bridgewatch",
  Forest: "Lymhurst",
  Mountain: "Fort Sterling",
  Swamp: "Thetford",
};

// Rests carry their own weapon-line + armor bonuses (offhands excluded).
const REST_CRAFT_SPEC = {
  "Arthur's Rest": [
    "axe", "crossbow", "hammer", "mace", "sword", "knuckles",
    "plate_helmet", "plate_armor", "plate_shoes",
  ],
  "Merlyn's Rest": [
    "bow", "dagger", "quarterstaff", "spear", "naturestaff", "shapeshifterstaff",
    "leather_helmet", "leather_armor", "leather_shoes",
  ],
  "Morgana's Rest": [
    "arcanestaff", "cursestaff", "firestaff", "froststaff", "holystaff",
    "cloth_helmet", "cloth_armor", "cloth_shoes",
  ],
};

// calculations.js owns the RRR formula and the focus bonus; fall back to its
// values when this file is required on its own (Node tests).
function _bzCalcRRR(bonusFraction) {
  if (typeof calcRRR === "function") return calcRRR(bonusFraction);
  return bonusFraction <= 0 ? 0 : bonusFraction / (1 + bonusFraction);
}
function _bzFocusPB() {
  return (typeof FOCUS_BONUS !== "undefined" ? FOCUS_BONUS : 0.59) * 100;
}

/**
 * Hideout crafting production bonus, in points.
 * @param {number} quality - Zone quality 1-6 (Roads hideouts = 1)
 * @param {number} power - Hideout power level 1-9
 * @param {boolean} spec - true for a craft the region's biome specializes in
 */
function getHideoutCraftPB(quality, power, spec = false) {
  const p = Math.min(Math.max(Math.round(power), 1), 9);
  if (!spec) return HIDEOUT_GENERAL_PB[p - 1];
  const q = Math.min(Math.max(Math.round(quality), 1), 6);
  return HIDEOUT_SPEC_PB[q][p - 1];
}

/**
 * Resource return rate for a black-zone production bonus.
 * @param {number} pb - production bonus in points (e.g. 15, not 0.15)
 * @param {boolean} useFocus - focus adds a flat +59 PB
 */
function getBlackZoneRRR(pb, useFocus = false) {
  const total = pb + (useFocus ? _bzFocusPB() : 0);
  return _bzCalcRRR(total / 100);
}

if (typeof window !== "undefined") {
  window.ZONE_QUALITIES = ZONE_QUALITIES;
  window.POWER_LEVELS = POWER_LEVELS;
  window.HIDEOUT_GENERAL_PB = HIDEOUT_GENERAL_PB;
  window.HIDEOUT_SPEC_PB = HIDEOUT_SPEC_PB;
  window.HIDEOUT_REFINE_PB = HIDEOUT_REFINE_PB;
  window.ROADS_REFINE_PB = ROADS_REFINE_PB;
  window.REST_BONUS = REST_BONUS;
  window.BIOME_TO_CITY = BIOME_TO_CITY;
  window.REST_CRAFT_SPEC = REST_CRAFT_SPEC;
  window.getHideoutCraftPB = getHideoutCraftPB;
  window.getBlackZoneRRR = getBlackZoneRRR;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ZONE_QUALITIES,
    POWER_LEVELS,
    HIDEOUT_GENERAL_PB,
    HIDEOUT_SPEC_PB,
    HIDEOUT_REFINE_PB,
    ROADS_REFINE_PB,
    REST_BONUS,
    BIOME_TO_CITY,
    REST_CRAFT_SPEC,
    getHideoutCraftPB,
    getBlackZoneRRR,
  };
}
