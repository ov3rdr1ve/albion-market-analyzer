/**
 * Test: render-buildings — the Building Costs table's row math and markup.
 *
 * Black-box: feed synthetic market data through the real renderer, capture the
 * rows it hands to renderTableData, and assert the cost arithmetic and the cell
 * text. Loads the REAL js/data-buildings.js catalog so the shapes under test are
 * the ones the app ships.
 *
 * Run: node tests/buildings-render.test.cjs
 */

const assert = require("assert");
const { renderBuildingsTable, buildBuildingRow, captured, BUILDINGS, BUILDING_FAMILIES,
  getBuildingFurnitureByType, BUILDING_CONTRACT_SLUGS, 
  getBuildingUpgradePath, rollupUpgradeMaterials,
  __setGold, __setOverrides, __setLaborer, __setCityForce,
  laborerSelectOptionCount, __restoredLaborer, __lsStore, BUILDINGS_LABORER_KEY,
  __fireLaborerChange, __hasDelegatedChangeHandler, 
  _bldContract } = require("./helpers/buildings-render-harness.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    __setGold(5000); __setOverrides({}); __setLaborer(""); __setCityForce({});
    fn(); console.log(`  PASS: ${name}`); passed++;
  }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const FS_CITY = "Fort Sterling";
const MART = "Martlock";

const house = BUILDINGS.find((b) => b.id === "T8_PLAYERHOUSE");
const hall = BUILDINGS.find((b) => b.id === "T8_GUILDHALL");
const forge = BUILDINGS.find((b) => b.id === "T8_FORGE");

// The whole upgrade ladder's bill — what the row actually prices, since a T8 is
// reached by paying every step, not by placing it.
const billFor = (b) => rollupUpgradeMaterials(getBuildingUpgradePath(b.id));
const unitsFor = (b) => billFor(b).reduce((s, m) => s + m.count, 0);

// Price every material a building needs at `price` in Fort Sterling, plus the
// laborer contracts and the furniture its furnishing plan buys.
function marketFor(b, price = 100, extra = {}) {
  const md = {};
  billFor(b).forEach((m) => { md[m.matId] = { [FS_CITY]: { buy_price: price } }; });
  if (b.laborerSlots > 0) {
    BUILDING_CONTRACT_SLUGS.forEach((s, i) => {
      md[`T${b.tier}_LABOURER_CONTRACT_${s}`] = { [FS_CITY]: { buy_price: 10000 + i * 1000 } };
    });
  }
  if (b.furnitureSlots > 0) {
    // The bed and table are pinned to the building's tier; trophies are shopped
    // at every tier, so all of them need a price or the plan runs short of slots
    // to fill and the happiness assertions stop meaning anything.
    getBuildingFurnitureByType("bed", b.tier).forEach((f) => {
      md[f.id] = { [FS_CITY]: { buy_price: 450000 } };
    });
    getBuildingFurnitureByType("table", b.tier).forEach((f) => {
      md[f.id] = { [FS_CITY]: { buy_price: 380000 } };
    });
    getBuildingFurnitureByType("trophy").forEach((f) => {
      md[f.id] = { [FS_CITY]: { buy_price: 5000 } };
    });
  }
  return { ...md, ...extra };
}

// One building's row, with the whole catalog priced. Named for the half of the
// row it is about: the laborers + furniture the building is fitted out with.
function fittedFor(b, price = 100, extra = {}) {
  return buildBuildingRow(b, marketFor(b, price, extra), { laborerSlug: "" });
}

// ── The shell half of the row ──────────────────────────────────────────────
console.log("\n=== Shell cost ===");

test("build cost = every upgrade step's fee + its materials at the cheapest city", () => {
  const shell = buildBuildingRow(forge, marketFor(forge, 100));
  const steps = getBuildingUpgradePath(forge.id);
  const units = unitsFor(forge);
  assert.strictEqual(shell.materialCost, units * 100);
  assert.strictEqual(shell.silverFee, steps.length * forge.silverCost);
  assert.strictEqual(shell.buildCost, units * 100 + steps.length * forge.silverCost);
  assert.strictEqual(shell.totalCost, shell.buildCost);
  assert.ok(shell.hasData);
});

test("each material is priced at the CHEAPEST city, not the first", () => {
  const md = marketFor(forge, 900);
  const first = billFor(forge)[0].matId;
  md[first] = { [FS_CITY]: { buy_price: 900 }, [MART]: { buy_price: 100 } };
  const shell = buildBuildingRow(forge, md);
  const line = shell.materials.find((l) => l.matId === first);
  assert.strictEqual(line.price, 100);
  assert.strictEqual(line.city, MART);
});

// ── The cost is the whole upgrade ladder ───────────────────────────────────
console.log("\n=== Cumulative upgrade path ===");

