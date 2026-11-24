/**
 * Test: prices captured by the live market monitor survive a restart, and a
 * later AODP scan does not silently throw them away.
 *
 * Bug (reported): "data was fetched from monitor, should be saved and shown".
 * applyPrices (render-monitor.js) merged a capture into the in-memory
 * lastMarketData / lastQualityMarketData only — nothing persisted it, so
 * closing the app lost every captured order book. A full "Scan Market Now" was
 * just as destructive: app.js assigned `lastMarketData = data` wholesale.
 *
 * Contract under test (js/captured-prices-store.js):
 *   - recordCapturedPrices(patch) accumulates captures and persists them,
 *   - loadCapturedPrices() returns them after a restart, pruned by age and by
 *     a cell cap so localStorage cannot grow without bound,
 *   - mergeCapturedInto{Quality,Flat} folds them back onto scan data
 *     DATE-AWARE: a capture only wins where it is newer than what is already
 *     there (or where that side has no price at all).
 *
 * Black-box: pure functions + an injected fake storage. No DOM, no live API.
 *
 * Run: node tests/captured-prices-persistence.test.cjs
 */

const assert = require("assert");
const path = require("path");

const S = require(path.join(__dirname, "..", "js", "captured-prices-store.js"));

// ── fake localStorage ────────────────────────────────────────────────────
function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  let writes = 0;
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (k === "capturedPrices") writes++; map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
    _writes: () => writes,
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// One quality-shaped capture: { itemId: { quality: { city: entry } } }
function cell({ sell = 0, buy = 0, sellAge = 0, buyAge = 0, vol = 0 } = {}) {
  return {
    sell_price: sell,
    buy_price: buy,
    sell_date: sell ? iso(sellAge) : null,
    buy_date: buy ? iso(buyAge) : null,
    volume_24h: vol,
    used_fallback: false,
    from_sniffer: true,
  };
}
function qmap(entries) {
  const out = {};
  entries.forEach(([id, quality, city, e]) => {
    out[id] = out[id] || {};
    out[id][quality] = out[id][quality] || {};
    out[id][quality][city] = e;
  });
  return out;
}

// Cases are queued rather than run inline: the file-backed ones are async
// (the bridge crosses IPC), and they must not interleave with each other or
// with the synchronous ones — every case resets the shared session map.
let passed = 0, failed = 0;
const queue = [];
function test(name, fn) {
  queue.push(async () => {
    try { await fn(); console.log(`  PASS: ${name}`); passed++; }
    catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  });
}

console.log("Captured price persistence tests\n");

// ── round trip ───────────────────────────────────────────────────────────
test("a capture saved now is returned by a fresh load", () => {
  const st = fakeStorage();
  const patch = qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000, buy: 3510 })]]);
  S.saveCapturedPrices(patch, { storage: st, now: NOW });
  const back = S.loadCapturedPrices({ storage: st, now: NOW });
  assert.strictEqual(back.T6_ENERGY[1].Lymhurst.sell_price, 4000);
  assert.strictEqual(back.T6_ENERGY[1].Lymhurst.buy_price, 3510);
});

test("recordCapturedPrices accumulates across captures and persists each one", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })]]),
    { storage: st, now: NOW },
  );
  S.recordCapturedPrices(
    qmap([["T6_ENERGY", 1, "Martlock", cell({ buy: 3000 })]]),
    { storage: st, now: NOW },
  );
  S.flushCapturedPrices({ storage: st, now: NOW });
  const back = S.loadCapturedPrices({ storage: st, now: NOW });
  assert.strictEqual(back.T6_ENERGY[1].Lymhurst.sell_price, 4000, "first capture kept");
  assert.strictEqual(back.T6_ENERGY[1].Martlock.buy_price, 3000, "second capture added");
});

test("a second capture of the same cell keeps the side the new one did not see", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000, buy: 3510 })]]),
    { storage: st, now: NOW },
  );
  // Offers-only response: buy_price 0 means "not observed", not "gone".
  S.recordCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 3900 })]]),
    { storage: st, now: NOW },
  );
  S.flushCapturedPrices({ storage: st, now: NOW });
  const back = S.loadCapturedPrices({ storage: st, now: NOW });
  assert.strictEqual(back.T6_ENERGY[1].Lymhurst.sell_price, 3900, "new ask applied");
  assert.strictEqual(back.T6_ENERGY[1].Lymhurst.buy_price, 3510, "unseen bid preserved");
});

