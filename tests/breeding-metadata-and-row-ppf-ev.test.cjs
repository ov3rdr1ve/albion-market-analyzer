/**
 * Test: Breeding rows render food type, grow time, and offspring chance;
 * baby price cell is editable; rows with no market data still include `item`
 * (so "Show All" reveals them).
 *
 * Run: node --test tests/breeding-metadata-and-row-ppf-ev.test.cjs
 *
 * Silver per focus, focus mats, nurture EV, EV column header, nurture-ladder days. Shared setup: tests/helpers/breeding-metadata-and-row-setup.cjs.
 */
const {
  assert, getBreedingMeta, BREEDING_NURTURE_DATA, readIndexHtml, test, finish,
} = require("./helpers/breeding-metadata-and-row-setup.cjs");

// ── Silver per focus (profitPerFocus) for breeding rows ──
// Marginal silver per focus = (nurtureGain × babyBuyPrice) / totalNurtureFocus.
// We validate the math directly with the meta-exposed fields; the row-level
// value in render-mounts.js uses the same formula.

// Offspring value = max(babyBuyPrice, cycleMarginProfit). This is what an
// extra baby is actually worth: either sell it (≈ buy price as a proxy) or
// breed another cycle (margin profit). Rare FW mounts with override-only
// baby prices get sensible values from the cycle-margin fallback.
function profitPerFocusForBreeding(meta, babyPrice, cycleProfit = 0) {
  if (!meta.totalNurtureFocus) return 0;
  const offspringValue = Math.max(babyPrice, cycleProfit);
  if (offspringValue <= 0) return 0;
  const extraSilver = (meta.nurtureGainPct / 100) * offspringValue;
  return extraSilver / meta.totalNurtureFocus;
}

test("rare mount (T8 direbear, base 0%) ppf uses baby buy when margin is lower", () => {
  // 1M baby, cycle profit 500k → max = 1M. nurtureGain 15%, focus 750
  // → 150k / 750 = 200
  const m = getBreedingMeta({ babyId: "T8_FARM_DIREBEAR_BABY" });
  const ppf = profitPerFocusForBreeding(m, 1_000_000, 500_000);
  assert.ok(Math.abs(ppf - 200) < 1e-3, `expected ~200, got ${ppf}`);
});

test("rare mount ppf falls back to cycle margin when baby buy is near-zero (FW override)", () => {
  // FW swamp salamander user case: baby overridden to 1, cycle margin 227k
  // → offspringValue = 227k. nurtureGain 30%, focus 375
  // → 30% × 227k / 375 = 181.6
  const m = getBreedingMeta({ babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  const ppf = profitPerFocusForBreeding(m, 1, 227_000);
  assert.ok(Math.abs(ppf - 181.6) < 1, `expected ~181.6, got ${ppf}`);
});

test("T3 chicken ppf uses the WHOLE 80% gain and max(baby, profit) offspring value", () => {
  // 10k baby, 5k profit → max = 10k. 80% gain × 10k / 125 = 64. The old 100%
  // cap clipped this to half and undersold the focus.
  const m = getBreedingMeta({ babyId: "T3_FARM_CHICKEN_BABY" });
  const ppf = profitPerFocusForBreeding(m, 10_000, 5_000);
  assert.ok(Math.abs(ppf - 64) < 1e-3, `expected ~64, got ${ppf}`);
});

test("ppf is 0 when both baby price and cycle profit are zero", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_DIREBEAR_BABY" });
  assert.strictEqual(profitPerFocusForBreeding(m, 0, 0), 0);
});

test("ppf is 0 when an animal has no nurture budget (hypothetical)", () => {
  const fakeMeta = { totalNurtureFocus: 0, nurtureGainPct: 0 };
  assert.strictEqual(profitPerFocusForBreeding(fakeMeta, 100_000, 100_000), 0);
});

test("ppf uses cycle margin over baby price when margin is higher", () => {
  // Scenario: profitable breeding where margin > baby cost
  // T5 horse, baby 100k, profit 150k → offspringValue = 150k
  // 26.67% gain (3 × 8.89, uncapped) × 150k / 375 = 106.68
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  const ppf = profitPerFocusForBreeding(m, 100_000, 150_000);
  assert.ok(Math.abs(ppf - 106.68) < 0.2, `expected ~106.68, got ${ppf}`);
});

test("negative cycle margin is ignored (falls back to baby price)", () => {
  // Losing money on breeding: profit = -20k. Should use baby price.
  // T5 horse, baby 100k, profit -20k → offspringValue = 100k
  // 26.67% × 100k / 375 = 71.12
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  const ppf = profitPerFocusForBreeding(m, 100_000, -20_000);
  assert.ok(Math.abs(ppf - 71.12) < 0.2, `expected ~71.12, got ${ppf}`);
});

test("focusMats for breeding = floor(10k/totalFocus) × (1 baby + feed pieces)", () => {
  // T8 direbear at max spec: totalFocus=750, breedings=floor(10000/750)=13,
  // feed piecesNeeded = ceil(19728/52) = 380 → mats = 13 × (1 + 380) = 4953
  const meta = getBreedingMeta({ babyId: "T8_FARM_DIREBEAR_BABY" });
  const breedings = Math.floor(10000 / meta.totalNurtureFocus);
  const feedPieces = meta.piecesNeeded;
  const mats = breedings * (1 + feedPieces);
  assert.strictEqual(breedings, 13);
  assert.strictEqual(feedPieces, 380);
  assert.strictEqual(mats, 4953);
});

test("T3 horse focusMats at max spec: 80 breedings × (1 baby + 10 plants)", () => {
  // T3 horse: totalFocus=125 → 80 breedings per 10k focus, T3 long-grow needs
  // ceil(480/48)=10 plant pieces → mats = 80 × (1 + 10) = 880
  const meta = getBreedingMeta({ babyId: "T3_FARM_HORSE_BABY" });
  const breedings = Math.floor(10000 / meta.totalNurtureFocus);
  assert.strictEqual(breedings, 80);
  assert.strictEqual(meta.piecesNeeded, 10);  // ceil(480/48)
  const mats = breedings * (1 + meta.piecesNeeded);
  assert.strictEqual(mats, 880);
});

// ── nurtureEv (what the cycle is worth when fully nurtured) ──
// The FULL offspring chance — base plus nurture — on top of the deterministic
// cycle profit, whatever the Use Focus checkbox says:
//   nurtureEv = profit + ((baseOffspringPct + nurtureGainPct)/100) × max(babyPrice, profit)
// Collapses to profit when the base cycle loses money or the animal has no
// nurture data. Profit itself carries the base slice always and the nurture
// slice only with focus on — that split is pinned in
// tests/breeding-offspring-revenue.test.cjs.

function nurtureEvFor(meta, profit, babyPrice) {
  if (!(profit > 0) || !meta.maxNurtures) return profit;
  const offspringValue = Math.max(babyPrice, profit);
  return profit + ((meta.baseOffspringPct + meta.nurtureGainPct) / 100) * offspringValue;
}

test("FW salamander: profit 227k, baby 1 → EV = 227k + 30% × 227k = 295.1k", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  const ev = nurtureEvFor(m, 227_000, 1);
  assert.ok(Math.abs(ev - 295_100) < 100, `expected ~295,100, got ${ev}`);
});

