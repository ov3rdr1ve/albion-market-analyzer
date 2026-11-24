/**
 * Tests for the Roads of Avalon portal graph — the live half of the roads map.
 *
 * Portals are undirected, expire in 12-24h (ao-bin-dumps tunnelsystem.xml:
 * lifetimemin 43200 / lifetimemax 86400) and are entered by hand
 * as the player finds them. The graph is therefore:
 *
 *   - keyed by the unordered zone pair (one live portal per pair; a later
 *     sighting refreshes the record rather than duplicating it),
 *   - time-aware on every read (an expired edge is invisible, not deleted),
 *   - serialisable to a plain object for localStorage.
 *
 * Routing is plain BFS over the live edges: fewest hops wins, ties broken
 * deterministically so the same graph always yields the same route.
 *
 * NO network, NO clock dependency — every case passes an explicit `now`.
 *
 * Run: node tests/roads-portal-graph.test.cjs
 */

const assert = require("assert");
const {
  createPortalGraph,
  portalRetainUntil,
  PORTAL_SIZES,
  MIN_PORTAL_LIFETIME_S,
  MAX_PORTAL_LIFETIME_S,
} = require("../js/data-roads-portals.js");
const { findRoute, findNearest } = require("../js/roads-route.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const T0 = 1_800_000_000_000; // fixed "now" for every case
const HOUR = 3_600_000;
const later = (h) => T0 + h * HOUR;

/** Graph seeded with a small chain: martlock — a — b — c, plus a stub d. */
function chainGraph() {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "a", size: "group", expiresAt: later(6), now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "b", size: "solo", expiresAt: later(8), now: T0 });
  g.record({ fromZoneId: "b", toZoneId: "c", size: "raid", expiresAt: later(4), now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "d", size: "solo", expiresAt: later(2), now: T0 });
  return g;
}

// ── constants ──────────────────────────────────────────────────────────────
test("portal sizes are the three tunnel exit types", () => {
  assert.deepStrictEqual([...PORTAL_SIZES].sort(), ["group", "raid", "solo"]);
});

test("portal lifetime bounds match tunnelsystem.xml", () => {
  assert.strictEqual(MIN_PORTAL_LIFETIME_S, 43200);
  assert.strictEqual(MAX_PORTAL_LIFETIME_S, 86400);
});

// ── recording ──────────────────────────────────────────────────────────────
test("a recorded portal is readable from both ends", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", size: "solo", expiresAt: later(5), now: T0 });
  assert.deepStrictEqual(g.neighbors("a", T0).map((n) => n.zoneId), ["b"]);
  assert.deepStrictEqual(g.neighbors("b", T0).map((n) => n.zoneId), ["a"]);
});

test("recording accepts secondsRemaining instead of an absolute expiry", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 7200, now: T0 });
  assert.strictEqual(g.get("a", "b").expiresAt, later(2));
});

test("re-sighting the same pair refreshes it instead of duplicating", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", size: "solo", expiresAt: later(3), now: T0 });
  g.record({ fromZoneId: "b", toZoneId: "a", size: "group", expiresAt: later(9), now: T0 });
  assert.strictEqual(g.all().length, 1);
  assert.strictEqual(g.get("a", "b").expiresAt, later(9));
  assert.strictEqual(g.get("a", "b").size, "group");
});

test("a refresh never shortens a known expiry", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(9), now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(4), now: T0 });
  assert.strictEqual(g.get("a", "b").expiresAt, later(9));
});

// A guessed timer (a portal entered without a timer, which dates nothing) and a measured one
// (the portal object's own close time) are not the same claim, so the
// never-shrink rule has to give way in exactly one direction.
//
// Note the third row: a guess is not evidence of death, so it is held to the
// 24h ceiling regardless of the number that came with it (see "retention"
// below). Only a measurement can put a portal below that.
const ESTIMATE_CASES = [
  ["a measured expiry replaces a longer guess", true, 9, false, 4, 4, false],
  ["a guess never overrides a measurement", false, 4, true, 9, 4, false],
  ["two guesses both land on the 24h ceiling", true, 9, true, 4, 24, true],
  ["two measurements keep the longer one", false, 4, false, 9, 9, false],
];