// ── the save is deferred, so a burst cannot freeze the window ────────────
//
// Bug (reported): "app is freezing when i open market". Opening one market
// emits a market response per page/tab, and each one used to prune the whole
// captured map, JSON.stringify ~2 MB into localStorage and then re-walk every
// cell to count it — ~78 ms of blocked main thread PER RESPONSE once a week of
// captures has accumulated. Recording must be proportional to the PATCH; the
// full save happens once the burst settles, or on an explicit flush.
test("a burst of captures writes storage no more than once, on flush", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  for (let i = 0; i < 50; i++) {
    S.recordCapturedPrices(qmap([[`ITEM_${i}`, 1, "Lymhurst", cell({ sell: 100 + i })]]),
      { storage: st, now: NOW });
  }
  assert.strictEqual(st._writes(), 0, "nothing written during the burst");
  S.flushCapturedPrices({ storage: st, now: NOW });
  assert.strictEqual(st._writes(), 1, "exactly one write for the whole burst");
});

test("flush persists everything the burst accumulated", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  for (let i = 0; i < 50; i++) {
    S.recordCapturedPrices(qmap([[`ITEM_${i}`, 1, "Lymhurst", cell({ sell: 100 + i })]]),
      { storage: st, now: NOW });
  }
  S.flushCapturedPrices({ storage: st, now: NOW });
  const back = S.loadCapturedPrices({ storage: st, now: NOW });
  assert.strictEqual(Object.keys(back).length, 50);
  assert.strictEqual(back.ITEM_49[1].Lymhurst.sell_price, 149);
});

test("a capture is readable in memory before its save lands", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })]]),
    { storage: st, now: NOW });
  assert.strictEqual(S.getCapturedPrices().T6_ENERGY[1].Lymhurst.sell_price, 4000);
  assert.strictEqual(st._writes(), 0, "and still nothing written");
});

test("saveDelayMs 0 writes immediately", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })]]),
    { storage: st, now: NOW, saveDelayMs: 0 });
  assert.strictEqual(st._writes(), 1);
  assert.strictEqual(S.loadCapturedPrices({ storage: st, now: NOW }).T6_ENERGY[1].Lymhurst.sell_price, 4000);
});

test("recordCapturedPrices still returns the number of cells held", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  const a = S.recordCapturedPrices(qmap([["A", 1, "Lymhurst", cell({ sell: 1 })]]), { storage: st, now: NOW });
  const b = S.recordCapturedPrices(qmap([["B", 1, "Lymhurst", cell({ sell: 2 })]]), { storage: st, now: NOW });
  // Same cell again — an update, not a new cell.
  const c = S.recordCapturedPrices(qmap([["A", 1, "Lymhurst", cell({ sell: 3 })]]), { storage: st, now: NOW });
  assert.deepStrictEqual([a, b, c], [1, 2, 2]);
});

test("recording into a large map stays fast enough not to block a market open", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  const cities = ["Bridgewatch", "Martlock", "Lymhurst", "Fort Sterling", "Thetford", "Caerleon"];
  const bulk = [];
  for (let i = 0; i < 18000; i++) bulk.push([`BULK_${i}`, 1, cities[i % 6], cell({ sell: 100 + i })]);
  S.recordCapturedPrices(qmap(bulk), { storage: st, now: NOW });
  S.flushCapturedPrices({ storage: st, now: NOW });

  const t0 = Date.now();
  for (let r = 0; r < 200; r++) {
    const patch = [];
    for (let i = 0; i < 40; i++) patch.push([`RESP_${r}_${i}`, 1, cities[i % 6], cell({ sell: 500 + i })]);
    S.recordCapturedPrices(qmap(patch), { storage: st, now: NOW });
  }
  const elapsed = Date.now() - t0;
  // The old per-patch prune+stringify took ~78 ms each: ~15 s for these 200.
  assert.ok(elapsed < 1000, `200 responses took ${elapsed} ms — recording is not patch-proportional`);
});

