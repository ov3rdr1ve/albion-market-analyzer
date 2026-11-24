/**
 * Tests for the main-side capture supervisor (js/sniffer-supervisor.js).
 *
 * The capture runs in an Electron utilityProcess so a native fault in `cap`
 * kills only that process (see plan.md). The supervisor is what main.js gets
 * in its place: the SAME surface as createPacketTap, so monitor-session
 * cannot tell the difference, plus the part a process boundary adds — what
 * to do when the child dies.
 *
 * Contract:
 *   start()  → forks the child, posts {type:"start", options:{device}}, true
 *   stop()   → posts {type:"stop"}, kills the child after a 2 s grace, never
 *              restarts, reports "stopped"
 *   getters  → capturing/serverIp/packetsSeen/deviceName mirror the latest
 *              state message (false/null/0 before one); running is the
 *              monitor's switch, like the sniffer's own: on from start()
 *              until stop(), a failed child start, or the circuit breaker
 *   photonStats/pendingFragments → the main-side parser's
 *   batch    → each payload, as a Buffer, into the parser in order
 *   status   → onStatus, unchanged
 *   crash    → logged with its code; {status:"error", message:/restarting/}; mirror reset;
 *              re-fork after min(30000, 1000·2^n)·(0.5 + random/2) with the
 *              same options, n = crashes in a row before this one
 *   60 s up  → the crash-in-a-row count resets
 *   5 crashes in 2 min → no more restarts, {status:"error", message:/stopped
 *              after repeated crashes/}; an explicit start() resets it
 *   30 s without a state → the child is killed (a hung Npcap), which restarts
 *   fork throws → status "unavailable", start() returns false
 *
 * Black-box: fake fork/child, fake clock and timers, fixed random, recording
 * logger and parser. No Electron, no cap.
 *
 * Run: node tests/sniffer-supervisor.test.cjs
 */