test("a T8 costs every step, not just its own", () => {
  // You cannot place a T8 building: the reported bug was pricing one step as if
  // you could. An Elder's House wants 3,810 Rough Logs in total, not 1,920.
  const shell = buildBuildingRow(house, marketFor(house, 100));
  const own = house.materials.reduce((s, m) => s + m.count, 0);
  assert.strictEqual(shell.materialCost, unitsFor(house) * 100);
  assert.ok(shell.materialCost > own * 100,
    `cumulative ${shell.materialCost} must exceed the single step ${own * 100}`);
  const logs = shell.materials.find((l) => l.matId === "T1_WOOD");
  assert.strictEqual(logs.count, 3810, "the wiki's cumulative Rough Logs total");
});

test("the materials cell lists every tier's blocks, each editable", () => {
  renderBuildingsTable(marketFor(house, 100));
  const idx = captured.rows.findIndex((r) => r.building.id === "T8_PLAYERHOUSE");
  const html = captured.html[idx];
  for (let t = 2; t <= 8; t++) {
    assert.ok(new RegExp(`180x T${t}_STONEBLOCK`).test(html), `T${t} blocks missing: ` + html);
    assert.ok(new RegExp(`data-item-id="T${t}_STONEBLOCK"`).test(html), `T${t} not editable`);
  }
});

test("the silver fee is charged once per step", () => {
  const shell = buildBuildingRow(house, marketFor(house, 100));
  assert.strictEqual(shell.silverFee, 7 * house.silverCost, "T2→T8 is seven placements");
});

test("a single-tier building is unchanged — its path is itself", () => {
  const farm = BUILDINGS.find((b) => b.id === "T1_FARMHOUSE");
  const shell = buildBuildingRow(farm, marketFor(farm, 100));
  assert.strictEqual(shell.silverFee, farm.silverCost);
  assert.strictEqual(shell.materialCost,
    farm.materials.reduce((s, m) => s + m.count, 0) * 100);
  assert.strictEqual(shell.pathSteps.length, 1);
});

test("the Total tooltip spells the ladder out step by step", () => {
  renderBuildingsTable(marketFor(house, 100));
  const idx = captured.rows.findIndex((r) => r.building.id === "T8_PLAYERHOUSE");
  const html = captured.html[idx];
  assert.ok(/Every upgrade step from scratch/.test(html), "no breakdown tooltip: " + html);
  for (let t = 2; t <= 8; t++) {
    assert.ok(new RegExp(`T${t} [0-9,]+`).test(html), `step T${t} missing from the tooltip`);
  }
});

test("the step costs in the tooltip sum to the build cost", () => {
  const shell = buildBuildingRow(house, marketFor(house, 100));
  const sum = shell.pathSteps.reduce((s, x) => s + x.cost, 0);
  assert.ok(Math.abs(sum - shell.buildCost) < 1e-6, `${sum} vs ${shell.buildCost}`);
});

// ── Override pinning ───────────────────────────────────────────────────────
console.log("\n=== Override pinning ===");

test("an override ABOVE market keeps its city instead of sliding to another", () => {
  // The reported bug: raise a price and the row silently re-prices at the
  // next-cheapest city, so the typed number and its ⚡ vanish.
  const contract = `T${house.tier}_LABOURER_CONTRACT_WOOD`;
  const md = marketFor(house, 100);
  md[contract] = { [FS_CITY]: { buy_price: 10000 }, [MART]: { buy_price: 20000 } };
  __setOverrides({ [`${contract}:${MART}`]: 999999 });
  __setCityForce({ [`${contract}:buy`]: MART });
  const fitted = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  assert.strictEqual(fitted.laborers.city, MART, "the forced city must hold");
  assert.strictEqual(fitted.laborers.price, 999999, "the typed price must hold");
  assert.strictEqual(fitted.laborers.cost, 999999 * house.laborerSlots);
});

test("a raised override on a material also holds its city", () => {
  const mat = billFor(house)[0].matId;
  const md = marketFor(house, 100);
  md[mat] = { [FS_CITY]: { buy_price: 100 }, [MART]: { buy_price: 150 } };
  __setOverrides({ [`${mat}:${MART}`]: 5000 });
  __setCityForce({ [`${mat}:buy`]: MART });
  const line = buildBuildingRow(house, md, {}).materials.find((l) => l.matId === mat);
  assert.strictEqual(line.city, MART);
  assert.strictEqual(line.price, 5000);
});

test("a force with no override behind it still pins the city", () => {
  // findBestBuyCity honours the picker even when it only names a city.
  const mat = billFor(house)[0].matId;
  const md = marketFor(house, 100);
  md[mat] = { [FS_CITY]: { buy_price: 100 }, [MART]: { buy_price: 150 } };
  __setCityForce({ [`${mat}:buy`]: MART });
  const line = buildBuildingRow(house, md, {}).materials.find((l) => l.matId === mat);
  assert.strictEqual(line.city, MART);
  assert.strictEqual(line.price, 150);
});

test("a manual override wins over the scanned price", () => {
  const first = forge.materials[0].matId;
  __setOverrides({ [`${first}:${MART}`]: 1 });
  const shell = buildBuildingRow(forge, marketFor(forge, 900));
  const line = shell.materials.find((l) => l.matId === first);
  assert.strictEqual(line.price, 1);
  assert.strictEqual(line.city, MART);
  assert.ok(shell.hasOverride, "the row must flag the override for the filter");
});

