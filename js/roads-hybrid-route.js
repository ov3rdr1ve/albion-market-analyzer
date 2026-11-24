/**
 * Routing over the Roads portals AND the open world at the same time.
 *
 * js/roads-route.js answers "which portals get me there" — the right question
 * inside the Roads, and the only one it can answer, because a portal graph
 * holds nothing but entered portals. It is the wrong question at the map's
 * edge: a portal that lands ten zones from the target is still the best play,
 * you simply run the rest. That last stretch lives in js/data-roads-overland.js
 * — the walkable neighbours of every open-world zone, straight from world.xml.
 *
 * So this module searches over the union of three edge sets:
 *
 *   portal edge  expiring, one per entered portal, roads↔roads or roads↔world
 *   foot edge    static, never expires, world↔world only
 *   travel edge  the city travel network — royal city to royal city, to its own
 *                bound portal city, to Caerleon and to Brecilien. Static too,
 *                and the only thing that joins royal to outlands off the Roads.
 *   Brecilien    static and DIRECTED, deep road → the city. The only one-way
 *                edge on the map; see THE POCKET below.
 *
 * Two rules shape which of them a route may use:
 *
 *   PREFERENCE  hops are not interchangeable. Crossing a Roads zone is fast and
 *               short; crossing an open-world zone is neither. `prefer` weights
 *               each KIND (see HOP_WEIGHTS_BY_RANK), so "Roads first" can walk
 *               six portals rather than run two zones, and `"fastest"` weights
 *               them in seconds instead. With no preference every hop costs 1
 *               and the search degrades to the plain shortest-hop answer.
 *
 *   THE POCKET  Brecilien and the Mists sit behind their own closed set of
 *               zones, and the traffic through the wall runs ONE WAY. In is a
 *               white portal standing permanently in the deep T8 Roads zones
 *               (TUNNEL_DEEP only — the raid roads have none, see
 *               js/data-roads-brecilien.js) — the fourth edge set, static like
 *               foot and travel. Out is the city's unstable exit, which drops
 *               you in a random Road no edge can name. So the pocket is a sink:
 *               a destination, never a start, and — because nothing leaves it —
 *               never a waypoint either.
 *
 *   BINDING     a character is bound to ONE portal city. Royal → outlands only
 *               works through that gate; coming back through any gate re-binds
 *               you to it. So the search carries the binding as state, and a
 *               route that walks home through a foreign gate cannot then leave
 *               through your own.
 *
 * When even the union cannot reach the destination, `findClosestApproach`
 * answers the next question down: how close can I get?
 */

// Weight per hop kind, by how the user ranked it. First choice 1, then 3, then
// 10 — 10 is deliberately far enough that a long run never wins on hop count.
const HOP_WEIGHTS_BY_RANK = [1, 3, 10];
// Ranking order when nothing is promoted: portals, then travel, then running.
const BASE_HOP_ORDER = ["portal", "travel", "foot"];
// Rough real time per hop, for `prefer: "fastest"`. A travel is a loading
// screen, a portal hop is one small Roads zone, a foot hop is a whole
// open-world zone on a mount.
const HOP_SECONDS = { travel: 15, portal: 45, foot: 75, brecilien: 45 };

/**
 * Cost per hop kind for a preference. Unknown/absent preference means every
 * hop costs 1, i.e. the shortest-hop answer this module used to give.
 */
function hopWeights(prefer) {
  const weights = rankedHopWeights(prefer);
  // The Brecilien portal is a portal — same kind of hop, same cost. It is not a
  // fourth thing to rank, and the preference picker never offers it as one.
  weights.brecilien = weights.portal;
  return weights;
}

/** The three rankable kinds, weighted by the preference in force. */
function rankedHopWeights(prefer) {
  if (prefer === "fastest") return { ...HOP_SECONDS };
  if (!BASE_HOP_ORDER.includes(prefer)) return { portal: 1, travel: 1, foot: 1 };
  const order = [prefer, ...BASE_HOP_ORDER.filter((kind) => kind !== prefer)];
  const weights = {};
  order.forEach((kind, rank) => { weights[kind] = HOP_WEIGHTS_BY_RANK[rank]; });
  return weights;
}

