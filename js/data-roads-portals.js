/**
 * Roads of Avalon portal graph — the live half of the roads map.
 *
 * Zones are static (js/data-roads-zones.js, generated). The portals between
 * them are not: each is an undirected link that dies 12-24h after it spawns
 * (ao-bin-dumps tunnelsystem.xml — lifetimemin 43200, lifetimemax 86400), and
 * no public API publishes them. Every edge in here was typed in by hand (or
 * taken from a teammate's file).
 *
 * Design notes:
 *   - Keyed by the UNORDERED zone pair. Two exits from one zone to the same
 *     destination are the same navigational fact, so a second sighting
 *     refreshes the record rather than duplicating it.
 *   - Expiry is applied on READ, not on write: a lapsed portal stays in the
 *     store (so the UI can grey it out) until `prune` deletes it. The panel
 *     prunes on its own countdown tick, so that window is one tick, not a
 *     session — see autoPruneExpired in js/render-roads.js.
 *   - A refresh never shortens a known expiry — a sighting from across the map
 *     may carry a stale timer, and the longer of the two is the safer claim.
 *     One exception: a MEASURED expiry (the portal object's own close time,
 *     `estimated: false`) always replaces a guessed one, even downwards. The
 *     whole point of reading the object is that the guess was never a claim.
 *   - A guessed timer never deletes anything either: it is held to the 24h
 *     ceiling from the first sighting (`portalRetainUntil`), because the game
 *     encrypts portal objects and a house number must not bury a live portal.
 *   - Persistence is a plain JSON object, ready for localStorage.
 *   - Zones the Roads never touch are refused outright (see offNetworkZone
 *     below). One gate covers every way in: the manual form and a
 *     teammate's file, which both land on `record`.
 */

const PORTAL_SIZES = ["solo", "group", "raid"];

// tunnelsystem.xml <tunnelexitsettings lifetimemin="43200" lifetimemax="86400">
const MIN_PORTAL_LIFETIME_S = 43200;
const MAX_PORTAL_LIFETIME_S = 86400;

const PORTAL_STORAGE_KEY = "roadsPortals";

/**
 * The moment a portal is certainly gone — the only cutoff allowed to delete one.
 *
 * A measured close time is the answer: the portal object said when it shuts, so
 * that is when it shuts. A guess is not. The game encrypts those objects, so
 * most portals are entered with only a rough timer (a house number), and that number
 * is evidence of nothing — least of all of death. What is known is the ceiling:
 * no exit outlives 24h from spawn, and a sighting cannot predate the spawn. So
 * a guessed portal is held 24h from when it was first seen, which is why a
 * 12h+ portal no longer vanishes from the map hours before it closes.
 */
function portalRetainUntil(expiresAt, discoveredAt, estimated) {
  if (!estimated || !Number.isFinite(discoveredAt)) return expiresAt;
  return Math.max(expiresAt, discoveredAt + MAX_PORTAL_LIFETIME_S * 1000);
}

/**
 * Is this zone off the Roads network entirely (the Brecilien pocket)?
 *
 * The catalog answers in the browser through the plain global; under Node the
 * tests load this module alone, so the sibling is required on first use. Either
 * way an absent catalog means "no opinion", never a refused portal.
 */
let offNetworkTest = null;
function offNetworkZone(zoneId) {
  // Only a hit is remembered: this module can load before the catalog does, and
  // caching "not there yet" would keep the gate open for the whole session.
  if (!offNetworkTest) {
    if (typeof isOffRoadsNetwork === "function") offNetworkTest = isOffRoadsNetwork;
    else if (typeof require === "function") {
      try { offNetworkTest = require("./data-roads-overland.js").isOffRoadsNetwork; } catch (e) { /* browser */ }
    }
  }
  return offNetworkTest ? !!offNetworkTest(zoneId) : false;
}

/** Unordered pair key, so a—b and b—a are one portal. */
function portalKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeSize(size) {
  return PORTAL_SIZES.includes(size) ? size : "unknown";
}

function makePortal({ key, fromZoneId, toZoneId, size, expiresAt, discoveredAt, estimated, chargesLeft }) {
  return {
    key,
    fromZoneId,
    toZoneId,
    size: normalizeSize(size),
    expiresAt,
    discoveredAt,
    // Every portal is a manual one now. Data saved by an older build may carry
    // source "sniffer" (or none at all); it is accepted and normalized, never
    // rejected, so nothing a user stored is lost.
    source: "manual",
    /** True when the timer is a fallback guess, not the portal's own close time. */
    estimated: !!estimated,
    chargesLeft: Number.isFinite(chargesLeft) ? chargesLeft : null,
    /** The zone on the far side of this portal, seen from `zoneId`. */
    other(zoneId) {
      return zoneId === this.fromZoneId ? this.toZoneId : this.fromZoneId;
    },
    isLive(now) {
      return this.expiresAt > now;
    },
    secondsLeft(now) {
      return Math.max(0, Math.round((this.expiresAt - now) / 1000));
    },
  };
}