test("an overridden contract keeps its line instead of electing the runner-up", () => {
  // "Cheapest contract" mode used to take the plain minimum over all 11 lines,
  // so raising the winner's price just promoted the next one and the number the
  // user typed left the table. An edit is a statement about which line you buy.
  const md = {};
  BUILDING_CONTRACT_SLUGS.forEach((s, i) => {
    md[`T8_LABOURER_CONTRACT_${s}`] = { [FS_CITY]: { buy_price: 10000 + i * 1000 } };
  });
  __setOverrides({ [`T8_LABOURER_CONTRACT_WOOD:${MART}`]: 4000000 });
  __setCityForce({ [`T8_LABOURER_CONTRACT_WOOD:buy`]: MART });
  const picked = _bldContract(md, 8, "");
  assert.strictEqual(picked.id, "T8_LABOURER_CONTRACT_WOOD");
  assert.strictEqual(picked.price, 4000000);
  assert.strictEqual(picked.city, MART);
  assert.strictEqual(picked.slug, "WOOD");
});

test("a city force alone also pins the contract line", () => {
  const md = {};
  BUILDING_CONTRACT_SLUGS.forEach((s, i) => {
    md[`T8_LABOURER_CONTRACT_${s}`] = {
      [FS_CITY]: { buy_price: 10000 + i * 1000 },
      [MART]: { buy_price: 90000 + i * 1000 },
    };
  });
  __setCityForce({ [`T8_LABOURER_CONTRACT_MERCENARY:buy`]: MART });
  const picked = _bldContract(md, 8, "");
  assert.strictEqual(picked.id, "T8_LABOURER_CONTRACT_MERCENARY");
  assert.strictEqual(picked.city, MART);
});

test("with several lines pinned the cheapest of THEM wins", () => {
  const md = {};
  BUILDING_CONTRACT_SLUGS.forEach((s, i) => {
    md[`T8_LABOURER_CONTRACT_${s}`] = { [FS_CITY]: { buy_price: 10000 + i * 1000 } };
  });
  __setOverrides({
    [`T8_LABOURER_CONTRACT_WOOD:${MART}`]: 5000,
    [`T8_LABOURER_CONTRACT_STONE:${MART}`]: 3000,
  });
  const picked = _bldContract(md, 8, "");
  assert.strictEqual(picked.id, "T8_LABOURER_CONTRACT_STONE");
  assert.strictEqual(picked.price, 3000);
});

test("with nothing pinned the cheapest line still wins", () => {
  const md = {};
  BUILDING_CONTRACT_SLUGS.forEach((s, i) => {
    md[`T8_LABOURER_CONTRACT_${s}`] = { [FS_CITY]: { buy_price: 10000 - i } };
  });
  const picked = _bldContract(md, 8, "");
  const last = BUILDING_CONTRACT_SLUGS[BUILDING_CONTRACT_SLUGS.length - 1];
  assert.strictEqual(picked.id, `T8_LABOURER_CONTRACT_${last}`);
});

test("an unpriced material leaves the row without data", () => {
  const md = marketFor(forge, 100);
  delete md[forge.materials[0].matId];
  const shell = buildBuildingRow(forge, md);
  assert.strictEqual(shell.hasData, false);
});

// ── Global Discount ────────────────────────────────────────────────────────
console.log("\n=== Global Discount ===");

test("the silver fee follows the gold price; materials do not", () => {
  const full = buildBuildingRow(forge, marketFor(forge, 100));
  __setGold(2500);                                 // factor 0.5
  const half = buildBuildingRow(forge, marketFor(forge, 100));
  assert.strictEqual(half.silverFee, full.silverFee / 2);
  assert.strictEqual(half.materialCost, full.materialCost, "market prices are not a silver sink");
  assert.strictEqual(half.totalCost, full.totalCost - full.silverFee / 2);
});

test("the hideout's recipe silver is discounted too — it is the big fee", () => {
  const hideout = BUILDINGS.find((b) => b.id === "UNIQUE_HIDEOUT");
  assert.ok(hideout.silverCost >= 7000000, "the hideout charges recipe silver, not just placement");
  const full = buildBuildingRow(hideout, marketFor(hideout, 100));
  __setGold(0);
  const none = buildBuildingRow(hideout, marketFor(hideout, 100));
  assert.strictEqual(full.silverFee, hideout.silverCost);
  assert.strictEqual(none.silverFee, 0);
});

// ── The fitting half of the row (laborers & furniture) ─────────────────────
console.log("\n=== Fitting (laborers & furniture) ===");

test("a building with slots carries a fitting; one without carries none", () => {
  const withSlots = buildBuildingRow(house, marketFor(house));
  assert.ok(withSlots.laborers, "a house hires laborers");
  assert.ok(withSlots.plan, "…and furnishes its slots");
  const noSlots = buildBuildingRow(forge, marketFor(forge));
  assert.strictEqual(noSlots.laborers, null);
  assert.strictEqual(noSlots.plan, null);
  assert.strictEqual(noSlots.totalCost, noSlots.buildCost, "no slots = the shell IS the total");
});

