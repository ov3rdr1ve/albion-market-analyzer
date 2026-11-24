/**
 * Del on the Roads map — the host half (js/render-roads.js `deleteFromMap`).
 *
 * The map view owns no portal data: it hands the selection over and the panel
 * decides what that means. Two very different meanings:
 *
 *   edge → one portal record, removed as quietly as the table's ✗ button
 *   node → NOT a record. A node exists only while some portal names its zone,
 *          so it means "drop every portal touching this zone", and 2+ of them
 *          ask first because there is no undo.
 *
 * Black-box: a real portal graph goes in through `_setGraph`, the confirm dialog
 * is a stub that records the question it was asked, and the assertions read the
 * graph afterwards. No DOM beyond the stubs the renderer needs to no-op, no
 * localStorage, no clock (every case passes an explicit expiry).
 *
 * Run: node tests/roads-map-delete.test.cjs
 */

const assert = require("assert");

const ZONES = [
  { id: "cases-ugumlos", name: "Cases-Ugumlos", tier: 6, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  { id: "quaes-ovumlum", name: "Quaes-Ovumlum", tier: 7, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  { id: "mud-ford", name: "Mud Ford", tier: 5, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  { id: "martlock", name: "Martlock", tier: 8, type: "royalBlue", chests: {}, resources: [], markers: {}, isRest: false, depth: null },
];

global.isOffRoadsNetwork = () => false;
global.ROADS_ZONES = ZONES;
global.ROADS_ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
global.ROADS_ZONE_BY_NAME = new Map(ZONES.map((z) => [z.name.toLowerCase(), z]));

// Enough DOM for the redraws to find nothing and stand down. `window` stays
// undefined on purpose: it keeps the panel's DOMContentLoaded wiring and its
// countdown interval out of the test run.
global.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
};

const { createPortalGraph } = require("../js/data-roads-portals.js");
const { deleteFromMap, _setGraph, _stop } = require("../js/render-roads.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const T0 = 1_800_000_000_000;
const later = (h) => T0 + h * 3_600_000;

/**
 * martlock — cases-ugumlos — quaes-ovumlum, plus cases-ugumlos — mud-ford.
 * "cases-ugumlos" is the hub with three portals; mud-ford's is already expired.
 */
function graphFixture() {
  const g = createPortalGraph();
  g.record({ fromZoneId: "martlock", toZoneId: "cases-ugumlos", size: "group", expiresAt: later(6), now: T0 });
  g.record({ fromZoneId: "cases-ugumlos", toZoneId: "quaes-ovumlum", size: "solo", expiresAt: later(8), now: T0 });
  g.record({ fromZoneId: "cases-ugumlos", toZoneId: "mud-ford", size: "raid", expiresAt: later(1), now: T0 });
  return g;
}

/** Runs `fn` with a confirm() that answers `answer` and records its question. */
function withConfirm(answer, fn) {
  const asked = [];
  global.confirm = (question) => { asked.push(question); return answer; };
  try { fn(asked); } finally { delete global.confirm; }
}

const keys = (g) => g.all().map((p) => p.key).sort();

// ── a portal: one record, no ceremony ──────────────────────────────────────

const EDGE_CASES = [
  ["the key as stored", "cases-ugumlos|martlock", 1, ["cases-ugumlos|mud-ford", "cases-ugumlos|quaes-ovumlum"]],
  ["an expired portal", "cases-ugumlos|mud-ford", 1, ["cases-ugumlos|martlock", "cases-ugumlos|quaes-ovumlum"]],
];

EDGE_CASES.forEach(([why, key, dropped, left]) => {
  test(`deleting a portal by ${why} removes exactly it`, () => {
    const g = graphFixture();
    _setGraph(g);
    withConfirm(false, (asked) => {
      assert.strictEqual(deleteFromMap({ kind: "edge", key }), dropped);
      assert.deepStrictEqual(asked, [], "a single portal must not prompt");
    });
    assert.deepStrictEqual(keys(g), left);
  });
});

const BAD_EDGE_CASES = [
  ["an unknown pair", "nowhere|elsewhere"],
  ["a key with no separator", "cases-ugumlos"],
  ["an empty key", ""],
  ["a missing key", undefined],
];

BAD_EDGE_CASES.forEach(([why, key]) => {
  test(`deleting ${why} changes nothing`, () => {
    const g = graphFixture();
    _setGraph(g);
    const before = keys(g);
    assert.strictEqual(deleteFromMap({ kind: "edge", key }), 0);
    assert.deepStrictEqual(keys(g), before);
  });
});

// ── a node: every portal at the zone ───────────────────────────────────────

test("a zone with one portal goes without asking", () => {
  const g = graphFixture();
  _setGraph(g);
  withConfirm(false, (asked) => {
    assert.strictEqual(deleteFromMap({ kind: "node", id: "martlock" }), 1);
    assert.deepStrictEqual(asked, [], "one portal is as quiet as the table's ✗");
  });
  assert.deepStrictEqual(keys(g), ["cases-ugumlos|mud-ford", "cases-ugumlos|quaes-ovumlum"]);
});

test("a hub asks first, naming the count and the zone", () => {
  const g = graphFixture();
  _setGraph(g);
  withConfirm(true, (asked) => {
    assert.strictEqual(deleteFromMap({ kind: "node", id: "cases-ugumlos" }), 3);
    assert.strictEqual(asked.length, 1);
    assert.ok(asked[0].includes("3"), `question lost the count: ${asked[0]}`);
    assert.ok(asked[0].includes("Cases-Ugumlos"), `question lost the zone name: ${asked[0]}`);
  });
  assert.deepStrictEqual(keys(g), []);
});

test("a cancelled confirm leaves every portal standing", () => {
  const g = graphFixture();
  _setGraph(g);
  const before = keys(g);
  withConfirm(false, () => {
    assert.strictEqual(deleteFromMap({ kind: "node", id: "cases-ugumlos" }), 0);
  });
  assert.deepStrictEqual(keys(g), before);
});

test("a zone no portal touches is a no-op, with no prompt", () => {
  const g = graphFixture();
  _setGraph(g);
  withConfirm(true, (asked) => {
    assert.strictEqual(deleteFromMap({ kind: "node", id: "quirky-zone" }), 0);
    assert.deepStrictEqual(asked, []);
  });
  assert.strictEqual(g.all().length, 3);
});

test("deleting a node counts expired portals too", () => {
  const g = graphFixture();
  _setGraph(g);
  withConfirm(true, () => {
    // mud-ford's own portal expired at +1h; it is still a record and still goes.
    assert.strictEqual(deleteFromMap({ kind: "node", id: "mud-ford" }), 1);
  });
  assert.strictEqual(g.get("cases-ugumlos", "mud-ford"), null);
});

test("an unknown zone id still reads back in the question", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "TNL-999", toZoneId: "martlock", expiresAt: later(6), now: T0 });
  g.record({ fromZoneId: "TNL-999", toZoneId: "mud-ford", expiresAt: later(6), now: T0 });
  _setGraph(g);
  withConfirm(true, (asked) => {
    assert.strictEqual(deleteFromMap({ kind: "node", id: "TNL-999" }), 2);
    assert.ok(asked[0].includes("TNL-999"), `id should stand in for a missing name: ${asked[0]}`);
  });
});

