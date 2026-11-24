/**
 * Tests for the Photon Protocol18 deserializer.
 *
 * Albion serialises message payloads with Protocol18, not Protocol16 — the npm
 * photon-packet-parser assumes 16 and produces "Type code: 164 not implemented"
 * on every real frame. These cases pin the 18 encodings that differ:
 *   - little-endian scalars (16 is big-endian),
 *   - base-128 varints with ZigZag for signed ints/longs,
 *   - a one-byte parameter-table count (16 uses a short),
 *   - "zero" and "slim custom type" codes with no payload at all.
 *
 * Buffers are built inline; the two REAL frames captured from the live client
 * on 2026-07-25 are pinned at the bottom. No capture device, no network.
 *
 * Run: node tests/photon-protocol18.test.cjs
 */

const assert = require("assert");
const { PhotonReader, zigzag32, zigzag64 } = require("../js/photon-reader.js");
const { P18, deserialize, readParameterTable, decodeEventData } = require("../js/photon-protocol18.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const hex = (s) => Buffer.from(s.replace(/\s+/g, ""), "hex");
const read = (bytes, typeCode) => deserialize(new PhotonReader(hex(bytes)), typeCode);

// ── varint + zigzag ────────────────────────────────────────────────────────
const VARINT_CASES = [
  ["00", 0],
  ["01", 1],
  ["7f", 127],
  ["8001", 128],
  ["ffff03", 65535],
  ["be890f", 246974], // from a real Move event
];
VARINT_CASES.forEach(([bytes, want]) => {
  test(`varint32(${bytes}) = ${want}`, () => {
    assert.strictEqual(new PhotonReader(hex(bytes)).readVarint32(), want);
  });
});

const ZIGZAG_CASES = [[0, 0], [1, -1], [2, 1], [3, -2], [4294967294, 2147483647]];
ZIGZAG_CASES.forEach(([input, want]) => {
  test(`zigzag32(${input}) = ${want}`, () => {
    assert.strictEqual(zigzag32(input), want);
  });
});

test("zigzag64 keeps 64-bit precision", () => {
  assert.strictEqual(zigzag64(2n), 1n);
  assert.strictEqual(zigzag64(1n), -1n);
  assert.strictEqual(zigzag64(18446744073709551614n), 9223372036854775807n);
});

// ── scalars ────────────────────────────────────────────────────────────────
const SCALAR_CASES = [
  ["boolean true", "01", P18.BOOLEAN, true],
  ["boolean false", "00", P18.BOOLEAN, false],
  ["boolean-true code", "", P18.BOOLEAN_TRUE, true],
  ["boolean-false code", "", P18.BOOLEAN_FALSE, false],
  ["byte", "2a", P18.BYTE, 42],
  ["byte zero code", "", P18.BYTE_ZERO, 0],
  ["short little-endian", "e803", P18.SHORT, 1000],
  ["negative short", "18fc", P18.SHORT, -1000],
  ["short zero code", "", P18.SHORT_ZERO, 0],
  ["int1", "07", P18.INT1, 7],
  ["int1 negative", "07", P18.INT1_NEGATIVE, -7],
  ["int2 little-endian", "e803", P18.INT2, 1000],
  ["int2 negative", "e803", P18.INT2_NEGATIVE, -1000],
  ["int zero code", "", P18.INT_ZERO, 0],
  ["compressed int", "04", P18.COMPRESSED_INT, 2],
  ["compressed int negative", "03", P18.COMPRESSED_INT, -2],
  ["float", "0000803f", P18.FLOAT, 1],
  ["float zero code", "", P18.FLOAT_ZERO, 0],
  ["double", "000000000000f03f", P18.DOUBLE, 1],
  ["null", "", P18.NULL, null],
  ["unknown", "", P18.UNKNOWN, null],
];
SCALAR_CASES.forEach(([name, bytes, typeCode, want]) => {
  test(`deserialize ${name}`, () => {
    assert.strictEqual(read(bytes, typeCode), want);
  });
});

const BIGINT_CASES = [
  ["long1", "05", P18.LONG1, 5n],
  ["long1 negative", "05", P18.LONG1_NEGATIVE, -5n],
  ["long2", "e803", P18.LONG2, 1000n],
  ["long zero code", "", P18.LONG_ZERO, 0n],
  ["compressed long", "04", P18.COMPRESSED_LONG, 2n],
];
BIGINT_CASES.forEach(([name, bytes, typeCode, want]) => {
  test(`deserialize ${name}`, () => {
    assert.strictEqual(read(bytes, typeCode), want);
  });
});

// ── strings ────────────────────────────────────────────────────────────────
test("string reads a varint length then utf8 bytes", () => {
  assert.strictEqual(read("0b" + Buffer.from("Cases-Ugum").toString("hex") + "6c", P18.STRING), "Cases-Uguml");
});

test("empty string is length 0", () => {
  assert.strictEqual(read("00", P18.STRING), "");
});

test("a string claiming more bytes than remain yields empty, not a throw", () => {
  assert.strictEqual(read("ff01" + "41", P18.STRING), "");
});

// ── arrays and tables ──────────────────────────────────────────────────────
test("byte array", () => {
  assert.deepStrictEqual([...read("03010203", P18.BYTE_ARRAY)], [1, 2, 3]);
});

test("short array is little-endian", () => {
  assert.deepStrictEqual(read("02" + "0100" + "0200", P18.SHORT_ARRAY), [1, 2]);
});

test("float array", () => {
  assert.deepStrictEqual(read("02" + "0000803f" + "00000040", P18.FLOAT_ARRAY), [1, 2]);
});

test("string array", () => {
  const bytes = "02" + "02" + Buffer.from("ab").toString("hex") + "03" + Buffer.from("cde").toString("hex");
  assert.deepStrictEqual(read(bytes, P18.STRING_ARRAY), ["ab", "cde"]);
});

test("compressed int array applies zigzag per element", () => {
  assert.deepStrictEqual(read("03" + "00" + "01" + "04", P18.COMPRESSED_INT_ARRAY), [0, -1, 2]);
});

test("boolean array unpacks bit by bit", () => {
  assert.deepStrictEqual(read("03" + "05", P18.BOOLEAN_ARRAY), [true, false, true]);
});

test("object array reads a type code per element", () => {
  const bytes = "02" + "03" + "2a" + "1c"; // byte 42, then boolean-true code
  assert.deepStrictEqual(read(bytes, P18.OBJECT_ARRAY), [42, true]);
});

test("dictionary with fixed key/value types", () => {
  const bytes = "03" + "03" + "02" + "01" + "0a" + "02" + "14";
  const dict = read(bytes, P18.DICTIONARY);
  assert.strictEqual(dict.get(1), 10);
  assert.strictEqual(dict.get(2), 20);
});

test("hashtable reads a type code for every key and value", () => {
  const bytes = "01" + "03" + "07" + "03" + "2a"; // {byte 7: byte 42}
  const table = read(bytes, P18.HASHTABLE);
  assert.strictEqual(table.get(7), 42);
});

test("slim custom types carry their code and raw bytes", () => {
  const value = read("03" + "aabbcc", P18.CUSTOM_TYPE_SLIM + 5);
  assert.strictEqual(value.customTypeCode, 5);
  assert.deepStrictEqual([...value.data], [0xaa, 0xbb, 0xcc]);
});

test("unknown type codes yield null rather than throwing", () => {
  assert.strictEqual(read("ffff", 99), null);
});

// ── parameter tables ───────────────────────────────────────────────────────
test("parameter table: one-byte count, then key/type/value triples", () => {
  const bytes = hex("02" + "00" + "03" + "07" + "01" + "1c");
  assert.deepStrictEqual(readParameterTable(new PhotonReader(bytes)), { 0: 7, 1: true });
});

test("an empty parameter table decodes to an empty object", () => {
  assert.deepStrictEqual(readParameterTable(new PhotonReader(hex("00"))), {});
});

test("a truncated parameter table returns what it managed to read", () => {
  const bytes = hex("03" + "00" + "03" + "07" + "01");
  assert.deepStrictEqual(readParameterTable(new PhotonReader(bytes)), { 0: 7 });
});

// ── real captured frames (live client, 2026-07-25) ─────────────────────────
// Message bodies straight off the wire, minus the 0xF3 magic and message type.

test("real Move event (code 3) decodes to its exact bounds", () => {
  // 42-byte body: code, 2 params, {0: compressedLong, 1: byteArray[30]} —
  // the byte array runs to the last byte of the frame.
  const body = hex(
    "03" + "02" + "000abe890f" +
    "01431e" + "0350c8ec576eeade080da3504355711b42de00004040d73c50436ce51c42",
  );
  const { code, parameters } = decodeEventData(body);
  assert.strictEqual(code, 3);
  assert.deepStrictEqual(Object.keys(parameters), ["0", "1"]);
  assert.strictEqual(parameters[0], zigzag64(246974n));
  assert.strictEqual(parameters[1].length, 30);
});

test("real code-1 event decodes all three parameters, including key 252", () => {
  // {0: compressedInt, 1: compressedInt, 252: short} — 252 is Albion's
  // event-code parameter slot, present on most events.
  const body = hex("01" + "03" + "0009ea99e617" + "0109ed8afac40b" + "fc04a000");
  const { code, parameters } = decodeEventData(body);
  assert.strictEqual(code, 1);
  assert.strictEqual(parameters[0], 24954485);
  assert.strictEqual(parameters[1], -1548698295);
  assert.strictEqual(parameters[252], 160);
});

// ── operation responses ────────────────────────────────────────────────────
// Layout: opCode(1), returnCode(int16 LE), then a typed value where the debug
// message belongs, then the parameter table.
//
// Albion abuses that debug-message slot: a market order list arrives there as a
// typed STRING ARRAY instead of in the parameter table. Reading the slot and
// keeping it only when it is a string — which is what the spec says — silently
// threw every order list away, and the capture looked deaf while the game was
// answering perfectly. The reference client surfaces it as parameter 0, which
// is exactly where the market reader looks.
const { decodeOperationResponse } = require("../js/photon-protocol18.js");

const str = (s) => {
  const body = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from([body.length]), body]).toString("hex");
};

test("a response carrying a string array in the debug slot exposes it as parameter 0", () => {
  const body = hex(`51 0000 47 02 ${str('{"Id":1}')} ${str('{"Id":2}')}`);
  const { code, parameters } = decodeOperationResponse(body);
  assert.strictEqual(code, 0x51);
  assert.deepStrictEqual(parameters[0], ['{"Id":1}', '{"Id":2}']);
});

test("a plain debug message is still just a debug message", () => {
  const body = hex(`02 0000 07 ${str("ok")} 01 08 07 ${str("3005")}`);
  const { debugMessage, parameters } = decodeOperationResponse(body);
  assert.strictEqual(debugMessage, "ok");
  assert.strictEqual(parameters[8], "3005");
});

test("a response with no debug value at all still reads its parameters", () => {
  const body = hex(`02 0000 08 01 08 07 ${str("1002")}`);
  assert.strictEqual(decodeOperationResponse(body).parameters[8], "1002");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
