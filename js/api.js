/**
 * Albion Community API Service
 * Handles batched requests to respect the 180 req/min limit.
 */

// Albion Online Data Project runs three independent regional servers, each
// with its OWN market data — a price from one server is meaningless on
// another. The user picks which one to query and we persist the choice.
const API_SERVERS = {
  west:   { host: "https://west.albion-online-data.com",   label: "Americas (West)" },
  europe: { host: "https://europe.albion-online-data.com", label: "Europe" },
  east:   { host: "https://east.albion-online-data.com",   label: "Asia (East)" },
};
const DEFAULT_SERVER = "west";
const API_SERVER_STORAGE_KEY = "apiServer";

const LOCATIONS =
  "Caerleon,Black Market,Lymhurst,Fort Sterling,Thetford,Martlock,Bridgewatch,Brecilien,Smuggler's Den";

// AODP answers a location it cannot resolve with city "0" and all-zero prices.
// It currently has no Smuggler's Network data, so the den comes back that way —
// we still ask for it (it costs one location and auto-fills the day AODP starts
// tracking dens), but the placeholder rows must never become a city bucket, or
// every price lookup would see a phantom 0-silver market.
function isRealMarketCity(city) {
  return !!city && city !== "0";
}

// Rate limiting & Safety
let isScanning = false;
let lastScanTime = 0;
const SCAN_COOLDOWN_MS = 10000; // 10 seconds between manual scans

// ── Server / region selection ───────────────────────────────────────────────

/** Normalize a stored server key to a valid one, falling back to the default. */
function resolveApiServer(savedKey) {
  return savedKey && API_SERVERS[savedKey] ? savedKey : DEFAULT_SERVER;
}

/** Base host (scheme + domain, no path) for a given server key. */
function apiHostFor(key) {
  return (API_SERVERS[key] || API_SERVERS[DEFAULT_SERVER]).host;
}

/** Currently selected server key — read from localStorage (default west). */
function getApiServerKey() {
  let saved = null;
  try { saved = localStorage.getItem(API_SERVER_STORAGE_KEY); } catch (e) { /* storage unavailable */ }
  return resolveApiServer(saved);
}

/** Base host for the currently selected server. */
function getApiHost() {
  return apiHostFor(getApiServerKey());
}

/**
 * Persist the selected server. Returns true when `key` is a known server
 * (and was stored), false otherwise — invalid keys leave the selection
 * untouched. A deliberate switch resets the scan cooldown: the cached prices
 * belong to the previous server, so the user should be able to re-scan the new
 * one immediately.
 */
function setApiServer(key) {
  if (!API_SERVERS[key]) return false;
  try { localStorage.setItem(API_SERVER_STORAGE_KEY, key); } catch (e) { /* storage unavailable */ }
  lastScanTime = 0;
  return true;
}

/** Build the AODP prices request URL. Pure — kept separate for testing. */
function buildPricesUrl(host, itemsString, locations, qualities) {
  return `${host}/api/v2/stats/prices/${itemsString}.json?locations=${locations}&qualities=${qualities}`;
}

/** Build the AODP 24h-history request URL. Pure — kept separate for testing. */
function buildHistoryUrl(host, itemsString, locations, timeScale, qualities) {
  return `${host}/api/v2/stats/history/${itemsString}.json?locations=${locations}&time-scale=${timeScale}&qualities=${qualities}`;
}

/**
 * Build the AODP gold-price URL. Gold is server-wide (no location/quality) —
 * `count` returns that many of the most recent hourly points. Pure for tests.
 */
function buildGoldUrl(host, count) {
  return `${host}/api/v2/stats/gold?count=${count}`;
}

/**
 * Fetch the most recent `count` hourly gold prices for the selected region.
 * Returns { time, price }[] sorted oldest→newest (UNIX seconds), ready for
 * bucketToOHLC / indicator math. Returns [] on any failure.
 *
 * AODP timestamps are UTC without a zone suffix ("2026-07-06T16:00:00"); we
 * append "Z" so Date parses them as UTC rather than local.
 */
async function fetchGoldHistory(count = 720) {
  const url = buildGoldUrl(getApiHost(), count);
  const res = await fetchWithRetry(url);
  if (!res || !res.ok) return [];
  let raw;
  try { raw = await res.json(); } catch (e) { return []; }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => ({
      time: Math.floor(new Date(d.timestamp + "Z").getTime() / 1000),
      price: d.price,
    }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.price))
    .sort((a, b) => a.time - b.time);
}

