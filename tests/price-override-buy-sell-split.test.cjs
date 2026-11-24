/**
 * Test: per-city price overrides hold both order prices plus an ACTIVE pick.
 *
 * The override store keeps, per (itemId, city):
 *   { buyOrder, sellOrder, use }
 * `use` is one of three:
 *   "auto"        follow the global Instant/Market toggle, exactly as an
 *                 unedited cell does. The default for an entry holding both
 *                 prices.
 *   "buy"/"sell"  PIN the entry to that field whatever the toggle says — how
 *                 you value one material at its ask to model an instant buy
 *                 while everything else stays on market orders.
 *
 * Bug (reported): "in some tables i cant switch buying price to instant buy
 * price - it resets to buy orders price". The pin was the only mode AND it was
 * written automatically from whatever the toggle said when the user typed a
 * price — so every cell they had ever edited stopped answering the Pricing
 * Model radios for good. Entries saved under that rule and carrying BOTH prices
 * are migrated to "auto"; single-price ones keep their pin, because there is
 * nothing for the toggle to choose between.
 *
 *   getOverridePrice(itemId, city, side) -> the value for that calling side
 *   getOverrideField(itemId, city, side) -> a raw stored field (editor prefill)
 *   getOverrideUse(itemId, city) -> "auto" | "buy" | "sell" | null
 *
 * Black-box over a faithful in-file replica of the utils.js logic (same pattern
 * as tests/order-type-pricing.test.cjs — no DOM, no live API).
 *
 * Run: node tests/price-override-buy-sell-split.test.cjs
 */

const assert = require("assert");

// ── DOM / order-type mock ────────────────────────────────────────────────
let _instantChecked = false; // default: market
function getOrderType() {
  return _instantChecked ? "instant" : "market";
}
function setMode(mode) {
  _instantChecked = mode === "instant";
}

// ── Replica of the override store (mirrors js/utils.js) ──────────────────
let priceOverrides = {};

function normalizeOverrideEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  if (typeof entry.buyOrder === "number") out.buyOrder = entry.buyOrder;
  if (typeof entry.sellOrder === "number") out.sellOrder = entry.sellOrder;
  if (typeof entry.price === "number") {
    if (out.buyOrder === undefined) out.buyOrder = entry.price;
    if (out.sellOrder === undefined) out.sellOrder = entry.price;
  }
  if (out.buyOrder === undefined && out.sellOrder === undefined) return null;
  const bothSides = out.buyOrder !== undefined && out.sellOrder !== undefined;
  if (entry.use === "buy" || entry.use === "sell" || entry.use === "auto") {
    out.use = entry.use;
  } else {
    out.use = bothSides ? "auto" : (out.buyOrder !== undefined ? "buy" : "sell");
  }
  if (out.use === "buy" && out.buyOrder === undefined) out.use = "sell";
  if (out.use === "sell" && out.sellOrder === undefined) out.use = "buy";
  return out;
}

// One-shot migration of entries saved before "auto" existed: a stored pin on an
// entry holding BOTH prices was written automatically, not chosen.
function migrateOverridesToAuto() {
  let touched = false;
  Object.values(priceOverrides).forEach((cities) => {
    Object.values(cities || {}).forEach((e) => {
      if (!e || e.use === "auto") return;
      if (typeof e.buyOrder === "number" && typeof e.sellOrder === "number") {
        e.use = "auto";
        touched = true;
      }
    });
  });
  return touched;
}

function setOverrideEntry(itemId, city, { buyOrder, sellOrder, use }) {
  if (!priceOverrides[itemId]) priceOverrides[itemId] = {};
  const e = {};
  if (typeof buyOrder === "number" && buyOrder > 0) e.buyOrder = buyOrder;
  if (typeof sellOrder === "number" && sellOrder > 0) e.sellOrder = sellOrder;
  if (use === "buy" || use === "sell" || use === "auto") e.use = use;
  const activePresent = e.use === "buy" ? e.buyOrder !== undefined
    : e.use === "sell" ? e.sellOrder !== undefined
      : e.use === "auto" ? (e.buyOrder !== undefined || e.sellOrder !== undefined)
        : false;
  if (activePresent) priceOverrides[itemId][city] = e;
  else delete priceOverrides[itemId][city];
}

function clearOverridePrice(itemId, city) {
  if (priceOverrides[itemId]) delete priceOverrides[itemId][city];
}

