/**
 * Black-box tests for the generic per-table search filter (js/table-search.js).
 *
 * The feature: every data table (except the volume table, which keeps its own
 * object-level filter) gets a free-text box in its <h2>. Typing hides rows whose
 * RENDERED text doesn't match all whitespace-separated terms. Structural rows
 * (royal/caerleon section dividers, rolling category/roll-type group headers,
 * brecilien group-label rows) stay visible only when a data row inside them
 * survives. `.breed-detail-row` rows (faction-spending toggles them open/closed
 * via inline display) must never be touched.
 *
 * We drive the REAL applyTableSearchFilter() through a tiny fake DOM and assert
 * the resulting per-row `style.display`. No live DOM, no network — pure
 * input→output behavior.
 *
 * Run: node tests/table-search.test.cjs
 */

const assert = require("assert");
const {
  applyTableSearchFilter,
  classifyRow,
  parseRowTierEnchant,
  rowPassesTierEnch,
} = require("../js/table-search.js");

const { makeRow, mountTable, DISPLAYS } = require("./helpers/table-search-dom.cjs");

// ── runner ──────────────────────────────────────────────────────────────────
let passed = 0,
  failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Generic table search filter\n");

// ── classifyRow mapping ──────────────────────────────────────────────────────
test("classifyRow distinguishes data / structural / skip rows", () => {
  assert.deepStrictEqual(classifyRow(makeRow({ text: "x" })), { data: true });
  assert.deepStrictEqual(
    classifyRow(makeRow({ cls: ["section-divider"] })),
    { level: 0 },
  );
  assert.deepStrictEqual(
    classifyRow(makeRow({ cls: ["bf-group-row"] })),
    { level: 0 },
  );
  assert.deepStrictEqual(
    classifyRow(makeRow({ attrs: ["data-header-cat"] })),
    { level: 0 },
  );
  assert.deepStrictEqual(
    classifyRow(makeRow({ attrs: ["data-header-roll"] })),
    { level: 1 },
  );
  assert.deepStrictEqual(
    classifyRow(makeRow({ cls: ["breed-detail-row"] })),
    { skip: true },
  );
});

// ── basic matching ───────────────────────────────────────────────────────────
test("empty query shows every data row", () => {
  const rows = [makeRow({ text: "Alpha" }), makeRow({ text: "Beta" })];
  const input = mountTable("crafting-table", rows);
  input.value = "";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", ""]);
});

test("single term hides non-matching data rows", () => {
  const rows = [
    makeRow({ text: "T6 Bag Martlock" }),
    makeRow({ text: "T5 Cape Lymhurst" }),
  ];
  const input = mountTable("crafting-table", rows);
  input.value = "bag";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
});

test("multiple terms are AND-combined", () => {
  const rows = [
    makeRow({ text: "T6 Bag Martlock" }), // has both
    makeRow({ text: "T6 Bag Lymhurst" }), // missing martlock
    makeRow({ text: "T6 Cape Martlock" }), // missing bag
  ];
  const input = mountTable("crafting-table", rows);
  input.value = "bag martlock";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none", "none"]);
});

test("matching is case-insensitive and whitespace-tolerant", () => {
  const rows = [makeRow({ text: "Swiftclaw Ox" })];
  const input = mountTable("mounts-table", rows);
  input.value = "  OX   swift ";
  applyTableSearchFilter("mounts-table");
  // "swift" is a substring of "Swiftclaw", "ox" matches "Ox"
  assert.deepStrictEqual(DISPLAYS(rows), [""]);
});

test("clearing the query restores all rows", () => {
  const rows = [makeRow({ text: "Alpha" }), makeRow({ text: "Beta" })];
  const input = mountTable("flipping-table", rows);
  input.value = "alpha";
  applyTableSearchFilter("flipping-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
  input.value = "";
  applyTableSearchFilter("flipping-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", ""]);
});

