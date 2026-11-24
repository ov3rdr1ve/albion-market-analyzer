/**
 * Test: Breeding rows render food type, grow time, and offspring chance;
 * baby price cell is editable; rows with no market data still include `item`
 * (so "Show All" reveals them).
 *
 * Run: node --test tests/breeding-metadata-and-row-meta-feed.test.cjs
 *
 * Food type, grow time, offspring chance, findCheapestFeed. Shared setup: tests/helpers/breeding-metadata-and-row-setup.cjs.
 */
const {
  assert, getBreedingMeta, findCheapestFeed, __setTestCityForce, test, finish,
} = require("./helpers/breeding-metadata-and-row-setup.cjs");

// ── getBreedingMeta tests: food type classification ──

test("horse uses crops/herbs", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  assert.strictEqual(m.foodType, "Crops/Herbs");
});

test("swamp salamander (T5 FW Thetford) uses meat", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("elite swamp salamander (T8 FW Thetford) uses meat", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("winter bear (T5 FW Fort Sterling) uses meat", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_DIREBEAR_FW_FORTSTERLING_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("bighorn ram (T5 FW Martlock) uses crops/herbs", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_RAM_FW_MARTLOCK_BABY" });
  assert.strictEqual(m.foodType, "Crops/Herbs");
});

test("moabird FW (T5 Bridgewatch) uses crops/herbs", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_MOABIRD_FW_BRIDGEWATCH_BABY" });
  assert.strictEqual(m.foodType, "Crops/Herbs");
});

test("mystic owl (T5 FW Brecilien) uses meat (raptor, not a grain-eating bird)", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_OWL_FW_BRECILIEN_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("elite mystic owl (T8 FW Brecilien) uses meat", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_OWL_FW_BRECILIEN_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("swiftclaw (T5_FARM_COUGAR_BABY) uses meat", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_COUGAR_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("ghostwolf (T8_FARM_DIREWOLF_BABY) uses meat", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_DIREWOLF_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

test("moose (T6) uses crops/herbs", () => {
  const m = getBreedingMeta({ babyId: "T6_FARM_GIANTSTAG_MOOSE_BABY" });
  assert.strictEqual(m.foodType, "Crops/Herbs");
});

test("spring cottontail uses chocolate", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_RABBIT_EASTER_BABY" });
  assert.strictEqual(m.foodType, "Chocolate");
});

test("caerleon cottontail uses meat (event-specific)", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_RABBIT_EASTER_DARK_BABY" });
  assert.strictEqual(m.foodType, "Meat");
});

// ── Grow time / total food ──

test("T5 salamander grows for 140h and needs 1488 nutrition (29 meat @ 52)", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  assert.strictEqual(m.growHours, 140);
  assert.strictEqual(m.nutritionMax, 1488);
  assert.strictEqual(m.nutritionPerPiece, 52);
  assert.strictEqual(m.piecesNeeded, 29); // ceil(1488/52)
});

test("T8 elite salamander needs 19728 nutrition (380 meat)", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  assert.strictEqual(m.growHours, 284);
  assert.strictEqual(m.nutritionMax, 19728);
  assert.strictEqual(m.piecesNeeded, 380); // ceil(19728/52)
});

test("T8 horse needs 19728 nutrition (411 plants @ 48)", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_HORSE_BABY" });
  assert.strictEqual(m.nutritionMax, 19728);
  assert.strictEqual(m.nutritionPerPiece, 48);
  assert.strictEqual(m.piecesNeeded, 411); // ceil(19728/48)
});

test("livestock (chicken T3) needs 864 nutrition (18 plants)", () => {
  const m = getBreedingMeta({ babyId: "T3_FARM_CHICKEN_BABY" });
  assert.strictEqual(m.growHours, 44);
  assert.strictEqual(m.nutritionMax, 864);
  assert.strictEqual(m.piecesNeeded, 18); // 864/48
});

