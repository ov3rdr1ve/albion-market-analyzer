/**
 * Test: the publish/pull loop (js/team-sync-loop.js).
 *
 * A shared Dropbox folder is not a database. Every publish rewrites a whole
 * file and Dropbox uploads it, so the loop's real job is restraint:
 *
 *   - a burst of edits (drag a route, add four portals) is ONE write;
 *   - a floor between writes stops a busy session hammering the folder, but a
 *     change inside the floor is delayed, never dropped;
 *   - the price file — a hundred times the size of the portal file — is on its
 *     own slower clock and is skipped entirely when no cell is newer than what
 *     already went out;
 *   - a peer that is unreadable, offline or malformed costs us that peer, not
 *     the tick.
 *
 * Black-box: clock, timers and the IPC bridge are all injected. Nothing here
 * touches a disk, a network or a real timer.
 *
 * Run: node tests/team-sync-loop.test.cjs
 */

const assert = require("assert");
const path = require("path");

const L = require(path.join(__dirname, "..", "js", "team-sync-loop.js"));

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// ── a clock with hand-cranked timers ────────────────────────────────────────

function fakeClock() {
  let t = 1_000_000;
  let seq = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const id = seq++; timers.set(id, { fn, at: t + ms, every: 0 }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms) { const id = seq++; timers.set(id, { fn, at: t + ms, every: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    pending() { return timers.size; },
    /** Move time forward, firing everything that comes due, then settle promises. */
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        let next = null;
        timers.forEach((timer, id) => {
          if (timer.at <= target && (next === null || timer.at < timers.get(next).at)) next = id;
        });
        if (next === null) break;
        const timer = timers.get(next);
        t = timer.at;
        if (timer.every) timer.at = t + timer.every; else timers.delete(next);
        await timer.fn();
        await Promise.resolve();
      }
      t = target;
      await Promise.resolve();
    },
  };
}

/**
 * A stand-in for window.teamSync (preload.js). An override still goes through
 * the call log, so a test can both shape the answer and count the calls.
 */
function fakeBridge(over) {
  const calls = { publish: [], readPeers: [] };
  const patch = over || {};
  return {
    calls,
    publish: async (kind, text) => {
      calls.publish.push([kind, text]);
      return patch.publish ? patch.publish(kind, text) : { ok: true };
    },
    readPeers: async (seen) => {
      calls.readPeers.push(seen);
      return patch.readPeers ? patch.readPeers(seen) : { ok: true, peers: [], mtimes: {} };
    },
  };
}

function makeLoop(over) {
  const clock = fakeClock();
  // The bridge override patches the fake rather than replacing it, so the call
  // log survives.
  const { bridge: bridgeOver, ...loopOver } = over || {};
  const bridge = fakeBridge(bridgeOver);
  const applied = [];
  const loop = L.createTeamSyncLoop({
    bridge,
    timers: clock,
    now: clock.now,
    getPrefs: () => ({ enabled: true, sharePrices: true }),
    getPortalPayload: () => ({ format: "albion-roads-sync", version: 1, roadsPortals: { portals: [] } }),
    getPricePayload: () => ({ format: "albion-roads-sync", version: 1, capturedPrices: {}, newestAt: clock.now() }),
    applyPeer: (payload, kind) => { applied.push([kind, payload]); return { portals: 1, cells: 0 }; },
    ...loopOver,
  });
  return { loop, clock, bridge, applied };
}

/** Let a pull's promise chain finish without moving the clock. */
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

/** The kinds written so far, in order. */
const kinds = (bridge) => bridge.calls.publish.map((c) => c[0]);
/** How many files of one kind were written. */
const writes = (bridge, kind) => kinds(bridge).filter((k) => k === kind).length;

// ── intervals ───────────────────────────────────────────────────────────────

test("the timings are constants, not numbers scattered through the loop", () => {
  assert.strictEqual(L.PORTAL_DEBOUNCE_MS, 3000);
  assert.strictEqual(L.PORTAL_MIN_INTERVAL_MS, 15000);
  assert.strictEqual(L.PRICE_DEBOUNCE_MS, 30000);
  assert.strictEqual(L.PRICE_MIN_INTERVAL_MS, 120000);
  assert.strictEqual(L.PULL_INTERVAL_MS, 20000);
});

