/**
 * Tests for re-ranking the adapter AFTER traffic was seen.
 *
 * The silence walk (tests/packet-tap-device.test.cjs) stops the moment a
 * packet arrives — armSwitch parks on packetsSeen > 0, and recycleCapture
 * reopens the SAME adapter. That is correct while the machine stays put, and
 * deaf forever after the route moves: a capture opened on a phone hotspot
 * (10.36.x) sits there with a perfectly healthy handle once the laptop joins
 * Wi-Fi (192.168.x), because the traffic now leaves by another NIC.
 *
 * So the watchdog's tick also asks a second question. Silence of a minute or
 * more on a capture that HAS carried traffic, plus a FRESH route probe naming
 * an adapter other than the one in hand, means the route moved: the ranking
 * is rebuilt around the new address and the capture moves. The probe is taken
 * fresh on purpose — the start-time `localIp` option is exactly the guess
 * that went stale. Every other skip is silent: standing idle on the same
 * network must not churn adapters or spam the status line.
 *
 * Everything is injected — no npcap, no route.exe, no real clock.
 *
 * Run: node tests/packet-tap-rerank.test.cjs
 */

const assert = require("assert");
const { createPacketTap } = require("../js/packet-tap.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const dev = (name, description, ...addrs) => ({
  name, description, addresses: addrs.map((addr) => ({ addr })),
});

// The live incident this fixes: npcap describes the Wi-Fi card as bare
// "Microsoft", and the address in the label is the one it held at start time.
const HOTSPOT = dev("\\Device\\NPF_{HOTSPOT}", "Microsoft", "10.36.24.70");
const WIFI = dev("\\Device\\NPF_{WIFI}", "Intel Wi-Fi 6 AX201", "192.168.178.33");

/**
 * @param {object} [options]
 * @param {object[]} [options.devices]       fake npcap device list
 * @param {string|null} [options.localIp]    the start-time address option
 * @param {string|null} [options.device]     pinned device option
 * @param {string|(() => string)|null} [options.routeIp]  what the probe answers
 * @param {number} [options.healthMs]        watchdog sampling window
 */
function harness({ devices = [HOTSPOT, WIFI], localIp = "10.36.24.70", device = null, routeIp = null, healthMs = 30000 } = {}) {
  const opened = [];
  const closed = [];
  const probes = [];
  const statuses = [];
  let packetHandler = null;
  let healthTick = null;
  let restartTick = null;
  const restartDelays = [];

  function Cap() {
    this.open = (name) => { opened.push(name); return "ETHERNET"; };
    this.close = () => { closed.push(opened[opened.length - 1]); };
    this.on = (event, cb) => { if (event === "packet") packetHandler = cb; };
    this.setMinBytes = () => {};
  }
  Cap.deviceList = () => devices;

  const decoders = {
    PROTOCOL: { ETHERNET: { IPV4: 2048 }, IP: { UDP: 17, TCP: 6 } },
    Ethernet: () => ({ info: { type: 2048 }, offset: 14 }),
    IPV4: () => ({ info: { protocol: 17, srcaddr: "5.188.125.9", totallen: 80 }, offset: 34, hdrlen: 20 }),
    UDP: () => ({ info: { srcport: 5056, dstport: 51000, length: 40 }, offset: 42 }),
  };

  // A clock and a CPU meter the test drives by hand.
  let clock = 0;
  let cpu = 0;

  const sniffer = createPacketTap({
    onMessage: () => {},
    onStatus: (s) => statuses.push(s),
    backend: { Cap, decoders },
    parser: { handle: () => {} },
    localIp,
    device: device || undefined,
    probeRouteIp: () => { probes.push(clock); return typeof routeIp === "function" ? routeIp() : routeIp; },
    setTimer: () => 1,          // adapter-failover walk: never fires here
    clearTimer: () => {},
    healthMs,
    setHealthTimer: (fn) => { healthTick = fn; return 2; },
    clearHealthTimer: () => { healthTick = null; },
    setRestartTimer: (fn, ms) => { restartTick = fn; restartDelays.push(ms); return 3; },
    clearRestartTimer: () => { restartTick = null; },
    now: () => clock,
    cpuMicros: () => cpu,
  });

  function deliver() { packetHandler && packetHandler(200); }
  /** Advance one watchdog window burning 1.5 cores — a spin. */
  function spinOnce() {
    clock += healthMs;
    cpu += healthMs * 1000 * 1.5;
    if (healthTick) healthTick();
  }
  /** Spin hard enough, long enough, to exhaust every reopen attempt. */
  function spinUntilPaused() {
    // No packets: a spinning handle is by definition one nothing arrives on,
    // and traffic (delivered or not) would keep resetting the spin windows.
    for (let i = 0; i < 60 && sniffer.capturing; i++) spinOnce();
  }
  function fireRestart() {
    const fn = restartTick;
    restartTick = null;
    clock += 1;
    if (fn) fn();
  }

  return {
    sniffer, opened, closed, statuses, probes, restartDelays,
    /** Advance the clock by ms of silence, then take one watchdog sample. */
    idle: (ms) => { clock += ms; if (healthTick) healthTick(); },
    spin: spinOnce,
    deliverPacket: deliver,
    spinUntilPaused,
    fireRestart,
    get hasRestartTimer() { return restartTick !== null; },
  };
}

// ── the route moved ────────────────────────────────────────────────────────