// Mirrors the editor's ✗ button: "remove the override at this city" drops the
// WHOLE entry (both order sides). It used to clear only the clicked side and
// keep the other, but the editor prefills both inputs from the market, so a
// phantom opposite-side order would survive and the price could never clear.
function clearOverrideButton(itemId, city) {
  clearOverridePrice(itemId, city);
}

// Mirrors the editor's commit (js/app.js persistOverrides): the ACTIVE side is
// always stored; the INACTIVE side is stored only when the user deliberately
// set it — i.e. it was edited this session (`dirty`) or already carried an
// override. Both inputs are PREFILLED from the live market, so without this
// guard the untouched inactive field would freeze its market price in as a
// phantom override the ✗ clear can't remove (it preserves the "other side").
// `use` may now be "auto", in which case either side's value makes the entry
// real — the toggle picks between whatever is stored.
function commitOverride(itemId, city, { buyVal, sellVal, use, buyDirty, sellDirty }) {
  const buyHasVal = typeof buyVal === "number" && buyVal > 0;
  const sellHasVal = typeof sellVal === "number" && sellVal > 0;
  const keepBuy = use === "buy" || buyDirty
    || getOverrideField(itemId, city, "buy") !== null;
  const keepSell = use === "sell" || sellDirty
    || getOverrideField(itemId, city, "sell") !== null;
  const activeHasVal = use === "buy" ? buyHasVal
    : use === "sell" ? sellHasVal
      : (keepBuy && buyHasVal) || (keepSell && sellHasVal);
  if (!activeHasVal) {
    clearOverridePrice(itemId, city);
    return;
  }
  setOverrideEntry(itemId, city, {
    buyOrder: keepBuy && buyHasVal ? buyVal : undefined,
    sellOrder: keepSell && sellHasVal ? sellVal : undefined,
    use,
  });
}

function getOverrideField(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e) return null;
  return (side === "buy" ? e.buyOrder : e.sellOrder) ?? null;
}
function getOverrideUse(itemId, city) {
  return priceOverrides[itemId]?.[city]?.use ?? null;
}
function resolveOverrideSide(entry, city, side) {
  if (!entry || !entry.use) return null;
  if (entry.use !== "auto") return entry.use;
  const instant = getOrderType() === "instant";
  if (side === "sell") return instant ? "buy" : "sell";
  return instant ? "sell" : "buy";
}
function getOverridePrice(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e || !e.use) return null;
  const pick = resolveOverrideSide(e, city, side);
  const v = pick === "buy" ? e.buyOrder : e.sellOrder;
  if (typeof v === "number") return v;
  if (e.use !== "auto") return null;
  const other = pick === "buy" ? e.sellOrder : e.buyOrder;
  return typeof other === "number" ? other : null;
}
// Flipping's side-specific read: a pin answers with the field asked for, an
// "auto" entry has no side to pin and follows the toggle.
function getOverrideSidePrice(itemId, city, side) {
  const e = priceOverrides[itemId]?.[city];
  if (!e) return null;
  if (e.use === "auto") return getOverridePrice(itemId, city, side);
  return getOverrideField(itemId, city, side);
}

// ── Replica of getBuyPrice / getSellPrice ────────────────────────────────
function getBuyPrice(itemData, city, itemId, sideMode) {
  const ov = itemId
    ? (sideMode ? getOverrideSidePrice(itemId, city, "buy") : getOverridePrice(itemId, city, "buy"))
    : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return (getOrderType() === "instant" ? itemData[city].sell_price : itemData[city].buy_price) || 0;
}
function getSellPrice(itemData, city, itemId, sideMode) {
  const ov = itemId
    ? (sideMode ? getOverrideSidePrice(itemId, city, "sell") : getOverridePrice(itemId, city, "sell"))
    : null;
  if (ov !== null) return ov;
  if (!itemData || !itemData[city]) return 0;
  return (getOrderType() === "instant" ? itemData[city].buy_price : itemData[city].sell_price) || 0;
}

// ── Test harness ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    priceOverrides = {};
    setMode("market");
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

const MD = {
  Martlock: { buy_price: 100, sell_price: 150, volume_24h: 100 },
  "Black Market": { buy_price: 5000, sell_price: 6000, volume_24h: 100 },
};

console.log("Price Override Active-Order Tests\n");

// ── store / getters ───────────────────────────────────────────────────────
test("setOverrideEntry stores both fields and the active pick", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "buy" });
  assert.strictEqual(getOverrideField("X", "Martlock", "buy"), 120);
  assert.strictEqual(getOverrideField("X", "Martlock", "sell"), 145);
  assert.strictEqual(getOverrideUse("X", "Martlock"), "buy");
  assert.strictEqual(getOverridePrice("X", "Martlock"), 120, "active = buy field");
});