for (const [name, firstGuess, firstHours, nextGuess, nextHours, keptHours, keptGuess] of ESTIMATE_CASES) {
  test(name, () => {
    const g = createPortalGraph();
    g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(firstHours), estimated: firstGuess, now: T0 });
    g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(nextHours), estimated: nextGuess, now: T0 });
    assert.strictEqual(g.get("a", "b").expiresAt, later(keptHours));
    assert.strictEqual(g.get("a", "b").estimated, keptGuess);
  });
}

test("a sighting that could not read the size does not erase one that could", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", size: "raid", expiresAt: later(6), now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "b", size: "unknown", expiresAt: later(6), now: T0 });
  assert.strictEqual(g.get("a", "b").size, "raid");
});

// ── zones off the Roads network ────────────────────────────────────────────
//
// No tunnel opens into the Brecilien pocket (5000 the city, 5100 the Weald), so
// a portal with an end there is not a portal anybody found — it is a typo, or
// a white Mists portal mistaken for a tunnel. The graph refuses it at the door
// rather than letting it draw a node on the map.

const OFF_NETWORK_CASES = [
  ["as the destination", "TNL-001", "5000"],
  ["as the origin", "5000", "TNL-001"],
  ["a zone around the city", "TNL-001", "5100"],
  ["both ends", "5000", "5100"],
];

for (const [name, from, to] of OFF_NETWORK_CASES) {
  test(`a portal into the Brecilien pocket is refused — ${name}`, () => {
    const g = createPortalGraph();
    const portal = g.record({ fromZoneId: from, toZoneId: to, size: "solo", expiresAt: later(6), now: T0 });
    assert.strictEqual(portal, null);
    assert.strictEqual(g.all().length, 0);
  });
}

test("an ordinary portal is still recorded", () => {
  const g = createPortalGraph();
  assert.ok(g.record({ fromZoneId: "TNL-001", toZoneId: "3004", size: "solo", expiresAt: later(6), now: T0 }));
});

test("a saved portal into the pocket is dropped on restore", () => {
  // Typed in before the rule existed, or synced from a teammate who did.
  const saved = {
    version: 1,
    portals: [
      { key: "5000|TNL-001", fromZoneId: "TNL-001", toZoneId: "5000", size: "solo", expiresAt: later(6), discoveredAt: T0 },
      { key: "3004|TNL-001", fromZoneId: "TNL-001", toZoneId: "3004", size: "solo", expiresAt: later(6), discoveredAt: T0 },
    ],
  };
  const g = createPortalGraph(saved, T0);
  assert.deepStrictEqual(g.all().map((p) => p.toZoneId), ["3004"]);
});

test("charges survive a re-sighting that does not report them", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", chargesLeft: 3, expiresAt: later(6), now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(6), now: T0 });
  assert.strictEqual(g.get("a", "b").chargesLeft, 3);
});

test("estimated and charges round-trip through toJSON", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", size: "solo", chargesLeft: 2, estimated: true, expiresAt: later(6), now: T0 });
  const back = createPortalGraph(g.toJSON(), T0);
  assert.strictEqual(back.get("a", "b").estimated, true);
  assert.strictEqual(back.get("a", "b").chargesLeft, 2);
});

test("an unknown size falls back to 'unknown'", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", size: "enormous", expiresAt: later(3), now: T0 });
  assert.strictEqual(g.get("a", "b").size, "unknown");
});

test("self-loops are rejected", () => {
  const g = createPortalGraph();
  assert.strictEqual(g.record({ fromZoneId: "a", toZoneId: "a", expiresAt: later(3), now: T0 }), null);
  assert.strictEqual(g.all().length, 0);
});

test("records missing a zone or an expiry are rejected", () => {
  const g = createPortalGraph();
  assert.strictEqual(g.record({ fromZoneId: "a", expiresAt: later(3), now: T0 }), null);
  assert.strictEqual(g.record({ fromZoneId: "a", toZoneId: "b", now: T0 }), null);
  assert.strictEqual(g.all().length, 0);
});

