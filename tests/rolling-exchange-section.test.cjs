/**
 * Test: the Energy Manipulator exchange section of the Artifact Rolling table.
 *
 * Crystal Shards and Fire Dragon Scales are NOT melded: 50 fragments of a tier
 * buy the artifact you PICK. The Rolling table shows them as a separate
 * section (js/rolling-exchange.js rows, js/render-rolling-exchange.js markup),
 * one row per family per tier, and they never become roll types.
 *
 * Row semantics under test:
 *   cost    = count x fragment price x (1 + SETUP_FEE)       (the buy leg)
 *   outcome = the best-paying priced artifact, net of PREMIUM_TAX
 *   profit  = outcome - cost,   value per fragment = outcome / count
 *   a REAL quote outranks an invented one; an unpriced artifact is skipped;
 *   an unpriced fragment prints "no data" and ranks last.
 *
 * Black box over the real modules with synthetic prices. No live API or DB.
 *
 * Run: node tests/rolling-exchange-section.test.cjs
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");
const assert = require("assert");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");

// The real isInventedSide, lifted out of its (browser-global) file so the
// invented-vs-real rule is tested against the app's own definition.
const inventedSrc = J("market-price-store.js").match(/function isInventedSide[\s\S]*?\r?\n}\r?\n/)[0];

const stubs = `
const _els = {
  "include-caerleon": { checked: false },
  "sort-instant": { checked: false },
  "premium-account": { checked: true },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
const tableState = { "rolling-table": { data: [], html: [] } };
function renderTableData(id, rows, fmt) {
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message + e.stack; } });
}
function priceTd(price, itemId, city) {
  const body = price > 0 ? String(price) : "no data — click to set";
  return '<td class="silver-val cell-num price-editable" data-item-id="' + itemId
    + '" data-city="' + city + '" data-city-list="sell">' + body + '</td>';
}
function profitTd() { return "<td class='cell-margin'>M</td>"; }
function getProfitClass() { return ""; }
function addTdForKey() { return '<td class="cell-add"><button></button></td>'; }
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function formatPriceAge() { return null; }
function getItemDisplayName(id) { return id; }
const ITEM_NAMES_MAP = {};
let lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
${inventedSrc}
`;

const sources =
  J("data-city-bonuses.js") +
  (J("calculations.js") + J("calculations-margins.js")) +
  J("travel-cost.js") +
  J("mp-bonus.js") +
  (J("utils.js") + J("utils-item-ids.js") + J("utils-overrides.js") + J("utils-focus-fees.js")) +
  J("price-freshness.js") +
  J("table-sell-city.js") +
  J("data-artifacts.js") +
  J("data-energy-exchange.js") +
  J("sorting-row-key.js") +
  J("rolling-strategy.js") +
  J("rolling-exchange.js") +
  J("render-rolling-exchange.js") +
  J("render-rolling.js");

const mod = new Module("rolling-exchange-section");
mod._compile(
  stubs + sources + `
module.exports = {
  _els, tableState, renderRollingTable, CITIES, SELL_CITIES, ROYAL_CITIES,
  ROLL_TYPES, ENERGY_EXCHANGE_ITEMS, ENERGY_EXCHANGE_FRAGMENT_IDS, ARTIFACT_MAPPING,
  rollingExchangeRows, getRollingItemIds, getRowKey,
  setPremium: (v) => { _els["premium-account"].checked = v; },
  setTableSellCity, setTableBuyCity, clearTableSellCities,
  setOverride: (id, city, price) => {
    (priceOverrides[id] = priceOverrides[id] || {})[city] = { use: "auto", buyOrder: price, sellOrder: price };
  },
  clearPins: () => {
    Object.keys(priceOverrides).forEach((k) => delete priceOverrides[k]);
    Object.keys(cityForceOverrides).forEach((k) => delete cityForceOverrides[k]);
  },
  getPremiumTax: () => PREMIUM_TAX, getSetupFee: () => SETUP_FEE,
};`,
  "rolling-exchange-section.js",
);
const X = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  X.clearTableSellCities();
  X.clearPins();
  X.setPremium(true);
  X._els["include-caerleon"].checked = false;
  try { fn(); console.log("  PASS: " + name); passed++; }
  catch (e) { console.error("  FAIL: " + name + " — " + e.message); failed++; }
  X.clearTableSellCities();
  X.clearPins();
  X.setPremium(true);
}

const entry = (buy, sell, extra) => Object.assign({ buy_price: buy, sell_price: sell, volume_24h: 500 }, extra || {});
const T = { Crystal: "SHARD_CRYSTAL", Dragon: "SHARD_FIRE_DRAGON" };
const fragId = (family, tier) => `T${tier}_${T[family]}`;
const picksOf = (family, tier) =>
  X.ENERGY_EXCHANGE_ITEMS.filter((i) => i.materials[0].matId === fragId(family, tier)).map((i) => i.id);

/** A market with a flat fragment price and a flat artifact price everywhere. */
function market({ frag = 1000, art = 80000, skip = () => false } = {}) {
  const md = {};
  const put = (id, city, c) => { (md[id] = md[id] || {})[city] = c; };
  X.ENERGY_EXCHANGE_FRAGMENT_IDS.forEach((id) => X.CITIES.forEach((c) => put(id, c, entry(frag, frag + 100))));
  X.ENERGY_EXCHANGE_ITEMS.forEach((i) => X.SELL_CITIES.forEach((c) => {
    if (!skip(i.id, c)) put(i.id, c, entry(art - 5000, art));
  }));
  return md;
}
const ROYAL = X.ROYAL_CITIES;
const rows = (md, buy = ROYAL, sell = ROYAL) => X.rollingExchangeRows(md, buy, sell, "royal");
const rowOf = (rs, family, tier) => rs.find((r) => r.rollType === family && r.tier === tier);

