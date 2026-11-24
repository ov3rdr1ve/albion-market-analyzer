/**
 * Integration (TLD) smoke test: renderCraftPlannerTable drives the REAL
 * craft-planner-pricing + refining-chain + data-craft-planner modules with a
 * synthetic two-item catalogue and a renderTableData capture, asserting the
 * row set and the key cells (combined profit, refine savings, journal tag,
 * best-focus-step label) render without throwing and resolve every global helper.
 *
 * Run: node --test tests/craft-planner-render-rows-laborer.test.cjs
 *
 * Row rendering, laborer journal column, Profit / 10k Focus, cell parity, refine focus, no-data rows. Shared setup: tests/helpers/craft-planner-render-setup.cjs.
 */
const {
  assert, readIndexHtml, renderCraftPlannerTable, captured, __setFocus, __setCraftSpec,
  getCraftJournalFill, _cpBestSell, test, formatSilverLocal, FS, market, finish,
} = require("./helpers/craft-planner-render-setup.cjs");

console.log("renderCraftPlannerTable smoke\n");

test("renders into craft-planner-table without formatter errors", () => {
  renderCraftPlannerTable(market);
  assert.strictEqual(captured.tableId, "craft-planner-table");
  assert.ok(captured.rows.length > 0, "expected rows");
  const html = captured.html.join("\n");
  assert.ok(!html.includes("ERR:"), "no formatter exceptions: " + html.slice(0, 300));
});

test("profit cell breaks the combined figure into craft + refine when self-refining is cheaper", () => {
  // Pricey plank bar (5000) + cheap raws → self-refining planks beats buying, so
  // refineSavings > 0 and the profit cell splits into pure-craft + refine.
  const selfRefine = {
    T8_PLANKS:   { [FS]: { buy_price: 5000, sell_price: 5200, volume_24h: 500 } },
    T8_WOOD:     { [FS]: { buy_price: 500 } },
    T7_PLANKS:   { [FS]: { buy_price: 500 } },
    T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
    T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 600000, volume_24h: 80 } },
    T8_ARMOR_PLATE_SET1:    { [FS]: { sell_price: 80000, volume_24h: 120 } },
  };
  renderCraftPlannerTable(selfRefine);
  const html = captured.html.join("\n");
  assert.ok(/= craft [\d,]+/.test(html), "expected a '= craft N' breakout under the profit cell");
  assert.ok(/\+ refine [\d,]+/.test(html), "expected a '+ refine N' component in the breakout");
});

test("furniture row shows the Tinker journal-fill tag", () => {
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  assert.ok(/Tinker T\d/.test(html), "expected a 'Tinker T8' journal tag");
});

test("plate armor row shows the Blacksmith journal-fill tag", () => {
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  assert.ok(/Blacksmith T\d/.test(html), "expected a 'Blacksmith T8' journal tag");
});

// ── Laborer Journal column (work the journal instead of selling it) ────────

// The Blacksmith / Tinker payout needs the refined mix priced, not just the
// craft's own bar.
const laborerMarket = {
  ...market,
  T8_CLOTH:   { [FS]: { buy_price: 900, sell_price: 1000, volume_24h: 500 } },
  T8_LEATHER: { [FS]: { buy_price: 950, sell_price: 1050, volume_24h: 500 } },
};

// One priced (row, html) pair whose laborer play exists, for the cell assertions.
function laborerCell() {
  renderCraftPlannerTable(laborerMarket);
  const i = captured.rows.findIndex((r) => !r.noData && r.laborerJournal
    && r.laborerJournal.bestJournal && r.laborerJournal.extraSilverPerCraft > 0);
  assert.ok(i >= 0, "fixture sanity: expected a row with a priced laborer journal");
  return { row: captured.rows[i], html: captured.html[i] };
}

test("laborer cell shows the profit under the worked-journal play + its added silver", () => {
  renderCraftPlannerTable(laborerMarket);
  const html = captured.html.join("\n");
  assert.ok(/title="Craft profit [^"]*laborer value/.test(html), "expected the laborer tooltip");
  assert.ok(/\+[\d,]+ \/craft · (Blacksmith|Tinker) T\d/.test(html),
    "expected a '+N /craft · Blacksmith T8' laborer tag");
});

