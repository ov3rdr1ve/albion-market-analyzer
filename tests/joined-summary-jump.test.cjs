/**
 * Top-10 boards — "Jump to →" has to land on the item.
 *
 * The link is the route from a board row to the feeder row that owns its
 * editable cells, so a jump that lands on the table top (or on nothing) is the
 * one thing that makes the boards feel read-only. Four reasons it used to miss:
 *
 *   a. the table sits in a folded `.tgroup` band, which the old guard never
 *      unfolded — it only tested the table's own display (js/section-groups.js
 *      is where `collapsed` lives, and isTableHidden already counts all three
 *      kinds of hidden),
 *   b. the target is an enchant variant, which Crafting / Consumables / Craft
 *      Planner drop from the DOM entirely unless its base id is expanded
 *      (js/sorting.js COLLAPSE_VARIANT_TABLES),
 *   c. an active per-table filter has the row at display:none, and
 *      scrollIntoView on a hidden element is a silent no-op,
 *   d. Faction Spending rows have an empty getRowKey, so there was no selector
 *      to match at all.
 *
 * Order matters: each reveal step changes what is in the DOM, so the row lookup
 * has to happen after all of them.
 *
 * Run: node tests/joined-summary-jump.test.cjs
 */

const assert = require("assert");
const path = require("path");

// ── A fake DOM, narrow to exactly what the jump touches ─────────────────────
let log = [];

function El(tag, attrs = {}) {
  const el = {
    tag,
    tagName: tag.toUpperCase(), // the DOM property; the heading lookup reads it
    attrs,
    style: { display: "" },
    children: [],
    parent: null,
    _classes: new Set((attrs.class || "").split(/\s+/).filter(Boolean)),
    classList: {
      contains: (c) => el._classes.has(c),
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
    },
    getAttribute: (k) => (k in el.attrs ? String(el.attrs[k]) : null),
    closest(sel) {
      let n = el;
      while (n) {
        if (sel.startsWith(".") && n._classes.has(sel.slice(1))) return n;
        if (!sel.startsWith(".") && n.tag === sel) return n;
        n = n.parent;
      }
      return null;
    },
    // The h2 that owns a table is found by walking forward from each <h2> to its
    // siblings and looking inside them — so the fake has to model both.
    querySelector(sel) {
      let hit = null;
      const want = sel.startsWith("#") ? sel.slice(1) : null;
      el.children.forEach((c) => walk(c, (n) => { if (!hit && want && n.attrs.id === want) hit = n; }));
      return hit;
    },
    click() { log.push(`click:${el.attrs.id || el.tag}`); if (el.onClick) el.onClick(); },
    dispatchEvent(e) { log.push(`dispatch:${el.attrs.id}:${e.type}`); return true; },
    scrollIntoView() { log.push(`scroll:${el.attrs.id || el.attrs["data-row-key"] || el.tag}`); },
  };
  Object.defineProperty(el, "parentElement", { get: () => el.parent });
  Object.defineProperty(el, "nextElementSibling", {
    get: () => {
      if (!el.parent) return null;
      const sibs = el.parent.children;
      return sibs[sibs.indexOf(el) + 1] || null;
    },
  });
  Object.defineProperty(el, "previousElementSibling", {
    get: () => {
      if (!el.parent) return null;
      const sibs = el.parent.children;
      const i = sibs.indexOf(el);
      return i > 0 ? sibs[i - 1] : null;
    },
  });
  return el;
}

function append(parent, child) { child.parent = parent; parent.children.push(child); return child; }
function walk(node, fn) { fn(node); node.children.forEach((c) => walk(c, fn)); }

/**
 * A page with one band, one table, its rows, and its search box.
 * `rows` is a list of { rowKey, itemId, rowItemId, hidden } — `itemId` prints
 * inside a cell the way a price span does, `rowItemId` sits on the <tr> itself
 * the way the Craft Planner's rows carry it.
 *
 * `precedingTables` puts other <h2> + table pairs ahead of the target in the
 * same band — the real page shape, where a band holds many tables.
 */