// ── junk in ────────────────────────────────────────────────────────────────

const JUNK_CASES = [
  ["nothing selected", null],
  ["an empty selection", {}],
  ["a node with no id", { kind: "node" }],
];

JUNK_CASES.forEach(([why, selection]) => {
  test(`${why} deletes nothing`, () => {
    const g = graphFixture();
    _setGraph(g);
    assert.strictEqual(deleteFromMap(selection), 0);
    assert.strictEqual(g.all().length, 3);
  });
});

// ── the Brecilien link is not a record ─────────────────────────────────────
//
// The T8 portal into Brecilien is drawn from the catalog, not from anything
// anyone entered. Del over it must not offer to remove the portals it touches.

const BRECILIEN_CASES = [
  ["the Brecilien node", { kind: "node", id: "5000" }],
  ["the Brecilien edge", { kind: "edge", key: "cases-ugumlos|5000" }],
  ["the Brecilien edge the other way round", { kind: "edge", key: "5000|cases-ugumlos" }],
];

BRECILIEN_CASES.forEach(([why, selection]) => {
  test(`${why} deletes nothing`, () => {
    const g = graphFixture();
    _setGraph(g);
    assert.strictEqual(deleteFromMap(selection), 0);
    assert.strictEqual(g.all().length, 3);
  });
});

test("a portal at the same zone is still deletable", () => {
  const g = graphFixture();
  _setGraph(g);
  assert.strictEqual(deleteFromMap({ kind: "edge", key: "cases-ugumlos|mud-ford" }), 1);
  assert.strictEqual(g.all().length, 2);
});

if (typeof _stop === "function") _stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
