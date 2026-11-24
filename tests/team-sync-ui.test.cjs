/**
 * Test: the Team Sync block in the Roads panel, and the glue behind it
 * (index.html + js/render-sync.js).
 *
 * Written after the UI, per the repo's front-end rule. Two things are worth
 * pinning down:
 *
 *   1. The block exists, is inside the Roads section, and is HIDDEN by default.
 *      Team sync needs the preload bridge, and a plain browser page must not be
 *      offered a folder picker it cannot open — the same rule the monitor
 *      controls follow.
 *   2. applyPeer routes a peer's file to the right store. A prices file must
 *      never reach the portal graph and a portals file must never reach the
 *      price maps, because the two payloads share an envelope and only their
 *      block tells them apart.
 *
 * Run: node tests/team-sync-ui.test.cjs
 */

const assert = require("assert");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const html = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Team sync UI tests\n");

const roadsSection = (() => {
  const start = html.indexOf('id="group-roads"');
  return html.slice(start, html.indexOf("</section>", start));
})();

// ── markup ──────────────────────────────────────────────────────────────────

const CONTROL_IDS = [
  "roads-sync-controls",
  "roads-sync-enabled",
  "roads-sync-folder-btn",
  "roads-sync-folder",
  "roads-sync-prices",
  "roads-sync-status",
];

CONTROL_IDS.forEach((id) => {
  test(`the Roads section carries #${id}`, () => {
    assert.ok(roadsSection.includes(`id="${id}"`), `${id} missing from the Roads section`);
  });
});

test("the block is hidden until the desktop bridge shows it", () => {
  const block = /<div class="([^"]*)" id="roads-sync-controls" style="([^"]*)"/.exec(roadsSection);
  assert.ok(block, "the sync block is not a controls row");
  assert.ok(/\bhidden\b/.test(block[1]), "a browser page must not see a folder picker it cannot open");
  // Hidden by CLASS, not inline: setupCollapsibleTables (js/app.js) remembers
  // each control row's inline display and restores it when the section is
  // expanded, so an inline-hidden row would never come back.
  assert.ok(/display:flex/.test(block[2]), "the inline display must be the one the row wants when shown");
});

test("the block sits with the portal controls, not inside the map", () => {
  const sync = roadsSection.indexOf('id="roads-sync-controls"');
  const addRow = roadsSection.indexOf('id="roads-add-btn"');
  const map = roadsSection.indexOf('id="roads-map-wrap"');
  assert.ok(addRow < sync && sync < map, "expected: add portal row, sync row, then the map");
});

test("both toggles say plainly that data leaves this machine", () => {
  const tips = [...roadsSection.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
  const sharing = tips.filter((tip) => /folder/i.test(tip) && /(read|share)/i.test(tip));
  assert.ok(sharing.length >= 2, "the enable and the prices toggle must both explain the sharing");
});

test("the scripts are loaded, and after the panel they hang off", () => {
  const order = ["js/render-roads.js", "js/team-sync-payload.js", "js/team-sync-loop.js", "js/render-sync.js"]
    .map((src) => html.indexOf(`src="${src}"`));
  order.forEach((at, i) => assert.ok(at > 0, `${i} not loaded`));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, "load order matters: render-sync.js is last");
});

// ── applyPeer routing ───────────────────────────────────────────────────────

const HOUR = 3600 * 1000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

/**
 * js/render-sync.js is a classic script: it reads the other modules off the
 * page's globals. Node has no page, so the globals are planted here — the same
 * shape the browser gives it.
 */
