/**
 * Spanish coverage for the Roads of Avalon panel + map and the settings
 * transfer prompts.
 *
 * Two kinds of string live in this feature and both must localize:
 *   - static chrome in index.html ([data-i18n] slugs, table headers, legend)
 *   - runtime text built in JS, which follows the repo's tx(enText, slug)
 *     contract: English inline, Spanish from the UI_STRINGS_ES overlay
 *
 * So the tests scan the real sources for the slugs each file actually uses and
 * assert the ES table answers for every one of them, then run the renderers
 * with a stubbed tx() to prove the Spanish text reaches the cells. Placeholders
 * ({n}, {zone}, {from}, {to}, {zones}) must survive translation or the message
 * loses its value.
 *
 * Run: node tests/roads-i18n.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { UI_STRINGS_EN } = require("../js/i18n-strings-en.js");
const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const html = readIndexHtml();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** Slugs passed to the local T()/TX()/t() runtime-translation helpers. */
function runtimeSlugs(source) {
  return [...source.matchAll(/\b[Tt][Xx]?\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*"([a-z0-9_]+)"/g)]
    .map((m) => m[1]);
}

// ── runtime slugs are all translated ───────────────────────────────────────

const RUNTIME_FILES = [
  "js/render-roads.js", "js/roads-route-describe.js", "js/roads-graph-view.js",
  "js/settings-transfer-ui.js", "js/render-sync.js",
];

for (const file of RUNTIME_FILES) {
  const slugs = [...new Set(runtimeSlugs(read(file)))];
  test(`${file} uses runtime slugs`, () => assert.ok(slugs.length > 0, "no tx() slugs found"));
  test(`${file}: every runtime slug has Spanish`, () => {
    const missing = slugs.filter((s) => UI_STRINGS_ES[s] == null);
    assert.deepStrictEqual(missing, [], `untranslated: ${missing.join(", ")}`);
  });
}

// ── static chrome in the Roads section ─────────────────────────────────────

const roadsSection = (() => {
  const start = html.indexOf('id="group-roads"');
  return html.slice(start, html.indexOf("</section>", start));
})();

