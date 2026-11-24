/**
 * Test: journal fill SPEED (js/journal-fill-speed.js).
 *
 * The Journals/Gathering tables already rank journals by silver-per-fame, which
 * answers "which journal monetises a point of fame best" — but never says how
 * LONG a journal takes to fill. That's the missing half of "a T3 journal can
 * beat a T8 one": fame is the constraint, and a small journal turns over fast.
 *
 *   hours     = maxfame ÷ baseFamePerHour
 *   silver/h  = silverPerFame × baseFamePerHour   (= margin ÷ hours)
 *
 * Game rule (Albion wiki "Journal", confirmed on the official forums): gathering
 * at tier G fills journals of tier G−2 … G — i.e. a journal fills from its own
 * tier up to two tiers HIGHER. Fishing is exempt: any fish fills any tier.
 * Only base fame counts (premium bonus fame does not fill journals).
 *
 * Black-box / TDD: written before the implementation. Pure input→output, no DOM,
 * no live API — localStorage is stubbed.
 *
 * Run: node tests/journal-fill-speed.test.cjs
 */

const assert = require("assert");

const {
  JOURNAL_TIERS,
  GATHER_PROFESSION_JOURNAL,
  GATHER_BASE_FAME_PER_HOUR,
  FISH_BASE_FAME_PER_HOUR,
  getJournalCandidates,
  getJournalMaxfame,
} = require("../js/data-journals.js");
const { PREMIUM_TAX, calcJournalEconomics } = require("../js/calculations.js");
const { LABORERS, TROPHY_LABORERS } = require("../js/data-laborers.js");

// ── localStorage stub ──────────────────────────────────────────────────────
// The module reads the pref at call time, so swapping the store between cases
// is enough — no re-require needed.
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// data-journals.js must be visible to journal-fill-speed.js as browser globals
// would be (it is a plain script in the app, not a CommonJS consumer).
Object.assign(global, {
  JOURNAL_TIERS,
  GATHER_PROFESSION_JOURNAL,
  GATHER_BASE_FAME_PER_HOUR,
  FISH_BASE_FAME_PER_HOUR,
  getJournalCandidates,
  getJournalMaxfame,
  getBaseFamePerHour: require("../js/data-journals.js").getBaseFamePerHour,
});

