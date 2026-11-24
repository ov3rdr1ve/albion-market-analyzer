/**
 * Energy Manipulator (Favor) rows for the Faction Spending table.
 *
 * These are the silver-per-Favor counterparts to the silver-per-FP faction
 * rows. Favor is spent at the Energy Manipulator (Mattina, in every Royal City
 * + Caerleon) on:
 *   - Conqueror's Chest (fixed 6,750 Favor → overrideable expected silver yield,
 *     modelled exactly like the faction Iron Chest).
 *   - Siphoned Energy (150 Favor / Energy) → Runes / Souls / Relics, sold direct.
 *   - Avalonian Shards (flat Favor) and Crests (Avalonian via Mattina, Smuggler
 *     via Maggy Slade / Shadow Hand) — tradable, sold direct for silver/Favor.
 *   - Elder's Tome of Insight — a non-tradable fame book valued fame-per-Favor
 *     (metric:"fame"), the one row that reports fame rather than silver.
 *   - Siphoned Energy → the four exclusive combat mounts (sold after netting the
 *     base mount + fixed mats bought off the market; the energy itself is
 *     costed only in the all-in pureProfitSilver the Top-10 board ranks by).
 *
 * Row shape mirrors buildFactionSpendRow (see render-faction-spending.js) so the
 * shared renderer can lay both currencies in one table. Favor rows always carry
 * fpCost:0 / silverPerFp:0 (render "—" in the FP columns) and the FP rows carry
 * favorCost:0 / silverPerFavor:0 (render "—" in the Favor columns).
 *
 * Data + pure math live in js/data-favor-costs.js.
 */

// Best display name for a Favor item, preferring the localized map.
function _favorRowName(itemId, fallback) {
  if (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[itemId]) return ITEM_NAMES_MAP[itemId];
  if (typeof getItemDisplayName === "function") return getItemDisplayName(itemId);
  return fallback || itemId;
}

// Cheapest acquisition cost for a mount input across every city, priced the
// way the Pricing Model says you would acquire it: the ask under Instant, your
// own buy order under Market Orders (getBuyPrice). A high-value base mount
// (e.g. Elder's Transport Mammoth ~220M) often has sell listings but no buy
// orders, so under Market Orders it prices at 0 — the caller's inputsKnown
// guard then renders "—" instead of an inflated net, rather than the cost
// silently vanishing. Honours per-item overrides so inputs can be hand-priced.
//
// Returns { price, city }. Crucially, overrides are consulted even when the
// item has NO market data at all (thinly-traded base mounts often return zero
// rows from the API, so marketData[id] is undefined) — otherwise a user-set
// override for such a mount would be silently ignored and its cost would keep
// vanishing from the net.
function _favorCheapestBuyCity(marketData, itemId) {
  const cities = (typeof CITIES !== "undefined") ? CITIES : [];
  const data = (marketData && marketData[itemId]) || null;
  let bestPrice = 0, bestCity = "";
  cities.forEach((c) => {
    const ov = (typeof getOverridePrice === "function") ? getOverridePrice(itemId, c) : null;
    const p = (ov !== null && ov > 0) ? ov : (data ? getBuyPrice(data, c, null, itemId) : 0);
    if (p > 0 && (bestPrice === 0 || p < bestPrice)) { bestPrice = p; bestCity = c; }
  });
  return { price: bestPrice, city: bestCity };
}

// Read the Conqueror's Chest yield override from whichever city it was set at.
// The chest is bought from the Energy Manipulator (present in every city), so
// its expected-silver yield isn't city-specific — the user may set it wherever
// they play. Scans all cities and returns the first override found.
function _chestYieldOverrideAnyCity(id) {
  if (typeof getOverridePrice !== "function") return null;
  const cities = (typeof SELL_CITIES !== "undefined") ? SELL_CITIES
    : (typeof CITIES !== "undefined") ? CITIES : [];
  for (const c of cities) {
    const o = getOverridePrice(id, c);
    if (o !== null && o > 0) return o;
  }
  return null;
}

