/**
 * My Crafting List — the persisted set of rows the user picked off the profit
 * tables with the "+" column.
 *
 * An entry is a REFERENCE, never a snapshot:
 *
 *   { tableId, rowKey, itemId, qty, addedAt }
 *
 * The list panel re-renders each entry through its source table's own row
 * formatter (tableState[tableId].formatter), so prices, overrides, focus,
 * premium and city settings stay in sync with the tables for free — a snapshot
 * would go stale the moment any of those changed.
 *
 * `rowKey` is the table's own getRowKey() (js/sorting.js), which encodes the
 * buy/craft city and zone section; a price swing that moves the winning city
 * changes it. MEMBERSHIP therefore keys on craftListIdentity() — the row key
 * with its city volatility collapsed (royal city segments dropped, a Caerleon /
 * Black Market route segment reduced to a literal `caerleon` tag) — while
 * `rowKey` stays as the DOM anchor and `itemId` as the last-resort matcher
 * (see js/render-craft-list.js).
 *
 * Storage mirrors the js/utils.js override stores: whole-list JSON under one
 * key, gated by a schema-version key so a shape change wipes rather than
 * misreads.
 */

const CRAFT_LIST_KEY = "craftingList";
const CRAFT_LIST_VERSION_KEY = "craftingListVersion";
const CRAFT_LIST_SCHEMA_VERSION = "1";
/** Sanity cap — a quantity is a crafting plan, not a number the user fat-fingered. */
const CRAFT_LIST_MAX_QTY = 1000000;

/** The list, in the order rows were added. */
let craftList = [];

/** Test seam: undefined = use the ambient localStorage, null = no persistence. */
let _craftListStorage;

function setCraftListStorage(storage) {
  _craftListStorage = storage;
}

function clStorage() {
  if (_craftListStorage !== undefined) return _craftListStorage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (e) {
    return null; // private mode / no DOM
  }
}

function craftListEntryId(tableId, rowKey) {
  return `${tableId}::${rowKey}`;
}

/**
 * Every market name, for stripping city segments out of a row key. The live
 * list comes from js/data.js (CITIES + the Black Market); this literal is the
 * fallback for the Node tests, which load this module on its own.
 */
const CRAFT_LIST_CITY_NAMES = [
  "Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien", "Smuggler's Den", "Black Market",
];

function craftListCitySet() {
  const names = (typeof CITIES !== "undefined" && Array.isArray(CITIES))
    ? [...CITIES, "Black Market"]
    : CRAFT_LIST_CITY_NAMES;
  return new Set(names);
}

/** The city names that mean the Caerleon / Black Market route, not a royal one. */
const CRAFT_LIST_CAERLEON_FAMILY = new Set(["Caerleon", "Black Market"]);

/**
 * Which route family a city segment belongs to: "caerleon" for the Caerleon /
 * Black Market route, "royal" for every other market, null when the segment is
 * not a city at all. Same exact, case-sensitive matching as the strip-list.
 */
function cityRouteFamily(segment, cities) {
  if (!cities.has(segment)) return null;
  return CRAFT_LIST_CAERLEON_FAMILY.has(segment) ? "caerleon" : "royal";
}

/**
 * Whether a row key routes through the Caerleon / Black Market side of the
 * split: any `|`-segment is a caerleon-family city. Same exact, case-sensitive
 * matching as the strip-list. The render-side item-id fallback reads this to
 * prefer an entry's own route, crossing only when that route has no row for
 * the item at all (js/render-craft-list.js).
 */
function craftListRowRouteIsCaerleon(rowKey) {
  return String(rowKey == null ? "" : rowKey)
    .split("|")
    .some((seg) => CRAFT_LIST_CAERLEON_FAMILY.has(seg));
}

/**
 * What the list means by "this row" — the row key with its VOLATILE parts gone.
 *
 * getRowKey (js/sorting.js) bakes the winning city into the key: `craftCity`
 * for crafting / planner / consumables / mounts, `refineCity` for transport.
 * Prices move that city, so the same row comes back under a different key after
 * a restart or a price swing. Keying membership on the raw key made the "+"
 * button paint "+" on a row that was already on the list, and the next click
 * pushed a SECOND entry for the same item — which then rendered twice and was
 * counted twice in the totals and the shopping list.
 *
 * City segments collapse by ROUTE family, not all alike. A royal-to-royal move
 * is drift — the winning royal city moves with prices — so every non-caerleon
 * market segment is dropped outright. But the same item legitimately renders
 * twice, once per route, and the Caerleon / Black Market route must not merge
 * with the royal one: a caerleon-family segment is replaced by a literal
 * `caerleon` tag kept in its slot, so `T6_BAG|Caerleon` and `T6_BAG|Black
 * Market` share the identity `T6_BAG|caerleon` while `T6_BAG|Martlock` stays
 * just `T6_BAG` — one entry per route, never two, never one.
 *
 * Empty segments are dropped for the same drift reason: a row with no winning
 * city yet (nothing priced) keys as `T6_BAG|`, the priced one as `T6_BAG|Martlock`.
 * Both must resolve to `T6_BAG`, which is exactly the restart case.
 *
 * Everything else — item id, section, variant, transition label — survives, so
 * rows that are genuinely different stay different.
 */
