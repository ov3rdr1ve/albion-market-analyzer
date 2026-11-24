function getItemDisplayName(itemId) {
  // Resources → uniform short label ("6.1 planks", "4 bar"); see resource-names.js.
  const short = typeof resourceShortName === "function" && resourceShortName(itemId);
  if (short) return short;
  // Spanish item names (js/item-names-es.js) win over the English chain below
  // when the UI language is "es"; anything without an ES entry falls through so
  // a raw id is never shown. Enchant "@n" resolves the base then appends [.n].
  if (
    typeof getLang === "function" &&
    getLang() === "es" &&
    typeof ITEM_NAMES_ES !== "undefined"
  ) {
    if (ITEM_NAMES_ES[itemId]) return ITEM_NAMES_ES[itemId];
    const em = itemId.match(/^(.+?)(?:_LEVEL\d+)?@(\d+)$/);
    if (em && ITEM_NAMES_ES[em[1]]) return `${ITEM_NAMES_ES[em[1]]} [.${em[2]}]`;
  }
  // Guarded like the rest below: the catalogs load after first paint now
  // (js/catalog-loader.js), and this helper is callable before they land
  // (the monitor's auto-start renders do exactly that).
  if (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[itemId]) return ITEM_NAMES_MAP[itemId];
  // Enchant variants ("T6_2H_BOW@4", "T4_SHOES_LEATHER_FEY@4", ...): resolve the
  // base item's name and append the ".n" indicator, matching the crafting
  // table's " [.n]" suffix. Callers that key off raw market ids (e.g. the volume
  // table) pass these straight in; without this they leak the raw "@n" slug.
  // Mapped "_LEVELn@n" refined resources are caught by the lookup above first.
  const enchMatch = itemId.match(/^(.+?)(?:_LEVEL\d+)?@(\d+)$/);
  if (enchMatch) {
    const baseName = getItemDisplayName(enchMatch[1]);
    if (baseName && baseName !== enchMatch[1]) return `${baseName} [.${enchMatch[2]}]`;
  }
  const craft = typeof CRAFTING_ITEMS !== "undefined"
    ? CRAFTING_ITEMS.find((i) => i.id === itemId || i.matId === itemId)
    : undefined;
  if (craft) return craft.name || craft.matId;
  const flip = typeof FLIPPING_ITEMS !== "undefined"
    ? FLIPPING_ITEMS.find((i) => i.id === itemId)
    : undefined;
  if (flip) return flip.name;
  // Luxury (trade) goods — TREASURE_* ids are absent from ITEM_NAMES_MAP, so
  // without this the name resolves to the raw id and the Flipping search box
  // (which matches the query against getItemDisplayName) can't find them.
  if (typeof getLuxuryFlipInfo === "function") {
    const lux = getLuxuryFlipInfo(itemId);
    if (lux) return lux.name;
  }
  // (Resources resolve via resourceShortName above; the old TRANSPORT_ITEMS lookup is gone.)
  const cons = typeof CONSUMABLES !== "undefined"
    ? CONSUMABLES.find((i) => i.id === itemId)
    : undefined;
  if (cons) return cons.name;
  if (typeof MOUNT_RECIPES !== "undefined") {
    const mount = MOUNT_RECIPES.find((i) => i.id === itemId);
    if (mount) return mount.name;
  }
  if (typeof BREEDING_ITEMS !== "undefined") {
    const breed = BREEDING_ITEMS.find((i) => i.babyId === itemId || i.grownId === itemId);
    if (breed) {
      if (itemId === breed.grownId) return breed.grownName || `${tx("Tame", "r_tame")} ${breed.name}`;
      if (itemId === breed.babyId) return breed.babyName || `${tx("Baby", "r_baby")} ${breed.name}`;
      return breed.name;
    }
  }
  // FARMING_PRODUCTION.name describes the harvested good ("Elusive Foxglove [T6]"),
  // so it only names `outputId`. Seed/animal ids fall through to ITEM_NAMES_MAP,
  // which has their own names ("Elusive Foxglove Seeds").
  if (typeof FARMING_PRODUCTION !== "undefined") {
    const farm = FARMING_PRODUCTION.find((i) => i.outputId === itemId);
    if (farm) return farm.name;
  }
  const artFlip = typeof ARTIFACT_FLIP_ITEMS !== "undefined"
    ? ARTIFACT_FLIP_ITEMS.find((i) => i.id === itemId)
    : undefined;
  if (artFlip) return artFlip.name;
  // Cape blueprint (crest) name resolution
  if (itemId.includes("CAPEITEM") && itemId.endsWith("_BP")) {
    const capeId = itemId.replace(/_BP$/, "");
    const cape = typeof GEAR_CAPES !== "undefined"
      ? GEAR_CAPES.find((c) => c.id === capeId)
      : undefined;
    if (cape) return cape.name.replace(/ \[T\d+\]/, "").replace("Cape", "Crest");
  }
  // Laborer trophy journals (full + empty) and trophy furniture items.
  // Slugs may mismatch between journal and furniture (STONE/ROCK,
  // FISHING/FISH), so we render each side from its own slug.
  const trophyJournal = itemId.match(/^T(\d+)_JOURNAL_TROPHY_([A-Z]+)_(FULL|EMPTY)$/);
  if (trophyJournal) {
    const [, t, slug, state] = trophyJournal;
    const cap = slug.charAt(0) + slug.slice(1).toLowerCase();
    return `T${t} ${cap} ${tx("Trophy Journal", "r_trophy_journal")} (${state === "FULL" ? tx("Full", "r_full") : tx("Empty", "r_empty")})`;
  }
  const trophyFurniture = itemId.match(/^T(\d+)_FURNITUREITEM_TROPHY_([A-Z]+)$/);
  if (trophyFurniture) {
    const [, t, slug] = trophyFurniture;
    const cap = slug.charAt(0) + slug.slice(1).toLowerCase();
    return `T${t} ${cap} Trophy`;
  }
  // Non-trophy laborer journals (Lumberjack, Mercenary, Blacksmith, ...).
  const regularJournal = itemId.match(/^T(\d+)_JOURNAL_([A-Z]+)_(FULL|EMPTY)$/);
  if (regularJournal) {
    const [, t, slug, state] = regularJournal;
    const cap = slug.charAt(0) + slug.slice(1).toLowerCase();
    return `T${t} ${cap} Journal (${state === "FULL" ? "Full" : "Empty"})`;
  }
  // Laborer contracts (pre-leveled laborer purchases).
  const contract = itemId.match(/^T(\d+)_LABOURER_CONTRACT_([A-Z]+)$/);
  if (contract) {
    const [, t, slug] = contract;
    const cap = slug.charAt(0) + slug.slice(1).toLowerCase();
    return `T${t} ${cap} Contract`;
  }
  return itemId;
}

