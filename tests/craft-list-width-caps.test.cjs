/**
 * My Crafting List — the group tables must fit a laptop screen.
 *
 * A list group is the source table's columns PLUS three of the list's own (Qty,
 * Total Buy Cost, Total Profit), so it is always the widest thing in the app.
 * Two rules keep it on screen, and both are easy to lose in a later edit:
 *
 *   1. the per-table caps and density written for `#mounts-table` must also
 *      reach `.cl-inner[data-cl-group="mounts-table"]` — the cloned rows carry
 *      the same cell-* classes but live under a different id;
 *   2. the list tightens those caps further under `#craft-list-table`, and its
 *      cloned headers WRAP (a nowrap "Profit / 10k Focus" sizes its column off
 *      the header rather than off the numbers below it);
 *   3. the group table takes the wrap's width (`width: 100%`), so its columns
 *      shrink toward min-content before anything overflows.
 *
 * Black box: read the shipped CSS as text. Measured on the Breeding & Mounts
 * group at an 1888px window (1828px wrap): as `width: max-content` it needed
 * 1822px compact / 1844px roomy and scrolled; with `width: 100%` and the
 * compact rules reaching the clone it fits down to a 1200px wrap.
 *
 * Run: node tests/craft-list-width-caps.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { readStyles } = require("./helpers/page-source.cjs");
const css = [readStyles(), ...["css/craft-list.css", "css/table-density.css"]
  .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8"))].join("\n");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Per-table rules reach the cloned group table ===");

// Every table whose rows the list can clone and that carries its own caps or
// density. A rule left pinned to the bare id styles the source table only.
["mounts-table", "laborers-table", "transport-table", "farming-table",
  "faction-spending-table", "buildings-table", "flipping-table"].forEach((id) => {
  test(`${id} rules also match .cl-inner[data-cl-group="${id}"]`, () => {
    const bare = [...css.matchAll(new RegExp(String.raw`(^|[,\s])#${id}(?=[\s,{])`, "gm"))];
    const scoped = css.includes(`.cl-inner[data-cl-group="${id}"]`);
    if (bare.length === 0) return; // no per-table rules at all: nothing to share
    assert.ok(scoped,
      `#${id} has per-table rules the list's clone of it never gets`);
  });
});

console.log("\n=== body.compact reaches the clone through the SAME rule ===");

// The check above only asks whether `.cl-inner[data-cl-group="<id>"]` appears
// ANYWHERE in the sheet — it passed even while css/table-density.css's
// `body.compact #mounts-table td` block reached the source table only, because
// styles.css carries an unrelated non-compact `:is(#mounts-table, .cl-inner[...])`
// rule elsewhere that satisfied the weak check. A bare `#<id>` selector NEVER
// matches `.cl-inner[data-cl-group="<id>"]`, however many companions the rest
// of the sheet carries, so every `body.compact` clause that names one of these
// eight ids must itself carry the `:is(#<id>, .cl-inner[...])` form.
const COMPACT_BLOCK_IDS = ["mounts-table", "laborers-table", "transport-table",
  "faction-spending-table", "skins-trading-table", "buildings-table",
  "farming-table", "brecilien-fees-table"];

// Every selector in the sheet, comments stripped (prose that names a selector
// is not a rule) and split at TOP-LEVEL commas only: the comma inside
// `:is(#mounts-table, .cl-inner[...])` belongs to one selector.
const SELECTORS = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)]
  .flatMap((m) => {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of m[1]) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });

COMPACT_BLOCK_IDS.forEach((id) => {
  test(`every body.compact rule for #${id} also names its craft-list clone`, () => {
    const hasClone = css.includes(`.cl-inner[data-cl-group="${id}"]`);
    const clauses = SELECTORS.filter(
      (s) => s.startsWith("body.compact") && new RegExp(String.raw`#${id}\b`).test(s),
    );
    if (!hasClone) {
      // Brecilien Fees has no craft-list clone anywhere in the CSS: staying
      // bare is correct, there is nothing to widen coverage to.
      assert.ok(clauses.length > 0, `expected body.compact rules for #${id}`);
      return;
    }
    assert.ok(clauses.length > 0, `expected body.compact rules for #${id}`);
    const uncovered = clauses.filter(
      (c) => !c.includes(`.cl-inner[data-cl-group="${id}"]`),
    );
    assert.deepStrictEqual(uncovered, [],
      `body.compact clause(s) for #${id} miss the craft-list clone: ${uncovered.join(" | ")}`);
  });
});

console.log("\n=== The group table shrinks to its wrap ===");

test("group tables take the wrap's width, never max-content", () => {
  const block = css.match(/\.cl-group-wrap > table\.cl-inner \{[^}]*\}/);
  assert.ok(block, "no rule for the craft-list group table");
  assert.match(block[0], /(^|[\s;{])width:\s*100%/,
    "the group table must take the wrap's width so its columns can shrink");
  assert.ok(!/max-content/.test(block[0]),
    "a max-content group table sums its columns' max widths: it never shrinks, only overflows");
});

console.log("\n=== The list's own tightening ===");

test("cloned headers wrap", () => {
  const block = css.match(/#craft-list-table tr\.cl-colhead th \{[^}]*\}/);
  assert.ok(block, "no header rule for the cloned column headers");
  assert.ok(/white-space:\s*normal/.test(block[0]),
    "nowrap headers size a column off its label, not off its numbers");
  assert.ok(/max-width:/.test(block[0]), "a header needs a wrap point");
});

[["cell-item", 115], ["cell-route", 115], ["cell-mats", 210],
  ["cell-focus-mats", 140], ["cell-note", 120]].forEach(([cls, want]) => {
  test(`#craft-list-table caps .${cls} at ${want}px`, () => {
    const m = css.match(new RegExp(String.raw`#craft-list-table td\.${cls} \{ max-width: (\d+)px`));
    assert.ok(m, `no list cap for .${cls}`);
    assert.ok(Number(m[1]) <= want,
      `.${cls} capped at ${m[1]}px in the list, wider than the ${want}px measured to fit`);
  });
});

test("cell-num is NOT capped in the list", () => {
  assert.ok(!/#craft-list-table td\.cell-num \{[^}]*max-width/.test(css),
    "a cap on cell-num pushes the age/volume badge onto its own line and the "
    + "column gets WIDER, not narrower (measured 101px → 116px)");
});

test("the list caps are at least as tight as the source tables'", () => {
  const src = css.match(/#mounts-table, \.cl-inner\[data-cl-group="mounts-table"\]\) td\.cell-mats \{ max-width: (\d+)px/);
  const list = css.match(/#craft-list-table td\.cell-mats \{ max-width: (\d+)px/);
  assert.ok(src && list, "both the mounts cap and the list cap must exist");
  assert.ok(Number(list[1]) <= Number(src[1]),
    `the list cap (${list[1]}px) must not be looser than the mounts one (${src[1]}px)`);
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