test("use=sell makes the sell-order value active", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "sell" });
  assert.strictEqual(getOverridePrice("X", "Martlock"), 145);
});

test("no override -> null everywhere", () => {
  assert.strictEqual(getOverridePrice("X", "Martlock"), null);
  assert.strictEqual(getOverrideUse("X", "Martlock"), null);
  assert.strictEqual(getOverrideField("X", "Martlock", "buy"), null);
});

test("entry whose pinned field has no value is dropped (treated as no override)", () => {
  setOverrideEntry("X", "Martlock", { sellOrder: 145, use: "buy" }); // buy picked but no buy value
  assert.strictEqual(getOverridePrice("X", "Martlock"), null);
  assert.strictEqual(getOverrideUse("X", "Martlock"), null);
});

// ── "auto": the entry follows the Pricing Model toggle ────────────────────
test("auto buys at the bid under Market Orders and the ask under Instant", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "auto" });
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 120, "market buy = buy order");
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 145, "instant buy = sell order");
});

test("auto sells at the ask under Market Orders and the bid under Instant", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "auto" });
  setMode("market");
  assert.strictEqual(getSellPrice(MD, "Martlock", "X"), 145, "listing a sell order");
  setMode("instant");
  assert.strictEqual(getSellPrice(MD, "Martlock", "X"), 120, "selling into the bid");
});

test("auto at the Black Market follows the toggle like any other city", () => {
  // The Black Market takes sell orders too: list your own price and wait for
  // the merchant demand to reach it. See tests/black-market-order-type.test.cjs.
  setOverrideEntry("X", "Black Market", { buyOrder: 5200, sellOrder: 6100, use: "auto" });
  setMode("market");
  assert.strictEqual(getSellPrice(MD, "Black Market", "X"), 6100, "listing a sell order");
  setMode("instant");
  assert.strictEqual(getSellPrice(MD, "Black Market", "X"), 5200, "filling its buy order");
});

test("auto with only one price stored falls back to it rather than reading as nothing", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, use: "auto" });
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 120,
    "instant would want the ask, but only the bid was ever typed");
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 120);
});

test("a pin still beats the toggle — that is what a pin is for", () => {
  setOverrideEntry("MAT", "Martlock", { buyOrder: 100, sellOrder: 150, use: "sell" });
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "MAT"), 150, "modelling an instant buy");
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "MAT"), 150);
});

// ── Flipping's side-specific reads ────────────────────────────────────────
test("sideMode on an AUTO entry follows the toggle like every other read", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "auto" });
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X", true), 120);
  assert.strictEqual(getSellPrice(MD, "Martlock", "X", true), 145);
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X", true), 145);
  assert.strictEqual(getSellPrice(MD, "Martlock", "X", true), 120);
});

test("sideMode on a PINNED entry still reads each side's own field", () => {
  // Flipping buys and sells the same (item, city) in one row, so the two cells
  // must stay independent whichever side the pin names.
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "buy" });
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X", true), 120);
  assert.strictEqual(getSellPrice(MD, "Martlock", "X", true), 145);
});

// ── active override wins and ignores the order-type toggle ────────────────
test("active = buy: both buying and selling use the buy-order value, in any mode", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "buy" });
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 120);
  assert.strictEqual(getSellPrice(MD, "Martlock", "X"), 120);
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 120, "toggle ignored for active override");
  assert.strictEqual(getSellPrice(MD, "Martlock", "X"), 120, "toggle ignored for active override");
});

test("active = sell: model an instant buy by valuing a mat at its sell-order (ask)", () => {
  // Default would buy at buy_price (100); picking the sell order models paying
  // the current ask (150) for an instant buy.
  setOverrideEntry("MAT", "Martlock", { buyOrder: 100, sellOrder: 150, use: "sell" });
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "MAT"), 150, "instant-buy cost = sell order");
});

test("switching the active pick changes the value used", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "buy" });
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 120);
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "sell" });
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 145);
});

test("non-overridden item still follows the order-type toggle", () => {
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "NOPE"), 100, "market buy = buy_price");
  assert.strictEqual(getSellPrice(MD, "Martlock", "NOPE"), 150, "market sell = sell_price");
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "NOPE"), 150, "instant buy = sell_price");
  assert.strictEqual(getSellPrice(MD, "Martlock", "NOPE"), 100, "instant sell = buy_price");
});

