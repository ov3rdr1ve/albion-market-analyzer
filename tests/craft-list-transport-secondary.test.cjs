/**
 * My Crafting List — the transport table's SECONDARY material leg (the
 * "transport-table" extractor) plus the merge rules of the
 * js/craft-list-materials.js aggregator.
 *
 * The transport table stores the secondary's real price and city on
 * r.secondaryMat = { id, count, price, city } (js/render-transport.js); on a
 * chain-sourced leg the renderer stores the RESOLVED chain cost there with a
 * null city. The extractor must read THAT. Reading r.secondaryChain instead —
 * a ChainNode (js/refining-chain-pricing.js: produces, output, station,
 * refineCity, rrr, focusCost, tier, resourceType, inputs, costPerOutput,
 * feePerOutput; no perUnit, no city) — priced every transport secondary leg
 * at 0, and the Materials to Buy board went red "no data" for T3/T5 leather.
 *
 * Black-box, the way production runs: extractCraftListRow("transport-table",
 * row) → aggregateCraftListMaterials.
 *
 * Run: node tests/craft-list-transport-secondary.test.cjs
 */
const assert = require("assert");
const path = require("path");

const {
  extractCraftListRow,
  aggregateCraftListMaterials,
} = require(path.join(__dirname, "..", "js", "craft-list-materials.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── realistic row + chain shapes ────────────────────────────────────────────

/**
 * A ChainNode, field for field as buildRefiningChain returns it
 * (js/refining-chain-pricing.js) — note there is NO perUnit and NO city on it.
 */
function chainNode(matId, tier, costPerOutput, inputs) {
  return {
    produces: matId,
    output: 1,
    station: "Refine hide at Martlock",
    refineCity: "Martlock",
    rrr: 0.367,
    focusCost: 24,
    tier,
    resourceType: "hide",
    inputs: inputs || [
      { matId: "T3_HIDE", count: 1,
        sourcing: { perUnit: 118, source: "market", city: "Martlock", travelFeePerUnit: 2 } },
    ],
    costPerOutput,
    feePerOutput: Math.round(costPerOutput * 0.02),
  };
}

/**
 * A T4-leather transport row exactly as js/render-transport.js emits it; its
 * secondary leg shops T3_LEATHER — the reported "no data" row.
 */
function transportRow(over) {
  return {
    route: {
      rawId: "T4_HIDE", refinedId: "T4_LEATHER", rawRatio: 1,
      resourceType: "hide",
      secondaryMatId: "T3_LEATHER", secondaryMatCount: 1,
    },
    buyRaw: { city: "Martlock", price: 210 },
    refineCity: "Caerleon",
    sellRefined: { city: "Caerleon", price: 690 },
    secondaryMat: { id: "T3_LEATHER", count: 1, price: 255, city: "Martlock" },
    secondaryChain: null,
    totalRawCost: 465,
    rrr: 0.238,
    marginInfo: { profit: 90, margin: 12 },
    ...over,
  };
}

const entryOf = (row, qty) => ({ ...extractCraftListRow("transport-table", row), qty: qty || 1 });
const secLine = (agg) => agg.lines.find((l) => l.matId === "T3_LEATHER");
const secMat = (got) => got.materials.find((m) => m.matId === "T3_LEATHER");

// ── 1. market-sourced secondary ─────────────────────────────────────────────

test("market-sourced secondary leg keeps secondaryMat's price and city", () => {
  const sec = secMat(extractCraftListRow("transport-table", transportRow()));
  assert.ok(sec, "the secondary leg is on the normalized row");
  assert.strictEqual(sec.perUnit, 255);
  assert.strictEqual(sec.city, "Martlock");
  assert.strictEqual(sec.note, "", "a market leg is a plain buy, not self-made");
});

test("market-sourced secondary survives aggregation at its real price (not 'no data')", () => {
  const line = secLine(aggregateCraftListMaterials([entryOf(transportRow())]));
  assert.ok(line, "T3_LEATHER is on the board");
  assert.strictEqual(line.perUnit, 255);
  assert.strictEqual(line.city, "Martlock");
  assert.strictEqual(line.total, 255);
});

// ── 2. chain-sourced secondary ──────────────────────────────────────────────

test("chain-sourced secondary takes secondaryMat.price, falls back to refineCity, marks 'refine'", () => {
  // The renderer stores the resolved chain cost on secondaryMat.price and a
  // null city when the leg is chain-sourced (js/render-transport.js).
  const row = transportRow({
    secondaryChain: chainNode("T3_LEATHER", 3, 240),
    secondaryMat: { id: "T3_LEATHER", count: 1, price: 240, city: null },
  });
  const sec = secMat(extractCraftListRow("transport-table", row));
  assert.ok(sec, "the secondary leg is on the normalized row");
  assert.strictEqual(sec.perUnit, 240);
  assert.strictEqual(sec.city, "Caerleon", "no market city → the refine city");
  assert.strictEqual(sec.note, "refine", "the same self-made marker the planner path uses");
  const line = secLine(aggregateCraftListMaterials([entryOf(row)]));
  assert.strictEqual(line.perUnit, 240);
  assert.strictEqual(line.note, "refine");
});

// ── 3. a zero price is legitimate "no data" ─────────────────────────────────

test("a zero-priced market secondary stays 0 — an empty book is real 'no data'", () => {
  const row = transportRow({
    secondaryMat: { id: "T3_LEATHER", count: 1, price: 0, city: "Martlock" },
  });
  const sec = secMat(extractCraftListRow("transport-table", row));
  assert.strictEqual(sec.perUnit, 0);
  assert.strictEqual(sec.note, "");
  // kept, not dropped: it is still something to go buy
  const line = secLine(aggregateCraftListMaterials([entryOf(row)]));
  assert.ok(line, "the unpriced line is kept on the board");
  assert.strictEqual(line.perUnit, 0);
  assert.strictEqual(line.total, 0);
});

// ── 4. merge order ──────────────────────────────────────────────────────────

test("a 0 contributor and a priced one merge into the positive price, either order", () => {
  const priced = transportRow();
  const unpriced = transportRow({
    secondaryMat: { id: "T3_LEATHER", count: 1, price: 0, city: "Martlock" },
  });
  [
    [entryOf(unpriced), entryOf(priced)],
    [entryOf(priced), entryOf(unpriced)],
  ].forEach((entries, i) => {
    const line = secLine(aggregateCraftListMaterials(entries));
    assert.ok(line, `order ${i}: T3_LEATHER is on the board`);
    assert.strictEqual(line.perUnit, 255, `order ${i}: the positive price wins`);
  });
});

test("aggregator: positive perUnit beats 0 whichever contributor came first", () => {
  const line = (perUnit) => ({ matId: "T3_LEATHER", count: 1, city: "Martlock", perUnit, note: "" });
  [[0, 255], [255, 0]].forEach(([first, second]) => {
    const out = aggregateCraftListMaterials([
      { materials: [line(first)], qty: 1 },
      { materials: [line(second)], qty: 1 },
    ]);
    assert.strictEqual(out.lines.length, 1);
    assert.strictEqual(out.lines[0].perUnit, 255);
  });
});

test("aggregator: two positive prices keep the first (stable merge)", () => {
  const line = (perUnit) => ({ matId: "T3_LEATHER", count: 1, city: "Martlock", perUnit, note: "" });
  const out = aggregateCraftListMaterials([
    { materials: [line(255)], qty: 1 },
    { materials: [line(300)], qty: 1 },
  ]);
  assert.strictEqual(out.lines.length, 1);
  assert.strictEqual(out.lines[0].perUnit, 255);
});

// ── 5. real-shape smoke (recursive chain, mirrors
//    tests/refining-chain-integration.smoke.cjs) ────────────────────────────

test("real-shape smoke: a recursive chain leg prices its secondary on the board", () => {
  // A T3-LEATHER chain recurses to a market leaf two tiers down, the same
  // shape the integration smoke builds for T8 planks: inputs[1].sourcing
  // .source === "chain" carries the nested node until a market leaf closes
  // the ladder.
  const t2 = chainNode("T2_LEATHER", 2, 60, [
    { matId: "T2_HIDE", count: 1,
      sourcing: { perUnit: 58, source: "market", city: "Martlock", travelFeePerUnit: 0 } },
  ]);
  const t3 = chainNode("T3_LEATHER", 3, 130, [
    { matId: "T3_HIDE", count: 1,
      sourcing: { perUnit: 118, source: "market", city: "Martlock", travelFeePerUnit: 2 } },
    { matId: "T2_LEATHER", count: 1,
      sourcing: { perUnit: 60, feePerUnit: 1, source: "chain", city: null, chain: t2 } },
  ]);
  assert.strictEqual(t3.produces, "T3_LEATHER");
  let node = t3;
  // a real T2 node has no secondary input at all (tier < 3 → no inputs[1])
  while (node.inputs[1] && node.inputs[1].sourcing.source === "chain") {
    node = node.inputs[1].sourcing.chain;
  }
  assert.strictEqual(node.tier, 2, "the chain recurses to the T2 leaf");

  // The renderer hangs the chain on the row and stores the resolved cost on
  // secondaryMat.price with no market city (js/render-transport.js).
  const row = transportRow({
    secondaryChain: t3,
    secondaryMat: { id: "T3_LEATHER", count: 1, price: 130, city: null },
  });
  const line = secLine(aggregateCraftListMaterials([entryOf(row)]));
  assert.ok(line, "T3_LEATHER is on the board");
  assert.ok(line.perUnit > 0, `perUnit ${line.perUnit} must not read as 'no data'`);
  assert.strictEqual(line.perUnit, 130);
  assert.strictEqual(line.note, "refine");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