// A response worth retrying: 429 (rate limit) or a transient 5xx. AODP's prices
// endpoint intermittently 500s on heavy batches while the identical request
// succeeds moments later (history endpoint is unaffected), so a single 500 must
// not abort a whole scan — back off and retry like a 429.
function shouldRetryStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Fetches a URL, retrying on 429 and transient 5xx with exponential backoff.
 * @param {string} url
 * @param {number} maxRetries
 * @returns {Promise<Response|null>}
 */
async function fetchWithRetry(url, maxRetries = 3) {
  let delay = 2000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url).catch(() => null);
    if (!res) return null;
    if (!shouldRetryStatus(res.status)) return res;
    if (attempt === maxRetries) return res;
    const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
    const wait = retryAfter > 0 ? retryAfter * 1000 : delay;
    console.warn(`[Albion API] ${res.status} — waiting ${wait / 1000}s before retry ${attempt + 1}/${maxRetries}…`);
    await new Promise((r) => setTimeout(r, wait));
    delay *= 2;
  }
}

/**
 * Pure merge of one AODP price entry with its matching 24h history block.
 *
 * Returns `{ buy_price, sell_price, sell_date, buy_date, volume_24h,
 * used_fallback }` shaped for the priceMap consumers.
 *
 * Fallback policy: history `avg_price` is only used to fill in a MISSING side
 * when the OTHER side is live. If both `buy_price_max` and `sell_price_min`
 * are 0 at this city, no fallback is applied — the row shows "no data" and
 * the user can override.
 *
 * Why: AODP's per-city `avg_price` is the simple mean of all trades it has
 * recorded, with no recency cap and no cross-city sanity. For chronically
 * thin items (laborer empty/full journals, low-tier crafting outputs) it
 * frequently encodes a market level that no longer exists — sometimes off
 * by 10×, sometimes inverted (e.g. T8_JOURNAL_TROPHY_ORE_EMPTY at Fort
 * Sterling shows avg≈370k while the only current listing anywhere is 50k).
 * Pre-fix the renderer surfaced these as 0.95×/1.05× of avg_price, producing
 * swapped-looking columns. Requiring at least one live side gates out the
 * worst of these — the avg_price is only trusted when the same city has
 * recent market activity to anchor it.
 *
 * Single-sided fallback rules (one live side, one zero):
 *   buy_price = 0:  use `Math.round(history.avg_price × 0.95)`, BUT clamp to
 *                   `Math.round(sell_price_min × 0.95)` when the live ask is
 *                   more than 2× the history estimate (stale-low history)
 *                   OR when the history estimate exceeds the live ask (would
 *                   make buying more expensive than the existing offer).
 *   sell_price = 0: mirror — use `Math.round(history.avg_price × 1.05)`, BUT
 *                   clamp UP to `buy_price_max` when the live bid exceeds the
 *                   history estimate (a seller could clear at the bid
 *                   immediately, so the sell estimate must not fall below it).
 *
 * Pure: no DOM, no I/O. Exported for tests; also used inline by
 * fetchPricesBatch.
 */
