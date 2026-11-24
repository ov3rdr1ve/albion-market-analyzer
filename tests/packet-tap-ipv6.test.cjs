/**
 * Tests for decoding IPv6 game traffic in the capture tap.
 *
 * On a phone hotspot the game connects over IPv6 — a live probe counted 381
 * port-5056 packets, 100% IPv6, 0 IPv4. The BPF filter passes those frames
 * fine; the packet handler must accept ethertype 0x86DD and decode them, or
 * every frame is silently dropped and the capture looks open but deaf.
 *
 * Length maths differ per family: IPv4 carries totallen (whole datagram, so
 * both headers come off for TCP), IPv6 carries payloadlen (already without the
 * 40-byte header, so only the TCP header comes off). UDP needs no maths — its
 * own length field is payload-only in both families.
 *
 * No npcap and no packets here: the capture library, the parser and the timer
 * are all injected. The stub decoders mirror node_modules/cap's real shapes.
 *
 * Run: node --test tests/packet-tap-ipv6.test.cjs
 */

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createPacketTap } = require("../js/packet-tap.js");

const ETHERNET_IPV4 = 2048;   // 0x0800
const ETHERNET_IPV6 = 34525;  // 0x86DD
const PROTO_UDP = 17;
const PROTO_TCP = 6;

const DEVICE = {
  name: "\\Device\\NPF_{AX201}",
  description: "Intel Wi-Fi 6 AX201",
  addresses: [{ addr: "10.36.24.70" }],
};

/**
 * A fake capture backend shaped like the one in packet-tap-device.test.cjs,
 * plus an IPV6 decoder stub matching cap's real one: info.protocol is the
 * final next-header after extension headers, offset points at the transport
 * header, payloadlen counts bytes AFTER the 40-byte fixed header, and there is
 * no totallen and no hdrlen.
 */
function harness({
  ethertype = ETHERNET_IPV6,
  ipOffset = 54,                // 14 (ethernet) + 40 (fixed IPv6 header)
  protocol = PROTO_UDP,
  srcport = 51000,
  dstport = 5056,
  udpLength = 40,               // UDP payload bytes, header already subtracted
  payloadlen,                   // IPv6 only: bytes after the 40-byte header
  srcaddr = "2a01:599:b05:796b::1",
  devices = [DEVICE],
} = {}) {
  const opened = [];
  const filters = [];
  const seen = [];
  const statuses = [];
  let packetHandler = null;
  const timers = [];

  function Cap() {
    this.open = (name, filter) => { opened.push(name); filters.push(filter); return "ETHERNET"; };
    this.close = () => {};
    this.on = (event, cb) => { if (event === "packet") packetHandler = cb; };
    this.setMinBytes = () => {};
  }
  Cap.deviceList = () => devices;

  const decoders = {
    PROTOCOL: { ETHERNET: { IPV4: ETHERNET_IPV4, IPV6: ETHERNET_IPV6 }, IP: { UDP: PROTO_UDP, TCP: PROTO_TCP } },
    Ethernet: () => ({ info: { type: ethertype }, offset: 14 }),
    IPV4: () => ({
      info: { protocol: PROTO_UDP, srcaddr: "5.188.125.9", totallen: 20 + 8 + udpLength },
      offset: 34,
      hdrlen: 20,
    }),
    IPV6: () => ({ info: { protocol, srcaddr, payloadlen }, offset: ipOffset }),
    UDP: () => ({ info: { srcport, dstport, length: udpLength }, offset: ipOffset + 8 }),
    TCP: () => ({ info: { srcport, dstport }, offset: ipOffset + 20, hdrlen: 20 }),
  };

  const sniffer = createPacketTap({
    onMessage: () => {},
    onStatus: (s) => statuses.push(s),
    backend: { Cap, decoders },
    parser: { handle: (payload) => seen.push(payload) },
    localIp: null,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
    setHealthTimer: () => 1,
    clearHealthTimer: () => {},
  });

  return {
    sniffer, opened, filters, seen, statuses,
    deliver: (nbytes = 200) => packetHandler && packetHandler(nbytes),
  };
}

