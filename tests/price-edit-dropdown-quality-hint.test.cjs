/**
 * The price editor's city dropdown (js/price-edit-dropdown.js buildCityOptions)
 * hints a Good+ ask when a city's NORMAL book has no ask.
 *
 * Reported: Elder's Shadowcaller (T8_MAIN_CURSEDSTAFF_AVALON@4) at Fort
 * Sterling read "Fort Sterling — — · 3,999,999": the asks were captured under
 * quality 4 (29,999,980), the Normal-keyed popup reads only the quality-1
 * projection, so the user saw "only buy orders" on a market full of asks.
 *
 * Contract (display only — the Normal cell's data is never rewritten):
 *   - Normal ask 0/absent + a Q2..Q5 ask in lastQualityMarketData for the same
 *     item and city → the option's sell side shows that ask with its quality
 *     name, e.g. "29,999,980 (Excellent)", instead of "—";
 *   - several qualities → the CHEAPEST ask (a tie keeps the lower quality);
 *   - the hint is exposed as option.sellHint = { price, quality }; option.sell
 *     (the Normal ask) and option.price (the default-selection price) stay 0,
 *     so the hint never ranks a city nor reaches the SELL ORDER input;
 *   - Normal ask present, or a sell override, or a quality-keyed popup
 *     (ITEM#Qn) → unchanged, no hint;
 *   - the bid side is never touched;
 *   - a missing quality map / item / city, and zero, negative or non-numeric
 *     asks, mean "no hint" — never a throw.
 *
 * Quality names follow the planner's sell label: 2 Good, 3 Outstanding,
 * 4 Excellent, 5 Masterpiece.
 *
 * Run: node tests/price-edit-dropdown-quality-hint.test.cjs
 */

const assert = require("assert");

// --- Globals the builder reads at call time (same stubs as the sibling tests).
let _priceOverrides = {};
globalThis.CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Martlock"];
globalThis.SELL_CITIES = [...globalThis.CITIES, "Black Market"];
globalThis.FOOD_ITEMS = { meat: [], plants: [], chocolate: [] };
globalThis.getOverridePrice = (itemId, city) => {
  const e = _priceOverrides[itemId]?.[city];
  if (e == null || !e.use) return null;
  const v = e.use === "buy" ? e.buyOrder : e.sellOrder;
  return typeof v === "number" ? v : null;
};
globalThis.getOverrideField = (itemId, city, side) => {
  const e = _priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
};
globalThis.getOrderType = () => "market";
globalThis.getItemDisplayName = (id) => id;

const { buildCityOptions, cityOptionHtml } = require("../js/price-edit-dropdown.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  finally { _priceOverrides = {}; globalThis.lastQualityMarketData = {}; }
}

const FS = "Fort Sterling";
const ITEM = "T8_MAIN_CURSEDSTAFF_AVALON@4";
const QUALITY_NAMES = { 2: "Good", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece" };

// The reported Normal book: a bid, no ask (sell_seen stamped).
const NORMAL_BID_ONLY = { [ITEM]: { [FS]: { buy_price: 3999999, sell_price: 0, sell_seen: "2026-10-01T10:00:00Z" } } };

function qmap(byQuality, item = ITEM, city = FS) {
  const book = {};
  for (const [q, cell] of Object.entries(byQuality)) book[q] = { [city]: cell };
  return { [item]: book };
}

function optionFor(itemId, marketData, city = FS) {
  const built = buildCityOptions(itemId, "sell", marketData, { preferCity: city });
  const opt = built.options.find((o) => o.city === city);
  assert.ok(opt, `no option for ${city}`);
  return opt;
}

/** The sell segment of a label: between "City — " and " · ". */
function sellSegment(label) {
  const head = label.indexOf(" — ");
  const sep = label.indexOf(" · ", head);
  assert.ok(head >= 0 && sep > head, "label is not a two-sided order row: " + label);
  return label.slice(head + 3, sep);
}
function buySegment(label) {
  const sep = label.indexOf(" · ");
  return label.slice(sep + 3).split(" · ")[0];
}

console.log("price-edit dropdown — Good+ ask hint on an empty Normal ask\n");

// ── The hint, per quality ────────────────────────────────────────────────────

[
  { q: 2, ask: 30000000, text: "30,000,000" },
  { q: 3, ask: 29999990, text: "29,999,990" },
  { q: 4, ask: 29999980, text: "29,999,980" },
  { q: 5, ask: 31000000, text: "31,000,000" },
].forEach(({ q, ask, text }) => {
  test(`Normal ask 0 + q${q} ask → sell side shows "${text} (${QUALITY_NAMES[q]})"`, () => {
    globalThis.lastQualityMarketData = qmap({ [q]: { buy_price: 0, sell_price: ask } });
    const opt = optionFor(ITEM, NORMAL_BID_ONLY);
    const seg = sellSegment(opt.label);
    assert.ok(seg.includes(text), `hint price missing from "${opt.label}"`);
    assert.ok(seg.includes(`(${QUALITY_NAMES[q]})`), `quality tag missing from "${opt.label}"`);
    assert.ok(!/^—/.test(seg), `sell side still an em dash: "${opt.label}"`);
    assert.deepStrictEqual(opt.sellHint, { price: ask, quality: q });
  });
});

test("the reported row reads exactly 'Fort Sterling — 29,999,980 (Excellent) · 3,999,999'", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { buy_price: 0, sell_price: 29999980 } });
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.strictEqual(opt.label, "Fort Sterling — 29,999,980 (Excellent) · 3,999,999");
});