function mergeEntryWithHistory(entry, historyEntry) {
  let buyPrice = entry.buy_price_max;
  let sellPrice = entry.sell_price_min;
  let volume24h = 0;
  let historyDate = null;

  if (historyEntry && historyEntry.data && historyEntry.data.length > 0) {
    const sortedData = historyEntry.data.slice().sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp),
    );

    sortedData.forEach((d) => {
      volume24h += d.item_count || 0;
    });

    // Only fall back to avg_price when at least ONE live side is non-zero.
    // Both-zero means no current market at this city — using the dormant
    // history surfaces stale values (often 10×+ off) and confuses users.
    const oneSideLive = buyPrice > 0 || sellPrice > 0;
    if (oneSideLive && (buyPrice === 0 || sellPrice === 0)) {
      const validRecent = sortedData.find((d) => d.avg_price > 0);
      if (validRecent) {
        historyDate = validRecent.timestamp;
        if (buyPrice === 0) {
          let fb = Math.round(validRecent.avg_price * 0.95);
          // sell_price_min is guaranteed > 0 here (oneSideLive + buyPrice=0
          // means sellPrice carries the live side). Clamp to ask × 0.95
          // whenever the history estimate diverges in either direction —
          // stale-low (ask >> avg) or stale-high (avg > ask). A buyer who
          // wants to clear posts at most the ask.
          const askBased = Math.round(entry.sell_price_min * 0.95);
          if (fb > entry.sell_price_min || entry.sell_price_min > fb * 2) {
            fb = askBased;
          }
          buyPrice = fb;
        }
        if (sellPrice === 0) {
          let fb = Math.round(validRecent.avg_price * 1.05);
          // buy_price_max guaranteed > 0 here. A seller could clear at the
          // live bid instantly, so sell estimate must not fall below it.
          if (entry.buy_price_max > fb) {
            fb = entry.buy_price_max;
          }
          sellPrice = fb;
        }
      }
    }
  }

  return {
    buy_price: buyPrice,
    sell_price: sellPrice,
    sell_date: entry.sell_price_min > 0 ? entry.sell_price_min_date : historyDate,
    buy_date: entry.buy_price_max > 0 ? entry.buy_price_max_date : historyDate,
    volume_24h: volume24h,
    used_fallback:
      (entry.buy_price_max === 0 && buyPrice > 0) ||
      (entry.sell_price_min === 0 && sellPrice > 0),
    // WHICH side was invented. used_fallback alone could not say, so a fold had
    // no way to keep a real captured ask over an invented one on the same cell
    // (js/market-price-store.js isInventedSide).
    buy_fallback: entry.buy_price_max === 0 && buyPrice > 0,
    sell_fallback: entry.sell_price_min === 0 && sellPrice > 0,
  };
}

// Cities whose price level is structurally different from the royal markets
// and must therefore neither anchor nor be judged by a cross-city comparison.
// The Black Market pays a premium over every city market. Caerleon joins it
// (plan-caerleon-exempt.md): rare items legitimately trade an order of
// magnitude above the royal median there, so a history-invented Caerleon price
// is never clamped and a Caerleon quote never anchors another city's clamp.
const CLAMP_EXEMPT_CITIES = ["Black Market", "Caerleon"];

// A fallback price is dropped when it sits above ref × this, or below ref ÷ this.
const FALLBACK_CLAMP_FACTOR = 3;

