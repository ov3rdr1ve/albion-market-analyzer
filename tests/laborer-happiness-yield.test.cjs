/**
 * Laborer yield as a function of TROPHY HAPPINESS.
 *
 *   yield = min(150%, baseYield + 0.5% × (happiness − 100 × laborerTier))
 *   baseYield = 100% for a journal at the laborer's own tier
 *               150% for any journal BELOW the laborer's tier
 *
 * Happiness above base comes from trophies, and items.xml decides which reach
 * whom via `labourersaffected`: "all" (a general trophy, 5) or one gathering /
 * mercenary type (10). NOTHING targets a crafting laborer, so a Blacksmith,
 * Fletcher, Imbuer or Tinker can only collect the general 5s — a hard 120%
 * own-tier ceiling — while a gatherer or the mercenary can reach 150%.
 *
 * A bed and a table are 50 × tier each, so a laborer with both at its own tier
 * sits exactly on its 100 × tier base and the trophies are the whole bonus.
 *
 * Black-box: only the exported yield/happiness functions and the stored
 * preferences are touched, never the internals of the pricing pipeline.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function loadFile(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

// A localStorage stand-in the modules can read through their own guards.
const sandbox = `
let __store = {};
const localStorage = {
  getItem: (k) => (k in __store ? __store[k] : null),
  setItem: (k, v) => { __store[k] = String(v); },
  removeItem: (k) => { delete __store[k]; },
};
function __setStore(next) { __store = next || {}; }
`;

const EXPORTS =
  "\nmodule.exports = { getLaborerYield, getLaborerYieldFor, getLaborerBaseHappiness, " +
  "getLaborerHappinessBonusFor, getLaborerMaxHappinessBonus, laborerHasMatchingTrophy, " +
  "GENERAL_TROPHY_HAPPINESS_MAX, MATCHING_TROPHY_HAPPINESS_MAX, LABORER_YIELD_CAP, " +
  "LABORER_HAPPINESS_GENERAL_KEY, LABORER_HAPPINESS_MATCHING_KEY, " +
  "getLaborerHappinessGeneral, getLaborerHappinessMatching, getLaborerHappiness, " +
  "laborerHappinessSummary, initLaborerHappinessControl, " +
  "refreshLaborerHappinessControl, HOUSE_TIER_KEY, getHouseTier, setHouseTier, " +
  "getHouseTrophyCaps, __setStore };";

// js/house-tier.js loads before the happiness prefs in index.html, and the two
// boxes read their ceilings through it — a T6 house has no T7 trophy to place.
const SOURCES = ["js/data-laborers.js", "js/house-tier.js", "js/laborer-happiness.js"];
const loadSources = () => SOURCES.map(loadFile).join("");

const mod = new Module("laborer-happiness-test");
mod._compile(sandbox + loadSources() + EXPORTS, "laborer-happiness.js");

const {
  getLaborerYield, getLaborerYieldFor, getLaborerBaseHappiness,
  getLaborerHappinessBonusFor, getLaborerMaxHappinessBonus, laborerHasMatchingTrophy,
  GENERAL_TROPHY_HAPPINESS_MAX, MATCHING_TROPHY_HAPPINESS_MAX, LABORER_YIELD_CAP,
  LABORER_HAPPINESS_GENERAL_KEY, LABORER_HAPPINESS_MATCHING_KEY,
  getLaborerHappinessGeneral, getLaborerHappinessMatching, getLaborerHappiness,
  laborerHappinessSummary, HOUSE_TIER_KEY, __setStore,
} = mod.exports;

const GEN = LABORER_HAPPINESS_GENERAL_KEY;
const MATCH = LABORER_HAPPINESS_MATCHING_KEY;
const HOUSE = HOUSE_TIER_KEY;

// The lower-tier-journal branch lives with the crafting-planner helper, which
// needs the laborer data + happiness in scope.
const jmod = new Module("laborer-journal-yield-test");
jmod._compile(
  sandbox + loadSources() + loadFile("js/laborer-journal-value.js") +
    "\nmodule.exports = { getLaborerJournalYield, LABORER_JOURNAL_ASSUMED_TIER, __setStore };",
  "laborer-journal-yield.js"
);
const { getLaborerJournalYield, LABORER_JOURNAL_ASSUMED_TIER, __setStore: __setJStore } = jmod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { __setStore({}); __setJStore({}); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}
function approx(actual, expected, tol = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tol, `expected ~${expected}, got ${actual}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Base happiness ===");

test("base happiness is 100 × laborer tier", () => {
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    assert.strictEqual(getLaborerBaseHappiness(tier), 100 * tier);
  });
});

test("getLaborerHappiness reports the absolute in-game number per laborer type", () => {
  __setStore({ [GEN]: "40", [MATCH]: "70" });
  assert.strictEqual(getLaborerHappiness(8, "TOOLMAKER"), 840, "T8 Tinker: base 800 + general 40");
  assert.strictEqual(getLaborerHappiness(8, "WOOD"), 910, "T8 Lumberjack also gets its 70");
  assert.strictEqual(getLaborerHappiness(7, "TOOLMAKER"), 740);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Which trophies reach which laborer (items.xml labourersaffected) ===");

test("gathering + mercenary laborers have a matching trophy; crafting laborers do not", () => {
  ["WOOD", "STONE", "ORE", "FIBER", "HIDE", "FISHING", "MERCENARY"].forEach((slug) => {
    assert.strictEqual(laborerHasMatchingTrophy(slug), true, slug);
  });
  ["WARRIOR", "HUNTER", "MAGE", "TOOLMAKER"].forEach((slug) => {
    assert.strictEqual(laborerHasMatchingTrophy(slug), false, `${slug} has no trophy of its own`);
  });
});

test("an unknown or missing slug is treated as having no matching trophy", () => {
  assert.strictEqual(laborerHasMatchingTrophy(null), false);
  assert.strictEqual(laborerHasMatchingTrophy("NOT_A_LABORER"), false);
});

test("the trophy ceiling is 110 for gatherers and 40 for crafting laborers", () => {
  assert.strictEqual(GENERAL_TROPHY_HAPPINESS_MAX, 40, "8 general trophies × 5");
  assert.strictEqual(MATCHING_TROPHY_HAPPINESS_MAX, 70, "T2-T8 of its own type × 10");
  assert.strictEqual(getLaborerMaxHappinessBonus("WOOD"), 110);
  assert.strictEqual(getLaborerMaxHappinessBonus("TOOLMAKER"), 40);
});

test("a crafting laborer can never pass 120% on its own-tier journal", () => {
  // Every trophy in the game placed — the crafting laborers still stop at 120%.
  __setStore({ [GEN]: String(GENERAL_TROPHY_HAPPINESS_MAX), [MATCH]: String(MATCHING_TROPHY_HAPPINESS_MAX) });
  ["WARRIOR", "HUNTER", "MAGE", "TOOLMAKER"].forEach((slug) => {
    approx(getLaborerYieldFor(slug, 8), 1.20);
  });
  ["WOOD", "ORE", "MERCENARY"].forEach((slug) => {
    approx(getLaborerYieldFor(slug, 8), LABORER_YIELD_CAP);
  });
});

test("the matching-trophy box does not move a crafting laborer at all", () => {
  [0, 30, 70].forEach((matching) => {
    __setStore({ [GEN]: "40", [MATCH]: String(matching) });
    approx(getLaborerYieldFor("TOOLMAKER", 8), 1.20, 1e-9);
  });
});

test("the general-trophy box moves every laborer", () => {
  __setStore({ [GEN]: "0", [MATCH]: "0" });
  approx(getLaborerYieldFor("TOOLMAKER", 8), 1.0);
  approx(getLaborerYieldFor("WOOD", 8), 1.0);
  __setStore({ [GEN]: "20", [MATCH]: "0" });
  approx(getLaborerYieldFor("TOOLMAKER", 8), 1.10);
  approx(getLaborerYieldFor("WOOD", 8), 1.10);
});

test("an unnamed laborer gets the general share only — understate, never overstate", () => {
  __setStore({ [GEN]: "40", [MATCH]: "70" });
  approx(getLaborerYield(8), 1.20, 1e-9);
  assert.strictEqual(getLaborerHappinessBonusFor(null), 40);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The yield curve ===");

const YIELD_CASES = [
  // [bonus above base, expected yield, why]
  [0,   1.00, "bare minimum happiness — beds and tables only, no trophies"],
  [10,  1.05, "one matching-type trophy"],
  [40,  1.20, "every general trophy — the crafting laborers' ceiling"],
  [70,  1.35, "every matching-type trophy tier placed"],
  [100, 1.50, "the +50% ceiling is reached at exactly 100 points"],
  [110, 1.50, "every trophy a gatherer can hold — 10 points are wasted"],
  [500, 1.50, "nothing above the cap ever pays"],
];

YIELD_CASES.forEach(([bonus, expected, why]) => {
  test(`+${bonus} happiness → ${(expected * 100).toFixed(0)}% own-tier yield (${why})`, () => {
    [2, 5, 8].forEach((tier) => approx(getLaborerYield(tier, bonus), expected));
  });
});

test("the bonus is tier-independent — base happiness cancels out of the formula", () => {
  [0, 25, 40, 100].forEach((bonus) => {
    const t2 = getLaborerYield(2, bonus);
    [3, 4, 5, 6, 7, 8].forEach((tier) => {
      assert.strictEqual(getLaborerYield(tier, bonus), t2,
        `bonus +${bonus} must yield the same at T${tier} as at T2`);
    });
  });
});

test("wiki worked examples: 840 on a T8 and 740 on a T7 both give 120%", () => {
  approx(getLaborerYield(8, 840 - getLaborerBaseHappiness(8)), 1.20);
  approx(getLaborerYield(7, 740 - getLaborerBaseHappiness(7)), 1.20);
});

test("a negative or unusable bonus floors at the 100% base, never below", () => {
  [-1, -800, NaN, Infinity, null, "abc"].forEach((bad) => {
    const y = getLaborerYield(8, bad);
    assert.ok(y >= 1.0 && y <= LABORER_YIELD_CAP,
      `bonus ${String(bad)} produced an out-of-range yield ${y}`);
  });
  approx(getLaborerYield(8, -50), 1.0);
});

test("yield never exceeds the 150% cap, whatever the inputs", () => {
  assert.strictEqual(LABORER_YIELD_CAP, 1.5);
  [0, 40, 100, 1e6].forEach((bonus) => {
    [2, 8].forEach((tier) => assert.ok(getLaborerYield(tier, bonus) <= LABORER_YIELD_CAP));
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The stored preferences ===");

test("unset = every trophy placed (the app-wide max-spec convention)", () => {
  __setStore({});
  assert.strictEqual(getLaborerHappinessGeneral(), GENERAL_TROPHY_HAPPINESS_MAX);
  assert.strictEqual(getLaborerHappinessMatching(), MATCHING_TROPHY_HAPPINESS_MAX);
  approx(getLaborerYieldFor("WOOD", 8), LABORER_YIELD_CAP);
  approx(getLaborerYieldFor("TOOLMAKER", 8), 1.20);
});

test("stored values drive the yield with no argument passed", () => {
  __setStore({ [GEN]: "20", [MATCH]: "40" });
  assert.strictEqual(getLaborerHappinessGeneral(), 20);
  assert.strictEqual(getLaborerHappinessMatching(), 40);
  approx(getLaborerYieldFor("WOOD", 8), 1.30, 1e-9);   // 60 points
  approx(getLaborerYieldFor("TOOLMAKER", 8), 1.10);    // 20 points
});

test("an explicit bonus argument always beats the stored preference", () => {
  __setStore({ [GEN]: "0", [MATCH]: "0" });
  approx(getLaborerYield(8, 100), 1.5, 1e-9);
  approx(getLaborerYield(8), 1.0);
});

test("corrupt / out-of-range stored values degrade to something usable", () => {
  const cases = [
    ["", GENERAL_TROPHY_HAPPINESS_MAX],
    ["   ", GENERAL_TROPHY_HAPPINESS_MAX],
    ["banana", GENERAL_TROPHY_HAPPINESS_MAX],
    ["-20", 0],
    ["9999", GENERAL_TROPHY_HAPPINESS_MAX],
    ["20.6", 20],
  ];
  cases.forEach(([stored, expected]) => {
    __setStore({ [GEN]: stored });
    assert.strictEqual(getLaborerHappinessGeneral(), expected,
      `stored ${JSON.stringify(stored)} should read back as ${expected}`);
  });
  __setStore({ [MATCH]: "9999" });
  assert.strictEqual(getLaborerHappinessMatching(), MATCHING_TROPHY_HAPPINESS_MAX);
});

test("a stored 0 is honoured, not treated as unset", () => {
  __setStore({ [GEN]: "0", [MATCH]: "0" });
  assert.strictEqual(getLaborerHappinessGeneral(), 0);
  assert.strictEqual(getLaborerHappinessMatching(), 0);
  approx(getLaborerYieldFor("WOOD", 8), 1.0);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The house tier caps both boxes ===");

test("an unset house tier is T8 — the pre-existing ceilings, unchanged", () => {
  __setStore({});
  assert.strictEqual(getLaborerHappinessGeneral(), GENERAL_TROPHY_HAPPINESS_MAX);
  assert.strictEqual(getLaborerHappinessMatching(), MATCHING_TROPHY_HAPPINESS_MAX);
});

test("a T6 house pulls a stored +70/+40 down to what it can hold", () => {
  // T2-T6 of each line: 5 matching at +10 and 5 general at +5.
  __setStore({ [HOUSE]: "6", [GEN]: "40", [MATCH]: "70" });
  assert.strictEqual(getLaborerHappinessMatching(), 50);
  assert.strictEqual(getLaborerHappinessGeneral(), 25);
});

test("the same stored values are untouched on a T8 house", () => {
  __setStore({ [HOUSE]: "8", [GEN]: "40", [MATCH]: "70" });
  assert.strictEqual(getLaborerHappinessMatching(), 70);
  assert.strictEqual(getLaborerHappinessGeneral(), 40);
});

test("a value the house CAN hold is left alone", () => {
  __setStore({ [HOUSE]: "6", [GEN]: "10", [MATCH]: "20" });
  assert.strictEqual(getLaborerHappinessGeneral(), 10);
  assert.strictEqual(getLaborerHappinessMatching(), 20);
});

test("unset boxes default to the house's ceiling, not to T8's", () => {
  __setStore({ [HOUSE]: "4" });
  assert.strictEqual(getLaborerHappinessMatching(), 30);
  assert.strictEqual(getLaborerHappinessGeneral(), 15);
});

test("the house tier moves the yield a laborer actually reaches", () => {
  // A fully-trophied gatherer is at the 150% cap in a T8 house. The same crew in
  // a T5 house collects 40 + 20 = 60 points, i.e. 130%.
  __setStore({ [HOUSE]: "8" });
  approx(getLaborerYieldFor("WOOD", 8), LABORER_YIELD_CAP);
  __setStore({ [HOUSE]: "5" });
  approx(getLaborerYieldFor("WOOD", 8), 1.30, 1e-9);
  approx(getLaborerYieldFor("TOOLMAKER", 8), 1.10, 1e-9);   // general 20 only
});

test("a T2 house is the floor: +10 matching, +5 general", () => {
  __setStore({ [HOUSE]: "2" });
  assert.strictEqual(getLaborerHappinessMatching(), 10);
  assert.strictEqual(getLaborerHappinessGeneral(), 5);
  approx(getLaborerYieldFor("WOOD", 8), 1.075, 1e-9);
});

test("a corrupt house tier degrades to T8 rather than zeroing every yield", () => {
  ["", "   ", "banana", "9999"].forEach((stored) => {
    __setStore({ [HOUSE]: stored });
    assert.strictEqual(getLaborerHappinessMatching(), MATCHING_TROPHY_HAPPINESS_MAX,
      `house tier ${JSON.stringify(stored)}`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The stored preferences (continued) ===");

test("the caption names both families and their in-game numbers", () => {
  __setStore({ [GEN]: "40", [MATCH]: "70" });
  const s = laborerHappinessSummary();
  assert.strictEqual(s.gatherPct, 150);
  assert.strictEqual(s.craftPct, 120);
  assert.ok(s.text.includes("910"), `gatherer's in-game happiness: ${s.text}`);
  assert.ok(s.text.includes("840"), `crafter's in-game happiness: ${s.text}`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== Journal below the laborer's tier ===");

test("any lower-tier journal runs at the 150% ceiling, even at zero happiness", () => {
  __setJStore({ [GEN]: "0", [MATCH]: "0" });
  assert.strictEqual(getLaborerJournalYield(7, 8, "TOOLMAKER"), 1.5);
  assert.strictEqual(getLaborerJournalYield(2, 8, "WOOD"), 1.5);
  assert.strictEqual(getLaborerJournalYield(4, 5, null), 1.5);
});

test("an own-tier journal follows the happiness its type can collect", () => {
  __setJStore({ [GEN]: "40", [MATCH]: "70" });
  approx(getLaborerJournalYield(8, 8, "TOOLMAKER"), 1.20);
  approx(getLaborerJournalYield(8, 8, "WOOD"), 1.50);
});

test("the assumed laborer is max tier (T8)", () => {
  assert.strictEqual(LABORER_JOURNAL_ASSUMED_TIER, 8);
});

test("for a crafting laborer, a lower-tier journal ALWAYS out-yields its own tier", () => {
  // 150% vs a 120% hard ceiling — the tier advantage never closes for them,
  // whatever the house looks like.
  [{ [GEN]: "0" }, { [GEN]: "40", [MATCH]: "70" }].forEach((store) => {
    __setJStore(store);
    assert.ok(getLaborerJournalYield(7, 8, "TOOLMAKER") > getLaborerJournalYield(8, 8, "TOOLMAKER"));
  });
});

test("for a fully-trophied gatherer the two branches tie", () => {
  __setJStore({ [GEN]: "40", [MATCH]: "70" });
  assert.strictEqual(getLaborerJournalYield(8, 8, "WOOD"), getLaborerJournalYield(7, 8, "WOOD"),
    "both at the cap — the only difference left is which tier of loot comes back");
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The user's observed run (3 T8 Tinkers, 840 happiness) ===");

test("840 on a T8 Tinker is the game's maximum for that laborer", () => {
  __setStore({ [GEN]: String(GENERAL_TROPHY_HAPPINESS_MAX), [MATCH]: String(MATCHING_TROPHY_HAPPINESS_MAX) });
  assert.strictEqual(getLaborerHappiness(8, "TOOLMAKER"), 840);
  approx(getLaborerYieldFor("TOOLMAKER", 8) * 4.2, 5.04, 1e-9); // CRAFTING_BASELOOT[8] = 4.2
});

test("a T7 journal on that same T8 Tinker is capped at 150%", () => {
  __setJStore({ [GEN]: "40", [MATCH]: "70" });
  approx(getLaborerJournalYield(7, 8, "TOOLMAKER") * 4.4, 6.6, 1e-9); // CRAFTING_BASELOOT[7] = 4.4
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n=== The header controls ===");

// Minimal DOM stub: the controls only read/write two <input>s and a note span.
function controlHarness(store) {
  const mk = (id) => ({
    id, value: "", max: "", _handlers: {},
    addEventListener(type, fn) { this._handlers[type] = fn; },
    change(next) { this.value = next; this._handlers.change(); },
  });
  const general = mk("laborer-happiness-general");
  const matching = mk("laborer-happiness-matching");
  const note = { id: "laborer-happiness-note", textContent: "" };
  const dom = `
const __els = globalThis.__els;
const document = {
  getElementById: (id) => __els[id] || null,
  querySelectorAll: () => [],
};
`;
  // Published before the compile: the module body binds them at load time.
  globalThis.__els = {
    "laborer-happiness-general": general,
    "laborer-happiness-matching": matching,
    "laborer-happiness-note": note,
  };
  const m = new Module(`laborer-happiness-control-${Math.random()}`);
  m._compile(sandbox + dom + loadSources() + EXPORTS, "laborer-happiness-control.js");
  const api = m.exports;
  api.__setStore(store || {});
  return { general, matching, note, api };
}

test("the boxes open on the stored values and caption both ceilings", () => {
  const h = controlHarness({ [GEN]: "40", [MATCH]: "0" });
  h.api.initLaborerHappinessControl();
  assert.strictEqual(h.general.value, "40");
  assert.strictEqual(h.matching.value, "0");
  assert.strictEqual(h.general.max, String(GENERAL_TROPHY_HAPPINESS_MAX));
  assert.strictEqual(h.matching.max, String(MATCHING_TROPHY_HAPPINESS_MAX));
  assert.ok(h.note.textContent.includes("120.0%"), h.note.textContent);
});

test("unset preferences open on the max defaults, not blank boxes", () => {
  const h = controlHarness({});
  h.api.initLaborerHappinessControl();
  assert.strictEqual(h.general.value, String(GENERAL_TROPHY_HAPPINESS_MAX));
  assert.strictEqual(h.matching.value, String(MATCHING_TROPHY_HAPPINESS_MAX));
  assert.ok(h.note.textContent.includes("150.0%"), "a fully-trophied gatherer is at the cap");
  assert.ok(h.note.textContent.includes("120.0%"), "a fully-trophied crafter is not");
});

test("editing either box persists, re-captions and asks the caller to re-render", () => {
  const h = controlHarness({});
  let renders = 0;
  h.api.initLaborerHappinessControl(() => { renders++; });
  h.general.change("20");
  assert.strictEqual(renders, 1, "the tables must be re-priced on every edit");
  assert.strictEqual(h.api.getLaborerHappinessGeneral(), 20);
  h.matching.change("0");
  assert.strictEqual(renders, 2);
  assert.strictEqual(h.api.getLaborerHappinessMatching(), 0);
  assert.ok(h.note.textContent.includes("110.0%"), h.note.textContent);
});

test("an out-of-range entry is written back clamped, so the box never lies", () => {
  const h = controlHarness({});
  h.api.initLaborerHappinessControl();
  h.matching.change("9999");
  assert.strictEqual(h.matching.value, String(MATCHING_TROPHY_HAPPINESS_MAX));
  h.general.change("-5");
  assert.strictEqual(h.general.value, "0", "a negative entry floors at no trophies");
});

test("clearing a box falls back to its max default", () => {
  const h = controlHarness({ [GEN]: "10", [MATCH]: "10" });
  h.api.initLaborerHappinessControl();
  h.general.change("");
  assert.strictEqual(h.general.value, String(GENERAL_TROPHY_HAPPINESS_MAX));
  assert.strictEqual(h.matching.value, "10", "the other box is untouched");
});

test("the boxes open capped by the house tier, and say so in their max", () => {
  const h = controlHarness({ [HOUSE]: "6", [GEN]: "40", [MATCH]: "70" });
  h.api.initLaborerHappinessControl();
  assert.strictEqual(h.general.max, "25");
  assert.strictEqual(h.matching.max, "50");
  assert.strictEqual(h.general.value, "25", "a stored 40 cannot be placed in a T6 house");
  assert.strictEqual(h.matching.value, "50");
});

test("a box cannot be typed above what the house holds", () => {
  const h = controlHarness({ [HOUSE]: "4" });
  h.api.initLaborerHappinessControl();
  h.matching.change("70");
  assert.strictEqual(h.matching.value, "30", "T2-T4 of its own line is all there is");
});

test("changing the house tier re-paints both boxes", () => {
  // The picker lives in js/house-tier.js and calls back into this refresh; a box
  // still reading 70 under a T6 house would be quoting furniture nobody can place.
  const h = controlHarness({ [GEN]: "40", [MATCH]: "70" });
  h.api.initLaborerHappinessControl();
  assert.strictEqual(h.matching.value, "70");
  h.api.setHouseTier(6);
  h.api.refreshLaborerHappinessControl();
  assert.strictEqual(h.matching.value, "50");
  assert.strictEqual(h.general.value, "25");
  assert.strictEqual(h.matching.max, "50");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
