/**
 * Test: journal catalogue (js/data-journals.js) matches items.xml, and the
 * candidate-picker rules match the in-game fill mechanic.
 *
 * Drift guard (same shape as tests/consumable-recipes-match-itemsxml): the
 * journal `maxfame` (fame needed to fill) and `weight` are hand-encoded in
 * data-journals.js; this test parses items.xml `<journalitem>` blocks and
 * asserts every value the module models matches the dump exactly, so a future
 * ao-bin-dumps refresh fails loudly instead of silently mis-pricing journals.
 *
 * Mechanic rules also asserted (Albion wiki / forums):
 *   - Each gathering profession (ore/wood/hide/fiber/rock/fish) maps to a real
 *     resource-journal slug and a trophy-journal slug.
 *   - A journal only fills from resources of its own tier up to +2 tiers higher,
 *     so a Tier-T gathering run can fill journal tiers [max(2,T-2) .. T].
 *   - Empty/Full market ids follow T?_JOURNAL_<SLUG>_EMPTY / _FULL.
 *
 * Black-box: reads repo files only, no live API. Run: node tests/journals-data.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dj = require("../js/data-journals.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// ── Parse items.xml <journalitem> → { uniquename: {maxfame, weight} } ─────────
const xml = fs.readFileSync(path.join(root, "data", "dumps", "items.xml"), "utf8");
const xmlJournals = {};
for (const b of xml.match(/<journalitem\b[^>]*>/g) || []) {
  const id = (b.match(/uniquename="([^"]+)"/) || [])[1];
  if (!id) continue;
  const maxfame = Number((b.match(/maxfame="([0-9.]+)"/) || [])[1]);
  const weight = Number((b.match(/weight="([0-9.]+)"/) || [])[1]);
  xmlJournals[id] = { maxfame, weight };
}

// ── 1. maxfame + weight match items.xml for every modelled journal slug ──────
test("every modelled journal's maxfame matches items.xml", () => {
  let checked = 0;
  for (const slug of dj.JOURNAL_SLUGS) {
    for (const tier of dj.JOURNAL_TIERS) {
      const id = `T${tier}_JOURNAL_${slug}`;
      const xmlRow = xmlJournals[id];
      assert.ok(xmlRow, `items.xml is missing ${id}`);
      assert.strictEqual(
        dj.getJournalMaxfame(slug, tier), xmlRow.maxfame,
        `maxfame mismatch for ${id}: model ${dj.getJournalMaxfame(slug, tier)} vs xml ${xmlRow.maxfame}`
      );
      checked++;
    }
  }
  assert.ok(checked >= 70, `expected to check 70+ journals, got ${checked}`);
});

test("every modelled journal's weight matches items.xml", () => {
  for (const slug of dj.JOURNAL_SLUGS) {
    for (const tier of dj.JOURNAL_TIERS) {
      const id = `T${tier}_JOURNAL_${slug}`;
      assert.strictEqual(
        dj.getJournalWeight(tier), xmlJournals[id].weight,
        `weight mismatch for ${id}`
      );
    }
  }
});

// ── 2. profession → slug map covers every gathering family ───────────────────
test("GATHER_PROFESSION_JOURNAL covers ore/wood/hide/fiber/rock/fish", () => {
  const expected = { ore: "ORE", wood: "WOOD", hide: "HIDE", fiber: "FIBER", rock: "STONE", fish: "FISHING" };
  for (const [type, slug] of Object.entries(expected)) {
    const m = dj.GATHER_PROFESSION_JOURNAL[type];
    assert.ok(m, `missing mapping for gathering type "${type}"`);
    assert.strictEqual(m.slug, slug, `slug for ${type} should be ${slug}`);
    // both the resource journal and its trophy variant must exist in items.xml
    assert.ok(xmlJournals[`T4_JOURNAL_${slug}`], `no resource journal for ${slug}`);
    assert.ok(xmlJournals[`T4_JOURNAL_TROPHY_${slug}`], `no trophy journal for ${slug}`);
  }
});

// ── 3. candidate fill-window: tiers [max(2,T-2) .. T], real ids, 3 kinds ──────
test("getJournalCandidates respects the ±2-tier fill window for LAND gathering", () => {
  for (const gatherTier of [2, 3, 4, 5, 6, 7, 8]) {
    // Profession journals only — the General trophy is not windowed, next test.
    const cands = dj.getJournalCandidates("ore", gatherTier).filter((c) => c.kind !== "general");
    const tiers = [...new Set(cands.map((c) => c.tier))].sort((a, b) => a - b);
    const lo = Math.max(2, gatherTier - 2);
    const expected = [];
    for (let t = lo; t <= gatherTier; t++) expected.push(t);
    assert.deepStrictEqual(tiers, expected, `tier window wrong at gatherTier ${gatherTier}`);
  }
});

// items.xml gives the General trophy <fameearned value="n"/> — no validitem
// list, no mintier, no activity restriction. So every tier of it is fillable by
// any run, and it must NOT ride the profession journals' window.
test("the General trophy ignores the fill window at every gathering tier", () => {
  for (const gatherTier of [2, 3, 4, 5, 6, 7, 8]) {
    const gen = dj.getJournalCandidates("ore", gatherTier).filter((c) => c.kind === "general");
    const tiers = [...new Set(gen.map((c) => c.tier))].sort((a, b) => a - b);
    assert.deepStrictEqual(tiers, [2, 3, 4, 5, 6, 7, 8],
      `General trophy was windowed at gatherTier ${gatherTier}`);
    assert.strictEqual(gen.length, 7, "one General trophy per tier, not one per window pass");
  }
});

test("FISHING ignores the fill window — any fish tier fills any journal tier", () => {
  // Every fishing run, regardless of tier, can fill all T2..T8 fishing journals.
  for (const gatherTier of [2, 4, 6, 8]) {
    const tiers = [...new Set(dj.getJournalCandidates("fish", gatherTier).map((c) => c.tier))].sort((a, b) => a - b);
    assert.deepStrictEqual(tiers, [2, 3, 4, 5, 6, 7, 8], `fishing should fill all tiers at gatherTier ${gatherTier}`);
  }
});

test("each gather-tier offers gathering + trophy + general candidates with real ids", () => {
  const cands = dj.getJournalCandidates("ore", 8);
  const kinds = new Set(cands.map((c) => c.kind));
  ["gathering", "trophy", "general"].forEach((k) => assert.ok(kinds.has(k), `missing kind ${k}`));
  for (const c of cands) {
    assert.ok(/^T[2-8]_JOURNAL_.+_EMPTY$/.test(c.emptyId), `bad empty id ${c.emptyId}`);
    assert.ok(/^T[2-8]_JOURNAL_.+_FULL$/.test(c.fullId), `bad full id ${c.fullId}`);
    // the underlying journalitem must exist in items.xml
    const base = c.fullId.replace(/_FULL$/, "");
    assert.ok(xmlJournals[base], `no items.xml journalitem for ${base}`);
    assert.strictEqual(c.maxfame, xmlJournals[base].maxfame, `candidate maxfame mismatch for ${base}`);
  }
});

test("tracking / non-gathering types yield no candidates", () => {
  assert.deepStrictEqual(dj.getJournalCandidates("tracking", 7), []);
  assert.deepStrictEqual(dj.getJournalCandidates("unknown", 5), []);
});

test("getProfessionJournalCandidates spans ALL tiers (no fill window)", () => {
  const cands = dj.getProfessionJournalCandidates("fish");
  // 7 tiers × {gathering, trophy, general} = 21, covering T2..T8
  assert.strictEqual(cands.length, 7 * 3, `expected 21, got ${cands.length}`);
  const tiers = [...new Set(cands.map((c) => c.tier))].sort((a, b) => a - b);
  assert.deepStrictEqual(tiers, [2, 3, 4, 5, 6, 7, 8]);
  ["gathering", "trophy", "general"].forEach((k) =>
    assert.ok(cands.some((c) => c.kind === k), `missing kind ${k}`));
  for (const c of cands) assert.ok(xmlJournals[c.fullId.replace(/_FULL$/, "")], `unreal id ${c.fullId}`);
  assert.deepStrictEqual(dj.getProfessionJournalCandidates("tracking"), []);
});

// ── 4. id list + companion rows ──────────────────────────────────────────────
test("getJournalItemIds returns deduped empty+full ids that exist in items.xml", () => {
  const ids = dj.getJournalItemIds();
  assert.strictEqual(ids.length, new Set(ids).size, "ids should be deduped");
  assert.ok(ids.includes("T8_JOURNAL_ORE_EMPTY") && ids.includes("T8_JOURNAL_ORE_FULL"));
  for (const id of ids) {
    const base = id.replace(/_(EMPTY|FULL)$/, "");
    assert.ok(xmlJournals[base], `id ${id} has no items.xml backing (${base})`);
  }
});

test("getAllJournalRows lists gathering+trophy per family plus general, all real", () => {
  const rows = dj.getAllJournalRows();
  const kinds = new Set(rows.map((r) => r.kind));
  ["gathering", "trophy", "general"].forEach((k) => assert.ok(kinds.has(k), `companion rows missing kind ${k}`));
  // 6 families × 2 kinds × 7 tiers + general 7 = 91
  assert.strictEqual(rows.length, 6 * 2 * 7 + 7, `unexpected companion row count ${rows.length}`);
  for (const r of rows) {
    assert.ok(xmlJournals[r.fullId.replace(/_FULL$/, "")], `companion row id missing: ${r.fullId}`);
    assert.strictEqual(r.maxfame, xmlJournals[r.fullId.replace(/_FULL$/, "")].maxfame);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
