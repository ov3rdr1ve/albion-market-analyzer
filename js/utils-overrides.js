// Split from js/utils.js: manual price / volume / city-force override stores.
// Loads right after utils.js; getBuyPrice / getSellPrice read these at call time.

// ─── Price Override System ─────────────────────────────────────────────────
// Stores manually entered prices per (itemId, city) as:
//   { itemId: { city: { buyOrder, sellOrder, use } } }
// buyOrder / sellOrder hold the two market prices (buy_price / sell_price) the
// user typed; `use` says which one is ACTIVE:
//
//   "auto"  follow the global Instant/Market toggle, exactly as an unedited
//           cell does — buying reads the ask under Instant and the bid under
//           Market Orders, selling the other way round, at every city
//           including the Black Market. This is the default for an entry that
//           carries both prices.
//   "buy" / "sell"
//           PIN this entry to that one field, whatever the toggle says. That is
//           how you value a single material at its ask to model an instant buy
//           while everything else stays on market orders.
//
// The pin used to be the only mode, and it was written automatically whenever
// the user typed a price — so switching the app to Instant Buy left every cell
// they had ever edited still priced off buy orders, with no way back short of
// clearing the override. That is the reported "in some tables I can't switch
// to instant buy" bug; see migrateOverridesToAuto below for what happens to
// entries saved under the old rule.
//
// An entry is only meaningful when it can produce a value; otherwise it's
// treated as "no override". Persisted in localStorage.
const OVERRIDE_SCHEMA_VERSION = "2"; // bump to clear stale overrides from older code
// Set once the pre-"auto" entries have been migrated. Deliberately NOT a schema
// bump: that path deletes the overrides, and these are hand-typed data.
const OVERRIDE_AUTO_MIGRATION_KEY = "priceOverridesAutoMigrated";
let priceOverrides = {};

// Normalize one stored entry to { buyOrder, sellOrder, use }. Accepts the
// legacy single-value shape { price: N } (used everywhere pre-split) and the
// interim { buyOrder, sellOrder } shape (no `use`). Returns null when no usable
// value is present. An entry with both prices and no explicit pick follows the
// toggle ("auto"); one that carries a single price pins to it, because there is
// nothing for the toggle to choose between.
function normalizeOverrideEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  if (typeof entry.buyOrder === "number") out.buyOrder = entry.buyOrder;
  if (typeof entry.sellOrder === "number") out.sellOrder = entry.sellOrder;
  if (typeof entry.price === "number") {
    if (out.buyOrder === undefined) out.buyOrder = entry.price;
    if (out.sellOrder === undefined) out.sellOrder = entry.price;
  }
  if (out.buyOrder === undefined && out.sellOrder === undefined) return null;
  const bothSides = out.buyOrder !== undefined && out.sellOrder !== undefined;
  if (entry.use === "buy" || entry.use === "sell" || entry.use === "auto") {
    out.use = entry.use;
  } else {
    out.use = bothSides ? "auto" : (out.buyOrder !== undefined ? "buy" : "sell");
  }
  if (out.use === "buy" && out.buyOrder === undefined) out.use = "sell";
  if (out.use === "sell" && out.sellOrder === undefined) out.use = "buy";
  return out;
}

// Write/replace the full override entry for (itemId, city). Keeps only positive
// field values and a valid `use`; if nothing the entry could resolve to has a
// value it is dropped (treated as cleared) so existence checks stay accurate.
function setOverrideEntry(itemId, city, { buyOrder, sellOrder, use }) {
  if (!priceOverrides[itemId]) priceOverrides[itemId] = {};
  const e = {};
  if (typeof buyOrder === "number" && buyOrder > 0) e.buyOrder = buyOrder;
  if (typeof sellOrder === "number" && sellOrder > 0) e.sellOrder = sellOrder;
  if (use === "buy" || use === "sell" || use === "auto") e.use = use;
  const activePresent = e.use === "buy" ? e.buyOrder !== undefined
    : e.use === "sell" ? e.sellOrder !== undefined
      : e.use === "auto" ? (e.buyOrder !== undefined || e.sellOrder !== undefined)
        : false;
  if (activePresent) priceOverrides[itemId][city] = e;
  else delete priceOverrides[itemId][city];
  saveOverridesToStorage();
}

