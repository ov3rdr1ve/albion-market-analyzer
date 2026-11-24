/**
 * Tests for the Brecilien Travel Planner Fees reference table renderer.
 *
 * The module under test is a browser-IIFE that exports its pure helpers via
 * `module.exports` for the Node harness. We exercise:
 *   - buildBrecilienFeeRows: emits every tiered artifact mat + the two
 *     special tokens, with per-tier fees sourced from the injected
 *     exitCostPerUnit fn (no globals patched).
 *   - Fee math: matches the live brecilienExitCostPerUnit values from
 *     js/travel-cost.js (artifact-mat tier schedule + special-token
 *     overrides — see tests/travel-cost.test.cjs for the canonical fixtures).
 *   - Special-token rows: only T4 cell is populated; T5-T8 are null and
 *     render as em-dash placeholders.
 *   - renderRow: 1 <tr> with 6 <td> cells (label + 5 tiers), tabular-nums
 *     class wiring, em-dash placeholder for missing tiers.
 *
 * Black-box, parameterised. We do not patch globals — the cost fn is injected
 * via the opts.exitCostPerUnit hook the module supports.
 *
 * Run: node tests/brecilien-fees-table.test.cjs
 */

const assert = require("assert");

const {
  buildBrecilienFeeRows,
  renderRow,
  TIERS,
  TIERED_ITEMS,
  SPECIAL_ITEMS,
  RESOURCE_ENCHANTS,
} = require("../js/render-brecilien-fees.js");
const tc = require("../js/travel-cost.js");

