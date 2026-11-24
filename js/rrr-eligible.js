/**
 * Which recipe materials the Resource Return Rate actually gives back.
 *
 * RRR refunds REFINED station resources only — cloth, leather, metal bars,
 * planks, stone blocks. Grown mounts, intermediate mount parts, tomes, GvG
 * tokens, artifacts, quest items and raw resources are consumed 1:1, so costing
 * them net of the return rate understates the craft.
 *
 * Enchanted bars count. A .1–.4 craft consumes `T5_CLOTH_LEVEL1@1` (the AODP
 * id format — see the refined-enchant note), refined at the same station and
 * refunded exactly like `T5_CLOTH`. The pattern used to stop at the optional
 * `_LEVELn`, so every enchanted row read as non-returnable: the Crafting Planner
 * and the Crafting table cost those mats net (their own classifiers know the
 * enchanted ids), while My Crafting List shopped the GROSS count — the two
 * figures ~2x apart on the same row, which is the drift the list is meant to
 * prevent.
 *
 * Lives on its own because three unrelated surfaces ask the question (mounts,
 * faction spending, the crafting list) and it is the kind of rule that must have
 * exactly one spelling.
 */
const REFINED_MAT_RE = /^T[1-8]_(LEATHER|CLOTH|METALBAR|PLANKS|STONEBLOCK)(_LEVEL\d)?(@\d)?$/;

function isRrrEligible(matId) {
  return REFINED_MAT_RE.test(String(matId == null ? "" : matId));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { REFINED_MAT_RE, isRrrEligible };
}
