/**
 * Tests for the silence restart — the capture's fastest self-heal path.
 *
 * The native cap addon reports no errors, so a network connection that drops
 * can leave the capture idle-dead: the handle is open, the packet counter
 * stands still, and ZERO CPU is burnt. Every other self-heal path is gated
 * shut in that state — the watchdog's spin detector needs CPU spin, the route
 * rerank needs a minute of silence plus a probe naming a DIFFERENT adapter,
 * and the silence walk disarmed permanently at the first packet. So: silence
 * past ten seconds on a capture that HAS carried traffic runs the same fresh
 * start() an app restart runs — fresh probe, fresh ranking, counters zeroed.
 * The threshold doubles as the cooldown (openedAt re-arms the gate after
 * every heal), so an offline capture heals once per window and picks traffic
 * back up within one of the line returning. A capture that NEVER carried
 * traffic stays excluded — the game is usually just not running yet, and the
 * boot walk owns that case — and a hot, quiet handle stands the restart down
 * in favour of the spin detector's cheaper in-place recycles.
 *
 * Everything is injected — no npcap, no route.exe, no real clock, no network.
 *
 * Run: node --test tests/packet-tap-silence-restart.test.cjs
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
// A second adapter, so a rerank has somewhere to move to.
const HOTSPOT = {
  name: "\\Device\\NPF_{HOTSPOT}",
  description: "Remote NDIS based Internet Sharing Device",
  addresses: [{ addr: "192.168.43.1" }],
};

const BACKOFF_MS = 5 * 60 * 1000;   // pauseAndRetry's short wait, untouched

/**
 * @param {object} [options]
 * @param {string} [options.device]  pinned device option
 * @param {boolean} [options.useProductionHealthMs]  omit the healthMs option
 *   entirely, so createPacketTap's production default drives the watchdog
 */
function harness({ device, useProductionHealthMs = false } = {}) {
  const opened = [];
  const closed = [];
  let failOpens = false;
  let packetHandler = null;

  function Cap() {
    this.open = (name) => {
      if (failOpens) throw new Error("no such device");
      opened.push(name);
      return "ETHERNET";
    };
    this.close = () => { closed.push(opened[opened.length - 1]); };
    this.on = (event, cb) => { if (event === "packet") packetHandler = cb; };
    this.setMinBytes = () => {};
  }
  Cap.deviceList = () => [REAL, HOTSPOT];

  const decoders = {
    PROTOCOL: { ETHERNET: { IPV4: 2048 }, IP: { UDP: 17, TCP: 6 } },
    Ethernet: () => ({ info: { type: 2048 }, offset: 14 }),
    IPV4: () => ({ info: { protocol: 17, srcaddr: "5.188.125.9", totallen: 80 }, offset: 34, hdrlen: 20 }),
    UDP: () => ({ info: { srcport: 5056, dstport: 51000, length: 40 }, offset: 42 }),
  };

  // A clock and a CPU meter the test drives by hand. probeAnswer is what the
  // route probe answers; null means the probe reads nothing.
  let clock = 0;
  let cpu = 0;
  let probeAnswer = null;
  let healthTick = null;
  let healthIntervalMs = null;
  let restartTick = null;
  const restartDelays = [];
  const healthMs = 5000;              // 5 s windows: both sides of the 10 s boundary

  const statuses = [];
  const sniffer = createPacketTap({
    onMessage: () => {},
    onStatus: (s) => statuses.push(s),
    backend: { Cap, decoders },
    parser: { handle: () => {} },
    localIp: "192.168.1.42",    // REAL holds the outbound address, so it ranks first
    device,
    probeRouteIp: () => probeAnswer,
    setTimer: () => 1,          // adapter-failover walk: never fires here
    clearTimer: () => {},
    ...(useProductionHealthMs ? {} : { healthMs }),
    setHealthTimer: (fn, ms) => { healthTick = fn; healthIntervalMs = ms; return 2; },
    clearHealthTimer: () => { healthTick = null; },
    setRestartTimer: (fn, ms) => { restartTick = fn; restartDelays.push(ms); return 3; },
    clearRestartTimer: () => { restartTick = null; },
    now: () => clock,
    cpuMicros: () => cpu,
  });

  /** Advance one watchdog window, burning `coreFraction` of one core in it. */
  function window_(coreFraction) {
    clock += healthMs;
    cpu += healthMs * 1000 * coreFraction;
    if (healthTick) healthTick();
  }

  return {
    sniffer, opened, closed, statuses, restartDelays, window_,
    idle: (windows) => { for (let i = 0; i < windows; i++) window_(0.01); },
    idleHot: (windows) => { for (let i = 0; i < windows; i++) window_(1.5); },
    deliverPacket: () => packetHandler && packetHandler(200),
    fireRestart: () => {
      const fn = restartTick;
      restartTick = null;
      clock += 1;
      if (fn) fn();
    },
    breakOpens: () => { failOpens = true; },
    fixOpens: () => { failOpens = false; },
    set probe(ip) { probeAnswer = ip; },
    get hasRestartTimer() { return restartTick !== null; },
    get healthIntervalMs() { return healthIntervalMs; },
  };
}

// ── the sampling cadence ───────────────────────────────────────────────────

test("the watchdog samples every ten seconds, so the heal lands on schedule", () => {
  const h = harness({ useProductionHealthMs: true });   // no healthMs option: the default drives it
  h.sniffer.start();
  assert.strictEqual(h.healthIntervalMs, 10000,
    "10 s samples — a 10 s silence threshold must not wait on 30 s ticks");
});

// ── the silence restart itself ─────────────────────────────────────────────