// ── pruning ──────────────────────────────────────────────────────────────
test("cells older than the retention window are dropped on load", () => {
  const st = fakeStorage();
  const patch = qmap([
    ["FRESH", 1, "Lymhurst", cell({ sell: 100, sellAge: 2 * DAY })],
    ["STALE", 1, "Lymhurst", cell({ sell: 100, sellAge: 30 * DAY })],
  ]);
  S.saveCapturedPrices(patch, { storage: st, now: NOW });
  const back = S.loadCapturedPrices({ storage: st, now: NOW, maxAgeMs: 7 * DAY });
  assert.ok(back.FRESH, "fresh cell kept");
  assert.strictEqual(back.STALE, undefined, "stale cell dropped");
});

test("an item left with no cells after pruning disappears entirely", () => {
  const st = fakeStorage();
  S.saveCapturedPrices(
    qmap([["STALE", 1, "Lymhurst", cell({ sell: 100, sellAge: 30 * DAY })]]),
    { storage: st, now: NOW },
  );
  const back = S.loadCapturedPrices({ storage: st, now: NOW, maxAgeMs: 7 * DAY });
  assert.deepStrictEqual(back, {}, "no empty item/quality husks left behind");
});

test("the cell cap keeps the NEWEST cells", () => {
  const st = fakeStorage();
  const patch = qmap([
    ["A", 1, "Lymhurst", cell({ sell: 1, sellAge: 5 * DAY })],
    ["B", 1, "Lymhurst", cell({ sell: 2, sellAge: 1 * DAY })],
    ["C", 1, "Lymhurst", cell({ sell: 3, sellAge: 3 * DAY })],
  ]);
  S.saveCapturedPrices(patch, { storage: st, now: NOW, maxCells: 2 });
  const back = S.loadCapturedPrices({ storage: st, now: NOW });
  assert.ok(back.B && back.C, "two newest kept");
  assert.strictEqual(back.A, undefined, "oldest dropped");
});

// ── a capture is kept until a newer reading replaces it ──────────────────
//
// Bug (reported): "i had all artifact prices in artifact table scanned by
// sniffer, but after some time they disappeared." The window was a hard-coded
// week and the prune is destructive — hydrate prunes, the next flush writes the
// pruned map back. For an artifact that is unrecoverable: the AODP has no
// artifact data at all, so the capture was the only price that ever existed.
// There is no TTL any more; `maxAgeMs` remains as an option for a caller that
// asks for one, which is what the two tests above pass.
test("the default window is no window at all", () => {
  assert.strictEqual(S.CAPTURED_MAX_AGE_MS, Infinity);
});

[
  ["a week and a day", 8 * DAY],
  ["two months", 60 * DAY],
  ["a year", 365 * DAY],
].forEach(([label, sellAge]) => {
  test(`a capture ${label} old survives a save/load round-trip`, () => {
    const st = fakeStorage();
    S.saveCapturedPrices(
      qmap([["T6_ARTEFACT_TOKEN", 1, "Caerleon", cell({ sell: 250_000, sellAge })]]),
      { storage: st, now: NOW },
    );
    const back = S.loadCapturedPrices({ storage: st, now: NOW });
    assert.strictEqual(back.T6_ARTEFACT_TOKEN[1].Caerleon.sell_price, 250_000);
  });
});

test("a newer capture of the same cell replaces the old one, never doubles it", () => {
  S.resetCapturedPrices();
  const id = "T6_ARTEFACT_MAIN_RAPIER_MORGANA";
  S.recordCapturedPrices(
    qmap([[id, 1, "Caerleon", cell({ sell: 200_000, sellAge: 200 * DAY })]]),
    { saveDelayMs: 0, storage: fakeStorage(), now: NOW },
  );
  const held = S.recordCapturedPrices(
    qmap([[id, 1, "Caerleon", cell({ sell: 250_000, sellAge: 0 })]]),
    { saveDelayMs: 0, storage: fakeStorage(), now: NOW },
  );
  const map = S.getCapturedPrices();
  assert.strictEqual(map[id][1].Caerleon.sell_price, 250_000, "newest reading wins");
  assert.strictEqual(held, 1, "one cell, not two");
  S.resetCapturedPrices();
});

test("age never removes a cell, however old", () => {
  const st = fakeStorage();
  const patch = qmap([["OLD", 1, "Lymhurst", cell({ sell: 100, sellAge: 900 * DAY })]]);
  assert.ok(S.pruneCapturedPrices(patch, { storage: st, now: NOW }).OLD);
});

