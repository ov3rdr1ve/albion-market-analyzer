/**
 * Test: js/focus-play.js — THE standard every table's "Silver/Focus" and
 * "Best Focus" column is built from.
 *
 * The definition under test:
 *   A focus PLAY is one placement of a focus charge inside a row's pipeline
 *   (the craft itself, one refine step below it, a nurture cycle, a watering…).
 *   Its worth is `profitDelta` — the silver it ADDS to the FINAL PRODUCT's
 *   profit versus running the row without that focus. `silverPerFocus` is that
 *   delta over the focus the play burns.
 *
 *   Best Focus = argmax(profitDelta)  — the end product's profit is the goal.
 *   Silver/Focus = the winning play's silverPerFocus.
 *
 * The key property (and the reason this module exists): ranking is on
 * profitDelta, NOT on the rate. A cheap low-tier step is often the most
 * efficient per focus point while saving almost nothing in absolute silver —
 * the wrong answer when the objective is the finished item's profit. Before
 * this module, Refining ranked by rate, the Planner by delta, and Consumables /
 * Mounts-craft / Farming divided the row's WHOLE profit by its focus cost, so
 * the four tables gave four different answers about the same focus point.
 *
 * Black-box: loads the real module and drives its public API only.
 *
 * Run: node tests/focus-play-standard.test.cjs
 */

const assert = require("assert");
const {
  makeFocusPlay,
  pickBestFocusPlay,
  focusPlayRate,
  focusPlayCell,
  FOCUS_PLAY_UNITS,
} = require("../js/focus-play.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Focus-play standard\n");

// ── makeFocusPlay ───────────────────────────────────────────────────────────
console.log("=== makeFocusPlay ===");

[
  // [label, spec, expected rate or null]
  ["craft play: rate = delta / focusCost",
    { kind: "craft", focusCost: 500, profitDelta: 2500 }, 5],
  ["refine play: fractional rate kept",
    { kind: "refine", focusCost: 320, profitDelta: 400 }, 1.25],
  ["negative delta is KEPT (focus is a bad buy here, not an absent one)",
    { kind: "craft", focusCost: 100, profitDelta: -250 }, -2.5],
  ["zero focus cost → no play (the step cannot take focus in-game)",
    { kind: "craft", focusCost: 0, profitDelta: 9999 }, null],
  ["negative focus cost → no play",
    { kind: "craft", focusCost: -5, profitDelta: 10 }, null],
  ["missing focusCost → no play",
    { kind: "craft", profitDelta: 10 }, null],
  ["zero delta → play exists, rate 0 (focus provably buys nothing)",
    { kind: "craft", focusCost: 200, profitDelta: 0 }, 0],
].forEach(([label, spec, expected]) => {
  test(label, () => {
    const p = makeFocusPlay(spec);
    if (expected === null) { assert.strictEqual(p, null); return; }
    assert.ok(p, "expected a play");
    assert.ok(Math.abs(p.silverPerFocus - expected) < 1e-9,
      `rate ${p.silverPerFocus} != ${expected}`);
    assert.strictEqual(p.kind, spec.kind);
    assert.strictEqual(p.focusCost, spec.focusCost);
    assert.strictEqual(p.profitDelta, spec.profitDelta);
  });
});

test("no kind → no play", () => {
  assert.strictEqual(makeFocusPlay({ focusCost: 10, profitDelta: 10 }), null);
});

test("null / undefined spec → no play", () => {
  assert.strictEqual(makeFocusPlay(null), null);
  assert.strictEqual(makeFocusPlay(undefined), null);
});

test("extra fields are carried through (focusItemId, tier, matId, chain…)", () => {
  const chain = { produces: "T6_PLANKS" };
  const p = makeFocusPlay({
    kind: "refine", focusCost: 100, profitDelta: 1000,
    matId: "T6_PLANKS", focusItemId: "T5_PLANKS", tier: 5, chain,
  });
  assert.strictEqual(p.matId, "T6_PLANKS");
  assert.strictEqual(p.focusItemId, "T5_PLANKS");
  assert.strictEqual(p.tier, 5);
  assert.strictEqual(p.chain, chain);
});

