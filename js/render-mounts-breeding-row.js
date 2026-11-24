// Mounts table — the BREEDING row renderer.
//
// Split out of js/render-mounts.js to keep both files inside the 800-line cap.
// Pure presentation: every figure on `row` is already computed by
// breedingRowFor() in render-mounts.js, and every helper it calls (getBreedingMeta,
// matPriceSpan, priceTd, profitTd, focusPlayCell, …) is a shared global, same as
// before the split.
//
// Grow time to DISPLAY, in hours. getBreedingMeta().growHours is the NON-Premium
// base (BREEDING_LONG_GROW_HOURS, the 668 h drake); Premium halves it. The base
// stays untouched because the nurture-cycle count is derived from it
// (ceil(growHours / 2 / 24) === maxNurtures). Premium defaults ON when the
// toggle helper is absent, same as js/pasture-econ.js. Lives here, not in
// js/render-mounts.js, to keep that file from growing past the 800-line cap.
function getBreedingGrowHours(meta) {
  const premium = (typeof isPremiumEnabled === "function") ? isPremiumEnabled() : true;
  return premium ? meta.growHours / 2 : meta.growHours;
}

// Finish-stage (saddler) materials for one finishing recipe. Source from the same
// zone the breeding row operates in (royal/caerleon/BRZ) so we don't pretend you
// can ferry leather across the realm boundary. The grown mount itself is the
// breeder's output: never rebought. Returns null when the recipe's faction lock
// city cannot be supplied under the table's Buy City pick (no honest row).
// Moved out of breedingRowFor (js/render-mounts.js) for the 800-line cap.
function priceBreedingFinishMats(recipe, ctx) {
  const { item, section, effBuy, marketData, matCitySearch, minVolume } = ctx;
  const out = {
    saddlerMatCost: 0,
    saddlerMatCostFocusOn: 0, // focus-ON cost basis for the Silver/Focus benchmark
    saddlerMatCostNoFocus: 0, // base-RRR cost basis for the fully unfocused twin
    saddlerMatPrices: null, saddlerCity: null,
    saddlerRrr: 0, saddlerRrrFocusOn: 0,
    // Base rate with no focus on the saddler craft. The Crafting List sizes the
    // tail past the focus budget with it (js/craft-list-extractors.js).
    saddlerRrrNoFocus: 0,
    saddlerMatCostNonGathered: 0, hasMissingSaddlerMats: false,
  };
  if (!recipe) return out;
  // Faction Warfare saddled mounts can only be saddled at the matching faction
  // city: overrides any cheapest-mat or section default.
  const lockCity = typeof getFactionLockCity === "function" ? getFactionLockCity(recipe.id) : null;
  const buyPick = typeof mountsPick === "function" ? mountsPick("buy") : null;
  if (lockCity && buyPick && !isValidSourceCity(buyPick, lockCity)) return null;
  out.saddlerCity = lockCity || (section === "caerleon" ? "Caerleon" : effBuy.city);
  // Only honor "Use Focus" if the finished mount is focus-craftable
  // (items.xml craftingfocus > 0), else it would get a phantom focus RRR.
  const focusCostGate = (typeof getFocusCost === "function")
    ? getFocusCost(recipe.id, getTierFromId(recipe.id)) : 0;
  out.saddlerRrr = getCraftRRR(out.saddlerCity, null, isFocusEnabled() && focusCostGate > 0);
  // Focus-ON RRR for the Silver/Focus (nurture) benchmark: must not track the checkbox.
  out.saddlerRrrFocusOn = getCraftRRR(out.saddlerCity, null, focusCostGate > 0);
  out.saddlerRrrNoFocus = getCraftRRR(out.saddlerCity, null, false);
  out.saddlerMatPrices = {};
  recipe.materials.forEach((m) => {
    if (m.matId === item.grownId) {
      out.saddlerMatPrices[m.matId] = { price: 0, city: out.saddlerCity, isProduced: true };
      return;
    }
    const mBounds = getIQRBounds(marketData[m.matId]);
    let bestPrice = Infinity, bestCity = null;
    const forcedBuyCity = getCityForce(m.matId, "buy");
    // Honor a force only within this section's cities so a pin can't apply to a cross-zone row.
    if (forcedBuyCity && matCitySearch.includes(forcedBuyCity)) {
      const p = getBuyPrice(marketData[m.matId], forcedBuyCity, mBounds, m.matId);
      bestCity = forcedBuyCity;
      bestPrice = p > 0 ? p : 0;
      if (p <= 0) out.hasMissingSaddlerMats = true;
    } else {
      matCitySearch.forEach((buyCity) => {
        const p = getBuyPrice(marketData[m.matId], buyCity, mBounds, m.matId);
        const v = marketData[m.matId]?.[buyCity]?.volume_24h || 0;
        if (p > 0 && v >= minVolume && p < bestPrice) { bestPrice = p; bestCity = buyCity; }
      });
      if (!bestCity) out.hasMissingSaddlerMats = true;
    }
    out.saddlerMatPrices[m.matId] = { price: bestCity ? bestPrice : 0, city: bestCity };
    if (bestCity) {
      const elig = isRrrEligible(m.matId);
      out.saddlerMatCost += bestPrice * (elig ? m.count * (1 - out.saddlerRrr) : m.count);
      out.saddlerMatCostFocusOn += bestPrice * (elig ? m.count * (1 - out.saddlerRrrFocusOn) : m.count);
      out.saddlerMatCostNoFocus += bestPrice * (elig ? m.count * (1 - out.saddlerRrrNoFocus) : m.count);
      // Non-gatherable remainder (hearts, other consumed-whole inputs) for the
      // self-gathered twin; RRR-eligible leather is gatherable.
      if (!elig) out.saddlerMatCostNonGathered += bestPrice * m.count;
    }
  });
  return out;
}

