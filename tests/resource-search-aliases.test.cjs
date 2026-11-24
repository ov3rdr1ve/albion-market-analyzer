// Black-box tests for resourceSearchAliases(): the extra hidden search terms
// attached to raw/refined resource rows so a mat is findable by its real
// in-game name (Travertine) and by family synonyms (stone/rock), not only by
// the uniform "<tier> rock" label the tables actually print.
//
// The function takes an explicit namesMap so the test never needs the 24MB
// browser ITEM_NAMES_MAP global; in the app it falls back to that global.

const assert = require("assert");
const { resourceSearchAliases } = require("../js/resource-names.js");

// Minimal synthetic name map — same shape/keys as js/item-names.js.
const NAMES = {
  T4_ROCK: "T4 Travertine",
  T4_STONEBLOCK: "T4 Travertine Block",
  T6_WOOD: "T6 Bloodoak Logs",
  T6_PLANKS: "T6 Bloodoak Planks",
  T4_ORE: "T4 Iron Ore",
  T4_METALBAR: "T4 Steel Bar",
  T5_HIDE: "T5 Robust Hide",
  T5_LEATHER: "T5 Hardened Leather",
  T7_FIBER: "T7 Sunflax",
  T7_CLOTH: "T7 Ornate Cloth",
};

function terms(id) {
  return resourceSearchAliases(id, NAMES).split(/\s+/).filter(Boolean);
}

const cases = [
  // id, must-include search terms
  ["T4_ROCK", ["travertine", "rock", "stone"]],
  ["T4_STONEBLOCK", ["travertine", "block", "stone"]],
  ["T6_WOOD", ["bloodoak", "logs", "wood"]],
  ["T6_PLANKS", ["bloodoak", "planks", "wood"]],
  ["T4_ORE", ["iron", "ore", "metal"]],
  ["T4_METALBAR", ["steel", "bar", "metal"]],
  ["T5_HIDE", ["robust", "hide", "leather"]],
  ["T5_LEATHER", ["hardened", "leather", "hide"]],
  ["T7_FIBER", ["sunflax", "fiber", "cloth"]],
  ["T7_CLOTH", ["ornate", "cloth", "fiber"]],
];

cases.forEach(([id, wanted]) => {
  const got = terms(id);
  wanted.forEach((w) => {
    assert.ok(
      got.includes(w),
      `${id}: expected alias term "${w}" in [${got.join(", ")}]`
    );
  });
});

// Enchanted ids resolve to the same proper name as their plain base (the quality
// word "Rare" etc. is not a useful search term and must not crowd out the name).
["T4_ORE_LEVEL2@2", "T4_ORE@2"].forEach((id) => {
  const got = terms(id);
  assert.ok(got.includes("iron"), `${id}: enchanted ore keeps "iron" → [${got}]`);
  assert.ok(got.includes("ore"), `${id}: enchanted ore keeps "ore" → [${got}]`);
});

// Output is lowercased and free of the "T4 " tier token.
assert.ok(!/t4|T4/.test(resourceSearchAliases("T4_ROCK", NAMES)), "tier token stripped");
assert.strictEqual(
  resourceSearchAliases("T4_ROCK", NAMES),
  resourceSearchAliases("T4_ROCK", NAMES).toLowerCase(),
  "aliases are lowercased"
);

// No duplicate terms.
{
  const got = terms("T4_STONEBLOCK");
  assert.strictEqual(got.length, new Set(got).size, "no duplicate alias terms");
}

// Non-resources and junk → empty string (callers render no span).
["T4_MAIN_SWORD", "T8_2H_NATURESTAFF_KEEPER", "UNIQUE_HIDEOUT", "", null, undefined, 42].forEach(
  (id) => {
    assert.strictEqual(
      resourceSearchAliases(id, NAMES),
      "",
      `non-resource ${String(id)} → ""`
    );
  }
);

// Missing proper name (id is a resource but absent from the map) still yields the
// family synonyms so the row stays findable by "stone"/"rock".
{
  const got = resourceSearchAliases("T2_ROCK", {}).split(/\s+/).filter(Boolean);
  assert.ok(got.includes("stone") && got.includes("rock"), `synonyms survive missing name → [${got}]`);
}

console.log("resource-search-aliases: all assertions passed");
