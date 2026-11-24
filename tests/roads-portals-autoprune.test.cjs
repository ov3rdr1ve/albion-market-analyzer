/**
 * Tests for the Roads panel's automatic prune of expired portals (UI — written
 * after the wiring, per the front-end convention in CLAUDE.md).
 *
 * Expiry in the store is applied on READ: a lapsed portal stays in the Map so
 * the map can grey it out. Nothing used to delete one while the app was open,
 * so a portal that closed mid-session sat in the table reading "expired" until
 * a restart. The panel now prunes on its own 15s countdown tick.
 *
 * What matters here is the wiring, not the cutoff (that is covered by
 * tests/roads-portal-graph.test.cjs):
 *
 *   - a real deletion persists and pings team sync,
 *   - an idle tick writes nothing (a needless sync write per 15s is a file
 *     handed to every teammate for no reason),
 *   - it stands down while the player is typing in the table, exactly like the
 *     redraw does — a row must not vanish from under an open editor.
 *
 * NO DOM, NO clock dependency, NO network: the zone catalog is injected the way
 * the browser provides it and every case passes an explicit `now`.
 *
 * Run: node tests/roads-portals-autoprune.test.cjs
 */

const assert = require("assert");

const ZONES = [
  { id: "a", name: "Cases-Ugumlos", tier: 6, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  { id: "b", name: "Quaes-Ovumlum", tier: 7, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  { id: "c", name: "Petos-Aietam", tier: 6, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  { id: "d", name: "Tynos-Atatlos", tier: 4, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
];
global.isOffRoadsNetwork = () => false;
global.ROADS_ZONES = ZONES;
global.ROADS_ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
global.ROADS_ZONE_BY_NAME = new Map(ZONES.map((z) => [z.name.toLowerCase(), z]));

const { createPortalGraph } = require("../js/data-roads-portals.js");
// Required BEFORE window/document exist: the module wires a DOMContentLoaded
// listener when it sees a window, and there is no DOM in this harness.
const { autoPruneExpired, _setGraph } = require("../js/render-roads.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
const later = (h) => T0 + h * HOUR;

/** Two measured portals: a—b closes at +2h, c—d at +8h. */
function panelGraph() {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", size: "solo", expiresAt: later(2), now: T0, estimated: false });
  g.record({ fromZoneId: "c", toZoneId: "d", size: "group", expiresAt: later(8), now: T0, estimated: false });
  return g;
}

/** Count team-sync pings while `fn` runs. */
function withSyncSpy(fn) {
  let pings = 0;
  global.window = { teamSyncLoop: { notifyPortalsChanged: () => { pings++; } } };
  try { fn(); } finally { delete global.window; }
  return pings;
}

/** Pretend the player has a cell of the portals table focused. */
function withEditingTable(fn) {
  global.document = {
    activeElement: { closest: (sel) => (sel === "#roads-portals-table" ? {} : null) },
  };
  try { return fn(); } finally { delete global.document; }
}

// ── what gets dropped ──────────────────────────────────────────────────────

const PRUNE_CASES = [
  ["nothing has closed yet", 1, 0, ["a|b", "c|d"]],
  ["one portal has closed", 5, 1, ["c|d"]],
  ["both portals have closed", 9, 2, []],
];
PRUNE_CASES.forEach(([name, hours, wantDropped, wantLeft]) => {
  test(`autoPruneExpired: ${name}`, () => {
    const g = panelGraph();
    _setGraph(g);
    assert.strictEqual(autoPruneExpired(later(hours)), wantDropped);
    assert.deepStrictEqual(g.all().map((p) => p.key), wantLeft);
  });
});

test("autoPruneExpired defaults to the wall clock", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "a", toZoneId: "b", expiresAt: Date.now() - 1000, now: T0, estimated: false });
  _setGraph(g);
  assert.strictEqual(autoPruneExpired(), 1);
  assert.strictEqual(g.all().length, 0);
});

// ── what gets written ──────────────────────────────────────────────────────

test("a deletion persists and pings team sync", () => {
  _setGraph(panelGraph());
  assert.strictEqual(withSyncSpy(() => autoPruneExpired(later(5))), 1);
});

test("an idle tick writes nothing", () => {
  _setGraph(panelGraph());
  assert.strictEqual(withSyncSpy(() => autoPruneExpired(later(1))), 0);
});

test("an empty graph writes nothing", () => {
  _setGraph(createPortalGraph());
  assert.strictEqual(withSyncSpy(() => autoPruneExpired(later(9))), 0);
});

// ── standing down while the player types ───────────────────────────────────

test("it stands down while the portals table is being edited", () => {
  const g = panelGraph();
  _setGraph(g);
  const dropped = withEditingTable(() => autoPruneExpired(later(5)));
  assert.strictEqual(dropped, 0);
  assert.deepStrictEqual(g.all().map((p) => p.key), ["a|b", "c|d"]);
});

test("the same portal goes on the next tick, once the edit is done", () => {
  const g = panelGraph();
  _setGraph(g);
  withEditingTable(() => autoPruneExpired(later(5)));
  assert.strictEqual(autoPruneExpired(later(5)), 1);
  assert.deepStrictEqual(g.all().map((p) => p.key), ["c|d"]);
});

test("focus elsewhere on the page does not stand it down", () => {
  const g = panelGraph();
  _setGraph(g);
  global.document = { activeElement: { closest: () => null } };
  try {
    assert.strictEqual(autoPruneExpired(later(5)), 1);
  } finally { delete global.document; }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
