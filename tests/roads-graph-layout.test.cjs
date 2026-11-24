/**
 * Tests for the Roads of Avalon node-link map.
 *
 * Two halves, both black-box:
 *   1. geometry — js/roads-graph-layout.js is pure (portals + zone lookup in,
 *      nodes/edges with x,y out), so it is exercised directly: model shape,
 *      degree counts, expiry handling, determinism, in-bounds placement, and
 *      that linked zones end up closer together than unlinked ones.
 *   2. wiring — index.html carries the map container/legend and loads the two
 *      scripts, and js/render-roads.js feeds the view. Asserted against the
 *      real files (no jsdom in this repo).
 *
 * Run: node tests/roads-graph-layout.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const {
  buildRoadsGraphModel, layoutRoadsGraph, routeEdgeKeys, routeEdgeKeysFromPairs,
  graphComponents, nodeRadius, ROADS_LAYOUT_DEFAULTS,
} = require("../js/roads-graph-layout.js");

const NOW = 1_800_000_000_000;
const H = 3600 * 1000;

const ZONES = {
  "cases-ugumlos": { id: "cases-ugumlos", name: "Cases-Ugumlos", tier: 6, type: "roads", isRest: false, chests: { green: 2 } },
  "quaes-ovumlum": { id: "quaes-ovumlum", name: "Quaes-Ovumlum", tier: 7, type: "roads", isRest: true, chests: { gold: 1 } },
  "tetos-igaelum": { id: "tetos-igaelum", name: "Tetos-Igaelum", tier: 5, type: "roads", isRest: false, chests: {} },
  "mud-ford": { id: "mud-ford", name: "Mud Ford", tier: 6, type: "outlands", isRest: false, chests: {} },
};
const zoneById = (id) => ZONES[id] || null;

/** Portal rows in the persisted shape — no graph object needed. */
function portal(from, to, hoursLeft, size = "solo") {
  return {
    key: from < to ? `${from}|${to}` : `${to}|${from}`,
    fromZoneId: from,
    toZoneId: to,
    size,
    expiresAt: NOW + hoursLeft * H,
  };
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── model building ─────────────────────────────────────────────────────────

const MODEL_CASES = [
  {
    name: "two portals sharing a zone give 3 nodes, 2 edges",
    portals: [portal("cases-ugumlos", "quaes-ovumlum", 4), portal("quaes-ovumlum", "mud-ford", 2)],
    nodes: 3,
    edges: 2,
    check: (m) => {
      const hub = m.nodes.find((n) => n.id === "quaes-ovumlum");
      assert.strictEqual(hub.degree, 2, "hub degree");
      assert.strictEqual(m.nodes[0].id, "quaes-ovumlum", "busiest node sorts first");
    },
  },
  {
    name: "expired portal is kept but flagged dead",
    portals: [portal("cases-ugumlos", "quaes-ovumlum", -1)],
    nodes: 2,
    edges: 1,
    check: (m) => {
      assert.strictEqual(m.edges[0].dead, true, "dead flag");
      assert.strictEqual(m.edges[0].secondsLeft, 0, "clamped countdown");
      assert.strictEqual(m.nodes[0].liveDegree, 0, "expired does not count as live");
      assert.strictEqual(m.nodes[0].degree, 1, "still counted overall");
    },
  },
  {
    name: "includeExpired:false drops the dead edge and its zones",
    portals: [portal("cases-ugumlos", "quaes-ovumlum", -1)],
    options: { includeExpired: false },
    nodes: 0,
    edges: 0,
  },
  {
    name: "a non-roads zone is marked as an exit",
    portals: [portal("cases-ugumlos", "mud-ford", 5)],
    nodes: 2,
    edges: 1,
    check: (m) => {
      assert.strictEqual(m.nodes.find((n) => n.id === "mud-ford").isExit, true, "outlands is an exit");
      assert.strictEqual(m.nodes.find((n) => n.id === "cases-ugumlos").isExit, false, "roads zone is not");
    },
  },
  {
    name: "zone not in the catalog falls back to its id",
    portals: [portal("cases-ugumlos", "TNL-999", 3)],
    nodes: 2,
    edges: 1,
    check: (m) => {
      const unknown = m.nodes.find((n) => n.id === "TNL-999");
      assert.strictEqual(unknown.name, "TNL-999", "name falls back to id");
      assert.strictEqual(unknown.known, false, "flagged unknown");
      assert.strictEqual(unknown.tier, 0, "no tier");
    },
  },
  {
    name: "Rest zones and portal size survive into the model",
    portals: [portal("cases-ugumlos", "quaes-ovumlum", 6, "raid")],
    nodes: 2,
    edges: 1,
    check: (m) => {
      assert.strictEqual(m.nodes.find((n) => n.id === "quaes-ovumlum").isRest, true, "Rest flag");
      assert.strictEqual(m.edges[0].size, "raid", "size kept");
      assert.strictEqual(m.edges[0].expiresAt, NOW + 6 * H, "expiry kept for the tick");
    },
  },
  {
    name: "malformed rows are ignored",
    portals: [null, { fromZoneId: "cases-ugumlos" }, portal("cases-ugumlos", "quaes-ovumlum", 1)],
    nodes: 2,
    edges: 1,
  },
];

for (const c of MODEL_CASES) {
  test(`model: ${c.name}`, () => {
    const model = buildRoadsGraphModel({ portals: c.portals, zoneById, now: NOW, ...(c.options || {}) });
    assert.strictEqual(model.nodes.length, c.nodes, "node count");
    assert.strictEqual(model.edges.length, c.edges, "edge count");
    if (c.check) c.check(model);
  });
}

test("model: live graph objects with secondsLeft() work too", () => {
  const { createPortalGraph } = require("../js/data-roads-portals.js");
  const graph = createPortalGraph();
  graph.record({ fromZoneId: "cases-ugumlos", toZoneId: "mud-ford", size: "group", secondsRemaining: 7200, now: NOW });
  const model = buildRoadsGraphModel({ portals: graph.all(), zoneById, now: NOW });
  assert.strictEqual(model.edges.length, 1);
  assert.strictEqual(model.edges[0].secondsLeft, 7200);
  assert.strictEqual(model.edges[0].dead, false);
});

// ── the Brecilien portal ───────────────────────────────────────────────────
//
// Every T8 road holds a permanent portal into Brecilien. Nobody entered it, so
// it is not in `portals`; it is derived, drawn only for zones already on the
// map, and it is the one directed edge here.

const BRECILIEN_ZONES = {
  ...ZONES,
  "deep-one": { id: "deep-one", name: "Deep One", tier: 8, type: "roads", isRest: false, chests: {} },
  "deep-two": { id: "deep-two", name: "Deep Two", tier: 8, type: "roads", isRest: false, chests: {} },
  5000: { id: "5000", name: "Brecilien", tier: 0, type: "city", isRest: false, chests: {} },
};
const brecilienZoneById = (id) => BRECILIEN_ZONES[id] || null;
const isDeep = (id) => id === "deep-one" || id === "deep-two";
const deepModel = (portals) => buildRoadsGraphModel({
  portals, zoneById: brecilienZoneById, now: NOW, isEntrance: isDeep,
});

test("a mapped deep road grows an edge into Brecilien", () => {
  const model = deepModel([portal("cases-ugumlos", "deep-one", 5)]);
  const brecilien = model.edges.filter((e) => e.kind === "brecilien");
  assert.strictEqual(brecilien.length, 1);
  assert.strictEqual(brecilien[0].source, "deep-one");
  assert.strictEqual(brecilien[0].target, "5000");
  assert.strictEqual(brecilien[0].directed, true);
});

test("Brecilien becomes a node even though no portal names it", () => {
  const model = deepModel([portal("cases-ugumlos", "deep-one", 5)]);
  const city = model.nodes.find((n) => n.id === "5000");
  assert.ok(city, "no Brecilien node");
  assert.strictEqual(city.isBrecilien, true);
  assert.strictEqual(city.name, "Brecilien");
});

test("every mapped deep road gets its own edge, one city node for all", () => {
  const model = deepModel([portal("cases-ugumlos", "deep-one", 5), portal("cases-ugumlos", "deep-two", 5)]);
  assert.strictEqual(model.edges.filter((e) => e.kind === "brecilien").length, 2);
  assert.strictEqual(model.nodes.filter((n) => n.id === "5000").length, 1);
});

test("an unmapped deep road draws nothing", () => {
  const model = deepModel([portal("cases-ugumlos", "quaes-ovumlum", 5)]);
  assert.strictEqual(model.edges.filter((e) => e.kind === "brecilien").length, 0);
  assert.ok(!model.nodes.some((n) => n.id === "5000"));
});

test("the static edge never expires and never dies", () => {
  const model = deepModel([portal("cases-ugumlos", "deep-one", -5)]);
  const edge = model.edges.find((e) => e.kind === "brecilien");
  assert.strictEqual(edge.dead, false);
  assert.strictEqual(edge.secondsLeft, Infinity);
  assert.strictEqual(edge.expiresAt, Infinity);
});

test("the static edge is not counted as a live entered portal", () => {
  const model = deepModel([portal("cases-ugumlos", "deep-one", 5)]);
  const deep = model.nodes.find((n) => n.id === "deep-one");
  const city = model.nodes.find((n) => n.id === "5000");
  assert.strictEqual(deep.liveDegree, 1, "the entered portal, and only it");
  assert.strictEqual(deep.degree, 2, "both links size the node");
  assert.strictEqual(city.liveDegree, 0);
});

test("without the entrance test nothing is drawn", () => {
  const model = buildRoadsGraphModel({
    portals: [portal("cases-ugumlos", "deep-one", 5)], zoneById: brecilienZoneById, now: NOW,
  });
  assert.strictEqual(model.edges.filter((e) => e.kind === "brecilien").length, 0);
});

// ── layout ─────────────────────────────────────────────────────────────────

const BOX = { width: 900, height: 400, padding: 40 };

function laidOut(portals, options = {}) {
  const model = buildRoadsGraphModel({ portals, zoneById, now: NOW });
  return layoutRoadsGraph(model, { ...BOX, ...options });
}

const CHAIN = [
  portal("cases-ugumlos", "quaes-ovumlum", 4),
  portal("quaes-ovumlum", "tetos-igaelum", 3),
  portal("tetos-igaelum", "mud-ford", 2),
];

test("layout: every node lands inside the padded box", () => {
  const { nodes } = laidOut(CHAIN);
  assert.strictEqual(nodes.length, 4);
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} has finite coords`);
    assert.ok(n.x >= BOX.padding - 0.5 && n.x <= BOX.width - BOX.padding + 0.5, `${n.id} x in bounds: ${n.x}`);
    assert.ok(n.y >= BOX.padding - 0.5 && n.y <= BOX.height - BOX.padding + 0.5, `${n.id} y in bounds: ${n.y}`);
  }
});

test("layout: deterministic — same input, same coordinates", () => {
  const a = laidOut(CHAIN).nodes.map((n) => `${n.id}:${n.x},${n.y}`);
  const b = laidOut(CHAIN).nodes.map((n) => `${n.id}:${n.x},${n.y}`);
  assert.deepStrictEqual(a, b);
});

test("layout: source model is not mutated", () => {
  const model = buildRoadsGraphModel({ portals: CHAIN, zoneById, now: NOW });
  layoutRoadsGraph(model, BOX);
  assert.ok(model.nodes.every((n) => n.x === undefined), "input nodes stay position-free");
});

test("layout: an empty graph returns nothing to draw", () => {
  const out = laidOut([]);
  assert.deepStrictEqual(out.nodes, []);
  assert.deepStrictEqual(out.edges, []);
});

test("layout: a single portal places both ends apart and on screen", () => {
  const { nodes } = laidOut([portal("cases-ugumlos", "mud-ford", 4)]);
  assert.strictEqual(nodes.length, 2);
  assert.ok(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y) > 50, "not stacked");
});

test("layout: linked zones sit closer than unlinked ones", () => {
  // Two clusters with no portal between them: A—B and C—D.
  const { nodes } = laidOut([
    portal("cases-ugumlos", "quaes-ovumlum", 4),
    portal("tetos-igaelum", "mud-ford", 4),
  ]);
  const at = (id) => nodes.find((n) => n.id === id);
  const dist = (a, b) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
  const linked = (dist("cases-ugumlos", "quaes-ovumlum") + dist("tetos-igaelum", "mud-ford")) / 2;
  const across = (dist("cases-ugumlos", "tetos-igaelum") + dist("quaes-ovumlum", "mud-ford")) / 2;
  assert.ok(linked < across, `linked ${linked.toFixed(1)} should be closer than across ${across.toFixed(1)}`);
});

test("layout: disconnected components both stay on screen", () => {
  const { nodes } = laidOut([
    portal("cases-ugumlos", "quaes-ovumlum", 4),
    portal("tetos-igaelum", "mud-ford", 4),
  ]);
  for (const n of nodes) {
    assert.ok(n.x >= BOX.padding - 0.5 && n.x <= BOX.width - BOX.padding + 0.5, `${n.id} x drifted: ${n.x}`);
    assert.ok(n.y >= BOX.padding - 0.5 && n.y <= BOX.height - BOX.padding + 0.5, `${n.id} y drifted: ${n.y}`);
  }
});

test("layout: coincident seeds do not produce NaN", () => {
  const model = buildRoadsGraphModel({ portals: CHAIN, zoneById, now: NOW });
  const out = layoutRoadsGraph(model, { ...BOX, iterations: 5 });
  for (const n of out.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id}`);
});