console.log("Artifact Rolling — Energy Manipulator exchange section\n");

// ── Shape ────────────────────────────────────────────────────────────────────
test("ten rows: Crystal and Dragon at T4..T8, in the Exchange category", () => {
  const rs = rows(market());
  assert.strictEqual(rs.length, 10);
  for (const family of ["Crystal", "Dragon"]) {
    assert.deepStrictEqual(rs.filter((r) => r.rollType === family).map((r) => r.tier), [4, 5, 6, 7, 8]);
  }
  assert.ok(rs.every((r) => r.cat === "Exchange" && r.exchange === true && r.section === "royal"));
});

test("Crystal and Dragon stay out of ROLL_TYPES", () => {
  assert.deepStrictEqual(X.ROLL_TYPES, ["Rune", "Soul", "Relic", "Avalonian"]);
});

test("the fragment and the pick list come from the exchange catalog", () => {
  const rs = rows(market());
  for (const r of rs) {
    assert.strictEqual(r.fragmentId, fragId(r.rollType, r.tier));
    assert.strictEqual(r.rollCost, 50);
    assert.ok(picksOf(r.rollType, r.tier).includes(r.artId), r.artId + " is not an exchange pick");
  }
});

test("Dragon has 3 picks per tier; Crystal as many as the catalog lists", () => {
  const rs = rows(market());
  for (const tier of [4, 5, 6, 7, 8]) {
    assert.strictEqual(rowOf(rs, "Dragon", tier).picks.length, 3);
    assert.strictEqual(rowOf(rs, "Crystal", tier).picks.length, picksOf("Crystal", tier).length);
  }
});