// Hidden, search-only span of a resource's real name + family synonyms, appended
// inside a name cell so the generic "<tier> rock" label is still findable by
// "stone"/"travertine"/"metal" etc. `display:none` keeps it out of sight while
// table-search.js (which matches tr.textContent) still sees it. Returns "" for
// non-resources, so it's safe to drop into any name cell unconditionally.
function resourceAliasSpan(itemId) {
  const aliases =
    typeof resourceSearchAliases === "function" ? resourceSearchAliases(itemId) : "";
  return aliases ? `<span class="search-alias">${aliases}</span>` : "";
}

// Tradeable ids that carry no "T<n>_" prefix but DO have a real tier in
// items.xml. Without these they'd hit the tier-4 fallback below and print the
// wrong tier (Flipping tier column, Brecilien fee table).
//   UNIQUE_GVGTOKEN_GENERIC → <simpleitem ... tier="1">  (Siphoned Energy)
//   QUESTITEM_TOKEN_AVALON  → <simpleitem ... tier="6">  (Avalonian Energy)
// Ids that carry the tier as a TRAILING _T<n> instead (QUESTITEM_TOKEN_ROYAL_T4
// … _T8, the only tradeable family in items.xml shaped that way) are read by
// the suffix branch of getTierFromId, not by this table.
const UNTIERED_ITEM_TIERS = {
  UNIQUE_GVGTOKEN_GENERIC: 1,
  QUESTITEM_TOKEN_AVALON: 6,
};

// Extract tier number from item ID like "T4_SWORD" -> 4
function getTierFromId(itemId) {
  if (!itemId) return 4;
  const match = itemId.match(/^T(\d+)/);
  if (match) return parseInt(match[1]);
  const base = itemId.replace(/(?:_LEVEL\d+)?@\d+$/, "");
  if (UNTIERED_ITEM_TIERS[base] !== undefined) return UNTIERED_ITEM_TIERS[base];
  // Trailing tier: the five Royal Sigils (QUESTITEM_TOKEN_ROYAL_T4 … _T8).
  // Without this they all took the fallback below, so the Flipping table listed
  // five different tokens as five identical "Royal Sigil [T4]" rows.
  const suffix = base.match(/_T(\d+)$/);
  if (suffix) return parseInt(suffix[1], 10);
  return 4;
}

// Determine item category by checking which data array contains it
function getItemCategory(itemId) {
  // Normalize enchant variants ("T6_2H_BOW@4", "T4_LEATHER_LEVEL2@2") to the
  // base id so the catalog exact-match lookups below resolve their category.
  itemId = itemId.replace(/(?:_LEVEL\d+)?@\d+$/, "");
  if (TRANSPORT_ITEMS.some((i) => i.rawId === itemId || i.refinedId === itemId || i.secondaryMatId === itemId))
    return "Resource";
  if (CRAFTING_ITEMS.some((i) => i.id === itemId || i.matId === itemId))
    return "Gear";
  if (CONSUMABLES.some((i) => i.id === itemId)) return "Consumable";
  if (typeof MOUNT_RECIPES !== "undefined" && MOUNT_RECIPES.some((i) => i.id === itemId)) return "Mount";
  if (typeof BREEDING_ITEMS !== "undefined" && BREEDING_ITEMS.some((i) => i.babyId === itemId || i.grownId === itemId)) return "Breeding";
  if (typeof FARMING_PRODUCTION !== "undefined" && FARMING_PRODUCTION.some((i) => i.id === itemId || i.outputId === itemId)) return "Farming";
  if (ARTIFACT_FLIP_ITEMS.some((i) => i.id === itemId)) return "Artifact";
  if (FLIPPING_ITEMS.some((i) => i.id === itemId)) {
    if (/_(RUNE|SOUL|RELIC)$/.test(itemId) || /_SHARD_/.test(itemId))
      return "Fragment";
    if (/_MOUNT_/.test(itemId) || /^UNIQUE_MOUNT_/.test(itemId))
      return "Mount";
    if (/_FISH/.test(itemId)) return "Consumable";
    if (/_FURNITUREITEM_/.test(itemId)) return "Furniture";
    if (/_JOURNAL_/.test(itemId)) return "Journal";
    return "Flip";
  }
  if (/_METALBAR|_PLANKS|_LEATHER|_CLOTH|_ORE|_WOOD|_HIDE|_FIBER|_ROCK|_STONEBLOCK/.test(itemId))
    return "Resource";
  return "Other";
}

