/**
 * Test: every <h2> collapses ITS OWN section, never the next heading's table.
 *
 * Bug: the Faction Point Calculator's block (`.fp-calc`) holds no table when
 *      setupCollapsibleTables() runs, so the sibling walk ran past the next
 *      <h2> and bound the calculator heading to #faction-spending-table. The
 *      calculator never collapsed; its arrow folded Faction Spending instead.
 *
 * Black-box: extract the REAL setupCollapsibleTables() from js/app.js and run
 * it over a minimal fake DOM (no jsdom vendored; localStorage is a stub), then
 * assert what the user sees: visibility, the arrow, and the stored keys.
 *
 * Run: node tests/collapsible-sections.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");

const appSrc = appSource();
const start = appSrc.indexOf("function setupCollapsibleTables()");
assert.ok(start >= 0, "could not find setupCollapsibleTables() in js/app.js");
let depth = 0, end = -1;
for (let i = appSrc.indexOf("{", start); i < appSrc.length; i++) {
  if (appSrc[i] === "{") depth++;
  else if (appSrc[i] === "}" && --depth === 0) { end = i + 1; break; }
}
const setupSrc = appSrc.slice(start, end);

class El {
  constructor(tag, id, dataset) {
    this.tagName = tag.toUpperCase();
    this.id = id || "";
    this.dataset = dataset || {};
    this.style = {};
    this.children = [];
    this.nextElementSibling = null;
    this.textContent = "";
    this.innerHTML = "";
    this._listeners = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  closest(sel) {
    const tags = sel.split(",").map((s) => s.trim().toUpperCase());
    return tags.includes(this.tagName) ? this : null;
  }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  click(target) { (this._listeners.click || []).forEach((fn) => fn({ target: target || this })); }
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
const arrow = (h2) => (h2.children.find((c) => c.tagName === "SPAN") || {}).textContent;

function makeDoc(flat) {
  flat.forEach((el, i) => { el.nextElementSibling = flat[i + 1] || null; });
  return {
    querySelectorAll: (sel) => flat.filter((el) => el.tagName === sel.toUpperCase()),
    createElement: (tag) => new El(tag),
  };
}
function table(id) {
  const t = new El("table", id);
  t.appendChild(new El("tbody"));
  return t;
}
function wrapped(id) {
  const w = new El("div");
  w.appendChild(table(id));
  return w;
}

let _ls = {};
const localStorageStub = {
  getItem: (k) => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};
function runSetup(doc) {
  const collapsers = [];
  new Function(
    "document", "localStorage", "tableState", "updateTableDisplay", "tableCollapsers", "isFirstRun",
    `${setupSrc}\nreturn setupCollapsibleTables;`,
  )(doc, localStorageStub, {}, () => {}, collapsers, () => false)();
  return collapsers;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/** The calculator layout: <h2> + keyed tool block + <h2> + Faction Spending table. */
function fpLayout({ blockHasTable = false } = {}) {
  const calcH2 = new El("h2");
  const calc = new El("div", "", { collapseKey: "fp-calc" });
  calc.style.display = "block";
  // Once the catalogs land the calculator renders its own breakdown <table>
  // inside the block — that is layout, not a data table to bind to.
  if (blockHasTable) calc.appendChild(table(""));
  const fsH2 = new El("h2");
  const fsTable = table("faction-spending-table");
  return { calcH2, calc, fsH2, fsTable, doc: makeDoc([calcH2, calc, fsH2, fsTable]) };
}

console.log("\n=== the calculator and Faction Spending collapse independently ===");

[
  ["the calculator block is empty at setup", false],
  ["the calculator already rendered its breakdown table", true],
].forEach(([label, blockHasTable]) => {
  test(`${label}: the calculator heading collapses only the calculator`, () => {
    _ls = {};
    const s = fpLayout({ blockHasTable });
    runSetup(s.doc);
    s.calcH2.click();
    assert.ok(hidden(s.calc), "calculator block must hide");
    assert.ok(!hidden(s.fsTable), "Faction Spending table must stay visible");
    assert.strictEqual(arrow(s.calcH2), " ▶");
    assert.strictEqual(arrow(s.fsH2), " ▼", "Faction Spending arrow stays in sync with its table");
    assert.deepStrictEqual(Object.keys(_ls), ["table-collapsed-fp-calc"]);
    s.calcH2.click();
    assert.strictEqual(s.calc.style.display, "block", "expand restores the block's own display");
    assert.deepStrictEqual(Object.keys(_ls), []);
  });

  test(`${label}: the Faction Spending heading collapses only its table`, () => {
    _ls = {};
    const s = fpLayout({ blockHasTable });
    runSetup(s.doc);
    s.fsH2.click();
    assert.ok(hidden(s.fsTable), "Faction Spending table must hide");
    assert.ok(!hidden(s.calc), "calculator must stay visible");
    assert.strictEqual(arrow(s.fsH2), " ▶");
    assert.strictEqual(arrow(s.calcH2), " ▼");
    assert.deepStrictEqual(Object.keys(_ls), ["table-collapsed-faction-spending-table"]);
  });
});

test("stored states restore per key, independently", () => {
  _ls = { "table-collapsed-fp-calc": "1" };
  const s = fpLayout();
  runSetup(s.doc);
  assert.ok(hidden(s.calc), "calculator restores collapsed");
  assert.ok(!hidden(s.fsTable), "Faction Spending restores expanded");
  _ls = { "table-collapsed-faction-spending-table": "1" };
  const t = fpLayout();
  runSetup(t.doc);
  assert.ok(!hidden(t.calc));
  assert.ok(hidden(t.fsTable));
});

test("both register with Collapse All", () => {
  _ls = {};
  const s = fpLayout();
  const collapsers = runSetup(s.doc);
  assert.strictEqual(collapsers.length, 2);
  collapsers.forEach((fn) => fn(true));
  assert.ok(hidden(s.calc) && hidden(s.fsTable));
});

console.log("\n=== the walk never borrows the next heading's table ===");

[
  // [label, build content of the first section, expected first-heading behaviour]
  ["heading with a table", () => [table("own-table")], "table"],
  ["heading with a wrapper containing a table", () => [wrapped("own-table")], "wrapper"],
  ["heading with a table-less block that has an id", () => {
    const d = new El("div", "own-block"); d.style.display = "block"; return [d];
  }, "block"],
  ["heading with a table-less block and no key", () => {
    const d = new El("div"); d.style.display = "block"; return [d];
  }, "none"],
].forEach(([label, build, kind]) => {
  test(`${label}: the first heading never touches the next section`, () => {
    _ls = {};
    const h1 = new El("h2");
    const content = build();
    const h2 = new El("h2");
    const next = table("next-table");
    runSetup(makeDoc([h1, ...content, h2, next]));
    h1.click();
    assert.ok(!hidden(next), "the next section's table must stay visible");
    assert.ok(!Object.keys(_ls).includes("table-collapsed-next-table"),
      "the next section's key must never be written by the first heading");
    const first = content[0];
    if (kind === "table") assert.ok(hidden(first));
    if (kind === "wrapper") assert.ok(hidden(first), "the wrapper hides, not an empty box");
    if (kind === "block") {
      assert.ok(hidden(first));
      assert.deepStrictEqual(Object.keys(_ls), ["table-collapsed-own-block"]);
    }
    if (kind === "none") {
      assert.strictEqual(first.style.display, "block", "an unkeyed block stays put");
      assert.strictEqual(arrow(h1), undefined, "and its heading gets no arrow");
    }
    h2.click();
    assert.ok(hidden(next), "the next heading still collapses its own table");
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
