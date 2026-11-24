// Fragments burned per meld at the Artifact Foundry.
//   "Any"  = 36 — random artifact across Warrior/Mage/Hunter
//   class  = 50 — random artifact inside the chosen class
//
// Only the four RANDOM families are rolled here. Crystal Shards and Fire Dragon
// Scales are not melded at all: 50 of either buys the artifact you PICK at the
// Energy Manipulator, a deterministic exchange. The Crafting table prices it as
// an ordinary craft (js/data-energy-exchange.js); this table lists it too, as a
// separate "Energy Manipulator exchange" section after the four roll families
// (js/rolling-exchange.js rows, js/render-rolling-exchange.js markup). Those
// rows are never roll types: no meld, roll EV, salvage or transmute sourcing.
const ROLL_COSTS = { Any: 36, Warrior: 50, Mage: 50, Hunter: 50 };
// Salvaging returns 20% of the item's crafting materials (wiki: Artifact
// Foundry § Salvaging). Every artifact's own recipe is 50 fragments, so a
// salvage always hands back 10 — regardless of whether you melded it for 36.
const SALVAGE_RETURN = 10;
// Salvaging does NOT charge silver: it RETURNS a small amount (a fraction of
// the item's itemvalue). The exact current fraction is unpublished, so it is
// modelled as 0 rather than invented — the fragments are the real payout.
// (The old −386 "NPC fee" was both fabricated and the wrong sign.)
const SALVAGE_SILVER = 0;

// Sell-side cost when dumping recovered fragments straight into buy orders:
// sales tax only, no 2.5% setup fee. Reads it live so the header's Premium
// toggle re-prices this table too (4% premium / 8% without). Subtracting
// SETUP_FEE from PREMIUM_TAX no longer works: SETUP_FEE is the BUY leg's fee
// and PREMIUM_TAX carries the SELL leg's, and the two toggles are independent.
function instantSellTax() {
  return typeof marketSalesTax === "function"
    ? marketSalesTax()
    : PREMIUM_TAX - SETUP_FEE;
}
// Net silver from salvaging one rolled artifact.
function artifactSalvageValue(fragBuyPrice) {
  return SALVAGE_RETURN * fragBuyPrice * (1 - instantSellTax()) + SALVAGE_SILVER;
}

/**
 * How one fragment of a meld is obtained over `cities`: bought outright, or a
 * cheaper node bought and transmuted up (js/fragment-transmute-sourcing.js —
 * Soul → Relic, 5× T5 Relic → T6 Relic, …). Without that module loaded it
 * degrades to the straight market buy the table always made, in the same shape.
 */
function rollFragmentSourcing(fragmentId, marketData, cities) {
  if (typeof getFragmentSourcing === "function") {
    return getFragmentSourcing(fragmentId, marketData, cities);
  }
  const best = findBestBuyCity(marketData, fragmentId, cities, 0);
  if (!best.city || !(best.price > 0)) return null;
  return {
    source: "market", perUnit: best.price * (1 + SETUP_FEE),
    marketPerUnit: best.price, feePerUnit: 0,
    buyId: fragmentId, buyCity: best.city, buyPrice: best.price, buyCount: 1,
    steps: [], marketPrice: best.price, marketCity: best.city,
  };
}

/**
 * The Crystallized token that fills this artifact's slot in a gear craft
 * (js/gear-token-substitute.js: Rune→Spirit, Soul→Dread, Relic→Magic,
 * Avalonian→Divinity), when it costs less than the artifact's sale price.
 *
 * This table SELLS the artifact, so the token is weighed against the sale the
 * row prints (`artSellPrice`): a crafter who can buy the token for less will not
 * pay that price. A city listing the artifact itself below the token does not
 * hide the line. Only an artifact with no sale price falls back to its cheapest
 * buy. The token is the cheapest buy over `cities`. Null when there is no token
 * path, either side is unpriced, or the token is not cheaper.
 */
