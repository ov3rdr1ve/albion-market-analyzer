/**
 * Integration (TLD) smoke test: renderCraftPlannerTable drives the REAL
 * craft-planner-pricing + refining-chain + data-craft-planner modules with a
 * synthetic two-item catalogue and a renderTableData capture, asserting the
 * row set and the key cells (combined profit, refine savings, journal tag,
 * best-focus-step label) render without throwing and resolve every global helper.
 *
 * Run: node --test tests/craft-planner-render-no-sell-enchant.test.cjs
 *
 * No-sell rows and quality hints, quality-fallback sell cells, jump targets, best-focus cell. Shared setup: tests/helpers/craft-planner-render-setup.cjs.
 */
const {
  assert, renderCraftPlannerTable, captured, _cpFocusCell, _cpMatLine, _cpJumpToRefine,
  __setQualityMap, test, formatSilverLocal, FS, market, finish,
} = require("./helpers/craft-planner-render-setup.cjs");

// ── No-data rows WITH a computable cost (all materials priced, no sell market) ─
// A row whose every material is priced but that has no reachable sell quote
// anywhere is still no-data (no honest sale) — yet its input cost is fully
// computable, so the Cost cell must show that number instead of the em dash.
// A missing-material no-data row keeps the dash: an incomplete sum must not.
const noSellMarket = {
  T8_PLANKS:   { [FS]: { buy_price: 1000, sell_price: 1100, volume_24h: 500 } },
  T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
  T8_ARMOR_PLATE_SET1: { [FS]: { sell_price: 80000, volume_24h: 120 } },
  // T8_FURNITUREITEM_TABLE / T8_2H_HOLYSTAFF carry NO sell price anywhere, so
  // their material-priced candidates dead-end on the sell side (noDataNoSell).
};

// The Cost cell sits between the Materials cell and the Sell cell in every row
// template; slice it out so dash/cost assertions cannot hit the row's OTHER
// dashed cells (profit, journal, laborer, 10k, focus).
function costCellOf(html) {
  const start = html.indexOf('class="cell-mats"');
  const end = html.indexOf('data-city-list="sell"', start);
  assert.ok(start >= 0 && end > start, "row markup missing its cells: " + html.slice(0, 300));
  return html.slice(start, end);
}

test("all-priced no-sell row renders its computable cost, not a dash", () => {
  renderCraftPlannerTable(noSellMarket);
  const idx = captured.rows.findIndex((r) => r.noData && r.noDataNoSell
    && r.item.id === "T8_FURNITUREITEM_TABLE");
  assert.ok(idx >= 0, "expected the no-sell placeholder row for the table");
  const row = captured.rows[idx];
  assert.deepStrictEqual(row.noDataMats, [], "fixture sanity: the materials are all priced");
  assert.ok(typeof row.refineCraftCost === "number" && row.refineCraftCost > 0,
    "precondition: pricing carries the computable cost, got " + row.refineCraftCost);
  const cell = costCellOf(captured.html[idx]);
  assert.ok(cell.includes(">" + formatSilverLocal(row.refineCraftCost) + "<"),
    `expected the Cost cell to show ${formatSilverLocal(row.refineCraftCost)}: ${cell}`);
  assert.ok(!cell.includes("—"), "the Cost cell must not be the em dash: " + cell);
});

test("missing-material no-data row keeps the cost dash", () => {
  renderCraftPlannerTable(noSellMarket);
  // The table's Caerleon twin cannot buy the Fort-Sterling-only plank — the
  // OTHER no-data kind. It must stay visually distinct from the cost-carrying
  // one: dash, because its material sum is incomplete.
  const idx = captured.rows.findIndex((r) => r.noData && r.item.id === "T8_FURNITUREITEM_TABLE"
    && r.craftCity === "Caerleon" && r.noDataNoSell === false);
  assert.ok(idx >= 0, "expected the missing-mat placeholder row (the Caerleon twin)");
  assert.strictEqual(captured.rows[idx].refineCraftCost, undefined,
    "no cost may be carried, let alone rendered");
  const cell = costCellOf(captured.html[idx]);
  assert.ok(cell.includes("—"), "expected the em dash in the Cost cell: " + cell);
});

