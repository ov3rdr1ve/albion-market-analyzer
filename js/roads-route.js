/**
 * Routing over the Roads of Avalon portal graph.
 *
 * Plain breadth-first search: every portal is one hop regardless of size, so
 * the fewest-portals route wins. Two extra rules make it useful in the Roads:
 *
 *   - A route is only as good as its shortest-lived portal, so `expiresAt` is
 *     the MIN over the edges walked — that is when the path stops existing.
 *   - `minSecondsLeft` filters out portals that will not survive the trip, so
 *     "get me home with 20 minutes of slack" is expressible.
 *
 * Neighbour order comes from the graph (sorted by destination id), which keeps
 * equal-length routes deterministic across runs.
 */

/** Rebuild the zone/portal path by walking the BFS parent chain backwards. */
function unwind(cameFrom, targetZoneId, now) {
  const zones = [targetZoneId];
  const portals = [];
  let cursor = targetZoneId;
  while (cameFrom.has(cursor)) {
    const { from, portal } = cameFrom.get(cursor);
    zones.push(from);
    portals.push(portal);
    cursor = from;
  }
  zones.reverse();
  portals.reverse();

  const expiresAt = portals.length ? Math.min(...portals.map((p) => p.expiresAt)) : Infinity;
  return {
    zones,
    portals,
    hops: portals.length,
    expiresAt,
    // One leg nobody timed makes the whole route's clock a ceiling, not a
    // promise. The route is still worth walking — it just cannot say "valid".
    timerEstimated: portals.some((p) => p.estimated),
    secondsLeft: portals.length ? Math.max(0, Math.round((expiresAt - now) / 1000)) : Infinity,
  };
}

/**
 * BFS from `fromZoneId` until `isTarget(zoneId)` matches.
 * @returns {object|null} route, or null when nothing reachable matches
 */
function search(graph, fromZoneId, isTarget, { now, minSecondsLeft = 0 } = {}) {
  if (!graph || !fromZoneId) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  const deadline = at + minSecondsLeft * 1000;

  if (isTarget(fromZoneId)) return unwind(new Map(), fromZoneId, at);

  const seen = new Set([fromZoneId]);
  const cameFrom = new Map();
  let frontier = [fromZoneId];

  while (frontier.length) {
    const next = [];
    for (const zoneId of frontier) {
      for (const { zoneId: neighbor, portal } of graph.neighbors(zoneId, at)) {
        if (seen.has(neighbor)) continue;
        if (portal.expiresAt <= deadline) continue;
        seen.add(neighbor);
        cameFrom.set(neighbor, { from: zoneId, portal });
        if (isTarget(neighbor)) return unwind(cameFrom, neighbor, at);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
}

/** Shortest live route between two zones. */
function findRoute(graph, fromZoneId, toZoneId, options = {}) {
  if (!toZoneId) return null;
  return search(graph, fromZoneId, (zoneId) => zoneId === toZoneId, options);
}

/** Closest live zone satisfying `predicate` (nearest exit, nearest Rest, …). */
function findNearest(graph, fromZoneId, predicate, options = {}) {
  if (typeof predicate !== "function") return null;
  return search(graph, fromZoneId, predicate, options);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { findRoute, findNearest };
}
