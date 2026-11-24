/**
 * Tests for the Photon packet/command layer.
 *
 * Covers the framing the sniffer depends on:
 *   - big-endian packet + command headers (values inside are little-endian),
 *   - reliable (6) vs unreliable (7, four extra sequence bytes) bodies,
 *   - fragment (8) reassembly across datagrams, out of order and with a TTL,
 *   - the 0xF3 magic, event message type 4, and skipping encrypted (>128),
 *   - truncated/garbage frames counting as malformed instead of throwing.
 *
 * Packets are assembled by the helpers below — nothing is captured live.
 *
 * Run: node tests/photon-packets.test.cjs
 */

const assert = require("assert");
const {
  createPhotonParser,
  COMMAND_SEND_RELIABLE,
  COMMAND_SEND_UNRELIABLE,
  COMMAND_SEND_FRAGMENT,
  MESSAGE_MAGIC,
} = require("../js/photon-packets.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** Message body: magic, message type, event code, then a 1-param table. */
function eventBody(code, { messageType = 4, paramKey = 0, paramValue = 7 } = {}) {
  return Buffer.concat([
    Buffer.from([MESSAGE_MAGIC, messageType, code]),
    Buffer.from([1, paramKey, 3, paramValue]), // count 1, key, type BYTE, value
  ]);
}

function command(type, body, { sequence = 1 } = {}) {
  const extra = type === COMMAND_SEND_UNRELIABLE ? 4 : 0;
  const header = Buffer.alloc(12 + extra);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(12 + extra + body.length, 4);
  header.writeUInt32BE(sequence, 8);
  return Buffer.concat([header, body]);
}

function packet(commands) {
  const header = Buffer.alloc(12);
  header.writeUInt8(commands.length, 3);
  return Buffer.concat([header, ...commands]);
}

/** Fragment command body: 20-byte header, then this fragment's slice. */
function fragment(startSequence, totalLength, offset, slice) {
  const header = Buffer.alloc(20);
  header.writeInt32BE(startSequence, 0);
  header.writeInt32BE(2, 4);  // fragmentCount (ignored by the parser)
  header.writeInt32BE(0, 8);  // fragmentNumber (ignored)
  header.writeInt32BE(totalLength, 12);
  header.writeUInt32BE(offset, 16);
  return Buffer.concat([header, slice]);
}

function collect() {
  const events = [];
  const parser = createPhotonParser((e) => events.push(e));
  return { parser, events };
}

// ── reliable / unreliable ──────────────────────────────────────────────────
test("a reliable event command emits one decoded event", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(42))]));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].code, 42);
  assert.deepStrictEqual(events[0].parameters, { 0: 7 });
});

test("an unreliable command skips its four sequence bytes", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_UNRELIABLE, eventBody(3))]));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].code, 3);
});

test("multiple commands in one packet all decode", () => {
  const { parser, events } = collect();
  parser.handle(packet([
    command(COMMAND_SEND_RELIABLE, eventBody(1)),
    command(COMMAND_SEND_UNRELIABLE, eventBody(2)),
    command(COMMAND_SEND_RELIABLE, eventBody(3)),
  ]));
  assert.deepStrictEqual(events.map((e) => e.code), [1, 2, 3]);
});

test("events are tagged with their kind", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(42))]));
  assert.strictEqual(events[0].kind, "event");
});

test("operation requests are decoded, not dropped", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(9, { messageType: 2 }))]));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].kind, "request");
  assert.strictEqual(events[0].code, 9);
  assert.deepStrictEqual(events[0].parameters, { 0: 7 });
});

test("operation responses carry returnCode, debug message and params", () => {
  // code(1), returnCode int16 LE, typed debug string, then the param table.
  const body = Buffer.concat([
    Buffer.from([MESSAGE_MAGIC, 3, 2]),          // magic, response, opCode 2 (Join)
    Buffer.from([0x00, 0x00]),                   // returnCode 0
    Buffer.from([7, 2]), Buffer.from("ok"),      // debug: STRING "ok"
    Buffer.from([1, 0, 3, 7]),                   // params {0: byte 7}
  ]);
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, body)]));
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(
    { kind: events[0].kind, code: events[0].code, returnCode: events[0].returnCode, debugMessage: events[0].debugMessage },
    { kind: "response", code: 2, returnCode: 0, debugMessage: "ok" },
  );
  assert.deepStrictEqual(events[0].parameters, { 0: 7 });
});

test("unknown message types are still ignored", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(9, { messageType: 9 }))]));
  assert.strictEqual(events.length, 0);
});

test("encrypted messages (type > 128) are skipped", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(9, { messageType: 200 }))]));
  assert.strictEqual(events.length, 0);
});

// The signal byte is not a gate — see "a message with a different signal byte
// is still decoded". Only the message TYPE decides, so a zero signal byte on an
// otherwise valid event is decoded like any other.
test("a zero signal byte does not disqualify a valid message", () => {
  const { parser, events } = collect();
  const body = eventBody(5);
  body.writeUInt8(0x00, 0);
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, body)]));
  assert.deepStrictEqual(events.map((e) => e.code), [5]);
});