test("cityOptionHtml carries the hint price and its quality name", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  const html = cityOptionHtml(optionFor(ITEM, NORMAL_BID_ONLY));
  assert.ok(html.includes("29,999,980"), "hint price missing: " + html);
  assert.ok(html.includes("Excellent"), "quality tag missing: " + html);
  assert.ok(html.includes("3,999,999"), "bid missing: " + html);
});

test("a hint with NO Normal bid still renders a two-sided row, not 'no data'", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  const opt = optionFor(ITEM, { [ITEM]: { [FS]: { buy_price: 0, sell_price: 0 } } });
  assert.ok(!opt.label.includes("no data"), "label: " + opt.label);
  assert.ok(sellSegment(opt.label).includes("29,999,980 (Excellent)"), "label: " + opt.label);
  assert.ok(buySegment(opt.label).startsWith("—"), "bid stays an em dash: " + opt.label);
});

test("a hint with NO Normal entry at all for the city still shows", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  const opt = optionFor(ITEM, {});
  assert.ok(opt.label.includes("29,999,980 (Excellent)"), "label: " + opt.label);
});

// ── Cheapest across qualities ────────────────────────────────────────────────

[
  { name: "q2 dearer than q4 → q4 wins", book: { 2: 30000000, 4: 29999980 }, want: { price: 29999980, quality: 4 } },
  { name: "q2 cheaper than q4 → q2 wins", book: { 2: 25000000, 4: 29999980 }, want: { price: 25000000, quality: 2 } },
  { name: "q3/q4/q5 → the cheapest q5", book: { 3: 40000000, 4: 35000000, 5: 33000000 }, want: { price: 33000000, quality: 5 } },
  { name: "q2 and q4 tie → the lower quality", book: { 2: 29999980, 4: 29999980 }, want: { price: 29999980, quality: 2 } },
].forEach(({ name, book, want }) => {
  test(`cheapest ask wins: ${name}`, () => {
    const cells = {};
    Object.entries(book).forEach(([q, p]) => { cells[q] = { sell_price: p }; });
    globalThis.lastQualityMarketData = qmap(cells);
    const opt = optionFor(ITEM, NORMAL_BID_ONLY);
    assert.deepStrictEqual(opt.sellHint, want);
    assert.ok(sellSegment(opt.label).includes(`${want.price.toLocaleString()} (${QUALITY_NAMES[want.quality]})`),
      "label: " + opt.label);
  });
});

// ── Display only: the Normal values are untouched ───────────────────────────

test("the hint never becomes option.sell or option.price", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.strictEqual(opt.sell, 0, "option.sell is the Normal ask (what the SELL ORDER field reads)");
  assert.strictEqual(opt.price, 0, "option.price drives the default pick and stays the Normal price");
  assert.strictEqual(opt.buy, 3999999, "bid unchanged");
});

test("the hint never wins the default city pick (no preferCity)", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  const md = {
    [ITEM]: {
      [FS]: { buy_price: 3999999, sell_price: 0 },
      Lymhurst: { buy_price: 0, sell_price: 100 },
    },
  };
  const built = buildCityOptions(ITEM, "sell", md, {});
  assert.strictEqual(built.options[built.defaultIndex].city, "Lymhurst",
    "a hint is not a Normal ask and must not rank");
});

test("the bid side is printed exactly as before when a hint exists", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { buy_price: 5000000, sell_price: 29999980 } });
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.strictEqual(buySegment(opt.label), "3,999,999", "the Normal bid, never the q4 bid: " + opt.label);
});

