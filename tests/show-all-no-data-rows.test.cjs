/**
 * Test: "Show All" checkbox should display items with no market routes.
 * Placeholder rows (margin === -1) must include `item` and render visible HTML.
 *
 * Run: node tests/show-all-no-data-rows.test.cjs
 */

const assert = require("assert");

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

console.log("Show All — No Data Rows Tests\n");

// ── Simulate the placeholder row creation (render-crafting.js lines 193-199) ──

function buildPlaceholderRow(item, materials, craftCity) {
  return {
    item,
    materials,
    craftCity,
    marginInfo: { margin: -1 },
    section: craftCity === "Caerleon" ? "caerleon" : "royal",
  };
}

// ── Stubs for render functions used by the formatter ──

function matPriceSpan(matId, city, price) {
  return `<span class="price-editable mat-price-inline" data-item-id="${matId}" data-city="${city || ""}">@ ${price > 0 ? price : "no data"} ea</span>`;
}

function priceTd(price, itemId, city) {
  const content = price > 0
    ? `${price}`
    : '<span style="color:#6b7280;font-style:italic">no data — click to set</span>';
  return `<td class="silver-val price-editable" data-item-id="${itemId}" data-city="${city}">${content}</td>`;
}

function getItemDisplayName(id) { return id; }

// ── Simulated override/force state ──
const _overrides = {};
const _cityForces = {};

function setOverridePrice(itemId, city, price) {
  if (!_overrides[itemId]) _overrides[itemId] = {};
  _overrides[itemId][city] = price;
}
function getOverridePrice(itemId, city) {
  return _overrides[itemId]?.[city] ?? null;
}
function setCityForce(itemId, side, city) {
  _cityForces[`${itemId}:${side}`] = city;
}
function getCityForce(itemId, side) {
  return _cityForces[`${itemId}:${side}`] || null;
}
function getBuyPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].buy_price || 0;
}
function getSellPrice(itemData, city, bounds, itemId) {
  const ov = itemId ? getOverridePrice(itemId, city) : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return itemData[city].sell_price || 0;
}

// ── Simulate the formatter logic (render-crafting.js line 280) ──

function formatNoDataRow(marginInfo, item, materials, craftCity, marketData) {
  if (marginInfo.margin === -1) {
    if (!item) return "";
    const noDataMatsHtml = materials
      .map((m) => {
        const name = getItemDisplayName(m.matId);
        const mCity = getCityForce(m.matId, "buy") || craftCity;
        const mPrice = getBuyPrice(marketData[m.matId], mCity, null, m.matId);
        return `${m.count}x ${name} ${matPriceSpan(m.matId, mCity, mPrice)}`;
      })
      .join("<br>");
    const sellCity = getCityForce(item.id, "sell") || craftCity;
    const sellPrice = getSellPrice(marketData[item.id], sellCity, null, item.id);
    const noDataTd = '<td style="color:#6b7280;font-style:italic">\u2014</td>';
    return `
        <tr>
          <td>${item.name}</td>
          <td style="color:#6b7280;font-style:italic">Craft: ${craftCity || "\u2014"}</td>
          <td>${noDataMatsHtml}</td>
          ${noDataTd}
          ${priceTd(sellPrice, item.id, sellCity)}
          ${noDataTd}
          ${noDataTd}
          ${noDataTd}
          ${noDataTd}
        </tr>`;
  }
  return null;
}

// ── Tests ──

test("placeholder row includes item property", () => {
  const item = { id: "T5_2H_TOOL_AXE_AVALON", name: "Expert's Avalonian Axe [T5]" };
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const row = buildPlaceholderRow(item, materials, "Lymhurst");
  assert.strictEqual(row.item, item);
});

test("placeholder row includes materials property", () => {
  const item = { id: "T5_2H_TOOL_AXE_AVALON", name: "Expert's Avalonian Axe [T5]" };
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const row = buildPlaceholderRow(item, materials, "Lymhurst");
  assert.strictEqual(row.materials, materials);
});

test("placeholder row includes craftCity", () => {
  const row = buildPlaceholderRow({}, [], "Lymhurst");
  assert.strictEqual(row.craftCity, "Lymhurst");
});

test("placeholder row has margin -1", () => {
  const row = buildPlaceholderRow({}, [], "Lymhurst");
  assert.strictEqual(row.marginInfo.margin, -1);
});

test("placeholder row section is 'royal' for non-Caerleon city", () => {
  const row = buildPlaceholderRow({}, [], "Lymhurst");
  assert.strictEqual(row.section, "royal");
});

test("placeholder row section is 'caerleon' for Caerleon", () => {
  const row = buildPlaceholderRow({}, [], "Caerleon");
  assert.strictEqual(row.section, "caerleon");
});

test("formatter renders item name for margin -1 row", () => {
  const item = { id: "T5_2H_TOOL_AXE_AVALON", name: "Expert's Avalonian Axe [T5]" };
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const html = formatNoDataRow({ margin: -1 }, item, materials, "Lymhurst", {});
  assert.ok(html.includes("Expert's Avalonian Axe [T5]"));
});

test("formatter renders craft city", () => {
  const item = { id: "T5_TEST", name: "Test" };
  const html = formatNoDataRow({ margin: -1 }, item, [], "Lymhurst", {});
  assert.ok(html.includes("Craft: Lymhurst"));
});

