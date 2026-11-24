/**
 * Tests for choosing WHICH network adapter to capture on.
 *
 * A machine typically offers several: the real NIC, a Hyper-V/WSL bridge, a
 * VPN tap, Bluetooth. Taking the first one in npcap's list is a coin flip, and
 * a wrong pick is silent — the app says "listening" and never sees a packet.
 *
 * Two rules, in order:
 *   1. Rank up front. The adapter holding the machine's outbound IP is the one
 *      carrying the game; virtual adapters rank last.
 *   2. Then confirm with actual traffic. If no Albion packet arrives within the
 *      grace window, the pick was wrong — move to the next candidate. That is
 *      the only honest measure, since npcap exposes no byte counters.
 *
 * No npcap and no device here: the capture library, the parser and the timer
 * are all injected.
 *
 * Run: node tests/packet-tap-device.test.cjs
 */

const assert = require("assert");
const { createPacketTap, rankDevices } = require("../js/packet-tap.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const dev = (name, description, ...addrs) => ({
  name, description, addresses: addrs.map((addr) => ({ addr })),
});

const REAL = dev("\\Device\\NPF_{REAL}", "Realtek PCIe GbE Family Controller", "192.168.1.42");
const VETH = dev("\\Device\\NPF_{VETH}", "Hyper-V Virtual Ethernet Adapter", "172.20.1.1");
const WSL = dev("\\Device\\NPF_{WSL}", "Microsoft (WSL) Virtual Adapter", "172.25.0.1");
const WIFI = dev("\\Device\\NPF_{WIFI}", "Intel Wi-Fi 6 AX201", "192.168.1.77");
const LOOP = dev("\\Device\\NPF_Loopback", "Adapter for loopback traffic capture", "127.0.0.1");
const NOIP = dev("\\Device\\NPF_{NOIP}", "Bluetooth Device (Personal Area Network)");

const names = (list) => list.map((d) => d.description);

// ── ranking ────────────────────────────────────────────────────────────────
test("the adapter holding the outbound IP comes first", () => {
  assert.deepStrictEqual(
    names(rankDevices([VETH, WSL, WIFI, REAL], "192.168.1.77")),
    ["Intel Wi-Fi 6 AX201", "Realtek PCIe GbE Family Controller", "Hyper-V Virtual Ethernet Adapter", "Microsoft (WSL) Virtual Adapter"],
  );
});

test("with no outbound IP known, physical adapters still beat virtual ones", () => {
  assert.deepStrictEqual(
    names(rankDevices([WSL, VETH, REAL], null)),
    ["Realtek PCIe GbE Family Controller", "Microsoft (WSL) Virtual Adapter", "Hyper-V Virtual Ethernet Adapter"],
  );
});

test("ranking is stable among equals — the OS order is kept", () => {
  assert.deepStrictEqual(names(rankDevices([WIFI, REAL], null)), [WIFI.description, REAL.description]);
  assert.deepStrictEqual(names(rankDevices([REAL, WIFI], null)), [REAL.description, WIFI.description]);
});

const EXCLUDED = [
  ["loopback", LOOP],
  ["an adapter with no IPv4 address", NOIP],
];
EXCLUDED.forEach(([label, device]) => {
  test(`${label} is not a candidate at all`, () => {
    assert.deepStrictEqual(rankDevices([device, REAL], null), [REAL]);
  });
});

test("an unknown outbound IP does not promote anything", () => {
  assert.deepStrictEqual(names(rankDevices([WSL, REAL], "10.9.9.9")), [REAL.description, WSL.description]);
});

test("no usable adapter gives an empty list, not a bad guess", () => {
  assert.deepStrictEqual(rankDevices([LOOP, NOIP], null), []);
  assert.deepStrictEqual(rankDevices([], null), []);
});