test("livestock (cow T8) is short-grow with 864 nutrition regardless of tier", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_COW_BABY" });
  assert.strictEqual(m.growHours, 44);
  assert.strictEqual(m.nutritionMax, 864);
});

test("cottontails are short-grow with 500 nutrition", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_RABBIT_EASTER_BABY" });
  assert.strictEqual(m.growHours, 44);
  assert.strictEqual(m.nutritionMax, 500);
});

// ── Offspring chance ──

test("T3 chicken has 60% offspring chance", () => {
  const m = getBreedingMeta({ babyId: "T3_FARM_CHICKEN_BABY" });
  assert.strictEqual(m.offspringPct, 60.0);
});

test("T8 cow has 93.3% offspring chance", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_COW_BABY" });
  assert.ok(Math.abs(m.offspringPct - 93.3) < 0.01);
});

test("rare mounts (swamp salamander) have no offspring data", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  assert.strictEqual(m.offspringPct, null);
});

test("rare mounts (direbear) have no offspring data", () => {
  const m = getBreedingMeta({ babyId: "T8_FARM_DIREBEAR_BABY" });
  assert.strictEqual(m.offspringPct, null);
});

test("horse T5 has 78.7% offspring chance", () => {
  const m = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  assert.ok(Math.abs(m.offspringPct - 78.7) < 0.01);
});

// ── findCheapestFeed: pick lowest-price food (user's core request) ──

test("findCheapestFeed picks lowest-price plant across tiers", () => {
  __setTestCityForce({});
  const market = {
    T1_CARROT:     { Martlock: { buy_price: 500 } },
    T3_WHEAT:      { Martlock: { buy_price: 100 } }, // cheapest
    T8_PUMPKIN:    { Martlock: { buy_price: 1000 } },
  };
  const feed = findCheapestFeed(market, "plants", ["Martlock"], "Martlock", 411);
  assert.strictEqual(feed.id, "T3_WHEAT");
  assert.strictEqual(feed.price, 100);
  assert.strictEqual(feed.city, "Martlock");
  assert.ok(Math.abs(feed.silverPerNutrition - 100 / 48) < 0.01);
  assert.strictEqual(feed.pieces, 411);
  assert.strictEqual(feed.totalCost, 411 * 100);
});

test("findCheapestFeed picks lowest-price meat across tiers (user's T3 vs T6 example)", () => {
  __setTestCityForce({});
  // User's example: "T6 Mutton 400 silver (400/52=7.6) cheaper than T3 meat 140 silver (140/52=2.69)"
  // Actually with uniform nutrition, lowest-price wins. 140 < 400, so T3 wins.
  const market = {
    T3_MEAT: { Bridgewatch: { buy_price: 140 } },
    T6_MEAT: { Bridgewatch: { buy_price: 400 } },
    T8_MEAT: { Bridgewatch: { buy_price: 900 } },
  };
  const feed = findCheapestFeed(market, "meat", ["Bridgewatch"], "Bridgewatch", 380);
  assert.strictEqual(feed.id, "T3_MEAT");
  assert.strictEqual(feed.city, "Bridgewatch");
  assert.strictEqual(feed.totalCost, 380 * 140);
});

test("findCheapestFeed returns tier-matched fallback when no food has price data", () => {
  __setTestCityForce({});
  const market = { T3_MEAT: { Bridgewatch: { buy_price: 0 } } };
  const feed = findCheapestFeed(market, "meat", ["Bridgewatch"], "Bridgewatch", 380, 8);
  assert.strictEqual(feed.id, "T8_MEAT");
  assert.strictEqual(feed.hasData, false);
  assert.strictEqual(feed.price, 0);
  assert.strictEqual(feed.city, "Bridgewatch");
  assert.strictEqual(feed.totalCost, 0);
});

test("findCheapestFeed returns null for unknown food category", () => {
  __setTestCityForce({});
  const feed = findCheapestFeed({}, "unknown_category", ["Martlock"], "Martlock", 10, 5);
  assert.strictEqual(feed, null);
});