test("focusPlayRate agrees with the play's own silverPerFocus", () => {
  const p = makeFocusPlay({ kind: "craft", focusCost: 250, profitDelta: 1000 });
  assert.strictEqual(focusPlayRate(p), p.silverPerFocus);
  assert.strictEqual(focusPlayRate(null), 0);
});

// ── pickBestFocusPlay ───────────────────────────────────────────────────────
console.log("\n=== pickBestFocusPlay: maximizes the END PRODUCT's profit ===");

const play = (kind, focusCost, profitDelta) => makeFocusPlay({ kind, focusCost, profitDelta });

test("picks the biggest profitDelta even when another play has a better rate", () => {
  // The trap this module exists to avoid: T4 refine is 4x more efficient per
  // focus point yet adds 1/5 of the silver to the finished item.
  const cheapEfficient = play("refine", 100, 800);   // 8.0 /focus
  const dearAbsolute   = play("craft", 2000, 4000);  // 2.0 /focus
  const best = pickBestFocusPlay([cheapEfficient, dearAbsolute]);
  assert.strictEqual(best, dearAbsolute);
  assert.strictEqual(best.silverPerFocus, 2);
});

test("ordering of the candidate list does not change the winner", () => {
  const a = play("refine", 100, 800), b = play("craft", 2000, 4000);
  assert.strictEqual(pickBestFocusPlay([a, b]), pickBestFocusPlay([b, a]));
});

test("exact tie on delta → the play that burns LESS focus wins (focus is scarce)", () => {
  const dear = play("craft", 900, 5000);
  const cheap = play("refine", 300, 5000);
  assert.strictEqual(pickBestFocusPlay([dear, cheap]), cheap);
  assert.strictEqual(pickBestFocusPlay([cheap, dear]), cheap);
});

test("all-negative candidates still return the least-bad play, not null", () => {
  const best = pickBestFocusPlay([play("craft", 100, -900), play("refine", 100, -100)]);
  assert.ok(best);
  assert.strictEqual(best.profitDelta, -100);
});

test("nulls in the list are ignored", () => {
  const good = play("craft", 100, 500);
  assert.strictEqual(pickBestFocusPlay([null, good, undefined]), good);
});

test("empty / null list → null", () => {
  assert.strictEqual(pickBestFocusPlay([]), null);
  assert.strictEqual(pickBestFocusPlay(null), null);
  assert.strictEqual(pickBestFocusPlay([null, null]), null);
});

test("single candidate is the winner", () => {
  const only = play("nurture", 100, 250);
  assert.strictEqual(pickBestFocusPlay([only]), only);
});

// ── the standard is table-agnostic ──────────────────────────────────────────
console.log("\n=== one definition across every table's kinds ===");

[
  ["craft", "/craft"],
  ["refine", "/refine"],
  ["nurture", "/cycle"],
  ["saddler", "/craft"],
  ["water", "/cycle"],
  ["chain", "/craft"],
].forEach(([kind, unit]) => {
  test(`kind "${kind}" is a first-class play with unit "${unit}"`, () => {
    const p = play(kind, 400, 1200);
    assert.ok(p, `${kind} must produce a play`);
    assert.strictEqual(p.silverPerFocus, 3);
    assert.strictEqual(FOCUS_PLAY_UNITS[kind], unit);
  });
});

test("kinds compete against each other on delta alone (mounts: nurture vs saddler)", () => {
  const nurture = play("nurture", 800, 3000);   // 3.75 /focus
  const saddler = play("saddler", 200, 1500);   // 7.50 /focus
  assert.strictEqual(pickBestFocusPlay([nurture, saddler]), nurture);
});