// Get minimum volume across buy/sell cities for an item
function getMinVol(marketData, itemId, city1, city2) {
  const v1 = getOverrideVolume(itemId, city1) ?? (marketData[itemId]?.[city1]?.volume_24h || 0);
  const v2 = getOverrideVolume(itemId, city2) ?? (marketData[itemId]?.[city2]?.volume_24h || 0);
  return Math.min(v1, v2);
}

// One item's 24h volume at one city (override-aware). Used as the Daily Vol for
// craft/breed rows where the buy leg is MULTIPLE materials (no single source id
// to pair): the meaningful liquidity gate there is "can I sell the output?", so
// we report the output's sell-city volume rather than a spurious buy-leg read.
function getCityVol(marketData, itemId, city) {
  return getOverrideVolume(itemId, city) ?? (marketData[itemId]?.[city]?.volume_24h || 0);
}

// Bottleneck volume when the two traded legs are DIFFERENT items: buy `id1` at
// `city1`, sell `id2` at `city2` (e.g. transmute buys the source resource and
// sells the transmuted end product). Using one itemId for both cities would read
// the end product's volume at the source-buy city, which is ~0 and wrong.
function getMinVol2(marketData, id1, city1, id2, city2) {
  const v1 = getOverrideVolume(id1, city1) ?? (marketData[id1]?.[city1]?.volume_24h || 0);
  const v2 = getOverrideVolume(id2, city2) ?? (marketData[id2]?.[city2]?.volume_24h || 0);
  return Math.min(v1, v2);
}

// --- Dynamic Route Finders ---
function isBlackRedZoneEnabled() {
  const cb = document.getElementById("include-caerleon");
  return cb && cb.checked;
}

function isFocusEnabled() {
  // Non-Premium accounts don't regenerate focus, so focus is unavailable to
  // them regardless of the "Use Focus" checkbox — Premium gates focus.
  if (!isPremiumEnabled()) return false;
  const cb = document.getElementById("use-focus");
  return !cb || cb.checked;
}

// Account status toggle in the header. Premium = 4% market sales tax,
// non-Premium = 8%. Drives the live PREMIUM_TAX getter in calculations.js so
// every profit table re-prices when the box is toggled. Defaults to Premium
// (checkbox absent or checked) to match the app's long-standing assumption.
function isPremiumEnabled() {
  const cb = document.getElementById("premium-account");
  return !cb || cb.checked;
}

// Faction Warfare mounts (T5 saddled + T8 elite) embed their forced craft city
// in the item ID as a `_FW_<CITY>_` suffix. The game only lets you saddle them
// at the matching faction's city — so the calculator must lock craftCity (and
// the breeding-chain saddler step) to that city instead of picking the cheapest
// material market.
const FW_CITY_SUFFIX_MAP = {
  THETFORD: "Thetford",
  LYMHURST: "Lymhurst",
  FORTSTERLING: "Fort Sterling",
  BRIDGEWATCH: "Bridgewatch",
  MARTLOCK: "Martlock",
  CAERLEON: "Caerleon",
  BRECILIEN: "Brecilien", // Mists faction enlistment (crests + Mystic Owl babies)
};
function getFactionLockCity(itemId) {
  if (!itemId || typeof itemId !== "string") return null;
  const m = itemId.match(/_FW_([A-Z]+)(?:_|$)/);
  if (!m) return null;
  return FW_CITY_SUFFIX_MAP[m[1]] || null;
}

// Source faction (Royal City) for any FP-spendable item: hearts, crests,
// babies, and Iron Campaign Chests. Lets the Faction Spending table filter
// rows down to a single faction's NPC inventory.
const FACTION_BIOME_TO_CITY = {
  SWAMP: "Thetford",
  FOREST: "Lymhurst",
  MOUNTAIN: "Fort Sterling",
  HIGHLAND: "Martlock",
  STEPPE: "Bridgewatch",
  CAERLEON: "Caerleon",
};
function getItemFaction(itemId) {
  if (!itemId || typeof itemId !== "string") return null;
  const fwCity = getFactionLockCity(itemId);
  if (fwCity) return fwCity;
  const heart = itemId.match(/^T1_FACTION_([A-Z]+)_TOKEN_/);
  if (heart) return FACTION_BIOME_TO_CITY[heart[1]] || null;
  const chest = itemId.match(/FACTIONCAMPAIGN_REWARD_([A-Z]+)_/);
  if (chest) return FACTION_BIOME_TO_CITY[chest[1]] || null;
  return null;
}

