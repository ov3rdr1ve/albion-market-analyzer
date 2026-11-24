/**
 * Test: the merged "Best Journal Play" cell (js/laborer-journal-play.js).
 *
 * One cell, two ways of working one laborer, DELIBERATELY IN DIFFERENT UNITS
 * because they are limited by different things:
 *
 *   SELF-FILL    fill it with fame you earn anyway, run it, get the same journal
 *                back empty. Limited by YOUR OWN EFFORT, so it is priced in the
 *                unit that effort comes in — silver per HOUR of gathering, or
 *                silver per CRAFT for a crafting laborer, which has no cast time
 *                and so no hourly rate. That is what the column sorts on.
 *   BUY FILLED   buy a full journal at market, run it, sell the empty one back.
 *                Limited by SILVER and market supply, repeatable as often as you
 *                can afford one — so it is priced per journal, i.e. per 22h
 *                laborer cycle, net of the purchase.
 *
 * Two earlier versions are pinned against here. The first forced both onto
 * silver-per-cycle so they could be ranked head to head — only the right
 * question when laborers are the bottleneck. The second priced self-fill per
 * point of journal FAME so the gathering and crafting rows would share a unit;
 * they never did. A journal's fame requirement doubles per tier while a
 * gatherer's fame rate rises only ~1.3-1.9× per tier, so a point of T3 fame
 * costs about seven times the gathering time a point of T8 fame does, and the
 * column ranked a T3 row level with a T8 row worth ~6.8× more per hour.
 *
 * What this pins down:
 *   1. Self-fill leads, in a FIXED order — there is no "winner" to promote when
 *      the two lines are not in the same unit, and a moving order would imply
 *      one. It is also the sort key, so it must be the emphasised line.
 *   2. journalPlayValue is the self-fill rate and nothing else — never a max()
 *      across units — and the two families are BANDED, never interleaved: every
 *      gathering row sorts above every crafting row, each ordered correctly
 *      inside itself, with the no-model rows beneath both.
 *   3. Every line states its own unit, so the two can never be read as one.
 *   4. Either side may be missing (an unpriced journal, a mercenary's combat
 *      fame) and the cell still renders, with a dash for the missing half.
 *   5. The fill effort is quoted in the unit that play actually has: the
 *      journal's fame AND the hours it costs for a gatherer, crafts for a
 *      crafter, always tiered.
 *   6. The tooltip reuses the computing modules' own prose rather than
 *      paraphrasing it.
 *
 * Black-box: no market data, no DOM — the cell takes plain result objects.
 *
 * Run: node tests/laborer-journal-play.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const loadSrc = (rel) =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

// Marker tooltips, so "the prose is the module's own" is checkable without
// dragging the whole pricing stack into this test.
const sandbox = `
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function tx(en) { return en; }
function formatFillHours(h) { return h < 1 ? Math.round(h * 60) + " min" : h.toFixed(1) + " h"; }
function formatCraftCount(c) { return c < 10 ? c.toFixed(1) : String(Math.round(c)); }
function bestJournalTip(bj) { return "BUYTIP-T" + bj.journalTier; }
function selfFillTip(sf) { return "SELFTIP-T" + sf.journalTier; }
`;

const mod = new Module("laborer-journal-play-test");
mod._compile(
  sandbox + loadSrc("js/laborer-journal-play.js") +
    "\nmodule.exports = { journalPlayValue, journalPlayLines, journalPlayTip, journalPlayCell, " +
    "buyFilledValue, selfFillValue, selfFillUnit };",
  "laborer-journal-play.js",
);
const {
  journalPlayValue, journalPlayLines, journalPlayTip, journalPlayCell,
  buyFilledValue, selfFillValue, selfFillUnit,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── fixtures ───────────────────────────────────────────────────────────────
// The self-fill fixtures carry BOTH the gross figures and the net ones, because
// the whole point of the column is that they differ: net is gross less what the
// fame could have sold for (js/journal-fame-price.js).
//
// The payload is always POSITIVE — a laborer returns loot whatever the journal
// market does — and it is the fame bill that can exceed it and drive the net
// negative. `_grossOf` keeps that invariant however extreme the net rate asked
// for, so a negative fixture stays a realistic one.
const buy = (journalTier, profit, yld = 1.5) => ({ journalTier, profit, yield: yld, sameTierProfit: profit * 0.8 });

// `rate` is the play's OWN rate — the payload per hour / per craft, which is
// what this column reports and sorts on. Nothing is bought to run the loop, so
// it is never negative. `vsMarket` is the separate comparison against selling
// the journal full instead: positive when self-fill wins, negative when the
// market does. Only the comparison can go below zero.
const gatherFill = (journalTier, rate, { maxfame = 28800, hours = 1.5, famePriced = true, vsMarket = -1000 } = {}) => {
  const payout = rate * hours;
  const netPerHour = famePriced ? vsMarket : rate;
  const netPayout = netPerHour * hours;
  return {
    found: true, kind: "gather", journalTier, maxfame, hours, gatherTier: 8,
    payout, profitPerCycle: payout,
    silverPerHour: rate,
    silverPerFame: payout / maxfame,
    fameCost: payout - netPayout,
    famePrice: (payout - netPayout) / maxfame,
    famePriced,
    netPayout,
    netSilverPerHour: netPerHour,
    netSilverPerFame: netPayout / maxfame,
    laborersFed: 22 / hours, idleHours: 0, city: "Martlock", yield: 1.5,
  };
};

const craftFill = (journalTier, rate, { crafts = 2.1, maxfame = 58590, famePriced = true, vsMarket = -1000 } = {}) => {
  const payout = rate * crafts;
  const netPerCraft = famePriced ? vsMarket : rate;
  const netPayout = netPerCraft * crafts;
  return {
    found: true, kind: "craft", journalTier, maxfame, crafts, famePerCraft: 27900,
    payout, profitPerCycle: payout,
    silverPerCraft: rate,
    silverPerFame: payout / maxfame,
    fameCost: payout - netPayout,
    famePrice: (payout - netPayout) / maxfame,
    famePriced,
    netPayout,
    netSilverPerCraft: netPerCraft,
    netSilverPerFame: netPayout / maxfame,
    city: "Lymhurst", yield: 1.5, itemName: "Elder's Plate Boots",
  };
};

const noFill = (reason) => ({ found: false, kind: "gather", reason, profitPerCycle: 0, silverPerFame: 0, silverPerHour: 0 });

const strip = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tipOf = (html) => (html.match(/title="([^"]*)"/) || [null, ""])[1];

// ── 1. self-fill leads, and its NET rate is the sort key ──────────────────
console.log("\n=== Self-fill leads, in a fixed order, and is the sort key ===");

const VALUE_CASES = [
  { name: "gathering row",            bj: buy(6, 420000),  sf: gatherFill(8, 46080), unit: "/ h",     rate: 46080 },
  { name: "crafting row",             bj: buy(7, 90000),   sf: craftFill(8, 118000), unit: "/ craft", rate: 118000 },
  { name: "no buy price",             bj: null,            sf: craftFill(8, 37000),  unit: "/ craft", rate: 37000 },
  { name: "buy dwarfs the fill rate", bj: buy(6, 9000000), sf: gatherFill(8, 7700),  unit: "/ h",     rate: 7700 },
];

for (const c of VALUE_CASES) {
  test(`${c.name} — the leading line carries the play's rate and its own unit`, () => {
    assert.strictEqual(selfFillValue(c.sf), c.rate);
    const first = journalPlayLines(c.bj, c.sf, 8).split("</div>")[0];
    assert.ok(strip(first).includes("self-fill"), `first line was: ${strip(first)}`);
    assert.ok(strip(first).includes(c.unit), `the leading line must state its unit: ${strip(first)}`);
    assert.ok(strip(first).includes(Math.round(c.rate).toLocaleString()),
      `the leading line must carry the sort key: ${strip(first)}`);
  });
}

// The unit is the row's own. There is no "gross" qualifier any more: the figure
// is the payload whether or not the journal has a market price, so a caveat
// about a deduction that no longer happens would be a lie.
test("the unit is per hour for a gatherer and per craft for a crafter", () => {
  assert.strictEqual(selfFillUnit(gatherFill(8, 100)), "/ h");
  assert.strictEqual(selfFillUnit(craftFill(8, 100)), "/ craft");
  assert.strictEqual(selfFillUnit(gatherFill(8, 100, { famePriced: false })), "/ h",
    "an unpriced journal changes nothing about what this play pays");
});

// The face is the payload, so the journal's own market price must not reach it.
test("the reported rate ignores the comparison entirely", () => {
  [gatherFill, craftFill].forEach((make) => {
    const wins = make(8, 46080, { vsMarket: 30000 });
    const loses = make(8, 46080, { vsMarket: -900000 });
    assert.strictEqual(selfFillValue(wins), 46080, `${make.name}: winning comparison moved the rate`);
    assert.strictEqual(selfFillValue(loses), 46080, `${make.name}: losing comparison moved the rate`);
    assert.strictEqual(journalPlayValue(null, wins), journalPlayValue(null, loses),
      `${make.name}: the comparison leaked into the sort key`);
  });
});

// The bug this replaces: max(perCycle, perRate) across two different units.
test("the sort key is NEVER a max across the two plays", () => {
  const huge = buy(6, 9999999);
  const small = gatherFill(8, 500);
  const big = gatherFill(8, 900000);
  assert.ok(journalPlayValue(huge, small) < journalPlayValue(huge, big),
    "a big per-cycle figure must not leak into the self-fill sort key");
  assert.ok(journalPlayValue(huge, noFill("no-fame-model")) < journalPlayValue(huge, small),
    "with no fill model the row sinks, however good the buy play is");
});

// Different units must not interleave: a per-craft figure and a per-hour figure
// have overlapping ranges, and ordering them together would read as a
// head-to-head the column explicitly refuses to claim.
test("the two families are banded — every gathering row sorts above every crafting row", () => {
  const gathers = [1, 5000, 900000, 40].map((r) => journalPlayValue(null, gatherFill(8, r)));
  const crafts = [1, 5000, 900000, 40].map((r) => journalPlayValue(null, craftFill(8, r)));
  const none = journalPlayValue(buy(6, 42), noFill("no-fame-model"));
  assert.ok(Math.min(...gathers) > Math.max(...crafts), `${gathers} vs ${crafts}`);
  assert.ok(Math.min(...crafts) > none, `crafting rows must outrank the no-model floor: ${crafts} vs ${none}`);
});

test("inside a family the order is the rate's own order", () => {
  const rates = [0.5, 1, 4200, 46080, 3000000];
  [gatherFill, craftFill].forEach((make) => {
    const keys = rates.map((r) => journalPlayValue(null, make(8, r)));
    for (let i = 1; i < keys.length; i++) {
      assert.ok(keys[i] > keys[i - 1], `${make.name}: ${rates[i]} did not outrank ${rates[i - 1]}`);
    }
  });
});

test("the order is fixed — self-fill first even when buy-filled is worth more", () => {
  [[buy(6, 420000), gatherFill(8, 4200)], [buy(6, 1), gatherFill(8, 990000)]].forEach(([bj, sf]) => {
    const first = journalPlayLines(bj, sf, 8).split("</div>")[0];
    assert.ok(strip(first).includes("self-fill"), `order moved: ${strip(first)}`);
  });
});

test("each line states its own unit, so the two can never be read as one", () => {
  const lines = journalPlayLines(buy(6, 420000), gatherFill(8, 46080), 8).split("</div>");
  const own = lines.find((l) => strip(l).includes("self-fill"));
  const bought = lines.find((l) => strip(l).includes("buy filled"));
  assert.ok(strip(own).includes("/ h"), strip(own));
  assert.ok(!strip(own).includes("/ cycle"), strip(own));
  assert.ok(strip(bought).includes("/ cycle"), strip(bought));
  assert.ok(!/\/ h\b/.test(strip(bought)), strip(bought));
});

// The journal being worth more sold full than fed to a laborer is a real
// verdict, but it is a verdict about which PLAY to run — not a loss on this one,
// which buys nothing. It must never reach the face as a negative.
test("a losing comparison never turns the self-fill line negative", () => {
  const sf = gatherFill(8, 46080, { vsMarket: -900000 });
  const text = strip(journalPlayLines(buy(6, 420000), sf, 8));
  assert.ok(text.includes("46,080"), text);
  assert.ok(!text.includes("-900,000"), `the comparison must not be the face: ${text}`);
  assert.ok(!/-[\d,]+ \/ h/.test(text), `no negative rate on the face: ${text}`);
});

// The BUY-FILLED play does buy a journal, so it can lose money, and a loss there
// is still coloured.
test("a losing buy-filled play is still coloured as a loss", () => {
  const html = journalPlayCell(buy(6, -420000), gatherFill(8, 46080), 8);
  assert.ok(html.includes("#dc2626"), `a negative buy-filled figure should be red: ${html}`);
});

// ── 2. both plays are always named ─────────────────────────────────────────
console.log("\n=== Both plays are always named ===");

test("both lines are present when both have data", () => {
  const body = journalPlayLines(buy(6, 420000), gatherFill(8, 46080), 8);
  const text = strip(body);
  assert.ok(text.includes("buy filled"), text);
  assert.ok(text.includes("self-fill"), text);
  assert.ok(text.includes("420,000"), text);
  assert.ok(text.includes("46,080"), text);
});

test("the buy line states the journal tier and its yield", () => {
  const text = strip(journalPlayLines(buy(6, 420000, 1.5), gatherFill(8, 46080), 8));
  assert.ok(text.includes("T6"), text);
  assert.ok(text.includes("@150%"), text);
});

const MISSING_CASES = [
  { name: "no filled-journal price", bj: null, sf: gatherFill(8, 46080), missing: "buy filled" },
  { name: "no fill model at all",    bj: buy(6, 420000), sf: noFill("no-fame-model"), missing: "self-fill" },
  { name: "self-fill found but worthless", bj: buy(6, 420000), sf: { found: true, kind: "gather", journalTier: 8, silverPerHour: 0, silverPerFame: 0, maxfame: 28800 }, missing: "self-fill" },
];
for (const c of MISSING_CASES) {
  test(`${c.name} — "${c.missing}" still appears, with a dash`, () => {
    const body = journalPlayLines(c.bj, c.sf, 8);
    const line = body.split("</div>").find((l) => strip(l).includes(c.missing));
    assert.ok(line, `the ${c.missing} line went missing entirely: ${strip(body)}`);
    assert.ok(strip(line).includes("—"), `expected a dash on the ${c.missing} line: ${strip(line)}`);
  });
}

test("neither play has data — the cell is a plain dash, never an empty box", () => {
  assert.strictEqual(journalPlayLines(null, null, 8), "");
  // The no-model floor sits beneath every real play. Rates are payloads now, so
  // the worst real one is a hair above zero rather than deeply negative.
  assert.ok(journalPlayValue(null, null) < journalPlayValue(null, gatherFill(8, 0.0001)),
    "a row with no model must sort beneath even the worst real play");
  assert.strictEqual(journalPlayValue(null, gatherFill(8, 0)), journalPlayValue(null, null),
    "a payload of nothing is not a play — it belongs on the floor, not at rate 0");
  const html = journalPlayCell(null, null, 8);
  assert.ok(html.includes("—"), html);
  assert.ok(!/NaN|undefined|Infinity/.test(html), html);
});

// ── 3. fill effort in the unit that play actually has ──────────────────────
console.log("\n=== Fill effort is quoted in its own unit ===");

test("a gathering row quotes the journal's FAME and the hours it costs, tiered", () => {
  const text = strip(journalPlayLines(buy(6, 10), gatherFill(8, 46080), 8));
  assert.ok(/T8 · 28,800 fame · 1\.5 h/.test(text), text);
  assert.ok(!text.includes("crafts"), `a gatherer must not be counted in crafts: ${text}`);
});

// The hours are on the face BECAUSE the headline is per hour, and because they
// are what the fame count cannot tell you: the same 28,800 fame is a very
// different amount of gathering at T3 than at T8. That is the whole bug this
// column shipped with.
test("two journals with the same fame but different fill times rank differently", () => {
  const slow = gatherFill(8, 20000, { maxfame: 28800, hours: 6 });
  const fast = gatherFill(8, 60000, { maxfame: 28800, hours: 2 });
  assert.ok(journalPlayValue(null, fast) > journalPlayValue(null, slow),
    "the faster fill must win, though both spend the same fame");
});

test("a crafting row quotes crafts, tiered, and no hours", () => {
  const text = strip(journalPlayLines(buy(6, 10), craftFill(8, 118000), 8));
  assert.ok(/T8 · 2\.1 crafts/.test(text), text);
  assert.ok(!/\d\s*h\b/.test(text), `crafting has no cast time, so no hours: ${text}`);
  assert.ok(!/\bmin\b/.test(text), text);
});

// ── 4. the tooltip is the computing modules' own prose ─────────────────────
console.log("\n=== The tooltip reuses each module's own explanation ===");

test("both halves' tooltips are carried through verbatim", () => {
  const tip = journalPlayTip(buy(6, 420000), gatherFill(8, 46080), 8);
  assert.ok(tip.includes("BUYTIP-T6"), tip);
  assert.ok(tip.includes("SELFTIP-T8"), tip);
  assert.ok(tip.includes("BUY FILLED:") && tip.includes("SELF-FILL:"), tip);
});

// It must NOT pick a winner: with two units there is nothing to compare, and
// saying otherwise is exactly the error this version exists to undo.
// The caveat survives; the ESSAY that used to argue it does not. Why the units
// differ belongs in the module header, not in a hover — see
// tests/tooltip-runtime-length.test.cjs for the length guard.
test("with both priced, the tooltip flags the unit mismatch instead of naming a winner", () => {
  const tip = journalPlayTip(buy(6, 420000), gatherFill(8, 46080), 8);
  assert.ok(/[Dd]ifferent units/.test(tip), tip);
  assert.ok(/cycle/.test(tip) && /effort/.test(tip), `both denominators must be named: ${tip}`);
  assert.ok(!/pays more/.test(tip), `must not rank one against the other: ${tip}`);
});

test("with one side missing, the tooltip says which and why", () => {
  assert.ok(journalPlayTip(null, gatherFill(8, 46080), 8).includes("No filled journal is priced"));
  // The missing-self case is explained by selfFillTip's own no-data prose, which
  // this file stubs — repeating it here is what made the merged tip enormous.
  const noSelf = journalPlayTip(buy(6, 420000), noFill("no-fame-model"), 8);
  assert.ok(noSelf.includes("BUY FILLED:") && noSelf.includes("SELF-FILL:"), noSelf);
});

test("the tooltip never breaks out of its own attribute", () => {
  const html = journalPlayCell(buy(6, 420000), gatherFill(8, 46080), 8);
  const tip = tipOf(html);
  assert.ok(tip.length > 0, "there should be a tooltip");
  assert.ok(!tip.includes('"'), `a raw quote would end the attribute early: ${tip}`);
});

// ── 5. the cell wrapper ────────────────────────────────────────────────────
console.log("\n=== The rendered cell ===");

test("one <td>, class-capped, never positionally", () => {
  const html = journalPlayCell(buy(6, 420000), craftFill(8, 118000), 8);
  assert.ok(/^<td /.test(html) && html.endsWith("</td>"), html);
  assert.ok(html.includes("cell-play"), "must carry the width-cap class");
  assert.ok(!/NaN|undefined|Infinity/.test(html), html);
});

test("a bare tier for bestJournal (no profit) counts as no buy data, not a crash", () => {
  assert.strictEqual(buyFilledValue(7), null);
  assert.strictEqual(buyFilledValue({ journalTier: 7 }), null);
  assert.strictEqual(selfFillValue({ found: false }), null);
  const html = journalPlayCell(7, craftFill(8, 118000), 8);
  assert.ok(html.includes("118,000"), html);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