test("total cost = shell + every laborer slot + the whole furnishing plan", () => {
  const row = buildBuildingRow(house, marketFor(house, 100), { laborerSlug: "" });
  assert.strictEqual(row.laborers.count, house.laborerSlots);
  const expected = row.buildCost
    + row.laborers.price * house.laborerSlots
    + row.plan.furnitureCost;
  assert.ok(Math.abs(row.totalCost - expected) < 1e-9,
    `total ${row.totalCost} vs ${expected}`);
  assert.ok(row.totalCost > row.buildCost, "fitting a house costs more than its shell");
});

test("the laborer slot is filled with the CHEAPEST contract line by default", () => {
  const md = marketFor(house, 100);
  md[`T${house.tier}_LABOURER_CONTRACT_MERCENARY`] = { [FS_CITY]: { buy_price: 7 } };
  const fitted = buildBuildingRow(house, md, { laborerSlug: "" });
  assert.strictEqual(fitted.laborers.price, 7);
  assert.strictEqual(fitted.laborers.id, `T${house.tier}_LABOURER_CONTRACT_MERCENARY`);
});

// ── The furnishing plan replaces "cheapest single furniture" ────────────────

test("furniture is a PLAN, not one item multiplied by the slot count", () => {
  // The reported bug: a 15-laborer guild hall rendered "70x <cheapest item>".
  const fitted = fittedFor(hall);
  assert.strictEqual(fitted.plan.beds.count, hall.laborerSlots, "one bed per laborer");
  assert.strictEqual(fitted.plan.tables.count, 3, "ceil(15/6) tables");
  assert.ok(fitted.plan.trophies.length > 1, "the leftover slots hold several trophies");
  const counts = [fitted.plan.beds.count, fitted.plan.tables.count,
    ...fitted.plan.trophies.map((t) => t.copies)];
  assert.ok(Math.max(...counts) < hall.furnitureSlots,
    `no single item may fill all ${hall.furnitureSlots} slots`);
});

test("a bed is bought per laborer even though it is the dearest furniture", () => {
  // Beds cost ~450k against a trophy's 5k, so the old cheapest-of-any-line
  // model dodged them entirely. They are mandatory: one laborer, one bed.
  const fitted = fittedFor(house);
  assert.strictEqual(fitted.plan.beds.id, `T${house.tier}_FURNITUREITEM_BED`);
  assert.strictEqual(fitted.plan.beds.count, house.laborerSlots);
  assert.strictEqual(fitted.plan.beds.price, 450000);
});

test("the plan never exceeds the building's furniture limit", () => {
  BUILDINGS.filter((b) => b.furnitureSlots > 0).forEach((b) => {
    const fitted = fittedFor(b);
    assert.ok(fitted.plan.slotsUsed <= b.furnitureSlots,
      `${b.id}: ${fitted.plan.slotsUsed} of ${b.furnitureSlots} slots`);
  });
});

test("the trophy line follows the chosen laborer", () => {
  const md = marketFor(house, 100);
  const wood = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  assert.ok(wood.plan.trophies.some((t) => t.id.endsWith("_TROPHY_WOOD")));
  assert.ok(!wood.plan.trophies.some((t) => t.id.endsWith("_TROPHY_FISH")));
  // Stonecutter's laborer slug is STONE but its trophy item is TROPHY_ROCK.
  const stone = buildBuildingRow(house, md, { laborerSlug: "STONE" });
  assert.ok(stone.plan.trophies.some((t) => t.id.endsWith("_TROPHY_ROCK")));
});

test("picking a laborer pins the contract to that line, cheap or not", () => {
  const md = marketFor(house, 100);
  md[`T${house.tier}_LABOURER_CONTRACT_MERCENARY`] = { [FS_CITY]: { buy_price: 7 } };
  const fitted = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  assert.strictEqual(fitted.laborers.id, `T${house.tier}_LABOURER_CONTRACT_WOOD`,
    "the picked line must win over the cheapest one");
  assert.notStrictEqual(fitted.laborers.price, 7);
});

test("with no laborer picked the trophies still follow whichever contract won", () => {
  // A Wood contract with Fish trophies would help nobody.
  const md = marketFor(house, 100);
  md[`T${house.tier}_LABOURER_CONTRACT_FISHERMAN`] = { [FS_CITY]: { buy_price: 7 } };
  const fitted = buildBuildingRow(house, md, { laborerSlug: "" });
  assert.strictEqual(fitted.laborers.id, `T${house.tier}_LABOURER_CONTRACT_FISHERMAN`);
  assert.ok(fitted.plan.trophies.some((t) => t.id.endsWith("_TROPHY_FISH")),
    "the Fisherman's trophies are the Fish ones");
});

