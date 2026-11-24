/**
 * Tests for the payload batch format between the capture utility process and
 * main (js/sniffer-batch.js).
 *
 * The capture child ships raw Photon payloads to main, where the parser runs.
 * One postMessage per packet would be thousands of IPC hops a second in a
 * market burst, so payloads are packed into one byte array plus an offsets
 * list and flushed on a short timer or when the batch grows large.
 *
 * Contract:
 *   createBatcher({flushMs, maxBytes, post, setTimer, clearTimer})
 *     push(buf)  — queue one payload; flushes at once when the batch reaches
 *                  maxBytes, otherwise arms one flush timer of flushMs
 *     flush()    — post {type:"batch", buf, offsets} if anything is queued
 *   unpackBatch({buf, offsets}) → Buffer[]
 *     — real Buffers even from a plain Uint8Array (what structured clone
 *       delivers); malformed offsets drop the batch rather than throw.
 *
 * Black-box: fake timers, a recording `post`. No IPC.
 *
 * Run: node tests/sniffer-batch.test.cjs
 */

const assert = require("assert");
const { createBatcher, unpackBatch } = require("../js/sniffer-batch.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** A manual timer queue: nothing fires until the test says so. */
function fakeTimers() {
  const t = { pending: new Map(), nextId: 1, armed: [] };
  t.setTimer = (fn, ms) => { const id = t.nextId++; t.pending.set(id, { fn, ms }); t.armed.push(ms); return id; };
  t.clearTimer = (id) => { t.pending.delete(id); };
  t.fireAll = () => {
    const due = [...t.pending.values()];
    t.pending.clear();
    due.forEach((d) => d.fn());
  };
  return t;
}

function makeBatcher(over = {}) {
  const posts = [];
  const timers = fakeTimers();
  const batcher = createBatcher({
    post: (m) => posts.push(m),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...over,
  });
  return { batcher, posts, timers };
}

/** A payload of `n` bytes whose content identifies it. */
function payload(n, seed) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (seed * 31 + i) & 0xff;
  return b;
}

/** Simulate the structured clone: a plain Uint8Array, no Buffer prototype. */
function cloned(msg) {
  return { ...msg, buf: new Uint8Array(msg.buf), offsets: [...msg.offsets] };
}

const unpackAll = (posts) => posts.flatMap((m) => unpackBatch(cloned(m)));

// ── pack → unpack round trips ──────────────────────────────────────────────

const ROUND_TRIPS = [
  { name: "no payloads", sizes: [] },
  { name: "one payload", sizes: [40] },
  { name: "many payloads", sizes: [12, 300, 1200, 13, 64, 500, 12, 999] },
  { name: "a 1-byte payload", sizes: [1] },
  { name: "a 64 KB payload", sizes: [65535] },
  { name: "payloads beyond maxBytes (mid-stream flushes)", sizes: Array(40).fill(1000), maxBytes: 4096 },
];

for (const c of ROUND_TRIPS) {
  test(`round trip: ${c.name}`, () => {
    const { batcher, posts } = makeBatcher(c.maxBytes ? { maxBytes: c.maxBytes } : {});
    const sent = c.sizes.map((n, i) => payload(n, i + 1));
    sent.forEach((b) => batcher.push(b));
    batcher.flush();
    const got = unpackAll(posts);
    assert.strictEqual(got.length, sent.length, "payload count");
    got.forEach((b, i) => assert.ok(b.equals(sent[i]), `payload ${i} differs`));
    if (c.maxBytes) {
      assert.ok(posts.length > 1, `expected mid-stream flushes, got ${posts.length} post(s)`);
      posts.forEach((m) => assert.ok(m.buf.length <= c.maxBytes, "a batch outgrew maxBytes"));
    }
  });
}

test("a batch message carries type, buf and end-terminated offsets", () => {
  const { batcher, posts } = makeBatcher();
  batcher.push(payload(3, 1));
  batcher.push(payload(5, 2));
  batcher.flush();
  assert.strictEqual(posts.length, 1);
  assert.strictEqual(posts[0].type, "batch");
  assert.ok(posts[0].buf instanceof Uint8Array);
  assert.deepStrictEqual(posts[0].offsets, [0, 3, 8]);
});

test("the posted buf owns exactly its bytes (no shared pool behind it)", () => {
  // Structured clone copies the WHOLE ArrayBuffer behind a view, so a slice
  // of Node's 8 KB pool would ship 8 KB for a 3-byte batch.
  const { batcher, posts } = makeBatcher();
  batcher.push(payload(3, 1));
  batcher.flush();
  assert.strictEqual(posts[0].buf.byteOffset, 0);
  assert.strictEqual(posts[0].buf.buffer.byteLength, 3);
});

test("a payload mutated after push does not change the batch", () => {
  // The sniffer reuses one capture buffer for every frame.
  const { batcher, posts } = makeBatcher();
  const b = payload(4, 1);
  const copy = Buffer.from(b);
  batcher.push(b);
  b.fill(0);
  batcher.flush();
  assert.ok(unpackAll(posts)[0].equals(copy));
});

// ── flushing ───────────────────────────────────────────────────────────────