test("a caller may still ask for a window explicitly", () => {
  const st = fakeStorage();
  const patch = qmap([["OLD", 1, "Lymhurst", cell({ sell: 100, sellAge: 30 * DAY })]]);
  assert.strictEqual(
    S.pruneCapturedPrices(patch, { storage: st, now: NOW, maxAgeMs: 7 * DAY }).OLD, undefined);
});

test("keeping everything does NOT disable the cell cap", () => {
  const st = fakeStorage();
  const patch = qmap([
    ["A", 1, "Lymhurst", cell({ sell: 1, sellAge: 400 * DAY })],
    ["B", 1, "Lymhurst", cell({ sell: 2, sellAge: 1 * DAY })],
  ]);
  const pruned = S.pruneCapturedPrices(patch, { storage: st, now: NOW, maxCells: 1 });
  assert.ok(pruned.B, "newest kept");
  assert.strictEqual(pruned.A, undefined, "the cap is what bounds the file, not the age");
});

// ── corrupt / versioned storage ──────────────────────────────────────────
test("a missing key loads as an empty map", () => {
  assert.deepStrictEqual(S.loadCapturedPrices({ storage: fakeStorage(), now: NOW }), {});
});

test("corrupt JSON loads as an empty map instead of throwing", () => {
  const st = fakeStorage({ capturedPrices: "{not json" });
  assert.deepStrictEqual(S.loadCapturedPrices({ storage: st, now: NOW }), {});
});

test("a schema version bump discards the old payload", () => {
  const st = fakeStorage();
  S.saveCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })]]),
    { storage: st, now: NOW },
  );
  st.setItem("capturedPricesVersion", "0");
  assert.deepStrictEqual(S.loadCapturedPrices({ storage: st, now: NOW }), {});
});

// ── date-aware merge back onto scan data ─────────────────────────────────
test("a NEWER capture overwrites the scanned price", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(6 * 60 * 60 * 1000), buy_date: iso(6 * 60 * 60 * 1000), volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Lymhurst: cell({ sell: 4000, buy: 3510, sellAge: 60 * 1000, buyAge: 60 * 1000 }) } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.sell_price, 4000);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.buy_price, 3510);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.volume_24h, 90, "scanned volume must survive");
});

test("an OLDER capture does not overwrite a fresher scan", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(60 * 1000), buy_date: iso(60 * 1000), volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Lymhurst: cell({ sell: 4000, buy: 3510, sellAge: 3 * DAY, buyAge: 3 * DAY }) } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.sell_price, 5000);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.buy_price, 4500);
});

test("a capture fills a side the scan has no price for, whatever the dates", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 0, sell_date: iso(60 * 1000), buy_date: null, volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Lymhurst: cell({ buy: 3510, buyAge: 3 * DAY }) } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.buy_price, 3510, "empty side takes the capture");
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.sell_price, 5000, "live side untouched");
});

// ── volume from a captured price CHART (market-history-volume.js) ────────
test("a captured volume fills a cell the scan measured no volume for", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(60 * 1000), buy_date: iso(60 * 1000), volume_24h: 0 } } };
  const captured = { T6_ENERGY: { Lymhurst: { ...cell(), volume_24h: 42, volume_date: iso(2 * 60 * 60 * 1000) } } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.volume_24h, 42);
});

test("a NEWER captured volume replaces the scanned one", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(6 * 60 * 60 * 1000), buy_date: iso(6 * 60 * 60 * 1000), volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Lymhurst: { ...cell(), volume_24h: 42, volume_date: iso(60 * 1000) } } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.volume_24h, 42);
});

test("an OLDER captured volume leaves a fresher scanned one alone", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(60 * 1000), buy_date: iso(60 * 1000), volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Lymhurst: { ...cell(), volume_24h: 42, volume_date: iso(3 * DAY) } } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.volume_24h, 90);
});

test("an order-only capture (no chart) still never invents volume", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(6 * 60 * 60 * 1000), buy_date: iso(6 * 60 * 60 * 1000), volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Lymhurst: cell({ sell: 4000, buy: 3510, sellAge: 60 * 1000, buyAge: 60 * 1000 }) } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.volume_24h, 90, "listed stock is not traded volume");
});

