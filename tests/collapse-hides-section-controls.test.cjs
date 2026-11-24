/**
 * Test: collapsing a section hides the controls parked between its <h2> and its
 * table, not just the table.
 *
 * Bug: "Roads of Avalon — Live Portals" puts two control rows (route finder,
 *      add-portal form) between the heading and #roads-portals-table.
 *      setupCollapsibleTables() only toggled the table, so a minimized section
 *      left the inputs floating under the heading.
 *
 * Black-box approach: extract the REAL setupCollapsibleTables() from js/app.js
 * and run it against a minimal fake DOM, then assert what the user sees
 * (element visibility) after collapse/expand. No jsdom is vendored, no live
 * storage — localStorage is a stub.
 *
 * Run: node tests/collapse-hides-section-controls.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");

// ── extract setupCollapsibleTables() from the real source ────────────────────
const appSrc = appSource();
const start = appSrc.indexOf("function setupCollapsibleTables()");
assert.ok(start >= 0, "could not find setupCollapsibleTables() in js/app.js");
let depth = 0, end = -1;
for (let i = appSrc.indexOf("{", start); i < appSrc.length; i++) {
  if (appSrc[i] === "{") depth++;
  else if (appSrc[i] === "}" && --depth === 0) { end = i + 1; break; }
}
assert.ok(end > start, "could not brace-match setupCollapsibleTables()");
const setupSrc = appSrc.slice(start, end);

// ── minimal fake DOM ─────────────────────────────────────────────────────────
class El {
  constructor(tag, id) {
    this.tagName = tag.toUpperCase();
    this.id = id || "";
    this.style = {};
    this.children = [];
    this.nextElementSibling = null;
    this.textContent = "";
    this.innerHTML = "";
    this._listeners = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  /** Only self-matching is needed: the guard asks whether the CLICKED node is a control. */
  closest(sel) {
    const tags = sel.split(",").map((s) => s.trim().toUpperCase());
    return tags.includes(this.tagName) ? this : null;
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  click(target) {
    const event = { target: target || this };
    (this._listeners.click || []).forEach((fn) => fn(event));
  }
  querySelector(sel) {
    const want = sel.toUpperCase();
    for (const child of this.children) {
      if (child.tagName === want) return child;
      const deep = child.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
}

const hidden = (el) => el.style.display === "none";

/**
 * Build a document from a flat list of top-level elements (siblings), wiring
 * nextElementSibling in order — the only traversal setupCollapsibleTables uses.
 */
function makeDoc(flat) {
  flat.forEach((el, i) => { el.nextElementSibling = flat[i + 1] || null; });
  return {
    querySelectorAll: (sel) =>
      flat.filter((el) => el.tagName === sel.toUpperCase()),
    createElement: (tag) => new El(tag),
  };
}

function table(id) {
  const t = new El("table", id);
  t.appendChild(new El("tbody"));
  return t;
}

/** Section: <h2> + N control divs (display:flex) + its table. */
function section(tableId, controlCount) {
  const h2 = new El("h2");
  const controls = [];
  for (let i = 0; i < controlCount; i++) {
    const div = new El("div");
    div.style.display = "flex";
    controls.push(div);
  }
  return { h2, controls, table: table(tableId) };
}

let _ls = {};
const localStorageStub = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

/**
 * Run the real setup over a fake document; returns nothing (mutates elements).
 * `firstRun` stands in for js/section-groups.js's isFirstRun() — true only on a
 * fresh install, where every table is meant to start collapsed.
 */
function runSetup(doc, firstRun = false) {
  const factory = new Function(
    "document", "localStorage", "tableState", "updateTableDisplay", "tableCollapsers", "isFirstRun",
    `${setupSrc}\nreturn setupCollapsibleTables;`,
  );
  factory(doc, localStorageStub, {}, () => {}, [], () => firstRun)();
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== controls between heading and table follow the collapse ===");

[
  ["one control row", 1],
  ["two control rows (Roads: route + add portal)", 2],
  ["no control rows (plain section)", 0],
].forEach(([label, count]) => {
  test(`${label}: collapse hides every part of the section`, () => {
    _ls = {};
    const s = section("t-collapse", count);
    runSetup(makeDoc([s.h2, ...s.controls, s.table]));
    s.h2.click();
    assert.ok(hidden(s.table), "table must hide on collapse");
    s.controls.forEach((c, i) =>
      assert.ok(hidden(c), `control row ${i} must hide with the section`),
    );
  });

  test(`${label}: expand restores the section's own layout`, () => {
    _ls = {};
    const s = section("t-expand", count);
    runSetup(makeDoc([s.h2, ...s.controls, s.table]));
    s.h2.click();
    s.h2.click();
    assert.ok(!hidden(s.table), "table must come back on expand");
    s.controls.forEach((c, i) =>
      assert.strictEqual(
        c.style.display, "flex",
        `control row ${i} must return to its own display, not a blank value`,
      ),
    );
  });
});

test("a section stored as collapsed starts with its controls hidden", () => {
  _ls = { "table-collapsed-roads-portals-table": "1" };
  const s = section("roads-portals-table", 2);
  runSetup(makeDoc([s.h2, ...s.controls, s.table]));
  assert.ok(hidden(s.table), "table must start hidden");
  s.controls.forEach((c, i) =>
    assert.ok(hidden(c), `control row ${i} must start hidden too`),
  );
});

console.log("\n=== first run: everything starts folded ===");

test("a fresh install starts every table collapsed and stores the flag", () => {
  _ls = {};
  const a = section("first-table", 1);
  const b = section("second-table", 0);
  runSetup(makeDoc([a.h2, ...a.controls, a.table, b.h2, b.table]), true);
  assert.ok(hidden(a.table), "first table must start collapsed");
  assert.ok(hidden(a.controls[0]), "its controls must start hidden too");
  assert.ok(hidden(b.table), "second table must start collapsed");
  assert.strictEqual(_ls["table-collapsed-first-table"], "1");
  assert.strictEqual(_ls["table-collapsed-second-table"], "1");
});

test("a returning user with nothing stored keeps their tables open", () => {
  _ls = {};
  const s = section("returning-table", 1);
  runSetup(makeDoc([s.h2, ...s.controls, s.table]), false);
  assert.ok(!hidden(s.table), "table must start expanded");
});

console.log("\n=== scope: only the section's own elements move ===");

test("a later section is untouched", () => {
  _ls = {};
  const a = section("first-table", 2);
  const b = section("second-table", 1);
  runSetup(makeDoc([a.h2, ...a.controls, a.table, b.h2, ...b.controls, b.table]));
  a.h2.click();
  assert.ok(!hidden(b.table), "second table must stay visible");
  assert.ok(!hidden(b.controls[0]), "second section's controls must stay visible");
});

test("a heading whose block holds no table borrows nothing from the next heading", () => {
  // The FP calculator: <h2> + <div> (no table inside) + the NEXT <h2> + table.
  // The walk runs past the intervening heading, so that table belongs to the
  // later section — collapsing the first heading must not hide the div.
  _ls = {};
  const lead = new El("h2");
  const panel = new El("div");
  panel.style.display = "block";
  const later = section("faction-spending-table", 0);
  runSetup(makeDoc([lead, panel, later.h2, later.table]));
  lead.click();
  assert.strictEqual(
    panel.style.display, "block",
    "the panel must not be hidden by a heading that never owned the table",
  );
});

console.log("\n=== collapse feature preserved ===");

test("collapsed state is persisted and cleared", () => {
  _ls = {};
  const s = section("persist-table", 1);
  runSetup(makeDoc([s.h2, ...s.controls, s.table]));
  s.h2.click();
  assert.strictEqual(_ls["table-collapsed-persist-table"], "1");
  s.h2.click();
  assert.strictEqual(_ls["table-collapsed-persist-table"], undefined);
});

test("clicking a control in the heading does not collapse", () => {
  _ls = {};
  const s = section("guard-table", 1);
  const input = new El("input");
  s.h2.appendChild(input);
  runSetup(makeDoc([s.h2, ...s.controls, s.table]));
  s.h2.click(input);
  assert.ok(!hidden(s.table), "focusing a header control must not collapse");
  assert.ok(!hidden(s.controls[0]), "…and must not hide the section's controls");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
