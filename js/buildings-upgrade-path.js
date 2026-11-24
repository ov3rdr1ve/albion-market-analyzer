/**
 * The ladder a building is actually reached by.
 *
 * You cannot place a T8 Guild Hall. You place the family's lowest tier and pay an
 * upgrade step for every tier after it, so the cost of "a T8 Guild Hall" is the
 * sum of all seven steps — 19,050 Rough Logs, not the 9,600 the last step asks
 * for, plus 900 stone blocks of EVERY tier along the way. The wiki publishes that
 * running sum as its "Total T1 mat. required" column
 * (wiki.albiononline.com/wiki/Guild_Hall); this module derives it instead, from
 * the `upgradeableto` attribute buildings.xml already carries.
 *
 * Nothing here is hand-authored. The chain root is simply a building nothing
 * upgrades into, which makes the odd cases fall out for free: Butcher and Saddler
 * ladders start at T3 (the dump has no T2), the farming plots and the Hideout are
 * one-offs, and T1_FORGE is a dead-end the T2→T8 station ladder never passes
 * through.
 *
 * Pure — no DOM, no market access. Reads BUILDINGS from js/data-buildings.js.
 */

// buildingId → the building that upgrades INTO it. Built lazily once, because
// BUILDINGS is a const in another script and never changes at runtime.
let _bldPredecessors = null;

function _predecessors() {
  if (_bldPredecessors) return _bldPredecessors;
  _bldPredecessors = new Map();
  BUILDINGS.forEach((b) => {
    if (b.upgradeableTo) _bldPredecessors.set(b.upgradeableTo, b);
  });
  return _bldPredecessors;
}

/**
 * Every step from the chain root up to `buildingId`, in build order.
 * A building with no lower tier returns just itself; an unknown id returns [].
 */
function getBuildingUpgradePath(buildingId) {
  const target = BUILDINGS.find((b) => b.id === buildingId);
  if (!target) return [];
  const preds = _predecessors();
  const path = [target];
  // Walk down. `seen` guards against a malformed dump pointing a chain at itself
  // — a cycle would otherwise hang the render rather than fail a test.
  const seen = new Set([target.id]);
  let cur = preds.get(target.id);
  while (cur && !seen.has(cur.id)) {
    path.unshift(cur);
    seen.add(cur.id);
    cur = preds.get(cur.id);
  }
  return path;
}

/**
 * The whole path's bill of materials, summed per item id and ordered by the step
 * that first needs it — so the rough logs and stone every tier eats lead, and the
 * per-tier stone blocks follow in tier order.
 */
function rollupUpgradeMaterials(path) {
  const totals = new Map();
  (path || []).forEach((step) => {
    step.materials.forEach((m) => {
      totals.set(m.matId, (totals.get(m.matId) || 0) + m.count);
    });
  });
  return [...totals.entries()].map(([matId, count]) => ({ matId, count }));
}

/** Σ of every step's silver fee, raw — the caller applies the Global Discount. */
function sumUpgradeSilver(path) {
  return (path || []).reduce((s, step) => s + step.silverCost, 0);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getBuildingUpgradePath, rollupUpgradeMaterials, sumUpgradeSilver,
  };
}
