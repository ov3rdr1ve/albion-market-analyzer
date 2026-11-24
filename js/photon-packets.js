/**
 * Photon packet/command layer: UDP payload → decoded events.
 *
 * Wire layout, verified against the live client 2026-07-25:
 *
 *   packet header (12B, BIG-endian): peerId(2) flags(1) commandCount(1)
 *                                    timestamp(4) challenge(4)
 *   command header (12B, BIG-endian): type(1) channel(1) flags(1) reserved(1)
 *                                     length(4) sequence(4)
 *     type 6  SendReliable    — body follows the header
 *     type 7  SendUnreliable  — 4 extra bytes (unreliable sequence) first
 *     type 8  SendFragment    — 20-byte fragment header, reassembled here
 *   message body: magic 0xF3, messageType(1), then Protocol18 payload
 *     messageType 4 = event; > 128 means encrypted, which we skip
 *
 * Fragments matter: the interesting Roads events (zone joins, exit lists) are
 * larger than one datagram, so a parser without reassembly — like the npm
 * photon-packet-parser — simply never sees them.
 */

const { decodeEventData, decodeOperationRequest, decodeOperationResponse } = (typeof require !== "undefined")
  ? require("./photon-protocol18.js")
  : {
    decodeEventData: globalThis.decodeEventData,
    decodeOperationRequest: globalThis.decodeOperationRequest,
    decodeOperationResponse: globalThis.decodeOperationResponse,
  };

const PACKET_HEADER_BYTES = 12;
const COMMAND_HEADER_BYTES = 12;
const FRAGMENT_HEADER_BYTES = 20;
const MESSAGE_MAGIC = 0xf3;

const COMMAND_SEND_RELIABLE = 6;
const COMMAND_SEND_UNRELIABLE = 7;
const COMMAND_SEND_FRAGMENT = 8;

const MESSAGE_OPERATION_REQUEST = 2;
const MESSAGE_OPERATION_RESPONSE = 3;
const MESSAGE_EVENT = 4;
const MESSAGE_INTERNAL_REQUEST = 6;
const MESSAGE_INTERNAL_RESPONSE = 7;

const MAX_FRAGMENT_BYTES = 10 * 1024 * 1024;
const FRAGMENT_TTL_MS = 30000;

/**
 * @param {(event:{code:number, parameters:object}) => void} onEvent
 * @param {object} [options]
 * @param {(info:{messageType:number, bytes:number}) => void} [options.onEncrypted]
 *   Called for each unreadable body. Only the probe uses it — knowing WHEN
 *   encrypted traffic arrives is the difference between "the game does not send
 *   this" and "the game sends it where we cannot read it".
 */