test("an unpriced trophy leaves the row whole — trophies are optional", () => {
  const md = marketFor(house, 100);
  getBuildingFurnitureByType("trophy").forEach((f) => { delete md[f.id]; });
  const fitted = buildBuildingRow(house, md, {});
  assert.strictEqual(fitted.hasData, true, "trophies are optional, not required");
  assert.deepStrictEqual(fitted.missing, [], "an optional part is not a gap");
  assert.strictEqual(fitted.plan.trophies.length, 0);
  assert.strictEqual(fitted.trophyCost, 0);
});

// ── Partly-priced rows ─────────────────────────────────────────────────────
// Laborer contracts and top-tier furniture are thin markets. Demanding every
// part be priced blanked the whole row, and since the fitting is the ONLY half
// the laborer picker drives, picking a laborer whose contract had no listing
// looked like the picker did nothing. The gaps are listed instead.
console.log("\n=== Partly-priced rows ===");

test("an unpriced contract keeps the row and names the gap", () => {
  const md = marketFor(house, 100);
  BUILDING_CONTRACT_SLUGS.forEach((s) => { delete md[`T${house.tier}_LABOURER_CONTRACT_${s}`]; });
  const row = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  assert.strictEqual(row.hasData, true, "an unpriced contract must not blank the row");
  assert.deepStrictEqual(row.missing, ["contract"]);
  assert.strictEqual(row.laborers.price, 0);
  assert.strictEqual(row.laborers.cost, 0, "an unpriced part adds nothing");
  assert.strictEqual(row.totalCost, row.buildCost + row.furnitureCost);
});

test("an unpriced BED keeps the row and names the gap", () => {
  const md = marketFor(house, 100);
  delete md[`T${house.tier}_FURNITUREITEM_BED`];
  const fitted = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  assert.strictEqual(fitted.hasData, true);
  assert.deepStrictEqual(fitted.missing, ["beds"]);
  assert.strictEqual(fitted.plan.beds.price, 0);
});

test("a fully priced row reports no gaps", () => {
  const fitted = fittedFor(house);
  assert.deepStrictEqual(fitted.missing, []);
});

test("both gaps are listed when contract AND beds are unpriced", () => {
  const md = marketFor(house, 100);
  BUILDING_CONTRACT_SLUGS.forEach((s) => { delete md[`T${house.tier}_LABOURER_CONTRACT_${s}`]; });
  delete md[`T${house.tier}_FURNITUREITEM_BED`];
  const fitted = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  assert.deepStrictEqual(fitted.missing, ["contract", "beds"]);
});

test("the Total carries the ⚠ flag and the tooltip names what is missing", () => {
  const md = marketFor(house, 100);
  BUILDING_CONTRACT_SLUGS.forEach((s) => { delete md[`T${house.tier}_LABOURER_CONTRACT_${s}`]; });
  const fitted = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  const html = captured.fmt(fitted, 0);
  assert.ok(/⚠/.test(html), "expected the partial marker on the total: " + html);
  assert.ok(/laborer contract unpriced/.test(html), "…and the part named: " + html);
  // The unpriced contract is still click-to-edit, so the gap can be filled in.
  assert.ok(/class="price-editable[^"]*"[^>]*data-item-id="T8_LABOURER_CONTRACT_WOOD"/.test(html),
    "the missing price must stay editable: " + html);
});

test("a fully priced row carries no ⚠", () => {
  const html = captured.fmt(fittedFor(house), 0);
  assert.ok(!/⚠/.test(html), "nothing is missing here: " + html);
});

test("furniture that cannot physically fit costs nothing but keeps the row", () => {
  // A rules failure, not a price hole. With the fitting on the building's own row
  // there is no shell row left to survive beside it, so blanking would hide the
  // construction cost too — which IS known and IS what the user came to read.
  const tiny = { ...house, furnitureSlots: 1, laborerSlots: 5 };
  const row = buildBuildingRow(tiny, marketFor(house, 100), { laborerSlug: "WOOD" });
  assert.strictEqual(row.plan.bedsAndTablesFit, false);
  assert.strictEqual(row.hasData, true, "the shell is priced, so the row still reads");
  assert.strictEqual(row.furnitureCost, 0, "an unfurnishable plan buys nothing");
  assert.strictEqual(row.totalCost, row.buildCost + row.laborers.cost);
  const html = captured.fmt(row, 0);
  assert.ok(/cannot hold one bed per laborer/.test(html),
    "the furniture cell must still say why: " + html);
});

test("trophyCost is reported separately so an optional trophy bill can be subtracted", () => {
  const fitted = fittedFor(house);
  const expected = fitted.plan.trophies.reduce((s, t) => s + t.price * t.copies, 0);
  assert.strictEqual(fitted.trophyCost, expected);
  assert.ok(fitted.trophyCost > 0);
  assert.strictEqual(fitted.furnitureCost, fitted.plan.furnitureCost);
});

// ── Markup ─────────────────────────────────────────────────────────────────
console.log("\n=== Markup ===");

test("the table renders exactly one row per building", () => {
  const md = {};
  BUILDINGS.forEach((b) => Object.assign(md, marketFor(b, 100)));
  renderBuildingsTable(md);
  assert.strictEqual(captured.tableId, "buildings-table");
  assert.strictEqual(captured.rows.length, BUILDINGS.length,
    "the laborers & furniture half is columns on the building's own row, not a second row");
  assert.ok(!captured.html.some((h) => h.startsWith("ERR:")),
    "formatter threw: " + captured.html.find((h) => h.startsWith("ERR:")));
});