test("no match leaves every data row hidden", () => {
  const rows = [makeRow({ text: "Alpha" }), makeRow({ text: "Beta" })];
  const input = mountTable("flipping-table", rows);
  input.value = "zzzznope";
  applyTableSearchFilter("flipping-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"]);
});

// ── section dividers (royal / caerleon split) ────────────────────────────────
test("section divider hides when no row beneath it matches", () => {
  const rows = [
    makeRow({ text: "royal alpha" }),
    makeRow({ text: "royal beta" }),
    makeRow({ cls: ["section-divider"], text: "Caerleon & Black Market Routes" }),
    makeRow({ text: "caerleon gamma" }),
    makeRow({ text: "caerleon delta" }),
  ];
  const input = mountTable("transport-table", rows);
  input.value = "beta"; // only a royal row matches
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "", "none", "none", "none"]);
});

test("section divider stays when a row beneath it matches", () => {
  const rows = [
    makeRow({ text: "royal alpha" }),
    makeRow({ cls: ["section-divider"], text: "Caerleon Routes" }),
    makeRow({ text: "caerleon gamma" }),
  ];
  const input = mountTable("transport-table", rows);
  input.value = "gamma";
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "", ""]);
});

// ── nested rolling group headers ─────────────────────────────────────────────
// (the nesting logic must resolve category ⊃ roll-type correctly)
test("nested headers: parent shows for any descendant; sibling stays hidden", () => {
  const rows = [
    makeRow({ attrs: ["data-header-cat"], text: "Any Artifacts" }), // 0
    makeRow({ attrs: ["data-header-roll"], text: "T4 Rune" }), //      1
    makeRow({ text: "alpha sword" }), //                                2
    makeRow({ attrs: ["data-header-roll"], text: "T4 Soul" }), //      3
    makeRow({ text: "gamma bow" }), //                                  4
    makeRow({ attrs: ["data-header-cat"], text: "Warrior Artifacts" }), // 5
    makeRow({ attrs: ["data-header-roll"], text: "T4 Rune" }), //      6
    makeRow({ text: "delta staff" }), //                                7
  ];
  const input = mountTable("rolling-table", rows);
  input.value = "gamma"; // only row 4 (under Any ▸ Soul) matches
  applyTableSearchFilter("rolling-table");
  assert.deepStrictEqual(DISPLAYS(rows), [
    "", // Any header — has a matching descendant
    "none", // Rune (Any) — no match in its group
    "none", // alpha sword
    "", // Soul (Any) — contains the match
    "", // gamma bow
    "none", // Warrior header — nothing matches
    "none", // Rune (Warrior)
    "none", // delta staff
  ]);
});