const FLUSH_MS = [15, 50];
for (const flushMs of FLUSH_MS) {
  test(`the flush timer is armed for flushMs=${flushMs} and posts when it fires`, () => {
    const { batcher, posts, timers } = makeBatcher({ flushMs });
    batcher.push(payload(20, 1));
    assert.strictEqual(posts.length, 0, "nothing posted before the timer");
    assert.deepStrictEqual(timers.armed, [flushMs]);
    timers.fireAll();
    assert.strictEqual(posts.length, 1);
  });
}

test("the default flush interval is 15 ms", () => {
  const { batcher, timers } = makeBatcher();
  batcher.push(payload(20, 1));
  assert.deepStrictEqual(timers.armed, [15]);
});

test("one timer per batch, not one per payload", () => {
  const { batcher, timers } = makeBatcher();
  for (let i = 0; i < 10; i++) batcher.push(payload(20, i));
  assert.strictEqual(timers.armed.length, 1);
});

test("reaching maxBytes flushes at once and disarms the timer", () => {
  const { batcher, posts, timers } = makeBatcher({ maxBytes: 100 });
  batcher.push(payload(60, 1));
  batcher.push(payload(40, 2));
  assert.strictEqual(posts.length, 1, "flushed without waiting");
  assert.strictEqual(timers.pending.size, 0, "no stale timer left armed");
});

test("a payload that would overflow the batch ships the queued ones first", () => {
  const { batcher, posts } = makeBatcher({ maxBytes: 100 });
  batcher.push(payload(60, 1));
  batcher.push(payload(60, 2));
  assert.strictEqual(posts.length, 1);
  assert.deepStrictEqual(posts[0].offsets, [0, 60], "only the first payload went");
});

test("a single payload bigger than maxBytes goes out alone, at once", () => {
  const { batcher, posts } = makeBatcher({ maxBytes: 100 });
  batcher.push(payload(10, 1));
  batcher.push(payload(150, 2));
  assert.deepStrictEqual(posts.map((m) => m.offsets), [[0, 10], [0, 150]]);
});

test("the default maxBytes is 256 KB", () => {
  const { batcher, posts } = makeBatcher();
  batcher.push(payload(262143, 1));
  assert.strictEqual(posts.length, 0);
  batcher.push(payload(1, 2));
  assert.strictEqual(posts.length, 1);
});

test("nothing is posted while the batch is empty", () => {
  const { batcher, posts, timers } = makeBatcher();
  batcher.flush();
  timers.fireAll();
  assert.strictEqual(posts.length, 0);
  batcher.push(payload(5, 1));
  batcher.flush();
  batcher.flush();
  timers.fireAll();
  assert.strictEqual(posts.length, 1, "a second flush of an emptied batch posts nothing");
});

test("a timer firing after a manual flush posts nothing", () => {
  const { batcher, posts, timers } = makeBatcher();
  batcher.push(payload(5, 1));
  const stale = [...timers.pending.values()][0];
  batcher.flush();
  stale.fn();
  assert.strictEqual(posts.length, 1);
});

// ── unpack ─────────────────────────────────────────────────────────────────

test("unpack returns real Buffers from a plain Uint8Array", () => {
  const out = unpackBatch({ buf: new Uint8Array([1, 2, 3, 4, 5]), offsets: [0, 2, 5] });
  assert.strictEqual(out.length, 2);
  out.forEach((b) => assert.ok(Buffer.isBuffer(b), "not a Buffer"));
  assert.deepStrictEqual([...out[0]], [1, 2]);
  assert.deepStrictEqual([...out[1]], [3, 4, 5]);
  assert.strictEqual(out[1].readUInt8(0), 3, "Buffer methods work");
});

test("unpack honours a Uint8Array view with a byteOffset", () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3]);
  const view = new Uint8Array(backing.buffer, 2, 3);
  const out = unpackBatch({ buf: view, offsets: [0, 1, 3] });
  assert.deepStrictEqual(out.map((b) => [...b]), [[1], [2, 3]]);
});

const MALFORMED = [
  { name: "an empty offsets array", offsets: [] },
  { name: "a single offset", offsets: [0] },
  { name: "an end past the buffer", offsets: [0, 3, 99] },
  { name: "a negative start", offsets: [-1, 3] },
  { name: "non-monotonic offsets", offsets: [0, 4, 2, 5] },
  { name: "a non-integer offset", offsets: [0, 1.5, 5] },
  { name: "a non-numeric offset", offsets: [0, "3", 5] },
  { name: "offsets that are not an array", offsets: "0,5" },
  { name: "a missing buf", offsets: [0, 5], buf: null },
];

for (const c of MALFORMED) {
  test(`malformed batch is dropped, not thrown: ${c.name}`, () => {
    const buf = "buf" in c ? c.buf : new Uint8Array(5);
    let out;
    assert.doesNotThrow(() => { out = unpackBatch({ buf, offsets: c.offsets }); });
    assert.deepStrictEqual(out, []);
  });
}

test("unpack of a missing message is an empty list", () => {
  assert.deepStrictEqual(unpackBatch(undefined), []);
  assert.deepStrictEqual(unpackBatch(null), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