function _baseFavorRow(itemId, name, category, favorCost) {
  return {
    itemId,
    name,
    category,
    currency: "Favor",
    // Faction-Spending dropdown group. Most Favor rows are the Energy
    // Manipulator's stock; crest/baby sections override to their own vendor.
    favorFaction: "Energy Manipulator",
    sellCity: "",
    sellPrice: 0,
    netSilver: 0,
    fpCost: 0,
    silverPerFp: 0,
    favorCost,
    silverPerFavor: 0,
    // metric distinguishes silver-valued rows from the fame-valued Tome rows.
    // "silver" (default) → silverPerFavor is the efficiency; "fame" → famePerFavor.
    metric: "silver",
    fameValue: 0,
    famePerFavor: 0,
    breedSilverPerFp: 0,
    breedSilverPerFavor: 0,
    breedData: null,
    dailyVol: 0,
    note: "",
    tradeable: true,
  };
}

function buildFavorSpendingRows(marketData) {
  if (!marketData) return [];
  const rows = [];
  const cities = (typeof CITIES !== "undefined") ? CITIES : [];

  // Favor purchases are sold at the Energy Manipulator (and the crest/mount
  // NPCs), which stand in every Royal City AND Caerleon, so there's no single
  // source faction. When "Include Caerleon" (Black/Red Zone Routes) is OFF the
  // user is assumed to operate out of a Royal city, so we anchor the sell-city
  // search to a royal origin: this blocks the Royal↔Caerleon hop exactly like
  // the FP rows (see render-faction-spending.js buildFactionSpendRow), while
  // leaving Caerleon reachable once the toggle is enabled. The specific royal
  // city is irrelevant — isInvalidCrossRoute only distinguishes royal vs Caerleon.
  const routeOrigin = (typeof ROYAL_CITIES !== "undefined" && ROYAL_CITIES[0]) || "Thetford";

  // ── 1. Conqueror's Chest — fixed 6,750 Favor → expected silver yield ────────
  {
    const id = CONQUEROR_CHEST_ID;
    // The Energy Manipulator stands in every city, so the chest isn't tied to
    // one — read the yield override from whichever city the user set it at.
    const ov = _chestYieldOverrideAnyCity(id);
    const yieldSilver = (ov !== null && ov > 0) ? ov : DEFAULT_CONQUEROR_CHEST_YIELD;
    const row = _baseFavorRow(id, "Conqueror's Chest", "Conqueror Chest", CONQUEROR_CHEST_FAVOR);
    row.sellCity = "Caerleon"; // dropdown default only; override read from any city
    row.sellPrice = yieldSilver;
    row.netSilver = yieldSilver; // already-liquidated silver, no market fees
    row.silverPerFavor = calculateSilverPerFavor(yieldSilver, CONQUEROR_CHEST_FAVOR);
    row.tradeable = false;
    row.note = tx("Loot chest — click the yield to set/override expected silver", "r_note_loot_chest");
    rows.push(row);
  }

  // ── 1b. Siphoned Energy — buy 1 for 150 Favor, resell raw ───────────────────
  {
    const id = SIPHONED_ENERGY_ID;
    const best = findBestSellCity(marketData, id, cities, 0, routeOrigin, null);
    const gross = (best.city && best.price > 0) ? best.price : 0;
    const netSilver = netSilverAfterFees(gross, true);
    const row = _baseFavorRow(id, _favorRowName(id, "Siphoned Energy"), "Siphoned Energy", FAVOR_PER_ENERGY);
    row.sellCity = best.city || "";
    row.sellPrice = gross;
    row.netSilver = netSilver;
    row.silverPerFavor = calculateSilverPerFavor(netSilver, FAVOR_PER_ENERGY);
    row.dailyVol = (best.city && marketData[id] && marketData[id][best.city] && marketData[id][best.city].volume_24h) || 0;
    row.note = tx("150 Favor → 1 Siphoned Energy, sold raw", "r_note_siphoned_energy");
    rows.push(row);
  }

  // ── 2. Energy → Runes / Souls / Relics (T4-T8) — direct market sale ─────────
  Object.keys(ENERGY_EXCHANGE_COSTS).forEach((type) => {
    for (let t = 4; t <= 8; t++) {
      const favorCost = getEnergyTokenFavorCost(type, t);
      if (favorCost <= 0) continue;
      const id = `T${t}_${type}`;
      const best = findBestSellCity(marketData, id, cities, 0, routeOrigin, null);
      const gross = (best.city && best.price > 0) ? best.price : 0;
      const netSilver = netSilverAfterFees(gross, true);
      const row = _baseFavorRow(id, _favorRowName(id, id), `Energy: ${ENERGY_TOKEN_LABELS[type]}`, favorCost);
      row.sellCity = best.city || "";
      row.sellPrice = gross;
      row.netSilver = netSilver;
      row.silverPerFavor = calculateSilverPerFavor(netSilver, favorCost);
      row.dailyVol = (best.city && marketData[id] && marketData[id][best.city] && marketData[id][best.city].volume_24h) || 0;
      row.note = `${ENERGY_EXCHANGE_COSTS[type][t]} Siphoned Energy`;
      rows.push(row);
    }
  });

  // ── 2b. Avalonian Shards (T4-T8) — flat direct-Favor purchase, sold direct ──
  // No Siphoned-Energy recipe exists for Avalonian, so the Energy Manipulator
  // sells the shard for a fixed Favor price (AVALONIAN_SHARD_FAVOR).
  for (let t = 4; t <= 8; t++) {
    const favorCost = getAvalonianShardFavorCost(t);
    if (favorCost <= 0) continue;
    const id = `T${t}_SHARD_AVALONIAN`;
    const best = findBestSellCity(marketData, id, cities, 0, routeOrigin, null);
    const gross = (best.city && best.price > 0) ? best.price : 0;
    const netSilver = netSilverAfterFees(gross, true);
    const row = _baseFavorRow(id, _favorRowName(id, id), "Avalonian Shard", favorCost);
    row.sellCity = best.city || "";
    row.sellPrice = gross;
    row.netSilver = netSilver;
    row.silverPerFavor = calculateSilverPerFavor(netSilver, favorCost);
    row.dailyVol = (best.city && marketData[id] && marketData[id][best.city] && marketData[id][best.city].volume_24h) || 0;
    row.note = tx("Direct Favor purchase (no energy recipe)", "r_note_direct_favor");
    rows.push(row);
  }

  // ── 2c. Tomes of Insight — non-tradable fame books, valued fame-per-Favor ────
  // Mattina sells the Elder's (T8) Tome for a flat 2,000 Favor. It's
  // non-tradable, so there's no silver value — the row reports combat fame per
  // Favor instead (fame granted ÷ Favor cost), flagged via metric:"fame".
  if (typeof TOMES_FOR_FAVOR !== "undefined") {
    TOMES_FOR_FAVOR.forEach((t) => {
      const row = _baseFavorRow(t.id, _favorRowName(t.id, t.id), "Tome", t.favorCost);
      row.tradeable = false;
      row.metric = "fame";
      row.fameValue = t.fame;
      row.famePerFavor = famePerFavor(t.fame, t.favorCost);
      row.silverPerFavor = 0; // non-tradable — no silver efficiency
      row.note = `${t.fame.toLocaleString()} combat fame (non-tradable) ÷ ${t.favorCost.toLocaleString()} Favor`;
      rows.push(row);
    });
  }

  // ── 2d. Crests (cape blueprints) — tradable, sold direct for Favor ──────────
  // Avalonian crests (Mattina), Smuggler crests (Maggy Slade / Shadow Hand) and
  // Demon crests (The Antiquarian) — each family priced off its own Favor
  // schedule. All are tradable cape BPs → direct market sale, exactly like the
  // Rune/Soul/Relic and Avalonian Shard rows above.
  if (typeof FAVOR_CREST_FAMILIES !== "undefined") {
    FAVOR_CREST_FAMILIES.forEach((fam) => {
      for (let t = 4; t <= 8; t++) {
        const favorCost = (typeof getFamilyCrestFavorCost === "function")
          ? getFamilyCrestFavorCost(fam, t)
          : getCrestFavorCost(t);
        if (favorCost <= 0) continue;
        const id = `T${t}_${fam.idStem}_BP`;
        const best = findBestSellCity(marketData, id, cities, 0, routeOrigin, null);
        const gross = (best.city && best.price > 0) ? best.price : 0;
        const netSilver = netSilverAfterFees(gross, true);
        const row = _baseFavorRow(id, _favorRowName(id, id), fam.category, favorCost);
        row.favorFaction = fam.faction || "Energy Manipulator";
        row.sellCity = best.city || "";
        row.sellPrice = gross;
        row.netSilver = netSilver;
        row.silverPerFavor = calculateSilverPerFavor(netSilver, favorCost);
        row.dailyVol = (best.city && marketData[id] && marketData[id][best.city] && marketData[id][best.city].volume_24h) || 0;
        row.note = fam.note;
        rows.push(row);
      }
    });
  }

  // ── 2e. Antiquarian spiderling babies — tradable, sold raw OR bred ──────────
  // The Antiquarian sells the Hellspinner (T5) and Soulspinner (T8) babies for
  // Favor. They're tradable "Farmable - Animal" creatures, so the raw floor is a
  // direct sale (silver/Favor). Like the Brecilien owl babies they also carry a
  // breed-vs-raw comparison: the bred path's silver/Favor is pulled from the
  // Mounts table (getBreedDataByBaby, which denominates the spider baby in Favor
  // via getBabyFavorCost since spiders are Favor-bought, not FP-bought).
  if (typeof ANTIQUARIAN_BABIES !== "undefined") {
    const breedMap = (typeof getBreedDataByBaby === "function") ? getBreedDataByBaby() : {};
    ANTIQUARIAN_BABIES.forEach((b) => {
      const best = findBestSellCity(marketData, b.id, cities, 0, routeOrigin, null);
      const gross = (best.city && best.price > 0) ? best.price : 0;
      const netSilver = netSilverAfterFees(gross, true);
      const row = _baseFavorRow(b.id, _favorRowName(b.id, b.name), "Antiquarian Baby", b.favorCost);
      row.favorFaction = "The Antiquarian";
      row.sellCity = best.city || "";
      row.sellPrice = gross;
      row.netSilver = netSilver;
      row.silverPerFavor = calculateSilverPerFavor(netSilver, b.favorCost);
      row.dailyVol = (best.city && marketData[b.id] && marketData[b.id][best.city] && marketData[b.id][best.city].volume_24h) || 0;
      const bd = breedMap[b.id] || null;
      row.breedData = bd;
      row.breedSilverPerFavor = bd ? (bd.silverPerFavor || 0) : 0;
      row.note = tx("The Antiquarian — sold raw or raise into the spider mount", "r_note_antiquarian_spider");
      rows.push(row);
    });
  }

  // ── 2f. Faerie Fire — Mists crafting token, tradable, sold raw for Favor ────
  // Eralia Wayfarer (Brecilien) sells Faerie Fire for a flat Favor price. It's a
  // market-tradable token (used in Brecilien capes + the Mystic Owl mount), so
  // the Favor sink is to buy it and resell raw — same handling as Siphoned Energy.
  if (typeof FAERIE_FIRE !== "undefined") {
    const f = FAERIE_FIRE;
    const best = findBestSellCity(marketData, f.id, cities, 0, routeOrigin, null);
    const gross = (best.city && best.price > 0) ? best.price : 0;
    const netSilver = netSilverAfterFees(gross, true);
    const row = _baseFavorRow(f.id, _favorRowName(f.id, f.name), "Faerie Fire", f.favorCost);
    row.favorFaction = "Brecilien";
    row.sellCity = best.city || "";
    row.sellPrice = gross;
    row.netSilver = netSilver;
    row.silverPerFavor = calculateSilverPerFavor(netSilver, f.favorCost);
    row.dailyVol = (best.city && marketData[f.id] && marketData[f.id][best.city] && marketData[f.id][best.city].volume_24h) || 0;
    row.note = tx("Brecilien (Eralia Wayfarer) — sold raw", "r_note_brecilien_raw");
    rows.push(row);
  }

  // ── 2g. Brecilien Mystic Owl babies — tradable, sold raw OR bred ────────────
  // Eralia Wayfarer sells the Mystic Owlet (675 Favor) and Elite Mystic Owlet
  // (11,250 Favor). Like the FP faction babies, they carry a breed-vs-raw
  // comparison: the raw floor is a direct sale (silver/Favor), and the bred
  // path's silver/Favor is pulled from the Mounts table (getBreedDataByBaby,
  // which now denominates owl breeding in Favor since owls aren't FP-bought).
  if (typeof BRECILIEN_BABIES !== "undefined") {
    const breedMap = (typeof getBreedDataByBaby === "function") ? getBreedDataByBaby() : {};
    BRECILIEN_BABIES.forEach((b) => {
      const best = findBestSellCity(marketData, b.id, cities, 0, routeOrigin, null);
      const gross = (best.city && best.price > 0) ? best.price : 0;
      const netSilver = netSilverAfterFees(gross, true);
      const row = _baseFavorRow(b.id, _favorRowName(b.id, b.name), "Mystic Owl Baby", b.favorCost);
      row.favorFaction = "Brecilien";
      row.sellCity = best.city || "";
      row.sellPrice = gross;
      row.netSilver = netSilver;
      row.silverPerFavor = calculateSilverPerFavor(netSilver, b.favorCost);
      row.dailyVol = (best.city && marketData[b.id] && marketData[b.id][best.city] && marketData[b.id][best.city].volume_24h) || 0;
      const bd = breedMap[b.id] || null;
      row.breedData = bd;
      row.breedSilverPerFavor = bd ? (bd.silverPerFavor || 0) : 0;
      row.note = tx("Brecilien (Eralia Wayfarer) — sold raw or raise into the Mystic Owl mount", "r_note_brecilien_owl");
      rows.push(row);
    });
  }

  // ── 3. Energy → exclusive combat mounts — sell mount net of base mount + mats ─
  // The finished battle mount is sold; the base mount + fixed mats bought off
  // the market are netted off the sale. A per-input breakdown (row.mountInputs)
  // is attached so the renderer can expose every cost as a click-to-override
  // span — the base mounts are thinly traded and frequently have no live ask,
  // in which case their cost would otherwise silently drop to 0 and overstate
  // the net. When any input price is unknown the silver/Favor is suppressed
  // (renders "—") rather than shown as an inflated profit.
  //
  // The Favor spent is backed by m.energy Siphoned Energy turned in at the
  // Manipulator, so the row ALSO carries the all-in silver figures the Top-10
  // board needs: mountInputs.energy (priced like every other input),
  // mountInputs.pureInputCost (base + mats + energy) and row.pureProfitSilver
  // (mountNet − pureInputCost). The table's OWN netSilver/silverPerFavor stay
  // Favor-denominated — energy is not deducted there, because the row ranks
  // against the sold-raw Siphoned Energy baseline in this same table.
  MOUNT_EXCHANGES.forEach((m) => {
    const best = findBestSellCity(marketData, m.id, cities, 0, routeOrigin, null);
    const gross = (best.city && best.price > 0) ? best.price : 0;
    const mountNet = netSilverAfterFees(gross, true);

    const baseAsk = _favorCheapestBuyCity(marketData, m.baseMountId);
    let inputCost = baseAsk.price;
    let inputsKnown = baseAsk.price > 0;
    const baseInput = {
      id: m.baseMountId,
      name: _favorRowName(m.baseMountId, m.baseMountId),
      count: 1,
      city: baseAsk.city,
      price: baseAsk.price,
      subtotal: baseAsk.price,
    };
    const matInputs = m.mats.map((mat) => {
      const ask = _favorCheapestBuyCity(marketData, mat.id);
      const subtotal = ask.price * mat.count;
      inputCost += subtotal;
      if (ask.price <= 0) inputsKnown = false;
      return {
        id: mat.id,
        name: _favorRowName(mat.id, mat.id),
        count: mat.count,
        city: ask.city,
        price: ask.price,
        subtotal,
      };
    });

    const energyAsk = _favorCheapestBuyCity(marketData, SIPHONED_ENERGY_ID);
    const energyInput = {
      id: SIPHONED_ENERGY_ID,
      name: _favorRowName(SIPHONED_ENERGY_ID, "Siphoned Energy"),
      count: m.energy,
      city: energyAsk.city,
      price: energyAsk.price,
      subtotal: energyAsk.price * m.energy,
    };
    const energyKnown = energyAsk.price > 0;
    const pureInputCost = inputCost + energyInput.subtotal;
    const pureProfitSilver = (gross > 0 && inputsKnown && energyKnown)
      ? (mountNet - pureInputCost)
      : 0;

    const profit = gross > 0 ? (mountNet - inputCost) : 0;
    const row = _baseFavorRow(m.id, m.name, "Energy Mount", m.favorCost);
    row.sellCity = best.city || "";
    row.sellPrice = gross;
    row.netSilver = profit;
    // Suppress silver/Favor when an input is unmpriced — the net is an upper
    // bound only (missing input treated as free), so showing it as a real
    // efficiency would mislead. Expanding the row lets the user set the price.
    row.silverPerFavor = (gross > 0 && inputsKnown) ? calculateSilverPerFavor(profit, m.favorCost) : 0;
    row.dailyVol = (best.city && marketData[m.id] && marketData[m.id][best.city] && marketData[m.id][best.city].volume_24h) || 0;
    row.note = `${m.energy.toLocaleString()} Energy + base mount + mats`
      + ((inputsKnown && energyKnown) ? "" : " — ⚠ input price missing, expand to set");
    row.pureProfitSilver = pureProfitSilver;
    row.mountInputs = {
      baseMount: baseInput,
      mats: matInputs,
      inputCost,
      inputsKnown,
      mountNet,
      energy: energyInput,
      energyKnown,
      pureInputCost,
    };
    rows.push(row);
  });

  return rows;
}

