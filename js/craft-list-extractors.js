/**
 * My Crafting List — per-table row normalization.
 *
 * Each profit table builds its own row shape, so the list panel needs one
 * translator per table to answer three questions about any picked row:
 *
 *   what does one unit cost · what does one unit earn · what must I go buy
 *
 * The registry mirrors EXTRACTORS in js/render-joined-summary.js (same tables,
 * same field names) — when a row builder changes shape, both files are the
 * places to look.
 *
 * The "unit" is whatever the source table's own profit column is denominated
 * in (one craft, one refine, one flip, one journal, one building). Tables whose
 * inputs are not bought on the market (Gathering, Faction Spending) report no
 * materials — they still contribute their profit to the list totals.
 *
 * Every focus-aware row is normalized TWICE — once focused, once at the base
 * return rate — because the focus budget is finite and only part of a basket
 * can be run focused (js/craft-list-focus-budget.js).
 *
 * Everything here is pure: no DOM, no market lookups, no globals beyond the
 * optional name helper. Aggregation and totals live in
 * js/craft-list-materials.js; rendering in js/render-craft-list.js.
 */

// rrrWithoutFocus lives in js/craft-list-focus-budget.js — a plain global in
// the browser (script order does not matter: _clBaseRrr looks it up at call
// time), and pulled in here under Node so the tests exercise the same inversion
// the app does instead of silently falling back to the focused rate.
if (typeof rrrWithoutFocus === "undefined"
    && typeof require === "function" && typeof globalThis !== "undefined") {
  try {
    globalThis.rrrWithoutFocus = require("./craft-list-focus-budget.js").rrrWithoutFocus;
  } catch (e) { /* loaded bare in a browser without the sibling — see above */ }
}

/** Item name for the list, falling back through the app's name helpers. */
function _clName(id, fallback) {
  if (fallback) return fallback;
  if (typeof getItemDisplayName === "function") {
    try { return getItemDisplayName(id) || id; } catch (e) { /* node/test */ }
  }
  return id || "";
}

function _clMat(matId, count, city, perUnit, note) {
  return {
    matId: String(matId || ""),
    count: Number(count) || 0,
    city: city || "",
    perUnit: Number(perUnit) || 0,
    // "refine" marks a line the plan MAKES rather than buys (the Crafting
    // Planner's self-refined materials) — the shopping list must not read as
    // "go buy T4 cloth" when the row's whole point is refining it.
    note: note || "",
  };
}

/**
 * What one craft actually consumes: the recipe count net of the resource return
 * rate, exactly as the tables cost it (`m.count * (1 - rrr)` in
 * render-crafting.js) — artifacts and other non-returning inputs are exempt.
 * Keeping the shopping list gross while the Input Cost column is net would put
 * the two figures ~2× apart on the same row.
 */
function _clEffCount(matId, count, rrr) {
  const n = Number(count) || 0;
  const rate = Number(rrr) || 0;
  if (!rate) return n;
  const eligible = (typeof isRrrEligible === "function") ? isRrrEligible(matId) : true;
  return eligible ? n * (1 - rate) : n;
}

/**
 * Material lines from a `materials`/`recipe` array + a matBestPrices map.
 *
 * The shopping line is keyed on the id that was actually BOUGHT, not the id the
 * recipe names: a Crafting row may fill an artifact slot with a cheaper
 * Crystallized token and record it as `matBestPrices[recipeId].id`
 * (js/render-crafting.js), and the Crafting table's own cell already renders
 * that id. Keying the line on the recipe id instead showed the substitute's
 * price and city under the artifact's name — and a price edit there wrote an
 * override the recompute never read back.
 *
 * The COUNT still keys on the recipe slot (`m.matId`): return-rate eligibility
 * follows the slot, which is how the table costs it (isNonReturnableCraftMat in
 * js/render-crafting.js). Keying it on the substitute would let the shopping
 * list and the Input Cost column drift apart.
 */
function _clRecipeMats(lines, priceMap, fallbackCity, rrr) {
  if (!Array.isArray(lines)) return [];
  const prices = priceMap || {};
  return lines.map((m) => {
    const best = prices[m.matId] || {};
    return _clMat(
      best.id || m.matId,
      _clEffCount(m.matId, m.count, rrr),
      best.city || fallbackCity || "",
      best.price,
    );
  });
}

