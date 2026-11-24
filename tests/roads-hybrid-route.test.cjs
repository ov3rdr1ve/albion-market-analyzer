/**
 * Tests for the hybrid route finder — js/roads-hybrid-route.js.
 *
 * The Roads panel used to search live portals alone, so "Lymhurst →
 * Murdergulch Ravine" answered "no live route" even when a mapped portal landed
 * ten zones away from the target. The hybrid finder walks BOTH edge sets at
 * once: portals (expiring, entered) and foot edges (static, from world.xml).
 * Every hop costs 1, so plain BFS stays optimal; the two kinds are only counted
 * and reported apart.
 *
 * Two rules sit on top of that search:
 *   - `prefer` weights each KIND of hop, so "Roads first" can beat a shorter run;
 *   - `realmgate` models the character's portal-city binding — royal → outlands
 *     only through your own gate, while coming back through any gate re-binds you.
 *
 * Black-box over a stub graph and a stub overland map — no catalog, no
 * localStorage, no network.
 *
 * Run: node tests/roads-hybrid-route.test.cjs
 */

const assert = require("assert");
const { findHybridRoute, findClosestApproach } = require("../js/roads-hybrid-route.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;

/**
 * Stub portal graph: `[from, to, hoursLeft]`. Mirrors data-roads-portals.js —
 * `neighbors` hands back live edges only, and the router still re-checks
 * `expiresAt` against `minSecondsLeft`.
 */
function stubGraph(edges) {
  const portals = edges.map(([from, to, hours]) => ({
    fromZoneId: from,
    toZoneId: to,
    expiresAt: NOW + hours * HOUR,
    isLive: (at) => NOW + hours * HOUR > at,
    other: (id) => (id === from ? to : from),
  }));
  return {
    all: () => portals,
    neighbors(zoneId, at) {
      return portals
        .filter((p) => p.isLive(at) && (p.fromZoneId === zoneId || p.toZoneId === zoneId))
        .map((p) => ({ zoneId: p.other(zoneId), portal: p }))
        .sort((a, b) => a.zoneId.localeCompare(b.zoneId));
    },
  };
}

/** Stub foot map: `{ zone: [neighbors] }`, made symmetric for the caller. */
function stubOverland(map) {
  const adj = new Map();
  for (const [id, neighbors] of Object.entries(map)) {
    for (const n of neighbors) {
      if (!adj.has(id)) adj.set(id, new Set());
      if (!adj.has(n)) adj.set(n, new Set());
      adj.get(id).add(n);
      adj.get(n).add(id);
    }
  }
  return (zoneId) => [...(adj.get(zoneId) || [])].sort();
}

/** Stub travel network: `[a, b, cost, noLuggage]`, expanded both ways. */
function stubTravel(pairs) {
  const map = new Map();
  const link = (from, to, cost, noLuggage) => {
    if (!map.has(from)) map.set(from, []);
    map.get(from).push({ zoneId: to, cost, noLuggage });
  };
  for (const [a, b, cost, noLuggage = false] of pairs) {
    link(a, b, cost, noLuggage);
    link(b, a, cost, noLuggage);
  }
  return (zoneId) => map.get(zoneId) || [];
}

const NO_PORTALS = stubGraph([]);
const NO_FOOT = () => [];
const NO_TRAVEL = () => [];

// ── portal-only behaviour is unchanged ─────────────────────────────────────

test("a portal chain routes exactly as the portal-only finder did", () => {
  const graph = stubGraph([["TNL-1", "TNL-2", 6], ["TNL-2", "TNL-3", 9]]);
  const route = findHybridRoute(graph, "TNL-1", "TNL-3", { now: NOW, overland: NO_FOOT });
  assert.deepStrictEqual(route.zones, ["TNL-1", "TNL-2", "TNL-3"]);
  assert.strictEqual(route.hops, 2);
  assert.strictEqual(route.portalHops, 2);
  assert.strictEqual(route.footHops, 0);
  assert.strictEqual(route.portals.length, 2);
});

test("the route expires with its shortest-lived portal", () => {
  const graph = stubGraph([["TNL-1", "TNL-2", 6], ["TNL-2", "TNL-3", 2]]);
  const route = findHybridRoute(graph, "TNL-1", "TNL-3", { now: NOW, overland: NO_FOOT });
  assert.strictEqual(route.expiresAt, NOW + 2 * HOUR);
  assert.strictEqual(route.secondsLeft, 2 * 3600);
});

test("from equals to is a zero-hop route", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "1000", { now: NOW, overland: NO_FOOT });
  assert.deepStrictEqual(route.zones, ["1000"]);
  assert.strictEqual(route.hops, 0);
  assert.strictEqual(route.secondsLeft, Infinity);
});