// ── failover on silence ────────────────────────────────────────────────────
function harness({ devices, localIp = null, linkType = "ETHERNET", protocol = "udp", device = null } = {}) {
  const opened = [];
  const closed = [];
  const filters = [];
  const seen = [];
  let packetHandler = null;
  const timers = [];

  function Cap() {
    this.open = (name, filter) => { opened.push(name); filters.push(filter); return linkType; };
    this.close = () => { closed.push(opened[opened.length - 1]); };
    this.on = (event, cb) => { if (event === "packet") packetHandler = cb; };
    this.setMinBytes = () => {};
  }
  Cap.deviceList = () => devices;

  const decoders = {
    PROTOCOL: { ETHERNET: { IPV4: 2048 }, IP: { UDP: 17, TCP: 6 } },
    Ethernet: () => ({ info: { type: 2048 }, offset: 14 }),
    IPV4: () => ({
      info: { protocol: protocol === "tcp" ? 6 : 17, srcaddr: "5.188.125.9", totallen: 20 + 20 + 40 },
      offset: 34,
      hdrlen: 20,
    }),
    // `cap`'s own decoder already takes the 8-byte UDP header off the wire
    // length before handing it over (node_modules/cap/lib/decoders.js:697,
    // `ret.info.length = b.readUInt16BE(offset) - 8`), so this is payload bytes.
    UDP: () => ({ info: { srcport: 5056, dstport: 51000, length: 40 }, offset: 42 }),
    TCP: () => ({ info: { srcport: 5056, dstport: 51000 }, offset: 54, hdrlen: 20 }),
  };

  const statuses = [];
  const sniffer = createPacketTap({
    onMessage: () => {},
    onStatus: (s) => statuses.push(s),
    backend: { Cap, decoders },
    parser: { handle: (payload) => seen.push(payload) },
    localIp,
    device: device || undefined,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });

  return {
    sniffer, opened, closed, statuses, timers, filters, seen,
    deliverPacket: () => packetHandler && packetHandler(200),
    tick: () => { const fn = timers.shift(); if (fn) fn(); },
  };
}

test("capture opens the best-ranked adapter first", () => {
  const h = harness({ devices: [WSL, REAL], localIp: null });
  assert.strictEqual(h.sniffer.start(), true);
  assert.deepStrictEqual(h.opened, [REAL.name]);
  assert.match(h.statuses.at(-1).message, /Realtek/);
});

test("silence moves the capture to the next adapter", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.tick();                       // grace window elapsed, nothing seen
  assert.deepStrictEqual(h.opened, [REAL.name, WSL.name]);
  assert.deepStrictEqual(h.closed, [REAL.name]);
  assert.match(h.statuses.at(-1).message, /WSL/);
});

test("traffic confirms the adapter and stops the search", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.deliverPacket();
  h.tick();
  assert.deepStrictEqual(h.opened, [REAL.name], "no switch once packets arrive");
  assert.strictEqual(h.sniffer.packetsSeen, 1);
});

test("after the last adapter it reports the real problem instead of cycling", () => {
  const h = harness({ devices: [REAL] });
  h.sniffer.start();
  h.tick();
  assert.deepStrictEqual(h.opened, [REAL.name]);
  assert.strictEqual(h.statuses.at(-1).status, "idle");
  assert.match(h.statuses.at(-1).message, /no Albion traffic/i);
});

test("an explicitly chosen adapter is never second-guessed", () => {
  const h = harness({ devices: [WSL, REAL] });
  const s = createPacketTap({
    onMessage: () => {},
    onStatus: () => {},
    device: WSL.name,
    backend: { Cap: (() => { const C = function () { this.open = () => "ETHERNET"; this.close = () => {}; this.on = () => {}; }; C.deviceList = () => [WSL, REAL]; return C; })(), decoders: {} },
    parser: { handle: () => {} },
    setTimer: () => 1,
    clearTimer: () => {},
  });
  assert.strictEqual(s.start(), true);
  assert.strictEqual(h.sniffer.running, false, "the harness sniffer is untouched");
});

test("with no usable adapter the capture reports why", () => {
  const h = harness({ devices: [LOOP] });
  assert.strictEqual(h.sniffer.start(), false);
  assert.strictEqual(h.statuses.at(-1).status, "unavailable");
});

// The 20 s grace window reports "no Albion traffic — is the game running?" and
// then never spoke again, so a capture that woke up later kept showing that
// line above a rising packet count. The first packet has to take it back.
test("traffic arriving after the idle report corrects the status", () => {
  const h = harness({ devices: [REAL] });
  h.sniffer.start();
  h.tick();
  assert.match(h.statuses.at(-1).message, /no Albion traffic/i);
  h.deliverPacket();
  assert.strictEqual(h.statuses.at(-1).status, "listening");
  assert.match(h.statuses.at(-1).message, /listening on .*Realtek/);
});

test("the correction is announced once, not per packet", () => {
  const h = harness({ devices: [REAL] });
  h.sniffer.start();
  const before = h.statuses.length;
  h.deliverPacket();
  h.deliverPacket();
  h.deliverPacket();
  assert.strictEqual(h.statuses.length - before, 1);
});

// ── TCP as well as UDP ─────────────────────────────────────────────────────
// Albion speaks Photon over both, and the reference client filters both. A
// UDP-only tap sees the game move and chat while missing whatever the client
// happens to carry on the TCP connection — which reads exactly like a decoder
// that has gone deaf.
test("the capture filter takes Photon over TCP as well as UDP", () => {
  const h = harness({ devices: [REAL] });
  h.sniffer.start();
  assert.match(h.filters[0], /tcp port 5056/);
  assert.match(h.filters[0], /udp port 5056/);
});