test("cost-carrying no-data rows keep the table's cell-count parity", () => {
  renderCraftPlannerTable(noSellMarket);
  const counts = new Set(captured.html.map((h) => (h.match(/<td\b/g) || []).length));
  assert.strictEqual(counts.size, 1, `ragged rows: ${[...counts].join("/")}`);
});

// ── The no-sell hint: quality references under the empty Sell cell ──────────
// A noDataNoSell row whose quality book (renderer global lastQualityMarketData,
// map[itemId][quality][city]) holds a q1 buy order and Good+ asks carries
// noSellRefs; the Sell cell explains WHY it is empty with a note passed through
// priceTd's existing note channel — the same slot the dropped-pin note
// (_cpSellPinNote) renders into (plan.md). Pricing semantics unchanged: the row
// is still no-data, sell stays quality 1.

// The no-data hint case AFTER the sell-fallback round: any ask at any quality in
// a searched city would PRICE the row (see the fallback fixtures below), so a
// book that still leaves a row noDataNoSell holds only a Normal BUY order —
// Lymhurst's 1,070,000 — and no asks at all.
const REFS_QUALITY_MAP = {
  T8_FURNITUREITEM_TABLE: {
    1: { Lymhurst: { buy_price: 1070000, sell_price: 0 } },
  },
};

// The rendered sell cell of a row: from the editable sell priceTd's key to the
// close of that td — exactly where the note channel renders. In a no-data row
// this priceTd is the only data-city-list="sell" (the Route cell's legs carry
// no itemId), so the anchor is unambiguous.
function sellCellOf(html) {
  const start = html.indexOf('data-city-list="sell"');
  const end = html.indexOf("</td>", start);
  assert.ok(start >= 0 && end > start, "row markup missing its sell cell: " + html.slice(0, 300));
  return html.slice(start, end);
}

function noSellRowHtml() {
  const idx = captured.rows.findIndex((r) => r.noData && r.noDataNoSell
    && r.item.id === "T8_FURNITUREITEM_TABLE");
  assert.ok(idx >= 0, "expected the no-sell placeholder row for the table");
  return captured.html[idx];
}

test("no-sell row with references renders the quality hint in the sell cell", () => {
  __setQualityMap(REFS_QUALITY_MAP);
  try {
    renderCraftPlannerTable(noSellMarket);
    const cell = sellCellOf(noSellRowHtml());
    assert.ok(cell.includes("no Normal asks"), "expected the hint text: " + cell);
    assert.ok(cell.includes(formatSilverLocal(1070000)),
      "expected the formatted q1 buy order: " + cell);
    // Buy-only book: the hint names no ask, and a sell-quality label is a
    // PRICED-row feature (covered by the fallback tests below).
    assert.ok(!cell.includes("ask</small>"), "no ask clause without an ask: " + cell);
  } finally { __setQualityMap({}); }
});

test("no-sell row without references renders the sell cell exactly as today", () => {
  __setQualityMap({});
  renderCraftPlannerTable(noSellMarket);
  const cell = sellCellOf(noSellRowHtml());
  assert.ok(cell.includes("no data — click to set"), "current placeholder text: " + cell);
  assert.ok(!cell.includes("no Normal asks"), "no hint without references: " + cell);
});

test("the hint row keeps the table's cell-count parity", () => {
  __setQualityMap(REFS_QUALITY_MAP);
  try {
    renderCraftPlannerTable(noSellMarket);
    const counts = new Set(captured.html.map((h) => (h.match(/<td\b/g) || []).length));
    assert.strictEqual(counts.size, 1, `ragged rows: ${[...counts].join("/")}`);
  } finally { __setQualityMap({}); }
});

