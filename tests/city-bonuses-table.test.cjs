/**
 * Tests for the City Bonuses reference table renderer.
 *
 * The module is browser-IIFE that exports its pure helpers via
 * `module.exports` for the Node test harness. We exercise:
 *  - buildCityBonusRows: every CITY_ORDER entry produces a row with the
 *    correct crafts/refine/butcher/farming-{crops,herbs,byproducts} payload,
 *    sourced from the real calculations.js constants (no mocks).
 *  - renderRow: serializes each row to the expected <tr> structure
 *    (8 cells, em-dash placeholder when empty, .cb-chip wrappers when not).
 *  - prettyCraftType: friendly labels override the raw kebab id when set,
 *    otherwise falls back to a title-cased version.
 *
 * Run: node tests/city-bonuses-table.test.cjs
 */

const assert = require("assert");

const {
  buildCityBonusRows,
  renderRow,
  CITY_ORDER,
  CRAFT_TYPE_LABELS,
  REFINE_LABELS,
  prettyCraftType,
} = require("../js/render-city-bonuses.js");

const {
  CITY_CRAFT_SPEC,
  CITY_REFINE_SPEC,
  CITY_BUTCHER_SPEC,
  CITY_FARM_SPEC,
} = require("../js/calculations.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

console.log("\n=== buildCityBonusRows — shape ===");

test("emits one row per CITY_ORDER entry, preserving order", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC,
    CITY_REFINE_SPEC,
    CITY_BUTCHER_SPEC,
    CITY_FARM_SPEC,
  });
  assert.strictEqual(rows.length, CITY_ORDER.length);
  rows.forEach((row, i) => {
    assert.strictEqual(row.city, CITY_ORDER[i]);
  });
});

test("CITY_ORDER covers all 5 royal cities + Caerleon + Brecilien", () => {
  const expected = new Set([
    "Caerleon",
    "Bridgewatch",
    "Fort Sterling",
    "Lymhurst",
    "Martlock",
    "Thetford",
    "Brecilien",
  ]);
  assert.strictEqual(CITY_ORDER.length, expected.size);
  CITY_ORDER.forEach((c) => assert.ok(expected.has(c), `unexpected city ${c}`));
});

test("each row has all expected payload keys", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC,
    CITY_REFINE_SPEC,
    CITY_BUTCHER_SPEC,
    CITY_FARM_SPEC,
  });
  rows.forEach((row) => {
    ["city", "crafts", "refine", "butcher", "crops", "herbs", "byproducts"].forEach((k) => {
      assert.ok(k in row, `row for ${row.city} missing key ${k}`);
    });
    assert.ok(Array.isArray(row.crafts), `crafts must be an array`);
    assert.ok(Array.isArray(row.butcher), `butcher must be an array`);
    assert.ok(Array.isArray(row.crops), `crops must be an array`);
    assert.ok(Array.isArray(row.herbs), `herbs must be an array`);
    assert.ok(Array.isArray(row.byproducts), `byproducts must be an array`);
  });
});

test("returned arrays are copies, not aliases of the source constants", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC,
    CITY_REFINE_SPEC,
    CITY_BUTCHER_SPEC,
    CITY_FARM_SPEC,
  });
  const fs = rows.find((r) => r.city === "Fort Sterling");
  fs.crafts.push("__poison__");
  assert.ok(
    !CITY_CRAFT_SPEC["Fort Sterling"].includes("__poison__"),
    "mutating returned row.crafts must not leak into CITY_CRAFT_SPEC",
  );
});

console.log("\n=== buildCityBonusRows — content from real constants ===");

test("Fort Sterling: wood refining + chicken & mutton butcher specs", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const fs = rows.find((r) => r.city === "Fort Sterling");
  assert.strictEqual(fs.refine, "wood");
  assert.deepStrictEqual(fs.butcher.sort(), ["T3_MEAT", "T6_MEAT"]);
});

test("Bridgewatch: rock refining + goat butcher + bean/corn crops + teasel herb + goat milk", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const bw = rows.find((r) => r.city === "Bridgewatch");
  assert.strictEqual(bw.refine, "rock");
  assert.deepStrictEqual(bw.butcher, ["T4_MEAT"]);
  assert.deepStrictEqual(bw.crops.sort(), ["T2_BEAN", "T7_CORN"]);
  assert.deepStrictEqual(bw.herbs, ["T5_TEASEL"]);
  assert.deepStrictEqual(bw.byproducts, ["T4_MILK"]);
});