// ── Energy Mount input breakdown (expandable detail row) ────────────────────
// Persisted UI state — which Energy Mount rows have their input breakdown open.
// Survives the re-renders triggered by price overrides.
const _expandedMountInputs = new Set();

// One "N× Name @ City <editable price> = subtotal" line for a single input.
function _mountInputLine(input) {
  const span = (typeof matPriceSpan === "function")
    ? matPriceSpan(input.id, input.city, input.price || 0)
    : `${(input.price || 0).toLocaleString()}`;
  const where = input.city ? ` @ ${input.city}` : "";
  const sub = input.price > 0
    ? ` <small style="color:#9ca3af">= ${formatSilver(input.subtotal)}</small>`
    : ` <small style="color:#f59e0b">${tx("no data — click to set", "r_no_data_click_set")}</small>`;
  return `${input.count}× ${input.name}${where} ${span}${sub}`;
}

// Expandable breakdown row for an Energy Mount: base mount + each mat + the
// Siphoned Energy backing the Favor, each with a click-to-override price, the
// totals deducted, and the resulting nets. Mirrors _renderBreedDetailRow's
// shape so the shared table lays it out identically.
function _renderMountInputDetailRow(row) {
  if (!row.mountInputs) return "";
  const mi = row.mountInputs;
  const isOpen = _expandedMountInputs.has(row.itemId);
  const display = isOpen ? "table-row" : "none";

  const baseHtml = _mountInputLine(mi.baseMount);
  const matsHtml = mi.mats.map(_mountInputLine).join("<br>");
  const energyHtml = mi.energy
    ? `${_mountInputLine(mi.energy)} <small style="color:#9ca3af">— ${
        tx("backs the {n} Favor; not deducted from the Favor-value net", "r_energy_backs_favor")
          .split("{n}").join((row.favorCost || 0).toLocaleString())
      }</small>`
    : "";

  const net = row.netSilver || 0;
  const netClass = net > 0 ? "profit-high" : "profit-negative";
  const warn = mi.inputsKnown
    ? ""
    : ` <small style="color:#f59e0b">— ${tx("missing input treated as free; net is an upper bound", "r_missing_input_upper_bound")}</small>`;
  const pure = (typeof row.pureProfitSilver === "number") ? row.pureProfitSilver : 0;
  const pureClass = pure > 0 ? "profit-high" : "profit-negative";
  const pureWarn = (mi.inputsKnown && mi.energyKnown)
    ? ""
    : ` <small style="color:#f59e0b">— ${tx("energy or input price missing", "r_energy_price_missing")}</small>`;
  const summaryHtml = `
    <div>${tx("Mount sale (net of tax)", "r_mount_sale_net_tax")}: <b>${formatSilver(mi.mountNet)}</b></div>
    <div>− ${tx("Inputs (base mount + mats)", "r_inputs_base_mount_mats")}: <b>${formatSilver(mi.inputCost)}</b></div>
    <div>= ${tx("Net silver", "r_net_silver")} ${tx("(Favor value)", "r_favor_value_net")}: <b class="${netClass}">${formatSilver(net)}</b>${warn}</div>
    <div>− ${tx("Siphoned Energy at market", "r_siphoned_energy_at_market")}: <b>${formatSilver(mi.energy ? mi.energy.subtotal : 0)}</b></div>
    <div>= ${tx("Pure profit incl. energy", "r_pure_profit_incl_energy")}: <b class="${pureClass}">${formatSilver(pure)}</b>${pureWarn}</div>
  `;

  return `
    <tr class="mount-input-detail-row" data-mount-id="${row.itemId}" style="display:${display}">
      <td colspan="${typeof _fsColCount === "function" ? _fsColCount() : 12}" class="breed-detail-cell">
        <div class="row-fluid"><div class="breed-detail-grid">
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Base mount (1 consumed)", "r_base_mount_consumed")}</div>
            <div>${baseHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Materials (consumed, no return)", "r_materials_consumed_no_return")}</div>
            <div>${matsHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Favor source — Siphoned Energy", "r_favor_source_energy")}</div>
            <div>${energyHtml}</div>
          </div>
          <div class="breed-detail-section">
            <div class="breed-detail-label">${tx("Net silver breakdown", "r_net_silver_breakdown")}</div>
            <div>${summaryHtml}</div>
          </div>
        </div></div>
      </td>
    </tr>
  `;
}

// Toggle handler for the Energy Mount input breakdown. Idempotent module-init,
// mirrors _initBreedToggle in render-faction-spending.js.
(function _initMountInputToggle() {
  if (typeof document === "undefined") return;
  if (document._mountInputToggleInit) return;
  document._mountInputToggleInit = true;
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".mount-input-toggle");
    if (!toggle) return;
    e.stopPropagation();
    const mountId = toggle.getAttribute("data-mount-id");
    if (!mountId) return;
    const detailRow = document.querySelector(
      `.mount-input-detail-row[data-mount-id="${CSS.escape(mountId)}"]`
    );
    if (!detailRow) return;
    const isOpen = detailRow.style.display !== "none";
    if (isOpen) {
      detailRow.style.display = "none";
      _expandedMountInputs.delete(mountId);
      toggle.textContent = "▾";
    } else {
      detailRow.style.display = "table-row";
      _expandedMountInputs.add(mountId);
      toggle.textContent = "▴";
    }
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildFavorSpendingRows };
}