function craftListIdentity(tableId, rowKey) {
  const cities = craftListCitySet();
  const rest = String(rowKey == null ? "" : rowKey)
    .split("|")
    .flatMap((seg) => {
      if (seg === "") return [];
      const family = cityRouteFamily(seg, cities);
      if (family === null) return [seg];
      return family === "caerleon" ? ["caerleon"] : [];
    });
  return `${tableId}::${rest.join("|")}`;
}

/**
 * The expression parser, as a browser global or a Node require — the same
 * resolution js/craft-list-extractors.js and js/craft-list-materials.js use for
 * their own siblings. Returns null when it cannot be reached, which leaves the
 * quantity field behaving exactly as it did before expressions existed.
 */
function _clQtyExprParser() {
  if (typeof parseQtyExpression === "function") return parseQtyExpression;
  if (typeof require === "function") {
    try { return require("./craft-list-qty-expr.js").parseQtyExpression; }
    catch (e) { return null; }
  }
  return null;
}

/**
 * A quantity is a plan, and 0 is a legitimate plan: it PARKS the row — the
 * entry (and its click-to-edit prices) stays on the list while contributing
 * nothing to the totals or the shopping board.
 *
 * Only an UNREADABLE quantity falls back to 1, and that is the "+" button's
 * case: `addCraftListEntry` passes no qty at all, which means "add one of
 * these", never "park one of these". Note `Number("") === 0`, so a cleared
 * quantity box commits as 0 — which is exactly what an emptied field means now.
 */
function normalizeCraftQty(value) {
  // Explicitly, not via Number(): `Number(null)` is 0, and a null quantity is
  // an ABSENT one (the same as undefined), never a park.
  if (value === null || value === undefined) return 1;
  // A typed quantity may be arithmetic — "two runs of 96" is entered as
  // `96+96` (js/craft-list-qty-expr.js). An unparseable text falls straight
  // through to the coercion below, so nothing about `""`, `"abc"` or a plain
  // number moves.
  if (typeof value === "string") {
    const parseExpr = _clQtyExprParser();
    const evaluated = parseExpr ? parseExpr(value) : null;
    if (evaluated !== null) value = evaluated;
  }
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  return Math.min(n, CRAFT_LIST_MAX_QTY);
}

/** Coerce one raw/stored record into an entry; null when it can't identify a row. */
function normalizeCraftListEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tableId = String(raw.tableId || "");
  const rowKey = String(raw.rowKey || "");
  if (!tableId || !rowKey) return null;
  return {
    tableId,
    rowKey,
    itemId: String(raw.itemId || ""),
    qty: normalizeCraftQty(raw.qty),
    addedAt: Number(raw.addedAt) || Date.now(),
  };
}

function getCraftList() {
  return craftList.slice();
}

/**
 * Where a row sits on the list. The exact key wins, so two rows that differ
 * only by an exact key (and share an identity) each keep their own entry; the
 * identity match is the fallback that survives a moved city.
 */
function craftListIndex(tableId, rowKey) {
  const id = craftListEntryId(tableId, rowKey);
  const exact = craftList.findIndex((e) => craftListEntryId(e.tableId, e.rowKey) === id);
  if (exact !== -1) return exact;
  const ident = craftListIdentity(tableId, rowKey);
  return craftList.findIndex((e) => craftListIdentity(e.tableId, e.rowKey) === ident);
}

function hasCraftListEntry(tableId, rowKey) {
  return craftListIndex(tableId, rowKey) !== -1;
}

/**
 * Add a row. Re-adding an existing row is a no-op that KEEPS its quantity —
 * the "+" button reads as "is this row on my list", so a stray second click
 * must not reset a plan the user typed a quantity into.
 */
function addCraftListEntry(raw) {
  const entry = normalizeCraftListEntry(raw);
  if (!entry) return null;
  const at = craftListIndex(entry.tableId, entry.rowKey);
  if (at !== -1) {
    // Re-point the DOM anchor at the key the table is using NOW (the winning
    // city may have moved), and refresh the fallback matcher. Quantity and
    // position stay put — the "+" reads as "is this row on my list", so a stray
    // second click must not reset a plan the user typed a quantity into.
    craftList[at].rowKey = entry.rowKey;
    if (entry.itemId) craftList[at].itemId = entry.itemId;
    saveCraftListToStorage();
    return craftList[at];
  }
  craftList.push(entry);
  saveCraftListToStorage();
  return entry;
}

function removeCraftListEntry(tableId, rowKey) {
  const at = craftListIndex(tableId, rowKey);
  if (at === -1) return false;
  craftList.splice(at, 1);
  saveCraftListToStorage();
  return true;
}

