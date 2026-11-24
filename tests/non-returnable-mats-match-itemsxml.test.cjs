/**
 * Test: the non-returnable-material classifiers agree with items.xml.
 *
 * The game marks a recipe line the Resource Return Rate never gives back with
 * `maxreturnamount="0"`:
 *
 *   <craftingrequirements silver="0" time="2.5" craftingfocus="8042">
 *     <craftresource uniquename="T8_CLOTH" count="8" />
 *     <craftresource uniquename="T8_LEATHER" count="8" />
 *     <craftresource uniquename="T4_SKILLBOOK_STANDARD" count="1" maxreturnamount="0" />
 *
 * The app answers the same question with a pattern list —
 * `isNonReturnableCraftMat` (js/render-crafting.js) and its planner twin
 * `_cpNonReturnable` (js/craft-planner-pricing.js) — because the classifier runs
 * per material id in the hot render path, not per recipe line. That is fine as
 * long as the patterns match the game files, which is what this test pins.
 *
 * Being non-returnable matters three times over, so a miss is not cosmetic:
 *   • RRR: the material is consumed in full, so a returnable-by-mistake input
 *     gets a phantom discount on the craft's cost;
 *   • station fee: the fee is billed off the crafted item's itemvalue, which the
 *     app estimates from the non-artifact material count — and these inputs carry
 *     no itemvalue at all (T4_SKILLBOOK_STANDARD has no `itemvalue` attribute);
 *   • journal fame: fame = non-artifact material amount × tier multiplier, so a
 *     miscounted input invents fame the craft never awarded.
 *
 * The Tome of Insight (T4_SKILLBOOK_STANDARD, in the T4-T8 Satchels of Insight)
 * was the one material the patterns missed.
 *
 * Black-box: parses items.xml and drives the two classifiers by id. No live API.
 *
 * Run: node tests/non-returnable-mats-match-itemsxml.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

// Lift each classifier out of its file — both are pure, and their hosts are
// browser scripts that touch the DOM at load.
function lift(file, name) {
  const src = read(file);
  const m = src.match(new RegExp(`function ${name}\\(matId\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found in ${file}`);
  return new Function(`${m[0]}\nreturn ${name};`)();
}
const isNonReturnableCraftMat = lift("js/render-crafting.js", "isNonReturnableCraftMat");
const cpNonReturnable = lift("js/craft-planner-pricing.js", "_cpNonReturnable");

const xml = read("data/dumps/items.xml");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Non-returnable mats vs items.xml\n");

// ── the two classifiers must never disagree ────────────────────────────────
console.log("=== the planner twin agrees with the Crafting table ===");

// Every distinct material id that appears in any craftresource line.
const allMats = [...new Set(
  [...xml.matchAll(/<craftresource uniquename="([^"]+)"/g)].map((m) => m[1]),
)];

test(`both classifiers answer alike for all ${allMats.length} craft materials`, () => {
  const differ = allMats.filter((id) => !!isNonReturnableCraftMat(id) !== !!cpNonReturnable(id));
  // The planner's list is deliberately shorter on the COMBINE bases (base capes,
  // SETn armor): the planner has no combine rows, so those never reach it.
  const unexpected = differ.filter((id) =>
    !/_CAPEITEM_/.test(id) && !/^T\d+_CAPE(@\d+)?$/.test(id) &&
    !/^T\d+_(HEAD|ARMOR|SHOES)_(CLOTH|LEATHER|PLATE)_SET[123](@\d+)?$/.test(id));
  assert.deepStrictEqual(unexpected, [], `classifiers disagree on: ${unexpected.join(", ")}`);
});

// ── every maxreturnamount="0" line the app can see is classified ───────────
console.log("\n=== items.xml maxreturnamount=\"0\" is honored ===");

// Materials that carry the flag on EVERY line they appear in. A material that
// appears both with and without it (the faction tokens, the Royal sigils) is
// per-recipe and cannot be answered by an id-only classifier — excluded here.
const withFlag = new Set(
  [...xml.matchAll(/<craftresource uniquename="([^"]+)"[^>]*maxreturnamount="0"/g)].map((m) => m[1]),
);
const lineCount = (id) =>
  (xml.match(new RegExp(`<craftresource uniquename="${id}"`, "g")) || []).length;
const flaggedCount = (id) =>
  (xml.match(new RegExp(`<craftresource uniquename="${id}"[^>]*maxreturnamount="0"`, "g")) || []).length;
const alwaysFlagged = [...withFlag].filter((id) => lineCount(id) === flaggedCount(id));

// …and narrowed again to the materials the APP actually consumes. items.xml
// carries flagged inputs for a great deal the app never prices — dungeon map
// tokens, mount skin upgrades, vanity unlocks — and a classifier that has never
// been asked about them cannot be wrong about them. The app's catalogues name
// their materials as `matId: "…"` / `uniquename` in js/, so scan for that.
const catalogSrc = fs.readdirSync(path.join(ROOT, "js"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => read(path.join("js", f)))
  .join("\n");
const usedByApp = new Set(
  [...catalogSrc.matchAll(/matId:\s*"([A-Z0-9_@]+)"|"matId":\s*"([A-Z0-9_@]+)"/g)]
    .map((m) => (m[1] || m[2]).replace(/@\d+$/, "")),
);
const appFlagged = alwaysFlagged.filter((id) => usedByApp.has(id));

test(`every flagged material the app consumes is non-returnable (${appFlagged.length} ids)`, () => {
  assert.ok(appFlagged.length > 20, `expected a real sample, got ${appFlagged.length}`);
  const missed = appFlagged.filter((id) => !isNonReturnableCraftMat(id));
  assert.deepStrictEqual(missed, [], `RRR would wrongly return: ${missed.join(", ")}`);
});

test("the same holds for the planner's classifier", () => {
  const missed = appFlagged.filter((id) => !cpNonReturnable(id) &&
    !/_CAPEITEM_/.test(id) && !/^T\d+_CAPE$/.test(id) &&
    !/^T\d+_(HEAD|ARMOR|SHOES)_(CLOTH|LEATHER|PLATE)_SET[123]$/.test(id));
  assert.deepStrictEqual(missed, [], `planner would wrongly return: ${missed.join(", ")}`);
});

// ── the Tome of Insight, the material this test was written for ────────────
console.log("\n=== Tome of Insight (Satchels of Insight) ===");

test("items.xml really does flag the tome, on every satchel tier", () => {
  const lines = [...xml.matchAll(
    /<craftresource uniquename="T4_SKILLBOOK_STANDARD"[^>]*\/>/g)].map((m) => m[0]);
  assert.ok(lines.length > 0, "no tome recipe line found — has items.xml been refreshed?");
  lines.forEach((l) => assert.ok(/maxreturnamount="0"/.test(l), `unflagged tome line: ${l}`));
});

test("the tome carries no itemvalue, so it bills no station-fee nutrition", () => {
  const decl = xml.match(/uniquename="T4_SKILLBOOK_STANDARD"[^>]*>/);
  assert.ok(decl, "T4_SKILLBOOK_STANDARD not declared in items.xml");
  assert.ok(!/itemvalue="/.test(decl[0]),
    "the tome now HAS an itemvalue — the station fee needs to count it: " + decl[0]);
});

[
  ["Crafting table", isNonReturnableCraftMat],
  ["Crafting Planner", cpNonReturnable],
].forEach(([label, fn]) => {
  test(`${label}: the tome is non-returnable`, () => {
    assert.ok(fn("T4_SKILLBOOK_STANDARD"), "T4_SKILLBOOK_STANDARD must not be RRR-returnable");
  });
});

test("the satchel's actual resources stay returnable", () => {
  ["T8_CLOTH", "T8_LEATHER", "T4_CLOTH", "T4_LEATHER"].forEach((id) => {
    assert.ok(!isNonReturnableCraftMat(id), `${id} must still be returned by RRR`);
    assert.ok(!cpNonReturnable(id), `${id} must still be returned by RRR (planner)`);
  });
});

// ── no over-claiming: a returnable material must not be caught ─────────────
console.log("\n=== nothing returnable is wrongly excluded ===");

test("refined resources, raws and journals are all returnable", () => {
  ["T4_PLANKS", "T8_METALBAR", "T6_STONEBLOCK", "T5_ORE", "T8_WOOD",
    "T8_JOURNAL_TOOLMAKER_EMPTY", "T4_CLOTH_LEVEL2", "T8_FISH_SALTWATER_ALL_BOSS_SHARK",
  ].forEach((id) => {
    assert.ok(!isNonReturnableCraftMat(id), `${id} should be returnable`);
    assert.ok(!cpNonReturnable(id), `${id} should be returnable (planner)`);
  });
});

test("the known non-returnable families are still caught", () => {
  ["T4_ARTEFACT_2H_NATURESTAFF_KEEPER", "QUESTITEM_TOKEN_ROYAL_T6",
    "T1_FACTION_FOREST_TOKEN_1", "UNIQUE_GVGTOKEN_GENERIC",
    "T3_ALCHEMY_RARE_PANTHER",
  ].forEach((id) => {
    assert.ok(isNonReturnableCraftMat(id), `${id} should be non-returnable`);
    assert.ok(cpNonReturnable(id), `${id} should be non-returnable (planner)`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