test("no row is an indented continuation of another", () => {
  const html = captured.html.join("\n");
  assert.ok(!/↳/.test(html), "the '+ laborers & furniture' row is gone");
  assert.ok(!/as above/.test(html), "every row prints its own bill of materials");
});

test("each rendered row's key is unique", () => {
  const keys = captured.html.map((h) => (h.match(/data-row-key="([^"]*)"/) || [])[1]);
  assert.ok(keys.every(Boolean), "every row must carry a data-row-key");
  assert.strictEqual(new Set(keys).size, keys.length, "duplicate row keys");
});

test("material prices are click-to-edit, like every other table", () => {
  const html = captured.html.join("\n");
  assert.ok(/class="price-editable[^"]*"[^>]*data-item-id="T8_STONEBLOCK"/.test(html),
    "expected an editable price span for a construction material");
});

test("an overridden material line shows the ⚡ pin marker", () => {
  // The material lines used to hand-roll their span and so dropped the ⚡ and the
  // gold colour: an accepted override read as discarded even though the number
  // and the Total had both moved.
  const mat = billFor(house)[0].matId;
  __setOverrides({ [`${mat}:${MART}`]: 5000 });
  __setCityForce({ [`${mat}:buy`]: MART });   // what the price editor writes
  const shell = buildBuildingRow(house, marketFor(house, 100), {});
  const html = captured.fmt(shell, 0);
  assert.ok(/⚡/.test(html), "expected the override marker on the material line: " + html);
  assert.ok(new RegExp(`data-item-id="${mat}"`).test(html), "…on the edited material: " + html);
});

test("a material line with no override shows no ⚡", () => {
  const shell = buildBuildingRow(house, marketFor(house, 100), {});
  assert.ok(!/⚡/.test(captured.fmt(shell, 0)));
});

test("the laborer contract price is click-to-edit", () => {
  // It is one of the two biggest numbers on the row and used to be plain text.
  const idx = captured.rows.findIndex((r) => r.building.id === "T8_GUILDHALL");
  const html = captured.html[idx];
  assert.ok(/class="price-editable[^"]*"[^>]*data-item-id="T8_LABOURER_CONTRACT_[A-Z]+"/.test(html),
    "expected an editable contract price: " + html);
});

test("the bed and table prices are click-to-edit", () => {
  const idx = captured.rows.findIndex((r) => r.building.id === "T8_GUILDHALL");
  const html = captured.html[idx];
  ["T8_FURNITUREITEM_BED", "T8_FURNITUREITEM_TABLE"].forEach((id) =>
    assert.ok(new RegExp(`class="price-editable[^"]*"[^>]*data-item-id="${id}"`).test(html),
      `expected an editable price for ${id}: ` + html));
});

test("an override on a furniture price flags the row for the override filter", () => {
  __setOverrides({ [`T8_FURNITUREITEM_BED:${MART}`]: 1 });
  const fitted = buildBuildingRow(house, marketFor(house, 100), {});
  assert.ok(fitted.hasOverride, "a bed override must mark the row");
  __setOverrides({ [`T8_LABOURER_CONTRACT_WOOD:${MART}`]: 1 });
  const fitted2 = buildBuildingRow(house, marketFor(house, 100), { laborerSlug: "WOOD" });
  assert.ok(fitted2.hasOverride, "a contract override must mark the row");
});

test("the furniture cell names the plan and scores the trophy happiness", () => {
  const idx = captured.rows.findIndex((r) => r.building.id === "T8_PLAYERHOUSE");
  const html = captured.html[idx];
  assert.ok(/3x T8_FURNITUREITEM_BED/.test(html), "expected 3 beds for 3 laborers: " + html);
  assert.ok(/1x T8_FURNITUREITEM_TABLE/.test(html), "expected 1 table: " + html);
  assert.ok(/\+85\/100/.test(html), "expected the 85/100 trophy happiness score: " + html);
});

test("no cell renders one furniture item 70 times any more", () => {
  const html = captured.html.join("\n");
  assert.ok(!/\b70x T\d_FURNITUREITEM/.test(html), "a 70-of-one-item cell is back");
});

test("a guild hall reports the slots its plan could not fill", () => {
  const idx = captured.rows.findIndex((r) => r.building.id === "T8_GUILDHALL");
  assert.ok(/2 slots spare/.test(captured.html[idx]),
    "15 beds + 3 tables + 50 trophies leaves 2 of 70 slots: " + captured.html[idx]);
});

test("the Best Journal cell reads as no-data until the journals are priced", () => {
  // The buildings scan deliberately does not fetch journal ids.
  const idx = captured.rows.findIndex((r) => r.laborers);
  assert.ok(/—/.test(captured.html[idx]), "expected an em dash: " + captured.html[idx]);
  assert.strictEqual(captured.rows[idx].bestJournal, null);
});

