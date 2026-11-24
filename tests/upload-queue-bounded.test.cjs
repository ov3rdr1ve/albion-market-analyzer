/**
 * Test: the AODP upload queue is bounded and serial.
 *
 * Every captured market response used to fire its own upload immediately, and
 * every upload costs one proof-of-work solve — benched at 0.34M sha256
 * attempts/s, i.e. 0.2–2 s of a core each. One market sweep emits hundreds of
 * responses, so the solver thread stayed pinned for minutes AFTER the game was
 * closed, and the promise for every one of them was retained forever.
 *
 * The queue fixes both: at most `concurrency` uploads in flight, at most
 * `maxPending` waiting, and the OLDEST waiting payload is dropped when the
 * backlog overflows — stale prices are the ones worth losing.
 *
 * Black box: the upload function is injected, no network.
 *
 * Run: node tests/upload-queue-bounded.test.cjs
 */

const assert = require("assert");
const path = require("path");

const { createUploadQueue } = require(path.join(__dirname, "..", "js", "upload-queue.js"));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

/** An upload that resolves only when the test says so. */
function gate() {
  let release;
  const promise = new Promise((res) => { release = res; });
  return { promise, release: (v) => release(v) };
}

(async () => {
  console.log("\n=== ordering and concurrency ===");

  await test("uploads run one at a time, in the order they were queued", async () => {
    const order = [];
    let active = 0, peak = 0;
    const q = createUploadQueue({
      upload: async (payload) => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        order.push(payload.n);
        active--;
        return { ok: true };
      },
    });
    for (let n = 1; n <= 5; n++) q.push({ n }, "topic");
    await q.idle();
    assert.deepStrictEqual(order, [1, 2, 3, 4, 5]);
    assert.strictEqual(peak, 1, "default concurrency is one solver thread's worth");
  });

  await test("concurrency is configurable", async () => {
    let active = 0, peak = 0;
    const q = createUploadQueue({
      concurrency: 3,
      upload: async () => {
        active++; peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { ok: true };
      },
    });
    for (let n = 0; n < 6; n++) q.push({ n }, "topic");
    await q.idle();
    assert.strictEqual(peak, 3);
  });

  console.log("\n=== bounding ===");

  await test("the oldest waiting payload is dropped once the backlog is full", async () => {
    const done = [];
    const held = gate();
    const q = createUploadQueue({
      maxPending: 2,
      upload: async (payload) => { await held.promise; done.push(payload.n); return { ok: true }; },
    });
    q.push({ n: 1 }, "t"); // starts immediately
    q.push({ n: 2 }, "t"); // waiting
    q.push({ n: 3 }, "t"); // waiting — queue now full
    q.push({ n: 4 }, "t"); // pushes 2 out
    assert.strictEqual(q.stats.dropped, 1);
    held.release();
    await q.idle();
    assert.deepStrictEqual(done, [1, 3, 4], "the freshest prices survive");
  });

  await test("nothing is dropped while the backlog fits", async () => {
    const q = createUploadQueue({ maxPending: 10, upload: async () => ({ ok: true }) });
    for (let n = 0; n < 8; n++) q.push({ n }, "t");
    await q.idle();
    assert.strictEqual(q.stats.dropped, 0);
    assert.strictEqual(q.stats.done, 8);
  });

  await test("a long burst never grows the queue past the bound", async () => {
    const held = gate();
    const q = createUploadQueue({ maxPending: 4, upload: async () => { await held.promise; return { ok: true }; } });
    for (let n = 0; n < 500; n++) {
      q.push({ n }, "t");
      assert.ok(q.pending <= 4, `queue grew to ${q.pending}`);
    }
    assert.strictEqual(q.stats.dropped, 495);
    held.release();
    await q.idle();
  });

  console.log("\n=== accounting ===");

  await test("ok, failed and thrown uploads are all counted", async () => {
    const results = [{ ok: true }, { ok: false, reason: "network" }, new Error("boom")];
    let i = 0;
    const q = createUploadQueue({
      upload: async () => {
        const r = results[i++];
        if (r instanceof Error) throw r;
        return r;
      },
    });
    for (let n = 0; n < 3; n++) q.push({ n }, "t");
    await q.idle();
    assert.strictEqual(q.stats.done, 1);
    assert.strictEqual(q.stats.failed, 2);
  });

  await test("an upload that throws does not stall the queue", async () => {
    const seen = [];
    const q = createUploadQueue({
      upload: async (payload) => {
        seen.push(payload.n);
        if (payload.n === 0) throw new Error("boom");
        return { ok: true };
      },
    });
    q.push({ n: 0 }, "t");
    q.push({ n: 1 }, "t");
    await q.idle();
    assert.deepStrictEqual(seen, [0, 1]);
  });

  await test("the caller is told the outcome of each upload", async () => {
    const seen = [];
    const q = createUploadQueue({
      upload: async () => ({ ok: true, status: 200 }),
      onResult: (r) => seen.push(r),
    });
    q.push({ n: 1 }, "t");
    await q.idle();
    assert.deepStrictEqual(seen, [{ ok: true, status: 200 }]);
  });

  await test("a dropped payload is reported as dropped, not silently lost", async () => {
    const seen = [];
    const held = gate();
    const q = createUploadQueue({
      maxPending: 1,
      upload: async () => { await held.promise; return { ok: true }; },
      onResult: (r) => seen.push(r),
    });
    q.push({ n: 1 }, "t");
    q.push({ n: 2 }, "t");
    q.push({ n: 3 }, "t");
    assert.deepStrictEqual(seen, [{ ok: false, reason: "dropped" }]);
    held.release();
    await q.idle();
  });

  console.log("\n=== idle ===");

  await test("idle() on an empty queue resolves immediately", async () => {
    const q = createUploadQueue({ upload: async () => ({ ok: true }) });
    await q.idle();
    assert.strictEqual(q.pending, 0);
  });

  await test("idle() waits for work queued while it is already waiting", async () => {
    let finished = 0;
    const q = createUploadQueue({
      upload: async () => { await new Promise((r) => setTimeout(r, 2)); finished++; return { ok: true }; },
    });
    q.push({ n: 1 }, "t");
    const waiting = q.idle();
    q.push({ n: 2 }, "t");
    await waiting;
    assert.strictEqual(finished, 2);
  });

  await test("the queue retains nothing once it is idle", async () => {
    const q = createUploadQueue({ upload: async () => ({ ok: true }) });
    for (let n = 0; n < 50; n++) q.push({ n }, "t");
    await q.idle();
    assert.strictEqual(q.pending, 0);
    assert.strictEqual(q.active, 0);
  });

  console.log(`\n--- ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
})();