// Remove the whole override for (itemId, city).
function clearOverridePrice(itemId, city) {
  if (priceOverrides[itemId]) {
    delete priceOverrides[itemId][city];
    saveOverridesToStorage();
  }
}

// Remove every override for an item, at ALL cities. This is what the editor's ✗
// means. Nothing reads an override per city: every table picks its city globally
// (findBestBuyCity / findBestSellCity) and an override at ANY city bypasses the
// volume gate, so deleting only the city the cell rendered just promoted the next
// city's entry — the ⚡ stayed and the user had to click ✗ once per city they had
// ever edited.
// Returns whether anything was actually deleted, so a caller can tell a clear
// that changed the numbers from one that only closed the popup (js/app.js — a ✗
// on a cell that carried no override must not cost a re-render).
function clearOverridePriceAllCities(itemId) {
  if (!priceOverrides[itemId]) return false;
  delete priceOverrides[itemId];
  saveOverridesToStorage();
  return true;
}

// Read one raw stored field (buy-order / sell-order price) regardless of which
// is active — used to prefill the editor inputs.
function getOverrideField(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
}

// Which order is active for (itemId, city): "auto" | "buy" | "sell" | null.
// "auto" means "whichever the Pricing Model toggle implies" — see
// resolveOverrideSide for what that resolves to.
function getOverrideUse(itemId, city) {
  return priceOverrides[itemId]?.[city]?.use ?? null;
}

// Which FIELD an entry reads for a given calling side. A pin answers itself; an
// "auto" entry answers the same way an unedited cell would — the ask when
// buying under Instant, the bid when buying under Market Orders, mirrored on
// the sell side. The Black Market is no exception: it takes sell orders too.
function resolveOverrideSide(entry, city, side) {
  if (!entry || !entry.use) return null;
  if (entry.use !== "auto") return entry.use;
  const instant = getOrderType(side === "sell" ? "sell" : "buy") === "instant";
  if (side === "sell") return instant ? "buy" : "sell";
  return instant ? "sell" : "buy";
}

// The ACTIVE override price for (itemId, city), or null when there's no active
// override. This is the single source every price read uses — getBuyPrice,
// getSellPrice, volume gates, the dropdown, and "has override" highlights all
// go through it.
//
// `side` ("buy" | "sell") is the calling context and only matters for an "auto"
// entry; a pinned one ignores it, which is the whole point of a pin. It
// defaults to the buy side so the existence checks that call this with two
// arguments keep working unchanged.
function getOverridePrice(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e || !e.use) return null;
  const pick = resolveOverrideSide(e, city, side);
  const v = pick === "buy" ? e.buyOrder : e.sellOrder;
  if (typeof v === "number") return v;
  // An "auto" entry that only carries one of the two prices falls back to it
  // rather than reading as "no override" half the time.
  if (e.use !== "auto") return null;
  const other = pick === "buy" ? e.sellOrder : e.buyOrder;
  return typeof other === "number" ? other : null;
}

// getOverrideField for the Flipping table's side-specific reads: a PINNED entry
// still answers with the field asked for, an "auto" one has no side to pin and
// follows the toggle like every other read.
function getOverrideSidePrice(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e) return null;
  if (e.use === "auto") return getOverridePrice(itemId, city, side);
  return getOverrideField(itemId, city, side);
}

/**
 * One-shot migration of the entries saved before "auto" existed.
 *
 * `use` used to be written automatically from whatever the Pricing Model
 * toggle happened to say when the user typed a price, so a stored "buy" is
 * almost never a deliberate pin — and it made those cells ignore the toggle
 * forever. Entries carrying BOTH prices go to "auto", which is what the user
 * means by "this cell is worth X and Y"; single-price entries keep their pin,
 * because there is nothing for the toggle to pick between. A pin the user sets
 * from the editor after this runs is written explicitly and stays.
 */
function migrateOverridesToAuto(storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return false;
  try {
    if (store.getItem(OVERRIDE_AUTO_MIGRATION_KEY) === "1") return false;
    let touched = false;
    Object.values(priceOverrides).forEach((cities) => {
      Object.values(cities || {}).forEach((e) => {
        if (!e || e.use === "auto") return;
        if (typeof e.buyOrder === "number" && typeof e.sellOrder === "number") {
          e.use = "auto";
          touched = true;
        }
      });
    });
    store.setItem(OVERRIDE_AUTO_MIGRATION_KEY, "1");
    if (touched) saveOverridesToStorage();
    return touched;
  } catch (e) {
    return false;
  }
}

