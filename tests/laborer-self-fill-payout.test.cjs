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
 * Run: node --test tests/laborer-self-fill-payout.test.cjs
 *
 * Journal prices never touch the payout, coverage, fill window. Shared setup: tests/helpers/laborer-self-fill-setup.cjs.
 */
const {
  assert, LABORERS, TROPHY_LABORERS, LABORER_MODE, getLaborerJournalYield,
  _computeRevenueForMode, laborerSelfFillPayout, computeLaborerSelfFill, getJournalFamePrice,
  getJournalFameBill, getJournalMaxfame, test, setPref, CITY, syntheticMarket, MD, specFor,
  trophySpecFor, GATHERING_LABORERS, CRAFTING_LABORERS, PROFESSION_TROPHIES, ORE, FISHER,
  finish,
} = require("./helpers/laborer-self-fill-setup.cjs");

// ── 1. journal prices must not touch the payout ────────────────────────────
console.log("\n=== The journal is never bought and never sold ===");

// The PAYLOAD is what the laborer returns, and no journal changes hands to get
// it — so no journal price may touch the gross figure. The NET one is a
// different claim entirely: it charges the fame at what the journal would have
// sold for, so it is *supposed* to move with journal prices. Both directions
// are pinned here, because collapsing them is exactly the mistake this column
// has made twice.
test("the payload is identical when every journal price is multiplied 10,000x", () => {
  const cheap = syntheticMarket(0.01);
  const dear = syntheticMarket(100);
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const a = computeLaborerSelfFill({ spec, marketData: cheap, city: CITY, laborerTier: 8, onlyTier: 8 });
    const b = computeLaborerSelfFill({ spec, marketData: dear, city: CITY, laborerTier: 8, onlyTier: 8 });
    assert.strictEqual(a.found, true, `${l.name}: no play found`);
    assert.strictEqual(b.found, true, `${l.name}: no play found`);
    assert.ok(Math.abs(a.payout - b.payout) < 1e-6, `${l.name}: payout moved with journal prices`);
    assert.ok(Math.abs(a.silverPerHour - b.silverPerHour) < 1e-6, `${l.name}: gross rate moved with journal prices`);
  });
});

// The RANKED figure is the payload, so journal prices must not touch it either.
// They move only the COMPARISON — what the same fame would have fetched sold.
// A market where every FULL journal outsells every EMPTY one by the same factor,
// so the chosen city's margin is positive whichever city that turns out to be.
// syntheticMarket() prices _FULL and _EMPTY independently, which leaves the
// single-city margin at the mercy of the hash.
function journalMarginMarket(scale) {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (!id.includes("_JOURNAL_")) return;
    const base = id.endsWith("_FULL") ? 100000 : 10000;
    Object.keys(md[id]).forEach((c) => {
      const p = Math.max(1, Math.round(base * scale));
      md[id][c] = { buy_price: p, sell_price: p, volume_24h: 9999 };
    });
  });
  return md;
}

test("the ranked rate ignores journal prices; only the comparison moves with them", () => {
  const cheap = journalMarginMarket(0.01);
  const dear = journalMarginMarket(1);
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const a = computeLaborerSelfFill({ spec, marketData: cheap, city: CITY, laborerTier: 8, onlyTier: 8 });
    const b = computeLaborerSelfFill({ spec, marketData: dear, city: CITY, laborerTier: 8, onlyTier: 8 });
    assert.ok(Math.abs(a.silverPerHour - b.silverPerHour) < 1e-6,
      `${l.name}: the ranked rate moved with journal prices (${a.silverPerHour} vs ${b.silverPerHour})`);
    assert.strictEqual(a.city, b.city, `${l.name}: the city is chosen on the payload, which did not change`);
    assert.ok(a.famePriced && b.famePriced, `${l.name}: fame went unpriced`);
    assert.ok(b.fameCost > a.fameCost, `${l.name}: dearer journals must value the fame higher`);
    assert.ok(b.netSilverPerHour < a.netSilverPerHour, `${l.name}: comparison ignored the fame price`);
  });
});

