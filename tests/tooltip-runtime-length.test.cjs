/**
 * Composed cell-tooltip length (the runtime tips built in js/*.js).
 *
 * tests/tooltip-length.test.cjs caps each SENTENCE a module hands to tx(); this
 * one caps what the user actually hovers, which is several of those sentences
 * appended together. The Best Journal Play cell was the failure case: five
 * modules' prose concatenated into ~2,800 characters, ~55 lines in the 340px
 * #app-tooltip box, running off the bottom of a 1080p viewport.
 *
 * A tooltip states the figures and how they were computed. The rationale — why
 * the rate is per hour and not per point of fame, why the two plays are in
 * different units, the pessimistic bound — lives in the module headers.
 *
 * Every tip is composed with EVERY optional branch turned on, so the numbers
 * here are the worst case and not a typical row. Both languages: Spanish runs
 * longer, so it gets its own cap.
 *
 * Run: node tests/tooltip-runtime-length.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
// One play's tooltip. Roughly five lines in the 340px box.
const EN_CAP = 320;
const ES_CAP = 370;
// The merged Best Journal Play cell describes TWO plays plus the caveat that
// they are in different units, so it gets one play's budget twice over — and
// nothing else in the app is allowed near it.
const MERGED_EN_CAP = 440;
const MERGED_ES_CAP = 520;

const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");

const loadSrc = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

/** Just one function's source out of a big render file, by name. */
function extractFn(rel, name) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${rel}`);
  let depth = 0, i = src.indexOf("{", start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`unterminated ${name} in ${rel}`);
}

// The shared stubs every tip module reaches for. `lang` flips tx() between the
// inline English and the Spanish overlay, exactly as js/i18n.js does.
function sandbox(lang) {
  return `