// Every portal is a manual one. Data saved by an
// older build may say "sniffer" or say nothing; it must load, never be refused.
const SOURCE_CASES = [["sniffer", "sniffer"], ["manual", "manual"], ["missing", undefined], ["unknown value", "teammate"]];

for (const [label, source] of SOURCE_CASES) {
  test(`a portal recorded with source ${label} is manual`, () => {
    const g = createPortalGraph();
    g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(3), now: T0, source });
    assert.strictEqual(g.get("a", "b").source, "manual");
  });

  test(`a stored portal with source ${label} loads, as manual`, () => {
    const stored = { version: 1, portals: [
      { fromZoneId: "a", toZoneId: "b", size: "group", expiresAt: later(3), estimated: false, discoveredAt: T0, source },
    ] };
    const g = createPortalGraph(JSON.parse(JSON.stringify(stored)), T0);
    assert.strictEqual(g.all().length, 1, "no stored portal may be rejected");
    assert.strictEqual(g.get("a", "b").source, "manual");
    assert.strictEqual(g.toJSON().portals[0].source, "manual");
  });
}

// ── expiry ─────────────────────────────────────────────────────────────────
test("expired portals disappear from reads but survive until pruned", () => {
  const g = chainGraph();
  const afterExpiry = later(3); // the a—d portal expired at +2h
  assert.deepStrictEqual(g.neighbors("a", afterExpiry).map((n) => n.zoneId), ["b", "martlock"]);
  assert.strictEqual(g.all().length, 4);
  assert.strictEqual(g.all(afterExpiry).length, 3);
});

test("prune drops exactly the expired portals and reports the count", () => {
  const g = chainGraph();
  assert.strictEqual(g.prune(later(5)), 2); // a—d (+2h) and b—c (+4h)
  assert.strictEqual(g.all().length, 2);
});

// prune deletes on the RETENTION rule, not on the printed countdown: a guessed
// timer is evidence of nothing, so a short guess still buys the portal its full
// 24h ceiling. The panel prunes on its countdown tick, so this is what keeps an
// auto-prune from burying a portal that is very much still open.
const GUESS_CASES = [
  ["a one-minute guess survives two hours", 2, 0, 1],
  ["a one-minute guess survives twenty-three hours", 23, 0, 1],
  ["a one-minute guess goes at twenty-five hours", 25, 1, 0],
];
GUESS_CASES.forEach(([name, hours, wantDropped, wantLeft]) => {
  test(`prune: ${name}`, () => {
    const g = createPortalGraph();
    g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 60, estimated: true, now: T0 });
    assert.strictEqual(g.prune(later(hours)), wantDropped);
    assert.strictEqual(g.all().length, wantLeft);
  });
});

test("prune drops a MEASURED portal the moment its own close time passes", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(1), now: T0, estimated: false });
  assert.strictEqual(g.prune(later(1)), 1);
  assert.strictEqual(g.all().length, 0);
});

test("a portal expiring exactly now is already gone", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(1), now: T0 });
  assert.deepStrictEqual(g.neighbors("a", later(1)), []);
});

test("secondsLeft counts down and floors at zero", () => {
  const g = chainGraph();
  assert.strictEqual(g.get("b", "c").secondsLeft(T0), 4 * 3600);
  assert.strictEqual(g.get("b", "c").secondsLeft(later(6)), 0);
});

// ── retention of guessed timers ────────────────────────────────────────────
//
// The game encrypts tunnel exit objects, so almost every entered portal arrives
// with a house guess rather than its own close time. A guess is not evidence of
// death: the only bound anybody has is tunnelsystem.xml's ceiling — no exit
// outlives 24h from spawn, and a sighting cannot predate the spawn. So a
// guessed portal is held 24h from when it was first seen, and the number shown
// is an upper bound. A measurement is exempt: it is the answer.

