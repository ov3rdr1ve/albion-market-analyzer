/**
 * The per-table City pick, and the one rule that decides where a row sells.
 *
 * The City picker (js/table-filters.js) used to filter rendered rows and
 * nothing more. That can only ever surface rows which ALREADY chose that city,
 * and a row keeps exactly one sell city — the best-margin one. Picking "Black
 * Market" therefore showed almost nothing: a city sale is quoted at the ask
 * while the Black Market is quoted at the bid (js/utils.js getSellPrice), so BM
 * loses most head-to-heads by a hair. Measured on a real scan, T6_BAG@1
 * (Caerleon ask 89,999 vs BM bid 88,410) and T6_BAG@3 named a city and
 * vanished under the pick, while @2 and @4 stayed — which reads as arbitrary.
 *
 * So a pick now RE-PRICES the table: while it is active every row sells at that
 * city, and the sell cell says so. It is view state, not a preference — held in
 * memory, never written to localStorage, gone the moment the picker goes back
 * to "All" (or Reset filters fires).
 *
 * Zone rules are untouched. A pick the row's craft/refine city cannot reach
 * (isInvalidCrossRoute — the Black Market is sellable from Caerleon alone) does
 * not bend them: the row is simply not built for that section, which is what
 * "the Caerleon section owns the Black Market routes" already meant.
 *
 * Browser global + Node export, like the other shared row-level modules.
 */

/**
 * Tables whose City pick re-prices the rows, and the sell-city list each one
 * searches. Refined bars are not Black-Market-traded, so the Refining /
 * Transports table offers CITIES while the craft tables offer SELL_CITIES
 * (which is CITIES + the Black Market).
 *
 * Flipping was deliberately absent here at first — "a flip row is a city PAIR,
 * so one pick cannot say which leg it means". That reasoning does not survive
 * contact with the table: Flipping is the one table carrying TWO pickers, Buy
 * City and Sell City, so each pick names its leg unambiguously. Filtering
 * instead of re-routing made whole items vanish from the board (reported: the
 * T5/T7 bags missing under a Black Market pick), because a row keeps exactly
 * one route and a best pair that happens to sell in Caerleon simply failed the
 * rendered-row filter, however good the Black Market's bid was.
 *
 * The lists are read lazily — js/data.js defines them as top-level `const`s,
 * which do NOT land on globalThis (classic scripts keep them in lexical scope),
 * so they are only reachable from a function body that runs after load.
 */
const REPRICE_CITY_LISTS = {
  "craft-planner-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  "crafting-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  "transport-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  "flipping-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  // Consumables routes exactly like the craft tables — one craft city, one sale
  // — and had the same bug for the same reason: a row keeps its best-margin
  // sell city, so filtering the rendered rows on a pick could only surface the
  // ones that had already chosen it, and "Black Market" emptied the table
  // instead of pricing the bid.
  "consumable-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  // The Volume table names ONE market per row — the argmax of volume_24h over
  // SELL_CITIES — so filtering on it asked "is this item's BUSIEST market the
  // picked one", not "did it trade there". T4_CAPEITEM_FW_LYMHURST (Black Market
  // 1,195 but Lymhurst 3,199) therefore vanished under a Black Market pick while
  // its T6–T8 siblings, which top at the BM, stayed — the cape-shaped twin of
  // the bag report above. Registered here, the pick instead re-expresses each row
  // at that city: its volume, its price, its name in the Top City cell.
  "volume-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  // Mounts source the baby, the feed and every saddler mat wherever they are
  // cheapest, so — like the tables above — a pick that only judged the rendered
  // rows could never say "price this whole table as if I shopped in Lymhurst".
  // Registered on both legs, the pick names where every input is bought and
  // where the grown/saddled result sells.
  "mounts-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  // Artifact Rolling keeps each artifact's best sell city, so a pick that only
  // filtered rendered rows hid every artifact selling best elsewhere (nothing
  // left to hand-price) and the group header's per-fragment economics kept the
  // best-anywhere prices. Registered, the pick prices every artifact there.
  "rolling-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
  // My Crafting List replays rows from the tables above, so its pick cannot
  // filter them for the same reason those tables stopped filtering: a row that
  // sold best elsewhere vanished instead of being priced at the pick. Its pick
  // re-prices each entry through its SOURCE table instead
  // (js/render-craft-list.js _clRepricedState), leaving the source on screen
  // exactly as its own pickers have it.
  "craft-list-table": () => (typeof SELL_CITIES !== "undefined" ? SELL_CITIES : []),
};

