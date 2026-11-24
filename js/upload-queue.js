/**
 * Bounded, serial queue for AODP uploads.
 *
 * Every captured market response is its own upload, and every upload costs one
 * proof-of-work solve: benched at 0.34M sha256 attempts/s on a desktop CPU,
 * that is 0.2–2 s of a core each, and `maxAttempts` makes an unsolvable
 * challenge cost 14.6 s. One market sweep emits hundreds of responses.
 *
 * Fired off unqueued, that had two costs. The solver is a single worker thread
 * (js/aodp-pow-async.js), so the work serialised anyway — but invisibly, with
 * the thread still hashing minutes after the game was closed. And every
 * in-flight promise was retained for the life of the session, so the payloads
 * were never collected either.
 *
 * Queuing makes the backlog a number that can be bounded. When it overflows the
 * OLDEST waiting payload is dropped: market data ages, so the upload worth
 * losing is always the stale one, and dropping it is strictly better for AODP
 * than uploading a price from ten minutes ago.
 *
 * Node only (Electron main process). The upload function is injected.
 */

const DEFAULT_MAX_PENDING = 32;
const DEFAULT_CONCURRENCY = 1;

/**
 * @param {object} options
 * @param {(payload:object, topic:string) => Promise<object>} options.upload
 * @param {number} [options.maxPending]   payloads allowed to wait; oldest is dropped past this
 * @param {number} [options.concurrency]  uploads in flight at once
 * @param {(result:object) => void} [options.onResult]  per-upload outcome, dropped ones included
 */
function createUploadQueue({
  upload,
  maxPending = DEFAULT_MAX_PENDING,
  concurrency = DEFAULT_CONCURRENCY,
  onResult = () => {},
} = {}) {
  const waiting = [];
  const stats = { done: 0, failed: 0, dropped: 0 };
  let active = 0;
  let idleWaiters = [];

  function report(result) {
    try { onResult(result); } catch (e) { /* a listener must not break the queue */ }
  }

  function settleIdle() {
    if (active > 0 || waiting.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  function pump() {
    while (active < concurrency && waiting.length > 0) {
      const job = waiting.shift();
      active++;
      Promise.resolve()
        .then(() => upload(job.payload, job.topic))
        .then((result) => {
          if (result && result.ok) stats.done++;
          else stats.failed++;
          report(result || { ok: false, reason: "empty" });
        })
        .catch((e) => {
          stats.failed++;
          report({ ok: false, reason: "threw", message: e && e.message });
        })
        .then(() => {
          active--;
          // Nothing of the job survives this turn — the payload is a captured
          // order list, and holding them was the leak.
          pump();
          settleIdle();
        });
    }
  }

  /** Queue one payload. Returns false if it was dropped to stay under the bound. */
  function push(payload, topic) {
    waiting.push({ payload, topic });
    let accepted = true;
    while (waiting.length > maxPending) {
      waiting.shift();
      stats.dropped++;
      accepted = false;
      report({ ok: false, reason: "dropped" });
    }
    pump();
    return accepted;
  }

  /** Resolves once nothing is queued or in flight — including work added while waiting. */
  function idle() {
    if (active === 0 && waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => { idleWaiters.push(resolve); });
  }

  return {
    push,
    idle,
    stats,
    get pending() { return waiting.length; },
    get active() { return active; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createUploadQueue, DEFAULT_MAX_PENDING, DEFAULT_CONCURRENCY };
}