test("a volume-only capture is kept alongside a price capture of the same cell", () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000, buy: 3510 })]]),
    { storage: st, now: NOW },
  );
  S.recordCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", { ...cell(), volume_24h: 42, volume_date: iso(0) }]]),
    { storage: st, now: NOW },
  );
  S.flushCapturedPrices({ storage: st, now: NOW });
  const back = S.loadCapturedPrices({ storage: st, now: NOW });
  const c = back.T6_ENERGY[1].Lymhurst;
  assert.strictEqual(c.volume_24h, 42, "the chart's volume landed");
  assert.strictEqual(c.sell_price, 4000, "and the order capture survived it");
  assert.strictEqual(c.buy_price, 3510);
});

test("a volume-only cell is not aged out by its volume_date", () => {
  const st = fakeStorage();
  S.saveCapturedPrices(
    qmap([["T6_ENERGY", 1, "Lymhurst", { ...cell(), volume_24h: 42, volume_date: iso(2 * DAY) }]]),
    { storage: st, now: NOW },
  );
  const back = S.loadCapturedPrices({ storage: st, now: NOW, maxAgeMs: 7 * DAY });
  assert.strictEqual(back.T6_ENERGY[1].Lymhurst.volume_24h, 42);
});

test("a capture for a city the scan never saw is added", () => {
  const scan = { T6_ENERGY: { Lymhurst: { sell_price: 5000, buy_price: 4500, sell_date: iso(60 * 1000), buy_date: iso(60 * 1000), volume_24h: 90 } } };
  const captured = { T6_ENERGY: { Martlock: cell({ sell: 4200, buy: 3900 }) } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Martlock.sell_price, 4200);
  assert.strictEqual(scan.T6_ENERGY.Martlock.volume_24h, 0, "a capture never invents volume");
});

test("an item the scan never fetched is added wholesale", () => {
  const scan = {};
  const captured = { T6_ENERGY: { Lymhurst: cell({ sell: 4000, buy: 3510 }) } };
  S.mergeCapturedIntoFlat(scan, captured);
  assert.strictEqual(scan.T6_ENERGY.Lymhurst.sell_price, 4000);
});

test("the quality-shaped merge follows the same date rule", () => {
  const scan = { T6_ENERGY: { 1: { Lymhurst: { sell_price: 5000, buy_price: 0, sell_date: iso(3 * DAY), buy_date: null, volume_24h: 12 } } } };
  const captured = qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000, buy: 3510, sellAge: 60 * 1000, buyAge: 60 * 1000 })]]);
  S.mergeCapturedIntoQuality(scan, captured);
  assert.strictEqual(scan.T6_ENERGY[1].Lymhurst.sell_price, 4000, "newer capture wins");
  assert.strictEqual(scan.T6_ENERGY[1].Lymhurst.buy_price, 3510, "empty side filled");
  assert.strictEqual(scan.T6_ENERGY[1].Lymhurst.volume_24h, 12, "scanned volume survives");
});

// ── the userData file backend ────────────────────────────────────────────
//
// Bug (reported): "after sniffer fetched market prices they disappear after
// some time or restart". Two causes lived here. The map was in localStorage,
// where a week of captures is megabytes and a quota error drops the write
// silently — and takes the crafting list and the price overrides down with it.
// And hydrate REPLACED the session map, so anything the auto-started monitor
// captured while the boot was still awaiting the scan file was thrown away and
// then overwritten on disk by the next flush.

function fakeBridge(initial) {
  let stored = initial === undefined ? null : initial;
  let saves = 0;
  return {
    load: async () => stored,
    save: async (map) => { saves++; stored = JSON.parse(JSON.stringify(map)); return true; },
    _stored: () => stored,
    _saves: () => saves,
  };
}

test("a capture round-trips through the file bridge, not localStorage", async () => {
  const br = fakeBridge();
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })]]),
    { bridge: br, storage: st, now: NOW, saveDelayMs: 0 });
  assert.strictEqual(br._saves(), 1, "the file took the write");
  assert.strictEqual(st._writes(), 0, "localStorage was left alone");
  assert.strictEqual(br._stored().T6_ENERGY[1].Lymhurst.sell_price, 4000);
});