/**
 * What ONE breeding cycle buys, as shopping lines.
 *
 * A breeding row has no `materials` array and no `matBestPrices` — its inputs
 * live in three separate fields (js/render-mounts.js breedingRowFor), which is
 * why _clRecipeMats returned nothing for it and a list of 144 moose showed
 * "No purchasable materials on the list yet" over a 43M cost line:
 *
 *   the BABY      one, at the row's buy city
 *   the FEED      `feed.pieces` of the cheapest food per nutrition point
 *   the SADDLER   the tame→saddled craft's leather and hearts, net of the
 *                 saddler return rate — the GROWN mount is skipped because the
 *                 breeder produces it in-house rather than buying it
 *
 * Mirrors the row's own Materials cell (js/render-mounts-breeding-row.js) line
 * for line, and sums to the row's `totalInputCost` before the setup fee.
 */
function _clBreedingMats(row, saddlerRrr) {
  const out = [];
  const babyId = row.item && row.item.babyId;
  if (babyId) {
    out.push(_clMat(babyId, 1, row.buyMat && row.buyMat.city, row.buyMat && row.buyMat.price));
  }
  const feed = row.feed;
  const pieces = Number(feed && feed.pieces) || 0;
  if (feed && feed.id && pieces > 0) {
    out.push(_clMat(feed.id, pieces, feed.city || (row.buyMat && row.buyMat.city), feed.price));
  }
  if (row.recipe && row.saddlerMatPrices) {
    (row.recipe.materials || []).forEach((m) => {
      if (m.matId === (row.item && row.item.grownId)) return;
      const priced = row.saddlerMatPrices[m.matId] || {};
      // `isProduced` marks an input the plan makes rather than buys.
      if (priced.isProduced) return;
      out.push(_clMat(
        m.matId,
        _clEffCount(m.matId, m.count, saddlerRrr),
        priced.city || row.saddlerCity,
        priced.price,
      ));
    });
  }
  return out;
}

/** A finite number, or the fallback. */
function _clNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The planner's `sourcing[]` as shopping lines.
 *
 * `s.matId` is the id actually BOUGHT, `s.origMatId` the recipe slot it fills —
 * the planner decides return eligibility from the SLOT (_cpNonReturnable in
 * js/craft-planner-pricing.js), so the count has to key on it too, exactly as
 * _clRecipeMats does. A market leg is costed at perUnit + the haul fee (same
 * file), so the line carries the fee or the board reads under the row's own
 * Input Cost; a self-refined ("chain") leg pays no haul fee.
 *
 * Called twice per row: once for the focused sourcing and once for the row's
 * focus-off baseline, which is a genuinely different plan, not the same lines
 * at a different return rate.
 */
function _clPlannerMats(sourcing, craftCity, rrr) {
  return (sourcing || []).map((s) =>
    _clMat(
      s.matId, _clEffCount(s.origMatId || s.matId, s.count, rrr),
      s.sourcing?.city || craftCity, _clSourcedUnit(s.sourcing),
      s.sourcing?.source === "chain" ? "refine" : "",
    ));
}

/**
 * What one unit of a planner-sourced material really costs to have in hand.
 *
 * A market leg pays the price plus the per-unit haul fee the row already
 * charges for it (`perUnit + travelFeePerUnit` in _cpPriceMaterials,
 * js/craft-planner-pricing.js). A leg the plan refines itself never went
 * through a market, so it carries no haul.
 */
function _clSourcedUnit(sourcing) {
  const s = sourcing || {};
  const unit = Number(s.perUnit) || 0;
  if (unit <= 0) return 0;
  return s.source === "market" ? unit + (Number(s.travelFeePerUnit) || 0) : unit;
}

/**
 * How many crafts of a row fill ONE of its laborer journals, from the row's own
 * winning journal pick. A laborer works one journal per 22h cycle, so this is
 * what turns a quantity into a headcount.
 *
 * getCraftsToFillJournal lives in js/data-craft-planner.js — loaded in the
 * browser, absent when this module is required bare — so the same division is
 * the fallback rather than a guard that silently drops the fill rate.
 */
function _clLaborerFill(j) {
  const b = j && j.bestJournal;
  if (!b || !(j.famePerCraft > 0) || !(b.maxfame > 0)) return null;
  const crafts = (typeof getCraftsToFillJournal === "function")
    ? getCraftsToFillJournal(j.famePerCraft, b.maxfame)
    : b.maxfame / j.famePerCraft;
  return crafts > 0 ? { slug: j.slug || "", tier: b.tier, craftsPerJournal: crafts } : null;
}