test("nothing reachable returns null", () => {
  assert.strictEqual(findHybridRoute(NO_PORTALS, "1000", "3355", { now: NOW, overland: NO_FOOT }), null);
  assert.strictEqual(findHybridRoute(null, "1000", "3355", { now: NOW }), null);
  assert.strictEqual(findHybridRoute(NO_PORTALS, "1000", "", { now: NOW }), null);
});

// ── foot edges ─────────────────────────────────────────────────────────────

const FOOT = stubOverland({
  1000: ["1207", "1215"],
  1207: ["1211"],
  1211: ["1213"],
  3355: ["0347"],
  "0347": ["0348"],
  "0348": ["0353"],
});

test("a walkable pair routes with no portals at all", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "1213", { now: NOW, overland: FOOT });
  assert.deepStrictEqual(route.zones, ["1000", "1207", "1211", "1213"]);
  assert.strictEqual(route.footHops, 3);
  assert.strictEqual(route.portalHops, 0);
  assert.strictEqual(route.expiresAt, Infinity);
  assert.strictEqual(route.secondsLeft, Infinity);
  assert.deepStrictEqual(route.portalPairs, []);
});

test("foot legs and portal legs combine into one plan", () => {
  const graph = stubGraph([["1211", "TNL-1", 8], ["TNL-1", "TNL-2", 5], ["TNL-2", "0353", 7]]);
  const route = findHybridRoute(graph, "1000", "0347", { now: NOW, overland: FOOT });
  assert.deepStrictEqual(route.zones, ["1000", "1207", "1211", "TNL-1", "TNL-2", "0353", "0348", "0347"]);
  assert.strictEqual(route.portalHops, 3);
  assert.strictEqual(route.footHops, 4);
  assert.strictEqual(route.hops, 7);
  assert.deepStrictEqual(route.steps.map((s) => s.via),
    ["foot", "foot", "portal", "portal", "portal", "foot", "foot"]);
  assert.strictEqual(route.secondsLeft, 5 * 3600);
});

test("only portal hops become map edges", () => {
  const graph = stubGraph([["1211", "TNL-1", 8], ["TNL-1", "TNL-2", 5], ["TNL-2", "0353", 7]]);
  const route = findHybridRoute(graph, "1000", "0347", { now: NOW, overland: FOOT });
  assert.deepStrictEqual(route.portalPairs,
    [["1211", "TNL-1"], ["TNL-1", "TNL-2"], ["TNL-2", "0353"]]);
});

test("the shorter of two ways wins, whichever kind it is", () => {
  // 1000 → 1215 on foot is 1 hop; the portal detour is 2.
  const graph = stubGraph([["1000", "TNL-9", 6], ["TNL-9", "1215", 6]]);
  const route = findHybridRoute(graph, "1000", "1215", { now: NOW, overland: FOOT });
  assert.deepStrictEqual(route.zones, ["1000", "1215"]);
  assert.strictEqual(route.footHops, 1);
});

// ── expiry filtering ───────────────────────────────────────────────────────

test("an expired portal is invisible, foot edges are not", () => {
  const graph = stubGraph([["1211", "TNL-1", -1], ["TNL-1", "0347", 6]]);
  assert.strictEqual(findHybridRoute(graph, "1000", "0347", { now: NOW, overland: FOOT }), null);
  const route = findHybridRoute(graph, "1000", "1211", { now: NOW, overland: FOOT });
  assert.strictEqual(route.footHops, 2);
});

test("minSecondsLeft drops portals that will not survive the trip", () => {
  const graph = stubGraph([["1000", "TNL-1", 1], ["TNL-1", "3355", 6]]);
  const options = { now: NOW, overland: FOOT };
  assert.ok(findHybridRoute(graph, "1000", "3355", options));
  assert.strictEqual(
    findHybridRoute(graph, "1000", "3355", { ...options, minSecondsLeft: 2 * 3600 }),
    null,
  );
});

test("minSecondsLeft never filters a foot hop", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "1213", {
    now: NOW, overland: FOOT, minSecondsLeft: 12 * 3600,
  });
  assert.strictEqual(route.footHops, 3);
});

// ── city travel ────────────────────────────────────────────────────────────
//
// 1000 Lymhurst, 1301 its bound portal city (free), 3003 Caerleon (no luggage).
// Caerleon is one zone from the target, the portal city three.