// [name, expiresAt offset (h), discoveredAt offset (h), estimated, kept-until (h)]
const RETAIN_CASES = [
  ["a guess is held to 24h from the sighting", 6, 0, true, 24],
  ["a guess is never shortened below its own number", 30, 0, true, 30],
  ["a measurement is left exactly as measured", 3, 0, false, 3],
  ["the ceiling counts from discovery, not from now", 6, -8, true, 16],
];

for (const [name, expiryH, discoveredH, estimated, keptH] of RETAIN_CASES) {
  test(name, () => {
    assert.strictEqual(
      portalRetainUntil(later(expiryH), later(discoveredH), estimated),
      later(keptH),
    );
  });
}

test("a guess with no discovery date is left alone", () => {
  assert.strictEqual(portalRetainUntil(later(6), undefined, true), later(6));
  assert.strictEqual(portalRetainUntil(later(6), NaN, true), later(6));
});

test("a guessed portal outlives the fallback it was stamped with", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 6 * 3600, estimated: true, now: T0 });
  assert.deepStrictEqual(g.neighbors("a", later(7)).map((n) => n.zoneId), ["b"]);
  assert.deepStrictEqual(g.neighbors("a", later(23)).map((n) => n.zoneId), ["b"]);
  assert.deepStrictEqual(g.neighbors("a", later(24.5)), []);
});

test("a measured portal still dies on its own clock", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 3 * 3600, now: T0 });
  assert.deepStrictEqual(g.neighbors("a", later(4)), []);
});

test("a measurement arriving after a guess still shortens the timer", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 6 * 3600, estimated: true, now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(2), estimated: false, now: later(1) });
  assert.strictEqual(g.get("a", "b").expiresAt, later(2));
  assert.strictEqual(g.get("a", "b").estimated, false);
});

test("re-sighting a guess counts the ceiling from the FIRST sighting", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 6 * 3600, estimated: true, now: T0 });
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 6 * 3600, estimated: true, now: later(5) });
  assert.strictEqual(g.get("a", "b").expiresAt, later(24));
});

test("a legacy 6h row survives the restore it used to be dropped by", () => {
  const legacy = [{
    fromZoneId: "a", toZoneId: "b", size: "unknown",
    expiresAt: later(6), discoveredAt: T0, estimated: true, source: "sniffer",
  }];
  assert.strictEqual(createPortalGraph(legacy, later(8)).all().length, 1);
  assert.strictEqual(createPortalGraph(legacy, later(25)).all().length, 0);
});

test("a restored measurement is still dropped once it lapses", () => {
  const measured = [{
    fromZoneId: "a", toZoneId: "b", size: "solo",
    expiresAt: later(6), discoveredAt: T0, estimated: false, source: "sniffer",
  }];
  assert.strictEqual(createPortalGraph(measured, later(8)).all().length, 0);
});

// ── serialisation ──────────────────────────────────────────────────────────
test("a graph survives a serialise/restore round-trip", () => {
  const g = chainGraph();
  const restored = createPortalGraph(JSON.parse(JSON.stringify(g.toJSON())));
  assert.deepStrictEqual(restored.all().map((p) => p.key).sort(), g.all().map((p) => p.key).sort());
  assert.strictEqual(restored.get("b", "c").size, "raid");
  assert.strictEqual(restored.get("b", "c").expiresAt, later(4));
});

test("restoring drops portals that expired while the app was closed", () => {
  const g = chainGraph();
  const restored = createPortalGraph(g.toJSON(), later(5));
  assert.strictEqual(restored.all().length, 2);
});

test("restoring from junk yields an empty graph", () => {
  assert.strictEqual(createPortalGraph(null).all().length, 0);
  assert.strictEqual(createPortalGraph({ portals: "nope" }).all().length, 0);
  assert.strictEqual(createPortalGraph([{ nonsense: true }]).all().length, 0);
});

// ── removal ────────────────────────────────────────────────────────────────
test("a portal can be removed by pair, in either order", () => {
  const g = chainGraph();
  assert.strictEqual(g.remove("c", "b"), true);
  assert.strictEqual(g.get("b", "c"), null);
  assert.strictEqual(g.remove("b", "c"), false);
});