// ── No hint: unchanged behaviour ─────────────────────────────────────────────

[
  {
    name: "Normal ask present → the Normal ask, no tag",
    market: { [ITEM]: { [FS]: { buy_price: 3999999, sell_price: 32000000 } } },
    quality: { 4: { sell_price: 29999980 } },
    sell: "32,000,000",
  },
  {
    name: "no asks at any quality → em dash",
    market: NORMAL_BID_ONLY,
    quality: { 4: { buy_price: 5000000, sell_price: 0 } },
    sell: "—",
  },
  {
    name: "quality map has no entry for the item → em dash",
    market: NORMAL_BID_ONLY,
    qualityMapOverride: { T4_OTHER: { 4: { [FS]: { sell_price: 1000 } } } },
    sell: "—",
  },
  {
    name: "quality map has the item but not this city → em dash",
    market: NORMAL_BID_ONLY,
    qualityMapOverride: { [ITEM]: { 4: { Lymhurst: { sell_price: 29999980 } } } },
    sell: "—",
  },
  {
    name: "a q1 ask inside the quality map is not a hint → em dash",
    market: NORMAL_BID_ONLY,
    quality: { 1: { sell_price: 29999980 } },
    sell: "—",
  },
  {
    name: "zero, negative and non-numeric asks are ignored → em dash",
    market: NORMAL_BID_ONLY,
    quality: { 2: { sell_price: 0 }, 3: { sell_price: -5 }, 4: { sell_price: "abc" }, 5: { sell_price: null } },
    sell: "—",
  },
].forEach(({ name, market, quality, qualityMapOverride, sell }) => {
  test(name, () => {
    globalThis.lastQualityMarketData = qualityMapOverride || qmap(quality);
    const opt = optionFor(ITEM, market);
    assert.strictEqual(sellSegment(opt.label), sell, "label: " + opt.label);
    assert.ok(!opt.sellHint, "no hint expected, got " + JSON.stringify(opt.sellHint));
    Object.values(QUALITY_NAMES).forEach((n) =>
      assert.ok(!opt.label.includes(`(${n})`), `stray quality tag "${n}": ${opt.label}`));
  });
});

test("zero/negative asks are skipped in favour of a real one", () => {
  globalThis.lastQualityMarketData = qmap({ 2: { sell_price: -1 }, 3: { sell_price: 0 }, 5: { sell_price: 33000000 } });
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.deepStrictEqual(opt.sellHint, { price: 33000000, quality: 5 });
});

test("lastQualityMarketData undefined → em dash, no throw", () => {
  delete globalThis.lastQualityMarketData;
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.strictEqual(sellSegment(opt.label), "—", "label: " + opt.label);
  assert.ok(!opt.sellHint);
});

test("lastQualityMarketData null → em dash, no throw", () => {
  globalThis.lastQualityMarketData = null;
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.strictEqual(sellSegment(opt.label), "—", "label: " + opt.label);
});

test("a stored sell override wins over the hint (no tag)", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  _priceOverrides = { [ITEM]: { [FS]: { sellOrder: 28000000, use: "sell" } } };
  const opt = optionFor(ITEM, NORMAL_BID_ONLY);
  assert.strictEqual(sellSegment(opt.label), "28,000,000", "label: " + opt.label);
  assert.ok(!opt.sellHint);
});

test("a quality-keyed popup (ITEM#Q4) never hints another quality", () => {
  // The Q4 popup's market slice is that quality's own book; an empty Q4 ask
  // there is the truth for Q4, not a gap to fill from Q2.
  globalThis.lastQualityMarketData = qmap({ 2: { sell_price: 30000000 } });
  const key = `${ITEM}#Q4`;
  const opt = optionFor(key, { [key]: { [FS]: { buy_price: 5000000, sell_price: 0 } } });
  assert.strictEqual(sellSegment(opt.label), "—", "label: " + opt.label);
  assert.ok(!opt.sellHint);
});

test("the buy-side dropdown is untouched by asks at other qualities", () => {
  globalThis.lastQualityMarketData = qmap({ 4: { sell_price: 29999980 } });
  const built = buildCityOptions(ITEM, "buy", NORMAL_BID_ONLY, { preferCity: FS });
  const opt = built.options.find((o) => o.city === FS);
  assert.strictEqual(opt.sell, 0);
  assert.strictEqual(opt.buy, 3999999);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