test("hydrate MERGES the stored map into the session instead of replacing it", async () => {
  const br = fakeBridge(qmap([["STORED", 1, "Lymhurst", cell({ sell: 111 })]]));
  S.resetCapturedPrices();
  // A capture lands while the boot is still awaiting the file — the exact race.
  S.recordCapturedPrices(qmap([["MIDBOOT", 1, "Martlock", cell({ sell: 222 })]]),
    { bridge: br, now: NOW });
  await S.hydrateCapturedPrices({ bridge: br, now: NOW });
  const held = S.getCapturedPrices();
  assert.strictEqual(held.STORED[1].Lymhurst.sell_price, 111, "the file's captures restored");
  assert.strictEqual(held.MIDBOOT[1].Martlock.sell_price, 222, "the mid-boot capture survived");
});

test("a mid-boot capture wins over the stored copy of the same cell", async () => {
  // The stored copy is a reading from an earlier session — hours back, so the
  // two are not pages of one browse (js/captured-prices-store.js reduces those
  // to the board's best side instead of taking the later one).
  const br = fakeBridge(qmap([
    ["T6_ENERGY", 1, "Lymhurst", cell({ sell: 111, buy: 99, sellAge: 4 * HOUR, buyAge: 4 * HOUR })],
  ]));
  S.resetCapturedPrices();
  S.recordCapturedPrices(qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 222 })]]),
    { bridge: br, now: NOW });
  await S.hydrateCapturedPrices({ bridge: br, now: NOW });
  const c = S.getCapturedPrices().T6_ENERGY[1].Lymhurst;
  assert.strictEqual(c.sell_price, 222, "the live capture is the newer reading");
  assert.strictEqual(c.buy_price, 99, "the side it did not observe comes from the file");
});

test("hydrate prunes what it restores", async () => {
  const br = fakeBridge(qmap([
    ["FRESH", 1, "Lymhurst", cell({ sell: 100, sellAge: 2 * DAY })],
    ["STALE", 1, "Lymhurst", cell({ sell: 100, sellAge: 30 * DAY })],
  ]));
  S.resetCapturedPrices();
  await S.hydrateCapturedPrices({ bridge: br, now: NOW, maxAgeMs: 7 * DAY });
  const held = S.getCapturedPrices();
  assert.ok(held.FRESH);
  assert.strictEqual(held.STALE, undefined);
});

test("an unreadable file hydrates as empty rather than throwing", async () => {
  const br = { load: async () => { throw new Error("EACCES"); }, save: async () => true };
  S.resetCapturedPrices();
  await assert.doesNotReject(() => S.hydrateCapturedPrices({ bridge: br, now: NOW }));
  assert.deepStrictEqual(S.getCapturedPrices(), {});
});

test("the file cap is far larger than the old localStorage one", () => {
  assert.ok(S.CAPTURED_MAX_CELLS_FILE > S.CAPTURED_MAX_CELLS * 10,
    "a quota-sized cap has no business bounding a file");
});

// ── one-shot migration off localStorage ──────────────────────────────────
test("captures already in localStorage move to the file on first hydrate", async () => {
  const st = fakeStorage();
  S.saveCapturedPrices(qmap([["LEGACY", 1, "Lymhurst", cell({ sell: 777 })]]),
    { storage: st, now: NOW });
  const br = fakeBridge();
  S.resetCapturedPrices();
  await S.hydrateCapturedPrices({ bridge: br, storage: st, now: NOW });
  assert.strictEqual(S.getCapturedPrices().LEGACY[1].Lymhurst.sell_price, 777, "restored");
  assert.strictEqual(br._stored().LEGACY[1].Lymhurst.sell_price, 777, "and written to the file");
  assert.strictEqual(st.getItem("capturedPrices"), null, "the legacy key is gone");
  assert.strictEqual(st.getItem("capturedPricesVersion"), null);
});

test("the migration does not clobber captures already in the file", async () => {
  const st = fakeStorage();
  S.saveCapturedPrices(qmap([["LEGACY", 1, "Lymhurst", cell({ sell: 777 })]]),
    { storage: st, now: NOW });
  const br = fakeBridge(qmap([["ONFILE", 1, "Martlock", cell({ sell: 888 })]]));
  S.resetCapturedPrices();
  await S.hydrateCapturedPrices({ bridge: br, storage: st, now: NOW });
  const held = S.getCapturedPrices();
  assert.strictEqual(held.LEGACY[1].Lymhurst.sell_price, 777);
  assert.strictEqual(held.ONFILE[1].Martlock.sell_price, 888);
});

