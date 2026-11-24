// Crafting Planner — quality helpers: the planner's reads of the per-quality
// market book, plus the Sell-cell quality notes that report them.
//
// Split out of js/craft-planner-pricing.js (the quality-map reads behind
// computeCraftPlannerRow's sell loop and its no-sell rows) and
// js/render-craft-planner.js (the one-line quality notes under the Sell cell)
// for the repo's 800-line cap. Every app script here is a plain classic script
// sharing the browser's global scope: index.html loads this file deferred,
// immediately before js/craft-planner-pricing.js, and the declarations below
// are plain globals the two callers invoke directly.
//
// The book itself — global lastQualityMarketData (js/app.js, filled by a
// full-market scan) — is read typeof-guarded inside the readers, the same way
// every optional collaborator in the planner is read: a scope without the map
// means "no quality data", never a crash.
//
// Contents, in order: the quality-name constants; the pricing-side readers
// (_cpNoSellReferences, _cpQualityAskFor); the render-side note builders
// (_cpNoSellRefsNote, _cpSellQualityNote).

// ─── Constants ──────────────────────────────────────────────────────────────

// In-game quality names for the no-sell hint. A q2 (Good) ask is the cheapest
// exit the Good+ range offers, so it reads "Good+" — Good or better; q3-5 carry
// their own quality name.
const _CP_QUALITY_NAMES = { 2: "Good+", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece" };

// In-game quality names for the priced fallback label (row.sellQuality, set by
// computeCraftPlannerRow when the winning sale is a Good+ ask). Unlike the
// no-sell hint above — where q2 reads "Good+", Good-or-better — this label names
// the EXACT quality being sold, so a q2 sale reads plain "Good".
const _CP_SELL_QUALITY_LABELS = { 2: "Good", 3: "Outstanding", 4: "Excellent", 5: "Masterpiece" };

// ─── Pricing-side readers (called by js/craft-planner-pricing.js) ───────────

// Quality references for a no-sell row (plan.md): the sell loop priced nothing
// at ANY quality (see step 4 of computeCraftPlannerRow — since the sell-fallback
// round it USES the cheapest Good+ ask it finds, so a row that still dead-ends
// had no sale anywhere), yet the renderer's full quality map (global
// lastQualityMarketData, js/app.js — typeof-guarded like every other optional
// collaborator here) may still quote a Normal (q1) BUY order — the item trades,
// it just is not offered. That order is reported, never priced (sell legs are
// quality 1, tests/captured-buy-any-quality.test.cjs): this only lets the Sell
// cell say WHY it is empty. The Good+ ask half (higherAsk) predates the fallback
// and can no longer fire for a searched city — kept as a defensive report should
// the loop ever skip an ask it did not price.
//
// Scan restricted to `sellCities`, the exact list the sell loop just searched
// (pin/pick narrowed, cross-route-guarded): a market the row never searched is
// not a reference. Returns `{ normalBuy: {price, city}|null,
// higherAsk: {price, quality, city}|null }`, or null when the book holds
// neither — so an all-empty book keeps the row's exact today-shape.
function _cpNoSellReferences(itemId, craftCity, sellCities) {
  const book = (typeof lastQualityMarketData !== "undefined" && lastQualityMarketData)
    ? lastQualityMarketData[itemId]
    : null;
  if (!book) return null;
  let normalBuy = null, higherAsk = null;
  sellCities.forEach((sc) => {
    if (typeof isInvalidCrossRoute === "function" && isInvalidCrossRoute(craftCity, sc)) return;
    const q1 = book[1] && book[1][sc];
    const buy = q1 && q1.buy_price > 0 ? q1.buy_price : 0;
    if (buy > 0 && (!normalBuy || buy > normalBuy.price)) {
      normalBuy = { price: buy, city: sc };
    }
    for (let q = 2; q <= 5; q++) {
      const cell = book[q] && book[q][sc];
      const ask = cell && cell.sell_price > 0 ? cell.sell_price : 0;
      if (ask > 0 && (!higherAsk || ask < higherAsk.price)) {
        higherAsk = { price: ask, quality: q, city: sc };
      }
    }
  });
  return (normalBuy || higherAsk) ? { normalBuy, higherAsk } : null;
}

// The cheapest Good+ ask (q2-5 sell_price > 0) for one item in one city, from
// the same quality book. This is the per-city half of the sell loop's fallback
// in computeCraftPlannerRow (step 4): a city whose Normal book has no ask can
// still sell into a Good+ ask, and the cheapest one wins — ties keep the lower
// quality, exactly as the inline scan this function was extracted from did.
// A per-quality override saved from a quality-keyed price editor
// ("<id>#Q<n>", qualityOverrideKey) IS that city's quality-n ask: it wins over
// the book, and creates a candidate where the book has none. An override of 0
// or less is no override. Null when the city offers no Good+ ask.
function _cpQualityAskFor(itemId, city) {
  const book = (typeof lastQualityMarketData !== "undefined" && lastQualityMarketData)
    ? lastQualityMarketData[itemId]
    : null;
  const canOverride = typeof getOverridePrice === "function" && typeof qualityOverrideKey === "function";
  let best = null;
  for (let q = 2; q <= 5; q++) {
    const ov = canOverride ? getOverridePrice(qualityOverrideKey(itemId, q), city, "sell") : null;
    const cell = book && book[q] && book[q][city];
    const ask = ov > 0 ? ov : (cell && cell.sell_price > 0 ? cell.sell_price : 0);
    if (ask > 0 && (!best || ask < best.price)) best = { price: ask, quality: q };
  }
  return best;
}

// ─── Pricing-side sell selection (called by js/craft-planner-pricing.js) ────

// Tiered sell-side selection for computeCraftPlannerRow's sell loop (plan.md).
// One pass over the searched cities, collecting two candidate classes:
//   • tier 1 — cities whose Normal (q1) book has a real ask (getSellPrice > 0);
//   • fallback — every other searched city's cheapest Good+ ask (_cpQualityAskFor,
//     ties keep the lower quality).
// If ANY tier-1 candidate exists the winner is the best net among tier 1 alone
// and the sale stays quality-less — the exact pre-fallback behavior; a dearer
// Good+ ask elsewhere never competes. Only when no searched city has a Normal
// ask does the fallback run, and then the tier is the LOWEST quality q2-5 any
// per-city candidate offers: the winner is the best net among candidates of
// that quality ONLY (a city whose cheapest ask is a higher quality is excluded),
// and the row is tagged `quality` = the tier. Null when no city offers a sale
// at any quality — the caller's no-sell branch.
//
// Net basis is `price × (1 − PREMIUM_TAX) − travel`, the caller's margin without
// its input-cost term: that term is the same constant for every candidate, so
// the argmax — and the first-city-wins tie on it — is identical. Travel uses the
// caller's exact leg computation (legBrecilienCost, typeof-guarded the same way)
// and is only ever computed for a city that priced, exactly as the inline loop
// this replaces did. Route guard: a city isInvalidCrossRoute fails is skipped
// before any price read, as before.
//
// @returns {{city: string, price: number, travel: number, quality: number|null}|null}
function _cpSelectSell(itemId, craftCity, sellCities, marketData, bounds) {
  const data = marketData ? marketData[itemId] : null;
  let q1 = null;
  const fallback = [];
  sellCities.forEach((sc) => {
    if (typeof isInvalidCrossRoute === "function" && isInvalidCrossRoute(craftCity, sc)) return;
    const p = getSellPrice(data, sc, bounds, itemId);
    if (p > 0) {
      const travel = (typeof legBrecilienCost === "function") ? legBrecilienCost(craftCity, sc, itemId, 1) : 0;
      const net = p * (1 - PREMIUM_TAX) - travel;
      if (!q1 || net > q1.net) q1 = { city: sc, price: p, travel, net };
      return;
    }
    const ask = _cpQualityAskFor(itemId, sc);
    if (!ask || !(ask.price > 0)) return;
    const travel = (typeof legBrecilienCost === "function") ? legBrecilienCost(craftCity, sc, itemId, 1) : 0;
    fallback.push({
      city: sc, price: ask.price, travel, quality: ask.quality,
      net: ask.price * (1 - PREMIUM_TAX) - travel,
    });
  });
  if (q1) return { city: q1.city, price: q1.price, travel: q1.travel, quality: null };
  let tier = 0;
  fallback.forEach((c) => { if (!tier || c.quality < tier) tier = c.quality; });
  let best = null;
  fallback.forEach((c) => {
    if (c.quality !== tier) return;
    if (!best || c.net > best.net) best = c;
  });
  return best ? { city: best.city, price: best.price, travel: best.travel, quality: tier } : null;
}

// ─── Render-side note builders (called by js/render-craft-planner.js) ───────

// The one-line note under an empty Sell cell on a noDataNoSell row that carries
// noSellRefs (built by _cpNoSellReferences, js/craft-planner-pricing.js): the
// flat quality-1 book has no ask, but the quality map quotes a Normal BUY order
// and/or Good+ asks. Same note channel as the dropped-pin line
// (_cpSellPinNote, priceTd's 9th argument). Returns "" when the row carries no
// references, so the cell is byte-identical to today's placeholder. Silver via
// formatSilver, the same formatter every cell uses.
function _cpNoSellRefsNote(refs) {
  if (!refs) return "";
  const parts = ["no Normal asks"];
  if (refs.normalBuy) {
    parts.push("buy ord " + formatSilver(refs.normalBuy.price));
  }
  if (refs.higherAsk) {
    const qName = _CP_QUALITY_NAMES[refs.higherAsk.quality]
      || ("Q" + refs.higherAsk.quality);
    parts.push(qName + " asks " + formatSilver(refs.higherAsk.price)
      + " (" + (refs.higherAsk.city || "—") + ")");
  }
  return '<br><small style="color:#9ca3af;font-size:0.7rem">' + parts.join(" · ") + "</small>";
}

// The one-line label under a PRICED Sell cell whose price came from a Good+ ask:
// "Outstanding ask" etc., through the same priceTd note channel as the pin note
// and the no-sell hint. "" without a fallback quality, so a Normal-ask row
// renders byte-identical to before the fallback existed.
function _cpSellQualityNote(q) {
  if (!q) return "";
  const name = _CP_SELL_QUALITY_LABELS[q] || ("Q" + q);
  return '<br><small style="color:#9ca3af;font-size:0.7rem">' + name + " ask</small>";
}
