/**
 * The panel↔map bridge — js/render-roads-map.js.
 *
 * The view owns no portal data and the panel owns no geometry, so this module
 * translates between them. Two translations are tested here:
 *
 *   which hops of a route exist as EDGES on the map (portals and the Brecilien
 *   portal — not the zones a route runs or travels through, which were never
 *   drawn), and what a Del selection means to the store.
 *
 * Black-box over a stub view and a stub store: no DOM, no SVG, no clock.
 *
 * Run: node tests/roads-map-bridge.test.cjs
 */

const assert = require("assert");
const { createRoadsMapBridge } = require("../js/render-roads-map.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** Records what the view was told, so the assertions can read it back. */
function stubView() {
  const calls = { render: [], highlight: [] };
  return {
    calls,
    render: (input) => calls.render.push(input),
    highlightRoute: (zones, pairs) => calls.highlight.push({ zones, pairs }),
  };
}

function bridgeWith(over = {}) {
  const view = over.view || stubView();
  return {
    view,
    bridge: createRoadsMapBridge({
      view: () => view,
      graph: () => over.graph || null,
      brecilienId: () => "5000",
      ...over,
    }),
  };
}

// ── which hops are edges on the map ────────────────────────────────────────

const PAIR_CASES = [
  {
    name: "portal hops only",
    route: { zones: ["a", "b"], portalPairs: [["a", "b"]], steps: [{ zone: "b", via: "portal" }] },
    want: [["a", "b"]],
  },
  {
    name: "a foot hop is not an edge",
    route: { zones: ["a", "b"], portalPairs: [], steps: [{ zone: "b", via: "foot" }] },
    want: [],
  },
  {
    name: "a travel hop is not an edge",
    route: { zones: ["a", "b"], portalPairs: [], steps: [{ zone: "b", via: "travel" }] },
    want: [],
  },
  {
    name: "the Brecilien hop is an edge",
    route: {
      zones: ["a", "TNL-8", "5000"],
      portalPairs: [["a", "TNL-8"]],
      steps: [{ zone: "TNL-8", via: "portal" }, { zone: "5000", via: "brecilien" }],
    },
    want: [["a", "TNL-8"], ["TNL-8", "5000"]],
  },
  {
    name: "a Brecilien hop after a run still names the right pair",
    route: {
      zones: ["a", "TNL-8", "5000"],
      portalPairs: [],
      steps: [{ zone: "TNL-8", via: "foot" }, { zone: "5000", via: "brecilien" }],
    },
    want: [["TNL-8", "5000"]],
  },
  { name: "a legacy route with no steps", route: { zones: ["a", "b"], portalPairs: [["a", "b"]] }, want: [["a", "b"]] },
  { name: "an empty route", route: { zones: [] }, want: [] },
];

for (const c of PAIR_CASES) {
  test(`routeMapPairs: ${c.name}`, () => {
    const { bridge } = bridgeWith();
    assert.deepStrictEqual(bridge.routeMapPairs(c.route), c.want);
  });
}

test("showRouteOnMap hands the view the zones and the drawable pairs", () => {
  const { bridge, view } = bridgeWith();
  bridge.showRouteOnMap({
    zones: ["a", "TNL-8", "5000"],
    portalPairs: [["a", "TNL-8"]],
    steps: [{ zone: "TNL-8", via: "portal" }, { zone: "5000", via: "brecilien" }],
  });
  assert.deepStrictEqual(view.calls.highlight[0].zones, ["a", "TNL-8", "5000"]);
  assert.deepStrictEqual(view.calls.highlight[0].pairs, [["a", "TNL-8"], ["TNL-8", "5000"]]);
});

test("no route clears the highlight", () => {
  const { bridge, view } = bridgeWith();
  bridge.showRouteOnMap(null);
  assert.deepStrictEqual(view.calls.highlight[0], { zones: [], pairs: undefined });
});

// ── what a selection means ─────────────────────────────────────────────────

const SELECTION_CASES = [
  ["a portal edge", { kind: "edge", key: "a|b" }, false],
  ["a zone node", { kind: "node", id: "a" }, false],
  ["the Brecilien node", { kind: "node", id: "5000" }, true],
  ["the Brecilien edge", { kind: "edge", key: "TNL-8|5000" }, true],
  ["the Brecilien edge reversed", { kind: "edge", key: "5000|TNL-8" }, true],
];

for (const [name, selection, want] of SELECTION_CASES) {
  test(`isBrecilienSelection: ${name} = ${want}`, () => {
    const { bridge } = bridgeWith();
    assert.strictEqual(bridge.isBrecilienSelection(selection), want);
  });
}

test("the Brecilien link is never taken to the store", () => {
  let asked = 0;
  const { bridge } = bridgeWith({
    graph: { all: () => { asked++; return []; }, remove: () => { asked++; return true; }, removeZone: () => { asked++; return 3; } },
  });
  assert.strictEqual(bridge.deleteFromMap({ kind: "node", id: "5000" }), 0);
  assert.strictEqual(bridge.deleteFromMap({ kind: "edge", key: "TNL-8|5000" }), 0);
  assert.strictEqual(asked, 0, "the store was consulted about a link it does not hold");
});

test("with no view mounted nothing throws", () => {
  const bridge = createRoadsMapBridge({ view: () => null, graph: () => null });
  bridge.renderPortalsMap();
  bridge.showRouteOnMap({ zones: ["a"] });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
