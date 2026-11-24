/**
 * Captured market HISTORY → the app's Vol/24h.
 *
 * Orders tell you what is listed; the in-game price chart
 * (AuctionGetItemAverageStats) tells you what actually traded, and it is the
 * very series AODP aggregates into `volume_24h`. The monitor already decodes
 * it for upload (market-sniffer-events.js) — this turns the same response into
 * a price-shaped patch so the number shows up locally too, instead of every
 * captured item sitting at Vol 0.
 *
 * Three details decide whether the number is right:
 *   - the response carries no item id, only the numeric AlbionId its REQUEST
 *     named; that index is the line number in ao-bin-dumps items.txt, which
 *     js/item-index.js maps back to a game id. The request's enchantment is a
 *     separate parameter and has to be folded into the id ("T4_BAG" + 2 →
 *     "T4_BAG@2"), exactly as the order path folds EnchantmentLevel,
 *   - timestamps arrive as .NET ticks (100 ns since 0001-01-01) but are
 *     decoded permissively, because a client patch that switched to epoch ms
 *     would otherwise silently produce absurd ages,
 *   - only the Hours (0) and Days (1) timescales can answer "how much traded
 *     in the last 24h". Weeks (2) buckets four weeks per point; cutting that
 *     down to a day would be inventing data, so it is refused.
 *
 * The patch carries volume and nothing else — sell/buy stay 0 so the merge in
 * market-price-store.js treats them as "not observed" and leaves captured
 * prices alone.
 */

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
// 0001-01-01 → 1970-01-01, in ms. .NET ticks are 100 ns since that epoch.
const TICKS_EPOCH_MS = 62135596800000;
const TIMESCALE_HOURS = 0;
const TIMESCALE_DAYS = 1;
const TIMESCALE_WEEKS = 2;

/**
 * Epoch ms from whatever the wire carried: .NET ticks, epoch ms, or epoch
 * seconds. 0 when the value is unusable.
 */
function decodeHistoryTimestamp(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Ticks are ~6.4e17 today, epoch ms ~1.8e12, epoch seconds ~1.8e9 — three
  // ranges far enough apart that no real timestamp is ambiguous.
  if (n > 1e15) return Math.round(n / 10000) - TICKS_EPOCH_MS;
  if (n > 1e11) return Math.round(n);
  return Math.round(n) * 1000;
}

/** ItemAmount as the reference client reads it; null when it must be dropped. */
function historyAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) {
    // Same byte artefact as the item ids: -121 means 135. Below -124 the
    // reference client gives up rather than guess, and so do we.
    if (n < -124) return null;
    return 256 + n;
  }
  return n;
}

/**
 * Reduce one captured history payload to a { itemId: { quality: { city: cell } } }
 * patch carrying volume_24h.
 *
 * @param {object} payload   { AlbionId, LocationId, QualityLevel, Timescale, MarketHistories }
 * @param {object} options
 *   now       — epoch ms, defaults to Date.now()
 *   maxAgeMs  — window width, defaults to 24h
 *   enchant   — enchantment level from the REQUEST (parameter 4)
 *   lookupId  — (index) => game id, defaults to the global item index
 *   cityOf    — (locationId) => city name, defaults to the global marketCityName
 * @returns {object} the patch, or {} when nothing usable came out
 */
function historyToVolumePatch(payload, options = {}) {
  if (!payload) return {};
  const now = options.now !== undefined ? options.now : Date.now();
  const maxAgeMs = options.maxAgeMs !== undefined ? options.maxAgeMs : HISTORY_WINDOW_MS;

  const timescale = Number(payload.Timescale);
  if (timescale !== TIMESCALE_HOURS && timescale !== TIMESCALE_DAYS) return {};

  const lookupId = options.lookupId
    || (typeof albionItemIdFromIndex === "function" ? albionItemIdFromIndex : null);
  const cityOf = options.cityOf
    || (typeof marketCityName === "function" ? marketCityName : null);
  if (!lookupId || !cityOf) return {};

  const baseId = lookupId(Number(payload.AlbionId));
  if (!baseId) return {};
  const enchant = Number(options.enchant) || 0;
  const itemId = (enchant > 0 && !String(baseId).includes("@")) ? `${baseId}@${enchant}` : baseId;

  const city = cityOf(payload.LocationId);
  if (!city) return {};

  const points = Array.isArray(payload.MarketHistories) ? payload.MarketHistories : [];
  let volume = 0;
  let newest = 0;
  points.forEach((point) => {
    const ts = decodeHistoryTimestamp(point && point.Timestamp);
    if (!ts || now - ts > maxAgeMs) return;
    const amount = historyAmount(point && point.ItemAmount);
    if (amount === null) return;
    volume += amount;
    if (ts > newest) newest = ts;
  });
  // Nothing traded in the window is NOT the same as "volume is zero": the
  // chart may simply be showing an older span. Report nothing rather than
  // overwrite a scanned number with a 0 we did not measure.
  if (volume <= 0) return {};

  const quality = Number(payload.QualityLevel) || 1;
  const cell = {
    buy_price: 0,
    sell_price: 0,
    sell_date: null,
    buy_date: null,
    volume_24h: volume,
    // Its own timestamp: a volume ages against the newest trade it counted,
    // not against a price date it does not carry.
    volume_date: new Date(newest || now).toISOString(),
    used_fallback: false,
    from_sniffer: true,
  };
  return { [itemId]: { [quality < 1 ? 1 : quality]: { [city]: cell } } };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    historyToVolumePatch,
    decodeHistoryTimestamp,
    HISTORY_WINDOW_MS,
    TIMESCALE_HOURS,
    TIMESCALE_DAYS,
    TIMESCALE_WEEKS,
  };
}