const TRAVEL = stubTravel([["1000", "1301", 0], ["1000", "3003", 4, true], ["3003", "3004", 1, true]]);
const FOOT2 = stubOverland({ 1301: ["0347"], "0347": ["3355"], 3003: ["3355"] });
const CITY = { now: NOW, overland: FOOT2, travel: TRAVEL };

test("a travel hop is taken when it is the shortest way", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "3355", CITY);
  assert.deepStrictEqual(route.zones, ["1000", "3003", "3355"]);
  assert.strictEqual(route.travelHops, 1);
  assert.strictEqual(route.footHops, 1);
  assert.strictEqual(route.portalHops, 0);
  assert.deepStrictEqual(route.steps.map((s) => s.via), ["travel", "foot"]);
});

test("a travel step carries its fee modifier and luggage flag", () => {
  const step = findHybridRoute(NO_PORTALS, "1000", "3355", CITY).steps[0];
  assert.strictEqual(step.cost, 4);
  assert.strictEqual(step.noLuggage, true);
});

test("carrying cargo routes around every no-luggage hop", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "3355", { ...CITY, allowNoLuggage: false });
  assert.deepStrictEqual(route.zones, ["1000", "1301", "0347", "3355"]);
  assert.strictEqual(route.travelHops, 1);
  assert.strictEqual(route.footHops, 2);
  assert.ok(!route.steps.some((s) => s.noLuggage));
});

test("carrying cargo can leave nowhere to go", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "3004", { ...CITY, allowNoLuggage: false });
  assert.strictEqual(route, null);
  assert.strictEqual(findHybridRoute(NO_PORTALS, "1000", "3004", CITY).travelHops, 2);
});

test("an all-travel route never expires and lights no map edge", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "3003", CITY);
  assert.strictEqual(route.hops, 1);
  assert.strictEqual(route.expiresAt, Infinity);
  assert.strictEqual(route.secondsLeft, Infinity);
  assert.deepStrictEqual(route.portalPairs, []);
});

test("portals, travel and running combine, and only portals become map edges", () => {
  const graph = stubGraph([["3355", "TNL-1", 4], ["TNL-1", "0353", 4]]);
  const route = findHybridRoute(graph, "1000", "0353", CITY);
  assert.deepStrictEqual(route.steps.map((s) => s.via), ["travel", "foot", "portal", "portal"]);
  assert.strictEqual(route.travelHops, 1);
  assert.strictEqual(route.portalHops, 2);
  assert.strictEqual(route.footHops, 1);
  assert.deepStrictEqual(route.portalPairs, [["3355", "TNL-1"], ["TNL-1", "0353"]]);
  assert.strictEqual(route.secondsLeft, 4 * 3600);
});

test("no travel lookup means no travel edges", () => {
  assert.strictEqual(findHybridRoute(NO_PORTALS, "1000", "3355", { now: NOW, overland: FOOT2 }), null);
  assert.strictEqual(
    findHybridRoute(NO_PORTALS, "1000", "3355", { now: NOW, overland: FOOT2, travel: NO_TRAVEL }),
    null,
  );
});

// ── prefer: which kind of hop wins ─────────────────────────────────────────
//
// A → B four ways over the same stubs: 4 portal hops, 2 foot hops, or 1 travel.

const PREFER_PORTALS = stubGraph([["A", "p1", 6], ["p1", "p2", 6], ["p2", "p3", 6], ["p3", "B", 6]]);
const PREFER_FOOT = stubOverland({ A: ["f1"], f1: ["B"] });
const PREFER_TRAVEL = stubTravel([["A", "B", 5]]);

test("prefer Roads takes four portals over two zones on foot", () => {
  const route = findHybridRoute(PREFER_PORTALS, "A", "B", {
    now: NOW, overland: PREFER_FOOT, travel: NO_TRAVEL, prefer: "portal",
  });
  assert.strictEqual(route.portalHops, 4);
  assert.strictEqual(route.footHops, 0);
});

test("prefer running takes the two zones on foot", () => {
  const route = findHybridRoute(PREFER_PORTALS, "A", "B", {
    now: NOW, overland: PREFER_FOOT, travel: NO_TRAVEL, prefer: "foot",
  });
  assert.strictEqual(route.footHops, 2);
  assert.strictEqual(route.portalHops, 0);
});

