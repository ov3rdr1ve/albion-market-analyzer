/**
 * What travels through the shared folder, and what is allowed back in.
 *
 * The merge rules are not invented here. A portal already knows that the longer
 * expiry is the safer claim and that a measurement beats a guess
 * (js/data-roads-portals.js record()); a captured price cell already knows
 * newest-wins side by side (js/captured-prices-store.js capFoldOntoTarget).
 * This module is the envelope around them, plus the two things a folder full of
 * other people's files forces on us:
 *
 *   OUT  Bounded. Every publish rewrites a whole file and Dropbox uploads it,
 *        so only live portals travel and only a window of recent price cells.
 *        The portal file is a few KB; the price file is capped near a megabyte.
 *
 *   IN   Untrusted. A peer file is somebody else's app writing to a folder we
 *        both have write access to. It is validated and capped before a single
 *        row reaches the graph, a malformed block reads as absent rather than
 *        taking the tick down, and a peer's older reading can never overwrite
 *        this box's newer one.
 *
 * Pure: no fs, no DOM, no timers, no globals of its own. The functions it leans
 * on are injected (Node tests) or read off the page's globals (browser).
 */

const SYNC_FORMAT = "albion-roads-sync";
const SYNC_VERSION = 1;

// Outbound bounds. Six hours is roughly one play session, which is as far back
// as a teammate's prices are worth anything anyway.
const SHARE_PRICE_WINDOW_MS = 6 * 3600 * 1000;
const SHARE_MAX_CELLS = 8000;

// Inbound bounds. Nothing legitimate comes near these; they are here so a
// corrupt or hostile file cannot blow the renderer's heap.
const MAX_PEER_PORTALS = 5000;
const MAX_PEER_CELLS = 50000;

const PORTAL_FIELDS = [
  "fromZoneId", "toZoneId", "size", "expiresAt",
  "estimated", "chargesLeft", "discoveredAt", "source",
];

/**
 * A function from the injected deps, the page's globals, or Node's require.
 *
 * The browser half matters: the app loads js/*.js as classic scripts, where a
 * function DECLARATION lands on globalThis (a top-level const does not — see
 * js/captured-prices-store.js, every helper there is a declaration).
 */
function _dep(deps, name, moduleId) {
  if (deps && typeof deps[name] === "function") return deps[name];
  if (typeof globalThis !== "undefined" && typeof globalThis[name] === "function") return globalThis[name];
  if (typeof module !== "undefined" && module.exports && moduleId) {
    try {
      const loaded = require(moduleId);
      if (typeof loaded[name] === "function") return loaded[name];
    } catch (e) { /* browser */ }
  }
  return null;
}

// Names the captured-price store exports under, when they differ from the
// internal ones the page puts on globalThis.
const _STORE = "./captured-prices-store.js";
function _storeFn(deps, globalName, exportName) {
  return _dep(deps, globalName, null) || _dep(deps, exportName, _STORE);
}

function _plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function _rows(block) {
  if (Array.isArray(block)) return block;
  const obj = _plainObject(block);
  return obj && Array.isArray(obj.portals) ? obj.portals : [];
}

function _envelope({ deviceId, deviceName, now }) {
  if (!deviceId) return null;
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    deviceId,
    deviceName: typeof deviceName === "string" ? deviceName : "",
    writtenAt: Number.isFinite(now) ? now : Date.now(),
  };
}

// ── outgoing ────────────────────────────────────────────────────────────────

/**
 * The portal half. Expired rows are dropped on the way out: they carry no
 * information a peer can use, and every one of them is bytes Dropbox re-uploads.
 * "Expired" is the graph's own reading of the word (portalRetainUntil), so a
 * guessed timer written by an older build is not mistaken for a dead portal.
 *
 * An EMPTY list is still a legitimate publish — that is how a map cleared with
 * "Clear All" stops being republished to the guild.
 */
