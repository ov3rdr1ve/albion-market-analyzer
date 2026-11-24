// Run: node --test tests/sniffer-fresh-bypass-outlier.test.cjs
/**
 * TDD RED-phase spec: a SNIFFER-captured price bypasses the IQR outlier gate.
 *
 * Feature under spec (NOT implemented yet — the bypass assertions here must
 * fail until it lands): price entries gain per-side provenance flags
 * `sell_src` / `buy_src`, "sniffer" or null. When the leg being priced comes
 * from a sniffer capture, the cross-city IQR outlier gate must NOT zero it:
 *   - getBuyPrice / getSellPrice (js/utils.js) return the real price, and
 *   - rejectedOutlierPrice (js/price-book-fallback.js) never names a sniffer
 *     city as the rejected one.
 * A cell WITHOUT the flag keeps today's behavior exactly: the gate rejects it.
 *
 * Black box, two harnesses:
 *   - the REAL js/utils.js gate (getIQRBounds / getBuyPrice / getSellPrice)
 *     runs in a vm sandbox, mirroring tests/iqr-small-sample-fence.test.cjs.
 *     js/price-book-fallback.js is loaded into the SAME context BEFORE
 *     utils.js: both are plain function-declaration files, the gate's
 *     cross-file helpers must resolve there (readBookLeg today, isSnifferLeg
 *     once implemented — utils.js references it via typeof), and
 *     price-book-fallback.js only typeof-guards its own cross-file refs.
 *   - mergeEntry (js/market-price-store.js) and capFoldOntoTarget
 *     (js/captured-prices-store.js) are plain Node modules, required
 *     directly, mirroring tests/invented-price-guard.test.cjs.
 *
 * Scenario map (expected red/green in the red phase):
 *   [1]  SELL bypass                    — RED   (gate zeroes the sniffer ask today)
 *   [2]  control: gate intact           — GREEN
 *   [3a] BUY instant bypass             — RED
 *   [3b] BUY market bypass              — RED
 *   [4a] label skips the sniffer city   — RED   (names the probe city today)
 *   [4b] label names the real troll     — GREEN
 *   [5a] mergeEntry: sniffer wins+flags — pins the fold contract
 *   [5b] mergeEntry: API win clears it  — RED   (stale flag rides along today)
 *   [5c] mergeEntry: zero keeps prev    — pins the fold contract
 *   [6a] capFoldOntoTarget stamps src   — RED   (flag dropped today)
 *   [6b] capFoldOntoTarget keeps target — GREEN
 *   [7]  legacy no-flag cell            — GREEN (unchanged)
 *   [8]  Black Market exemption         — GREEN (unchanged)
 *
 * The probe city is Bridgewatch: Caerleon is exempt from the gate entirely
 * (plan-caerleon-exempt.md, tests/caerleon-outlier-exempt.test.cjs), so a
 * Caerleon probe would pass the bypass assertions for the wrong reason.
 */

const { test } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── Harness: the real gate in a sandbox (iqr-small-sample-fence pattern) ──
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
const elements = {
  "sort-instant": { checked: false }, // legacy single toggle: market mode
  "buy-instant": { checked: false },  // per-side radios utils.js reads
  "sell-instant": { checked: false },
};
sandbox.document = { getElementById: (id) => elements[id] || null };
sandbox.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
const ctx = vm.createContext(sandbox);
// price-book-fallback.js BEFORE utils.js — see the docblock above.
vm.runInContext(read("js/price-book-fallback.js"), ctx, { filename: "price-book-fallback.js" });
const utilsCode = (read("js/utils.js") + read("js/utils-item-ids.js") + read("js/utils-overrides.js") + read("js/utils-focus-fees.js"))
  + "\n;globalThis.__exp = { getIQRBounds, getBuyPrice, getSellPrice, rejectedOutlierPrice };";
vm.runInContext(utilsCode, ctx, { filename: "utils.js" });
const { getIQRBounds, getBuyPrice, getSellPrice, rejectedOutlierPrice } = sandbox.__exp;

function setMarketMode() { for (const k of Object.keys(elements)) elements[k].checked = false; }
function setInstantBuy() { setMarketMode(); elements["buy-instant"].checked = true; }