test("every [data-i18n*] slug in the Roads section has Spanish", () => {
  const slugs = [...new Set([...roadsSection.matchAll(/data-i18n(?:-ph|-title)?="([^"]+)"/g)].map((m) => m[1]))];
  assert.ok(slugs.length >= 25, `expected the section to be tagged, found ${slugs.length}`);
  const missing = slugs.filter((s) => UI_STRINGS_ES[s] == null);
  assert.deepStrictEqual(missing, [], `untranslated: ${missing.join(", ")}`);
});

test("legend labels are tagged without losing their colour swatch", () => {
  assert.ok(
    /<span class="swatch"[^>]*><\/span><span data-i18n="roads_type_roads">Roads<\/span>/.test(roadsSection),
    "swatch must be a sibling of the translated label, not replaced by it",
  );
  for (const slug of ["roads_legend_royal", "roads_legend_rest", "roads_legend_exit", "roads_legend_lines"]) {
    assert.ok(roadsSection.includes(`data-i18n="${slug}"`), slug);
  }
});

test("the whole generated EN table is covered by ES", () => {
  const missing = Object.keys(UI_STRINGS_EN).filter((k) => UI_STRINGS_ES[k] == null);
  assert.deepStrictEqual(missing, [], `untranslated: ${missing.slice(0, 8).join(", ")}`);
});

// ── placeholders survive translation ───────────────────────────────────────

const PLACEHOLDER_CASES = [
  ["roads_no_exit", ["{zone}"]],
  ["roads_no_route", ["{from}", "{to}"]],
  ["roads_unknown_zone", ["{zones}"]],
  ["roads_added_portal", ["{from}", "{to}"]],
  ["roads_clear_confirm", ["{n}"]],
  ["roads_cleared", ["{n}"]],
  ["roads_live_portal_one", ["{n}"]],
  ["roads_live_portal_many", ["{n}"]],
  ["roads_closest_approach", ["{zone}"]],
  ["roads_pocket_no_exit", ["{zone}"]],
  ["roads_pocket_no_tunnel", ["{zone}"]],
  ["roads_needs_binding", ["{zone}"]],
  ["roads_rebinds_to", ["{zone}"]],
  ["roads_route_eta", ["{time}"]],
  ["roads_sync_summary", ["{n}", "{p}"]],
  ["roads_sync_summary_one", ["{p}"]],
];

for (const [slug, placeholders] of PLACEHOLDER_CASES) {
  test(`${slug} keeps ${placeholders.join(" + ")}`, () => {
    const value = UI_STRINGS_ES[slug];
    assert.ok(value, `${slug} missing`);
    for (const p of placeholders) assert.ok(value.includes(p), `${slug} lost ${p}: ${value}`);
  });
}

// ── the renderer actually emits Spanish ────────────────────────────────────

const ZONES = [
  { id: "cases-ugumlos", name: "Cases-Ugumlos", tier: 6, type: "roads", chests: { green: 2, gold: 1 }, resources: ["rock", "hide"], markers: { dungeon: 2, hire: 1 }, isRest: true, depth: 2 },
  { id: "mud-ford", name: "Mud Ford", tier: 6, type: "outlands", chests: {}, resources: [], markers: {}, isRest: false, depth: null },
  // The one marker the zone reference still carries: a Brecilien portal on a
  // tier-8 deep road. Rests no longer get one.
  { id: "tnl-301", name: "Filites-Izohun", tier: 8, type: "roads", chests: {}, resources: [], markers: {}, isRest: false, depth: 2, worldType: "TUNNEL_DEEP" },
];
global.ROADS_ZONES = ZONES;
global.ROADS_ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
global.ROADS_ZONE_BY_NAME = new Map(ZONES.map((z) => [z.name.toLowerCase(), z]));
// Stand-in for js/i18n.js tx() locked to Spanish.
global.tx = (en, slug) => (UI_STRINGS_ES[slug] != null ? UI_STRINGS_ES[slug] : en);

// The panel resolves the label tables and the Brecilien predicate PER CALL now
// (the catalogs land after paint via js/catalog-loader.js), so hand them over
// the way the browser does: roads-labels.js assigns itself onto globalThis,
// and the predicate is its catalog's bare global.
require("../js/roads-labels.js");
global.isBrecilienEntrance = require("../js/data-roads-brecilien.js").isBrecilienEntrance;

const { createPortalGraph } = require("../js/data-roads-portals.js");
const { zoneRow, portalRow, formatDuration, chestSummary } = require("../js/render-roads.js");
const { describeRoute } = require("../js/roads-route-describe.js");

// The route line is pure now, so Spanish reaches it through the same tx() stub
// the panel would hand it.
const ES_ROUTE_HELPERS = {
  zoneLabel: (id) => (global.ROADS_ZONE_BY_ID.get(id)?.name || id),
  escapeHtml: (text) => String(text),
  formatDuration,
  t: global.tx,
};
const sayEs = (route, extra = {}) => describeRoute(route, { ...ES_ROUTE_HELPERS, ...extra });

const NOW = 1_800_000_000_000;

const ES_ROW_CASES = [
  { name: "expired countdown", run: () => formatDuration(0), expect: ["caducado"] },
  { name: "chest colours", run: () => chestSummary({ green: 2, gold: 1 }), expect: ["2×verde", "1×dorado"] },
  { name: "zone row type + markers + resources", run: () => zoneRow(ZONES[0]), expect: ["Caminos", "Piedra", "Piel", "2× mazmorra", "mercenario"] },
  { name: "zone row Brecilien marker", run: () => zoneRow(ZONES[2]), expect: ["◆", "Portal de Brecilien"] },
  {
    name: "portal row size + source",
    run: () => {
      const graph = createPortalGraph();
      const p = graph.record({ fromZoneId: "cases-ugumlos", toZoneId: "mud-ford", size: "raid", secondsRemaining: 7200, now: NOW, source: "manual" });
      return portalRow(p, NOW);
    },
    expect: ["Incursión", "manual"],
  },
  { name: "route summary plural + validity", run: () => sayEs({ hops: 2, zones: ["cases-ugumlos", "mud-ford"], secondsLeft: 3600 }), expect: ["2 portales", "(válida"] },
  { name: "route summary singular", run: () => sayEs({ hops: 1, zones: ["cases-ugumlos", "mud-ford"], secondsLeft: 3600 }), expect: ["1 portal<"] },
  {
    name: "realmgate warnings",
    run: () => sayEs({
      hops: 2, portalHops: 0, travelHops: 2, footHops: 0, secondsLeft: Infinity,
      zones: ["cases-ugumlos", "mud-ford", "cases-ugumlos"],
      steps: [
        { zone: "mud-ford", via: "travel", gate: "in", rebindsTo: "mud-ford", noLuggage: false },
        { zone: "cases-ugumlos", via: "travel", gate: "out", noLuggage: false },
      ],
    }),
    expect: ["te vincula a Mud Ford", "necesita vínculo con Cases-Ugumlos"],
  },
  {
    name: "no-portal note + fastest estimate",
    run: () => sayEs(
      { hops: 1, portalHops: 0, footHops: 1, travelHops: 0, estimatedSeconds: 75, secondsLeft: Infinity, zones: ["cases-ugumlos", "mud-ford"], steps: [{ zone: "mud-ford", via: "foot" }] },
      { hasPortals: true, prefer: "fastest" },
    ),
    expect: ["ningún portal registrado la acorta", "unos 1m"],
  },
];

for (const c of ES_ROW_CASES) {
  test(`es render: ${c.name}`, () => {
    const out = c.run();
    for (const needle of c.expect) assert.ok(out.includes(needle), `${needle} not in: ${out}`);
  });
}

test("es render: English is restored when tx() is absent", () => {
  const saved = global.tx;
  delete global.tx;
  try {
    assert.strictEqual(formatDuration(0), "expired");
    assert.ok(chestSummary({ green: 2 }).includes("2×green"));
  } finally {
    global.tx = saved;
  }
});

// ── the language switch repaints the panel ─────────────────────────────────

test("switching language re-renders the Roads panel", () => {
  const app = appSource();
  const handler = app.slice(app.indexOf('langSelect.addEventListener("change"'), app.indexOf("// Apply the saved language"));
  assert.ok(/renderRoadsPanel\(\)/.test(handler), "roads panel must be repainted on language change");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
