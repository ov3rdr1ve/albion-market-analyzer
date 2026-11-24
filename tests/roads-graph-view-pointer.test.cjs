/**
 * Tests for the Roads map's pointer gestures (js/roads-graph-view.js).
 *
 * Regression: clicking a node did nothing. startNodeDrag captures the pointer
 * on the <svg>, and a captured pointer retargets the follow-up click to the
 * capture element — so the `click` listener that used to sit on the node <g>
 * never fired, and neither click nor shift-click reached the route boxes.
 * Selection is decided on pointerup now, and these cases hold it there.
 *
 * There is no jsdom in this repo, so the module runs against the smallest DOM
 * that satisfies it: enough of createElementNS/appendChild/addEventListener to
 * let real gestures be dispatched. Nothing is stubbed on the module itself —
 * the assertions read the inputs the app really writes to.
 *
 * Run: node tests/roads-graph-view-pointer.test.cjs
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
  setPointerCapture() { this.captured = true; }
  releasePointerCapture() { this.captured = false; }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 940, height: 480 }; }
  /** Backed by the class attribute, so selection can be asserted through it. */
  get classList() {
    const has = (name) => (this.attrs.class || "").split(/\s+/).includes(name);
    const write = (names) => { this.attrs.class = names.join(" "); };
    const names = () => (this.attrs.class || "").split(/\s+/).filter(Boolean);
    return {
      contains: has,
      add: (name) => { if (!has(name)) write([...names(), name]); },
      remove: (name) => write(names().filter((n) => n !== name)),
      toggle: (name, on) => (on === undefined ? (has(name) ? !write(names().filter((n) => n !== name)) : write([...names(), name]))
        : on ? (has(name) || write([...names(), name])) : write(names().filter((n) => n !== name))),
    };
  }
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
const makeInput = (id) => { const el = new El("input"); el.id = id; byId.set(id, el); return el; };

const svg = new El("svg");
svg.id = "roads-map";
byId.set("roads-map", svg);
byId.set("roads-map-tip", null);
byId.set("roads-map-empty", null);
byId.set("roads-map-status", new El("span"));
byId.set("roads-map-reset", null);
const fromInput = makeInput("roads-route-from");
const toInput = makeInput("roads-route-to");

global.document = {
  createElementNS: (_ns, name) => new El(name),
  getElementById: (id) => byId.get(id) || null,
};
global.window = {};

const layout = require("../js/roads-graph-layout.js");
global.buildRoadsGraphModel = layout.buildRoadsGraphModel;
global.layoutRoadsGraph = layout.layoutRoadsGraph;
global.routeEdgeKeys = layout.routeEdgeKeys;

require("../js/roads-graph-view.js");
const view = global.window.roadsGraphView;

// ── fixture ────────────────────────────────────────────────────────────────

const ZONES = {
  "TNL-1": { id: "TNL-1", name: "Cases-Ugumlos", tier: 6, type: "roads", chests: {}, resources: [], markers: {}, isRest: false },
  "TNL-2": { id: "TNL-2", name: "Quaes-Ovumlum", tier: 7, type: "roads", chests: {}, resources: [], markers: {}, isRest: false },
};
const NOW = 1_700_000_000_000;
const PORTALS = [{
  key: "TNL-1|TNL-2",
  fromZoneId: "TNL-1",
  toZoneId: "TNL-2",
  size: "group",
  expiresAt: NOW + 6 * 3600 * 1000,
  secondsLeft: () => 6 * 3600,
}];

/** Selections the map handed to onDelete, newest last. */
let deleted = [];

function redraw(portals = PORTALS) {
  fromInput.value = "";
  toInput.value = "";
  deleted = [];
  view.render({
    portals,
    zoneById: (id) => ZONES[id] || null,
    isExit: () => false,
    now: NOW,
    onDelete: (selection) => deleted.push(selection),
  });
}

/**
 * Fresh map for a case. A render deliberately KEEPS a selection the model still
 * holds (that is its own case below), so the reset has to be explicit.
 */
function draw(portals = PORTALS) {
  redraw(portals);
  svg.dispatchEvent({ type: "keydown", key: "Escape", preventDefault() {} });
}

const nodeGroup = (zoneId) => svg.querySelector(`[data-id="${zoneId}"]`);
const classesOf = (el) => (el.attrs.class || "").split(/\s+/);
/** The fat invisible twin that carries a portal's gestures. */
const edgeHit = (key) => svg.descendants()
  .find((el) => el.attrs["data-key"] === key && classesOf(el).includes("roads-edge-hit"));
const edgeLine = (key) => svg.descendants()
  .find((el) => el.attrs["data-key"] === key && classesOf(el).includes("roads-edge"));
