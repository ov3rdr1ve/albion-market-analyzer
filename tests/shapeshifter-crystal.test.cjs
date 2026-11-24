/**
 * Test: Shapeshifter staves and Crystal weapon recipes are correctly defined.
 * Covers: material counts, craftType, artifact ingredients, tier coverage.
 *
 * Run: node tests/shapeshifter-crystal.test.cjs
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

// ── helpers ────────────────────────────────────────────────────────────
function loadFileContent(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf-8");
}

function extractValue(src, varName) {
  const fn = new Function(`${src}; return ${varName};`);
  return fn();
}

const stavesSrc = loadFileContent("js/gear-staves-c.js");
const GEAR_STAVES_C = extractValue(stavesSrc, "GEAR_STAVES_C");

const crystalSrc = loadFileContent("js/gear-crystal-weapons.js");
const GEAR_CRYSTAL_WEAPONS = extractValue(crystalSrc, "GEAR_CRYSTAL_WEAPONS");
const crystalSrcB = loadFileContent("js/gear-crystal-weapons-b.js");
const GEAR_CRYSTAL_WEAPONS_B = extractValue(crystalSrcB, "GEAR_CRYSTAL_WEAPONS_B");
const ALL_CRYSTAL = [...GEAR_CRYSTAL_WEAPONS, ...GEAR_CRYSTAL_WEAPONS_B];

const artifactSrc = loadFileContent("js/data-artifacts.js");
const ARTIFACT_MAPPING = extractValue(artifactSrc, "ARTIFACT_MAPPING");

// ── test runner ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

console.log("Shapeshifter & Crystal Weapons Tests\n");

// ── Shapeshifter Staves ───────────────────────────────────────────────

const shapeshifterVariants = [
  "SET1", "SET2", "SET3",
  "MORGANA", "HELL", "KEEPER", "AVALON", "CRYSTAL",
];

const artifactVariants = ["MORGANA", "HELL", "KEEPER", "AVALON", "CRYSTAL"];

test("GEAR_STAVES_C has 40 entries (8 variants x 5 tiers)", () => {
  assert.strictEqual(GEAR_STAVES_C.length, 40);
});

test("all Shapeshifter entries have craftType 'shapeshifterstaff'", () => {
  const bad = GEAR_STAVES_C.filter((i) => i.craftType !== "shapeshifterstaff");
  assert.strictEqual(bad.length, 0, `Bad craftType: ${bad.map((i) => i.id)}`);
});

for (const variant of shapeshifterVariants) {
  test(`${variant}: T4-T8 coverage`, () => {
    for (let t = 4; t <= 8; t++) {
      const id = `T${t}_2H_SHAPESHIFTER_${variant}`;
      const item = GEAR_STAVES_C.find((i) => i.id === id);
      assert.ok(item, `Missing ${id}`);
    }
  });
}

// items.xml is authoritative: every base shapeshifter staff also consumes a
// non-returnable "rare creature remains" drop (maxreturnamount=0), tiered by
// weapon tier — T4:T3x2, T5:T5x1, T6:T5x2, T7:T7x1, T8:T7x2. Each weapon line
// maps to its transformation's creature; only Crystal (Stillgaze) has none.
const VARIANT_CREATURE = {
  SET1: "PANTHER", SET2: "ENT", SET3: "DIREBEAR",
  MORGANA: "WEREWOLF", HELL: "IMP", KEEPER: "ELEMENTAL", AVALON: "EAGLE",
  CRYSTAL: null,
};
const DROP_SCHEDULE = {
  4: { tier: 3, count: 2 }, 5: { tier: 5, count: 1 }, 6: { tier: 5, count: 2 },
  7: { tier: 7, count: 1 }, 8: { tier: 7, count: 2 },
};
const tierOf = (id) => parseInt(id.match(/^T(\d)_/)[1], 10);
const variantOf = (id) => shapeshifterVariants.find((v) => id.includes(`_${v}`));
function expectedDrop(id) {
  const creature = VARIANT_CREATURE[variantOf(id)];
  if (!creature) return null;
  const s = DROP_SCHEDULE[tierOf(id)];
  return { matId: `T${s.tier}_ALCHEMY_RARE_${creature}`, count: s.count };
}

test("normal variants (SET1-SET3): 20 PLANKS + 12 LEATHER + tiered creature drop", () => {
  const normals = GEAR_STAVES_C.filter((i) =>
    i.id.includes("_SET1") || i.id.includes("_SET2") || i.id.includes("_SET3")
  );
  assert.strictEqual(normals.length, 15, "expected 3 sets x 5 tiers");
  for (const item of normals) {
    assert.strictEqual(item.materials.length, 3, `${item.id} has ${item.materials.length} materials`);
    const planks = item.materials.find((m) => m.matId.includes("PLANKS"));
    const leather = item.materials.find((m) => m.matId.includes("LEATHER"));
    assert.ok(planks && planks.count === 20, `${item.id} PLANKS`);
    assert.ok(leather && leather.count === 12, `${item.id} LEATHER`);
    assert.ok(!item.materials.some((m) => m.matId.includes("ARTEFACT")), `${item.id} base set should have no artefact`);
    const drop = expectedDrop(item.id);
    const got = item.materials.find((m) => m.matId === drop.matId);
    assert.ok(got, `${item.id} missing creature drop ${drop.matId}`);
    assert.strictEqual(got.count, drop.count, `${item.id} ${drop.matId} count`);
  }
});

test("artifact variants: PLANKS + LEATHER + 1x ARTEFACT + creature drop (Crystal has no drop)", () => {
  const artifacts = GEAR_STAVES_C.filter((i) =>
    artifactVariants.some((v) => i.id.includes(`_${v}`))
  );
  for (const item of artifacts) {
    const variant = variantOf(item.id);
    const drop = expectedDrop(item.id);
    const expectedLen = drop ? 4 : 3; // Crystal (Stillgaze) consumes no creature drop
    assert.strictEqual(item.materials.length, expectedLen, `${item.id} has ${item.materials.length} materials`);
    const artMat = item.materials.find((m) => m.matId.includes("ARTEFACT"));
    assert.ok(artMat, `${item.id} missing ARTEFACT material`);
    assert.strictEqual(artMat.count, 1, `${item.id} ARTEFACT count`);
    assert.strictEqual(artMat.matId, `T${tierOf(item.id)}_ARTEFACT_2H_SHAPESHIFTER_${variant}`, `${item.id} artefact id`);
    if (drop) {
      const got = item.materials.find((m) => m.matId === drop.matId);
      assert.ok(got, `${item.id} missing creature drop ${drop.matId}`);
      assert.strictEqual(got.count, drop.count, `${item.id} ${drop.matId} count`);
    } else {
      assert.ok(!item.materials.some((m) => m.matId.includes("ALCHEMY_RARE")), `${item.id} (Crystal) should have no creature drop`);
    }
  }
});

test("artifact variants have group 'artifact'", () => {
  const artifacts = GEAR_STAVES_C.filter((i) =>
    artifactVariants.some((v) => i.id.includes(`_${v}`))
  );
  for (const item of artifacts) {
    assert.strictEqual(item.group, "artifact", `${item.id} group`);
  }
});

test("normal variants have group 'normal'", () => {
  const normals = GEAR_STAVES_C.filter((i) =>
    i.id.includes("_SET1") || i.id.includes("_SET2") || i.id.includes("_SET3")
  );
  for (const item of normals) {
    assert.strictEqual(item.group, "normal", `${item.id} group`);
  }
});

// ── Crystal Weapons ───────────────────────────────────────────────────

// Crystal artifact weapons use REAL game ids (so the market API can price
// them) and are split across gear-crystal-weapons.js + -b.js. Recipes are
// generated from items.xml and cross-checked vs the wiki. Representative
// spot-checks below; the structural asserts cover all 95.
const crystalSpotChecks = [
  { suffix: "MAIN_SWORD_CRYSTAL",           craftType: "sword",        mats: { METALBAR: 16, LEATHER: 8 } },
  { suffix: "2H_SCYTHE_CRYSTAL",            craftType: "axe",          mats: { PLANKS: 12, METALBAR: 20 } },
  { suffix: "OFF_SHIELD_CRYSTAL",           craftType: "shield",       mats: { PLANKS: 4, METALBAR: 4 } },
  { suffix: "OFF_TOME_CRYSTAL",             craftType: "book",         mats: { CLOTH: 4, LEATHER: 4 } },
  { suffix: "OFF_TORCH_CRYSTAL",            craftType: "torch",        mats: { PLANKS: 4, CLOTH: 4 } },
  { suffix: "2H_DOUBLEBLADEDSTAFF_CRYSTAL", craftType: "quarterstaff", mats: { METALBAR: 12, LEATHER: 20 } },
  { suffix: "2H_HOLYSTAFF_CRYSTAL",         craftType: "holystaff",    mats: { PLANKS: 20, CLOTH: 12 } },
  { suffix: "2H_FROSTSTAFF_CRYSTAL",        craftType: "froststaff",   mats: { PLANKS: 20, METALBAR: 12 } },
  { suffix: "2H_GLAIVE_CRYSTAL",            craftType: "spear",        mats: { PLANKS: 12, METALBAR: 20 } },
  { suffix: "MAIN_FIRESTAFF_CRYSTAL",       craftType: "firestaff",    mats: { PLANKS: 16, METALBAR: 8 } },
];

test("Crystal catalog (A+B) has 95 entries (19 families x 5 tiers)", () => {
  assert.strictEqual(ALL_CRYSTAL.length, 95);
});

test("Crystal weapon ids are all real game ids (no flavor ids)", () => {
  const flavor = ALL_CRYSTAL.filter((i) =>
    /INFINITY|CRYSTALREAPER|UNBREAKABLEWARD|TIMELOCKED|PHANTOMTWINBLADE|BLUEFLAME|EXALTEDSTAFF|ARCTICSTAFF/.test(i.id)
  );
  assert.strictEqual(flavor.length, 0, `Flavor ids present: ${flavor.map((i) => i.id)}`);
});

test("every Crystal weapon: group 'artifact', 2-3 materials, 1x matching artefact", () => {
  for (const item of ALL_CRYSTAL) {
    assert.strictEqual(item.group, "artifact", `${item.id} group`);
    // 2 materials for single-resource weapons (bows = planks + artefact),
    // 3 for everything else (two resources + artefact).
    assert.ok(item.materials.length === 2 || item.materials.length === 3, `${item.id} material count ${item.materials.length}`);
    const arts = item.materials.filter((m) => m.matId.includes("ARTEFACT"));
    assert.strictEqual(arts.length, 1, `${item.id} should have exactly 1 artefact`);
    assert.strictEqual(arts[0].count, 1, `${item.id} artefact count`);
    const expected = item.id.replace(/^(T\d+)_(.+)$/, "$1_ARTEFACT_$2");
    assert.strictEqual(arts[0].matId, expected, `${item.id} artefact id`);
  }
});

test("every Crystal family covers T4-T8", () => {
  const fams = [...new Set(ALL_CRYSTAL.map((i) => i.id.replace(/^T\d+_/, "")))];
  for (const fam of fams) {
    for (let t = 4; t <= 8; t++) {
      assert.ok(ALL_CRYSTAL.find((i) => i.id === `T${t}_${fam}`), `Missing T${t}_${fam}`);
    }
  }
});

for (const sc of crystalSpotChecks) {
  test(`${sc.suffix}: craftType '${sc.craftType}' + recipe`, () => {
    const item = ALL_CRYSTAL.find((i) => i.id === `T4_${sc.suffix}`);
    assert.ok(item, `Missing T4_${sc.suffix}`);
    assert.strictEqual(item.craftType, sc.craftType, `${item.id} craftType`);
    for (const [mat, count] of Object.entries(sc.mats)) {
      const m = item.materials.find((x) => x.matId === `T4_${mat}`);
      assert.ok(m && m.count === count, `${item.id} expected ${count}x T4_${mat}`);
    }
  });
}

// ── Artifact Mapping ──────────────────────────────────────────────────

const shapeshifterArtifacts = [
  { key: "2H_SHAPESHIFTER_MORGANA", tier: "Rune", name: "Werewolf Remnant" },
  { key: "2H_SHAPESHIFTER_HELL", tier: "Soul", name: "Hellfire Imp Remnant" },
  { key: "2H_SHAPESHIFTER_KEEPER", tier: "Relic", name: "Runestone Golem Remnant" },
  { key: "2H_SHAPESHIFTER_AVALON", tier: "Avalonian", name: "Dawnbird Remnant" },
  { key: "2H_SHAPESHIFTER_CRYSTAL", tier: "Crystal", name: "Serpent Crystal" },
];

for (const sa of shapeshifterArtifacts) {
  test(`ARTIFACT_MAPPING has ${sa.key}`, () => {
    assert.ok(ARTIFACT_MAPPING[sa.key], `Missing ${sa.key}`);
  });

  test(`${sa.key}: tier=${sa.tier}, category=Hunter, name=${sa.name}`, () => {
    const entry = ARTIFACT_MAPPING[sa.key];
    assert.strictEqual(entry.tier, sa.tier);
    assert.strictEqual(entry.category, "Hunter");
    assert.strictEqual(entry.subcat, "shapeshifterstaff");
    assert.strictEqual(entry.name, sa.name);
  });
}

test("shapeshifter non-crystal artifacts are dropOnly (not rollable at Artifact Foundry)", () => {
  const dropOnlyKeys = [
    "2H_SHAPESHIFTER_MORGANA",
    "2H_SHAPESHIFTER_HELL",
    "2H_SHAPESHIFTER_KEEPER",
    "2H_SHAPESHIFTER_AVALON",
  ];
  for (const key of dropOnlyKeys) {
    const entry = ARTIFACT_MAPPING[key];
    assert.strictEqual(entry.dropOnly, true, `${key} should be dropOnly`);
  }
  assert.strictEqual(ARTIFACT_MAPPING["2H_SHAPESHIFTER_CRYSTAL"].dropOnly, undefined, "Crystal variant should NOT be dropOnly");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