const assert = require("assert");
const { EventEmitter } = require("events");
const { createSupervisedSniffer } = require("../js/sniffer-supervisor.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** A clock plus one-shot timers that fire, in due order, as time advances. */
function fakeClock() {
  const c = { t: 1_000_000, timers: new Map(), nextId: 1 };
  c.now = () => c.t;
  c.setTimer = (fn, ms) => { const id = c.nextId++; c.timers.set(id, { fn, at: c.t + ms, ms }); return id; };
  c.clearTimer = (id) => { c.timers.delete(id); };
  c.advance = (ms) => {
    const end = c.t + ms;
    for (;;) {
      let next = null;
      for (const [id, tm] of c.timers) if (tm.at <= end && (!next || tm.at < next[1].at)) next = [id, tm];
      if (!next) break;
      c.timers.delete(next[0]);
      c.t = next[1].at;
      next[1].fn();
    }
    c.t = end;
  };
  return c;
}

/** A utilityProcess.fork stand-in: each call hands back a recording child. */
function fakeFork({ throws = null } = {}) {
  const fork = (...args) => {
    fork.calls.push(args);
    if (throws) throw throws;
    const child = new EventEmitter();
    child.pid = 4000 + fork.children.length;
    child.posted = [];
    child.killCalls = 0;
    child.postMessage = (m) => child.posted.push(m);
    child.kill = () => { child.killCalls++; return true; };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    // What the real child would say back.
    child.state = (s) => child.emit("message", {
      type: "state",
      state: { running: true, capturing: true, serverIp: null, packetsSeen: 0, deviceName: null, ...s },
    });
    fork.children.push(child);
    return child;
  };
  fork.calls = [];
  fork.children = [];
  fork.last = () => fork.children[fork.children.length - 1];
  return fork;
}

function fakeParserFactory() {
  const factory = (onMessage) => {
    const p = { onMessage, handled: [], stats: { packets: 0, events: 3 }, pendingFragments: 2 };
    p.handle = (buf) => { p.handled.push(buf); p.stats.packets++; };
    factory.built.push(p);
    return p;
  };
  factory.built = [];
  return factory;
}

function supervised(over = {}) {
  const clock = fakeClock();
  const fork = over.fork || fakeFork();
  const parsers = fakeParserFactory();
  const statuses = [];
  const lines = [];
  const onMessage = () => {};
  const s = createSupervisedSniffer({
    onMessage,
    onStatus: (st) => statuses.push(st),
    device: over.device,
    fork,
    entryPath: "/app/js/sniffer-host.js",
    logger: { log: (m) => lines.push(m) },
    createParser: parsers,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    random: () => over.random ?? 0.5,
  });
  return { s, clock, fork, parsers, statuses, lines, onMessage, parser: () => parsers.built[0] };
}

const backoff = (n, r) => Math.min(30000, 1000 * 2 ** n) * (0.5 + r / 2);
const lastStatus = (h) => h.statuses[h.statuses.length - 1];

// ── the createPacketTap surface ─────────────────────────────────────────

test("start forks the host entry as albion-capture and posts start with options", () => {
  const h = supervised({ device: "\\Device\\NPF_{X}" });
  assert.strictEqual(h.s.start(), true);
  assert.strictEqual(h.fork.calls.length, 1);
  const [entry, args, opts] = h.fork.calls[0];
  assert.strictEqual(entry, "/app/js/sniffer-host.js");
  assert.deepStrictEqual(args, []);
  assert.strictEqual(opts.serviceName, "albion-capture");
  assert.strictEqual(opts.stdio, "pipe");
  assert.deepStrictEqual(h.fork.last().posted, [{ type: "start", options: { device: "\\Device\\NPF_{X}" } }]);
});

test("a second start while on does not fork again", () => {
  const h = supervised();
  h.s.start();
  assert.strictEqual(h.s.start(), true);
  assert.strictEqual(h.fork.calls.length, 1);
});

test("getters default to false / null / 0 before any state arrives", () => {
  const h = supervised();
  assert.strictEqual(h.s.running, false);
  assert.strictEqual(h.s.capturing, false);
  assert.strictEqual(h.s.serverIp, null);
  assert.strictEqual(h.s.packetsSeen, 0);
  assert.strictEqual(h.s.deviceName, null);
  h.s.start();
  assert.strictEqual(h.s.capturing, false, "capturing waits for the child to say so");
  assert.strictEqual(h.s.packetsSeen, 0);
});

test("the getters mirror the latest state message", () => {
  const h = supervised();
  h.s.start();
  h.fork.last().state({ serverIp: "5.188.125.10", packetsSeen: 7, deviceName: "eth0" });
  h.fork.last().state({ serverIp: "5.188.125.11", packetsSeen: 9, deviceName: "eth1", capturing: false });
  assert.strictEqual(h.s.running, true);
  assert.strictEqual(h.s.capturing, false);
  assert.strictEqual(h.s.serverIp, "5.188.125.11");
  assert.strictEqual(h.s.packetsSeen, 9);
  assert.strictEqual(h.s.deviceName, "eth1");
});

test("photonStats and pendingFragments come from the main-side parser", () => {
  const h = supervised();
  h.s.start();
  assert.strictEqual(h.parsers.built.length, 1, "one parser");
  assert.strictEqual(h.parser().onMessage, h.onMessage, "built with onMessage");
  assert.strictEqual(h.s.photonStats, h.parser().stats);
  assert.strictEqual(h.s.pendingFragments, 2);
});

test("a batch feeds each payload, as a Buffer, to the parser in order", () => {
  const h = supervised();
  h.s.start();
  h.fork.last().emit("message", { type: "batch", buf: new Uint8Array([1, 2, 3, 4, 5, 6]), offsets: [0, 1, 4, 6] });
  const got = h.parser().handled;
  assert.strictEqual(got.length, 3);
  got.forEach((b) => assert.ok(Buffer.isBuffer(b)));
  assert.deepStrictEqual(got.map((b) => [...b]), [[1], [2, 3, 4], [5, 6]]);
});

test("a parser that throws on one payload does not lose the rest", () => {
  const h = supervised();
  h.s.start();
  const p = h.parser();
  const handle = p.handle;
  p.handle = (b) => { if (b[0] === 1) throw new Error("bad frame"); handle(b); };
  h.fork.last().emit("message", { type: "batch", buf: new Uint8Array([1, 2]), offsets: [0, 1, 2] });
  assert.deepStrictEqual(p.handled.map((b) => [...b]), [[2]]);
});

test("a status message is forwarded to onStatus unchanged", () => {
  const h = supervised();
  h.s.start();
  const st = { status: "listening", message: "listening on Ethernet" };
  h.fork.last().emit("message", { type: "status", status: st });
  assert.deepStrictEqual(lastStatus(h), st);
});

test("stop posts stop, reports stopped, kills after the grace period, never restarts", () => {
  const h = supervised();
  h.s.start();
  const child = h.fork.last();
  child.state({});
  h.s.stop();
  assert.deepStrictEqual(child.posted[child.posted.length - 1], { type: "stop" });
  assert.strictEqual(lastStatus(h).status, "stopped");
  assert.strictEqual(h.s.running, false);
  assert.strictEqual(h.s.capturing, false);
  h.clock.advance(1999);
  assert.strictEqual(child.killCalls, 0, "not before the grace period");
  h.clock.advance(1);
  assert.strictEqual(child.killCalls, 1, "killed after 2 s");
  child.emit("exit", 1);
  h.clock.advance(120000);
  assert.strictEqual(h.fork.calls.length, 1, "no restart");
});

test("a child that exits cleanly within the grace period is not killed", () => {
  const h = supervised();
  h.s.start();
  const child = h.fork.last();
  h.s.stop();
  child.emit("exit", 0);
  h.clock.advance(5000);
  assert.strictEqual(child.killCalls, 0);
});

test("stop then start forks a fresh child", () => {
  const h = supervised();
  h.s.start();
  h.s.stop();
  assert.strictEqual(h.s.start(), true);
  assert.strictEqual(h.fork.calls.length, 2);
});

test("messages from a stopped child are ignored", () => {
  const h = supervised();
  h.s.start();
  const old = h.fork.last();
  h.s.stop();
  h.s.start();
  const before = h.statuses.length;
  old.emit("message", { type: "status", status: { status: "stopped", message: "stopped" } });
  old.state({ packetsSeen: 99 });
  assert.strictEqual(h.statuses.length, before);
  assert.strictEqual(h.s.packetsSeen, 0);
});

// ── crashes ────────────────────────────────────────────────────────────────

const CRASH_CODES = [-1073741819, 1, 3221225477];
for (const code of CRASH_CODES) {
  test(`a crash with exit code ${code} is logged, reported, reset and restarted`, () => {
    const h = supervised({ device: "eth0", random: 0.25 });
    h.s.start();
    const first = h.fork.last();
    first.state({ serverIp: "5.188.125.10", packetsSeen: 50 });
    first.emit("exit", code);

    assert.ok(h.lines.some((l) => l.includes(String(code))), `no log line with ${code}: ${h.lines}`);
    const st = lastStatus(h);
    assert.strictEqual(st.status, "error");
    assert.match(st.message, /restarting/i);
    assert.strictEqual(h.s.capturing, false);
    assert.strictEqual(h.s.packetsSeen, 0);
    assert.strictEqual(h.s.serverIp, null);
    assert.strictEqual(h.s.running, true, "the monitor stays on while it restarts");

    const delay = backoff(0, 0.25);
    h.clock.advance(delay - 1);
    assert.strictEqual(h.fork.calls.length, 1, "not before the backoff");
    h.clock.advance(1);
    assert.strictEqual(h.fork.calls.length, 2, "re-forked after the backoff");
    assert.deepStrictEqual(h.fork.last().posted, [{ type: "start", options: { device: "eth0" } }]);
  });
}

test("the backoff doubles with each crash in a row and caps at 30 s", () => {
  const random = 1;  // 0.5 + 1/2 = 1: the bare exponential
  const h = supervised({ random });
  h.s.start();
  const seen = [];
  // Space the crashes past the breaker window so only the backoff is measured.
  for (let n = 0; n < 7; n++) {
    for (let k = 0; k < 16; k++) { h.clock.advance(2000); h.fork.last().state({}); }
    const forksBefore = h.fork.calls.length;
    h.fork.last().emit("exit", 1);
    const start = h.clock.t;
    while (h.fork.calls.length === forksBefore) h.clock.advance(100);
    seen.push(h.clock.t - start);
  }
  assert.deepStrictEqual(seen, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});

test("a stopped supervisor does not restart a crash that lands in the backoff", () => {
  const h = supervised();
  h.s.start();
  h.fork.last().emit("exit", 1);
  h.s.stop();
  h.clock.advance(60000);
  assert.strictEqual(h.fork.calls.length, 1);
});

test("an exit after stop() does not restart", () => {
  const h = supervised();
  h.s.start();
  const child = h.fork.last();
  h.s.stop();
  child.emit("exit", -1073741819);
  h.clock.advance(60000);
  assert.strictEqual(h.fork.calls.length, 1);
  assert.ok(!h.statuses.some((s) => /restarting/i.test(s.message)), "no restart reported");
});

test("the crash-in-a-row count resets after the child stays up 60 s", () => {
  const h = supervised({ random: 1 });
  h.s.start();
  h.fork.last().emit("exit", 1);           // crash 1 → 1 s
  h.clock.advance(1000);
  h.fork.last().emit("exit", 1);           // crash 2 → 2 s
  h.clock.advance(2000);
  // Stays up, heartbeating, for a full minute.
  for (let i = 0; i < 30; i++) { h.clock.advance(2000); h.fork.last().state({}); }
  const forks = h.fork.calls.length;
  h.fork.last().emit("exit", 1);
  h.clock.advance(999);
  assert.strictEqual(h.fork.calls.length, forks, "not before 1 s");
  h.clock.advance(1);
  assert.strictEqual(h.fork.calls.length, forks + 1, "back to the 1 s backoff");
});

// ── circuit breaker ────────────────────────────────────────────────────────

function crashFiveTimesFast(h) {
  h.s.start();
  for (let i = 0; i < 5; i++) {
    h.fork.last().emit("exit", -1073741819);
    h.clock.advance(backoff(i, 0.5));
  }
}

test("5 crashes within 2 minutes stop the restarts", () => {
  const h = supervised();
  crashFiveTimesFast(h);
  const forks = h.fork.calls.length;
  h.clock.advance(10 * 60000);
  assert.strictEqual(h.fork.calls.length, forks, "no restart after the breaker trips");
  const st = lastStatus(h);
  assert.strictEqual(st.status, "error");
  assert.match(st.message, /stopped after repeated crashes/i);
  assert.strictEqual(h.s.running, false, "the monitor reads off: Start is offered");
  assert.ok(h.lines.some((l) => /repeated crashes/i.test(l)), "logged");
});

test("crashes spread over more than 2 minutes do not trip the breaker", () => {
  const h = supervised();
  h.s.start();
  for (let i = 0; i < 8; i++) {
    h.clock.advance(31000);
    h.fork.last().emit("exit", 1);
  }
  h.clock.advance(31000);
  assert.strictEqual(h.fork.calls.length, 9);
  assert.ok(!h.statuses.some((s) => /repeated crashes/i.test(s.message)));
});

test("an explicit start() after the breaker resets it", () => {
  const h = supervised();
  crashFiveTimesFast(h);
  const forks = h.fork.calls.length;
  assert.strictEqual(h.s.start(), true);
  assert.strictEqual(h.fork.calls.length, forks + 1, "forked again");
  // A fresh breaker: one more crash restarts instead of tripping.
  h.fork.last().emit("exit", 1);
  assert.match(lastStatus(h).message, /restarting/i);
  h.clock.advance(1000);
  assert.strictEqual(h.fork.calls.length, forks + 2);
});

// ── heartbeat watchdog ─────────────────────────────────────────────────────

test("30 s without a state message kills the child, and the exit restarts it", () => {
  const h = supervised();
  h.s.start();
  const child = h.fork.last();
  child.state({});
  h.clock.advance(29999);
  assert.strictEqual(child.killCalls, 0);
  h.clock.advance(1);
  assert.strictEqual(child.killCalls, 1, "killed on a silent heartbeat");
  assert.ok(h.lines.some((l) => /heartbeat/i.test(l)), "logged");
  child.emit("exit", 1);
  h.clock.advance(1000);
  assert.strictEqual(h.fork.calls.length, 2, "restarted");
});

test("a steady heartbeat keeps the child alive", () => {
  const h = supervised();
  h.s.start();
  for (let i = 0; i < 60; i++) { h.clock.advance(2000); h.fork.last().state({}); }
  assert.strictEqual(h.fork.last().killCalls, 0);
});

test("a child that never sends a first state is killed too", () => {
  const h = supervised();
  h.s.start();
  h.clock.advance(30000);
  assert.strictEqual(h.fork.last().killCalls, 1);
});

// ── start failures ─────────────────────────────────────────────────────────

test("a fork that throws reports unavailable and start() returns false", () => {
  const h = supervised({ fork: fakeFork({ throws: new Error("spawn EACCES") }) });
  assert.strictEqual(h.s.start(), false);
  const st = lastStatus(h);
  assert.strictEqual(st.status, "unavailable");
  assert.match(st.message, /EACCES/);
  assert.strictEqual(h.s.running, false);
});

test("a child whose capture fails to start turns the monitor off and is stopped", () => {
  // The child's own start() returned false (no adapter, no npcap): it posts
  // a state with running:false before ever reporting running:true.
  const h = supervised();
  h.s.start();
  const child = h.fork.last();
  child.emit("message", { type: "status", status: { status: "unavailable", message: "no IPv4 capture device found" } });
  child.state({ running: false, capturing: false });
  assert.strictEqual(h.s.running, false);
  assert.deepStrictEqual(child.posted[child.posted.length - 1], { type: "stop" });
  assert.strictEqual(lastStatus(h).status, "unavailable", "the child's reason is what the user sees");
  child.emit("exit", 0);
  h.clock.advance(60000);
  assert.strictEqual(h.fork.calls.length, 1, "no restart");
});

test("a running:false state after the capture ran is not mistaken for a failed start", () => {
  // packet-tap drops its switch for a moment inside its own restart.
  const h = supervised();
  h.s.start();
  h.fork.last().state({});
  h.fork.last().state({ running: false, capturing: false });
  assert.strictEqual(h.s.running, true);
  assert.ok(!h.fork.last().posted.some((m) => m.type === "stop"));
});

// ── child output ───────────────────────────────────────────────────────────

test("child stdout and stderr lines go to the log prefixed [capture]", () => {
  const h = supervised();
  h.s.start();
  h.fork.last().stdout.emit("data", Buffer.from("hello\nwor"));
  h.fork.last().stdout.emit("data", Buffer.from("ld\n"));
  h.fork.last().stderr.emit("data", "oops\n");
  assert.ok(h.lines.includes("[capture] hello"));
  assert.ok(h.lines.includes("[capture] world"));
  assert.ok(h.lines.includes("[capture] oops"));
});

test("a child without stdout/stderr streams is fine", () => {
  const fork = fakeFork();
  const wrapped = (...a) => { const c = fork(...a); c.stdout = null; c.stderr = null; return c; };
  wrapped.calls = fork.calls;
  wrapped.children = fork.children;
  wrapped.last = fork.last;
  const h = supervised({ fork: wrapped });
  assert.strictEqual(h.s.start(), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
