/**
 * Settings export/import bundle — what travels between two installs.
 *
 * The old export was the bare priceOverrides map, so everything else the user
 * had typed or levelled stayed behind: volume overrides, pinned buy/sell
 * cities, ⚙ Specs levels, mapped Roads portals and the header toggles.
 *
 * Bundle versions:
 *   v1  the bare { itemId: { city: entry } } price map (no wrapper)
 *   v2  { format, version, overrides, specLevels }
 *   v3  + volumeOverrides, cityForceOverrides, roadsPortals, prefs, panels
 *
 * Every reader here is tolerant: a missing block imports as "nothing", so a v1
 * or v2 file still loads into a v3 app and only moves what it actually carries.
 *
 * Deliberately NOT carried (machine-local, not part of a user's setup):
 *   apiServer        which AODP mirror this box talks to
 *   monitorUpload    whether THIS install contributes captures to AODP
 *   table-collapsed-*, group-collapsed-*, ui-defaults-applied   window layout
 */

const SETTINGS_FORMAT = "albion-market-settings";
const SETTINGS_VERSION = 3;

// Header toggles / inputs. Applied live to their controls on import.
const TRANSFER_PREF_KEYS = [
  "useFocus",
  "premiumAccount",
  "stationFee",
  // Pricing Model, one key per leg. "orderType" is the pre-split single toggle:
  // still carried so an older bundle imports, and it seeds a side whose own key
  // is missing (js/settings-transfer-ui.js).
  "buyOrderType",
  "sellOrderType",
  "orderType",
  "caerleonRoutes",
  "showAllItems",
  "appLang",
  "dailyProductionBonus",
  "laborerHappinessGeneral",
  "laborerHappinessMatching",
  // The house those laborers live in — it caps both happiness boxes and the
  // Crafting Planner's furniture rows (js/house-tier.js).
  "houseTier",
  // Roads route rules: which realmgate you are bound to, which kind of hop
  // the search should favour, and whether you are hauling.
  "roadsRealmgate",
  "roadsRoutePrefer",
  "roadsRouteCargo",
  // Display size (js/app-zoom.js). Machine-ish, but a user who settled on 80%
  // expects the next install to open the same way.
  "appZoom",
];

// Panel state that a module caches at load time — carried, but only visible
// after a restart, so the import tells the user so.
const TRANSFER_PANEL_KEYS = [
  "gold-chart-config",
  "feesCalculatorSavedRows",
  "albionMarketSortState",
  // My Crafting List — the picked rows travel with their schema-version key,
  // or the receiving app's version gate would wipe them on load.
  "craftingList",
  "craftingListVersion",
];

const TRANSFER_SKIP_KEYS = ["apiServer", "monitorUpload"];

function _transferStorage(storage) {
  if (storage) return storage;
  return typeof localStorage !== "undefined" ? localStorage : null;
}

/** Raw string values for the whitelisted keys that are actually set. */
function collectStoredKeys(keys, storage) {
  const store = _transferStorage(storage);
  const out = {};
  if (!store) return out;
  keys.forEach((key) => {
    const value = store.getItem(key);
    if (value !== null && value !== undefined) out[key] = String(value);
  });
  return out;
}

/**
 * Write back the whitelisted keys. A key the file doesn't carry is REMOVED, so
 * the importing box ends on the exporting box's setup rather than a mix of the
 * two — same rule as the spec levels.
 */
function applyStoredKeys(map, keys, storage) {
  const store = _transferStorage(storage);
  if (!store) return {};
  const source = map && typeof map === "object" ? map : {};
  const applied = {};
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value === null || value === undefined) return;
      store.setItem(key, String(value));
      applied[key] = String(value);
    } else {
      store.removeItem(key);
    }
  });
  return applied;
}

/**
 * Assemble the export payload. Every input is optional — a caller that has no
 * portal graph or no spec module just omits it and the block comes out empty.
 */
function buildSettingsBundle(env) {
  const source = env || {};
  return {
    format: SETTINGS_FORMAT,
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    overrides: source.priceOverrides || {},
    volumeOverrides: source.volumeOverrides || {},
    cityForceOverrides: source.cityForceOverrides || {},
    specLevels: source.specLevels || {},
    roadsPortals: source.roadsPortals || null,
    prefs: collectStoredKeys(TRANSFER_PREF_KEYS, source.storage),
    panels: collectStoredKeys(TRANSFER_PANEL_KEYS, source.storage),
  };
}