test("empty query shows all structural + data rows", () => {
  const rows = [
    makeRow({ attrs: ["data-header-cat"], text: "Any" }),
    makeRow({ attrs: ["data-header-roll"], text: "Rune" }),
    makeRow({ text: "alpha" }),
  ];
  const input = mountTable("rolling-table", rows);
  input.value = "";
  applyTableSearchFilter("rolling-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "", ""]);
});

// ── rolling: display ownership is shared with the group collapse ─────────────
// The Artifact Rolling table hides rows two ways: its per-group collapse
// (applyRollingCollapsed, js/app.js) and this filter. Contract: an ACTIVE query
// owns display (a match shows even through a folded group); an EMPTY one hands
// display straight back to the collapse applier and writes nothing itself, so
// clearing the box cannot silently unfold every group. Pickers without a query
// keep the folds and only hide more rows on top of them.
test("rolling: an empty query delegates to the collapse applier, untouched rows", () => {
  const rows = [
    makeRow({ attrs: ["data-header-cat"], text: "Any", display: "none" }),
    makeRow({ text: "alpha sword", display: "none" }),
  ];
  const input = mountTable("rolling-table", rows);
  let called = 0;
  global.window = { applyRollingCollapsed: () => { called++; } };
  input.value = "";
  applyTableSearchFilter("rolling-table");
  delete global.window;
  assert.strictEqual(called, 1, "collapse applier must be called back");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"], "filter must not overwrite collapse state");
});

test("rolling: an active query owns display, showing matches through a fold", () => {
  const rows = [
    makeRow({ attrs: ["data-header-cat"], text: "Any", display: "none" }),
    makeRow({ text: "alpha sword", display: "none" }),
    makeRow({ text: "gamma bow", display: "none" }),
  ];
  const input = mountTable("rolling-table", rows);
  let called = 0;
  global.window = { applyRollingCollapsed: () => { called++; } };
  input.value = "gamma";
  applyTableSearchFilter("rolling-table");
  delete global.window;
  assert.strictEqual(called, 0, "an active query must not hand display back");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none", ""]);
});

test("rolling: a tier pick alone still filters (the picked-out row hides)", () => {
  const rows = [
    makeRow({ text: "alpha sword", rowKey: "royal|Any|T4_ARTEFACT_MAIN_SWORD_UNDEAD" }),
    makeRow({ text: "gamma bow", rowKey: "royal|Any|T5_ARTEFACT_2H_BOW_HELL" }),
  ];
  const input = mountTable("rolling-table", rows, { tierEnch: true });
  global.window = { applyRollingCollapsed: () => {} };
  input.tierSel.value = "5";
  applyTableSearchFilter("rolling-table");
  delete global.window;
  assert.deepStrictEqual(DISPLAYS(rows), ["none", ""]);
});

// A PICKER (tier, enchant, category, city) only narrows the table; it must not
// unfold groups the user minimized. Only a typed query shows matches through a
// fold. The fake applier folds the "T4 Relic" group the way applyRollingCollapsed
// does: it hides that group's data rows and leaves every other row alone.
//
// Layout (index → row):
//   0 cat header "Any"           3 roll header "T4 Soul"
//   1 roll header "T4 Relic"     4   gamma bow   (T5, Lymhurst sell)
//   2   alpha sword (T5, Lymhurst sell) — inside the folded group
//                                5   delta axe   (T4, Bridgewatch sell)
function foldedRollingRows() {
  return [
    makeRow({ attrs: ["data-header-cat"], text: "Any" }),
    makeRow({ attrs: ["data-header-roll"], text: "T4 Relic" }),
    makeRow({
      text: "alpha sword", rowKey: "royal|Any|T5_ARTEFACT_MAIN_SWORD_UNDEAD",
      dataAttrs: { "data-roll-key": "Any:T4 Relic" },
      cityCells: [{ city: "Lymhurst", side: "sell" }],
    }),
    makeRow({ attrs: ["data-header-roll"], text: "T4 Soul" }),
    makeRow({
      text: "gamma bow", rowKey: "royal|Any|T5_ARTEFACT_2H_BOW_HELL",
      dataAttrs: { "data-roll-key": "Any:T4 Soul" },
      cityCells: [{ city: "Lymhurst", side: "sell" }],
    }),
    makeRow({
      text: "delta axe", rowKey: "royal|Any|T4_ARTEFACT_2H_AXE_KEEPER",
      dataAttrs: { "data-roll-key": "Any:T4 Soul" },
      cityCells: [{ city: "Bridgewatch", side: "sell" }],
    }),
  ];
}
function foldRelicGroup(rows) {
  return () => {
    rows.forEach((r) => {
      if (r.getAttribute("data-roll-key") === "Any:T4 Relic") r.style.display = "none";
      else if (r.getAttribute("data-roll-key")) r.style.display = "";
    });
  };
}

[
  { name: "sell city", set: (i) => { i.sellCitySel.value = "Lymhurst"; },
    want: ["", "", "none", "", "", "none"] },
  { name: "tier", set: (i) => { i.tierSel.value = "5"; },
    want: ["", "", "none", "", "", "none"] },
  { name: "tier + sell city", set: (i) => { i.tierSel.value = "5"; i.sellCitySel.value = "Lymhurst"; },
    want: ["", "", "none", "", "", "none"] },
].forEach(({ name, set, want }) => {
  test(`rolling: a ${name} pick keeps folded groups folded`, () => {
    const rows = foldedRollingRows();
    const input = mountTable("rolling-table", rows, { tierEnch: true, pickers: true });
    global.window = { applyRollingCollapsed: foldRelicGroup(rows) };
    set(input);
    applyTableSearchFilter("rolling-table");
    delete global.window;
    assert.deepStrictEqual(DISPLAYS(rows), want);
  });
});

test("rolling: a picker fold survives a stale display left by an earlier pass", () => {
  const rows = foldedRollingRows();
  // A previous filter pass hid the roll header and the category header.
  rows[0].style.display = "none";
  rows[3].style.display = "none";
  const input = mountTable("rolling-table", rows, { tierEnch: true, pickers: true });
  global.window = { applyRollingCollapsed: foldRelicGroup(rows) };
  input.sellCitySel.value = "Lymhurst";
  applyTableSearchFilter("rolling-table");
  delete global.window;
  assert.deepStrictEqual(DISPLAYS(rows), ["", "", "none", "", "", "none"]);
});

test("rolling: a group with no picked row hides its header even when unfolded", () => {
  const rows = foldedRollingRows();
  const input = mountTable("rolling-table", rows, { tierEnch: true, pickers: true });
  global.window = { applyRollingCollapsed: foldRelicGroup(rows) };
  input.sellCitySel.value = "Bridgewatch";
  applyTableSearchFilter("rolling-table");
  delete global.window;
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none", "none", "", "none", ""]);
});

test("rolling: a typed query next to a picker still shows matches through a fold", () => {
  const rows = foldedRollingRows();
  const input = mountTable("rolling-table", rows, { tierEnch: true, pickers: true });
  global.window = { applyRollingCollapsed: foldRelicGroup(rows) };
  input.sellCitySel.value = "Lymhurst";
  input.value = "alpha";
  applyTableSearchFilter("rolling-table");
  delete global.window;
  assert.deepStrictEqual(DISPLAYS(rows), ["", "", "", "none", "none", "none"]);
});

// Rolling row keys lead with the section, not the item id ("royal|Any|T5_…"),
// so the tier/enchant pickers must find the id anywhere in the key.
test("parseRowTierEnchant: reads the id even when the key leads with a section", () => {
  const tr = makeRow({ text: "Hellish Sword", rowKey: "royal|Warrior|T6_ARTEFACT_MAIN_SWORD_HELL@2" });
  assert.deepStrictEqual(parseRowTierEnchant(tr), { tier: 6, ench: 2 });
});

// ── brecilien group-label rows behave like dividers ──────────────────────────
test("bf-group-row hides when its group has no surviving row", () => {
  const rows = [
    makeRow({ cls: ["bf-group-row"], text: "Resources" }),
    makeRow({ text: "T4 Planks" }),
    makeRow({ cls: ["bf-group-row"], text: "Special" }),
    makeRow({ text: "Toolbox" }),
  ];
  const input = mountTable("brecilien-fees-table", rows);
  input.value = "planks";
  applyTableSearchFilter("brecilien-fees-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "", "none", "none"]);
});

// ── breed-detail-row is never touched ────────────────────────────────────────
test("breed-detail-row keeps its collapsed display through an empty query", () => {
  const rows = [
    makeRow({ text: "Baby Swiftclaw" }),
    makeRow({ cls: ["breed-detail-row"], text: "detail grid", display: "none" }),
  ];
  const input = mountTable("faction-spending-table", rows);
  input.value = "";
  applyTableSearchFilter("faction-spending-table");
  // baby row shown; detail row LEFT as-is (still none) — not force-expanded
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
});

test("breed-detail-row keeps an open display and ignores the query", () => {
  const rows = [
    makeRow({ text: "Baby Swiftclaw" }),
    makeRow({
      cls: ["breed-detail-row"],
      text: "detail grid",
      display: "table-row",
    }),
  ];
  const input = mountTable("faction-spending-table", rows);
  input.value = "zzz"; // matches nothing; detail must still be untouched
  applyTableSearchFilter("faction-spending-table");
  assert.strictEqual(rows[0].style.display, "none"); // baby hidden by filter
  assert.strictEqual(rows[1].style.display, "table-row"); // detail untouched
});

// ── robustness ───────────────────────────────────────────────────────────────
test("table with no search input is a no-op", () => {
  const rows = [makeRow({ text: "Alpha", display: "" })];
  mountTable("volume-table", rows, { hasInput: false });
  assert.doesNotThrow(() => applyTableSearchFilter("volume-table"));
  assert.strictEqual(rows[0].style.display, ""); // untouched
});

test("missing tbody is a no-op (no throw)", () => {
  const input = { value: "x" };
  global.document = {
    getElementById: (id) => (id === "search-foo-table" ? input : null),
    querySelector: () => null, // no tbody
  };
  assert.doesNotThrow(() => applyTableSearchFilter("foo-table"));
});

// ── tier / enchant parsing (in-game-style pickers) ───────────────────────────
test("parseRowTierEnchant reads tier + enchant from the row-key item id", () => {
  const cases = [
    { rowKey: "T4_BAG|Martlock",            tier: 4, ench: 0 },
    { rowKey: "T6_2H_BOW@4|caerleon",       tier: 6, ench: 4 },
    { rowKey: "T5_PLANKS_LEVEL2@2|section", tier: 5, ench: 2 },
    { rowKey: "T8_FARM_HORSE_BABY|royal",   tier: 8, ench: 0 },
    { rowKey: "UNIQUE_UNLOCK_VANITY|",      tier: null, ench: 0 }, // no tier → null
  ];
  cases.forEach((c) => {
    assert.deepStrictEqual(
      parseRowTierEnchant(makeRow({ rowKey: c.rowKey })),
      { tier: c.tier, ench: c.ench },
      c.rowKey,
    );
  });
});

test("parseRowTierEnchant falls back to visible T4.2 text when key has no id", () => {
  // transmute-style key is a bare tier number; tier/enchant come from the cell.
  const r = makeRow({ rowKey: "4|transition|royal", text: "T4.2 → T5.2  Martlock" });
  assert.deepStrictEqual(parseRowTierEnchant(r), { tier: 4, ench: 2 });
});

test("data-filter-tier/-ench override the row-key and the visible text", () => {
  // Transmute rows: the key + first cell describe the BOUGHT start (T4.0), while
  // the pickers must match the FINAL product (T6.2) the renderer pins.
  const chain = makeRow({
    rowKey: "4|4 → 5 → 6 tier|royal",
    text: "T4 → T6.2  Martlock",
    dataAttrs: { "data-filter-tier": "6", "data-filter-ench": "2" },
  });
  assert.deepStrictEqual(parseRowTierEnchant(chain), { tier: 6, ench: 2 });
  assert.strictEqual(rowPassesTierEnch(chain, "6", ""), true);
  assert.strictEqual(rowPassesTierEnch(chain, "4", ""), false);
  assert.strictEqual(rowPassesTierEnch(chain, "6", "2"), true);
  assert.strictEqual(rowPassesTierEnch(chain, "6", "0"), false);
});

test("data-filter-tier without data-filter-ench means enchant 0", () => {
  const r = makeRow({
    rowKey: "4|4 → 5 tier|royal",
    text: "T4 → T5",
    dataAttrs: { "data-filter-tier": "5" },
  });
  assert.deepStrictEqual(parseRowTierEnchant(r), { tier: 5, ench: 0 });
  assert.strictEqual(rowPassesTierEnch(r, "", "0"), true);
});

test("rowPassesTierEnch: empty selects pass everything (no getAttribute needed)", () => {
  const bare = { textContent: "anything" }; // no getAttribute → must not throw
  assert.strictEqual(rowPassesTierEnch(bare, "", ""), true);
});

test("rowPassesTierEnch matches on tier, enchant, and both", () => {
  const bow = makeRow({ rowKey: "T6_2H_BOW@4|caerleon" }); // tier 6, ench 4
  assert.strictEqual(rowPassesTierEnch(bow, "6", ""), true);
  assert.strictEqual(rowPassesTierEnch(bow, "5", ""), false);
  assert.strictEqual(rowPassesTierEnch(bow, "", "4"), true);
  assert.strictEqual(rowPassesTierEnch(bow, "", "0"), false);
  assert.strictEqual(rowPassesTierEnch(bow, "6", "4"), true);
  assert.strictEqual(rowPassesTierEnch(bow, "6", "0"), false);
});

test("rowPassesTierEnch: enchant '0' selects only base (un-enchanted) rows", () => {
  const base = makeRow({ rowKey: "T4_BAG|Martlock" });   // ench 0
  const ench = makeRow({ rowKey: "T4_BAG_LEVEL1@1|x" });  // ench 1
  assert.strictEqual(rowPassesTierEnch(base, "", "0"), true);
  assert.strictEqual(rowPassesTierEnch(ench, "", "0"), false);
});

test("rows with an unknown tier are hidden when a tier is selected", () => {
  const skin = makeRow({ rowKey: "UNIQUE_UNLOCK_VANITY|" }); // tier null
  assert.strictEqual(rowPassesTierEnch(skin, "6", ""), false);
  assert.strictEqual(rowPassesTierEnch(skin, "", ""), true); // All → still shown
});

// ── tier/enchant folded into applyTableSearchFilter (integration) ────────────
test("tier dropdown hides rows of other tiers; text query still ANDs", () => {
  const rows = [
    makeRow({ text: "Adept's Bag", rowKey: "T4_BAG|Martlock" }),
    makeRow({ text: "Expert's Bag", rowKey: "T6_BAG|Martlock" }),
    makeRow({ text: "Expert's Cape", rowKey: "T6_CAPE|Martlock" }),
  ];
  const input = mountTable("crafting-table", rows, { tierEnch: true });
  input.tierSel.value = "6"; // only T6 rows survive
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "", ""]);

  input.value = "bag"; // AND the text box on top
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "", "none"]);
});

