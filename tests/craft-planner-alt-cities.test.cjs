/**
 * Test: the planner keeps one row per (item, zone section) — the best
 * royal-side candidate AND the best Caerleon candidate — and remembers the
 * craft cities it passed over.
 *
 * _cpRowsForItem builds one candidate per craft city; dedupeCraftPlannerRows
 * keeps each section's highest-profit candidate and drops the rest. The
 * Caerleon section renders under the shared "Caerleon & Black Market Routes"
 * divider (renderTableData, js/sorting.js), the way the Farming table does.
 * Collapsing to one row per item hid the reported case: a winner that buys its
 * materials in Caerleon and hauls them out to a royal craft station, with the
 * Caerleon craft — no red-zone run at all — invisible a few thousand silver
 * behind it.
 *
 * A section with NO priced candidate contributes no PRICED row: its no-data
 * candidates stay gate-hidden in the default view (the profitability gate drops
 * them), but they survive in the row set as their own placeholder rows — Show
 * All and a matching search query reveal them (js/sorting.js reads the query
 * before the gate) — and donate their blocker summaries to the surviving
 * section's `altCityRows` — the priced ones first, then the no-data ones with
 * their blocker named — so a route the zone rules starved of prices (the
 * Caerleon twin of a bag, with Black/Red Zone Routes off) is still visible and
 * explained in the "best path" panel, and its full placeholder is one click of
 * Show All away. Summaries for the default view, whole placeholder rows for the
 * explicit ones — a planner row carries its entire sourcing tree and this table
 * is the app's largest.
 *
 * The rendering of that block lives in tests/craft-planner-paths-render.test.cjs.
 *
 * Black-box over the real dedupeCraftPlannerRows / craftCitySummary /
 * cpMatBuyCities, required straight out of js/craft-planner-dedupe.js (no DOM).
 * Synthetic rows only, no live API.
 *
 * Run: node tests/craft-planner-alt-cities.test.cjs
 */