function buildDoc({ tableId = "crafting-table", bandCollapsed = false, tableCollapsed = false,
                    rows = [], filterValue = "", precedingTables = [] } = {}) {
  const root = El("root");
  const band = append(root, El("section", { class: "tgroup" + (bandCollapsed ? " collapsed" : "") }));
  precedingTables.forEach((otherId) => {
    const oh2 = append(band, El("h2", { id: `h2-${otherId}` }));
    const owrap = append(band, El("div", { class: "table-wrap" }));
    append(owrap, El("table", { id: otherId }));
    oh2.onClick = () => { log.push(`expand:${otherId}`); };
  });
  const h2 = append(band, El("h2", { id: `h2-${tableId}` }));
  const wrap = append(band, El("div", { class: "table-wrap" }));
  const table = append(wrap, El("table", { id: tableId }));
  const tbody = append(table, El("tbody"));
  if (tableCollapsed) wrap.style.display = "none";
  h2.onClick = () => { wrap.style.display = ""; log.push(`expand:${tableId}`); };

  rows.forEach((r) => {
    const trAttrs = { "data-row-key": r.rowKey || "" };
    if (r.rowItemId) trAttrs["data-item-id"] = r.rowItemId;
    const tr = append(tbody, El("tr", trAttrs));
    if (r.hidden) tr.style.display = "none";
    if (r.itemId) append(tr, El("td", { "data-item-id": r.itemId }));
  });

  const search = append(h2, El("input", { id: `search-${tableId}` }));
  search.value = filterValue;

  const doc = {
    getElementById(id) {
      let found = null;
      walk(root, (n) => { if (!found && n.attrs.id === id) found = n; });
      return found;
    },
    querySelectorAll(sel) {
      const out = [];
      walk(root, (n) => { if (sel === "h2" && n.tag === "h2") out.push(n); });
      return out;
    },
    // Only the two selector shapes the jump builds.
    querySelector(sel) {
      const rowKeyM = /^#(\S+) tr\[data-row-key="(.*)"\]$/.exec(sel);
      const rowItemM = /^#(\S+) tr\[data-item-id="(.*)"\]$/.exec(sel);
      const itemM = /^#(\S+) \[data-item-id="(.*)"\]$/.exec(sel);
      let hit = null;
      if (rowKeyM) {
        const tbl = this.getElementById(rowKeyM[1]);
        if (tbl) walk(tbl, (n) => { if (!hit && n.tag === "tr" && n.getAttribute("data-row-key") === rowKeyM[2]) hit = n; });
      } else if (rowItemM) {
        const tbl = this.getElementById(rowItemM[1]);
        if (tbl) walk(tbl, (n) => { if (!hit && n.tag === "tr" && n.getAttribute("data-item-id") === rowItemM[2]) hit = n; });
      } else if (itemM) {
        const tbl = this.getElementById(itemM[1]);
        if (tbl) walk(tbl, (n) => { if (!hit && n.getAttribute("data-item-id") === itemM[2]) hit = n; });
      }
      return hit;
    },
    _root: root,
  };
  return doc;
}

globalThis.CSS = { escape: (s) => String(s) };

