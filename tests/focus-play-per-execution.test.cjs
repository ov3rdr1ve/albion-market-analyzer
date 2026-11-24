/**
 * Test: focusPlayCell's `focusPerExecution` option — quoting a play's delta
 * against the focus ONE ROW EXECUTION burns, not one step's charge.
 *
 * Why the option exists. `profitDelta` is defined per one execution of the row
 * (js/focus-play.js) — for the Crafting Planner that is one craft. `focusCost`
 * is what the PLAY's step burns once. For a craft play those are the same
 * number, so the rate `profitDelta / focusCost` is right. For the planner's
 * REFINE play they are not: the delta is the cost removed from the whole craft
 * (every unit of that material the craft eats, times every ladder refine per
 * unit) while `focusCost` is a single refine of a single unit. Dividing one by
 * the other inflated the displayed /focus rate by the refines-per-craft factor,
 * and the "/refine" unit label made a per-craft figure read as a per-refine one.
 *
 * The planner already computes the honest total (_cpFocusPerCraft, the divisor
 * Profit / 10k Focus uses); this option lets the cell use it.
 *
 * Black-box + parameterized: drives focusPlayCell's public API only. The
 * omitted-option cases are the regression guard for the five refine-native
 * tables (Refining/Transports, Consumables, Mounts, Farming, Crafting), whose
 * focusCost IS per execution and whose output must not shift.
 *
 * Run: node tests/focus-play-per-execution.test.cjs
 */

const assert = require("assert");
const { makeFocusPlay, focusPlayCell } = require("../js/focus-play.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const play = (kind, focusCost, profitDelta, extra) =>
  makeFocusPlay({ kind, focusCost, profitDelta, ...(extra || {}) });

console.log("focusPlayCell: focusPerExecution\n");

// ── the rate is re-derived from the per-execution focus ─────────────────────
console.log("=== rate = profitDelta / focusPerExecution ===");

[
  // [label, kind, focusCost (one step), profitDelta, focusPerExecution, rate]
  ["refine play: 8 refines per craft deflates the rate 8x",
    "refine", 100, 4000, 800, "5.0"],
  ["craft play: perExecution equal to focusCost leaves the rate alone",
    "craft", 500, 2500, 500, "5.0"],
  ["fractional per-execution focus is honored",
    "refine", 10, 1000, 400, "2.5"],
  ["negative delta keeps its sign at the new scale",
    "refine", 100, -4000, 800, "-5.0"],
  ["zero delta stays zero at any scale",
    "refine", 100, 0, 800, "0.0"],
].forEach(([label, kind, focusCost, profitDelta, perExec, rate]) => {
  test(label, () => {
    const html = focusPlayCell(play(kind, focusCost, profitDelta), {
      focusPerExecution: perExec,
    });
    assert.ok(html.includes(`>${rate}<`), `expected rate ${rate} in ${html}`);
  });
});

test("the inflated single-step rate is GONE from the cell", () => {
  // 4000/100 = 40.0 was the old (wrong) figure; 4000/800 = 5.0 is the honest one.
  const html = focusPlayCell(play("refine", 100, 4000), { focusPerExecution: 800 });
  assert.ok(html.includes(">5.0<"), html);
  assert.ok(!html.includes(">40.0<"), `stale per-step rate still rendered: ${html}`);
});

test("the delta itself is untouched — only its denominator changes", () => {
  const html = focusPlayCell(play("refine", 100, 4000), { focusPerExecution: 800 });
  assert.ok(html.includes("4,000"), html);
});

// ── the tooltip quotes the focus the row actually burns ─────────────────────
console.log("\n=== the 'focus ea' tooltip follows the same figure ===");

test("tooltip quotes focusPerExecution, not the single step's cost", () => {
  const html = focusPlayCell(play("refine", 100, 4000), { focusPerExecution: 843 });
  assert.ok(html.includes("843"), `per-execution focus missing: ${html}`);
});

test("without the option the tooltip still quotes the play's own focusCost", () => {
  const html = focusPlayCell(play("refine", 1234, 4000));
  assert.ok(html.includes("1,234"), html);
});

// ── the unit label ─────────────────────────────────────────────────────────
console.log("\n=== unit label ===");

test("opts.unit still overrides the kind default alongside focusPerExecution", () => {
  const html = focusPlayCell(play("refine", 100, 4000), {
    unit: "/craft", focusPerExecution: 800,
  });
  assert.ok(html.includes("/craft"), html);
  assert.ok(!html.includes("/refine"), `stale per-refine unit: ${html}`);
});

test("a refine play left alone still reads /refine (refining-native tables)", () => {
  assert.ok(focusPlayCell(play("refine", 100, 400)).includes("/refine"));
});

// ── regression guard: omitting the option changes nothing ───────────────────
console.log("\n=== omitting the option is byte-identical to today ===");

[
  ["craft", 500, 2500],
  ["refine", 320, 400],
  ["nurture", 800, 3000],
  ["saddler", 200, 1500],
  ["water", 100, 0],
  ["chain", 250, -750],
].forEach(([kind, focusCost, profitDelta]) => {
  test(`${kind}: no opts vs empty opts vs undefined focusPerExecution all match`, () => {
    const p = play(kind, focusCost, profitDelta);
    const bare = focusPlayCell(p);
    assert.strictEqual(focusPlayCell(p, {}), bare);
    assert.strictEqual(focusPlayCell(p, { focusPerExecution: undefined }), bare);
    assert.strictEqual(focusPlayCell(p, { focusPerExecution: null }), bare);
  });
});

[
  ["zero is not a divisor — fall back to the play's own rate", 0],
  ["negative is not a divisor either", -100],
].forEach(([label, bad]) => {
  test(label, () => {
    const p = play("refine", 320, 400);
    assert.strictEqual(focusPlayCell(p, { focusPerExecution: bad }), focusPlayCell(p));
  });
});

test("a null play still renders an em dash with the option set", () => {
  assert.ok(focusPlayCell(null, { focusPerExecution: 800 }).includes("—"));
});

test("linkRefine and focusPerExecution compose", () => {
  const html = focusPlayCell(
    play("refine", 100, 4000, { matId: "T8_CLOTH", focusItemId: "T8_CLOTH" }),
    { linkRefine: (id, label) => `<a href="#${id}">${label}</a>`, focusPerExecution: 800 },
  );
  assert.ok(html.includes('<a href="#T8_CLOTH"'), html);
  assert.ok(html.includes(">5.0<"), html);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
