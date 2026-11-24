/**
 * Test: what actually travels through the shared folder (js/team-sync-payload.js).
 *
 * The merge rules are NOT new here — a portal already knows that the longer
 * expiry wins and that a measurement beats a guess (js/data-roads-portals.js),
 * and a captured price cell already knows newest-wins per side
 * (js/captured-prices-store.js). This module is the envelope around them plus
 * the two things a shared folder forces:
 *
 *   OUT — only live portals and a bounded window of recent price cells. The
 *         whole file is rewritten on every publish, so an unbounded payload
 *         would mean re-uploading tens of megabytes to Dropbox every minute.
 *   IN  — a peer file is somebody else's data. It is validated and capped
 *         before a single row of it reaches the graph, and a peer's older
 *         reading can never overwrite this box's newer one.
 *
 * Black-box: pure functions, injected clock, no fs, no DOM, no timers.
 *
 * Run: node tests/team-sync-payload.test.cjs
 */

const assert = require("assert");
const path = require("path");

const S = require(path.join(__dirname, "..", "js", "team-sync-payload.js"));
const { createPortalGraph } = require(path.join(__dirname, "..", "js", "data-roads-portals.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Team sync payload tests\n");

const NOW = 1_770_000_000_000;
const HOUR = 3600 * 1000;
const ME = { deviceId: "aaaabbbb", deviceName: "Test-PC" };

const iso = (ms) => new Date(ms).toISOString();

function portalRow(over) {
  return {
    fromZoneId: "TNL-022",
    toZoneId: "3004",
    size: "group",
    expiresAt: NOW + 6 * HOUR,
    estimated: false,
    chargesLeft: null,
    discoveredAt: NOW - HOUR,
    source: "sniffer",
    ...over,
  };
}

// ── outgoing envelope ───────────────────────────────────────────────────────

test("the format tag is stable — a rename would silently split a guild", () => {
  assert.strictEqual(S.SYNC_FORMAT, "albion-roads-sync");
  assert.strictEqual(S.SYNC_VERSION, 1);
});

const ENVELOPE_CASES = [
  ["format", "albion-roads-sync"],
  ["version", 1],
  ["deviceId", "aaaabbbb"],
  ["deviceName", "Test-PC"],
  ["writtenAt", NOW],
];

ENVELOPE_CASES.forEach(([key, expected]) => {
  test(`the envelope carries ${key}`, () => {
    const out = S.buildPortalPayload({ ...ME, portals: { portals: [portalRow()] }, now: NOW });
    assert.strictEqual(out[key], expected);
  });
});

test("a payload without a device id is refused — it would be unattributable", () => {
  assert.strictEqual(S.buildPortalPayload({ deviceId: "", portals: { portals: [portalRow()] }, now: NOW }), null);
});

// ── outgoing portals ────────────────────────────────────────────────────────

test("live portals are published", () => {
  const out = S.buildPortalPayload({ ...ME, portals: { portals: [portalRow()] }, now: NOW });
  assert.strictEqual(out.roadsPortals.portals.length, 1);
  assert.strictEqual(out.roadsPortals.version, 1);
});

test("a portal that has already expired is not published", () => {
  const out = S.buildPortalPayload({
    ...ME,
    portals: { portals: [portalRow({ expiresAt: NOW - 1 })] },
    now: NOW,
  });
  assert.deepStrictEqual(out.roadsPortals.portals, []);
});

// "Expired" means the graph's reading of it. A guess is held to 24h from the
// sighting, so a row an older build stamped 6h on is still worth a teammate's
// time — dropping it here is how the guild map lost live portals.
test("a lapsed GUESS is still published while it could be open", () => {
  const out = S.buildPortalPayload({
    ...ME,
    portals: { portals: [portalRow({ expiresAt: NOW - HOUR, discoveredAt: NOW - 7 * HOUR, estimated: true })] },
    now: NOW,
  });
  assert.strictEqual(out.roadsPortals.portals.length, 1);
});

test("a guess past the 24h ceiling is not published", () => {
  const out = S.buildPortalPayload({
    ...ME,
    portals: { portals: [portalRow({ expiresAt: NOW - 19 * HOUR, discoveredAt: NOW - 25 * HOUR, estimated: true })] },
    now: NOW,
  });
  assert.deepStrictEqual(out.roadsPortals.portals, []);
});

test("every field the merge needs survives the trip", () => {
  const out = S.buildPortalPayload({ ...ME, portals: { portals: [portalRow({ chargesLeft: 3 })] }, now: NOW });
  const row = out.roadsPortals.portals[0];
  ["fromZoneId", "toZoneId", "size", "expiresAt", "estimated", "chargesLeft", "discoveredAt", "source"]
    .forEach((key) => assert.ok(key in row, `missing ${key}`));
  assert.strictEqual(row.estimated, false, "provenance must travel or a guess could outrank a measurement");
});

test("a live portal graph feeds the payload directly", () => {
  const graph = createPortalGraph();
  graph.record({ fromZoneId: "TNL-022", toZoneId: "3004", secondsRemaining: 7200, now: NOW, source: "manual" });
  const out = S.buildPortalPayload({ ...ME, portals: graph.toJSON(), now: NOW });
  assert.strictEqual(out.roadsPortals.portals.length, 1);
});

test("an empty graph still publishes — that is how a cleared map reaches peers", () => {
  const out = S.buildPortalPayload({ ...ME, portals: { portals: [] }, now: NOW });
  assert.deepStrictEqual(out.roadsPortals.portals, []);
});

// ── outgoing prices ─────────────────────────────────────────────────────────

function cell(ms, over) {
  return { sell_price: 4000, sell_date: iso(ms), buy_price: 3510, buy_date: iso(ms), ...over };
}

const PRICE_MAP = {
  T8_2H_HOLYSTAFF_HELL: { 1: { Martlock: cell(NOW - HOUR) } },
  T4_BAG: { 1: { Lymhurst: cell(NOW - 10 * HOUR) } },
};

test("recent captured cells are published", () => {
  const out = S.buildPricePayload({ ...ME, capturedPrices: PRICE_MAP, now: NOW });
  assert.ok(out.capturedPrices.T8_2H_HOLYSTAFF_HELL, "the hour-old cell travels");
});

test("cells older than the share window stay home", () => {
  const out = S.buildPricePayload({ ...ME, capturedPrices: PRICE_MAP, now: NOW });
  assert.ok(!out.capturedPrices.T4_BAG, "a 10h-old cell is outside the 6h window");
});

test("the window is a constant, not a magic number in the caller", () => {
  assert.strictEqual(S.SHARE_PRICE_WINDOW_MS, 6 * HOUR);
  assert.strictEqual(S.SHARE_MAX_CELLS, 8000);
});

test("the cell cap bounds the file even in a window full of captures", () => {
  const big = {};
  for (let i = 0; i < 40; i++) big[`ITEM_${i}`] = { 1: { Martlock: cell(NOW - i * 1000) } };
  const out = S.buildPricePayload({ ...ME, capturedPrices: big, now: NOW, maxCells: 10 });
  assert.strictEqual(S.countPriceCells(out.capturedPrices), 10);
});

test("when the cap bites it keeps the NEWEST cells", () => {
  const big = {};
  for (let i = 0; i < 10; i++) big[`ITEM_${i}`] = { 1: { Martlock: cell(NOW - i * 60000) } };
  const out = S.buildPricePayload({ ...ME, capturedPrices: big, now: NOW, maxCells: 2 });
  assert.deepStrictEqual(Object.keys(out.capturedPrices).sort(), ["ITEM_0", "ITEM_1"]);
});

test("a price payload carries no portals — the two files are published apart", () => {
  const out = S.buildPricePayload({ ...ME, capturedPrices: PRICE_MAP, now: NOW });
  assert.ok(!("roadsPortals" in out));
});

test("nothing to share publishes nothing at all", () => {
  assert.strictEqual(S.buildPricePayload({ ...ME, capturedPrices: {}, now: NOW }), null);
});

test("the payload states its freshest cell, so the loop can skip a pointless write", () => {
  const out = S.buildPricePayload({ ...ME, capturedPrices: PRICE_MAP, now: NOW });
  assert.strictEqual(out.newestAt, NOW - HOUR);
});

test("newestCellTime finds the freshest reading, so a publish can be skipped", () => {
  assert.strictEqual(S.newestCellTime(PRICE_MAP), NOW - HOUR);
  assert.strictEqual(S.newestCellTime({}), 0);
  assert.strictEqual(S.newestCellTime(null), 0);
});

// ── incoming validation ─────────────────────────────────────────────────────

const REJECT_CASES = [
  ["junk text", "not json at all"],
  ["an array", "[]"],
  ["a bare number", "42"],
  ["null", "null"],
  ["an empty string", ""],
  ["another app's file", JSON.stringify({ format: "albion-market-settings", version: 3 })],
  ["a payload with no format", JSON.stringify({ version: 1, roadsPortals: { portals: [] } })],
  ["a version from the future", JSON.stringify({ format: "albion-roads-sync", version: 99, deviceId: "x" })],
  ["a payload with no device id", JSON.stringify({ format: "albion-roads-sync", version: 1 })],
];

REJECT_CASES.forEach(([name, text]) => {
  test(`readPeerPayload refuses ${name}`, () => {
    assert.strictEqual(S.readPeerPayload(text), null);
  });
});

test("a payload this box wrote reads back whole", () => {
  const out = S.buildPortalPayload({ ...ME, portals: { portals: [portalRow()] }, now: NOW });
  const back = S.readPeerPayload(JSON.stringify(out));
  assert.strictEqual(back.deviceId, "aaaabbbb");
  assert.strictEqual(back.roadsPortals.portals.length, 1);
});

test("an already-parsed object is accepted as well as text", () => {
  const out = S.buildPricePayload({ ...ME, capturedPrices: PRICE_MAP, now: NOW });
  assert.ok(S.readPeerPayload(out));
});

test("an older version is still readable — a guild upgrades one box at a time", () => {
  const back = S.readPeerPayload(JSON.stringify({
    format: "albion-roads-sync", version: 1, deviceId: "9f8e7d6c", roadsPortals: { portals: [portalRow()] },
  }));
  assert.ok(back);
});

test("a peer that floods portals is capped, not trusted", () => {
  const rows = [];
  for (let i = 0; i < S.MAX_PEER_PORTALS + 500; i++) {
    rows.push(portalRow({ fromZoneId: `TNL-${i}`, expiresAt: NOW + i }));
  }
  const back = S.readPeerPayload({
    format: "albion-roads-sync", version: 1, deviceId: "9f8e7d6c", roadsPortals: { portals: rows },
  });
  assert.strictEqual(back.roadsPortals.portals.length, S.MAX_PEER_PORTALS);
});

test("a peer that floods price cells is capped too", () => {
  const map = {};
  for (let i = 0; i < 30; i++) map[`ITEM_${i}`] = { 1: { Martlock: cell(NOW - i * 1000) } };
  const back = S.readPeerPayload(
    { format: "albion-roads-sync", version: 1, deviceId: "9f8e7d6c", capturedPrices: map },
    { maxCells: 5 },
  );
  assert.strictEqual(S.countPriceCells(back.capturedPrices), 5);
});

test("a malformed block reads as absent rather than taking the file down", () => {
  const back = S.readPeerPayload({
    format: "albion-roads-sync", version: 1, deviceId: "9f8e7d6c",
    roadsPortals: "portals!", capturedPrices: [1, 2, 3],
  });
  assert.deepStrictEqual(back.roadsPortals, { version: 1, portals: [] });
  assert.deepStrictEqual(back.capturedPrices, {});
});

// ── incoming portal merge ───────────────────────────────────────────────────

/** A stand-in for the localStorage-backed graph the renderer merges into. */
function graphDeps(rows) {
  const store = { value: rows ? JSON.stringify({ version: 1, portals: rows }) : null };
  const P = require(path.join(__dirname, "..", "js", "data-roads-portals.js"));
  const T = require(path.join(__dirname, "..", "js", "settings-transfer.js"));
  const storage = {
    getItem: () => store.value,
    setItem: (k, v) => { store.value = v; },
  };
  return {
    store,
    deps: {
      loadPortalGraph: (_s, now) => P.loadPortalGraph(storage, now),
      savePortalGraph: (g) => P.savePortalGraph(g, storage),
      importRoadsPortals: T.importRoadsPortals,
    },
    read: () => JSON.parse(store.value || "null"),
  };
}

test("a peer's portal lands in an empty local map", () => {
  const g = graphDeps(null);
  const taken = S.mergePeerPortals({ roadsPortals: { portals: [portalRow()] } }, NOW, g.deps);
  assert.strictEqual(taken, 1);
  assert.strictEqual(g.read().portals.length, 1);
});

test("a peer's longer expiry on a link we already know wins", () => {
  const g = graphDeps([portalRow({ expiresAt: NOW + HOUR })]);
  S.mergePeerPortals({ roadsPortals: { portals: [portalRow({ expiresAt: NOW + 5 * HOUR })] } }, NOW, g.deps);
  assert.strictEqual(g.read().portals[0].expiresAt, NOW + 5 * HOUR);
});

test("a peer's shorter expiry does not shorten what we know", () => {
  const g = graphDeps([portalRow({ expiresAt: NOW + 5 * HOUR })]);
  S.mergePeerPortals({ roadsPortals: { portals: [portalRow({ expiresAt: NOW + HOUR })] } }, NOW, g.deps);
  assert.strictEqual(g.read().portals[0].expiresAt, NOW + 5 * HOUR);
});

test("a peer's GUESS never outranks a timer this box measured", () => {
  const g = graphDeps([portalRow({ expiresAt: NOW + HOUR, estimated: false })]);
  S.mergePeerPortals(
    { roadsPortals: { portals: [portalRow({ expiresAt: NOW + 9 * HOUR, estimated: true })] } },
    NOW, g.deps,
  );
  assert.strictEqual(g.read().portals[0].expiresAt, NOW + HOUR);
  assert.strictEqual(g.read().portals[0].estimated, false);
});

test("a portal already dead when it arrives is dropped", () => {
  const g = graphDeps(null);
  const taken = S.mergePeerPortals({ roadsPortals: { portals: [portalRow({ expiresAt: NOW - 1 })] } }, NOW, g.deps);
  assert.strictEqual(taken, 0);
});

test("the same pair from both directions stays ONE portal", () => {
  const g = graphDeps([portalRow()]);
  S.mergePeerPortals(
    { roadsPortals: { portals: [portalRow({ fromZoneId: "3004", toZoneId: "TNL-022" })] } },
    NOW, g.deps,
  );
  assert.strictEqual(g.read().portals.length, 1);
});

test("a payload with no portal block is a no-op, not a wipe", () => {
  const g = graphDeps([portalRow()]);
  const taken = S.mergePeerPortals({}, NOW, g.deps);
  assert.strictEqual(taken, 0);
  assert.strictEqual(g.read().portals.length, 1);
});

// ── incoming price merge ────────────────────────────────────────────────────

test("a peer cell for an item we have never seen is taken", () => {
  const { patch, taken } = S.mergePeerCells({}, { T4_BAG: { 1: { Lymhurst: cell(NOW) } } });
  assert.strictEqual(taken, 1);
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.sell_price, 4000);
});

