/**
 * Game location ids → the city names the app prices under.
 *
 * The client only ever reports the cluster you are standing in ("3005",
 * "0007", "3013-Auction2"); display names never cross the wire. The Albion
 * Online Data Project canonicalises those ids before storing a price, and the
 * app must apply the SAME folding or a sniffed price and a scanned price for
 * the very same market would land in two different city buckets.
 *
 * Folding rules, from albiondata-models-dotNet/Locations.cs and
 * albiondata-deduper-dotNet/Program.cs:
 *   - the five "Into the Fray" portal towns share their parent city's market,
 *   - Caerleon 2 (3013, and its "-Auction2" spelling) is the Caerleon market,
 *   - everything else — rests, hideout banks, Smuggler's Dens, roads zones —
 *     has no city here. Those still upload fine; they simply have no column in
 *     this app.
 */

// Only the eight markets the app itself prices. Deliberately not the full
// Locations enum: a rest or a portal town has no column to fill.
const AODP_LOCATIONS = {
  7: "Thetford",
  1002: "Lymhurst",
  2004: "Bridgewatch",
  3003: "Black Market",
  3005: "Caerleon",
  3008: "Martlock",
  4002: "Fort Sterling",
  5003: "Brecilien",
};

// Portal town → the city whose market it mirrors.
const PORTAL_TOWNS = { 301: 7, 1301: 1002, 2301: 2004, 3301: 3008, 4301: 4002 };

// Caerleon's second auction house is the same market as the first.
const CAERLEON_2 = 3013;
const CAERLEON = 3005;

/**
 * Canonical numeric market id, or null when the location is not a market the
 * app knows how to fold (roads zones, hideout banks, dens).
 * @param {string|number|null} raw
 * @returns {number|null}
 */
function normalizeMarketLocationId(raw) {
  if (raw === null || raw === undefined) return null;
  let text = String(raw).trim();
  if (!text) return null;
  // "3013-Auction2" is the only lettered form that still names a real market.
  if (/^\d+-Auction2$/i.test(text)) text = text.split("-")[0];
  if (!/^\d+$/.test(text)) return null;

  const id = parseInt(text, 10);
  if (id === CAERLEON_2) return CAERLEON;
  if (PORTAL_TOWNS[id] !== undefined) return PORTAL_TOWNS[id];
  return id;
}

/**
 * App city name for a raw location id, or null when the app prices no such
 * market.
 * @param {string|number|null} raw
 * @returns {string|null}
 */
function marketCityName(raw) {
  const id = normalizeMarketLocationId(raw);
  if (id === null) return null;
  return AODP_LOCATIONS[id] || null;
}

/**
 * Whether a location is one the ingest accepts. Mirrors the reference client's
 * IsValidLocation: plain digits, a hideout bank, a hell den or an auction
 * house. Anything else (a roads tunnel, an unset location) would be filed
 * under a meaningless key, so it is never uploaded.
 * @param {string|number|null} raw
 */
function isUploadableLocation(raw) {
  if (raw === null || raw === undefined) return false;
  const text = String(raw).trim();
  if (!text) return false;
  return /^\d+$/.test(text)
    || text.startsWith("BLACKBANK-")
    || /-HellDen$/.test(text)
    || /-Auction2$/i.test(text);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AODP_LOCATIONS, PORTAL_TOWNS,
    normalizeMarketLocationId, marketCityName, isUploadableLocation,
  };
}
