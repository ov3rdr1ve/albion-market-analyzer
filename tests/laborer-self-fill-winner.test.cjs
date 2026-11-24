/**
 * Test: the laborer SELF-FILL loop (js/laborer-self-fill.js).
 *
 * The Laborers table's existing model BUYS the journal already full and sells
 * the empty one back, so its constraint is the laborer's 22h cycle and fill
 * speed is somebody else's problem. This column models the other play, the one
 * js/laborer-journal-value.js documents:
 *
 *   fill your own journal with gathering fame → hand it to your laborer →
 *   22h later collect the loot AND THE SAME JOURNAL BACK, empty.
 *
 * So in steady state no journal is ever bought or sold: the GROSS value per
 * journal is the laborer's payload alone. Two things then decide the ranking:
 *
 *   THE WHOLE ROW IS PRICED AT ONE GATHERING TIER — the LABORER's own. The old
 *     header's Gathering Tier preference is gone (the control made way for the
 *     Daily Production Bonus select), so the row always falls through to the
 *     laborer's own tier: one row, one tier, one comparable hour.
 *   THE UNIT IS AN HOUR OF YOUR GATHERING, not a point of fame. A journal's fame
 *     requirement doubles per tier while a gatherer's fame rate rises only
 *     ~1.3-1.9× per tier, so the two units do not agree ACROSS rows. Per fame is
 *     still reported, and inside one row — one gathering tier — the two orders
 *     now coincide by construction; that equivalence is tested below.
 *   THE FAME IS PAID FOR. Its one alternative use is filling the journal and
 *     selling it FULL, so that journal's market value is the price of the fame
 *     (js/journal-fame-price.js). The RANKED bill is the MARGIN — full sell net
 *     of tax minus the empty you must re-buy to run that alternative again. The
 *     self-fill loop still never buys an empty; the play it is measured against
 *     does, which is why the empty is on that side of the ledger. The whole full
 *     sale is reported beside it as the pessimistic bound (liquidate the journal
 *     and never replace it). Every ranked figure is net of the bill, which is
 *     the only thing that makes two tiers comparable — their fame is worth
 *     different silver, not just different amounts.
 *
 * The four traps this pins down:
 *   1. computeBestLaborerRoute's revenue/profit include the empty-journal resale
 *      and the filled-journal purchase. Neither happens here.
 *   2. laborerJournalPayout (laborer-journal-value.js) only resolves a mix for
 *      WARRIOR/HUNTER/MAGE/TOOLMAKER — exactly the slugs with no fame/hour data.
 *      Using it would blank the whole column.
 *   3. The fill window applies here but NOT to the Best Journal column beside it
 *      (that one buys at market), so the two legitimately name different tiers.
 *   4. A tier whose EMPTY journal does not trade must still be billed for its
 *      fame — it falls back to the full sale. Billing it nothing let it compete
 *      gross against tiers charged in full, which could hand the win to the
 *      thinnest market on the board.
 *
 * Black-box: one synthetic market, no live API, no DOM.
 *
 * Run: node --test tests/laborer-self-fill-winner.test.cjs
 *
 * Winner on net silver per hour, the play's own city, capacity annotation. Shared setup: tests/helpers/laborer-self-fill-setup.cjs.
 */
const {
  assert, LABORER_MODE, getLaborerJournalYield, _computeRevenueForMode, LABORER_CYCLE_HOURS,
  computeLaborerSelfFill, selfFillCapacity, GATHER_BASE_FAME_PER_HOUR, test, setPref, CITY,
  syntheticMarket, MD, specFor, GATHERING_LABORERS, ORE, FISHER, finish,
} = require("./helpers/laborer-self-fill-setup.cjs");

// ── 4. the winner is chosen on silver per point of JOURNAL FAME ────────────
//
// The unit is an hour of YOUR gathering. Per-fame is reported but must never
// decide, because the candidates are filled at different gathering tiers and so
// buy their fame at different prices in time.
console.log("\n=== The winner is the best NET silver per hour of gathering ===");

test("the chosen tier really is the max net silver/hour of its candidates", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    sf.candidateTiers.forEach((t) => {
      const one = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8, onlyTier: t });
      if (!one.found) return;
      // The yield is per laborer TYPE — a gatherer has its own +10 trophies and
      // reaches 150% on an own-tier journal, so the slug has to be named here.
      const rev = _computeRevenueForMode({ ...spec, tier: t, yield: getLaborerJournalYield(t, 8, l.slug) }, MD, one.city);
      assert.ok(one.netSilverPerHour <= sf.netSilverPerHour + 1e-9,
        `${l.name}: T${t} scores ${one.netSilverPerHour} > the chosen ${sf.netSilverPerHour}`);
      assert.ok(Math.abs(one.payout - rev.revenue) < 1e-6, `${l.name}: T${t} payout mismatch at ${one.city}`);
    });
  });
});