// ── clusters and crowding ──────────────────────────────────────────────────
//
// A real 92-portal map came out of the old single-simulation layout with 79
// overlapping node pairs — separate clusters heaped on the centre by gravity.
// Components are laid out apart now, and nothing may end up drawn on top of
// anything else.

/** A synthetic map: `sizes` clusters, each a hub with that many spokes. */
function clusterPortals(sizes) {
  const portals = [];
  sizes.forEach((size, c) => {
    for (let i = 1; i <= size; i++) {
      portals.push(portal(`c${c}-hub`, `c${c}-z${i}`, 4));
    }
  });
  return portals;
}

/** Zones invented on the fly, so a stub map can be any size. */
const anyZone = (id) => ({ id, name: id, tier: 6, type: "roads", isRest: false, chests: {} });

function laidStub(portals, options = {}) {
  const model = buildRoadsGraphModel({ portals, zoneById: anyZone, now: NOW });
  return layoutRoadsGraph(model, { ...BOX, ...options });
}

function closestGap(nodes) {
  let gap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      gap = Math.min(gap, d - nodeRadius(nodes[i]) - nodeRadius(nodes[j]));
    }
  }
  return gap;
}

function boundsOf(nodes) {
  return {
    minX: Math.min(...nodes.map((n) => n.x)), maxX: Math.max(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)), maxY: Math.max(...nodes.map((n) => n.y)),
  };
}