const isSelected = (el) => classesOf(el).includes("is-selected");
const key = (name, over = {}) => ({ type: "keydown", key: name, preventDefault() {}, ...over });

const pointer = (type, over = {}) => ({
  type, pointerId: 1, clientX: 100, clientY: 100, shiftKey: false,
  stopPropagation() {}, preventDefault() {}, ...over,
});

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** Press a node, optionally move, release — the gesture the browser produces. */
function gesture({ zoneId, shiftKey = false, moveTo = null }) {
  const group = nodeGroup(zoneId);
  assert.ok(group, `node ${zoneId} drawn`);
  group.dispatchEvent(pointer("pointerdown", { shiftKey }));
  if (moveTo) svg.dispatchEvent(pointer("pointermove", { clientX: moveTo[0], clientY: moveTo[1] }));
  // Pointer capture means the browser delivers pointerup to the svg, not the node.
  svg.dispatchEvent(pointer("pointerup", { shiftKey }));
  return group;
}

// ── the regression ─────────────────────────────────────────────────────────

const PICK_CASES = [
  ["TNL-1", false, "roads-route-from", "Cases-Ugumlos"],
  ["TNL-2", false, "roads-route-from", "Quaes-Ovumlum"],
  ["TNL-1", true, "roads-route-to", "Cases-Ugumlos"],
  ["TNL-2", true, "roads-route-to", "Quaes-Ovumlum"],
];

PICK_CASES.forEach(([zoneId, shiftKey, inputId, want]) => {
  test(`${shiftKey ? "shift-click" : "click"} ${zoneId} fills #${inputId} with ${want}`, () => {
    draw();
    gesture({ zoneId, shiftKey });
    assert.strictEqual(byId.get(inputId).value, want);
  });
});

test("a plain click leaves the other box alone", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  assert.strictEqual(toInput.value, "");
});

test("clicking fires an input event, so the route box's own listeners run", () => {
  draw();
  let events = 0;
  fromInput.addEventListener("input", () => { events++; });
  gesture({ zoneId: "TNL-1" });
  assert.strictEqual(events, 1);
  fromInput.listeners.input = [];
});

// ── drag must NOT select ───────────────────────────────────────────────────

test("dragging a node rearranges it without retargeting the route box", () => {
  draw();
  gesture({ zoneId: "TNL-1", moveTo: [400, 300] });
  assert.strictEqual(fromInput.value, "", "a moved node is a rearrange, not a pick");
});

test("a drag moves the node's transform", () => {
  draw();
  const before = nodeGroup("TNL-1").getAttribute("transform");
  gesture({ zoneId: "TNL-1", moveTo: [500, 350] });
  assert.notStrictEqual(nodeGroup("TNL-1").getAttribute("transform"), before);
});

test("a click straight after a drag still selects — no dead window", () => {
  draw();
  gesture({ zoneId: "TNL-1", moveTo: [400, 300] });
  gesture({ zoneId: "TNL-2" });
  assert.strictEqual(fromInput.value, "Quaes-Ovumlum");
});

// ── background gestures ────────────────────────────────────────────────────

test("pressing the background pans instead of selecting", () => {
  draw();
  svg.dispatchEvent(pointer("pointerdown"));
  svg.dispatchEvent(pointer("pointermove", { clientX: 300, clientY: 300 }));
  svg.dispatchEvent(pointer("pointerup"));
  assert.strictEqual(fromInput.value, "");
  assert.notStrictEqual(svg.getAttribute("viewBox"), "0 0 940 480");
});

test("leaving the map mid-press cancels the gesture, selecting nothing", () => {
  draw();
  nodeGroup("TNL-1").dispatchEvent(pointer("pointerdown"));
  svg.dispatchEvent({ type: "pointerleave" });
  svg.dispatchEvent(pointer("pointerup"));
  assert.strictEqual(fromInput.value, "");
});

test("the pointer capture taken on press is released on up", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  assert.strictEqual(svg.captured, false);
});

test("no node carries its own click listener — a captured pointer never delivers one", () => {
  draw();
  const clickable = svg.descendants().filter((el) => (el.listeners.click || []).length && el.attrs["data-id"]);
  assert.deepStrictEqual(clickable, []);
});

test("no portal line carries one either, for the same reason", () => {
  draw();
  const clickable = svg.descendants().filter((el) => (el.listeners.click || []).length && el.attrs["data-key"]);
  assert.deepStrictEqual(clickable, []);
});

// ── selection ──────────────────────────────────────────────────────────────

const EDGE_KEY = "TNL-1|TNL-2";

/** Press a portal's hit line, optionally move, release. */
function edgeGesture({ edgeKey = EDGE_KEY, moveTo = null } = {}) {
  const hit = edgeHit(edgeKey);
  assert.ok(hit, `portal ${edgeKey} drawn`);
  hit.dispatchEvent(pointer("pointerdown"));
  if (moveTo) svg.dispatchEvent(pointer("pointermove", { clientX: moveTo[0], clientY: moveTo[1] }));
  svg.dispatchEvent(pointer("pointerup"));
  return hit;
}

