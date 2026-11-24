/**
 * Test: Breeding rows render food type, grow time, and offspring chance;
 * baby price cell is editable; rows with no market data still include `item`
 * (so "Show All" reveals them).
 *
 * Run: node --test tests/breeding-metadata-and-row-integrity-nurture.test.cjs
 *
 * Catalogue integrity, getRowKey uniqueness, RRR eligibility, nurture mechanics. Shared setup: tests/helpers/breeding-metadata-and-row-setup.cjs.
 */
const {
  assert, fs, path, getBreedingMeta, isRrrEligible, BREEDING_ITEMS, BREEDING_NURTURE_DATA,
  BREEDING_NURTURE_FOCUS_PER_CYCLE, getRowKey, test, finish,
} = require("./helpers/breeding-metadata-and-row-setup.cjs");

// ── Data integrity: all item IDs must be valid (exist in items.json) ──

test("every BREEDING_ITEMS babyId exists in items.json", () => {
  const itemsJson = fs.readFileSync(path.join(__dirname, "..", "data", "dumps", "items.json"), "utf8");
  const missing = BREEDING_ITEMS.filter((b) => !itemsJson.includes(`"UniqueName": "${b.babyId}"`));
  assert.strictEqual(missing.length, 0, `Missing babyIds: ${missing.map((b) => b.babyId).join(", ")}`);
});

test("every BREEDING_ITEMS grownId exists in items.json", () => {
  const itemsJson = fs.readFileSync(path.join(__dirname, "..", "data", "dumps", "items.json"), "utf8");
  const missing = BREEDING_ITEMS.filter((b) => !itemsJson.includes(`"UniqueName": "${b.grownId}"`));
  assert.strictEqual(missing.length, 0, `Missing grownIds: ${missing.map((b) => b.grownId).join(", ")}`);
});

// ── Ensure all previously-missing mounts are present ──

test("BREEDING_ITEMS includes Swamp Salamander T5", () => {
  assert.ok(BREEDING_ITEMS.some((b) => b.babyId === "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"));
});

test("BREEDING_ITEMS includes Elite Swamp Salamander T8", () => {
  assert.ok(BREEDING_ITEMS.some((b) => b.babyId === "T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY"));
});

test("BREEDING_ITEMS includes Ghostwolf T8", () => {
  assert.ok(BREEDING_ITEMS.some((b) => b.babyId === "T8_FARM_DIREWOLF_BABY"));
});

test("BREEDING_ITEMS includes Giant Stag T6", () => {
  assert.ok(BREEDING_ITEMS.some((b) => b.babyId === "T6_FARM_GIANTSTAG_BABY"));
});

test("BREEDING_ITEMS includes Moose T6", () => {
  assert.ok(BREEDING_ITEMS.some((b) => b.babyId === "T6_FARM_GIANTSTAG_MOOSE_BABY"));
});

test("BREEDING_ITEMS includes all 5 city FW T8 elite mounts", () => {
  const t8Elites = [
    "T8_FARM_DIREBEAR_FW_FORTSTERLING_BABY",
    "T8_FARM_DIREBOAR_FW_LYMHURST_BABY",
    "T8_FARM_GREYWOLF_FW_CAERLEON_BABY",
    "T8_FARM_MOABIRD_FW_BRIDGEWATCH_BABY",
    "T8_FARM_RAM_FW_MARTLOCK_BABY",
  ];
  const missing = t8Elites.filter((id) => !BREEDING_ITEMS.some((b) => b.babyId === id));
  assert.strictEqual(missing.length, 0, `Missing T8 elites: ${missing.join(", ")}`);
});

test("Swiftclaw uses correct COUGAR internal ID", () => {
  const sw = BREEDING_ITEMS.find((b) => b.name === "Swiftclaw [T5]");
  assert.ok(sw);
  assert.strictEqual(sw.babyId, "T5_FARM_COUGAR_BABY");
  assert.strictEqual(sw.grownId, "T5_FARM_COUGAR_GROWN");
});

