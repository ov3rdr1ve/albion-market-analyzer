/**
 * Test: the app's journal fill-window rule matches items.xml, family by family.
 *
 * The rule is NOT one rule. items.xml gives each journal family a different
 * <famefillingmissions> child, and each child means something different:
 *
 *   <gatherfame mintier="n"> + <validitem> list   gathering + gathering trophies
 *       The validitem list is exhaustive and spans exactly n … n+2, so a journal
 *       fills from its own tier up to two HIGHER. T8 accepts only T8.
 *   <fishingfame value="n"/>                      fishing + fishing trophy
 *       No validitem list, no mintier. ANY fish fills ANY tier.
 *   <fameearned value="n"/>                       the General trophy
 *       No validitem list, no mintier, no activity restriction at all. ANY fame
 *       from ANY activity at ANY tier fills it.
 *   <craftitemfame mintier="n"> + <validitem>     crafting journals
 *       Same tier ONLY (handled in js/laborer-craft-fill.js, not here).
 *   <killmobfame mintier="n"/>                    mercenary
 *       A MINIMUM, with no upper bound. Not modelled — the app has no combat
 *       fame/hour estimate — so it is asserted absent, not windowed.
 *
 * Cross-checked against the Albion wiki "Journal" page, which states it in
 * words: "The fame action must be of the same tier or up to 2 higher for
 * Gathering Journals (except fishing) … Fishing Tier 2 fish, will fill a Tier 8
 * journal for fishing", and "general journals fill up when you do anything that
 * brings in fame."
 *
 * The bug this was written for: the General trophy was run through the ±2
 * gathering window, so a T8 run was told it could fill only T6–T8 General
 * trophies. It can fill all seven.
 *
 * Data-driven: the expectations are PARSED from items.xml rather than typed, so
 * a dump refresh that changes the rules fails this test instead of silently
 * drifting. See [[project_items_xml_dump_sync]].
 *
 * Run: node tests/journal-fill-window-matches-itemsxml.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const dj = require("../js/data-journals.js");
const {
  JOURNAL_TIERS, GATHER_PROFESSION_JOURNAL, GATHER_BASE_FAME_PER_HOUR,
  FISH_BASE_FAME_PER_HOUR, getJournalCandidates, getJournalMaxfame, getBaseFamePerHour,
} = dj;

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
Object.assign(global, {
  JOURNAL_TIERS, GATHER_PROFESSION_JOURNAL, GATHER_BASE_FAME_PER_HOUR,
  FISH_BASE_FAME_PER_HOUR, getJournalCandidates, getJournalMaxfame, getBaseFamePerHour,
});
const {
  canFillAtTier, resolveJournalFill, laborerSlugToGatherType,
} = require("../js/journal-fill-speed.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}
// The legacy storage key the removed Gathering Tier control wrote; a couple of
// cases keep writing it to prove nothing reads it any more.
const LEGACY_TIER_KEY = "journalFillTier";
const setPref = (v) => { if (v == null) store.delete(LEGACY_TIER_KEY); else store.set(LEGACY_TIER_KEY, String(v)); };

// ── parse the truth out of items.xml ───────────────────────────────────────
// { SLUG: { tier: { famekind, mintier, tiers: [gathering tiers that fill it] } } }
function parseJournalRules() {
  const src = fs.readFileSync(path.join(ROOT, "data", "dumps", "items.xml"), "utf8");
  const re = /<journalitem[^>]*uniquename="T(\d)_JOURNAL_([A-Z_]+)"[\s\S]*?<\/famefillingmissions>/g;
  const out = {};
  let m;
  while ((m = re.exec(src)) !== null) {
    const [block, tierStr, slug] = m;
    // The FIRST child of <famefillingmissions> is the rule. Matched positionally
    // rather than by name pattern: the elements are gatherfame / fishingfame /
    // craftitemfame / killmobfame / fameearned, and no single name pattern
    // catches all five without also catching the wrapper.
    const kind = (block.match(/<famefillingmissions>\s*<(\w+)/) || [])[1] || null;
    const mintier = (block.match(/mintier="(\d+)"/) || [])[1];
    const tiers = [...new Set(
      [...block.matchAll(/validitem id="T(\d)[^"]*"/g)].map((x) => Number(x[1]))
    )].sort((a, b) => a - b);
    (out[slug] || (out[slug] = {}))[Number(tierStr)] = {
      kind, mintier: mintier != null ? Number(mintier) : null, tiers,
    };
  }
  return out;
}
const RULES = parseJournalRules();

const LAND_SLUGS = ["WOOD", "STONE", "ORE", "FIBER", "HIDE"];
const LAND_ALL = [...LAND_SLUGS, ...LAND_SLUGS.map((s) => `TROPHY_${s}`)];

console.log("\n=== items.xml really does say what the app assumes ===");

test("every journal family was found in items.xml", () => {
  ["WOOD", "STONE", "ORE", "FIBER", "HIDE", "FISHING", "TROPHY_GENERAL",
   "TROPHY_FISHING", "MERCENARY", "WARRIOR"].forEach((s) => {
    assert.ok(RULES[s], `no ${s} journals parsed`);
    assert.strictEqual(Object.keys(RULES[s]).length, 7, `${s}: expected 7 tiers`);
  });
});

test("land gathering journals list exactly their own tier .. +2, capped at T8", () => {
  LAND_ALL.forEach((slug) => {
    JOURNAL_TIERS.forEach((j) => {
      const r = RULES[slug][j];
      assert.strictEqual(r.kind, "gatherfame", `${slug} T${j}`);
      const want = [j, j + 1, j + 2].filter((t) => t <= 8);
      assert.deepStrictEqual(r.tiers, want, `${slug} T${j}`);
    });
  });
});

test("crafting journals list ONLY their own tier", () => {
  ["WARRIOR", "HUNTER", "MAGE", "TOOLMAKER"].forEach((slug) => {
    JOURNAL_TIERS.forEach((j) => {
      const r = RULES[slug][j];
      assert.strictEqual(r.kind, "craftitemfame", `${slug} T${j}`);
      assert.deepStrictEqual(r.tiers, [j], `${slug} T${j}`);
    });
  });
});

test("fishing journals have NO tier gate — any fish fills any tier", () => {
  ["FISHING", "TROPHY_FISHING"].forEach((slug) => {
    JOURNAL_TIERS.forEach((j) => {
      const r = RULES[slug][j];
      assert.strictEqual(r.kind, "fishingfame", `${slug} T${j}`);
      assert.strictEqual(r.mintier, null, `${slug} T${j}: a mintier appeared`);
      assert.deepStrictEqual(r.tiers, [], `${slug} T${j}: a validitem list appeared`);
    });
  });
});

test("the General trophy has NO tier gate and no activity gate either", () => {
  JOURNAL_TIERS.forEach((j) => {
    const r = RULES.TROPHY_GENERAL[j];
    assert.strictEqual(r.kind, "fameearned", `T${j}: expected <fameearned>, got ${r.kind}`);
    assert.strictEqual(r.mintier, null, `T${j}: a mintier appeared`);
    assert.deepStrictEqual(r.tiers, [], `T${j}: a validitem list appeared`);
  });
});

test("mercenary is a MINIMUM tier, not a window", () => {
  JOURNAL_TIERS.forEach((j) => {
    const r = RULES.MERCENARY[j];
    assert.strictEqual(r.kind, "killmobfame", `T${j}`);
    assert.strictEqual(r.mintier, j, `T${j}: mintier should equal the journal tier`);
    assert.deepStrictEqual(r.tiers, [], `T${j}: no validitem list means no upper bound`);
  });
});

console.log("\n=== canFillAtTier encodes each of those, and no other ===");

test("land: canFillAtTier matches the items.xml validitem lists exactly", () => {
  JOURNAL_TIERS.forEach((j) => {
    const allowed = new Set(RULES.ORE[j].tiers);
    JOURNAL_TIERS.forEach((g) => {
      assert.strictEqual(canFillAtTier(j, g, false), allowed.has(g),
        `T${j} journal at T${g} gathering — items.xml allows [${[...allowed]}]`);
    });
  });
});

test("fishing: fillable from every tier, because items.xml gates nothing", () => {
  JOURNAL_TIERS.forEach((j) => {
    JOURNAL_TIERS.forEach((g) => {
      assert.strictEqual(canFillAtTier(j, g, true), true, `T${j} fishing journal at T${g}`);
    });
  });
});

console.log("\n=== the General trophy is not windowed (the bug) ===");

const GENERAL_CASES = [];
JOURNAL_TIERS.forEach((j) => JOURNAL_TIERS.forEach((g) => GENERAL_CASES.push([j, g])));

test("resolveJournalFill: a General trophy of ANY tier fills at ANY gathering tier", () => {
  setPref(null);
  GENERAL_CASES.forEach(([j, g]) => {
    const r = resolveJournalFill({
      type: "general", journalTier: j,
      maxfame: getJournalMaxfame("TROPHY_GENERAL", j), gatherTierOverride: g,
    });
    assert.strictEqual(r.fillable, true,
      `T${j} General trophy at T${g}: reported ${r.reason} — items.xml has no gate at all`);
    assert.ok(r.hours > 0, `T${j} at T${g}: no fill time`);
  });
  setPref(null);
});

test("the regression, stated plainly: even with a stale T8 in storage the T2 General trophy fills", () => {
  setPref(8);
  const r = resolveJournalFill({
    type: "general", journalTier: 2, maxfame: getJournalMaxfame("TROPHY_GENERAL", 2),
  });
  assert.strictEqual(r.fillable, true, `reported ${r.reason}`);
  setPref(null);
});

test("land journals are still windowed — the fix must not unwindow everything", () => {
  // A genuinely different gathering tier is expressed by the renderer's
  // gatherTierOverride (the Gathering table's row tier); no stored preference exists.
  const t2 = resolveJournalFill({ type: "ore", journalTier: 2, maxfame: getJournalMaxfame("ORE", 2), gatherTierOverride: 8 });
  assert.strictEqual(t2.fillable, false, "T8 mining must NOT fill a T2 ore journal");
  assert.strictEqual(t2.reason, "out-of-window");
  const t6 = resolveJournalFill({ type: "ore", journalTier: 6, maxfame: getJournalMaxfame("ORE", 6), gatherTierOverride: 8 });
  assert.strictEqual(t6.fillable, true, "T8 mining must fill a T6 ore journal");
});

test("the General trophy journal a laborer holds resolves as 'general', not a land type", () => {
  assert.strictEqual(laborerSlugToGatherType("TROPHY_GENERAL"), "general");
});

console.log("\n=== the candidate catalogue agrees with the predicate ===");

test("a land run offers the profession journals windowed, General unwindowed", () => {
  Object.keys(GATHER_PROFESSION_JOURNAL).filter((t) => t !== "fish").forEach((type) => {
    JOURNAL_TIERS.forEach((g) => {
      const cands = getJournalCandidates(type, g);
      const prof = [...new Set(cands.filter((c) => c.kind !== "general").map((c) => c.tier))].sort((a, b) => a - b);
      const gen = [...new Set(cands.filter((c) => c.kind === "general").map((c) => c.tier))].sort((a, b) => a - b);
      const want = JOURNAL_TIERS.filter((j) => canFillAtTier(j, g, false));
      assert.deepStrictEqual(prof, want, `${type} at T${g}: profession journals`);
      assert.deepStrictEqual(gen, [...JOURNAL_TIERS], `${type} at T${g}: General trophies`);
    });
  });
});

test("a fishing run offers every tier of everything", () => {
  JOURNAL_TIERS.forEach((g) => {
    const tiers = [...new Set(getJournalCandidates("fish", g).map((c) => c.tier))].sort((a, b) => a - b);
    assert.deepStrictEqual(tiers, [...JOURNAL_TIERS], `fishing at T${g}`);
  });
});

test("no candidate is duplicated — General must be added once per tier, not per loop pass", () => {
  JOURNAL_TIERS.forEach((g) => {
    const cands = getJournalCandidates("ore", g);
    const keys = cands.map((c) => `${c.kind}|${c.slug}|${c.tier}`);
    assert.strictEqual(new Set(keys).size, keys.length,
      `ore at T${g}: duplicates ${keys.filter((k, i) => keys.indexOf(k) !== i).join(", ")}`);
  });
});

test("non-gathering types still yield nothing", () => {
  assert.deepStrictEqual(getJournalCandidates("tracking", 7), []);
  assert.deepStrictEqual(getJournalCandidates("unknown", 5), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