// ── clear (editor ✗ button) drops the WHOLE entry ────────────────────────────
test("✗ clears the whole entry even when both order sides are set", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, sellOrder: 145, use: "buy" });
  clearOverrideButton("X", "Martlock");
  assert.strictEqual(getOverridePrice("X", "Martlock"), null, "override gone");
  assert.strictEqual(getOverrideField("X", "Martlock", "buy"), null);
  assert.strictEqual(getOverrideField("X", "Martlock", "sell"), null);
});

test("✗ clears a single-side override", () => {
  setOverrideEntry("X", "Martlock", { buyOrder: 120, use: "buy" });
  clearOverrideButton("X", "Martlock");
  assert.strictEqual(getOverridePrice("X", "Martlock"), null);
});

test("✗ on a phantom-sell entry (pre-fix saved data) removes it — the bug", () => {
  // Reproduces the refining-table report: an override saved before the persist
  // fix carries a frozen market sell_price. The old side-specific clear kept
  // that phantom and repointed `use` to it, so the price never cleared. A full
  // clear wipes it.
  setOverrideEntry("RAW", "Lymhurst", { buyOrder: 300000, sellOrder: 295000, use: "buy" });
  clearOverrideButton("RAW", "Lymhurst");
  assert.strictEqual(getOverridePrice("RAW", "Lymhurst"), null, "no lingering phantom sell");
  assert.strictEqual(getOverrideField("RAW", "Lymhurst", "sell"), null);
});

// ── editor commit: untouched prefill must not freeze in (refining-table bug) ──
// Both editor inputs are prefilled from the market, so a buy-only edit must NOT
// store the prefilled market sell_price as a phantom override.
test("buy-only commit does not freeze the prefilled market sell price", () => {
  // User opens the buy cell, types 100 in Buy, leaves Sell at its prefill (150).
  commitOverride("RAW", "Martlock", {
    buyVal: 100, sellVal: 150, use: "buy", buyDirty: true, sellDirty: false,
  });
  assert.strictEqual(getOverrideField("RAW", "Martlock", "buy"), 100);
  assert.strictEqual(getOverrideField("RAW", "Martlock", "sell"), null, "no phantom sell");
  assert.strictEqual(getOverridePrice("RAW", "Martlock"), 100);
});

test("clearing a buy-only override (after prefill commit) fully removes it", () => {
  commitOverride("RAW", "Martlock", {
    buyVal: 100, sellVal: 150, use: "buy", buyDirty: true, sellDirty: false,
  });
  clearOverrideButton("RAW", "Martlock"); // the ✗ button
  assert.strictEqual(getOverridePrice("RAW", "Martlock"), null, "override gone");
  assert.strictEqual(getOverrideField("RAW", "Martlock", "buy"), null);
  assert.strictEqual(getOverrideField("RAW", "Martlock", "sell"), null);
});

test("no-change commit (nothing typed) stores active side only", () => {
  // Opening the cell and committing without typing keeps the effective price,
  // but only on the active side — no phantom on the other side.
  commitOverride("RAW", "Martlock", {
    buyVal: 100, sellVal: 150, use: "buy", buyDirty: false, sellDirty: false,
  });
  assert.strictEqual(getOverrideField("RAW", "Martlock", "buy"), 100);
  assert.strictEqual(getOverrideField("RAW", "Martlock", "sell"), null);
});

test("deliberately editing BOTH sides keeps both until ✗ clears them together", () => {
  commitOverride("X", "Martlock", {
    buyVal: 100, sellVal: 130, use: "buy", buyDirty: true, sellDirty: true,
  });
  assert.strictEqual(getOverrideField("X", "Martlock", "buy"), 100);
  assert.strictEqual(getOverrideField("X", "Martlock", "sell"), 130);
  clearOverrideButton("X", "Martlock");
  assert.strictEqual(getOverridePrice("X", "Martlock"), null);
});

test("editing the inactive side alone (dirty) persists it alongside the active", () => {
  // Active = sell, but the user also typed a deliberate buy price.
  commitOverride("X", "Martlock", {
    buyVal: 90, sellVal: 150, use: "sell", buyDirty: true, sellDirty: false,
  });
  assert.strictEqual(getOverrideField("X", "Martlock", "buy"), 90, "dirty buy kept");
  assert.strictEqual(getOverrideField("X", "Martlock", "sell"), 150);
  assert.strictEqual(getOverridePrice("X", "Martlock"), 150, "active = sell");
});