// The bill is quoted in the SAME city the payload is priced in. Across the whole
// list it would take the dearest full and the cheapest empty from two different
// cities with no haul between them — a free arbitrage compared against
// single-city revenue.
test("the fame bill is the journal's MARGIN in the payload's own city, never negative", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    const bill = getJournalFameBill({
      slug: spec.journalSlug, tier: sf.journalTier, maxfame: sf.maxfame, marketData: MD,
      cities: [sf.city],
    });
    assert.ok(bill.pricePerFame >= 0, `${l.name}: negative fame price`);
    assert.strictEqual(sf.fameBasis, bill.basis, `${l.name}: basis disagrees`);
    assert.ok(Math.abs(sf.famePrice - bill.pricePerFame) < 1e-12, `${l.name}: fame price disagrees`);
    assert.ok(Math.abs(sf.fameCost - bill.pricePerFame * sf.maxfame) < 1e-6, `${l.name}: bill != price x fame`);
    assert.ok(Math.abs(sf.netPayout - (sf.payout - sf.fameCost)) < 1e-6, `${l.name}: net != gross - bill`);
  });
});

// The pessimistic reading is REPORTED, not ranked: selling the journal full
// without ever replacing it liquidates an asset this loop keeps, so it is a
// bound, and it can never be cheaper than the ranked bill.
test("the full-sale bound is reported beside the ranked figure, and is never cheaper", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    assert.ok(sf.fameCostFull >= sf.fameCost - 1e-6, `${l.name}: bound bill below the ranked one`);
    assert.ok(Math.abs(sf.netPayoutFull - (sf.payout - sf.fameCostFull)) < 1e-6, `${l.name}: bound net != gross - bound bill`);
    assert.ok(sf.netSilverPerHourFull <= sf.netSilverPerHour + 1e-6, `${l.name}: bound rate above the ranked one`);
    assert.ok(Math.abs(sf.netSilverPerHourFull * sf.hours - sf.netPayoutFull) < 1e-6, `${l.name}: bound rate is not per hour`);
  });
});

// THE EMPTY JOURNAL IS ON THE ALTERNATIVE'S SIDE. This loop never buys one, but
// the play it is measured against — fill it and sell it full — must re-buy one
// every cycle, so a dearer empty makes that alternative worth less and the fame
// cheaper. The bound liquidates instead, so nothing moves it.
test("a dearer EMPTY journal lowers the ranked bill and leaves the bound alone", () => {
  setPref(null);
  const dearEmpties = syntheticMarket();
  Object.keys(dearEmpties).forEach((id) => {
    if (!id.endsWith("_EMPTY")) return;
    Object.keys(dearEmpties[id]).forEach((c) => {
      dearEmpties[id][c] = { buy_price: 999999, sell_price: 999999, volume_24h: 9999 };
    });
  });
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const a = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8, onlyTier: 8 });
    const b = computeLaborerSelfFill({ spec, marketData: dearEmpties, city: CITY, laborerTier: 8, onlyTier: 8 });
    assert.ok(b.fameCost < a.fameCost + 1e-6,
      `${l.name}: a 999,999 empty journal must not RAISE the bill (${a.fameCost} -> ${b.fameCost})`);
    assert.strictEqual(b.fameCost, 0, `${l.name}: an unsellable alternative must bill nothing`);
    assert.ok(Math.abs(a.fameCostFull - b.fameCostFull) < 1e-6,
      `${l.name}: the bound liquidates, so the empty price must not touch it`);
  });
});

