/**
 * Test: the pasture byproduct model — feed a GROWN animal, collect eggs/milk.
 *
 * The old model priced a byproduct row as "buy one baby, get 1 egg/milk, baby
 * consumed". That is not the game. items.xml says:
 *
 *   <farmableitem uniquename="T8_FARM_COW_GROWN" ...>
 *     <consumption><food nutritionmax="864" secondspernutrition="91.67">
 *       <acceptedfood foodcategory="plants" favorite="T8_PUMPKIN" favoritebonus="1"/>
 *     </food></consumption>
 *     <products productiontime="79200" actionname="@FARMABLE_GETPRODUCT_BUTTON_MILK" .../>
 *
 * So one production cycle is:
 *   - 864 nutrition of crops (a favorite crop is worth 2x48 = 96, so 9 of them;
 *     any other plant is 48, so 18),
 *   - 79,200s = 22h,
 *   - 7-11 produce (doubled by Premium),
 *   - and the animal SURVIVES: it is reusable capital, not an input.
 *
 * The baby only matters for breeding (Mounts table) — a baby bought to be
 * milked is just an expensive way to obtain the grown animal.
 *
 * Black box over the shipped modules plus items.xml. No market, no DOM.
 *
 * Run: node tests/farming-byproduct-feed-model.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const { calcFarmingEconomics, PREMIUM_TAX, SETUP_FEE } = require("../js/calculations.js");
const { evaluateFarmingRow } = require("../js/farming-row-econ.js");

const dataSrc = fs.readFileSync(path.join(ROOT, "js/data-farming.js"), "utf8");
const dataMod = new Module("farming-data-byproduct-test");
dataMod._compile(`${dataSrc}\nmodule.exports = { FARMING_PRODUCTION };`, "data-farming.js");
const { FARMING_PRODUCTION } = dataMod.exports;

const itemsXml = fs.readFileSync(path.join(ROOT, "data", "dumps", "items.xml"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
const close = (a, b, eps, what) =>
  assert.ok(Math.abs(a - b) < (eps || 1e-9), `${what || "value"}: ${a} != ${b}`);

const BYPRODUCTS = FARMING_PRODUCTION.filter((p) => p.type === "byproduct");

// --- items.xml readers ------------------------------------------------------

/** The <farmableitem> block for one id, up to its closing tag. */
function farmableBlock(id) {
  const start = itemsXml.indexOf(`<farmableitem uniquename="${id}"`);
  if (start < 0) return "";
  const end = itemsXml.indexOf("</farmableitem>", start);
  return end < 0 ? itemsXml.slice(start, start + 2000) : itemsXml.slice(start, end);
}

function attr(block, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(block);
  return m ? m[1] : null;
}

function cropNutrition(id) {
  const m = new RegExp(`uniquename="${id}"[^>]*nutrition="(\\d+)"`).exec(itemsXml);
  return m ? Number(m[1]) : 0;
}

console.log("\n=== FARMING_PRODUCTION byproduct rows describe the produce cycle ===");

BYPRODUCTS.forEach((p) => {
  test(`${p.name}: buys FEED each cycle, not a baby`, () => {
    assert.strictEqual(p.id, p.feedId, "the per-cycle purchase is the feed crop");
    assert.ok(/_FARM_[A-Z]+_GROWN$/.test(p.animalId), `${p.animalId} is not a GROWN animal`);
    assert.ok(/_FARM_[A-Z]+_BABY$/.test(p.babyId), `${p.babyId} is not a BABY animal`);
    assert.ok(itemsXml.includes(`uniquename="${p.feedId}"`), `${p.feedId} missing from items.xml`);
    assert.ok(itemsXml.includes(`uniquename="${p.animalId}"`), `${p.animalId} missing from items.xml`);
    assert.ok(itemsXml.includes(`uniquename="${p.babyId}"`), `${p.babyId} missing from items.xml`);
  });

  test(`${p.name}: feed is the animal's favorite crop in items.xml`, () => {
    const block = farmableBlock(p.animalId);
    assert.strictEqual(attr(block, "favorite"), p.feedId);
  });

  test(`${p.name}: feedCount = nutritionmax / (favorite nutrition x 2)`, () => {
    const block = farmableBlock(p.animalId);
    const need = Number(attr(block, "nutritionmax"));
    const perCrop = cropNutrition(p.feedId) * 2; // favoritebonus="1" doubles it
    assert.strictEqual(need, 864);
    assert.strictEqual(perCrop, 96);
    assert.strictEqual(p.feedCount, need / perCrop);
  });

  test(`${p.name}: cycle = the grown animal's productiontime (22h)`, () => {
    const block = farmableBlock(p.animalId);
    const seconds = Number(attr(block, "productiontime"));
    assert.strictEqual(seconds, 79200);
    assert.strictEqual(p.cycleHours, seconds / 3600);
  });

  test(`${p.name}: produceBase is the free-account average of the 7-11 roll`, () => {
    // loot.xml T3_CHICKEN_LOOT ... T8_COW_LOOT: <Item ... amount="7-11" />
    assert.strictEqual(p.produceBase, 9);
  });
});