// ── Math ─────────────────────────────────────────────────────────────────────
test("best pick wins; value per fragment and profit follow it", () => {
  const md = market({ frag: 1000, art: 80000 });
  const ids = picksOf("Crystal", 6);
  md[ids[2]].Martlock = entry(150000, 160000); // the jackpot pick, sold in Martlock
  const r = rowOf(rows(md), "Crystal", 6);
  assert.strictEqual(r.artId, ids[2]);
  assert.strictEqual(r.bestSellCity, "Martlock");
  assert.strictEqual(r.bestSellPrice, 160000);
  const tax = X.getPremiumTax();
  const fee = X.getSetupFee();
  const cost = 50 * 1000 * (1 + fee);
  assert.ok(Math.abs(r.rollCostSilver - cost) < 1e-6, "cost " + r.rollCostSilver);
  assert.ok(Math.abs(r.sellRevenue - 160000 * (1 - tax)) < 1e-6);
  assert.ok(Math.abs(r.valuePerFragment - (160000 * (1 - tax)) / 50) < 1e-6);
  assert.ok(Math.abs(r.sellRevenue - r.rollCostSilver - (r.sellRevenue - cost)) < 1e-6);
  assert.ok(Math.abs(r.margin - ((r.sellRevenue - cost) / cost) * 100) < 1e-6);
  assert.strictEqual(r.fragBuyCity, "Lymhurst");
  assert.strictEqual(r.fragBuyPrice, 1000);
});

test("the fragment is bought where it is cheapest", () => {
  const md = market({ frag: 1000 });
  md[fragId("Dragon", 5)].Thetford = entry(700, 800);
  const r = rowOf(rows(md), "Dragon", 5);
  assert.strictEqual(r.fragBuyCity, "Thetford");
  assert.strictEqual(r.fragBuyPrice, 700);
});

[true, false].forEach((premium) => {
  test(`sales tax follows the Premium toggle (premium=${premium})`, () => {
    X.setPremium(premium);
    const r = rowOf(rows(market({ art: 100000 })), "Crystal", 4);
    assert.strictEqual(r.sellRevenue, 100000 * (1 - X.getPremiumTax()));
    assert.ok(premium ? X.getPremiumTax() < 0.07 : X.getPremiumTax() > 0.1);
  });
});

// ── Unpriced and invented legs ───────────────────────────────────────────────
test("an unpriced artifact is skipped when choosing the best", () => {
  const ids = picksOf("Dragon", 7);
  const md = market({ art: 50000, skip: (id) => id === ids[0] });
  const r = rowOf(rows(md), "Dragon", 7);
  assert.notStrictEqual(r.artId, ids[0]);
  assert.strictEqual(r.hasNoArtData, false);
  assert.strictEqual(r.picks.length, 2);
  assert.deepStrictEqual(r.unpricedPicks.map((p) => p.artId), [ids[0]]);
});

test("a zero scan cell means not observed, never a price", () => {
  const ids = picksOf("Dragon", 4);
  const md = market({ art: 50000 });
  X.SELL_CITIES.forEach((c) => { md[ids[0]][c] = entry(0, 0); });
  const r = rowOf(rows(md), "Dragon", 4);
  assert.ok(r.picks.every((p) => p.artId !== ids[0]));
});

test("no priced artifact: row stays, editable on the first pick, ranks last", () => {
  const md = market({ skip: (id) => picksOf("Crystal", 8).includes(id) });
  const rs = rows(md);
  const r = rowOf(rs, "Crystal", 8);
  assert.strictEqual(r.hasNoArtData, true);
  assert.strictEqual(r.artId, picksOf("Crystal", 8)[0]);
  assert.strictEqual(r.bestSellPrice, 0);
  assert.strictEqual(r.margin, -999);
  assert.strictEqual(rs.length, 10, "an unpriced row voided its neighbours");
  assert.ok(rs.filter((x) => x !== r).every((x) => x.margin > -999));
});

test("an unpriced fragment prints no data, costs nothing and ranks last", () => {
  const md = market();
  delete md[fragId("Crystal", 5)];
  const rs = rows(md);
  const r = rowOf(rs, "Crystal", 5);
  assert.strictEqual(r.hasNoFragData, true);
  assert.strictEqual(r.fragBuyCity, null);
  assert.strictEqual(r.rollCostSilver, 0);
  assert.strictEqual(r.margin, -999);
  assert.strictEqual(r.marginInfo.margin, -1);
  assert.ok(r.bestSellPrice > 0, "the artifact side must still be priced");
  assert.strictEqual(rs.length, 10);
});

