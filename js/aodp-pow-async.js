/**
 * The AODP proof-of-work, solved off the main thread.
 *
 * Measured against the live endpoint the challenge is a 41-bit target and costs
 * 0.2–2 s of sha256. The Electron main process owns the packet capture, the IPC
 * and the window's input, so spending that inline froze the whole app for the
 * length of every upload — and a captured market window is several uploads in a
 * row. Nothing here makes the work cheaper; it just happens somewhere the user
 * is not waiting on.
 *
 * The worker is built from the SOURCE of js/aodp-pow.js rather than by loading
 * that file: a worker started from a path inside an asar archive is a packaging
 * question this does not need to have an opinion on, and the worker ends up
 * depending on node builtins only. Stringifying the real functions keeps one
 * definition of the algorithm — tests verify the worker's answers against the
 * same module the main thread checks with.
 *
 * Node only (Electron main process).
 */

const { randomHex, powChallengeString, powHashHex, powBitPrefix, isPowSolution, solvePow } = require("./aodp-pow.js");

// Idle workers are cheap but not free, and a monitor session can go hours
// between uploads. The thread retires and is rebuilt on the next challenge.
const DEFAULT_IDLE_MS = 60000;

const WORKER_SOURCE = `
const crypto = require("crypto");
const { parentPort } = require("worker_threads");
const randomHex = ${randomHex.toString()};
const powChallengeString = ${powChallengeString.toString()};
const powHashHex = ${powHashHex.toString()};
const powBitPrefix = ${powBitPrefix.toString()};
const isPowSolution = ${isPowSolution.toString()};
const solvePow = ${solvePow.toString()};

parentPort.on("message", (job) => {
  let solution = null;
  try {
    solution = solvePow(job.pow, job.options || {});
  } catch (e) {
    solution = null;
  }
  parentPort.postMessage({ id: job.id, solution });
});
`;

/**
 * @param {object} [options]
 * @param {Function} [options.Worker]   injectable worker_threads.Worker
 * @param {number} [options.idleMs]     how long an unused thread is kept alive
 * @returns {{solve:(pow:object, options?:object) => Promise<string|null>, close:() => void}}
 */
function createPowSolver({ Worker, idleMs = DEFAULT_IDLE_MS } = {}) {
  const WorkerImpl = Worker || require("worker_threads").Worker;
  const pending = new Map();
  let worker = null;
  let idleTimer = null;
  let nextId = 1;

  function clearIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function armIdle() {
    clearIdle();
    if (pending.size) return;
    // Idle: stop the thread holding the process open. While a challenge is in
    // flight it must do the opposite — an unref'd worker is not a reason for
    // node to stay alive, so the process would exit with the answer still
    // being computed and the caller's promise never settled.
    if (worker && typeof worker.unref === "function") worker.unref();
    idleTimer = setTimeout(() => { idleTimer = null; terminate(); }, idleMs);
    // Never hold the process open on this alone.
    if (idleTimer && typeof idleTimer.unref === "function") idleTimer.unref();
  }

  function terminate() {
    if (!worker) return;
    const dying = worker;
    worker = null;
    try { dying.terminate(); } catch (e) { /* already gone */ }
  }

  /** A worker dying mid-solve must not leave callers waiting forever. */
  function failAll() {
    const waiting = [...pending.values()];
    pending.clear();
    waiting.forEach((resolve) => resolve(null));
  }

  function ensureWorker() {
    if (worker) return worker;
    const started = new WorkerImpl(WORKER_SOURCE, { eval: true });
    worker = started;
    started.on("message", ({ id, solution }) => {
      const resolve = pending.get(id);
      if (resolve) { pending.delete(id); resolve(solution === undefined ? null : solution); }
      armIdle();
    });
    // Both handlers check that the thread they belong to is still the current
    // one. A retired worker's `exit` arrives AFTER close(), by which time a new
    // challenge may already be running on a new thread — and the old event
    // then dropped that thread on the floor and answered null for work that
    // was going perfectly well.
    started.on("error", () => { if (worker === started) { terminate(); failAll(); } });
    started.on("exit", () => {
      if (worker !== started) return;
      worker = null;
      failAll();
    });
    return started;
  }

  function solve(pow, options) {
    if (!pow || typeof pow.key !== "string") return Promise.resolve(null);
    clearIdle();
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      try {
        const active = ensureWorker();
        if (typeof active.ref === "function") active.ref();
        active.postMessage({ id, pow, options });
      } catch (e) {
        pending.delete(id);
        terminate();
        resolve(null);
      }
    });
  }

  function close() {
    clearIdle();
    terminate();
    failAll();
  }

  return { solve, close };
}

module.exports = { createPowSolver, WORKER_SOURCE };
