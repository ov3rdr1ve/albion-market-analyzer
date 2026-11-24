/**
 * The payload batch format between the capture utility process and main.
 *
 * The capture runs in its own process (js/sniffer-host.js) so a native fault
 * in `cap` cannot take the app down, but the Photon parser stays in main:
 * decoded messages hold Buffers and Maps that do not survive structured
 * clone. So raw payloads cross the boundary — and one postMessage per packet
 * would be thousands of IPC hops a second in a market burst. Instead they are
 * packed into ONE byte array plus an offsets list:
 *
 *   { type: "batch", buf: Uint8Array, offsets: [0, end0, end1, ...] }
 *
 * payload i is buf[offsets[i] .. offsets[i + 1]). A batch goes out 15 ms
 * after its first payload, or at once when it reaches 256 KB.
 *
 * No Electron here — both halves are plain functions, tested by
 * tests/sniffer-batch.test.cjs.
 */

const DEFAULT_FLUSH_MS = 15;
const DEFAULT_MAX_BYTES = 256 * 1024;

/**
 * @param {object} options
 * @param {(message:{type:"batch", buf:Uint8Array, offsets:number[]}) => void} options.post
 * @param {number} [options.flushMs]
 * @param {number} [options.maxBytes]
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 * @returns {{push:(buf:Uint8Array) => void, flush:() => void}}
 */
function createBatcher({
  post,
  flushMs = DEFAULT_FLUSH_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let queued = [];
  let bytes = 0;
  let timer = null;

  function flush() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!queued.length) return;
    // A fresh array, never a pool slice: structured clone copies the WHOLE
    // ArrayBuffer behind a view, so a slice of Node's 8 KB pool would ship
    // the pool. Copying also detaches the batch from the capture buffer the
    // sniffer reuses for every frame.
    const buf = new Uint8Array(bytes);
    const offsets = [0];
    let at = 0;
    for (const payload of queued) {
      buf.set(payload, at);
      at += payload.length;
      offsets.push(at);
    }
    queued = [];
    bytes = 0;
    post({ type: "batch", buf, offsets });
  }

  function push(payload) {
    // Ship what is queued first rather than let this payload push the batch
    // past the cap; only a single payload bigger than the cap goes alone.
    if (queued.length && bytes + payload.length > maxBytes) flush();
    queued.push(Uint8Array.from(payload));
    bytes += payload.length;
    if (bytes >= maxBytes) { flush(); return; }
    if (timer === null) {
      timer = setTimer(() => { timer = null; flush(); }, flushMs);
      // A pending flush is never a reason for the process to stay alive.
      if (timer && typeof timer.unref === "function") timer.unref();
    }
  }

  return { push, flush };
}

/**
 * The payloads of one batch, as real Buffers (structured clone delivers a
 * plain Uint8Array). Views, not copies. A malformed batch — offsets missing,
 * out of range or going backwards — is dropped whole rather than thrown: it
 * can only come from a bug, and guessing which slices are still right would
 * feed the parser garbage.
 * @param {{buf:Uint8Array, offsets:number[]}} message
 * @returns {Buffer[]}
 */
function unpackBatch(message) {
  const { buf, offsets } = message || {};
  if (!(buf instanceof Uint8Array) || !Array.isArray(offsets) || offsets.length < 2) return [];
  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i];
    if (!Number.isInteger(o) || o < 0 || o > buf.length) return [];
    if (i > 0 && o < offsets[i - 1]) return [];
  }
  const out = [];
  for (let i = 0; i + 1 < offsets.length; i++) {
    out.push(Buffer.from(buf.buffer, buf.byteOffset + offsets[i], offsets[i + 1] - offsets[i]));
  }
  return out;
}

module.exports = { createBatcher, unpackBatch, DEFAULT_FLUSH_MS, DEFAULT_MAX_BYTES };
