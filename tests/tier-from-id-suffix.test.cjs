/**
 * Test: getTierFromId (js/utils.js) reads a TRAILING _T<n> tier suffix.
 *
 * The Royal Sigils are the only tradeable family in items.xml whose id carries
 * its tier at the END (QUESTITEM_TOKEN_ROYAL_T4 … _T8) instead of the usual
 * "T4_" prefix. They fell through to the tier-4 fallback, so all five tokens
 * reported tier 4 — the Flipping table printed five rows all labelled
 * "Royal Sigil [T4]" (the reported duplicate-row bug), each actually a
 * different token with its own prices.
 *
 * Black-box: the real getTierFromId is lifted out of js/utils.js (with the
 * UNTIERED_ITEM_TIERS table it reads) and driven by a parameter table. No DOM,
 * no market data.
 *
 * Run: node tests/tier-from-id-suffix.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf-8")).join("\n");
const start = src.indexOf("const UNTIERED_ITEM_TIERS");
const fnStart = src.indexOf("function getTierFromId", start);
const fnEnd = src.indexOf("\n}", fnStart);
assert.ok(start >= 0 && fnStart > start && fnEnd > fnStart, "could not slice getTierFromId out of js/utils.js");
const getTierFromId = new Function(
  src.slice(start, fnEnd + 2) + "\nreturn getTierFromId;",
)();

const CASES = [
  // [id, expected tier, why]
  ["T4_SWORD", 4, "plain prefix"],
  ["T8_BAG", 8, "plain prefix"],
  ["T6_2H_BOW@3", 6, "prefix wins over the enchant suffix"],
  ["T4_LEATHER_LEVEL2@2", 4, "refined resource variant"],
  ["QUESTITEM_TOKEN_ROYAL_T4", 4, "royal sigil suffix"],
  ["QUESTITEM_TOKEN_ROYAL_T5", 5, "royal sigil suffix"],
  ["QUESTITEM_TOKEN_ROYAL_T6", 6, "royal sigil suffix"],
  ["QUESTITEM_TOKEN_ROYAL_T7", 7, "royal sigil suffix"],
  ["QUESTITEM_TOKEN_ROYAL_T8", 8, "royal sigil suffix"],
  ["QUESTITEM_TOKEN_ROYAL_T8@1", 8, "suffix survives an enchant marker"],
  ["UNIQUE_GVGTOKEN_GENERIC", 1, "untiered table still wins"],
  ["QUESTITEM_TOKEN_AVALON", 6, "untiered table still wins"],
  ["QUESTITEM_TOKEN_ROYAL_HORSE", 4, "no tier anywhere -> fallback"],
  ["UNIQUE_HIDEOUT", 4, "no tier anywhere -> fallback"],
  ["", 4, "empty id -> fallback"],
  [null, 4, "null id -> fallback"],
];

let failures = 0;
for (const [id, expected, why] of CASES) {
  const got = getTierFromId(id);
  if (got === expected) {
    console.log(`  PASS  ${JSON.stringify(id)} -> T${got}  (${why})`);
  } else {
    failures++;
    console.log(`  FAIL  ${JSON.stringify(id)} -> T${got}, expected T${expected}  (${why})`);
  }
}

// The five sigils must be five DISTINCT tiers — that is what stops the Flipping
// table from printing five rows with the same "[T4]" label.
const sigilTiers = [4, 5, 6, 7, 8].map((n) => getTierFromId(`QUESTITEM_TOKEN_ROYAL_T${n}`));
if (new Set(sigilTiers).size === 5) {
  console.log("  PASS  the five Royal Sigils carry five distinct tiers");
} else {
  failures++;
  console.log(`  FAIL  Royal Sigil tiers collapsed: ${sigilTiers.join(",")}`);
}

console.log(failures === 0 ? "\nAll tier-from-id-suffix tests passed" : `\n${failures} test(s) failed`);
process.exit(failures === 0 ? 0 : 1);
