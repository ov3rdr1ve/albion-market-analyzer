/**
 * Building Costs table — what it takes to put a building down, and what it takes
 * to put it down FURNISHED.
 *
 * ONE row per building. Two halves of the same answer, side by side:
 *
 *   • the shell   — the silver fee plus the bill of construction materials, each
 *                   bought in whichever city lists it cheapest. The Silver Fee
 *                   and Material Cost columns are exactly those two numbers, so
 *                   the bare shell stays readable and sortable on its own.
 *   • the fitting — every laborer slot filled with a contract, and the furniture
 *                   slots furnished the way the game requires: one bed per
 *                   laborer, a table per 4 (or 6 from T5), and the slots left
 *                   over spent on trophies. js/buildings-furnishing.js does that
 *                   allocation and documents the rules; this file only prices and
 *                   renders it. Only houses and guild halls have slots
 *                   (js/data-buildings.js reads furniturelimit/laborerslimit
 *                   straight out of buildings.xml), so everything else shows an
 *                   em dash in the Laborers / Furniture / Best Journal /
 *                   Self-Fill columns.
 *
 * Total Cost is the FURNISHED total, with a `= shell + laborers + furniture`
 * breakout under it. It used to be split across a second, indented "+ laborers &
 * furniture" row per building; the fitting is columns now, so sorting any column
 * can no longer separate a building from its own staffing costs.
 *
 * This is a COST board, not a profit table: nothing here is sold, so there is no
 * margin column and no sell city. What it answers is "which tier can I afford,
 * and how much more is it once it is actually staffed".
 *
 * The Best Journal column is a REUSE, not a second model: it asks the Laborers
 * table's own _bestJournalForLaborer which journal tier this laborer would run.
 * That matters here because a journal at least one tier below the laborer already
 * yields the full 150% on tier advantage alone — trophies cannot get you there
 * and are not needed for it — so when a lower-tier journal wins, the trophy half
 * of the plan is flagged optional with its subtotal.
 *
 * Deliberate limitation: the app's yield model is binary (getLaborerYield at the
 * laborer's own tier, else a flat 1.5) and does NOT interpolate happiness, so the
 * trophy plan is PRICED here but not re-scored. js/data-laborers.js:41-55 already
 * bakes the standard trophy setup into its same-tier yield; inventing a
 * happiness-to-yield curve here would contradict it.
 *
 * The silver fee is a sink like every other, so it goes through
 * applyGlobalDiscount (js/global-discount.js) and moves with the gold price.
 */

// Cities a construction material can be bought in. Materials are bulk-hauled to
// the plot either way, so this is a plain cheapest-listing search with no route
// validity to honour — unlike a craft, there is no "sell" leg to invalidate.
const BUILDING_BUY_CITIES = [
  "Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch",
  "Brecilien", "Smuggler's Den",
];

// Cheapest listing of `id` across BUILDING_BUY_CITIES. Returns price 0 / city
// null when nothing is priced.
//
// findBestBuyCity is the app-wide picker (js/utils.js) and honours the city FORCE
// the price editor writes alongside an override. The hand-rolled loop this
// replaced did not, so editing a price upward moved the row to the next-cheapest
// city instead: the number the user typed vanished along with its ⚡, and the edit
// looked discarded. minVolume 0 — construction materials and contracts are bought
// in bulk from whoever lists them, and this table has no thin-market question.
function _bldCheapest(marketData, id) {
  const best = findBestBuyCity(marketData, id, BUILDING_BUY_CITIES, 0);
  return { price: best.city ? best.price : 0, city: best.city };
}

// Cheapest of a set of interchangeable ids. A laborer slot takes any laborer, so
// with no laborer picked the cheapest contract sets the price of filling it.
//
// A hand-typed price or a pinned city on ONE of the candidates narrows the search
// to the pinned ones: editing a contract's price is a statement about which line
// you buy, and taking the plain minimum meant raising the winner silently elected
// the runner-up — the number the user just typed vanished from the table, which
// read as the override being discarded. Among several pinned lines the cheapest
// of THEM still wins.
function _bldCheapestOf(marketData, ids) {
  const pinned = ids.filter((id) => _bldAnyOverride(id)
    || (typeof getCityForce === "function" && getCityForce(id, "buy")));
  const candidates = pinned.length > 0 ? pinned : ids;
  let best = { price: 0, city: null, id: null };
  candidates.forEach((id) => {
    const c = _bldCheapest(marketData, id);
    if (c.price > 0 && (best.price === 0 || c.price < best.price)) {
      best = { price: c.price, city: c.city, id };
    }
  });
  return best;
}

