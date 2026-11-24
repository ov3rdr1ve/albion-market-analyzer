/**
 * Test: the Refining/Transports table — generic resource labels and the
 * low-tier (T2/T3) rows.
 *
 *   - First column renders via getItemDisplayName(refinedId) as a short generic
 *     label ("T6.1 planks", "T4 bar"), consistent with the breakdown/volume/flip
 *     tables and independent of tier-specific proper names.
 *   - T2 and T3 rows exist for all 5 families, plain-only (no enchant variants),
 *     with the correct in-game structure: T2 refines from raw alone (no
 *     secondary), T3 takes 2 raw + 1 T2 refined.
 *   - T4-T8 keep their 5 enchant levels each (regression guard).
 *
 * Black-box: load real data.js + resource-names.js + utils.js, then inspect
 * TRANSPORT_ITEMS and getItemDisplayName output.
 *
 * Run: node tests/refining-resource-rows.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sandbox = { window: {}, document: { getElementById: () => null }, console };
vm.createContext(sandbox);
for (const s of [
  "js/item-names.js", "js/resource-names.js", "js/data.js",
  "js/data-consumables.js", "js/data-mounts.js", "js/data-farming.js", "js/utils.js",
]) {
  try { vm.runInContext(fs.readFileSync(path.join(__dirname, "..", s), "utf-8"), sandbox); }
  catch (e) { console.error(`Error loading ${s}: ${e.message}`); process.exit(1); }
}
const TRANSPORT_ITEMS = vm.runInContext("TRANSPORT_ITEMS", sandbox);
const getItemDisplayName = vm.runInContext("getItemDisplayName", sandbox);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

const byRefined = new Map(TRANSPORT_ITEMS.map((r) => [r.refinedId, r]));
// family: [refined code, raw code]
const FAMILIES = [
  ["PLANKS", "WOOD"], ["METALBAR", "ORE"], ["LEATHER", "HIDE"],
  ["CLOTH", "FIBER"], ["STONEBLOCK", "ROCK"],
];

console.log("Refining resource rows\n");

// ── 1. First-column label is the generic refined form ──
const LABELS = {
  T6_PLANKS: "T6 planks", "T6_PLANKS_LEVEL1@1": "T6.1 planks",
  T4_METALBAR: "T4 bar", T6_CLOTH: "T6 cloth",   // T6_CLOTH regression: was mislabelled "Fine Cloth"
  T2_PLANKS: "T2 planks", T3_STONEBLOCK: "T3 block",
  T6_WOOD: "T6 logs", "T6_WOOD_LEVEL1@1": "T6.1 logs",
};
for (const [id, expect] of Object.entries(LABELS)) {
  test(`getItemDisplayName(${id}) === "${expect}"`, () =>
    assert.strictEqual(getItemDisplayName(id), expect));
}

// ── 2. T2/T3 rows exist for every family, plain-only ──
for (const [refined] of FAMILIES) {
  test(`T2_${refined} and T3_${refined} rows exist`, () => {
    assert.ok(byRefined.has(`T2_${refined}`), `missing T2_${refined}`);
    assert.ok(byRefined.has(`T3_${refined}`), `missing T3_${refined}`);
  });
}

// ── 3. T2 refines from raw alone (no secondary), rawRatio 1 ──
for (const [refined] of FAMILIES) {
  test(`T2_${refined}: no secondary, rawRatio 1`, () => {
    const row = byRefined.get(`T2_${refined}`);
    assert.strictEqual(row.secondaryMatId, null);
    assert.strictEqual(row.secondaryMatCount, 0);
    assert.strictEqual(row.rawRatio, 1);
  });
}

// ── 4. T3 takes 2 raw + 1 T2 refined ──
for (const [refined] of FAMILIES) {
  test(`T3_${refined}: secondary = T2_${refined}, rawRatio 2`, () => {
    const row = byRefined.get(`T3_${refined}`);
    assert.strictEqual(row.secondaryMatId, `T2_${refined}`);
    assert.strictEqual(row.secondaryMatCount, 1);
    assert.strictEqual(row.rawRatio, 2);
  });
}

// ── 5. No enchant variants below T4 ──
test("no enchanted T2/T3 rows exist", () => {
  const bad = TRANSPORT_ITEMS.filter((r) => /^T[23]_[A-Z]+(_LEVEL|@)\d/.test(r.refinedId));
  assert.strictEqual(bad.length, 0, `found: ${bad.map((r) => r.refinedId).join(", ")}`);
});

// ── 6. Regression: non-stone T4-T8 carry 5 enchant levels each (enchanted on the
//        REFINED side). Stone's refined block never enchants, so its refined id is
//        always the PLAIN block; instead it carries alt-sourcing rows keyed by an
//        enchanted RAW rock. Count non-stone by refined enchant, stone by raw. ──
for (const [refined, raw] of FAMILIES) {
  for (let t = 4; t <= 8; t++) {
    if (refined === "STONEBLOCK") {
      test(`T${t}_STONEBLOCK: 1 plain-rock row + 3 enchanted-rock (.1–.3) rows, all → plain block`, () => {
        const rows = TRANSPORT_ITEMS.filter((r) => r.refinedId === `T${t}_STONEBLOCK`);
        assert.strictEqual(rows.length, 4, `expected 4 stone rows, got ${rows.length}`);
        assert.strictEqual(rows.filter((r) => r.rawId === `T${t}_${raw}`).length, 1, "one plain-rock row");
        const enchRaw = rows.filter((r) => /_ROCK_LEVEL[123]@[123]$/.test(r.rawId));
        assert.strictEqual(enchRaw.length, 3, "three enchanted-rock (.1–.3) rows");
      });
    } else {
      test(`T${t}_${refined}: 5 enchant rows`, () => {
        const n = TRANSPORT_ITEMS.filter((r) => new RegExp(`^T${t}_${refined}(_LEVEL\\d+@\\d+)?$`).test(r.refinedId)).length;
        assert.strictEqual(n, 5, `expected 5, got ${n}`);
      });
    }
  }
}

// ── 7. Stone enchant rules: the REFINED stoneblock has no enchanted version (no
//        enchanted block exists), so every stone row's OUTPUT is a plain block.
//        Enchanted RAW rock (.1–.3) is a valid INPUT that refines into plain
//        blocks — those alt rows exist — but pristine (.4) rock never does. ──
const STONEBLOCK_ENCH_RE = /_STONEBLOCK_LEVEL\d+@\d+$/;
const ROCK_ENCH_RE = /_ROCK_LEVEL(\d+)@\d+$/;

test("no enchanted stone block is ever an output (refined side stays flat)", () => {
  const bad = TRANSPORT_ITEMS.filter(
    (r) => STONEBLOCK_ENCH_RE.test(r.refinedId) || STONEBLOCK_ENCH_RE.test(r.rawId)
  );
  assert.strictEqual(bad.length, 0, `enchanted block leaked: ${bad.map((r) => r.refinedId).join(", ")}`);
});

test("enchanted raw rock inputs are .1–.3 only (no pristine .4), and always output a plain block", () => {
  const enchRockRows = TRANSPORT_ITEMS.filter((r) => ROCK_ENCH_RE.test(r.rawId));
  assert.ok(enchRockRows.length > 0, "expected enchanted-rock alt rows to exist");
  for (const r of enchRockRows) {
    const lvl = (r.rawId.match(ROCK_ENCH_RE) || [])[1];
    assert.ok(["1", "2", "3"].includes(lvl), `raw rock enchant out of .1–.3 range: ${r.rawId}`);
    assert.ok(/^T\d+_STONEBLOCK$/.test(r.refinedId), `enchanted rock must output plain block: ${r.refinedId}`);
  }
});

test("plain stone refining rows still exist at every tier T2–T8", () => {
  for (let t = 2; t <= 8; t++) assert.ok(byRefined.has(`T${t}_STONEBLOCK`), `missing T${t}_STONEBLOCK`);
});

test("Flipping (RESOURCE_FLIP_ITEMS): enchanted RAW rock .1–.3 present, no .4, no enchanted stoneblock", () => {
  const flip = vm.runInContext("buildResourceFlipItems(); RESOURCE_FLIP_ITEMS", sandbox);
  // Refined stoneblock never enchants.
  const badBlock = flip.filter((i) => STONEBLOCK_ENCH_RE.test(i.id));
  assert.strictEqual(badBlock.length, 0, `enchanted stoneblock leaked: ${badBlock.map((i) => i.id).join(", ")}`);
  // Raw rock enchants, but caps at .3.
  const rockEnchLevels = new Set(flip.map((i) => (i.id.match(ROCK_ENCH_RE) || [])[1]).filter(Boolean));
  assert.deepStrictEqual([...rockEnchLevels].sort(), ["1", "2", "3"], "raw rock should enchant .1–.3 only");
  assert.ok(flip.some((i) => i.id === "T4_ROCK_LEVEL1@1"), "enchanted raw stone flip row should exist");
  assert.ok(!flip.some((i) => i.id === "T8_ROCK_LEVEL4@4"), "no pristine (.4) rock");
  assert.ok(flip.some((i) => i.id === "T4_ORE_LEVEL1@1"), "enchanted ore flip row should still exist (control)");
  assert.ok(flip.some((i) => i.id === "T6_ROCK"), "plain stone flip row should exist");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