test("IPv6 UDP from the server reaches the parser and learns the v6 address", () => {
  const h = harness({ srcport: 5056, dstport: 51000 });
  assert.strictEqual(h.sniffer.start(), true);
  const statusesBefore = h.statuses.length;
  h.deliver();
  assert.strictEqual(h.seen.length, 1, "the payload reaches the parser once");
  assert.strictEqual(h.seen[0].length, 40, "the whole UDP payload, not truncated");
  assert.strictEqual(h.sniffer.packetsSeen, 1);
  assert.strictEqual(h.sniffer.serverIp, "2a01:599:b05:796b::1");
  assert.ok(h.statuses.length > statusesBefore, "the first packet re-announces the capture");
  assert.strictEqual(h.statuses.at(-1).status, "listening");
});

test("IPv6 UDP to the server reaches the parser without learning a server address", () => {
  const h = harness({ srcport: 51000, dstport: 5056 });
  h.sniffer.start();
  h.deliver();
  assert.strictEqual(h.seen.length, 1);
  assert.strictEqual(h.sniffer.packetsSeen, 1);
  assert.strictEqual(h.sniffer.serverIp, null, "the client's own address is not a server");
});

test("IPv6 UDP on other ports is ignored", () => {
  const h = harness({ srcport: 1234, dstport: 4321 });
  h.sniffer.start();
  const statusesBefore = h.statuses.length;
  h.deliver();
  assert.strictEqual(h.seen.length, 0);
  assert.strictEqual(h.sniffer.packetsSeen, 0);
  assert.strictEqual(h.statuses.length, statusesBefore, "no traffic announcement");
});

test("IPv6 TCP from the server is sized by payloadlen minus the TCP header", () => {
  const h = harness({ protocol: PROTO_TCP, srcport: 5056, dstport: 51000, payloadlen: 60 });
  h.sniffer.start();
  h.deliver();
  assert.strictEqual(h.seen.length, 1);
  assert.strictEqual(h.seen[0].length, 40, "60 payloadlen - 20 TCP header");

  // A frame truncated by the capture must not over-read past what arrived.
  const h2 = harness({ protocol: PROTO_TCP, srcport: 5056, dstport: 51000, payloadlen: 60 });
  h2.sniffer.start();
  h2.deliver(90);               // 74 bytes of headers + 16 bytes of payload
  assert.strictEqual(h2.seen.length, 1);
  assert.strictEqual(h2.seen[0].length, 16, "clamped to the bytes actually captured");
});

test("IPv4 UDP still decodes unchanged (regression)", () => {
  const h = harness({ ethertype: ETHERNET_IPV4, ipOffset: 34, srcport: 5056, dstport: 51000 });
  h.sniffer.start();
  h.deliver();
  assert.strictEqual(h.seen.length, 1);
  assert.strictEqual(h.seen[0].length, 40);
  assert.strictEqual(h.sniffer.serverIp, "5.188.125.9");
  assert.strictEqual(h.sniffer.packetsSeen, 1);
});

test("a non-IP ethertype (ARP) is ignored without throwing", () => {
  const h = harness({ ethertype: 2054 });  // 0x0806
  h.sniffer.start();
  assert.doesNotThrow(() => h.deliver());
  assert.strictEqual(h.seen.length, 0);
  assert.strictEqual(h.sniffer.packetsSeen, 0);
});

test("a short IPv6 UDP ack is counted but not parsed", () => {
  const h = harness({ srcport: 5056, dstport: 51000, udpLength: 5 });
  h.sniffer.start();
  h.deliver();
  assert.strictEqual(h.sniffer.packetsSeen, 1, "counts as traffic — the adapter is confirmed");
  assert.strictEqual(h.seen.length, 0, "below the Photon header minimum, so not parsed");
});