/**
 * Split a parsed file into its blocks, whatever version wrote it.
 * `isBundle: false` means a v1 file, i.e. the object IS the price map.
 */
function readSettingsBundle(parsed) {
  const empty = {
    isBundle: false,
    version: 1,
    overrides: {},
    volumeOverrides: {},
    cityForceOverrides: {},
    specLevels: {},
    roadsPortals: null,
    prefs: {},
    panels: {},
  };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;

  const isBundle =
    parsed.format === SETTINGS_FORMAT ||
    typeof parsed.overrides === "object" ||
    typeof parsed.specLevels === "object" ||
    typeof parsed.volumeOverrides === "object" ||
    typeof parsed.cityForceOverrides === "object";

  if (!isBundle) return Object.assign(empty, { overrides: parsed });

  const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  return {
    isBundle: true,
    version: Number.isFinite(parsed.version) ? parsed.version : 2,
    overrides: obj(parsed.overrides),
    volumeOverrides: obj(parsed.volumeOverrides),
    cityForceOverrides: obj(parsed.cityForceOverrides),
    specLevels: obj(parsed.specLevels),
    roadsPortals: parsed.roadsPortals || null,
    prefs: obj(parsed.prefs),
    panels: obj(parsed.panels),
  };
}

/**
 * Merge imported portals into the stored graph instead of replacing it: a
 * portal is a timed sighting, and two players' sightings are additive. The
 * graph's own record() keeps the longer expiry when both know the same link.
 * Portals already dead at import time are dropped.
 *
 * @returns {number} how many portals were taken from the file
 */
/**
 * The graph's own reading of "expired": a guessed timer is held to the 24h
 * ceiling, so a file written by an older build (which stamped 6h on everything
 * it could not read) does not arrive already dead.
 *
 * A function DECLARATION lands on globalThis in the browser's classic scripts;
 * under Node the tests load this module alone, so the sibling is required.
 */
function resolveRetainUntil(api) {
  if (api && typeof api.portalRetainUntil === "function") return api.portalRetainUntil;
  if (typeof portalRetainUntil === "function") return portalRetainUntil;
  if (typeof require === "function") {
    try { return require("./data-roads-portals.js").portalRetainUntil; } catch (e) { /* browser */ }
  }
  return (expiresAt) => expiresAt;
}

function importRoadsPortals(saved, now, deps) {
  const api = deps || (typeof globalThis !== "undefined" ? globalThis : {});
  const load = api.loadPortalGraph || (typeof loadPortalGraph === "function" ? loadPortalGraph : null);
  const save = api.savePortalGraph || (typeof savePortalGraph === "function" ? savePortalGraph : null);
  if (!load || !save) return 0;
  const retainUntil = resolveRetainUntil(api);

  const at = Number.isFinite(now) ? now : Date.now();
  const rows = Array.isArray(saved)
    ? saved
    : saved && Array.isArray(saved.portals)
      ? saved.portals
      : [];
  if (rows.length === 0) return 0;

  const graph = load(null, at);
  let taken = 0;
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const keptUntil = retainUntil(
      Number(row.expiresAt), Number(row.discoveredAt), row.estimated !== false,
    );
    if (!(keptUntil > at)) return; // already expired — nothing to map
    const recorded = graph.record({
      fromZoneId: row.fromZoneId,
      toZoneId: row.toZoneId,
      size: row.size,
      expiresAt: Number(row.expiresAt),
      // Whether the timer was measured or guessed travels with it — otherwise
      // an imported guess would outrank a local reading of the same portal.
      // A file written before the field existed carries no provenance, so it
      // counts as a guess: it can never override something this box measured.
      estimated: row.estimated !== false,
      chargesLeft: Number.isFinite(row.chargesLeft) ? row.chargesLeft : undefined,
      source: row.source,
      now: Number.isFinite(row.discoveredAt) ? row.discoveredAt : at,
    });
    if (recorded) taken++;
  });
  if (taken > 0) save(graph);
  return taken;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SETTINGS_FORMAT,
    SETTINGS_VERSION,
    TRANSFER_PREF_KEYS,
    TRANSFER_PANEL_KEYS,
    TRANSFER_SKIP_KEYS,
    collectStoredKeys,
    applyStoredKeys,
    buildSettingsBundle,
    readSettingsBundle,
    importRoadsPortals,
  };
}