test("enchant dropdown filters by enchant level", () => {
  const rows = [
    makeRow({ text: "Bag", rowKey: "T4_BAG|c" }),          // .0
    makeRow({ text: "Bag", rowKey: "T4_BAG_LEVEL2@2|c" }), // .2
    makeRow({ text: "Bag", rowKey: "T5_BAG_LEVEL2@2|c" }), // .2
  ];
  const input = mountTable("flipping-table", rows, { tierEnch: true });
  input.enchSel.value = "2";
  applyTableSearchFilter("flipping-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "", ""]);
});

test("a section divider hides once the tier filter empties its group", () => {
  const rows = [
    makeRow({ text: "royal T4", rowKey: "T4_ORE|royal" }),
    makeRow({ cls: ["section-divider"], text: "Caerleon Routes" }),
    makeRow({ text: "caerleon T6", rowKey: "T6_ORE|caerleon" }),
  ];
  const input = mountTable("gathering-table", rows, { tierEnch: true });
  input.tierSel.value = "4"; // only the royal T4 row survives → divider hides
  applyTableSearchFilter("gathering-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none", "none"]);
});

// ── query matches the row's ids + catalog names, not just its rendered text ──
// The Enter-fetch matches `id + getItemDisplayName(id)` (matchedCatalogIds),
// but the filter used to match ONLY the rendered text. Where the two disagree
// the user got the worst outcome: Enter fetched the right items, then the filter
// hid every row. Real case — a journal row renders "Wood [Gathering]" while its
// item is named "T4 Wood Journal (Empty)", so "journal" matched 28 ids to fetch
// and displayed none of them. The row's own ids and their names must therefore
// count toward the match.