/**
 * The BASE (focus-off) return rate behind a row's headline rate.
 *
 * A renderer that publishes `baseRrr` is always believed: it knows about city
 * specs, no-return crafts and butcher rates. Without one, the rate is inverted
 * out of the headline (rrrWithoutFocus, js/craft-list-focus-budget.js) — but
 * ONLY when the row proves focus is actually on its headline by reporting a
 * focus gain. A row priced focus-off already IS its own base rate, and
 * subtracting the focus bonus from it a second time would invent a saving that
 * was never there.
 */
function _clBaseRrr(row) {
  const on = Number(row && row.rrr) || 0;
  const published = Number(row && row.baseRrr);
  if (Number.isFinite(published)) return published;
  const gain = Number(row && row.focusProfitDelta) || 0;
  if (!(gain > 0) || !(on > 0)) return on;
  return (typeof rrrWithoutFocus === "function") ? rrrWithoutFocus(on) : on;
}

/**
 * A row's focus gain, but only when the row's HEADLINE is actually focused.
 *
 * With "Use Focus" off a table still reports what focus WOULD buy (that is the
 * whole point of the invariant Silver/Focus columns), while its profit is
 * already the focus-off figure. Subtracting the gain there would take the
 * saving off a row that never had it. A published base rate equal to the
 * headline rate is exactly that case.
 */
function _clFocusGain(row, delta) {
  const d = Number(delta) || 0;
  if (!(d > 0)) return 0;
  const on = Number(row && row.rrr);
  const base = Number(row && row.baseRrr);
  if (Number.isFinite(on) && Number.isFinite(base) && !(on > base)) return 0;
  return d;
}

/**
 * What one execution of this row earns with NO focus on it.
 *
 * `focusProfitDelta` is the row's own focus play measured per row execution
 * (js/focus-play.js) — the silver focus buys, which for every table on the list
 * is the extra material the higher return rate hands back. Subtracting it is
 * the same difference-of-two-RRRs the Crafting table already computes for its
 * Silver/Focus column (js/render-crafting.js), so the two can never disagree.
 *
 * A row that publishes a focus-off profit outright (the Crafting Planner prices
 * its focus-off baseline on every pass anyway) hands it over directly — a
 * refine play changes WHERE a material comes from, not just how much of it
 * comes back, and no arithmetic on the return rate could reproduce that.
 */
function _clNoFocusProfit(profit, delta) {
  const p = Number(profit) || 0;
  const d = Number(delta) || 0;
  return d > 0 ? p - d : p;
}

/**
 * `laborerProfit` is the SAME row costed under the other journal play: the
 * journal goes to your own laborer instead of being sold (see
 * js/craft-planner-pricing.js — the two plays are exclusive and never summed).
 *
 * A table that has no such play says nothing, and the field falls back to
 * `unitProfit`: the footer's laborer total prices the WHOLE basket, so a
 * transport or flipping row has to contribute its ordinary profit to both
 * figures or the second one reads as a smaller list rather than another play.
 * `hasLaborerPlay` is what tells the two apart for the footer.
 */
