/**
 * Tests for the Start Monitor control (UI — written after the markup, per the
 * front-end convention in CLAUDE.md).
 *
 * The module is a browser IIFE that exports its pure parts for the Node
 * harness. What matters here is the fold: a captured price patch has to land in
 * the SAME two globals a normal scan fills — `lastMarketData` (flat, what most
 * tables read) and `lastQualityMarketData` (quality-aware) — replacing only the
 * cells that were actually seen, so a live capture in Caerleon never blanks the
 * scanned prices for Martlock.
 *
 * Run: node tests/monitor-panel-render.test.cjs
 */

const assert = require("assert");
// The module reaches for the app's translator the way every renderer does.
// Identity here: this harness asserts the English wording.
global.tx = (en) => en;
const { ordersToPrices } = require("../js/market-price-store.js");
const { applyPrices, statusLine, captureRunning, _reset } = require("../js/render-monitor.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { _reset(); fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const NOW = "2026-07-25T12:00:00";
const order = (over = {}) => ({
  Id: 1, ItemTypeId: "T4_BAG", LocationId: "3005", QualityLevel: 1,
  EnchantmentLevel: 0, UnitPriceSilver: 12340000, Amount: 3,
  AuctionType: "offer", ...over,
});
const update = (orders, city = "Caerleon") => ({
  prices: ordersToPrices(orders, { now: NOW }),
  city,
  count: orders.length,
});

function withGlobals(flat, quality) {
  global.lastMarketData = flat;
  global.lastQualityMarketData = quality;
}

// ── folding a patch into the app's maps ────────────────────────────────────
test("a captured order lands in the flat price map", () => {
  withGlobals({}, {});
  const written = applyPrices(update([order()]));
  assert.strictEqual(written, 1);
  assert.strictEqual(global.lastMarketData["T4_BAG"]["Caerleon"].sell_price, 1234);
});

test("the same order also lands in the quality-aware map", () => {
  withGlobals({}, {});
  applyPrices(update([order({ QualityLevel: 3 })]));
  assert.strictEqual(global.lastQualityMarketData["T4_BAG"][3]["Caerleon"].sell_price, 1234);
});

test("only quality 1 is projected onto the flat map", () => {
  withGlobals({}, {});
  const written = applyPrices(update([order({ QualityLevel: 3 })]));
  assert.strictEqual(written, 0, "nothing at quality 1 to flatten");
  assert.deepStrictEqual(global.lastMarketData, {});
});

test("scanned prices for other cities survive a capture", () => {
  withGlobals({ T4_BAG: { Martlock: { sell_price: 777, buy_price: 5 } } }, {});
  applyPrices(update([order()]));
  assert.strictEqual(global.lastMarketData["T4_BAG"]["Martlock"].sell_price, 777);
  assert.strictEqual(global.lastMarketData["T4_BAG"]["Caerleon"].sell_price, 1234);
});

test("a capture overwrites the scanned price for the city it saw", () => {
  withGlobals({ T4_BAG: { Caerleon: { sell_price: 999999, buy_price: 1 } } }, {});
  applyPrices(update([order()]));
  assert.strictEqual(global.lastMarketData["T4_BAG"]["Caerleon"].sell_price, 1234);
  assert.strictEqual(global.lastMarketData["T4_BAG"]["Caerleon"].from_sniffer, true);
});

test("prices arriving before any scan create the map instead of throwing", () => {
  withGlobals(null, null);
  applyPrices(update([order()]));
  assert.strictEqual(global.lastMarketData["T4_BAG"]["Caerleon"].sell_price, 1234);
  assert.ok(global.lastQualityMarketData["T4_BAG"]);
});

test("several markets in a row accumulate rather than replace", () => {
  withGlobals({}, {});
  applyPrices(update([order()], "Caerleon"));
  applyPrices(update([order({ LocationId: "1002", UnitPriceSilver: 50000000 })], "Lymhurst"));
  assert.deepStrictEqual(
    Object.keys(global.lastMarketData["T4_BAG"]).sort(), ["Caerleon", "Lymhurst"],
  );
});

const EMPTY_CASES = [
  ["null update", null],
  ["update with no prices", { city: "Caerleon", count: 0 }],
  ["update with an empty patch", { prices: {}, city: "Caerleon", count: 0 }],
];
EMPTY_CASES.forEach(([label, input]) => {
  test(`${label} writes nothing`, () => {
    withGlobals({ T4_BAG: { Caerleon: { sell_price: 5 } } }, {});
    assert.strictEqual(applyPrices(input), 0);
    assert.strictEqual(global.lastMarketData["T4_BAG"]["Caerleon"].sell_price, 5);
  });
});

test("orders from an unpriced location (a den, the roads) write nothing", () => {
  withGlobals({}, {});
  assert.strictEqual(applyPrices(update([order({ LocationId: "BLACKBANK-3005@1" })])), 0);
  assert.deepStrictEqual(global.lastMarketData, {});
});

// ── redraw scheduling ──────────────────────────────────────────────────────
// `renderAllTables` recomputes every table and blocks the thread while it does.
// Opening one market emits several patches, so the redraw must be coalesced,
// deferred to an idle moment, and skipped outright while the window is hidden
// (the normal case — you are in the game when prices arrive).
const {
  _flushOnVisible: flushOnVisible, _pendingRedraw: pendingRedraw,
} = require("../js/render-monitor.js");

const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
let pendingTimers = [];
let timerSeq = 0;
let renders = 0;

function withFakeClock(hidden, body) {
  pendingTimers = [];
  renders = 0;
  global.setTimeout = (fn) => { const id = ++timerSeq; pendingTimers.push({ id, fn }); return id; };
  global.clearTimeout = (id) => { pendingTimers = pendingTimers.filter((t) => t.id !== id); };
  global.document = { hidden };
  // The redraw goes through the async scheduler now (js/render-async.js) and
  // falls back to renderAllTables when it is not installed. Either one counts:
  // what these tests check is the debounce/idle/hidden policy above it, which
  // is unchanged.
  global.renderAllTables = () => { renders++; };
  global.scheduleRerender = () => { renders++; return true; };
  withGlobals({}, {});
  try { body(); } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    delete global.document;
    delete global.renderAllTables;
    delete global.scheduleRerender;
  }
}

