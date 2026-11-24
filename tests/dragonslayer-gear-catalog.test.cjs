/**
 * Test: Dragonslayer leather armor and its Dragonhide artifacts (Dragonfire,
 * 2026-08-31).
 *
 * Fifteen gear recipes — Hood / Jacket / Shoes at T4–T8 — each 8 or 16 leather
 * of its own tier plus one matching T{n}_ARTEFACT_*_LEATHER_DRAGON. The
 * artifacts are melded from a brand-new fragment family, Fire Dragon Scales
 * (T{n}_SHARD_FIRE_DRAGON), and unlike Rune / Soul / Relic / Avalonian
 * artifacts they have NO Crystallized-token substitute: items.xml gives the
 * dragon gear a single craftingrequirements block, so a token path would be
 * invented. getArtifactTokenId() must therefore return null for all fifteen.
 *
 * Black-box: reads the real gear catalog, artifact mapping, token-substitute
 * module and focus table, cross-checked against items.xml. No live API or DB.
 *
 * Run: node tests/dragonslayer-gear-catalog.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

function load(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

const TIERS = [4, 5, 6, 7, 8];
const TIER_WORD = { 4: "Adept's", 5: "Expert's", 6: "Master's", 7: "Grandmaster's", 8: "Elder's" };

const SLOTS = [
  { seg: "HEAD",  craftType: "leather_helmet", leather: 8,  piece: "Dragonslayer Hood",
    artifact: "Dragonhide Crown", focus: { 4: 429, 5: 750, 6: 1313, 7: 2298, 8: 4021 } },
  { seg: "ARMOR", craftType: "leather_armor",  leather: 16, piece: "Dragonslayer Jacket",
    artifact: "Dragonhide Padding", focus: { 4: 858, 5: 1501, 6: 2626, 7: 4596, 8: 8042 } },
  { seg: "SHOES", craftType: "leather_shoes",  leather: 8,  piece: "Dragonslayer Shoes",
    artifact: "Dragonhide Trim", focus: { 4: 429, 5: 750, 6: 1313, 7: 2298, 8: 4021 } },
];

const CASES = SLOTS.flatMap((s) =>
  TIERS.map((t) => ({
    ...s,
    tier: t,
    id: "T" + t + "_" + s.seg + "_LEATHER_DRAGON",
    artefactId: "T" + t + "_ARTEFACT_" + s.seg + "_LEATHER_DRAGON",
    leatherId: "T" + t + "_LEATHER",
    shardId: "T" + t + "_SHARD_FIRE_DRAGON",
    suffix: s.seg + "_LEATHER_DRAGON",
  }))
);

const mod = new Module("dragonslayer-test");
mod._compile(
  load("js/gear-leather-armor.js") +
    load("js/gear-leather-dragon.js") +
    load("js/data-artifacts.js") +
    load("js/gear-token-substitute.js") +
    "\nmodule.exports = { GEAR_LEATHER_ARMOR, GEAR_LEATHER_DRAGON, ARTIFACT_MAPPING, getArtifactTokenId, ARTIFACT_NO_TOKEN_PATH };",
  "dragonslayer-test.js"
);
const {
  GEAR_LEATHER_DRAGON,
  ARTIFACT_MAPPING,
  getArtifactTokenId,
} = mod.exports;

// The aggregator is a separate module and needs every gear-*.js in scope; the
// catalog test covers that. Here we only need the dragon list plus proof that
// js/gear.js actually spreads it.
const GEAR_JS = load("js/gear.js");
const ITEMS_XML = load("data/dumps/items.xml");
const FOCUS_COSTS = require("../js/focus-costs.json");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
}

const byId = new Map(GEAR_LEATHER_DRAGON.map((g) => [g.id, g]));

console.log("\n=== Fifteen recipes, and nothing else, in the dragon list ===");
test("GEAR_LEATHER_DRAGON holds exactly 15 entries", () => {
  assert.strictEqual(GEAR_LEATHER_DRAGON.length, 15);
});
test("every entry is a T4–T8 *_LEATHER_DRAGON id", () => {
  for (const g of GEAR_LEATHER_DRAGON) {
    assert.ok(/^T[4-8]_(HEAD|ARMOR|SHOES)_LEATHER_DRAGON$/.test(g.id), "bad id " + g.id);
  }
});
test("js/gear.js spreads the dragon list into GEAR_RECIPES_ALL", () => {
  assert.ok(GEAR_JS.includes("...GEAR_LEATHER_DRAGON"),
    "GEAR_LEATHER_DRAGON is not aggregated — the rows would never render");
});

console.log("\n=== Each recipe matches items.xml ===");
for (const c of CASES) {
  test(c.id + " exists in items.xml", () => {
    assert.ok(ITEMS_XML.includes('uniquename="' + c.id + '"'), c.id + " is not a real id");
  });
  test(c.id + " = " + c.leather + " leather + 1 artifact", () => {
    const g = byId.get(c.id);
    assert.ok(g, c.id + " missing from GEAR_LEATHER_DRAGON");
    assert.deepStrictEqual(
      g.materials.map((m) => [m.matId, m.count]),
      [[c.leatherId, c.leather], [c.artefactId, 1]]
    );
  });
  test(c.id + " is craftType " + c.craftType + ", group artifact", () => {
    const g = byId.get(c.id);
    assert.strictEqual(g.craftType, c.craftType);
    assert.strictEqual(g.group, "artifact");
  });
  test(c.id + " renders as \"" + TIER_WORD[c.tier] + " " + c.piece + " [T" + c.tier + "]\"", () => {
    const g = byId.get(c.id);
    assert.strictEqual(g.name, TIER_WORD[c.tier] + " " + c.piece + " [T" + c.tier + "]");
  });
  test(c.id + " base focus = " + c.focus[c.tier], () => {
    assert.strictEqual(FOCUS_COSTS[c.id], c.focus[c.tier],
      c.id + " focus mismatch (got " + FOCUS_COSTS[c.id] + ")");
  });
}

console.log("\n=== The Dragonhide artifacts and their Fire Dragon Scales ===");
for (const slot of SLOTS) {
  const suffix = slot.seg + "_LEATHER_DRAGON";
  test(suffix + " is mapped as a Dragon-fragment Hunter artifact", () => {
    const info = ARTIFACT_MAPPING[suffix];
    assert.ok(info, suffix + " missing from ARTIFACT_MAPPING");
    assert.strictEqual(info.tier, "Dragon");
    assert.strictEqual(info.category, "Hunter");
    assert.strictEqual(info.subcat, slot.craftType);
    assert.strictEqual(info.name, slot.artifact);
    assert.ok(!info.dropOnly, "Fire Dragon Scales buy the artifact, so not dropOnly");
  });
}
test("Dragon is the only new fragment family and only Hunter leather uses it", () => {
  const dragon = Object.entries(ARTIFACT_MAPPING).filter(([, v]) => v.tier === "Dragon");
  assert.strictEqual(dragon.length, 3, "expected exactly 3 Dragon artifacts");
  for (const [, v] of dragon) assert.strictEqual(v.category, "Hunter");
});
for (const c of CASES) {
  test(c.artefactId + " is bought with 50 " + c.shardId, () => {
    const block = ITEMS_XML.match(
      new RegExp('<simpleitem uniquename="' + c.artefactId + '"[\\s\\S]*?</simpleitem>')
    );
    assert.ok(block, c.artefactId + " is not in items.xml");
    assert.ok(
      block[0].includes('uniquename="' + c.shardId + '"') && block[0].includes('count="50"'),
      c.artefactId + " should cost 50 " + c.shardId
    );
  });
}

console.log("\n=== No Crystallized-token path for dragon gear ===");
for (const c of CASES) {
  test(c.artefactId + " has no token substitute", () => {
    assert.strictEqual(getArtifactTokenId(c.artefactId), null,
      c.artefactId + " must not offer a Crystallized token");
  });
}
test("items.xml really gives dragon gear a single craft block", () => {
  for (const c of CASES) {
    const block = ITEMS_XML.match(
      new RegExp('<equipmentitem uniquename="' + c.id + '"[\\s\\S]*?</equipmentitem>')
    );
    const base = block[0].split("<enchantments>")[0];
    const blocks = base.match(/<craftingrequirements/g) || [];
    assert.strictEqual(blocks.length, 1,
      c.id + " has " + blocks.length + " craft blocks — a token path may exist after all");
  }
});

console.log("\n" + "=".repeat(50));
console.log("Total: " + (passed + failed) + " | Passed: " + passed + " | Failed: " + failed);
if (failed > 0) process.exit(1);