test("query matches an id in the row-key that the rendered text never shows", () => {
  const rows = [
    makeRow({ text: "Wood [Gathering] T4", rowKey: "T4_JOURNAL_WOOD_EMPTY|T4_JOURNAL_WOOD_FULL|royal" }),
    makeRow({ text: "Ore [Gathering] T4", rowKey: "T4_ORE|royal" }),
  ];
  const input = mountTable("journal-filling-table", rows);
  input.value = "journal";
  applyTableSearchFilter("journal-filling-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
});

test("query matches the catalog NAME of a row-key id absent from the text", () => {
  // getItemDisplayName resolves T4_JOURNAL_WOOD_EMPTY → "T4 Wood Journal (Empty)".
  globalThis.getItemDisplayName = (id) =>
    id === "T5_XYZ" ? "Grandmaster's Toolbox" : id;
  const rows = [
    makeRow({ text: "some opaque label", rowKey: "T5_XYZ|royal" }),
    makeRow({ text: "another label", rowKey: "T5_ABC|royal" }),
  ];
  const input = mountTable("crafting-table", rows);
  input.value = "toolbox";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
  delete globalThis.getItemDisplayName;
});

test("multi-term query may span the rendered text AND the row's ids", () => {
  const rows = [
    makeRow({ text: "Wood [Gathering] T4", rowKey: "T4_JOURNAL_WOOD_EMPTY|royal" }),
    makeRow({ text: "Hide [Gathering] T4", rowKey: "T4_JOURNAL_HIDE_EMPTY|royal" }),
  ];
  const input = mountTable("journal-filling-table", rows);
  input.value = "gathering journal wood"; // text + id + text
  applyTableSearchFilter("journal-filling-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
});

test("a row with no data-row-key still matches on its text alone", () => {
  const rows = [
    makeRow({ text: "Rune → Soul  T4  Martlock", rowKey: "4|Rune → Soul|royal" }),
    makeRow({ text: "Soul → Relic  T4  Martlock", rowKey: "4|Soul → Relic|royal" }),
  ];
  const input = mountTable("transmute-table", rows);
  input.value = "rune";
  applyTableSearchFilter("transmute-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
});

test("switching language re-resolves names (the id haystack is not stale-cached)", () => {
  // getItemDisplayName is language-dependent (utils.js reads getLang() and
  // prefers ITEM_NAMES_ES), so a per-row-key cache must not outlive a switch.
  let lang = "en";
  globalThis.getLang = () => lang;
  globalThis.getItemDisplayName = (id) =>
    id === "T5_RELIC" ? (lang === "es" ? "Reliquia de Experto" : "Expert's Relic") : id;

  const mk = () => [makeRow({ text: "opaque label", rowKey: "T5_RELIC|royal" })];

  let rows = mk();
  let input = mountTable("crafting-table", rows);
  input.value = "relic";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), [""], "EN name should match before the switch");

  lang = "es";
  rows = mk();
  input = mountTable("crafting-table", rows);
  input.value = "reliquia";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), [""], "ES name must match after the switch");

  delete globalThis.getLang;
  delete globalThis.getItemDisplayName;
});