const OVERLAP_CASES = [
  { name: "one cluster", sizes: [8] },
  { name: "three clusters of different size", sizes: [12, 5, 3] },
  { name: "a crowded map — 90 nodes, the size that broke", sizes: [60, 14, 8, 6] },
  { name: "many tiny clusters", sizes: [2, 2, 2, 2, 2, 2, 2, 2] },
];

for (const c of OVERLAP_CASES) {
  test(`layout: no two nodes overlap — ${c.name}`, () => {
    const { nodes } = laidStub(clusterPortals(c.sizes));
    assert.ok(nodes.length > 1, "fixture built");
    assert.ok(closestGap(nodes) > 0, `closest pair overlaps by ${(-closestGap(nodes)).toFixed(1)}px`);
  });
}

test("layout: nodes keep the configured clear space between them", () => {
  const { nodes } = laidStub(clusterPortals([12, 5, 3]));
  assert.ok(
    closestGap(nodes) >= ROADS_LAYOUT_DEFAULTS.nodeGap - 0.05,
    `gap ${closestGap(nodes).toFixed(1)} < ${ROADS_LAYOUT_DEFAULTS.nodeGap}`,
  );
});

test("layout: separate clusters occupy separate patches of canvas", () => {
  const laid = laidStub(clusterPortals([6, 5, 4]));
  const boxes = graphComponents(laid.nodes, laid.edges).map((c) => boundsOf(c.nodes));
  assert.strictEqual(boxes.length, 3, "three components");
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const apart = boxes[i].maxX < boxes[j].minX || boxes[j].maxX < boxes[i].minX
        || boxes[i].maxY < boxes[j].minY || boxes[j].maxY < boxes[i].minY;
      assert.ok(apart, `cluster ${i} and ${j} share canvas`);
    }
  }
});

