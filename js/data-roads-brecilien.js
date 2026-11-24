/**
 * The Brecilien entrances — the one static link into the Mists pocket.
 *
 * Every other roads↔roads and roads↔world crossing is a tunnel exit: hand-entered,
 * unordered, dead in 12-24h (js/data-roads-portals.js). The Brecilien portal is
 * none of those things. It stands in the deep Roads zones, permanently, whether
 * or not anyone has entered it — so it is DERIVED from the zone catalog rather
 * than recorded, and a `gen-roads-zones.cjs` regen cannot leave it stale.
 *
 * Deep does not mean every T8 zone. world.xml splits the T8 roads into
 * TUNNEL_DEEP and TUNNEL_DEEP_RAID, and only the TUNNEL_DEEP cluster files
 * contain the static portal (the S_ROADS_Portal_Mistcity_01 template —
 * verified across all 30 cluster files, ao-bin-dumps 2026-08-29). The raid
 * roads — Fynitos-Ezatam among them — have no way into Brecilien at all, which
 * is why the catalog carries the raw cluster type as `worldType`.
 *
 * It is also the only DIRECTED link on the map. You walk into Brecilien; the
 * way back out is the city's unstable portal, which drops you in a random Road.
 * That exit is a real thing in the game and still an unmappable one — no edge
 * can name where it lands — which is why the pocket is a sink and never a
 * source (js/roads-hybrid-route.js).
 *
 * Note the zone id: Brecilien names four of its own clusters, and 5000 is the
 * one carrying the travel network (see js/data-roads-zones.js).
 */

const BRECILIEN_ZONE_ID = "5000";

let brecilienEntranceSet = null;

/**
 * The zone catalog: the plain global in the browser, the sibling module under
 * Node, where the tests load this file alone. An absent catalog means no
 * entrances — never a thrown error and never a guessed list.
 */
function brecilienZoneCatalog() {
  if (typeof ROADS_ZONES !== "undefined") return ROADS_ZONES;
  if (typeof require === "function") {
    try { return require("./data-roads-zones.js").ROADS_ZONES; } catch { return []; }
  }
  return [];
}

/**
 * Every zone with a Brecilien portal, as one memoized Set: the tier-8 Roads
 * zones world.xml types TUNNEL_DEEP — the ones whose cluster file carries the
 * static Mistcity portal. The TUNNEL_DEEP_RAID zones (and any zone no cluster
 * backs, like the mapper's phantom files-izizaum) have no portal.
 */
function brecilienEntrances() {
  if (!brecilienEntranceSet) {
    brecilienEntranceSet = new Set(
      brecilienZoneCatalog()
        .filter((zone) => zone && zone.type === "roads" && zone.tier === 8
          && zone.worldType === "TUNNEL_DEEP")
        .map((zone) => zone.id),
    );
  }
  return brecilienEntranceSet;
}

/** Does this zone hold a Brecilien portal? */
function isBrecilienEntrance(zoneId) {
  return typeof zoneId === "string" && brecilienEntrances().has(zoneId);
}

/**
 * The static edges leaving `zoneId` — one into Brecilien from a deep road, and
 * nothing at all from anywhere else, Brecilien included.
 */
function brecilienEdgesFrom(zoneId) {
  if (!isBrecilienEntrance(zoneId)) return [];
  return [{ neighbor: BRECILIEN_ZONE_ID, kind: "brecilien" }];
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BRECILIEN_ZONE_ID, brecilienEntrances, isBrecilienEntrance, brecilienEdgesFrom,
  };
}