test("an invented artifact price never beats a real one", () => {
  const ids = picksOf("Dragon", 6);
  const md = market({ art: 40000 });
  ids.forEach((id) => X.SELL_CITIES.forEach((c) => { md[id][c] = entry(35000, 40000); }));
  md[ids[1]].Martlock = entry(0, 900000, { sell_fallback: true, used_fallback: true });
  const r = rowOf(rows(md), "Dragon", 6);
  assert.strictEqual(r.bestSellPrice, 40000, "the invented 900,000 won");
  assert.notStrictEqual(r.bestSellCity, "Martlock");
});

test("an invented price still prices a pick when it is all there is", () => {
  const ids = picksOf("Dragon", 6);
  const md = market({ skip: (id) => picksOf("Dragon", 6).includes(id) });
  md[ids[1]] = { Martlock: entry(0, 70000, { sell_fallback: true, used_fallback: true }) };
  const r = rowOf(rows(md), "Dragon", 6);
  assert.strictEqual(r.artId, ids[1]);
  assert.strictEqual(r.bestSellPrice, 70000);
});

test("an invented fragment price never beats a real one", () => {
  const md = market({ frag: 1000 });
  md[fragId("Crystal", 4)].Thetford = entry(300, 400, { buy_fallback: true, used_fallback: true });
  const r = rowOf(rows(md), "Crystal", 4);
  assert.strictEqual(r.fragBuyPrice, 1000);
  assert.notStrictEqual(r.fragBuyCity, "Thetford");
});

// ── City picks and overrides ─────────────────────────────────────────────────
test("the cities handed in bound both legs", () => {
  const md = market({ frag: 1000 });
  md[fragId("Crystal", 4)].Thetford = entry(700, 800);
  const r = rowOf(rows(md, ["Lymhurst"], ["Martlock"]), "Crystal", 4);
  assert.strictEqual(r.fragBuyCity, "Lymhurst");
  assert.strictEqual(r.bestSellCity, "Martlock");
});

test("a typed sell price on a pick makes it the best and flags the override", () => {
  const ids = picksOf("Crystal", 7);
  const md = market({ art: 50000 });
  X.setOverride(ids[3], "Bridgewatch", 400000);
  const r = rowOf(rows(md), "Crystal", 7);
  assert.strictEqual(r.artId, ids[3]);
  assert.strictEqual(r.bestSellPrice, 400000);
  assert.strictEqual(r.hasOverride, true);
});

// ── The price scan ───────────────────────────────────────────────────────────
test("getRollingItemIds covers every exchange fragment and artifact once", () => {
  const ids = X.getRollingItemIds();
  assert.strictEqual(new Set(ids).size, ids.length, "duplicate ids");
  X.ENERGY_EXCHANGE_FRAGMENT_IDS.forEach((id) => assert.ok(ids.includes(id), id + " not scanned"));
  X.ENERGY_EXCHANGE_ITEMS.forEach((i) => assert.ok(ids.includes(i.id), i.id + " not scanned"));
});

test("getRollingItemIds still scans the four roll families", () => {
  const ids = X.getRollingItemIds();
  ["T4_RUNE", "T5_SOUL", "T6_RELIC", "T7_SHARD_AVALONIAN", "T8_ARTEFACT_OFF_SHIELD_HELL"]
    .forEach((id) => assert.ok(ids.includes(id), id));
});

// ── Rendered table ───────────────────────────────────────────────────────────
function render(md) {
  X.renderRollingTable(md || market());
  return X.tableState["rolling-table"];
}
const royal = (t) => t.data.map((r, i) => ({ r, h: t.html[i] })).filter((x) => x.r.section === "royal");

test("the exchange section follows the four roll families", () => {
  const t = render();
  const all = royal(t);
  const firstExchange = all.findIndex((x) => x.r.exchange);
  const lastRoll = all.map((x) => !x.r.exchange).lastIndexOf(true);
  assert.ok(firstExchange > lastRoll, "exchange rows are not last");
  assert.strictEqual(all.filter((x) => x.r.exchange).length, 10);
  assert.ok(all.filter((x) => !x.r.exchange).every((x) => !["Crystal", "Dragon"].includes(x.r.rollType)));
});