// The laborer the fitted row hires. `laborerSlug` empty = whichever contract line
// is cheapest at this tier (the table's default), and the trophy line then
// follows whichever won — a Wood contract with Fish trophies would help nobody.
function _bldContract(marketData, tier, laborerSlug) {
  if (laborerSlug) {
    const laborer = _bldLaborers().find((l) => l.slug === laborerSlug);
    if (laborer) {
      const id = `T${tier}_LABOURER_CONTRACT_${laborer.contractSlug}`;
      return { ..._bldCheapest(marketData, id), id, slug: laborer.slug };
    }
  }
  const best = _bldCheapestOf(marketData,
    BUILDING_CONTRACT_SLUGS.map((slug) => `T${tier}_LABOURER_CONTRACT_${slug}`));
  return { ...best, slug: best.id ? _bldSlugOfContractId(best.id) : null };
}

// LABORERS lives in js/data-laborers.js, which the table does not otherwise
// depend on. Guarded so the buildings table still renders if that catalog is
// absent (the Node tests load neither).
function _bldLaborers() {
  return typeof LABORERS !== "undefined" ? LABORERS : [];
}

// Contract id back to a laborer slug. The contract slug is not always the laborer
// slug — the Fisherman's contract is T?_LABOURER_CONTRACT_FISHERMAN — so this
// goes through the catalog rather than slicing the id.
function _bldSlugOfContractId(id) {
  const m = id.match(/_LABOURER_CONTRACT_([A-Z]+)$/);
  if (!m) return null;
  const laborer = _bldLaborers().find((l) => l.contractSlug === m[1]);
  return laborer ? laborer.slug : m[1];
}

/** localStorage key holding the picked laborer across restarts. */
const BUILDINGS_LABORER_KEY = "buildingsLaborer";

/** The laborer the table is currently pinned to, "" for cheapest-contract. */
function getBuildingsLaborerSlug() {
  if (typeof document === "undefined") return "";
  return document.getElementById("buildings-laborer-select")?.value || "";
}

// One priced line of a bill of materials.
function _bldMaterialLines(marketData, materials) {
  let total = 0, allPriced = true;
  const lines = materials.map((m) => {
    const c = _bldCheapest(marketData, m.matId);
    if (c.price <= 0) allPriced = false;
    total += c.price * m.count;
    return { matId: m.matId, count: m.count, price: c.price, city: c.city };
  });
  return { lines, total, allPriced };
}

// What each rung of the ladder costs on its own: [{ tier, cost }]. Only the sum
// is spent, but the steps are what a player pays one at a time, so the Total cell
// spells them out.
function _bldPathSteps(marketData, path) {
  return path.map((step) => {
    const priced = _bldMaterialLines(marketData, step.materials);
    const silver = typeof applyGlobalDiscount === "function"
      ? applyGlobalDiscount(step.silverCost)
      : step.silverCost;
    return { tier: step.tier, cost: priced.total + silver };
  });
}

// True when any city carries a manual override for `id` — the override filter
// keys on this, so every id a row prices has to be checked, not just materials.
function _bldAnyOverride(id) {
  if (typeof getOverridePrice !== "function" || !id) return false;
  return BUILDING_BUY_CITIES.some((c) => getOverridePrice(id, c) !== null);
}