// ── focusPlayCell ──────────────────────────────────────────────────────────
console.log("\n=== focusPlayCell rendering ===");

test("null play renders an em dash, never a 0", () => {
  const html = focusPlayCell(null);
  assert.ok(html.includes("—"), html);
  assert.ok(!/\b0\.0\b/.test(html), html);
});

test("cell leads with WHAT to focus, then +delta, then the rate", () => {
  const html = focusPlayCell(play("craft", 500, 2500));
  const iLabel = html.indexOf("Craft");
  const iDelta = html.indexOf("2,500");
  const iRate = html.indexOf("5.0");
  assert.ok(iLabel >= 0 && iDelta > iLabel && iRate > iDelta,
    `order wrong: label ${iLabel}, delta ${iDelta}, rate ${iRate} in ${html}`);
});

test("refine play names the step it wants focused", () => {
  const html = focusPlayCell(makeFocusPlay({
    kind: "refine", focusCost: 100, profitDelta: 400,
    matId: "T6_PLANKS", focusItemId: "T5_PLANKS", tier: 5,
  }));
  assert.ok(/Refine/.test(html), html);
  assert.ok(html.includes("T5_PLANKS"), html);
});

test("negative rate renders in the negative class, positive in the profit class", () => {
  assert.ok(focusPlayCell(play("craft", 100, -500)).includes("profit-negative"));
  assert.ok(focusPlayCell(play("craft", 100, 500)).includes("profit-low"));
});

test("a play worth exactly nothing says so, rather than hiding the figure", () => {
  // "This step can take focus and it buys you nothing" must read differently from
  // the em dash a missing play renders.
  const html = focusPlayCell(play("water", 100, 0));
  assert.ok(/Water/.test(html), html);
  assert.ok(/\b0\b/.test(html), `the zero should be visible: ${html}`);
  assert.ok(!html.includes("—"), html);
});

test("a negative delta is shown with its sign, not swallowed", () => {
  const html = focusPlayCell(play("craft", 100, -500));
  assert.ok(html.includes("-500"), html);
});

test("unit label follows the kind (a nurture play is /cycle, not /craft)", () => {
  assert.ok(focusPlayCell(play("nurture", 100, 500)).includes("/cycle"));
  assert.ok(focusPlayCell(play("craft", 100, 500)).includes("/craft"));
});

test("opts.unit overrides the kind default (refining rows sell per refine)", () => {
  assert.ok(focusPlayCell(play("craft", 100, 500), { unit: "/batch" }).includes("/batch"));
});

test("opts.linkRefine wraps the label of a refine play only", () => {
  const link = (id, label) => `<a href="#${id}">${label}</a>`;
  const refineHtml = focusPlayCell(
    makeFocusPlay({ kind: "refine", focusCost: 100, profitDelta: 400, matId: "T6_PLANKS", focusItemId: "T6_PLANKS" }),
    { linkRefine: link },
  );
  assert.ok(refineHtml.includes('<a href="#T6_PLANKS"'), refineHtml);
  const craftHtml = focusPlayCell(play("craft", 100, 400), { linkRefine: link });
  assert.ok(!craftHtml.includes("<a href"), craftHtml);
});

test("a refine won at a tier BELOW the material notes the ladder it sits in", () => {
  const html = focusPlayCell(makeFocusPlay({
    kind: "refine", focusCost: 100, profitDelta: 400,
    matId: "T8_PLANKS", focusItemId: "T5_PLANKS", tier: 5,
  }));
  assert.ok(html.includes("T8_PLANKS"), "ladder note should name the material: " + html);
  assert.ok(html.includes("T5_PLANKS"), "label should name the step: " + html);
});

test("focus cost per play is exposed in the cell's tooltip", () => {
  const html = focusPlayCell(play("craft", 1234, 500));
  assert.ok(html.includes("1,234"), html);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