test("a TCP photon payload reaches the parser", () => {
  const h = harness({ devices: [REAL], protocol: "tcp" });
  h.sniffer.start();
  h.deliverPacket();
  assert.strictEqual(h.seen.length, 1);
  assert.strictEqual(h.sniffer.packetsSeen, 1);
});

test("a UDP photon payload still reaches the parser", () => {
  const h = harness({ devices: [REAL] });
  h.sniffer.start();
  h.deliverPacket();
  assert.strictEqual(h.seen.length, 1);
});

// Taking the UDP header off a length that never had it truncated every packet
// by 8 bytes. Most of the packet still parsed, so the capture looked healthy —
// only the LAST command of each packet fell off the end, and since a market
// order list is the one message big enough to be fragmented, the missing
// fragment meant it was never reassembled. Hence: prices stopped, chat did not.
const PAYLOAD_CASES = [
  ["udp", "udp"],
  ["tcp", "tcp"],
];
PAYLOAD_CASES.forEach(([label, protocol]) => {
  test(`the whole ${label} payload reaches the parser, not 8 bytes short`, () => {
    const h = harness({ devices: [REAL], protocol });
    h.sniffer.start();
    h.deliverPacket();
    assert.strictEqual(h.seen[0].length, 40);
  });
});

test("the game server address is learnt from TCP too", () => {
  const h = harness({ devices: [REAL], protocol: "tcp" });
  h.sniffer.start();
  h.deliverPacket();
  assert.strictEqual(h.sniffer.serverIp, "5.188.125.9");
});

test("stopping cancels the pending switch", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.sniffer.stop();
  h.tick();
  assert.deepStrictEqual(h.opened, [REAL.name], "a stopped capture must not reopen anything");
});

test("restarting begins again from the best candidate", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.tick();                       // switched to WSL
  h.sniffer.stop();
  h.sniffer.start();
  assert.strictEqual(h.opened.at(-1), REAL.name);
  assert.strictEqual(h.sniffer.packetsSeen, 0);
});

// ── the parked capture must not stay parked ────────────────────────────────
// Reaching the last candidate used to be terminal: the walk assumed "no game
// running". But the game often starts AFTER the app (or its route moves — a
// VPN reconnect), so every earlier adapter is silent during the walk and the
// capture then sat on a virtual NIC forever while the game's traffic flowed
// elsewhere. The window kept the last zone drawn and never moved again.
test("a parked capture re-walks the candidates after another grace window", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.tick();                       // REAL silent -> trying WSL
  assert.deepStrictEqual(h.opened, [REAL.name, WSL.name]);
  assert.ok(h.statuses.some((s) => /trying/.test(s.message)), "the switch is announced");
  h.tick();                       // WSL silent -> last adapter, idle report
  assert.strictEqual(h.statuses.at(-1).status, "idle");
  h.tick();                       // the re-walk: back to the best candidate
  assert.deepStrictEqual(h.opened, [REAL.name, WSL.name, REAL.name]);
  assert.deepStrictEqual(h.closed, [REAL.name, WSL.name]);
  assert.match(h.statuses.at(-1).message, /listening on .*Realtek/);
});

test("a game started after the walk is caught by the re-walk", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.tick();                       // -> WSL
  h.tick();                       // -> parked
  h.tick();                       // -> re-walking REAL
  assert.deepStrictEqual(h.opened, [REAL.name, WSL.name, REAL.name]);
  h.deliverPacket();
  assert.strictEqual(h.sniffer.packetsSeen, 1);
  assert.strictEqual(h.statuses.at(-1).status, "listening");
});

test("stopping cancels the pending re-walk", () => {
  const h = harness({ devices: [WSL, REAL] });
  h.sniffer.start();
  h.tick();                       // -> WSL
  h.tick();                       // -> parked, re-walk armed
  h.sniffer.stop();
  h.tick();
  assert.deepStrictEqual(h.opened, [REAL.name, WSL.name], "no reopen after stop");
});

test("an explicitly chosen adapter is re-opened by the re-walk, not second-guessed", () => {
  const h = harness({ devices: [WSL, REAL], device: WSL.name });
  h.sniffer.start();
  h.tick();                       // pinned WSL silent -> idle report
  h.tick();                       // re-walk: same adapter, by choice
  assert.deepStrictEqual(h.opened, [WSL.name, WSL.name]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