test("ack/ping command types are stepped over, not decoded", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(1, eventBody(7)), command(COMMAND_SEND_RELIABLE, eventBody(8))]));
  assert.deepStrictEqual(events.map((e) => e.code), [8]);
});

// ── the signal byte ────────────────────────────────────────────────────────
// The first byte of a message body is a signal byte, and 0xF3 is only its most
// common value. Requiring it threw away every message that carried anything
// else — a filter the reference client does not apply, and one whose losses are
// invisible because a discarded message looks exactly like traffic that was
// never sent.
test("a message with a different signal byte is still decoded", () => {
  const { parser, events } = collect();
  const body = eventBody(42);
  body.writeUInt8(0xf4, 0);
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, body)]));
  assert.deepStrictEqual(events.map((e) => e.code), [42]);
});

test("the message type still decides what is decoded", () => {
  const { parser, events } = collect();
  const body = eventBody(9, { messageType: 3 }); // operation response
  body.writeUInt8(0xf4, 0);
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, body)]));
  assert.deepStrictEqual(events.map((e) => e.kind), ["response"]);
});

// ── encrypted packets ──────────────────────────────────────────────────────
// A packet whose header flag is 1 is encrypted whole: the command bytes behind
// it are ciphertext. Walking it anyway produced nonsense command lengths and,
// worse, buried the fact in the malformed counter — the one number that would
// have said "this traffic is unreadable by design, stop looking for a decoder
// bug".
test("an encrypted packet is counted, not walked", () => {
  const { parser, events } = collect();
  const p = packet([command(COMMAND_SEND_RELIABLE, eventBody(5))]);
  p.writeUInt8(1, 2); // header flags
  parser.handle(p);
  assert.strictEqual(events.length, 0);
  assert.strictEqual(parser.stats.encrypted, 1);
  assert.strictEqual(parser.stats.malformed, 0);
});

test("an ordinary packet is unaffected by the flag check", () => {
  const { parser, events } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(5))]));
  assert.deepStrictEqual(events.map((e) => e.code), [5]);
  assert.strictEqual(parser.stats.encrypted, 0);
});

// ── fragments ──────────────────────────────────────────────────────────────
test("a message split across two fragments is reassembled", () => {
  const { parser, events } = collect();
  const body = eventBody(77);
  const half = Math.ceil(body.length / 2);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(100, body.length, 0, body.subarray(0, half)))]));
  assert.strictEqual(events.length, 0, "not emitted until complete");
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(100, body.length, half, body.subarray(half)))]));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].code, 77);
});

test("fragments arriving out of order still reassemble", () => {
  const { parser, events } = collect();
  const body = eventBody(88);
  const half = Math.ceil(body.length / 2);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(7, body.length, half, body.subarray(half)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(7, body.length, 0, body.subarray(0, half)))]));
  assert.deepStrictEqual(events.map((e) => e.code), [88]);
});

test("two interleaved fragmented messages stay separate", () => {
  const { parser, events } = collect();
  const a = eventBody(11), b = eventBody(22);
  const halfA = Math.ceil(a.length / 2), halfB = Math.ceil(b.length / 2);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(1, a.length, 0, a.subarray(0, halfA)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(2, b.length, 0, b.subarray(0, halfB)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(2, b.length, halfB, b.subarray(halfB)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(1, a.length, halfA, a.subarray(halfA)))]));
  assert.deepStrictEqual(events.map((e) => e.code), [22, 11]);
});

// Photon retransmits a fragment whose ack was lost, so the same slice arrives
// twice on a busy connection. Counting BYTES received made the duplicate finish
// the message early, and what was emitted had a hole where the missing slice
// belonged — a corrupt body, silently discarded downstream. Market order lists
// are the biggest thing the game sends, so they are what this loses.
test("a retransmitted fragment does not complete the message early", () => {
  const { parser, events } = collect();
  const body = eventBody(66);
  const third = Math.ceil(body.length / 3);
  const slice = (from, to) => body.subarray(from, to);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(9, body.length, 0, slice(0, third)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(9, body.length, third, slice(third, 2 * third)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(9, body.length, third, slice(third, 2 * third)))]));
  assert.strictEqual(events.length, 0, "still missing the last slice");
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(9, body.length, 2 * third, slice(2 * third)))]));
  assert.deepStrictEqual(events.map((e) => e.code), [66]);
});