test("layout: a map too big for the box grows the canvas instead of stacking", () => {
  const small = laidStub(clusterPortals([6]));
  const huge = laidStub(clusterPortals([80, 60, 40]));
  assert.strictEqual(small.width, BOX.width, "a small map keeps the asked-for canvas");
  assert.ok(huge.width > BOX.width && huge.height > BOX.height, "a crowded map gets a bigger one");
  assert.strictEqual(
    Math.round((huge.width / huge.height) * 100),
    Math.round((BOX.width / BOX.height) * 100),
    "aspect ratio preserved, so the view is not stretched",
  );
  assert.ok(closestGap(huge.nodes) > 0, "and still nothing overlaps");
  for (const n of huge.nodes) {
    assert.ok(n.x >= BOX.padding - 0.5 && n.x <= huge.width - BOX.padding + 0.5, `${n.id} x in canvas`);
    assert.ok(n.y >= BOX.padding - 0.5 && n.y <= huge.height - BOX.padding + 0.5, `${n.id} y in canvas`);
  }
});

test("layout: a crowded map is still deterministic", () => {
  const a = laidStub(clusterPortals([30, 9, 4])).nodes.map((n) => `${n.id}:${n.x},${n.y}`);
  const b = laidStub(clusterPortals([30, 9, 4])).nodes.map((n) => `${n.id}:${n.x},${n.y}`);
  assert.deepStrictEqual(a, b);
});

