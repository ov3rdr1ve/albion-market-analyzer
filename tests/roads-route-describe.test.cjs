/**
 * Tests for the route line — js/roads-route-describe.js (UI, written after the
 * markup, per the front-end convention in CLAUDE.md).
 *
 * The module is pure: names, escaping, duration formatting and translation all
 * arrive as injected helpers, so these cases run with no DOM and no catalog.
 * Routes come from the real finders over stub graphs, so the shapes asserted
 * here are the shapes the panel actually renders.
 *
 * Run: node tests/roads-route-describe.test.cjs
 */

const assert = require("assert");
const { describeRoute } = require("../js/roads-route-describe.js");
const { createPortalGraph } = require("../js/data-roads-portals.js");
const { findRoute } = require("../js/roads-route.js");
const { findHybridRoute } = require("../js/roads-hybrid-route.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const NAMES = {
  martlock: "Martlock",
  "cases-ugumlos": "Cases-Ugumlos",
  "quaes-ovumlum": "Quaes-Ovumlum",
  "quirky-zone": "Quirky <script>",
  1000: "Lymhurst",
  1301: "Lymhurst Portal",
  "0000": "Thetford",
  "0301": "Thetford Portal",
};

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

const HELPERS = {
  zoneLabel: (id) => NAMES[id] || id,
  escapeHtml: (text) => String(text).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[c])),
  formatDuration,
  t: (en) => en,
};

const say = (route, extra = {}) => describeRoute(route, { ...HELPERS, ...extra });

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

// ── portal routes ──────────────────────────────────────────────────────────

test("names every hop and the validity window", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", expiresAt: T0 + 2 * HOUR, now: T0 });
  const text = say(findRoute(g, "martlock", "cases-ugumlos", { now: T0 }));
  assert.ok(text.includes("1 portal</strong>"));
  assert.ok(text.includes("Martlock"));
  assert.ok(text.includes("⟶"), "a portal hop is marked as one");
  assert.ok(text.includes("Cases-Ugumlos"));
  assert.ok(text.includes("valid 2h 00m"));
});

// A route is only as timed as its worst-timed leg. One portal nobody read
// makes the window a ceiling, and the line has to stop saying "valid".
test("a leg with a guessed timer downgrades the window to a ceiling", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", secondsRemaining: 6 * 3600, estimated: true, now: T0 });
  const text = say(findRoute(g, "martlock", "cases-ugumlos", { now: T0 }));
  assert.ok(text.includes("open at most 24h 00m"), text);
  assert.ok(!text.includes("valid"), text);
});

test("one guessed leg is enough to downgrade a mixed route", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", expiresAt: T0 + 2 * HOUR, now: T0 });
  g.record({ fromZoneId: "cases-ugumlos", toZoneId: "quaes-ovumlum", secondsRemaining: 6 * 3600, estimated: true, now: T0 });
  const text = say(findRoute(g, "martlock", "quaes-ovumlum", { now: T0 }));
  assert.ok(text.includes("open at most 2h 00m"), text);
});

test("pluralises multi-hop routes", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", expiresAt: T0 + 5 * HOUR, now: T0 });
  g.record({ fromZoneId: "cases-ugumlos", toZoneId: "quaes-ovumlum", expiresAt: T0 + 5 * HOUR, now: T0 });
  assert.ok(say(findRoute(g, "martlock", "quaes-ovumlum", { now: T0 })).includes("2 portals</strong>"));
});

// ── hybrid routes: portals, travel and running ─────────────────────────────

const walkBetween = (a, b) => (id) => (id === a ? [b] : id === b ? [a] : []);

test("counts portals and zones on foot apart", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", expiresAt: T0 + 6 * HOUR, now: T0 });
  const route = findHybridRoute(g, "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("cases-ugumlos", "quirky-zone"),
  });
  const text = say(route);
  assert.ok(text.includes("1 portal + 1 zone on foot</strong>"), text);
  assert.ok(text.includes("valid 6h 00m"));
});

test("a hybrid route reports the ceiling the same way", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", secondsRemaining: 6 * 3600, estimated: true, now: T0 });
  const route = findHybridRoute(g, "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("cases-ugumlos", "quirky-zone"),
  });
  assert.strictEqual(route.timerEstimated, true);
  assert.ok(say(route).includes("open at most 24h 00m"));
});

test("a route with no portal leg has nothing to be unsure about", () => {
  const route = findHybridRoute(createPortalGraph(), "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("martlock", "quirky-zone"),
  });
  assert.strictEqual(route.timerEstimated, false);
});

test("drops the validity window from an all-foot route", () => {
  const route = findHybridRoute(createPortalGraph(), "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("martlock", "quirky-zone"),
  });
  const text = say(route);
  assert.ok(text.includes("1 zone on foot</strong>"), text);
  assert.ok(!text.includes("valid"), "a walk never expires");
});

test("names the travel hops and flags the no-luggage ones", () => {
  const travel = (id) => (id === "martlock"
    ? [{ zoneId: "quirky-zone", cost: 4, noLuggage: true }]
    : id === "quirky-zone" ? [{ zoneId: "martlock", cost: 4, noLuggage: true }] : []);
  const text = say(findHybridRoute(createPortalGraph(), "martlock", "quirky-zone", {
    now: T0, overland: () => [], travel,
  }));
  assert.ok(text.includes("1 travel</strong>"), text);
  assert.ok(text.includes("⇢"), "a travel hop is marked as one");
  assert.ok(text.includes("(no luggage)"));
  assert.ok(!text.includes("valid"), "city travel never expires");
});

