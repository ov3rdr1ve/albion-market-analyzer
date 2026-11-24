/**
 * Tests for the Roads of Avalon panel renderer (UI — written after the markup,
 * per the front-end convention in CLAUDE.md).
 *
 * The module is a browser IIFE that exports its pure helpers for the Node
 * harness. Nothing here touches the DOM: we exercise the string/lookup layer
 * that the tables are built from.
 *
 *   - formatDuration: the portal countdown, including the expired case.
 *   - chestSummary: chest spawn rollup from the generated catalog shape.
 *   - resolveZone: id / display-name / free-typed-name resolution.
 *   - zoneRow + portalRow: cell counts, Brecilien marker, escaping.
 *
 * Zone globals are injected the way the browser provides them (the catalog
 * script assigns top-level consts), so no network and no real catalog file is
 * required for the pure cases.
 *
 * Run: node tests/roads-panel-render.test.cjs
 */

const assert = require("assert");
const path = require("path");

const ZONES = [
  { id: "cases-ugumlos", name: "Cases-Ugumlos", tier: 6, type: "roads", chests: { green: 2, blue: 1 }, resources: ["logs", "rock"], markers: { dungeon: 1 }, isRest: false, depth: 2 },
  { id: "quaes-ovumlum", name: "Quaes-Ovumlum", tier: 7, type: "roads", chests: { gold: 3 }, resources: [], markers: { hire: 2 }, isRest: true, depth: 2 },
  { id: "martlock", name: "Martlock", tier: 8, type: "royalBlue", chests: {}, resources: [], markers: {}, isRest: false, depth: null },
  { id: "quirky-zone", name: "Quirky <script>", tier: 5, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2 },
  // In the catalog (it is a real place) but off the Roads network entirely.
  { id: "5000", name: "Brecilien", tier: 0, type: "city", chests: {}, resources: [], markers: {}, isRest: false, depth: null },
  // The three TUNNEL_* flavours the Brecilien predicate splits on: only the T8
  // TUNNEL_DEEP cluster files carry the static Mistcity portal
  // (js/data-roads-brecilien.js). Raid roads and lower tiers never do.
  { id: "tnl-301", name: "Filites-Izohun", tier: 8, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2, worldType: "TUNNEL_DEEP" },
  { id: "tnl-296", name: "Fynitos-Ezatam", tier: 8, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2, worldType: "TUNNEL_DEEP_RAID" },
  { id: "tnl-099", name: "Kaetos-Ulonum", tier: 6, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2, worldType: "TUNNEL_DEEP" },
];

// The catalog's own predicate, as the browser hands it over (a bare global).
global.isOffRoadsNetwork = (id) => id === "5000";

// Same handover for the label tables and the derived Brecilien predicate: the
// panel resolves them PER CALL now (the catalogs land after paint via
// js/catalog-loader.js, so its old eval-time require/globalThis captures read
// undefined). roads-labels.js assigns itself onto globalThis, and the
// predicate is its catalog's bare global — exactly how the browser sees them.
require("../js/roads-labels.js");
global.isBrecilienEntrance = require("../js/data-roads-brecilien.js").isBrecilienEntrance;

global.ROADS_ZONES = ZONES;
global.ROADS_ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
global.ROADS_ZONE_BY_NAME = new Map(ZONES.map((z) => [z.name.toLowerCase(), z]));