// Helper: block Caerleon↔Royal routes unless "Black/Red Zone Routes" is enabled
function isInvalidCrossRoute(buyCity, sellCity) {
  if (!buyCity || !sellCity) return true;

  // The Black Market takes bids from players and sells to nobody, so it is
  // never a buy city at any setting.
  if (buyCity === "Black Market") return true;

  // When Black/Red Zone Routes is enabled, all city combos are allowed
  if (isBlackRedZoneEnabled()) return false;

  // Smuggler's Network markets sit deep in the black zone: with routes off the
  // player never goes there, so any leg touching one is dead — including the
  // den→den leg (unlike Caerleon, which stays valid to itself).
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(sellCity))
    return true;

  // The Black Market's order book sits INSIDE Caerleon, so reaching it is the
  // ordinary "can this buy city reach Caerleon?" question — not a rule of its
  // own. It used to be one, checked ABOVE the routes toggle and demanding a
  // literal Caerleon origin, which left the Black Market invisible to every
  // royal-origin row even with the black/red haul opted into.
  const effectiveSell = sellCity === "Black Market" ? "Caerleon" : sellCity;

  const buyIsRoyal = ROYAL_CITIES.includes(buyCity);
  const sellIsRoyal = ROYAL_CITIES.includes(effectiveSell);

  // Block Royal↔Caerleon in both directions (unless opted in)
  if (buyIsRoyal && effectiveSell === "Caerleon") return true;
  if (buyCity === "Caerleon" && sellIsRoyal) return true;

  return false;
}

// Helper: can materials bought in `buyCity` be hauled to `craftCity`?
//
// A craft buys where it crafts. The material and refining legs must stay on ONE
// side of the zone line — the royal continent (Brecilien included, reached by
// yellow Mists portals) or the outlands (Caerleon and the Smuggler's Network) —
// no matter what Black/Red Zone Routes says. That toggle governs the SALE only
// (isInvalidCrossRoute), so a royal craft can still haul its finished goods to
// the Black Market; what it can no longer do is buy in Caerleon, carry the
// materials out to a royal station, and carry the product back.
//
// Cross-zone hauling costs nothing in this model — the Brecilien Travel Planner
// fee is disabled and no other leg is billed — so while the toggle waved every
// pair through, each material picked the globally cheapest city independently
// and a five-city route was compared against a one-city route at the same price.
// A Master's Cape bought in Caerleon was crafted in Brecilien for a +15% cape
// bonus and sold back at the Black Market, crossing the line twice.
//
// The toggle still owns one thing here: the Smuggler's Network sits deep in the
// black zone, so with routes off it is unreachable and drops out entirely. With
// routes on it is reachable, and it is on the CAERLEON side of the line.
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  // The Black Market takes bids and sells to nobody, so it is never a source.
  if (buyCity === "Black Market") return false;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) {
    if (!isBlackRedZoneEnabled()) return false;
  }
  return ROYAL_CITIES.includes(buyCity) === ROYAL_CITIES.includes(craftCity);
}

// Outlier detection: IQR-based (resistant to extreme values skewing the median)
// Plus a hard cap on maximum displayable margin
const MAX_MARGIN_PERCENT = 500; // Any route showing >500% profit is rejected as bugged

// A margin over the cap means bad market data (stale order, one-off listing) far
// more often than a real 6× flip. Such rows used to be DROPPED at build time by
// transmute/enchanting/rerolling, which made them invisible in every mode —
// "Show All" included — with nothing to click to correct the bad price. Then
// they were kept but filtered out of the default view, which had the same effect
// for anyone not running Show All: the item simply wasn't there. So a flagged
// row is now MARKED and shown — `suspectMargin: true` earns the ⚠ badge below
// and nothing else. Infinity/NaN are NOT flagged — those come from a zero input
// cost, which the -999 no-data sentinel already covers.
function isSuspectMargin(margin) {
  return Number.isFinite(margin) && margin > MAX_MARGIN_PERCENT;
}

// ⚠ marker for a flagged row's transition cell (empty for every normal row).
function suspectMarginBadge(row) {
  if (!row || !row.suspectMargin) return "";
  return `<span class="suspect-margin" style="color:#d9a13b;cursor:help" title="Margin over ${MAX_MARGIN_PERCENT}% — almost always bad market data (a stale or one-off listing), not a real play. Click a price to set an override.">⚠</span> `;
}

// Far-outlier ceiling for one set of prices: q3 + 3·IQR, with a 6×median
// fallback below three samples. Empty set ⇒ Infinity (never rejects).
function iqrUpper(prices) {
  if (prices.length === 0) return Infinity;
  prices.sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  if (prices.length < 3) {
    return median * 6;
  }
  const q1 = prices[Math.floor(prices.length * 0.25)];
  const q3 = prices[Math.floor(prices.length * 0.75)];
  const iqr = q3 - q1;
  const fence = q3 + iqr * 3; // Standard "far outlier" threshold
  // A price sample here is at most 8 cities, and often 3-4. At that size a
  // single fat-finger listing IS the upper quartile: q3 lands on the outlier,
  // the IQR balloons, and the fence ends up far above the value it should
  // reject (T7_PLANKS: asks 11,486 / 12,960 / 80,979 → fence ≈ 290k). The
  // median can't be dragged that way, so for small samples cap the fence at
  // median × 8 — the same median-anchored rule already used for n < 3, kept
  // looser (×8 vs ×6) because a real Caerleon/Brecilien premium runs ~3-6×
  // the royals and belongs inside the band; only order-of-magnitude junk
  // (≈10× and up) sits outside it (plan-outlier-cap.md).
  if (prices.length <= 6) return Math.min(fence, median * 8);
  return fence;
}