/** @returns {boolean} true when the row is now ON the list. */
function toggleCraftListEntry(raw) {
  const entry = normalizeCraftListEntry(raw);
  if (!entry) return false;
  if (hasCraftListEntry(entry.tableId, entry.rowKey)) {
    removeCraftListEntry(entry.tableId, entry.rowKey);
    return false;
  }
  addCraftListEntry(entry);
  return true;
}

function setCraftListQty(tableId, rowKey, qty) {
  const at = craftListIndex(tableId, rowKey);
  if (at === -1) return false;
  craftList[at].qty = normalizeCraftQty(qty);
  saveCraftListToStorage();
  return true;
}

function clearCraftList() {
  craftList = [];
  saveCraftListToStorage();
}

/**
 * Whether the last write to storage failed (quota, private mode). The panel
 * shows it: a list that silently stops saving looks exactly like a list that
 * got wiped, and the user only finds out after the next restart.
 */
let craftListSaveFailed = false;

function craftListSaveFailedFlag() {
  return craftListSaveFailed;
}

function saveCraftListToStorage() {
  const storage = clStorage();
  if (!storage) return;
  try {
    storage.setItem(CRAFT_LIST_KEY, JSON.stringify(craftList));
    storage.setItem(CRAFT_LIST_VERSION_KEY, CRAFT_LIST_SCHEMA_VERSION);
    craftListSaveFailed = false;
  } catch (e) {
    craftListSaveFailed = true;
    console.warn("Failed to save the crafting list", e);
  }
}

// ─── Focus budget ───────────────────────────────────────────────────────────
//
// How much focus the plan may spend. Premium regenerates ~10,000 a day, which
// is the default and the same yardstick the footer used to quote as a fixed
// "days at 10,000/day" hint — but a player sitting on a banked pool (capped at
// 30,000) can type that instead. Everything the budget cannot cover is priced
// at the base return rate (js/craft-list-focus-budget.js).
const CRAFT_LIST_FOCUS_BUDGET_KEY = "craftListFocusBudget";
const CRAFT_LIST_DEFAULT_FOCUS_BUDGET = 10000;
/** A day's regen × the pool cap × a wide margin — a budget, not a typo. */
const CRAFT_LIST_MAX_FOCUS_BUDGET = 10000000;

function normalizeCraftFocusBudget(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return CRAFT_LIST_DEFAULT_FOCUS_BUDGET;
  if (n < 0) return 0;
  return Math.min(n, CRAFT_LIST_MAX_FOCUS_BUDGET);
}

function getCraftListFocusBudget() {
  const storage = clStorage();
  if (!storage) return CRAFT_LIST_DEFAULT_FOCUS_BUDGET;
  try {
    const raw = storage.getItem(CRAFT_LIST_FOCUS_BUDGET_KEY);
    if (raw === null || raw === "") return CRAFT_LIST_DEFAULT_FOCUS_BUDGET;
    return normalizeCraftFocusBudget(raw);
  } catch (e) {
    return CRAFT_LIST_DEFAULT_FOCUS_BUDGET;
  }
}

/** @returns {number} the value actually stored, after normalization. */
function setCraftListFocusBudget(value) {
  const n = normalizeCraftFocusBudget(value);
  const storage = clStorage();
  if (storage) {
    try { storage.setItem(CRAFT_LIST_FOCUS_BUDGET_KEY, String(n)); }
    catch (e) { console.warn("Failed to save the crafting list focus budget", e); }
  }
  return n;
}

function loadCraftListFromStorage() {
  const storage = clStorage();
  if (!storage) return craftList;
  try {
    if (storage.getItem(CRAFT_LIST_VERSION_KEY) !== CRAFT_LIST_SCHEMA_VERSION) {
      storage.removeItem(CRAFT_LIST_KEY);
      storage.removeItem(CRAFT_LIST_VERSION_KEY);
      craftList = [];
      return craftList;
    }
    const raw = storage.getItem(CRAFT_LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    craftList = Array.isArray(parsed)
      ? parsed.map(normalizeCraftListEntry).filter(Boolean)
      : [];
  } catch (e) {
    console.warn("Failed to load the crafting list", e);
    craftList = [];
  }
  return craftList;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CRAFT_LIST_KEY,
    CRAFT_LIST_VERSION_KEY,
    CRAFT_LIST_SCHEMA_VERSION,
    CRAFT_LIST_MAX_QTY,
    CRAFT_LIST_FOCUS_BUDGET_KEY,
    CRAFT_LIST_DEFAULT_FOCUS_BUDGET,
    CRAFT_LIST_MAX_FOCUS_BUDGET,
    normalizeCraftFocusBudget,
    getCraftListFocusBudget,
    setCraftListFocusBudget,
    setCraftListStorage,
    craftListEntryId,
    craftListIdentity,
    craftListRowRouteIsCaerleon,
    craftListSaveFailedFlag,
    normalizeCraftQty,
    normalizeCraftListEntry,
    getCraftList,
    hasCraftListEntry,
    addCraftListEntry,
    removeCraftListEntry,
    toggleCraftListEntry,
    setCraftListQty,
    clearCraftList,
    saveCraftListToStorage,
    loadCraftListFromStorage,
  };
}
