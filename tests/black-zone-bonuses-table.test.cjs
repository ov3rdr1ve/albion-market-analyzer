/**
 * Tests for the Black Zone Bonuses reference-table renderer.
 *
 * Black-box over the module's pure builders/serializers:
 *   - buildHideoutMatrixRows: 54 rows (zone quality 1-6 × power level 1-9),
 *     quality-major, each carrying general/specialized PB + RRR with and
 *     without focus.
 *   - buildLocationRows: 5 biome hideouts + Roads hideout + 3 Rests, with the
 *     flat refining bonus and the craft-spec list each location grants.
 *   - renderMatrixRow / renderLocationRow: <tr> with 8 cells, percentages to
 *     one decimal, .cb-chip per craft, em-dash when the list is empty.
 *
 * Run: node tests/black-zone-bonuses-table.test.cjs
 */

const assert = require("assert");

const {
  buildHideoutMatrixRows,
  buildLocationRows,
  renderMatrixRow,
  renderLocationRow,
} = require("../js/render-black-zone-bonuses.js");

const {
  ZONE_QUALITIES,
  POWER_LEVELS,
  HIDEOUT_REFINE_PB,
  ROADS_REFINE_PB,
  REST_BONUS,
  getBlackZoneRRR,
} = require("../js/data-black-zone.js");

const { CITY_CRAFT_SPEC } = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== buildHideoutMatrixRows ===");

test("emits 54 rows — every zone quality × power level", () => {
  const rows = buildHideoutMatrixRows();
  assert.strictEqual(rows.length, ZONE_QUALITIES.length * POWER_LEVELS.length);
});

test("rows are quality-major, power ascending inside each quality", () => {
  const rows = buildHideoutMatrixRows();
  assert.deepStrictEqual(
    rows.slice(0, 9).map((r) => `${r.quality}/${r.power}`),
    POWER_LEVELS.map((p) => `1/${p}`),
  );
  assert.strictEqual(rows[9].quality, 2);
  assert.strictEqual(rows[9].power, 1);
  assert.strictEqual(rows[53].quality, 6);
  assert.strictEqual(rows[53].power, 9);
});

test("each row carries both bonuses and both return rates", () => {
  buildHideoutMatrixRows().forEach((row) => {
    ["quality", "power", "generalPB", "generalRRR", "generalRRRFocus",
      "specPB", "specRRR", "specRRRFocus"].forEach((k) => {
      assert.ok(k in row, `row Q${row.quality}/P${row.power} missing ${k}`);
    });
  });
});

test("focus return rate always beats the no-focus one", () => {
  buildHideoutMatrixRows().forEach((row) => {
    assert.ok(row.generalRRRFocus > row.generalRRR,
      `general focus RRR must exceed base at Q${row.quality}/P${row.power}`);
    assert.ok(row.specRRRFocus > row.specRRR,
      `spec focus RRR must exceed base at Q${row.quality}/P${row.power}`);
  });
});

test("specialized bonus never sits below the general bonus", () => {
  buildHideoutMatrixRows().forEach((row) => {
    assert.ok(row.specPB >= row.generalPB,
      `spec PB (${row.specPB}) < general PB (${row.generalPB}) at Q${row.quality}/P${row.power}`);
  });
});

test("return rates come from the shared RRR helper", () => {
  const row = buildHideoutMatrixRows().find((r) => r.quality === 4 && r.power === 6);
  assert.strictEqual(row.specPB, 54.75);
  assert.strictEqual(row.specRRR, getBlackZoneRRR(54.75, false));
  assert.strictEqual(row.specRRRFocus, getBlackZoneRRR(54.75, true));
});

console.log("\n=== buildLocationRows ===");

test("emits the 5 biome hideouts, the Roads hideout, and the 3 Rests", () => {
  const rows = buildLocationRows();
  assert.strictEqual(rows.length, 9);
  assert.deepStrictEqual(rows.map((r) => r.location), [
    "Hideout — Highland",
    "Hideout — Steppe",
    "Hideout — Forest",
    "Hideout — Mountain",
    "Hideout — Swamp",
    "Hideout — Roads of Avalon",
    "Arthur's Rest",
    "Merlyn's Rest",
    "Morgana's Rest",
  ]);
});

test("biome hideouts inherit their royal-city twin's craft list", () => {
  const rows = buildLocationRows();
  const swamp = rows.find((r) => r.location === "Hideout — Swamp");
  assert.deepStrictEqual(swamp.crafts, CITY_CRAFT_SPEC.Thetford);
  assert.ok(swamp.note.includes("Thetford"));
});