const {
  jbJumpTo, jbJumpToFirst, 
} = require(path.join(__dirname, "..", "js", "joined-summary-jump.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  log = [];
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/** Fresh collaborators per call, so each test sees its own recorder. */
function deps(doc, extra = {}) {
  return {
    doc,
    setGroupCollapsed: (group, collapsed) => {
      log.push(`unfold:${collapsed}`);
      group.classList.remove("collapsed");
    },
    expandedCraftItems: new Set(),
    collapseVariantTables: new Set(["crafting-table", "consumable-table", "craft-planner-table"]),
    updateTableDisplay: (id) => log.push(`redraw:${id}`),
    ...extra,
  };
}

console.log("\n=== revealing the table ===");

test("a folded band is unfolded", () => {
  const doc = buildDoc({ bandCollapsed: true, rows: [{ rowKey: "crafting-table|T6_BAG" }] });
  jbJumpTo({ tableId: "crafting-table", rowKey: "crafting-table|T6_BAG" }, deps(doc));
  assert.ok(log.includes("unfold:false"), `expected the band to unfold — got ${log}`);
});

test("an unfolded band is left alone", () => {
  const doc = buildDoc({ rows: [{ rowKey: "k" }] });
  jbJumpTo({ tableId: "crafting-table", rowKey: "k" }, deps(doc));
  assert.ok(!log.some((l) => l.startsWith("unfold")), "no need to touch an open band");
});

test("a collapsed table is expanded via its own <h2>", () => {
  const doc = buildDoc({ tableCollapsed: true, rows: [{ rowKey: "k" }] });
  jbJumpTo({ tableId: "crafting-table", rowKey: "k" }, deps(doc));
  assert.ok(log.includes("expand:crafting-table"), `expected the h2 click — got ${log}`);
});

test("an already-open table is not toggled shut", () => {
  const doc = buildDoc({ rows: [{ rowKey: "k" }] });
  jbJumpTo({ tableId: "crafting-table", rowKey: "k" }, deps(doc));
  assert.ok(!log.includes("expand:crafting-table"));
});

// Scanning forward from every <h2> matches the FIRST heading whose sibling
// chain reaches the table — for a table late in a band that is some earlier,
// unrelated section. Clicking it collapsed a different table and left the jump
// target hidden. The owning heading is one hop back from the table's wrapper.
test("a table late in a band is opened by its OWN heading", () => {
  const doc = buildDoc({
    tableCollapsed: true,
    precedingTables: ["flipping-table", "transport-table"],
    rows: [{ rowKey: "k" }],
  });
  jbJumpTo({ tableId: "crafting-table", rowKey: "k" }, deps(doc));
  assert.ok(log.includes("expand:crafting-table"), "the target's own heading must be clicked");
  assert.ok(!log.includes("expand:flipping-table"), "an earlier section must not be toggled");
  assert.ok(!log.includes("expand:transport-table"));
});

console.log("\n=== revealing an enchant variant ===");

test("an @n target expands its base id and redraws", () => {
  const doc = buildDoc({ rows: [{ rowKey: "crafting-table|T6_BAG@2", itemId: "T6_BAG@2" }] });
  const d = deps(doc);
  jbJumpTo({ tableId: "crafting-table", rowKey: "crafting-table|T6_BAG@2", itemId: "T6_BAG@2" }, d);
  assert.ok(d.expandedCraftItems.has("T6_BAG"), "the base id must be expanded, not the variant id");
  assert.ok(log.includes("redraw:crafting-table"), "the variant only appears after a re-render");
});

test("a base (non-@n) target expands nothing", () => {
  const doc = buildDoc({ rows: [{ rowKey: "k", itemId: "T6_BAG" }] });
  const d = deps(doc);
  jbJumpTo({ tableId: "crafting-table", rowKey: "k", itemId: "T6_BAG" }, d);
  assert.strictEqual(d.expandedCraftItems.size, 0);
});

test("a table that does not collapse variants is left alone", () => {
  const doc = buildDoc({ tableId: "flipping-table", rows: [{ rowKey: "k", itemId: "T6_BAG@2" }] });
  const d = deps(doc);
  jbJumpTo({ tableId: "flipping-table", rowKey: "k", itemId: "T6_BAG@2" }, d);
  assert.strictEqual(d.expandedCraftItems.size, 0, "flipping renders every variant as its own row");
});

console.log("\n=== an active filter ===");

test("a non-empty search box is cleared and re-run", () => {
  const doc = buildDoc({ filterValue: "martlock", rows: [{ rowKey: "k" }] });
  jbJumpTo({ tableId: "crafting-table", rowKey: "k" }, deps(doc));
  assert.strictEqual(doc.getElementById("search-crafting-table").value, "");
  assert.ok(log.includes("dispatch:search-crafting-table:input"),
    "clearing the value is not enough — the filter has to re-run");
});

test("an empty search box is not touched", () => {
  const doc = buildDoc({ rows: [{ rowKey: "k" }] });
  jbJumpTo({ tableId: "crafting-table", rowKey: "k" }, deps(doc));
  assert.ok(!log.some((l) => l.startsWith("dispatch:")));
});

console.log("\n=== finding the target ===");

test("the row key is the primary locator", () => {
  const doc = buildDoc({ rows: [{ rowKey: "crafting-table|T6_BAG", itemId: "T6_BAG" }] });
  const t = jbJumpTo({ tableId: "crafting-table", rowKey: "crafting-table|T6_BAG" }, deps(doc));
  assert.ok(t, "expected a target");
  assert.strictEqual(t.getAttribute("data-row-key"), "crafting-table|T6_BAG");
});

// Faction Spending's getRowKey returns "" — the whole reason joinedRowKey has a
// name+route fallback. Without a secondary locator those rows never land.
test("an empty row key falls back to the item id", () => {
  const doc = buildDoc({ tableId: "faction-spending-table", rows: [{ rowKey: "", itemId: "T5_CREST" }] });
  const t = jbJumpTo({ tableId: "faction-spending-table", rowKey: "", itemId: "T5_CREST" }, deps(doc));
  assert.ok(t, "expected the item-id fallback to find the row");
  assert.strictEqual(t.tag, "tr", "the fallback must resolve to the ROW, not the cell");
});

test("a row key that no longer resolves falls back to the item id", () => {
  const doc = buildDoc({ rows: [{ rowKey: "crafting-table|OTHER", itemId: "T6_BAG" }] });
  const t = jbJumpTo({ tableId: "crafting-table", rowKey: "crafting-table|GONE", itemId: "T6_BAG" }, deps(doc));
  assert.ok(t);
  assert.strictEqual(t.tag, "tr");
});

test("neither locator matching returns null — the caller scrolls to the table", () => {
  const doc = buildDoc({ rows: [{ rowKey: "other", itemId: "T9_NOPE" }] });
  const t = jbJumpTo({ tableId: "crafting-table", rowKey: "gone", itemId: "T6_BAG" }, deps(doc));
  assert.strictEqual(t, null);
});

test("a missing table returns null and does not throw", () => {
  const doc = buildDoc({ tableId: "crafting-table", rows: [] });
  assert.strictEqual(jbJumpTo({ tableId: "no-such-table", rowKey: "k" }, deps(doc)), null);
});

console.log("\n=== ordering ===");

// Each step changes the DOM, so the lookup has to come last. A jump that read
// the row before clearing the filter found a display:none element and scrolled
// nowhere.
test("band → table → variants → filter, then the lookup", () => {
  const doc = buildDoc({
    bandCollapsed: true, tableCollapsed: true, filterValue: "x",
    rows: [{ rowKey: "crafting-table|T6_BAG@2", itemId: "T6_BAG@2" }],
  });
  jbJumpTo({ tableId: "crafting-table", rowKey: "crafting-table|T6_BAG@2", itemId: "T6_BAG@2" }, deps(doc));
  const order = log.filter((l) =>
    l.startsWith("unfold") || l.startsWith("expand:") || l.startsWith("redraw:") || l.startsWith("dispatch:"));
  assert.deepStrictEqual(order, [
    "unfold:false",
    "expand:crafting-table",
    "redraw:crafting-table",
    "dispatch:search-crafting-table:input",
  ], `wrong reveal order: ${order}`);
});

console.log("\n=== the Craft Planner destination ===");
// A crafting board row jumps to the Craft Planner, not the Crafting table: the
// planner is where its materials can be refined or transmuted rather than
// merely priced. Three things make that a real jump rather than a target swap.

test("a row-level item id beats an earlier row's inline span with the same id", () => {
  // The planner's Materials column prints item ids, and a combine cape's
  // material line is literally another row's item id — so the loose fallback
  // landed on the wrong row's Materials cell.
  const doc = buildDoc({
    tableId: "craft-planner-table",
    rows: [
      { rowKey: "T8_CAPE_HERETIC|Lymhurst|royal", itemId: "T8_CAPE@1" },
      { rowKey: "T8_CAPE@1|Martlock|royal", rowItemId: "T8_CAPE@1" },
    ],
  });
  const hit = jbJumpTo({ tableId: "craft-planner-table", rowKey: "", itemId: "T8_CAPE@1" }, deps(doc));
  assert.ok(hit, "nothing matched");
  assert.strictEqual(hit.getAttribute("data-row-key"), "T8_CAPE@1|Martlock|royal");
});

test("a row key still wins over both item-id passes", () => {
  const doc = buildDoc({
    tableId: "craft-planner-table",
    rows: [
      { rowKey: "A|Lymhurst|royal", rowItemId: "T8_BAG" },
      { rowKey: "B|Martlock|royal", rowItemId: "T8_BAG" },
    ],
  });
  const hit = jbJumpTo({ tableId: "craft-planner-table", rowKey: "B|Martlock|royal", itemId: "T8_BAG" }, deps(doc));
  assert.strictEqual(hit.getAttribute("data-row-key"), "B|Martlock|royal");
});

test("the loose cell match still works where no row carries the id", () => {
  const doc = buildDoc({
    tableId: "faction-spending-table",
    rows: [{ rowKey: "", itemId: "T5_CAPEITEM_FW_LYMHURST" }],
  });
  const hit = jbJumpTo(
    { tableId: "faction-spending-table", rowKey: "", itemId: "T5_CAPEITEM_FW_LYMHURST" },
    deps(doc),
  );
  assert.strictEqual(hit.tag, "tr", "resolves to the row, not the cell");
});

test("an @n planner target fetches the variant prices it would otherwise show empty", () => {
  const doc = buildDoc({ tableId: "craft-planner-table", rows: [] });
  const asked = [];
  jbJumpTo(
    { tableId: "craft-planner-table", rowKey: "", itemId: "T8_2H_AXE@3" },
    deps(doc, { ensureVariantPrices: (o) => asked.push(o.baseId) }),
  );
  assert.deepStrictEqual(asked, ["T8_2H_AXE"], "the fetch is keyed on the BASE id");
});

test("another table's @n target does not fetch planner prices", () => {
  const doc = buildDoc({ tableId: "crafting-table", rows: [] });
  const asked = [];
  jbJumpTo(
    { tableId: "crafting-table", rowKey: "", itemId: "T8_2H_AXE@3" },
    deps(doc, { ensureVariantPrices: (o) => asked.push(o.baseId) }),
  );
  assert.deepStrictEqual(asked, []);
});

test("a base-id planner target fetches nothing", () => {
  const doc = buildDoc({ tableId: "craft-planner-table", rows: [] });
  const asked = [];
  jbJumpTo(
    { tableId: "craft-planner-table", rowKey: "", itemId: "T8_2H_AXE" },
    deps(doc, { ensureVariantPrices: (o) => asked.push(o.baseId) }),
  );
  assert.deepStrictEqual(asked, []);
});

test("a fetch that throws does not stop the jump", () => {
  const doc = buildDoc({
    tableId: "craft-planner-table",
    rows: [{ rowKey: "k", rowItemId: "T8_2H_AXE@3" }],
  });
  const hit = jbJumpTo(
    { tableId: "craft-planner-table", rowKey: "k", itemId: "T8_2H_AXE@3" },
    deps(doc, { ensureVariantPrices: () => { throw new Error("offline"); } }),
  );
  assert.ok(hit);
});

console.log("\n=== falling back to the feeder's own table ===");
// The planner does not hold every crafted item, and its own Sell/Buy city picks
// can hide the one it does. A jump must never reset a filter the user set, so it
// lands on the table the row was collected from instead of fighting it.

test("the first target that resolves wins", () => {
  const doc = buildDoc({
    tableId: "craft-planner-table",
    rows: [{ rowKey: "k", rowItemId: "T8_2H_AXE" }],
  });
  const out = jbJumpToFirst([
    { tableId: "craft-planner-table", rowKey: "", itemId: "T8_2H_AXE" },
    { tableId: "crafting-table", rowKey: "", itemId: "T8_2H_AXE" },
  ], deps(doc));
  assert.ok(out.target);
  assert.strictEqual(out.tableId, "craft-planner-table");
});

test("a primary holding no row hands over to the fallback", () => {
  const doc = buildDoc({
    tableId: "crafting-table",
    rows: [{ rowKey: "T8_MEAL_OMELETTE@1|Lymhurst", rowItemId: "T8_MEAL_OMELETTE@1" }],
  });
  const out = jbJumpToFirst([
    { tableId: "craft-planner-table", rowKey: "", itemId: "T8_MEAL_OMELETTE@1" },
    { tableId: "crafting-table", rowKey: "", itemId: "T8_MEAL_OMELETTE@1" },
  ], deps(doc));
  assert.ok(out.target, "the crafting row was not found");
  assert.strictEqual(out.tableId, "crafting-table");
});

test("nothing anywhere reports the PRIMARY table, which is where to scroll", () => {
  const doc = buildDoc({ tableId: "craft-planner-table", rows: [] });
  const out = jbJumpToFirst([
    { tableId: "craft-planner-table", rowKey: "", itemId: "T8_2H_AXE" },
    { tableId: "crafting-table", rowKey: "", itemId: "T8_2H_AXE" },
  ], deps(doc));
  assert.strictEqual(out.target, null);
  assert.strictEqual(out.tableId, "craft-planner-table");
});

test("an empty target list is not a crash", () => {
  const doc = buildDoc({ rows: [] });
  assert.deepStrictEqual(jbJumpToFirst([], deps(doc)), { target: null, tableId: null });
  assert.deepStrictEqual(jbJumpToFirst(null, deps(doc)), { target: null, tableId: null });
});

test("a target naming no table is skipped rather than counted", () => {
  const doc = buildDoc({
    tableId: "crafting-table",
    rows: [{ rowKey: "k", rowItemId: "T8_2H_AXE" }],
  });
  const out = jbJumpToFirst([
    { tableId: "", rowKey: "", itemId: "T8_2H_AXE" },
    { tableId: "crafting-table", rowKey: "", itemId: "T8_2H_AXE" },
  ], deps(doc));
  assert.strictEqual(out.tableId, "crafting-table");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