test("Caerleon: no refining / no butcher / no crops / 3 herbs / no byproducts", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const cae = rows.find((r) => r.city === "Caerleon");
  assert.strictEqual(cae.refine, null);
  assert.deepStrictEqual(cae.butcher, []);
  assert.deepStrictEqual(cae.crops, []);
  assert.deepStrictEqual(cae.herbs.sort(), ["T3_COMFREY", "T5_TEASEL", "T7_MULLEIN"]);
  assert.deepStrictEqual(cae.byproducts, []);
});

test("Brecilien: cape/bag/potion crafts + all 8 crops + no refining/butcher/herbs/byproducts", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const br = rows.find((r) => r.city === "Brecilien");
  assert.strictEqual(br.refine, null);
  assert.deepStrictEqual(br.butcher, []);
  assert.deepStrictEqual(br.crops.sort(), [
    "T1_CARROT", "T2_BEAN", "T3_WHEAT", "T4_TURNIP",
    "T5_CABBAGE", "T6_POTATO", "T7_CORN", "T8_PUMPKIN",
  ]);
  assert.deepStrictEqual(br.herbs, []);
  assert.deepStrictEqual(br.byproducts, []);
  assert.deepStrictEqual(br.crafts.sort(), ["bag", "cape", "potion"]);
});

test("Lymhurst: fiber refining + goose butcher + carrot/pumpkin crops + burdock herb + goose egg", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const ly = rows.find((r) => r.city === "Lymhurst");
  assert.strictEqual(ly.refine, "fiber");
  assert.deepStrictEqual(ly.butcher, ["T5_MEAT"]);
  assert.deepStrictEqual(ly.crops.sort(), ["T1_CARROT", "T8_PUMPKIN"]);
  assert.deepStrictEqual(ly.herbs, ["T4_BURDOCK"]);
  assert.deepStrictEqual(ly.byproducts, ["T5_EGG"]);
});

test("Martlock: hide refining + beef butcher + wheat/potato crops + foxglove + cow milk", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const ma = rows.find((r) => r.city === "Martlock");
  assert.strictEqual(ma.refine, "hide");
  assert.deepStrictEqual(ma.butcher, ["T8_MEAT"]);
  assert.deepStrictEqual(ma.crops.sort(), ["T3_WHEAT", "T6_POTATO"]);
  assert.deepStrictEqual(ma.herbs, ["T6_FOXGLOVE"]);
  assert.deepStrictEqual(ma.byproducts, ["T8_MILK"]);
});

test("Thetford: ore refining + pork butcher + cabbage crop + agaric/mullein herbs + no byproducts", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
  });
  const th = rows.find((r) => r.city === "Thetford");
  assert.strictEqual(th.refine, "ore");
  assert.deepStrictEqual(th.butcher, ["T7_MEAT"]);
  assert.deepStrictEqual(th.crops, ["T5_CABBAGE"]);
  assert.deepStrictEqual(th.herbs.sort(), ["T2_AGARIC", "T7_MULLEIN"]);
  assert.deepStrictEqual(th.byproducts, []);
});

console.log("\n=== buildCityBonusRows — robustness ===");

test("empty constants: every row has empty arrays / null refine", () => {
  const rows = buildCityBonusRows({});
  assert.strictEqual(rows.length, CITY_ORDER.length);
  rows.forEach((row) => {
    assert.deepStrictEqual(row.crafts, []);
    assert.strictEqual(row.refine, null);
    assert.deepStrictEqual(row.butcher, []);
    assert.deepStrictEqual(row.crops, []);
    assert.deepStrictEqual(row.herbs, []);
    assert.deepStrictEqual(row.byproducts, []);
  });
});

test("custom cityOrder is honored (subset)", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC, CITY_REFINE_SPEC, CITY_BUTCHER_SPEC, CITY_FARM_SPEC,
    cityOrder: ["Martlock", "Thetford"],
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].city, "Martlock");
  assert.strictEqual(rows[1].city, "Thetford");
});

test("missing CITY_FARM_SPEC entry for a city: empty crops/herbs/byproducts", () => {
  const rows = buildCityBonusRows({
    CITY_CRAFT_SPEC,
    CITY_REFINE_SPEC,
    CITY_BUTCHER_SPEC,
    CITY_FARM_SPEC: {},
  });
  rows.forEach((r) => {
    assert.deepStrictEqual(r.crops, []);
    assert.deepStrictEqual(r.herbs, []);
    assert.deepStrictEqual(r.byproducts, []);
  });
});