// The rigged comparison this avoids: a tier with no empty listing billed NOTHING
// would compete gross against tiers billed in full.
// A full sale you cannot repeat is not the alternative play: selling consumes
// the journal, and with no empty on the market there is nothing to buy to run
// that play again. So there is no comparison to draw — and the play's own
// figure, which buys nothing, is unaffected either way.
test("a tier whose EMPTY journal does not trade has no comparison, and still reports its rate", () => {
  setPref(null);
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => { if (id.endsWith("_EMPTY")) delete md[id]; });
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, true, `${l.name}: ${sf.reason}`);
    assert.ok(sf.silverPerHour > 0, `${l.name}: the play itself must still price`);
    assert.strictEqual(sf.famePriced, false, `${l.name}: no empty listing → no margin to compare against`);
    assert.strictEqual(sf.fameBasis, "full", `${l.name}: should say which leg was missing`);
    assert.strictEqual(sf.fameCost, 0, `${l.name}: nothing is billed`);
    assert.ok(sf.fameCostFull > 0, `${l.name}: the liquidation bound is still reported`);
  });
});

// The floor still exists on the PAID-empty path, which the Journal Filling table
// uses: a full journal worth less than the empty it replaces is a play nobody
// runs, so the fame's alternative use is worth nothing rather than a negative.
test("paid-empty: an unsellable journal prices its fame at 0, not at a negative", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (!id.endsWith("_FULL")) return;
    Object.keys(md[id]).forEach((c) => { md[id][c] = { buy_price: 1, sell_price: 1, volume_24h: 9999 }; });
  });
  const price = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame: getJournalMaxfame("ORE", 8), marketData: md });
  assert.ok(price.hasData, "both legs price, so the paid-empty path must resolve");
  assert.strictEqual(price.pricePerFame, 0, "a loss-making journal must not pay a bonus");
});

test("no FULL journal price reports famePriced:false and leaves the figure gross", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => { if (id.includes("_JOURNAL_")) delete md[id]; });
  const spec = specFor(GATHERING_LABORERS[0], 8, LABORER_MODE.RESOURCE);
  const sf = computeLaborerSelfFill({ spec, marketData: md, city: CITY, laborerTier: 8 });
  assert.strictEqual(sf.found, true, sf.reason);
  assert.strictEqual(sf.famePriced, false);
  assert.strictEqual(sf.fameBasis, "none");
  assert.strictEqual(sf.fameCost, 0);
  assert.strictEqual(sf.fameCostFull, 0);
  assert.ok(Math.abs(sf.netSilverPerHour - sf.silverPerHour) < 1e-9);
  assert.ok(Math.abs(sf.netSilverPerHourFull - sf.silverPerHour) < 1e-9);
});

test("the two fame prices do not share a cache entry", () => {
  const maxfame = getJournalMaxfame("ORE", 8);
  const paid = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame, marketData: MD });
  const free = getJournalFamePrice({ slug: "ORE", tier: 8, maxfame, marketData: MD, emptyFree: true });
  assert.ok(free.pricePerFame > paid.pricePerFame,
    "dropping the empty cost must raise the price of the fame");
  assert.strictEqual(paid.emptyCost > 0, true, "the paid path still buys an empty");
  assert.strictEqual(free.emptyCost, 0, "the free path buys nothing");
});

test("payout equals _computeRevenueForMode exactly — no resale, no purchase", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const sf = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    // In the city the play CHOSE — it prices itself in whichever laborer city
    // pays most, so the row's own city is a fallback, not the constraint.
    const direct = _computeRevenueForMode(
      { ...spec, tier: sf.journalTier, yield: getLaborerJournalYield(sf.journalTier, 8) },
      MD, sf.city,
    );
    assert.ok(Math.abs(sf.payout - direct.revenue) < 1e-6,
      `${l.name}: payout ${sf.payout} != payload revenue ${direct.revenue} at ${sf.city}`);
  });
});

test("laborerSelfFillPayout reports no data for an unpriced market", () => {
  const spec = specFor(GATHERING_LABORERS[0], 8, LABORER_MODE.RESOURCE);
  const r = laborerSelfFillPayout(spec, {}, CITY, 8, 8);
  assert.strictEqual(r.hasData, false);
  assert.strictEqual(r.revenue, 0);
});

// ── 2. coverage: the slugs that DO have a fame/hour model ──────────────────
console.log("\n=== Coverage: every gathering journal gets a number ===");