test("clear empties the graph", () => {
  const g = chainGraph();
  g.clear();
  assert.deepStrictEqual(g.all(), []);
});

// A map node exists only while some portal names its zone, so deleting a node
// on the map means dropping every portal that touches it. The chain graph gives
// "a" three portals (martlock, b, d), "b" two, "c" and "martlock" one each.
const REMOVE_ZONE_CASES = [
  ["a hub, portals on both sides of the pair", "a", 3, ["b|c"]],
  ["a leaf named as the destination", "d", 1, ["a|b", "b|c", "a|martlock"]],
  ["a leaf named as the origin", "martlock", 1, ["a|b", "a|d", "b|c"]],
  ["a mid-chain zone", "b", 2, ["a|d", "a|martlock"]],
  ["a zone no portal mentions", "elsewhere", 0, ["a|b", "a|d", "a|martlock", "b|c"]],
];

REMOVE_ZONE_CASES.forEach(([why, zoneId, dropped, left]) => {
  test(`removeZone drops every portal at ${why}`, () => {
    const g = chainGraph();
    assert.strictEqual(g.removeZone(zoneId), dropped);
    assert.deepStrictEqual(g.all().map((p) => p.key).sort(), left.slice().sort());
    assert.deepStrictEqual(g.neighbors(zoneId, T0), []);
  });
});

test("removeZone also drops expired portals at the zone", () => {
  const g = chainGraph(); // a—d expired at +2h but is still stored
  assert.strictEqual(g.removeZone("d"), 1);
  assert.strictEqual(g.get("a", "d"), null);
});

test("removeZone rejects a missing zone id without touching the graph", () => {
  const g = chainGraph();
  const before = JSON.stringify(g.toJSON());
  assert.strictEqual(g.removeZone(""), 0);
  assert.strictEqual(g.removeZone(null), 0);
  assert.strictEqual(JSON.stringify(g.toJSON()), before);
});

test("what removeZone left survives a serialise/restore round-trip", () => {
  const g = chainGraph();
  g.removeZone("a");
  const restored = createPortalGraph(JSON.parse(JSON.stringify(g.toJSON())), T0);
  assert.deepStrictEqual(restored.all().map((p) => p.key), ["b|c"]);
});

test("a route through a removed zone no longer resolves", () => {
  const g = chainGraph();
  g.removeZone("b");
  assert.strictEqual(findRoute(g, "martlock", "c", { now: T0 }), null);
  assert.strictEqual(findRoute(g, "martlock", "d", { now: T0 }).hops, 2);
});

// ── manual correction ──────────────────────────────────────────────────────
// The game never exposes a portal's size (it encrypts the object) and a
// portal entered without a timer carries none, so the player has to be able to type both
// in. Unlike `record`, a correction is authoritative: it overwrites in either
// direction, because the person typing it is looking at the portal.
test("update sets the size of a known portal", () => {
  const g = chainGraph();
  const portal = g.update("a", "martlock", { size: "raid" });
  assert.strictEqual(portal.size, "raid");
  assert.strictEqual(g.get("martlock", "a").size, "raid");
});

test("update accepts the pair in either order", () => {
  const g = chainGraph();
  assert.ok(g.update("c", "b", { size: "solo" }));
  assert.strictEqual(g.get("b", "c").size, "solo");
});

const UPDATE_SIZE_CASES = [
  ["solo", "solo"],
  ["group", "group"],
  ["raid", "raid"],
  ["unknown", "unknown"],
  ["nonsense", "unknown"],
];
UPDATE_SIZE_CASES.forEach(([given, want]) => {
  test(`update normalises size ${JSON.stringify(given)} to ${want}`, () => {
    const g = chainGraph();
    assert.strictEqual(g.update("a", "b", { size: given }).size, want);
  });
});

