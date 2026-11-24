/**
 * Tests for the capture utility process entry (js/sniffer-host.js).
 *
 * `cap` faults natively on its close path (a thread-pool wait callback racing
 * pcap_close — see plan.md), and in the main process that fault takes the
 * whole app down with no message. The host runs the sniffer in an Electron
 * utilityProcess instead: it owns the capture, ships raw Photon payloads to
 * main in batches, and mirrors the sniffer's state back as a heartbeat.
 *
 * Contract (runHost):
 *   {type:"start", options:{device}} → creates the sniffer with an injected
 *       parser (whose handle() batches payloads) and the device, then start()s
 *   onStatus(s)  → {type:"status", status:s} then a {type:"state"} snapshot
 *   every 2 s    → a {type:"state"} snapshot (the supervisor's heartbeat)
 *   {type:"stop"} → sniffer.stop(), pending payloads flushed, then exit(0)
 *   start() → false: a state with running:false is posted; no exit
 *   start() throws: reported as a status; no exit
 *
 * Black-box: a fake parentPort (Electron delivers {data} message events), a
 * fake createPacketTap, fake timers and a recording exit. No cap, no
 * Electron.
 *
 * Run: node tests/sniffer-host.test.cjs
 */

const assert = require("assert");
const { EventEmitter } = require("events");
const { runHost } = require("../js/sniffer-host.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** Electron's process.parentPort: message events carry the payload in .data. */
function fakeParentPort() {
  const port = new EventEmitter();
  port.posted = [];
  port.postMessage = (m) => port.posted.push(m);
  port.send = (data) => port.emit("message", { data });
  port.ofType = (type) => port.posted.filter((m) => m.type === type);
  return port;
}

/** A createPacketTap stand-in that records how it was built and driven. */
function fakeSnifferFactory({ startResult = true, startThrows = null } = {}) {
  const factory = (opts) => {
    const s = {
      opts,
      startCalls: 0,
      stopCalls: 0,
      running: false,
      capturing: false,
      serverIp: null,
      packetsSeen: 0,
      deviceName: null,
      start() {
        s.startCalls++;
        if (startThrows) throw startThrows;
        if (startResult === false) {
          opts.onStatus({ status: "unavailable", message: "no IPv4 capture device found" });
          return false;
        }
        s.running = true;
        s.capturing = true;
        s.deviceName = "\\Device\\NPF_{TEST}";
        opts.onStatus({ status: "listening", message: "listening on Ethernet" });
        return true;
      },
      stop() {
        s.stopCalls++;
        s.running = false;
        s.capturing = false;
        opts.onStatus({ status: "stopped", message: "stopped" });
      },
    };
    factory.built.push(s);
    return s;
  };
  factory.built = [];
  return factory;
}

/** Interval + one-shot timers that only fire when told to. */
function fakeTimers() {
  const t = { intervals: new Map(), timeouts: new Map(), nextId: 1 };
  t.setInterval = (fn, ms) => { const id = t.nextId++; t.intervals.set(id, { fn, ms }); return id; };
  t.clearInterval = (id) => { t.intervals.delete(id); };
  t.setTimer = (fn, ms) => { const id = t.nextId++; t.timeouts.set(id, { fn, ms }); return id; };
  t.clearTimer = (id) => { t.timeouts.delete(id); };
  t.tickInterval = () => [...t.intervals.values()].forEach((i) => i.fn());
  t.flushTimeouts = () => {
    const due = [...t.timeouts.values()];
    t.timeouts.clear();
    due.forEach((d) => d.fn());
  };
  return t;
}

function host(over = {}) {
  const port = fakeParentPort();
  const factory = over.factory || fakeSnifferFactory(over);
  const timers = fakeTimers();
  const exits = [];
  runHost({
    parentPort: port,
    createPacketTap: factory,
    exit: (code) => exits.push(code),
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { port, factory, timers, exits, sniffer: () => factory.built[0] };
}

const { unpackBatch } = require("../js/sniffer-batch.js");
const batchedPayloads = (port) => port.ofType("batch").flatMap((m) => unpackBatch(m));

// ── start ──────────────────────────────────────────────────────────────────

const DEVICES = [undefined, "\\Device\\NPF_{ABC}"];
for (const device of DEVICES) {
  test(`start builds the sniffer with device=${device} and an injected parser, then starts it`, () => {
    const h = host();
    h.port.send({ type: "start", options: { device } });
    assert.strictEqual(h.factory.built.length, 1);
    const s = h.sniffer();
    assert.strictEqual(s.opts.device, device);
    assert.ok(s.opts.parser && typeof s.opts.parser.handle === "function", "parser injected");
    assert.strictEqual(typeof s.opts.onStatus, "function");
    assert.strictEqual(s.startCalls, 1);
  });
}

test("a second start while running does not build a second sniffer", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  h.port.send({ type: "start", options: {} });
  assert.strictEqual(h.factory.built.length, 1);
});

test("the injected parser exposes what the sniffer reads from a parser", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  const { parser } = h.sniffer().opts;
  assert.ok(parser.stats && typeof parser.stats === "object");
  assert.strictEqual(parser.pendingFragments, 0);
});

// ── payloads ───────────────────────────────────────────────────────────────

test("payloads handed to parser.handle arrive in a batch message, in order", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  const { parser } = h.sniffer().opts;
  const sent = [Buffer.from([1, 2, 3]), Buffer.from([4]), Buffer.alloc(300, 7)];
  sent.forEach((b) => parser.handle(b));
  assert.strictEqual(h.port.ofType("batch").length, 0, "batched, not posted per packet");
  h.timers.flushTimeouts();
  const got = batchedPayloads(h.port);
  assert.strictEqual(got.length, sent.length);
  got.forEach((b, i) => assert.ok(b.equals(sent[i]), `payload ${i}`));
});