function saveOverridesToStorage() {
  localStorage.setItem("priceOverrides", JSON.stringify(priceOverrides));
}

function loadOverridesFromStorage() {
  try {
    if (
      localStorage.getItem("priceOverridesVersion") !== OVERRIDE_SCHEMA_VERSION
    ) {
      localStorage.removeItem("priceOverrides");
      localStorage.setItem("priceOverridesVersion", OVERRIDE_SCHEMA_VERSION);
      return;
    }
    const raw = localStorage.getItem("priceOverrides");
    if (!raw) return;
    const stored = JSON.parse(raw);
    for (const [itemId, cities] of Object.entries(stored)) {
      for (const [city, entry] of Object.entries(cities)) {
        const norm = normalizeOverrideEntry(entry);
        if (norm) {
          if (!priceOverrides[itemId]) priceOverrides[itemId] = {};
          priceOverrides[itemId][city] = norm;
        }
      }
    }
    migrateOverridesToAuto();
  } catch (e) {
    /* ignore corrupt storage */
  }
}

// ─── Volume Override System ───────────────────────────────────────────────
// Stores manually entered volumes: { itemId: { city: { volume } } }
// Persisted in localStorage.
const VOLUME_OVERRIDE_SCHEMA_VERSION = "2";
let volumeOverrides = {};

function setOverrideVolume(itemId, city, volume) {
  if (!volumeOverrides[itemId]) volumeOverrides[itemId] = {};
  volumeOverrides[itemId][city] = { volume };
  saveVolumeOverridesToStorage();
}

function getOverrideVolume(itemId, city) {
  const entry = volumeOverrides[itemId]?.[city];
  return entry ? entry.volume : null;
}

function saveVolumeOverridesToStorage() {
  localStorage.setItem("volumeOverrides", JSON.stringify(volumeOverrides));
}

function loadVolumeOverridesFromStorage() {
  try {
    if (localStorage.getItem("volumeOverridesVersion") !== VOLUME_OVERRIDE_SCHEMA_VERSION) {
      localStorage.removeItem("volumeOverrides");
      localStorage.setItem("volumeOverridesVersion", VOLUME_OVERRIDE_SCHEMA_VERSION);
      return;
    }
    const raw = localStorage.getItem("volumeOverrides");
    if (!raw) return;
    const stored = JSON.parse(raw);
    for (const [itemId, cities] of Object.entries(stored)) {
      for (const [city, entry] of Object.entries(cities)) {
        if (entry && typeof entry.volume === "number") {
          if (!volumeOverrides[itemId]) volumeOverrides[itemId] = {};
          volumeOverrides[itemId][city] = entry;
        }
      }
    }
  } catch (e) {
    /* ignore corrupt storage */
  }
}

// ─── City Force Override System ──────────────────────────────────────────────
// Forces a specific city for buy/sell side calculations: { itemId: { buy: "city", sell: "city" } }
let cityForceOverrides = {};

function setCityForce(itemId, side, city) {
  if (!cityForceOverrides[itemId]) cityForceOverrides[itemId] = {};
  cityForceOverrides[itemId][side] = city;
  saveCityForcesToStorage();
}

function getCityForce(itemId, side) {
  return cityForceOverrides[itemId]?.[side] ?? null;
}

/** Returns whether a force was really removed — see clearOverridePriceAllCities. */
function clearCityForce(itemId, side) {
  if (cityForceOverrides[itemId] && cityForceOverrides[itemId][side] !== undefined) {
    delete cityForceOverrides[itemId][side];
    saveCityForcesToStorage();
    return true;
  }
  return false;
}

function saveCityForcesToStorage() {
  localStorage.setItem("cityForceOverrides", JSON.stringify(cityForceOverrides));
}

function loadCityForcesFromStorage() {
  try {
    const raw = localStorage.getItem("cityForceOverrides");
    if (raw) cityForceOverrides = JSON.parse(raw);
  } catch { cityForceOverrides = {}; }
}