// ── publishing on start ─────────────────────────────────────────────────────
//
// Turning sync on is itself the change. Waiting for the next added portal
// before writing anything leaves a folder that stays empty for hours and a
// feature that reads as broken.

test("starting publishes the map this box already has", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();                                   // no notify* at all
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.deepStrictEqual(kinds(bridge), ["portals"]);
});

test("starting publishes the captured prices too", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  await clock.advance(L.PRICE_DEBOUNCE_MS + 1);
  assert.strictEqual(writes(bridge, "prices"), 1);
});

test("starting with price sharing off writes the portal file only", async () => {
  const { loop, clock, bridge } = makeLoop({ getPrefs: () => ({ enabled: true, sharePrices: false }) });
  loop.start();
  await clock.advance(L.PRICE_DEBOUNCE_MS + L.PRICE_MIN_INTERVAL_MS);
  assert.deepStrictEqual(kinds(bridge), ["portals"]);
});

test("starting twice still publishes once", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.start();
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.strictEqual(writes(bridge, "portals"), 1);
});

test("starting reads the folder at once, not a full interval later", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  assert.strictEqual(bridge.calls.readPeers.length, 1);
  await clock.advance(L.PULL_INTERVAL_MS + 1);
  assert.strictEqual(bridge.calls.readPeers.length, 2, "and the interval keeps running");
});

test("starting while switched off writes and reads nothing", async () => {
  const { loop, clock, bridge } = makeLoop({ getPrefs: () => ({ enabled: false, sharePrices: true }) });
  loop.start();
  await clock.advance(L.PRICE_DEBOUNCE_MS + 1);
  assert.strictEqual(bridge.calls.publish.length, 0);
  assert.strictEqual(bridge.calls.readPeers.length, 0);
});

// ── publishing portals ──────────────────────────────────────────────────────

test("a portal change is published after the debounce, not immediately", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.notifyPortalsChanged();
  await clock.advance(L.PORTAL_DEBOUNCE_MS - 1);
  assert.strictEqual(bridge.calls.publish.length, 0);
  await clock.advance(2);
  assert.deepStrictEqual(bridge.calls.publish.map((c) => c[0]), ["portals"]);
});

test("a burst of portal changes is one write", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  for (let i = 0; i < 8; i++) { loop.notifyPortalsChanged(); await clock.advance(100); }
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 100);
  assert.strictEqual(bridge.calls.publish.length, 1);
});

test("what is published is the payload text, ready for the file", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.notifyPortalsChanged();
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  const [kind, text] = bridge.calls.publish[0];
  assert.strictEqual(kind, "portals");
  assert.strictEqual(typeof text, "string");
  assert.strictEqual(JSON.parse(text).format, "albion-roads-sync");
});

test("a change inside the floor is delayed, never dropped", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.notifyPortalsChanged();
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.strictEqual(bridge.calls.publish.length, 1);

  loop.notifyPortalsChanged();                       // immediately after the write
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.strictEqual(bridge.calls.publish.length, 1, "the floor holds it back");
  await clock.advance(L.PORTAL_MIN_INTERVAL_MS);
  assert.strictEqual(bridge.calls.publish.length, 2, "and it goes out once the floor lifts");
});

test("nothing to publish means no write", async () => {
  const { loop, clock, bridge } = makeLoop({ getPortalPayload: () => null });
  loop.start();
  loop.notifyPortalsChanged();
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.strictEqual(bridge.calls.publish.length, 0);
});

test("a failed write is reported and does not stop the next one", async () => {
  let first = true;
  const { loop, clock, bridge } = makeLoop({
    bridge: {
      publish: async () => {
        if (first) { first = false; throw new Error("ENOSPC"); }
        return { ok: true };
      },
    },
  });
  loop.start();
  loop.notifyPortalsChanged();
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.ok(/ENOSPC/.test(loop.status().lastError), "the user is told the folder is full");

  loop.notifyPortalsChanged();
  await clock.advance(L.PORTAL_MIN_INTERVAL_MS + L.PORTAL_DEBOUNCE_MS);
  assert.strictEqual(bridge.calls.publish.length, 2, "the loop tried again");
  assert.strictEqual(loop.status().lastError, null, "and the second write cleared the error");
});

// ── publishing prices ───────────────────────────────────────────────────────

