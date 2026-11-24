/**
 * Tests for the capture's self-defence against a spinning npcap handle.
 *
 * Measured on a live machine (game closed, monitor running for ~100 min): the
 * Electron main process sat at ~1.9 cores — 140% kernel, ~17,000 zero-byte read
 * ops per second, ~20k context switches per second between the capture's wait
 * thread and the main thread. Stopping the monitor took it to 0%. That is the
 * npcap read event signalling forever while pcap_dispatch returns nothing: the
 * handle is dead (adapter reset, resume from sleep) or the driver keeps the
 * event hot, and node-cap reports neither — it just keeps dispatching.
 *
 * So the capture watches itself: CPU burnt with the packet counter standing
 * still means the tap is spinning, and the answer is to reopen the handle. If
 * reopening does not help, the tap is closed — CPU back to nothing — and opened
 * again from scratch a while later, on a widening delay. The monitor stays on
 * throughout: a capture that heals itself must not need a click.
 *
 * Everything is injected — no npcap, no device, no real clock, no real CPU.
 *
 * Run: node tests/packet-tap-health.test.cjs
 */

const assert = require("assert");
const { createPacketTap } = require("../js/packet-tap.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const REAL = {
  name: "\\Device\\NPF_{REAL}",
  description: "Realtek PCIe GbE Family Controller",
  addresses: [{ addr: "192.168.1.42" }],
};

const CORE_MICROS_PER_MS = 1000; // 1 ms of wall time = 1000 µs of one core

/**
 * @param {object} [options]
 * @param {number} [options.healthMs]  window the watchdog samples over
 */
function harness({ healthMs = 30000 } = {}) {
  const opened = [];
  const closed = [];
  const minBytes = [];
  let packetHandler = null;

  function Cap() {
    this.open = (name) => { opened.push(name); return "ETHERNET"; };
    this.close = () => { closed.push(opened[opened.length - 1]); };
    this.on = (event, cb) => { if (event === "packet") packetHandler = cb; };
    this.setMinBytes = (n) => { minBytes.push(n); };
  }
  Cap.deviceList = () => [REAL];

  const decoders = {
    PROTOCOL: { ETHERNET: { IPV4: 2048 }, IP: { UDP: 17, TCP: 6 } },
    Ethernet: () => ({ info: { type: 2048 }, offset: 14 }),
    IPV4: () => ({ info: { protocol: 17, srcaddr: "5.188.125.9", totallen: 80 }, offset: 34, hdrlen: 20 }),
    UDP: () => ({ info: { srcport: 5056, dstport: 51000, length: 40 }, offset: 42 }),
  };

  // A clock and a CPU meter the test drives by hand.
  let clock = 0;
  let cpu = 0;
  let healthTick = null;
  let restartTick = null;
  const restartDelays = [];

  const statuses = [];
  const sniffer = createPacketTap({
    onMessage: () => {},
    onStatus: (s) => statuses.push(s),
    backend: { Cap, decoders },
    parser: { handle: () => {} },
    localIp: null,
    setTimer: () => 1,          // adapter-failover timer: never fires here
    clearTimer: () => {},
    healthMs,
    setHealthTimer: (fn) => { healthTick = fn; return 2; },
    clearHealthTimer: () => { healthTick = null; },
    setRestartTimer: (fn, ms) => { restartTick = fn; restartDelays.push(ms); return 3; },
    clearRestartTimer: () => { restartTick = null; },
    now: () => clock,
    cpuMicros: () => cpu,
  });

  /** Advance one watchdog window, burning `coreFraction` of one core in it. */
  function window_(coreFraction) {
    clock += healthMs;
    cpu += healthMs * CORE_MICROS_PER_MS * coreFraction;
    if (healthTick) healthTick();
  }

  return {
    sniffer, opened, closed, statuses, minBytes, window_, restartDelays,
    get hasHealthTimer() { return healthTick !== null; },
    get hasRestartTimer() { return restartTick !== null; },
    deliverPacket: () => packetHandler && packetHandler(200),
    idle: (windows) => { for (let i = 0; i < windows; i++) window_(0.01); },
    spin: (windows) => { for (let i = 0; i < windows; i++) window_(1.5); },
    /** Let the pending auto-restart delay elapse. */
    fireRestart: () => {
      const fn = restartTick;
      restartTick = null;
      clock += 1;
      if (fn) fn();
    },
    /** Spin hard enough, long enough, to exhaust every reopen attempt. */
    spinUntilPaused: () => { for (let i = 0; i < 60 && sniffer.capturing; i++) window_(1.5); },
  };
}

// ── the handle is never asked to signal on zero bytes ───────────────────────
// min-to-copy 0 asks the driver to raise the read event even when it has
// nothing, which is one half of the spin. 1 keeps delivery immediate for a
// packet that actually arrived.
test("the capture never sets min-to-copy to zero", () => {
  const h = harness();
  h.sniffer.start();
  assert.ok(h.minBytes.length > 0, "min-to-copy is still configured");
  assert.ok(!h.minBytes.includes(0), `min-to-copy 0 is what spins: got ${h.minBytes}`);
});

// ── spin detection ─────────────────────────────────────────────────────────
test("CPU burnt with no packets reopens the capture", () => {
  const h = harness();
  h.sniffer.start();
  h.spin(2);
  assert.deepStrictEqual(h.opened, [REAL.name, REAL.name], "the handle is reopened");
  assert.deepStrictEqual(h.closed, [REAL.name], "and the spinning one is closed");
});