test("prefer city travel takes the travel hop over a shorter portal path", () => {
  const graph = stubGraph([["A", "p1", 6], ["p1", "B", 6]]);
  const options = { now: NOW, overland: NO_FOOT, travel: PREFER_TRAVEL };
  assert.strictEqual(findHybridRoute(graph, "A", "B", { ...options, prefer: "travel" }).travelHops, 1);
  assert.strictEqual(findHybridRoute(graph, "A", "B", { ...options, prefer: "portal" }).portalHops, 2);
});

test("no preference is plain hop count, exactly as before", () => {
  const options = { now: NOW, overland: PREFER_FOOT, travel: NO_TRAVEL };
  assert.strictEqual(findHybridRoute(PREFER_PORTALS, "A", "B", options).footHops, 2);
  assert.strictEqual(
    findHybridRoute(PREFER_PORTALS, "A", "B", { ...options, prefer: "nonsense" }).footHops, 2,
  );
});

test("a preference cannot invent a route that does not exist", () => {
  const route = findHybridRoute(NO_PORTALS, "A", "B", {
    now: NOW, overland: PREFER_FOOT, travel: NO_TRAVEL, prefer: "portal",
  });
  assert.strictEqual(route.footHops, 2);
});

// fastest weights hops in seconds: travel 15, portal 45, foot 75.
const FASTEST_PORTALS = stubGraph([["A", "p1", 6], ["p1", "p2", 6], ["p2", "B", 6]]);

test("fastest prefers three portals to two zones on foot", () => {
  const route = findHybridRoute(FASTEST_PORTALS, "A", "B", {
    now: NOW, overland: PREFER_FOOT, travel: NO_TRAVEL, prefer: "fastest",
  });
  assert.strictEqual(route.portalHops, 3);
  assert.strictEqual(route.estimatedSeconds, 135);
});

test("fastest prefers a travel plus one run to either of them", () => {
  const route = findHybridRoute(FASTEST_PORTALS, "A", "B", {
    now: NOW,
    overland: stubOverland({ A: ["f1"], f1: ["B"], t: ["B"] }),
    travel: stubTravel([["A", "t", 5]]),
    prefer: "fastest",
  });
  assert.deepStrictEqual(route.steps.map((s) => s.via), ["travel", "foot"]);
  assert.strictEqual(route.estimatedSeconds, 90);
});

test("every route reports its estimate, whatever the preference", () => {
  const route = findHybridRoute(NO_PORTALS, "A", "B", {
    now: NOW, overland: PREFER_FOOT, travel: NO_TRAVEL, prefer: "foot",
  });
  assert.strictEqual(route.estimatedSeconds, 150);
});

// ── realmgate binding ──────────────────────────────────────────────────────
//
// 1000/0000 royal cities, 1301/0301 their portal cities. The target sits one
// zone behind the Thetford gate and five behind the Lymhurst one.

const GATES = new Map([["1301", "1000"], ["0301", "0000"]]);
const GATE_TRAVEL = stubTravel([["1000", "1301", 0], ["0000", "0301", 0], ["1000", "0000", 5]]);
const GATE_FOOT = stubOverland({
  "0301": ["bz1"], bz1: ["target"],
  1301: ["ly1"], ly1: ["ly2"], ly2: ["ly3"], ly3: ["ly4"], ly4: ["target"],
});
const GATED = { now: NOW, overland: GATE_FOOT, travel: GATE_TRAVEL, gates: GATES };

test("with no binding set every gate is open, as before", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "target", GATED);
  assert.ok(route.zones.includes("0301"));
});

test("a binding shuts the other four gates", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "target", { ...GATED, realmgate: "1301" });
  assert.ok(!route.zones.includes("0301"), route.zones.join(" "));
  assert.ok(route.zones.includes("1301"));
  assert.strictEqual(route.footHops, 5);
});

test("gate steps are marked outbound and inbound", () => {
  const out = findHybridRoute(NO_PORTALS, "1000", "1301", { ...GATED, realmgate: "1301" });
  assert.strictEqual(out.steps[0].gate, "out");
  const back = findHybridRoute(NO_PORTALS, "1301", "1000", { ...GATED, realmgate: "1301" });
  assert.strictEqual(back.steps[0].gate, "in");
  assert.strictEqual(back.steps[0].rebindsTo, "1301");
});

test("coming home through a foreign gate is allowed", () => {
  const route = findHybridRoute(NO_PORTALS, "0301", "0000", { ...GATED, realmgate: "1301" });
  assert.strictEqual(route.travelHops, 1);
  assert.strictEqual(route.steps[0].gate, "in");
});