function buildPortalPayload({ deviceId, deviceName, portals, now, deps }) {
  const envelope = _envelope({ deviceId, deviceName, now });
  if (!envelope) return null;
  const at = envelope.writtenAt;
  const retainUntil = _dep(deps, "portalRetainUntil", "./data-roads-portals.js")
    || ((expiresAt) => expiresAt);
  const live = _rows(portals)
    .filter((row) => _plainObject(row)
      && retainUntil(Number(row.expiresAt), Number(row.discoveredAt), row.estimated !== false) > at)
    .map((row) => {
      const out = {};
      PORTAL_FIELDS.forEach((field) => { out[field] = row[field]; });
      return out;
    });
  return { ...envelope, roadsPortals: { version: 1, portals: live } };
}

/** Epoch ms of the freshest reading in a quality-shaped captured map. */
function newestCellTime(map, deps) {
  const entryTime = _storeFn(deps, "capEntryTime", "entryTime");
  let newest = 0;
  const source = _plainObject(map);
  if (!source || !entryTime) return 0;
  Object.keys(source).forEach((itemId) => {
    const byQuality = _plainObject(source[itemId]) || {};
    Object.keys(byQuality).forEach((quality) => {
      const byCity = _plainObject(byQuality[quality]) || {};
      Object.keys(byCity).forEach((city) => {
        const ts = entryTime(byCity[city]);
        if (ts > newest) newest = ts;
      });
    });
  });
  return newest;
}

/** Cells in a quality-shaped map. */
function countPriceCells(map) {
  let n = 0;
  const source = _plainObject(map) || {};
  Object.keys(source).forEach((itemId) => {
    const byQuality = _plainObject(source[itemId]) || {};
    Object.keys(byQuality).forEach((quality) => {
      n += Object.keys(_plainObject(byQuality[quality]) || {}).length;
    });
  });
  return n;
}

/**
 * The price half: the newest cells inside the share window.
 *
 * pruneCapturedPrices already does exactly "inside this age, newest N first",
 * and it returns a fresh map, so the session's own captures are never touched.
 * `bridge: null` keeps it off the userData file — this is a payload, not a save.
 *
 * @returns {object|null} null when there is nothing new enough to be worth a file
 */
function buildPricePayload({ deviceId, deviceName, capturedPrices, now, windowMs, maxCells, deps }) {
  const envelope = _envelope({ deviceId, deviceName, now });
  if (!envelope) return null;
  const prune = _dep(deps, "pruneCapturedPrices", _STORE);
  if (!prune) return null;

  const window = Number.isFinite(windowMs) ? windowMs : SHARE_PRICE_WINDOW_MS;
  const cap = Number.isFinite(maxCells) ? maxCells : SHARE_MAX_CELLS;
  const shared = prune(capturedPrices, {
    now: envelope.writtenAt,
    maxAgeMs: window,
    maxCells: cap,
    bridge: null,
  });
  if (countPriceCells(shared) === 0) return null;

  return { ...envelope, capturedPrices: shared, newestAt: newestCellTime(shared, deps) };
}

// ── incoming ────────────────────────────────────────────────────────────────

function _capPortals(block) {
  const rows = _rows(block).filter((row) => _plainObject(row));
  // When a peer floods us, the portals worth keeping are the ones that live
  // longest — a link expiring in a minute is not worth a slot.
  if (rows.length > MAX_PEER_PORTALS) {
    rows.sort((a, b) => (Number(b.expiresAt) || 0) - (Number(a.expiresAt) || 0));
    rows.length = MAX_PEER_PORTALS;
  }
  return { version: 1, portals: rows };
}

function _capCells(map, maxCells, deps) {
  const source = _plainObject(map);
  if (!source) return {};
  const cap = Number.isFinite(maxCells) ? maxCells : MAX_PEER_CELLS;
  const prune = _dep(deps, "pruneCapturedPrices", _STORE);
  if (!prune) return {};
  return prune(source, { maxAgeMs: Infinity, maxCells: cap, bridge: null });
}

/**
 * Validate one peer file. Text or an already-parsed object; null when it is not
 * ours to read.
 *
 * A version from the FUTURE is refused: a later build may mean something else
 * by these fields, and guessing would corrupt the local graph rather than skip
 * one peer. An older version is fine — a guild upgrades one box at a time.
 */
