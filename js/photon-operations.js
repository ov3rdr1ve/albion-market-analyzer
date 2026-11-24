/**
 * Which OPERATION a decoded Photon message belongs to.
 *
 * Shared because two readers depend on the answer and used to disagree about
 * it: the market reader gated everything on the operation code, while the roads
 * reader gated nothing and took any response carrying a cluster-shaped string
 * as the player's position. That is how a Brecilien → Lymhurst trip ended up
 * reported as "Willowshade Icemarsh" (cluster 0320) — some unrelated response
 * held "0320" in parameter 0 and was read as an arrival.
 *
 * Two numbering systems meet here, which is the usual source of confusion:
 *   - `parameters[253]` is Albion's own operation code, and is the truth,
 *   - `message.code` is Photon's header byte, used only when 253 is absent —
 *     which is exactly the case for responses whose payload sits in the
 *     debug-message slot (market order lists).
 * EVENTS are excluded from that fallback: their codes are a separate numbering
 * that would collide (an event's code lives in `parameters[252]`).
 */

const EMPTY_OPS = new Set();

/** Join. Verified live: the response carries the cluster in parameter 8/66. */
const OP_JOIN = 2;

/**
 * The operation code, corrected for the byte-order artefact the reference
 * client also guards against (81 arriving as 0x5100 after a client update).
 *
 * @param {object} message  decoded {kind, code, parameters}
 * @param {Set<number>} [knownOps]  codes the caller recognises. Only used to
 *   decide whether a byte-swap repair applies — an unknown code is returned as
 *   it arrived, never rewritten.
 * @returns {number|null}
 */
function readOperationCode(message, knownOps = EMPTY_OPS) {
  if (!message || !message.parameters) return null;
  let raw = message.parameters[253];
  if (raw === undefined && message.kind && message.kind !== "event") raw = message.code;
  const code = typeof raw === "string" ? parseInt(raw, 10) : raw;
  if (!Number.isFinite(code)) return null;
  if (knownOps.has(code)) return code;
  const swapped = ((code & 0xff) << 8) | (code >> 8);
  if (knownOps.has(swapped)) return swapped;
  if (code > 0xff && (code & 0xff) === 0 && knownOps.has(code >> 8)) return code >> 8;
  return code;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readOperationCode, OP_JOIN };
}
