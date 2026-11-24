/**
 * Global Discount — the live gold price applied to every silver sink.
 *
 * When gold trades below 5,000 silver the game discounts silver costs in
 * proportion to how cheap gold is:
 *
 *     Global Discount = (1 - gold price / 5000) * 100%
 *
 * so the cost multiplier is clamp(gold / 5000, 0, 1). Above the pivot there is
 * no discount and — importantly — no surcharge, so the factor caps at 1.
 * It hits repair, transmutation, quality rerolls, station usage fees, recipe
 * silver and island upgrades alike.
 *
 * Gold has traded 7,500-8,700 all year, so the factor is 1 today and none of
 * the tables move. This exists so they stop being silently wrong the next time
 * gold dips under the pivot.
 *
 * NOTE: this is NOT the same knob as Gold Market Stabilization (the ~1.156
 * items.xml-silver → in-game-silver multiplier in data-maps.js / travel-cost.js).
 * That one is a separate, undocumented server-side scaler measured in-game.
 *
 * The price comes from AODP /stats/gold (server-wide, hourly). It is cached in
 * localStorage so a cold start with no network still prices at the last known
 * gold rather than falling back to full price.
 */

const GLOBAL_DISCOUNT_PIVOT = 5000;
const GOLD_PRICE_KEY = "goldPrice";

let _goldPrice = null;

/** Only a plausible whole-silver gold quote is accepted; anything else is ignored. */
function _isValidGoldPrice(price) {
  return Number.isFinite(price) && price >= 0 && price === Math.round(price);
}

/**
 * Records the latest gold price. Explicit null clears it (back to full price);
 * anything unparseable leaves the last good value alone so one bad fetch can't
 * knock the tables off their prices.
 */
function setGoldPrice(price) {
  if (price === null) {
    _goldPrice = null;
  } else if (_isValidGoldPrice(price)) {
    _goldPrice = price;
  } else {
    return;
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      if (_goldPrice === null) localStorage.removeItem(GOLD_PRICE_KEY);
      else localStorage.setItem(GOLD_PRICE_KEY, String(_goldPrice));
    }
  } catch (e) {
    /* private mode / quota — in-memory value still stands */
  }
}

function getGoldPrice() {
  return _goldPrice;
}

/** Multiplier on any silver cost. 1 when gold is unknown or at/above the pivot. */
function getGlobalDiscountFactor() {
  if (_goldPrice === null) return 1;
  return Math.min(1, Math.max(0, _goldPrice / GLOBAL_DISCOUNT_PIVOT));
}

/** The same thing the game shows in its UI, as a percentage off. */
function getGlobalDiscountPercent() {
  return (1 - getGlobalDiscountFactor()) * 100;
}

/** Discounted silver for a gross (undiscounted) figure. */
function applyGlobalDiscount(silver) {
  const n = Number(silver);
  if (!Number.isFinite(n)) return 0;
  return n * getGlobalDiscountFactor();
}

/** Restores the cached price at boot, before any fetch has landed. */
function loadCachedGoldPrice() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return;
    const raw = localStorage.getItem(GOLD_PRICE_KEY);
    if (raw !== null) setGoldPrice(parseInt(raw, 10));
  } catch (e) {
    /* ignore */
  }
}

/**
 * Pulls the newest hourly gold quote from AODP and stores it. Safe to call on
 * every boot and on a region change; failures leave the cached price in place.
 */
async function refreshGoldPrice() {
  if (typeof fetchGoldHistory !== "function") return getGoldPrice();
  try {
    const points = await fetchGoldHistory(1);
    const last = Array.isArray(points) && points.length ? points[points.length - 1] : null;
    if (last) setGoldPrice(last.price);
  } catch (e) {
    /* offline — keep the cached price */
  }
  return getGoldPrice();
}

if (typeof localStorage !== "undefined") loadCachedGoldPrice();
