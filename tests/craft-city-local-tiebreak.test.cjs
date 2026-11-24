/**
 * Test: the "craft where you sell" tie-break shared by the Consumables and
 * Mounts craft pickers (render-consumables.js / render-mounts.js).
 *
 * For non-specialized items every Royal craft city is economically identical
 * (same RRR, materials sourced from the cheapest city, Travel-Planner fee
 * disabled → free royal↔royal haul), so the per-craft-city candidates tie on
 * margin. The pickers used a strictly-greater test (`margin > best.margin`),
 * which silently kept the first Royal in CITIES order (Lymhurst). Now a tie is
 * broken in favour of the candidate that sells in the city it crafted in, so
 * the displayed advice avoids a pointless finished-good haul. When no candidate
 * is "local" (best sell is Black Market / Caerleon) the first-seen city wins.
 *
 * This replicates the inline predicate both renderers use (candidate carries
 * `craftCity` and `sellPot.city`), mirroring how crafting-table-dedupe.test.cjs
 * replicates dedupeCraftingRows.
 *
 * Run: node tests/craft-city-local-tiebreak.test.cjs
 */

const assert = require("assert");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Replicated predicate (identical logic in both render files) ──
const isLocal = (row) =>
  !!(row && row.sellPot && row.craftCity && row.sellPot.city === row.craftCity);

function shouldReplaceRoyal(cur, cand) {
  if (!cur) return true;
  if (cand.marginInfo.margin > cur.marginInfo.margin) return true;
  return (
    cand.marginInfo.margin === cur.marginInfo.margin &&
    isLocal(cand) &&
    !isLocal(cur)
  );
}

// Fold a list of per-craft-city candidates (in CITIES order) into the winning
// Royal pick, exactly as the renderer's forEach does.
function pickRoyal(candidates) {
  let best = null;
  candidates.forEach((c) => {
    if (shouldReplaceRoyal(best, c)) best = c;
  });
  return best;
}

const cand = (craftCity, sellCity, margin) => ({
  craftCity,
  sellPot: { city: sellCity },
  marginInfo: { margin },
});

console.log("Craft-city local tie-break tests\n");

// ── Profitable, interchangeable: all sell at the global best Royal city ──
test("tied Royal rows → winner crafts in the sell city, not first-seen Lymhurst", () => {
  // Global best sell = Fort Sterling; every craft city ties on margin.
  const winner = pickRoyal([
    cand("Lymhurst", "Fort Sterling", 12),
    cand("Fort Sterling", "Fort Sterling", 12), // local
    cand("Thetford", "Fort Sterling", 12),
    cand("Martlock", "Fort Sterling", 12),
    cand("Bridgewatch", "Fort Sterling", 12),
  ]);
  assert.strictEqual(winner.craftCity, "Fort Sterling");
});

// ── Best sell is non-Royal (Black Market) → no local row → first-seen wins ──
test("tied rows selling to Black Market keep first-seen craft city", () => {
  const winner = pickRoyal([
    cand("Lymhurst", "Black Market", 12),
    cand("Fort Sterling", "Black Market", 12),
    cand("Thetford", "Black Market", 12),
  ]);
  assert.strictEqual(winner.craftCity, "Lymhurst");
});

// ── Strictly-higher margin always wins, even over a local lower-margin row ──
test("higher margin beats a local row with lower margin", () => {
  const winner = pickRoyal([
    cand("Lymhurst", "Lymhurst", 5), // local but worse
    cand("Martlock", "Fort Sterling", 30), // best margin, non-local
  ]);
  assert.strictEqual(winner.craftCity, "Martlock");
  assert.strictEqual(winner.marginInfo.margin, 30);
});

// ── Unprofitable divergent local sells (each pinned to own city) ──
test("unprofitable rows: least-negative margin wins regardless of locality", () => {
  const winner = pickRoyal([
    cand("Fort Sterling", "Fort Sterling", -3.25),
    cand("Lymhurst", "Lymhurst", -7.75),
    cand("Thetford", "Thetford", -10.0),
  ]);
  assert.strictEqual(winner.craftCity, "Fort Sterling");
  assert.strictEqual(winner.marginInfo.margin, -3.25);
});

// ── Local row appears BEFORE the non-local ones (order independence) ──
test("local row wins a tie even when it is first in the list", () => {
  const winner = pickRoyal([
    cand("Martlock", "Martlock", 8), // local, first
    cand("Lymhurst", "Martlock", 8),
    cand("Thetford", "Martlock", 8),
  ]);
  assert.strictEqual(winner.craftCity, "Martlock");
});

// ── Single candidate ──
test("single candidate is returned as-is", () => {
  const winner = pickRoyal([cand("Thetford", "Caerleon", 4)]);
  assert.strictEqual(winner.craftCity, "Thetford");
});

// ── Empty list ──
test("no candidates → null", () => {
  assert.strictEqual(pickRoyal([]), null);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