test("T7 Swamp Dragon uses correct SWAMPDRAGON internal ID (no underscore)", () => {
  const sd = BREEDING_ITEMS.find((b) => b.name === "Swamp Dragon [T7]");
  assert.ok(sd);
  assert.strictEqual(sd.babyId, "T7_FARM_SWAMPDRAGON_BABY");
  assert.strictEqual(sd.grownId, "T7_FARM_SWAMPDRAGON_GROWN");
});

test("no duplicate babyIds in BREEDING_ITEMS", () => {
  const ids = BREEDING_ITEMS.map((b) => b.babyId);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.strictEqual(dup.length, 0, `Duplicate babyIds: ${dup.join(", ")}`);
});

// ── getRowKey for mounts-table: breeding rows must have unique keys so
//    restoreAnchor can find the edited row after re-render (previously all
//    breeding rows shared key "|", causing scroll jumps on price-clear). ──

test("getRowKey distinguishes two different breeding rows in same section", () => {
  const horseRoyal = {
    isBreeding: true,
    item: { babyId: "T5_FARM_HORSE_BABY", grownId: "T5_FARM_HORSE_GROWN", name: "Horse [T5]" },
    section: "royal",
  };
  const salRoyal = {
    isBreeding: true,
    item: { babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY", grownId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_GROWN", name: "Swamp Salamander [T5]" },
    section: "royal",
  };
  const k1 = getRowKey(horseRoyal, "mounts-table");
  const k2 = getRowKey(salRoyal, "mounts-table");
  assert.notStrictEqual(k1, k2);
  assert.ok(k1.includes("T5_FARM_HORSE_BABY"));
  assert.ok(k2.includes("T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY"));
});

test("getRowKey distinguishes the same breeding row across royal vs caerleon sections", () => {
  const base = { isBreeding: true, item: { babyId: "T8_FARM_DIREBEAR_BABY" } };
  const royal = getRowKey({ ...base, section: "royal" }, "mounts-table");
  const caerleon = getRowKey({ ...base, section: "caerleon" }, "mounts-table");
  assert.notStrictEqual(royal, caerleon);
});

test("getRowKey for craft rows still uses item.id + craftCity (regression)", () => {
  const craftRow = {
    isBreeding: false, isCraft: true,
    item: { id: "T8_MOUNT_DIREBEAR", name: "Direbear [T8]" },
    craftCity: "Lymhurst",
  };
  const k = getRowKey(craftRow, "mounts-table");
  assert.strictEqual(k, "T8_MOUNT_DIREBEAR|Lymhurst");
});

test("every breeding row in BREEDING_ITEMS produces a unique rowKey per section", () => {
  const keys = new Set();
  for (const item of BREEDING_ITEMS) {
    for (const section of ["royal", "caerleon"]) {
      const row = { isBreeding: true, item, section };
      const k = getRowKey(row, "mounts-table");
      assert.ok(!keys.has(k), `duplicate rowKey: ${k}`);
      keys.add(k);
    }
  }
  // 2 rows per breeding item
  assert.strictEqual(keys.size, BREEDING_ITEMS.length * 2);
});

test("getRowKey falls back to babyId only when section is undefined (BlackRedZone mode)", () => {
  const row = { isBreeding: true, item: { babyId: "T5_FARM_HORSE_BABY" } };
  const k = getRowKey(row, "mounts-table");
  assert.strictEqual(k, "T5_FARM_HORSE_BABY|");
});

// ── RRR eligibility: only refined station resources get Resource Return Rate.
//    Grown mounts, intermediate mount inputs, GvG tokens, and quest items must
//    be consumed 1:1 (user bug report: Transport Mammoth cost showed 151M
//    because the 260M Tame Mammoth was being RRR-discounted to ~60%). ──

test("isRrrEligible: refined leather/cloth/metalbar/planks all qualify", () => {
  assert.strictEqual(isRrrEligible("T5_LEATHER"), true);
  assert.strictEqual(isRrrEligible("T8_LEATHER"), true);
  assert.strictEqual(isRrrEligible("T6_CLOTH"), true);
  assert.strictEqual(isRrrEligible("T6_METALBAR"), true);
  assert.strictEqual(isRrrEligible("T3_PLANKS"), true);
  assert.strictEqual(isRrrEligible("T7_STONEBLOCK"), true);
});