/**
 * The same, for the BUY leg. A table that routes both legs has one — and so does
 * a table whose materials are sourced wherever cheapest, because "price this
 * table as if I shopped in X" is exactly what the pick means there too.
 */
const REPRICE_BUY_CITY_LISTS = {
  "flipping-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // The Crafting Planner buys every material somewhere, so its Buy pick names
  // the city the whole row sources from (effectiveBuyCities below). The list is
  // fixed rather than pruned to the cities today's rows happen to name — the
  // same rule the sell side follows, and it also keeps the picker's <option>
  // nodes stable while a render is running.
  "craft-planner-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // Consumables buys every ingredient somewhere too, and its Buy pick names the
  // one market the whole row sources from (consumableBuyCities,
  // js/consumable-city-pick.js). Filtering instead passed a row when a SINGLE
  // ingredient happened to come from the picked city, which said nothing about
  // the route. Fixed list, not pruned to today's rows — same rule as the sell
  // side, and it keeps the picker's <option> nodes stable mid-render.
  "consumable-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // Mounts buy the baby, the feed and every saddler mat somewhere; the pick
  // names the one market the whole row shops in (js/mounts-city-pick.js).
  "mounts-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // Crafting buys its materials wherever cheapest — the pick pins that market
  // for every row (effectiveBuyCities), the twin of its registered sell leg.
  "crafting-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // The Refining / Transports buy leg (raw ore/herbes at the source city) is a
  // user pick too: it pins where the route buys its raws.
  "transport-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // Artifact Rolling buys its fragments wherever cheapest; the pick pins that
  // market for every meld.
  "rolling-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
  // My Crafting List — see its entry in REPRICE_CITY_LISTS above.
  "craft-list-table": () => (typeof CITIES !== "undefined" ? CITIES : []),
};

/** Does this table's City pick re-price its rows (vs merely filter them)? */
function tableRepricesOnCityPick(tableId) {
  return (
    Object.prototype.hasOwnProperty.call(REPRICE_CITY_LISTS, tableId) ||
    Object.prototype.hasOwnProperty.call(REPRICE_BUY_CITY_LISTS, tableId)
  );
}

/**
 * Every city this table's picker should offer, or null to keep the default
 * "prune to the cities the rendered rows already name".
 *
 * A re-pricing table must offer them all: pruning means a city that currently
 * wins no row can never be picked, which is exactly the Black Market case the
 * re-pricing exists for.
 */
function sellCityOptionsFor(tableId) {
  const get = REPRICE_CITY_LISTS[tableId];
  return get ? get() : null;
}

/** Buy-side twin of sellCityOptionsFor. */
function buyCityOptionsFor(tableId) {
  const get = REPRICE_BUY_CITY_LISTS[tableId];
  return get ? get() : null;
}

/** tableId → the city currently picked ("" / absent = All). */
const _tableSellCity = new Map();
/** tableId → the value the last filter pass saw, for change detection. */
const _tableSellCitySeen = new Map();

function setTableSellCity(tableId, city) {
  if (city) _tableSellCity.set(tableId, city);
  else _tableSellCity.delete(tableId);
}

function getTableSellCity(tableId) {
  return _tableSellCity.get(tableId) || null;
}

/**
 * Record the picker's current value and report whether it MOVED.
 *
 * The filter pass runs on every picker (text, tier, enchant, category, city),
 * but only a city change is worth a full recompute — the others re-filter the
 * DOM in microseconds while the Crafting Planner renderer costs seconds.
 *
 * @returns {boolean} true when this call changed the active pick
 */
function sellCityFilterChanged(tableId, city) {
  const next = city || "";
  const prev = _tableSellCitySeen.has(tableId) ? _tableSellCitySeen.get(tableId) : "";
  _tableSellCitySeen.set(tableId, next);
  setTableSellCity(tableId, next);
  return next !== prev;
}

/** tableId → the buy-leg city currently picked ("" / absent = All). */
const _tableBuyCity = new Map();
/** tableId → the buy value the last filter pass saw, for change detection. */
const _tableBuyCitySeen = new Map();

function setTableBuyCity(tableId, city) {
  if (city) _tableBuyCity.set(tableId, city);
  else _tableBuyCity.delete(tableId);
}