// ── migration ──────────────────────────────────────────────────────────────
test("legacy {price:N} migrates to both fields following the toggle, value N", () => {
  const m = normalizeOverrideEntry({ price: 200 });
  assert.deepStrictEqual(m, { buyOrder: 200, sellOrder: 200, use: "auto" });
  priceOverrides = { X: { Martlock: m } };
  assert.strictEqual(getOverridePrice("X", "Martlock"), 200);
});

test("interim {buyOrder,sellOrder} (no use) follows the toggle", () => {
  assert.deepStrictEqual(
    normalizeOverrideEntry({ buyOrder: 1, sellOrder: 2 }),
    { buyOrder: 1, sellOrder: 2, use: "auto" },
  );
  // single-field entry pins to the present field — nothing to choose between
  assert.deepStrictEqual(
    normalizeOverrideEntry({ sellOrder: 9 }),
    { sellOrder: 9, use: "sell" },
  );
  assert.strictEqual(normalizeOverrideEntry({}), null);
  assert.strictEqual(normalizeOverrideEntry(null), null);
});

test("normalizeOverrideEntry honors an explicit use, including auto", () => {
  assert.deepStrictEqual(
    normalizeOverrideEntry({ buyOrder: 10, sellOrder: 20, use: "sell" }),
    { buyOrder: 10, sellOrder: 20, use: "sell" },
  );
  assert.deepStrictEqual(
    normalizeOverrideEntry({ buyOrder: 10, sellOrder: 20, use: "auto" }),
    { buyOrder: 10, sellOrder: 20, use: "auto" },
  );
});

test("a pre-auto two-sided pin is released — it was never a deliberate choice", () => {
  // The reported bug: `use` was written from whatever the toggle said when the
  // user typed a price, so an edited cell ignored the radios ever after.
  priceOverrides = { X: { Martlock: { buyOrder: 120, sellOrder: 145, use: "buy" } } };
  assert.strictEqual(migrateOverridesToAuto(), true);
  assert.strictEqual(getOverrideUse("X", "Martlock"), "auto");
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 145, "instant buy now reaches the ask");
});

test("a pre-auto ONE-sided pin is kept — there is nothing to switch to", () => {
  priceOverrides = { X: { Martlock: { buyOrder: 120, use: "buy" } } };
  assert.strictEqual(migrateOverridesToAuto(), false);
  assert.strictEqual(getOverrideUse("X", "Martlock"), "buy");
});

test("the migration is idempotent and leaves auto entries alone", () => {
  priceOverrides = { X: { Martlock: { buyOrder: 120, sellOrder: 145, use: "auto" } } };
  assert.strictEqual(migrateOverridesToAuto(), false);
  assert.strictEqual(getOverrideUse("X", "Martlock"), "auto");
});

// ── the editor's three states ────────────────────────────────────────────
test("a pin set from the editor survives — it IS a deliberate choice", () => {
  commitOverride("X", "Martlock", {
    buyVal: 100, sellVal: 130, use: "sell", buyDirty: true, sellDirty: true,
  });
  assert.strictEqual(getOverrideUse("X", "Martlock"), "sell");
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 130, "still pinned to the ask");
});

test("committing under auto stores what was typed and follows the toggle", () => {
  commitOverride("X", "Martlock", {
    buyVal: 100, sellVal: 130, use: "auto", buyDirty: true, sellDirty: true,
  });
  assert.strictEqual(getOverrideUse("X", "Martlock"), "auto");
  setMode("market");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 100);
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "X"), 130);
});

test("a bare open-and-commit under auto stores NO phantom override", () => {
  // Both inputs are prefilled from the market; without the dirty guard this
  // would freeze both market prices in as an override that never clears.
  commitOverride("RAW", "Martlock", {
    buyVal: 100, sellVal: 150, use: "auto", buyDirty: false, sellDirty: false,
  });
  assert.strictEqual(getOverridePrice("RAW", "Martlock"), null);
});

test("under auto a one-sided edit stores only that side", () => {
  commitOverride("RAW", "Martlock", {
    buyVal: 90, sellVal: 150, use: "auto", buyDirty: true, sellDirty: false,
  });
  assert.strictEqual(getOverrideField("RAW", "Martlock", "buy"), 90);
  assert.strictEqual(getOverrideField("RAW", "Martlock", "sell"), null, "no phantom sell");
  setMode("instant");
  assert.strictEqual(getBuyPrice(MD, "Martlock", "RAW"), 90, "falls back to the only price stored");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