function loadRenderSync() {
  const store = { value: null };
  const portals = require(path.join(ROOT, "js", "data-roads-portals.js"));
  const transfer = require(path.join(ROOT, "js", "settings-transfer.js"));
  const captured = require(path.join(ROOT, "js", "captured-prices-store.js"));
  const payload = require(path.join(ROOT, "js", "team-sync-payload.js"));

  const storage = { getItem: () => store.value, setItem: (k, v) => { store.value = v; } };
  global.loadPortalGraph = (_s, now) => portals.loadPortalGraph(storage, now);
  global.savePortalGraph = (g) => portals.savePortalGraph(g, storage);
  global.importRoadsPortals = (saved, now) => transfer.importRoadsPortals(saved, now, {
    loadPortalGraph: global.loadPortalGraph,
    savePortalGraph: global.savePortalGraph,
  });
  global.mergePeerPortals = payload.mergePeerPortals;
  global.mergePeerCells = payload.mergePeerCells;
  global.capFoldOntoTarget = captured.capFoldOntoTarget;
  global.getCapturedPrices = captured.getCapturedPrices;
  global.recordCapturedPrices = captured.recordCapturedPrices;

  captured.resetCapturedPrices();
  delete require.cache[require.resolve(path.join(ROOT, "js", "render-sync.js"))];
  return {
    sync: require(path.join(ROOT, "js", "render-sync.js")),
    captured,
    readPortals: () => JSON.parse(store.value || '{"portals":[]}').portals,
  };
}

const PORTAL_PAYLOAD = {
  format: "albion-roads-sync",
  version: 1,
  deviceId: "9f8e7d6c",
  roadsPortals: {
    portals: [{
      fromZoneId: "TNL-022", toZoneId: "3004", size: "group",
      expiresAt: NOW + 6 * HOUR, estimated: false, chargesLeft: null,
      discoveredAt: NOW - HOUR, source: "sniffer",
    }],
  },
};

const PRICE_PAYLOAD = {
  format: "albion-roads-sync",
  version: 1,
  deviceId: "9f8e7d6c",
  capturedPrices: {
    T8_2H_HOLYSTAFF_HELL: { 1: { Martlock: { sell_price: 4000, sell_date: iso(NOW) } } },
  },
};

test("a portals file reaches the graph and reports what it took", () => {
  const env = loadRenderSync();
  const taken = env.sync.applyPeer(PORTAL_PAYLOAD, "portals");
  assert.strictEqual(taken.portals, 1);
  assert.strictEqual(taken.cells, 0);
  assert.strictEqual(env.readPortals().length, 1);
});

test("a prices file reaches the captured map, not the graph", () => {
  const env = loadRenderSync();
  const taken = env.sync.applyPeer(PRICE_PAYLOAD, "prices");
  assert.strictEqual(taken.cells, 1);
  assert.strictEqual(taken.portals, 0);
  assert.strictEqual(env.readPortals().length, 0, "a price file must never touch the portal graph");
  assert.strictEqual(
    env.captured.getCapturedPrices().T8_2H_HOLYSTAFF_HELL[1].Martlock.sell_price,
    4000,
  );
});

test("a peer's older price does not displace ours", () => {
  const env = loadRenderSync();
  env.captured.recordCapturedPrices({
    T8_2H_HOLYSTAFF_HELL: { 1: { Martlock: { sell_price: 9999, sell_date: iso(NOW) } } },
  });
  const taken = env.sync.applyPeer({
    ...PRICE_PAYLOAD,
    capturedPrices: {
      T8_2H_HOLYSTAFF_HELL: { 1: { Martlock: { sell_price: 10, sell_date: iso(NOW - HOUR) } } },
    },
  }, "prices");
  assert.strictEqual(taken.cells, 0);
  assert.strictEqual(
    env.captured.getCapturedPrices().T8_2H_HOLYSTAFF_HELL[1].Martlock.sell_price,
    9999,
  );
});

test("an empty portal block takes nothing rather than wiping the map", () => {
  const env = loadRenderSync();
  env.sync.applyPeer(PORTAL_PAYLOAD, "portals");
  const taken = env.sync.applyPeer({ ...PORTAL_PAYLOAD, roadsPortals: { portals: [] } }, "portals");
  assert.strictEqual(taken.portals, 0);
  assert.strictEqual(env.readPortals().length, 1);
});

// ── folder display ──────────────────────────────────────────────────────────

const FOLDER_CASES = [
  ["", "no folder chosen"],
  [null, "no folder chosen"],
  ["D:\\Dropbox", "D:\\Dropbox"],
  ["D:\\Dropbox\\Guild\\albion-roads", "…Guild\\albion-roads"],
];

FOLDER_CASES.forEach(([folder, expected]) => {
  test(`the folder label for ${JSON.stringify(folder)} reads "${expected}"`, () => {
    const env = loadRenderSync();
    assert.strictEqual(env.sync.shortFolder(folder), expected);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