// Outlier ceilings, computed PER price-side. Buy orders (bids) sit
// systematically below sell orders (asks), so pooling both into one
// distribution lets a cluster of low buy orders drag the ceiling below a
// legitimate lone sell price — wrongly discarding it (e.g. a Brecilien-only
// bag listing while royals show only buy orders). getBuyPrice/getSellPrice
// each gate their value against the SAME field's distribution. `upper` is the
// combined ceiling, kept for back-compat with stub bounds objects.
//
// The Black Market is left OUT of every pool. It pays a premium the city
// markets never quote, so it can neither anchor the distribution nor be judged
// by it — the same rule js/api.js already applies to the fallback clamp
// (CLAMP_EXEMPT_CITIES). Pooling it did damage in both directions: a BM bid
// four times the royal median was discarded as an outlier (T3_BAG, 2,686
// against a 2,180 ceiling — 59 ids in one real scan), while BM's own ask, a
// field the game has no order book for, moved the ceiling that judges genuine
// city listings on 2,402 ids. getSellPrice therefore reads a BM price ungated —
// there is no longer any distribution it belongs to.
//
// Caerleon joins it in both roles (plan-caerleon-exempt.md): even after the
// small-sample caps were raised to ×8/×6, rare items legitimately quote an
// order of magnitude above the royal median there (a lone royal pair anchors
// the median low), so its rows kept reading "outlier ignored" and no fixed cap
// covers every real spread. Exclusion — not a looser cap — is the fix; the
// royal cities keep full gating.
const IQR_EXEMPT_CITIES = ["Black Market", "Caerleon"];

function getIQRBounds(itemData) {
  if (!itemData) return { upper: Infinity, buyUpper: Infinity, sellUpper: Infinity };
  const all = [], buys = [], sells = [];
  Object.entries(itemData).forEach(([city, cityData]) => {
    if (IQR_EXEMPT_CITIES.includes(city)) return;
    if (cityData.buy_price > 0) { all.push(cityData.buy_price); buys.push(cityData.buy_price); }
    if (cityData.sell_price > 0) { all.push(cityData.sell_price); sells.push(cityData.sell_price); }
  });
  return {
    upper: iqrUpper(all),
    buyUpper: iqrUpper(buys),
    sellUpper: iqrUpper(sells),
  };
}

function isPriceOutlier(price, bounds) {
  if (!bounds || price <= 0) return false;
  return price > bounds.upper;
}

// OrderType: "market" (buy orders / sell orders) or "instant" (sell_price_min /
// buy_price_max). The two legs of a trade are chosen INDEPENDENTLY — the header
// carries a Buy pair and a Sell pair — because real play mixes them: source
// patiently with a market order and dump the output into standing bids, or grab
// mats off the ask now and list the output to wait.
//
// Everything inside the app reads getOrderType(side); the two per-side readers
// exist for the header wiring and for tests. Keeping one entry point matters:
// a harness that stubs `getOrderType` (dozens do) then still drives every
// consumer, and a stub that ignores its argument reproduces the pre-split
// behaviour where both legs moved together.
function _orderTypeFromRadio(id) {
  const radio = document.getElementById(id);
  if (radio) return radio.checked ? "instant" : "market";
  // Pre-split single toggle. Still honoured so an older saved layout, and the
  // harnesses that stub only #sort-instant, drive BOTH sides.
  const legacy = document.getElementById("sort-instant");
  return legacy && legacy.checked ? "instant" : "market";
}
function getBuyOrderType() { return _orderTypeFromRadio("buy-instant"); }
function getSellOrderType() { return _orderTypeFromRadio("sell-instant"); }
/** @param {"buy"|"sell"} [side] — defaults to the buy leg, the historical no-arg meaning. */
function getOrderType(side) {
  return side === "sell" ? getSellOrderType() : getBuyOrderType();
}

// The 24h volume a leg needs before it counts as liquid. A market ORDER has to
// sit in a real book to ever fill; an instant fill does not, so the gate drops
// to 0. Each leg answers for its own side.
//
// The render-*.js tables spell this out inline instead of calling it: they are
// compiled on their own in the Node harnesses, where utils.js is not in scope
// but getOrderType is stubbed.
function minLiquidVolume(side) {
  return getOrderType(side) === "market" ? 25 : 0;
}
// ───────────────────────────────────────────────────────────────────────────