test("a foreign gate re-binds you, so your own gate shuts behind it", () => {
  // Walking home through Thetford's gate re-binds you there, so 1000 → 1301 is
  // refused for the rest of the trip and the only way left is running.
  const bound = findHybridRoute(NO_PORTALS, "0301", "ly1", { ...GATED, realmgate: "1301" });
  assert.strictEqual(bound.travelHops, 0);
  assert.strictEqual(bound.footHops, 6);
  // Unbound, the same trip takes the gates: 0301 ⇢ 0000 ⇢ 1000 ⇢ 1301 › ly1.
  const free = findHybridRoute(NO_PORTALS, "0301", "ly1", GATED);
  assert.strictEqual(free.travelHops, 3);
  assert.strictEqual(free.footHops, 1);
});

test("a binding never touches city-to-city travel", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "0000", { ...GATED, realmgate: "1301" });
  assert.strictEqual(route.travelHops, 1);
  assert.ok(!route.steps[0].gate);
});

// ── the Brecilien pocket: a sink, not a hole ───────────────────────────────
// 5000 the city, 5001 its second cluster, 5102 a zone around it — the Mists.
// Every T8 Roads zone holds a permanent portal IN, and the only way out is the
// city's unstable exit, which lands in a random Road no edge can name. So the
// pocket takes routes and never gives them back: reachable, never a waypoint,
// never a start.

const POCKET = new Set(["5000", "5001", "5102"]);
const BREC_TRAVEL = stubTravel([["1000", "5000", 10], ["0000", "5000", 10], ["1000", "0000", 5]]);
const BREC_FOOT = stubOverland({ 5000: ["5001", "5102"] });
const BREC_PORTALS = stubGraph([["5001", "TNL-5", 6], ["TNL-5", "0000", 6]]);
const BREC = { now: NOW, overland: BREC_FOOT, travel: BREC_TRAVEL, offNetwork: POCKET };
// The static T8 portal, injected the way every other edge set is.
const DEEP = new Set(["TNL-8", "TNL-9"]);
const BREC_IN = (zoneId) => (DEEP.has(zoneId) ? [{ neighbor: "5000", kind: "brecilien" }] : []);

test("city travel reaches Brecilien", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "5000", BREC);
  assert.deepStrictEqual(route.zones, ["1000", "5000"]);
  assert.strictEqual(route.travelHops, 1);
});

test("a deep road reaches Brecilien through its own portal", () => {
  const graph = stubGraph([["TNL-1", "TNL-8", 6]]);
  const route = findHybridRoute(graph, "TNL-1", "5000", { ...BREC, brecilien: BREC_IN });
  assert.deepStrictEqual(route.zones, ["TNL-1", "TNL-8", "5000"]);
  assert.strictEqual(route.hops, 2);
  assert.strictEqual(route.portalHops, 1);
  assert.strictEqual(route.footHops, 0);
  assert.strictEqual(route.travelHops, 0);
  assert.strictEqual(route.steps[1].via, "brecilien");
});

test("the Brecilien portal never expires the route", () => {
  const graph = stubGraph([["TNL-1", "TNL-8", 6]]);
  const route = findHybridRoute(graph, "TNL-1", "5000", { ...BREC, brecilien: BREC_IN });
  assert.strictEqual(route.expiresAt, NOW + 6 * HOUR);
  assert.strictEqual(route.portals.length, 1);
});

test("a shallow road has no portal of its own", () => {
  assert.strictEqual(
    findHybridRoute(NO_PORTALS, "TNL-1", "5000", { ...BREC, brecilien: BREC_IN }),
    null,
  );
});

test("a zone deeper in the pocket is reached on foot from the city", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "5102", BREC);
  assert.deepStrictEqual(route.zones, ["1000", "5000", "5102"]);
  assert.strictEqual(route.footHops, 1);
});

test("a pocket zone is not a starting point", () => {
  assert.strictEqual(findHybridRoute(NO_PORTALS, "5000", "1000", BREC), null);
  assert.strictEqual(findHybridRoute(NO_PORTALS, "5102", "1000", BREC), null);
});

test("no route travels in and travels out again", () => {
  const detour = { ...BREC, travel: stubTravel([["1000", "5000", 10], ["0000", "5000", 10]]) };
  assert.strictEqual(findHybridRoute(NO_PORTALS, "1000", "0000", detour), null);
});

test("no route walks in through a deep road and out through travel", () => {
  const graph = stubGraph([["TNL-1", "TNL-8", 6]]);
  const route = findHybridRoute(graph, "TNL-1", "0000", { ...BREC, brecilien: BREC_IN });
  assert.strictEqual(route, null);
});