function rollArtifactTokenSubstitute(artId, marketData, cities, artSellPrice) {
  const tokenId = (typeof getArtifactTokenId === "function") ? getArtifactTokenId(artId) : null;
  if (!tokenId) return null;
  const cheapest = (id) => {
    const bounds = getIQRBounds(marketData[id] || {});
    let best = null;
    cities.forEach((c) => {
      const p = getBuyPrice(marketData[id], c, bounds, id);
      if (p > 0 && (!best || p < best.price)) best = { price: p, city: c };
    });
    return best;
  };
  const token = cheapest(tokenId);
  if (!token) return null;
  const art = artSellPrice > 0 ? null : cheapest(artId);
  const artPrice = artSellPrice > 0 ? artSellPrice : (art ? art.price : 0);
  if (!(artPrice > 0) || token.price >= artPrice) return null;
  return { tokenId, city: token.city, price: token.price, artPrice };
}

// What a salvaged fragment is worth: its own market price. A fragment nobody
// lists but a transmute can still produce falls back to that production cost —
// the 10 salvaged units then stand in for 10 you would otherwise produce.
function rollFragmentSalvagePrice(src) {
  if (!src) return 0;
  return src.marketPrice > 0 ? src.marketPrice : src.perUnit;
}

// ── Fragment families ────────────────────────────────────────────────────────
// The Artifact Foundry melds one family of fragments into a random artifact of
// that family. Kept at module scope (rather than inside renderRollingTable) so
// the family tables and the two pure helpers below can be tested directly.
const ROLL_TYPES = ["Rune", "Soul", "Relic", "Avalonian"];
const ROLL_CATEGORIES = ["Any", "Warrior", "Mage", "Hunter"];
// Family → the id stem its fragment uses (prefixed with the tier at use).
const ROLL_FRAGMENT_ID_BY_TYPE = {
  Rune: "RUNE",
  Soul: "SOUL",
  Relic: "RELIC",
  Avalonian: "SHARD_AVALONIAN",
};
const ROLL_FRAGMENT_LABEL = {
  Rune: "Rune",
  Soul: "Soul",
  Relic: "Relic",
  Avalonian: "Avalonian Shard",
};

/**
 * Which class filters the Foundry actually offers for a fragment family.
 *
 * "Any" is the unfiltered 36-fragment meld, and it only means something when
 * the family spans more than one class — there has to be something for the
 * roll to randomise over. A single-class family would otherwise be quoted a
 * play that does not exist, 14 fragments cheaper than the one that does.
 */
function rollCategoriesFor(rollType) {
  const classes = new Set(
    Object.values(ARTIFACT_MAPPING)
      .filter((d) => d.tier === rollType && !d.dropOnly)
      .map((d) => d.category),
  );
  const present = ROLL_CATEGORIES.filter((c) => c !== "Any" && classes.has(c));
  return present.length > 1 ? ["Any", ...present] : present;
}

/** Fragments burned by one meld of `rollType` under the `cat` class filter. */
function rollCostFor(rollType, cat) {
  return ROLL_COSTS[cat];
}

function getArtifactShortName(suffix) {
  const info = ARTIFACT_MAPPING[suffix];
  if (info && info.name) return info.name;
  const parts = suffix.split("_");
  const prefixes = ["OFF", "HEAD", "ARMOR", "SHOES", "MAIN", "BAG", "2H"];
  while (parts.length > 0 && prefixes.includes(parts[0])) parts.shift();
  return parts.map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(" ");
}