test("a route that moved adapters re-ranks the capture onto the new one", () => {
  const h = harness({ routeIp: "192.168.178.33" });
  h.sniffer.start();
  h.deliverPacket();               // traffic confirmed the hotspot pick...
  h.idle(60000);                   // ...then the hotspot went away
  assert.deepStrictEqual(h.opened, [HOTSPOT.name, WIFI.name], "the capture reopens on the adapter holding the new route");
  assert.deepStrictEqual(h.closed, [HOTSPOT.name]);
  assert.strictEqual(h.sniffer.capturing, true);
  assert.strictEqual(h.statuses.at(-1).status, "listening");
  assert.match(
    h.statuses.at(-1).message,
    /no traffic for 60s — was Microsoft \(10\.36\.24\.70\), trying Intel Wi-Fi 6 AX201 \(192\.168\.178\.33\)/,
  );
});

test("the rerank starts the packet count over, re-arming the silence walk", () => {
  const h = harness({ routeIp: "192.168.178.33" });
  h.sniffer.start();
  h.deliverPacket();
  h.idle(60000);
  assert.strictEqual(h.sniffer.packetsSeen, 0, "the new adapter proves itself with fresh traffic");
});

test("the rerank ranks around a FRESH probe, not the start-time localIp option", () => {
  // The option says hotspot; the probe says Wi-Fi. Reusing the option would
  // rebuild the same ranking and reopen the same dead adapter.
  const h = harness({ devices: [WIFI, HOTSPOT], localIp: "10.36.24.70", routeIp: "192.168.178.33" });
  h.sniffer.start();
  assert.strictEqual(h.opened[0], HOTSPOT.name, "the start ranks by the seeded option");
  h.deliverPacket();
  h.idle(60000);
  assert.strictEqual(h.opened.at(-1), WIFI.name, "the rerank uses the fresh answer instead");
  assert.ok(h.probes.length >= 1, "the fresh probe was taken");
});

// ── every reason to leave a capture alone ──────────────────────────────────

test("silence on the adapter that still holds the route heals in place, not a rerank", () => {
  const h = harness({ routeIp: "10.36.24.70" });
  h.sniffer.start();
  h.deliverPacket();
  h.idle(60000);
  h.idle(60000);
  assert.deepStrictEqual(h.opened, [HOTSPOT.name, HOTSPOT.name, HOTSPOT.name],
    "the same adapter is reopened — the probe never names another one");
  assert.deepStrictEqual(h.closed, [HOTSPOT.name, HOTSPOT.name]);
  assert.match(h.statuses.at(-1).message, /restarted/i, "the silence restart is what answered");
});

test("traffic still flowing means no restart however long the session runs", () => {
  const h = harness({ routeIp: "192.168.178.33" });
  h.sniffer.start();
  for (let i = 0; i < 6; i++) { h.deliverPacket(); h.idle(5000); }
  assert.deepStrictEqual(h.opened, [HOTSPOT.name]);
  assert.deepStrictEqual(h.closed, []);
});

test("a pinned device is never reranked, and the probe is never taken for one", () => {
  const h = harness({ device: HOTSPOT.name, routeIp: "192.168.178.33" });
  h.sniffer.start();
  h.deliverPacket();
  h.idle(60000);
  assert.deepStrictEqual(h.probes, [], "an explicitly chosen adapter is not second-guessed");
  assert.deepStrictEqual(h.opened, [HOTSPOT.name, HOTSPOT.name],
    "the silence restart reopens the pinned device itself");
  assert.match(h.statuses.at(-1).message, /restarted/i);
});

test("silence on a capture that never saw traffic is the walk's job, not the rerank's", () => {
  const h = harness({ routeIp: "192.168.178.33" });
  h.sniffer.start();
  h.idle(120000);                  // not one packet, ever
  assert.deepStrictEqual(h.opened, [HOTSPOT.name]);
});

test("an unreadable route (the probe answers nothing) leaves the healing to the restart", () => {
  const h = harness({ routeIp: null });
  h.sniffer.start();
  h.deliverPacket();
  h.idle(60000);
  assert.deepStrictEqual(h.opened, [HOTSPOT.name, HOTSPOT.name],
    "with no fresh route to rank around, the silence restart heals in place");
  assert.deepStrictEqual(h.closed, [HOTSPOT.name]);
  assert.match(h.statuses.at(-1).message, /restarted/i);
});

test("a capture already healing from a spin is left to its restart", () => {
  const h = harness({ routeIp: "192.168.178.33" });
  h.sniffer.start();
  h.deliverPacket();
  h.spinUntilPaused();
  const opens = h.opened.length;
  assert.strictEqual(h.hasRestartTimer, true);
  h.idle(120000);                  // silence far past the threshold, but a restart is pending
  assert.strictEqual(h.opened.length, opens, "no rerank on top of a pending restart");
  h.fireRestart();
  assert.strictEqual(h.sniffer.capturing, true, "the restart still lands");
});

// ── the rerank must not become its own churn loop ──────────────────────────

test("a rerank still cooling down hands the silence to the restart", () => {
  let route = "192.168.178.33";
  const h = harness({ routeIp: () => route });
  h.sniffer.start();
  h.deliverPacket();
  h.idle(60000);                   // first move: hotspot -> Wi-Fi (rerank)
  assert.deepStrictEqual(h.opened, [HOTSPOT.name, WIFI.name]);
  h.deliverPacket();               // traffic confirms the Wi-Fi pick, re-arming the clocks
  route = "10.36.24.70";           // the machine moved back within the cooldown
  h.idle(60000);                   // the rerank is due but still cooling down...
  assert.deepStrictEqual(h.opened, [HOTSPOT.name, WIFI.name, HOTSPOT.name],
    "the silence restart heals instead of waiting out the cooldown");
  assert.match(h.statuses.at(-1).message, /restarted/i, "the restart, not a rerank, did the moving");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