// ── Quality-fallback priced rows: the sell cell names the quality it sells ──
// When the row's sell price came from a Good+ ask (the pricing fallback,
// plan.md — row.sellQuality set), the priced sell cell shows a small label
// through the same priceTd note slot the pin note uses: "Outstanding ask" etc.
// A Normal-ask row (sellQuality null/absent) renders exactly today's cell.

// The priced sell cell of a row: the only `silver-val price-editable` td in the
// row template (the Route cell's sell leg is a `price-editable route-city`
// span; journal price spans lack silver-val), so the anchor is unambiguous —
// unlike the no-data helper above it also skips the Route leg on a priced row.
function pricedSellCellOf(html) {
  const start = html.indexOf('class="silver-val price-editable"');
  const end = html.indexOf("</td>", start);
  assert.ok(start >= 0 && end > start, "row markup missing its sell price td: " + html.slice(0, 300));
  return html.slice(start, end);
}

// Materials priced, the product with NO Normal ask anywhere, an Outstanding ask
// in Lymhurst via the quality book → once the fallback lands, the row prices at
// 6,498,970 with sellQuality 3 (and until then it stays the no-sell placeholder).
const FALLBACK_MARKET = {
  T8_PLANKS: { [FS]: { buy_price: 1000, volume_24h: 500 } },
  T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
};
const FALLBACK_QUALITY_MAP = {
  T8_FURNITUREITEM_TABLE: {
    3: { Lymhurst: { buy_price: 0, sell_price: 6498970 } },
  },
};
const QUALITY_ASK_LABELS = ["Good ask", "Good+ ask", "Outstanding ask", "Excellent ask", "Masterpiece ask"];

test("a quality-fallback priced row labels its sell cell with the quality ask", () => {
  __setQualityMap(FALLBACK_QUALITY_MAP);
  try {
    renderCraftPlannerTable(FALLBACK_MARKET);
    const i = captured.rows.findIndex((r) => !r.noData
      && r.item.id === "T8_FURNITUREITEM_TABLE" && r.sellQuality === 3);
    assert.ok(i >= 0, "expected the table row PRICED via its Outstanding ask (sellQuality 3)");
    const cell = pricedSellCellOf(captured.html[i]);
    assert.ok(cell.includes(String(captured.rows[i].sellPrice)),
      "expected the fallback ask price in the cell: " + cell);
    assert.ok(cell.includes("Outstanding ask"), "expected the quality label: " + cell);
    // The label rides the existing note slot, so the row keeps its cell parity.
    const counts = new Set(captured.html.map((h) => (h.match(/<td\b/g) || []).length));
    assert.strictEqual(counts.size, 1, `ragged rows: ${[...counts].join("/")}`);
  } finally { __setQualityMap({}); }
});

test("a Normal-ask priced row shows no quality label — the cell is today's shape", () => {
  renderCraftPlannerTable(market);
  const i = captured.rows.findIndex((r) => !r.noData && r.item.id === "T8_FURNITUREITEM_TABLE");
  assert.ok(i >= 0, "expected the priced table row");
  const row = captured.rows[i];
  assert.ok(!row.sellQuality, "fixture sanity: a Normal ask carries no quality");
  const cell = pricedSellCellOf(captured.html[i]);
  assert.ok(cell.includes(">" + row.sellPrice), "the sell price is rendered: " + cell);
  QUALITY_ASK_LABELS.forEach((label) =>
    assert.ok(!cell.includes(label), `no quality label on a Normal-ask row, found "${label}": ${cell}`));
});

test("rows are deduped to best per (item, section)", () => {
  renderCraftPlannerTable(market);
  // After enchant expansion each (item.id, section) pair collapses to one row.
  // Assert uniqueness, not a fixed count.
  const keys = new Set(captured.rows.map((r) => `${r.item.id}|${r.section}`));
  assert.strictEqual(keys.size, captured.rows.length, "no duplicate (item, section) rows");
});