console.log("\n=== calcFarmingEconomics — one produce cycle ===");

// Cow's Milk, no city bonus, Premium off. 9 pumpkins at 400 feed the cow for
// one 22h cycle; it gives 9.5 milk at 390 each.
const CYCLE = {
  type: "byproduct",
  seedPrice: 400,          // one feed crop
  feedCount: 9,
  producePerCycle: 9.5,
  outputSellPrice: 390,
  yieldBonus: 0,
  plotsPerCycle: 1,
  cycleHours: 22,
  focusPerCycle: 0,
  useWater: true,
};

test("outputs per cycle = produce x (1 + city bonus)", () => {
  close(calcFarmingEconomics(CYCLE).outputsPerCycle, 9.5, 1e-9, "no bonus");
  close(calcFarmingEconomics({ ...CYCLE, yieldBonus: 0.10 }).outputsPerCycle, 10.45, 1e-9, "+10%");
});

test("the cycle's input cost is feedCount x feed price, spread over the produce", () => {
  const e = calcFarmingEconomics(CYCLE);
  close(e.netSeedCostPerOutput, (9 * 400) / 9.5, 1e-9, "feed cost per milk");
});

test("profit per cycle = produce x net sale - feed", () => {
  const e = calcFarmingEconomics(CYCLE);
  const expected = 9.5 * 390 * (1 - PREMIUM_TAX) - 9 * 400 * (1 + SETUP_FEE);
  close(e.profitPerCycle, expected, 1e-6, "profit per cycle");
});

test("the city bonus adds produce without adding feed", () => {
  const plain = calcFarmingEconomics(CYCLE);
  const bonus = calcFarmingEconomics({ ...CYCLE, yieldBonus: 0.10 });
  close(bonus.profitPerCycle - plain.profitPerCycle, 0.95 * 390 * (1 - PREMIUM_TAX), 1e-6,
    "+10% is 0.95 extra milk, sold net, at no extra feed cost");
});

test("profit/day runs on the 22h produce cycle", () => {
  const e = calcFarmingEconomics(CYCLE);
  close(e.profitPerDay, e.profitPerCycle * (24 / 22), 1e-6, "cycles per day");
});

test("expensive feed can make the cycle a loss", () => {
  const e = calcFarmingEconomics({ ...CYCLE, seedPrice: 900 });
  assert.ok(e.profitPerCycle < 0, "9 crops at 900 outruns 9.5 milk at 390");
});

test("no seed leg: an animal never hands feed back", () => {
  const e = calcFarmingEconomics({ ...CYCLE, seedSellPrice: 5000 });
  assert.strictEqual(e.surplusSeedsPerCycle, 0);
  assert.strictEqual(e.seedRevenuePerCycle, 0);
});

test("no watering play: the delta and the marginal rate are both 0", () => {
  const e = calcFarmingEconomics({ ...CYCLE, focusPerCycle: 100 });
  assert.strictEqual(e.wateringProfitDelta, 0);
  assert.strictEqual(e.profitPerFocus, 0);
  assert.strictEqual(e.profitPerCycleFocusOn, e.profitPerCycle);
});

test("produce 0 (unpriced row) stays 0, never NaN", () => {
  const e = calcFarmingEconomics({ ...CYCLE, producePerCycle: 0 });
  assert.strictEqual(e.outputsPerCycle, 0);
  assert.strictEqual(e.profitPerCycle, 0);
  assert.ok(Number.isFinite(e.netSeedCostPerOutput));
});