test("T5 horse: baby 75k beats profit 50k as offspring value → EV = 50k + 105.34% × 75k", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  const ev = nurtureEvFor(m, 50_000, 75_000);
  // 50_000 + 1.0534 × 75_000 = 129_005
  assert.ok(Math.abs(ev - 129_005) < 50, `expected ~129,005, got ${ev}`);
});

test("T5 horse: profit 150k beats baby 75k → EV = 150k × (1 + 105.34%) = 308.01k", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  const ev = nurtureEvFor(m, 150_000, 75_000);
  // 150_000 + 1.0534 × 150_000 = 308_010
  assert.ok(Math.abs(ev - 308_010) < 100, `expected ~308,010, got ${ev}`);
});

test("loss-making cycle (profit < 0): nurtureEv stays at the same loss value", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  const ev = nurtureEvFor(m, -10_000, 75_000);
  assert.strictEqual(ev, -10_000);
});

test("T3 chicken ev reflects the whole 140% chance on an offspring worth max(baby, profit)", () => {
  // base 60% + 80% nurture = 140%, uncapped
  const m = getBreedingMeta({ babyId: "T3_FARM_CHICKEN_BABY" });
  const ev = nurtureEvFor(m, 5_000, 8_000);
  // 1.40 × max(8k, 5k) = 11_200 → EV = 5k + 11.2k = 16.2k
  assert.ok(Math.abs(ev - 16_200) < 10, `expected ~16,200, got ${ev}`);
});

test("index.html mounts-table header includes EV w/ Nurture column", () => {
  const html = readIndexHtml();
  const mountsTableStart = html.indexOf('id="mounts-table"');
  const mountsTableEnd = html.indexOf("</table>", mountsTableStart);
  assert.ok(mountsTableStart > 0 && mountsTableEnd > mountsTableStart);
  const section = html.slice(mountsTableStart, mountsTableEnd);
  assert.ok(/data-sort="nurtureEv"/.test(section), "missing data-sort=\"nurtureEv\" in mounts-table");
  assert.ok(/EV w\/ Nurture/.test(section), "missing column label 'EV w/ Nurture'");
  // 15 columns: 14 data columns + the leading "+" (My Crafting List) column.
  const thCount = (section.match(/<th /g) || []).length;
  assert.strictEqual(thCount, 15, "mounts-table header column count changed");
  assert.ok(new RegExp(`colspan="${thCount}"`).test(section),
    "awaiting-scan row colspan does not match the header column count");
});

// ── the nurture ladder is a DAILY instalment ───────────────────────────────
//
// Nurturing has a 24h cooldown and is hard-capped at the number of days the
// baby takes to grow with Premium (which halves the grow time). So maxCycles IS
// the length of the play in days, which is what lets the Crafting List bill a
// nurture per day against a daily focus pool (js/craft-list-extractors.js,
// "mounts-table"). Pinned across the whole catalog — the Firewing Drake's 668h
// / 14 cycles is the extreme case, and a new baby whose grow time and cycle
// count disagree would silently mis-bill.
test("every baby's nurture cycles equal its Premium grow time in days", () => {
  const off = Object.keys(BREEDING_NURTURE_DATA).filter((babyId) => {
    const meta = getBreedingMeta({ babyId });
    return Math.ceil((meta.growHours / 2) / 24) !== meta.maxNurtures;
  });
  assert.deepStrictEqual(off, [], "cycles != Premium grow days for these babies");
});

finish();