/** A search node is a zone plus the portal city you are currently bound to. */
function stateKey(zoneId, lock) {
  return `${zoneId}|${lock || ""}`;
}

/** Rebuild the path by walking the parent chain backwards. */
function unwindHybrid(cameFrom, targetKey, now) {
  const chain = [];
  let cursor = targetKey;
  while (cameFrom.has(cursor)) {
    const { from, zone, via, portal, travel, gate, rebindsTo } = cameFrom.get(cursor);
    chain.push({
      zone,
      via: via || (portal ? "portal" : travel ? "travel" : "foot"),
      portal: portal || null,
      cost: travel ? travel.cost : null,
      noLuggage: travel ? travel.noLuggage : false,
      gate: gate || null,
      rebindsTo: rebindsTo || null,
    });
    cursor = from;
  }
  chain.reverse();

  const startZone = cursor.slice(0, cursor.lastIndexOf("|"));
  const zones = [startZone, ...chain.map((step) => step.zone)];
  const portals = chain.filter((step) => step.portal).map((step) => step.portal);
  const travelHops = chain.filter((step) => step.via === "travel").length;
  const footHops = chain.filter((step) => step.via === "foot").length;
  const brecilienHops = chain.filter((step) => step.via === "brecilien").length;
  const portalPairs = chain
    .map((step, i) => (step.portal ? [zones[i], zones[i + 1]] : null))
    .filter(Boolean);
  const estimatedSeconds = chain.reduce((total, step) => total + HOP_SECONDS[step.via], 0);

  // A route is only as good as its shortest-lived portal; foot and travel hops
  // never stop existing.
  const expiresAt = portals.length ? Math.min(...portals.map((p) => p.expiresAt)) : Infinity;
  return {
    zones,
    steps: chain,
    portals,
    portalPairs,
    hops: chain.length,
    portalHops: portals.length,
    travelHops,
    footHops,
    brecilienHops,
    estimatedSeconds,
    expiresAt,
    // Not `estimatedSeconds`' cousin: this is about the portal CLOCKS. One leg
    // nobody timed makes the route's expiry a ceiling rather than a promise.
    timerEstimated: portals.some((p) => p.estimated),
    secondsLeft: portals.length ? Math.max(0, Math.round((expiresAt - now) / 1000)) : Infinity,
  };
}

/** The foot-neighbour lookup to use: injected, else the shipped overland map. */
function resolveOverland(overland) {
  if (typeof overland === "function") return overland;
  if (typeof overlandNeighbors === "function") return overlandNeighbors;
  return () => [];
}

/** The city-travel lookup to use: injected, else the shipped network. */
function resolveTravel(travel) {
  if (typeof travel === "function") return travel;
  if (typeof travelConnections === "function") return travelConnections;
  return () => [];
}

/** The Brecilien entrances: injected, else the shipped catalog-derived set. */
function resolveBrecilien(brecilien) {
  if (typeof brecilien === "function") return brecilien;
  if (typeof brecilienEdgesFrom === "function") return brecilienEdgesFrom;
  return () => [];
}

/** The off-network pocket: injected, else the shipped one (Brecilien). */
function resolveOffNetwork(offNetwork) {
  if (offNetwork && typeof offNetwork.has === "function") return offNetwork;
  if (typeof ROADS_OFF_NETWORK !== "undefined") return ROADS_OFF_NETWORK;
  return new Set();
}

/** The realmgate map (portal city → royal city): injected, else the shipped one. */
function resolveGates(gates) {
  if (gates && typeof gates.get === "function") return gates;
  if (typeof ROADS_REALMGATES !== "undefined") return ROADS_REALMGATES;
  return new Map();
}

