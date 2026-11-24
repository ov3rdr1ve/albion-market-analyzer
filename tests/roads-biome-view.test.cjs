/**
 * Tests for the biome badge on the Roads map (js/roads-graph-view.js).
 *
 * Step 2 of the biome feature: every zone whose catalog record carries a
 * `biome` shows it twice — a small caption line in the node's label stack and
 * a line in the hover tooltip. Zones without a biome (Brecilien, the
 * mapper-only phantoms, unknown ids) show neither. Past ~30 nodes the map goes
 * dense, the name labels hide, and the badge is dropped with them (the tooltip
 * keeps the biome).
 *
 * There is no jsdom in this repo, so the view runs against the smallest DOM
 * that satisfies it (same pattern as roads-graph-view-pointer.test.cjs): the
 * assertions read the SVG elements and tooltip HTML the view really builds.
 *
 * Run: node tests/roads-biome-view.test.cjs
 */

const assert = require("assert");

// ── minimal DOM ────────────────────────────────────────────────────────────

class El {
  constructor(name) {
    this.tagName = name;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.parentElement = null;
    this._text = "";
    this.value = "";
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatchEvent(event) {
    for (const fn of this.listeners[event.type] || []) fn(event);
    return true;
  }
  set textContent(value) { this._text = value; if (value === "") this.children = []; }
  get textContent() { return this._text; }
  focus() {}
  /** Only the selectors the module actually uses. */
  querySelector(selector) {
    const match = /\[data-(id|key)="(.*)"\]$/.exec(selector);
    if (!match) return null;
    const [, kind, value] = match;
    const walk = (node) => {
      if (node.attrs[`data-${kind}`] === value) return node;
      for (const child of node.children) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
}

const byId = new Map();
const svg = new El("svg");
svg.id = "roads-map";
byId.set("roads-map", svg);
const tip = new El("div");
tip.id = "roads-map-tip";
byId.set("roads-map-tip", tip);
byId.set("roads-map-empty", null);
byId.set("roads-map-status", new El("span"));
byId.set("roads-map-reset", null);
byId.set("roads-route-from", new El("input"));
byId.set("roads-route-to", new El("input"));

global.document = {
  createElementNS: (_ns, name) => new El(name),
  getElementById: (id) => byId.get(id) || null,
};
global.window = {};

// The [en, slug] tables — also what puts ROADS_BIOME_LABELS on globalThis for
// the view's draw-time lookup.
const { ROADS_BIOME_LABELS } = require("../js/roads-labels.js");

const layout = require("../js/roads-graph-layout.js");
global.buildRoadsGraphModel = layout.buildRoadsGraphModel;
global.layoutRoadsGraph = layout.layoutRoadsGraph;
global.routeEdgeKeys = layout.routeEdgeKeys;

require("../js/roads-graph-view.js");
const view = global.window.roadsGraphView;

// ── fixtures ───────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;
const zone = (id, name, biome) => ({
  id, name, tier: 6, type: "roads", chests: {}, biome: biome === undefined ? null : biome,
});

/** A chain of zones so every one of them lands on the map. */
function chainZones(specs) {
  const zones = {};
  const portals = [];
  for (let i = 0; i < specs.length; i++) {
    zones[specs[i].id] = specs[i];
    if (i > 0) {
      portals.push({
        key: `${specs[i - 1].id}|${specs[i].id}`,
        fromZoneId: specs[i - 1].id,
        toZoneId: specs[i].id,
        size: "group",
        expiresAt: NOW + 6 * 3600 * 1000,
        secondsLeft: () => 6 * 3600,
      });
    }
  }
  return { zones, portals };
}

function draw(specs, portals) {
  const { zones, portals: chained } = chainZones(specs);
  view.render({
    portals: portals || chained,
    zoneById: (id) => zones[id] || null,
    isExit: () => false,
    now: NOW,
  });
  return zones;
}

const nodeGroup = (zoneId) => svg.querySelector(`[data-id="${zoneId}"]`);
const badges = () => svg.descendants().filter((e) => (e.attrs.class || "").split(/\s+/).includes("roads-node-biome"));
const badgeOf = (zoneId) => {
  const group = nodeGroup(zoneId);
  assert.ok(group, `node ${zoneId} drawn`);
  return group.descendants().find((e) => (e.attrs.class || "").split(/\s+/).includes("roads-node-biome"));
};
const hoverTip = (zoneId) => nodeGroup(zoneId).dispatchEvent({ type: "pointerenter" });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── the badge ──────────────────────────────────────────────────────────────

const FOREST_PAIR = [zone("A", "Cases-Ugumlos", "forest"), zone("B", "Quaes-Ovumlum", null)];

test("a node with biome forest renders a Forest badge", () => {
  draw(FOREST_PAIR);
  const badge = badgeOf("A");
  assert.ok(badge, "badge element exists");
  assert.strictEqual(badge.tagName, "text", "badge is a text line");
  assert.strictEqual(badge.textContent, "Forest");
});

test("the badge stacks with the name label, not inside the circle", () => {
  draw(FOREST_PAIR);
  const group = nodeGroup("A");
  const badge = badgeOf("A");
  const name = group.descendants().find((e) => (e.attrs.class || "").includes("roads-node-label"));
  const tier = group.descendants().find((e) => (e.attrs.class || "").includes("roads-node-tier"));
  assert.ok(name && tier, "name and tier lines still drawn");
  assert.strictEqual(tier.textContent, "T6", "tier text untouched");
  assert.ok(Number(badge.getAttribute("y")) < Number(name.getAttribute("y")),
    "badge sits clear of the ring, above the name");
});

test("the hover tooltip names the biome", () => {
  draw(FOREST_PAIR);
  hoverTip("A");
  assert.ok(tip.innerHTML.includes("Forest"), `biome line in: ${tip.innerHTML}`);
  assert.strictEqual(tip.style.display, "block");
});

test("a null-biome node renders no badge and no tooltip line", () => {
  draw(FOREST_PAIR);
  assert.strictEqual(badgeOf("B"), undefined, "no badge element");
  hoverTip("B");
  assert.ok(!tip.innerHTML.includes("Forest"), `no biome line in: ${tip.innerHTML}`);
});

test("a zone the catalog does not know shows no badge either", () => {
  draw([zone("A", "Cases-Ugumlos", "forest"), zone("9999", "9999")]);
  assert.strictEqual(badgeOf("9999"), undefined);
  hoverTip("9999");
  assert.ok(!tip.innerHTML.includes("Forest"));
});

// ── all six biomes ─────────────────────────────────────────────────────────

const BIOME_KEYS = ["forest", "swamp", "steppe", "mountain", "highlands", "avalon"];

test("the labels table speaks the six biomes as [english, slug] pairs", () => {
  for (const key of BIOME_KEYS) {
    const pair = ROADS_BIOME_LABELS[key];
    assert.ok(Array.isArray(pair) && pair.length === 2, `${key} is an [en, slug] pair`);
    assert.match(pair[1], /^roads_biome_[a-z]+$/, `${key} slug shape`);
  }
  assert.deepStrictEqual(Object.keys(ROADS_BIOME_LABELS).sort(), [...BIOME_KEYS].sort(),
    "the table carries exactly the six biomes");
});

test("every biome key renders its translated EN label on the map", () => {
  const specs = BIOME_KEYS.map((biome, i) => zone(`Z${i}`, `Zone-${biome}`, biome));
  draw(specs);
  BIOME_KEYS.forEach((biome, i) => {
    const badge = badgeOf(`Z${i}`);
    assert.ok(badge, `${biome} node drawn`);
    assert.strictEqual(badge.textContent, ROADS_BIOME_LABELS[biome][0]);
  });
});

// ── Spanish ────────────────────────────────────────────────────────────────

const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");

test("the ES table answers for all six biome slugs", () => {
  const missing = BIOME_KEYS.filter((key) => UI_STRINGS_ES[ROADS_BIOME_LABELS[key][1]] == null);
  assert.deepStrictEqual(missing, [], `untranslated: ${missing.join(", ")}`);
});

test("with tx() locked to Spanish the badge renders Spanish", () => {
  global.tx = (en, slug) => (UI_STRINGS_ES[slug] != null ? UI_STRINGS_ES[slug] : en);
  try {
    draw([zone("A", "Cases-Ugumlos", "forest"), zone("B", "Quaes-Ovumlum", null)]);
    assert.strictEqual(badgeOf("A").textContent, UI_STRINGS_ES.roads_biome_forest);
    hoverTip("A");
    assert.ok(tip.innerHTML.includes(UI_STRINGS_ES.roads_biome_forest));
  } finally {
    delete global.tx;
  }
});

// ── dense map (>30 nodes): the badge goes with the labels ──────────────────

const DENSE_SPECS = Array.from({ length: 31 }, (_, i) =>
  zone(`D${i}`, `Dense-${String(i).padStart(2, "0")}`, i === 0 ? "forest" : "swamp"));

test("past 30 nodes the badge is dropped together with the label treatment", () => {
  draw(DENSE_SPECS);
  const root = svg.children.find((c) => (c.attrs.class || "").includes("roads-map-root"));
  assert.ok((root.attrs.class || "").includes("is-dense"), "map is dense");
  assert.deepStrictEqual(badges(), [], "no badge elements survive the dense cut");
});

test("dense or not, the tooltip keeps the biome", () => {
  draw(DENSE_SPECS);
  hoverTip("D0");
  assert.ok(tip.innerHTML.includes("Forest"), `biome line in: ${tip.innerHTML}`);
});

// ── layout pass-through (pure, no DOM) ─────────────────────────────────────

test("buildRoadsGraphModel copies biome from the catalog record", () => {
  const model = layout.buildRoadsGraphModel({
    portals: [{ fromZoneId: "X", toZoneId: "Y", size: "solo" }],
    zoneById: (id) => (id === "X" ? { id: "X", name: "X", tier: 5, type: "roads", biome: "swamp" } : null),
  });
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  assert.strictEqual(byId.get("X").biome, "swamp");
  assert.strictEqual(byId.get("Y").biome, null, "unknown zone → null");
});

test("a record without the biome field normalizes to null", () => {
  const model = layout.buildRoadsGraphModel({
    portals: [{ fromZoneId: "X", toZoneId: "Y", size: "solo" }],
    zoneById: (id) => (id === "X" ? { id: "X", name: "X", tier: 5, type: "roads" } : null),
  });
  assert.strictEqual(model.nodes.find((n) => n.id === "X").biome, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