function getBuyPrice(itemData, city, bounds, itemId, sideMode) {
  // An active override wins. A PINNED one ignores the order-type toggle — that
  // is what a pin is for (e.g. valuing a material at its ask to model an
  // instant buy); an "auto" one follows the toggle, same as an unedited cell.
  //
  // sideMode (Flipping only): read the buy-ORDER field directly rather than the
  // active pick. Flipping buys AND sells one (itemId, city) in the same row, so
  // each cell must read its own order field — a single active value can't
  // represent both. A missing buy field falls through to the market (NOT to the
  // sell order). Every other caller omits sideMode.
  const ov = itemId
    ? (sideMode ? getOverrideSidePrice(itemId, city, "buy") : getOverridePrice(itemId, city, "buy"))
    : null;
  if (ov !== null) return ov;

  const cell = itemData ? itemData[city] : null;
  // Any captured quality may stand in for an empty quality 1 on a buy leg, but
  // only on the app's LIVE flat cell (js/price-book-fallback.js isLiveFlatCell).
  const anyQuality = (typeof isLiveFlatCell === "function" && isLiveFlatCell(itemData, itemId))
    ? (field) => anyQualityBookPrice(itemId, city, field) : null;
  if (!cell && !anyQuality) return 0;
  // Instant pays the ask, Market Orders the bid; under Instant an empty ask
  // falls back to the bid of the same book (readBookLeg).
  const { price, field } = _bookLeg(cell, "buy", getOrderType("buy"), anyQuality);
  // Caerleon reads ungated (see getIQRBounds): its legs sit outside every
  // cross-city comparison. The Black Market does NOT join this one — unlike its
  // sell side, its buy book is real city-market data the pools can bound.
  if (city !== "Black Market" && IQR_EXEMPT_CITIES.includes(city)) return price;
  // Gate against the cross-city distribution of the field actually read: an ask
  // against sellUpper, a bid against buyUpper. A sniffer-captured field skips
  // the gate — a live capture is a reading, not a troll quote.
  if (bounds && !_isSnifferLeg(cell, field) && isPriceOutlier(price, { upper: sideUpper(bounds, field === "sell_price" ? "sell" : "buy") })) return 0;
  return price;
}

function getSellPrice(itemData, city, bounds, itemId, sideMode) {
  // The Black Market deals in equipment alone (js/black-market-items.js), so an
  // untradable item has no price there — before the override, because a
  // hand-typed number cannot create an order book that does not exist. Checked
  // here rather than in each table: this is the one function every Black Market
  // sell leg in the app is priced through.
  if (city === "Black Market" && itemId
      && typeof isBlackMarketTradable === "function"
      && !isBlackMarketTradable(itemId)) {
    return 0;
  }

  // An active override wins, pinned or following the toggle, same as
  // getBuyPrice. sideMode (Flipping only) reads the sell-ORDER field directly
  // so the sell cell is independent of the buy cell — see getBuyPrice.
  const ov = itemId
    ? (sideMode ? getOverrideSidePrice(itemId, city, "sell") : getOverridePrice(itemId, city, "sell"))
    : null;
  if (ov !== null) return ov;

  if (!itemData || !itemData[city]) return 0;
  // The Black Market follows the toggle like any other city: it does take sell
  // orders — you either fill its standing buy order (instant) or list your own
  // price and wait for the merchant demand to reach it (market orders). Under
  // Instant an empty bid falls back to the ask of the same book (readBookLeg).
  const cell = itemData ? itemData[city] : null;
  const { price, field } = _bookLeg(cell, "sell", getOrderType("sell"), null);
  const readsBuyField = field === "buy_price";
  // The exempt cities are read ungated: getIQRBounds builds its pools without
  // them (see there), so there is no distribution their premium legs could be
  // measured against — the Black Market's bid, or Caerleon's quotes at any
  // ratio (plan-caerleon-exempt.md). A sniffer-captured field skips the gate
  // the same way, same as the buy leg.
  if (IQR_EXEMPT_CITIES.includes(city)) return price;
  if (bounds && !_isSnifferLeg(cell, field) && isPriceOutlier(price, { upper: sideUpper(bounds, readsBuyField ? "buy" : "sell") })) return 0;
  return price;
}

// Pick the per-side outlier ceiling, falling back to the combined `upper`
// (so legacy/stub bounds objects exposing only `{ upper }` still gate).
function sideUpper(bounds, side) {
  const u = side === "buy" ? bounds.buyUpper : bounds.sellUpper;
  return u !== undefined ? u : bounds.upper;
}

// One leg's read of one book cell: js/price-book-fallback.js when loaded (the
// Instant other-side and any-quality fallbacks), else the leg's single field.
function _bookLeg(cell, side, orderType, anyQuality) {
  if (typeof readBookLeg === "function") return readBookLeg(cell, side, orderType, anyQuality);
  const field = (side === "buy") === (orderType === "instant") ? "sell_price" : "buy_price";
  return { price: (cell && cell[field]) || 0, field };
}

// Whether the field a leg read came from a sniffer capture: true only when
// js/price-book-fallback.js is loaded and the cell carries its provenance
// flag, so a fresh capture skips the outlier gate. File not loaded, or a
// flagless (scan / API / legacy) cell → false: the gate exactly as before.
function _isSnifferLeg(cell, field) {
  if (typeof isSnifferLeg === "function") return isSnifferLeg(cell, field);
  return false;
}