test("clicking a node marks it selected", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  assert.ok(isSelected(nodeGroup("TNL-1")), "clicked node");
  assert.ok(!isSelected(nodeGroup("TNL-2")), "the other one");
});

test("only one thing is selected at a time", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  gesture({ zoneId: "TNL-2" });
  assert.ok(!isSelected(nodeGroup("TNL-1")));
  assert.ok(isSelected(nodeGroup("TNL-2")));
});

test("clicking a portal selects the line without touching the route box", () => {
  draw();
  edgeGesture();
  assert.ok(isSelected(edgeLine(EDGE_KEY)), "portal line");
  assert.strictEqual(fromInput.value, "", "a portal is not a route end");
});

test("selecting a portal clears a selected node", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  edgeGesture();
  assert.ok(!isSelected(nodeGroup("TNL-1")));
  assert.ok(isSelected(edgeLine(EDGE_KEY)));
});

test("a drag selects nothing — neither node nor portal", () => {
  draw();
  gesture({ zoneId: "TNL-1", moveTo: [400, 300] });
  assert.ok(!isSelected(nodeGroup("TNL-1")));
  draw();
  edgeGesture({ moveTo: [400, 300] });
  assert.ok(!isSelected(edgeLine(EDGE_KEY)));
});

test("pressing the background clears the selection", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  svg.dispatchEvent(pointer("pointerdown"));
  svg.dispatchEvent(pointer("pointerup"));
  assert.ok(!isSelected(nodeGroup("TNL-1")));
});

test("a drag keeps the node's line and its hit twin together", () => {
  draw();
  gesture({ zoneId: "TNL-1", moveTo: [500, 350] });
  const line = edgeLine(EDGE_KEY);
  const hit = edgeHit(EDGE_KEY);
  assert.strictEqual(hit.getAttribute("x1"), line.getAttribute("x1"));
  assert.strictEqual(hit.getAttribute("y1"), line.getAttribute("y1"));
});

// ── Del ────────────────────────────────────────────────────────────────────

const DELETE_CASES = [
  ["a node", () => gesture({ zoneId: "TNL-1" }), { kind: "node", id: "TNL-1" }],
  ["a portal", () => edgeGesture(), { kind: "edge", key: EDGE_KEY }],
];

DELETE_CASES.forEach(([what, pick, want]) => {
  test(`Del on ${what} hands that selection to onDelete`, () => {
    draw();
    pick();
    svg.dispatchEvent(key("Delete"));
    assert.deepStrictEqual(deleted, [want]);
  });
});

test("Del with nothing selected does nothing", () => {
  draw();
  svg.dispatchEvent(key("Delete"));
  assert.deepStrictEqual(deleted, []);
});

test("Del keeps the selection standing — the host may put a confirm in the way", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  svg.dispatchEvent(key("Delete"));
  assert.ok(isSelected(nodeGroup("TNL-1")), "a cancelled delete must not lose the pick");
});

test("a re-render drops a selection the model no longer holds", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  redraw([{ ...PORTALS[0], key: "TNL-2|TNL-3", fromZoneId: "TNL-2", toZoneId: "TNL-3" }]);
  svg.dispatchEvent(key("Delete"));
  assert.deepStrictEqual(deleted, [], "the deleted zone is not selectable any more");
});

test("a re-render keeps a selection the model still holds", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  redraw();
  assert.ok(isSelected(nodeGroup("TNL-1")));
  svg.dispatchEvent(key("Delete"));
  assert.deepStrictEqual(deleted, [{ kind: "node", id: "TNL-1" }]);
});

test("Escape drops the selection without deleting", () => {
  draw();
  gesture({ zoneId: "TNL-1" });
  svg.dispatchEvent(key("Escape"));
  assert.ok(!isSelected(nodeGroup("TNL-1")));
  svg.dispatchEvent(key("Delete"));
  assert.deepStrictEqual(deleted, []);
});

const IGNORED_KEYS = ["Backspace", "d", "Enter", "ArrowLeft"];
IGNORED_KEYS.forEach((name) => {
  test(`${name} is not a delete key`, () => {
    draw();
    gesture({ zoneId: "TNL-1" });
    svg.dispatchEvent(key(name));
    assert.deepStrictEqual(deleted, []);
  });
});

test("the map takes focus on a press, or Del would never reach it", () => {
  draw();
  svg.focused = false;
  gesture({ zoneId: "TNL-1" });
  assert.strictEqual(svg.focused, true);
  assert.strictEqual(svg.getAttribute("tabindex"), "0");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