function _clRow(fields) {
  const unitProfit = Number(fields.unitProfit) || 0;
  // The source table's self-gathered twin (plan.md), passed through whole.
  // ABSENT when the table computes none — the list never invents one, so the
  // buy-only tables (flipping, skins, …) stay without the dimmed line.
  const unitProfitSelfFound = fields.unitProfitSelfFound != null
    && Number.isFinite(Number(fields.unitProfitSelfFound))
    ? Number(fields.unitProfitSelfFound)
    : undefined;
  const laborer = Number(fields.laborerProfit);
  const hasLaborerPlay = fields.laborerProfit != null && Number.isFinite(laborer);
  const laborerProfit = hasLaborerPlay ? laborer : unitProfit;
  // The focus budget is finite, so a row is priced TWICE: once for the units it
  // can afford to focus and once for the tail past the budget, which runs at
  // the base return rate (js/craft-list-focus-budget.js). A row focus does
  // nothing for reports the same figure twice and the split never moves it.
  const focusProfitDelta = Number(fields.focusProfitDelta) || 0;
  const unitProfitNoFocus = fields.unitProfitNoFocus != null
    && Number.isFinite(Number(fields.unitProfitNoFocus))
    ? Number(fields.unitProfitNoFocus)
    : _clNoFocusProfit(unitProfit, focusProfitDelta);
  const laborerProfitNoFocus = fields.laborerProfitNoFocus != null
    && Number.isFinite(Number(fields.laborerProfitNoFocus))
    ? Number(fields.laborerProfitNoFocus)
    : _clNoFocusProfit(laborerProfit, focusProfitDelta);
  const materials = fields.materials || [];
  return {
    tableId: fields.tableId,
    itemId: fields.itemId || "",
    itemName: fields.itemName || "",
    buyCity: fields.buyCity || "",
    sellCity: fields.sellCity || "",
    sellPrice: Number(fields.sellPrice) || 0,
    inputCost: Number(fields.inputCost) || 0,
    // Faction Points one unit spends (Faction Spending rows only). FP is paid
    // at the NPC, not in silver, so it never enters inputCost — the list shows
    // it beside Total Buy Cost and sums it in the footer instead.
    fpCost: Math.max(0, Number(fields.fpCost) || 0),
    // Same for Energy Manipulator rows, paid in Favor.
    favorCost: Math.max(0, Number(fields.favorCost) || 0),
    unitProfit,
    unitProfitSelfFound,
    twinSavings: fields.twinSavings || null, // breeding: js/craft-list-per10k.js
    unitProfitNoFocus,
    laborerProfit,
    laborerProfitNoFocus,
    hasLaborerPlay,
    laborerFill: fields.laborerFill || null,
    focusCost: Number(fields.focusCost) || 0,
    // How many DAYS the focus above is drawn over. 1 for a craft, a refine, a
    // watering — the charge lands in one sitting. A nurture ladder does not:
    // nurturing has a 24h cooldown and is capped at the number of days the
    // baby takes to grow, so its focus is a daily instalment (see the
    // mounts-table extractor). The budget box is a DAILY pool, so `focusCost`
    // is always what ONE DAY of this row costs and this says over how many
    // days that instalment repeats.
    focusDays: Math.max(1, Math.floor(Number(fields.focusDays) || 1)),
    focusProfitDelta,
    materials,
    // An unfunded unit gets less material back, so it BUYS more. Rows that
    // cannot say what that costs fall back to their focused lines rather than
    // guessing — the shopping board must never invent a purchase.
    materialsNoFocus: fields.materialsNoFocus || materials,
    // The extra input silver an unfunded unit pays. Derived from the two
    // material lists rather than stored, so the two can never disagree.
    inputCostNoFocus: Number.isFinite(Number(fields.inputCostNoFocus))
      ? Number(fields.inputCostNoFocus)
      : (Number(fields.inputCost) || 0) + Math.max(0, unitProfit - unitProfitNoFocus),
  };
}

/**
 * The FITTING of one building: the laborer contracts it hires and the furniture
 * that keeps them happy, as shopping lines.
 *
 * A building row's Total Cost is `shell + laborers + furniture`
 * (js/render-buildings.js), but only the shell ever reached the list, so adding
 * a house put its stone and planks on the shopping board and silently omitted
 * the beds, tables, trophies and contracts the same row was charging for.
 *
 * Contracts and furniture are ordinary marketplace buys — no `note` marker; the
 * list should read "go buy these" for all of them.
 *
 * A furnishing that does not physically fit (`bedsAndTablesFit: false`) is not a
 * purchase plan at all: it contributes 0 to the row's cost, so it contributes no
 * lines either. The contract still does — the laborers are hired regardless.
 */
function _clBuildingFitting(row) {
  const out = [];
  const push = (id, count, city, price) => {
    if (!id || !(Number(count) > 0)) return;
    out.push(_clMat(id, count, city, price));
  };

  const crew = row && row.laborers;
  if (crew) push(crew.id, crew.count, crew.city, crew.price);

  const plan = row && row.plan;
  if (!plan || plan.bedsAndTablesFit === false) return out;

  push(plan.beds && plan.beds.id, plan.beds && plan.beds.count,
       plan.beds && plan.beds.city, plan.beds && plan.beds.price);
  push(plan.tables && plan.tables.id, plan.tables && plan.tables.count,
       plan.tables && plan.tables.city, plan.tables && plan.tables.price);
  // One line per trophy TIER, counted in whole blocks — a trophy is bought in
  // `copies` so every laborer falls inside its effect (js/buildings-furnishing.js).
  (plan.trophies || []).forEach((t) => push(t.id, t.copies, t.city, t.price));

  return out;
}

// ─── Per-table extractors ───────────────────────────────────────────────────