test("returned craft arrays are copies, not aliases of CITY_CRAFT_SPEC", () => {
  const swamp = buildLocationRows().find((r) => r.location === "Hideout — Swamp");
  swamp.crafts.push("__poison__");
  assert.ok(!CITY_CRAFT_SPEC.Thetford.includes("__poison__"));
});

test("refining bonus: 15 in the Outlands / at Rests, 10 in the Roads", () => {
  const rows = buildLocationRows();
  rows.forEach((r) => {
    const expected = r.location.includes("Roads") ? ROADS_REFINE_PB : HIDEOUT_REFINE_PB;
    assert.strictEqual(r.refinePB, expected, `wrong refining PB for ${r.location}`);
  });
  assert.strictEqual(REST_BONUS.refine, HIDEOUT_REFINE_PB);
});

test("Rests show flat crafting bonuses; hideouts show the quality×power range", () => {
  const rows = buildLocationRows();
  const arthur = rows.find((r) => r.location === "Arthur's Rest");
  assert.strictEqual(arthur.craftGeneralPB, "18");
  assert.strictEqual(arthur.craftSpecPB, "33");
  const highland = rows.find((r) => r.location === "Hideout — Highland");
  assert.strictEqual(highland.craftGeneralPB, "0 – 26");
  assert.strictEqual(highland.craftSpecPB, "1 – 82");
  const roads = rows.find((r) => r.location.includes("Roads"));
  assert.strictEqual(roads.craftSpecPB, "1 – 57");
  assert.deepStrictEqual(roads.crafts, []);
});

console.log("\n=== renderMatrixRow / renderLocationRow ===");

const matrixRow = buildHideoutMatrixRows().find((r) => r.quality === 6 && r.power === 9);

test("matrix row emits one <tr> with 8 <td> cells", () => {
  const html = renderMatrixRow(matrixRow);
  assert.strictEqual((html.match(/<tr>/g) || []).length, 1);
  assert.strictEqual((html.match(/<td/g) || []).length, 8);
});

test("matrix row shows quality, power, bonus points and both return rates", () => {
  const html = renderMatrixRow(matrixRow);
  assert.ok(html.includes(">Q6<"), "quality cell");
  assert.ok(html.includes(">9<"), "power cell");
  assert.ok(html.includes(">82<"), "spec PB 82 at Q6/P9");
  assert.ok(html.includes("45.1%"), "spec RRR without focus");
  assert.ok(html.includes("58.5%"), "spec RRR with focus");
  assert.ok(html.includes("20.6%"), "general RRR without focus");
  assert.ok(html.includes("45.9%"), "general RRR with focus");
});

test("focus cells are tagged so the CSS can tint them", () => {
  const html = renderMatrixRow(matrixRow);
  assert.strictEqual((html.match(/bz-focus/g) || []).length, 2);
});

test("percentages are formatted to one decimal", () => {
  const html = renderMatrixRow(matrixRow);
  const pcts = html.match(/\d+\.\d+%/g) || [];
  assert.strictEqual(pcts.length, 4, "4 RRR cells");
  pcts.forEach((p) => {
    assert.ok(/^\d+\.\d%$/.test(p), `${p} should carry exactly one decimal`);
  });
});

test("location row emits one <tr> with 8 <td> cells and a chip per craft", () => {
  const row = buildLocationRows().find((r) => r.location === "Arthur's Rest");
  const html = renderLocationRow(row);
  assert.strictEqual((html.match(/<tr>/g) || []).length, 1);
  assert.strictEqual((html.match(/<td/g) || []).length, 8);
  assert.strictEqual((html.match(/class="cb-chip"/g) || []).length, row.crafts.length);
  assert.ok(html.includes("War Gloves"), "knuckles must render as War Gloves");
  assert.ok(html.includes("13.0%") && html.includes("42.5%"),
    "refining RRR with and without focus");
});

test("location row with no craft list renders the em-dash placeholder", () => {
  const roads = buildLocationRows().find((r) => r.location.includes("Roads"));
  const html = renderLocationRow(roads);
  assert.ok(!html.includes("cb-chip"), "no chips expected");
  assert.ok(html.includes("—"), "em-dash placeholder expected");
  assert.ok(html.includes("9.1%") && html.includes("40.8%"),
    "Roads refining RRR (PB 10) with and without focus");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