function findBestRoute(marketData, itemId, buyCities, sellCities) {
  let bestBuyCity = null;
  let bestBuyPrice = Infinity;
  let bestSellCity = null;
  let bestSellPrice = 0;
  let maxMarginNet = -Infinity;

  const MIN_BUY_VOLUME = minLiquidVolume("buy");
  const MIN_SELL_VOLUME = minLiquidVolume("sell");
  const bounds = getIQRBounds(marketData[itemId]);

  // Only honour city forces when the user has an active price override there
  const forcedBuy = getCityForce(itemId, "buy");
  const forcedSell = getCityForce(itemId, "sell");
  const effectiveBuyCities = (forcedBuy && getOverridePrice(itemId, forcedBuy) !== null) ? [forcedBuy] : buyCities;
  const effectiveSellCities = (forcedSell && getOverridePrice(itemId, forcedSell) !== null) ? [forcedSell] : sellCities;

  effectiveBuyCities.forEach((bc) => {
    let buyP = getBuyPrice(marketData[itemId], bc, bounds, itemId);
    let buyVol = marketData[itemId]?.[bc]?.volume_24h || 0;

    if (
      buyP > 0 &&
      (buyVol >= MIN_BUY_VOLUME || getOverridePrice(itemId, bc) !== null)
    ) {
      effectiveSellCities.forEach((sc) => {
        if (!isInvalidCrossRoute(bc, sc)) {
          let sellP = getSellPrice(marketData[itemId], sc, bounds, itemId);
          let sellVol = marketData[itemId]?.[sc]?.volume_24h || 0;

          if (
            sellP > 0 &&
            (sellVol >= MIN_SELL_VOLUME || getOverridePrice(itemId, sc) !== null)
          ) {
            // Net of the Brecilien Travel Planner fee when this route hauls the
            // item out of Brecilien (bc === Brecilien, sc !== Brecilien).
            const exit = typeof legBrecilienCost === "function"
              ? legBrecilienCost(bc, sc, itemId, 1) : 0;
            // Net profit, not the gross spread: the market fees scale each
            // leg while the exit fee is flat silver, so the two orderings
            // differ as soon as a leg is charged. Same scorer as
            // findBestFlipPair (js/flip-route.js).
            let margin = typeof calculateFlipMargin === "function"
              ? calculateFlipMargin(buyP, sellP, exit).profit
              : sellP - buyP - exit;
            if (margin > maxMarginNet) {
              maxMarginNet = margin;
              bestBuyCity = bc;
              bestBuyPrice = buyP;
              bestSellCity = sc;
              bestSellPrice = sellP;
            }
          }
        }
      });
    }
  });

  const bestTravel = (bestBuyCity && typeof legBrecilienCost === "function")
    ? legBrecilienCost(bestBuyCity, bestSellCity, itemId, 1) : 0;
  return {
    buyCity: bestBuyCity,
    buyPrice: bestBuyPrice === Infinity ? 0 : bestBuyPrice,
    sellCity: bestSellCity,
    sellPrice: bestSellPrice,
    travelCost: bestTravel,
  };
}

// Find cheapest city to BUY a single item (volume check on buy side only).
// Returns { city, price, travelCost }.
//
// destCity (optional): where the bought item is headed (craft/sell city). When
// given, candidates are ranked by EFFECTIVE cost = price + Brecilien exit fee,
// so buying in Brecilien is only chosen when it still wins after the Travel
// Planner fee for hauling the item out. Omit it for plain cheapest-buy (the
// returned travelCost is then 0 and behaviour is unchanged).
// sideMode (Flipping): resolve the buy price from the buy-ORDER override field
// (not the active pick) so it stays independent of the same-city sell cell.
// 24h volume for one (itemId, city), manual entry first. Used by the route
// pickers' volume preference so a hand-typed volume ranks a city exactly like
// a fetched one (the rest of the app already reads volume this way — getMinVol,
// getCityVol).
function volumeAt(marketData, itemId, city) {
  return getOverrideVolume(itemId, city) ?? (marketData[itemId]?.[city]?.volume_24h || 0);
}

function findBestBuyCity(marketData, itemId, cities, minVolume, destCity, sideMode) {
  const exitFee = (c) =>
    typeof legBrecilienCost === "function" ? legBrecilienCost(c, destCity, itemId, 1) : 0;
  // In sideMode the buy override is the buy-order field; otherwise it's the
  // active pick. Used both as a price source and to bypass the volume gate.
  const hasOv = (c) => (sideMode
    ? getOverrideField(itemId, c, "buy")
    : getOverridePrice(itemId, c)) !== null;
  // Honour city force unconditionally so the picker (which sets only the
  // city, not a price) survives re-renders. Falls through if the forced
  // city is outside the caller's cities list (e.g. royal-only branch).
  const forced = getCityForce(itemId, "buy");
  if (forced && cities.includes(forced)) {
    const bounds = getIQRBounds(marketData[itemId]);
    const p = getBuyPrice(marketData[itemId], forced, bounds, itemId, sideMode);
    return { city: forced, price: p > 0 ? p : 0, travelCost: p > 0 ? exitFee(forced) : 0 };
  }
  const bounds = getIQRBounds(marketData[itemId]);
  // The volume gate is a PREFERENCE, not a hard filter: a city clearing
  // minVolume always outranks a thin one, but when NO city clears it we still
  // return the best-priced thin city instead of "no data". Monitor-captured
  // prices carry volume_24h = 0 by design (market-price-store.js), and thin
  // items (faction capes, artifacts, energies) trade far below 25/24h — gating
  // them out blanked whole rows that had a real order book. Vol/24h surfaces
  // the thinness. Same fix as crafting/enchanting/mounts.
  let best = { eff: Infinity, city: null, price: 0 };
  let thin = { eff: Infinity, city: null, price: 0 };
  cities.forEach((c) => {
    const p = getBuyPrice(marketData[itemId], c, bounds, itemId, sideMode);
    if (p <= 0) return;
    const eff = p + exitFee(c);
    const slot = volumeAt(marketData, itemId, c) >= minVolume || hasOv(c) ? best : thin;
    if (eff < slot.eff) { slot.eff = eff; slot.city = c; slot.price = p; }
  });
  const pick = best.city ? best : thin;
  return { city: pick.city, price: pick.city ? pick.price : 0, travelCost: pick.city ? exitFee(pick.city) : 0 };
}