/**
 * @param {object|Array} [saved]  previously serialised state (toJSON output)
 * @param {number} [restoreNow]   clock used to drop portals that lapsed while closed
 */
function createPortalGraph(saved, restoreNow) {
  /** @type {Map<string, object>} */
  const portals = new Map();

  function record({ fromZoneId, toZoneId, size, expiresAt, secondsRemaining, now, source, estimated, chargesLeft }) {
    const at = Number.isFinite(now) ? now : Date.now();
    if (!fromZoneId || !toZoneId || fromZoneId === toZoneId) return null;
    // No tunnel opens into the Mists, so an edge with an end there is a typo or
    // a white Brecilien portal mistaken for one — never a walkable link.
    if (offNetworkZone(fromZoneId) || offNetworkZone(toZoneId)) return null;

    let expiry = Number.isFinite(expiresAt) ? expiresAt : null;
    if (expiry === null && Number.isFinite(secondsRemaining)) expiry = at + secondsRemaining * 1000;
    if (expiry === null) return null;

    const key = portalKey(fromZoneId, toZoneId);
    const existing = portals.get(key);
    const guessed = !!estimated;

    // A measured close time settles the question in either direction; between
    // two readings of the same kind, the longer one is the safer claim.
    let mergedExpiry = expiry;
    let mergedEstimated = guessed;
    if (existing) {
      if (existing.estimated && !guessed) { mergedExpiry = expiry; mergedEstimated = false; }
      else if (!existing.estimated && guessed) { mergedExpiry = existing.expiresAt; mergedEstimated = false; }
      else { mergedExpiry = Math.max(existing.expiresAt, expiry); mergedEstimated = guessed; }
    }

    // Whatever the guess said, hold it until the portal cannot still be open.
    const discoveredAt = existing ? existing.discoveredAt : at;
    mergedExpiry = portalRetainUntil(mergedExpiry, discoveredAt, mergedEstimated);

    // A sighting that could not read the size must not erase one that could.
    const knownSize = normalizeSize(size) === "unknown" && existing && existing.size !== "unknown"
      ? existing.size
      : size === undefined && existing ? existing.size : size;

    const portal = makePortal({
      key,
      // Keep the original orientation so the UI can say "a → b".
      fromZoneId: existing ? existing.fromZoneId : fromZoneId,
      toZoneId: existing ? existing.toZoneId : toZoneId,
      size: knownSize,
      expiresAt: mergedExpiry,
      estimated: mergedEstimated,
      chargesLeft: Number.isFinite(chargesLeft) ? chargesLeft
        : existing && Number.isFinite(existing.chargesLeft) ? existing.chargesLeft : null,
      discoveredAt,
      source: source === undefined && existing ? existing.source : source,
    });
    portals.set(key, portal);
    return portal;
  }

  function get(a, b) {
    return portals.get(portalKey(a, b)) || null;
  }

  /**
   * Correct a portal by hand. The game encrypts the portal object, so the size
   * and the timer are typed in — and unlike `record`, what they type wins outright:
   * they are standing in front of the portal, so a shorter timer is a fact, not
   * a stale sighting. A typed timer therefore also clears `estimated`.
   *
   * @param {object} patch {size?, expiresAt?, secondsRemaining?, now?}
   * @returns {object|null} the updated portal, or null if nothing was changed
   */
  function update(a, b, patch) {
    const key = portalKey(a, b);
    const existing = portals.get(key);
    if (!existing || !patch || typeof patch !== "object") return null;

    const at = Number.isFinite(patch.now) ? patch.now : Date.now();
    let expiry = existing.expiresAt;
    let estimated = existing.estimated;
    if (Number.isFinite(patch.expiresAt)) { expiry = patch.expiresAt; estimated = false; }
    else if (patch.secondsRemaining !== undefined) {
      if (!Number.isFinite(patch.secondsRemaining) || patch.secondsRemaining < 0) return null;
      expiry = at + patch.secondsRemaining * 1000;
      estimated = false;
    }

    const portal = makePortal({
      ...existing,
      size: patch.size === undefined ? existing.size : patch.size,
      expiresAt: expiry,
      estimated,
    });
    portals.set(key, portal);
    return portal;
  }

  function all(now) {
    const list = [...portals.values()];
    const live = Number.isFinite(now) ? list.filter((p) => p.isLive(now)) : list;
    return live.sort((a, b) => a.key.localeCompare(b.key));
  }

  /** Live links out of `zoneId`, sorted by destination for deterministic walks. */
  function neighbors(zoneId, now) {
    const at = Number.isFinite(now) ? now : Date.now();
    const out = [];
    for (const portal of portals.values()) {
      if (!portal.isLive(at)) continue;
      if (portal.fromZoneId !== zoneId && portal.toZoneId !== zoneId) continue;
      out.push({ zoneId: portal.other(zoneId), portal });
    }
    return out.sort((a, b) => a.zoneId.localeCompare(b.zoneId));
  }

  /**
   * Delete every portal that cannot still be open. The cutoff is the retention
   * rule, never the printed countdown: a guessed timer is evidence of nothing,
   * so a row whose count reached zero but whose 24h ceiling has not is kept.
   * (Rows written by this build already carry the retained expiry — `record`
   * bumps it — but an older row read straight into memory may not.)
   */
  function prune(now) {
    const at = Number.isFinite(now) ? now : Date.now();
    let dropped = 0;
    for (const [key, portal] of portals) {
      const keptUntil = portalRetainUntil(portal.expiresAt, portal.discoveredAt, portal.estimated);
      if (!(keptUntil > at)) { portals.delete(key); dropped++; }
    }
    return dropped;
  }

  function remove(a, b) {
    return portals.delete(portalKey(a, b));
  }

  /**
   * Drop every portal touching `zoneId` — what deleting a node on the map means,
   * since a node only exists while some portal names its zone.
   * @returns {number} how many portals went, expired ones included.
   */
  function removeZone(zoneId) {
    if (!zoneId) return 0;
    let dropped = 0;
    for (const [key, portal] of portals) {
      if (portal.fromZoneId === zoneId || portal.toZoneId === zoneId) { portals.delete(key); dropped++; }
    }
    return dropped;
  }

  function clear() {
    portals.clear();
  }

  function toJSON() {
    return {
      version: 1,
      portals: all().map((p) => ({
        fromZoneId: p.fromZoneId,
        toZoneId: p.toZoneId,
        size: p.size,
        expiresAt: p.expiresAt,
        estimated: p.estimated,
        chargesLeft: p.chargesLeft,
        discoveredAt: p.discoveredAt,
        source: p.source,
      })),
    };
  }

  // ── restore ──────────────────────────────────────────────────────────────
  const rows = Array.isArray(saved) ? saved : saved && Array.isArray(saved.portals) ? saved.portals : [];
  const cutoff = Number.isFinite(restoreNow) ? restoreNow : null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    // The stored number may be a guess written by an older build, so the cutoff
    // asks the retention rule rather than the row. Without this the rescue in
    // `record` never runs: the row is gone before it gets there.
    const keptUntil = portalRetainUntil(
      Number(row.expiresAt), Number(row.discoveredAt), row.estimated !== false,
    );
    if (cutoff !== null && !(keptUntil > cutoff)) continue;
    record({
      ...row,
      // Rows written before the field existed carry no provenance; a guess is
      // the safe reading, so a later measurement can still correct them.
      estimated: row.estimated !== false,
      now: Number.isFinite(row.discoveredAt) ? row.discoveredAt : cutoff || Date.now(),
    });
  }

  return { record, get, update, all, neighbors, prune, remove, removeZone, clear, toJSON };
}

/** Load / save helpers for the browser. No-ops when storage is unavailable. */
function loadPortalGraph(storage, now) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store) return createPortalGraph();
  try {
    return createPortalGraph(JSON.parse(store.getItem(PORTAL_STORAGE_KEY) || "null"), now);
  } catch {
    return createPortalGraph();
  }
}

function savePortalGraph(graph, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!store || !graph) return false;
  try {
    store.setItem(PORTAL_STORAGE_KEY, JSON.stringify(graph.toJSON()));
    return true;
  } catch {
    return false;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPortalGraph,
    loadPortalGraph,
    savePortalGraph,
    portalKey,
    portalRetainUntil,
    PORTAL_SIZES,
    PORTAL_STORAGE_KEY,
    MIN_PORTAL_LIFETIME_S,
    MAX_PORTAL_LIFETIME_S,
  };
}