// Build the one row for one building: the shell, plus the fitting when the
// building has slots to fill (`laborers` / `plan` stay null otherwise). `ctx`
// carries the render-wide picks: the chosen laborer and the Laborers table's
// best-journal verdicts by tier.
function buildBuildingRow(b, marketData, ctx) {
  const fam = BUILDING_FAMILIES[b.family];
  // What a T8 costs is the WHOLE ladder: you place the family's lowest tier and
  // pay an upgrade step per tier, so the bill is every step's materials rolled up
  // (js/buildings-upgrade-path.js). Pricing only b.materials answered "what does
  // the last upgrade cost", which is not a building you can own.
  const path = getBuildingUpgradePath(b.id);
  const rollup = rollupUpgradeMaterials(path);
  const mats = _bldMaterialLines(marketData, rollup);
  const rawSilver = sumUpgradeSilver(path);
  const silverFee = typeof applyGlobalDiscount === "function"
    ? applyGlobalDiscount(rawSilver)
    : rawSilver;
  const buildCost = mats.total + silverFee;

  const shell = {
    building: b, family: fam,
    materials: mats.lines, materialCost: mats.total, silverFee,
    buildCost, totalCost: buildCost,
    // Per-step costs for the Total tooltip: the single-tier number the table used
    // to show is still worth reading, it just is not what the building costs.
    pathSteps: _bldPathSteps(marketData, path),
    laborers: null, plan: null, bestJournal: null,
    furnitureCost: 0, trophyCost: 0, missing: [],
    hasData: mats.allPriced && mats.total > 0,
    hasOverride: rollup.some((m) => _bldAnyOverride(m.matId)),
  };

  if (b.laborerSlots <= 0 && b.furnitureSlots <= 0) return shell;

  const laborerSlug = (ctx && ctx.laborerSlug) || "";
  const contract = b.laborerSlots > 0
    ? _bldContract(marketData, b.tier, laborerSlug)
    : null;

  // With no laborer pinned the trophies follow whichever contract came out
  // cheapest, so the trophy line always matches the crew that was hired.
  const trophySlug = laborerSlug || (contract && contract.slug) || "";
  const plan = b.furnitureSlots > 0
    ? planFurnishing({
        tier: b.tier,
        laborers: b.laborerSlots,
        furnitureSlots: b.furnitureSlots,
        laborerSlug: trophySlug,
        priceOf: (id) => _bldCheapest(marketData, id),
      })
    : null;

  const laborerCost = contract ? contract.price * b.laborerSlots : 0;
  const furnitureCost = plan ? plan.furnitureCost : 0;
  const trophyCost = plan
    ? plan.trophies.reduce((s, t) => s + t.price * t.copies, 0)
    : 0;

  // Which parts of the fitting the market does not price. Thin markets are the
  // norm here — laborer contracts and T8 furniture often have no listing at all —
  // and demanding every part be priced USED to blank the whole row, so picking a
  // laborer whose contract was unpriced made the row disappear and the picker
  // looked dead. The gaps are listed instead, and each stays click-to-edit so the
  // user can supply the price the market is missing.
  const missing = [];
  if (contract && contract.price <= 0) missing.push("contract");
  if (plan && plan.bedsAndTablesFit) {
    if (plan.beds.count > 0 && plan.beds.price <= 0) missing.push("beds");
    if (plan.tables.count > 0 && plan.tables.price <= 0) missing.push("tables");
  }

  return {
    ...shell,
    missing,
    laborers: contract
      ? { ...contract, count: b.laborerSlots, cost: laborerCost }
      : null,
    plan,
    furnitureCost,
    trophyCost,
    // Keyed on the crew this row actually hires, not on the picker: with no
    // laborer pinned the winning contract differs per tier, and looking the
    // verdict up by tier alone left the whole column blank in that default —
    // which read as the Best Journal column being broken.
    bestJournal: (ctx && typeof ctx.bestJournalFor === "function")
      ? ctx.bestJournalFor(trophySlug, b.tier)
      : null,
    totalCost: buildCost + laborerCost + furnitureCost,
    // hasData stays the SHELL's verdict — the shell has to be priced or there is
    // no building at all. A furnishing that physically cannot fit is a game-rules
    // failure, not a price hole: it keeps its own red cell, contributes 0 to the
    // total, and must NOT blank the building's construction cost with it (the old
    // two-row layout could afford to, because the shell row survived beside it).
    // Unpriced contracts and furniture likewise land in `missing`, add nothing to
    // the total, and flag it. Trophies were always exempt for the same reason.
    hasData: shell.hasData,
    hasOverride: shell.hasOverride
      || _bldAnyOverride(contract && contract.id)
      || (plan ? [plan.beds.id, plan.tables.id, ...plan.trophies.map((t) => t.id)]
        .some((id) => _bldAnyOverride(id)) : false),
  };
}

