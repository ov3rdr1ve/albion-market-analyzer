/**
 * Test: prices pulled by "Scan Market Now" survive closing the app.
 *
 * Bug (reported): "when i scanned all markets why prices not saved after
 * restart?". A scan only ever assigned the in-memory globals (lastMarketData /
 * lastQualityMarketData / lastMpMarketData) — nothing wrote them anywhere, so
 * every table was empty again on the next launch. Only monitor captures
 * persisted (js/captured-prices-store.js).
 *
 * localStorage is the wrong home for this one: a full scan is ~9k items × 9
 * cities across three maps, several megabytes of JSON, which is at or over the
 * quota. So the bundle goes to a JSON file under userData through the main
 * process, and the renderer keeps only the pure logic tested here.
 *
 * Contract under test:
 *   js/scan-price-store.js (renderer, pure)
 *     - buildScanBundle stamps a version + savedAt around the three maps,
 *     - readScanBundle gives them back, and returns null for anything it
 *       should not trust: corrupt, wrong version, or older than the TTL,
 *     - scheduleScanSave coalesces a burst of scans into one write, and
 *       flushScanSave forces the pending one out now.
 *   js/scan-price-file.js (main process, injected fs)
 *     - load returns null for a missing/corrupt file, the parsed object
 *       otherwise; save reports whether the write landed.
 *   Restored scan data still loses to a NEWER capture, and wins over an older
 *   one — the fold that keeps both sources honest.
 *
 * Black-box: pure functions, injected clock, injected fs, injected save. No
 * DOM, no live API, no real filesystem.
 *
 * Run: node tests/scan-price-persistence.test.cjs
 */

const assert = require("assert");
const path = require("path");

const S = require(path.join(__dirname, "..", "js", "scan-price-store.js"));
const F = require(path.join(__dirname, "..", "js", "scan-price-file.js"));
const C = require(path.join(__dirname, "..", "js", "captured-prices-store.js"));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function flatCell({ sell = 0, buy = 0, ageMs = 0, vol = 0 } = {}) {
  return {
    sell_price: sell,
    buy_price: buy,
    sell_date: sell ? iso(ageMs) : null,
    buy_date: buy ? iso(ageMs) : null,
    volume_24h: vol,
  };
}

const FLAT = { T4_BAG: { Caerleon: flatCell({ sell: 1000, buy: 900, vol: 42 }) } };
const QUALITY = { T4_BAG: { 1: { Caerleon: flatCell({ sell: 1000 }) } } };
const MP = { T8_MOUNT_HORSE: { Martlock: flatCell({ sell: 5_000_000 }) } };