test("counts travels, portals and foot hops apart", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "cases-ugumlos", toZoneId: "quaes-ovumlum", expiresAt: T0 + 3 * HOUR, now: T0 });
  const route = findHybridRoute(g, "martlock", "quaes-ovumlum", {
    now: T0,
    overland: walkBetween("quirky-zone", "cases-ugumlos"),
    travel: (id) => (id === "martlock"
      ? [{ zoneId: "quirky-zone", cost: 5, noLuggage: false }]
      : id === "quirky-zone" ? [{ zoneId: "martlock", cost: 5, noLuggage: false }] : []),
  });
  const text = say(route);
  assert.ok(text.includes("1 portal + 1 travel + 1 zone on foot</strong>"), text);
  assert.ok(!text.includes("(no luggage)"));
  assert.ok(text.includes("valid 3h 00m"));
});

test("escapes zone names on a hybrid path", () => {
  const route = findHybridRoute(createPortalGraph(), "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("martlock", "quirky-zone"),
  });
  assert.ok(say(route).includes("Quirky &lt;script&gt;"));
});

// ── realmgate warnings ─────────────────────────────────────────────────────

const GATES = new Map([["1301", "1000"], ["0301", "0000"]]);
const GATE_OPTIONS = {
  now: T0,
  overland: () => [],
  travel: (id) => ({
    1000: [{ zoneId: "1301", cost: 0, noLuggage: false }],
    1301: [{ zoneId: "1000", cost: 0, noLuggage: false }],
  }[id] || []),
  gates: GATES,
};

test("an outbound gate hop says which binding it needs", () => {
  const route = findHybridRoute(createPortalGraph(), "1000", "1301", GATE_OPTIONS);
  assert.ok(say(route).includes("(needs Lymhurst Portal binding)"), say(route));
});

test("the warning goes away once that binding is chosen", () => {
  const route = findHybridRoute(createPortalGraph(), "1000", "1301", { ...GATE_OPTIONS, realmgate: "1301" });
  assert.ok(!say(route, { realmgate: "1301" }).includes("binding)"));
});

test("a gate hop that moves your binding says so", () => {
  const route = findHybridRoute(createPortalGraph(), "1301", "1000", GATE_OPTIONS);
  assert.ok(say(route).includes("(re-binds you to Lymhurst Portal)"), say(route));
  assert.ok(!say(route, { realmgate: "1301" }).includes("re-binds"), "already bound there");
});

// ── the two notes about the answer as a whole ──────────────────────────────

test("a portal-free answer says no mapped portal would shorten it", () => {
  const route = findHybridRoute(createPortalGraph(), "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("martlock", "quirky-zone"),
  });
  assert.ok(say(route, { hasPortals: true }).includes("no mapped portal makes this shorter"));
  assert.ok(!say(route, { hasPortals: false }).includes("no mapped portal"));
});

test("fastest prints the time estimate, other preferences do not", () => {
  const route = findHybridRoute(createPortalGraph(), "martlock", "quirky-zone", {
    now: T0, overland: walkBetween("martlock", "quirky-zone"), prefer: "fastest",
  });
  assert.ok(say(route, { prefer: "fastest" }).includes("about 1m"), say(route, { prefer: "fastest" }));
  assert.ok(!say(route, { prefer: "portal" }).includes("about"));
});

// ── the Brecilien portal ───────────────────────────────────────────────────

const BREC_ROUTE = {
  hops: 2,
  zones: ["martlock", "TNL-8", "5000"],
  steps: [{ zone: "TNL-8", via: "portal" }, { zone: "5000", via: "brecilien" }],
  portalHops: 1, footHops: 0, travelHops: 0, brecilienHops: 1,
  secondsLeft: 3600, timerEstimated: false,
};

test("the Brecilien hop gets its own mark and its own count", () => {
  const text = say(BREC_ROUTE);
  assert.ok(text.includes("⟼"), text);
  assert.ok(text.includes("Brecilien portal"), text);
  assert.ok(text.includes("1 portal +"), text);
});

test("the Brecilien hop is never counted as a portal, foot or travel", () => {
  const text = say(BREC_ROUTE);
  assert.ok(!text.includes("2 portals"), text);
  assert.ok(!text.includes("on foot"), text);
  assert.ok(!text.includes("travel"), text);
});

test("a Brecilien-only route does not print '0 portals'", () => {
  const text = say({
    hops: 1, zones: ["TNL-8", "5000"], steps: [{ zone: "5000", via: "brecilien" }],
    portalHops: 0, footHops: 0, travelHops: 0, brecilienHops: 1, secondsLeft: Infinity,
  });
  assert.ok(!text.includes("0 portals"), text);
  assert.ok(text.includes("Brecilien portal</strong>"), text);
});

// ── degenerate shapes ──────────────────────────────────────────────────────

test("a zero-hop route still renders", () => {
  const route = findHybridRoute(createPortalGraph(), "martlock", "martlock", { now: T0, overland: () => [] });
  const text = say(route);
  assert.ok(text.includes("0 portals</strong>"), text);
  assert.ok(text.includes("Martlock"));
});

test("a legacy route with no steps is read as all portals", () => {
  const text = say({ hops: 2, zones: ["martlock", "cases-ugumlos", "quaes-ovumlum"], secondsLeft: 3600 });
  assert.ok(text.includes("2 portals</strong>"), text);
  assert.ok(text.includes("valid 1h 00m"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
