/**
 * Test: js/data-buildings.js — the generated building-construction catalog.
 *
 * Black-box against the ground truth: everything asserted here is re-read from
 * buildings.xml (the ao-bin-dumps file the generator consumes), so the test
 * fails if the catalog drifts from the dump or if the generator silently drops
 * a family. Nothing about the generator's internals is inspected.
 *
 * Run: node tests/buildings-catalog.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
// Commented-out <skins> blocks reuse building uniquenames (a disabled skin list
// inside T2_FORGE names T3_FORGE), so a raw text search would read the wrong
// element. Strip comments before matching anything.
const XML = fs.readFileSync(path.join(ROOT, "data", "dumps", "buildings.xml"), "utf8")
  .replace(/<!--[\s\S]*?-->/g, "");
// items.xml is the other half of the catalog: the furniture that fills the slots.
const ITEMS_XML = fs.readFileSync(path.join(ROOT, "data", "dumps", "items.xml"), "utf8")
  .replace(/<!--[\s\S]*?-->/g, "");
const ELEMENTS = "craftbuilding|playerbuilding|farmbuilding|hideoutbuilding|repairbuilding|meldbuilding";

const mod = new Module("data-buildings-test");
mod._compile(
  fs.readFileSync(path.join(ROOT, "js/data-buildings.js"), "utf8"),
  "data-buildings.js",
);
const { BUILDINGS, BUILDING_FAMILIES, getBuildingsItemIds,
  BUILDING_LABORER_FURNITURE, getBuildingFurnitureByType } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// ── Ground truth re-read from the dump ─────────────────────────────────────
// Slice one building element out of the XML by uniquename and pull the fields
// the catalog claims to carry.
function xmlBuilding(id) {
  const re = new RegExp(`<(${ELEMENTS})\\s([^>]*?uniquename="${id}"[^>]*?)(/>|>)`);
  const m = XML.match(re);
  if (!m) return null;
  const attrs = m[2];
  let body = "";
  if (m[3] === ">") {
    const start = m.index + m[0].length;
    body = XML.slice(start, XML.indexOf(`</${m[1]}>`, start));
  }
  const attr = (n) => { const a = attrs.match(new RegExp(`${n}="([^"]*)"`)); return a ? a[1] : null; };
  const req = body.match(/<craftingrequirements([^>]*)>([\s\S]*?)<\/craftingrequirements>/);
  const materials = [];
  if (req) {
    const re2 = /<craftresource uniquename="([^"]+)"\s*count="(\d+)"/g;
    let r; while ((r = re2.exec(req[2]))) materials.push({ matId: r[1], count: parseInt(r[2], 10) });
  }
  const reqSilver = req && req[1].match(/silver="(\d+)"/);
  return {
    element: m[1],
    tier: parseInt(attr("tier"), 10),
    placecost: parseInt(attr("placecost") || "0", 10),
    reqSilver: reqSilver ? parseInt(reqSilver[1], 10) : 0,
    furnitureSlots: parseInt(attr("furniturelimit") || "0", 10),
    laborerSlots: parseInt(attr("laborerslimit") || "0", 10),
    upgradeableTo: attr("upgradeableto"),
    materials,
  };
}

const byId = new Map(BUILDINGS.map((b) => [b.id, b]));

// ── Shape ──────────────────────────────────────────────────────────────────
console.log("\n=== Catalog shape ===");

test("every row carries the fields the table renders", () => {
  assert.ok(BUILDINGS.length > 50, `expected a full catalog, got ${BUILDINGS.length}`);
  BUILDINGS.forEach((b) => {
    assert.ok(typeof b.id === "string" && b.id.length > 0, `bad id: ${JSON.stringify(b)}`);
    assert.ok(BUILDING_FAMILIES[b.family], `${b.id}: unknown family "${b.family}"`);
    assert.ok(Number.isInteger(b.tier) && b.tier >= 1 && b.tier <= 8, `${b.id}: bad tier ${b.tier}`);
    assert.ok(Array.isArray(b.materials) && b.materials.length > 0, `${b.id}: no materials`);
    assert.ok(Number.isFinite(b.silverCost) && b.silverCost >= 0, `${b.id}: bad silverCost`);
    assert.ok(Number.isInteger(b.laborerSlots) && b.laborerSlots >= 0, `${b.id}: bad laborerSlots`);
    assert.ok(Number.isInteger(b.furnitureSlots) && b.furnitureSlots >= 0, `${b.id}: bad furnitureSlots`);
  });
});

test("ids are unique", () => {
  assert.strictEqual(byId.size, BUILDINGS.length, "duplicate building ids in the catalog");
});

test("every family has a label and a category the table can group on", () => {
  const cats = new Set(["station", "house", "guildhall", "farm", "hideout"]);
  Object.entries(BUILDING_FAMILIES).forEach(([key, f]) => {
    assert.ok(f.label && f.label.length > 0, `${key}: no label`);
    assert.ok(cats.has(f.category), `${key}: unknown category "${f.category}"`);
  });
});

// ── Faithful to buildings.xml ──────────────────────────────────────────────
console.log("\n=== Faithful to buildings.xml ===");

test("tier, silver and materials round-trip from the dump", () => {
  BUILDINGS.forEach((b) => {
    const x = xmlBuilding(b.id);
    assert.ok(x, `${b.id} is not in buildings.xml`);
    assert.strictEqual(b.tier, x.tier, `${b.id}: tier`);
    assert.strictEqual(b.silverCost, x.placecost + x.reqSilver, `${b.id}: silverCost`);
    assert.deepStrictEqual(b.materials, x.materials, `${b.id}: materials`);
  });
});

test("laborer and furniture slots round-trip from the dump", () => {
  BUILDINGS.forEach((b) => {
    const x = xmlBuilding(b.id);
    assert.strictEqual(b.laborerSlots, x.laborerSlots, `${b.id}: laborerSlots`);
    assert.strictEqual(b.furnitureSlots, x.furnitureSlots, `${b.id}: furnitureSlots`);
  });
});

test("every building in the dump with a real family is in the catalog", () => {
  // Walk every uniquename the dump declares; anything whose family the catalog
  // knows about MUST be present, so a new tier or station cannot be missed.
  const seen = new Set();
  const re = new RegExp(`<(?:${ELEMENTS})\\s[^>]*?uniquename="([^"]+)"`, "g");
  let m;
  while ((m = re.exec(XML))) seen.add(m[1]);
  seen.forEach((id) => {
    const fam = id.replace(/^T\d+_/, "").replace(/^UNIQUE_/, "");
    if (!BUILDING_FAMILIES[fam]) return;          // deliberately out of scope
    assert.ok(byId.has(id), `${id} has known family "${fam}" but is missing from the catalog`);
  });
});

// ── Exclusions ─────────────────────────────────────────────────────────────
console.log("\n=== Exclusions ===");

test("no tutorial, test, NPC-shop or founder-skin building leaks in", () => {
  const banned = /_TUTORIAL|TESTFORGE|^NDA_|^MOB_SETS_|^MISTS_|^HIGHLAND_|LEGENDARY_FOUNDER|^ARENA_|^VANITY_|^FARMING_MERCHANT/;
  BUILDINGS.forEach((b) => assert.ok(!banned.test(b.id), `${b.id} should not be catalogued`));
});

test("the guild hall, houses, kennel, pasture and hideout are all present", () => {
  ["T8_GUILDHALL", "T8_PLAYERHOUSE", "T1_KENNEL", "T1_PASTURE", "T1_HERBGARDEN",
    "T1_FARMHOUSE", "UNIQUE_HIDEOUT", "T8_FORGE", "T8_SMELTER", "T8_MELDBUILDING",
    "T8_REPAIRSHOP"].forEach((id) => {
    assert.ok(byId.has(id), `${id} missing from the catalog`);
  });
});

// ── Slot facts the fitted row depends on ───────────────────────────────────
console.log("\n=== Slot facts ===");

test("only houses and guild halls have laborer/furniture slots", () => {
  BUILDINGS.forEach((b) => {
    const cat = BUILDING_FAMILIES[b.family].category;
    if (cat === "house" || cat === "guildhall") return;
    assert.strictEqual(b.laborerSlots, 0, `${b.id} should have no laborer slots`);
    assert.strictEqual(b.furnitureSlots, 0, `${b.id} should have no furniture slots`);
  });
});

test("slots grow with tier for both houses and guild halls", () => {
  ["PLAYERHOUSE", "GUILDHALL"].forEach((fam) => {
    const rows = BUILDINGS.filter((b) => b.family === fam).sort((a, b) => a.tier - b.tier);
    assert.ok(rows.length >= 7, `${fam}: expected T2–T8, got ${rows.length}`);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].furnitureSlots >= rows[i - 1].furnitureSlots, `${fam}: furniture slots shrank at T${rows[i].tier}`);
      assert.ok(rows[i].laborerSlots >= rows[i - 1].laborerSlots, `${fam}: laborer slots shrank at T${rows[i].tier}`);
    }
    assert.ok(rows[rows.length - 1].laborerSlots > 0, `${fam}: top tier must house laborers`);
  });
});

// ── Scan ids ───────────────────────────────────────────────────────────────
console.log("\n=== Scan ids ===");

test("getBuildingsItemIds covers every construction material", () => {
  const ids = new Set(getBuildingsItemIds());
  BUILDINGS.forEach((b) => b.materials.forEach((m) =>
    assert.ok(ids.has(m.matId), `${m.matId} (${b.id}) is not in the scan id list`)));
});

test("getBuildingsItemIds covers the laborer contracts and furniture the fitted row buys", () => {
  const ids = new Set(getBuildingsItemIds());
  BUILDINGS.filter((b) => b.laborerSlots > 0 || b.furnitureSlots > 0).forEach((b) => {
    if (b.laborerSlots > 0) {
      assert.ok(ids.has(`T${b.tier}_LABOURER_CONTRACT_TOOLMAKER`),
        `no T${b.tier} laborer contract in the scan id list`);
    }
    // The bed and table are pinned to the building's tier (they set base
    // happiness), so exactly those two must be priced.
    if (b.furnitureSlots > 0) {
      ["bed", "table"].forEach((type) => {
        const items = getBuildingFurnitureByType(type, b.tier);
        assert.strictEqual(items.length, 1, `T${b.tier} should have exactly one ${type}`);
        assert.ok(ids.has(items[0].id), `${items[0].id} is not in the scan id list`);
      });
    }
  });
});

test("getBuildingsItemIds covers trophies at EVERY tier, not just the building's", () => {
  // Trophy happiness does not vary with tier, so the plan shops the cheapest
  // tiers freely — a scan that only priced the building's own tier would make
  // "cheapest" mean "the only one we asked about".
  const ids = new Set(getBuildingsItemIds());
  getBuildingFurnitureByType("trophy").forEach((f) =>
    assert.ok(ids.has(f.id), `${f.id} is not in the scan id list`));
});

test("every scan id looks like a real game id", () => {
  getBuildingsItemIds().forEach((id) => {
    assert.ok(/^(T[1-8]|UNIQUE)_[A-Z0-9_]+$/.test(id), `suspicious id: ${id}`);
  });
});

// ── Laborer furniture, faithful to items.xml ───────────────────────────────
console.log("\n=== Laborer furniture ===");

// Pull one <furnitureitem> out of items.xml and read the labourer* attributes
// the furnishing plan is built on.
function xmlFurniture(id) {
  const re = new RegExp(`<furnitureitem\\s([^>]*?uniquename="${id}"[^>]*?)(?:/>|>)`);
  const m = ITEMS_XML.match(re);
  if (!m) return null;
  const attr = (n) => { const a = m[1].match(new RegExp(`${n}="([^"]*)"`)); return a ? a[1] : null; };
  return {
    tier: parseInt(attr("tier"), 10),
    type: attr("labourerfurnituretype"),
    perItem: parseInt(attr("labourersperfurnitureitem") || "0", 10),
    happiness: parseInt(attr("labourerhappiness") || "0", 10),
    affected: attr("labourersaffected") || "all",
  };
}

test("every furniture entry round-trips from items.xml", () => {
  assert.ok(BUILDING_LABORER_FURNITURE.length > 60,
    `expected the full furniture catalog, got ${BUILDING_LABORER_FURNITURE.length}`);
  BUILDING_LABORER_FURNITURE.forEach((f) => {
    const x = xmlFurniture(f.id);
    assert.ok(x, `${f.id} is not in items.xml`);
    assert.strictEqual(f.tier, x.tier, `${f.id}: tier`);
    assert.strictEqual(f.type, x.type, `${f.id}: type`);
    assert.strictEqual(f.perItem, x.perItem, `${f.id}: perItem`);
    assert.strictEqual(f.happiness, x.happiness, `${f.id}: happiness`);
    assert.strictEqual(f.affected, x.affected, `${f.id}: affected`);
  });
});

test("every item items.xml marks as laborer furniture is catalogued", () => {
  // The presence of labourerfurnituretype is the whole filter, so a new line
  // added to the dump has to show up here rather than being silently unbuyable.
  const known = new Set(BUILDING_LABORER_FURNITURE.map((f) => f.id));
  const re = /<furnitureitem\s([^>]*?)(?:\/>|>)/g;
  let m;
  while ((m = re.exec(ITEMS_XML))) {
    if (!/labourerfurnituretype="/.test(m[1])) continue;
    const id = (m[1].match(/uniquename="([^"]+)"/) || [])[1];
    if (!id || !/^T[1-8]_/.test(id)) continue;         // founder vanity: no market
    if (id === "T8_FURNITUREITEM_TROPHY_FISHING_BOSS") continue;  // excluded on purpose
    assert.ok(known.has(id), `${id} is laborer furniture but is missing from the catalog`);
  }
});

test("chests and other decor are NOT laborer furniture", () => {
  // A chest carries no labourer* attributes at all, which is exactly why it
  // cannot fill a laborer slot. The old model treated it as interchangeable
  // with a bed and picked it as the "cheapest furniture".
  const ids = new Set(BUILDING_LABORER_FURNITURE.map((f) => f.id));
  ["T5_FURNITUREITEM_CHEST", "T2_FURNITUREITEM_WARDROBE", "T8_FURNITUREITEM_BATTLEVAULT",
    "T8_FURNITUREITEM_REPAIRKIT"].forEach((id) =>
    assert.ok(!ids.has(id), `${id} must not be able to fill a laborer slot`));
});

test("exactly one bed and one table per tier, T2-T8", () => {
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    assert.strictEqual(getBuildingFurnitureByType("bed", tier).length, 1, `T${tier} bed`);
    assert.strictEqual(getBuildingFurnitureByType("table", tier).length, 1, `T${tier} table`);
  });
});

test("a bed serves 1 laborer and a table 4 below T5, 6 from T5 up", () => {
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    assert.strictEqual(getBuildingFurnitureByType("bed", tier)[0].perItem, 1, `T${tier} bed`);
    assert.strictEqual(getBuildingFurnitureByType("table", tier)[0].perItem,
      tier >= 5 ? 6 : 4, `T${tier} table`);
  });
});

test("bed + table of tier n give the 100n base happiness a tier-n laborer wants", () => {
  [2, 3, 4, 5, 6, 7, 8].forEach((tier) => {
    const base = getBuildingFurnitureByType("bed", tier)[0].happiness
      + getBuildingFurnitureByType("table", tier)[0].happiness;
    assert.strictEqual(base, 100 * tier, `T${tier} base happiness`);
  });
});

test("trophies serve 3 laborers and are worth +10 specialist / +5 general at every tier", () => {
  const trophies = getBuildingFurnitureByType("trophy");
  assert.strictEqual(trophies.length, 56, "8 lines x 7 tiers");
  trophies.forEach((t) => {
    assert.strictEqual(t.perItem, 3, `${t.id}: perItem`);
    const expected = t.affected === "all" ? 5 : 10;
    assert.strictEqual(t.happiness, expected, `${t.id}: happiness`);
  });
});

test("a trophy's affected slug is the LABORER slug, so no mapping table is needed", () => {
  // The app's slug mismatches (Stonecutter STONE -> TROPHY_ROCK, Fisherman
  // FISHING -> TROPHY_FISH) are already resolved by the dump's own attribute.
  const find = (id) => BUILDING_LABORER_FURNITURE.find((f) => f.id === id);
  assert.strictEqual(find("T8_FURNITUREITEM_TROPHY_ROCK").affected, "stone");
  assert.strictEqual(find("T8_FURNITUREITEM_TROPHY_FISH").affected, "fishing");
  assert.strictEqual(find("T8_FURNITUREITEM_TROPHY_WOOD").affected, "wood");
  assert.strictEqual(find("T8_FURNITUREITEM_TROPHY_GENERAL").affected, "all");
});

// ── The upgrade ladder ─────────────────────────────────────────────────────
// The table's cost is the sum of every step from the chain root, so a broken or
// branching `upgradeableTo` would silently under- or over-count a whole family.
console.log("\n=== Upgrade ladder ===");

test("upgradeableTo always names a catalogued building of the next tier up", () => {
  const byId = new Map(BUILDINGS.map((b) => [b.id, b]));
  BUILDINGS.filter((b) => b.upgradeableTo).forEach((b) => {
    const next = byId.get(b.upgradeableTo);
    assert.ok(next, `${b.id} upgrades to ${b.upgradeableTo}, which is not in the catalog`);
    assert.strictEqual(next.family, b.family, `${b.id} upgrades across families`);
    assert.strictEqual(next.tier, b.tier + 1, `${b.id} (T${b.tier}) → ${next.id} (T${next.tier})`);
  });
});

test("no two buildings upgrade into the same one — the ladder never branches", () => {
  const seen = new Map();
  BUILDINGS.filter((b) => b.upgradeableTo).forEach((b) => {
    assert.ok(!seen.has(b.upgradeableTo),
      `${b.id} and ${seen.get(b.upgradeableTo)} both upgrade into ${b.upgradeableTo}`);
    seen.set(b.upgradeableTo, b.id);
  });
});

test("upgradeableTo matches the dump", () => {
  BUILDINGS.forEach((b) => {
    const xml = xmlBuilding(b.id);
    assert.ok(xml, `${b.id} is not in buildings.xml`);
    assert.strictEqual(b.upgradeableTo, xml.upgradeableTo, b.id);
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