console.log("\n=== evaluateFarmingRow — Premium, feed leg, animal capital ===");

const COW = BYPRODUCTS.find((p) => p.tier === 8);

function makeDeps(market) {
  const at = (side, id, c) => (market[id] && market[id][side] && market[id][side][c]) || 0;
  return {
    marketData: market,
    findBestBuyCity(md, id, cities) {
      let city = null, price = 0;
      cities.forEach((c) => {
        const p = at("buy", id, c);
        if (p > 0 && (price === 0 || p < price)) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    findBestSellCity(md, id, cities) {
      let city = null, price = 0;
      cities.forEach((c) => {
        const p = at("sell", id, c);
        if (p > price) { city = c; price = p; }
      });
      return { city, price, travelCost: 0 };
    },
    getFarmingYieldBonus: () => 0,
    calcFarmingEconomics,
    getCityForce: () => null,
  };
}

const CITIES = ["Martlock", "Thetford"];
const MARKET = {
  [COW.feedId]:   { buy: { Martlock: 400, Thetford: 500 }, sell: {} },
  [COW.outputId]: { buy: {}, sell: { Martlock: 390, Thetford: 390 } },
  [COW.animalId]: { buy: { Martlock: 8000, Thetford: 9000 }, sell: {} },
};

test("the buy leg is the feed crop, priced per crop", () => {
  const r = evaluateFarmingRow(COW, CITIES, CITIES, { premium: false }, makeDeps(MARKET));
  assert.strictEqual(r.seedBuy.city, "Martlock");
  assert.strictEqual(r.seedBuy.price, 400);
});

test("Premium doubles the produce, not the feed", () => {
  const free = evaluateFarmingRow(COW, CITIES, CITIES, { premium: false }, makeDeps(MARKET));
  const prem = evaluateFarmingRow(COW, CITIES, CITIES, { premium: true }, makeDeps(MARKET));
  close(prem.econ.outputsPerCycle, 2 * free.econ.outputsPerCycle, 1e-9, "produce doubles");
  // Same feed bill on both, so the extra produce is pure margin.
  close(prem.econ.profitPerCycle - free.econ.profitPerCycle,
    free.econ.outputsPerCycle * 390 * (1 - PREMIUM_TAX), 1e-6, "Premium delta");
});

test("the grown animal is reported as capital, not charged to the cycle", () => {
  const r = evaluateFarmingRow(COW, CITIES, CITIES, { premium: true }, makeDeps(MARKET));
  assert.strictEqual(r.animalBuy.city, "Martlock");
  assert.strictEqual(r.animalBuy.price, 8000);
  const dearer = JSON.parse(JSON.stringify(MARKET));
  dearer[COW.animalId].buy = { Martlock: 80000, Thetford: 90000 };
  const r2 = evaluateFarmingRow(COW, CITIES, CITIES, { premium: true }, makeDeps(dearer));
  close(r2.econ.profitPerCycle, r.econ.profitPerCycle, 1e-9,
    "a 10x animal price must not move the produce cycle");
});

test("a missing animal listing leaves the capital leg blank, cycle unaffected", () => {
  const noAnimal = JSON.parse(JSON.stringify(MARKET));
  delete noAnimal[COW.animalId];
  const r = evaluateFarmingRow(COW, CITIES, CITIES, { premium: true }, makeDeps(noAnimal));
  assert.strictEqual(r.animalBuy.price, 0);
  assert.ok(r.econ.profitPerCycle !== 0);
});

test("crops keep their own leg shape (animalBuy is empty there)", () => {
  const wheat = FARMING_PRODUCTION.find((p) => p.id === "T3_FARM_WHEAT_SEED");
  const market = {
    T3_FARM_WHEAT_SEED: { buy: { Martlock: 300 }, sell: { Martlock: 300 } },
    T3_WHEAT: { buy: {}, sell: { Martlock: 440 } },
  };
  const r = evaluateFarmingRow(wheat, ["Martlock"], ["Martlock"], { premium: true }, makeDeps(market));
  assert.strictEqual(r.animalBuy.price, 0);
  assert.strictEqual(r.animalBuy.city, null);
  // 9 slots x 4.5 crops per seed, doubled by Premium (loot.xml: amount="3-6").
  assert.strictEqual(r.econ.outputsPerCycle, 81, "9 slots x 9 crops each with Premium");
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
