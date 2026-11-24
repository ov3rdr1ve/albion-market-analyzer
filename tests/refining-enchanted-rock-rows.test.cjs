/**
 * Test: enchanted-raw-rock refining rows in the Refining/Transports table.
 *
 * There is NO enchanted stone block — enchanted raw rock (.1–.3) refines into
 * PLAIN blocks, yielding 2^e blocks per refine (wiki Granite Block: Uncommon/
 * Rare/Exceptional Granite → 2/4/8 Granite Block). TRANSPORT_ITEMS models each
 * of these as an alt-sourcing row for the SAME plain T{tier}_STONEBLOCK,
 * normalized to the table's per-1-output basis:
 *
 *   rawId          = T{tier}_ROCK_LEVEL{e}@{e}   (enchanted raw rock)
 *   refinedId      = T{tier}_STONEBLOCK          (plain block, the sold good)
 *   rawRatio       = baseRawRatio / 2^e          (enchanted rock per output block)
 *   secondaryMatId = T{tier-1}_STONEBLOCK        (plain lower block)
 *   outputPerRefine= 2^e
 *
 * Guards:
 *   - Rows exist for rock T4–T8 × enchant .1–.3 (no .4 / pristine rock).
 *   - Non-rock families get NO such alt rows (they enchant the refined product).
 *   - The plain-rock rows are unchanged (regression).
 *
 * Black-box: load real data.js and inspect TRANSPORT_ITEMS.
 *
 * Run: node tests/refining-enchanted-rock-rows.test.cjs
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

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Enchanted-rock refining rows\n");

const TIERS = [4, 5, 6, 7, 8];
const BASE_RATIO = { 4: 2, 5: 3, 6: 4, 7: 5, 8: 5 };
// The enchant-variant rows are the rock rows whose rawId is enchanted rock.
const enchRock = TRANSPORT_ITEMS.filter((r) => /^T\d+_ROCK_LEVEL\d+@\d+$/.test(r.rawId));
const byKey = new Map(enchRock.map((r) => [r.rawId, r]));

// ── 1. Exactly one row per rock T4–T8 × enchant .1–.3 (15 rows), no .4 ──
test("15 enchanted-rock rows: T4–T8 × .1–.3, none pristine (.4)", () => {
  assert.strictEqual(enchRock.length, 15, `expected 15, got ${enchRock.length}`);
  assert.ok(!enchRock.some((r) => /_LEVEL4@4$/.test(r.rawId)), "pristine rock row leaked");
});

// ── 2. Each row's shape: plain output, fractional raw, plain lower secondary ──
for (const t of TIERS) {
  for (let e = 1; e <= 3; e++) {
    const id = `T${t}_ROCK_LEVEL${e}@${e}`;
    test(`${id} → plain T${t}_STONEBLOCK, rawRatio ${BASE_RATIO[t]}/2^${e}, secondary T${t - 1}_STONEBLOCK`, () => {
      const row = byKey.get(id);
      assert.ok(row, `missing row ${id}`);
      assert.strictEqual(row.refinedId, `T${t}_STONEBLOCK`, "output must be the PLAIN block");
      assert.strictEqual(row.rawRatio, BASE_RATIO[t] / Math.pow(2, e));
      assert.strictEqual(row.secondaryMatId, `T${t - 1}_STONEBLOCK`);
      assert.strictEqual(row.secondaryMatCount, 1);
      assert.strictEqual(row.outputPerRefine, Math.pow(2, e));
      assert.strictEqual(row.enchantedRaw, e);
      assert.strictEqual(row.resourceType, "rock");
    });
  }
}

// ── 3. Enchanted rock is cheaper per block only when its unit price < 2^e × plain.
//        The fractional ratio encodes exactly that break-even (2^e fewer needed). ──
test("rawRatio halves each enchant level (encodes the 2^e yield)", () => {
  for (const t of TIERS) {
    const r1 = byKey.get(`T${t}_ROCK_LEVEL1@1`).rawRatio;
    const r2 = byKey.get(`T${t}_ROCK_LEVEL2@2`).rawRatio;
    const r3 = byKey.get(`T${t}_ROCK_LEVEL3@3`).rawRatio;
    assert.strictEqual(r2, r1 / 2, `T${t}: .2 ratio should be half of .1`);
    assert.strictEqual(r3, r2 / 2, `T${t}: .3 ratio should be half of .2`);
  }
});

// ── 4. No enchanted-rock rows below T4 (no enchanted raw resources under T4) ──
test("no enchanted-rock rows below T4", () => {
  assert.ok(!enchRock.some((r) => /^T[123]_/.test(r.rawId)), "sub-T4 enchanted rock leaked");
});

// ── 5. Refined side never enchants: no row produces an enchanted stoneblock ──
test("no row produces an enchanted stone block (refined stays flat)", () => {
  const bad = TRANSPORT_ITEMS.filter((r) => /_STONEBLOCK_LEVEL\d+@\d+$/.test(r.refinedId));
  assert.strictEqual(bad.length, 0, `enchanted block output leaked: ${bad.map((r) => r.refinedId).join(", ")}`);
});

// ── 6. Non-rock families get NO enchanted-RAW alt rows (they enchant the
//        refined product instead, so raw enchant === refined enchant) ──
test("non-rock rows never mix an enchanted raw with a plain refined output", () => {
  const mismatched = TRANSPORT_ITEMS.filter((r) => {
    if (r.resourceType === "rock") return false;
    const rawE = (r.rawId.match(/_LEVEL(\d+)@\d+$/) || [])[1] || "0";
    const refE = (r.refinedId.match(/_LEVEL(\d+)@\d+$/) || [])[1] || "0";
    return rawE !== refE;
  });
  assert.strictEqual(mismatched.length, 0, `mismatched: ${mismatched.map((r) => r.rawId).join(", ")}`);
});

// ── 7. Regression: the plain-rock rows are untouched (rawRatio integer, raw =
//        plain rock, output = plain block, no outputPerRefine marker) ──
test("plain stone rows unchanged (plain raw, integer ratio, no enchant marker)", () => {
  for (const t of TIERS) {
    const plain = TRANSPORT_ITEMS.find((r) => r.rawId === `T${t}_ROCK`);
    assert.ok(plain, `missing plain T${t}_ROCK row`);
    assert.strictEqual(plain.refinedId, `T${t}_STONEBLOCK`);
    assert.strictEqual(plain.rawRatio, BASE_RATIO[t]);
    assert.strictEqual(plain.outputPerRefine, undefined);
    assert.strictEqual(plain.enchantedRaw, undefined);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