// Clear weight-table globals so the live cost helper falls through to its
// pattern tables (artifact-mat schedule + MANUAL_TRAVEL_OVERRIDES), exactly as
// in tests/travel-cost.test.cjs. Any leakage would push artifact-mat rows
// through the gear-class fallback (~100× too large).
delete global.ITEM_WEIGHTS;
delete global.ITEM_FT_FACTORS;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
function approx(actual, expected, eps = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ~${expected}, got ${actual}`,
  );
}

console.log("\n=== shape ===");

test("TIERS covers T4-T8", () => {
  assert.deepStrictEqual(TIERS, [4, 5, 6, 7, 8]);
});

test("emits 5 resource + 7 tiered + 2 special rows + 2 group headers", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: () => 0 });
  const byKind = (k) => rows.filter((r) => r.kind === k).length;
  assert.strictEqual(byKind("resource"), RESOURCE_ENCHANTS.length);
  assert.strictEqual(byKind("resource"), 5);
  assert.strictEqual(byKind("tiered"), TIERED_ITEMS.length);
  assert.strictEqual(byKind("special"), SPECIAL_ITEMS.length);
  assert.strictEqual(byKind("group"), 2);
  assert.strictEqual(rows.length, 2 + 5 + TIERED_ITEMS.length + SPECIAL_ITEMS.length);
});

test("each tiered row has fees populated for every tier (T4-T8)", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: () => 42 });
  rows.filter((r) => r.kind === "tiered").forEach((row) => {
    TIERS.forEach((t) => {
      assert.strictEqual(row.fees[t], 42, `${row.label} T${t} should equal injected cost`);
    });
  });
});

test("each resource row has fees populated for every tier (T4-T8)", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: () => 7 });
  const res = rows.filter((r) => r.kind === "resource");
  assert.strictEqual(res.length, 5);
  res.forEach((row) => {
    TIERS.forEach((t) => {
      assert.strictEqual(row.fees[t], 7, `${row.label} T${t} should equal injected cost`);
    });
  });
});

test("special-token rows populate exactly ONE column — their own tier, or T4 when below the axis", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: () => 99 });
  const specials = rows.filter((r) => r.kind === "special");
  assert.strictEqual(specials.length, SPECIAL_ITEMS.length);
  specials.forEach((row) => {
    assert.strictEqual(row.special, true, `${row.label} should be flagged special`);
    const col = TIERS.includes(row.tier) ? row.tier : TIERS[0];
    assert.strictEqual(row.fees[col], 99, `${row.label} T${col} populated`);
    TIERS.filter((t) => t !== col).forEach((t) => {
      assert.strictEqual(row.fees[t], null, `${row.label} T${t} should be null`);
    });
  });
});

test("group-header rows carry a label and no fees", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: () => 0 });
  const groups = rows.filter((r) => r.kind === "group");
  assert.strictEqual(groups.length, 2);
  groups.forEach((g) => {
    assert.ok(typeof g.label === "string" && g.label.length, "group needs a label");
    assert.strictEqual(g.fees, undefined, "group rows have no fees");
  });
});

test("missing cost fn (no opts, no global): every data fee is null", () => {
  // Capture & clear the global, run, restore.
  const saved = global.brecilienExitCostPerUnit;
  delete global.brecilienExitCostPerUnit;
  try {
    const rows = buildBrecilienFeeRows();
    rows.filter((r) => r.fees).forEach((row) => {
      TIERS.forEach((t) => {
        assert.strictEqual(row.fees[t], null, `${row.label} T${t} should be null without cost fn`);
      });
    });
  } finally {
    if (saved !== undefined) global.brecilienExitCostPerUnit = saved;
  }
});

console.log("\n=== fee math wires through brecilienExitCostPerUnit ===");

test("each tiered row receives the live exit cost for T{tier}_{stem}", () => {
  const seen = [];
  const fakeCost = (id) => {
    seen.push(id);
    return id.length;
  };
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: fakeCost });
  // Verify every artifact-mat id was queried exactly once per tier.
  TIERED_ITEMS.forEach((item) => {
    TIERS.forEach((tier) => {
      const id = `T${tier}_${item.stem}`;
      assert.ok(seen.includes(id), `expected lookup for ${id}`);
    });
  });
  // And the row values came from the fake.
  const relic = rows.find((r) => r.label === "Relic");
  assert.strictEqual(relic.fees[4], "T4_RELIC".length);
});

test("Relic fee matches live brecilienExitCostPerUnit values", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const relic = rows.find((r) => r.label === "Relic");
  // From tests/travel-cost.test.cjs: T4_RELIC = 23.12 silver.
  approx(relic.fees[4], 23.12, 0.005);
  // T8 = 200 * 1.0 * 1 * 2 * 1.156 = 462.4
  approx(relic.fees[8], 462.4, 0.01);
});

test("all artifact-mat families share the same tier schedule (RELIC=SOUL=RUNE=SHARD…)", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const baseline = rows.find((r) => r.label === "Relic").fees;
  rows.filter((r) => r.kind === "tiered").forEach((row) => {
    TIERS.forEach((t) => {
      approx(row.fees[t], baseline[t], 0.01);
    });
  });
});

// Special tokens are NOT untiered: items.xml gives QUESTITEM_TOKEN_AVALON
// tier="6" and UNIQUE_GVGTOKEN_GENERIC tier="1". The fee itself is one number
// (weight/ftf are pinned per id), so it lands in the row's real tier column
// when that tier is on the T4-T8 axis, and in the first column otherwise.
test("Avalonian Energy is T6: fee ≈ 73.99 sits in the T6 column", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const ae = rows.find((r) => r.label === "Avalonian Energy");
  assert.strictEqual(ae.tier, 6);
  approx(ae.fees[6], 73.984, 0.01);
  [4, 5, 7, 8].forEach((t) => assert.strictEqual(ae.fees[t], null, `T${t} should be empty`));
});

test("Siphoned Energy is T1: below the axis, fee ≈ 4.62 shown in the first column", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const se = rows.find((r) => r.label === "Siphoned Energy");
  assert.strictEqual(se.tier, 1);
  approx(se.fees[4], 4.624, 0.005);
  [5, 6, 7, 8].forEach((t) => assert.strictEqual(se.fees[t], null, `T${t} should be empty`));
});

test("special rows print their tier next to the label", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const ae = renderRow(rows.find((r) => r.label === "Avalonian Energy"));
  const se = renderRow(rows.find((r) => r.label === "Siphoned Energy"));
  assert.ok(ae.includes("Avalonian Energy [T6]"), `missing [T6] tag: ${ae}`);
  assert.ok(se.includes("Siphoned Energy [T1]"), `missing [T1] tag: ${se}`);
});

test("tiered rows carry no tier tag", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const relic = renderRow(rows.find((r) => r.label === "Relic"));
  assert.ok(!/\[T\d\]/.test(relic), `unexpected tier tag: ${relic}`);
});

test("artifact-mat tier ordering monotonically increases T4 < T8", () => {
  const rows = buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit });
  const relic = rows.find((r) => r.label === "Relic");
  assert.ok(relic.fees[4] < relic.fees[8],
    `T4 (${relic.fees[4]}) should be < T8 (${relic.fees[8]})`);
});

console.log("\n=== resource rows scale with tier AND enchant ===");

const GMS = 1.156;
const RATE = 200; // TRAVEL_PLANNER_RATE — was 150 before 2026-07-29
function resourceRows() {
  return buildBrecilienFeeRows({ exitCostPerUnit: tc.brecilienExitCostPerUnit })
    .filter((r) => r.kind === "resource");
}

test("resource .0 matches live formula (T4≈471.6, T5≈1405.7)", () => {
  const r0 = resourceRows()[0];
  approx(r0.fees[4], RATE * 0.51 * 2 * 2 * GMS, 0.5);
  approx(r0.fees[5], RATE * 0.76 * 4 * 2 * GMS, 0.5);
});

test("enchant doubles the fee: .1 = 2× .0 at every tier", () => {
  const res = resourceRows();
  TIERS.forEach((t) => approx(res[1].fees[t], res[0].fees[t] * 2, 1));
});

test("resource .2 (Rare) T4 ≈ 1886.6 — the user's T4.2 case (ftf 8)", () => {
  approx(resourceRows()[2].fees[4], RATE * 0.51 * 8 * 2 * GMS, 0.5);
});

test("T8 fasttravelfactor caps at 256: resource .3 T8 == .4 T8", () => {
  const res = resourceRows();
  approx(res[3].fees[8], res[4].fees[8], 0.5);
});

test("representative-id choice is neutral: PLANKS == WOOD (same weight + ftf)", () => {
  approx(tc.brecilienExitCostPerUnit("T6_PLANKS_LEVEL1@1"),
         tc.brecilienExitCostPerUnit("T6_WOOD_LEVEL1@1"), 0.001);
});

console.log("\n=== renderRow ===");

const sampleRow = {
  label: "Relic",
  fees: { 4: 17.34, 5: 86.7, 6: 131.8, 7: 173.4, 8: 346.8 },
};

test("emits one <tr> with 6 <td> cells (label + 5 tier columns)", () => {
  const html = renderRow(sampleRow);
  const trCount = (html.match(/<tr>/g) || []).length;
  const tdCount = (html.match(/<td/g) || []).length;
  assert.strictEqual(trCount, 1);
  assert.strictEqual(tdCount, 6);
});

test("group-header row renders one full-width bf-group cell (colspan 6)", () => {
  const html = renderRow({ kind: "group", label: "Resources" });
  assert.ok(html.includes('class="bf-group"'), "expected a bf-group cell");
  assert.ok(/colspan="6"/.test(html), "expected colspan=6 (label + 5 tiers)");
  assert.ok(html.includes("Resources"), "expected the group label text");
  assert.strictEqual((html.match(/<td/g) || []).length, 1, "group row has exactly one td");
});

test("label cell uses .bf-label class", () => {
  const html = renderRow(sampleRow);
  assert.ok(html.includes('class="bf-label">Relic'),
    "expected bf-label cell containing 'Relic'");
});

test("fee cells use .bf-fee class", () => {
  const html = renderRow(sampleRow);
  const feeMatches = (html.match(/class="bf-fee"/g) || []).length;
  assert.strictEqual(feeMatches, 5);
});

test("small fees (<10) render with 2 decimals", () => {
  const row = { label: "Siphoned Energy", fees: { 4: 3.47, 5: null, 6: null, 7: null, 8: null } };
  const html = renderRow(row);
  assert.ok(html.includes("3.47"), "expected '3.47' in output");
});

test("mid fees (10-100) render with 1 decimal", () => {
  const row = { label: "X", fees: { 4: 17.34, 5: null, 6: null, 7: null, 8: null } };
  const html = renderRow(row);
  assert.ok(html.includes("17.3"), "expected '17.3' in output");
});

test("large fees (>=100) render rounded with thousands separators", () => {
  const row = { label: "X", fees: { 4: 1234.56, 5: null, 6: null, 7: null, 8: null } };
  const html = renderRow(row);
  // toLocaleString in node-en-US uses a comma; we just assert the rounded int appears.
  assert.ok(/1[,.]?235/.test(html), "expected '1,235' or '1235' in output");
});

test("null fee cells render an em-dash placeholder", () => {
  const row = { label: "Avalonian Energy", fees: { 4: 55.49, 5: null, 6: null, 7: null, 8: null } };
  const html = renderRow(row);
  const dashCount = (html.match(/>—</g) || []).length;
  assert.strictEqual(dashCount, 4, `expected 4 em-dash placeholders, got ${dashCount}`);
});

test("zero/negative fees also render as em-dash (defensive)", () => {
  const row = { label: "X", fees: { 4: 0, 5: -1, 6: 100, 7: null, 8: null } };
  const html = renderRow(row);
  const dashCount = (html.match(/>—</g) || []).length;
  // 0, -1, and 2 nulls → 4 dashes; 100 renders normally.
  assert.strictEqual(dashCount, 4, `expected 4 em-dash cells, got ${dashCount}`);
  assert.ok(html.includes("100"), "expected '100' to render normally");
});

console.log("\n=== exposed item set covers user's call-out ===");

test("TIERED_ITEMS includes Relic, Soul, Rune, both Shards, Essence, Essence Potion", () => {
  const labels = TIERED_ITEMS.map((i) => i.label);
  ["Relic", "Soul", "Rune", "Avalonian Shard", "Crystal Shard", "Essence", "Essence Potion"]
    .forEach((label) => {
      assert.ok(labels.includes(label), `missing tiered item: ${label}`);
    });
});

test("SPECIAL_ITEMS includes Avalonian Energy + Siphoned Energy with items.xml tiers", () => {
  const labels = SPECIAL_ITEMS.map((i) => i.label);
  assert.ok(labels.includes("Avalonian Energy"), "missing Avalonian Energy");
  assert.ok(labels.includes("Siphoned Energy"), "missing Siphoned Energy");
  assert.strictEqual(SPECIAL_ITEMS.find((i) => i.label === "Avalonian Energy").tier, 6);
  assert.strictEqual(SPECIAL_ITEMS.find((i) => i.label === "Siphoned Energy").tier, 1);
});

test("SPECIAL_ITEMS ids match the MANUAL_TRAVEL_OVERRIDES keys in travel-cost.js", () => {
  const ids = SPECIAL_ITEMS.map((i) => i.id);
  assert.ok(ids.includes("QUESTITEM_TOKEN_AVALON"), "missing Avalonian Energy id");
  assert.ok(ids.includes("UNIQUE_GVGTOKEN_GENERIC"), "missing Siphoned Energy id");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