const runTimers = () => {
  const due = pendingTimers;
  pendingTimers = [];
  due.forEach((t) => t.fn());
};

test("a patch does not redraw inside the call that delivered it", () => {
  withFakeClock(false, () => {
    applyPrices(update([order()]));
    assert.strictEqual(renders, 0, "redraw is deferred, never inline");
    assert.strictEqual(pendingTimers.length, 1);
  });
});

test("a burst of patches collapses into a single redraw", () => {
  withFakeClock(false, () => {
    applyPrices(update([order()]));
    applyPrices(update([order({ Id: 2, UnitPriceSilver: 11000000 })]));
    applyPrices(update([order({ Id: 3, UnitPriceSilver: 10000000 })]));
    assert.strictEqual(pendingTimers.length, 1, "each patch pushes the timer back");
    runTimers();
    assert.strictEqual(renders, 1);
  });
});

test("a settled redraw leaves nothing pending", () => {
  withFakeClock(false, () => {
    applyPrices(update([order()]));
    runTimers();
    assert.strictEqual(pendingRedraw(), false);
    runTimers();
    assert.strictEqual(renders, 1, "an empty tick draws nothing");
  });
});

test("nothing is drawn while the window is hidden", () => {
  withFakeClock(true, () => {
    applyPrices(update([order()]));
    assert.strictEqual(pendingTimers.length, 0, "no timer armed behind the game");
    assert.strictEqual(renders, 0);
    assert.strictEqual(pendingRedraw(), true, "but the draw is still owed");
  });
});

test("coming back to a visible window draws what arrived while it was hidden", () => {
  withFakeClock(true, () => {
    applyPrices(update([order()]));
    global.document.hidden = false;
    flushOnVisible();
    runTimers();
    assert.strictEqual(renders, 1);
  });
});

test("a visible window with nothing owed draws nothing", () => {
  withFakeClock(false, () => {
    flushOnVisible();
    runTimers();
    assert.strictEqual(renders, 0);
  });
});

// ── the capture-city picker ────────────────────────────────────────────────
// The game names the city only on a zone Join, so a capture started while the
// player already stands at the market has nothing to file prices under. The
// picker is the way out that does not involve walking through a gate.
const { _bind: bind } = require("../js/render-monitor.js");