// ── Fixtures ────────────────────────────────────────────────────────────────
const ID = "T_X";
const NEW = "2026-09-14T12:00:00.000Z";
const OLD = "2026-09-13T00:00:00.000Z";
const NEWER = "2026-09-14T00:00:00.000Z";
const royalAsk = (p) => ({ buy_price: 0, sell_price: p, sell_date: NEW });

/** Five cities; the probe's 9000 ask sits 8x above the others' 1000..1200 band. */
function fiveCities(probe) {
  return {
    Bridgewatch: probe,
    "Fort Sterling": royalAsk(1000),
    Lymhurst: royalAsk(1050),
    Martlock: royalAsk(1100),
    Thetford: royalAsk(1200),
  };
}
const snifferAsk = () => ({ buy_price: 0, sell_price: 9000, sell_date: NEW, sell_src: "sniffer" });
const plainAsk = () => ({ buy_price: 0, sell_price: 9000, sell_date: NEW });

/** Five cities with live bids on both sides, for the market-order buy leg. */
function fiveCityBids(probe) {
  return {
    Bridgewatch: probe,
    "Fort Sterling": { buy_price: 1000, buy_date: NEW, sell_price: 1100, sell_date: NEW },
    Lymhurst: { buy_price: 1050, buy_date: NEW, sell_price: 1150, sell_date: NEW },
    Martlock: { buy_price: 1100, buy_date: NEW, sell_price: 1200, sell_date: NEW },
    Thetford: { buy_price: 1200, buy_date: NEW, sell_price: 1300, sell_date: NEW },
  };
}

// Direct-required stores (invented-price-guard pattern).
const { mergeEntry } = require(path.join(ROOT, "js", "market-price-store.js"));
const CAP = require(path.join(ROOT, "js", "captured-prices-store.js"));

// ── 1 + 2. getSellPrice: sniffer bypass, and the gate-intact control ───────

test("[1] SELL bypass: a sniffer ask above the fence is returned, not zeroed (RED: the gate zeroes it today)", () => {
  setMarketMode();
  const data = fiveCities(snifferAsk());
  const bounds = getIQRBounds(data);
  assert.strictEqual(getSellPrice(data, "Bridgewatch", bounds, ID), 9000);
});

test("[2] control: the same ask WITHOUT the provenance flag is still rejected", () => {
  setMarketMode();
  const data = fiveCities(plainAsk());
  const bounds = getIQRBounds(data);
  assert.strictEqual(getSellPrice(data, "Bridgewatch", bounds, ID), 0);
});

// ── 3. getBuyPrice: instant reads the ask, market reads the bid ────────────

test("[3a] BUY instant bypass: a sniffer ask above sellUpper prices the instant buy (RED: zeroed today)", () => {
  setInstantBuy();
  const data = fiveCities(snifferAsk());
  const bounds = getIQRBounds(data);
  assert.strictEqual(getBuyPrice(data, "Bridgewatch", bounds, ID), 9000);
});

test("[3b] BUY market bypass: a sniffer bid above buyUpper prices the market buy (RED: zeroed today)", () => {
  setMarketMode();
  const data = fiveCityBids({
    buy_price: 9000, buy_date: NEW, buy_src: "sniffer", sell_price: 1000, sell_date: NEW,
  });
  const bounds = getIQRBounds(data);
  assert.strictEqual(getBuyPrice(data, "Bridgewatch", bounds, ID), 9000);
});

// ── 4. the rejected-outlier label never blames a sniffer capture ──────────

test("[4a] rejectedOutlierPrice never names a sniffer city (RED: it names Caerleon today)", () => {
  setMarketMode();
  const data = fiveCities(snifferAsk()); // ONLY the sniffer city above the fence
  assert.strictEqual(rejectedOutlierPrice(data, ID, null, "sell"), null);
});

test("[4b] a NON-sniffer troll above the fence is still named (control)", () => {
  setMarketMode();
  const data = {
    // non-sniffer troll inserted FIRST so today's first-above-fence rule and
    // the future sniffer-skipping rule both answer Thetford.
    Thetford: { buy_price: 0, sell_price: 95000, sell_date: NEW },
    Bridgewatch: snifferAsk(),
    "Fort Sterling": royalAsk(1000),
    Lymhurst: royalAsk(1050),
    Martlock: royalAsk(1200),
  };
  // Field-wise: the result object is born in the vm realm, so a cross-realm
  // deepStrictEqual would fail on prototype identity, not on values.
  const rejected = rejectedOutlierPrice(data, ID, null, "sell");
  assert.ok(rejected, "expected Thetford to be named, got " + JSON.stringify(rejected));
  assert.strictEqual(rejected.city, "Thetford");
  assert.strictEqual(rejected.price, 95000);
});