const COMPONENT_CASES = [
  { name: "one chain is one component", portals: CHAIN, sizes: [4] },
  { name: "two unlinked pairs are two components", portals: [portal("a", "b", 3), portal("c", "d", 3)], sizes: [2, 2] },
  { name: "components come back biggest first", portals: [portal("a", "b", 3), ...clusterPortals([5])], sizes: [6, 2] },
];

for (const c of COMPONENT_CASES) {
  test(`graphComponents: ${c.name}`, () => {
    const model = buildRoadsGraphModel({ portals: c.portals, zoneById: anyZone, now: NOW });
    const parts = graphComponents(model.nodes, model.edges);
    assert.deepStrictEqual(parts.map((p) => p.nodes.length), c.sizes);
    const seen = new Set();
    for (const part of parts) for (const n of part.nodes) {
      assert.ok(!seen.has(n.id), `${n.id} landed in two components`);
      seen.add(n.id);
    }
    assert.strictEqual(seen.size, model.nodes.length, "every node placed once");
  });
}

test("nodeRadius: bigger tier and busier zone draw bigger, capped", () => {
  assert.ok(nodeRadius({ tier: 8, degree: 0 }) > nodeRadius({ tier: 4, degree: 0 }), "tier grows it");
  assert.ok(nodeRadius({ tier: 6, degree: 5 }) > nodeRadius({ tier: 6, degree: 0 }), "degree grows it");
  assert.strictEqual(nodeRadius({ tier: 6, degree: 40 }), nodeRadius({ tier: 6, degree: 10 }), "degree bonus capped");
  assert.ok(Number.isFinite(nodeRadius({})), "missing fields still give a radius");
});

