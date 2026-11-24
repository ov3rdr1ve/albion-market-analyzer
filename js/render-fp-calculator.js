/**
 * Faction Point Calculator.
 *
 * Pure FP-budget planner for city faction capes: "I have N Faction Points and
 * want to craft capes — how many hearts and crests does that buy me?"
 *
 * A faction cape consumes FP on two of its three ingredients:
 *   - the crest blueprint (1 per cape; FP scales by tier: 400/2250/3000/7500/15000)
 *   - the heart fragment (N per cape, 3,000 FP each; N = 1/1/3/5/10 for T4..T8)
 * The third ingredient — the base cape (T{tier}_CAPE) — is silver-bought and so
 * is reported as a reminder, not part of the FP arithmetic.
 *
 * Scope: the 5 royal-city families whose crest BP is FP-purchasable (Caerleon's
 * is not, so it's excluded). The inverse question — silver value per FP — lives
 * in the Faction Spending table (js/render-faction-spending.js).
 *
 * No market scan needed: this is pure FP→quantity math, recomputed live as the
 * user edits the budget / city / tier controls.
 */

// City code (recipe id segment) → faction heart short-name, for the dropdown.
const FP_CALC_CITIES = [
  { code: "THETFORD", label: "Thetford" },
  { code: "LYMHURST", label: "Lymhurst" },
  { code: "FORTSTERLING", label: "Fort Sterling" },
  { code: "BRIDGEWATCH", label: "Bridgewatch" },
  { code: "MARTLOCK", label: "Martlock" },
];

/**
 * Pure calculator. deps is injectable for node tests; defaults to globals.
 *   deps.gearCapes : GEAR_CAPES recipe array
 *   deps.getFpCost : (itemId) => FP cost (0 for non-FP items)
 *
 * Per-cape figures (perCapeFp, heartsPerCape, crestFp) are always populated even
 * when budget/maxCapes is 0, so the cost breakdown shows before a budget is set.
 * Returns null when the recipe or its FP-priced mats can't be resolved.
 */
function calcFpCapePlan({ budget, tier, city }, deps) {
  const gearCapes = (deps && deps.gearCapes)
    || (typeof GEAR_CAPES !== "undefined" ? GEAR_CAPES : null);
  const fpCost = (deps && deps.getFpCost)
    || (typeof getFpCost === "function" ? getFpCost : null);
  if (!gearCapes || !fpCost) return null;

  const capeId = `T${tier}_CAPEITEM_FW_${city}`;
  const recipe = gearCapes.find((r) => r.id === capeId);
  if (!recipe || !Array.isArray(recipe.materials)) return null;

  const crestMat = recipe.materials.find((m) => /_BP$/.test(m.matId));
  const heartMat = recipe.materials.find((m) => /^T1_FACTION_.*_TOKEN_1$/.test(m.matId));
  const baseMat = recipe.materials.find((m) => /_CAPE$/.test(m.matId));
  if (!crestMat || !heartMat) return null;

  const crestId = crestMat.matId;
  const heartId = heartMat.matId;
  const crestFp = fpCost(crestId);
  const heartFpEach = fpCost(heartId);
  const heartsPerCape = heartMat.count;
  if (crestFp <= 0 || heartFpEach <= 0) return null; // not FP-fundable (e.g. Caerleon)

  const perCapeFp = crestFp + heartsPerCape * heartFpEach;
  const safeBudget = Math.max(0, Number(budget) || 0);
  const maxCapes = perCapeFp > 0 ? Math.floor(safeBudget / perCapeFp) : 0;

  const crestCount = maxCapes;
  const crestSpent = crestCount * crestFp;
  const heartCount = maxCapes * heartsPerCape;
  const heartSpent = heartCount * heartFpEach;
  const totalSpent = crestSpent + heartSpent;
  const fpLeft = safeBudget - totalSpent;

  return {
    capeId, capeName: recipe.name,
    crestId, heartId, baseCapeId: baseMat ? baseMat.matId : null,
    heartsPerCape, perCapeFp,
    budget: safeBudget, maxCapes,
    crestCount, crestFp, crestSpent,
    heartCount, heartFpEach, heartSpent,
    totalSpent, fpLeft,
  };
}