test("id matching does not make unrelated rows match", () => {
  const rows = [
    makeRow({ text: "Wood [Gathering] T4", rowKey: "T4_JOURNAL_WOOD_EMPTY|royal" }),
    makeRow({ text: "Ore [Gathering] T4", rowKey: "T4_JOURNAL_ORE_EMPTY|royal" }),
  ];
  const input = mountTable("journal-filling-table", rows);
  input.value = "hide";
  applyTableSearchFilter("journal-filling-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"]);
});

// ── Category / Subcategory / City pickers ────────────────────────────────────
// These live in js/table-filters.js but are ANDed in here, alongside the text
// query and the tier/enchant picks. Loading the generated taxonomy as a global
// mirrors how the browser reaches it.
require("../js/data-item-categories.js");

test("category pick hides rows outside it, text query still ANDs", () => {
  const rows = [
    makeRow({ text: "4 Ore Thetford", rowKey: "T4_ORE|Thetford" }),
    makeRow({ text: "T4 Soldier's Armor Martlock", rowKey: "T4_ARMOR_PLATE_SET1|Martlock" }),
  ];
  const input = mountTable("crafting-table", rows, { pickers: true });
  input.catSel.value = "resources";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);

  input.value = "armor";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"], "text AND category, not OR");
});

test("subcategory narrows inside the picked category", () => {
  const rows = [
    makeRow({ text: "4 Ore", rowKey: "T4_ORE|Thetford" }),
    makeRow({ text: "4 Planks", rowKey: "T4_PLANKS|Lymhurst" }),
  ];
  const input = mountTable("transport-table", rows, { pickers: true });
  input.catSel.value = "refinedresources";
  input.subSel.value = "planks";
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", ""]);
});

