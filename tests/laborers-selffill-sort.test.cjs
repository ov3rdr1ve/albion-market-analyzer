/**
 * Test: the "Best Journal Play" column sorts.
 *
 * The header has been keyed five ways; each move fixed a real problem:
 *
 *   1. selfFillPerHour — the self-fill loop's silver per hour of GATHERING. The
 *      crafting laborers (Blacksmith, Fletcher, Imbuer, Tinker) have no hourly
 *      rate at all — crafting has no cast time — so every one of them keyed 0,
 *      the comparator tied on all of them, and the stable sort left the previous
 *      order untouched: the column looked like it sorted by whatever had been
 *      clicked before it.
 *   2. selfFillPerFame — silver per point of journal fame, a unit both kinds of
 *      row appeared to carry.
 *   3. journalPlay keyed on max(buy-filled, self-fill) in silver per 22h laborer
 *      cycle. That let the two plays be ranked head to head, which is the right
 *      question only when LABORERS are the bottleneck.
 *   4. journalPlay keyed on the self-fill FAME rate. With laborers to spare the
 *      two plays are not rivals (you run both), and a max() across two different
 *      units was meaningless arithmetic besides.
 *   5. journalPlay keyed on the self-fill rate IN EACH FAMILY'S OWN UNIT, BANDED
 *      — where it is now. Fame turned out not to be one unit either: a journal's
 *      fame requirement doubles per tier while a gatherer's fame rate rises only
 *      ~1.3-1.9× per tier, so a T3 row and a T8 row with the same silver per
 *      fame are not worth the same, and the T8 one is worth ~6.8× more per hour.
 *      Gathering rows now key silver per HOUR, crafting rows silver per CRAFT,
 *      and the two are placed in DISJOINT bands so they never interleave. Rates
 *      are net of the fame's market price, so they can be negative — which is
 *      why "no play" is a floor beneath everything and not 0.
 *
 * selfFillPerCycle, selfFillPerHour, selfFillPerCraft and selfFillPerFame all
 * remain keyed: each answers a real question and is still shown on the row or in
 * its tooltip.
 *
 * Loads the REAL getSortValue (js/sorting.js) over the REAL per-table branches
 * (js/sorting-values-tables.js) and the REAL banding (js/laborer-journal-play.js),
 * so the wiring is exercised, not mirrored.
 *
 * Run: node tests/laborers-selffill-sort.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8")
  .replace(/if \(typeof module[\s\S]*$/, "");

const stubs = `
const localStorage = { getItem: () => null, setItem: () => {} };
const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
const window = { scrollTo() {}, scrollY: 0 };
const SETUP_FEE = 0.025;
function getItemDisplayName(id) { return id; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function tx(en) { return en; }
const ITEM_NAMES_MAP = {};
`;
const mod = new Module("laborers-selffill-sort-test");
mod._compile(
  stubs + read("js/laborer-journal-play.js") + read("js/sorting-values-tables.js") + read("js/sorting.js")
    + "\nmodule.exports = { getSortValue, journalPlayValue };",
  "sorting.js",
);
const { getSortValue, journalPlayValue } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const TID = "laborers-table";
const BID = "buildings-table";

// A crafting row: crafts, no hours — silverPerHour never exists on these.
// The rate is the PAYLOAD and is always positive — a laborer returns loot
// whatever the journal market does, and nothing is bought to run the loop. Only
// the comparison against selling the journal (`net*`) can go below zero, and it
// is not what this column keys on.
const craftSelfFill = (perCraft, perCycle) => ({
  found: true, kind: "craft", silverPerCraft: perCraft, netSilverPerCraft: perCraft - 1000,
  profitPerCycle: perCycle, famePriced: true,
});
const craftRow = (perCraft, perCycle) => {
  const selfFill = craftSelfFill(perCraft, perCycle);
  return {
    journalPlayRank: journalPlayValue(null, selfFill),
    selfFillPerCraft: perCraft,
    selfFillPerCycle: perCycle,
    selfFillPerHour: 0,
    selfFill,
  };
};
// A gathering row: hours as well, because it is priced in them.
const gatherSelfFill = (perHour, perCycle, perFame) => ({
  found: true, kind: "gather", silverPerHour: perHour, netSilverPerHour: perHour - 1000,
  silverPerFame: perFame, netSilverPerFame: perFame - 1, profitPerCycle: perCycle, famePriced: true,
});
const gatherRow = (perHour, perCycle, perFame = 4.2) => {
  const selfFill = gatherSelfFill(perHour, perCycle, perFame);
  return {
    journalPlayRank: journalPlayValue(null, selfFill),
    selfFillPerHour: perHour,
    selfFillPerCraft: 0,
    selfFillPerFame: perFame,
    selfFillPerCycle: perCycle,
    selfFill,
  };
};
const noPlayRow = () => ({
  journalPlayRank: journalPlayValue(null, { found: false, reason: "no-fame-model" }),
  selfFillPerHour: 0, selfFillPerCraft: 0, selfFillPerCycle: 0, selfFillPerFame: 0,
  selfFill: { found: false, reason: "no-fame-model" },
});

const desc = (rows) => rows.slice().sort((a, b) => getSortValue(b, "journalPlay", TID) - getSortValue(a, "journalPlay", TID));

console.log("Laborers — Best Journal Play column sorting tests\n");

test("a crafting row keys its own per-craft rate, not 0", () => {
  const rows = desc([{ id: "lo", ...craftRow(40000, 180000) }, { id: "hi", ...craftRow(90000, 910000) }]);
  assert.deepStrictEqual(rows.map((r) => r.id), ["hi", "lo"]);
});

test("a gathering row keys its own per-hour rate", () => {
  const rows = desc([{ id: "slow", ...gatherRow(20000, 1100000) }, { id: "fast", ...gatherRow(91000, 640000) }]);
  assert.deepStrictEqual(rows.map((r) => r.id), ["fast", "slow"]);
});

test("missing / no-play rows key a number, never NaN or undefined", () => {
  [{}, { journalPlayRank: null }, { journalPlayRank: undefined }].forEach((row) => {
    const v = getSortValue(row, "journalPlay", TID);
    assert.ok(Number.isFinite(v), `keyed ${v}`);
  });
});

// The whole point of the band: a per-craft figure and a per-hour figure have
// overlapping ranges and are not comparable, so they must never interleave.
test("gathering and crafting rows are BANDED, not interleaved", () => {
  const rows = desc([
    { id: "craft-lo", ...craftRow(40000, 180000) },
    { id: "gather-lo", ...gatherRow(2000, 640000) },
    { id: "craft-hi", ...craftRow(900000, 910000) },
    { id: "gather-hi", ...gatherRow(91000, 300000) },
    { id: "nodata", ...noPlayRow() },
  ]);
  assert.deepStrictEqual(rows.map((r) => r.id),
    ["gather-hi", "gather-lo", "craft-hi", "craft-lo", "nodata"]);
});

// Rates are payloads, so they never go below zero — a row whose journal sells
// for more than the laborer returns is still a real play, and sorts on what it
// pays. Only a row with no fill model at all drops beneath them all.
test("a thin rate sorts below every fatter one and above no-model", () => {
  const rows = desc([
    { id: "thin", ...gatherRow(1, 100) },
    { id: "fat", ...gatherRow(50000, 100) },
    { id: "nodata", ...noPlayRow() },
  ]);
  assert.deepStrictEqual(rows.map((r) => r.id), ["fat", "thin", "nodata"]);
});

// The journal's market price moves the comparison, never the ranking.
test("the sort ignores the comparison against selling the journal", () => {
  const beatsMarket = { found: true, kind: "gather", silverPerHour: 50000, netSilverPerHour: 40000, famePriced: true, profitPerCycle: 100 };
  const losesToMarket = { found: true, kind: "gather", silverPerHour: 50000, netSilverPerHour: -900000, famePriced: true, profitPerCycle: 100 };
  assert.strictEqual(journalPlayValue(null, beatsMarket), journalPlayValue(null, losesToMarket));
});

// The two rankings genuinely disagree, and the column follows the RATE — what
// your own effort buys — not what one journal happens to pay the laborer.
test("rate and per-cycle can disagree, and the column follows the RATE", () => {
  const thrifty = { id: "thrifty", ...craftRow(300000, 200000) };  // few presses, great per press
  const rich    = { id: "rich",    ...craftRow(40000, 900000) };   // huge journal, poor per press
  const rows = [thrifty, rich];
  const byRate  = desc(rows);
  const byCycle = rows.slice().sort((a, b) => getSortValue(b, "selfFillPerCycle", TID) - getSortValue(a, "selfFillPerCycle", TID));
  assert.deepStrictEqual(byRate.map((r) => r.id), ["thrifty", "rich"]);
  assert.deepStrictEqual(byCycle.map((r) => r.id), ["rich", "thrifty"]);
});

test("regression: the raw per-hour key still leaves every crafting row tied at 0", () => {
  const rows = [craftRow(90000, 910000), craftRow(40000, 180000), craftRow(60000, 400000)];
  const byHour = rows.map((r) => getSortValue(r, "selfFillPerHour", TID));
  assert.deepStrictEqual(byHour, [0, 0, 0], "crafting rows have no hourly rate — this is why it is not the header's key");
  const ranked = desc(rows.map((r, i) => ({ id: i, ...r })));
  assert.deepStrictEqual(ranked.map((r) => r.id), [0, 2, 1], "…but they do have a per-craft rate");
});

test("the reported per-cycle, per-hour, per-craft and per-fame keys are still readable", () => {
  const g = gatherRow(120000, 640000, 4.2);
  assert.strictEqual(getSortValue(g, "selfFillPerFame", TID), 4.2);
  assert.strictEqual(getSortValue(g, "selfFillPerCycle", TID), 640000);
  assert.strictEqual(getSortValue(g, "selfFillPerHour", TID), 120000);
  assert.strictEqual(getSortValue(craftRow(90000, 910000), "selfFillPerCraft", TID), 90000);
});

test("ascending and descending are exact mirrors", () => {
  const rows = [craftRow(100000, 100000), gatherRow(900000, 900000), craftRow(300000, 300000)];
  const d = rows.slice().sort((a, b) => getSortValue(b, "journalPlay", TID) - getSortValue(a, "journalPlay", TID));
  const a = rows.slice().sort((x, y) => getSortValue(x, "journalPlay", TID) - getSortValue(y, "journalPlay", TID));
  assert.deepStrictEqual(a.map((r) => r.journalPlayRank), d.map((r) => r.journalPlayRank).reverse());
});

// ── the Building Costs twin, which renders the self-fill cell on its own ─────

test("the buildings column keys through the same banding as the laborers one", () => {
  const craft = { bestJournal: { selfFill: craftSelfFill(90000, 310000) } };
  const gather = { bestJournal: { selfFill: gatherSelfFill(2000, 310000, 4.2) } };
  assert.strictEqual(getSortValue(craft, "selfFill", BID), journalPlayValue(null, craft.bestJournal.selfFill));
  assert.ok(getSortValue(gather, "selfFill", BID) > getSortValue(craft, "selfFill", BID),
    "a gathering crew must band above a crafting one here too");
});

test("a buildings row with no crew sinks beneath every real play", () => {
  const none = getSortValue({ bestJournal: null }, "selfFill", BID);
  const alsoNone = getSortValue({ bestJournal: { selfFill: null } }, "selfFill", BID);
  // Rates are payloads, so the worst real play is a hair above zero.
  const worst = getSortValue({ bestJournal: { selfFill: craftSelfFill(0.0001, 0) } }, "selfFill", BID);
  assert.strictEqual(none, alsoNone);
  assert.ok(none < worst, `no crew (${none}) must sort beneath the worst real play (${worst})`);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