// ─── DOM render ──────────────────────────────────────────────────────────────
// The cape plan reads GEAR_CAPES and getFpCost, which js/catalog-loader.js
// injects after first paint. Until they are here the calculator says it is
// loading; once the load has settled without them it says THAT, so neither
// state is ever mistaken for "this cape isn't FP-fundable".
let _fpCatalogsSettled = false;
const _fpCatalogsPresent = () =>
  typeof GEAR_CAPES !== "undefined" && Array.isArray(GEAR_CAPES)
  && typeof getFpCost === "function";

function renderFpCalculator() {
  if (typeof document === "undefined") return;
  const out = document.getElementById("fp-calc-result");
  if (!out) return;
  if (!_fpCatalogsPresent()) {
    out.innerHTML = _fpCatalogsSettled
      ? `<span style="color:#c47a7a">Can't compute — the cape catalog failed to load.</span>`
      : `<span style="color:#9ca3af">Loading catalogs…</span>`;
    return;
  }

  const budget = parseInt(document.getElementById("fp-calc-budget")?.value, 10) || 0;
  const city = document.getElementById("fp-calc-city")?.value || "THETFORD";
  const tier = parseInt(document.getElementById("fp-calc-tier")?.value, 10) || 8;

  const plan = calcFpCapePlan({ budget, tier, city });
  if (!plan) {
    out.innerHTML = `<span style="color:#c47a7a">Can't compute — this cape isn't FP-fundable.</span>`;
    return;
  }

  const nm = (id) => (typeof getItemDisplayName === "function" ? getItemDisplayName(id) : id);
  const fmt = (n) => Math.round(n).toLocaleString();
  const heartName = nm(plan.heartId);
  const baseName = plan.baseCapeId ? nm(plan.baseCapeId) : "base cape";

  out.innerHTML = `
    <div class="fp-calc-card">
      <div class="fp-calc-percape">
        <b>${plan.capeName}</b> — per cape:
        1× crest <b>${fmt(plan.crestFp)} FP</b>
        + ${plan.heartsPerCape}× ${heartName} (${fmt(plan.heartFpEach)} FP ea)
        = <b class="profit-high">${fmt(plan.perCapeFp)} FP/cape</b>
      </div>
      <div class="fp-calc-headline">
        ${fmt(plan.budget)} FP → <b class="profit-high">${plan.maxCapes}</b> complete cape${plan.maxCapes === 1 ? "" : "s"}
      </div>
      <table class="fp-calc-breakdown">
        <tr><td>Crests to buy</td><td><b>${fmt(plan.crestCount)}</b></td><td>${fmt(plan.crestSpent)} FP</td></tr>
        <tr><td>${heartName} to buy</td><td><b>${fmt(plan.heartCount)}</b></td><td>${fmt(plan.heartSpent)} FP</td></tr>
        <tr class="fp-calc-total"><td>Total FP spent</td><td></td><td><b>${fmt(plan.totalSpent)} FP</b></td></tr>
        <tr><td>FP left over</td><td></td><td>${fmt(plan.fpLeft)} FP</td></tr>
      </table>
      <div class="fp-calc-note">
        Plus ${fmt(plan.maxCapes)}× ${baseName} (crafted/bought with silver — not FP).
      </div>
    </div>
  `;
}

// Idempotent module-init — wire the three controls to live-recompute (no scan).
(function _initFpCalculator() {
  if (typeof document === "undefined") return;
  if (document._fpCalcInit) return;
  document._fpCalcInit = true;
  const attach = () => {
    const ids = ["fp-calc-budget", "fp-calc-city", "fp-calc-tier"];
    let found = false;
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) { found = true; el.addEventListener("input", renderFpCalculator); el.addEventListener("change", renderFpCalculator); }
    });
    if (found) {
      // First paint is the loading state; the real one follows the catalogs.
      renderFpCalculator();
      // The shared wait (js/catalog-ready.js): this file runs before the
      // loader, so it polls for catalogsReady rather than reading it once.
      const settle = () => {
        _fpCatalogsSettled = true;
        renderFpCalculator();
      };
      if (typeof whenCatalogsReady === "function") whenCatalogsReady(settle, { present: _fpCatalogsPresent });
      else settle();
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  } else {
    attach();
  }
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { calcFpCapePlan, FP_CALC_CITIES };
}