// Own-baby sale fields of a breeding row. `best` = findBestSellCity result for the
// baby. babyRaw*: raw sale per FP / Favor, only for FP- or Favor-bought babies.
// babySellVsRaise: instant-sell net vs raising the owned baby one cycle, for
// EVERY scored row (silver babies too); null on an unscored row.
function babySaleFields({ item, marginInfo, effBuyPrice, totalFavorCost, canScoreMargin, best }) {
  const out = {
    babyRawSilverPerFp: 0, babyRawSilverPerFavor: 0, babyRawSellCity: null, babyRawSellPrice: 0,
    babySellVsRaise: null,
  };
  if (!best || !best.city || !(best.price > 0)) return out;
  const babyFp = (typeof getFpCost === "function") ? getFpCost(item.babyId) : 0;
  if (babyFp > 0 || totalFavorCost > 0) {
    out.babyRawSellCity = best.city;
    out.babyRawSellPrice = best.price;
    const netRaw = netSilverAfterFees(best.price, true);
    if (babyFp > 0) out.babyRawSilverPerFp = calculateSilverPerFp(netRaw, babyFp);
    if (totalFavorCost > 0 && typeof calculateSilverPerFavor === "function") {
      out.babyRawSilverPerFavor = calculateSilverPerFavor(netRaw, totalFavorCost);
    }
  }
  if (canScoreMargin && typeof babySellVsRaise === "function") {
    out.babySellVsRaise = {
      ...babySellVsRaise({
        babySellPrice: best.price, instant: true, tax: PREMIUM_TAX, setupFee: SETUP_FEE,
        raiseNet: raiseNetFromRow(marginInfo.profit, effBuyPrice, SETUP_FEE),
      }),
      sellCity: best.city, sellPrice: best.price,
    };
  }
  return out;
}