test("findCheapestFeed fallback prefers same-tier, then descends", () => {
  __setTestCityForce({});
  const feed = findCheapestFeed({}, "meat", ["Martlock"], "Martlock", 10, 7);
  assert.strictEqual(feed.id, "T7_MEAT");
  const feedT5 = findCheapestFeed({}, "meat", ["Martlock"], "Martlock", 10, 5);
  assert.strictEqual(feedT5.id, "T5_MEAT");
});

test("findCheapestFeed skips foods with 0 price and picks next cheapest", () => {
  __setTestCityForce({});
  const market = {
    T3_MEAT: { Bridgewatch: { buy_price: 0 } }, // no data
    T4_MEAT: { Bridgewatch: { buy_price: 200 } },
    T5_MEAT: { Bridgewatch: { buy_price: 150 } }, // cheapest with data
  };
  const feed = findCheapestFeed(market, "meat", ["Bridgewatch"], "Bridgewatch", 29);
  assert.strictEqual(feed.id, "T5_MEAT");
  assert.strictEqual(feed.city, "Bridgewatch");
});

test("findCheapestFeed respects per-city pricing (only uses cities in citySearch)", () => {
  __setTestCityForce({});
  const market = {
    T3_MEAT: { Caerleon: { buy_price: 50 }, Bridgewatch: { buy_price: 140 } },
  };
  const feed = findCheapestFeed(market, "meat", ["Bridgewatch"], "Bridgewatch", 380);
  // Caerleon's 50 must NOT leak in when citySearch excludes it.
  assert.strictEqual(feed.price, 140);
  assert.strictEqual(feed.city, "Bridgewatch");
});

test("findCheapestFeed considers both crops and herbs for plant eaters", () => {
  __setTestCityForce({});
  const market = {
    T3_WHEAT:   { Martlock: { buy_price: 200 } },
    T3_COMFREY: { Martlock: { buy_price: 80 } }, // herb, cheapest
  };
  const feed = findCheapestFeed(market, "plants", ["Martlock"], "Martlock", 100);
  assert.strictEqual(feed.id, "T3_COMFREY");
});

// ── findCheapestFeed scans all of THIS section's cities and honors a city
//    force only WITHIN the section (parity with saddler materials). A force
//    pointing outside the section (e.g. Caerleon on a royal row) is ignored so
//    a pin can't bleed across the royal/Caerleon split. (Originally the force
//    won regardless of citySearch — the "Raw Beef" behavior — but that mirrored
//    the bug it was meant to fix, so feed/saddler are now section-scoped like
//    every other table.) ──

test("findCheapestFeed scans multiple cities and picks cheapest across them", () => {
  __setTestCityForce({});
  const market = {
    T6_MEAT: {
      Lymhurst:        { buy_price: 400 },
      Martlock:        { buy_price: 250 }, // cheapest
      "Fort Sterling": { buy_price: 380 },
    },
  };
  const feed = findCheapestFeed(
    market, "meat",
    ["Lymhurst", "Martlock", "Fort Sterling"],
    "Lymhurst", 380, 6,
  );
  assert.strictEqual(feed.id, "T6_MEAT");
  assert.strictEqual(feed.city, "Martlock");
  assert.strictEqual(feed.price, 250);
});

test("findCheapestFeed ignores a forced buy city outside this section's citySearch", () => {
  // A force at Caerleon must NOT apply to a royal breeding row — sections are
  // independent. The royal row scans royal cities only; with no royal data it
  // falls back to the no-data default rather than ferrying feed cross-zone.
  __setTestCityForce({ T8_MEAT: { buy: "Caerleon" } });
  const market = {
    T8_MEAT: { Caerleon: { buy_price: 25000 } },
  };
  const feed = findCheapestFeed(
    market, "meat",
    ["Lymhurst", "Martlock"], // royal section — excludes Caerleon
    "Lymhurst", 380, 8,
  );
  assert.strictEqual(feed.id, "T8_MEAT");
  assert.strictEqual(feed.city, "Lymhurst"); // defaultCity; Caerleon force ignored
  assert.strictEqual(feed.hasData, false);
  assert.strictEqual(feed.price, 0);
  __setTestCityForce({});
});