/** The world-map position lookup: injected, else the shipped one. */
function resolvePositions(positions) {
  if (positions && typeof positions.get === "function") return positions;
  if (typeof ROADS_ZONE_POS !== "undefined") return ROADS_ZONE_POS;
  return new Map();
}

/**
 * Uniform-cost search over portals + foot edges + city travel. Returns the
 * parent chain and every state reached, so callers can either unwind a hit or
 * reason about the whole reachable set.
 */
function hybridSearch(graph, fromZoneId, isTarget, options = {}) {
  const {
    now, minSecondsLeft = 0, overland, travel, allowNoLuggage = true,
    prefer = null, realmgate = null, gates, offNetwork, brecilien,
  } = options;
  const at = Number.isFinite(now) ? now : Date.now();
  const deadline = at + minSecondsLeft * 1000;
  const walk = resolveOverland(overland);
  const ride = resolveTravel(travel);
  const enter = resolveBrecilien(brecilien);
  const gateMap = resolveGates(gates);
  const pocket = resolveOffNetwork(offNetwork);
  const weights = hopWeights(prefer);

  // Standing in the pocket, there is no Roads question to answer: the only way
  // out is the city's unstable portal, and where it lands is nobody's to say.
  if (pocket.has(fromZoneId)) return { cameFrom: new Map(), best: new Map(), hit: null, at };

  const start = stateKey(fromZoneId, realmgate);
  const best = new Map([[start, 0]]);
  const cameFrom = new Map();
  const buckets = new Map([[0, [{ key: start, zoneId: fromZoneId, lock: realmgate }]]]);
  let hit = isTarget(fromZoneId) ? start : null;

  for (let cost = 0; !hit && buckets.size; cost++) {
    const bucket = buckets.get(cost);
    if (!bucket) continue;
    buckets.delete(cost);
    for (const { key, zoneId, lock } of bucket) {
      if (best.get(key) !== cost) continue; // superseded by a cheaper path
      if (isTarget(zoneId)) { hit = key; break; }

      const edges = [];
      if (graph && typeof graph.neighbors === "function") {
        for (const { zoneId: neighbor, portal } of graph.neighbors(zoneId, at)) {
          if (portal.expiresAt <= deadline) continue;
          edges.push({ neighbor, portal, travel: null, lock, via: "portal", weight: weights.portal });
        }
      }
      for (const neighbor of walk(zoneId)) {
        edges.push({ neighbor, portal: null, travel: null, lock, via: "foot", weight: weights.foot });
      }
      // The deep road's own portal into the city. No timer to check: it is as
      // static as a foot edge, and as one-way as the exit it does not model.
      for (const { neighbor } of enter(zoneId)) {
        edges.push({ neighbor, portal: null, travel: null, lock, via: "brecilien", weight: weights.brecilien });
      }
      for (const hop of ride(zoneId)) {
        if (!allowNoLuggage && hop.noLuggage) continue;
        // The realmgate is the cost-0 link between a portal city and its royal
        // city — the one crossing the game gates by binding.
        const outbound = gateMap.get(hop.zoneId) === zoneId;
        const inbound = gateMap.get(zoneId) === hop.zoneId;
        if (outbound && lock && lock !== hop.zoneId) continue;
        edges.push({
          neighbor: hop.zoneId,
          portal: null,
          travel: hop,
          via: "travel",
          gate: outbound ? "out" : inbound ? "in" : null,
          rebindsTo: inbound ? zoneId : null,
          lock: inbound && lock ? zoneId : lock,
          weight: weights.travel,
        });
      }

      for (const edge of edges) {
        // Nothing LEAVES the pocket. Going in is fine — that is what the T8
        // portal and the travel planner are for — but once in, the only exit
        // lands somewhere random, so no hop out of it is a claim worth making.
        // Being unable to leave is also what stops it ever being a waypoint.
        if (pocket.has(zoneId) && !pocket.has(edge.neighbor)) continue;
        const nextKey = stateKey(edge.neighbor, edge.lock);
        const nextCost = cost + edge.weight;
        if (best.has(nextKey) && best.get(nextKey) <= nextCost) continue;
        best.set(nextKey, nextCost);
        cameFrom.set(nextKey, {
          from: key,
          zone: edge.neighbor,
          via: edge.via,
          portal: edge.portal,
          travel: edge.travel,
          gate: edge.gate || null,
          rebindsTo: edge.rebindsTo || null,
        });
        if (!buckets.has(nextCost)) buckets.set(nextCost, []);
        buckets.get(nextCost).push({ key: nextKey, zoneId: edge.neighbor, lock: edge.lock });
      }
      if (hit) break;
    }
  }
  return { cameFrom, best, hit, at };
}

