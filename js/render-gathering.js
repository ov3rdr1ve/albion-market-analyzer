/**
 * Gathering Profitability Table Renderer
 *
 * A single comparable table to pick the best gathering activity by Silver/Hour —
 * Mining, Lumberjacking, Skinning, Harvesting, Quarrying and Fishing, one row per
 * activity × tier. Gathering has no material input cost (you harvest for free), so
 * there's no buy→sell margin; rows are normalized two ways instead:
 *   - Silver / kg     — all-in net silver per unit ÷ weight (haul efficiency;
 *     mounts/bags are weight-limited).
 *   - Silver / Hour   — all-in net silver per unit × an ESTIMATED units/hour. The
 *     headline "most profitable right now".
 *
 * "All-in" means the bonus is folded straight into the number (no "+x%" badge):
 * land rows blend in the enchanted (.1–.4) drops you also pull from T4+ nodes
 * (calcGatheringEconomics); each merged Fishing row blends in the biome RARE fish
 * — fishing's "enchant" — picking the better-priced water (freshwater vs
 * saltwater) and its best rare (calcFishingEconomics). Seaweed is a lone T1
 * byproduct row.
 *
 * Each id is priced at its best sell city. Like the other tables, when "Black/Red
 * Zone Routes" is off the rows split into a Royal section and a Caerleon section.
 *
 * Catalogue, professions and the rate/share estimates come from data-gathering.js;
 * the pure economics are calcGatheringEconomics + calcFishingEconomics
 * (calculations.js).
 */

// Proper in-game tracked-animal name from a Rare Animal Remains id
// (T5_ALCHEMY_RARE_IMP → "Hellfire Imp") — shown in the Tracking row label and
// tooltip. Falls back to a title-cased segment for any unmapped creature.
const TRACK_CREATURE_LABELS = {
  PANTHER: "Panther", WEREWOLF: "Werewolf", IMP: "Hellfire Imp",
  ELEMENTAL: "Stone Golem", EAGLE: "Dawnbird",
};
function trackCreatureLabel(id) {
  const m = typeof id === "string" && id.match(/ALCHEMY_RARE_([A-Z]+)/);
  if (!m) return null;
  const en = TRACK_CREATURE_LABELS[m[1]] || (m[1].charAt(0) + m[1].slice(1).toLowerCase());
  return txSlug(en, "creature");
}

/**
 * Translate a data-file label ("Mining", "Pickaxe", "Saltwater") through a
 * prefixed slug — `prof_mining`, `tool_pickaxe`, `water_saltwater`. English is
 * the fallback, so an untranslated label still reads correctly.
 */
function txSlug(en, prefix) {
  if (typeof tx !== "function" || !en) return en;
  const slug = `${prefix}_${String(en).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_")}`;
  return tx(en, slug);
}