const assert = require("assert");
const { dedupeCraftPlannerRows, craftCitySummary, cpMatBuyCities } =
  require("../js/craft-planner-dedupe.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// One candidate row, shaped like computeCraftPlannerRow's output.
function candidate(craftCity, combinedProfit, buyCities = [craftCity], o = {}) {
  return {
    item: { id: "T6_2H_AXE", name: "Great Axe" },
    craftCity,
    section: craftCity === "Caerleon" ? "caerleon" : "royal",
    combinedProfit,
    sellCity: craftCity === "Caerleon" ? "Black Market" : craftCity,
    sourcing: buyCities.map((city, i) => ({
      matId: `T6_MAT_${i}`, count: 8, isArtifact: false,
      sourcing: { source: "market", city },
    })),
    ...o,
  };
}
const noData = (craftCity, o = {}) => ({
  noData: true, item: { id: "T6_2H_AXE" }, craftCity,
  section: craftCity === "Caerleon" ? "caerleon" : "royal",
  noDataMats: [], noDataNoSell: false,
  ...o,
});

console.log("\n=== Craft Planner: one row per (item, section), alternatives kept ===");

// -- 1. One row per (item, section) -----------------------------------------
test("each section's best candidate survives as its own row", () => {
  const rows = dedupeCraftPlannerRows([
    candidate("Caerleon", 40_000), candidate("Martlock", 52_000), candidate("Brecilien", 11_000),
  ]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(
    rows.map((r) => [r.craftCity, r.section]).sort(),
    [["Caerleon", "caerleon"], ["Martlock", "royal"]]);
});

test("a section with no priced candidate keeps its placeholder row beside the winner", () => {
  // The dead section's row is a no-data placeholder the profitability gate hides
  // by default; Show All and a matching search reveal it (js/sorting.js), so it
  // has to be in the row set at all.
  const rows = dedupeCraftPlannerRows([candidate("Martlock", 52_000), noData("Caerleon")]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].craftCity, "Martlock");
  const twin = rows.find((r) => r.craftCity === "Caerleon");
  assert.strictEqual(twin.noData, true);
  assert.strictEqual(twin.section, "caerleon");
});

test("a priced candidate beats a no-data one, and the no-data twin stays", () => {
  const rows = dedupeCraftPlannerRows([noData("Caerleon"), candidate("Martlock", 1)]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows.find((r) => r.craftCity === "Martlock").noData, undefined);
  assert.strictEqual(rows.find((r) => r.craftCity === "Caerleon").noData, true);
});

test("different items keep their own rows", () => {
  const other = { ...candidate("Martlock", 9_000), item: { id: "T7_2H_AXE" } };
  const rows = dedupeCraftPlannerRows([candidate("Caerleon", 40_000), other]);
  assert.strictEqual(rows.length, 2);
});

// -- 2. The losers are attached to their section's winner --------------------
test("a section winner carries its same-section priced losers", () => {
  const rows = dedupeCraftPlannerRows([
    candidate("Caerleon", 40_000), candidate("Martlock", 52_000), candidate("Brecilien", 11_000),
  ]);
  const royal = rows.find((r) => r.section === "royal");
  assert.deepStrictEqual(royal.altCityRows.map((a) => a.craftCity), ["Brecilien"]);
});

test("same-section alternatives are sorted by profit, best first", () => {
  const rows = dedupeCraftPlannerRows([
    candidate("Martlock", 52_000), candidate("Brecilien", 11_000), candidate("Thetford", 30_000),
  ]);
  assert.deepStrictEqual(
    rows[0].altCityRows.map((a) => a.combinedProfit), [30_000, 11_000]);
});

test("the winner never lists itself", () => {
  const rows = dedupeCraftPlannerRows([candidate("Caerleon", 40_000), candidate("Martlock", 52_000)]);
  const royal = rows.find((r) => r.section === "royal");
  assert.ok(!royal.altCityRows.some((a) => a.craftCity === royal.craftCity));
  assert.deepStrictEqual(rows.find((r) => r.section === "caerleon").altCityRows, []);
});

test("a single candidate leaves an empty list, not undefined", () => {
  const rows = dedupeCraftPlannerRows([candidate("Martlock", 52_000)]);
  assert.deepStrictEqual(rows[0].altCityRows, []);
});

test("a priced winner keeps no-data candidates as alternatives, after the priced ones", () => {
  // Same-section no-data (a sparse royal) and the other section's dead twin
  // both surface on the survivor; priced losers sort first, no-data by city.
  const rows = dedupeCraftPlannerRows([
    candidate("Martlock", 52_000), candidate("Bridgewatch", 44_000),
    noData("Thetford"), noData("Caerleon"), noData("Brecilien"),
  ]);
  assert.deepStrictEqual(
    rows[0].altCityRows.map((a) => [a.craftCity, a.noData]),
    [["Bridgewatch", false], ["Brecilien", true], ["Caerleon", true], ["Thetford", true]]);
});

test("a no-data alternative reports its blocker", () => {
  const rows = dedupeCraftPlannerRows([
    candidate("Brecilien", 52_000),
    noData("Caerleon", { noDataMats: ["T6_CLOTH", "T6_LEATHER"] }),
  ]);
  const [alt] = rows[0].altCityRows;
  assert.strictEqual(alt.craftCity, "Caerleon");
  assert.deepStrictEqual(alt.noDataMats, ["T6_CLOTH", "T6_LEATHER"]);
  assert.strictEqual(alt.noDataNoSell, false);
});

test("when nothing prices anywhere, every section's placeholder survives", () => {
  // Each is a no-data placeholder with clickable prices; Show All and a matching
  // search reveal them all, so no section's blockers may be silently dropped.
  const rows = dedupeCraftPlannerRows([noData("Caerleon"), noData("Thetford")]);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(
    rows.map((r) => r.craftCity).sort(), ["Caerleon", "Thetford"]);
  rows.forEach((r) => assert.deepStrictEqual(r.altCityRows, []));
});

test("a losing same-section candidate's own row is still dropped from the board", () => {
  const rows = dedupeCraftPlannerRows([candidate("Bridgewatch", 40_000), candidate("Martlock", 52_000)]);
  assert.strictEqual(rows.length, 1);
});

// -- 3. The summary carries what the panel prints ---------------------------
test("the summary is fields, not the whole row (no sourcing tree)", () => {
  const s = craftCitySummary(candidate("Caerleon", 40_000));
  assert.deepStrictEqual(Object.keys(s).sort(),
    ["buyCities", "combinedProfit", "craftCity", "noData", "noDataMats", "noDataNoSell", "section", "sellCity"]);
  assert.strictEqual(s.sourcing, undefined);
  assert.strictEqual(s.item, undefined);
});

test("the summary keeps the craft city, section, profit and sell city", () => {
  const s = craftCitySummary(candidate("Caerleon", 40_000));
  assert.strictEqual(s.craftCity, "Caerleon");
  assert.strictEqual(s.section, "caerleon");
  assert.strictEqual(s.combinedProfit, 40_000);
  assert.strictEqual(s.sellCity, "Black Market");
});

test("missing fields degrade to empty/zero rather than undefined", () => {
  const s = craftCitySummary({ item: { id: "X" } });
  assert.deepStrictEqual(s, { craftCity: "", section: "", combinedProfit: 0, sellCity: "", buyCities: [],
    noData: false, noDataMats: [], noDataNoSell: false });
});

// -- 4. The material buy cities ---------------------------------------------
test("buy cities are the distinct market cities the materials came from", () => {
  assert.deepStrictEqual(
    cpMatBuyCities(candidate("Martlock", 1, ["Caerleon", "Martlock", "Caerleon"])),
    ["Caerleon", "Martlock"]);
});

test("a self-refined material with no chain leaves contributes no buy city", () => {
  const row = candidate("Martlock", 1, ["Martlock"]);
  row.sourcing.push({ matId: "T6_PLANKS", count: 8, sourcing: { source: "chain", city: null } });
  assert.deepStrictEqual(cpMatBuyCities(row), ["Martlock"]);
});

// A refined material buys nothing itself — its cities are down at the chain's
// leaves. Reading only the top level reported "no buy cities" for exactly the
// rows this block exists to explain: the reported Master's Cape refines BOTH its
// materials, so its alternative printed a bare profit with no materials line.
test("a chain material's leaf cities are collected", () => {
  const row = candidate("Brecilien", 1, ["Brecilien"]);
  row.sourcing.push({
    matId: "T6_CLOTH", count: 4,
    sourcing: { source: "chain", city: null, chain: { inputs: [
      { matId: "T6_FIBER", count: 4, sourcing: { source: "market", city: "Fort Sterling" } },
      { matId: "T5_CLOTH", count: 1, sourcing: { source: "market", city: "Caerleon" } },
    ] } },
  });
  assert.deepStrictEqual(cpMatBuyCities(row), ["Brecilien", "Fort Sterling", "Caerleon"]);
});

test("nested chains are walked to the bottom of the ladder", () => {
  const leaf = (city) => ({ source: "market", city });
  const row = { sourcing: [{ matId: "T6_CLOTH", count: 4, sourcing: {
    source: "chain", chain: { inputs: [
      { matId: "T6_FIBER", sourcing: leaf("Lymhurst") },
      { matId: "T5_CLOTH", sourcing: { source: "chain", chain: { inputs: [
        { matId: "T5_FIBER", sourcing: leaf("Martlock") },
        { matId: "T4_CLOTH", sourcing: { source: "chain", chain: { inputs: [
          { matId: "T4_FIBER", sourcing: leaf("Thetford") },
        ] } } },
      ] } } },
    ] } } }] };
  assert.deepStrictEqual(cpMatBuyCities(row), ["Lymhurst", "Martlock", "Thetford"]);
});

test("a city repeated across leaves is listed once, first-seen order", () => {
  const leaf = (city) => ({ source: "market", city });
  const row = { sourcing: [{ sourcing: { source: "chain", chain: { inputs: [
    { sourcing: leaf("Caerleon") }, { sourcing: leaf("Caerleon") },
    { sourcing: leaf("Bridgewatch") }, { sourcing: leaf("Caerleon") },
  ] } } }] };
  assert.deepStrictEqual(cpMatBuyCities(row), ["Caerleon", "Bridgewatch"]);
});

test("a transmuted leaf reports the city its cheaper node was bought in", () => {
  const row = { sourcing: [{ matId: "T6_ORE", sourcing: {
    source: "transmute", city: "Thetford", transmute: { startCity: "Thetford" } } }] };
  assert.deepStrictEqual(cpMatBuyCities(row), ["Thetford"]);
});

test("a chain with no priced leaf contributes nothing", () => {
  const row = { sourcing: [{ sourcing: { source: "chain", chain: { inputs: [
    { sourcing: { source: "chain", chain: { inputs: [] } } },
  ] } } }] };
  assert.deepStrictEqual(cpMatBuyCities(row), []);
});

test("a row with no sourcing has no buy cities", () => {
  assert.deepStrictEqual(cpMatBuyCities({}), []);
});

// -- 5. The reported case ---------------------------------------------------
test("a Caerleon craft that prices gets its own section row, not a summary line", () => {
  const rows = dedupeCraftPlannerRows([
    candidate("Brecilien", 52_000, ["Caerleon"]),
    candidate("Caerleon", 48_000, ["Caerleon"]),
  ]);
  assert.strictEqual(rows.length, 2);
  const caer = rows.find((r) => r.section === "caerleon");
  assert.strictEqual(caer.craftCity, "Caerleon");
  assert.deepStrictEqual(cpMatBuyCities(caer), ["Caerleon"]);
  const royal = rows.find((r) => r.section === "royal");
  assert.strictEqual(royal.craftCity, "Brecilien");
  assert.strictEqual(royal.combinedProfit - caer.combinedProfit, 4_000);
  assert.deepStrictEqual(royal.altCityRows, []);
});

test("a starved Caerleon twin stays visible as the royal row's alternative", () => {
  const rows = dedupeCraftPlannerRows([
    candidate("Brecilien", 52_000, ["Caerleon"]),
    noData("Caerleon", { noDataMats: ["T6_CLOTH"] }),
  ]);
  // The twin is ALSO its own (gate-hidden) placeholder row now — with its
  // blocker intact so the placeholder's clickable prices name what is missing.
  assert.strictEqual(rows.length, 2);
  const twin = rows.find((r) => r.craftCity === "Caerleon");
  assert.deepStrictEqual(twin.noDataMats, ["T6_CLOTH"]);
  const [alt] = rows[0].altCityRows;
  assert.strictEqual(alt.craftCity, "Caerleon");
  assert.strictEqual(alt.noData, true);
  assert.deepStrictEqual(alt.noDataMats, ["T6_CLOTH"]);
});

test("a dead twin's no-data siblings in a PRICED section stay summary-only", () => {
  // Thetford/Brecilien are same-section losers of a section that priced (the
  // Martlock winner): whole rows would duplicate a priced row's panel, so they
  // remain alternatives only.
  const rows = dedupeCraftPlannerRows([
    candidate("Martlock", 52_000),
    noData("Thetford"), noData("Brecilien"),
  ]);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(
    rows[0].altCityRows.map((a) => a.craftCity).sort(), ["Brecilien", "Thetford"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