// ── 5. mergeEntry keeps the provenance flag with the price it belongs to ──

test("[5a] mergeEntry: a newer sniffer ask wins and carries its provenance flag", () => {
  const out = mergeEntry(
    { sell_price: 1000, sell_date: OLD },
    { sell_price: 9000, sell_date: NEWER, sell_src: "sniffer" },
  );
  assert.strictEqual(out.sell_price, 9000);
  assert.strictEqual(out.sell_src, "sniffer");
});

test("[5b] mergeEntry: a newer API ask (no flag) wins the price AND clears the stale sniffer flag (RED: the stale flag rides along today)", () => {
  const out = mergeEntry(
    { sell_price: 9000, sell_date: OLD, sell_src: "sniffer" },
    { sell_price: 1000, sell_date: NEWER },
  );
  assert.strictEqual(out.sell_price, 1000);
  assert.ok(
    out.sell_src === null || out.sell_src === undefined,
    "sell_src should be null/absent after an API win, got " + JSON.stringify(out.sell_src),
  );
});

test("[5c] mergeEntry: a zero-price sniffer patch keeps the previous price AND its flag", () => {
  const out = mergeEntry(
    { sell_price: 9000, sell_date: OLD, sell_src: "sniffer" },
    { sell_price: 0, sell_date: NEWER, sell_src: "sniffer" },
  );
  assert.strictEqual(out.sell_price, 9000);
  assert.strictEqual(out.sell_src, "sniffer");
});

// ── 6. capFoldOntoTarget: a capture stamps its provenance onto the scan ───

test("[6a] capFoldOntoTarget: a newer capture wins and stamps its sniffer provenance onto the scan cell (RED: the flag is dropped today)", () => {
  const out = CAP.capFoldOntoTarget(
    { sell_price: 1000, sell_date: OLD },
    { sell_price: 9000, sell_date: NEWER, sell_src: "sniffer" },
  );
  assert.strictEqual(out.sell_price, 9000);
  assert.strictEqual(out.sell_src, "sniffer");
});

test("[6b] capFoldOntoTarget: an older capture replaces nothing — scan price and scan provenance kept", () => {
  const out = CAP.capFoldOntoTarget(
    { sell_price: 1000, sell_date: NEWER },
    { sell_price: 9000, sell_date: OLD, sell_src: "sniffer" },
  );
  assert.strictEqual(out.sell_price, 1000);
  assert.ok(
    out.sell_src === null || out.sell_src === undefined,
    "target had no src flag, the fold must not invent one, got " + JSON.stringify(out.sell_src),
  );
});

// ── 7 + 8. behavior that must not change ───────────────────────────────────

test("[7] legacy: a captured-style cell WITHOUT the flag above the fence is zeroed and named (control)", () => {
  setMarketMode();
  const data = fiveCities(plainAsk());
  assert.strictEqual(getSellPrice(data, "Bridgewatch", getIQRBounds(data), ID), 0);
  const rejected = rejectedOutlierPrice(data, ID, null, "sell");
  assert.ok(rejected, "expected Bridgewatch to be named, got " + JSON.stringify(rejected));
  assert.strictEqual(rejected.city, "Bridgewatch");
  assert.strictEqual(rejected.price, 9000);
});

test("[8] Black Market: a sniffer-flagged premium stays exempt from the pools and the judgment (control)", () => {
  setMarketMode();
  const data = {
    "Fort Sterling": royalAsk(1000),
    Lymhurst: royalAsk(1050),
    Bridgewatch: royalAsk(1100),
    Martlock: royalAsk(1200),
    "Black Market": {
      buy_price: 0, sell_price: 900000, sell_date: NEW, sell_src: "sniffer", from_sniffer: true,
    },
  };
  const bounds = getIQRBounds(data);
  assert.ok(
    bounds.sellUpper < 5000,
    "the BM ask must not drag the sell pool upward, got sellUpper " + bounds.sellUpper,
  );
  assert.strictEqual(getSellPrice(data, "Black Market", bounds, ID), 900000);
});