test("prices are on their own, slower debounce", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.notifyPricesChanged();
  await clock.advance(L.PORTAL_DEBOUNCE_MS + 1);
  assert.strictEqual(writes(bridge, "prices"), 0, "the portal debounce must not carry prices");
  await clock.advance(L.PRICE_DEBOUNCE_MS);
  assert.strictEqual(writes(bridge, "prices"), 1);
});

test("a price publish is skipped when no cell is newer than the last one sent", async () => {
  const stuck = 5_000_000;
  const { loop, clock, bridge } = makeLoop({
    getPricePayload: () => ({ format: "albion-roads-sync", version: 1, capturedPrices: {}, newestAt: stuck }),
  });
  loop.start();
  loop.notifyPricesChanged();
  await clock.advance(L.PRICE_DEBOUNCE_MS + 1);
  assert.strictEqual(writes(bridge, "prices"), 1);

  loop.notifyPricesChanged();
  await clock.advance(L.PRICE_MIN_INTERVAL_MS + L.PRICE_DEBOUNCE_MS + 1);
  assert.strictEqual(writes(bridge, "prices"), 1, "same newest cell — nothing to say");
});

test("a genuinely newer capture does go out", async () => {
  let newest = 5_000_000;
  const { loop, clock, bridge } = makeLoop({
    getPricePayload: () => ({ format: "albion-roads-sync", version: 1, capturedPrices: {}, newestAt: newest }),
  });
  loop.start();
  loop.notifyPricesChanged();
  await clock.advance(L.PRICE_DEBOUNCE_MS + 1);
  newest = 6_000_000;
  loop.notifyPricesChanged();
  await clock.advance(L.PRICE_MIN_INTERVAL_MS + L.PRICE_DEBOUNCE_MS + 1);
  assert.strictEqual(writes(bridge, "prices"), 2);
});

test("with price sharing off, only portals are ever written", async () => {
  const { loop, clock, bridge } = makeLoop({ getPrefs: () => ({ enabled: true, sharePrices: false }) });
  loop.start();
  loop.notifyPricesChanged();
  loop.notifyPortalsChanged();
  await clock.advance(L.PRICE_DEBOUNCE_MS + L.PRICE_MIN_INTERVAL_MS);
  assert.deepStrictEqual(bridge.calls.publish.map((c) => c[0]), ["portals"]);
});

// ── pulling ─────────────────────────────────────────────────────────────────

test("peers are pulled on the interval", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS * 3 + 1);
  assert.strictEqual(bridge.calls.readPeers.length, 4, "the one on start, then three ticks");
});

test("each peer payload is applied once, with its kind", async () => {
  const peers = [
    { name: "peer-9f8e7d6c.json", deviceId: "9f8e7d6c", kind: "portals", text: '{"format":"albion-roads-sync","version":1,"deviceId":"9f8e7d6c"}' },
    { name: "peer-9f8e7d6c-prices.json", deviceId: "9f8e7d6c", kind: "prices", text: '{"format":"albion-roads-sync","version":1,"deviceId":"9f8e7d6c"}' },
  ];
  const { loop, applied } = makeLoop({
    bridge: { readPeers: async () => ({ ok: true, peers, mtimes: {} }) },
  });
  loop.start();
  await settle();                                  // the read start makes
  assert.deepStrictEqual(applied.map((a) => a[0]), ["portals", "prices"]);
});

test("the mtimes from a pull are handed back on the next one", async () => {
  const { loop, clock, bridge } = makeLoop({
    bridge: { readPeers: async (seen) => ({ ok: true, peers: [], mtimes: { "peer-x.json": 42 } }) },
  });
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS + 1);
  await clock.advance(L.PULL_INTERVAL_MS);
  assert.deepStrictEqual(bridge.calls.readPeers[1], { "peer-x.json": 42 });
});

test("an unparseable peer file is skipped, the rest of the tick carries on", async () => {
  const peers = [
    { name: "peer-a.json", deviceId: "a", kind: "portals", text: "<html>Dropbox error page</html>" },
    { name: "peer-b.json", deviceId: "b", kind: "portals", text: '{"format":"albion-roads-sync","version":1,"deviceId":"b"}' },
  ];
  const { loop, applied } = makeLoop({
    bridge: { readPeers: async () => ({ ok: true, peers, mtimes: {} }) },
  });
  loop.start();
  await settle();
  assert.strictEqual(applied.length, 1);
  assert.strictEqual(applied[0][1].deviceId, "b");
});