const { createPortalGraph } = require("../js/data-roads-portals.js");
const { findNearest } = require("../js/roads-route.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");
const {
  formatDuration, chestSummary, resolveZone, zoneRow, portalRow, isExitZone, routeOptions,
  routableZones, destinationZones, offNetworkZones,
  pocketStartMessage, pocketPortalMessage,
} = require("../js/render-roads.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const countCells = (html) => (html.match(/<td/g) || []).length;

// ── formatDuration ─────────────────────────────────────────────────────────
const DURATION_CASES = [
  [0, "expired"],
  [-60, "expired"],
  [90, "1m"],
  [3600, "1h 00m"],
  [3600 * 5 + 60 * 7, "5h 07m"],
  [3600 * 23 + 3540, "23h 59m"],
  [Infinity, "—"],
  [NaN, "—"],
];
DURATION_CASES.forEach(([seconds, want]) => {
  test(`formatDuration(${seconds}) = ${want}`, () => {
    assert.strictEqual(formatDuration(seconds), want);
  });
});

// ── chestSummary ───────────────────────────────────────────────────────────
const CHEST_CASES = [
  [{}, "—"],
  [{ green: 2 }, "2×green"],
  [{ green: 1, blue: 1, gold: 2 }, "1×green, 1×blue, 2×gold"],
  [{ gold: 3 }, "3×gold"],
];
CHEST_CASES.forEach(([chests, want]) => {
  test(`chestSummary(${JSON.stringify(chests)}) = ${want}`, () => {
    assert.strictEqual(chestSummary(chests), want);
  });
});

// ── resolveZone ────────────────────────────────────────────────────────────
const RESOLVE_CASES = [
  ["cases-ugumlos", "cases-ugumlos"],
  ["Cases-Ugumlos", "cases-ugumlos"],
  ["cases-UGUMLOS", "cases-ugumlos"],
  ["  Martlock  ", "martlock"],
  ["martlock", "martlock"],
  ["Quaes-Ovumlum", "quaes-ovumlum"],
];
RESOLVE_CASES.forEach(([input, want]) => {
  test(`resolveZone(${JSON.stringify(input)}) = ${want}`, () => {
    assert.strictEqual(resolveZone(input).id, want);
  });
});

test("resolveZone rejects unknown and empty input", () => {
  assert.strictEqual(resolveZone("Nowhere-Land"), null);
  assert.strictEqual(resolveZone(""), null);
  assert.strictEqual(resolveZone(null), null);
});

// ── zoneRow ────────────────────────────────────────────────────────────────
test("zoneRow emits six cells", () => {
  assert.strictEqual(countCells(zoneRow(ZONES[0])), 6);
});

test("zoneRow shows tier, chests, resources and markers", () => {
  const html = zoneRow(ZONES[0]);
  assert.ok(html.includes("Cases-Ugumlos"));
  assert.ok(html.includes("T6"));
  assert.ok(html.includes("2×green, 1×blue"));
  assert.ok(html.includes("Logs, Stone"));
  assert.ok(html.includes("dungeon"));
});

// ── zoneRow: uniform Roads, one Brecilien marker ───────────────────────────
//
// The reference table types every roads zone plainly as "Roads" — raid zones,
// deep roads, rests and crossroads are NOT distinguished. The single marker it
// carries is the Brecilien portal, and only the tier-8 deep roads have one.

test("zoneRow types every roads zone plainly as Roads", () => {
  ZONES.filter((z) => z.type === "roads").forEach((zone) => {
    assert.ok(zoneRow(zone).includes("<td>Roads</td>"), zone.name);
  });
});

test("zoneRow marks a Brecilien entrance and nothing else", () => {
  const deep = zoneRow(global.ROADS_ZONE_BY_ID.get("tnl-301"));
  assert.ok(deep.includes("◆"), "the T8 deep road must carry the marker");
  assert.ok(/title="Brecilien portal"/.test(deep), "the marker must say what it is");
  ZONES.filter((z) => z.id !== "tnl-301").forEach((zone) => {
    const html = zoneRow(zone);
    assert.ok(!html.includes("◆"), `${zone.name} must carry no marker`);
    assert.ok(!html.includes("Brecilien portal"), zone.name);
  });
});

test("the raid road and the lower-tier deep road get no Brecilien marker", () => {
  assert.ok(!zoneRow(global.ROADS_ZONE_BY_ID.get("tnl-296")).includes("◆"));
  assert.ok(!zoneRow(global.ROADS_ZONE_BY_ID.get("tnl-099")).includes("◆"));
});

test("zoneRow no longer distinguishes Avalonian Rests", () => {
  const html = zoneRow(global.ROADS_ZONE_BY_ID.get("quaes-ovumlum"));
  assert.ok(!html.includes("Avalonian Rest"));
  assert.ok(!html.includes("◆"));
});

test("zoneRow renders empty resources and markers as em-dashes", () => {
  const html = zoneRow(ZONES[2]);
  assert.strictEqual((html.match(/—/g) || []).length, 3); // chests, resources, markers
});

test("zoneRow escapes zone names", () => {
  const html = zoneRow(ZONES[3]);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

// ── portalRow ──────────────────────────────────────────────────────────────
const T0 = 1_800_000_000_000;

function portal({ from = "martlock", to = "cases-ugumlos", size = "group", hours = 5, source, estimated, chargesLeft } = {}) {
  const g = createPortalGraph();
  return g.record({
    fromZoneId: from, toZoneId: to, size, expiresAt: T0 + hours * 3_600_000, now: T0, source, estimated, chargesLeft,
  });
}

test("portalRow emits six cells", () => {
  assert.strictEqual(countCells(portalRow(portal(), T0)), 6);
});

test("portalRow names both zones with their tiers", () => {
  const html = portalRow(portal(), T0);
  assert.ok(html.includes("Martlock"));
  assert.ok(html.includes("T8"));
  assert.ok(html.includes("Cases-Ugumlos"));
  assert.ok(html.includes("T6"));
});

// The Type cell is a dropdown, not text: the game never exposes the
// size (the game encrypts portal objects), so the player picks it.
const SIZE_CASES = [["solo", "Solo"], ["group", "Group"], ["raid", "Raid"], ["mystery", "?"]];
SIZE_CASES.forEach(([size, want]) => {
  test(`portalRow preselects the ${size} portal's own size (${want})`, () => {
    const html = portalRow(portal({ size }), T0);
    assert.ok(/<select class="roads-portal-size"/.test(html), "size cell must be editable");
    assert.ok(new RegExp(`selected>${want.replace("?", "\\?")}</option>`).test(html));
  });
});

test("portalRow offers every size plus unknown, exactly once each", () => {
  const html = portalRow(portal({ size: "solo" }), T0);
  const values = [...html.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(values, ["solo", "group", "raid", "unknown"]);
  assert.strictEqual((html.match(/ selected>/g) || []).length, 1);
});

test("the size dropdown carries the pair key so a change can be saved", () => {
  assert.ok(portalRow(portal(), T0).includes('<select class="roads-portal-size" data-key="cases-ugumlos|martlock"'));
});

// An unreadable size is not the app being lazy — the game encrypts the portal
// object — so the cell says where the gap comes from and what to do about it.
test("portalRow explains an unknown size", () => {
  assert.ok(/title="[^"]*encrypts[^"]*"/.test(portalRow(portal({ size: "mystery" }), T0)));
  assert.ok(!portalRow(portal({ size: "raid" }), T0).includes("encrypts"));
});

// Time Left is typed too — a portal entered without a timer carries none.
test("the Time Left cell is click-to-edit and knows which portal it edits", () => {
  const html = portalRow(portal(), T0);
  assert.ok(/<td class="roads-portal-time" data-key="cases-ugumlos\|martlock"/.test(html));
  assert.ok(/title="[^"]*(hours|h:mm)[^"]*"/.test(html), "the cell has to say it is editable");
});

test("portalRow counts down and dims once expired", () => {
  const p = portal({ hours: 2 });
  assert.ok(portalRow(p, T0).includes("2h 00m"));
  const expired = portalRow(p, T0 + 3 * 3_600_000);
  assert.ok(expired.includes("expired"));
  assert.ok(expired.includes("opacity:0.45"));
});

// A timer read off the portal object is a fact; one attached to a portal entered without a timer
// is the app's own ceiling — the longest it can still be open. The
// row has to say which it is, so a guess reads "≤" and a measurement reads
// plain. Note the graph holds a guess to 24h whatever number came with it, so
// the guessed row below counts down from the ceiling, not from its six hours.
test("portalRow marks a guessed countdown with a ≤", () => {
  assert.ok(portalRow(portal({ estimated: true, hours: 6 }), T0).includes("≤24h 00m"));
  assert.ok(!portalRow(portal({ hours: 6 }), T0).includes("≤"));
});

test("portalRow drops the ≤ once the portal is expired anyway", () => {
  const html = portalRow(portal({ estimated: true, hours: 1 }), T0 + 25 * 3_600_000);
  assert.ok(html.includes("expired"));
  assert.ok(!html.includes("≤"));
});

test("a guessed row is still counting down long after its stamped hours", () => {
  const html = portalRow(portal({ estimated: true, hours: 6 }), T0 + 8 * 3_600_000);
  assert.ok(html.includes("≤16h 00m"));
  assert.ok(!html.includes("expired"));
});

test("portalRow shows charges left beside the size when known", () => {
  assert.ok(portalRow(portal({ size: "raid", chargesLeft: 12 }), T0).includes("(12)"));
  assert.ok(!portalRow(portal({ size: "raid" }), T0).includes("("));
});

// Every row reads as typed — including portals stored by an older build
// with a legacy source value.
[["sniffer", "sniffer"], ["manual", "manual"], ["missing", undefined]].forEach(([label, source]) => {
  test(`portalRow renders a portal with source ${label} as typed`, () => {
    const html = portalRow(portal({ source }), T0);
    assert.ok(html.includes("typed"), html);
    assert.ok(!html.includes("sniffer"), "no sniffer label is left");
  });

  test(`a stored portal with source ${label} renders as typed after loading`, () => {
    const { loadPortalGraph, PORTAL_STORAGE_KEY } = require("../js/data-roads-portals.js");
    const storage = { getItem: (k) => (k === PORTAL_STORAGE_KEY ? JSON.stringify({ version: 1, portals: [{
      fromZoneId: "martlock", toZoneId: "cases-ugumlos", size: "group", expiresAt: T0 + 5 * 3_600_000,
      estimated: false, discoveredAt: T0, source,
    }] }) : null) };
    const [loaded] = loadPortalGraph(storage, T0).all();
    assert.ok(loaded, "the stored portal loads");
    assert.ok(portalRow(loaded, T0).includes("typed"));
  });
});

test("portalRow keeps an unknown zone id readable", () => {
  const html = portalRow(portal({ to: "not-in-catalog" }), T0);
  assert.ok(html.includes("not-in-catalog"));
  assert.ok(html.includes("?"));
});

test("portalRow carries the pair key for the delete button", () => {
  assert.ok(portalRow(portal(), T0).includes('data-key="cases-ugumlos|martlock"'));
});

// ── the Brecilien pocket ───────────────────────────────────────────────────
//
// Every T8 road holds a permanent portal into Brecilien, and the only way back
// out lands in a random Road. So the pocket is a place you route TO: the
// destination box offers it, every other box must not, and naming it as a start
// must be answered with a reason rather than "no live route".

test("the start and portal boxes offer everything except the Brecilien pocket", () => {
  const offered = routableZones().map((z) => z.id);
  assert.ok(!offered.includes("5000"), "Brecilien is offered");
  assert.deepStrictEqual(offered, ZONES.filter((z) => z.id !== "5000").map((z) => z.id));
});

test("the destination box offers the pocket too", () => {
  const offered = destinationZones().map((z) => z.id);
  assert.ok(offered.includes("5000"), "Brecilien is missing");
  assert.deepStrictEqual(offered, ZONES.map((z) => z.id));
});

test("the static Zones catalog still lists Brecilien", () => {
  assert.ok(global.ROADS_ZONES.some((z) => z.id === "5000"));
  assert.ok(resolveZone("Brecilien"), "and it still resolves by name");
});

const OFF_NETWORK_ARG_CASES = [
  ["neither end", ["martlock", "cases-ugumlos"], []],
  ["the destination", ["martlock", "5000"], ["Brecilien"]],
  ["the origin", ["5000", "martlock"], ["Brecilien"]],
  ["both ends", ["5000", "5000"], ["Brecilien", "Brecilien"]],
];

for (const [name, ids, want] of OFF_NETWORK_ARG_CASES) {
  test(`offNetworkZones names the pocket zones — ${name}`, () => {
    const found = offNetworkZones(...ids.map((id) => global.ROADS_ZONE_BY_ID.get(id)));
    assert.deepStrictEqual(found.map((z) => z.name), want);
  });
}

test("offNetworkZones ignores a zone that did not resolve", () => {
  assert.deepStrictEqual(offNetworkZones(null, undefined), []);
});

test("the start refusal names the zone and blames the one-way exit", () => {
  const text = pocketStartMessage([global.ROADS_ZONE_BY_ID.get("5000")]);
  assert.ok(text.includes("Brecilien"), text);
  assert.ok(/one-way|random/i.test(text), text);
  assert.ok(!/no live route/i.test(text), text);
});

test("the portal refusal names the zone and says no tunnel reaches it", () => {
  const text = pocketPortalMessage([global.ROADS_ZONE_BY_ID.get("5000")]);
  assert.ok(text.includes("Brecilien"), text);
  assert.ok(/tunnel/i.test(text), text);
});

// ── exits and route text ───────────────────────────────────────────────────
const EXIT_CASES = [
  ["cases-ugumlos", false], // roads
  ["quaes-ovumlum", false], // roads (Rest)
  ["martlock", true],       // royal (catalog fixture is typed royalBlue)
];
EXIT_CASES.forEach(([id, want]) => {
  test(`isExitZone(${id}) = ${want}`, () => {
    assert.strictEqual(isExitZone(global.ROADS_ZONE_BY_ID.get(id)), want);
  });
});

test("isExitZone tolerates an unknown zone", () => {
  assert.strictEqual(isExitZone(null), false);
});

test("the nearest exit is the closest non-roads zone", () => {
  const g = createPortalGraph();
  const hours = (h) => T0 + h * 3_600_000;
  g.record({ fromZoneId: "quaes-ovumlum", toZoneId: "cases-ugumlos", expiresAt: hours(6), now: T0 });
  g.record({ fromZoneId: "cases-ugumlos", toZoneId: "martlock", expiresAt: hours(4), now: T0 });
  const route = findNearest(g, "quaes-ovumlum", (id) => isExitZone(global.ROADS_ZONE_BY_ID.get(id)), { now: T0 });
  assert.deepStrictEqual(route.zones, ["quaes-ovumlum", "cases-ugumlos", "martlock"]);
  assert.strictEqual(route.hops, 2);
});

test("no exit recorded yields null", () => {
  const g = createPortalGraph();
  g.record({ fromZoneId: "quaes-ovumlum", toZoneId: "cases-ugumlos", expiresAt: T0 + 3_600_000, now: T0 });
  const route = findNearest(g, "quaes-ovumlum", (id) => isExitZone(global.ROADS_ZONE_BY_ID.get(id)), { now: T0 });
  assert.strictEqual(route, null);
});

// The route LINE itself lives in js/roads-route-describe.js — see
// tests/roads-route-describe.test.cjs. What belongs here is the panel's own
// glue: the search options the controls produce, and the markup they need.

test("routeOptions carries the cargo, binding and preference rules", () => {
  const controls = {
    "roads-route-cargo": { checked: true },
    "roads-route-gate": { value: "1301" },
    "roads-route-prefer": { value: "fastest" },
  };
  const previous = global.document;
  global.document = { getElementById: (id) => controls[id] || null };
  try {
    const options = routeOptions();
    assert.strictEqual(options.allowNoLuggage, false);
    assert.strictEqual(options.realmgate, "1301");
    assert.strictEqual(options.prefer, "fastest");
  } finally {
    global.document = previous;
  }
});

test("routeOptions reads an unset binding as no restriction", () => {
  const controls = { "roads-route-gate": { value: "" }, "roads-route-prefer": { value: "portal" } };
  const previous = global.document;
  global.document = { getElementById: (id) => controls[id] || null };
  try {
    const options = routeOptions();
    assert.strictEqual(options.realmgate, null);
    assert.strictEqual(options.allowNoLuggage, true);
    assert.strictEqual(options.prefer, "portal");
  } finally {
    global.document = previous;
  }
});

test("routeOptions falls back to the saved cargo tick when the box is absent", () => {
  const previousDoc = global.document;
  const previousStore = global.localStorage;
  global.document = { getElementById: () => null };
  const store = { roadsRouteCargo: "1" };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  try {
    assert.strictEqual(routeOptions().allowNoLuggage, false);
    store.roadsRouteCargo = "0";
    assert.strictEqual(routeOptions().allowNoLuggage, true);
    delete store.roadsRouteCargo;
    assert.strictEqual(routeOptions().allowNoLuggage, true, "unsaved means not hauling");
  } finally {
    global.document = previousDoc;
    global.localStorage = previousStore;
  }
});

test("the cargo tick is saved and restored like the other route rules", () => {
  const source = require("fs").readFileSync(path.join(__dirname, "..", "js", "render-roads.js"), "utf8");
  assert.ok(/CARGO_KEY = "roadsRouteCargo"/.test(source));
  // change → persisted through the same helper the gate and preference use
  const handler = source.slice(source.indexOf('getElementById("roads-route-cargo")?.addEventListener'));
  assert.ok(/onRouteRuleChanged\(CARGO_KEY, e\.target\.checked \? "1" : "0"\)/
    .test(handler.slice(0, handler.indexOf("});"))), "cargo change must persist");
  // load → restored onto the checkbox
  const init = source.slice(source.indexOf("function initRouteControls"), source.indexOf("function onRouteRuleChanged"));
  assert.ok(/cargo\.checked = localStorage\.getItem\(CARGO_KEY\) === "1"/.test(init), "cargo must be restored on load");
});

test("the cargo tick travels in the settings bundle", () => {
  const { TRANSFER_PREF_KEYS } = require("../js/settings-transfer.js");
  assert.ok(TRANSFER_PREF_KEYS.includes("roadsRouteCargo"));
  const ui = require("fs").readFileSync(path.join(__dirname, "..", "js", "settings-transfer-ui.js"), "utf8");
  const sync = ui.slice(ui.indexOf("function syncPrefControlsFromStorage"), ui.indexOf('const orderType = localStorage.getItem("orderType")'));
  // On import the controls are already on screen, and routeOptions reads the
  // DOM before storage — so the imported values must reach the controls.
  assert.ok(sync.includes('setChecked("roads-route-cargo"'), "import must repaint the cargo box");
  assert.ok(sync.includes('getElementById("roads-route-gate")'), "import must repaint the realmgate picker");
  assert.ok(sync.includes('getElementById("roads-route-prefer")'), "import must repaint the preference picker");
});

// ── the shipped panel is wired into index.html ─────────────────────────────
test("index.html loads the roads scripts and hosts both tables", () => {
  const html = readIndexHtml();
  // The data catalogs are injected after first paint by js/catalog-loader.js;
  // their presence is asserted against the loader's list, not the markup.
  const { CATALOG_SCRIPTS } = require(path.join(__dirname, "..", "js", "catalog-loader.js"));
  [
    "data-roads-zones.js", "data-roads-overland.js", "data-roads-portals.js",
  ].forEach((src) => {
    assert.ok(CATALOG_SCRIPTS.includes(`js/${src}`), `${src} not in the catalog loader`);
  });
  [
    "roads-route.js", "roads-hybrid-route.js", "render-roads.js",
  ].forEach((src) => {
    assert.ok(html.includes(`js/${src}`), `${src} not loaded`);
  });
  assert.ok(html.includes('id="roads-portals-table"'));
  assert.ok(html.includes('id="roads-zones-table"'));
});

test("the zone reference intro names the Brecilien marker, not the Rest", () => {
  const html = readIndexHtml();
  const en = require("fs").readFileSync(path.join(__dirname, "..", "js", "i18n-strings-en.js"), "utf8");
  for (const source of [html, en]) {
    assert.ok(source.includes("Brecilien portal"), "the intro must name the marker");
    assert.ok(!source.includes("marks an Avalonian Rest"), "the Rest legend must be gone");
  }
  assert.ok(en.includes("roads_brecilien_portal"), "the marker title needs a translation slug");
});

test("render-roads wires the Brecilien entrance predicate", () => {
  const source = require("fs").readFileSync(path.join(__dirname, "..", "js", "render-roads.js"), "utf8");
  // Resolved per call under a typeof guard now: the predicate lives in the
  // injected catalog (js/catalog-loader.js), so the old eval-time capture read
  // undefined and the whole zones table died on first paint. The wrapper falls
  // back to "no marker" while the catalog is absent — and the table still
  // reuses the derived predicate, never its own filter.
  assert.ok(/typeof isBrecilienEntrance === "function" \? isBrecilienEntrance\(zoneId\) : false/.test(source),
    "the table must reuse the derived predicate through the guarded wrapper");
  assert.ok(source.includes("brecilienEntrance(zone.id)"), "the zone row goes through the wrapper");
  assert.ok(!source.includes("TUNNEL_DEEP"), "and never re-derives the deep-road rule itself");
  assert.ok(!source.includes("roads_avalonian_rest"), "the rest tooltip must be gone from the table");
});

test("index.html carries the carrying-cargo checkbox beside the route buttons", () => {
  const html = readIndexHtml();
  assert.ok(html.includes('id="roads-route-cargo"'));
  assert.ok(html.includes('data-i18n="roads_carrying_cargo"'));
});

test("index.html carries Clear All in the same controls row as Add Portal", () => {
  const html = readIndexHtml();
  assert.ok(html.includes('id="roads-clear-btn"'));
  assert.ok(html.includes('data-i18n="clear_all_portals"'));
  const row = html.slice(html.lastIndexOf("<div", html.indexOf('id="roads-add-btn"')),
    html.indexOf("</div>", html.indexOf('id="roads-add-btn"')));
  assert.ok(row.includes('id="roads-clear-btn"'), "Clear All must sit beside Add Portal");
});

// Expired portals are dropped on the countdown tick now (see
// tests/roads-portals-autoprune.test.cjs), so the manual button is gone.
test("no manual Drop Expired button survives", () => {
  const html = readIndexHtml();
  const source = require("fs").readFileSync(path.join(__dirname, "..", "js", "render-roads.js"), "utf8");
  assert.ok(!html.includes("roads-prune-btn"), "the Drop Expired button must be gone from index.html");
  assert.ok(!source.includes("roads-prune-btn"), "its click handler must be gone too");
});

test("the countdown tick prunes before it redraws", () => {
  const source = require("fs").readFileSync(path.join(__dirname, "..", "js", "render-roads.js"), "utf8");
  const tick = source.slice(source.indexOf("timer = setInterval("));
  const body = tick.slice(0, tick.indexOf("}, REFRESH_MS)"));
  assert.ok(body.indexOf("autoPruneExpired(") >= 0, "the tick must prune");
  assert.ok(body.indexOf("autoPruneExpired(") < body.indexOf("renderPortalsTable("),
    "a dropped row must be gone in the same paint that redraws the countdowns");
});

test("Clear All wipes the graph, saves it and relays out the map", () => {
  const source = require("fs").readFileSync(path.join(__dirname, "..", "js", "render-roads.js"), "utf8");
  const handler = source.slice(source.indexOf('getElementById("roads-clear-btn")'));
  const body = handler.slice(0, handler.indexOf("\n    });"));
  for (const call of ["graph.clear()", "persist()", "renderPortalsTable(true)", "renderPortalsMap()"]) {
    assert.ok(body.includes(call), `Clear All must call ${call}`);
  }
  // Unrecoverable, so it asks — but an empty table has nothing to confirm.
  assert.ok(body.includes("confirm("), "Clear All must confirm before wiping");
  assert.ok(/if \(!count\) return;/.test(body), "no confirm prompt when there is nothing to clear");
});

test("index.html carries the realmgate picker, empty but for the 'any' option", () => {
  const html = readIndexHtml();
  assert.ok(html.includes('id="roads-route-gate"'));
  assert.ok(html.includes('data-i18n="roads_realmgate_any"'));
  // The five portal cities come from the generated gate map at runtime, so the
  // markup must not spell them out.
  assert.ok(!html.includes("Lymhurst Portal</option>"));
});

test("index.html carries the preference picker, defaulting to the Roads", () => {
  const html = readIndexHtml();
  const select = html.slice(html.indexOf('id="roads-route-prefer"'));
  const options = [...select.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(options.slice(0, 4), ["portal", "travel", "foot", "fastest"]);
  assert.ok(select.indexOf('data-i18n="roads_prefer_fastest"') > 0);
});

test("the route line renderer loads before the panel that calls it", () => {
  const html = readIndexHtml();
  assert.ok(html.indexOf("js/roads-route-describe.js") < html.indexOf("js/render-roads.js"));
});

test("the overland map loads before the router that reads it", () => {
  const html = readIndexHtml();
  assert.ok(html.indexOf("js/data-roads-overland.js") < html.indexOf("js/roads-hybrid-route.js"));
});

// ── portal timer input in h:m (plan 2026-09-16, TDD step 1) ───────────────
//
// Both timer entry points — the Time Left cell editor and the Add-Portal
// form — switch from decimal hours to what a player reads off the portal
// ("2:30", "30m", "23h"). The editor moves to its own module
// (js/roads-portal-editor.js — render-roads.js sits at its 800-line
// ceiling) and both paths share the RoadsTimeInput parser
// (js/roads-time-input.js, whose full syntax table lives in
// tests/roads-time-input.test.cjs).
//
// The editor and addManualPortal are IIFE-private and this harness has no
// DOM, so — exactly like the "countdown tick prunes before it redraws" test
// above — the wiring is pinned at source level, while every NUMBER the
// wiring must produce is driven through the real parser, loaded from its
// browser-global source in a sandbox.

/** Source of a repo file, CRLF/BOM normalised. Throws inside a test → FAIL. */
function roadsSource(rel) {
  if (rel === "index.html") return require("./helpers/page-source.cjs").readIndexHtml();
  return require("fs").readFileSync(path.join(__dirname, "..", rel), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^\uFEFF/, "");
}

/** RoadsTimeInput, evaluated from its browser-global source in a sandbox. */
function timeInput() {
  const vm = require("vm");
  const sandbox = { window: {}, console, module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(roadsSource("js/roads-time-input.js"), sandbox, { filename: "js/roads-time-input.js" });
  const mod = sandbox.window.RoadsTimeInput || sandbox.RoadsTimeInput || sandbox.module.exports.RoadsTimeInput;
  if (!mod || typeof mod.parse !== "function") {
    throw new Error("js/roads-time-input.js must expose window.RoadsTimeInput.parse()");
  }
  return mod;
}

/** Body of `function name` up to the next sibling function declaration. */
function fnSlice(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return null;
  const after = source.slice(start);
  const next = after.slice(1).search(/\n\s{0,4}function /);
  return next < 0 ? after : after.slice(0, next + 1);
}

test("the cell editor lives in its own module; the panel only binds it", () => {
  const editor = roadsSource("js/roads-portal-editor.js");
  for (const fn of ["openTimeEditor", "closeTimeEditor", "bindPortalEditing"]) {
    assert.ok(editor.includes(fn), `${fn} must move to js/roads-portal-editor.js`);
  }
  assert.ok(/window\.RoadsPortalEditor\b/.test(editor), "the editor module must expose window.RoadsPortalEditor");
  const panel = roadsSource("js/render-roads.js");
  assert.ok(/portalEditor\(\)\s*\.\s*bindPortalEditing\s*\(/.test(panel), "the panel must bind through the editor module");
  assert.ok(!panel.includes("function openTimeEditor"), "the editor source must leave render-roads.js");
  assert.ok(!panel.includes("function closeTimeEditor"), "the editor source must leave render-roads.js");
});

test("the Time Left editor opens as a text input prefilled H:MM", () => {
  const open = fnSlice(roadsSource("js/roads-portal-editor.js"), "openTimeEditor");
  assert.ok(open, "openTimeEditor must exist in the editor module (declared as `function openTimeEditor`)");
  assert.ok(open.includes('type="text"'), "the cell editor must be a text input");
  assert.ok(!open.includes('type="number"'), "decimal-hours typing is exactly what this replaces");
  assert.ok(open.includes("roads-portal-hours"), "the class keeps the keydown/focusout wiring working");
  assert.ok(open.includes("RoadsTimeInput.formatForEdit("), "the prefill must go through the shared formatter");
  assert.ok(open.includes("secondsLeft("), "the prefill comes from what is actually left");
});

test("7500 s left prefills the editor with 2:05", () => {
  assert.strictEqual(timeInput().formatForEdit(7500), "2:05");
});

test("committing h:mm text patches secondsRemaining through the shared parser", () => {
  const close = fnSlice(roadsSource("js/roads-portal-editor.js"), "closeTimeEditor");
  assert.ok(close, "closeTimeEditor must exist in the editor module (declared as `function closeTimeEditor`)");
  const atParse = close.indexOf("RoadsTimeInput.parse(");
  const atPatch = close.indexOf("applyPortalPatch(");
  assert.ok(atParse >= 0, "the typed text must go through RoadsTimeInput.parse");
  assert.ok(atPatch > atParse, "the parse result is what reaches applyPortalPatch");
  assert.ok(/secondsRemaining\s*:/.test(close), "the patch keeps the secondsRemaining contract");
  assert.strictEqual(timeInput().parse("2:30"), 9000, "'2:30' commits 9000 s");
  assert.strictEqual(timeInput().parse("30m"), 1800, "'30m' commits 1800 s");
  assert.strictEqual(timeInput().parse("1.5"), 5400, "a plain decimal number still commits legacy hours");
});

test("unparsable timer text never reaches the graph", () => {
  const close = fnSlice(roadsSource("js/roads-portal-editor.js"), "closeTimeEditor");
  assert.ok(close, "closeTimeEditor must exist in the editor module");
  const atParse = close.indexOf("RoadsTimeInput.parse(");
  const atPatch = close.indexOf("applyPortalPatch(");
  assert.ok(atParse >= 0 && atPatch > atParse, "commit must parse before patching");
  const guard = close.slice(atParse, atPatch);
  assert.ok(/null|isFinite|!seconds|seconds\s*[!<>=]/.test(guard),
    "a rejected parse (null) must bail before applyPortalPatch");
  assert.strictEqual(timeInput().parse("abc"), null, "'abc' is not a time");
  assert.strictEqual(timeInput().parse("25h"), null, "'25h' is past the 24 h ceiling");
  assert.strictEqual(timeInput().parse("2:75"), null, "minutes above 59 are rejected");
});

test("Escape reverts the countdown without patching", () => {
  const editor = roadsSource("js/roads-portal-editor.js");
  const binding = fnSlice(editor, "bindPortalEditing");
  assert.ok(binding, "bindPortalEditing must exist in the editor module");
  assert.ok(/event\.key === "Escape"[\s\S]{0,120}?closeTimeEditor\([^)]*,\s*false\)/.test(binding),
    "Escape must close the editor with save=false");
  const close = fnSlice(editor, "closeTimeEditor");
  assert.ok(close, "closeTimeEditor must exist in the editor module");
  const atSave = close.indexOf("save");
  const atPatch = close.indexOf("applyPortalPatch(");
  assert.ok(atSave >= 0, "closeTimeEditor keeps its save flag");
  assert.ok(atPatch < 0 || atSave < atPatch, "nothing is patched unless save was requested");
});

test("the Add-Portal form parses the same h:mm syntax into secondsRemaining", () => {
  const add = fnSlice(roadsSource("js/render-roads.js"), "addManualPortal");
  assert.ok(add, "addManualPortal stays in render-roads.js");
  const atParse = add.indexOf("timeInput().parse(");
  const atRecord = add.indexOf("recordPortal(");
  assert.ok(atParse >= 0, "the typed time must go through RoadsTimeInput.parse");
  assert.ok(add.includes("roads-add-hours"), "the value still comes from #roads-add-hours");
  assert.ok(atRecord > atParse, "the parse result feeds the recorded portal");
  assert.ok(/secondsRemaining\s*:/.test(add.slice(atParse)), "the record keeps the secondsRemaining contract");
  assert.strictEqual(timeInput().parse("30m"), 1800, "'30m' records 1800 s");
  assert.strictEqual(timeInput().parse("2:30"), 9000, "'2:30' records 9000 s");
});

test("an unparsable Add-Portal time hits the need-fields error, like an empty one", () => {
  const add = fnSlice(roadsSource("js/render-roads.js"), "addManualPortal");
  assert.ok(add, "addManualPortal stays in render-roads.js");
  const atParse = add.indexOf("timeInput().parse(");
  const atNeed = add.indexOf("roads_add_need_fields");
  assert.ok(atNeed > 0, "the need-fields error path survives");
  assert.ok(atParse >= 0 && atParse < atNeed, "the parse runs before the guard");
  assert.ok(/null|isFinite/.test(add.slice(atParse, atNeed)),
    "a rejected parse (null) must fall into the need-fields guard");
  assert.strictEqual(timeInput().parse("abc"), null, "'abc' is not a time");
});

test("the Add-Portal time box is a text field with an h:mm hint", () => {
  const html = roadsSource("index.html");
  const at = html.indexOf('id="roads-add-hours"');
  assert.ok(at > 0, "#roads-add-hours keeps its id");
  const tag = html.slice(html.lastIndexOf("<input", at), html.indexOf(">", at) + 1);
  assert.ok(tag.includes('type="text"'), "the box must accept text like '30m' (was type=number)");
  assert.ok(!tag.includes('type="number"'), "decimal-hours typing is exactly what this replaces");
  assert.ok(/placeholder="[^"]*2:30[^"]*30m[^"]*23h[^"]*"/.test(tag),
    "the placeholder shows the accepted syntax");
});

test("index.html loads the parser and the editor before the panel", () => {
  const html = roadsSource("index.html");
  const atInput = html.indexOf("js/roads-time-input.js");
  const atEditor = html.indexOf("js/roads-portal-editor.js");
  const atPanel = html.indexOf("js/render-roads.js");
  assert.ok(atInput > 0, "js/roads-time-input.js must be loaded");
  assert.ok(atEditor > 0, "js/roads-portal-editor.js must be loaded");
  assert.ok(atPanel > 0, "sanity: the panel is loaded too");
  assert.ok(atInput < atPanel && atEditor < atPanel, "both must run before render-roads.js");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