// One route each: buy where the raw is cheap, sell where the bar is dear.
const routeRows = () => [
  makeRow({
    text: "4 Ore Thetford 120",
    rowKey: "T4_ORE|T4_METALBAR|Thetford|",
    cityCells: [{ city: "Thetford", side: "buy" }, { city: "Caerleon", side: "sell" }],
  }),
  makeRow({
    text: "4 Ore Martlock 140",
    rowKey: "T4_ORE|T4_METALBAR|Martlock|",
    cityCells: [{ city: "Martlock", side: "buy" }, { city: "Lymhurst", side: "sell" }],
  }),
];

test("buy city pick hides rows that buy elsewhere", () => {
  const rows = routeRows();
  const input = mountTable("transport-table", rows, { pickers: true });
  input.buyCitySel.value = "Martlock";
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", ""]);
});

test("sell city pick hides rows that sell elsewhere", () => {
  const rows = routeRows();
  const input = mountTable("transport-table", rows, { pickers: true });
  input.sellCitySel.value = "Caerleon";
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"]);
});

test("the two sides AND, they do not OR", () => {
  const rows = routeRows();
  const input = mountTable("transport-table", rows, { pickers: true });
  input.buyCitySel.value = "Thetford";
  input.sellCitySel.value = "Caerleon";
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", "none"], "the row matching both survives");

  // Two picks that are each satisfied by a DIFFERENT row match neither.
  input.sellCitySel.value = "Lymhurst";
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"]);
});