const ES = ${JSON.stringify(UI_STRINGS_ES)};
const LANG = ${JSON.stringify(lang)};
function tx(en, slug) { return (LANG === "es" && ES[slug] != null) ? ES[slug] : en; }
function formatSilver(n) { return Math.round(n).toLocaleString(); }
function formatFillHours(h) { return h < 1 ? Math.round(h * 60) + " min" : h.toFixed(1) + " h"; }
function formatCraftCount(c) { return c < 10 ? c.toFixed(1) : String(Math.round(c)); }
function getLaborerYield() { return 1.0; }
const PREMIUM_TAX = 0.04;
`;
}

/** Compile the tip builders for one language into a single module. */
function tipModule(lang) {
  const src = sandbox(lang) +
    loadSrc("js/laborer-craft-fill.js") +
    loadSrc("js/laborer-self-fill.js") +
    extractFn("js/render-laborers.js", "bestJournalTip") + "\n" +
    extractFn("js/render-laborers.js", "_levelingPathCell") + "\n" +
    loadSrc("js/laborer-journal-play.js") +
    loadSrc("js/journal-laborer-payload.js") +
    "\nmodule.exports = { selfFillTip, craftFillTip, journalPlayTip, journalLaborerTip, " +
    "bestJournalTip, _levelingPathCell, _selfFillNoDataTip };";
  const m = new Module(`tooltip-runtime-${lang}`);
  m._compile(src, `tooltip-runtime-${lang}.js`);
  return m.exports;
}

const EN = tipModule("en");
const ES = tipModule("es");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── fixtures: every optional branch ON ──────────────────────────────────────

const BUY = { journalTier: 6, profit: 258160, yield: 1.5, sameTierProfit: 115078, sameTierYield: 1.2 };

const GATHER = {
  found: true, kind: "gather", journalTier: 2, city: "Brecilien",
  hours: 0.22, gatherTier: 8, maxfame: 2160, yield: 1.5,
  payout: 268492, profitPerCycle: 268492,
  silverPerHour: 1266263, silverPerFame: 124.3,
  netPayout: -12000, netSilverPerHour: -55000, netSilverPerFame: -5.5,
  famePrice: 140, fameCost: 280492, famePriced: true, fameBasis: "margin",
  fameCostFull: 310000, netPayoutFull: -41508,
  netSilverPerHourFull: -188672, netSilverPerFameFull: -19.2,
  laborersFed: 104, idleHours: 0, candidateTiers: [2, 3, 4],
};

const CRAFT = {
  found: true, kind: "craft", journalTier: 8, city: "Martlock",
  crafts: 8.4, itemName: "Elder's Soldier Boots", famePerCraft: 2280,
  yield: 1.5, payout: 512000, profitPerCycle: 512000,
  silverPerCraft: 41290, netSilverPerCraft: -3100,
  famePrice: 190, fameCost: 540000, famePriced: true, fameBasis: "margin",
  fameCostFull: 610000, netSilverPerCraftFull: -7900,
};

const PLAY = {
  hasData: true, tier: 5, laborerTier: 8, yield: 1.5, city: "Lymhurst",
  payload: 268492, sellFull: 310000, advantage: -41508, advantageFull: -61508,
  sellPriced: true, fameBasis: "margin",
};
const RATE = { perHour: 1266263, netPerHour: -188672, netPerHourFull: -220000, laborersFed: 104, hours: 0.22 };

// Every tip, in the branchiest state it can reach. `label` is what fails; the
// optional third element marks the merged two-play cell, which has its own cap.
function cases(M) {
  return [
    ["selfFillTip · gatherer, priced, differs", () => M.selfFillTip(GATHER, BUY)],
    ["selfFillTip · idle branch", () => M.selfFillTip({ ...GATHER, hours: 30, idleHours: 8, laborersFed: 0 }, BUY)],
    ["selfFillTip · unpriced fame", () => M.selfFillTip({ ...GATHER, famePriced: false, fameBasis: "none" }, BUY)],
    ["selfFillTip · full-only basis", () => M.selfFillTip({ ...GATHER, famePriced: false, fameBasis: "full" }, BUY)],
    ["craftFillTip · priced, differs", () => M.craftFillTip(CRAFT, BUY)],
    ["craftFillTip · unpriced fame", () => M.craftFillTip({ ...CRAFT, famePriced: false, fameBasis: "none" }, BUY)],
    ["bestJournalTip · lower tier wins", () => M.bestJournalTip(BUY, 8)],
    ["bestJournalTip · own tier", () => M.bestJournalTip({ ...BUY, journalTier: 8 }, 8)],
    ["journalPlayTip · both plays, gatherer", () => M.journalPlayTip(BUY, GATHER, 8), "merged"],
    ["journalPlayTip · both plays, crafter", () => M.journalPlayTip(BUY, CRAFT, 8), "merged"],
    ["journalPlayTip · self-fill only", () => M.journalPlayTip(null, GATHER, 8)],
    ["journalPlayTip · buy only", () => M.journalPlayTip(BUY, { found: false, reason: "no-fame-model" }, 8)],
    ["journalLaborerTip · priced, negative", () => M.journalLaborerTip(PLAY, RATE)],
    ["journalLaborerTip · positive advantage", () => M.journalLaborerTip({ ...PLAY, advantage: 41508, advantageFull: 21508 }, RATE)],
    ["journalLaborerTip · unpriced sell", () => M.journalLaborerTip({ ...PLAY, sellPriced: false, fameBasis: "none" }, RATE)],
    ["_selfFillNoDataTip · no fillable tier", () => M._selfFillNoDataTip("no-fillable-tier")],
  ];
}

function checkAll(M, cap, mergedCap, lang) {
  const over = cases(M)
    .map(([label, build, kind]) => ({ label, text: String(build() || ""), cap: kind === "merged" ? mergedCap : cap }))
    .filter((r) => r.text.length > r.cap)
    .map((r) => `      ${r.label} (${r.text.length} > ${r.cap}): ${r.text.slice(0, 70)}…`);
  assert.strictEqual(over.length, 0, `${over.length} ${lang} tooltip(s) over the cap:\n${over.join("\n")}`);
}

test(`no composed English tooltip is longer than ${EN_CAP} characters (${MERGED_EN_CAP} merged)`,
  () => checkAll(EN, EN_CAP, MERGED_EN_CAP, "EN"));
test(`no composed Spanish tooltip is longer than ${ES_CAP} characters (${MERGED_ES_CAP} merged)`,
  () => checkAll(ES, ES_CAP, MERGED_ES_CAP, "ES"));

// Shortening must not cost the reader a figure. These are the facts each tip
// exists to carry; a rewrite that drops one is a regression, not a trim.
test("the merged play tooltip still names both plays and their figures", () => {
  const tip = EN.journalPlayTip(BUY, GATHER, 8);
  ["BUY FILLED:", "SELF-FILL:", "T6", "258,160", "268,492", "1,266,263", "Brecilien"]
    .forEach((needle) => assert.ok(tip.includes(needle), `missing ${needle} in: ${tip}`));
});

test("the crafting play tooltip still names crafts, tier and rate", () => {
  const tip = EN.journalPlayTip(BUY, CRAFT, 8);
  ["T8", "8.4", "41,290", "Martlock"].forEach((needle) =>
    assert.ok(tip.includes(needle), `missing ${needle} in: ${tip}`));
});

test("the Feed-a-Laborer tooltip still names payload, yield, rate and city", () => {
  const tip = EN.journalLaborerTip(PLAY, RATE);
  ["268,492", "150", "1,266,263", "Lymhurst"].forEach((needle) =>
    assert.ok(tip.includes(needle), `missing ${needle} in: ${tip}`));
});

test("no tooltip carries a raw double quote (it would end the attribute)", () => {
  cases(EN).concat(cases(ES)).forEach(([label, build]) => {
    const text = String(build() || "");
    assert.ok(!text.includes('"'), `${label} carries a raw quote: ${text}`);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
