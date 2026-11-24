/**
 * Test: js/item-index.js names the wire ids the live game sends.
 *
 * Reported 2026-09-11: the shipped index was the 2026-07-21 ao-bin-dumps
 * items.txt, and the 09-03 patch had shifted 12,049 of its 12,071 ids. The
 * pairs below are not read off the dump alone — each was confirmed by a real
 * capture on 2026-09-11, where the request's number and the item named by the
 * orders in its own response agreed only under the refreshed index.
 *
 * When a future patch moves them again, regenerate the index
 * (node scripts/gen-item-index.cjs) and re-confirm these against a capture.
 *
 * Run: node tests/item-index-live-ids.test.cjs
 */

const assert = require("assert");
const { albionItemIdFromIndex } = require("../js/item-index.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// [wire id, item the game's orders named, what the stale index said]
[
  [3067, "T8_MOUNT_DRAKE_FIRE", "UNIQUE_MOUNT_BASTION_CRYSTAL"],
  [1629, "T8_ARTEFACT_OFF_SHIELD_CRYSTAL", "T6_ARTEFACT_OFF_SHIELD_HELL"],
  [4693, "T6_ARMOR_LEATHER_DRAGON", "T6_HEAD_CLOTH_SET2"],
  [24, "T8_FARM_DRAKE_GROWN", "T4_FARM_OX_BABY"],
].forEach(([wire, want, stale]) => {
  test(`wire ${wire} is ${want}, not ${stale}`, () => {
    assert.strictEqual(albionItemIdFromIndex(wire), want);
  });
});

test("an enchanted variant has its own wire id", () => {
  assert.strictEqual(albionItemIdFromIndex(4696), "T6_ARMOR_LEATHER_DRAGON@3");
});

[null, undefined, "abc", 0, 99999999].forEach((bad) => {
  test(`an unreadable or unknown id (${String(bad)}) names nothing`, () => {
    assert.strictEqual(albionItemIdFromIndex(bad), null);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