// A partial message whose remaining slices never arrive is the ONLY counter
// that means "a message was lost on the way in". It used to be deleted in
// silence, and the UI implied loss from `reassembled` sitting far below
// `fragments` — a count of MESSAGES against a count of PIECES, which is low on
// every healthy capture and cries loss where there is none.
test("a partial message abandoned by the TTL is counted, not dropped in silence", () => {
  const { parser, events } = collect();
  const body = eventBody(55);
  const half = Math.ceil(body.length / 2);
  const t0 = 1_800_000_000_000;
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(3, body.length, 0, body.subarray(0, half)))]), t0);
  assert.strictEqual(parser.stats.abandoned, 0, "still inside the window");
  // Any later fragment sweeps whatever has gone stale.
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(4, body.length, 0, body.subarray(0, half)))]), t0 + 31000);
  assert.strictEqual(parser.stats.abandoned, 1);
  assert.strictEqual(events.length, 0, "an incomplete message is never emitted");
});

test("a message completed inside the window is never counted as abandoned", () => {
  const { parser, events } = collect();
  const body = eventBody(56);
  const half = Math.ceil(body.length / 2);
  const t0 = 1_800_000_000_000;
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(5, body.length, 0, body.subarray(0, half)))]), t0);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(5, body.length, half, body.subarray(half)))]), t0 + 29000);
  assert.strictEqual(parser.stats.abandoned, 0);
  assert.strictEqual(parser.stats.reassembled, 1);
  assert.deepStrictEqual(events.map((e) => e.code), [56]);
});

test("a duplicate of the LAST fragment does not emit the message twice", () => {
  const { parser, events } = collect();
  const body = eventBody(55);
  const half = Math.ceil(body.length / 2);
  const last = () => packet([command(COMMAND_SEND_FRAGMENT, fragment(3, body.length, half, body.subarray(half)))]);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(3, body.length, 0, body.subarray(0, half)))]));
  parser.handle(last());
  parser.handle(last());
  assert.deepStrictEqual(events.map((e) => e.code), [55]);
});

test("an incomplete fragment set is dropped after the TTL", () => {
  const { parser, events } = collect();
  const body = eventBody(99);
  const half = Math.ceil(body.length / 2);
  const t0 = 1_800_000_000_000;
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(5, body.length, 0, body.subarray(0, half)))]), t0);
  assert.strictEqual(parser.pendingFragments, 1);
  // A later fragment for a different message triggers the sweep.
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(6, 999, 0, Buffer.alloc(4)))]), t0 + 31000);
  assert.strictEqual(parser.pendingFragments, 1); // only the fresh one survives
  assert.strictEqual(events.length, 0);
});

test("a fragment claiming an absurd total length is rejected", () => {
  const { parser } = collect();
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(1, 50 * 1024 * 1024, 0, Buffer.alloc(8)))]));
  assert.strictEqual(parser.pendingFragments, 0);
});

test("a fragment whose slice overruns the total is rejected", () => {
  const { parser } = collect();
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(1, 10, 8, Buffer.alloc(8)))]));
  assert.strictEqual(parser.pendingFragments, 0);
});

// ── malformed input ────────────────────────────────────────────────────────
const JUNK_CASES = [
  ["an empty buffer", Buffer.alloc(0)],
  ["a runt shorter than the packet header", Buffer.alloc(6)],
  ["a header promising commands that are not there", packet([]).subarray(0, 12)],
  ["random bytes", Buffer.from("deadbeefcafebabe0102030405060708", "hex")],
];
JUNK_CASES.forEach(([name, buffer]) => {
  test(`${name} decodes to nothing without throwing`, () => {
    const { parser, events } = collect();
    if (buffer.length >= 4) buffer.writeUInt8(3, 3); // claim 3 commands
    parser.handle(buffer);
    assert.strictEqual(events.length, 0);
  });
});

test("a command length inside the header but past the buffer is malformed", () => {
  const { parser, events } = collect();
  const good = packet([command(COMMAND_SEND_RELIABLE, eventBody(1))]);
  parser.handle(good.subarray(0, good.length - 4));
  assert.strictEqual(events.length, 0);
  assert.strictEqual(parser.stats.malformed, 1);
});

test("a non-Buffer input is ignored", () => {
  const { parser, events } = collect();
  parser.handle("not a buffer");
  parser.handle(null);
  assert.strictEqual(events.length, 0);
});

// ── stats ──────────────────────────────────────────────────────────────────
test("stats count packets, commands and events", () => {
  const { parser } = collect();
  parser.handle(packet([command(COMMAND_SEND_RELIABLE, eventBody(1)), command(COMMAND_SEND_RELIABLE, eventBody(2))]));
  assert.strictEqual(parser.stats.packets, 1);
  assert.strictEqual(parser.stats.commands, 2);
  assert.strictEqual(parser.stats.events, 2);
});

test("stats count fragments and reassemblies", () => {
  const { parser } = collect();
  const body = eventBody(3);
  const half = Math.ceil(body.length / 2);
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(1, body.length, 0, body.subarray(0, half)))]));
  parser.handle(packet([command(COMMAND_SEND_FRAGMENT, fragment(1, body.length, half, body.subarray(half)))]));
  assert.strictEqual(parser.stats.fragments, 2);
  assert.strictEqual(parser.stats.reassembled, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