test("one busy window alone is not a spin", () => {
  const h = harness();
  h.sniffer.start();
  h.spin(1);
  assert.deepStrictEqual(h.opened, [REAL.name], "a single busy sample proves nothing");
});

test("CPU burnt WITH packets arriving is just a busy capture", () => {
  const h = harness();
  h.sniffer.start();
  for (let i = 0; i < 6; i++) { h.deliverPacket(); h.window_(1.5); }
  assert.deepStrictEqual(h.opened, [REAL.name], "traffic explains the CPU");
});

test("an idle capture is left alone", () => {
  const h = harness();
  h.sniffer.start();
  h.idle(10);
  assert.deepStrictEqual(h.opened, [REAL.name]);
  assert.deepStrictEqual(h.closed, []);
});

test("the reopen is announced", () => {
  const h = harness();
  h.sniffer.start();
  h.spin(2);
  assert.strictEqual(h.statuses.at(-1).status, "listening");
  assert.match(h.statuses.at(-1).message, /reopen/i);
});

test("a healthy capture stays running after the reopen", () => {
  const h = harness();
  h.sniffer.start();
  h.spin(2);
  assert.strictEqual(h.sniffer.running, true);
  h.deliverPacket();
  assert.strictEqual(h.sniffer.packetsSeen, 1, "the new handle feeds the same counter");
});

// ── the reopen does not become its own busy loop ───────────────────────────
test("reopening is not attempted on every window", () => {
  const h = harness();
  h.sniffer.start();
  h.spin(2);
  const afterFirst = h.opened.length;
  h.spin(1);
  assert.strictEqual(h.opened.length, afterFirst, "back-to-back reopens are pointless");
});

// ── a capture that will not stop spinning ──────────────────────────────────
// Reopening in place has a limit; past it the tap is closed so the core comes
// back, and the whole capture is started again later — device ranking and all.
test("a capture that keeps spinning is paused, not left burning a core", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  assert.strictEqual(h.sniffer.capturing, false, "the spinning handle is closed");
  assert.strictEqual(h.closed.length, h.opened.length, "every handle opened was closed");
  assert.ok(h.opened.length <= 4, `reopens in place are bounded, got ${h.opened.length}`);
  assert.strictEqual(h.hasHealthTimer, false, "nothing left to watch while paused");
});

test("the monitor stays on while the capture heals — no click needed", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  assert.strictEqual(h.sniffer.running, true, "the monitor was never switched off");
  assert.strictEqual(h.statuses.at(-1).status, "idle");
  assert.match(h.statuses.at(-1).message, /retry/i);
  assert.strictEqual(h.hasRestartTimer, true);
});

test("the capture comes back by itself", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  const beforeRestart = h.opened.length;
  h.fireRestart();
  assert.strictEqual(h.opened.length, beforeRestart + 1, "the adapter is opened again");
  assert.strictEqual(h.sniffer.capturing, true);
  assert.strictEqual(h.hasHealthTimer, true, "and it is watched again");
});

test("a paused capture burns nothing, so the watchdog leaves it alone", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  const opens = h.opened.length;
  h.spin(4);
  assert.strictEqual(h.opened.length, opens, "no reopen while there is no handle");
});

test("a capture that keeps failing backs off instead of retrying forever", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  h.fireRestart();
  h.spinUntilPaused();
  h.fireRestart();
  h.spinUntilPaused();
  const [first, second, third] = h.restartDelays;
  assert.ok(second > first, `the second wait is longer: ${first} → ${second}`);
  assert.ok(third > second, `and the third longer still: ${second} → ${third}`);
  assert.ok(h.restartDelays.every((ms) => ms <= 30 * 60 * 1000), "capped at half an hour");
});

test("traffic proves the capture is well again and resets the backoff", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  h.fireRestart();
  h.deliverPacket();               // the reopened tap works
  h.spinUntilPaused();             // ...and only later spins again
  const [first, afterTraffic] = h.restartDelays;
  assert.strictEqual(afterTraffic, first, "a healthy spell earns the short wait back");
});

test("stopping the monitor cancels the pending auto-restart", () => {
  const h = harness();
  h.sniffer.start();
  h.spinUntilPaused();
  h.sniffer.stop();
  assert.strictEqual(h.hasRestartTimer, false);
  assert.strictEqual(h.sniffer.running, false);
  const opens = h.opened.length;
  h.fireRestart();
  assert.strictEqual(h.opened.length, opens, "a stopped monitor must not reopen anything");
});

// ── lifecycle ──────────────────────────────────────────────────────────────
test("stopping the capture stops the watchdog", () => {
  const h = harness();
  h.sniffer.start();
  h.sniffer.stop();
  assert.strictEqual(h.hasHealthTimer, false);
  h.spin(4);
  assert.deepStrictEqual(h.opened, [REAL.name], "a stopped capture must not reopen anything");
});

test("restarting arms a fresh watchdog with a clean history", () => {
  const h = harness();
  h.sniffer.start();
  h.spin(2);                       // one recycle used up
  h.sniffer.stop();
  h.sniffer.start();
  assert.strictEqual(h.hasHealthTimer, true);
  h.spin(2);
  assert.strictEqual(h.opened.length, 4, "the restarted capture may recycle again");
  assert.strictEqual(h.sniffer.running, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