test("findCheapestFeed honors a forced buy city that IS within this section", () => {
  // In-section pin still wins (e.g. user pins meat to Martlock on a royal row),
  // even when a cheaper city exists — so the override-style pin isn't lost.
  __setTestCityForce({ T8_MEAT: { buy: "Martlock" } });
  const market = {
    T8_MEAT: { Lymhurst: { buy_price: 100 }, Martlock: { buy_price: 30000 } },
  };
  const feed = findCheapestFeed(
    market, "meat",
    ["Lymhurst", "Martlock"], // royal section includes Martlock
    "Lymhurst", 380, 8,
  );
  assert.strictEqual(feed.city, "Martlock"); // forced, despite Lymhurst being cheaper
  assert.strictEqual(feed.price, 30000);
  __setTestCityForce({});
});

test("findCheapestFeed uses defaultCity in fallback when no food has data", () => {
  __setTestCityForce({});
  const feed = findCheapestFeed(
    {}, "meat",
    ["Lymhurst", "Bridgewatch", "Fort Sterling"], // citySearch starts non-default
    "Martlock", // breeding city — this is what the dropdown should default to
    380, 8,
  );
  assert.strictEqual(feed.id, "T8_MEAT");
  assert.strictEqual(feed.hasData, false);
  assert.strictEqual(feed.price, 0);
  assert.strictEqual(feed.city, "Martlock");
});

test("findCheapestFeed sets feed.city on every successful pick", () => {
  __setTestCityForce({});
  const market = {
    T4_MEAT: { Lymhurst: { buy_price: 100 } },
  };
  const feed = findCheapestFeed(market, "meat", ["Lymhurst"], "Lymhurst", 50, 4);
  assert.strictEqual(typeof feed.city, "string");
  assert.ok(feed.city.length > 0);
});

test("findCheapestFeed: a cross-section force is ignored, so in-section data still wins", () => {
  // T8_MEAT pinned to Caerleon, but this is a royal section (citySearch has no
  // Caerleon). The pin is ignored and the royal scan finds Martlock's listing
  // instead of falling back to a no-data result.
  __setTestCityForce({ T8_MEAT: { buy: "Caerleon" } });
  const market = {
    T8_MEAT: { Martlock: { buy_price: 30000 } },
  };
  const feed = findCheapestFeed(
    market, "meat",
    ["Lymhurst", "Martlock"],
    "Lymhurst", 380, 8,
  );
  assert.strictEqual(feed.id, "T8_MEAT");
  assert.strictEqual(feed.hasData, true);
  assert.strictEqual(feed.price, 30000);
  assert.strictEqual(feed.city, "Martlock");
  __setTestCityForce({});
});

test("findCheapestFeed forcing one id does not poison sibling ids' multi-city scan", () => {
  __setTestCityForce({ T8_MEAT: { buy: "Caerleon" } });
  const market = {
    // T8_MEAT has no data anywhere (user only wrote down a force)
    T7_MEAT: { Lymhurst: { buy_price: 200 } },
  };
  const feed = findCheapestFeed(
    market, "meat",
    ["Lymhurst", "Martlock"],
    "Lymhurst", 50, 8,
  );
  assert.strictEqual(feed.id, "T7_MEAT");
  assert.strictEqual(feed.city, "Lymhurst");
  assert.strictEqual(feed.price, 200);
  __setTestCityForce({});
});

test("nutrition per piece is 48 for plants and 52 for meat (game-verified)", () => {
  const horseMeta = getBreedingMeta({ babyId: "T5_FARM_HORSE_BABY" });
  const salMeta = getBreedingMeta({ babyId: "T5_FARM_SWAMPDRAGON_FW_THETFORD_BABY" });
  assert.strictEqual(horseMeta.nutritionPerPiece, 48);
  assert.strictEqual(salMeta.nutritionPerPiece, 52);
});

finish();