// ── route highlight keys ───────────────────────────────────────────────────

const ROUTE_KEY_CASES = [
  { path: [], keys: [] },
  { path: ["a"], keys: [] },
  { path: ["b", "a"], keys: ["a|b"] },            // unordered pair, matches the graph key
  { path: ["a", "b", "c"], keys: ["a|b", "b|c"] },
];

for (const c of ROUTE_KEY_CASES) {
  test(`routeEdgeKeys: [${c.path.join(",")}] → ${c.keys.length} edge(s)`, () => {
    assert.deepStrictEqual([...routeEdgeKeys(c.path)].sort(), c.keys);
  });
}

// A hybrid route runs part of the way on foot, and those zones are not on this
// map — consecutive entries in its zone path are not always an edge, so the
// portal pairs are handed over explicitly.
const PAIR_KEY_CASES = [
  { pairs: [], keys: [] },
  { pairs: [["b", "a"]], keys: ["a|b"] },
  { pairs: [["a", "b"], ["c", "d"]], keys: ["a|b", "c|d"] },  // two legs, no invented a|c
  { pairs: [["a"], null, ["a", "b"]], keys: ["a|b"] },        // junk entries are skipped
];

for (const c of PAIR_KEY_CASES) {
  test(`routeEdgeKeysFromPairs: ${c.pairs.length} pair(s) → ${c.keys.length} edge(s)`, () => {
    assert.deepStrictEqual([...routeEdgeKeysFromPairs(c.pairs)].sort(), c.keys);
  });
}

// ── wiring (real files) ────────────────────────────────────────────────────

const html = readIndexHtml();
const view = fs.readFileSync(path.join(ROOT, "js", "roads-graph-view.js"), "utf8");
const render = fs.readFileSync(path.join(ROOT, "js", "render-roads.js"), "utf8");

const MARKUP_CASES = [
  ['id="roads-map"', "svg canvas"],
  ['id="roads-map-tip"', "hover tooltip"],
  ['id="roads-map-empty"', "empty-state note"],
  ['id="roads-map-reset"', "reset view button"],
  ["roads-map-legend", "legend"],
  // data-roads-brecilien.js no longer sits in the markup — it is injected by
  // js/catalog-loader.js after first paint (asserted further down).
  ['data-i18n="roads_legend_brecilien"', "legend note for the Brecilien portal"],
  ['src="js/roads-graph-layout.js"', "layout script"],
  ['src="js/roads-graph-view.js"', "view script"],
  ['src="js/render-roads-map.js"', "panel↔map bridge"],
  ['href="css/roads-map.css"', "stylesheet"],
];

for (const [needle, label] of MARKUP_CASES) {
  test(`index.html carries the ${label}`, () => assert.ok(html.includes(needle), needle));
}

test("the Brecilien entrance catalog rides the catalog loader", () => {
  const { CATALOG_SCRIPTS } = require(path.join(ROOT, "js", "catalog-loader.js"));
  assert.ok(CATALOG_SCRIPTS.includes("js/data-roads-brecilien.js"), "entrances catalog is injected");
});

test("map scripts load before the renderer that drives them", () => {
  assert.ok(html.indexOf('src="js/roads-graph-layout.js"') < html.indexOf('src="js/roads-graph-view.js"'), "layout before view");
  assert.ok(html.indexOf('src="js/roads-graph-view.js"') < html.indexOf('src="js/render-roads.js"'), "view before renderer");
  assert.ok(html.indexOf('src="js/render-roads-map.js"') < html.indexOf('src="js/render-roads.js"'), "bridge before renderer");
  // The entrance catalog is read by the layout as a global, so conceptually it
  // still has to run first — and it reads the zone catalog, so that runs
  // before both. The catalogs load after first paint now (js/catalog-loader.js):
  // their order lives in CATALOG_SCRIPTS, and the panel paints on catalogsReady.
  const { CATALOG_SCRIPTS } = require(path.join(ROOT, "js", "catalog-loader.js"));
  assert.ok(CATALOG_SCRIPTS.indexOf("js/data-roads-zones.js") < CATALOG_SCRIPTS.indexOf("js/data-roads-brecilien.js"), "zones before entrances");
  assert.ok(html.includes('src="js/catalog-loader.js"'), "the loader tag injects them");
});