/** Every zone any state reached, mapped to the cheapest state key for it. */
function cheapestStatePerZone(best) {
  const byZone = new Map();
  for (const [key, cost] of best) {
    const zoneId = key.slice(0, key.lastIndexOf("|"));
    const current = byZone.get(zoneId);
    if (!current || cost < current.cost) byZone.set(zoneId, { key, cost });
  }
  return byZone;
}

/**
 * Best live route between two zones, portals, travel and running combined.
 * @returns {object|null} route, or null when the destination is unreachable
 */
function findHybridRoute(graph, fromZoneId, toZoneId, options = {}) {
  if (!fromZoneId || !toZoneId) return null;
  const { cameFrom, hit, at } = hybridSearch(graph, fromZoneId, (id) => id === toZoneId, options);
  return hit ? unwindHybrid(cameFrom, hit, at) : null;
}

/**
 * The best you can do when nothing reaches the destination: the reachable zone
 * closest to it on the world map.
 *
 * Straight-line distance is the only honest measure here. Foot edges are free
 * and symmetric, so any reachable zone sharing the destination's continent
 * would make the destination itself reachable — by the time this function runs,
 * no walkable link to it is known, and hop counts do not exist to be reported.
 *
 * @returns {{route: object, target: string, distance: number}|null} null when
 *          the destination IS reachable (call findHybridRoute instead), when
 *          the start is inside the Brecilien pocket, when nothing but the
 *          starting zone is reachable, or when no position is known for the
 *          zones involved — which covers a pocket destination, since no zone in
 *          there carries a world-map position.
 */
function findClosestApproach(graph, fromZoneId, toZoneId, options = {}) {
  if (!fromZoneId || !toZoneId) return null;
  const { cameFrom, best, hit, at } = hybridSearch(graph, fromZoneId, (id) => id === toZoneId, options);
  if (hit) return null;

  const byZone = cheapestStatePerZone(best);
  byZone.delete(fromZoneId);
  if (!byZone.size) return null;

  const positions = resolvePositions(options.positions);
  const goal = positions.get(toZoneId);
  if (!goal) return null;
  const pocket = resolveOffNetwork(options.offNetwork);

  let nearest = null;
  for (const [zoneId, state] of byZone) {
    // "Get as close as Brecilien, then run" is not advice: nobody runs out of
    // the pocket. Reachable it may be, an approach it never is.
    if (pocket.has(zoneId)) continue;
    // Roads zones carry no world position, which is fitting: "run from here"
    // only means something once you are standing in the open world.
    const pos = positions.get(zoneId);
    if (!pos) continue;
    const distance = Math.hypot(pos.x - goal.x, pos.y - goal.y);
    if (!nearest || distance < nearest.distance) nearest = { key: state.key, zoneId, distance };
  }
  if (!nearest) return null;
  return {
    route: unwindHybrid(cameFrom, nearest.key, at),
    target: nearest.zoneId,
    distance: Math.round(nearest.distance),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    findHybridRoute, findClosestApproach, hopWeights,
    HOP_WEIGHTS_BY_RANK, BASE_HOP_ORDER, HOP_SECONDS,
  };
}
