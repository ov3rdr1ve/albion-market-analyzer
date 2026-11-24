/**
 * What LOCATION a Join response names — the app's only source of "where am I".
 *
 * Split out of js/market-sniffer-events.js (which city a captured price is
 * filed under) so the shapes it reads live in one place.
 *
 * The shapes are the reference client's — ao-data/albiondata-client,
 * client/listener.go `normalizeLocationID` and client/decode.go
 * `looksLikeJoinResponse` / `extractLocationLikeString`, read 2026-09-03:
 *
 *   "3005", "0301"                 a cluster id
 *   "TNL-022"                      a roads cluster
 *   "3013-Auction2"                Caerleon's second auction house
 *   "BLACKBANK-…"                  a hideout bank
 *   "…-HellDen"                    a hell den
 *   "@island@<uuid>"               a PRIVATE ISLAND — canonicalised to @ISLAND@
 *   "@player-island…", "@island-…", "Island-Player-…"   its other spellings
 *
 * Two things this fixes, both reported as "the app lost my zone and never got
 * it back after I teleported straight to an island":
 *
 *   - an island id was refused, so the Join it arrived on was dropped. A
 *     dropped Join is indistinguishable from a Join that never arrived — the
 *     position simply stops moving and nothing says why.
 *   - the value does not always arrive as a plain string in parameter 8. The
 *     reference client scans the parameter tree, byte arrays included, which is
 *     why extractLocationLikeString exists here too.
 *
 * STRICT vs LOOSE, deliberately two things:
 *   - `normalizeLocationId` is STRICT — a shape the game is known to send. It
 *     is what may be trusted on a message whose operation is NOT confirmed.
 *   - the loose read inside `readJoinLocation` accepts any short, space-free
 *     token, and is only safe because the caller already knows the message is a
 *     Join. It is what lets the Mists, hideouts and dungeons announce
 *     themselves at all (see js/market-sniffer-events.js).
 */

const JOIN_LOCATION_PARAMS = [8, 66];

/** "@island@" followed by a UUID — the private-island form. */
const ISLAND_UUID = /@island@([0-9a-f-]{36})/i;
/** A bare cluster id: 3 to 6 digits, zero-padding kept. */
const NUMERIC_CLUSTER = /^[0-9]{3,6}$/;
/** "TNL-022", "3013", "0301b" — the catalog's key shape. */
const CLUSTER_SHAPE = /^[A-Za-z]{0,6}-?\d{3,5}[A-Za-z]?$/;

const INSTANCED_PREFIXES = ["island-player-", "@player-island", "@island-", "@island@"];
const MAX_LOCATION_CHARS = 64;
const MAX_SCAN_DEPTH = 6;

/** Strip the punctuation the wire sometimes pads a value with. */
function trimLocation(text) {
  return text.replace(/^[\s,.]+/, "").replace(/[\s,.]+$/, "");
}

/**
 * A location the game is KNOWN to send, canonicalised — or null.
 *
 * Strict on purpose: this is the test applied to values found in parameters
 * nobody has confirmed, and a cluster id is just a number. Reading one off any
 * response is what once moved the player to Willowshade Icemarsh and kept them
 * there for a session.
 *
 * @param {string|number|null|undefined} raw
 * @returns {string|null}
 */
function normalizeLocationId(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && NUMERIC_CLUSTER.test(String(raw)) ? String(raw) : null;
  }
  if (typeof raw !== "string") return null;

  const text = trimLocation(raw);
  if (!text || text.length > MAX_LOCATION_CHARS) return null;

  // The island id can arrive with something in front of it, so it is EXTRACTED
  // rather than matched whole.
  const island = ISLAND_UUID.exec(text);
  if (island) return `@ISLAND@${island[1]}`;

  if (NUMERIC_CLUSTER.test(text)) return text;

  const lower = text.toLowerCase();
  if (INSTANCED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return text;
  if (text.startsWith("BLACKBANK-") || /-HellDen$/.test(text) || /-Auction2$/i.test(text)) return text;

  return CLUSTER_SHAPE.test(text) ? text : null;
}

/**
 * Whether a location is a private copy of a map — an island, a hideout bank, a
 * hell den. Its id is not stable between visits, so it names a position and
 * NEVER a node the portal graph may route through.
 */
function isInstancedLocation(raw) {
  const id = typeof raw === "string" ? trimLocation(raw) : null;
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower.startsWith("@island@")) return true;
  if (INSTANCED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  return id.startsWith("BLACKBANK-") || /-HellDen$/.test(id);
}

/**
 * An island token — "@island@<uuid>" and its spellings. The ONE instanced id
 * that is unmistakable anywhere in a payload: it names the player's own
 * island, and no other message carries it by accident. A den or bank id
 * cannot say the same — the traffic entering Rowanwood names the den entrance
 * standing in that map, and a payload-wide scan for "-HellDen" read the whole
 * response as a Join arriving at "Antiquarian's Den" (reported 2026-09-03).
 * Those ids count only in the confirmed location parameters.
 */
function isIslandLocation(raw) {
  const id = typeof raw === "string" ? trimLocation(raw) : null;
  if (!id) return false;
  const lower = id.toLowerCase();
  return INSTANCED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * The loose read: any short, space-free token, on a message already known to be
 * a Join. Whitespace is the tell — a display name ("Anklesnag Mire") is the one
 * confusable thing the slot could hold, and no map id contains a space.
 */
function looseLocation(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_LOCATION_CHARS || /\s/.test(text)) return null;
  return text;
}