test("a peer whose merge throws does not take the tick down", async () => {
  const peers = [
    { name: "peer-a.json", deviceId: "a", kind: "portals", text: '{"format":"albion-roads-sync","version":1,"deviceId":"a"}' },
    { name: "peer-b.json", deviceId: "b", kind: "portals", text: '{"format":"albion-roads-sync","version":1,"deviceId":"b"}' },
  ];
  const seen = [];
  const { loop } = makeLoop({
    bridge: { readPeers: async () => ({ ok: true, peers, mtimes: {} }) },
    applyPeer: (payload) => {
      seen.push(payload.deviceId);
      if (payload.deviceId === "a") throw new Error("bad row");
      return { portals: 0, cells: 0 };
    },
  });
  loop.start();
  await settle();
  assert.deepStrictEqual(seen, ["a", "b"]);
});

test("a folder that is gone is reported, and the next tick still runs", async () => {
  let ticks = 0;
  const { loop, clock } = makeLoop({
    bridge: { readPeers: async () => { ticks++; return { ok: false, error: "ENOENT", peers: [], mtimes: {} }; } },
  });
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS * 2 + 1);
  assert.strictEqual(ticks, 3, "the read on start, then two ticks");
  assert.ok(/ENOENT/.test(loop.status().lastError));
});

test("a pull that is still running does not start a second one", async () => {
  let open = 0, peak = 0;
  const { loop, clock } = makeLoop({
    bridge: {
      readPeers: async () => {
        open++; peak = Math.max(peak, open);
        await new Promise((r) => setTimeout(r, 0));
        open--;
        return { ok: true, peers: [], mtimes: {} };
      },
    },
  });
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS * 3 + 1);
  assert.strictEqual(peak, 1);
});

test("the status line reports what the last pull took", async () => {
  const peers = [{ name: "peer-a.json", deviceId: "a", kind: "portals", text: '{"format":"albion-roads-sync","version":1,"deviceId":"a"}' }];
  const { loop, clock } = makeLoop({
    bridge: { readPeers: async () => ({ ok: true, peers, peerIds: ["a"], mtimes: {} }) },
    applyPeer: () => ({ portals: 7, cells: 3 }),
  });
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS + 1);
  const status = loop.status();
  assert.strictEqual(status.lastPortalsTaken, 7);
  assert.strictEqual(status.lastCellsTaken, 3);
  assert.strictEqual(status.peers.length, 1);
});

test("a quiet tick still knows the guild is there", async () => {
  // Nothing changed in the folder, so nothing is parsed — but the roster comes
  // from the listing, and reporting "0 peers" would read as "nobody is sharing".
  const { loop, clock } = makeLoop({
    bridge: { readPeers: async () => ({ ok: true, peers: [], peerIds: ["a", "b"], mtimes: {} }) },
  });
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS + 1);
  assert.deepStrictEqual(loop.status().peers.map((p) => p.deviceId), ["a", "b"]);
  assert.strictEqual(loop.status().lastPortalsTaken, 0);
});

// ── off ─────────────────────────────────────────────────────────────────────

test("sync switched off makes no bridge calls at all", async () => {
  const { loop, clock, bridge } = makeLoop({ getPrefs: () => ({ enabled: false, sharePrices: true }) });
  loop.start();
  loop.notifyPortalsChanged();
  loop.notifyPricesChanged();
  await clock.advance(L.PULL_INTERVAL_MS * 3 + L.PRICE_DEBOUNCE_MS);
  assert.strictEqual(bridge.calls.publish.length, 0);
  assert.strictEqual(bridge.calls.readPeers.length, 0);
});

test("stop clears every timer — a closed panel must not keep writing", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.notifyPortalsChanged();
  loop.stop();
  assert.strictEqual(clock.pending(), 0);
  await clock.advance(L.PULL_INTERVAL_MS * 2);
  assert.strictEqual(bridge.calls.publish.length, 0, "the pending write died with the loop");
  assert.strictEqual(bridge.calls.readPeers.length, 1, "only the read start already made");
});

test("start twice does not double the timers", async () => {
  const { loop, clock, bridge } = makeLoop();
  loop.start();
  loop.start();
  await clock.advance(L.PULL_INTERVAL_MS + 1);
  assert.strictEqual(bridge.calls.readPeers.length, 2, "one on start, one on the interval");
});

// ── run ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log("Team sync loop tests\n");
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  PASS: ${name}`); passed++; }
    catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