/** Fragment type ("Rune", "Soul") and class filter ("Any", "Mage") labels. */
function txRollLabel(label) {
  if (typeof tx !== "function" || !label) return label;
  return tx(label, "roll_" + String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_"));
}

/**
 * The cities one leg may use under the table's Buy / Sell City pick
 * (js/table-sell-city.js). A pick re-prices the table rather than filtering it:
 * every fragment is bought, and every artifact sold, at the pick. A pick outside
 * `allCities` returns [] and the caller drops that section. No pick, or no
 * module loaded, returns `allCities` unchanged.
 */
function rollingPickCities(side, allCities) {
  return typeof effectiveFlipCities === "function"
    ? effectiveFlipCities("rolling-table", side, allCities)
    : allCities;
}

function renderRollingTable(marketData) {
  const tiers = [4, 5, 6, 7, 8];
  const rollTypes = ROLL_TYPES;
  const fragmentMap = ROLL_FRAGMENT_ID_BY_TYPE;
  const fragmentLabels = ROLL_FRAGMENT_LABEL;

  const rows = [];

  const sections = isBlackRedZoneEnabled()
    ? [{ name: undefined, buyCities: CITIES, sellCities: SELL_CITIES }]
    : [
        { name: "royal", buyCities: ROYAL_CITIES, sellCities: ROYAL_CITIES },
        {
          name: "caerleon",
          buyCities: ["Caerleon"],
          sellCities: ["Caerleon", "Black Market"],
        },
      ];

  sections.forEach(({ name: sectionName, buyCities: sectionBuy, sellCities: sectionSell }) => {
    // A City pick prices the whole section at that city; a section that cannot
    // trade there has no honest row to build.
    const buyCities = rollingPickCities("buy", sectionBuy);
    const sellCities = rollingPickCities("sell", sectionSell);
    if (buyCities.length === 0 || sellCities.length === 0) return;
    // Rolled families first; the exchange rows are appended after them below.
    tiers.forEach((tier) => {
      rollTypes.forEach((rollType) => {
        const fragmentId = `T${tier}_${fragmentMap[rollType]}`;
        const fragLabel = fragmentLabels[rollType];

        // Cheapest way to OBTAIN the fragment: buy it, or transmute a cheaper
        // node up (no volume gate — artifacts are niche). Null = nothing priced;
        // rows are still generated so the user can set an override.
        const fragSrc = rollFragmentSourcing(fragmentId, marketData, buyCities);

        // One row per category × artifact
        const effectiveCategories = rollCategoriesFor(rollType);
        effectiveCategories.forEach((cat) => {
          const rollCost = rollCostFor(rollType, cat);

          Object.entries(ARTIFACT_MAPPING).forEach(([suffix, data]) => {
            if (
              data.tier !== rollType ||
              data.dropOnly ||
              (cat !== "Any" && data.category !== cat)
            )
              return;

            const artId = `T${tier}_ARTEFACT_${suffix}`;

            // Best sell city for this artifact (highest sell order price)
            // Skip IQR outlier detection — artifact sell prices are often far
            // above fragment buy prices, which skews the bounds and rejects
            // legitimate sell orders.
            let bestSellCity = null;
            let bestSellPrice = 0;
            const forcedArtSellCity = getCityForce(artId, "sell");
            // Only honor a forced sell city that belongs to THIS section's
            // sellCities — otherwise a force set in the royal section bleeds into
            // the Caerleon section and back. Mirrors findBestSellCity's guard.
            if (
              forcedArtSellCity &&
              sellCities.includes(forcedArtSellCity) &&
              getOverridePrice(artId, forcedArtSellCity) !== null
            ) {
              const p = getSellPrice(marketData[artId], forcedArtSellCity, null, artId);
              bestSellCity = forcedArtSellCity;
              bestSellPrice = p > 0 ? p : 0;
            } else {
              // Price the sale the way the Pricing Model says you would make
              // it (getSellPrice: the bid under Instant, your own listing under
              // Market Orders). A missing field is 0 — the row then reads "no
              // data" and can be hand-priced, rather than quietly quoting the
              // other side of the book.
              sellCities.forEach((city) => {
                const ov = getOverridePrice(artId, city, "sell");
                const d = marketData[artId]?.[city];
                if (!d && ov === null) return;
                const p = getSellPrice(marketData[artId], city, null, artId);
                if (p > bestSellPrice) {
                  bestSellPrice = p;
                  bestSellCity = city;
                }
              });
            }

            const noArtData = bestSellPrice === 0;

            // If the cheapest fragment source is bought in a city that cannot
            // reach bestSellCity, re-source over the valid cities only (only when
            // the user has an override for this sell city).
            let src = fragSrc;
            if (
              src &&
              bestSellCity !== null &&
              isInvalidCrossRoute(src.buyCity, bestSellCity)
            ) {
              if (!priceOverrides[artId]?.[bestSellCity]) return; // no override, drop as before
              const validCities = rollingPickCities("buy", CITIES)
                .filter((city) => !isInvalidCrossRoute(city, bestSellCity));
              src = rollFragmentSourcing(fragmentId, marketData, validCities);
              if (!src) return; // no valid buy city has market data
            }

            const hasNoFragData = !src;
            const effectiveFragBuyCity = src ? src.buyCity : null;
            const effectiveFragBuyPrice = src ? src.buyPrice : 0;
            // Market silver pays the buy-order setup fee; transmute silver and
            // its station fee do not.
            const effectiveRollCostSilver = hasNoFragData
              ? 0
              : rollCost * src.marketPerUnit * (1 + SETUP_FEE) + rollCost * src.feePerUnit;
            const fragSalvagePrice = rollFragmentSalvagePrice(src);
            const effectiveSalvageRevenue = hasNoFragData
              ? 0
              : artifactSalvageValue(fragSalvagePrice);
            const sellRevenue = bestSellPrice * (1 - PREMIUM_TAX); // sales tax + setup fee
            const action = hasNoFragData
              ? "SELL"
              : sellRevenue >= effectiveSalvageRevenue
                ? "SELL"
                : "REROLL";
            const margin = hasNoFragData
              ? null
              : effectiveRollCostSilver > 0
                ? ((sellRevenue - effectiveRollCostSilver) /
                    effectiveRollCostSilver) *
                  100
                : -999;

            rows.push({
              // updateTableDisplay uses marginInfo.margin for filtering
              marginInfo: {
                margin: hasNoFragData ? -1 : margin,
              },
              hasOverride: !!(
                priceOverrides[artId]?.[bestSellCity] ||
                priceOverrides[src ? src.buyId : fragmentId]?.[effectiveFragBuyCity]
              ),
              hasNoFragData,
              hasNoArtData: noArtData,
              tier,
              cat,
              rollType,
              artName: getArtifactShortName(suffix),
              artId,
              fragmentId,
              fragLabel,
              // The node actually BOUGHT — the fragment itself, or the cheaper
              // node a transmute starts from. fragSourcing carries the route.
              fragBuyId: src ? src.buyId : fragmentId,
              fragBuyCity: effectiveFragBuyCity,
              fragBuyPrice: effectiveFragBuyPrice,
              fragSalvagePrice,
              fragSourcing: src,
              // A cheaper Crystallized token crafters can use instead of this artifact.
              tokenSub: rollArtifactTokenSubstitute(artId, marketData, buyCities, bestSellPrice),
              rollCost,
              rollCostSilver: effectiveRollCostSilver,
              bestSellCity: bestSellCity || sellCities[0],
              bestSellPrice,
              sellRevenue,
              action,
              margin: margin ?? -999,
              section: sectionName,
            });
          });
        });
      });
    });
    // Deterministic Energy Manipulator exchange, over the same section cities.
    if (typeof rollingExchangeRows === "function") {
      rows.push(...rollingExchangeRows(marketData, buyCities, sellCities, sectionName));
    }
  }); // end sections.forEach

  // Sort: category first, then tier, then rollType, then margin desc
  // The exchange section sorts after every roll family (its own category).
  const rollTypeOrder = [...ROLL_TYPES, "Crystal", "Dragon"];
  const catOrder = [...ROLL_CATEGORIES, "Exchange"];
  rows.sort((a, b) => {
    const co = catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat);
    if (co !== 0) return co;
    // One exchange group: margin only, the tier is printed on each row.
    if (a.exchange && b.exchange) return b.margin - a.margin;
    if (a.tier !== b.tier) return a.tier - b.tier;
    const ro =
      rollTypeOrder.indexOf(a.rollType) - rollTypeOrder.indexOf(b.rollType);
    if (ro !== 0) return ro;
    return b.margin - a.margin;
  });

  // Whole-campaign economics per roll group, for the group header.
  const groupEconMap = new Map();

  // ── Optimal-stopping strategy advice per group ───────────────────────────
  // For each (cat, tier, rollType) group, compute T* = optimal sell threshold.
  // T* satisfies: T* = (1/N)*SUM[max(v_i, T*)] - netRerollCost
  // If T* <= best artifact value AND some artifacts beat the threshold:
  //   → "Hunt only" (only keep artifacts above T*)
  // If T* <= 0 or all artifacts are above T* (keep everything):
  //   → "Keep any profitable"
  // solveOptimalThreshold / classifyRollGroup / decideRowAction /
  // rollCampaignEconomics live in js/rolling-strategy.js (loaded before this
  // file) so they can be unit-tested.

  const groupStrategy = new Map(); // key: `${section}:${cat}:T${tier} ${rollType}`
  // Group rows by (section, cat, tier, rollType).
  // Artifacts with NO sell data stay IN the pool at zero revenue: a meld can
  // still roll them, and pretending they can't be rolled inflates the expected
  // value of every group (the pool used to shrink to just the liquid jackpots).
  const groupMap = new Map();
  rows.forEach((row) => {
    if (row.exchange) return; // a deterministic pick: no roll campaign to price
    if (row.hasNoFragData) return; // no fragment price ⇒ no cost basis at all
    const key = `${row.section ?? ""}:${row.cat}:T${row.tier} ${row.rollType}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(row);
  });

  groupMap.forEach((groupRows, key) => {
    const rep = groupRows[0];
    const salvageValue = artifactSalvageValue(rep.fragSalvagePrice);
    const sellRevenues = groupRows.map((r) => (r.hasNoArtData ? 0 : r.sellRevenue));
    const econ = rollCampaignEconomics(
      sellRevenues,
      rep.rollCostSilver,
      salvageValue,
      rep.rollCost,
      SALVAGE_RETURN,
    );
    const { type, Tstar } = econ;
    groupEconMap.set(key, econ);

    const label =
      type === "keep-any"
        ? tx("\u2713 Sell or salvage \u2014 no reroll", "r_sell_salvage_no_reroll")
        : type === "unprofitable"
          ? tx("\u2717 Don't roll \u2014 unprofitable", "r_dont_roll_unprofitable")
          : tx("\u2191 Hunt mode", "r_hunt_mode");
    groupStrategy.set(key, { type, label, Tstar });
  });

  // Badge helper — called live inside formatter so price overrides are always reflected
  // Live per-row strategy decision (re-read each render so price overrides apply).
  // Returns { strat, action, liveSellRev, salvageValue } or null.
  function liveRowAction(row) {
    if (row.hasNoFragData || row.hasNoArtData) return null;
    const strat = groupStrategy.get(
      `${row.section ?? ""}:${row.cat}:T${row.tier} ${row.rollType}`,
    );
    if (!strat) return null;
    const liveSellPrice =
      priceOverrides[row.artId]?.[row.bestSellCity]?.price || row.bestSellPrice;
    const liveSellRev = liveSellPrice * (1 - PREMIUM_TAX);
    const salvageValue = artifactSalvageValue(row.fragSalvagePrice);
    const action = decideRowAction(
      strat.type, strat.Tstar, liveSellRev, salvageValue,
    );
    return { strat, action, liveSellRev, salvageValue };
  }

  function makeStrategyBadge(row) {
    const info = liveRowAction(row);
    if (!info) return "";
    const { action, strat, liveSellRev, salvageValue } = info;
    const rev = formatSilver(Math.round(liveSellRev));
    const sv = formatSilver(Math.round(salvageValue));
    const tStr = formatSilver(Math.round(strat.Tstar));
    const badge = (bg, label, tip) =>
      `<span style="background:${bg};color:rgba(255,255,255,0.85);padding:1px 6px;border-radius:3px;font-size:0.68rem;font-weight:600;margin-left:5px;cursor:help" title="${tip}">${label}</span>`;
    if (action === "sell") {
      const tip =
        strat.type === "hunt"
          ? tx("KEEP &amp; SELL: revenue {rev} beats the reroll threshold {threshold}. Sell this one.", "r_tip_keep_sell")
              .replace("{rev}", rev).replace("{threshold}", tStr)
          : tx("SELL: revenue {rev} &gt; salvage {salvage}. Selling beats salvaging.", "r_tip_sell_beats_salvage")
              .replace("{rev}", rev).replace("{salvage}", sv);
      return badge("#3d6e50", tx("\u2713 sell", "r_sell_badge"), tip);
    }
    if (action === "reroll") {
      return badge(
        "#7a5e2a",
        tx("\u21a9 reroll", "r_reroll_badge"),
        tx("REROLL: revenue {rev} is below the hunt threshold {threshold}. Salvage and roll again.", "r_tip_reroll")
          .replace("{rev}", rev).replace("{threshold}", tStr),
      );
    }
    if (action === "salvage") {
      return badge(
        "#3e5e82",
        tx("\u267B salvage", "r_salvage_badge"),
        tx("SALVAGE: revenue {rev} &lt; salvage {salvage}. Break it for fragments and sell those \u2014 don't reroll, rolling isn't +EV here.", "r_tip_salvage")
          .replace("{rev}", rev).replace("{salvage}", sv),
      );
    }
    // skip (unprofitable)
    return badge(
      "#44474e",
      tx("\u2298 skip", "r_skip_badge"),
      tx("Rolling is unprofitable at current prices. Don't roll; if you already hold stock, sell the highest-value artifact.", "r_rolling_unprofitable"),
    );
  }

  // Stateful two-level group-header formatter using closure
  let _lastCat = null;
  let _lastRollGroup = null;
  const formatter = (row, rowIdx) => {
    if (row.exchange) {
      const head = rollingExchangeHeadersHtml(row, _lastCat, _lastRollGroup);
      _lastCat = head.cat;
      _lastRollGroup = head.group;
      return head.html + rollingExchangeRowHtml(row, rowIdx);
    }
    const {
      tier,
      cat,
      rollType,
      artName,
      artId,
      fragmentId,
      fragLabel,
      fragBuyCity,
      fragBuyPrice,
      fragSourcing,
      rollCost,
      rollCostSilver,
      bestSellCity,
      bestSellPrice,
      sellRevenue,
      margin,
      hasNoFragData,
      hasNoArtData,
    } = row;

    const rollGroup = `T${tier} ${rollType}`;
    let groupHeader = "";
    // Outer header: category
    if (cat !== _lastCat) {
      _lastCat = cat;
      _lastRollGroup = null;
      const catColor =
        cat === "Any"
          ? "#4b4e82"
          : cat === "Warrior"
            ? "#7a3e3e"
            : cat === "Mage"
              ? "#3e5e82"
              : "#2e6648";
      groupHeader += `<tr data-header-cat="${cat}" style="background:${catColor};color:rgba(255,255,255,0.85);font-weight:700;cursor:pointer;user-select:none">
        <td colspan="8" style="padding:9px 12px;font-size:0.95rem;letter-spacing:0.06em" title="${
          cat === "Any"
            ? tx("Meld with no class filter: 36 fragments per roll, any Warrior, Mage or Hunter artifact of that type.", "r_tip_meld_any")
            : tx("Meld filtered to {cat} artifacts: 50 fragments per roll. You pay 14 extra fragments to shrink the pool to {cat}-only outcomes.", "r_tip_meld_class")
                .split("{cat}").join(txRollLabel(cat))
        }">◆ ${txRollLabel(cat)} ${tx("Artifacts", "r_artifacts")}<span class="cind"> ▼</span></td>
      </tr>`;
    }
    // Inner header: tier + roll type
    if (rollGroup !== _lastRollGroup) {
      _lastRollGroup = rollGroup;
      // Key MUST include section — groupStrategy/margin/profit maps are all
      // section-keyed. Without it the strategy label (Hunt mode / etc.) silently
      // never renders in the header.
      const groupKey = `${row.section ?? ""}:${cat}:${rollGroup}`;
      const strat = groupStrategy.get(groupKey);
      const stratBadgeColor = !strat
        ? "#44474e"
        : strat.type === "keep-any"
          ? "#3d6e50"
          : strat.type === "hunt"
            ? "#7a5e2a"
            : "#4e5158";
      const stratBadge = strat
        ? ` <span style="background:${stratBadgeColor};color:rgba(255,255,255,0.85);padding:1px 7px;border-radius:3px;font-size:0.72rem;font-weight:600;margin-left:8px">${strat.label}</span>`
        : "";
      // Group header numbers describe the WHOLE campaign (roll → maybe reroll →
      // cash out), normalized by the silver/fragments that campaign is expected
      // to burn — not by the first roll alone.
      const econ = groupEconMap.get(groupKey);
      const stratMargin = econ ? econ.marginPct : null;
      const rollsStr = econ ? econ.expectedRolls.toFixed(1) : "";
      const fragsStr = econ ? Math.round(econ.expectedFragments) : "";
      const campaignTip = econ
        ? `Expected result of ONE campaign: buy ${row.rollCost} ${fragLabel}, meld, then follow the badge advice until you cash out.\n` +
          `Expected rolls: ${rollsStr} (${(econ.sellChance * 100).toFixed(0)}% of melds are worth keeping)\n` +
          `Expected fragments burned: ${fragsStr} (each reroll salvages 10 back, so it nets ${Math.max(0, row.rollCost - SALVAGE_RETURN)})\n` +
          `Expected silver in: ${formatSilver(Math.round(econ.expectedCost))}\n` +
          `Expected profit: ${formatSilver(Math.round(econ.profitPerCampaign))}\n` +
          `Assumes every artifact in the pool is equally likely; artifacts with no sell orders count as worth 0.`
        : "";
      const marginCell = stratMargin != null
        ? `<td class="${getProfitClass(stratMargin)}" style="font-size:0.82rem;text-align:right;cursor:help" title="${tx("Expected profit ÷ expected silver spent over the whole campaign ({rolls} rolls on average, not one). This is the honest return on the fragments you commit.", "r_tip_campaign_margin").replace("{rolls}", rollsStr)}&#10;&#10;${campaignTip.replace(/\n/g, "&#10;")}">${stratMargin.toFixed(1)}%</td>`
        : `<td></td>`;
      const profitCell = econ != null
        ? `<td class="silver-val ${getProfitClass(stratMargin)}" style="font-size:0.82rem;cursor:help" title="${tx("Silver each {frag} is worth ON TOP of its market price if melded instead of sold — campaign profit ÷ the {frags} fragments it burns.", "r_tip_profit_per_fragment").replace("{frag}", fragLabel).replace("{frags}", fragsStr)}&#10;&#10;${campaignTip.replace(/\n/g, "&#10;")}">${formatSilver(Math.round(econ.profitPerFragment))}<small style="color:#9ca3af"> /frag</small></td>`
        : `<td></td>`;
      groupHeader += `<tr data-header-roll="${rollGroup}" data-roll-cat="${cat}" style="background:#1c2230;color:#6e90a8;font-weight:600;cursor:pointer;user-select:none">
        <td colspan="5" style="padding:5px 10px 5px 22px;font-size:0.82rem;letter-spacing:0.04em" title="${row.rollCost} ${fragLabel} ${tx("per meld", "r_per_meld")}${econ ? ` · ${tx("{rolls} rolls / {frags} fragments expected per keeper", "r_rolls_per_keeper").replace("{rolls}", rollsStr).replace("{frags}", fragsStr)}` : ""}">— ${rollGroup} —<small style="color:#8b98a8"> (${row.rollCost} frags/roll)</small>${stratBadge}<span class="cind"> ▼</span></td>
        ${marginCell}
        ${profitCell}
        <td></td>
      </tr>`;
    }

    const effectiveFragCity = fragBuyCity || CITIES[0];
    // The cell prices and edits the node actually bought: the fragment itself,
    // or the cheaper node a transmute starts from.
    const fragBuyId = row.fragBuyId || fragmentId;
    const viaTransmute = !!(fragSourcing && fragSourcing.source === "transmute");
    const fragOverride = getOverridePrice(fragBuyId, effectiveFragCity);
    const fragEditStyle = fragOverride
      ? "color:#9e8840;"
      : hasNoFragData
        ? "color:#6b7280;font-style:italic;"
        : "";
    const fragEditIndicator = fragOverride
      ? ' <span style="color:#9e8840;font-size:0.75rem" title="Price overridden">⚡</span>'
      : "";

    const catBadgeColor =
      cat === "Any"
        ? "#4b4e82"
        : cat === "Warrior"
          ? "#7a3e3e"
          : cat === "Mage"
            ? "#3e5e82"
            : "#2e6648";
    const catBadge = `<span style="background:${catBadgeColor};color:rgba(255,255,255,0.85);padding:1px 5px;border-radius:3px;font-size:0.72rem">${txRollLabel(cat)}</span>`;

    // No sell city means nothing has been listed anywhere — which is exactly
    // when the user wants to type the price in. Fall back to a placeholder city
    // the way the fragment cell above already does (effectiveFragCity), so the
    // cell stays click-to-edit instead of going dead.
    const effectiveArtSellCity = bestSellCity
      || (typeof SELL_CITIES !== "undefined" && SELL_CITIES[0])
      || CITIES[0];
    const sellRouteHtml = priceTd(bestSellPrice, artId, effectiveArtSellCity);

    const rowKey = getRowKey(row, "rolling-table");
    return (
      groupHeader +
      `
    <tr data-cat="${cat}" data-roll-key="${cat}:${rollGroup}" data-row-key="${rowKey}">
      ${addTdForKey("rolling-table", rowKey)}
      <td class="cell-item">${catBadge} <small style="color:#e5e7eb">${artName}</small>${makeStrategyBadge(row)}${
        typeof artifactTokenPathLine === "function" ? artifactTokenPathLine(row.tokenSub, artName) : ""
      }</td>
      <td class="silver-val price-editable" data-item-id="${fragBuyId}" data-city="${effectiveFragCity}" data-raw-price="${fragBuyPrice}" data-city-list="buy" style="cursor:pointer;${fragEditStyle}" title="${tx("Click to override", "r_tip_click_override")}">${
        hasNoFragData
          ? `<span style="color:#6b7280;font-style:italic">${tx("no data — click to set", "r_no_data_click_to_set")}</span>`
          : (() => {
              // The fragment is BOUGHT, so its date follows the buy field the
              // Pricing Model reads: the ask under Instant, the bid under
              // Market Orders (js/price-freshness.js). Hard-coding buy_date
              // was right in one mode only.
              const _fragEntry = lastMarketData?.[fragBuyId]?.[effectiveFragCity];
              const _fragDateStr = typeof priceDateFor === "function"
                ? priceDateFor(_fragEntry, "buy")
                : _fragEntry?.buy_date;
              const _fragAge = formatPriceAge(_fragDateStr);
              const _fragVol = _fragEntry?.volume_24h;
              const _fragVolStr =
                _fragVol > 0 ? ` · ${_fragVol.toLocaleString()} vol` : "";
              const _fragAgeBadge = _fragAge
                ? ` <small style="color:${_fragAge.color};font-size:0.7rem" title="Price last seen: ${_fragDateStr}">${_fragAge.label}${_fragVolStr}</small>`
                : "";
              // A transmute buys a different node, in a different count: say
              // what goes in the basket, not the fragment the meld consumes.
              const buyWhat = viaTransmute
                ? `${rollCost * fragSourcing.buyCount}× ${getItemDisplayName(fragBuyId)}`
                : `${rollCost}× ${fragLabel}`;
              const pathLine = typeof rollingFragmentPathLine === "function"
                ? rollingFragmentPathLine(fragSourcing, fragmentId, rollCost) : "";
              return `${formatSilver(fragBuyPrice)}${fragEditIndicator}${_fragAgeBadge} <small style="color:#9ca3af">(${buyWhat} — ${fragBuyCity})</small>${pathLine}`;
            })()
      }</td>
      <td class="silver-val" title="${
        viaTransmute
          ? tx("{count} × {frag} @ {unit} all-in = one meld, made from {buy} transmuted up. {fee}% setup fee on the bought part only; salvage returns 10.", "r_tip_roll_cost_transmute")
              .replace("{count}", rollCost).replace("{frag}", fragLabel)
              .replace("{unit}", formatSilver(Math.round(fragSourcing.perUnit)))
              .replace("{buy}", getItemDisplayName(fragBuyId))
              .replace("{fee}", (SETUP_FEE * 100).toFixed(1))
          : tx("{count} × {frag} @ {price} + {fee}% buy-order setup fee = one meld. Rolling again costs this much again, minus the 10 fragments you salvage back.", "r_tip_roll_cost").replace("{count}", rollCost).replace("{frag}", fragLabel).replace("{price}", formatSilver(fragBuyPrice)).replace("{fee}", (SETUP_FEE * 100).toFixed(1))
      }">${hasNoFragData ? "—" : formatSilver(rollCostSilver)}</td>
      ${sellRouteHtml}
      ${!hasNoFragData && !hasNoArtData ? profitTd({ margin }, "rolling-table", rowIdx, bestSellCity) : `<td>—</td>`}
      ${
        !hasNoFragData && !hasNoArtData
          ? `<td class="silver-val ${getProfitClass(margin)}" title="IF this exact artifact comes out of the meld: net sale ${formatSilver(Math.round(sellRevenue))} − roll cost ${formatSilver(Math.round(rollCostSilver))}. It is a single-outcome payout, NOT an expected value — the meld is random, so weigh it against the group header's per-fragment figure.">${formatSilver(sellRevenue - rollCostSilver)}</td>`
          : `<td>—</td>`
      }
      <td>${(() => {
        const a = liveRowAction(row);
        return a && a.action === "sell" && bestSellCity
          ? `<small style="color:#9ca3af">→ ${bestSellCity}</small>`
          : "";
      })()}</td>
    </tr>`
    );
  };

  // Reset group tracker before each render (updateTableDisplay re-calls formatter each time)
  tableState["rolling-table"]._resetGroup = () => {
    _lastCat = null;
    _lastRollGroup = null;
  };
  renderTableData("rolling-table", rows, (row, rowIdx) => {
    return formatter(row, rowIdx);
  });
}