test("a peer's NEWER reading replaces ours", () => {
  const mine = { T4_BAG: { 1: { Lymhurst: cell(NOW - HOUR, { sell_price: 100 }) } } };
  const theirs = { T4_BAG: { 1: { Lymhurst: cell(NOW, { sell_price: 900 }) } } };
  const { patch } = S.mergePeerCells(mine, theirs);
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.sell_price, 900);
});

test("a peer's OLDER reading never clobbers ours", () => {
  const mine = { T4_BAG: { 1: { Lymhurst: cell(NOW, { sell_price: 900 }) } } };
  const theirs = { T4_BAG: { 1: { Lymhurst: cell(NOW - HOUR, { sell_price: 100 }) } } };
  const { patch, taken } = S.mergePeerCells(mine, theirs);
  assert.strictEqual(taken, 0, "nothing to write");
  assert.deepStrictEqual(patch, {});
});

test("the two sides of a cell are judged on their own dates", () => {
  const mine = { T4_BAG: { 1: { Lymhurst: { sell_price: 900, sell_date: iso(NOW), buy_price: 0, buy_date: null } } } };
  const theirs = { T4_BAG: { 1: { Lymhurst: { sell_price: 100, sell_date: iso(NOW - HOUR), buy_price: 700, buy_date: iso(NOW - HOUR) } } } };
  const { patch } = S.mergePeerCells(mine, theirs);
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.sell_price, 900, "my newer sell survives");
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.buy_price, 700, "their buy fills a side I never saw");
});