test("a sell city never matches on the buy side (the old combined pick did)", () => {
  const rows = routeRows();
  const input = mountTable("transport-table", rows, { pickers: true });
  input.buyCitySel.value = "Caerleon"; // it SELLS there, it does not buy there
  applyTableSearchFilter("transport-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"]);
});

test("a section divider disappears once a category pick empties its group", () => {
  const rows = [
    makeRow({ cls: ["section-divider"], text: "Royal Cities" }),
    makeRow({ text: "T4 Soldier's Armor", rowKey: "T4_ARMOR_PLATE_SET1|Martlock" }),
  ];
  const input = mountTable("crafting-table", rows, { pickers: true });
  input.catSel.value = "resources";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["none", "none"], "header must not linger over an empty group");
});

test("clearing every picker restores all rows", () => {
  const rows = [
    makeRow({ text: "4 Ore Thetford", rowKey: "T4_ORE|Thetford" }),
    makeRow({ text: "T4 Soldier's Armor Martlock", rowKey: "T4_ARMOR_PLATE_SET1|Martlock" }),
  ];
  const input = mountTable("crafting-table", rows, { pickers: true });
  input.catSel.value = "resources";
  applyTableSearchFilter("crafting-table");
  input.catSel.value = "";
  applyTableSearchFilter("crafting-table");
  assert.deepStrictEqual(DISPLAYS(rows), ["", ""]);
});

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