function renderGatheringTable(marketData) {
  const MIN_BUY_VOLUME = getOrderType("buy") === "market" ? 25 : 0;
  const MIN_SELL_VOLUME = getOrderType("sell") === "market" ? 25 : 0;

  const sections = isBlackRedZoneEnabled()
    ? [{ name: undefined, sellCities: SELL_CITIES }]
    : [
        { name: "royal", sellCities: ROYAL_CITIES },
        { name: "caerleon", sellCities: ["Caerleon", "Black Market"] },
      ];

  const resources = getGatheringResources();
  const rows = [];

  // Best sell of one id across this section's cities → {id, gross, city}.
  const bestPrice = (id, sellCities) => {
    const s = findBestSellCity(marketData, id, sellCities, MIN_SELL_VOLUME);
    return { id, gross: s.price || 0, city: s.city };
  };
  const volOf = (id, city) =>
    getOverrideVolume(id, city) ?? (marketData[id]?.[city]?.volume_24h || 0);

  // Land + seaweed: a single resource priced via calcGatheringEconomics (land
  // folds in its enchant variants; seaweed/stone collapse to flat).
  function buildSingleRow(res, sellCities) {
    const sell = bestPrice(res.rawId, sellCities);
    const enchantPrices = {};
    Object.entries(res.enchantIds).forEach(([level, id]) => {
      enchantPrices[level] = bestPrice(id, sellCities).gross;
    });
    const econ = calcGatheringEconomics({
      sellPrice: sell.gross,
      tier: res.tier,
      unitsPerHour: res.unitsPerHour,
      enchantPrices,
      enchantDist: res.enchantable ? getEnchantDist(res.tier) : {},
      weightKg: res.weightKg,
    });
    return {
      ...res,
      name: getItemDisplayName(res.rawId),
      sellCity: sell.city,
      sellPrice: sell.gross,
      netPerUnit: econ.netPerUnit,
      weightKg: econ.weightKg,
      blendedNetPerUnit: econ.blendedNetPerUnit,
      silverPerKg: econ.silverPerKg,
      silverPerHour: econ.silverPerHour,
      unitsPerHour: res.unitsPerHour,
      dailyVol: volOf(res.rawId, sell.city),
      hasOverride: getOverridePrice(res.rawId, sell.city) !== null,
    };
  }

  // Fishing: merge the tier into one row. Base = the better-priced common (fresh
  // vs salt); the bonus = the best-priced rare of that water, share-blended into
  // Silver/kg & Silver/Hour via calcFishingEconomics.
  function buildFishingRow(res, sellCities) {
    const fresh = bestPrice(res.freshCommonId, sellCities);
    const salt = bestPrice(res.saltCommonId, sellCities);
    const base = salt.gross > fresh.gross ? salt : fresh;
    const baseWater = base === salt ? "Saltwater" : "Freshwater";

    let rare = { id: null, gross: 0, city: null };
    const rareIds = baseWater === "Saltwater"
      ? (res.saltRareId ? [res.saltRareId] : [])
      : res.freshRareIds;
    rareIds.forEach((id) => {
      const p = bestPrice(id, sellCities);
      if (p.gross > rare.gross) rare = p;
    });

    const econ = calcFishingEconomics({
      commonGross: base.gross,
      commonWeightKg: res.commonWeightKg,
      rareGross: rare.gross,
      rareWeightKg: res.rareWeightKg,
      rareShare: res.rareShare,
      unitsPerHour: res.unitsPerHour,
    });
    return {
      ...res,
      rawId: base.id, // the staple common → drives the price cell + overrides
      // Uniform label like Skinning's "T8 hide" so every tier reads as one Fishing
      // activity, not a separate species. The actual catch is in the tooltip.
      // Ancient Lands rows carry their own name (js/data-gathering.js) because
      // they are a different activity, not another tier of the same one.
      name: res.rowName || `T${res.tier} fish`,
      commonName: getItemDisplayName(base.id),
      baseWater,
      rareId: rare.id,
      sellCity: base.city,
      sellPrice: base.gross,
      netPerUnit: econ.netPerUnit,
      weightKg: econ.weightKg,
      blendedNetPerUnit: econ.blendedNetPerUnit,
      silverPerKg: econ.silverPerKg,
      silverPerHour: econ.silverPerHour,
      unitsPerHour: econ.unitsPerHour,
      dailyVol: volOf(base.id, base.city),
      hasOverride: getOverridePrice(base.id, base.city) !== null,
    };
  }

  // Tracking: merge the tier into one row. Staple = the best-paying creature's Rare
  // Animal Remains; the bonus = the best-paying Shapeshifter artifact faction, plus
  // rare-quarry Black Market loot, share-blended into Silver/kg & Silver/Hour via
  // calcTrackingEconomics. Mirrors buildFishingRow's "best of N, fold in the bonus".
  function buildTrackingRow(res, sellCities) {
    let remains = { id: null, gross: 0, city: null };
    res.remainsIds.forEach((id) => {
      const p = bestPrice(id, sellCities);
      if (p.gross > remains.gross) remains = p;
    });
    let artifact = { id: null, gross: 0, city: null };
    res.artifactIds.forEach((id) => {
      const p = bestPrice(id, sellCities);
      if (p.gross > artifact.gross) artifact = p;
    });

    const bmLootPerKill = (res.rareQuarryShare || 0) * (res.bmLootGross || 0);
    const econ = calcTrackingEconomics({
      remainsGross: remains.gross,
      remainsWeightKg: res.remainsWeightKg,
      remainsPerKill: res.remainsPerKill,
      artifactGross: artifact.gross,
      artifactWeightKg: res.artifactWeightKg,
      artifactShare: res.artifactShare,
      bmLootPerKill,
      killsPerHour: res.killsPerHour,
    });
    const stapleId = remains.id || res.remainsIds[0];
    const creature = remains.id ? trackCreatureLabel(remains.id) : null;
    return {
      ...res,
      rawId: stapleId, // the staple remains → drives the price cell + overrides
      // Name the most-profitable creature to hunt (the best-priced remains right now),
      // e.g. "7 Werewolf remains" — that creature choice is the actionable decision,
      // unlike fishing's uniform "{tier} fish". Falls back to "{tier} remains" when no
      // remains is priced. The best-of logic is explained in the profession tooltip.
      name: creature ? `${res.tier} ${creature} remains` : `${res.tier} remains`,
      creature,
      artifactId: artifact.id,
      bmLootPerKill,
      sellCity: remains.city,
      sellPrice: remains.gross,
      netPerUnit: econ.netPerUnit,
      weightKg: econ.weightKg,
      blendedNetPerUnit: econ.blendedNetPerUnit,
      silverPerKg: econ.silverPerKg,
      silverPerHour: econ.silverPerHour,
      unitsPerHour: econ.unitsPerHour,
      dailyVol: volOf(stapleId, remains.city),
      hasOverride: remains.id ? getOverridePrice(remains.id, remains.city) !== null : false,
    };
  }

  sections.forEach(({ name: sectionName, sellCities }) => {
    resources.forEach((res) => {
      const row = res.kind === "fishing"
        ? buildFishingRow(res, sellCities)
        : res.kind === "tracking"
        ? buildTrackingRow(res, sellCities)
        : buildSingleRow(res, sellCities);
      row.section = sectionName;
      // Best journal to fill while doing this activity (empty bought + full sold
      // in the same cities). pickBestJournal returns null for activities with no
      // matching journal (tracking, the T1 seaweed byproduct). The ±2-tier fill
      // window is keyed off this row's tier.
      const best = (typeof pickBestJournal === "function")
        ? pickBestJournal(marketData, res.type, res.tier, sellCities, sellCities, MIN_SELL_VOLUME, MIN_BUY_VOLUME)
        : null;
      // Globally best journal for this profession (all tiers) — so the cell can
      // note when a lower tier ranks higher per fame than the one you can fill
      // at this gathering tier (matches the Journal Filling table).
      const globalBest = (typeof pickGlobalBestJournal === "function")
        ? pickGlobalBestJournal(marketData, res.type, res.tier, sellCities, sellCities, MIN_SELL_VOLUME, MIN_BUY_VOLUME)
        : null;
      row.journalBest = best;
      row.journalGlobalBest = globalBest;
      row.journalExtraPerHour = best ? best.extraSilverPerHour : 0;
      row.journalSilverPerFame = best ? best.silverPerFame : 0;
      // The second buyer for that journal: your own laborer, which returns loot
      // AND the journal (js/journal-laborer-payload.js). Priced per journal, the
      // unit the Journal Filling table beside it uses.
      const laborerPlay = (best && typeof computeJournalLaborerPlay === "function")
        ? computeJournalLaborerPlay({
            slug: best.slug, tier: best.tier, marketData, city: best.fullCity || sellCities[0],
          })
        : null;
      // How long that journal takes to fill at THIS row's gathering tier — the
      // row already IS a gathering-tier statement, so the header preference is
      // deliberately not read (see the Best Journal cell below). Computed once
      // here so the cell and the sort key can never disagree.
      row.jbFillHours = (best && typeof getJournalFillHours === "function")
        ? getJournalFillHours(best.maxfame, best.baseFamePerHour) : 0;
      row.laborerPlay = laborerPlay;
      row.laborerPayload = (laborerPlay && laborerPlay.hasData) ? laborerPlay.payload : 0;
      row.laborerAdvantage = (laborerPlay && laborerPlay.hasData && laborerPlay.sellPriced)
        ? laborerPlay.advantage : 0;
      row.laborerPerHour = (laborerPlay && laborerPlay.hasData && row.jbFillHours > 0)
        ? laborerPlay.payload / row.jbFillHours : 0;
      rows.push(row);
    });
  });

  renderTableData("gathering-table", rows, (row) => {
    const rowKey = getRowKey(row, "gathering-table");
    const prof = row.profession || {};
    const profLabel = txSlug(prof.label || "Gathering", "prof");
    const profTool = txSlug(prof.tool || "gathering tool", "tool");
    const isFishing = row.kind === "fishing";
    const isSeaweed = row.kind === "seaweed";
    const isTracking = row.kind === "tracking";

    // Profession badge + its tooltip.
    let profTip;
    if (isFishing && row.ancient) {
      // Ancient Lands: one catch, no water choice, no rare fold — saying
      // "no rare below T3" here would be wrong on both counts.
      profTip = tx(
        "Ancient Lands Fishing (T{tier}) — a {tool}, inside a run only. The leyfin is the whole catch; the rate is an estimate (a run is time-boxed).",
        "r_gather_tip_fishing_ancient",
      ).replace("{tier}", row.tier).replace("{tool}", profTool);
    } else if (isFishing) {
      const rareNote = row.rareShare > 0
        ? " " + tx("and the best {water} rare folded in (~{pct}% of catches)", "r_gather_rare_folded")
            .replace("{water}", row.baseWater === "Saltwater" ? tx("saltwater", "r_saltwater_lower") : tx("biome", "r_biome_lower"))
            .replace("{pct}", Math.round(row.rareShare * 100))
        : " " + tx("(no rare below T3)", "r_no_rare_below_t3");
      profTip = tx(
        "Fishing (T{tier}) — caught with a {tool}. Shown as the better-priced water right now: {fish} ({water}){rare}.",
        "r_gather_tip_fishing",
      ).replace("{tier}", row.tier).replace("{tool}", profTool)
        .replace("{fish}", row.commonName || tx("common fish", "r_common_fish"))
        .replace("{water}", txSlug(row.baseWater, "water")).replace("{rare}", rareNote);
    } else if (isSeaweed) {
      profTip = tx("Fishing byproduct — Seaweed (cheap, heavy) comes up constantly while fishing; a cooking material, not a meal fish.", "r_gather_tip_seaweed");
    } else if (isTracking) {
      const artNote = row.artifactId
        ? ", " + tx("with the best Shapeshifter Artifact (~{pct}% of kills) and rare-quarry Black Market loot folded in", "r_gather_artifact_folded")
            .replace("{pct}", Math.round(row.artifactShare * 100))
        : " " + tx("(no artifact priced right now)", "r_no_artifact_priced");
      profTip = tx(
        "Tracking (T{tier}) — hunted with a {tool}. Staple drop: {creature} Remains (you hunt whichever creature pays best){art}.",
        "r_gather_tip_tracking",
      ).replace("{tier}", row.tier).replace("{tool}", profTool)
        .replace("{creature}", row.creature || tx("Rare Animal", "r_rare_animal")).replace("{art}", artNote);
    } else {
      const enchNote = row.enchantable
        ? "; " + tx("Silver/kg & Silver/Hour fold in the enchanted (.1–.{max}) drops", "r_gather_ench_note")
            .replace("{max}", row.type === "rock" ? "3" : "4")
        : "";
      profTip = tx("{profession} — gathered with a {tool}{note}.", "r_gather_tip_land")
        .replace("{profession}", profLabel).replace("{tool}", profTool).replace("{note}", enchNote);
    }
    const profBadge = `<small style="color:#9ca3af" title="${profTip}">[${profLabel}]</small>`;

    const foldsBonus = row.enchantable; // land families that blend enchants
    const weightTip = isSeaweed
      ? tx("Seaweed's real in-game weight (1 kg) — heavy for such a cheap byproduct, so its Silver/kg is low", "r_weight_tip_seaweed")
      : isFishing
      ? tx("Real in-game weight of the common fish (the staple catch) — fish haul far better per kg than mined resources", "r_weight_tip_fish")
      : isTracking
      ? tx("Real in-game weight of one Rare Animal Remains (0.05 kg) — extremely light, so remains haul superbly per kg", "r_weight_tip_remains")
      : tx("Weight of one unit (0.1 × 1.5^tier)", "r_weight_tip_unit");
    const rateTip = isSeaweed
      ? tx("Estimated seaweed pulled per hour while fishing (a frequent byproduct) — see SEAWEED_UNITS_PER_HOUR in data-gathering.js", "r_rate_tip_seaweed")
      : isFishing
      ? tx("Estimated total fish caught per hour at this tier (commons + the rare share) — see FISH_UNITS_PER_HOUR in data-gathering.js", "r_rate_tip_fish")
      : isTracking
      ? tx("Estimated Rare Animal Remains per hour = est. kills/hour × remains/kill. See TRACK_KILLS_PER_HOUR / TRACK_REMAINS_PER_KILL in data-gathering.js", "r_rate_tip_tracking")
      : tx("Estimated raw units gathered per hour at this tier (decent gear/spec, matching-tier zone) — see GATHER_UNITS_PER_HOUR", "r_rate_tip_land");
    const perKgTip = isFishing
      ? tx("All-in net silver per catch ÷ blended weight — haul efficiency, with the heavier, pricier biome rare fish folded in", "r_perkg_tip_fish")
      : isTracking
      ? tx("All-in net silver per kill ÷ blended weight — haul efficiency, with the heavy (2 kg) Shapeshifter Artifact bonus folded in", "r_perkg_tip_tracking")
      : tx("All-in net silver per unit ÷ weight — haul efficiency", "r_perkg_tip_land") +
        (foldsBonus ? ", " + tx("with the enchanted (.1–.4) drops folded in (same weight, more silver)", "r_perkg_tip_ench") : "");
    const perHourTip = isFishing
      ? tx("All-in fishing throughput: best common catch plus the biome rare bonus, × estimated fish/hour. The headline gathering number.", "r_perhour_tip_fish")
      : isTracking
      ? tx("All-in tracking throughput: Rare Animal Remains plus the Shapeshifter Artifact and Black Market loot, × estimated kills/hour.", "r_perhour_tip_tracking")
      : tx("All-in throughput: net silver per unit{ench} × estimated units/hour. The headline number to compare gathering activities.", "r_perhour_tip_land")
          .replace("{ench}", foldsBonus ? " " + tx("(incl. the enchanted .1–.4 bonus)", "r_incl_ench_bonus") : "");

    const dim = '<span style="color:#6b7280;font-style:italic">—</span>';
    const netCell = row.netPerUnit > 0 ? formatSilver(row.netPerUnit) : dim;
    // Silver/kg & Silver/Hour are ALL-IN: the enchant/rare bonus is folded into
    // the number itself. A compact "incl. ench/rare" cue (no misleading "+x%" on
    // the face) confirms the bonus is in there; the tooltip shows by how much and
    // the flat baseline. Shown only when the bonus actually lifts the value.
    const bonusPct = row.netPerUnit > 0 && row.blendedNetPerUnit > row.netPerUnit
      ? (row.blendedNetPerUnit / row.netPerUnit - 1) * 100 : 0;
    const flatPerHour = row.netPerUnit * row.unitsPerHour;
    // What's folded into the all-in number, the baseline it beats, and the chip word.
    const bonusWhat = isFishing
      ? tx("biome rare fish are", "r_bonus_what_fish")
      : isTracking
      ? tx("Shapeshifter Artifact + rare-quarry Black Market loot are", "r_bonus_what_tracking")
      : tx("enchanted (.1–.4) drops are", "r_bonus_what_ench");
    const baselineWord = isTracking
      ? tx("remains-only", "r_baseline_remains")
      : isFishing ? tx("common-only", "r_baseline_common") : tx("flat", "r_baseline_flat");
    const bonusChip = isFishing
      ? tx("rare", "r_chip_rare")
      : isTracking ? tx("loot", "r_chip_loot") : tx("ench", "r_chip_ench");
    const bonusMark = bonusPct >= 0.5
      ? ` <small style="color:#10b981;font-weight:normal" title="${tx("All-in — the {what} already folded into this number (≈+{pct}% over the {baseline} {flat}/h). Nothing to add.", "r_bonus_mark_tip").replace("{what}", bonusWhat).replace("{pct}", Math.round(bonusPct)).replace("{baseline}", baselineWord).replace("{flat}", formatSilver(flatPerHour))}">${tx("incl.", "r_incl")} ${bonusChip}</small>`
      : "";
    const perKgCell = row.silverPerKg > 0 ? formatSilver(row.silverPerKg) : dim;
    const perHourCell = row.silverPerHour > 0 ? `<b>${formatSilver(row.silverPerHour)}</b>${bonusMark}` : dim;
    const perHourClass = getProfitClass(row.silverPerHour > 0 ? 25 : -1);

    // Best journal to fill while gathering this — a parallel income stream from
    // the base fame you earn anyway. Label = "T{tier} {Profession} · {Type}",
    // value = estimated extra silver/hour on top of the resource Silver/Hour.
    const jb = row.journalBest;
    const gb = row.journalGlobalBest;
    let journalCell;
    if (jb && jb.extraSilverPerHour > 0) {
      const jTypeShort = JOURNAL_KIND_LABEL[jb.kind] || jb.kind;
      // When the globally-best journal for this profession is a different tier
      // than the one you can fill here (the ±2 window), note it so the column
      // reconciles with the Journal Filling table instead of looking contradictory.
      const hasBetterGlobal = gb && gb.tier !== jb.tier && gb.silverPerFame > jb.silverPerFame + 1e-9;
      const gTypeShort = hasBetterGlobal ? (JOURNAL_KIND_LABEL[gb.kind] || gb.kind) : "";
      const globalNote = hasBetterGlobal
        ? ` <small style="color:#6b7280" title="Across all tiers, T${gb.tier} ${gb.label} (${gTypeShort}) pays more per fame (${formatSilver(gb.silverPerFame * 1000)}/1k vs ${formatSilver(jb.silverPerFame * 1000)}/1k) — but you can't fill it while gathering at T${row.tier} (a journal only fills from its tier up to +2 higher). Drop to a T${gb.tier}–T${Math.min(8, gb.tier + 2)} run to fill it.">· T${gb.tier} best overall</small>`
        : "";
      const windowNote = hasBetterGlobal
        ? ` The globally best is T${gb.tier} ${gb.label} (${formatSilver(gb.silverPerFame * 1000)}/1k fame), but it's unfillable at T${row.tier} — see the Journal Filling table.`
        : "";
      // Fishing ignores the ±2 fill window — any tier of fish fills any tier of
      // fishing journal — so it can always fill the globally best one.
      const fillRule = isFishing
        ? `Any tier of fish fills any tier of fishing journal, so this run can fill any tier; the best is shown.`
        : `A journal fills from resources of its tier up to +2 tiers higher, so this run can fill T${Math.max(2, row.tier - 2)}–T${row.tier} journals; the best fillable is shown.${windowNote}`;
      // How long that journal takes to fill at THIS row's gathering tier. The
      // header's Gathering Tier preference is deliberately not read here: a
      // gathering row already is a gathering-tier statement, and jb.baseFamePerHour
      // is keyed to row.tier, so overriding it would make the row contradict itself.
      const fillHours = row.jbFillHours;
      const fillNote = fillHours > 0
        ? ` <small style="color:#9ca3af">· ${formatFillHours(fillHours)} ${tx("to fill", "r_to_fill")}</small>`
        : "";
      const fillTip = fillHours > 0
        ? ` One journal takes about ${formatFillHours(fillHours)} of gathering at T${row.tier} to fill.`
        : "";
      const jTip = `Fill a T${jb.tier} ${jb.label} (${jTypeShort}) journal while gathering: buy empty @ ${formatSilver(jb.emptyCost)} (${jb.emptyCity || "—"}), sell full @ ${formatSilver(jb.fullGross)} (${jb.fullCity || "—"}) → ${formatSilver(jb.marginPerJournal)} margin ÷ ${jb.maxfame.toLocaleString()} fame = ${formatSilver(jb.silverPerFame * 1000)}/1k fame. × ~${jb.baseFamePerHour.toLocaleString()} base fame/h (est.) ≈ +${formatSilver(jb.extraSilverPerHour)}/h on top of the resource Silver/Hour.${fillTip} ${fillRule}`;
      journalCell = `<td title="${jTip}"><b>+${formatSilver(jb.extraSilverPerHour)}</b><small style="color:#6b7280">/h</small> <small style="color:#9ca3af">T${jb.tier} ${jb.label} · ${jTypeShort}</small>${globalNote}${fillNote}</td>`;
    } else {
      const noneTip = (row.kind === "tracking")
        ? "Tracking earns combat/tracking fame, which doesn't fill gathering journals."
        : (row.kind === "seaweed")
        ? "Seaweed is a T1 byproduct — no journal fills from it."
        : "No profitable journal priced for this profession right now (check the Journal Filling table).";
      journalCell = `<td title="${noneTip}">${dim}</td>`;
    }

    // What that same journal is worth handed to a laborer instead of sold. The
    // row's own journal, so the two cells always talk about the same item; rows
    // with no journal (tracking, seaweed) get the same dimmed dash.
    const laborerCell = (jb && typeof journalLaborerCell === "function")
      ? journalLaborerCell(row.laborerPlay, { hours: row.jbFillHours })
      : `<td class="silver-val" style="color:#6b7280;font-style:italic">—</td>`;

    return `
    <tr data-row-key="${rowKey}">
      ${addTdForKey("gathering-table", rowKey)}
      <td class="cell-item">${dispName(row.rawId, row.name)}${resourceAliasSpan(row.rawId)} ${profBadge}</td>
      <td>T${row.tier}</td>
      ${priceTd(row.sellPrice, row.rawId, row.sellCity, "sell", "silver-val", true)}
      <td class="silver-val">${netCell}</td>
      <td title="${weightTip}">${row.weightKg.toFixed(2)} kg</td>
      <td class="silver-val" title="${perKgTip}">${perKgCell}</td>
      <td title="${rateTip}">${row.unitsPerHour.toLocaleString()}<small style="color:#6b7280"> /h est</small></td>
      <td class="silver-val ${perHourClass}" title="${perHourTip}">${perHourCell}</td>
      ${journalCell}${laborerCell}    </tr>`;
  });
}