test("update takes secondsRemaining relative to the supplied now", () => {
  const g = chainGraph();
  const portal = g.update("a", "b", { secondsRemaining: 3600, now: T0 });
  assert.strictEqual(portal.expiresAt, later(1));
  assert.strictEqual(portal.secondsLeft(T0), 3600);
});

test("update takes an absolute expiry too", () => {
  const g = chainGraph();
  assert.strictEqual(g.update("a", "b", { expiresAt: later(3) }).expiresAt, later(3));
});

// `record` deliberately refuses to shorten a timer — a sighting from across the
// map may be stale. A typed correction is the opposite case and must win.
test("update SHORTENS a timer, unlike a re-sighting", () => {
  const g = chainGraph(); // a—b expires at +8h
  assert.strictEqual(g.update("a", "b", { secondsRemaining: 600, now: T0 }).expiresAt, T0 + 600_000);
});

test("a typed timer is no longer flagged as estimated", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", secondsRemaining: 7200, now: T0, estimated: true });
  assert.strictEqual(g.get("a", "b").estimated, true);
  assert.strictEqual(g.update("a", "b", { secondsRemaining: 1800, now: T0 }).estimated, false);
});

test("correcting only the size leaves the timer and its provenance alone", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(8), now: T0, estimated: true });
  const portal = g.update("a", "b", { size: "group" });
  assert.strictEqual(portal.expiresAt, later(24)); // still the guess's ceiling
  assert.strictEqual(portal.estimated, true);
});

test("update keeps the recorded orientation, discovery time and source", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "b", toZoneId: "a", expiresAt: later(8), now: T0, source: "manual", chargesLeft: 9 });
  const portal = g.update("a", "b", { size: "raid", secondsRemaining: 60, now: T0 });
  assert.strictEqual(portal.fromZoneId, "b");
  assert.strictEqual(portal.toZoneId, "a");
  assert.strictEqual(portal.discoveredAt, T0);
  assert.strictEqual(portal.source, "manual");
  assert.strictEqual(portal.chargesLeft, 9);
});

test("an update can revive an expired portal", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(1), now: T0 });
  const portal = g.update("a", "b", { secondsRemaining: 3600, now: later(4) });
  assert.strictEqual(portal.isLive(later(4)), true);
  assert.deepStrictEqual(g.neighbors("a", later(4)).map((n) => n.zoneId), ["b"]);
});

const BAD_UPDATE_CASES = [
  ["an unknown pair", ["nowhere", "elsewhere"], { size: "solo" }],
  ["a missing patch", ["a", "b"], null],
  ["a negative timer", ["a", "b"], { secondsRemaining: -60, now: T0 }],
  ["a non-numeric timer", ["a", "b"], { secondsRemaining: "soon", now: T0 }],
];
BAD_UPDATE_CASES.forEach(([why, [x, y], patch]) => {
  test(`update rejects ${why} and leaves the graph untouched`, () => {
    const g = chainGraph();
    const before = JSON.stringify(g.toJSON());
    assert.strictEqual(g.update(x, y, patch), null);
    assert.strictEqual(JSON.stringify(g.toJSON()), before);
  });
});

test("an updated portal survives a serialise/restore round-trip", () => {
  const g = chainGraph();
  g.update("a", "b", { size: "raid", secondsRemaining: 1800, now: T0 });
  const restored = createPortalGraph(JSON.parse(JSON.stringify(g.toJSON())), T0);
  const portal = restored.get("a", "b");
  assert.strictEqual(portal.size, "raid");
  assert.strictEqual(portal.expiresAt, T0 + 1_800_000);
  assert.strictEqual(portal.estimated, false);
});

// ── routing ────────────────────────────────────────────────────────────────
test("a route walks the chain and reports hops and portals", () => {
  const route = findRoute(chainGraph(), "martlock", "c", { now: T0 });
  assert.deepStrictEqual(route.zones, ["martlock", "a", "b", "c"]);
  assert.strictEqual(route.hops, 3);
  assert.deepStrictEqual(route.portals.map((p) => p.size), ["group", "solo", "raid"]);
});