// The Best Focus cell renders a single winning play (craft OR refine-a-material),
// decided in computeCraftPlannerRow — there is no separate "better elsewhere" note.
test("refine focus cell renders its label and no legacy note", () => {
  const refineStep = { kind: "refine", matId: "T8_CLOTH", resourceType: "fiber", tier: 8, focusCost: 24, silverPerFocus: 340 };
  let html;
  assert.doesNotThrow(() => { html = _cpFocusCell(refineStep); });
  assert.ok(!/↗ better/.test(html) && !/&amp; sell/.test(html), "no legacy note / 'refine & sell' wording");
  assert.ok(/Refine T8_CLOTH/.test(html), "renders the refine-a-material label");
});

// The winning tier is often below the material's own tier, so the cell must name
// the refine that is actually run (and jump to it), with the ladder as context.
test("refine focus cell names the step's own tier, not the ladder top", () => {
  const html = _cpFocusCell({
    kind: "refine", matId: "T6_STONEBLOCK", focusItemId: "T5_STONEBLOCK",
    resourceType: "rock", tier: 5, focusCost: 24, silverPerFocus: 27.6, usedInCraft: false,
  });
  assert.ok(/Refine T5_STONEBLOCK/.test(html), "names the T5 refine: " + html);
  assert.ok(/T6_STONEBLOCK ladder/.test(html), "shows which ladder it belongs to: " + html);
  assert.ok(/data-refined-id="T5_STONEBLOCK"/.test(html), "jumps to the T5 refining row");
});

test("refine focus cell omits the ladder note when the step IS the material", () => {
  const html = _cpFocusCell({
    kind: "refine", matId: "T8_PLANKS", focusItemId: "T8_PLANKS",
    resourceType: "wood", tier: 8, focusCost: 24, silverPerFocus: 340, usedInCraft: true,
  });
  assert.ok(/Refine T8_PLANKS/.test(html));
  assert.ok(!/\(in the .*ladder\)/.test(html), "no ladder note for a single-tier play: " + html);
});

test("material line self-refined WITH focus carries a focus marker", () => {
  const withFocus = _cpMatLine(
    { matId: "T8_PLANKS", count: 30, sourcing: { source: "chain", perUnit: 800, chain: { resourceType: "wood" }, focusTier: 8 } },
    "Fort Sterling",
  );
  assert.ok(/focus ⚡/.test(withFocus), "expected a 'focus ⚡' marker on the focused refine: " + withFocus);
  const noFocus = _cpMatLine(
    { matId: "T8_PLANKS", count: 30, sourcing: { source: "chain", perUnit: 900, chain: { resourceType: "wood" } } },
    "Fort Sterling",
  );
  assert.ok(!/focus ⚡/.test(noFocus), "no marker when focus isn't spent on this refine");
});

// ── Jump-to-refining click targets ─────────────────────────────────────────
// A refine-sourced material line must be a clickable jump target carrying the
// refined-material id, so clicking it can scroll the Refining / Transports table
// to that row. A bought-bar line must NOT be a jump target (nothing to refine).
test("refine-sourced material line is a cp-refine-jump target for its matId", () => {
  const refined = _cpMatLine(
    { matId: "T8_PLANKS", count: 30, sourcing: { source: "chain", perUnit: 900, chain: { resourceType: "wood" } } },
    "Fort Sterling",
  );
  assert.ok(/class="cp-refine-jump"[^>]*data-refined-id="T8_PLANKS"/.test(refined),
    "expected a cp-refine-jump span keyed to T8_PLANKS: " + refined);
});

test("bought-bar material line is NOT a jump target", () => {
  const bought = _cpMatLine(
    { matId: "T8_PLANKS", count: 30, sourcing: { source: "market", perUnit: 900, city: "Fort Sterling" } },
    "Fort Sterling",
  );
  assert.ok(!/cp-refine-jump/.test(bought), "a market-bought bar has no refine row to jump to: " + bought);
});

test("_cpJumpToRefine wraps content with the refined id", () => {
  const html = _cpJumpToRefine("T8_CLOTH", "hi");
  assert.ok(/class="cp-refine-jump"/.test(html) && /data-refined-id="T8_CLOTH"/.test(html) && html.includes("hi"));
});

