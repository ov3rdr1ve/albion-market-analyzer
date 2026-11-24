/**
 * Detail rows follow their parent through the table filter.
 *
 * `classifyRow` (js/table-search.js) knows three kinds of <tr>: data rows, which
 * are matched against the query; structural headers, which survive if anything
 * in their scope does; and skip rows, whose display another toggle owns.
 *
 * A panel row — the Crafting Planner's "paths" panel, and now the Top-10 boards'
 * detail row — is none of the three. It fell through to `{data:true}`, so it was
 * matched against the query on its own: a filter that hid the parent left the
 * panel floating with no row above it, and a query matching only text inside the
 * panel showed a panel whose parent was hidden. `skip` is not the fix either —
 * that leaves it visible under a filter that hid its parent.
 *
 * The right answer is a fourth kind: take the preceding data row's visibility.
 *
 * Run: node tests/table-search-detail-rows.test.cjs
 */

const assert = require("assert");
const { applyTableSearchFilter, classifyRow } = require("../js/table-search.js");

function makeRow({ text = "", cls = [], attrs = [], display = "" } = {}) {
  const classes = new Set(cls);
  const attrSet = new Set(attrs);
  return {
    textContent: text,
    style: { display },
    classList: { contains: (c) => classes.has(c) },
    hasAttribute: (a) => attrSet.has(a),
    getAttribute: () => null,
  };
}

function mountTable(tableId, rows) {
  const input = { value: "" };
  const tbody = { rows };
  global.document = {
    getElementById: (id) => (id === `search-${tableId}` ? input : null),
    querySelector: (sel) => (sel === `#${tableId} tbody` ? tbody : null),
  };
  return input;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== classifyRow ===");

for (const cls of ["jb-detail-row", "cp-paths-row"]) {
  test(`.${cls} is a follow-the-parent row, not a data row`, () => {
    assert.deepStrictEqual(classifyRow(makeRow({ cls: [cls] })), { follows: true });
  });
}

test("an ordinary row is still a data row", () => {
  assert.deepStrictEqual(classifyRow(makeRow({ text: "x" })), { data: true });
});

test("breed-detail-row is still skipped — faction spending owns its display", () => {
  assert.deepStrictEqual(classifyRow(makeRow({ cls: ["breed-detail-row"] })), { skip: true });
});

console.log("\n=== the filter ===");

/** parent row, its detail row, a second parent, its detail row. */
function pairs() {
  return [
    makeRow({ text: "Grandmaster's Bag Martlock" }),
    makeRow({ cls: ["jb-detail-row"], text: "T6 Leather 1,240 ea" }),
    makeRow({ text: "Expert's Cape Lymhurst" }),
    makeRow({ cls: ["jb-detail-row"], text: "T5 Cloth 860 ea" }),
  ];
}

test("a detail row hides with its parent", () => {
  const rows = pairs();
  const input = mountTable("joined-summary-table", rows);
  input.value = "bag";
  applyTableSearchFilter("joined-summary-table");
  assert.strictEqual(rows[0].style.display, "", "the matching parent stays");
  assert.strictEqual(rows[1].style.display, "", "its detail row stays with it");
  assert.strictEqual(rows[2].style.display, "none", "the other parent goes");
  assert.strictEqual(rows[3].style.display, "none", "and so does its detail row");
});

test("a detail row shows again when its parent comes back", () => {
  const rows = pairs();
  const input = mountTable("joined-summary-table", rows);
  input.value = "bag";
  applyTableSearchFilter("joined-summary-table");
  input.value = "";
  applyTableSearchFilter("joined-summary-table");
  rows.forEach((r, i) => assert.strictEqual(r.style.display, "", `row ${i} should be visible`));
});

// The panel's own text is not what the user is filtering on — the board row is.
test("text inside the detail row does not rescue a hidden parent", () => {
  const rows = pairs();
  const input = mountTable("joined-summary-table", rows);
  input.value = "cloth";
  applyTableSearchFilter("joined-summary-table");
  assert.strictEqual(rows[2].style.display, "none", "the parent does not match 'cloth'");
  assert.strictEqual(rows[3].style.display, "none", "so its panel must go too");
});

test("the same holds for the Crafting Planner's paths panel", () => {
  const rows = [
    makeRow({ text: "Grandmaster's Bag" }),
    makeRow({ cls: ["cp-paths-row"], text: "buy it refine it yourself" }),
    makeRow({ text: "Expert's Cape" }),
    makeRow({ cls: ["cp-paths-row"], text: "buy it refine it yourself" }),
  ];
  const input = mountTable("craft-planner-table", rows);
  input.value = "cape";
  applyTableSearchFilter("craft-planner-table");
  assert.strictEqual(rows[0].style.display, "none");
  assert.strictEqual(rows[1].style.display, "none");
  assert.strictEqual(rows[2].style.display, "");
  assert.strictEqual(rows[3].style.display, "");
});

test("a detail row with no data row above it is left hidden, not crashed on", () => {
  const rows = [makeRow({ cls: ["jb-detail-row"], text: "orphan" }), makeRow({ text: "bag" })];
  const input = mountTable("joined-summary-table", rows);
  input.value = "bag";
  applyTableSearchFilter("joined-summary-table");
  assert.strictEqual(rows[1].style.display, "");
});

test("several detail rows in a row all follow the same parent", () => {
  const rows = [
    makeRow({ text: "bag" }),
    makeRow({ cls: ["jb-detail-row"], text: "a" }),
    makeRow({ cls: ["jb-detail-row"], text: "b" }),
    makeRow({ text: "cape" }),
    makeRow({ cls: ["jb-detail-row"], text: "c" }),
  ];
  const input = mountTable("joined-summary-table", rows);
  input.value = "bag";
  applyTableSearchFilter("joined-summary-table");
  assert.strictEqual(rows[1].style.display, "");
  assert.strictEqual(rows[2].style.display, "");
  assert.strictEqual(rows[4].style.display, "none");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