// Find best city to SELL a single item (volume check on sell side only).
// Optionally excludes invalid cross-routes relative to excludeBuyCity.
// Returns { city, price, travelCost }.
//
// originCity (optional): where the goods are produced/held before sale. When
// given, candidates are ranked by NET proceeds = price - Brecilien exit fee,
// so selling IN Brecilien (free) competes fairly against selling elsewhere
// (which costs the Travel Planner fee to haul out). Omit it for plain
// highest-price selection (travelCost is then 0; behaviour unchanged).
// sideMode (Flipping): resolve the sell price from the sell-ORDER override
// field (not the active pick) so it stays independent of the same-city buy cell.
function findBestSellCity(marketData, itemId, cities, minVolume, excludeBuyCity, originCity, sideMode) {
  const exitFee = (c) =>
    typeof legBrecilienCost === "function" ? legBrecilienCost(originCity, c, itemId, 1) : 0;
  const hasOv = (c) => (sideMode
    ? getOverrideField(itemId, c, "sell")
    : getOverridePrice(itemId, c)) !== null;
  // Honour city force unconditionally so the picker (which sets only the
  // city, not a price) survives re-renders. Falls through if the forced
  // city is outside the caller's cities list (e.g. royal-only branch).
  const forced = getCityForce(itemId, "sell");
  if (forced && cities.includes(forced)) {
    const bounds = getIQRBounds(marketData[itemId]);
    const p = getSellPrice(marketData[itemId], forced, bounds, itemId, sideMode);
    return { city: forced, price: p > 0 ? p : 0, travelCost: p > 0 ? exitFee(forced) : 0 };
  }
  const bounds = getIQRBounds(marketData[itemId]);
  // Volume gate as a preference — see findBestBuyCity for the rationale.
  let best = { net: -Infinity, city: null, price: 0 };
  let thin = { net: -Infinity, city: null, price: 0 };
  cities.forEach((c) => {
    if (excludeBuyCity && isInvalidCrossRoute(excludeBuyCity, c)) return;
    const p = getSellPrice(marketData[itemId], c, bounds, itemId, sideMode);
    if (p <= 0) return;
    const net = p - exitFee(c);
    const slot = volumeAt(marketData, itemId, c) >= minVolume || hasOv(c) ? best : thin;
    if (net > slot.net) { slot.net = net; slot.city = c; slot.price = p; }
  });
  const pick = best.city ? best : thin;
  return { city: pick.city, price: pick.price, travelCost: pick.city ? exitFee(pick.city) : 0 };
}

// --- Quality Price Helpers (for rerolling) ---

// Synthetic override key for quality cells. The override store stays
// itemId→city→entry; for rerolling the "itemId" encodes quality so the same
// base item at Normal/Good/Outstanding/Excellent keeps INDEPENDENT overrides.
// Without this, an override on one quality bled onto every other quality of
// the item (and across the buy/sell sides, since qualities 2/3/4 are both a
// `from` and a `to`). '#' never appears in real item ids, so no collision.
function qualityOverrideKey(itemId, quality) {
  return quality == null ? itemId : `${itemId}#Q${quality}`;
}

function getQualityBuyPrice(qualityData, itemId, quality, city) {
  // The active per-quality override wins — same contract as getBuyPrice
  // (getOverridePrice returns whichever order the user marked active, so it
  // works in both Market and Instant mode). The quality key keeps each
  // quality's override isolated; the active-order read avoids the "edited in
  // Instant mode, value saved to the sell field, buy read ignored it" reset.
  const ov = getOverridePrice(qualityOverrideKey(itemId, quality), city, "buy");
  if (ov !== null) return ov;
  if (!qualityData?.[itemId]?.[quality]?.[city]) return 0;
  // Same leg rule as getBuyPrice (Instant falls back to the other side).
  return _bookLeg(qualityData[itemId][quality][city], "buy", getOrderType("buy"), null).price;
}

function getQualitySellPrice(qualityData, itemId, quality, city) {
  // Same gate as getSellPrice, for the quality-aware readers.
  if (city === "Black Market" && itemId
      && typeof isBlackMarketTradable === "function"
      && !isBlackMarketTradable(itemId)) {
    return 0;
  }
  const ov = getOverridePrice(qualityOverrideKey(itemId, quality), city, "sell");
  if (ov !== null) return ov;
  if (!qualityData?.[itemId]?.[quality]?.[city]) return 0;
  // Same leg rule as getSellPrice (Instant falls back to the other side).
  return _bookLeg(qualityData[itemId][quality][city], "sell", getOrderType("sell"), null).price;
}

function getQualityVolume(qualityData, itemId, quality, city) {
  return qualityData?.[itemId]?.[quality]?.[city]?.volume_24h || 0;
}