// ── status and state ───────────────────────────────────────────────────────

test("onStatus is forwarded as a status message followed by a state snapshot", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  const kinds = h.port.posted.map((m) => m.type);
  const i = kinds.indexOf("status");
  assert.ok(i >= 0, `no status in ${kinds}`);
  assert.deepStrictEqual(h.port.posted[i].status, { status: "listening", message: "listening on Ethernet" });
  assert.strictEqual(kinds[i + 1], "state", "a state follows the status");
});

test("a state snapshot carries the sniffer's getters", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  const s = h.sniffer();
  s.serverIp = "5.188.125.10";
  s.packetsSeen = 42;
  h.timers.tickInterval();
  const states = h.port.ofType("state");
  assert.deepStrictEqual(states[states.length - 1].state, {
    running: true,
    capturing: true,
    serverIp: "5.188.125.10",
    packetsSeen: 42,
    deviceName: "\\Device\\NPF_{TEST}",
  });
});

test("a state message is sent every 2 s", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  const intervals = [...h.timers.intervals.values()];
  assert.strictEqual(intervals.length, 1, "one heartbeat interval");
  assert.strictEqual(intervals[0].ms, 2000);
  const before = h.port.ofType("state").length;
  h.timers.tickInterval();
  h.timers.tickInterval();
  assert.strictEqual(h.port.ofType("state").length, before + 2);
});

// ── stop ───────────────────────────────────────────────────────────────────

test("stop stops the sniffer, flushes queued payloads, then exits 0", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  h.sniffer().opts.parser.handle(Buffer.from([9, 9, 9]));
  h.port.send({ type: "stop" });
  assert.strictEqual(h.sniffer().stopCalls, 1);
  assert.strictEqual(batchedPayloads(h.port).length, 1, "the queued payload was not lost");
  assert.deepStrictEqual(h.exits, [0]);
  assert.strictEqual(h.timers.intervals.size, 0, "heartbeat cleared");
});

test("stop before any start still exits 0", () => {
  const h = host();
  h.port.send({ type: "stop" });
  assert.deepStrictEqual(h.exits, [0]);
});

test("a sniffer whose stop throws still exits 0", () => {
  const h = host();
  h.port.send({ type: "start", options: {} });
  h.sniffer().stop = () => { throw new Error("already closed"); };
  h.port.send({ type: "stop" });
  assert.deepStrictEqual(h.exits, [0]);
});

// ── failures ───────────────────────────────────────────────────────────────

test("start() returning false posts state running:false and does not exit", () => {
  const h = host({ startResult: false });
  h.port.send({ type: "start", options: {} });
  const states = h.port.ofType("state");
  assert.ok(states.length > 0, "a state was posted");
  assert.strictEqual(states[states.length - 1].state.running, false);
  assert.deepStrictEqual(h.exits, []);
});

test("start() throwing is reported as a status and does not exit", () => {
  const h = host({ startThrows: new Error("cap was built for a different runtime") });
  assert.doesNotThrow(() => h.port.send({ type: "start", options: {} }));
  const statuses = h.port.ofType("status");
  assert.ok(statuses.some((m) => /different runtime/.test(m.status.message)), "error reported");
  assert.strictEqual(h.port.ofType("state").pop().state.running, false);
  assert.deepStrictEqual(h.exits, []);
});

test("unknown and malformed messages are ignored", () => {
  const h = host();
  assert.doesNotThrow(() => {
    h.port.send({ type: "nonsense" });
    h.port.send(null);
    h.port.emit("message", undefined);
  });
  assert.strictEqual(h.factory.built.length, 0);
  assert.deepStrictEqual(h.exits, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