test("ten seconds of silence after traffic restarts the capture fresh", () => {
  const h = harness();
  h.sniffer.start();
  h.deliverPacket();               // the capture carried traffic...
  h.probe = "192.168.1.42";        // ...and the route still names this adapter — same-IP recovery
  h.idle(2);                       // two watchdog windows: ten seconds of silence
  assert.deepStrictEqual(h.opened, [REAL.name, REAL.name], "the device is opened again, from scratch");
  assert.deepStrictEqual(h.closed, [REAL.name], "the dead handle was closed first");
  assert.strictEqual(h.sniffer.packetsSeen, 0, "the counters are back to zero");
  assert.strictEqual(h.sniffer.capturing, true);
  assert.strictEqual(h.sniffer.running, true, "the monitor was never switched off");
  assert.strictEqual(h.statuses.at(-1).status, "listening");
  assert.match(h.statuses.at(-1).message, /restart/i, "the restart is announced");
});

test("the heal re-arms: one restart per silence window, not a loop", () => {
  const h = harness();
  h.sniffer.start();
  h.deliverPacket();
  h.probe = "192.168.1.42";
  h.idle(2);                       // the first heal fires here (10 s of silence)
  assert.deepStrictEqual(h.opened, [REAL.name, REAL.name]);
  h.idle(1);                       // five seconds into the fresh window: nothing yet
  assert.strictEqual(h.opened.length, 2, "the fresh open re-armed the gate");
  h.idle(1);                       // ten seconds since the heal: exactly one more
  assert.strictEqual(h.opened.length, 3, "one heal per window while the line is down");
});

test("a pinned device gets the same fresh restart on silence", () => {
  const h = harness({ device: REAL.name });
  h.sniffer.start();
  h.deliverPacket();
  h.probe = "192.168.43.1";        // even a moved route must not rerank a pinned device
  h.idle(2);
  assert.deepStrictEqual(h.opened, [REAL.name, REAL.name], "the pinned device is reopened");
  assert.strictEqual(h.sniffer.packetsSeen, 0);
});

// ── every reason to leave a capture alone ──────────────────────────────────

test("silence shorter than ten seconds changes nothing", () => {
  const h = harness();
  h.sniffer.start();
  h.deliverPacket();
  h.probe = "192.168.1.42";
  h.idle(1);                       // five seconds: half the threshold
  assert.deepStrictEqual(h.opened, [REAL.name], "no restart before the threshold");
  assert.deepStrictEqual(h.closed, []);
  assert.strictEqual(h.sniffer.capturing, true);
});

test("silence on a capture that never carried traffic stays the walk's business", () => {
  const h = harness();
  h.sniffer.start();               // not one packet, ever
  h.probe = "192.168.1.42";
  h.idle(20);                      // 100 seconds of nothing
  assert.deepStrictEqual(h.opened, [REAL.name], "no fresh restart of the silence kind");
  assert.deepStrictEqual(h.closed, []);
  assert.strictEqual(h.sniffer.capturing, true);
});

test("a hot, quiet handle is the spin detector's patient, not the restart's", () => {
  const h = harness();
  h.sniffer.start();
  h.deliverPacket();
  h.probe = "192.168.1.42";
  h.idleHot(3);                    // silence past the threshold, but CPU is burning
  assert.deepStrictEqual(h.opened, [REAL.name, REAL.name], "the handle was recycled in place");
  assert.ok(
    h.statuses.every((s) => !/restarted/i.test(s.message)),
    "no full restart while the spin machinery still has room"
  );
  assert.match(h.statuses.at(-1).message, /reopen/i, "the recycle is what answered");
});

// ── the restart must not stack on the other healing paths ──────────────────

test("a silence restart that finds no adapter hands off to the backoff, once", () => {
  const h = harness();
  h.sniffer.start();
  h.deliverPacket();
  h.breakOpens();                  // the NIC is gone: nothing can be opened now
  h.idle(2);                       // ten seconds: the restart fires into the void
  assert.strictEqual(h.sniffer.capturing, false, "the dead handle was closed");
  assert.strictEqual(h.sniffer.running, true, "the monitor stays on");
  assert.deepStrictEqual(h.restartDelays, [BACKOFF_MS], "one backoff is scheduled");
  h.idle(4);                       // twenty more seconds while that retry is pending
  assert.deepStrictEqual(h.restartDelays, [BACKOFF_MS], "the pending restart is not doubled");
  assert.strictEqual(h.opened.length, 1, "and nothing can open while the NIC is gone");
  h.fixOpens();
  h.fireRestart();
  assert.strictEqual(h.sniffer.capturing, true, "the backoff still heals it when the NIC returns");
  assert.strictEqual(h.sniffer.packetsSeen, 0);
});

// ── the rerank still works where it can, and starts the clocks over ────────

test("a rerank to a new adapter starts the silence clocks over", () => {
  const h = harness();
  h.sniffer.start();               // REAL holds the outbound address
  h.deliverPacket();
  h.probe = "192.168.43.1";        // the route moved to the hotspot
  // Hot windows: the silence restart stands down on a burning handle, which
  // is what leaves the silence unhealed long enough for the 60 s rerank.
  h.idleHot(12);                   // one minute of hot silence: the rerank moves the capture
  assert.deepStrictEqual(h.opened, [REAL.name, REAL.name, HOTSPOT.name], "the capture moved");
  assert.strictEqual(h.sniffer.packetsSeen, 0, "the counter starts over on the new adapter");
  h.probe = "192.168.1.42";        // and the route moved back
  h.idleHot(1);                    // five more seconds of hot silence
  assert.strictEqual(h.opened.length, 3, "no traffic since, so no further move — lastPacketAt was reset too");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