test("rows render without error and carry the Exchange headers", () => {
  const t = render();
  assert.ok(t.html.every((h) => !h.startsWith("ERR:")), t.html.find((h) => h.startsWith("ERR:")));
  const first = royal(t).find((x) => x.r.exchange).h;
  assert.ok(first.includes('data-header-cat="Exchange"'), "category header missing");
  assert.ok(first.includes("Energy Manipulator exchange (pick, not a roll)"));
  assert.ok(first.includes('data-header-roll="Energy Manipulator"') && first.includes('data-roll-cat="Exchange"'));
  assert.ok(first.includes('data-roll-key="Exchange:Energy Manipulator"'));
});

// ── One roll-group for the whole exchange ───────────────────────────────────
const plain = (h) => h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const countOf = (s, needle) => s.split(needle).length - 1;
/** A market whose fragment prices differ per tier, so margin order != tier order. */
function skewedMarket() {
  const md = market();
  const price = { 4: 3000, 5: 900, 6: 2500, 7: 400, 8: 1500 };
  for (const family of ["Crystal", "Dragon"]) {
    for (const tier of [4, 5, 6, 7, 8]) {
      const p = price[tier] * (family === "Dragon" ? 1.3 : 1);
      X.CITIES.forEach((c) => { md[fragId(family, tier)][c] = entry(p, p + 100); });
    }
  }
  return md;
}

[
  { name: "royal section", zone: false, section: "royal" },
  { name: "zone routes merged section", zone: true, section: null },
].forEach(({ name, zone, section }) => {
  const exchangeOf = () => {
    X._els["include-caerleon"].checked = zone;
    const t = render(skewedMarket());
    const ex = t.data.map((r, i) => ({ r, h: t.html[i] }))
      .filter((x) => x.r.exchange && (section === null || x.r.section === section));
    return { ex, all: ex.map((x) => x.h).join("\n") };
  };

  test(`${name}: exactly one Exchange roll-group header "Energy Manipulator"`, () => {
    const { ex, all } = exchangeOf();
    assert.strictEqual(ex.length, 10);
    assert.strictEqual(countOf(all, "data-header-roll="), 1, "expected ONE roll-group header");
    assert.strictEqual(countOf(all, 'data-header-roll="Energy Manipulator"'), 1);
    const header = all.match(/<tr data-header-roll="Energy Manipulator"[\s\S]*?<\/tr>/)[0];
    assert.ok(header.includes('data-roll-cat="Exchange"'));
    const text = plain(header);
    assert.ok(text.includes("Energy Manipulator"), text);
    assert.ok(text.includes("(50 frags / exchange)"), text);
  });

  test(`${name}: exactly one Exchange category band`, () => {
    assert.strictEqual(countOf(exchangeOf().all, 'data-header-cat="Exchange"'), 1);
  });

  test(`${name}: all 10 rows share the one roll key, no per-tier exchange header`, () => {
    const { ex, all } = exchangeOf();
    assert.strictEqual(countOf(all, 'data-roll-key="Exchange:Energy Manipulator"'), 10);
    assert.strictEqual(countOf(all, 'data-roll-key="Exchange:T'), 0, "per-tier roll key left");
    ["Crystal", "Dragon"].forEach((f) => [4, 5, 6, 7, 8].forEach((tr) =>
      assert.ok(!all.includes(`data-header-roll="T${tr} ${f}"`), `T${tr} ${f} header`)));
    ex.forEach(({ h }) => assert.ok(h.includes('data-filter-tier="')));
  });

  test(`${name}: each row's item cell names its fragment tier and family`, () => {
    const { ex } = exchangeOf();
    ex.forEach(({ r, h }) => {
      const cell = plain(h.match(/<td class="cell-item">[\s\S]*?<\/td>/)[0]);
      const family = r.rollType === "Crystal" ? "Crystal Shard" : "Fire Dragon Scales";
      assert.ok(cell.includes(`T${r.tier} ${family}`), `T${r.tier} ${r.rollType}: ${cell}`);
    });
  });

  test(`${name}: exchange rows are ordered by margin descending`, () => {
    const { ex } = exchangeOf();
    const margins = ex.map((x) => x.r.margin);
    assert.ok(new Set(margins).size > 3, "fixture: margins should differ");
    for (let i = 1; i < margins.length; i++) {
      assert.ok(margins[i - 1] >= margins[i], `not margin-desc at ${i}: ${margins.join(",")}`);
    }
  });
});