test("the Brecilien edge is drawn as permanent and one-way", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "roads-map.css"), "utf8");
  assert.ok(view.includes('marker-end", "url(#roads-brecilien-arrow)'), "the one directed line gets an arrowhead");
  const rule = /\.roads-edge\.is-brecilien\.is-dead\s*\{[^}]*\}/.exec(css);
  assert.ok(rule, "no rule keeping the permanent link out of the expired styling");
  assert.ok(/stroke-dasharray:\s*none/.test(rule[0]), "a permanent link must never grey out as expired");
});

test("the map redraws wherever portals change", () => {
  const { renderPortalsMap } = require("../js/render-roads.js");
  assert.strictEqual(typeof renderPortalsMap, "function", "exported for reuse");
  // record / prune / drop-row / panel render all repaint.
  assert.ok((render.match(/renderPortalsMap\(\)/g) || []).length >= 5, "map redraw is wired at every mutation");
  assert.ok(/showRouteOnMap\(route\)/.test(render), "found routes are highlighted");
});

test("the countdown tick never relayouts", () => {
  assert.ok(/roadsGraphView\?\.tick\(/.test(render), "tick used on the interval");
  assert.ok(!/setInterval\([^)]*renderPortalsMap/.test(render), "no periodic relayout");
});

test("the view's canvas height matches the panel's CSS height", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "roads-map.css"), "utf8");
  const cssHeight = /#roads-map\s*\{[^}]*height:\s*(\d+)px/.exec(css);
  const viewHeight = /const VIEW_H = (\d+)/.exec(view);
  assert.ok(cssHeight && viewHeight, "both heights found");
  assert.strictEqual(viewHeight[1], cssHeight[1], "one viewBox unit must be one CSS pixel");
});

// Found in a real browser: the visible line is painted OVER its hit twin, so
// with default pointer-events a click dead-centre on a portal lands on the line
// that has no listener and the portal can never be picked. The stylesheet is
// what makes the twin reachable, and no DOM stub can catch it regressing.
test("portal clicks belong to the hit twin, not the drawn line", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "roads-map.css"), "utf8");
  const rule = (selector) => {
    const found = new RegExp(`\\${selector}\\s*\\{[^}]*\\}`).exec(css);
    return found ? found[0] : "";
  };
  assert.ok(/pointer-events:\s*none/.test(rule(".roads-edge")), ".roads-edge must not take the pointer");
  assert.ok(/pointer-events:\s*stroke/.test(rule(".roads-edge-hit")), "a transparent stroke is only hit-tested with pointer-events: stroke");
  assert.ok(/pointerdown/.test(view) && /startEdgePress/.test(view), "the twin carries the press");
});

test("the map is focusable, or Del never reaches it", () => {
  assert.ok(/tabindex="0"/.test(html.slice(html.indexOf('id="roads-map"') - 60, html.indexOf('id="roads-map"') + 60)), "markup");
  assert.ok(/setAttribute\("tabindex", "0"\)/.test(view), "set by mount() too");
  assert.ok(/addEventListener\("keydown"/.test(view), "keydown is the svg's, not the document's");
});

test("the view draws the radius the layout separated by", () => {
  assert.ok(!/function nodeRadius/.test(view), "no forked copy in the view");
  assert.ok(/nodeRadius\(/.test(view), "view calls the layout's nodeRadius");
});

test("view escapes zone names in tooltips", () => {
  assert.ok(/function escapeHtml/.test(view), "escaper present");
  assert.ok(!/innerHTML\s*=\s*`[^`]*\$\{(?!escapeHtml)/.test(view), "no raw interpolation into innerHTML");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