function getTableBuyCity(tableId) {
  return _tableBuyCity.get(tableId) || null;
}

/** Buy-side twin of sellCityFilterChanged. */
function buyCityFilterChanged(tableId, city) {
  const next = city || "";
  const prev = _tableBuyCitySeen.has(tableId) ? _tableBuyCitySeen.get(tableId) : "";
  _tableBuyCitySeen.set(tableId, next);
  setTableBuyCity(tableId, next);
  return next !== prev;
}

/** Test/reset seam: forget every pick (also used by Reset filters paths). */
function clearTableSellCities() {
  _tableSellCity.clear();
  _tableSellCitySeen.clear();
  _tableBuyCity.clear();
  _tableBuyCitySeen.clear();
}

/** Tables being rendered off screen by withTableCityPicks, right now. */
const _shadowRenderTables = new Set();

/**
 * Is `tableId` being rendered off screen? renderTableData (js/app-cells.js)
 * stores the rows but leaves the table's DOM alone while this is true.
 */
function isTableShadowRender(tableId) {
  return _shadowRenderTables.has(tableId);
}

/**
 * Run `fn` with `tableId`'s City picks temporarily set to `picks`, as an off
 * screen render: the picks are restored afterwards whatever `fn` does, and the
 * table's DOM is not painted meanwhile.
 *
 * This is how My Crafting List prices an entry at the list's own pick without
 * moving the source table's pickers — the source's own pick is view state the
 * user set on THAT table, and the list must not repaint it behind their back.
 * Only the active picks are swapped; the change detectors (the *Seen maps) are
 * untouched, so the source's next filter pass still sees its own value.
 *
 * @param {string} tableId
 * @param {{sell?: string|null, buy?: string|null}} picks  null/absent = All
 * @param {Function} fn
 * @returns {*} whatever `fn` returns
 */
function withTableCityPicks(tableId, picks, fn) {
  const prevSell = getTableSellCity(tableId);
  const prevBuy = getTableBuyCity(tableId);
  const wasShadow = _shadowRenderTables.has(tableId);
  setTableSellCity(tableId, (picks && picks.sell) || null);
  setTableBuyCity(tableId, (picks && picks.buy) || null);
  _shadowRenderTables.add(tableId);
  try {
    return fn();
  } finally {
    setTableSellCity(tableId, prevSell);
    setTableBuyCity(tableId, prevBuy);
    if (!wasShadow) _shadowRenderTables.delete(tableId);
  }
}

/**
 * Which sell cities a row may search, in one place for every table that has a
 * City picker.
 *
 * Precedence:
 *   1. the table's active City pick, when `fromCity` can reach it — the user is
 *      explicitly asking "price this table at X", so it outranks a per-item pin;
 *   2. else a reachable per-item sell force (`getCityForce(id, "sell")`) — the
 *      pin a typed override leaves behind, today's behaviour, unchanged;
 *   3. else the caller's full list.
 *
 * An ACTIVE pick that `fromCity` cannot reach returns `[]`: there is no honest
 * row to build for that section, and the caller skips it rather than emitting a
 * blank. Callers pass their own `allCities` because the lists differ — refined
 * bars are not Black-Market-traded, so the Refining / Transports table searches
 * CITIES while the craft tables search SELL_CITIES.
 *
 * @param {string} tableId
 * @param {string} fromCity          craft / refine city the goods start in
 * @param {string|null} forcedSellCity  per-item sell pin, or null
 * @param {string[]} allCities       the table's own unfiltered sell-city list
 * @returns {string[]}
 */
function effectiveSellCities(tableId, fromCity, forcedSellCity, allCities) {
  const unreachable = (city) =>
    typeof isInvalidCrossRoute === "function" && isInvalidCrossRoute(fromCity, city);
  const pick = getTableSellCity(tableId);
  if (pick) {
    if (!Array.isArray(allCities) || !allCities.includes(pick)) return [];
    return unreachable(pick) ? [] : [pick];
  }
  if (forcedSellCity && !unreachable(forcedSellCity)) return [forcedSellCity];
  return allCities;
}