test("a peer's order capture never invents a traded volume", () => {
  const mine = { T4_BAG: { 1: { Lymhurst: { ...cell(NOW - HOUR), volume_24h: 5000, volume_date: iso(NOW - HOUR) } } } };
  const theirs = { T4_BAG: { 1: { Lymhurst: cell(NOW) } } };
  const { patch } = S.mergePeerCells(mine, theirs);
  assert.strictEqual(patch.T4_BAG[1].Lymhurst.volume_24h, 5000);
});

test("quality is part of the cell's identity", () => {
  const mine = { T4_BAG: { 1: { Lymhurst: cell(NOW) } } };
  const theirs = { T4_BAG: { 3: { Lymhurst: cell(NOW - HOUR) } } };
  const { patch, taken } = S.mergePeerCells(mine, theirs);
  assert.strictEqual(taken, 1);
  assert.ok(patch.T4_BAG[3].Lymhurst, "quality 3 is a different cell, not a stale quality 1");
});

test("an empty peer map produces no patch", () => {
  assert.deepStrictEqual(S.mergePeerCells({ T4_BAG: { 1: { Lymhurst: cell(NOW) } } }, {}), { patch: {}, taken: 0 });
});

test("a dateless peer cell cannot displace a dated one of ours", () => {
  const mine = { T4_BAG: { 1: { Lymhurst: cell(NOW, { sell_price: 900 }) } } };
  const theirs = { T4_BAG: { 1: { Lymhurst: { sell_price: 100 } } } };
  const { taken } = S.mergePeerCells(mine, theirs);
  assert.strictEqual(taken, 0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