function createPhotonParser(onEvent, { onEncrypted = null } = {}) {
  /** @type {Map<number, {total:number, received:number, buffer:Buffer, at:number}>} */
  const pending = new Map();
  const stats = {
    packets: 0, commands: 0, events: 0, requests: 0, responses: 0,
    // fragments = PIECES seen, reassembled = whole MESSAGES rebuilt from them,
    // abandoned = messages given up on. Never read the first two as a ratio.
    fragments: 0, reassembled: 0, abandoned: 0, malformed: 0, encrypted: 0,
    byMessageType: {},
  };

  function emitMessage(body) {
    if (body.length < 2) return;
    // Byte 0 is a signal byte, and 0xF3 is only its usual value — the reference
    // client skips it without looking. Requiring it here discarded every
    // message carrying anything else, and a discarded message is
    // indistinguishable from traffic the game never sent.
    const messageType = body.readUInt8(1);
    stats.byMessageType[messageType] = (stats.byMessageType[messageType] || 0) + 1;
    // > 128 marks an encrypted body (128 + the real type). Albion encrypts a
    // slice of its traffic; those are unreadable by design, not a decode bug.
    if (messageType > 128) {
      stats.encrypted++;
      if (onEncrypted) onEncrypted({ messageType, bytes: body.length });
      return;
    }
    const payload = body.subarray(2);

    switch (messageType) {
      case MESSAGE_EVENT: {
        stats.events++;
        onEvent({ kind: "event", ...decodeEventData(payload) });
        break;
      }
      case MESSAGE_OPERATION_REQUEST:
      case MESSAGE_INTERNAL_REQUEST: {
        stats.requests++;
        onEvent({ kind: "request", ...decodeOperationRequest(payload) });
        break;
      }
      // The zone you are standing in comes back on the Join RESPONSE — the
      // Join event itself is an empty envelope — so responses are not optional.
      case MESSAGE_OPERATION_RESPONSE:
      case MESSAGE_INTERNAL_RESPONSE: {
        stats.responses++;
        onEvent({ kind: "response", ...decodeOperationResponse(payload) });
        break;
      }
      default:
        break;
    }
  }

  /**
   * Give up on partial messages whose remaining slices never arrived, and COUNT
   * them. This is the only figure that means a message was lost on the way in.
   * Comparing `reassembled` against `fragments` does not: one counts whole
   * messages and the other counts pieces, so a healthy capture reassembling
   * five-piece order lists reads as "13 of 71" and looks like catastrophe.
   */
  function dropStaleFragments(now) {
    for (const [key, entry] of pending) {
      if (now - entry.at > FRAGMENT_TTL_MS) {
        pending.delete(key);
        stats.abandoned++;
      }
    }
  }

  function handleFragment(body, now) {
    if (body.length < FRAGMENT_HEADER_BYTES) return;
    stats.fragments++;
    const startSequence = body.readInt32BE(0);
    const totalLength = body.readInt32BE(12);
    const fragmentOffset = body.readUInt32BE(16);
    const payload = body.subarray(FRAGMENT_HEADER_BYTES);

    if (totalLength <= 0 || totalLength > MAX_FRAGMENT_BYTES) return;
    if (fragmentOffset + payload.length > totalLength) return;

    let entry = pending.get(startSequence);
    if (!entry) {
      entry = {
        total: totalLength, received: 0, seen: new Set(),
        buffer: Buffer.alloc(totalLength), at: now,
      };
      pending.set(startSequence, entry);
    }
    payload.copy(entry.buffer, fragmentOffset);
    entry.at = now;
    // Count each OFFSET once. Photon retransmits a fragment whose ack was lost,
    // and summing bytes let the duplicate push the total over the line while a
    // slice was still missing — the message was emitted with a hole in it. The
    // biggest messages the game sends are market order lists, so that is what
    // it quietly destroyed.
    if (!entry.seen.has(fragmentOffset)) {
      entry.seen.add(fragmentOffset);
      entry.received += payload.length;
    }

    if (entry.received >= entry.total) {
      pending.delete(startSequence);
      stats.reassembled++;
      emitMessage(entry.buffer);
    }
    dropStaleFragments(now);
  }

  /** Feed one UDP payload. */
  function handle(payload, now = Date.now()) {
    if (!Buffer.isBuffer(payload) || payload.length < PACKET_HEADER_BYTES) return;
    stats.packets++;

    // Flag 1 marks the whole packet encrypted: everything behind the header is
    // ciphertext, so walking it invents command lengths and files the result
    // under "malformed". Counting it as what it is keeps the one number that
    // says "unreadable by design" honest.
    if (payload.readUInt8(2) === 1) { stats.encrypted++; return; }

    const commandCount = payload.readUInt8(3);
    let offset = PACKET_HEADER_BYTES;

    for (let i = 0; i < commandCount; i++) {
      if (offset + COMMAND_HEADER_BYTES > payload.length) { stats.malformed++; return; }
      const commandType = payload.readUInt8(offset);
      const commandLength = payload.readUInt32BE(offset + 4);
      if (commandLength < COMMAND_HEADER_BYTES || offset + commandLength > payload.length) {
        stats.malformed++;
        return;
      }
      stats.commands++;

      let bodyStart = offset + COMMAND_HEADER_BYTES;
      if (commandType === COMMAND_SEND_UNRELIABLE) bodyStart += 4;
      const body = payload.subarray(bodyStart, offset + commandLength);

      if (commandType === COMMAND_SEND_RELIABLE || commandType === COMMAND_SEND_UNRELIABLE) {
        emitMessage(body);
      } else if (commandType === COMMAND_SEND_FRAGMENT) {
        handleFragment(body, now);
      }
      offset += commandLength;
    }
  }

  return {
    handle,
    stats,
    get pendingFragments() { return pending.size; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPhotonParser,
    PACKET_HEADER_BYTES,
    COMMAND_HEADER_BYTES,
    FRAGMENT_HEADER_BYTES,
    MESSAGE_MAGIC,
    COMMAND_SEND_RELIABLE,
    COMMAND_SEND_UNRELIABLE,
    COMMAND_SEND_FRAGMENT,
  };
}