test("best-focus refine step is a clickable jump target", () => {
  const step = { kind: "refine", matId: "T8_CLOTH", resourceType: "fiber", tier: 8, focusCost: 24, silverPerFocus: 340 };
  const html = _cpFocusCell(step);
  assert.ok(/class="cp-refine-jump"[^>]*data-refined-id="T8_CLOTH"/.test(html),
    "expected the Refine label to be a jump target: " + html);
});

test("best-focus craft step is NOT a jump target", () => {
  const step = { kind: "craft", tier: 8, focusCost: 9848, silverPerFocus: 37 };
  const html = _cpFocusCell(step);
  assert.ok(/>Craft</.test(html) && !/cp-refine-jump/.test(html),
    "a craft step has no refine row to jump to: " + html);
});

test("best-focus cell leads with what the play ADDS per craft", () => {
  // The winner is chosen on profit added, so that figure is the headline; the
  // silver/focus stays after it because focus is still the scarce input.
  const step = { kind: "craft", tier: 8, focusCost: 9848, silverPerFocus: 37, profitDelta: 12345 };
  const html = _cpFocusCell(step);
  assert.ok(/\+12,345/.test(html), "expected the +profit/craft delta: " + html);
  assert.ok(/37\.0/.test(html), "expected the silver/focus figure too: " + html);
  // A play that adds nothing prints no delta rather than "+0".
  assert.ok(!/\+/.test(_cpFocusCell({ kind: "craft", tier: 8, focusCost: 100, silverPerFocus: 1, profitDelta: 0 })));
});

// Every candidate this table enumerates feeds ONE craft, so a play's delta is
// per craft — including a refine play, whose own focusCost is a single refine of
// a single unit. The cell must therefore quote the row's per-craft focus total
// (the same divisor Profit / 10k Focus uses), not the step's charge, or the
// /focus rate reads inflated by the refines-per-craft factor.
test("best-focus cell labels a refine play PER CRAFT, never per refine", () => {
  const step = { kind: "refine", matId: "T8_CLOTH", focusItemId: "T8_CLOTH",
    tier: 8, focusCost: 24, silverPerFocus: 340, profitDelta: 8160 };
  const html = _cpFocusCell(step, 816);
  assert.ok(/\/craft/.test(html), "a planner refine play's saving is per craft: " + html);
  assert.ok(!/\/refine/.test(html), "per-refine unit would misread the delta: " + html);
});

test("best-focus rate is the delta over the focus ONE CRAFT burns", () => {
  // 34 refines of 24 focus each = 816 focus per craft. 8,160 / 816 = 10.0.
  // Dividing by the single refine's 24 would have printed 340.0.
  const step = { kind: "refine", matId: "T8_CLOTH", focusItemId: "T8_CLOTH",
    tier: 8, focusCost: 24, silverPerFocus: 340, profitDelta: 8160 };
  const html = _cpFocusCell(step, 816);
  assert.ok(/>10\.0</.test(html), "expected the per-craft rate: " + html);
  assert.ok(!/>340\.0</.test(html), "single-refine rate must be gone: " + html);
  assert.ok(/816/.test(html), "the tooltip should quote the per-craft focus: " + html);
});

test("a craft play is unaffected — its focusCost already IS per craft", () => {
  const step = { kind: "craft", tier: 8, focusCost: 370, silverPerFocus: 20, profitDelta: 7400 };
  assert.strictEqual(_cpFocusCell(step, 370), _cpFocusCell(step));
});

test("no focus cell ever claims a refine is sold rather than used", () => {
  // Refining a material to SELL is a different business and is no longer a
  // candidate, so the contradictory "(sell, not used here)" note is gone.
  const refine = _cpFocusCell({ kind: "refine", matId: "T8_CLOTH", focusItemId: "T8_CLOTH",
    tier: 8, focusCost: 24, silverPerFocus: 340, profitDelta: 900 });
  assert.ok(!/not used here/.test(refine), refine);
});

finish();
