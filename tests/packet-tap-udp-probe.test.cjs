"use strict";

/**
 * udpProbeLocalIp() — the dgram fallback of the outbound-IP probe.
 *
 * The probe connects a throwaway UDP socket at 8.8.8.8:53 purely to make the
 * OS pick a route; nothing is ever sent. On a machine with NO default route
 * (an offline start, a hotspot that dropped) the connect fails — and the
 * failure is delivered ASYNCHRONOUSLY, as an EventEmitter 'error'. The old
 * implementation attached no listener, so it escaped as an uncaughtException
 * and, under Electron, as the "Uncaught Exception: connect ENETUNREACH
 * 8.8.8.8:53" crash dialog on every offline start.
 *
 * The socket factory is injectable, so no dgram socket is ever opened here
 * and no network is touched. The async-failure case installs a temporary
 * process-level uncaughtException capture and asserts it stays empty across
 * a drained tick — exactly the property an offline start needs.
 *
 * Plain harness (no node:test registration).
 *
 * Run: node tests/packet-tap-udp-probe.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { udpProbeLocalIp } = require("../js/packet-tap.js");

// The shipped source, for the default-factory smoke below: the real probe
// (no injected factory) must register its error sink between createSocket
// and connect, or the first routeless start crashes again.
const SOURCE = fs.readFileSync(path.join(__dirname, "..", "js", "packet-tap.js"), "utf8");

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/**
 * A minimal dgram-shaped fake. `handlers` mirrors EventEmitter registration
 * so the error sink can be counted; `emitError` reproduces EventEmitter's
 * contract that an 'error' with NO listener THROWS — which is precisely the
 * mechanism that used to reach uncaughtException.
 */
function fakeSocket({ address = "0.0.0.0", failAsync = false, ops = [] } = {}) {
  const socket = {
    handlers: {},
    on(event, fn) {
      (socket.handlers[event] ||= []).push(fn);
      ops.push(["on", event]);
      return socket;
    },
    unref() { ops.push(["unref"]); },
    connect(port, host) {
      ops.push(["connect", port, host]);
      if (failAsync) {
        // The way a routeless connect actually fails: not a throw, an
        // 'error' on a later tick.
        process.nextTick(() => emitError(socket, new Error(`connect ENETUNREACH ${host}:${port}`)));
      }
    },
    address() { ops.push(["address"]); return { address, family: "IPv4", port: 5353 }; },
    close() { ops.push(["close"]); },
  };
  return socket;
}

/** EventEmitter semantics: an unhandled 'error' event throws. */
function emitError(socket, err) {
  const fns = socket.handlers.error || [];
  if (!fns.length) throw err;
  for (const fn of fns) fn(err);
}

/** Drain every scheduled tick, so any async 'error' has had its chance. */
async function drainTicks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setImmediate(resolve));
}

// ── the probe ──────────────────────────────────────────────────────────────

(async () => {
  await test("an async connect failure returns null and never reaches uncaughtException", async () => {
    const uncaught = [];
    const capture = (e) => uncaught.push(e);
    process.on("uncaughtException", capture);
    try {
      const ops = [];
      const socket = fakeSocket({ failAsync: true, ops });
      assert.strictEqual(udpProbeLocalIp(() => socket), null, "the probe itself answers null on failure");
      await drainTicks();
      assert.deepStrictEqual(uncaught, [], "the async 'error' must be swallowed, not crash the process");
      assert.ok(ops.some(([op]) => op === "connect"), "the probe still attempted the connect");
    } finally {
      process.removeListener("uncaughtException", capture);
    }
  });

  await test("the error sink is registered before connect() — observed through the fake", async () => {
    const ops = [];
    const socket = fakeSocket({ failAsync: true, ops });
    udpProbeLocalIp(() => socket);
    const sink = ops.findIndex(([op, ev]) => op === "on" && ev === "error");
    const connect = ops.findIndex(([op]) => op === "connect");
    assert.ok(sink !== -1, "an error sink must be registered at all");
    assert.ok(sink < connect, "the sink must exist before connect() can fail");
  });

  await test("the shipped source registers the error sink between createSocket and connect", async () => {
    // Default-factory path smoke: production calls udpProbeLocalIp() with no
    // factory, landing in the real dgram branch. The sink's position is
    // pinned straight on the source — order is the whole fix.
    const created = SOURCE.indexOf('createSocket("udp4")');
    const sink = SOURCE.indexOf('.on("error"');
    const connected = SOURCE.indexOf("socket.connect(53");
    assert.ok(created !== -1 && sink !== -1 && connected !== -1, "probe wiring found in source");
    assert.ok(created < sink && sink < connected,
      'the "error" sink must sit after createSocket and before connect()');
  });

  await test("a successful probe returns the socket's address and does not pin the process", async () => {
    const ops = [];
    const socket = fakeSocket({ address: "192.168.1.42", ops });
    assert.strictEqual(udpProbeLocalIp(() => socket), "192.168.1.42");
    assert.ok(ops.some(([op]) => op === "unref"), "a route probe must never keep the process alive");
  });

  await test("a 0.0.0.0 answer (route not settled in the same tick) is an honest null", async () => {
    const socket = fakeSocket({ address: "0.0.0.0" });
    assert.strictEqual(udpProbeLocalIp(() => socket), null);
  });

  await test("a factory that throws synchronously yields null, not a crash", async () => {
    assert.strictEqual(udpProbeLocalIp(() => { throw new Error("no dgram here"); }), null);
    assert.strictEqual(udpProbeLocalIp(() => null), null, "a factory with nothing to give is the same failure");
  });

  await test("a socket that throws at connect or at address() is swallowed and answers null", async () => {
    const badConnect = fakeSocket();
    badConnect.connect = () => { throw new Error("EBADF"); };
    assert.strictEqual(udpProbeLocalIp(() => badConnect), null);
    const badAddress = fakeSocket();
    badAddress.address = () => { throw new Error("socket gone"); };
    assert.strictEqual(udpProbeLocalIp(() => badAddress), null);
  });

  await test("the injected factory is the only socket source", async () => {
    // If the implementation ever built its own socket alongside the injected
    // one, the recording fake would see extra registration. It must not.
    const ops = [];
    const socket = fakeSocket({ address: "10.0.0.2", ops });
    assert.strictEqual(udpProbeLocalIp(() => socket), "10.0.0.2");
    assert.strictEqual(ops.filter(([op]) => op === "on").length, 1, "exactly the one error sink");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL: harness - ${e.message}`);
  process.exit(1);
});