test("the exchange rows carry no roll, salvage or strategy markup", () => {
  const t = render();
  royal(t).filter((x) => x.r.exchange).forEach(({ h }) => {
    assert.ok(!/reroll|salvage|Hunt mode|✓ sell|skip/i.test(h.replace(/<[^>]*>/g, " ")),
      "roll vocabulary leaked into an exchange row");
  });
});

test("one Crystal and one Dragon row: editable cells and tier hook", () => {
  const t = render();
  const crystal = royal(t).find((x) => x.r.exchange && x.r.rollType === "Crystal" && x.r.tier === 6);
  const dragon = royal(t).find((x) => x.r.exchange && x.r.rollType === "Dragon" && x.r.tier === 6);
  for (const x of [crystal, dragon]) {
    assert.ok(x.h.includes(`data-item-id="${x.r.fragmentId}"`), "fragment cell is not click-to-set");
    assert.ok(x.h.includes(`data-item-id="${x.r.artId}"`), "sell cell is not click-to-set");
    assert.ok(x.h.includes('data-filter-tier="6"'));
    assert.ok(x.h.includes(x.r.artName));
    assert.ok(x.h.includes("50×"));
  }
  assert.ok(crystal.h.includes("Crystal Shard") && dragon.h.includes("Fire Dragon Scales"));
  console.log("    Crystal row: " + crystal.h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  console.log("    Dragon  row: " + dragon.h.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
});

test("row keys are unique across the whole table and not price-derived", () => {
  const t = render();
  const keys = t.data.map((r) => X.getRowKey(r, "rolling-table"));
  assert.strictEqual(new Set(keys).size, keys.length, "duplicate row keys");
  const a = t.data.find((r) => r.exchange && r.rollType === "Crystal" && r.tier === 5);
  const k1 = X.getRowKey(a, "rolling-table");
  const md = market();
  const last = picksOf("Crystal", 5).slice(-1)[0];
  md[last].Martlock = entry(1, 999999);
  const b = render(md).data.find((r) => r.exchange && r.rollType === "Crystal" && r.tier === 5);
  assert.notStrictEqual(a.artId, b.artId, "fixture: the best pick should have moved");
  assert.strictEqual(X.getRowKey(b, "rolling-table"), k1);
});

test("an unpriced exchange row renders a no-data cell, others unaffected", () => {
  const md = market();
  delete md[fragId("Dragon", 8)];
  const t = render(md);
  const x = royal(t).find((y) => y.r.exchange && y.r.rollType === "Dragon" && y.r.tier === 8);
  assert.ok(x.h.includes("no data"));
  assert.strictEqual(royal(t).filter((y) => y.r.exchange && !y.r.hasNoFragData).length, 9);
});

test("a Buy City pick buys the fragment there; a Sell City pick sells there", () => {
  X.setTableBuyCity("rolling-table", "Brecilien");
  X.setTableSellCity("rolling-table", "Martlock");
  const t = render();
  const ex = t.data.filter((r) => r.exchange && r.section === "royal");
  assert.strictEqual(ex.length, 10);
  assert.ok(ex.every((r) => r.fragBuyCity === "Brecilien" && r.bestSellCity === "Martlock"));
});

test("a pick the section cannot trade at drops the whole exchange section too", () => {
  X.setTableSellCity("rolling-table", "Lymhurst");
  const t = render();
  assert.strictEqual(t.data.filter((r) => r.exchange && r.section === "caerleon").length, 0);
});

test("zone routes on: one merged section, 10 exchange rows", () => {
  X._els["include-caerleon"].checked = true;
  const t = render();
  assert.strictEqual(t.data.filter((r) => r.exchange).length, 10);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