test("isRrrEligible: grown mounts are NOT eligible (user bug — Tame Mammoth)", () => {
  assert.strictEqual(isRrrEligible("T8_FARM_MAMMOTH_GROWN"), false);
  assert.strictEqual(isRrrEligible("T5_FARM_HORSE_GROWN"), false);
  assert.strictEqual(isRrrEligible("T8_FARM_DIREBEAR_GROWN"), false);
  assert.strictEqual(isRrrEligible("T7_FARM_SWAMPDRAGON_GROWN"), false);
});

test("isRrrEligible: intermediate mount inputs (battle mount recipes) not eligible", () => {
  assert.strictEqual(isRrrEligible("T6_MOUNT_OX"), false);
  assert.strictEqual(isRrrEligible("T7_MOUNT_SWAMPDRAGON"), false);
  assert.strictEqual(isRrrEligible("T8_MOUNT_MAMMOTH_TRANSPORT"), false);
});

test("isRrrEligible: GvG tokens and quest items not eligible", () => {
  assert.strictEqual(isRrrEligible("UNIQUE_GVGTOKEN_GENERIC"), false);
  assert.strictEqual(isRrrEligible("QUESTITEM_TOKEN_AVALON"), false);
});

test("isRrrEligible: Transport Mammoth cost math — Tame Mammoth consumed 1:1", () => {
  // User report: Tame Mammoth @ 260M, Fortified Leather @ 41,495 × 20 pieces,
  // RRR ~43.5% (Lymhurst). Previous bug applied RRR to the Mammoth → 151M.
  // Correct: 1 × 260M + 20 × (1 - 0.435) × 41,495 = 260,468,893 (pre-setup-fee).
  const mammothMat = { matId: "T8_FARM_MAMMOTH_GROWN", count: 1 };
  const leatherMat = { matId: "T8_LEATHER", count: 20 };
  const rrr = 0.435;
  const mammothPrice = 259_999_999;
  const leatherPrice = 41_495;
  const setupFee = 0.025;
  const mammothEff = isRrrEligible(mammothMat.matId) ? mammothMat.count * (1 - rrr) : mammothMat.count;
  const leatherEff = isRrrEligible(leatherMat.matId) ? leatherMat.count * (1 - rrr) : leatherMat.count;
  assert.strictEqual(mammothEff, 1);
  assert.ok(Math.abs(leatherEff - 11.3) < 0.01);
  const cost = (mammothPrice * mammothEff + leatherPrice * leatherEff) * (1 + setupFee);
  // Should be around 267M, NOT 151M.
  assert.ok(cost > 260_000_000, `Expected cost > 260M, got ${Math.round(cost)}`);
  assert.ok(cost < 280_000_000, `Expected cost < 280M, got ${Math.round(cost)}`);
});

// ── Nurture mechanics: focus cost / max cycles / offspring-bonus per cycle.
//    Values come from items.xml activefarmfocuscost / activefarmmaxcycles /
//    activefarmbonus. Every cycle is a flat 1000 focus before mastery
//    reduction; max cycles and bonus scale with tier and type. ──

test("nurture focus per cycle assumes max spec (125 focus/nurture, 1000 base halved 3x)", () => {
  assert.strictEqual(BREEDING_NURTURE_FOCUS_PER_CYCLE, 125);
});

test("every BREEDING_ITEMS babyId has nurture data", () => {
  const missing = BREEDING_ITEMS.filter((b) => !BREEDING_NURTURE_DATA[b.babyId]);
  assert.strictEqual(missing.length, 0, `Missing nurture data: ${missing.map((b) => b.babyId).join(", ")}`);
});