test("all 6 gathering laborers produce a self-fill play", () => {
  setPref(null);
  assert.strictEqual(GATHERING_LABORERS.length, 6, "expected 6 gathering laborers");
  GATHERING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, true, `${l.name}: ${sf.reason}`);
    assert.ok(sf.hours > 0, `${l.name}: no hours`);
    assert.ok(sf.silverPerHour > 0, `${l.name}: no rate`);
  });
});

test("all 6 profession trophy lines produce a self-fill play", () => {
  setPref(null);
  assert.strictEqual(PROFESSION_TROPHIES.length, 6, "expected 6 profession trophy lines");
  PROFESSION_TROPHIES.forEach((line) => {
    const sf = computeLaborerSelfFill({ spec: trophySpecFor(line, 8), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, true, `${line.name}: ${sf.reason}`);
    assert.ok(sf.silverPerHour > 0, `${line.name}: no rate`);
  });
});

test("the General trophy journal has a fill model too", () => {
  setPref(null);
  const line = TROPHY_LABORERS.find((l) => l.journalSlug === "TROPHY_GENERAL");
  const sf = computeLaborerSelfFill({ spec: trophySpecFor(line, 8), marketData: MD, city: CITY, laborerTier: 8 });
  assert.strictEqual(sf.found, true, sf.reason);
});

console.log("\n=== Coverage: the slugs with no fame/hour model say so ===");

// The 4 crafting journals ARE priced — in crafts, by js/laborer-craft-fill.js,
// which tests/laborer-craft-fill.test.cjs covers. This sandbox deliberately does
// not load it, so what is pinned here is the degradation: with no craft module
// present the gathering path must say "no model", never invent an hourly rate.
test("the 4 crafting laborers never reach the HOURLY model", () => {
  setPref(null);
  assert.strictEqual(CRAFTING_LABORERS.length, 4, "expected 4 crafting laborers");
  CRAFTING_LABORERS.forEach((l) => {
    const sf = computeLaborerSelfFill({ spec: specFor(l, 8, LABORER_MODE.CRAFTING), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(sf.found, false, `${l.name} has no fame/HOUR model`);
    assert.strictEqual(sf.reason, "no-fame-model");
    assert.strictEqual(sf.silverPerHour, 0);
    assert.strictEqual(sf.hours, 0);
  });
});

test("the mercenary journal and trophy report no-fame-model", () => {
  setPref(null);
  const merc = LABORERS.find((l) => l.slug === "MERCENARY");
  const a = computeLaborerSelfFill({ spec: specFor(merc, 8, LABORER_MODE.MERCENARY), marketData: MD, city: CITY, laborerTier: 8 });
  assert.strictEqual(a.found, false);
  assert.strictEqual(a.reason, "no-fame-model");
  const line = TROPHY_LABORERS.find((l) => l.journalSlug === "TROPHY_MERCENARY");
  const b = computeLaborerSelfFill({ spec: trophySpecFor(line, 8), marketData: MD, city: CITY, laborerTier: 8 });
  assert.strictEqual(b.found, false);
  assert.strictEqual(b.reason, "no-fame-model");
});

// ── 3. the fill window bounds the candidates ───────────────────────────────
console.log("\n=== The fill window bounds which journals this loop can use ===");


// The stored Gathering Tier is DEAD — the header control made way for the Daily
// Production Bonus select — so the window rides the LABORER's own tier whatever
// a legacy install still carries in storage.
const WINDOW_CASES = [
  { pref: null, want: [6, 7, 8], why: "no stored tier — a T8 laborer's owner gathers at T8, so T6-T8" },
  { pref: 8,    want: [6, 7, 8], why: "a stale stored tier is ignored — the control is gone" },
  { pref: 5,    want: [6, 7, 8], why: "a stale stored tier is ignored — the control is gone" },
  { pref: 2,    want: [6, 7, 8], why: "a stale stored tier is ignored — the control is gone" },
];
for (const c of WINDOW_CASES) {
  test(`land candidates at pref ${c.pref} — ${c.why}`, () => {
    setPref(c.pref);
    const sf = computeLaborerSelfFill({ spec: specFor(ORE, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.deepStrictEqual(sf.candidateTiers, c.want);
  });
}

// THE BUG THIS COLUMN SHIPPED. With no preference set, the gathering tier is the
// LABORER's, so the ±2 window bites — it used to be the candidate journal's own
// tier, which made canFillAtTier trivially true and offered a T8 laborer every
// tier from T2 up.
const LABORER_TIER_CASES = [
  { laborerTier: 8, want: [6, 7, 8] },
  { laborerTier: 7, want: [5, 6, 7] },
  { laborerTier: 5, want: [3, 4, 5] },
  { laborerTier: 4, want: [2, 3, 4] },
  { laborerTier: 3, want: [2, 3] },
  { laborerTier: 2, want: [2] },
];
for (const c of LABORER_TIER_CASES) {
  test(`a T${c.laborerTier} land laborer fills T${c.want[0]}-T${c.want[c.want.length - 1]} with no preference set`, () => {
    setPref(null);
    const sf = computeLaborerSelfFill({
      spec: specFor(ORE, c.laborerTier, LABORER_MODE.RESOURCE),
      marketData: MD, city: CITY, laborerTier: c.laborerTier,
    });
    assert.deepStrictEqual(sf.candidateTiers, c.want);
    assert.strictEqual(sf.gatherTier, c.laborerTier, "the row must be priced at the laborer's own tier");
  });
}

test("a stale stored Gathering Tier is ignored — the row prices at the laborer's own tier", () => {
  setPref(4);
  const sf = computeLaborerSelfFill({ spec: specFor(ORE, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
  assert.strictEqual(sf.gatherTier, 8, "the preference is gone; the laborer's own tier rules");
  assert.deepStrictEqual(sf.candidateTiers, [6, 7, 8]);
  setPref(null);
});

test("every candidate in one row is filled at the SAME gathering tier", () => {
  setPref(null);
  GATHERING_LABORERS.forEach((l) => {
    const spec = specFor(l, 8, LABORER_MODE.RESOURCE);
    const all = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8 });
    all.candidateTiers.forEach((t) => {
      const one = computeLaborerSelfFill({ spec, marketData: MD, city: CITY, laborerTier: 8, onlyTier: t });
      if (!one.found) return;
      assert.strictEqual(one.gatherTier, 8,
        `${l.name}: T${t} priced at T${one.gatherTier}, not the laborer's T8`);
    });
  });
});

test("fishing ignores the window at every preference", () => {
  for (const pref of [null, 2, 5, 8]) {
    setPref(pref);
    const sf = computeLaborerSelfFill({ spec: specFor(FISHER, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8 });
    assert.deepStrictEqual(sf.candidateTiers, [2, 3, 4, 5, 6, 7, 8], `pref ${pref}`);
  }
});

test("a laborer never takes a journal above its own tier", () => {
  setPref(null);
  [3, 5, 7].forEach((laborerTier) => {
    const sf = computeLaborerSelfFill({ spec: specFor(ORE, laborerTier, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier });
    sf.candidateTiers.forEach((t) => assert.ok(t <= laborerTier, `T${laborerTier} laborer offered a T${t} journal`));
  });
});

test("a stale stored T8 no longer blanks a T5 laborer (the old preference could)", () => {
  setPref(8);
  // The removed Gathering Tier control forced gather tier 8 onto a T5 laborer
  // whose journals top out at T5 — nothing was fillable and the column went
  // blank ("no-fillable-tier"). Match-tier pricing fills at the laborer's tier.
  const sf = computeLaborerSelfFill({ spec: specFor(ORE, 5, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 5 });
  assert.strictEqual(sf.found, true, "a T5 laborer must not be blanked by stale storage");
  assert.strictEqual(sf.gatherTier, 5, "the laborer's own tier, not the stale stored one");
  assert.deepStrictEqual(sf.candidateTiers, [3, 4, 5]);
  setPref(null);
});

finish();