function _median(sorted) {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Second sanity gate on history-derived prices — cross-CITY this time.
 *
 * mergeEntryWithHistory bounds an invented side only against the other side at
 * the SAME city. When that same-city anchor is itself a lone troll listing the
 * derived price inherits the nonsense: T7_PLANKS at Caerleon had no bid and a
 * single 80,979 ask, so the fallback bid came out at 76,930 while Fort Sterling
 * (10,056) and Lymhurst (8,589) carried the real bids. One such value drove 83%
 * of the T8 Tinker laborer's reported payload (225k/cycle vs a true ~49k), and
 * every table that prices a thin item is exposed the same way.
 *
 * Rule: for each side independently, take the median of that side's genuinely
 * LIVE prices across the other cities. Any price that was INVENTED from history
 * and lands outside [ref ÷ 3, ref × 3] is dropped to 0 ("no data" — the user can
 * still override the cell). Live prices are never touched: a real listing is
 * real data, and lone-listing outliers on the live side are the IQR bounds'
 * job (utils.js iqrUpper).
 *
 * Needs ≥2 live reference cities on that side; a single anchor is too weak to
 * reject on. The exempt cities (CLAMP_EXEMPT_CITIES) are excluded from both
 * roles.
 *
 * @param {Object} cityMap  { [city]: mergeEntryWithHistory result } — MUTATED
 * @param {Object} liveMap  { [city]: { bid, ask } } raw AODP live sides
 */
function clampFallbackOutliers(cityMap, liveMap, factor = FALLBACK_CLAMP_FACTOR) {
  if (!cityMap) return cityMap;
  const live = liveMap || {};
  const cities = Object.keys(cityMap).filter((c) => !CLAMP_EXEMPT_CITIES.includes(c));

  [
    { field: "buy_price", raw: "bid" },
    { field: "sell_price", raw: "ask" },
  ].forEach(({ field, raw }) => {
    const refs = cities
      .map((c) => (live[c] ? live[c][raw] || 0 : 0))
      .filter((p) => p > 0)
      .sort((a, b) => a - b);
    if (refs.length < 2) return;
    const ref = _median(refs);
    if (ref <= 0) return;

    cities.forEach((c) => {
      const entry = cityMap[c];
      if (!entry || !entry.used_fallback) return;
      const isLive = live[c] && (live[c][raw] || 0) > 0;
      if (isLive) return;                       // real order book, not invented
      const price = entry[field] || 0;
      if (price <= 0) return;
      if (price > ref * factor || price * factor < ref) {
        entry[field] = 0;
        entry[field.replace("_price", "_fallback")] = false;
      }
    });
  });

  // A row with nothing invented left is no longer a fallback row.
  cities.forEach((c) => {
    const entry = cityMap[c];
    if (!entry || !entry.used_fallback) return;
    if (!entry.buy_price && !entry.sell_price) {
      entry.used_fallback = false;
    } else if (entry.buy_fallback === false && entry.sell_fallback === false) {
      entry.used_fallback = false;
    }
  });

  return cityMap;
}

/**
 * Raw batched price fetch — no rate-limit guards or UI side effects.
 * Used internally by fetchPrices and for follow-up calls (e.g. extra recipe materials).
 * @param {string[]} itemIds
 * @returns {Promise<Object>} priceMap
 */
async function fetchPricesBatch(itemIds, { skipHistory = false } = {}) {
  // Filter synthetic ids (`__` separator) — not real items, would 404.
  itemIds = itemIds.filter((id) => !isSyntheticId(id));
  if (itemIds.length === 0) return {};

  const chunkSize = 150;
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    chunks.push(itemIds.slice(i, i + chunkSize));
  }

  const priceMap = {};
  // Raw live sides per (item, city), kept only for the duration of this call:
  // clampFallbackOutliers needs to tell a real order book apart from a price
  // mergeEntryWithHistory invented from the 24h history. Not persisted.
  const liveSides = {};
  // Resolve the host once per call so every chunk — and the paired history
  // request — hits the same server even if the user switches mid-fetch.
  const host = getApiHost();

  for (const chunk of chunks) {
    const itemsString = chunk.join(",");
    const url = buildPricesUrl(host, itemsString, LOCATIONS, 1);

    const fetches = [fetchWithRetry(url)];
    if (!skipHistory) {
      const historyUrl = buildHistoryUrl(host, itemsString, LOCATIONS, 24, 1);
      fetches.push(fetchWithRetry(historyUrl));
    }

    console.log(
      `[Albion API] Fetching batch of ${chunk.length} items${skipHistory ? "" : " (prices & history fallback)"}...`,
    );

    const [response, historyResponse] = await Promise.all(fetches);

    if (!response || !response.ok) {
      if (response?.status === 429) {
        throw new Error("API rate limit hit (429). Try again in a minute.");
      }
      throw new Error(`API Error: ${response?.status} ${response?.statusText}`);
    }

    const data = await response.json();
    let historyLookup = {};
    if (!skipHistory && historyResponse && historyResponse.ok) {
      const historyData = await historyResponse.json();
      historyData.forEach((h) => {
        historyLookup[`${h.item_id}:${h.location}`] = h;
      });
    }

    data.forEach((entry) => {
      if (!isRealMarketCity(entry.city)) return;
      if (!priceMap[entry.item_id]) {
        priceMap[entry.item_id] = {};
      }
      const historyEntry = historyLookup[`${entry.item_id}:${entry.city}`];
      priceMap[entry.item_id][entry.city] = mergeEntryWithHistory(entry, historyEntry);
      if (!liveSides[entry.item_id]) liveSides[entry.item_id] = {};
      liveSides[entry.item_id][entry.city] = {
        bid: entry.buy_price_max,
        ask: entry.sell_price_min,
      };
    });

    if (chunks.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  // Cross-city sanity pass: drop history-invented prices that contradict the
  // live market in the other cities (see clampFallbackOutliers).
  Object.keys(priceMap).forEach((itemId) => {
    clampFallbackOutliers(priceMap[itemId], liveSides[itemId]);
  });

  return priceMap;
}

/**
 * Fetches prices for a list of items across all major cities.
 * Applies rate-limit guards and manages loading UI.
 * @param {string[]} itemIds Array of Albion item IDs
 * @returns {Promise<Object>} Map of prices parsed for quick lookup
 */
async function fetchPrices(itemIds) {
  // Filter synthetic ids (`__` separator) before the rate-limit guard
  // and isScanning check — these are virtual rows that route to real
  // output ids via `sellAs`, never sent to the API directly.
  itemIds = itemIds.filter((id) => !isSyntheticId(id));
  if (itemIds.length === 0) return {};
  if (isScanning) {
    throw new Error("Scan already in progress.");
  }

  const now = Date.now();
  if (now - lastScanTime < SCAN_COOLDOWN_MS) {
    throw new Error(
      `Please wait ${Math.ceil((SCAN_COOLDOWN_MS - (now - lastScanTime)) / 1000)} seconds before scanning again.`,
    );
  }

  isScanning = true;
  lastScanTime = now;

  const uiLoading = document.getElementById("loading-overlay");
  const scanBtn = document.getElementById("scan-trigger");

  if (uiLoading) { uiLoading.classList.remove("hidden"); uiLoading.textContent = "Fetching data..."; }
  if (scanBtn) scanBtn.disabled = true;

  const MAX_RATE_LIMIT_RETRIES = 2;
  let rateLimitAttempt = 0;

  try {
    while (true) {
      try {
        const priceMap = await fetchPricesBatch(itemIds);
        console.log("[Albion API] Data successfully fetched and mapped.");
        return priceMap;
      } catch (error) {
        if (error.message.includes("429") && rateLimitAttempt < MAX_RATE_LIMIT_RETRIES) {
          rateLimitAttempt++;
          const waitSeconds = 60;
          console.warn(
            `[Albion API] Rate limited. Auto-retrying in ${waitSeconds}s ` +
            `(attempt ${rateLimitAttempt}/${MAX_RATE_LIMIT_RETRIES})…`
          );
          for (let s = waitSeconds; s > 0; s--) {
            if (uiLoading) uiLoading.textContent = `Rate limited — retrying in ${s}s…`;
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (uiLoading) uiLoading.textContent = "Fetching data...";
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error("Failed to fetch market data:", error);
    showFetchError(`${error.message}  ·  The community API might be down or overloaded.`);
    return {};
  } finally {
    isScanning = false;
    if (uiLoading) { uiLoading.classList.add("hidden"); uiLoading.textContent = "Fetching data..."; }
    if (scanBtn) scanBtn.disabled = false;
  }
}

function showFetchError(message) {
  let banner = document.getElementById("api-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "api-error-banner";
    banner.style.cssText =
      "position:fixed;top:0;left:0;right:0;background:#3e2020;" +
      "border-bottom:2px solid #9e5858;color:#f87171;padding:10px 16px;" +
      "text-align:center;z-index:10001;font-size:0.9rem;cursor:pointer";
    banner.title = "Click to dismiss";
    banner.addEventListener("click", () => banner.remove());
    document.body.prepend(banner);
  }
  banner.textContent = `⚠ ${message}  —  Click to dismiss`;
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.remove(), 30000);
}

/**
 * Pure: aggregate AODP 24h history into a per-(item, city, quality) volume map.
 * Sums `item_count` across every time bucket. Keys are `item_id:location:quality`.
 * Exported for tests; used by fetchPricesBatchWithQualities.
 */
function sumQualityHistoryVolume(historyData) {
  const lookup = {};
  (historyData || []).forEach((h) => {
    const q = h.quality || 1;
    let vol = 0;
    (h.data || []).forEach((d) => { vol += d.item_count || 0; });
    lookup[`${h.item_id}:${h.location}:${q}`] = vol;
  });
  return lookup;
}

/**
 * Fetch prices with quality information for quality rerolling analysis.
 * Returns qualityPriceMap[itemId][quality][city] = { buy_price, sell_price, volume_24h, ... }
 */
async function fetchPricesBatchWithQualities(itemIds, qualities) {
  if (itemIds.length === 0) return {};

  const chunkSize = 150;
  const chunks = [];
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    chunks.push(itemIds.slice(i, i + chunkSize));
  }

  const qualityMap = {};
  const qualitiesStr = qualities.join(",");
  const host = getApiHost();

  for (const chunk of chunks) {
    const itemsString = chunk.join(",");
    const url = buildPricesUrl(host, itemsString, LOCATIONS, qualitiesStr);
    const historyUrl = buildHistoryUrl(host, itemsString, LOCATIONS, 24, qualitiesStr);

    console.log(`[Albion API] Fetching batch of ${chunk.length} items with qualities (prices & 24h volume)...`);

    const [response, historyResponse] = await Promise.all([
      fetchWithRetry(url),
      fetchWithRetry(historyUrl),
    ]);
    if (!response || !response.ok) {
      if (response?.status === 429) {
        throw new Error("API rate limit hit (429). Try again in a minute.");
      }
      throw new Error(`API Error: ${response?.status} ${response?.statusText}`);
    }

    const data = await response.json();

    // Sum 24h item_count per (item, city, quality) for the volume column.
    let volumeLookup = {};
    if (historyResponse && historyResponse.ok) {
      const historyData = await historyResponse.json();
      volumeLookup = sumQualityHistoryVolume(historyData);
    }

    data.forEach((entry) => {
      if (!isRealMarketCity(entry.city)) return;
      const q = entry.quality || 1;
      if (!qualityMap[entry.item_id]) qualityMap[entry.item_id] = {};
      if (!qualityMap[entry.item_id][q]) qualityMap[entry.item_id][q] = {};

      qualityMap[entry.item_id][q][entry.city] = {
        buy_price: entry.buy_price_max,
        sell_price: entry.sell_price_min,
        // Dated like every flat cell (mergeEntryWithHistory). These used to be
        // dropped, which was harmless while only the Rerolling table read this
        // map; now that a Flipping row can be PRICED at quality 2+
        // (js/flip-route-quality.js), an undated cell would render a number
        // with no age beside it and no way to judge it. No history fallback
        // here: a quality book is thin by nature and inventing a price for it
        // from a 24h average would be guesswork on guesswork.
        sell_date: entry.sell_price_min > 0 ? entry.sell_price_min_date : null,
        buy_date: entry.buy_price_max > 0 ? entry.buy_price_max_date : null,
        volume_24h: volumeLookup[`${entry.item_id}:${entry.city}:${q}`] || 0,
      };
    });

    if (chunks.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  return qualityMap;
}

// --- Crafting Recipe Cache ---

const recipeCache = {};

/**
 * Fetches the crafting recipe for a gear item from the gameinfo API.
 * Returns an array of { matId, count } or null if unavailable.
 * IDs are converted from gameinfo format (T5_LEATHER_LEVEL1) to market format (T5_LEATHER@1).
 * Results are cached in memory for the session.
 */
// Non-tradeable auxiliary ingredients that have no market price (soulbound).
// These are skipped in recipe calculations to avoid pricing errors.
// Note: T1_FISHSAUCE / T1_FISHCHOPS were previously here but are tradeable
// in-game — confirmed via Thetford Marketplace listings 2026-05-14.
const NON_TRADEABLE_PREFIXES = [
  "T1_ALCHEMY_EXTRACT",
];

function isNonTradeable(uniqueName) {
  return NON_TRADEABLE_PREFIXES.some((p) => uniqueName.startsWith(p));
}

// Synthetic row ids (e.g., T1_FISHCHOPS__T3_FISH_FRESHWATER_FOREST_RARE)
// are not real Albion items — they're per-fish-source butcher-route rows
// that route their sell price to the real output id via `sellAs`. The
// AODP would 404 if these were included in a batch, so filter them out
// before any fetch.
function isSyntheticId(uniqueName) {
  return typeof uniqueName === "string" && uniqueName.includes("__");
}

async function fetchCraftingRecipe(itemId) {
  if (recipeCache[itemId] !== undefined) return recipeCache[itemId];

  // Use bundled recipes only — gameinfo.albiononline.com blocks CORS from all origins
  if (typeof BUNDLED_RECIPES !== "undefined" && BUNDLED_RECIPES[itemId]) {
    recipeCache[itemId] = BUNDLED_RECIPES[itemId];
    return recipeCache[itemId];
  }

  // Not in bundled recipes — cache & return null (no ingredient breakdown)
  recipeCache[itemId] = null;
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    mergeEntryWithHistory,
    clampFallbackOutliers,
    API_SERVERS,
    DEFAULT_SERVER,
    resolveApiServer,
    apiHostFor,
    getApiServerKey,
    getApiHost,
    setApiServer,
    buildPricesUrl,
    buildHistoryUrl,
    buildGoldUrl,
    fetchGoldHistory,
    sumQualityHistoryVolume,
    shouldRetryStatus,
  };
}