[
  // [babyId, maxCycles, bonusPerCycle, baseOffspring, expectedTotalFocus, expectedMaxOffspringPct]
  // A common animal's total chance is NOT capped at 100 — the surplus is a real
  // chance at a second baby from the same cycle.
  ["T3_FARM_HORSE_BABY", 1, 0.2000, 0.8400, 125, 104.0],   // 84 + 1×20
  ["T4_FARM_HORSE_BABY", 2, 0.1333, 0.7867, 250, 105.33],  // 78.67 + 2×13.33
  ["T8_FARM_HORSE_BABY", 6, 0.0263, 0.8736, 750, 103.14],  // 87.36 + 6×2.63
  ["T3_FARM_CHICKEN_BABY", 1, 0.8000, 0.6000, 125, 140.0], // short-grow: 60 + 80
  ["T8_FARM_COW_BABY", 1, 0.1333, 0.9333, 125, 106.66],    // 93.33 + 13.33
  ["T4_FARM_GIANTSTAG_BABY", 2, 0.175, 0, 250, 35.0],      // rare: base 0, 2×17.5 = 35
  ["T5_FARM_COUGAR_BABY", 3, 0.10, 0, 375, 30.0],
  ["T6_FARM_DIREWOLF_BABY", 4, 0.06, 0, 500, 24.0],
  ["T8_FARM_DIREBEAR_BABY", 6, 0.0250, 0, 750, 15.0],      // matches forum-reported 15% max for T8
  ["T8_FARM_MAMMOTH_BABY", 6, 0.0250, 0, 750, 15.0],
  ["T8_FARM_RABBIT_EASTER_BABY", 1, 0.10, 0, 125, 10.0],
  ["T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY", 3, 0.10, 0, 375, 30.0],
  ["T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY", 6, 0.025, 0, 750, 15.0],
  ["T5_FARM_OWL_FW_BRECILIEN_BABY", 3, 0.10, 0, 375, 30.0],   // Mystic Owl (Brecilien FW T5)
  ["T8_FARM_OWL_FW_BRECILIEN_BABY", 6, 0.025, 0, 750, 15.0],  // Elite Mystic Owl (Brecilien FW T8)
].forEach(([babyId, cycles, bonus, base, totalFocus, maxPct]) => {
  test(`${babyId}: ${cycles} cycles × ${bonus*100}% bonus, total ${totalFocus} focus, max ${maxPct}% offspring`, () => {
    const m = getBreedingMeta({ babyId });
    assert.strictEqual(m.maxNurtures, cycles);
    assert.ok(Math.abs(m.bonusPerNurture - bonus) < 1e-6, `bonus: expected ${bonus}, got ${m.bonusPerNurture}`);
    assert.ok(Math.abs(m.baseOffspringPct / 100 - base) < 1e-4, `base: expected ${base}, got ${m.baseOffspringPct/100}`);
    assert.strictEqual(m.focusPerNurture, 125);
    assert.strictEqual(m.totalNurtureFocus, totalFocus);
    assert.ok(Math.abs(m.maxOffspringPct - maxPct) < 0.05, `maxPct: expected ${maxPct}, got ${m.maxOffspringPct}`);
  });
});

test("max offspring % is NOT capped at 100 — the surplus is a second baby", () => {
  // T3 chicken: 60% base + 80% nurture = 140%. Capping it to 100 threw away
  // half the nurture ladder the breeder was paying focus for, and with it the
  // chance of the second chick the game actually hands back.
  const m = getBreedingMeta({ babyId: "T3_FARM_CHICKEN_BABY" });
  assert.ok(Math.abs(m.maxOffspringPct - 140) < 0.01, `expected 140, got ${m.maxOffspringPct}`);
  assert.ok(Math.abs(m.nurtureGainPct - 80) < 0.01, `expected 80, got ${m.nurtureGainPct}`);
});

test("the nurture gain is always the whole ladder (cycles × bonus)", () => {
  for (const babyId of ["T3_FARM_HORSE_BABY", "T5_FARM_HORSE_BABY", "T8_FARM_COW_BABY", "T8_FARM_DIREBEAR_BABY"]) {
    const m = getBreedingMeta({ babyId });
    const expected = m.maxNurtures * m.bonusPerNurture * 100;
    assert.ok(Math.abs(m.nurtureGainPct - expected) < 1e-6,
      `${babyId}: expected gain ${expected}, got ${m.nurtureGainPct}`);
  }
});

test("rare mount shows full nurture gain (no cap needed when base is 0)", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_DIREBEAR_BABY" });
  assert.strictEqual(m.baseOffspringPct, 0);
  assert.ok(Math.abs(m.nurtureGainPct - m.maxOffspringPct) < 1e-6);
  assert.ok(Math.abs(m.nurtureGainPct - 15) < 0.01);
});

finish();