const CRAFT_LIST_EXTRACTORS = {
  // Refine-the-ladder planner: sourcing[] already carries the per-unit price and
  // the city each material is bought in (or refined at).
  // `s.matId` is the id actually BOUGHT, `s.origMatId` the recipe slot it fills
  // — the planner decides return eligibility from the SLOT (_cpNonReturnable in
  // js/craft-planner-pricing.js), so the count has to key on it too, exactly as
  // _clRecipeMats does. And a market leg is costed at perUnit + the haul fee
  // (same file), so the line carries the fee or the board reads under the row's
  // own Input Cost. A self-refined ("chain") leg pays no haul fee.
  "craft-planner-table": (r) => _clRow({
    tableId: "craft-planner-table",
    itemId: r.item?.id,
    itemName: _clName(r.item?.id, r.item?.name),
    buyCity: r.craftCity,
    sellCity: r.sellCity,
    sellPrice: r.sellPrice,
    inputCost: r.refineCraftCost,
    unitProfit: r.combinedProfit,
    // The twin rides on the ROW itself (the planner row has no marginInfo —
    // js/craft-planner-pricing.js step 4.95).
    unitProfitSelfFound: r.selfFoundProfit,
    laborerProfit: r.laborerCombinedProfit ?? null,
    laborerFill: _clLaborerFill(r.laborerJournal),
    // The planner's per-row focus is `focusPerCraft`, not `focusCost`: a refine
    // play's own focusCost is ONE refine, and _cpFocusPerCraft
    // (js/craft-planner-pricing.js) has already scaled it to the refines one
    // craft needs. It is the same divisor the row's Profit / 10k Focus uses.
    focusCost: r.focusPerCraft,
    // The planner prices its focus-OFF baseline on every pass anyway (step 1 of
    // computeCraftPlannerRow) — it is the row it would show with the checkbox
    // off. Taking it whole is exact where arithmetic could not be: a refine
    // play moves a material from "buy the bar" to "refine it yourself", which
    // no difference of two return rates can reproduce.
    unitProfitNoFocus: r.noFocusCombinedProfit,
    laborerProfitNoFocus: r.noFocusLaborerCombinedProfit,
    materials: _clPlannerMats(r.sourcing, r.craftCity, r.rrr),
    materialsNoFocus: r.noFocusSourcing
      ? _clPlannerMats(r.noFocusSourcing, r.craftCity, _clNum(r.noFocusRrr, r.rrr))
      : null,
  }),

  "crafting-table": (r) => _clRow({
    tableId: "crafting-table",
    itemId: r.item?.id,
    itemName: _clName(r.item?.id, r.item?.name),
    buyCity: r.craftCity,
    sellCity: r.sellGear?.city,
    sellPrice: r.sellGear?.price,
    inputCost: r.totalInputCost,
    unitProfit: r.marginInfo?.profit,
    // The table's self-gathered twin (plan.md) — read guarded, so a table that
    // does not compute one (yet) passes absence straight through.
    unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
    laborerProfit: r.profitWithLaborer ?? null,
    laborerFill: _clLaborerFill(r.laborerJournal),
    focusCost: r.focusCost,
    focusProfitDelta: r.focusProfitDelta,
    materials: _clRecipeMats(r.materials, r.matBestPrices, r.craftCity, r.rrr),
    materialsNoFocus: _clRecipeMats(
      r.materials, r.matBestPrices, r.craftCity, _clBaseRrr(r)),
  }),

  // Consumables price their recipe through the chain helper: a self-made
  // ingredient has no market city, so those lines fall back to the craft city.
  "consumable-table": (r) => _clRow({
    tableId: "consumable-table",
    itemId: r.item?.id,
    itemName: _clName(r.item?.id, r.item?.name),
    buyCity: r.craftCity || r.buyMat?.city,
    sellCity: r.sellPot?.city,
    sellPrice: r.sellPot?.price,
    inputCost: r.totalInputCost,
    unitProfit: r.marginInfo?.profit,
    // The table's self-gathered twin (plan.md) — read guarded, so a table that
    // does not compute one (yet) passes absence straight through.
    unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
    // A chain-craft row (butcher / mill / pasture) charges focus for a whole
    // BATCH while its profit is quoted per output, so it publishes the play per
    // output too — billing the batch charge once per output is the same trap
    // the farming rows hit with a 22h watering cycle.
    focusCost: _clNum(r.focusPerOutput, r.focusCost),
    focusProfitDelta: _clFocusGain(
      r, _clNum(r.focusProfitPerOutput, r.bestFocusPlay && r.bestFocusPlay.profitDelta)),
    materials: _clRecipeMats(r.recipe, r.matBestPrices, r.craftCity, r.rrr),
    materialsNoFocus: _clRecipeMats(
      r.recipe, r.matBestPrices, r.craftCity, _clBaseRrr(r)),
  }),

  // A breeding row is identified by its BABY, matching getRowKey
  // (js/sorting.js: `babyId|section` for isBreeding). Reading item.id there
  // would hand the list a matcher no breeding row can ever satisfy.
  "mounts-table": (r) => {
    // A breeding row has TWO competing places to put a focus charge — nurture
    // the offspring or focus the saddler craft — and `focusCost` on the row is
    // always the NURTURE one. The budget has to bill the play that actually
    // won, or its cost and its gain are quoted in different plays.
    // On a breeding row the list funds the NURTURE play: it is the focus the
    // Profit / 10k Focus column prices, so the gain that column shows is the
    // gain Total Profit adds once Use Focus is on (a reported case, 2026-10-07). It is
    // also by far the better use of a daily budget — a T8 saddle craft bills
    // ~10,000 focus for one unit, where six days of nurture bill 750.
    const nurtureDelta = Number(r.nurtureProfitDelta);
    const useNurture = !!r.isBreeding && Number(r.focusCost) > 0
      && Number.isFinite(nurtureDelta) && nurtureDelta > 0;
    const focusOn = typeof isFocusEnabled !== "function" || isFocusEnabled();
    const play = useNurture
      ? { kind: "nurture", focusCost: Number(r.focusCost), profitDelta: nurtureDelta }
      : r.bestFocusPlay;
    const playFocus = _clNum(play && play.focusCost, r.focusCost);
    const fullDelta = useNurture
      ? (focusOn ? nurtureDelta : 0)
      : (Number(r.focusProfitDelta) || 0);
    // A nurture is charged ONCE PER 24h: the ladder is hard-capped at the
    // number of DAYS the baby takes to grow with Premium, so a T6 Moose's
    // "4x @ 125 = 500" is 125 a day for four days, never 500 out of one bar.
    // The budget box is a daily pool (~10,000 regen), so the row is billed —
    // and credited — per day, or 144 moose read 72,000 focus against a bar
    // that only ever had to cover 18,000 of it. A saddler play is one craft,
    // so it keeps its whole charge.
    const nurtureDays = (play && play.kind === "nurture")
      ? Math.max(1, Math.floor(Number(r.meta && r.meta.maxNurtures) || 1))
      : 1;
    const headline = Number(r.marginInfo?.profit) || 0;
    // The headline can hold TWO focus effects (saddler leather RRR + nurture
    // offspring), but a row runs ONE play. With the fully unfocused twin
    // (js/render-mounts.js) an unfunded unit earns exactly that and a funded
    // one that + the winning play — never the saddler gain it did not pay for.
    // An unscored row publishes null (Number(null) is 0): never split it.
    const noFocusTwin = r.profitNoFocus == null ? NaN : Number(r.profitNoFocus);
    const split = r.isBreeding && fullDelta > 0 && Number.isFinite(noFocusTwin);
    // Only the CHARGE is per day. An unfunded baby forfeits the whole nurture
    // ladder, not one day of it, so the focus-off profit drops the full
    // delta — otherwise the tail past the budget would be priced at
    // three quarters of a nurtured animal, which is not a thing you can buy.
    const noFocusProfit = split ? noFocusTwin
      : (fullDelta > 0 ? headline - fullDelta : headline);
    const unitProfit = split ? noFocusTwin + fullDelta : headline;
    // Only a SADDLER play changes what the row buys (a higher return rate). A
    // NURTURE costs offspring, not leather, so with the twin neither side of a
    // nurture row focuses the saddler; without it the funded side keeps the
    // focused counts (the shape before the split existed).
    const saddlerRrr = Number(r.saddlerRrr) || 0;
    const saddlerWins = !!(play && play.kind === "saddler");
    const saddlerRrrOff = (saddlerWins || split)
      ? _clNum(r.saddlerRrrNoFocus, saddlerRrr)
      : saddlerRrr;
    const saddlerRrrFunded = (split && !saddlerWins) ? saddlerRrrOff : saddlerRrr;
    const costNoFocus = Number(r.totalInputCostNoFocus);
    const costSplit = split && Number.isFinite(costNoFocus);
    const mats = r.isBreeding
      ? _clBreedingMats(r, saddlerRrrFunded)
      : _clRecipeMats(r.materials || r.item?.materials, r.matBestPrices, r.craftCity, r.rrr);
    const matsNoFocus = r.isBreeding
      ? _clBreedingMats(r, saddlerRrrOff)
      : _clRecipeMats(r.materials || r.item?.materials, r.matBestPrices, r.craftCity, _clBaseRrr(r));
    return _clRow({
      tableId: "mounts-table",
      itemId: (r.isBreeding ? r.item?.babyId : r.item?.id) || r.item?.id,
      itemName: _clName(r.item?.id, r.item?.name),
      buyCity: r.craftCity || r.buyMat?.city,
      sellCity: r.sellPot?.city,
      sellPrice: r.sellPot?.price,
      inputCost: (costSplit && !saddlerWins) ? costNoFocus : r.totalInputCost,
      // From the base-RRR pass; the profit gap would bill nurture as leather.
      ...(costSplit ? { inputCostNoFocus: costNoFocus } : {}),
      unitProfit,
      // Craft rows only (js/render-mounts-craft-row.js): a breeding row's twin
      // is the ea54329 per-10k line, never this column — its marginInfo must
      // not grow selfFoundProfit, so this reads undefined there.
      unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
      focusCost: playFocus / nurtureDays,
      focusProfitDelta: fullDelta / nurtureDays,
      focusDays: nurtureDays,
      unitProfitNoFocus: noFocusProfit,
      laborerProfitNoFocus: noFocusProfit,
      twinSavings: typeof clTwinSavings === "function" ? clTwinSavings(r, mats, matsNoFocus) : null,
      materials: mats,
      materialsNoFocus: matsNoFocus,
    });
  },

  // The transport-table extractor lives in js/craft-list-extractors-transport.js
  // (split off for the 800-line limit) and registers itself into this registry.

  "transmute-table": (r) => _clRow({
    tableId: "transmute-table",
    itemId: r.targetId,
    itemName: _clName(r.targetId),
    buyCity: r.buyCity,
    sellCity: r.sellCity,
    sellPrice: r.sellPrice,
    inputCost: r.totalInputCost,
    unitProfit: r.marginInfo?.profit,
    // The table's self-gathered twin (plan.md) — read guarded, so a table that
    // does not compute one (yet) passes absence straight through.
    unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
    materials: r.sourceId
      ? [_clMat(r.sourceId, r.sourceCount || 1, r.buyCity, r.buyPrice)]
      : [],
  }),

  // The base item plus the runes/souls/relics the enchant step consumes.
  "enchanting-table": (r) => {
    const mats = [];
    if (r.sourceId) mats.push(_clMat(r.sourceId, 1, r.sourceCity, r.sourcePrice));
    if (r.enchantMatId) mats.push(_clMat(r.enchantMatId, r.matCount || 0, r.matCity, r.matPrice));
    return _clRow({
      tableId: "enchanting-table",
      itemId: r.targetId,
      itemName: _clName(r.targetId, r.item?.name),
      buyCity: r.sourceCity,
      sellCity: r.sellCity,
      sellPrice: r.sellPrice,
      inputCost: r.totalInputCost,
      unitProfit: r.marginInfo?.profit,
      // The table's self-gathered twin (plan.md) — read guarded, so a table
      // that does not compute one (yet) passes absence straight through.
      unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
      materials: mats,
    });
  },

  // The reroll fee is silver, not an item: the only thing to buy is the item.
  "rerolling-table": (r) => _clRow({
    tableId: "rerolling-table",
    itemId: r.item?.id,
    itemName: _clName(r.item?.id, r.item?.name),
    buyCity: r.buyCity,
    sellCity: r.sellCity,
    sellPrice: r.sellPrice,
    inputCost: r.totalInputCost,
    unitProfit: r.marginInfo?.profit,
    // The table's self-gathered twin (plan.md) — read guarded, so a table that
    // does not compute one (yet) passes absence straight through.
    unitProfitSelfFound: r.marginInfo?.selfFoundProfit ?? r.selfFoundProfit,
    materials: r.item?.id
      ? [_clMat(r.item.id, 1, r.buyCity, r.buyPrice)]
      : [],
  }),

  "flipping-table": (r) => _clRow({
    tableId: "flipping-table",
    itemId: r.item?.id,
    itemName: _clName(r.item?.id, r.item?.name),
    buyCity: r.buy?.city,
    sellCity: r.sell?.city,
    sellPrice: r.sell?.price,
    inputCost: r.buy?.price,
    unitProfit: r.marginInfo?.profit,
    materials: r.item?.id ? [_clMat(r.item.id, 1, r.buy?.city, r.buy?.price)] : [],
  }),

  "skins-trading-table": (r) => _clRow({
    tableId: "skins-trading-table",
    itemId: r.item?.id,
    itemName: _clName(r.item?.id, r.item?.name),
    buyCity: r.buy?.city,
    sellCity: r.sell?.city,
    sellPrice: r.sell?.price,
    inputCost: r.buy?.price,
    unitProfit: r.marginInfo?.profit,
    materials: r.item?.id ? [_clMat(r.item.id, 1, r.buy?.city, r.buy?.price)] : [],
  }),

  // One meld: rollCost fragments in, one artifact out — shopped as the node bought (180× Soul, not 36× Relic).
  "rolling-table": (r) => _clRow({
    tableId: "rolling-table",
    itemId: r.artId,
    itemName: _clName(r.artId, r.artName),
    buyCity: r.fragBuyCity,
    sellCity: r.bestSellCity || r.sellCity,
    sellPrice: r.bestSellPrice ?? r.sellPrice,
    inputCost: r.rollCostSilver,
    unitProfit: (Number(r.sellRevenue) || 0) - (Number(r.rollCostSilver) || 0),
    materials: r.fragmentId
      ? [_clMat(r.fragBuyId || r.fragmentId, (r.rollCost || 0) * (r.fragSourcing?.buyCount || 1), r.fragBuyCity, r.fragBuyPrice)]
      : [],
  }),

  // A cost board: the whole bill of materials for one building, no sale.
  // Construction mats FIRST, then the fitting — the row's Total Cost charges for
  // both (js/render-buildings.js), so the shopping list has to list both.
  "buildings-table": (r) => _clRow({
    tableId: "buildings-table",
    itemId: r.building?.id,
    itemName: r.building?.name || r.building?.id,
    inputCost: r.totalCost,
    unitProfit: 0,
    materials: (r.materials || []).map((m) => _clMat(m.matId, m.count, m.city, m.price))
      .concat(_clBuildingFitting(r)),
  }),

  // One cycle: a filled journal in, loot + the empty journal out.
  "laborers-table": (r) => _clRow({
    tableId: "laborers-table",
    itemId: r.item?.id,
    itemName: r.item?.name || r.item?.id,
    buyCity: r.buy?.city,
    sellCity: r.sell?.city,
    sellPrice: r.sell?.price,
    inputCost: r.totalInputCost,
    unitProfit: r.marginInfo?.profit,
    materials: r.filledId
      ? [_clMat(r.filledId, 1, r.buy?.city, r.buy?.price)]
      : [],
  }),

  // One journal: buy it empty, sell it full.
  "journal-filling-table": (r) => _clRow({
    tableId: "journal-filling-table",
    itemId: r.fullId,
    itemName: r.name || r.label || r.fullId,
    buyCity: r.emptyCity,
    sellCity: r.fullCity,
    sellPrice: r.fullGross,
    inputCost: r.emptyCost,
    unitProfit: r.marginPerJournal,
    materials: r.emptyId
      ? [_clMat(r.emptyId, 1, r.emptyCity, r.emptyCost)]
      : [],
  }),

  // Nothing is bought: the input is your time, so no material lines.
  "gathering-table": (r) => _clRow({
    tableId: "gathering-table",
    itemId: r.id || r.item?.id,
    itemName: _clName(r.id || r.item?.id, r.name),
    sellCity: r.sellCity,
    sellPrice: r.sellPrice,
    inputCost: 0,
    unitProfit: 0,
    materials: [],
  }),
};