test("formatter renders clickable material price spans with craft city", () => {
  const item = { id: "T5_TEST", name: "Test" };
  const materials = [
    { matId: "T5_PLANKS", count: 6 },
    { matId: "T5_METALBAR", count: 2 },
  ];
  const html = formatNoDataRow({ margin: -1 }, item, materials, "Lymhurst", {});
  assert.ok(html.includes('class="price-editable mat-price-inline"'));
  assert.ok(html.includes('data-item-id="T5_PLANKS"'));
  assert.ok(html.includes('data-item-id="T5_METALBAR"'));
  assert.ok(html.includes('data-city="Lymhurst"'));
});

test("formatter shows override price instead of 'no data'", () => {
  const item = { id: "T5_TEST", name: "Test" };
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  setOverridePrice("T5_PLANKS", "Lymhurst", 1500);
  const html = formatNoDataRow({ margin: -1 }, item, materials, "Lymhurst", {});
  assert.ok(html.includes("1500"), "should show override price 1500");
  assert.ok(!html.includes("@ no data ea"), "should NOT show 'no data' for overridden material");
  // cleanup
  delete _overrides["T5_PLANKS"];
});

test("formatter shows API price from marketData", () => {
  const item = { id: "T5_TEST", name: "Test" };
  const materials = [{ matId: "T5_METALBAR", count: 2 }];
  const md = { T5_METALBAR: { Lymhurst: { buy_price: 800, sell_price: 900 } } };
  const html = formatNoDataRow({ margin: -1 }, item, materials, "Lymhurst", md);
  assert.ok(html.includes("800"), "should show API buy price");
});

test("formatter uses forced buy city for material", () => {
  const item = { id: "T5_TEST", name: "Test" };
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  setCityForce("T5_PLANKS", "buy", "Martlock");
  setOverridePrice("T5_PLANKS", "Martlock", 2000);
  const html = formatNoDataRow({ margin: -1 }, item, materials, "Lymhurst", {});
  assert.ok(html.includes('data-city="Martlock"'), "should use forced city");
  assert.ok(html.includes("2000"), "should show override at forced city");
  // cleanup
  delete _overrides["T5_PLANKS"];
  delete _cityForces["T5_PLANKS:buy"];
});

test("formatter uses forced sell city", () => {
  const item = { id: "T5_TEST", name: "Test" };
  setCityForce("T5_TEST", "sell", "Bridgewatch");
  setOverridePrice("T5_TEST", "Bridgewatch", 5000);
  const html = formatNoDataRow({ margin: -1 }, item, [], "Lymhurst", {});
  assert.ok(html.includes('data-city="Bridgewatch"'));
  assert.ok(html.includes("5000"));
  // cleanup
  delete _overrides["T5_TEST"];
  delete _cityForces["T5_TEST:sell"];
});

test("formatter renders clickable sell price cell with craft city", () => {
  const item = { id: "T5_2H_TOOL_AXE_AVALON", name: "Test" };
  const html = formatNoDataRow({ margin: -1 }, item, [], "Lymhurst", {});
  assert.ok(html.includes('data-item-id="T5_2H_TOOL_AXE_AVALON"'));
  assert.ok(html.includes('data-city="Lymhurst"'));
  assert.ok(html.includes("no data — click to set"));
});

test("material and sell city default to craft city, not empty", () => {
  const item = { id: "T5_TEST", name: "Test" };
  const materials = [{ matId: "T5_PLANKS", count: 6 }];
  const html = formatNoDataRow({ margin: -1 }, item, materials, "Martlock", {});
  assert.ok(!html.includes('data-city=""'));
  assert.ok(html.includes('data-city="Martlock"'));
});

test("formatter returns empty string when item is null", () => {
  const html = formatNoDataRow({ margin: -1 }, null, [], "Lymhurst", {});
  assert.strictEqual(html, "");
});

test("formatter returns null for non-placeholder rows", () => {
  const result = formatNoDataRow({ margin: 5.2 }, { id: "X", name: "Test" }, [], "", {});
  assert.strictEqual(result, null);
});

// ── Filter logic: margin -1 excluded when showAll is false ──

test("margin -1 rows filtered out when showAll is false", () => {
  const rows = [
    { marginInfo: { margin: 15 } },
    { marginInfo: { margin: -1 }, item: { name: "Avalonian Axe" } },
    { marginInfo: { margin: 3 } },
  ];
  const showAll = false;
  const filtered = showAll
    ? rows
    : rows.filter((row) => row.marginInfo && row.marginInfo.margin >= 0);
  assert.strictEqual(filtered.length, 2);
  assert.ok(filtered.every((r) => r.marginInfo.margin >= 0));
});

test("margin -1 rows included when showAll is true", () => {
  const rows = [
    { marginInfo: { margin: 15 } },
    { marginInfo: { margin: -1 }, item: { name: "Avalonian Axe" } },
    { marginInfo: { margin: 3 } },
  ];
  const showAll = true;
  const filtered = showAll
    ? rows
    : rows.filter((row) => row.marginInfo && row.marginInfo.margin >= 0);
  assert.strictEqual(filtered.length, 3);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