// Returns the <tr> HTML for one breeding row.
function renderBreedingMountRow(row, rowIdx, rowKey) {
  // Prefer the meta the row was built with — it was priced inside the table's
  // ⚙ Specs scope. The fallback is for callers that assemble a breeding row of
  // their own (js/render-faction-spending.js, the tests).
  const meta = row.meta || getBreedingMeta(row.item);
  const babyName = row.item.babyName || ITEM_NAMES_MAP[row.item.babyId] || getItemDisplayName(row.item.babyId) || tx("Baby", "r_baby");
  const offspringStr = meta.offspringPct != null
    ? `${meta.offspringPct.toFixed(1)}% ${tx("offspring", "r_offspring")}`
    : tx("rare (focus-only)", "r_rare_focus_only");
  const growTitle = tx("Needs {total} nutrition ({pieces}x at {each} ea)", "r_grow_title")
    .replace("{total}", meta.nutritionMax).replace("{pieces}", meta.piecesNeeded).replace("{each}", meta.nutritionPerPiece);
  const metaLine = `<small style="color:#9ca3af" title="${growTitle}">${txFood(meta.foodType)} · ${getBreedingGrowHours(meta)}h ${tx("grow", "r_grow")} · ${offspringStr}</small>`;
  // A fully nurtured common animal passes 100% — that surplus is a real chance
  // at a second baby, so the line prints it rather than clipping to 100.
  const overHundred = meta.maxOffspringPct > 100
    ? ` <span style="color:#7ab8c4" title="${tx("Over 100% — the surplus is a chance at a SECOND baby from the same cycle.", "r_offspring_over_100")}">↑2×</span>`
    : "";
  // The focus figure follows the ⚙ Specs panel (Animal Breeder + the
  // per-animal node), so the qualifier must too: "(max spec)" only at the
  // 100/100 floor (125). At the panel defaults — Breeder 100, specialist 0 —
  // a nurture costs 500, which is a real mid-spec number, never "max".
  const atMaxSpec = meta.focusPerNurture === meta.focusPerNurtureMaxSpec;
  const focusQual = atMaxSpec
    ? tx("focus (max spec)", "r_focus_max_spec")
    : tx("focus (your spec)", "r_focus_your_spec");
  const nurtureLine = meta.maxNurtures > 0
    ? `<small style="color:#9ca3af" title="${tx("{focus} focus per nurture at your ⚙ Specs levels — {max} at 100/100 spec, 1,000 before mastery. Tier changes only the NUMBER of nurtures.", "r_nurture_focus_tip").replace("{focus}", meta.focusPerNurture).replace("{max}", meta.focusPerNurtureMaxSpec)}">${tx("Nurture", "r_nurture")}: ${meta.maxNurtures}× @ ${meta.focusPerNurture.toLocaleString()} ${focusQual} = <b>${meta.totalNurtureFocus.toLocaleString()} ${tx("focus", "r_focus")}</b> ${tx("total", "r_total")} · ${meta.baseOffspringPct.toFixed(1)}% → ${meta.maxOffspringPct.toFixed(1)}% ${tx("offspring", "r_offspring")}${overHundred}</small>`
    : `<small style="color:#6b7280;font-style:italic">${tx("No nurture data", "r_no_nurture_data")}</small>`;
  let feedHtml;
  if (!row.feed) {
    feedHtml = `<small style="color:#6b7280;font-style:italic">${tx("No {food} category", "r_no_food_category").replace("{food}", txFood(meta.foodType).toLowerCase())}</small>`;
  } else {
    const feedName = ITEM_NAMES_MAP[row.feed.id] || getItemDisplayName(row.feed.id) || row.feed.id;
    const feedCity = row.feed.city || row.buyMat.city;
    const feedPriceEl = matPriceSpan(row.feed.id, feedCity, row.feed.price, { foodMode: true });
    const feedDetail = row.feed.hasData
      ? `<small style="color:#9ca3af">${tx("(from {city}; cheapest {food} @ {rate} silver/nutrition; total {total})", "r_feed_detail").replace("{city}", feedCity).replace("{food}", txFood(meta.foodType).toLowerCase()).replace("{rate}", row.feed.silverPerNutrition.toFixed(2)).replace("{total}", formatSilver(row.feedCost))}</small>`
      : `<small style="color:#9ca3af">${tx("(no market data — click price to override)", "r_no_market_data_override")}</small>`;
    feedHtml = `${meta.piecesNeeded}x ${feedName} ${feedPriceEl} ${feedDetail}`;
  }

  // Saddler stage materials (leather + heart fragments). Rendered only when
  // a chain recipe exists; the grown mount input is skipped because the
  // breeder produces it in-house, not from the market.
  let saddlerHtml = "";
  if (row.recipe && row.saddlerMatPrices) {
    const saddlerLines = row.recipe.materials
      .filter((m) => m.matId !== row.item.grownId)
      .map((m) => {
        const name = getItemDisplayName(m.matId) || m.matId;
        const { price, city } = row.saddlerMatPrices[m.matId] || { price: 0, city: row.saddlerCity };
        const eligible = isRrrEligible(m.matId);
        const effectiveCount = eligible ? (m.count * (1 - row.saddlerRrr)).toFixed(1) : m.count.toString();
        const consumedTag = eligible
          ? ` <small style="color:#9ca3af">(~${effectiveCount}x ${tx("consumed", "r_consumed")})</small>`
          : ` <small style="color:#9ca3af">(${tx("no return", "r_no_return")})</small>`;
        const fromTag = city
          ? ` <small style="color:#9ca3af">(${tx("from", "r_from_lower")} ${city})</small>`
          : ` <small style="color:#6b7280;font-style:italic">${tx("(no data — click to override)", "r_no_data_override")}</small>`;
        return `${m.count}x ${name} ${matPriceSpan(m.matId, city || row.saddlerCity, price)}${fromTag}${consumedTag}`;
      });
    if (saddlerLines.length) {
      saddlerHtml = `<br>${saddlerLines.join("<br>")}`;
    }
  }

  let focusMatsHtml;
  if (meta.maxNurtures > 0) {
    const breedingsPer10k = (typeof focusBarCrafts === "function" ? focusBarCrafts(meta.totalNurtureFocus) : Math.floor(10000 / meta.totalNurtureFocus));
    const feedPerBreed = row.feed?.pieces || 0;
    const feedName = row.feed ? (ITEM_NAMES_MAP[row.feed.id] || getItemDisplayName(row.feed.id) || row.feed.id) : meta.foodType;
    const babyRow = `${(typeof formatBarCrafts === "function" ? formatBarCrafts(breedingsPer10k) : breedingsPer10k.toLocaleString())}x ${babyName}`;
    const feedRow = feedPerBreed > 0 ? `<br>${(breedingsPer10k * feedPerBreed).toLocaleString()}x ${feedName}` : "";
    focusMatsHtml = `${babyRow}${feedRow}<br><small style="color:#9ca3af" title="${tx("{n} nurtures × {focus} focus (at your ⚙ spec) to fully nurture each baby", "r_nurtures_tip").replace("{n}", meta.maxNurtures).replace("{focus}", meta.focusPerNurture)}">${(typeof formatBarCrafts === "function" ? formatBarCrafts(breedingsPer10k) : breedingsPer10k.toLocaleString())}x ${tx("nurtured", "r_nurtured")} @ ${meta.maxNurtures}× ${meta.focusPerNurture} = ${meta.totalNurtureFocus.toLocaleString()} ${tx("focus/baby", "r_focus_per_baby")}</small>`;
  } else {
    focusMatsHtml = "—";
  }

  const ppfClass = row.profitPerFocus > 0 ? getProfitClass(row.profitPerFocus * 10) : "profit-negative";
  const offspringValue = Math.max(row.buyMat.price, row.marginInfo.profit || 0);
  const offspringSource = (row.marginInfo.profit || 0) > row.buyMat.price
    ? `${tx("cycle margin", "r_cycle_margin")} ${formatSilver(row.marginInfo.profit)}`
    : `${tx("baby price", "r_baby_price")} ${formatSilver(row.buyMat.price)}`;
  // Two competing plays on a breeding row (nurture vs the saddler craft); the
  // tooltip explains whichever one won. See js/focus-play.js.
  const ppfTitle = row.profitPerFocus > 0
    ? (row.bestFocusPlay && row.bestFocusPlay.kind === "saddler"
        ? tx("Focus the SADDLER craft: {added} of extra leather returned ÷ {focus} focus. Worth more here than nurturing this row's offspring.", "r_ppf_saddler_tip")
            .replace("{added}", formatSilver(row.bestFocusPlay.profitDelta))
            .replace("{focus}", formatFocusCost(row.bestFocusPlay.focusCost))
        : tx("{pct}% extra offspring × {value} ({source}) ÷ {focus} focus", "r_ppf_tip")
            .replace("{pct}", meta.nurtureGainPct.toFixed(2)).replace("{value}", formatSilver(offspringValue))
            .replace("{source}", offspringSource).replace("{focus}", meta.totalNurtureFocus.toLocaleString()))
    : (meta.maxNurtures === 0
        ? tx("No nurture data", "r_no_nurture_data")
        : (offspringValue > 0
            ? tx("Base offspring already at 100%", "r_offspring_maxed")
            : tx("Set baby price or sell price to calculate", "r_set_prices_to_calc")));
  const ppfCell = row.profitPerFocus > 0
    ? `<td class="silver-val ${ppfClass}" title="${ppfTitle}">${row.profitPerFocus.toFixed(2)}</td>`
    : `<td title="${ppfTitle}">—</td>`;

  // Breeding efficiency is denominated per acquisition currency: silver/FP
  // for royal faction babies, silver/Favor for Brecilien owls (bought from
  // Eralia Wayfarer). The mounts columns show whichever applies, suffixed
  // "/Fav" so a Favor ratio is never mistaken for an FP one.
  const isFavorBaby = row.totalFavorCost > 0;
  const breedRatio = isFavorBaby ? row.silverPerFavor : row.silverPerFp;
  const curSuffix = isFavorBaby ? '<small style="color:#9ca3af">/Fav</small>' : "";
  const silverPerFpClass = breedRatio >= 20 ? "profit-high"
                        : breedRatio >= 10 ? "profit-low"
                        : "profit-negative";
  const silverPerFpTitle = isFavorBaby
    ? tx("{profit} silver ÷ {favor} Favor outlay (treats the Favor-purchased baby as silver-free)", "r_silver_per_favor_outlay")
        .replace("{profit}", formatSilver(row.favorAdjustedProfit)).replace("{favor}", row.totalFavorCost.toLocaleString())
    : (row.totalFpCost > 0
        ? tx("{profit} silver ÷ {fp} FP outlay (treats FP-purchased baby + hearts as silver-free)", "r_silver_per_fp_outlay")
            .replace("{profit}", formatSilver(row.fpAdjustedProfit)).replace("{fp}", row.totalFpCost.toLocaleString())
        : tx("Not FP-priced", "r_not_fp_priced"));
  // MP annotation, denominated per acquisition currency (FP or Favor).
  const mpRatio = isFavorBaby ? (row.mpSilverPerFavor || 0) : (row.mpSilverPerFp || 0);
  const mpAnnotation = (mpRatio > 0 && mpRatio > breedRatio)
    ? `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${tx("MP @ {city}: {price} × 0.1% MP chance = +{gain}/cycle", "r_mp_chance_tip").replace("{city}", row.mpSellCity).replace("{price}", formatSilver(row.mpSellPrice)).replace("{gain}", formatSilver(row.mpRevenuePerCycle))}">→ ${mpRatio.toFixed(2)}${curSuffix} ${tx("incl. MP", "r_incl_mp")}</small>`
    : "";
  const silverPerFpCell = breedRatio > 0
    ? `<td class="silver-val ${silverPerFpClass}" title="${silverPerFpTitle}">${breedRatio.toFixed(2)}${curSuffix}${mpAnnotation}</td>`
    : `<td title="${silverPerFpTitle}">—${mpAnnotation}</td>`;

  const rawRatio = isFavorBaby ? row.babyRawSilverPerFavor : row.babyRawSilverPerFp;
  const rawClass = rawRatio >= 20 ? "profit-high"
                 : rawRatio >= 10 ? "profit-low"
                 : "profit-negative";
  const babyAcqCost = isFavorBaby ? row.totalFavorCost : (row.totalFpCost > 0 ? getFpCost(row.item.babyId) : 0);
  const babyAcqCur = isFavorBaby ? "Favor" : "FP";
  const rawTitle = row.babyRawSellCity
    ? `Sell baby at ${row.babyRawSellCity} for ${formatSilver(row.babyRawSellPrice)} silver, divided by ${formatSilver(babyAcqCost)} ${babyAcqCur} for the baby alone (no breeding, no leather, no focus)`
    : "Baby not on market in this zone";
  const babyRawCell = rawRatio > 0
    ? `<td class="silver-val ${rawClass}" title="${rawTitle}">${rawRatio.toFixed(2)}${curSuffix} <small style="color:#9ca3af">@ ${row.babyRawSellCity}</small></td>`
    : `<td title="${rawTitle}">—</td>`;

  // Profit already carries the offspring chance the checkbox allows: the base
  // chance always, the nurture slice only with Use Focus on. So this column has
  // something to add only when focus is OFF — it is what nurturing would make
  // the cycle worth. With focus on the two are equal and it reads "—".
  const totalOffspringPct = meta.baseOffspringPct + meta.nurtureGainPct;
  const nurtureEvCell = (meta.maxNurtures > 0 && row.nurtureEv !== row.marginInfo.profit)
    ? `<td class="silver-val ${getProfitClass(row.marginInfo.margin)}" title="Cycle profit + ${totalOffspringPct.toFixed(1)}% offspring (${meta.baseOffspringPct.toFixed(1)}% base + ${meta.nurtureGainPct.toFixed(1)}% nurtured) × ${formatSilver(offspringValue)} (${offspringSource})">${formatSilver(row.nurtureEv)}</td>`
    : `<td style="color:#6b7280;font-style:italic" title="${
        meta.maxNurtures === 0 ? 'No nurture data' :
        isFocusEnabled() ? 'Use Focus is on — the nurtured offspring is already inside Profit' :
        'Base cycle unprofitable — nurture offers no expected gain'
      }">—</td>`;

  // What the focus ALONE adds over a whole 10k bar: each nurtured baby's extra
  // offspring chance × the babies one bar nurtures. The cycle's own margin
  // needs no focus, so it is not in here (a reported case, 2026-10-07).
  const p10kBreed = row.profitPer10kFocus || 0;
  const barBabies = (typeof focusBarCrafts === "function")
    ? focusBarCrafts(row.focusCost) : Math.floor(10000 / row.focusCost);
  const barBabiesText = (typeof formatBarCrafts === "function")
    ? formatBarCrafts(barBabies) : barBabies.toLocaleString();
  const gainTip = (text, gain) => text
    .replace("{gain}", formatSilver(gain != null ? gain : 0))
    .replace("{pct}", (meta.nurtureGainPct || 0).toFixed(1))
    .replace("{babies}", barBabiesText)
    .replace("{focus}", formatFocusCost(row.focusCost));
  // SELF-FOUND twin of the same bar: with self-bred babies the unfocused cycle
  // an extra offspring is bred into pays more. Dimmed under the bought
  // headline (mpAnnotation pattern); only the valued branch carries it.
  const selfFoundTip = gainTip(tx("Babies self-bred: focus-only gain +{gain} per nurtured baby (+{pct}% offspring) × {babies} babies ({focus} focus ea)", "r_p10k_breed_self_tip"), row.profitFocusGainSelfFound);
  const selfFoundAnnotation = `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${selfFoundTip}">${tx("self-found", "r_p10k_breed_self")} ${formatSilver(row.profitPer10kFocusSelfFound || 0)}</small>`;
  const gatheredTip = gainTip(tx("Babies bought, leather and feed self-gathered: focus-only gain +{gain} per nurtured baby (+{pct}% offspring) × {babies} babies ({focus} focus ea)", "r_p10k_breed_gathered_tip"), row.profitFocusGainGathered);
  const gatheredAnnotation = `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="${gatheredTip}">${tx("gathered", "r_p10k_breed_gathered")} ${formatSilver(row.profitPer10kFocusGathered || 0)}</small>`;
  const p10kBreedTip = gainTip(tx("Extra profit from focus only (after mat costs): +{gain} per nurtured baby (+{pct}% offspring) × {babies} babies ({focus} focus ea)", "r_p10k_breed_tip"), row.profitFocusGain);
  const p10kBreedCell = row.focusCost > 0
    ? `<td class="silver-val ${p10kBreed > 0 ? "profit-low" : "profit-negative"}" title="${p10kBreedTip}">${formatSilver(p10kBreed)}${selfFoundAnnotation}${gatheredAnnotation}</td>`
    : '<td style="color:#6b7280;font-style:italic" title="No nurture data">—</td>';

  // The suffix names the mount this row finishes into (best-paying recipe).
  const titleSuffix = row.recipe
    ? tx("(Breeding → {mount})", "r_breeding_finish").replace("{mount}", dispName(row.recipe.id, row.recipe.name))
    : tx("(Breeding)", "r_breeding");
  // Own baby: instant sale vs raising it one cycle; the winner carries the ▲.
  const bsr = row.babySellVsRaise;
  const babySaleLine = bsr ? (() => {
    const win = (w, text) => (bsr.winner === w
      ? `<b style="color:#5e9e78">${text}</b>` : text);
    const sellTxt = bsr.sellUnpriced ? "—" : `${formatSilver(bsr.sellNet)} (${bsr.sellCity})`;
    const verdict = bsr.sellUnpriced ? "" : ` · ▲ ${bsr.winner === "sell" ? tx("sell", "r_baby_sell_word") : tx("raise", "r_baby_raise_word")} +${formatSilver(bsr.delta)}`;
    return `<br><small style="color:#9ca3af" title="${tx("Baby you already own: sell it now (instant, after tax) vs raise it one cycle (this row's profit plus the baby's purchase price you no longer pay)", "r_baby_sale_tip")}">${tx("Own baby", "r_own_baby")}: ${win("sell", `${tx("sell", "r_baby_sell_word")} ${sellTxt}`)} ${tx("vs", "r_vs")} ${win("raise", `${tx("raise", "r_baby_raise_word")} ${formatSilver(bsr.raiseNet)}`)}${verdict}</small>`;
  })() : "";
  return `
  <tr data-row-key="${rowKey}">
    ${addTdForKey("mounts-table", rowKey)}
    <td class="cell-item">${dispName(row.item.id, row.item.name)} <small style="color:#9ca3af">${titleSuffix}</small></td>
    <td class="cell-route">${tx("Buy", "r_buy")}: ${row.buyMat.city} → ${tx("Sell", "r_sell")}: ${row.sellPot.city}${brecilienFeeBadge(row.brecilienFee)}</td>
    <td class="cell-mats">${babyName} ${matPriceSpan(row.item.babyId, row.buyMat.city, row.buyMat.price)}<br>${feedHtml}${saddlerHtml}<br>${metaLine}<br>${nurtureLine}${babySaleLine}</td>
    <td class="silver-val">${formatSilver(row.totalInputCost)}</td>
    ${priceTd(row.sellPot.price, row.sellItemId, row.sellPot.city)}
    ${profitTd(row.marginInfo, "mounts-table", rowIdx, row.sellPot.city)}
    ${pureProfitTd(row.marginInfo)}
    ${p10kBreedCell}
    ${nurtureEvCell}        <td class="cell-focus-mats">${focusMatsHtml}</td>
    ${ppfCell}
    <td class="cell-note">${focusPlayCell(row.bestFocusPlay)}</td>
    ${silverPerFpCell}
    ${babyRawCell}
  </tr>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderBreedingMountRow, priceBreedingFinishMats, babySaleFields };
}