test("a second hydrate has nothing left to migrate", async () => {
  const st = fakeStorage();
  S.saveCapturedPrices(qmap([["LEGACY", 1, "Lymhurst", cell({ sell: 777 })]]),
    { storage: st, now: NOW });
  const br = fakeBridge();
  S.resetCapturedPrices();
  await S.hydrateCapturedPrices({ bridge: br, storage: st, now: NOW });
  S.resetCapturedPrices();
  await S.hydrateCapturedPrices({ bridge: br, storage: st, now: NOW });
  assert.strictEqual(S.getCapturedPrices().LEGACY[1].Lymhurst.sell_price, 777,
    "still there — it lives in the file now");
});

test("with no bridge at all the store still uses localStorage", async () => {
  const st = fakeStorage();
  S.resetCapturedPrices();
  S.recordCapturedPrices(qmap([["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })]]),
    { storage: st, now: NOW, saveDelayMs: 0 });
  assert.strictEqual(st._writes(), 1);
  S.resetCapturedPrices();
  await S.hydrateCapturedPrices({ storage: st, now: NOW });
  assert.strictEqual(S.getCapturedPrices().T6_ENERGY[1].Lymhurst.sell_price, 4000);
});

// ── a scan must not erase captures ───────────────────────────────────────
//
// The flat map has been protected by applyScanPatch for a while; the QUALITY
// map was still being assigned directly by the Rerolling scan and the
// rerolling search-fetch, so a sniffed quality price vanished the moment
// either ran.
test("a quality scan keeps the captured cells for the items it re-priced", () => {
  S.resetCapturedPrices();
  S.recordCapturedPrices(
    qmap([["T6_BAG", 3, "Martlock", cell({ sell: 1234, sellAge: 60 * 1000 })]]),
    { storage: fakeStorage(), now: NOW },
  );
  const target = {};
  // The scan returns q1 for the same item and nothing at q3.
  S.applyQualityScanPatch(target, { T6_BAG: { 1: { Martlock: { sell_price: 500, buy_price: 0, sell_date: iso(6 * 60 * 60 * 1000), buy_date: null, volume_24h: 9 } } } });
  assert.strictEqual(target.T6_BAG[1].Martlock.sell_price, 500, "the scan landed");
  assert.strictEqual(target.T6_BAG[3].Martlock.sell_price, 1234, "the capture survived it");
});

test("a quality scan leaves items it did not touch alone", () => {
  S.resetCapturedPrices();
  const target = { OTHER: { 1: { Martlock: { sell_price: 7 } } } };
  S.applyQualityScanPatch(target, { T6_BAG: { 1: { Martlock: { sell_price: 500 } } } });
  assert.strictEqual(target.OTHER[1].Martlock.sell_price, 7);
});

test("a NEWER quality scan still beats an older capture of the same cell", () => {
  S.resetCapturedPrices();
  S.recordCapturedPrices(
    qmap([["T6_BAG", 1, "Martlock", cell({ sell: 1234, sellAge: 3 * DAY })]]),
    { storage: fakeStorage(), now: NOW },
  );
  const target = {};
  S.applyQualityScanPatch(target, { T6_BAG: { 1: { Martlock: { sell_price: 500, buy_price: 0, sell_date: iso(60 * 1000), buy_date: null, volume_24h: 9 } } } });
  assert.strictEqual(target.T6_BAG[1].Martlock.sell_price, 500);
});

test("flattenCaptured projects quality 1 onto the flat shape", () => {
  const captured = qmap([
    ["T6_ENERGY", 1, "Lymhurst", cell({ sell: 4000 })],
    ["T6_ENERGY", 3, "Lymhurst", cell({ sell: 9000 })],
  ]);
  const flat = S.flattenCaptured(captured);
  assert.strictEqual(flat.T6_ENERGY.Lymhurst.sell_price, 4000, "quality 1 only");
});

(async () => {
  for (const run of queue) await run();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
