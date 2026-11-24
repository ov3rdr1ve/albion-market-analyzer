// Crystallized-token substitution for the artifact material slot of a gear craft.
//
// Black-box: feeds material ids in, checks which sourcing candidates come back.
// The game truth (verified against ao-bin-dumps items.xml): a craftable artifact
// gear item carries TWO craftingrequirements blocks per enchant level with
// identical base resources and identical focus — one consuming the artifact
// material, one consuming T{tier}_ARTEFACT_TOKEN_FAVOR_{1..4}.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const ctx = vm.createContext({ console });
for (const f of ["js/data-artifacts.js", "js/gear-token-substitute.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx);
}
const getArtifactTokenId = vm.runInContext("getArtifactTokenId", ctx);
const getCraftMatCandidates = vm.runInContext("getCraftMatCandidates", ctx);
const ARTIFACT_MAPPING = vm.runInContext("ARTIFACT_MAPPING", ctx);

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}\n    expected ${e}\n    actual   ${a}`);
  }
}

// ── token class per artifact rarity tier ────────────────────────────────────
console.log("token id by artifact rarity tier");
[
  ["T4_ARTEFACT_OFF_TOWERSHIELD_UNDEAD", "T4_ARTEFACT_TOKEN_FAVOR_1"], // Rune
  ["T5_ARTEFACT_OFF_SHIELD_HELL", "T5_ARTEFACT_TOKEN_FAVOR_2"], // Soul
  ["T6_ARTEFACT_OFF_SPIKEDSHIELD_MORGANA", "T6_ARTEFACT_TOKEN_FAVOR_3"], // Relic
  ["T7_ARTEFACT_OFF_SHIELD_AVALON", "T7_ARTEFACT_TOKEN_FAVOR_4"], // Avalonian
  ["T8_ARTEFACT_OFF_LAMP_UNDEAD", "T8_ARTEFACT_TOKEN_FAVOR_3"], // faction != rarity
  ["T4_ARTEFACT_OFF_ORB_MORGANA", "T4_ARTEFACT_TOKEN_FAVOR_1"], // faction != rarity
].forEach(([matId, tokenId]) => check(matId, getArtifactTokenId(matId), tokenId));

// ── no token path exists for these ──────────────────────────────────────────
console.log("\nartifacts with no token recipe in items.xml");
[
  "T4_ARTEFACT_2H_ARCANESTAFF_CRYSTAL", // Crystal rarity — shards only
  "T8_ARTEFACT_MAIN_SWORD_CRYSTAL",
  "T4_ARTEFACT_2H_SHAPESHIFTER_MORGANA",
  "T6_ARTEFACT_2H_SHAPESHIFTER_AVALON",
  "T4_ARTEFACT_HEAD_CLOTH_FEY",
  "T8_ARTEFACT_SHOES_PLATE_FEY",
].forEach((matId) => check(matId, getArtifactTokenId(matId), null));

console.log("\nnon-artifact materials never substitute");
[
  "T4_PLANKS",
  "T8_METALBAR_LEVEL2@2",
  "T5_SHARD_CRYSTAL",
  "T4_RUNE",
  "T6_LEATHER",
  "",
  null,
  undefined,
].forEach((matId) => check(String(matId), getArtifactTokenId(matId), null));

console.log("\nmalformed / unknown ids");
[
  "T9_ARTEFACT_OFF_TOWERSHIELD_UNDEAD", // tier out of range
  "T3_ARTEFACT_OFF_TOWERSHIELD_UNDEAD", // artifacts start at T4
  "T4_ARTEFACT_NOT_A_REAL_SUFFIX",
  "T4_ARTEFACT_",
  "ARTEFACT_OFF_TOWERSHIELD_UNDEAD",
].forEach((matId) => check(String(matId), getArtifactTokenId(matId), null));

// ── sourcing candidates ─────────────────────────────────────────────────────
console.log("\ncraft material sourcing candidates");
check(
  "artifact mat offers both artifact and token",
  getCraftMatCandidates("T4_ARTEFACT_OFF_TOWERSHIELD_UNDEAD"),
  ["T4_ARTEFACT_OFF_TOWERSHIELD_UNDEAD", "T4_ARTEFACT_TOKEN_FAVOR_1"],
);
check(
  "crystal artifact offers itself only",
  getCraftMatCandidates("T4_ARTEFACT_2H_ARCANESTAFF_CRYSTAL"),
  ["T4_ARTEFACT_2H_ARCANESTAFF_CRYSTAL"],
);

// ── expiring "decay" twins ──────────────────────────────────────────────────
// Three Crystal lines ship a time-limited twin (decayitem= points back at the
// plain artifact, decayondatetime= is when it stops working). It fills the same
// craft slot, so the craft buys whichever of the two is cheaper.
console.log("\ndecay twins as an alternate artifact input");
[
  ["T4_ARTEFACT_2H_BOW_CRYSTAL", "T4_ARTEFACT_2H_BOW_CRYSTAL_DECAY"],
  ["T8_ARTEFACT_2H_KNUCKLES_CRYSTAL", "T8_ARTEFACT_2H_KNUCKLES_CRYSTAL_DECAY"],
  ["T6_ARTEFACT_MAIN_CURSEDSTAFF_CRYSTAL", "T6_ARTEFACT_MAIN_CURSEDSTAFF_CRYSTAL_DECAY"],
].forEach(([artifact, decay]) => {
  check(`${artifact} also offers its decay twin`, getCraftMatCandidates(artifact), [artifact, decay]);
});
check(
  "a Crystal line without a decay twin is unaffected",
  getCraftMatCandidates("T8_ARTEFACT_2H_HAMMER_CRYSTAL"),
  ["T8_ARTEFACT_2H_HAMMER_CRYSTAL"],
);
check("the decay twin is not itself re-substituted", getCraftMatCandidates("T4_ARTEFACT_2H_BOW_CRYSTAL_DECAY"), [
  "T4_ARTEFACT_2H_BOW_CRYSTAL_DECAY",
]);
check(
  "fey artifact offers itself only",
  getCraftMatCandidates("T7_ARTEFACT_ARMOR_LEATHER_FEY"),
  ["T7_ARTEFACT_ARMOR_LEATHER_FEY"],
);
check("plank offers itself only", getCraftMatCandidates("T4_PLANKS"), ["T4_PLANKS"]);
check("token itself is not re-substituted", getCraftMatCandidates("T4_ARTEFACT_TOKEN_FAVOR_1"), [
  "T4_ARTEFACT_TOKEN_FAVOR_1",
]);

// ── coverage: 112 of 128 non-Crystal artifacts have a token path ────────────
console.log("\ncoverage vs ARTIFACT_MAPPING");
const nonCrystal = Object.entries(ARTIFACT_MAPPING).filter(([, i]) => i.tier !== "Crystal");
const withToken = nonCrystal.filter(([s]) => getArtifactTokenId(`T4_ARTEFACT_${s}`) !== null);
check("non-Crystal artifacts", nonCrystal.length, 128);
check("of those, token-craftable", withToken.length, 112);
check(
  // 4 shapeshifter + 9 fey + 3 Dragonhide. The Dragonhide artifacts joined the
  // list with Dragonfire (2026-08-31): their gear has a single
  // craftingrequirements block, so no Crystallized token can replace them.
  "excluded count (shapeshifter + fey + dragonhide)",
  nonCrystal.length - withToken.length,
  16,
);
check(
  "every Crystal artifact excluded",
  Object.entries(ARTIFACT_MAPPING)
    .filter(([, i]) => i.tier === "Crystal")
    .every(([s]) => getArtifactTokenId(`T4_ARTEFACT_${s}`) === null),
  true,
);
check(
  "token id tier always tracks the artifact tier",
  [4, 5, 6, 7, 8].every((t) =>
    getArtifactTokenId(`T${t}_ARTEFACT_OFF_TOWERSHIELD_UNDEAD`) === `T${t}_ARTEFACT_TOKEN_FAVOR_1`,
  ),
  true,
);

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