test("a lower-tier best journal tags the trophies optional with their subtotal", () => {
  // T7 journal in a T8 house: tier advantage alone caps the yield at 150%, so
  // the trophy half of the plan is not needed to reach it.
  const fitted = buildBuildingRow(house, marketFor(house, 100), {
    laborerSlug: "WOOD",
    bestJournalFor: (slug, tier) =>
      (slug === "WOOD" && tier === 8 ? { journalTier: 7, yield: 1.5, profit: 1 } : null),
  });
  const html = captured.fmt(fitted, 0);
  assert.ok(/T7/.test(html), "the journal cell names the winning tier: " + html);
  assert.ok(/@150\.0%/.test(html), "…and its yield: " + html);
  assert.ok(/▲/.test(html), "…and flags that it beats the laborer's own tier: " + html);
  assert.ok(/optional −/.test(html), "the trophies are tagged optional: " + html);
  assert.ok(html.includes(`optional −${fitted.trophyCost.toLocaleString()}`),
    "…with the trophy subtotal so it can be subtracted: " + html);
});

test("a same-tier best journal does NOT call the trophies optional", () => {
  // At its own tier the journal needs the trophy happiness to reach its yield.
  const fitted = buildBuildingRow(house, marketFor(house, 100), {
    laborerSlug: "WOOD",
    bestJournalFor: (slug, tier) =>
      (slug === "WOOD" && tier === 8 ? { journalTier: 8, yield: 1.175, profit: 1 } : null),
  });
  const html = captured.fmt(fitted, 0);
  assert.ok(/T8/.test(html));
  assert.ok(!/optional/.test(html), "trophies are required here: " + html);
  assert.ok(!/▲/.test(html), "no lower-tier journal won: " + html);
});

test("on Cheapest contract the journal verdict follows the laborer actually hired", () => {
  // The default pick is "" — the cheapest contract line, which differs per tier.
  // Asking for the verdict by tier alone left the whole column blank in exactly
  // the state the table opens in.
  const asked = [];
  const fitted = buildBuildingRow(house, marketFor(house, 100), {
    laborerSlug: "",
    bestJournalFor: (slug, tier) => {
      asked.push([slug, tier]);
      return { journalTier: tier, yield: 1.175, profit: 1 };
    },
  });
  assert.strictEqual(asked.length, 1, "one lookup per row: " + JSON.stringify(asked));
  assert.strictEqual(asked[0][0], fitted.laborers.slug,
    "the verdict is keyed on the contract that won, not on the empty picker");
  assert.strictEqual(asked[0][1], house.tier);
  assert.ok(fitted.bestJournal, "the cheapest-contract default still gets a verdict");
  assert.ok(/T8 @117\.5%/.test(captured.fmt(fitted, 0)), "…and the cell renders it");
});

test("a slotless building shows no journal verdict — it has no laborers", () => {
  const shell = buildBuildingRow(forge, marketFor(forge, 100), {});
  const html = captured.fmt(shell, 0);
  assert.ok(!/@\d+\.\d%/.test(html), "a forge has no laborers to feed: " + html);
});

test("the journal cell names the laborer and its profit per cycle", () => {
  // The contract's item name is not the laborer's, so a cell that only said
  // "T7" read as contradicting the Laborers table when it was about another
  // crew entirely.
  const fitted = buildBuildingRow(house, marketFor(house, 100), {
    laborerSlug: "WOOD",
    bestJournalFor: (slug, tier) => (slug === "WOOD" && tier === 8
      ? { journalTier: 7, yield: 1.5, profit: 58557, laborerName: "Lumberjack" } : null),
  });
  const html = captured.fmt(fitted, 0);
  assert.ok(/Lumberjack/.test(html), "the verdict names its laborer: " + html);
  assert.ok(/58,557\/cyc/.test(html), "…and the profit it is based on: " + html);
});

test("the laborer picker is populated from the LABORERS catalog", () => {
  assert.ok(laborerSelectOptionCount() >= 5,
    "the selector should offer every laborer line plus the cheapest-contract default");
});

test("the picker restores the laborer stored from the last session", () => {
  // Which crew you are costing out is not a transient view toggle; losing it on
  // every launch read as the laborer type not being settable at all.
  assert.strictEqual(BUILDINGS_LABORER_KEY, "buildingsLaborer");
  assert.strictEqual(__lsStore[BUILDINGS_LABORER_KEY], "STONE");
  assert.strictEqual(__restoredLaborer, "STONE",
    "the stored pick must be selected while the table's script loads");
});

test("the picker's change handler is delegated on the document", () => {
  // Bound to the element it died with any re-render of the header; delegated it
  // survives, which is what "I can't change the laborer" turned out to need.
  assert.ok(__hasDelegatedChangeHandler(), "no delegated change listener registered");
});