// One gathering tier per row means famePerHour is constant across its candidates,
// so the per-fame and per-hour orders coincide — inside the row. That is the
// whole (true) half of the old per-fame argument, and it is what makes the hourly
// figure safe to read as a fame figure on a single row. It is NOT a licence to
// rank across rows on fame: a T2 laborer and a T8 laborer gather at different
// speeds, which is what the hour, and only the hour, accounts for.
const ORDER_AGREEMENT_PREFS = [null, 8, 5];
for (const pref of ORDER_AGREEMENT_PREFS) {
  test(`per-fame and per-hour orders agree inside one row (pref ${pref})`, () => {
    setPref(pref);
    GATHERING_LABORERS.forEach((l) => {
      const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
      const all = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
      const scored = all.candidateTiers
        .map((t) => computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8, onlyTier: t }))
        .filter((r) => r.found);
      const byFame = [...scored].sort((a, b) => b.silverPerFame - a.silverPerFame).map((r) => r.journalTier);
      const byHour = [...scored].sort((a, b) => b.silverPerHour - a.silverPerHour).map((r) => r.journalTier);
      assert.deepStrictEqual(byFame, byHour, `${l.name}`);
    });
    setPref(null);
  });
}

// The concrete form of the same claim: within a row, a point of fame costs the
// same slice of your clock whatever tier of journal swallows it, because you are
// gathering at one tier. Fishing is the row where this matters most — it is
// unwindowed, so T2 and T8 sit in the same list.
test("a point of fame costs the same gathering time at every tier of one row", () => {
  setPref(null);
  [ORE, FISHER].forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const all = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    const rates = all.candidateTiers
      .map((t) => computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8, onlyTier: t }))
      .filter((r) => r.found)
      .map((r) => r.hours / r.maxfame);
    rates.forEach((r) => assert.ok(Math.abs(r - rates[0]) < 1e-12,
      `${l.name}: fame costs different time at different tiers of the same row`));
  });
});

test("profitPerCycle is still reported — it is what ONE journal pays the laborer", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, true, `${l.name}: ${sf.reason}`);
    assert.strictEqual(sf.profitPerCycle, sf.payout, `${l.name}`);
  });
});

test("a no-data row reports 0 for every metric, not undefined", () => {
  setPref(null);
  [undefined, null, {}, { journalSlug: "NOPE" }].forEach((spec) => {
    const sf = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.profitPerCycle, 0);
    assert.strictEqual(sf.silverPerFame, 0);
  });
});

// The biggest-paying journal is not automatically the winner: a T8 journal is
// 28,800 fame at 19,000 fame/h = 1.52 h against a T3's 900 at 2,800 = 0.32 h, so
// the T8 must pay ~4.7× the T3 to break even on your clock. Here T8 loot is
// tripled — it has by far the biggest payout and still loses. Pinning this stops
// a "fix" that reinstates the raw payout as the sort key.
test("the biggest-paying journal loses when it fills too slowly", () => {
  setPref(null);
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (!id.startsWith("T8_") || id.includes("_JOURNAL_")) return;
    Object.keys(md[id]).forEach((c) => {
      md[id][c] = { buy_price: md[id][c].buy_price * 3, sell_price: md[id][c].sell_price * 3, volume_24h: 9999 };
    });
  });
  let sawSmallerWinner = false;
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8 });
    if (!sf.found) return;
    const scored = sf.candidateTiers
      .map((t) => computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8, onlyTier: t }))
      .filter((r) => r.found);
    // The winner really is the top net rate …
    scored.forEach((one) => {
      assert.ok(one.netSilverPerHour <= sf.netSilverPerHour + 1e-9,
        `${l.name}: T${one.journalTier} out-rates the winner`);
    });
    // … and it is NOT the top payout.
    if (scored.some((one) => one.payout > sf.payout + 1e-6)) sawSmallerWinner = true;
  });
  assert.ok(sawSmallerWinner,
    "at least one row must win with a journal that is NOT the biggest payout");
});

test("the yield is the tier-advantage 150% for a lower journal, same-tier rate at the top", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.yield, getLaborerJournalYield(sf.journalTier, 8), `${l.name}`);
    if (sf.journalTier < 8) assert.strictEqual(sf.yield, 1.5, `${l.name}: lower tier must run at 150%`);
  });
});

test("silver/hour is payout ÷ hours, exactly", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.ok(Math.abs(sf.silverPerHour - sf.payout / sf.hours) < 1e-6, `${l.name}`);
  });
});

test("silver/fame is payout ÷ the journal's maxfame — reported, never the sort key", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.ok(sf.maxfame > 0, `${l.name}: no maxfame`);
    assert.ok(Math.abs(sf.silverPerFame - sf.payout / sf.maxfame) < 1e-9, `${l.name}`);
  });
});

// ── 4b. the play prices itself, and says where ─────────────────────────────
console.log("\n=== The play picks its own city ===");