let failures = 0;
// Sync or async: a test that returns a promise is awaited before the summary,
// so a rejected assertion inside a .then still counts as a failure.
const running = [];
function test(name, fn) {
  const fail = (e) => {
    failures++;
    console.error(`  FAIL ${name}\n       ${e.message}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      running.push(result.then(() => console.log(`  ok  ${name}`), fail));
      return;
    }
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail(e);
  }
}

// ── buildScanBundle / readScanBundle ────────────────────────────────────────
console.log("bundle round-trip");

test("a built bundle carries the three maps, a version and a save stamp", () => {
  const b = S.buildScanBundle({ flat: FLAT, quality: QUALITY, mp: MP, now: NOW });
  assert.strictEqual(b.version, S.SCAN_BUNDLE_VERSION);
  assert.strictEqual(b.savedAt, new Date(NOW).toISOString());
  assert.deepStrictEqual(b.flat, FLAT);
  assert.deepStrictEqual(b.quality, QUALITY);
  assert.deepStrictEqual(b.mp, MP);
});

test("null maps are stored as empty objects, never as null", () => {
  const b = S.buildScanBundle({ flat: null, quality: null, mp: null, now: NOW });
  assert.deepStrictEqual(b.flat, {});
  assert.deepStrictEqual(b.quality, {});
  assert.deepStrictEqual(b.mp, {});
});

test("a JSON round-trip returns the same three maps", () => {
  const raw = JSON.parse(JSON.stringify(
    S.buildScanBundle({ flat: FLAT, quality: QUALITY, mp: MP, now: NOW }),
  ));
  const got = S.readScanBundle(raw, { now: NOW });
  assert.deepStrictEqual(got.flat, FLAT);
  assert.deepStrictEqual(got.quality, QUALITY);
  assert.deepStrictEqual(got.mp, MP);
  assert.strictEqual(got.savedAt, new Date(NOW).toISOString());
});

[
  ["null", null],
  ["a string", "prices"],
  ["an array", [1, 2, 3]],
  ["an object with no maps", { version: S.SCAN_BUNDLE_VERSION, savedAt: iso(0) }],
  ["a bundle from a future schema", { version: S.SCAN_BUNDLE_VERSION + 1, savedAt: iso(0), flat: FLAT }],
  ["a bundle with no version", { savedAt: iso(0), flat: FLAT }],
].forEach(([label, raw]) => {
  test(`readScanBundle rejects ${label}`, () => {
    assert.strictEqual(S.readScanBundle(raw, { now: NOW }), null);
  });
});

test("a bundle whose maps are all empty is not worth restoring", () => {
  const b = S.buildScanBundle({ flat: {}, quality: {}, mp: {}, now: NOW });
  assert.strictEqual(S.readScanBundle(b, { now: NOW }), null);
});

test("a bundle carrying only quality prices still restores", () => {
  const b = S.buildScanBundle({ flat: {}, quality: QUALITY, mp: {}, now: NOW });
  const got = S.readScanBundle(b, { now: NOW });
  assert.deepStrictEqual(got.quality, QUALITY);
  assert.deepStrictEqual(got.flat, {});
});

// ── age ─────────────────────────────────────────────────────────────────────
//
// Bug (reported): "after sniffer fetched market prices they disappear after
// some time or restart". Expiry used to be BUNDLE-WIDE, on the save stamp: go
// three days without pressing Scan and every price in the file went at once,
// including the fresh sniffed cells that had been folded into it. Ageing is
// per cell now — a stale item drops out on its own and the rest of the book
// stays, with the tables' own age badges saying how old each one is.
//
// Bug (reported, again): "i had all artifact prices in artifact table scanned
// by sniffer, but after some time they disappeared." The fortnight is gone as
// well. A stored price is kept until a NEWER reading of the same item/city
// replaces it, and nothing else removes it — the AODP has no artifact data, so
// a sniffed artifact price is the only one that will ever exist and a TTL just
// deleted it. `maxAgeMs` survives as an option; every case that wants a window
// now passes one explicitly.
console.log("staleness");

const FORTNIGHT = { maxAgeMs: 14 * DAY };

[
  ["fresh (1 hour old)", 60 * 60 * 1000, true],
  ["one second inside the window", 14 * DAY - 1000, true],
  ["one second past the window", 14 * DAY + 1000, false],
  ["a year old", 365 * DAY, false],
].forEach(([label, ageMs, keeps]) => {
  test(`with an explicit 14-day window, a cell ${label} → ${keeps ? "kept" : "dropped"}`, () => {
    const b = S.buildScanBundle({
      flat: { T4_BAG: { Caerleon: flatCell({ sell: 1000, ageMs }) } },
      now: NOW,
    });
    const got = S.readScanBundle(b, { now: NOW, ...FORTNIGHT });
    assert.strictEqual(got !== null && !!got.flat.T4_BAG, keeps);
  });
});

// The reported regression, stated as a test.
test("the default window is no window at all", () => {
  assert.strictEqual(S.SCAN_MAX_CELL_AGE_MS, Infinity);
});

[
  ["a fortnight and a day", 15 * DAY],
  ["two months", 60 * DAY],
  ["a year", 365 * DAY],
].forEach(([label, ageMs]) => {
  test(`by default a cell ${label} old is kept, not deleted`, () => {
    const b = S.buildScanBundle({
      flat: { T4_ARTEFACT: { Caerleon: flatCell({ sell: 1000, ageMs }) } },
      now: NOW,
    });
    const got = S.readScanBundle(b, { now: NOW });
    assert.ok(got, "the bundle still restores");
    assert.strictEqual(got.flat.T4_ARTEFACT.Caerleon.sell_price, 1000);
  });
});

test("age never removes a cell from any of the three maps", () => {
  const b = S.buildScanBundle({
    flat: { OLD: { Caerleon: flatCell({ sell: 1, ageMs: 400 * DAY }) } },
    quality: { OLDQ: { 1: { Caerleon: flatCell({ sell: 2, ageMs: 400 * DAY }) } } },
    mp: { OLDMP: { Martlock: flatCell({ sell: 3, ageMs: 400 * DAY }) } },
    now: NOW,
  });
  const got = S.readScanBundle(b, { now: NOW });
  assert.ok(got.flat.OLD && got.quality.OLDQ && got.mp.OLDMP);
});

test("a NEWER reading is the one thing that removes the old one", () => {
  // Two scans of the same cell: the second bundle is what the file holds, and
  // the old price is not kept alongside it — one cell per item + city.
  const first = S.buildScanBundle({
    flat: { T4_ARTEFACT: { Caerleon: flatCell({ sell: 1000, ageMs: 200 * DAY }) } },
    now: NOW,
  });
  const second = S.buildScanBundle({
    flat: { T4_ARTEFACT: { Caerleon: flatCell({ sell: 250_000, ageMs: 0 }) } },
    now: NOW,
  });
  assert.strictEqual(
    S.readScanBundle(first, { now: NOW }).flat.T4_ARTEFACT.Caerleon.sell_price, 1000,
    "the old reading survives on its own",
  );
  const got = S.readScanBundle(second, { now: NOW });
  assert.strictEqual(got.flat.T4_ARTEFACT.Caerleon.sell_price, 250_000, "replaced, not appended");
  assert.strictEqual(Object.keys(got.flat.T4_ARTEFACT).length, 1);
});

test("an old SAVE STAMP no longer discards fresh cells", () => {
  // The file was last written ten days ago, but it carries prices read today —
  // captures folded in by the monitor, which is exactly what used to vanish.
  const b = S.buildScanBundle({
    flat: { T4_BAG: { Caerleon: flatCell({ sell: 1000, ageMs: 60 * 1000 }) } },
    now: NOW - 10 * DAY,
  });
  const got = S.readScanBundle(b, { now: NOW });
  assert.ok(got, "the bundle survives its own save stamp");
  assert.strictEqual(got.flat.T4_BAG.Caerleon.sell_price, 1000);
});

test("stale cells are dropped WITHOUT taking the fresh ones with them", () => {
  const b = S.buildScanBundle({
    flat: {
      FRESH: { Caerleon: flatCell({ sell: 1000, ageMs: 2 * DAY }) },
      STALE: { Caerleon: flatCell({ sell: 2000, ageMs: 60 * DAY }) },
    },
    now: NOW,
  });
  const got = S.readScanBundle(b, { now: NOW, ...FORTNIGHT });
  assert.ok(got.flat.FRESH, "fresh item kept");
  assert.strictEqual(got.flat.STALE, undefined, "stale item dropped");
});

test("an item left with no cities after pruning disappears entirely", () => {
  const b = S.buildScanBundle({
    flat: { STALE: { Caerleon: flatCell({ sell: 2000, ageMs: 60 * DAY }) } },
    now: NOW,
  });
  assert.strictEqual(
    S.readScanBundle(b, { now: NOW, ...FORTNIGHT }), null, "no husks, and nothing to restore");
});

test("the quality and mp maps age per cell too", () => {
  const b = S.buildScanBundle({
    quality: {
      FRESH: { 1: { Caerleon: flatCell({ sell: 10, ageMs: 1 * DAY }) } },
      STALE: { 1: { Caerleon: flatCell({ sell: 20, ageMs: 60 * DAY }) } },
    },
    mp: {
      FRESHMP: { Martlock: flatCell({ sell: 30, ageMs: 1 * DAY }) },
      STALEMP: { Martlock: flatCell({ sell: 40, ageMs: 60 * DAY }) },
    },
    now: NOW,
  });
  const got = S.readScanBundle(b, { now: NOW, ...FORTNIGHT });
  assert.ok(got.quality.FRESH && got.mp.FRESHMP);
  assert.strictEqual(got.quality.STALE, undefined);
  assert.strictEqual(got.mp.STALEMP, undefined);
});

test("a dateless cell is never aged out — nothing says when it was read", () => {
  const b = S.buildScanBundle({
    flat: { NODATE: { Caerleon: { sell_price: 0, buy_price: 0, sell_date: null, buy_date: null, volume_24h: 7 } } },
    now: NOW,
  });
  const got = S.readScanBundle(b, { now: NOW });
  assert.ok(got && got.flat.NODATE, "kept rather than silently discarded");
});

test("an unreadable savedAt still rejects the bundle as corrupt", () => {
  const b = { ...S.buildScanBundle({ flat: FLAT, now: NOW }), savedAt: "not a date" };
  assert.strictEqual(S.readScanBundle(b, { now: NOW }), null);
});

test("the caller may widen the window", () => {
  const b = S.buildScanBundle({
    flat: { T4_BAG: { Caerleon: flatCell({ sell: 1000, ageMs: 60 * DAY }) } },
    now: NOW,
  });
  assert.ok(S.readScanBundle(b, { now: NOW, maxAgeMs: 90 * DAY }));
});

// ── deferred save ───────────────────────────────────────────────────────────
console.log("deferred save");

function fakeClock() {
  let timerId = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => { timerId++; timers.set(timerId, { fn, ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    tick: () => {
      const pending = [...timers.entries()];
      timers.clear();
      pending.forEach(([, t]) => t.fn());
    },
    pending: () => timers.size,
  };
}

function recorder() {
  const calls = [];
  return { save: (bundle) => { calls.push(bundle); return true; }, calls };
}

test("a burst of scans writes once, with the LAST bundle", () => {
  S.resetScanSave();
  const clock = fakeClock();
  const r = recorder();
  const opts = { save: r.save, timers: clock, delayMs: 1500 };
  S.scheduleScanSave(() => S.buildScanBundle({ flat: { A: {} }, now: NOW }), opts);
  S.scheduleScanSave(() => S.buildScanBundle({ flat: { A: {}, B: {} }, now: NOW }), opts);
  S.scheduleScanSave(() => S.buildScanBundle({ flat: FLAT, now: NOW }), opts);
  assert.strictEqual(r.calls.length, 0, "nothing written before the burst settles");
  clock.tick();
  assert.strictEqual(r.calls.length, 1);
  assert.deepStrictEqual(r.calls[0].flat, FLAT);
});

test("flushScanSave writes now and cancels the pending timer", () => {
  S.resetScanSave();
  const clock = fakeClock();
  const r = recorder();
  S.scheduleScanSave(() => S.buildScanBundle({ flat: FLAT, now: NOW }),
    { save: r.save, timers: clock, delayMs: 1500 });
  assert.strictEqual(S.flushScanSave(), true);
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(clock.pending(), 0, "timer cancelled");
  clock.tick();
  assert.strictEqual(r.calls.length, 1, "no second write");
});

test("flushScanSave with nothing pending is a no-op, not an error", () => {
  S.resetScanSave();
  assert.strictEqual(S.flushScanSave(), false);
});

test("delayMs 0 writes straight away", () => {
  S.resetScanSave();
  const clock = fakeClock();
  const r = recorder();
  S.scheduleScanSave(() => S.buildScanBundle({ flat: FLAT, now: NOW }),
    { save: r.save, timers: clock, delayMs: 0 });
  assert.strictEqual(r.calls.length, 1);
  assert.strictEqual(clock.pending(), 0);
});

test("a save that throws is swallowed — a failed write never kills a scan", () => {
  S.resetScanSave();
  const clock = fakeClock();
  S.scheduleScanSave(() => S.buildScanBundle({ flat: FLAT, now: NOW }), {
    save: () => { throw new Error("EACCES"); },
    timers: clock,
    delayMs: 0,
  });
  assert.strictEqual(S.flushScanSave(), false);
});

test("a bundle with nothing in it is not written at all", () => {
  S.resetScanSave();
  const clock = fakeClock();
  const r = recorder();
  S.scheduleScanSave(() => S.buildScanBundle({ flat: {}, quality: {}, mp: {}, now: NOW }),
    { save: r.save, timers: clock, delayMs: 0 });
  assert.strictEqual(r.calls.length, 0);
});

// ── the file on disk ────────────────────────────────────────────────────────
console.log("file store");

test("a missing file loads as null", () => {
  const got = F.loadScanPricesFile({
    file: "x.json",
    readFile: () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
  });
  assert.strictEqual(got, null);
});

test("a truncated file loads as null instead of throwing", () => {
  const got = F.loadScanPricesFile({ file: "x.json", readFile: () => '{"flat":{' });
  assert.strictEqual(got, null);
});

test("a written bundle reads back byte-identical", () => {
  let disk = null;
  const bundle = S.buildScanBundle({ flat: FLAT, quality: QUALITY, mp: MP, now: NOW });
  const ok = F.saveScanPricesFile({ file: "x.json", writeFile: (f, d) => { disk = d; }, bundle });
  assert.strictEqual(ok, true);
  const got = F.loadScanPricesFile({ file: "x.json", readFile: () => disk });
  assert.deepStrictEqual(got, JSON.parse(JSON.stringify(bundle)));
});

test("a read-only profile reports the failure rather than throwing", () => {
  const ok = F.saveScanPricesFile({
    file: "x.json",
    writeFile: () => { throw new Error("EPERM"); },
    bundle: S.buildScanBundle({ flat: FLAT, now: NOW }),
  });
  assert.strictEqual(ok, false);
});

test("nothing is written for a bundle that is not an object", () => {
  let wrote = false;
  assert.strictEqual(
    F.saveScanPricesFile({ file: "x.json", writeFile: () => { wrote = true; }, bundle: null }),
    false,
  );
  assert.strictEqual(wrote, false);
});

// ── restored scan data vs captures ──────────────────────────────────────────
console.log("restored scan data folded with captures");

test("a newer capture beats a restored scan price", () => {
  const restored = S.readScanBundle(
    S.buildScanBundle({ flat: { T4_BAG: { Caerleon: flatCell({ sell: 1000, ageMs: 2 * 60 * 60 * 1000 }) } }, now: NOW }),
    { now: NOW },
  );
  const captured = { T4_BAG: { Caerleon: { sell_price: 800, sell_date: iso(0), buy_price: 0, volume_24h: 0 } } };
  C.mergeCapturedIntoFlat(restored.flat, captured);
  assert.strictEqual(restored.flat.T4_BAG.Caerleon.sell_price, 800);
});

test("an older capture loses to a restored scan price, and never wipes volume", () => {
  const restored = S.readScanBundle(
    S.buildScanBundle({ flat: { T4_BAG: { Caerleon: flatCell({ sell: 1000, ageMs: 0, vol: 42 }) } }, now: NOW }),
    { now: NOW },
  );
  const captured = { T4_BAG: { Caerleon: { sell_price: 800, sell_date: iso(3 * DAY), buy_price: 0, volume_24h: 0 } } };
  C.mergeCapturedIntoFlat(restored.flat, captured);
  assert.strictEqual(restored.flat.T4_BAG.Caerleon.sell_price, 1000);
  assert.strictEqual(restored.flat.T4_BAG.Caerleon.volume_24h, 42);
});

test("a capture for a city the scan never priced is added, not dropped", () => {
  const restored = S.readScanBundle(S.buildScanBundle({ flat: FLAT, now: NOW }), { now: NOW });
  C.mergeCapturedIntoFlat(restored.flat, {
    T4_BAG: { Lymhurst: { sell_price: 1234, sell_date: iso(0), buy_price: 0, volume_24h: 0 } },
  });
  assert.strictEqual(restored.flat.T4_BAG.Lymhurst.sell_price, 1234);
  assert.strictEqual(restored.flat.T4_BAG.Caerleon.sell_price, 1000);
});

test("a scan that returns NO data for a city never writes that loss to disk", () => {
  // AODP answers with a cell for every requested (item, city) pair; an empty
  // book comes back all zeroes. That used to replace the stored price outright
  // and then get persisted, so the next launch restored "no data".
  let disk = null;
  global.window = {
    scanPriceStore: {
      save: (bundle) => F.saveScanPricesFile({ file: "x", bundle, writeFile: (_f, d) => { disk = d; } }),
      load: () => F.loadScanPricesFile({ file: "x", readFile: () => disk }),
    },
  };
  C.resetCapturedPrices();

  global.lastMarketData = { T4_BAG: { Caerleon: flatCell({ sell: 1000, buy: 900, ageMs: 3 * 60 * 60 * 1000, vol: 42 }) } };
  global.lastQualityMarketData = {};
  global.lastMpMarketData = {};

  C.applyScanPatch(global.lastMarketData, {
    T4_BAG: { Caerleon: { sell_price: 0, buy_price: 0, sell_date: null, buy_date: null, volume_24h: 0 } },
  });
  S.resetScanSave();
  S.persistScanPrices({ delayMs: 0 });

  return S.hydrateScanPrices({ now: NOW }).then((restored) => {
    assert.ok(restored, "the bundle is still worth restoring");
    const got = restored.flat.T4_BAG.Caerleon;
    assert.strictEqual(got.sell_price, 1000, "the ask survived the empty scan");
    assert.strictEqual(got.buy_price, 900, "so did the bid");
    assert.strictEqual(got.volume_24h, 42);
    delete global.window;
    delete global.lastMarketData;
    delete global.lastQualityMarketData;
    delete global.lastMpMarketData;
  });
});

// ── the whole loop: scan → bridge → file → next launch ──────────────────────
console.log("session round-trip through the bridge");

test("a scan in one session is what the next session restores", () => {
  let disk = null;
  // Stands in for preload.js: the renderer's window.scanPriceStore, backed by
  // the main process's file module. Same two calls, no IPC in between.
  global.window = {
    scanPriceStore: {
      save: (bundle) => F.saveScanPricesFile({ file: "s.json", bundle, writeFile: (f, d) => { disk = d; } }),
      load: () => F.loadScanPricesFile({ file: "s.json", readFile: () => { if (disk === null) throw new Error("ENOENT"); return disk; } }),
    },
  };
  // Session 1: the globals app.js keeps, then a scan.
  global.lastMarketData = FLAT;
  global.lastQualityMarketData = QUALITY;
  global.lastMpMarketData = MP;
  S.resetScanSave();
  S.persistScanPrices({ delayMs: 0 });
  assert.ok(disk, "the scan reached the file");

  // Session 2: fresh globals, restore.
  delete global.lastMarketData;
  delete global.lastQualityMarketData;
  delete global.lastMpMarketData;
  return S.hydrateScanPrices({ now: NOW }).then((restored) => {
    assert.deepStrictEqual(restored.flat, FLAT);
    assert.deepStrictEqual(restored.quality, QUALITY);
    assert.deepStrictEqual(restored.mp, MP);
    delete global.window;
  });
});

test("no bridge (plain browser, no Electron) is a no-op, not a crash", () => {
  delete global.window;
  S.resetScanSave();
  S.persistScanPrices({ delayMs: 0 });
  return S.hydrateScanPrices().then((got) => assert.strictEqual(got, null));
});

test("a first launch with no file yet restores nothing", () => {
  global.window = { scanPriceStore: { save: () => true, load: () => null } };
  return S.hydrateScanPrices({ now: NOW }).then((got) => {
    assert.strictEqual(got, null);
    delete global.window;
  });
});

Promise.all(running).then(() => {
  console.log(failures === 0 ? "\nAll scan-price persistence tests passed."
    : `\n${failures} test(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
});
