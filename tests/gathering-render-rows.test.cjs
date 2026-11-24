/**
 * Test: renderGatheringTable produces correctly-priced, comparable rows.
 *
 * Black-box / TLD: load the real resource-names + calculations + data-gathering
 * + render-gathering with stubbed DOM/pricing helpers and synthetic marketData,
 * capture the rows the renderer hands to renderTableData, and assert the
 * economics + rendered cells. No DOM, no live API.
 *
 *   land  silver/hour = blended net/unit × GATHER_UNITS_PER_HOUR[tier], where the
 *         blend folds in the enchanted (.1–.4) variants (stone stays flat).
 *   fish  one merged row per tier: base = better-priced common (fresh vs salt),
 *         with the biome RARE share-blended in via calcFishingEconomics.
 *   Every Silver/kg & Silver/Hour is ALL-IN — NO "+x% ench" badge anywhere.
 *
 * Run: node tests/gathering-render-rows.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// DOM / market helper stubs. findBestSellCity picks the highest `.sell` across
// the allowed cities; everything else is inert capture/formatting. formatSilver,
// getProfitClass, getResourceWeightKg, calcGatheringEconomics, calcFishingEconomics,
// PREMIUM_TAX come from the REAL calculations.js included below.
const stubs = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
function getOrderType(){ return "instant"; }          // MIN_VOLUME = 0
function isBlackRedZoneEnabled(){ return true; }        // single section over SELL_CITIES
function isValidSourceCity(buyCity, craftCity) {
  if (!buyCity || !craftCity) return false;
  if (isBlackRedZoneEnabled()) return true;
  if (BLACK_ZONE_CITIES.includes(buyCity) || BLACK_ZONE_CITIES.includes(craftCity)) return false;
  return (buyCity === "Caerleon") === (craftCity === "Caerleon");
}
function getOverridePrice(){ return null; }
function getOverrideVolume(){ return null; }
function getItemDisplayName(id){ const s = resourceShortName(id); return s || id; }
function resourceAliasSpan(){ return ""; }
function findBestSellCity(marketData, itemId, cities){
  const d = marketData[itemId] || {};
  let best = { city: null, price: 0 };
  cities.forEach((c) => {
    const p = d[c] && d[c].sell ? d[c].sell : 0;
    if (p > best.price) best = { city: c, price: p };
  });
  return best;
}
function priceTd(price, itemId, city){ return "<td data-item-id='"+itemId+"' data-city='"+(city||"")+"'>"+price+"</td>"; }
function volTd(v, itemId, city){ return "<td class='vol'>"+v+"</td>"; }
// The "+" column cell (js/table-add-button.js) — every row template emits it.
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.rawId||"") + "|" + (row.section||""); }
const captured = { rows: [], html: [] };
function renderTableData(id, rows, fmt){
  captured.tableId = id;
  captured.rows = rows;
  captured.html = rows.map((r,i) => { try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } });
}
`;

const sources =
  J("resource-names.js") + J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + J("data-gathering.js") + J("render-gathering.js");

globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
const mod = new Module("gathering-render");
mod._compile(
  stubs + sources +
    "\nmodule.exports = { renderGatheringTable, captured, trackCreatureLabel, GATHER_UNITS_PER_HOUR, FISH_UNITS_PER_HOUR, FISH_RARE_SHARE, FISH_WEIGHT_KG, FISH_RARE_WEIGHT_KG, calcTrackingEconomics, REMAINS_WEIGHT_KG, TRACK_ARTIFACT_WEIGHT_KG, TRACK_REMAINS_PER_KILL, TRACK_ARTIFACT_SHARE, TRACK_KILLS_PER_HOUR, TRACK_RARE_QUARRY_SHARE, TRACK_BM_LOOT_GROSS };",
  "gathering-render.js",
);
const { renderGatheringTable, captured, trackCreatureLabel, GATHER_UNITS_PER_HOUR, FISH_UNITS_PER_HOUR, FISH_RARE_SHARE, FISH_WEIGHT_KG, FISH_RARE_WEIGHT_KG, calcTrackingEconomics, REMAINS_WEIGHT_KG, TRACK_ARTIFACT_WEIGHT_KG, TRACK_REMAINS_PER_KILL, TRACK_ARTIFACT_SHARE, TRACK_KILLS_PER_HOUR, TRACK_RARE_QUARRY_SHARE, TRACK_BM_LOOT_GROSS } = mod.exports;

// Synthetic market. Land: T4 ore @200 (no enchant data → flat); T8 hide @1500;
// T2 rock absent → no-data row; T6 ore @300 + enchanted → blend; T6 rock @120 flat.
// Fishing: T5 freshwater common @2000 + a Forest rare @9000 → freshwater base with
// the rare folded in; T6 saltwater common @3000 (no rare priced) → saltwater base,
// pure common. Seaweed @40.
const marketData = {
  T4_ORE:  { Thetford: { sell: 200, volume_24h: 90 } },
  T8_HIDE: { Martlock: { sell: 1500, volume_24h: 40 } },
  T6_ORE:  { Bridgewatch: { sell: 300, volume_24h: 80 } },
  "T6_ORE_LEVEL1@1": { Bridgewatch: { sell: 1200, volume_24h: 60 } },
  "T6_ORE_LEVEL2@2": { Bridgewatch: { sell: 4000, volume_24h: 30 } },
  "T6_ORE_LEVEL3@3": { Bridgewatch: { sell: 12000, volume_24h: 12 } },
  T6_ROCK: { Bridgewatch: { sell: 120, volume_24h: 70 } },
  "T5_FISH_FRESHWATER_ALL_COMMON": { Martlock: { sell: 2000, volume_24h: 55 } },
  "T5_FISH_FRESHWATER_FOREST_RARE": { Thetford: { sell: 9000, volume_24h: 20 } },
  "T6_FISH_SALTWATER_ALL_COMMON": { Caerleon: { sell: 3000, volume_24h: 40 } },
  "T1_SEAWEED": { Lymhurst: { sell: 40, volume_24h: 200 } },
  // Tracking T5: werewolf remains the best-paying creature; Avalon the best artifact
  // faction → remains staple + artifact + BM loot folded in.
  "T5_ALCHEMY_RARE_WEREWOLF": { Caerleon: { sell: 2500, volume_24h: 35 } },
  "T5_ALCHEMY_RARE_PANTHER": { Martlock: { sell: 1800, volume_24h: 20 } },
  "T5_ARTEFACT_2H_SHAPESHIFTER_AVALON": { Caerleon: { sell: 60000, volume_24h: 12 } },
  "T5_ARTEFACT_2H_SHAPESHIFTER_MORGANA": { Lymhurst: { sell: 8000, volume_24h: 8 } },
  // Tracking T3: only a remains priced, no T4 artifact → remains + BM loot, no artifact.
  "T3_ALCHEMY_RARE_PANTHER": { Caerleon: { sell: 700, volume_24h: 50 } },
};

renderGatheringTable(marketData);
const html = captured.html.join("\n");
const rowOf = (id) => captured.rows.find((r) => r.rawId === id);
// The stub above selects "instant", so the sale fills a standing buy order:
// no sell-order setup fee, just the 4% Premium sales tax. Under Market Orders
// PREMIUM_TAX would be 0.065 (4% + the 2.5% setup fee) instead.
const PT = 0.04;
const net = (g) => g * (1 - PT);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (e) { failed++; console.log(`  FAIL: ${name}\n    ${e.message}`); }
}

console.log("Gathering render rows\n");

test("renders into #gathering-table, 49 comparable rows (35 land + 7 fishing + seaweed + 3 Ancient Lands + 3 tracking)", () => {
  assert.strictEqual(captured.tableId, "gathering-table");
  assert.strictEqual(captured.rows.length, 49);
});

test("the per-row formatter never throws", () =>
  assert.ok(!html.includes("ERR:"), html));

test("bonus is folded into the number: a compact 'incl.' cue, never the old '+x% ench' badge", () => {
  assert.ok(!/\+\d+% ench/.test(html), "the misleading '+x% ench' badge must be gone");
  assert.ok(/incl\. (ench|rare)/.test(html), "rows with a folded-in bonus show the compact 'incl.' cue");
});

console.log("\n— land rows —");

test("T4 ore row: net/unit, silver/kg and silver/hour all correct", () => {
  const r = rowOf("T4_ORE");
  assert.ok(r, "T4_ORE row missing");
  assert.strictEqual(r.sellCity, "Thetford");
  assert.strictEqual(r.sellPrice, 200);
  assert.ok(Math.abs(r.netPerUnit - net(200)) < 1e-6, `net ${r.netPerUnit}`);
  assert.ok(Math.abs(r.weightKg - 0.51) < 1e-9, `weight ${r.weightKg}`);
  assert.ok(Math.abs(r.silverPerKg - net(200) / 0.51) < 1e-6, `silver/kg ${r.silverPerKg}`);
  assert.ok(Math.abs(r.silverPerHour - net(200) * GATHER_UNITS_PER_HOUR[4]) < 1e-6, `silver/hour ${r.silverPerHour}`);
});

test("T4 ore renders short name + Mining badge + clickable price cell", () => {
  const cell = captured.html[captured.rows.indexOf(rowOf("T4_ORE"))];
  assert.ok(cell.includes("T4 ore"), "missing short name");
  assert.ok(cell.includes("[Mining]"), "missing profession badge");
  assert.ok(cell.includes("data-item-id='T4_ORE'"), "missing price cell");
});

test("T8 hide uses the heavier weight → lower silver/kg than its net/unit", () => {
  const r = rowOf("T8_HIDE");
  assert.ok(Math.abs(r.weightKg - 2.56) < 1e-9, `weight ${r.weightKg}`);
  assert.ok(Math.abs(r.silverPerKg - net(1500) / 2.56) < 1e-6);
  assert.ok(r.silverPerKg < r.netPerUnit, "T8 weight >1kg should pull silver/kg below net/unit");
});

test("no-data resource (T2_ROCK) → zero value row, weight still shown, em dash", () => {
  const r = rowOf("T2_ROCK");
  assert.ok(r, "T2_ROCK row missing");
  assert.strictEqual(r.sellPrice, 0);
  assert.strictEqual(r.netPerUnit, 0);
  assert.strictEqual(r.silverPerHour, 0);
  assert.ok(r.weightKg > 0, "weight should still be known");
  assert.ok(captured.html[captured.rows.indexOf(r)].includes("—"), "no-data cells show an em dash");
});

test("enchantable T6 ore folds enchant drops into silver/hour & silver/kg, with an 'incl. ench' cue", () => {
  const r = rowOf("T6_ORE");
  const flatNet = net(300);
  assert.ok(Math.abs(r.netPerUnit - flatNet) < 1e-6, `net/unit ${r.netPerUnit} stays the flat fact`);
  assert.ok(r.blendedNetPerUnit > flatNet, "blend should lift the net above flat");
  assert.ok(r.silverPerHour > flatNet * GATHER_UNITS_PER_HOUR[6], "silver/hour folds in the enchant bonus");
  assert.ok(Math.abs(r.silverPerKg - r.blendedNetPerUnit / r.weightKg) < 1e-6, `silver/kg ${r.silverPerKg}`);
  const cell = captured.html[captured.rows.indexOf(r)];
  assert.ok(cell.includes("incl. ench"), "silver/hour should carry the 'incl. ench' cue");
  assert.ok(!/\+\d+% ench/.test(cell), "but NOT the old misleading '+x% ench' badge");
});

test("Quarrying (T6 rock): enchantable, but no enchant prices → blend stays flat, no green bonus chip", () => {
  const r = rowOf("T6_ROCK");
  const flatNet = net(120);
  assert.strictEqual(r.enchantable, true, "raw rock is enchantable (enchanted stone is real)");
  // Fixture prices no enchanted rock, so the blend collapses to flat (never invents value).
  assert.ok(Math.abs(r.blendedNetPerUnit - flatNet) < 1e-9, "rock blend must equal flat");
  assert.ok(Math.abs(r.silverPerHour - flatNet * GATHER_UNITS_PER_HOUR[6]) < 1e-6, "rock silver/hour = flat × units");
  // No uplift → no green "incl. ench" chip on the number (the column tooltip may still mention the fold-in).
  assert.ok(!captured.html[captured.rows.indexOf(r)].includes("incl. ench"), "no green bonus chip without enchant prices");
});

console.log("\n— merged fishing rows —");

test("T5 Fishing: freshwater base, Forest rare folded into all-in silver/hour & silver/kg", () => {
  const r = rowOf("T5_FISH_FRESHWATER_ALL_COMMON");
  assert.ok(r, "T5 fishing row missing");
  assert.strictEqual(r.kind, "fishing");
  assert.strictEqual(r.baseWater, "Freshwater");
  assert.strictEqual(r.rareId, "T5_FISH_FRESHWATER_FOREST_RARE", "should pick the priced Forest rare");
  // displayed Net/Unit & Weight stay the STAPLE common catch
  assert.ok(Math.abs(r.netPerUnit - net(2000)) < 1e-6, `net/unit ${r.netPerUnit}`);
  assert.ok(Math.abs(r.weightKg - FISH_WEIGHT_KG[5]) < 1e-9, `weight ${r.weightKg}`);
  // all-in blend
  const blendedNet = net(2000) * (1 - FISH_RARE_SHARE) + net(9000) * FISH_RARE_SHARE;
  const blendedWeight = FISH_WEIGHT_KG[5] * (1 - FISH_RARE_SHARE) + FISH_RARE_WEIGHT_KG[5] * FISH_RARE_SHARE;
  assert.ok(Math.abs(r.silverPerHour - blendedNet * FISH_UNITS_PER_HOUR[5]) < 1e-6, `silver/hour ${r.silverPerHour}`);
  assert.ok(Math.abs(r.silverPerKg - blendedNet / blendedWeight) < 1e-6, `silver/kg ${r.silverPerKg}`);
  // rare bonus genuinely lifts it above the common-only baseline
  assert.ok(r.silverPerHour > net(2000) * FISH_UNITS_PER_HOUR[5], "rare bonus must lift silver/hour");
  assert.strictEqual(r.name, "T5 fish", "uniform name like Skinning's '8 hide'");
  const cell = captured.html[captured.rows.indexOf(r)];
  assert.ok(cell.includes("T5 fish"), "uniform '{tier} fish' name");
  assert.ok(cell.includes("[Fishing]"), "Fishing badge");
  assert.ok(cell.includes("incl. rare"), "rare bonus folded in → 'incl. rare' cue");
  assert.ok(!/>rare<\/small>/.test(cell), "no separate standalone 'rare' chip");
});

test("T6 Fishing: saltwater base wins (only it's priced), pure common when no rare priced", () => {
  const r = rowOf("T6_FISH_SALTWATER_ALL_COMMON");
  assert.ok(r, "T6 fishing row missing");
  assert.strictEqual(r.baseWater, "Saltwater");
  assert.strictEqual(r.rareId, null, "no rare priced → none blended");
  assert.ok(Math.abs(r.silverPerHour - net(3000) * FISH_UNITS_PER_HOUR[6]) < 1e-6, `silver/hour ${r.silverPerHour}`);
  assert.ok(Math.abs(r.silverPerKg - net(3000) / FISH_WEIGHT_KG[6]) < 1e-6, `silver/kg ${r.silverPerKg}`);
  const cell = captured.html[captured.rows.indexOf(r)];
  assert.strictEqual(r.name, "T6 fish", "uniform name");
  assert.ok(!cell.includes("incl. rare"), "no rare priced → no bonus cue");
});

test("seaweed row: single T1 byproduct, 1 kg, Fishing badge, all-in (no badge)", () => {
  const r = rowOf("T1_SEAWEED");
  assert.ok(r, "seaweed row missing");
  assert.strictEqual(r.kind, "seaweed");
  assert.ok(Math.abs(r.weightKg - 1.0) < 1e-9, `seaweed weight ${r.weightKg}`);
  assert.ok(Math.abs(r.silverPerHour - net(40) * 200) < 1e-6, `silver/hour ${r.silverPerHour}`);
  const cell = captured.html[captured.rows.indexOf(r)];
  assert.ok(cell.includes("[Fishing]"), "missing Fishing badge");
  assert.ok(!cell.includes("incl."), "byproduct has no bonus cue");
});

test("fishing is comparable to land — one row per tier, same columns", () => {
  // Ancient Lands rows share the kind but are a different activity; they are
  // covered by tests/ancient-lands-fishing-row.test.cjs.
  const fishing = captured.rows.filter((r) => r.kind === "fishing" && !r.ancient);
  assert.strictEqual(fishing.length, 7, "exactly 7 merged fishing tier rows");
  fishing.forEach((r) => {
    assert.ok("silverPerHour" in r && "silverPerKg" in r && "unitsPerHour" in r,
      "fishing rows expose the same comparator columns as land");
  });
});

console.log("\n— merged tracking rows —");

test("creature labels use proper in-game names (Hellfire Imp / Stone Golem / Dawnbird)", () => {
  assert.strictEqual(trackCreatureLabel("T5_ALCHEMY_RARE_IMP"), "Hellfire Imp");
  assert.strictEqual(trackCreatureLabel("T7_ALCHEMY_RARE_ELEMENTAL"), "Stone Golem");
  assert.strictEqual(trackCreatureLabel("T3_ALCHEMY_RARE_EAGLE"), "Dawnbird");
  assert.strictEqual(trackCreatureLabel("T5_ALCHEMY_RARE_PANTHER"), "Panther");
  assert.strictEqual(trackCreatureLabel("T7_ALCHEMY_RARE_WEREWOLF"), "Werewolf");
});

test("Tracking is 3 merged rows (T3/T5/T7), comparable to land — same columns", () => {
  const tracking = captured.rows.filter((r) => r.kind === "tracking");
  assert.strictEqual(tracking.length, 3, "exactly 3 merged tracking tier rows");
  assert.deepStrictEqual(tracking.map((r) => r.tier), [3, 5, 7]);
  tracking.forEach((r) => {
    assert.ok("silverPerHour" in r && "silverPerKg" in r && "unitsPerHour" in r,
      "tracking rows expose the same comparator columns as land");
  });
  // T7 has no priced remains in the synthetic market → falls back to generic name.
  const t7 = tracking.find((r) => r.tier === 7);
  assert.strictEqual(t7.name, "7 remains", "unpriced tier falls back to generic '{tier} remains'");
  assert.strictEqual(t7.creature, null);
});

test("T5 Tracking: best creature (Werewolf) remains staple + artifact + BM loot folded in", () => {
  const r = rowOf("T5_ALCHEMY_RARE_WEREWOLF");
  assert.ok(r, "T5 tracking row missing (should pick the best-paying creature)");
  assert.strictEqual(r.kind, "tracking");
  assert.strictEqual(r.name, "5 Werewolf remains", "names the most-profitable creature, not a generic '{tier} remains'");
  assert.strictEqual(r.creature, "Werewolf");
  assert.strictEqual(r.artifactId, "T5_ARTEFACT_2H_SHAPESHIFTER_AVALON", "best-paying artifact faction");
  // displayed Net/Unit & Weight stay the STAPLE remains
  assert.ok(Math.abs(r.netPerUnit - net(2500)) < 1e-6, `net/unit ${r.netPerUnit}`);
  assert.ok(Math.abs(r.weightKg - REMAINS_WEIGHT_KG) < 1e-9, `weight ${r.weightKg}`);
  // all-in blend matches calcTrackingEconomics
  const econ = calcTrackingEconomics({
    remainsGross: 2500, remainsWeightKg: REMAINS_WEIGHT_KG, remainsPerKill: TRACK_REMAINS_PER_KILL,
    artifactGross: 60000, artifactWeightKg: TRACK_ARTIFACT_WEIGHT_KG, artifactShare: TRACK_ARTIFACT_SHARE,
    bmLootPerKill: TRACK_RARE_QUARRY_SHARE * TRACK_BM_LOOT_GROSS, killsPerHour: TRACK_KILLS_PER_HOUR[5],
  });
  assert.ok(Math.abs(r.silverPerHour - econ.silverPerHour) < 1e-6, `silver/hour ${r.silverPerHour}`);
  assert.ok(Math.abs(r.silverPerKg - econ.silverPerKg) < 1e-6, `silver/kg ${r.silverPerKg}`);
  assert.ok(Math.abs(r.unitsPerHour - TRACK_KILLS_PER_HOUR[5] * TRACK_REMAINS_PER_KILL) < 1e-9, "units = kills × remains/kill");
  // bonus genuinely lifts silver/hour above the remains-only baseline
  assert.ok(r.silverPerHour > net(2500) * r.unitsPerHour, "artifact + BM loot must lift silver/hour");
  const cell = captured.html[captured.rows.indexOf(r)];
  assert.ok(cell.includes("5 Werewolf remains"), "most-profitable creature shown in cell");
  assert.ok(cell.includes("[Tracking]"), "Tracking badge");
  assert.ok(cell.includes("incl. loot"), "artifact + BM loot folded in → 'incl. loot' cue");
  assert.ok(!/incl\. (rare|ench)/.test(cell), "tracking uses the 'loot' chip, not rare/ench");
});

test("T3 Tracking: remains priced but no T4 artifact → no artifact blended, still renders", () => {
  const r = rowOf("T3_ALCHEMY_RARE_PANTHER");
  assert.ok(r, "T3 tracking row missing");
  assert.strictEqual(r.kind, "tracking");
  assert.strictEqual(r.artifactId, null, "no artifact priced → none blended");
  assert.ok(Math.abs(r.netPerUnit - net(700)) < 1e-6, `net/unit ${r.netPerUnit}`);
  const cell = captured.html[captured.rows.indexOf(r)];
  assert.strictEqual(r.name, "3 Panther remains", "names the priced creature");
  assert.ok(cell.includes("[Tracking]"), "Tracking badge");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