test("picking a laborer stores it and re-costs the row on that contract", () => {
  __fireLaborerChange("FISHING");
  assert.strictEqual(__lsStore[BUILDINGS_LABORER_KEY], "FISHING",
    "the pick is persisted from the delegated handler");
  const fitted = buildBuildingRow(house, marketFor(house, 100), { laborerSlug: "FISHING" });
  assert.strictEqual(fitted.laborers.id, `T${house.tier}_LABOURER_CONTRACT_FISHERMAN`,
    "the Fisherman's contract slug differs from the laborer slug");
  assert.ok(/Fisherman/.test(captured.fmt(fitted, 0)),
    "the cell names the hired laborer: " + captured.fmt(fitted, 0));
});

test("the laborer cell names the crew, not only the contract item", () => {
  // A Fiber contract hires the Cropper — with only the item name on the row, a
  // successful pick looked like nothing had changed.
  const fitted = buildBuildingRow(house, marketFor(house, 100), { laborerSlug: "WARRIOR" });
  const html = captured.fmt(fitted, 0);
  assert.ok(/Blacksmith/.test(html), "the laborer's name: " + html);
  assert.ok(/CONTRACT_WARRIOR/.test(html), "…alongside the contract it buys: " + html);
});

test("an unpriced contract says so instead of reading as free", () => {
  const md = marketFor(house, 100);
  BUILDING_CONTRACT_SLUGS.forEach((s) => { delete md[`T${house.tier}_LABOURER_CONTRACT_${s}`]; });
  const fitted = buildBuildingRow(house, md, { laborerSlug: "WOOD" });
  const html = captured.fmt(fitted, 0);
  assert.strictEqual(fitted.laborers.price, 0);
  assert.ok(/no listing/.test(html), "the cell must invite a price: " + html);
  assert.ok(/price-editable/.test(html), "…and stay click-to-edit: " + html);
});

test("cheapest-contract mode with nothing priced names no phantom item", () => {
  const md = marketFor(house, 100);
  BUILDING_CONTRACT_SLUGS.forEach((s) => { delete md[`T${house.tier}_LABOURER_CONTRACT_${s}`]; });
  const fitted = buildBuildingRow(house, md, { laborerSlug: "" });
  const html = captured.fmt(fitted, 0);
  assert.strictEqual(fitted.laborers.id, null);
  assert.ok(!/null/.test(html), "no 'null' item name leaks into the cell: " + html);
  assert.ok(/no line priced/.test(html), "the cell explains the blank: " + html);
});

test("every row still renders one cell per column header", () => {
  // "+", Building, Type, Materials, Fee, Material Cost, Laborers, Furniture,
  // Journal, Fill Speed / Max Profit, Total
  const cols = 11;
  captured.html.forEach((html, i) => {
    const tds = (html.match(/<td\b/g) || []).length;
    assert.strictEqual(tds, cols,
      `${captured.rows[i].building.id} rendered ${tds} cells`);
  });
});

test("every row names its own building", () => {
  const idx = captured.rows.findIndex((r) => r.building.family === "GUILDHALL");
  const html = captured.html[idx];
  assert.ok(/Guild Hall/.test(html), "the row must name the building: " + html);
});

// ── Total Cost is the FURNISHED total, broken out ──────────────────────────
console.log("\n=== Total Cost breakout ===");

test("the Total spells out shell + laborers + furniture", () => {
  const row = fittedFor(house);
  const html = captured.fmt(row, 0);
  assert.ok(html.includes(`shell ${Math.round(row.buildCost).toLocaleString()}`),
    "the shell term: " + html);
  assert.ok(html.includes(`laborers ${Math.round(row.laborers.cost).toLocaleString()}`),
    "the contracts term: " + html);
  assert.ok(html.includes(`furniture ${Math.round(row.furnitureCost).toLocaleString()}`),
    "the furnishing term: " + html);
  assert.ok(html.includes(Math.round(row.totalCost).toLocaleString()),
    "…and the total itself: " + html);
});

test("a building with no slots has no breakout — its shell IS its total", () => {
  const row = buildBuildingRow(forge, marketFor(forge, 100), {});
  const html = captured.fmt(row, 0);
  assert.ok(!/= shell/.test(html), "one term needs no breakout: " + html);
});

test("the shell half stays readable as Silver Fee + Material Cost", () => {
  // No twelfth column: those two columns already sum to the shell, so the
  // furnished Total loses nothing by being the only total on the row.
  const row = fittedFor(house);
  assert.ok(Math.abs(row.silverFee + row.materialCost - row.buildCost) < 1e-9,
    `${row.silverFee} + ${row.materialCost} vs ${row.buildCost}`);
});

test("a station row shows an em dash for laborers and furniture", () => {
  const idx = captured.rows.findIndex((r) => BUILDING_FAMILIES[r.building.family].category === "station");
  const html = captured.html[idx];
  assert.ok((html.match(/—/g) || []).length >= 2,
    "stations have no slots, so both cells read as an em dash: " + html);
});

test("wide cells carry the cap classes the CSS keys on", () => {
  const html = captured.html.join("\n");
  ["cell-item", "cell-mats", "cell-note"].forEach((c) =>
    assert.ok(new RegExp(`class="[^"]*\\b${c}\\b`).test(html), `missing ${c}`));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
