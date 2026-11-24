/**
 * Test: per-group "Daily Production Bonus" — plan.md step 1 (TDD red).
 *
 * The game rotates a daily 10%/20% production bonus onto up to two ITEM GROUPS
 * per station. The old global select (#daily-production-bonus, "0"/"0.1"/"0.2")
 * is replaced by TWO toolbar slots, each a (group, bonus) select pair:
 *
 *   #daily-bonus-group-1 / #daily-bonus-value-1
 *   #daily-bonus-group-2 / #daily-bonus-value-2
 *
 * The group field is a type-to-filter TEXT INPUT over one shared <datalist>:
 * the typed label is resolved (dailyBonusGroupIdFromLabel,
 * js/data-daily-bonus-groups.js) onto the input's data-daily-bonus-group
 * attribute by js/app.js — that attribute, not the visible text, is what the
 * reader below trusts.
 *
 * A slot's bonus applies only to rows whose group matches:
 *   craft rows   → craftType as-is ("sword", "food", "potion", ...)
 *   refine rows  → "refine:" + resourceType ("refine:wood", ...)
 *   butcher rows → "butcher" (any meat)
 * The bonus still lands in the production-bonus sum that feeds
 * calcRRR(bonus) = bonus / (1 + bonus) inside every RRR getter:
 *
 *   getCraftRRR    base 0.18 (+0.15 city craft spec, +0.59 focus)
 *   getRefineRRR   base 0.18 (+0.40 refine spec,     +0.59 focus)
 *   getButcherRRR  base 0.18 (+0.10 butcher spec,    +0.59 focus)
 *
 * New pieces under contract:
 *   js/data-daily-bonus-groups.js — DAILY_BONUS_GROUPS (craft spec union +
 *       food + potion, "refine:wood|fiber|rock|ore|hide", "butcher"),
 *       isDailyBonusGroupId(id), dailyBonusGroupLabel(id)
 *   js/utils.js — getDailyProductionBonus() (map from the slots),
 *       getDailyProductionBonusFor(group), parseDailyBonusJson(str);
 *       all on globalThis. The old getDailyProductionBonusInput() scalar
 *       reader is replaced — the global bonus is no longer expressible.
 *   js/calculations.js — the three RRR getters consult
 *       getDailyProductionBonusFor with their group id.
 *
 * BLACK-BOX: the sandbox compiles the REAL js/data-city-bonuses.js +
 * js/data-daily-bonus-groups.js + js/calculations.js + js/utils.js (the
 * tests/crafting-self-found-profit.test.cjs pattern) with a document stub
 * serving the four slot elements. Expected RRRs are computed by the REAL
 * calcRRR over the hand-summed bonus, so the assertion is "the per-group
 * bonus lands in the sum before calcRRR", not a transcription of floats.
 *
 * RED BY DESIGN: js/data-daily-bonus-groups.js does not exist yet, so the
 * sandbox concatenates it only when present (fs.existsSync) and exports the
 * group API behind typeof guards — the same honest-red pattern this file used
 * for the previous global-bonus phase. The group-model, reader and parse
 * sections fail on the missing file/functions, and every targeted-bonus RRR
 * assertion fails on the unchanged baseline (the getters still read the old
 * global scalar path, whose stub element no longer exists). The no-bonus
 * baselines, mismatch rows and junk-pricing cases are regressions and pass
 * before AND after the feature.
 *
 * All inputs simulated; no live API.
 *
 * Run: node --test tests/daily-production-bonus.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8").replace(/\r\n/g, "\n");

// The per-group data module is the new piece: absent until step 2 implements
// it. Loading it is attempted, but must not take the whole sandbox down —
// otherwise every baseline below would fail for the wrong reason.
const GROUPS_PRESENT = fs.existsSync(path.join(ROOT, "js", "data-daily-bonus-groups.js"));

const sandbox = `
const _els = { "premium-account": { checked: true }, "station-fee": { value: "0" } };
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
`;

const mod = new Module("daily-production-bonus-test");
mod._compile(
  sandbox + J("data-city-bonuses.js") + (GROUPS_PRESENT ? J("data-daily-bonus-groups.js") : "") +
    (J("calculations.js") + J("calculations-margins.js")) + (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
    "\nmodule.exports = { calcRRR, getCraftRRR, getRefineRRR, getButcherRRR, _els," +
    " CITY_CRAFT_SPEC: (typeof CITY_CRAFT_SPEC !== 'undefined') ? CITY_CRAFT_SPEC : null," +
    " groupsLoaded: " + (GROUPS_PRESENT ? "true" : "false") + "," +
    " DAILY_BONUS_GROUPS: (typeof DAILY_BONUS_GROUPS !== 'undefined') ? DAILY_BONUS_GROUPS : null," +
    " isDailyBonusGroupId: (typeof isDailyBonusGroupId === 'function') ? isDailyBonusGroupId : null," +
    " dailyBonusGroupLabel: (typeof dailyBonusGroupLabel === 'function') ? dailyBonusGroupLabel : null," +
    " dailyBonusGroupIdFromLabel: (typeof dailyBonusGroupIdFromLabel === 'function') ? dailyBonusGroupIdFromLabel : null," +
    " getDailyProductionBonus: (typeof getDailyProductionBonus === 'function') ? getDailyProductionBonus : null," +
    " getDailyProductionBonusFor: (typeof getDailyProductionBonusFor === 'function') ? getDailyProductionBonusFor : null," +
    " parseDailyBonusJson: (typeof parseDailyBonusJson === 'function') ? parseDailyBonusJson : null };",
  "daily-production-bonus.js",
);
const X = mod.exports;
const { calcRRR, getCraftRRR, getRefineRRR, getButcherRRR, _els } = X;

// The two toolbar slots. Each slot is a [group, value] pair where group is the
// RESOLVED group id (or "none" / "" / junk): the group field is a text input
// over a shared datalist — its visible value is the id's LABEL text, while the
// reader-trusted id rides on data-daily-bonus-group — so the stub mirrors that
// real DOM shape. null removes the pair's elements entirely (DOM missing). An
// installed-but-unpicked slot sits at its boot defaults: empty input with
// dataset "none", bonus "0.1".
function setSlots(slot1, slot2) {
  [slot1, slot2].forEach((slot, i) => {
    const gid = "daily-bonus-group-" + (i + 1);
    const vid = "daily-bonus-value-" + (i + 1);
    delete _els[gid];
    delete _els[vid];
    if (slot) {
      const label = (typeof X.dailyBonusGroupLabel === "function")
        ? X.dailyBonusGroupLabel(slot[0])
        : slot[0];
      _els[gid] = { value: label, dataset: { dailyBonusGroup: slot[0] } };
      _els[vid] = { value: slot[1] };
    }
  });
}

// Point the slots at a bonus entry list: entry 1 fills slot 1, entry 2 slot 2,
// any remaining slot sits untouched at its "none" default.
function setBonus(entries) {
  setSlots(entries[0] || ["none", "0.1"], entries[1] || ["none", "0.1"]);
}

function clearBonus() {
  setBonus([]);
}
clearBonus(); // every case sets its own state; default to no bonus

const near = (a, b) => Math.abs(a - b) <= 1e-12;

function need(name) {
  if (typeof X[name] !== "function") {
    assert.fail(`${name} is missing (feature not implemented: js/${GROUPS_PRESENT ? "utils.js" : "data-daily-bonus-groups.js + js/utils.js"})`);
  }
  return X[name];
}

// ── 1. the group model (js/data-daily-bonus-groups.js) ─────────────────────
test("js/data-daily-bonus-groups.js exists on disk", () => {
  assert.ok(GROUPS_PRESENT, "the per-group daily-bonus data module must exist");
});

test("the sandbox loaded data-daily-bonus-groups.js", () => {
  assert.ok(X.groupsLoaded, "data-daily-bonus-groups.js must compile inside the sandbox");
});

test("DAILY_BONUS_GROUPS is available and is an array of string ids", () => {
  assert.ok(Array.isArray(X.DAILY_BONUS_GROUPS),
    "DAILY_BONUS_GROUPS must be an array (got " + X.DAILY_BONUS_GROUPS + ")");
  assert.ok(X.DAILY_BONUS_GROUPS.every((id) => typeof id === "string" && id.length > 0));
});

// The craft half is the ordered union of CITY_CRAFT_SPEC values plus the two
// consumable families; the resource halves are the refine prefix ids and the
// single butcher group.
const REFINING_GROUPS = ["refine:wood", "refine:fiber", "refine:rock", "refine:ore", "refine:hide"];
const BUTCHER_GROUP = "butcher";

function expectedGroupIds() {
  const ids = new Set(["food", "potion"]);
  Object.values(X.CITY_CRAFT_SPEC).forEach((list) => list.forEach((id) => ids.add(id)));
  REFINING_GROUPS.forEach((id) => ids.add(id));
  ids.add(BUTCHER_GROUP);
  return ids;
}

test("DAILY_BONUS_GROUPS == craft spec union + food/potion + refine:* + butcher, no duplicates", () => {
  // need() gates FUNCTION exports; DAILY_BONUS_GROUPS is an array constant
  // (its own test above asserts Array.isArray), so gate presence directly.
  assert.ok(Array.isArray(X.DAILY_BONUS_GROUPS), "DAILY_BONUS_GROUPS is missing");
  const groups = X.DAILY_BONUS_GROUPS;
  assert.strictEqual(new Set(groups).size, groups.length, "group ids must not repeat");
  assert.deepStrictEqual([...groups].sort(), [...expectedGroupIds()].sort(),
    "the group list must be exactly the craftable categories plus the five refine resources plus butcher");
});

const ID_CASES = [
  ["sword", true], ["food", true], ["potion", true],
  ["refine:wood", true], ["refine:hide", true], ["butcher", true],
  // Bare resource names and invented ids are not groups; nothing is a group
  // when there is no id at all.
  ["wood", false], ["refine:planks", false], ["bogus", false], ["", false],
  [null, false], [undefined, false],
];
for (const [id, want] of ID_CASES) {
  test(`isDailyBonusGroupId(${JSON.stringify(id)}) is ${want}`, () => {
    const fn = need("isDailyBonusGroupId");
    assert.strictEqual(fn(id), want);
  });
}

test("dailyBonusGroupLabel returns a non-empty string for every group id", () => {
  const fn = need("dailyBonusGroupLabel");
  for (const id of expectedGroupIds()) {
    const label = fn(id);
    assert.ok(typeof label === "string" && label.length > 0,
      `label for ${id} must be a non-empty string (got ${JSON.stringify(label)})`);
  }
});

// ── 1b. the label→id resolver behind the type-to-filter group inputs ───────
// The group pickers are text inputs over ONE shared <datalist>: the typed text
// is a LABEL that must resolve back onto the input's data-daily-bonus-group
// attribute. An exact (case-insensitive, whitespace-trimmed) label hit
// recovers its id; empty text and any miss resolve to the "none" sentinel —
// never a throw — so free-typed junk simply prices that slot as no bonus.
test("dailyBonusGroupIdFromLabel: exact labels resolve to their ids", () => {
  const fn = need("dailyBonusGroupIdFromLabel");
  [
    ["Sword", "sword"],
    ["Holy Staff", "holystaff"],
    ["Refine: Wood", "refine:wood"],
    ["Butchery", "butcher"],
    ["Food (Meals)", "food"],
    ["Potions", "potion"],
  ].forEach(([label, id]) => {
    assert.strictEqual(fn(label), id, `${JSON.stringify(label)} must resolve to ${id}`);
  });
});

test("dailyBonusGroupIdFromLabel is case-insensitive and trims whitespace", () => {
  const fn = need("dailyBonusGroupIdFromLabel");
  assert.strictEqual(fn("sword"), "sword");
  assert.strictEqual(fn("SWORD"), "sword");
  assert.strictEqual(fn("refine: wood"), "refine:wood");
  assert.strictEqual(fn("REFINE: WOOD"), "refine:wood");
  assert.strictEqual(fn("  Sword  "), "sword");
});

test("dailyBonusGroupIdFromLabel: empty, whitespace, unknown and non-string text resolve to 'none'", () => {
  const fn = need("dailyBonusGroupIdFromLabel");
  ["", "   ", "Swordfish", "bogus", null, undefined].forEach((text) => {
    assert.strictEqual(fn(text), "none",
      `${JSON.stringify(text)} must resolve to "none" (no bonus, no crash)`);
  });
});

test("dailyBonusGroupIdFromLabel: every group's label round-trips to its own id", () => {
  const fn = need("dailyBonusGroupIdFromLabel");
  assert.ok(Array.isArray(X.DAILY_BONUS_GROUPS) && X.DAILY_BONUS_GROUPS.length > 0,
    "DAILY_BONUS_GROUPS must be populated to round-trip");
  for (const id of X.DAILY_BONUS_GROUPS) {
    assert.strictEqual(fn(X.dailyBonusGroupLabel(id)), id,
      `the label for ${id} must resolve back to ${id}`);
  }
});

test("group labels are unique across DAILY_BONUS_GROUPS (the datalist keys on them)", () => {
  assert.ok(Array.isArray(X.DAILY_BONUS_GROUPS), "DAILY_BONUS_GROUPS is missing");
  const labels = X.DAILY_BONUS_GROUPS.map((id) => X.dailyBonusGroupLabel(id));
  assert.strictEqual(new Set(labels).size, labels.length,
    "a duplicated label would make two groups unresolvable from the typed text");
});

// ── 2. the reader: getDailyProductionBonus() maps the two slots ────────────
const READER_CASES = [
  {
    name: "two filled slots produce the group→bonus map",
    entries: [["sword", "0.1"], ["refine:wood", "0.2"]],
    want: { sword: 0.1, "refine:wood": 0.2 },
  },
  {
    name: "a slot left at group 'none' is skipped",
    entries: [["none", "0.2"], ["butcher", "0.1"]],
    want: { butcher: 0.1 },
  },
  {
    name: "an empty group id is skipped",
    entries: [["", "0.2"], ["butcher", "0.1"]],
    want: { butcher: 0.1 },
  },
  {
    name: "only the second slot filled still reads",
    entries: [["butcher", "0.1"]],
    want: { butcher: 0.1 },
  },
  {
    name: "junk bonus value is skipped",
    entries: [["sword", "abc"]],
    want: {},
  },
  {
    name: "an out-of-set bonus value (0.5) is skipped",
    entries: [["sword", "0.5"]],
    want: {},
  },
  {
    name: "a '0' bonus value is skipped",
    entries: [["sword", "0"]],
    want: {},
  },
  {
    name: "an unknown group id is skipped",
    entries: [["bogus", "0.2"]],
    want: {},
  },
  {
    name: "both slots at their none/0.1 defaults read as no bonus",
    entries: [],
    want: {},
  },
];
for (const c of READER_CASES) {
  test(`getDailyProductionBonus: ${c.name}`, () => {
    const read = need("getDailyProductionBonus");
    setBonus(c.entries);
    assert.deepStrictEqual(read(), c.want);
  });
}

test("getDailyProductionBonus: missing slot elements degrade to {}", () => {
  const read = need("getDailyProductionBonus");
  setSlots(null, null);
  assert.deepStrictEqual(read(), {});
});

test("getDailyProductionBonus: a slot with its group element deleted is skipped", () => {
  const read = need("getDailyProductionBonus");
  setSlots(["sword", "0.2"], null);
  delete _els["daily-bonus-group-1"];
  assert.deepStrictEqual(read(), {});
});

test("getDailyProductionBonus: a duplicate group in slot 2 overwrites slot 1", () => {
  const read = need("getDailyProductionBonus");
  setBonus([["sword", "0.1"], ["sword", "0.2"]]);
  assert.deepStrictEqual(read(), { sword: 0.2 });
});

test("getDailyProductionBonus: flipping the slots re-reads live (no cached map)", () => {
  const read = need("getDailyProductionBonus");
  setBonus([["sword", "0.2"]]);
  assert.deepStrictEqual(read(), { sword: 0.2 });
  setBonus([]);
  assert.deepStrictEqual(read(), {});
  setBonus([["refine:ore", "0.1"]]);
  assert.deepStrictEqual(read(), { "refine:ore": 0.1 });
});
clearBonus();

test("getDailyProductionBonus: the reader trusts the dataset id, not the typed text", () => {
  const read = need("getDailyProductionBonus");
  setBonus([["sword", "0.2"]]);
  // The visible text is display-only: whatever it reads, the id on
  // data-daily-bonus-group decides the slot's group.
  _els["daily-bonus-group-1"].value = "totally not a label";
  assert.deepStrictEqual(read(), { sword: 0.2 },
    "a label/value mismatch must not change what the reader reads");
  _els["daily-bonus-group-1"].value = "Sword";
  assert.deepStrictEqual(read(), { sword: 0.2 });
});
clearBonus();

test("getDailyProductionBonus: a slot with no dataset id at all is skipped", () => {
  const read = need("getDailyProductionBonus");
  setBonus([["sword", "0.2"]]);
  _els["daily-bonus-group-1"] = { value: "Sword" }; // input without the attribute
  assert.deepStrictEqual(read(), {},
    "an input with no resolved data-daily-bonus-group prices as no bonus");
});
clearBonus();

// ── 3. getDailyProductionBonusFor(group) ───────────────────────────────────
const FOR_CASES = [
  { entries: [["sword", "0.2"]], group: "sword", want: 0.2 },
  { entries: [["refine:wood", "0.1"]], group: "refine:wood", want: 0.1 },
  { entries: [["butcher", "0.1"], ["sword", "0.2"]], group: "butcher", want: 0.1 },
  { entries: [["sword", "0.2"]], group: "bow", want: 0, why: "a group with no slot prices as 0" },
  { entries: [], group: "sword", want: 0, why: "no bonus anywhere prices as 0" },
  { entries: [["sword", "0.2"]], group: null, want: 0, why: "a null group (mount rows) is never targeted" },
  { entries: [["sword", "0.2"]], group: undefined, want: 0, why: "an undefined group is never targeted" },
  { entries: [["bogus", "0.2"]], group: "bogus", want: 0, why: "an invalid group id can never be targeted" },
];
for (const c of FOR_CASES) {
  test(`getDailyProductionBonusFor(${JSON.stringify(c.group)}) is ${c.want}${c.why ? ` (${c.why})` : ""}`, () => {
    const fn = need("getDailyProductionBonusFor");
    setBonus(c.entries);
    assert.strictEqual(fn(c.group), c.want);
  });
}
clearBonus();

// ── 4. parseDailyBonusJson: the stored-pref validator ──────────────────────
const PARSE_CASES = [
  {
    name: "a valid two-group map parses to itself",
    str: '{"sword":0.2,"refine:wood":0.1}',
    want: { sword: 0.2, "refine:wood": 0.1 },
  },
  {
    name: "string bonus values are coerced to the legal numbers",
    str: '{"sword":"0.2"}',
    want: { sword: 0.2 },
  },
  {
    name: "an unknown group is dropped",
    str: '{"sword":0.2,"bogus":0.2}',
    want: { sword: 0.2 },
  },
  {
    name: "an out-of-set number (0.5) drops the entry",
    str: '{"sword":0.5}',
    want: {},
  },
  {
    name: "a junk value drops the entry",
    str: '{"sword":"abc"}',
    want: {},
  },
  {
    name: "a zero value drops the entry",
    str: '{"sword":0}',
    want: {},
  },
  {
    name: "a boolean value drops the entry",
    str: '{"sword":true}',
    want: {},
  },
  {
    name: "the legacy scalar '0.2' is no longer expressible: {}",
    str: "0.2",
    want: {},
  },
  {
    name: "the legacy scalar '0.1' is no longer expressible: {}",
    str: "0.1",
    want: {},
  },
  {
    name: "the legacy scalar '0' is no longer expressible: {}",
    str: "0",
    want: {},
  },
  {
    name: "junk text degrades to {}",
    str: "abc",
    want: {},
  },
  {
    name: "more than two groups keeps the first two",
    str: '{"sword":0.2,"refine:wood":0.1,"butcher":0.2}',
    want: { sword: 0.2, "refine:wood": 0.1 },
  },
  {
    name: "null degrades to {}",
    str: null,
    want: {},
  },
  {
    name: "undefined degrades to {}",
    str: undefined,
    want: {},
  },
];
for (const c of PARSE_CASES) {
  test(`parseDailyBonusJson(${JSON.stringify(c.str)}) → ${JSON.stringify(c.want)} (${c.name})`, () => {
    const fn = need("parseDailyBonusJson");
    assert.deepStrictEqual(fn(c.str), c.want);
  });
}

// ── 5. the per-group bonus lands in the RRR sum, before calcRRR ────────────
// Real spec tables (js/data-city-bonuses.js): Bridgewatch crafts no "sword"
// (base 0.18), Lymhurst does (0.33, 0.92 with focus); Fort Sterling refines
// "wood" (0.58); Bridgewatch butchers T4_MEAT (0.28); Caerleon specs "food"
// and Brecilien "potion" (both 0.33).
const RRR_CASES = [
  { name: "craft, non-spec city (Bridgewatch / sword)", rrr: () => getCraftRRR("Bridgewatch", "sword", false), sum: 0.18 },
  { name: "craft, spec city (Lymhurst / sword)", rrr: () => getCraftRRR("Lymhurst", "sword", false), sum: 0.33 },
  { name: "craft, spec city with focus (Lymhurst / sword)", rrr: () => getCraftRRR("Lymhurst", "sword", true), sum: 0.92 },
  { name: "refine, spec city (Fort Sterling / wood)", rrr: () => getRefineRRR("Fort Sterling", "wood", false), sum: 0.58 },
  { name: "butcher, spec city (Bridgewatch / T4_MEAT)", rrr: () => getButcherRRR("Bridgewatch", "T4_MEAT", false), sum: 0.28 },
];

for (const c of RRR_CASES) {
  test(`no bonus: ${c.name} stays calcRRR(${c.sum})`, () => {
    clearBonus();
    assert.ok(near(c.rrr(), calcRRR(c.sum)),
      `got ${c.rrr()}, want calcRRR(${c.sum}) = ${calcRRR(c.sum)}`);
  });
}

const TARGETED_CASES = [
  {
    name: "craft match: {sword:0.2} raises sword at Bridgewatch (no spec there)",
    call: () => getCraftRRR("Bridgewatch", "sword", false),
    entries: [["sword", "0.2"]],
    sum: 0.18 + 0.2,
  },
  {
    name: "craft match stacks on the city spec: {sword:0.2} at Lymhurst",
    call: () => getCraftRRR("Lymhurst", "sword", false),
    entries: [["sword", "0.2"]],
    sum: 0.33 + 0.2,
  },
  {
    name: "craft match + focus anchor: {sword:0.2} at Lymhurst with focus",
    call: () => getCraftRRR("Lymhurst", "sword", true),
    entries: [["sword", "0.2"]],
    sum: 0.33 + 0.2 + 0.59,
  },
  {
    name: "craft mismatch: {bow:0.2} leaves sword at Bridgewatch unboosted",
    call: () => getCraftRRR("Bridgewatch", "sword", false),
    entries: [["bow", "0.2"]],
    sum: 0.18,
  },
  {
    name: "craft mismatch keeps the spec: {bow:0.2} leaves Lymhurst sword at its 0.33 spec baseline",
    call: () => getCraftRRR("Lymhurst", "sword", false),
    entries: [["bow", "0.2"]],
    sum: 0.33,
  },
  {
    name: "null craftType (mount rows) is never targeted, even with a map set",
    call: () => getCraftRRR("Lymhurst", null, false),
    entries: [["sword", "0.2"]],
    sum: 0.18,
  },
  {
    name: "refine match: {refine:wood:0.1} raises wood at Fort Sterling",
    call: () => getRefineRRR("Fort Sterling", "wood", false),
    entries: [["refine:wood", "0.1"]],
    sum: 0.58 + 0.1,
  },
  {
    name: "refine mismatch: {refine:wood:0.1} leaves Bridgewatch rock at its 0.58 spec baseline",
    call: () => getRefineRRR("Bridgewatch", "rock", false),
    entries: [["refine:wood", "0.1"]],
    sum: 0.58,
  },
  {
    name: "bare 'wood' is not a refine group: it must not boost refining wood",
    call: () => getRefineRRR("Fort Sterling", "wood", false),
    entries: [["wood", "0.2"]],
    sum: 0.58,
  },
  {
    name: "butcher match: {butcher:0.2} raises T4_MEAT at spec city Bridgewatch",
    call: () => getButcherRRR("Bridgewatch", "T4_MEAT", false),
    entries: [["butcher", "0.2"]],
    sum: 0.28 + 0.2,
  },
  {
    name: "butcher targets ANY meat: {butcher:0.1} raises T8_MEAT at non-spec Fort Sterling",
    call: () => getButcherRRR("Fort Sterling", "T8_MEAT", false),
    entries: [["butcher", "0.1"]],
    sum: 0.18 + 0.1,
  },
  {
    name: "craft group 'food' is targetable: {food:0.1} stacks on Caerleon's food spec",
    call: () => getCraftRRR("Caerleon", "food", false),
    entries: [["food", "0.1"]],
    sum: 0.33 + 0.1,
  },
  {
    name: "craft group 'potion' is targetable: {potion:0.2} stacks on Brecilien's potion spec",
    call: () => getCraftRRR("Brecilien", "potion", false),
    entries: [["potion", "0.2"]],
    sum: 0.33 + 0.2,
  },
  {
    name: "a junk slot value prices the row as no bonus",
    call: () => getCraftRRR("Bridgewatch", "sword", false),
    entries: [["sword", "abc"]],
    sum: 0.18,
  },
];

for (const c of TARGETED_CASES) {
  test(`${c.name} → calcRRR(${c.sum})`, () => {
    setBonus(c.entries);
    assert.ok(near(c.call(), calcRRR(c.sum)),
      `got ${c.call()}, want calcRRR(${c.sum}) = ${calcRRR(c.sum)} — ` +
      `the per-group daily bonus must be added to the production-bonus sum before calcRRR`);
  });
}
clearBonus();

for (const c of RRR_CASES) {
  test(`no bonus baseline: ${c.name} is the hand-computed fraction`, () => {
    clearBonus();
    assert.ok(near(c.rrr(), c.sum / (1 + c.sum)),
      `got ${c.rrr()}, want ${c.sum}/(1+${c.sum})`);
  });
}

test("+20% on plain crafting is the exact 0.38/1.38 fraction, hand-computed", () => {
  setBonus([["sword", "0.2"]]);
  assert.ok(near(getCraftRRR("Bridgewatch", "sword", false), 0.38 / 1.38),
    `got ${getCraftRRR("Bridgewatch", "sword", false)}, want ${0.38 / 1.38}`);
});
clearBonus();

test("flipping the slots moves the RRR live (no cached bonus)", () => {
  clearBonus();
  const none = getCraftRRR("Bridgewatch", "sword", false);
  setBonus([["sword", "0.2"]]);
  const some = getCraftRRR("Bridgewatch", "sword", false);
  clearBonus();
  const back = getCraftRRR("Bridgewatch", "sword", false);
  assert.ok(some > none, `a matching +20% must raise the RRR (${some} !> ${none})`);
  assert.ok(near(back, none), `clearing the slots must restore the RRR (${back} != ${none})`);
});

test("the legacy global scalar path is gone: a stale #daily-production-bonus element no longer moves RRR", () => {
  clearBonus();
  _els["daily-production-bonus"] = { value: "0.2" };
  assert.ok(near(getCraftRRR("Bridgewatch", "sword", false), calcRRR(0.18)),
    `got ${getCraftRRR("Bridgewatch", "sword", false)}, want calcRRR(0.18) — ` +
    `a global bonus must no longer be expressible`);
  delete _els["daily-production-bonus"];
});
clearBonus();

// ── 6. the reader has NO global Clear gate ─────────────────────────────────
// Clearing is per-slot now: each slot's ✕ button (#daily-bonus-clear-1/-2)
// empties its own group/value pair through the same persist path as the
// change listeners. The reader itself must never consult a global gate —
// a stray element with the old #daily-bonus-clear checkbox id (an older DOM,
// a leftover stub) present and CHECKED must not silence the slots.
test("a stray #daily-bonus-clear element no longer gates the reader", () => {
  const read = need("getDailyProductionBonus");
  setBonus([["sword", "0.2"], ["refine:wood", "0.1"]]);
  _els["daily-bonus-clear"] = { checked: true }; // the old gate element, checked
  try {
    assert.deepStrictEqual(read(), { sword: 0.2, "refine:wood": 0.1 },
      "a stray #daily-bonus-clear element must not gate the reader — " +
      "clearing is per-slot now, through the slots themselves");
    assert.ok(near(getCraftRRR("Bridgewatch", "sword", false), calcRRR(0.38)),
      "and the RRR keeps the bonus");
  } finally {
    delete _els["daily-bonus-clear"];
  }
});
clearBonus();