/**
 * Which cities a row may BUY from, given the table's Buy City pick.
 *
 * The buy-side twin of effectiveSellCities, and deliberately the same shape: no
 * pick means "the caller's own list", exactly today's behaviour, so a table that
 * never grows a Buy picker cannot notice this exists.
 *
 * An ACTIVE pick that `fromCity` cannot source from (isValidSourceCity — the
 * Caerleon/royal split, plus the black-zone cities) returns `[]`. The caller
 * then has no material source and drops the row, rather than quietly buying
 * somewhere the pick did not name.
 *
 * @param {string} tableId
 * @param {string} fromCity   craft / refine city the materials must reach
 * @param {string[]} allCities  the caller's own unfiltered buy-city list
 * @returns {string[]}
 */
function effectiveBuyCities(tableId, fromCity, allCities) {
  const list = Array.isArray(allCities) ? allCities : [];
  const pick = getTableBuyCity(tableId);
  if (!pick) return list;
  if (!list.includes(pick)) return [];
  const reachable = typeof isValidSourceCity !== "function"
    || isValidSourceCity(pick, fromCity);
  return reachable ? [pick] : [];
}

/**
 * Which cities one LEG of a flip may search, given the table's pick for that
 * side.
 *
 * Deliberately simpler than effectiveSellCities: a flip has no craft city to
 * start from, and findBestFlipPair already drops the pairs the zone rules bar
 * (isInvalidCrossRoute, js/flip-route.js). So this only has to answer "which
 * cities is this leg allowed to consider". Artifact Rolling has the same shape
 * — no craft city, one buy leg (fragments) and one sell leg (the artifact) per
 * section — and narrows both through this too.
 *
 * A pick outside `allCities` returns [] — that section of the table cannot
 * honour it (the royal section can never sell at the Black Market), and the
 * caller drops the row rather than emitting a route that ignores the pick.
 *
 * @param {string} tableId
 * @param {"buy"|"sell"} side
 * @param {string[]} allCities  the caller's own unfiltered list for this leg
 * @returns {string[]}
 */
function effectiveFlipCities(tableId, side, allCities) {
  const list = Array.isArray(allCities) ? allCities : [];
  const pick = side === "buy" ? getTableBuyCity(tableId) : getTableSellCity(tableId);
  if (!pick) return list;
  return list.includes(pick) ? [pick] : [];
}

/**
 * Did the table's City pick override a per-item sell pin on this row?
 * The planner surfaces it under the sell price so an override that stops
 * applying is never silent — see _cpSellPinNote in js/render-craft-planner.js.
 */
function sellPinOverriddenByFilter(tableId, fromCity, forcedSellCity) {
  const pick = getTableSellCity(tableId);
  if (!pick || !forcedSellCity || forcedSellCity === pick) return null;
  return forcedSellCity;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    REPRICE_CITY_LISTS,
    REPRICE_BUY_CITY_LISTS,
    tableRepricesOnCityPick,
    sellCityOptionsFor,
    buyCityOptionsFor,
    setTableSellCity,
    getTableSellCity,
    sellCityFilterChanged,
    setTableBuyCity,
    getTableBuyCity,
    buyCityFilterChanged,
    clearTableSellCities,
    effectiveSellCities,
    effectiveBuyCities,
    effectiveFlipCities,
    sellPinOverriddenByFilter,
    isTableShadowRender,
    withTableCityPicks,
  };
  // Browsers load this with a plain <script> tag; mirror the globals for Node so
  // the modules that probe `typeof sellCityOptionsFor === "function"` behave the
  // same under test as they do in the page.
  if (typeof globalThis !== "undefined") {
    globalThis.tableRepricesOnCityPick = tableRepricesOnCityPick;
    globalThis.sellCityOptionsFor = sellCityOptionsFor;
    globalThis.buyCityOptionsFor = buyCityOptionsFor;
    globalThis.setTableSellCity = setTableSellCity;
    globalThis.getTableSellCity = getTableSellCity;
    globalThis.sellCityFilterChanged = sellCityFilterChanged;
    globalThis.setTableBuyCity = setTableBuyCity;
    globalThis.getTableBuyCity = getTableBuyCity;
    globalThis.buyCityFilterChanged = buyCityFilterChanged;
    globalThis.clearTableSellCities = clearTableSellCities;
    globalThis.effectiveSellCities = effectiveSellCities;
    globalThis.effectiveBuyCities = effectiveBuyCities;
    globalThis.effectiveFlipCities = effectiveFlipCities;
    globalThis.sellPinOverriddenByFilter = sellPinOverriddenByFilter;
    globalThis.isTableShadowRender = isTableShadowRender;
    globalThis.withTableCityPicks = withTableCityPicks;
  }
}