function isByteArray(value) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return true;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return true;
  return Array.isArray(value) && value.length > 0
    && value.every((n) => typeof n === "number" && Number.isInteger(n) && n >= -128 && n <= 255);
}

function bytesToText(value) {
  let out = "";
  for (const n of value) out += String.fromCharCode(n < 0 ? n + 256 : n);
  return out;
}

/**
 * Location-shaped strings hiding in a blob: split on non-printable bytes and
 * test every printable run. This is how the value arrives when it is not a
 * plain string parameter.
 */
function scanText(text, accept) {
  let chunk = "";
  const take = () => {
    if (!chunk) return null;
    const id = normalizeLocationId(chunk);
    chunk = "";
    return id && accept(id) ? id : null;
  };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) { chunk += text[i]; continue; }
    const found = take();
    if (found) return found;
  }
  return take();
}

/**
 * The first location-shaped value anywhere in a decoded parameter, descending
 * through arrays, dictionaries and byte blobs.
 *
 * @param {*} value
 * @param {(id:string) => boolean} [accept]  narrows what counts as a hit
 * @returns {string|null}
 */
function extractLocationLikeString(value, accept = () => true, depth = 0, seen = new Set()) {
  if (value === null || value === undefined || depth > MAX_SCAN_DEPTH) return null;

  if (typeof value === "string" || typeof value === "number") {
    const direct = normalizeLocationId(value);
    if (direct && accept(direct)) return direct;
    return typeof value === "string" ? scanText(value, accept) : null;
  }
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  if (isByteArray(value)) return scanText(bytesToText(value), accept);

  const children = value instanceof Map
    ? Array.from(value.values())
    : (Array.isArray(value) ? value : Object.values(value));
  for (const child of children) {
    const found = extractLocationLikeString(child, accept, depth + 1, seen);
    if (found) return found;
  }
  return null;
}

/**
 * One parameter's worth of location: the strict shape, then the loose token,
 * then the same value read as a blob. For a caller that already knows which
 * parameter carries the map id and knows the message is a Join.
 *
 * @param {*} raw
 * @returns {string|null}
 */
function readLocationValue(raw) {
  return normalizeLocationId(raw) || looseLocation(raw) || extractLocationLikeString(raw);
}

/**
 * Where a Join says the player is, or null.
 *
 * Order matters: the confirmed parameters first and strictly, then loosely (the
 * Mists), then the same parameters as blobs, and only then the rest of the
 * payload — and there, only for an INSTANCED id. A bare cluster id found in an
 * unnamed parameter is exactly the thing that fabricates positions.
 *
 * That last, payload-wide read is for a message whose OPERATION already names
 * it a Join — `confirmed`. It used to run on any caller, and that is what left
 * the app stuck on a private island after leaving one (reported 2026-09-04):
 * ordinary traffic carries the player's own island reference, so message after
 * message re-announced an arrival at the island and undid the real zone.
 *
 * @param {object} parameters  decoded Photon parameters
 * @param {object} [options]
 * @param {boolean} [options.confirmed]  the operation code says this is a Join
 * @returns {string|null}
 */
function readJoinLocation(parameters, { confirmed = false } = {}) {
  if (!parameters || typeof parameters !== "object") return null;
  for (const key of JOIN_LOCATION_PARAMS) {
    const id = normalizeLocationId(parameters[key]);
    if (id) return id;
  }
  for (const key of JOIN_LOCATION_PARAMS) {
    const id = looseLocation(parameters[key]);
    if (id) return id;
  }
  for (const key of JOIN_LOCATION_PARAMS) {
    const id = extractLocationLikeString(parameters[key]);
    if (id) return id;
  }
  return confirmed ? extractLocationLikeString(parameters, isInstancedLocation) : null;
}

/**
 * Whether a message nobody could name by operation code is a Join anyway.
 *
 * The reference client needs this because a Join does not always arrive under
 * the operation code the tables give it. Kept far stricter than the position
 * read above, because it decides whether an UNIDENTIFIED message may move the
 * player at all:
 *
 * The Join's own character block (parameter 1 = character id, 2 = character
 * name) is required either way. Beside it, EITHER a known location in parameter
 * 8/66, OR an instanced id — an island — anywhere in the payload, which is what
 * a teleport straight to an island sends.
 *
 * The character block used to be optional for that second branch, on the claim
 * that no other message carries an island token by accident. It was as wrong
 * for islands as it already was for dens: leaving a private island left the
 * zone stuck on "@ISLAND@…" for the rest of the session, because ordinary
 * post-island traffic mentions the player's own island and every mention was
 * read as an arrival back at it (reported 2026-09-04; the den half of the same
 * mistake is the Rowanwood report, 2026-09-03).
 *
 * @param {object} parameters
 * @returns {boolean}
 */
function looksLikeJoinResponse(parameters) {
  if (!parameters || typeof parameters !== "object") return false;
  const hasCharacterBlock = parameters[1] !== undefined && typeof parameters[2] === "string";
  if (!hasCharacterBlock) return false;
  for (const key of JOIN_LOCATION_PARAMS) {
    if (normalizeLocationId(parameters[key])) return true;
    if (extractLocationLikeString(parameters[key])) return true;
  }
  return !!extractLocationLikeString(parameters, isIslandLocation);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeLocationId,
    isInstancedLocation,
    isIslandLocation,
    looseLocation,
    extractLocationLikeString,
    readLocationValue,
    readJoinLocation,
    looksLikeJoinResponse,
    JOIN_LOCATION_PARAMS,
  };
}