/** Normalize one source row; null when the table isn't on the list's map. */
function extractCraftListRow(tableId, row) {
  const fn = CRAFT_LIST_EXTRACTORS[tableId];
  if (!fn || !row) return null;
  try {
    return fn(row);
  } catch (e) {
    console.error(`craft-list extractor failed for ${tableId}:`, e);
    return null;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CRAFT_LIST_EXTRACTORS,
    extractCraftListRow,
    _clBuildingFitting,
    _clBaseRrr,
    _clRow,
    // Shared with js/craft-list-extractors-transport.js — under Node the
    // transport extractor pulls these onto globalThis (see that file).
    _clMat,
    _clEffCount,
    _clName,
    _clNum,
  };
}

// The transport-table extractor lives in js/craft-list-extractors-transport.js,
// the faction-spending extractor in js/craft-list-extractors-faction.js and the
// farming extractor in js/craft-list-extractors-farming.js
// (all split off for the 800-line limit); these requires are what load them
// under Node, and each registers itself into CRAFT_LIST_EXTRACTORS above. In
// a browser the sibling <script> tags do it; a sandbox that concatenates the
// sources has every file as plain globals already.
try {
  require("./craft-list-extractors-transport.js");
  require("./craft-list-extractors-faction.js");
  require("./craft-list-extractors-farming.js");
} catch (e) { /* browser: no such relative module — the script tag handles it */ }
