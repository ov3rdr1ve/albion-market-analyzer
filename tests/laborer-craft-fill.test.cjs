/**
 * Test: the CRAFTING laborer self-fill loop (js/laborer-craft-fill.js).
 *
 * The gathering half of the Fill Speed / Max Profit column (laborer-self-fill.js)
 * is denominated in HOURS, because a gathering journal is filled by gathering
 * fame and this repo has a fame/hour estimate for it. The four crafting journals
 * (Blacksmith/WARRIOR, Fletcher/HUNTER, Imbuer/MAGE, Tinker/TOOLMAKER) have no
 * such rate — crafting is instant in-game, so crafts/hour would be invented.
 * Fill EFFORT is denominated in CRAFTS instead:
 *
 *   crafts to fill = journal maxfame ÷ fame per craft
 *
 * and so is the RANKING: NET silver per craft. Two earlier units were tried and
 * are both wrong — silver per 22h laborer cycle (only right when the LABORER is
 * the bottleneck) and silver per point of fame (fame is not one unit: it costs a
 * different number of presses at every tier, exactly as it costs a different
 * number of gathering minutes at every tier on the other side). These rows and
 * the hourly gathering rows are therefore BANDED in the merged column's sort,
 * not compared.
 *
 * NET of what? The fame's one alternative use: fill the journal and SELL it
 * full. The market margin on that journal is the price of the fame that filled
 * it (js/journal-fame-price.js), and it is subtracted here.
 *
 * The traps this pins down:
 *   1. The journal is never bought or sold in this loop, so journal market
 *      prices must not move the PAYLOAD by a single silver — while the NET
 *      figure is priced off exactly those journal prices, and must move.
 *   2. A crafting journal is filled ONLY by crafts of its own tier (items.xml
 *      <craftitemfame><validitem>), never the ±2 window the gathering journals
 *      use — so the craft named by a row must really fill that exact journal.
 *      This is also why "craft T8 gear to fill a T3 journal" is not a play: the
 *      journal tier pins the craft tier.
 *   3. silver/fame and the GROSS silver/craft are still computed and still
 *      shown; they just no longer decide the winner.
 *   4. A laborer can never take a journal above its own tier.
 *
 * Black-box: one synthetic market, no live API, no DOM.
 *
 * Run: node tests/laborer-craft-fill.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}
function loadSrc(rel) {
  return loadFile(rel).replace(/if \(typeof module[\s\S]*$/, "");
}

const store = new Map();

const sandbox = `
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SETUP_FEE = 0.025;
const PREMIUM_TAX = 0.065;

function isBlackRedZoneEnabled() { return false; }
function getOrderType() { return "instant"; }
function getOverridePrice() { return null; }
function getOverrideVolume() { return null; }
function getCityForce() { return null; }
function getIQRBounds() { return { upper: Infinity }; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function tx(en) { return en; }

function getBuyPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city) {
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || itemData[city].sell_price || 0;
}
function findBestBuyCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getBuyPrice(marketData[itemId], c);
    if (p <= 0) continue;
    if (!bestCity || p < bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice, travelCost: 0 };
}
function findBestSellCity(marketData, itemId, cities) {
  let bestCity = null, bestPrice = 0;
  for (const c of cities) {
    const p = getSellPrice(marketData[itemId], c);
    if (p <= 0) continue;
    if (!bestCity || p > bestPrice) { bestCity = c; bestPrice = p; }
  }
  return { city: bestCity, price: bestPrice };
}
`;

global.calcJournalEconomics = require("../js/calculations.js").calcJournalEconomics;

const GEAR_FILES = [
  "js/gear-cloth-armor.js", "js/gear-leather-armor.js", "js/gear-leather-dragon.js", "js/gear-plate-armor.js",
  "js/gear-melee-light.js", "js/gear-melee-heavy.js", "js/gear-ranged.js",
  "js/gear-staves-a.js", "js/gear-staves-b.js", "js/gear-staves-c.js",
  "js/gear-offhand.js", "js/gear-capes.js", "js/gear-tools.js", "js/gear-gatherer.js",
  "js/gear-crystal-weapons.js", "js/gear-crystal-weapons-b.js",
  "js/gear.js",
];

const mod = new Module("laborer-craft-fill-test");
mod._compile(
  sandbox +
    GEAR_FILES.map(loadSrc).join("\n") +
    loadSrc("js/data-gathering.js") +
    loadSrc("js/gather-fame-rates.js") +
    loadSrc("js/data-journals.js") +
    loadSrc("js/journal-fill-speed.js") +
    loadSrc("js/journal-fame-price.js") +
    loadSrc("js/data-laborers.js") +
    loadSrc("js/laborers-pricing.js") +
    loadSrc("js/data-craft-journal-fame.js") +
    loadSrc("js/data-craft-planner.js") +
    loadSrc("js/laborer-journal-value.js") +
    loadSrc("js/laborer-craft-fill.js") +
    loadSrc("js/laborer-self-fill.js") +
    "\nmodule.exports = { LABORERS, LABORER_TIERS, LABORER_MODE, GEAR_RECIPES_ALL, " +
    "getLaborersItemIds, getLaborerJournalYield, getCraftJournalForItem, " +
    "CRAFT_JOURNAL_MAXFAME, _laborerJournalRowSpec, _trophyRowSpec, TROPHY_LABORERS, " +
    "getCraftFillCandidate, computeLaborerCraftFill, computeLaborerSelfFill, " +
    "craftFillCell, selfFillCell, formatCraftCount, getJournalFamePrice, getJournalFameBill };",
  "laborer-craft-fill.js",
);

global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  LABORERS, LABORER_TIERS, LABORER_MODE, GEAR_RECIPES_ALL, getLaborersItemIds,
  getLaborerJournalYield, getCraftJournalForItem, CRAFT_JOURNAL_MAXFAME,
  _laborerJournalRowSpec, _trophyRowSpec, TROPHY_LABORERS,
  getCraftFillCandidate, computeLaborerCraftFill, computeLaborerSelfFill,
  craftFillCell, selfFillCell, formatCraftCount, getJournalFameBill,
} = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
const CITY = "Lymhurst";

// ── synthetic market ───────────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}
function syntheticMarket(journalPriceFactor = 1) {
  const md = {};
  const cities = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
  getLaborersItemIds().forEach((id) => {
    md[id] = {};
    const isJournal = id.includes("_JOURNAL_");
    cities.forEach((c) => {
      let price = 40 + (hash(id + c) % 9000);
      if (isJournal) price = Math.max(1, Math.round(price * journalPriceFactor));
      md[id][c] = { buy_price: price, sell_price: Math.round(price * 1.15), volume_24h: 9999 };
    });
  });
  return md;
}
const MD = syntheticMarket();

const CRAFTING_LABORERS = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.CRAFTING));
const GATHERING_LABORERS = LABORERS.filter((l) => l.modes.includes(LABORER_MODE.RESOURCE));
const TINKER = LABORERS.find((l) => l.slug === "TOOLMAKER");
const craftSpec = (l, tier) => _laborerJournalRowSpec(l, tier, LABORER_MODE.CRAFTING);

// ── 1. the catalogue every crafting journal tier draws from ────────────────
console.log("\n=== The craft that fills the journal ===");

test("the unfiltered gear catalogue reaches below T4 (the T2/T3 journals need it)", () => {
  assert.ok(Array.isArray(GEAR_RECIPES_ALL), "GEAR_RECIPES_ALL should be an array");
  const lowTier = GEAR_RECIPES_ALL.filter((i) => /^T[23]_/.test(i.id));
  assert.ok(lowTier.length > 0, "expected T2/T3 recipes in the unfiltered catalogue");
});

CRAFTING_LABORERS.forEach((l) => {
  LABORER_TIERS.forEach((tier) => {
    test(`${l.name} T${tier}: a fillable craft exists and really fills that journal`, () => {
      const c = getCraftFillCandidate(l.slug, tier);
      assert.ok(c, `no craft found for ${l.slug} T${tier}`);
      const hit = getCraftJournalForItem(c.itemId);
      assert.ok(hit, `${c.itemId} fills no crafting journal at all`);
      assert.strictEqual(hit.slug, l.slug);
      assert.strictEqual(hit.tier, tier, "a crafting journal is filled by its OWN tier only");
    });
  });
});

test("crafts x fame-per-craft equals the journal's maxfame", () => {
  CRAFTING_LABORERS.forEach((l) => {
    LABORER_TIERS.forEach((tier) => {
      const c = getCraftFillCandidate(l.slug, tier);
      assert.ok(c.famePerCraft > 0, `${l.slug} T${tier} fame per craft`);
      assert.ok(Number.isFinite(c.crafts) && c.crafts > 0, `${l.slug} T${tier} crafts`);
      const rebuilt = c.crafts * c.famePerCraft;
      assert.ok(Math.abs(rebuilt - CRAFT_JOURNAL_MAXFAME[tier]) < 1e-6,
        `${l.slug} T${tier}: ${rebuilt} != ${CRAFT_JOURNAL_MAXFAME[tier]}`);
    });
  });
});

// Artifact materials award no crafting fame, so they do not count toward the
// fill. Restated here rather than imported: it is the rule under test.
const ARTIFACT_MAT = /ARTEFACT|QUESTITEM_TOKEN|_FACTION_|UNIQUE_GVGTOKEN|_FARM_|_MOUNT_|ALCHEMY_RARE/;
const fameMats = (item) =>
  (item.materials || []).reduce((n, m) => (ARTIFACT_MAT.test(m.matId) ? n : n + m.count), 0);

test("the named craft is the FASTEST filler at that tier (most fame per craft)", () => {
  CRAFTING_LABORERS.forEach((l) => {
    const c = getCraftFillCandidate(l.slug, 8);
    assert.strictEqual(c.matCount * 1395, c.famePerCraft, `${c.itemId}: T8 fame = mats x 1395`);
    GEAR_RECIPES_ALL.forEach((item) => {
      const hit = getCraftJournalForItem(item.id);
      if (!hit || hit.slug !== l.slug || hit.tier !== 8) return;
      const mats = fameMats(item);
      assert.ok(mats * 1395 <= c.famePerCraft + 1e-9,
        `${item.id} (${mats} fame mats) fills faster than the chosen ${c.itemId}`);
    });
  });
});

test("an artifact material does not count toward the fill", () => {
  const artifactCraft = GEAR_RECIPES_ALL.find(
    (i) => i.id === "T8_2H_HALBERD_MORGANA" && (i.materials || []).some((m) => ARTIFACT_MAT.test(m.matId)),
  );
  assert.ok(artifactCraft, "expected T8_2H_HALBERD_MORGANA in the catalogue");
  const total = (artifactCraft.materials || []).reduce((n, m) => n + m.count, 0);
  assert.ok(fameMats(artifactCraft) < total, "the artifact should be excluded");
  const c = getCraftFillCandidate("WARRIOR", 8);
  assert.ok(c.famePerCraft >= fameMats(artifactCraft) * 1395);
});

test("an unknown slug and a gathering slug have no craft candidate", () => {
  assert.strictEqual(getCraftFillCandidate("NOPE", 8), null);
  assert.strictEqual(getCraftFillCandidate("ORE", 8), null);
  assert.strictEqual(getCraftFillCandidate("TOOLMAKER", 1), null);
});

// ── 2. the row model ───────────────────────────────────────────────────────
console.log("\n=== One row: which journal tier, priced how ===");

test("every crafting laborer resolves a self-fill play (Tinker included)", () => {
  CRAFTING_LABORERS.forEach((l) => {
    const r = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(r.found, true, `${l.name}: ${r.reason}`);
    assert.strictEqual(r.kind, "craft");
    assert.ok(r.crafts > 0 && Number.isFinite(r.crafts), `${l.name} crafts`);
    assert.ok(r.payout > 0, `${l.name} payout`);
    assert.ok(r.silverPerFame > 0, `${l.name} silver/fame`);
  });
});

test("a gathering laborer is not a crafting-fill row", () => {
  GATHERING_LABORERS.forEach((l) => {
    const r = computeLaborerCraftFill({
      spec: _laborerJournalRowSpec(l, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8,
    });
    assert.strictEqual(r.found, false, `${l.name} should not resolve a craft fill`);
    assert.strictEqual(r.reason, "not-a-craft-journal");
  });
});

test("silver per fame is the payout divided by the journal's maxfame", () => {
  CRAFTING_LABORERS.forEach((l) => {
    LABORER_TIERS.forEach((tier) => {
      const r = computeLaborerCraftFill({ spec: craftSpec(l, tier), marketData: MD, city: CITY, laborerTier: tier });
      if (!r.found) return;
      const expected = r.payout / CRAFT_JOURNAL_MAXFAME[r.journalTier];
      assert.ok(Math.abs(r.silverPerFame - expected) < 1e-6, `${l.name} T${tier}`);
      const perCraft = r.payout / r.crafts;
      assert.ok(Math.abs(r.silverPerCraft - perCraft) < 1e-6, `${l.name} T${tier} silver/craft`);
    });
  });
});

test("the journal tier never exceeds the laborer's tier", () => {
  CRAFTING_LABORERS.forEach((l) => {
    LABORER_TIERS.forEach((tier) => {
      const r = computeLaborerCraftFill({ spec: craftSpec(l, tier), marketData: MD, city: CITY, laborerTier: tier });
      if (!r.found) return;
      assert.ok(r.journalTier <= tier, `${l.name} T${tier} picked a T${r.journalTier} journal`);
    });
  });
});

// A press is the unit, not a point of fame. Fame per craft rises harder than
// journal maxfame does, so the two orders are not the same, and per-fame ranking
// made a T2 journal — 442 silver per fame but a few hundred silver per press —
// look like the best play a T8 Blacksmith had.
test("the winning tier is the best NET silver per craft of all candidates", () => {
  CRAFTING_LABORERS.forEach((l) => {
    const best = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: MD, city: CITY, laborerTier: 8 });
    assert.strictEqual(best.found, true);
    best.candidateTiers.forEach((t) => {
      const one = computeLaborerCraftFill({
        spec: craftSpec(l, 8), marketData: MD, city: CITY, laborerTier: 8, onlyTier: t,
      });
      if (!one.found) return;
      assert.ok(best.netSilverPerCraft >= one.netSilverPerCraft - 1e-9,
        `${l.name}: T${t} (${one.netSilverPerCraft}) beats the winner (${best.netSilverPerCraft})`);
    });
  });
});

// The crafting loop charges the same bill the gathering one does: the journal's
// MARGIN. This loop never buys an empty — the laborer returns the same one — but
// the alternative it is measured against sells the journal full and must re-buy
// an empty to run again, so the empty is on that play's side of the ledger.
// The comparison is drawn in the SAME city the payload is priced in. Quoted
// across the whole list it would take the dearest full and the cheapest empty
// from two different cities with no haul between them.
test("the comparison is gross minus the journal's MARGIN in the payload's city", () => {
  CRAFTING_LABORERS.forEach((l) => {
    const r = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: MD, city: CITY, laborerTier: 8 });
    const bill = getJournalFameBill({
      slug: craftSpec(l, 8).journalSlug, tier: r.journalTier, maxfame: r.maxfame, marketData: MD,
      cities: [r.city],
    });
    assert.strictEqual(r.famePriced, bill.hasData, `${l.name}: famePriced disagrees`);
    assert.strictEqual(r.fameBasis, bill.basis, `${l.name}: basis disagrees`);
    assert.ok(bill.pricePerFame >= 0, `${l.name}: negative fame price`);
    assert.ok(Math.abs(r.fameCost - bill.pricePerFame * r.maxfame) < 1e-6, `${l.name}: bill != price x fame`);
    assert.ok(Math.abs(r.netPayout - (r.payout - r.fameCost)) < 1e-6, `${l.name}: net != gross - bill`);
    assert.ok(Math.abs(r.netSilverPerCraft - r.netPayout / r.crafts) < 1e-6, `${l.name}: per craft`);
  });
});

// The whole-full-sale reading is reported as a bound, never ranked.
test("the full-sale bound is reported per craft, and is never above the ranked figure", () => {
  CRAFTING_LABORERS.forEach((l) => {
    const r = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: MD, city: CITY, laborerTier: 8 });
    assert.ok(r.fameCostFull >= r.fameCost - 1e-6, `${l.name}: bound bill below the ranked one`);
    assert.ok(Math.abs(r.netPayoutFull - (r.payout - r.fameCostFull)) < 1e-6, `${l.name}: bound net != gross - bound bill`);
    assert.ok(r.netSilverPerCraftFull <= r.netSilverPerCraft + 1e-6, `${l.name}: bound rate above the ranked one`);
    assert.ok(Math.abs(r.netSilverPerCraftFull - r.netPayoutFull / r.crafts) < 1e-6, `${l.name}: bound is not per craft`);
  });
});

// Fame is the unit the gathering rows and these rows share, and the reason the
// column can drop hours: these rows never had any.
test("profitPerCycle is still reported — what ONE journal pays the laborer", () => {
  CRAFTING_LABORERS.forEach((l) => {
    LABORER_TIERS.forEach((tier) => {
      const r = computeLaborerCraftFill({ spec: craftSpec(l, tier), marketData: MD, city: CITY, laborerTier: tier });
      if (!r.found) {
        assert.strictEqual(r.profitPerCycle, 0, `${l.name} T${tier}: a no-data row must report 0`);
        assert.strictEqual(r.silverPerFame, 0, `${l.name} T${tier}`);
        return;
      }
      assert.strictEqual(r.profitPerCycle, r.payout, `${l.name} T${tier}`);
    });
  });
});

// The intuition this repo kept re-deriving, pinned so nobody "fixes" the crafts
// column back into a gathering-shaped one: crafting fame per craft scales HARDER
// than journal maxfame does (CRAFT_BASE_FAME_MULT ×1395 at T8 against ×270 at
// T6, on a similar material count), so a T8 crafting journal fills in FEWER
// presses than a T6 one. There is no "many cheap low-tier journals" play on the
// crafting side — the tradeoff exists only per point of fame.
test("a higher-tier crafting journal fills in FEWER crafts, not more", () => {
  CRAFTING_LABORERS.forEach((l) => {
    const slug = l.journalSlug;
    const crafts = [4, 5, 6, 7, 8]
      .map((t) => getCraftFillCandidate(slug, t))
      .filter(Boolean)
      .map((c) => c.crafts);
    for (let i = 1; i < crafts.length; i++) {
      assert.ok(crafts[i] <= crafts[i - 1] + 1e-9,
        `${l.name}: crafts-to-fill went UP with tier (${crafts.join(" -> ")})`);
    }
  });
});

// ── 2b. the play prices itself, and says where ─────────────────────────────
console.log("\n=== The play picks its own city ===");

test("the city named is the one that pays most, not the one passed in", () => {
  const rich = "Bridgewatch";
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (id.includes("_JOURNAL_")) return;
    md[id][rich] = { buy_price: md[id][rich].buy_price * 10, sell_price: md[id][rich].sell_price * 10, volume_24h: 9999 };
  });
  CRAFTING_LABORERS.forEach((l) => {
    const r = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: md, city: CITY, laborerTier: 8 });
    assert.strictEqual(r.found, true, `${l.name}: ${r.reason}`);
    assert.strictEqual(r.city, rich, `${l.name}: priced in ${r.city}, not the 10x city`);
  });
});

test("one laborer's tiers no longer disagree because the caller's city moved", () => {
  // The bug this replaces: the caller passed each row's own buy-the-journal
  // route city, so a T8 row priced in a thin city named a different journal
  // than the T7 row beside it, for the same play.
  CRAFTING_LABORERS.forEach((l) => {
    const a = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: MD, city: "Martlock", laborerTier: 8 });
    const b = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: MD, city: "Caerleon", laborerTier: 8 });
    assert.strictEqual(a.journalTier, b.journalTier, `${l.name}: tier moved with the caller's city`);
    assert.strictEqual(a.city, b.city, `${l.name}: winning city moved with the caller's city`);
    assert.ok(Math.abs(a.payout - b.payout) < 1e-6, `${l.name}: payout moved with the caller's city`);
  });
});

test("the caller's city wins an exact tie", () => {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    Object.keys(md[id]).forEach((c) => { md[id][c] = { buy_price: 500, sell_price: 575, volume_24h: 9999 }; });
  });
  const r = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: md, city: CITY, laborerTier: 8 });
  assert.strictEqual(r.city, CITY);
});

test("a journal below the laborer's tier runs at the 150% ceiling", () => {
  const r = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8, onlyTier: 5 });
  assert.strictEqual(r.found, true, r.reason);
  assert.strictEqual(r.yield, 1.5);
  const same = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8, onlyTier: 8 });
  assert.strictEqual(same.yield, getLaborerJournalYield(8, 8));
});

// ── 3. the journal is never traded ─────────────────────────────────────────
console.log("\n=== No journal is bought or sold in this loop ===");

// The PAYLOAD never touches a journal price — nothing is bought or sold to earn
// it. The NET figure is a different claim and is *supposed* to move: it charges
// the fame at what the journal would have sold for, so dearer journals make
// feeding the laborer a worse trade. Tier is pinned here because that same
// pricing can legitimately move which tier wins.
test("multiplying every journal price by 100 does not move the payout", () => {
  const cheap = syntheticMarket(0.01);
  const dear = syntheticMarket(100);
  CRAFTING_LABORERS.forEach((l) => {
    const a = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: cheap, city: CITY, laborerTier: 8, onlyTier: 8 });
    const b = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: dear, city: CITY, laborerTier: 8, onlyTier: 8 });
    assert.strictEqual(a.found, true);
    assert.strictEqual(a.payout, b.payout, `${l.name} payout moved with journal prices`);
    assert.strictEqual(a.silverPerCraft, b.silverPerCraft, `${l.name} gross rate moved with journal prices`);
  });
});

// A market where every FULL journal outsells every EMPTY one, so the chosen
// city's own margin is positive whichever city the payload picks —
// syntheticMarket() prices the two legs independently, which leaves a
// single-city margin at the mercy of the hash.
function journalMarginMarket(scale) {
  const md = syntheticMarket();
  Object.keys(md).forEach((id) => {
    if (!id.includes("_JOURNAL_")) return;
    const p = Math.max(1, Math.round((id.endsWith("_FULL") ? 100000 : 10000) * scale));
    Object.keys(md[id]).forEach((c) => { md[id][c] = { buy_price: p, sell_price: p, volume_24h: 9999 }; });
  });
  return md;
}

test("but the COMPARISON does move with them — the fame is priced at the journal", () => {
  const cheap = journalMarginMarket(0.01);
  const dear = journalMarginMarket(1);
  CRAFTING_LABORERS.forEach((l) => {
    const a = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: cheap, city: CITY, laborerTier: 8, onlyTier: 8 });
    const b = computeLaborerCraftFill({ spec: craftSpec(l, 8), marketData: dear, city: CITY, laborerTier: 8, onlyTier: 8 });
    assert.ok(a.famePriced && b.famePriced, `${l.name}: fame went unpriced`);
    assert.ok(Math.abs(a.silverPerCraft - b.silverPerCraft) < 1e-6,
      `${l.name}: the ranked rate moved with journal prices`);
    assert.ok(b.fameCost > a.fameCost, `${l.name}: dearer journals must value the fame higher`);
    assert.ok(b.netSilverPerCraft < a.netSilverPerCraft, `${l.name}: comparison ignored the fame price`);
  });
});

test("an empty market says no-price-data, not a zero-silver play", () => {
  const r = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: {}, city: CITY, laborerTier: 8 });
  assert.strictEqual(r.found, false);
  assert.strictEqual(r.reason, "no-price-data");
  assert.strictEqual(r.silverPerFame, 0);
  assert.strictEqual(r.crafts, 0);
});

test("a missing spec or city degrades to no-spec", () => {
  assert.strictEqual(computeLaborerCraftFill({ marketData: MD, city: CITY }).reason, "no-spec");
  assert.strictEqual(computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD }).reason, "no-spec");
});

// ── 4. the shared entry point dispatches on journal kind ───────────────────
console.log("\n=== computeLaborerSelfFill routes crafting journals here ===");

test("a Tinker row now resolves through the shared entry point", () => {
  const r = computeLaborerSelfFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  assert.strictEqual(r.found, true, r.reason);
  assert.strictEqual(r.kind, "craft");
  assert.ok(r.crafts > 0);
});

test("gathering rows still report hours, not crafts", () => {
  const ore = LABORERS.find((l) => l.slug === "ORE");
  const r = computeLaborerSelfFill({
    spec: _laborerJournalRowSpec(ore, 8, LABORER_MODE.RESOURCE), marketData: MD, city: CITY, laborerTier: 8,
  });
  assert.strictEqual(r.found, true, r.reason);
  assert.strictEqual(r.kind, "gather");
  assert.ok(r.hours > 0);
  assert.ok(r.silverPerHour > 0);
});

test("the mercenary journal and trophy still have no fill model at all", () => {
  const merc = LABORERS.find((l) => l.slug === "MERCENARY");
  const a = computeLaborerSelfFill({
    spec: _laborerJournalRowSpec(merc, 8, LABORER_MODE.MERCENARY), marketData: MD, city: CITY, laborerTier: 8,
  });
  assert.strictEqual(a.found, false);
  assert.strictEqual(a.reason, "no-fame-model");
  const line = TROPHY_LABORERS.find((l) => l.journalSlug === "TROPHY_MERCENARY");
  const b = computeLaborerSelfFill({ spec: _trophyRowSpec(line, 8), marketData: MD, city: CITY, laborerTier: 8 });
  assert.strictEqual(b.found, false);
  assert.strictEqual(b.reason, "no-fame-model");
});

test("repeated calls are identical (the craft index is cached, not mutated)", () => {
  const a = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const b = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  assert.deepStrictEqual(a, b);
});

// ── 5. the cell ────────────────────────────────────────────────────────────
console.log("\n=== The rendered cell ===");

test("the cell LEADS with silver per craft and counts crafts underneath", () => {
  const cf = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const html = craftFillCell(cf);
  assert.ok(/^<td /.test(html) && html.endsWith("</td>"), "should be one <td>");
  // The tooltip also mentions crafts, so compare positions inside the BODY.
  const body = html.replace(/^<td[^>]*>/, "");
  assert.ok(body.includes("/ craft"), "leads with the per-press rate — the column's sort key");
  assert.ok(body.indexOf("/ craft") < body.indexOf("1k fame"),
    `the per-craft rate must come before the fame view: ${body}`);
  assert.ok(body.includes("1k fame"), "still reports the fame view underneath");
  assert.ok(body.includes("crafts"), "still counts crafts");
  assert.ok(html.includes(`T${cf.journalTier}`), "names the journal tier");
  assert.ok(!/NaN|undefined|Infinity/.test(html), `leaked a bad number: ${html}`);
  assert.ok(html.includes("title="), "carries the explanation tooltip");
});

// Hours never applied to these rows, and the per-journal payout is now the
// SECOND question ("what if the laborer, not my fame, is the bottleneck?"), so
// it belongs in the tooltip rather than on the face of the cell.
test("the per-journal payout moved to the tooltip; no hours appear anywhere", () => {
  const cf = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const html = craftFillCell(cf);
  const body = html.replace(/^<td[^>]*>/, "");
  assert.ok(!body.includes("/ cycle"), `the visible cell should not quote a per-cycle figure: ${body}`);
  assert.ok(!/\d\s*h\b|\bmin\b/.test(body), `no hours or minutes on a crafting row: ${body}`);
  const tip = html.match(/title="([^"]*)"/)[1];
  // The payout is still quoted; the per-cycle sermon that used to follow it is
  // not (tests/tooltip-runtime-length.test.cjs caps the composed string).
  assert.ok(tip.includes(_lcfFmt(cf.payout)), `the tooltip should still quote the payout: ${tip}`);
});

// Silver as the module formats it, for asserting a figure survived a rewrite.
function _lcfFmt(n) { return Math.round(n).toLocaleString(); }

test("the visible body tiers BOTH the journal and the crafts, and names the city", () => {
  const cf = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const body = craftFillCell(cf).replace(/^<td[^>]*>/, "");
  const t = `T${cf.journalTier}`;
  assert.ok(body.includes(`${t} journal`), `body should say "${t} journal": ${body}`);
  assert.ok(new RegExp(`${t} crafts`).test(body), `body should say "${t} crafts": ${body}`);
  assert.ok(body.includes(cf.city), `cell should name the city: ${body}`);
  const tip = craftFillCell(cf).match(/title="([^"]*)"/)[1];
  assert.ok(tip.includes(`Priced in ${cf.city}`), `tooltip should explain the city: ${tip}`);
});

// The crafts are still TIERED in the tooltip — a reader must never take them for
// crafts at some other tier. The paragraph that argued WHY only same-tier crafts
// count now lives in the module header instead.
test("the tooltip tiers the crafts and states the yield", () => {
  const cf = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const tip = craftFillCell(cf).match(/title="([^"]*)"/)[1];
  assert.ok(tip.includes(`T${cf.journalTier} crafts`), `tooltip should tier the crafts: ${tip}`);
  assert.ok(tip.includes(`${+((cf.yield || 1) * 100).toFixed(1)}%`), "tooltip should state the laborer's yield");
});

test("when Best Journal names another tier the tooltip names it", () => {
  const cf = computeLaborerCraftFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const other = cf.journalTier === 8 ? 7 : 8;
  const tip = craftFillCell(cf, { journalTier: other, profit: 48432 }).match(/title="([^"]*)"/)[1];
  assert.ok(/Buying filled names T/.test(tip), `should flag the disagreement: ${tip}`);
  assert.ok(tip.includes(`T${other}`), "names the Best Journal tier");
  // Same tier on both columns: nothing to reconcile, no extra sentence.
  const same = craftFillCell(cf, { journalTier: cf.journalTier, profit: 48432 }).match(/title="([^"]*)"/)[1];
  assert.ok(!/Buying filled names T/.test(same), "no reconciliation when the tiers agree");
});

test("the shared cell dispatches crafting rows to the craft cell, Best Journal and all", () => {
  const sf = computeLaborerSelfFill({ spec: craftSpec(TINKER, 8), marketData: MD, city: CITY, laborerTier: 8 });
  const bj = { journalTier: 7, profit: 48432 };
  assert.strictEqual(selfFillCell(sf, bj), craftFillCell(sf, bj));
  // A bare tier still works — the Building Costs table passed one for a while.
  assert.strictEqual(selfFillCell(sf, 7), craftFillCell(sf, 7));
});

test("a crafting row with no prices renders a dash, not a broken count", () => {
  const sf = computeLaborerSelfFill({ spec: craftSpec(TINKER, 8), marketData: {}, city: CITY, laborerTier: 8 });
  const html = selfFillCell(sf, 8);
  assert.ok(html.includes("—"), "expected an em dash");
  assert.ok(!/NaN|undefined/.test(html), html);
});

test("craft counts read as fractions below ten and whole above", () => {
  assert.strictEqual(formatCraftCount(2.62), "2.6");
  assert.strictEqual(formatCraftCount(213.7), "214");
  assert.strictEqual(formatCraftCount(0), "");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