test("a portal recorded inside the pocket is unusable from outside", () => {
  // The shape the panel actually produced: ⇢ Brecilien › Brecilien ⟶ Roads.
  assert.strictEqual(findHybridRoute(BREC_PORTALS, "1000", "0000", {
    ...BREC, travel: stubTravel([["1000", "5000", 10]]),
  }), null);
});

test("and unusable from inside — that portal cannot exist", () => {
  assert.strictEqual(findHybridRoute(BREC_PORTALS, "5000", "0000", {
    ...BREC, travel: stubTravel([["1000", "5000", 10]]),
  }), null);
});

test("a route that never nears the pocket is untouched", () => {
  const route = findHybridRoute(NO_PORTALS, "1000", "0000", BREC);
  assert.deepStrictEqual(route.zones, ["1000", "0000"]);
});

test("closest approach has nothing to say about a reachable Brecilien", () => {
  const positions = new Map([["1000", { x: 0, y: 0 }], ["0000", { x: 1, y: 1 }], ["5000", { x: 2, y: 2 }]]);
  assert.strictEqual(findClosestApproach(NO_PORTALS, "1000", "5000", { ...BREC, positions }), null);
});

test("closest approach never answers with a pocket zone", () => {
  const positions = new Map([["1000", { x: 0, y: 0 }], ["5000", { x: 9, y: 9 }], ["3355", { x: 10, y: 10 }]]);
  const found = findClosestApproach(NO_PORTALS, "1000", "3355", { ...BREC, positions });
  assert.ok(!found || !POCKET.has(found.target));
});

test("without the option nothing is off the network", () => {
  const open = {
    now: NOW, overland: BREC_FOOT, offNetwork: new Set(),
    travel: stubTravel([["1000", "5000", 10], ["0000", "5000", 10]]),
  };
  assert.strictEqual(findHybridRoute(NO_PORTALS, "1000", "0000", open).travelHops, 2);
});


// ── closest approach ───────────────────────────────────────────────────────

const POSITIONS = new Map([
  ["1000", { x: 127, y: -313 }],
  ["1215", { x: 120, y: -300 }],
  ["3355", { x: -47, y: 197 }],
  ["0353", { x: 6, y: 362 }],
  ["0347", { x: 0, y: 300 }],
]);

test("a portal onto the target's continent makes it a route, not an approach", () => {
  // The point of the hybrid finder: land anywhere on the far side and the rest
  // is running, so closest-approach must stand down.
  const graph = stubGraph([["1211", "TNL-1", 8], ["TNL-1", "0353", 8]]);
  const options = { now: NOW, overland: FOOT, positions: POSITIONS };
  assert.strictEqual(findClosestApproach(graph, "1000", "3355", options), null);
  assert.strictEqual(findHybridRoute(graph, "1000", "3355", options).footHops, 5);
});

test("closest approach names the reachable zone nearest the target on the map", () => {
  const found = findClosestApproach(NO_PORTALS, "1000", "3355", {
    now: NOW, overland: FOOT, positions: POSITIONS,
  });
  assert.strictEqual(found.target, "1215");
  assert.strictEqual(found.distance, 524);
  assert.deepStrictEqual(found.route.zones, ["1000", "1215"]);
});

test("closest approach ignores zones with no world position", () => {
  // 1207/1211/1213 are reachable but unplaced — only 1215 can be offered.
  const found = findClosestApproach(NO_PORTALS, "1000", "3355", {
    now: NOW, overland: FOOT, positions: new Map([["1000", { x: 0, y: 0 }], ["3355", { x: 1, y: 1 }]]),
  });
  assert.strictEqual(found, null);
});

test("closest approach needs a position for the destination", () => {
  const found = findClosestApproach(NO_PORTALS, "1000", "TNL-7", {
    now: NOW, overland: FOOT, positions: POSITIONS,
  });
  assert.strictEqual(found, null);
});

test("closest approach returns null when it cannot beat standing still", () => {
  const found = findClosestApproach(NO_PORTALS, "1000", "3355", {
    now: NOW, overland: NO_FOOT, positions: POSITIONS,
  });
  assert.strictEqual(found, null);
});

test("closest approach returns null when the route would be the route", () => {
  // Reachable target: the caller should have taken findHybridRoute instead.
  assert.strictEqual(
    findClosestApproach(NO_PORTALS, "1000", "1213", { now: NOW, overland: FOOT }),
    null,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