function readPeerPayload(input, options) {
  let parsed;
  if (typeof input === "string") {
    try { parsed = JSON.parse(input); } catch (e) { return null; }
  } else {
    parsed = input;
  }
  const obj = _plainObject(parsed);
  if (!obj) return null;
  if (obj.format !== SYNC_FORMAT) return null;
  const version = Number(obj.version);
  if (!Number.isFinite(version) || version < 1 || version > SYNC_VERSION) return null;
  if (typeof obj.deviceId !== "string" || !obj.deviceId) return null;

  const opts = options || {};
  return {
    format: obj.format,
    version,
    deviceId: obj.deviceId,
    deviceName: typeof obj.deviceName === "string" ? obj.deviceName : "",
    writtenAt: Number(obj.writtenAt) || 0,
    roadsPortals: _capPortals(obj.roadsPortals),
    capturedPrices: _capCells(obj.capturedPrices, opts.maxCells, opts.deps),
    newestAt: Number(obj.newestAt) || 0,
  };
}

/**
 * Fold a peer's portals into the stored graph. This is the settings-bundle
 * import path (js/settings-transfer.js importRoadsPortals) — same rules, same
 * tests — because a file arriving through Dropbox is the same fact as a file
 * the user mailed themselves.
 *
 * @returns {number} portals taken
 */
function mergePeerPortals(payload, now, deps) {
  const rows = _rows(payload && payload.roadsPortals);
  if (rows.length === 0) return 0;
  const importPortals = _dep(deps, "importRoadsPortals", "./settings-transfer.js");
  if (!importPortals) return 0;
  return importPortals({ portals: rows }, Number.isFinite(now) ? now : Date.now(), deps);
}

/**
 * Decide which of a peer's price cells this box should actually take.
 *
 * recordCapturedPrices cannot be handed a peer map directly: its fold assumes
 * the incoming cell is the NEWER one (it always is, for our own capture), so a
 * teammate replaying a two-hour-old market would overwrite prices we read a
 * minute ago. capFoldOntoTarget is the date-aware fold, so the patch is built
 * against the local map first and only the cells that actually changed are
 * returned.
 *
 * @returns {{patch:object, taken:number}}
 */
function mergePeerCells(localMap, peerMap, deps) {
  const fold = _storeFn(deps, "capFoldOntoTarget", "capFoldOntoTarget");
  const local = _plainObject(localMap) || {};
  const peer = _plainObject(peerMap) || {};
  const patch = {};
  let taken = 0;
  if (!fold) return { patch, taken };

  Object.keys(peer).forEach((itemId) => {
    const byQuality = _plainObject(peer[itemId]) || {};
    Object.keys(byQuality).forEach((quality) => {
      const byCity = _plainObject(byQuality[quality]) || {};
      Object.keys(byCity).forEach((city) => {
        const incoming = _plainObject(byCity[city]);
        if (!incoming) return;
        const mine = local[itemId] && local[itemId][quality] ? local[itemId][quality][city] : null;
        const merged = fold(mine, incoming);
        if (mine && !_changed(mine, merged)) return;
        if (!patch[itemId]) patch[itemId] = {};
        if (!patch[itemId][quality]) patch[itemId][quality] = {};
        patch[itemId][quality][city] = merged;
        taken++;
      });
    });
  });
  return { patch, taken };
}

/** Whether a fold actually moved a price, so an unchanged cell is not rewritten. */
function _changed(before, after) {
  return before.sell_price !== after.sell_price
    || before.buy_price !== after.buy_price
    || before.sell_date !== after.sell_date
    || before.buy_date !== after.buy_date
    || before.volume_24h !== after.volume_24h;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SYNC_FORMAT,
    SYNC_VERSION,
    SHARE_PRICE_WINDOW_MS,
    SHARE_MAX_CELLS,
    MAX_PEER_PORTALS,
    MAX_PEER_CELLS,
    buildPortalPayload,
    buildPricePayload,
    readPeerPayload,
    mergePeerPortals,
    mergePeerCells,
    newestCellTime,
    countPriceCells,
  };
}