function fakeElement(value) {
  const classes = new Set(["hidden"]);
  return {
    value,
    checked: true,
    dataset: {},
    textContent: "",
    classList: {
      remove: (c) => classes.delete(c),
      toggle: () => {},
      has: (c) => classes.has(c),
    },
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}

function withPanel(stored, body) {
  const nodes = {
    "monitor-toggle": fakeElement(),
    "monitor-upload-label": fakeElement(),
    "monitor-city-label": fakeElement(),
    "monitor-city": fakeElement(stored),
    "monitor-upload": fakeElement(),
    "monitor-status": fakeElement(),
  };
  const sent = [];
  const store = { [`monitorCity`]: stored };
  global.document = {
    hidden: false,
    getElementById: (id) => nodes[id] || null,
    addEventListener: () => {},
  };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  global.window = {
    marketMonitor: {
      start: async () => ({}), stop: async () => ({}),
      setUpload: () => {},
      setCity: (id) => sent.push(id),
    },
  };
  try { body({ nodes, sent, store }); } finally {
    delete global.document; delete global.localStorage; delete global.window;
  }
}

test("the picker is revealed only where a capture exists", () => {
  withPanel("", ({ nodes }) => {
    bind();
    assert.strictEqual(nodes["monitor-city-label"].classList.has("hidden"), false);
  });
});

test("the stored city is restored and pushed to the capture on load", () => {
  withPanel("1002", ({ nodes, sent }) => {
    bind();
    assert.strictEqual(nodes["monitor-city"].value, "1002");
    assert.deepStrictEqual(sent, ["1002"]);
  });
});

test("choosing a city sends it to the capture and remembers it", () => {
  withPanel("", ({ nodes, sent, store }) => {
    bind();
    nodes["monitor-city"].value = "3008";
    nodes["monitor-city"].listeners.change();
    assert.strictEqual(sent.at(-1), "3008");
    assert.strictEqual(store.monitorCity, "3008");
  });
});

// Feedback for the pick itself: the status line only ever named the city that
// came back with a price patch, so choosing one looked like it did nothing
// until the next market was opened — and if the capture was already holding a
// different city, it went on showing that one.
test("choosing a city names it in the status line at once", () => {
  withPanel("", ({ nodes }) => {
    bind();
    nodes["monitor-city"].value = "1002";
    nodes["monitor-city"].listeners.change();
    assert.match(nodes["monitor-status"].textContent, /at Lymhurst/);
  });
});

test("going back to Auto leaves the last known city alone", () => {
  withPanel("1002", ({ nodes }) => {
    bind();
    nodes["monitor-city"].value = "";
    nodes["monitor-city"].listeners.change();
    assert.match(nodes["monitor-status"].textContent, /at Lymhurst/);
  });
});

test("going back to Auto clears the stored city", () => {
  withPanel("3008", ({ nodes, sent, store }) => {
    bind();
    nodes["monitor-city"].value = "";
    nodes["monitor-city"].listeners.change();
    assert.strictEqual(sent.at(-1), "");
    assert.strictEqual(store.monitorCity, "");
  });
});

// ── status line ────────────────────────────────────────────────────────────
test("the status line starts as just the capture state", () => {
  assert.strictEqual(statusLine({ status: "listening", message: "listening on Ethernet" }), "listening on Ethernet");
});

test("the status line grows as the capture picks things up", () => {
  withGlobals({}, {});
  applyPrices(update([order(), order({ Id: 2 })]));
  assert.strictEqual(
    statusLine({ message: "listening" }),
    "listening · at Caerleon · 2 orders",
  );
});

test("the status line copes with no state at all", () => {
  assert.strictEqual(statusLine(null), "");
});

// ── where the capture thinks it is ─────────────────────────────────────────
// The reported bug: "at Brecilien" under a capture whose player was standing in
// Lymhurst, with no way to tell the claim was hours old.
const { _setLocation: setLocation } = require("../js/render-monitor.js");
const AT = 1_800_000_000_000;

test("a location the app prices under is named by its city", () => {
  setLocation({ locationId: "3005", city: "Caerleon", at: AT });
  assert.strictEqual(statusLine({ message: "listening" }, AT), "listening · at Caerleon");
});

test("a location with no market column is named by its RAW ID, not the last city", () => {
  withGlobals({}, {});
  applyPrices(update([order()]));                       // teaches the line "Caerleon"
  setLocation({ locationId: "TNL-022", city: null, at: AT });
  const line = statusLine({ message: "listening" }, AT);
  assert.ok(line.includes("at TNL-022 (no market)"), line);
  assert.ok(!line.includes("Caerleon"), `a left city must not survive the move: ${line}`);
});

test("a fresh position says nothing about its age", () => {
  setLocation({ locationId: "3005", city: "Caerleon", at: AT - 60_000 });
  assert.strictEqual(statusLine({ message: "listening" }, AT), "listening · at Caerleon");
});

const AGE_CASES = [
  [30 * 60_000, "30m ago"],
  [3 * 3600_000, "3h ago"],
];
AGE_CASES.forEach(([elapsed, expected]) => {
  test(`a position last confirmed ${expected} says so`, () => {
    setLocation({ locationId: "3005", city: "Caerleon", at: AT - elapsed });
    assert.strictEqual(statusLine({ message: "listening" }, AT), `listening · at Caerleon · ${expected}`);
  });
});

// ── diagnostics ────────────────────────────────────────────────────────────
// The wire counters live in the badge's TOOLTIP. The line itself only speaks
// when something is wrong: while the capture is decoding markets it is a
// number scrolling under the button that nobody has to read, and "listening ·
// 442 orders · 20k pkts · 53k ev · 43 resp · 23/241 frag · 56 enc · 9 bad ·
// op 89/94" is unreadable at a glance.
const { _setDiagnostics: setDiagnostics, statusDetail } = require("../js/render-monitor.js");
const diag = (over = {}) => ({
  packets: 12000, responses: 40, marketResponses: 3, orderResponses: 3,
  emptyOrderResponses: 0, lastQueries: [],
  droppedNoLocation: 0, unknownOps: {}, ...over,
});

const DETAIL_CASES = [
  ["a silent adapter says so instead of counting nothing",
    diag({ packets: 0 }), "no packets — wrong adapter?"],
  ["packet counts are compacted", diag(), "12k pkts"],
  ["market messages are counted separately from orders", diag(), "3 market msg"],
  ["decoded responses are reported, so a live decoder is visible",
    diag({ responses: 40 }), "40 resp"],
  ["events show the decoder is walking the bulk of the traffic",
    diag({ events: 15000 }), "15k ev"],
  ["frames the decoder could not walk are reported",
    diag({ malformed: 900 }), "900 bad"],
  ["orders thrown away for want of a zone are named",
    diag({ droppedNoLocation: 5 }), "5 dropped (no zone)"],
  // 1598 dropped is unactionable on its own; the location says whether the
  // capture is in the Roads or holding no position at all.
  ["the location the drops were filed under is named when it is known",
    diag({ droppedNoLocation: 1598, lastDroppedLocation: "TNL-022" }), "1598 dropped (TNL-022)"],
  ["an order list on an unknown operation names the code",
    diag({ unknownOps: { 84: 2 } }), "op 84"],
  // Spelled out, because the two numbers count different things: 12 whole
  // messages rebuilt from 40 pieces is a HEALTHY capture, and the bare "12/40"
  // this used to print reads as a 70% loss rate.
  ["fragments say how many whole messages they rebuilt",
    diag({ fragments: 40, reassembled: 12 }), "12 msg of 40 frag"],
  ["encrypted bodies are counted, since they are unreadable by design",
    diag({ encrypted: 21000 }), "21k enc"],
];
DETAIL_CASES.forEach(([label, d, expected]) => {
  test(`tooltip: ${label}`, () => {
    setDiagnostics(d);
    assert.ok(statusDetail().includes(expected),
      `expected "${expected}" in "${statusDetail()}"`);
  });
});

test("tooltip: a capture with no zone traffic at all stays quiet about Join", () => {
  setDiagnostics(diag());
  assert.ok(!statusDetail(AT).includes("join"),
    `expected no join bit in "${statusDetail(AT)}"`);
});

test("tooltip: a Join read off another operation is named, not absorbed", () => {
  setDiagnostics(diag({ joinsByFallbackOp: { 77: 2 } }));
  assert.ok(statusDetail(AT).includes("join via op 77×2"),
    `expected the fallback operation in "${statusDetail(AT)}"`);
});

test("tooltip: a capture whose Joins all arrive normally says nothing about fallbacks", () => {
  setDiagnostics(diag({ location: "3005", locationAt: AT, joins: 4 }));
  assert.ok(!statusDetail(AT).includes("join via"),
    `expected no fallback bit in "${statusDetail(AT)}"`);
});

test("with no diagnostics the tooltip is empty", () => {
  setDiagnostics(null);
  assert.strictEqual(statusDetail(), "");
});

// ── faults in the status line ──────────────────────────────────────────────
// Each of these is something the user can act on: change the adapter, open a
// market, pick a city, or report a decoder that stopped working.
const FAULT_CASES = [
  ["a healthy capture says nothing beyond what it caught", diag(), null],
  ["a silent adapter is named", diag({ packets: 0 }), "no packets — wrong adapter?"],
  ["no market message yet is said plainly",
    diag({ marketResponses: 0, orderResponses: 0 }), "no market data yet"],
  // The reported bug: browsing an item nobody is listing (a T6 fish trophy)
  // left the line saying "no market data yet" for the whole session, which
  // reads as a broken capture. The game DID answer — the book was empty.
  ["an empty order book is not silence",
    diag({ marketResponses: 4, orderResponses: 0, emptyOrderResponses: 4 }),
    "4 empty book — no listings"],
  ["empty books alongside real ones are not a fault at all",
    diag({ marketResponses: 6, orderResponses: 3, emptyOrderResponses: 3 }), null],
  ["orders thrown away for want of a zone are named",
    diag({ droppedNoLocation: 5 }), "5 dropped (no zone)"],
  // 1598 dropped is unactionable on its own; the location says whether the
  // capture is in the Roads or holding no position at all.
  ["the location the drops were filed under is named when it is known",
    diag({ droppedNoLocation: 1598, lastDroppedLocation: "TNL-022" }), "1598 dropped (TNL-022)"],
  ["a decoder failing on most frames is named, with the share visible",
    diag({ malformed: 9000 }), "9000/12k bad"],
  // 9 bad frames in 20k packets is a live tap being live, not a fault.
  ["a handful of bad frames is not a fault", diag({ malformed: 9 }), null],
  ["unknown operation codes are not a fault — orders decode by shape",
    diag({ unknownOps: { 89: 4, 94: 2 } }), null],
  ["the counters themselves stay out of the line", diag({ events: 53000 }), null],
  // An order list given up on half-received is prices the player asked for and
  // never got. Silent on a healthy capture, so one is worth saying.
  ["a message lost half-received is a fault, even a single one",
    diag({ abandoned: 1 }), "1 lost mid-message"],
  // The distinction the old "12/40 frag" label destroyed: pieces rebuilt into
  // whole messages is the healthy case and must stay out of the line.
  ["fragments that all rebuilt into messages are not a fault",
    diag({ fragments: 859, reassembled: 163, abandoned: 0 }), null],
  // Reported 2026-09-11: a game patch shifted the numeric item ids, and every
  // "book was read" stamp landed on the wrong item without a word. The reader
  // now notices (js/market-sniffer-events.js itemIndexStale) — and it is only
  // fixable by updating the app, so it has to be said.
  ["an item index the game has moved past is a fault",
    diag({ itemIndexStale: true }), "item ids out of date — update the app"],
];
FAULT_CASES.forEach(([label, d, expected]) => {
  test(`status line: ${label}`, () => {
    setDiagnostics(d);
    const line = statusLine({ message: "listening" });
    if (expected === null) assert.strictEqual(line, "listening", `expected no diagnostics in "${line}"`);
    else assert.ok(line.includes(expected), `expected "${expected}" in "${line}"`);
  });
});

// The reported bug: after a teleport straight to an island the position stopped
// moving, and nothing in the app said so — a capture happily decoding markets
// while it believes the player is in the city they left looks entirely healthy.
test("status line: a position nothing has confirmed for ten minutes is a fault", () => {
  setDiagnostics(diag({ location: "3005", locationAt: AT - 14 * 60000, joins: 4 }));
  const line = statusLine({ message: "listening" }, AT);
  assert.ok(line.includes("position not confirmed 14m ago"), `expected the stale position in "${line}"`);
});

test("status line: a position confirmed a minute ago is not a fault", () => {
  setDiagnostics(diag({ location: "3005", locationAt: AT - 60000, joins: 4 }));
  assert.strictEqual(statusLine({ message: "listening" }, AT), "listening");
});

test("status line: standing still in one zone is not a stale position", () => {
  // locationAt is when the position was CONFIRMED, not when it last changed —
  // the reader restamps it on every Join, so a player who has not moved for an
  // hour must not read as a capture that lost the game.
  setDiagnostics(diag({ location: "3005", locationAt: AT, joins: 400 }));
  assert.strictEqual(statusLine({ message: "listening" }, AT), "listening");
});

test("an empty book never also claims there is no market data", () => {
  setDiagnostics(diag({ marketResponses: 4, orderResponses: 0, emptyOrderResponses: 4 }));
  const line = statusLine({ message: "listening" });
  assert.ok(!line.includes("no market data yet"), `the game answered: "${line}"`);
});

// The whole point of the query log: naming the item the capture last saw a
// market for. "Zander Trophy · Caerleon · 0 sell" answers the question the
// counters cannot — was this item even asked about?
test("tooltip: the last markets seen are named, with their listing counts", () => {
  setDiagnostics(diag({
    emptyOrderResponses: 1,
    lastQueries: [
      { itemId: "T6_FURNITUREITEM_TROPHY_FISH", albionId: 9738, city: "Caerleon", count: 0, side: "offer" },
      { itemId: "T4_BAG", albionId: 4, city: "Martlock", count: 12, side: "request" },
    ],
  }));
  const detail = statusDetail();
  assert.ok(detail.includes("Caerleon · 0 sell"), `expected the empty book in "${detail}"`);
  assert.ok(detail.includes("Martlock · 12 buy"), `expected the live book in "${detail}"`);
});

test("tooltip: a query the item index cannot name falls back to the wire id", () => {
  setDiagnostics(diag({
    lastQueries: [{ itemId: null, albionId: 65000, city: "Caerleon", count: 0, side: "offer" }],
  }));
  assert.ok(statusDetail().includes("#65000"), statusDetail());
});

// Reported as "Elder's Hellion Shoes Black Market price not detected by the
// sniffer". It was detected: browsing the Black Market by category answers with
// one page of orders for dozens of items, and the line printed a bare "?" for
// the name it could not pick. "?" reads as "the capture saw nothing"; the count
// says what actually happened.
test("tooltip: a browse that read many books says how many, not '?'", () => {
  setDiagnostics(diag({
    lastQueries: [{ itemId: null, albionId: null, itemCount: 12, city: "Black Market", count: 50, side: "request" }],
  }));
  const detail = statusDetail();
  assert.ok(detail.includes("12 items · Black Market · 50 buy"), detail);
  assert.ok(!detail.includes("?"), `no unnamed query left in "${detail}"`);
});

test("tooltip: a genuinely unnamed query still says so", () => {
  setDiagnostics(diag({
    lastQueries: [{ itemId: null, albionId: null, itemCount: 0, city: "Caerleon", count: 0, side: "offer" }],
  }));
  assert.ok(statusDetail().includes("? · Caerleon · 0 sell"), statusDetail());
});

test("no diagnostics yet leaves the line as it was", () => {
  setDiagnostics(null);
  assert.strictEqual(statusLine({ message: "listening" }), "listening");
});

test("the live line the user complained about is down to what they caught", () => {
  withGlobals({}, {});
  applyPrices(update([order(), order({ Id: 2 })]));
  setDiagnostics(diag({
    packets: 20000, events: 53000, responses: 43, orderResponses: 10,
    fragments: 241, reassembled: 23, encrypted: 56, malformed: 9,
    unknownOps: { 89: 3, 94: 1 },
  }));
  assert.strictEqual(
    statusLine({ message: "listening on Microsoft (192.168.178.33)" }),
    "listening on Microsoft (192.168.178.33) · at Caerleon · 2 orders",
  );
  assert.ok(statusDetail().includes("20k pkts"), "the counters moved to the tooltip");
});

// ── run state ──────────────────────────────────────────────────────────────
// The button label follows the CAPTURE, not the message. "idle" is what the
// sniffer reports after 20 s of silence on the last candidate adapter — the tap
// is still open, so the control must still offer Stop. Reading it as stopped
// flipped the button back to "Start Monitor" and the next click was a no-op
// (main.js returns early while the session runs), stranding the user.
const RUN_STATE_CASES = [
  ["listening", { status: "listening", message: "listening on Ethernet" }, true],
  ["idle after a silent adapter", { status: "idle", message: "no Albion traffic — is the game running?" }, true],
  ["a state carrying an explicit running flag", { status: "idle", running: false }, false],
  ["stopped", { status: "stopped", message: "stopped" }, false],
  ["unavailable", { status: "unavailable", message: "capture library missing" }, false],
  ["error", { status: "error", message: "cannot open device" }, false],
  ["no state at all", null, false],
];
RUN_STATE_CASES.forEach(([label, state, expected]) => {
  test(`captureRunning: ${label} → ${expected}`, () => {
    assert.strictEqual(captureRunning(state), expected);
  });
});

test("an idle state keeps the adapter name it reported", () => {
  const state = { status: "idle", message: "no Albion traffic on Ethernet (192.168.0.5) — is the game running?" };
  assert.ok(statusLine(state).includes("192.168.0.5"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