console.log("\n=== renderRow ===");

const sampleRow = {
  city: "Thetford",
  crafts: ["mace", "naturestaff", "firestaff", "leather_armor", "cloth_helmet"],
  refine: "ore",
  butcher: ["T7_MEAT"],
  crops: ["T5_CABBAGE"],
  herbs: ["T2_AGARIC", "T7_MULLEIN"],
  byproducts: [],
};

test("emits exactly one <tr> with 8 <td> cells", () => {
  const html = renderRow(sampleRow);
  const trCount = (html.match(/<tr>/g) || []).length;
  const tdCount = (html.match(/<td/g) || []).length;
  assert.strictEqual(trCount, 1);
  assert.strictEqual(tdCount, 8);
});

test("city cell shows the city name and class cb-city", () => {
  const html = renderRow(sampleRow);
  assert.ok(html.includes('class="cb-city">Thetford'),
    "expected cb-city cell containing 'Thetford'");
});

test("base column always shows +18%", () => {
  const html = renderRow(sampleRow);
  assert.ok(html.includes('class="cb-base">+18%'),
    "expected cb-base cell containing '+18%'");
});

test("refine cell shows the friendly label, not the raw key", () => {
  const html = renderRow(sampleRow);
  assert.ok(html.includes("Metal Bars (Ore)"),
    "expected REFINE_LABELS lookup to produce 'Metal Bars (Ore)'");
  assert.ok(!html.includes(">ore<"),
    "should not render the raw 'ore' string");
});

test("empty arrays render an em-dash placeholder, not an empty chip", () => {
  const html = renderRow(sampleRow);
  // byproducts is [], so its cell should hold the dash.
  assert.ok(html.includes('class="cb-byproducts">'),
    "byproducts cell present");
  assert.ok(html.match(/cb-byproducts">[^<]*<span[^>]*>—<\/span>/),
    "expected em-dash placeholder for empty byproducts");
});

test("non-empty lists render one .cb-chip per item", () => {
  const html = renderRow(sampleRow);
  // 5 crafts + 1 refine + 1 butcher + 1 crop + 2 herbs + 0 byproducts = 10 chips
  const chipCount = (html.match(/class="cb-chip"/g) || []).length;
  assert.strictEqual(chipCount, 10,
    `expected 10 chips, got ${chipCount}`);
});

test("butcher chip uses ITEM_NAMES_MAP-style human name when available", () => {
  // ITEM_NAMES_MAP isn't loaded in Node tests, so the helper falls back to
  // the raw id. We assert the id surfaces inside the chip rather than the
  // mapped name (the mapping is exercised in the browser via the global).
  const html = renderRow(sampleRow);
  assert.ok(html.includes("T7_MEAT"),
    "butcher chip should include T7_MEAT (or its display name)");
});

console.log("\n=== prettyCraftType ===");

test("known kebab key returns mapped label", () => {
  assert.strictEqual(prettyCraftType("plate_helmet"), "Plate Helmet");
  assert.strictEqual(prettyCraftType("froststaff"), "Frost Staff");
  assert.strictEqual(prettyCraftType("food"), "Food (Meals)");
});

test("unknown key gets a fallback title-case (first letter upper)", () => {
  assert.strictEqual(prettyCraftType("sword"), "Sword");
  assert.strictEqual(prettyCraftType("axe"), "Axe");
});

test("CRAFT_TYPE_LABELS covers all multi-word gathering gear pieces", () => {
  // Caerleon's gathering set has 24 entries (6 resources × 4 slots). Every
  // one needs a friendly label so the chip column reads cleanly.
  const gathererKeys = (CITY_CRAFT_SPEC.Caerleon || []).filter((k) =>
    k.endsWith("_helmet") || k.endsWith("_armor") ||
    k.endsWith("_shoes") || k.endsWith("_backpack"),
  );
  assert.ok(gathererKeys.length >= 24,
    `expected ≥24 gatherer gear pieces in Caerleon, got ${gathererKeys.length}`);
  gathererKeys.forEach((k) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CRAFT_TYPE_LABELS, k),
      `CRAFT_TYPE_LABELS missing label for ${k}`,
    );
  });
});

test("REFINE_LABELS covers every CITY_REFINE_SPEC value", () => {
  Object.values(CITY_REFINE_SPEC).forEach((r) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(REFINE_LABELS, r),
      `REFINE_LABELS missing label for refining resource '${r}'`,
    );
  });
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