// Only the fill-speed MATH is pinned here. The Gathering Tier preference
// helpers (JOURNAL_FILL_TIER_*, getJournalFillTier, isMatchJournalTier,
// resolveGatherTier, resolveLaborerGatherTier) die with the header control:
// the always-match behaviour they used to gate is pinned through
// resolveJournalFill below, and the laborer side end-to-end in
// tests/laborer-self-fill.test.cjs via computeLaborerSelfFill.
const {
  getJournalFillHours,
  canFillAtTier,
  resolveJournalFill,
  laborerSlugToGatherType,
} = require("../js/journal-fill-speed.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${b}, got ${a}`);
// The legacy storage key the removed Gathering Tier control wrote. Cases below
// keep writing it to prove the app now ignores whatever sits there.
const LEGACY_TIER_KEY = "journalFillTier";
const setPref = (v) => { if (v == null) store.delete(LEGACY_TIER_KEY); else store.set(LEGACY_TIER_KEY, String(v)); };

// ── getJournalFillHours ────────────────────────────────────────────────────
// A renderer divides by this and prints it, so it must never emit Infinity or
// NaN — every degenerate input collapses to 0 ("no estimate").
const HOURS_CASES = [
  { maxfame: 28800, fph: 19000, want: 28800 / 19000, why: "T8 ore journal at T8 gathering" },
  { maxfame: 900,   fph: 19000, want: 900 / 19000,   why: "T3 journal filled by a T8 gatherer — fast" },
  { maxfame: 8320,  fph: 8500,  want: 8320 / 8500,   why: "T8 fishing journal at the fishing rate" },
  { maxfame: 0,     fph: 19000, want: 0, why: "no fame schedule" },
  { maxfame: 28800, fph: 0,     want: 0, why: "no fame/hour estimate" },
  { maxfame: -5,    fph: 19000, want: 0, why: "negative fame" },
  { maxfame: 28800, fph: -19000, want: 0, why: "negative rate" },
  { maxfame: null,  fph: 19000, want: 0, why: "null fame" },
  { maxfame: 28800, fph: undefined, want: 0, why: "undefined rate" },
  { maxfame: NaN,   fph: 19000, want: 0, why: "NaN fame" },
  { maxfame: 28800, fph: NaN,   want: 0, why: "NaN rate" },
];
for (const c of HOURS_CASES) {
  test(`getJournalFillHours(${c.maxfame}, ${c.fph}) — ${c.why}`, () => {
    const h = getJournalFillHours(c.maxfame, c.fph);
    assert.ok(Number.isFinite(h), `expected a finite number, got ${h}`);
    approx(h, c.want);
  });
}

test("getJournalFillHours with no arguments is 0, not NaN", () => {
  assert.strictEqual(getJournalFillHours(), 0);
});

// ── canFillAtTier ──────────────────────────────────────────────────────────
// Full 7x7 grid against the wiki rule: G in [J, J+2].
test("canFillAtTier — full journal x gather tier grid matches the G-2..G rule", () => {
  for (const j of JOURNAL_TIERS) {
    for (const g of JOURNAL_TIERS) {
      const want = g >= j && g <= j + 2;
      assert.strictEqual(
        canFillAtTier(j, g, false), want,
        `T${j} journal at T${g} gathering: expected ${want}`
      );
    }
  }
});

test("canFillAtTier — fishing ignores the window entirely", () => {
  for (const j of JOURNAL_TIERS) {
    for (const g of JOURNAL_TIERS) {
      assert.strictEqual(canFillAtTier(j, g, true), true, `T${j} fishing journal at T${g}`);
    }
  }
});

// The predicate and data-journals.js's candidate window must never disagree —
// they encode the same rule from opposite directions.
// The General trophy is deliberately excluded: it is emitted at every tier
// regardless of the window, because items.xml gates it by nothing at all
// (<fameearned>). See tests/journal-fill-window-matches-itemsxml.
test("canFillAtTier agrees with getJournalCandidates for every land profession", () => {
  const landTypes = Object.keys(GATHER_PROFESSION_JOURNAL).filter((t) => t !== "fish");
  for (const type of landTypes) {
    for (const g of JOURNAL_TIERS) {
      const fromCatalogue = new Set(
        getJournalCandidates(type, g).filter((c) => c.kind !== "general").map((c) => c.tier)
      );
      for (const j of JOURNAL_TIERS) {
        assert.strictEqual(
          canFillAtTier(j, g, false), fromCatalogue.has(j),
          `${type}: T${j} journal at T${g} gathering`
        );
      }
    }
  }
});

test("canFillAtTier agrees with getJournalCandidates for fishing (no window)", () => {
  for (const g of JOURNAL_TIERS) {
    const fromCatalogue = new Set(getJournalCandidates("fish", g).map((c) => c.tier));
    for (const j of JOURNAL_TIERS) {
      assert.strictEqual(canFillAtTier(j, g, true), fromCatalogue.has(j), `T${j} at T${g}`);
    }
  }
});

test("canFillAtTier — junk tiers are never fillable", () => {
  [[null, 5], [5, null], [undefined, 5], [5, undefined], [NaN, 5], [5, NaN], [0, 0]]
    .forEach(([j, g]) => assert.strictEqual(canFillAtTier(j, g, false), false, `(${j}, ${g})`));
});

// ── the Gathering Tier preference is gone ──────────────────────────────────
//
// The header select was replaced by the Daily Production Bonus one, so there is
// no set gathering tier any more: fill speed is ALWAYS the journal's own tier.
// Whatever a legacy install still carries under "journalFillTier" — a real
// tier, the old "match" sentinel, junk, or nothing at all — must price
// identically. The old reading ("unset means a fixed T8 so the column stays
// sortable") is dead with the control that needed it.
const LEGACY_STORED = [null, "", "match", "5", "8", "2", "99", "1", "abc", "0"];
for (const stored of LEGACY_STORED) {
  test(`resolveJournalFill ignores legacy stored tier ${JSON.stringify(stored)} — a T3 journal fills at T3`, () => {
    setPref(stored);
    const r = resolveJournalFill({ type: "ore", journalTier: 3, maxfame: 1800 });
    assert.strictEqual(r.gatherTier, 3, `stored ${JSON.stringify(stored)} moved the gather tier`);
    assert.strictEqual(r.fillable, true, `stored ${JSON.stringify(stored)} dashed the row`);
    assert.strictEqual(r.reason, null);
  });
  setPref(null);
}

test("every land journal fills at its own tier with a stale tier left in storage", () => {
  setPref("5");
  for (const tier of JOURNAL_TIERS) {
    const r = resolveJournalFill({ type: "ore", journalTier: tier, maxfame: getJournalMaxfame("ORE", tier) });
    assert.strictEqual(r.gatherTier, tier, `T${tier} priced at T${r.gatherTier}`);
    assert.strictEqual(r.fillable, true, `T${tier} must stay fillable at its own tier`);
    approx(r.hours, getJournalMaxfame("ORE", tier) / GATHER_BASE_FAME_PER_HOUR[tier]);
  }
  setPref(null);
});

// ── resolveJournalFill ─────────────────────────────────────────────────────
test("resolveJournalFill — with nothing stored, every land journal fills at its own tier", () => {
  setPref(null);
  for (const [type, prof] of Object.entries(GATHER_PROFESSION_JOURNAL)) {
    for (const tier of JOURNAL_TIERS) {
      const maxfame = getJournalMaxfame(prof.slug, tier);
      const r = resolveJournalFill({ type, journalTier: tier, maxfame });
      assert.strictEqual(r.gatherTier, tier, `${type} T${tier} gatherTier`);
      assert.strictEqual(r.fillable, true, `${type} T${tier} should be fillable at its own tier`);
      assert.strictEqual(r.reason, null);
      approx(r.hours, maxfame / (type === "fish" ? FISH_BASE_FAME_PER_HOUR[tier] : GATHER_BASE_FAME_PER_HOUR[tier]));
    }
  }
});

// The ±2 fill window still bites whenever the gathering tier genuinely differs
// from the journal's — expressed now through the renderer's gatherTierOverride
// (the Gathering table's own row tier), since no stored preference exists any more.
test("resolveJournalFill — a T8 gatherTierOverride leaves T2-T5 land journals out of the window", () => {
  setPref(null);
  for (const tier of JOURNAL_TIERS) {
    const r = resolveJournalFill({ type: "ore", journalTier: tier, maxfame: getJournalMaxfame("ORE", tier), gatherTierOverride: 8 });
    assert.strictEqual(r.gatherTier, 8);
    if (tier >= 6) {
      assert.strictEqual(r.fillable, true, `T${tier} should be fillable at T8`);
      assert.ok(r.hours > 0, `T${tier} should have hours`);
    } else {
      assert.strictEqual(r.fillable, false, `T${tier} should NOT be fillable at T8`);
      assert.strictEqual(r.reason, "out-of-window");
      assert.strictEqual(r.hours, 0);
    }
  }
});

test("resolveJournalFill — at a T8 gatherTierOverride a T6 journal fills far faster than a T8 one", () => {
  setPref(null);
  const t6 = resolveJournalFill({ type: "ore", journalTier: 6, maxfame: getJournalMaxfame("ORE", 6), gatherTierOverride: 8 });
  const t8 = resolveJournalFill({ type: "ore", journalTier: 8, maxfame: getJournalMaxfame("ORE", 8), gatherTierOverride: 8 });
  assert.ok(t6.hours < t8.hours, "the T6 journal must fill faster");
  approx(t6.hours * 4, t8.hours); // 7200 vs 28800 fame at the same rate
});

test("resolveJournalFill — fishing is fillable at every tier from any tier", () => {
  for (const pref of [null, 2, 5, 8]) {
    setPref(pref);
    for (const tier of JOURNAL_TIERS) {
      const r = resolveJournalFill({ type: "fish", journalTier: tier, maxfame: getJournalMaxfame("FISHING", tier) });
      assert.strictEqual(r.fillable, true, `pref ${pref}, T${tier} fishing`);
      assert.ok(r.hours > 0);
    }
  }
});

test("resolveJournalFill — fishing uses the fishing fame/hour table, not the land one", () => {
  setPref(8);
  const r = resolveJournalFill({ type: "fish", journalTier: 8, maxfame: getJournalMaxfame("FISHING", 8) });
  assert.strictEqual(r.famePerHour, FISH_BASE_FAME_PER_HOUR[8]);
  assert.notStrictEqual(r.famePerHour, GATHER_BASE_FAME_PER_HOUR[8]);
});

test("resolveJournalFill — no fame schedule (maxfame 0) reports no-fame-schedule", () => {
  setPref(null);
  const r = resolveJournalFill({ type: "ore", journalTier: 5, maxfame: 0 });
  assert.strictEqual(r.fillable, false);
  assert.strictEqual(r.reason, "no-fame-schedule");
  assert.strictEqual(r.hours, 0);
});

test("resolveJournalFill — an unknown profession still resolves a land rate", () => {
  // TROPHY_GENERAL rows carry type "general"; getBaseFamePerHour falls through
  // to the land table for anything that is not "fish". Pin that on purpose.
  setPref("match");
  const r = resolveJournalFill({ type: "general", journalTier: 6, maxfame: 12150 });
  assert.strictEqual(r.famePerHour, GATHER_BASE_FAME_PER_HOUR[6]);
  assert.strictEqual(r.fillable, true);
});

test("resolveJournalFill — gatherTierOverride wins over anything left in storage", () => {
  setPref(8);
  const r = resolveJournalFill({ type: "ore", journalTier: 4, maxfame: 1800, gatherTierOverride: 5 });
  assert.strictEqual(r.gatherTier, 5);
  assert.strictEqual(r.fillable, true, "T4 journal IS fillable by a T5 gatherer");
  setPref(null);
});

// ── laborer slug → gathering type ──────────────────────────────────────────
// The two catalogues disagree on spelling: laborer slug STONE vs gathering type
// "rock", FISHING vs "fish". Pin every slug so a rename can't silently blank
// the column.
const SLUG_CASES = [
  ["WOOD", "wood"], ["STONE", "rock"], ["ORE", "ore"], ["FIBER", "fiber"],
  ["HIDE", "hide"], ["FISHING", "fish"],
  ["TROPHY_WOOD", "wood"], ["TROPHY_STONE", "rock"], ["TROPHY_ORE", "ore"],
  ["TROPHY_FIBER", "fiber"], ["TROPHY_HIDE", "hide"], ["TROPHY_FISHING", "fish"],
  ["TROPHY_GENERAL", "general"],
  // Crafting fame and combat fame have no fame/hour model anywhere in the repo.
  ["WARRIOR", null], ["HUNTER", null], ["MAGE", null], ["TOOLMAKER", null],
  ["MERCENARY", null], ["TROPHY_MERCENARY", null],
];
for (const [slug, want] of SLUG_CASES) {
  test(`laborerSlugToGatherType(${slug}) → ${want}`, () => {
    assert.strictEqual(laborerSlugToGatherType(slug), want);
  });
}

test("every LABORERS slug is covered by laborerSlugToGatherType", () => {
  const known = new Set(SLUG_CASES.map(([s]) => s));
  LABORERS.forEach((l) => assert.ok(known.has(l.slug), `LABORERS slug ${l.slug} is not pinned by this test`));
});

test("every TROPHY_LABORERS journal slug is covered by laborerSlugToGatherType", () => {
  const known = new Set(SLUG_CASES.map(([s]) => s));
  TROPHY_LABORERS.forEach((l) => assert.ok(known.has(l.journalSlug), `trophy slug ${l.journalSlug} is not pinned`));
});

test("laborerSlugToGatherType — junk input is null, never a throw", () => {
  [null, undefined, "", "NOPE", 5].forEach((s) => assert.strictEqual(laborerSlugToGatherType(s), null, String(s)));
});

// ── the invariant that keeps the cell's two lines honest ───────────────────
// The cell prints hours on one line and silver/hour on the next. They come from
// two different functions, so pin the identity: silver/h = margin ÷ hours.
test("extraSilverPerHour equals marginPerJournal ÷ fill hours", () => {
  const grid = [
    { emptyCost: 3000, fullGross: 30000, maxfame: 28800, tier: 8, type: "ore" },
    { emptyCost: 120,  fullGross: 900,   maxfame: 450,   tier: 2, type: "wood" },
    { emptyCost: 5000, fullGross: 3000,  maxfame: 7200,  tier: 6, type: "hide" },
    { emptyCost: 800,  fullGross: 6400,  maxfame: 8320,  tier: 8, type: "fish" },
  ];
  for (const c of grid) {
    const fph = c.type === "fish" ? FISH_BASE_FAME_PER_HOUR[c.tier] : GATHER_BASE_FAME_PER_HOUR[c.tier];
    const econ = calcJournalEconomics({ ...c, baseFamePerHour: fph });
    const hours = getJournalFillHours(c.maxfame, fph);
    approx(econ.extraSilverPerHour, econ.marginPerJournal / hours, 1e-9);
  }
});

test("the tax used by the invariant is the live premium tax, not a constant", () => {
  const econ = calcJournalEconomics({ emptyCost: 0, fullGross: 1000, maxfame: 100, baseFamePerHour: 100 });
  approx(econ.fullNet, 1000 * (1 - PREMIUM_TAX));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