test("a route expires with its shortest-lived portal", () => {
  const route = findRoute(chainGraph(), "martlock", "c", { now: T0 });
  assert.strictEqual(route.expiresAt, later(4)); // the b—c portal
  assert.strictEqual(route.secondsLeft, 4 * 3600);
});

test("routing to the current zone is a zero-hop route", () => {
  const route = findRoute(chainGraph(), "a", "a", { now: T0 });
  assert.deepStrictEqual(route.zones, ["a"]);
  assert.strictEqual(route.hops, 0);
  assert.deepStrictEqual(route.portals, []);
});

test("no path yields null", () => {
  assert.strictEqual(findRoute(chainGraph(), "martlock", "elsewhere", { now: T0 }), null);
  assert.strictEqual(findRoute(chainGraph(), "elsewhere", "a", { now: T0 }), null);
});

test("routing ignores portals that expired before now", () => {
  const g = chainGraph();
  assert.strictEqual(findRoute(g, "martlock", "d", { now: T0 }).hops, 2);
  assert.strictEqual(findRoute(g, "martlock", "d", { now: later(3) }), null);
});

test("minSecondsLeft rejects portals that will not outlive the trip", () => {
  const g = chainGraph();
  assert.strictEqual(findRoute(g, "martlock", "c", { now: T0, minSecondsLeft: 3 * 3600 }).hops, 3);
  assert.strictEqual(findRoute(g, "martlock", "c", { now: T0, minSecondsLeft: 5 * 3600 }), null);
});

test("BFS takes the fewest hops, not the first-recorded path", () => {
  const g = chainGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "c", size: "solo", expiresAt: later(7), now: T0 });
  const route = findRoute(g, "martlock", "c", { now: T0 });
  assert.deepStrictEqual(route.zones, ["martlock", "c"]);
  assert.strictEqual(route.hops, 1);
});

test("equal-length routes resolve deterministically", () => {
  const build = () => {
    const g = createPortalGraph();
    g.record({ fromZoneId: "start", toZoneId: "zeta", expiresAt: later(6), now: T0 });
    g.record({ fromZoneId: "start", toZoneId: "alpha", expiresAt: later(6), now: T0 });
    g.record({ fromZoneId: "zeta", toZoneId: "end", expiresAt: later(6), now: T0 });
    g.record({ fromZoneId: "alpha", toZoneId: "end", expiresAt: later(6), now: T0 });
    return g;
  };
  const first = findRoute(build(), "start", "end", { now: T0 }).zones;
  const second = findRoute(build(), "start", "end", { now: T0 }).zones;
  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.length, 3);
});

test("a cycle does not trap the search", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: later(5), now: T0 });
  g.record({ fromZoneId: "b", toZoneId: "c", expiresAt: later(5), now: T0 });
  g.record({ fromZoneId: "c", toZoneId: "a", expiresAt: later(5), now: T0 });
  assert.strictEqual(findRoute(g, "a", "c", { now: T0 }).hops, 1);
});

// ── nearest-match search ───────────────────────────────────────────────────
test("findNearest returns the closest zone matching the predicate", () => {
  const g = chainGraph();
  const hit = findNearest(g, "martlock", (zoneId) => zoneId === "b" || zoneId === "c", { now: T0 });
  assert.strictEqual(hit.zones[hit.zones.length - 1], "b");
  assert.strictEqual(hit.hops, 2);
});

test("findNearest can match the origin itself", () => {
  const hit = findNearest(chainGraph(), "a", (zoneId) => zoneId === "a", { now: T0 });
  assert.strictEqual(hit.hops, 0);
});

test("findNearest yields null when nothing matches", () => {
  assert.strictEqual(findNearest(chainGraph(), "martlock", () => false, { now: T0 }), null);
});

test("findNearest honours the same expiry rules as findRoute", () => {
  const g = chainGraph();
  assert.strictEqual(findNearest(g, "martlock", (z) => z === "d", { now: T0 }).hops, 2);
  assert.strictEqual(findNearest(g, "martlock", (z) => z === "d", { now: later(3) }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