test("laborerCombinedProfit = craft profit + laborer value, kept apart from the market play", () => {
  renderCraftPlannerTable(laborerMarket);
  const row = captured.rows.find((r) => !r.noData && r.laborerJournal && r.laborerJournal.bestJournal);
  assert.ok(row, "a row with a priced laborer journal");
  assert.ok(Math.abs(row.laborerCombinedProfit - (row.craftProfit + row.laborerJournal.extraSilverPerCraft)) < 0.01);
  assert.ok(Math.abs(row.combinedProfit - (row.craftProfit + row.journal.extraSilverPerCraft)) < 0.01,
    "the sell-the-journal headline must not absorb the laborer value");
});

// ── The laborer return, in the column rather than a row of its own ────────
// The worked-journal play has no row: it is this column, so the column carries
// the whole play — the profit under it, what it adds per craft, and the laborer's
// own unit (one journal's payout, its yield, and the crafts that fill it).

test("the laborer play adds no second row for the craft", () => {
  renderCraftPlannerTable(laborerMarket);
  const seen = new Map();
  captured.rows.forEach((r) => {
    const k = `${r.item.id}|${r.section}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  });
  [...seen.entries()].forEach(([k, n]) =>
    assert.strictEqual(n, 1, `${k} rendered ${n} rows — the laborer play is a column`));
});

test("the cell quotes the payout per journal, its yield and the crafts to fill it", () => {
  const { row, html } = laborerCell();
  const b = row.laborerJournal.bestJournal;
  const crafts = b.maxfame / row.laborerJournal.famePerCraft;
  assert.ok(html.includes(`${formatSilverLocal(b.payout)} / journal`),
    "expected the per-journal payout: " + html);
  assert.ok(new RegExp(`${b.yield.toFixed(2)}×`).test(html), "expected the yield: " + html);
  assert.ok(html.includes(`${crafts.toFixed(1)} crafts`),
    `expected ${crafts.toFixed(1)} crafts per journal: ${html}`);
});

test("the tooltip names the refined mix the laborer hands back", () => {
  const { row, html } = laborerCell();
  const priced = row.laborerJournal.bestJournal.lines.filter((l) => l.silver > 0);
  assert.ok(priced.length > 0, "fixture sanity: the mix is priced");
  const tips = html.match(/title="[^"]*"/g) || [];
  const tip = tips.find((t) => /Returns /.test(t));
  assert.ok(tip, "expected a 'Returns …' clause in a tooltip: " + html);
  priced.forEach((l) => assert.ok(tip.includes(l.itemId),
    `expected ${l.itemId} in the returned mix: ${tip}`));
});

test("the tooltip prices a focus bar spent on the laborer play, not the journal sale", () => {
  // focusCraftProfit + the laborer return. focusCombinedProfit would carry the
  // journal SALE, which this play never makes.
  const { row, html } = laborerCell();
  if (!(row.focusPerCraft > 0) || row.focusCraftProfit == null) return;
  const bar = (row.focusCraftProfit + row.laborerJournal.extraSilverPerCraft)
    * Math.floor(10000 / row.focusPerCraft);
  const tips = html.match(/title="[^"]*"/g) || [];
  const tip = tips.find((t) => /10,000-focus bar/.test(t));
  assert.ok(tip, "expected the focus-bar clause: " + html);
  assert.ok(tip.includes(formatSilverLocal(bar)),
    `expected ${formatSilverLocal(bar)} in: ${tip}`);
});

test("the 10k-focus column still quotes focusCombinedProfit — it prices the SALE play", () => {
  renderCraftPlannerTable(laborerMarket);
  const i = captured.rows.findIndex((r) => !r.noData
    && r.profitPer10kFocus != null && r.focusCombinedProfit != null);
  assert.ok(i >= 0, "expected a priced row with a 10k figure");
  const m = captured.html[i].match(/title="([\d,-]+) profit\/craft/);
  assert.ok(m, captured.html[i]);
  assert.strictEqual(m[1], formatSilverLocal(captured.rows[i].focusCombinedProfit));
});

// ── Profit / 10k Focus column ─────────────────────────────────────────────

test("profit / 10k focus cell renders the bar total with a crafts tooltip", () => {
  renderCraftPlannerTable(market);
  const idx = captured.rows.findIndex((r) => !r.noData && r.profitPer10kFocus != null);
  assert.ok(idx >= 0, "expected a row with a 10k-focus figure");
  const row = captured.rows[idx];
  const html = captured.html[idx];
  assert.ok(new RegExp(`title="[^"]*× ${row.craftsPer10kFocus.toLocaleString()} crafts`).test(html),
    "expected the crafts-per-bar tooltip: " + html);
  assert.ok(html.includes(`>${formatSilverLocal(row.profitPer10kFocus)}<`),
    "expected the 10k-focus total rendered: " + html);
});

test("a row that can take no focus renders a dash, not a zero", () => {
  // Craft focus 0 + a market-only material (no ladder) → no focus play at all.
  const noFocus = {
    T8_PLANKS:   { [FS]: { buy_price: 1000, sell_price: 1100, volume_24h: 500 } },
    T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
    T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 60000, volume_24h: 80 } },
    T8_ARMOR_PLATE_SET1:    { [FS]: { sell_price: 80000, volume_24h: 120 } },
  };
  renderCraftPlannerTable(noFocus);
  const idx = captured.rows.findIndex((r) => !r.noData && r.profitPer10kFocus == null);
  if (idx >= 0) assert.ok(/—/.test(captured.html[idx]), "expected an em dash for a focus-less row");
});

test("the rendered row has exactly as many cells as the table has headers", () => {
  const htmlSrc = readIndexHtml();
  const table = htmlSrc.split('<table id="craft-planner-table"')[1] || "";
  const thead = table.split("</thead>")[0] || "";
  const headers = (thead.match(/<th\b/g) || []).length;
  assert.ok(headers > 0, "expected planner headers in index.html");
  renderCraftPlannerTable(market);
  const cells = (captured.html[0].match(/<td\b/g) || []).length;
  assert.strictEqual(cells, headers, `row has ${cells} cells for ${headers} headers`);
});

test("every row emits the same cell count, no-data placeholders included", () => {
  renderCraftPlannerTable(laborerMarket);
  const counts = new Set(captured.html.map((h) => (h.match(/<td\b/g) || []).length));
  assert.strictEqual(counts.size, 1, `ragged rows: ${[...counts].join("/")}`);
});

// Regression: craft-planner-pricing.js and render-craft-planner.js both live in
// the browser's single global scope. They used to BOTH define `_cpBestSell` with
// different signatures — render's (item, city, md) loaded last and clobbered
// pricing's (id, md, city), so getCraftJournalFill got item-shaped garbage back,
// every candidate failed the `full.price <= 0` gate, and ALL journals rendered
// "no data". This test loads both files into one scope (like the browser) and
// asserts the global `_cpBestSell` is pricing's id-based helper and that the
// journal fill actually resolves to a positive value.
test("global _cpBestSell is the pricing (id, md, city) helper, not render's item helper", () => {
  // pricing's takes (id, marketData, craftCity) → passing an id string must read
  // marketData[id]; render's would do id.id and blow up / return the fallback.
  const best = _cpBestSell("T8_JOURNAL_WARRIOR_FULL", market, FS);
  assert.strictEqual(best.price, 18000, "expected the WARRIOR-full sell price via the id-based helper");
});

test("journal fill resolves to positive silver in the combined (browser-like) scope", () => {
  const item = { id: "T8_ARMOR_PLATE_SET1", craftType: "plate_armor" };
  const jf = getCraftJournalFill(item, [{ matId: "T8_METALBAR", count: 16 }], FS, market, 16);
  assert.ok(jf && jf.bestJournal, "bestJournal must resolve (null = the _cpBestSell collision regressed)");
  assert.ok(jf.extraSilverPerCraft > 0, "journal fill must be positive, got " + (jf && jf.extraSilverPerCraft));
});

test("journal cell renders the fill value, not the 'no data' fallback", () => {
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  // The value branch emits a `title="Fills the ... journal"` tooltip; the fallback
  // branch emits the em-dash + "no data" journal prices. Require the former.
  assert.ok(/title="Fills the [^"]*journal/.test(html), "expected a resolved journal-fill value cell");
});

test("filled-journal price is click-to-edit (sell-side price-editable span)", () => {
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  // The full (filled) Toolmaker journal sell price must be an editable cell.
  assert.ok(/class="price-editable"[^>]*data-item-id="T8_JOURNAL_TOOLMAKER_FULL"[^>]*data-city-list="sell"/.test(html)
    || /data-item-id="T8_JOURNAL_TOOLMAKER_FULL"[^>]*data-city-list="sell"[^>]*class="price-editable"/.test(html),
    "expected an editable sell-side span for the full Toolmaker journal");
});

test("best-focus-step label renders (Refine… or Craft)", () => {
  renderCraftPlannerTable(market);
  const html = captured.html.join("\n");
  assert.ok(/(Refine T\d|>Craft<)/.test(html), "expected a focus-step label");
});

test("refine-wins row: Best Focus = Refine the mat + it's self-refined with a focus marker", () => {
  // Pricey plank bar + cheap raws → self-refining planks is cheaper than buying.
  // With full craft spec the craft's own focus gain is small (focus adds a fixed
  // +59 to an already-high bonus), so in the cities with no wood refine spec the
  // ladder is the placement that leaves the finished item most profitable.
  __setCraftSpec(0.40);
  const refineWins = {
    T8_PLANKS:   { [FS]: { buy_price: 5000, sell_price: 5200, volume_24h: 500 } },
    T8_WOOD:     { [FS]: { buy_price: 500 } },
    T7_PLANKS:   { [FS]: { buy_price: 500 } },
    T8_METALBAR: { [FS]: { buy_price: 1200, sell_price: 1300, volume_24h: 500 } },
    T8_FURNITUREITEM_TABLE: { [FS]: { sell_price: 600000, volume_24h: 80 } },
    T8_ARMOR_PLATE_SET1:    { [FS]: { sell_price: 80000, volume_24h: 120 } },
    T8_JOURNAL_TOOLMAKER_EMPTY: { [FS]: { buy_price: 5000 } },
    T8_JOURNAL_TOOLMAKER_FULL:  { [FS]: { sell_price: 20000, volume_24h: 30 } },
    T8_JOURNAL_WARRIOR_EMPTY:   { [FS]: { buy_price: 4000 } },
    T8_JOURNAL_WARRIOR_FULL:    { [FS]: { sell_price: 18000, volume_24h: 30 } },
  };
  __setFocus(true);
  renderCraftPlannerTable(refineWins);
  __setFocus(false);
  __setCraftSpec(0);
  const html = captured.html.join("\n");
  assert.ok(/Refine T8_PLANKS/.test(html),
    "expected the Best Focus cell to say Refine the material (use it in the craft)");
  assert.ok(/focus ⚡/.test(html),
    "expected the self-refined plank line to carry a 'focus ⚡' marker");
  assert.ok(!/sell instead/.test(html) && !/&amp; sell/.test(html) && !/not used here/.test(html),
    "no legacy 'sell instead' / 'refine & sell' / 'not used here' wording");
});

test("unpriced item yields a no-data placeholder row", () => {
  renderCraftPlannerTable(market);
  const noData = captured.rows.filter((r) => r.noData);
  assert.ok(noData.length > 0, "expected at least one no-data row (Holy Staff)");
});

// Regression: a no-data row must still expose editable price cells so the user
// can FILL the missing prices that are blanking the row (previously every value
// cell was a dead "—" dash, leaving nothing to click).
test("no-data row exposes editable sell cell + material price spans", () => {
  renderCraftPlannerTable(market);
  const idx = captured.rows.findIndex((r) => r.noData && r.item.id === "T8_2H_HOLYSTAFF");
  assert.ok(idx >= 0, "expected the Holy Staff no-data row");
  const html = captured.html[idx];
  // Sell cell is an editable price-editable td keyed to the item itself.
  assert.ok(/class="silver-val price-editable"[^>]*data-item-id="T8_2H_HOLYSTAFF"/.test(html),
    "expected an editable sell cell for the no-data item: " + html);
  // Material price is still a clickable span (sourced @-price), not plain text.
  assert.ok(/data-item-id=['"]T8_PLANKS['"]/.test(html),
    "expected an editable material price span in the no-data row: " + html);
});

finish();