// "12x Elder's Stone Block @ 1,234 ea (from Martlock)" — prices are click-to-edit
// through the same override plumbing every other table uses.
//
// The span comes from matPriceSpan (js/app.js) like every other price in this
// table: the hand-rolled span this replaced carried the click-to-edit hooks but
// NOT the ⚡ marker or the gold override colour, so an accepted override on a
// material read as discarded even though the number and the Total had moved.
// Guarded — js/app.js is not loaded by the Node tests.
function _bldMatLine(line) {
  const name = getItemDisplayName(line.matId);
  const span = typeof matPriceSpan === "function"
    ? matPriceSpan(line.matId, line.city || "", line.price)
    : `<span class="price-editable" data-item-id="${line.matId}" data-city="${line.city || ""}" data-raw-price="${line.price}" data-city-list="buy" style="cursor:pointer;text-decoration:underline dotted">@ ${formatSilver(line.price)} ${tx("ea", "r_ea")}</span>`;
  const cityBit = line.price > 0 && line.city
    ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${line.city})</small>`
    : "";
  return `${line.count.toLocaleString()}x ${name} ${span}${cityBit}`;
}

// One priced furniture / contract line: "15x Elder's Bed @ 450,000 ea (Martlock)".
// matPriceSpan (js/app.js) gives the same click-to-edit dropdown and the ⚡
// override marker the material lines get — the laborer and furniture prices used
// to be plain text, so the only prices on the row that could NOT be corrected
// were the two biggest ones.
function _bldItemLine(count, id, price, city, suffix = "") {
  const span = typeof matPriceSpan === "function"
    ? matPriceSpan(id, city || "", price)
    : `@ ${formatSilver(price)} ${tx("ea", "r_ea")}`;
  const cityBit = city ? ` <small style="color:#9ca3af">(${city})</small>` : "";
  return `${count.toLocaleString()}x ${getItemDisplayName(id)}${suffix} ${span}${cityBit}`;
}

// The laborer cell: who is hired, then the contract line that hires them. The
// contract's item name is NOT the laborer's name — a Fiber contract hires the
// Cropper, a Toolmaker contract the Tinker — so a cell showing only the item
// left the header picker looking inert, since switching crews changed a word
// the user was not reading as the laborer. An unpriced contract says so rather
// than sitting there as a silent "@ 0 ea".
function _bldLaborerCell(row, emDash) {
  const c = row.laborers;
  if (!c) return emDash;
  if (!c.id) {
    // Cheapest-contract mode with not one contract line priced: there is no id
    // to hang an editable price on, so say that rather than render "15x null".
    return `<td class="cell-note" style="color:#9e8840">${c.count.toLocaleString()}x ` +
      `${tx("laborer contract — no line priced yet", "r_bld_contract_none_priced")}</td>`;
  }
  const laborer = c.slug ? _bldLaborers().find((l) => l.slug === c.slug) : null;
  const who = laborer
    ? `<small style="color:#9ca3af">${laborer.name}</small><br>`
    : "";
  const note = c.price > 0
    ? ""
    : `<br><small style="color:#9e8840">${tx("no listing — click the price to set it", "r_bld_contract_no_listing")}</small>`;
  return `<td class="cell-note">${who}${_bldItemLine(c.count, c.id, c.price, c.city)}${note}</td>`;
}

// Trophies collapse to one line per trophy LINE with its tier list, because a
// T8 guild hall buys ten distinct trophies in blocks of five and listing all
// fifty would bury the row. The tiers are spelled out because they are the whole
// point — the happiness stacks only because they are different items — and they
// are listed individually when the cheapest picks are not contiguous.
function _bldTrophyLines(trophies) {
  const byLine = new Map();
  trophies.forEach((t) => {
    if (!byLine.has(t.affected)) byLine.set(t.affected, []);
    byLine.get(t.affected).push(t);
  });
  return [...byLine.entries()].map(([affected, group]) => {
    const copies = group[0].copies;
    const total = group.reduce((s, t) => s + t.copies, 0);
    const cost = group.reduce((s, t) => s + t.price * t.copies, 0);
    const tierBit = formatTierRange(group.map((t) => t.tier));
    const copyBit = copies > 1 ? ` ×${copies}` : "";
    // Priced per line, not per tier: the tiers cost different amounts, so a
    // single editable span over the group would be a lie. The subtotal is the
    // honest summary; individual tiers stay editable in the Flipping table.
    return `${total.toLocaleString()}x ${getTrophyLineName(group[0].id)} ` +
      `<small style="color:#9ca3af">${tierBit}${copyBit}</small> ` +
      `<small style="color:#9ca3af">= ${formatSilver(cost)}</small>`;
  });
}

// The furniture cell: the plan, not one item repeated. Ends with what the trophy
// half actually bought — the happiness score and any slot the plan could not
// fill, so a hall with slots to spare says so instead of looking complete.
function _bldFurnitureCell(row, emDash) {
  const plan = row.plan;
  if (!plan) return emDash;
  if (!plan.bedsAndTablesFit) {
    return `<td class="cell-note" style="color:#c0392b">${tx("furniture slots cannot hold one bed per laborer", "r_bld_slots_overflow")}</td>`;
  }
  const lines = [];
  if (plan.beds.count > 0) {
    lines.push(_bldItemLine(plan.beds.count, plan.beds.id, plan.beds.price, plan.beds.city));
  }
  if (plan.tables.count > 0) {
    lines.push(_bldItemLine(plan.tables.count, plan.tables.id, plan.tables.price, plan.tables.city));
  }
  lines.push(..._bldTrophyLines(plan.trophies));

  const optional = row.bestJournal && row.bestJournal.journalTier < row.building.tier;
  const trophyNote = plan.trophies.length > 0
    ? `+${plan.trophyHappiness}/100 ${tx("trophy happiness", "r_bld_trophy_happiness")}` +
      (optional
        ? ` · <span style="color:#9e8840">${tx("optional", "r_bld_optional")} −${formatSilver(row.trophyCost)}</span>`
        : "")
    : tx("no trophies fit", "r_bld_no_trophies");
  const spareNote = plan.slotsSpare > 0
    ? ` · ${plan.slotsSpare} ${tx("slots spare", "r_bld_slots_spare")}`
    : "";
  const tip = tx("A bed serves 1 laborer, a table 4 (6 from T5); spare slots take trophies. Happiness stacks only across DIFFERENT trophies, none above the building's own tier.", "r_tip_bld_furnishing");

  lines.push(`<small style="color:#9ca3af" title="${tip}">${trophyNote}${spareNote}</small>`);
  return `<td class="cell-note">${lines.join("<br>")}</td>`;
}

// "Best Journal": which journal tier this laborer would actually be fed, taken
// from the Laborers table rather than recomputed. A journal below the laborer's
// own tier yields the full 150% on tier advantage alone, which is what makes the
// trophy spend optional — so that verdict belongs next to the trophy bill.
function _bldJournalCell(row, emDash) {
  if (!row.laborers) return emDash;
  const bj = row.bestJournal;
  if (!bj) {
    return `<td class="cell-note" style="color:#6b7280;font-style:italic" title="${tx("Run a full scan (or the Laborers scan) to price the journals — the buildings scan deliberately does not fetch them.", "r_tip_bld_journal_no_data")}">—</td>`;
  }
  const beatsSameTier = bj.journalTier < row.building.tier;
  const arrow = beatsSameTier ? ' <span style="color:#1f9d55">▲</span>' : "";
  const tip = beatsSameTier
    ? tx("A T{journal} journal is below this laborer's tier, so it already yields the full 150% — trophies cannot raise it and are optional here.", "r_tip_bld_journal_lower")
      .replace("{journal}", bj.journalTier)
    : tx("The laborer's own tier is the most profitable journal to feed it, and a same-tier journal does need the trophy happiness to reach its yield.", "r_tip_bld_journal_same");
  // Same three facts, in the same order, as the Laborers table's own Best Journal
  // cell (js/render-laborers.js:_bestJournalCell) — plus the laborer's name, so
  // the two tables can be compared row to row instead of read as disagreeing.
  const who = bj.laborerName ? `<br><small style="color:#9ca3af">${bj.laborerName}</small>` : "";
  const profit = (bj.profit != null)
    ? ` <span style="color:#9ca3af">${formatSilver(bj.profit)}/cyc</span>`
    : "";
  return `<td class="cell-note" title="${tip}">T${bj.journalTier} @${(bj.yield * 100).toFixed(1)}%${arrow}` +
    `${profit}${who}</td>`;
}

// The Laborers table's best-journal verdict per tier for one laborer, indexed by
// tier. Returns {} when that table's catalog or its journal prices are absent —
// with nothing scanned yet, "no data" is the normal case.
function _bldBestJournalByTier(marketData, laborerSlug) {
  const ready = typeof LABORERS !== "undefined"
    && typeof LABORER_TIERS !== "undefined"
    && typeof computeBestLaborerRoute === "function"
    && typeof _bestJournalForLaborer === "function"
    && typeof _laborerJournalRowSpec === "function";
  if (!ready) return {};
  // With no laborer pinned there is no single journal to name — the contract
  // line, and so the journal, can differ per tier.
  const laborer = LABORERS.find((l) => l.slug === laborerSlug);
  if (!laborer) return {};
  const out = {};
  // Every mode the laborer can run, best of them per tier — the Laborers table
  // gives each mode its own row, so taking modes[0] alone could name a different
  // journal than that table shows for the same crew. Today each laborer has one
  // mode, so this is a drift guard rather than a change of answer.
  (laborer.modes || []).forEach((mode) => {
    const specs = LABORER_TIERS.map((tier) => _laborerJournalRowSpec(laborer, tier, mode));
    const routes = specs.map((s) => computeBestLaborerRoute(s, marketData));
    if (!routes.some((r) => r)) return;
    const boosted = specs.map((s) => computeBestLaborerRoute({ ...s, yield: 1.5 }, marketData));
    specs.forEach((s, i) => {
      const bj = _bestJournalForLaborer(specs, routes, boosted, i);
      if (!bj) return;
      if (out[s.tier] && out[s.tier].profit >= bj.profit) return;
      // The name travels with the verdict: the column sits next to a CONTRACT
      // line whose item name is not the laborer's (a Fiber contract hires the
      // Cropper), so a cell that only said "T8" read as contradicting the
      // Laborers table when it was simply about another laborer.
      // The self-fill alternative for the same crew — no extra pricing loop and
      // no extra scan ids: the payload ids are the ones the routes above already
      // fetched. Kept on the verdict so the two columns move together.
      const selfFill = (typeof computeLaborerSelfFill === "function")
        ? computeLaborerSelfFill({
            spec: s, marketData, laborerTier: s.tier,
            city: (routes[i] && routes[i].laborerCity) || (bj.route && bj.route.laborerCity),
          })
        : null;
      out[s.tier] = { ...bj, laborerName: laborer.name, mode, selfFill };
    });
  });
  return out;
}

// Total tooltip: the ladder, step by step, because the number in the cell is a
// sum nobody pays in one go. A single-step building (a farm, the Hideout) has no
// ladder to spell out, so it keeps the plain fee/materials reading.
// The parts of a fitted row the market does not price, named for the ⚠ tooltip.
// Spelled out as literal tx() calls, not a table of arguments: the i18n scanner
// (scripts/gen-i18n-index.cjs) reads the source, so a spread call would leave
// these three strings untranslated and invisible to the coverage test.
function _bldMissingLabel(row) {
  return (row.missing || []).map((p) => {
    if (p === "contract") return tx("laborer contract", "r_bld_part_contract");
    if (p === "beds") return tx("beds", "r_bld_part_beds");
    if (p === "tables") return tx("tables", "r_bld_part_tables");
    return p;
  }).join(", ");
}

// "Partial: laborer contract unpriced…" — a total that is missing a part says so,
// on the total itself. Without it a row with an unpriced contract reads as a
// complete, and much too cheap, answer.
function _bldPartialTip(row) {
  if (!row.missing || row.missing.length === 0) return "";
  return tx("Partial: {parts} unpriced, so they add nothing to this total. Click the price to fill it in.",
    "r_tip_bld_partial").replace("{parts}", _bldMissingLabel(row));
}

function _bldTotalTip(row) {
  const steps = row.pathSteps || [];
  const partial = _bldPartialTip(row);
  if (steps.length < 2) return partial;
  const chain = steps.map((s) => `T${s.tier} ${formatSilver(s.cost)}`).join(" + ");
  const last = steps[steps.length - 1];
  const tip = tx("Every upgrade step from scratch: {chain} = {total}. This tier's own step is {step}.",
    "r_tip_bld_upgrade_path")
    .replace("{chain}", chain)
    .replace("{total}", formatSilver(row.buildCost))
    .replace("{step}", formatSilver(last.cost));
  // Contracts and furniture are bought ONCE, at the final tier: furniture below
  // the building's tier gives less happiness than the tier piece, and a contract
  // levels by fame rather than being re-bought, so neither is part of the ladder.
  const extra = (row.laborers ? row.laborers.cost : 0) + (row.furnitureCost || 0);
  if (extra <= 0) return partial ? `${tip} ${partial}` : tip;
  const fittedTip = `${tip} ${tx("Contracts and furniture add {extra}, bought once at this tier.",
    "r_tip_bld_fitted_extra").replace("{extra}", formatSilver(extra))}`;
  return partial ? `${fittedTip} ${partial}` : fittedTip;
}

// Total Cost is the FURNISHED total, so it says what it is made of: the shell
// (every upgrade step's fee + materials), the contracts, and the furnishing plan.
// Same shape as the Crafting Planner's Profit / Craft breakout. Omitted when
// there is only one term — a building with no slots is its shell.
function _bldTotalBreakout(row) {
  const parts = [`${tx("shell", "r_bld_part_shell")} ${formatSilver(row.buildCost)}`];
  const laborerCost = row.laborers ? row.laborers.cost : 0;
  if (laborerCost > 0) parts.push(`${tx("laborers", "r_bld_part_laborers")} ${formatSilver(laborerCost)}`);
  if (row.furnitureCost > 0) parts.push(`${tx("furniture", "r_bld_part_furniture")} ${formatSilver(row.furnitureCost)}`);
  if (parts.length < 2) return "";
  return `<br><small style="color:#9ca3af">= ${parts.join(" + ")}</small>`;
}

function renderBuildingsTable(marketData) {
  const md = marketData || {};
  const laborerSlug = getBuildingsLaborerSlug();
  // One verdict table per laborer, memoised for the length of this render: on
  // "Cheapest contract" the rows ask about several different laborers, and
  // computeBestLaborerRoute over 7 tiers is not cheap enough to redo per row.
  const journalMemo = new Map();
  const ctx = {
    laborerSlug,
    bestJournalFor: (slug, tier) => {
      if (!slug) return null;
      if (!journalMemo.has(slug)) journalMemo.set(slug, _bldBestJournalByTier(md, slug));
      return journalMemo.get(slug)[tier] || null;
    },
  };
  const rowData = BUILDINGS.map((b) => buildBuildingRow(b, md, ctx));
  // The laborers this table asked about — the pinned one, or every contract
  // winner on "Cheapest contract". ensureBuildingsJournalPrices fetches their
  // journals so the column is not left waiting on a Laborers scan.
  _bldJournalSlugsNeeded = Array.from(new Set(
    rowData.filter((r) => r.laborers && r.laborers.slug).map((r) => r.laborers.slug),
  ));

  const emDash = '<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>';

  renderTableData("buildings-table", rowData, (row) => {
    const { building: b, family: fam } = row;
    const rowKey = getRowKey(row, "buildings-table");

    const label = `T${b.tier} ${tx(fam.label, `r_bld_${b.family.toLowerCase()}`)}`;

    const laborCell = _bldLaborerCell(row, emDash);
    const furnCell = _bldFurnitureCell(row, emDash);
    const journalCell = _bldJournalCell(row, emDash);
    // Same cell as the Laborers table's, from the same verdict — see
    // js/laborer-self-fill.js. A building with no laborer slots has no crew, so
    // no fill play.
    const selfFillTd = (row.laborers && typeof selfFillCell === "function")
      ? selfFillCell(row.bestJournal && row.bestJournal.selfFill, row.bestJournal || null, emDash)
      : emDash;

    // ⚠ = the total is real but incomplete: a part of the row has no market
    // price, so it contributed nothing. The tooltip names which.
    const partialMark = (row.missing && row.missing.length > 0)
      ? ' <sup style="color:#9e8840">⚠</sup>'
      : "";
    return `
      <tr data-row-key="${rowKey}">
        ${addTdForKey("buildings-table", rowKey)}
        <td class="cell-item">${label}</td>
        <td><small style="color:#9ca3af">${tx(fam.category, `r_bldcat_${fam.category}`)}</small></td>
        <td class="cell-mats">${row.materials.map(_bldMatLine).join("<br>")}</td>
        <td class="silver-val" title="${tx("Placement fee for every upgrade step, after the Global Discount the gold price sets", "r_tip_building_fee")}">${formatSilver(row.silverFee)}</td>
        <td class="silver-val">${row.materialCost > 0 ? formatSilver(row.materialCost) : "—"}</td>
        ${laborCell}
        ${furnCell}
        ${journalCell}
        ${selfFillTd}
        <td class="silver-val cell-note profit-low" title="${_bldTotalTip(row)}">${row.hasData ? formatSilver(row.totalCost) + partialMark + _bldTotalBreakout(row) : "—"}</td>
      </tr>
    `;
  });

  // A pick restored from localStorage never went through the change handler, and
  // a buildings scan run on "Cheapest contract" pulled no journals at all — both
  // left the column reading "—" until the user toggled the picker. Once there is
  // market data in hand, top it up from here instead. Re-entrant by design: the
  // fetch re-renders, and the second pass finds nothing missing and stops.
  if (Object.keys(md).length > 0) ensureBuildingsJournalPrices();
}

// ─── Laborer selector ────────────────────────────────────────────────────────
// Populates #buildings-laborer-select from the LABORERS catalog and re-renders
// off the cached lastMarketData — the pick changes which contract is bought and
// which specialist trophy line the plan fills slots with, and both are already
// priced by the buildings scan, so no re-scan is needed. Not persisted, matching
// the other per-table pickers (#rerolling-quality-filter).
// Returns true once the options are in. Bailing WITHOUT latching matters: the
// old version marked itself done before its guards, so if this file happened to
// run before the laborer catalog existed the dropdown was left with its single
// hard-coded "Cheapest contract" option for the life of the session — a picker
// that literally cannot be changed.
function _populateBuildingsLaborerSelect() {
  if (typeof document === "undefined") return false;
  const select = document.getElementById("buildings-laborer-select");
  if (!select || typeof LABORERS === "undefined" || !LABORERS.length) return false;
  if (select.dataset && select.dataset.laborersLoaded === "1") return true;

  LABORERS.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.slug;
    opt.textContent = l.name;
    select.appendChild(opt);
  });
  if (select.dataset) select.dataset.laborersLoaded = "1";

  // The pick is which crew you are costing out, not a transient view toggle, so
  // it survives a restart — losing it on every launch read as "the laborer type
  // cannot be set". Unknown slugs (a renamed laborer) fall back to cheapest.
  try {
    const saved = localStorage.getItem(BUILDINGS_LABORER_KEY);
    if (saved && LABORERS.some((l) => l.slug === saved)) select.value = saved;
  } catch (e) { /* storage disabled — the picker just starts on cheapest */ }
  return true;
}

(function _initBuildingsLaborerSelect() {
  if (typeof document === "undefined") return;
  if (document._buildingsLaborerSelectInit) return;
  document._buildingsLaborerSelectInit = true;

  // Delegated, so the handler cannot be lost with the element (a re-render, a
  // language switch rebuilding the header) and is wired even if the options
  // arrive later.
  document.addEventListener("change", (e) => {
    const select = e.target;
    if (!select || select.id !== "buildings-laborer-select") return;
    try { localStorage.setItem(BUILDINGS_LABORER_KEY, select.value); } catch (err) { /* ignore */ }
    if (typeof lastMarketData !== "undefined" && lastMarketData) {
      renderBuildingsTable(lastMarketData);
    }
    ensureBuildingsJournalPrices();
  });

  if (_populateBuildingsLaborerSelect()) return;
  // Catalog or element not there yet — try again once the document is parsed.
  // The catalogs load after first paint now (js/catalog-loader.js), so a bare
  // next-tick retry fires while they are still loading; the last shot waits
  // for them before giving up.
  const retry = () => {
    if (_populateBuildingsLaborerSelect()) return;
    const last = () => setTimeout(_populateBuildingsLaborerSelect, 0);
    if (typeof whenCatalogsReady === "function") whenCatalogsReady(last);
    else setTimeout(last, 0);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", retry);
  else retry();
})();

// The journals of the laborers the table hires, fetched on demand. Switching
// laborer changes which journals the Best Journal column has to compare, and the
// buildings scan only pulled the ones for the laborer selected AT scan time —
// without this the column reads "—" until the user re-scans. Same shape as the
// Craft Planner's lazy variant fetch (ensurePlannerVariantPrices,
// js/render-craft-planner.js:378).
const _bldJournalFetchInFlight = new Set();
// Slugs already fetched once. An id the API has no listing for never lands in
// lastMarketData, so without this a render→fetch→render cycle would retry it
// forever.
const _bldJournalTried = new Set();
// Filled by the last render: whose journals the visible rows actually need.
let _bldJournalSlugsNeeded = [];

async function ensureBuildingsJournalPrices() {
  if (typeof fetchPricesBatch !== "function") return;
  if (typeof getLaborerJournalScanIds !== "function") return;
  const pinned = getBuildingsLaborerSlug();
  const slugs = (pinned ? [pinned] : _bldJournalSlugsNeeded)
    .filter((s) => s && !_bldJournalFetchInFlight.has(s) && !_bldJournalTried.has(s));
  if (slugs.length === 0) return;
  const md = (typeof lastMarketData !== "undefined" && lastMarketData) || {};
  const missing = Array.from(new Set(
    slugs.flatMap((s) => getLaborerJournalScanIds(s)),
  )).filter((id) => !(id in md));
  if (missing.length === 0) return;
  slugs.forEach((s) => { _bldJournalFetchInFlight.add(s); _bldJournalTried.add(s); });
  const btn = (typeof document !== "undefined")
    ? document.getElementById("scan-buildings-btn") : null;
  if (btn) btn.classList.add("scanning"); // reuse the scan pulse as a loading cue
  try {
    const data = await fetchPricesBatch(missing);
    if (typeof lastMarketData === "undefined" || !lastMarketData) lastMarketData = {};
    applyScanPatch(lastMarketData, data);
    renderBuildingsTable(lastMarketData);
  } catch (e) {
    console.error("[buildings] lazy journal price fetch failed:", e);
  } finally {
    slugs.forEach((s) => _bldJournalFetchInFlight.delete(s));
    if (btn) btn.classList.remove("scanning");
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderBuildingsTable, buildBuildingRow, _bldCheapest, _bldCheapestOf,
    _bldContract, _bldMatLine, _bldTotalTip, getBuildingsLaborerSlug,
    ensureBuildingsJournalPrices, BUILDINGS_LABORER_KEY,
  };
}