test("the city the play names is the one that pays most, not the one passed in", () => {
  setPref(null);
  // One city made 10x richer for every payload — the play must move there even
  // though the caller passed a different city.
  const rich = "Bridgewatch";
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (id.includes("_JOURNAL_")) return;
    md[id][rich] = { buy_price: md[id][rich].buy_price * 10, sell_price: md[id][rich].sell_price * 10, volume_24h: 9999 };
  });
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: md, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, true, `${l.name}: ${sf.reason}`);
    assert.strictEqual(sf.city, rich, `${l.name}: priced in ${sf.city}, not the 10x city`);
    const here = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.ok(sf.payout > here.payout, `${l.name}: the richer city must pay more`);
  });
});

test("the caller's city wins an exact tie, so the column does not wander", () => {
  setPref(null);
  // Every city priced identically: nothing beats the row's own city.
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    Object.keys(md[id]).forEach((c) => { md[id][c] = { buy_price: 500, sell_price: 575, volume_24h: 9999 }; });
  });
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: md, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.city, CITY, `${l.name}: tie moved off ${CITY}`);
  });
});

test("the verdict no longer depends on which city the caller passed", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const a = computeLaborerSelfFill({ spec, marketData: MD, city: "Lymhurst", laborerTier: 8 });
    const b = computeLaborerSelfFill({ spec, marketData: MD, city: "Martlock", laborerTier: 8 });
    assert.strictEqual(a.journalTier, b.journalTier, `${l.name}: tier moved with the caller's city`);
    assert.ok(Math.abs(a.payout - b.payout) < 1e-6, `${l.name}: payout moved with the caller's city`);
  });
});

// ── 5. capacity is annotated, never folded into the rate ───────────────────
console.log("\n=== The 22h cycle is an annotation, not a cap ===");

test("LABORER_CYCLE_HOURS is 22", () => {
  assert.strictEqual(LABORER_CYCLE_HOURS, 22);
});

test("a fast fill feeds several laborers and idles none", () => {
  setPref(null);
  // T2 ore: 450 fame at the derived T2 land rate — well under an hour, so one
  // player keeps dozens of laborers fed and none of them idles.
  const t2Rate = GATHER_BASE_FAME_PER_HOUR[2];
  const sf = computeLaborerSelfFill({ spec: specFor(ORE, 2, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 2 });
  assert.strictEqual(sf.found, true, sf.reason);
  assert.ok(sf.hours < 1, `expected a sub-hour fill, got ${sf.hours}`);
  assert.ok(Math.abs(sf.hours - 450 / t2Rate) < 1e-9, `hours ${sf.hours}`);
  assert.ok(Math.abs(sf.laborersFed - 22 / sf.hours) < 1e-6, `laborersFed ${sf.laborersFed}`);
  assert.strictEqual(sf.idleHours, 0);
});

// No journal in the game is slow enough to idle a laborer at the app's fame/hour
// estimates, so the slow half of the capacity rule is pinned on the pure helper.
const CAPACITY_CASES = [
  { hours: 0.3,  fed: 22 / 0.3,  idle: 0 },
  { hours: 3.1,  fed: 22 / 3.1,  idle: 0 },
  { hours: 22,   fed: 1,         idle: 0 },
  { hours: 30,   fed: 22 / 30,   idle: 8 },
  { hours: 86.4, fed: 22 / 86.4, idle: 64.4 },
  { hours: 0,    fed: 0,         idle: 0 },
];
for (const c of CAPACITY_CASES) {
  test(`selfFillCapacity(${c.hours}) — feeds ${c.fed.toFixed(2)}, idles ${c.idle}`, () => {
    const r = selfFillCapacity(c.hours);
    assert.ok(Math.abs(r.laborersFed - c.fed) < 1e-6, `laborersFed ${r.laborersFed}`);
    assert.ok(Math.abs(r.idleHours - c.idle) < 1e-6, `idleHours ${r.idleHours}`);
  });
}

test("the rate is never capped at the cycle — it stays payout ÷ gathering hours", () => {
  setPref(null);
  const fast = computeLaborerSelfFill({ spec: specFor(ORE, 2, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 2 });
  // 0.3h to fill, far under a 22h cycle: a capped rate would be payout/22.
  assert.ok(fast.hours < LABORER_CYCLE_HOURS);
  assert.ok(Math.abs(fast.silverPerHour - fast.payout / fast.hours) < 1e-6,
    "the rate must stay payout ÷ gathering hours, never the cycle");
  assert.ok(fast.silverPerHour > fast.payout / LABORER_CYCLE_HOURS,
    "a capped rate would be strictly smaller here — it is not capped");
});

test("an unknown / missing spec returns a reason instead of throwing", () => {
  setPref(null);
  [undefined, null, {}, { journalSlug: "NOPE" }].forEach((spec) => {
    const sf = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, false);
    assert.ok(sf.reason, "a reason must be given");
    assert.strictEqual(sf.silverPerHour, 0);
  });
});

finish();
