/**
 * Photon Protocol18 deserializer.
 *
 * Albion's message payloads are Protocol18, NOT Protocol16 — this is the trap
 * that makes the npm `photon-packet-parser` (Protocol16 only) report garbage
 * "Type code: 164 not implemented" errors on live traffic. The two differ in
 * both the type table (letters vs small ints) and the encodings: Protocol18
 * uses little-endian scalars, base-128 varints, and ZigZag for signed values.
 *
 * Type table + layout verified against the live client on 2026-07-25, e.g. a
 * real 42-byte Move event decoding exactly to its bounds:
 *   f3 04 03 | 02 | 00 0a be890f | 01 43 1e <30 bytes>
 *   magic, event, code 3, 2 params, {0: compressedLong, 1: byteArray[30]}
 *
 * Every reader is bounds-checked (see PhotonReader) so a truncated frame yields
 * a partial value instead of throwing.
 */

const { PhotonReader, zigzag32, zigzag64 } = (typeof require !== "undefined")
  ? require("./photon-reader.js")
  : { PhotonReader: globalThis.PhotonReader, zigzag32: globalThis.zigzag32, zigzag64: globalThis.zigzag64 };

const P18 = {
  UNKNOWN: 0,
  BOOLEAN: 2,
  BYTE: 3,
  SHORT: 4,
  FLOAT: 5,
  DOUBLE: 6,
  STRING: 7,
  NULL: 8,
  COMPRESSED_INT: 9,
  COMPRESSED_LONG: 10,
  INT1: 11,
  INT1_NEGATIVE: 12,
  INT2: 13,
  INT2_NEGATIVE: 14,
  LONG1: 15,
  LONG1_NEGATIVE: 16,
  LONG2: 17,
  LONG2_NEGATIVE: 18,
  CUSTOM: 19,
  DICTIONARY: 20,
  HASHTABLE: 21,
  OBJECT_ARRAY: 23,
  OPERATION_REQUEST: 24,
  OPERATION_RESPONSE: 25,
  EVENT_DATA: 26,
  BOOLEAN_FALSE: 27,
  BOOLEAN_TRUE: 28,
  SHORT_ZERO: 29,
  INT_ZERO: 30,
  LONG_ZERO: 31,
  FLOAT_ZERO: 32,
  DOUBLE_ZERO: 33,
  BYTE_ZERO: 34,
  ARRAY: 64,
  BOOLEAN_ARRAY: 66,
  BYTE_ARRAY: 67,
  SHORT_ARRAY: 68,
  FLOAT_ARRAY: 69,
  DOUBLE_ARRAY: 70,
  STRING_ARRAY: 71,
  COMPRESSED_INT_ARRAY: 73,
  COMPRESSED_LONG_ARRAY: 74,
  CUSTOM_TYPE_ARRAY: 83,
  DICTIONARY_ARRAY: 84,
  HASHTABLE_ARRAY: 85,
  CUSTOM_TYPE_SLIM: 128,
};

function readString(reader) {
  const length = reader.readVarint32();
  if (!length) return "";
  if (length > reader.remaining) { reader.fail(); return ""; }
  return reader.readBytes(length).toString("utf8");
}

function readArray(reader, readElement, bytesPerElement = 1) {
  const length = reader.readVarint32();
  if (length > reader.remaining * (bytesPerElement === 1 ? 1 : 1) / bytesPerElement) return [];
  const out = [];
  for (let i = 0; i < length && reader.ok; i++) out.push(readElement(reader));
  return out;
}

function readDictionaryEntries(reader, keyType, valueType) {
  const size = reader.readVarint32();
  const out = new Map();
  if (!size || size > reader.remaining) return out;
  for (let i = 0; i < size && !reader.isEmpty; i++) {
    const key = keyType === P18.UNKNOWN ? deserialize(reader, reader.readByte()) : deserialize(reader, keyType);
    const value = valueType === P18.UNKNOWN ? deserialize(reader, reader.readByte()) : deserialize(reader, valueType);
    if (key !== null && key !== undefined) out.set(key, value);
  }
  return out;
}

function readCustomType(reader, slimCode) {
  const typeCode = slimCode ? slimCode - P18.CUSTOM_TYPE_SLIM : reader.readByte();
  const length = reader.readVarint32();
  if (length > reader.remaining) { reader.fail(); return null; }
  return { customTypeCode: typeCode, data: Buffer.from(reader.readBytes(length)) };
}

function readBooleanArray(reader) {
  const length = reader.readVarint32();
  if (length > reader.remaining * 8) { reader.fail(); return []; }
  const out = [];
  let byte = 0;
  for (let i = 0; i < length; i++) {
    if (i % 8 === 0) byte = reader.readByte();
    out.push((byte & (1 << i % 8)) !== 0);
  }
  return out;
}

/** One value of the given Protocol18 type code. */
function deserialize(reader, typeCode) {
  if (typeCode >= P18.CUSTOM_TYPE_SLIM) return readCustomType(reader, typeCode);

  switch (typeCode) {
    case P18.BOOLEAN: return reader.readByte() !== 0;
    case P18.BOOLEAN_FALSE: return false;
    case P18.BOOLEAN_TRUE: return true;
    case P18.BYTE: return reader.readByte();
    case P18.BYTE_ZERO: return 0;
    case P18.SHORT: return reader.readInt16();
    case P18.SHORT_ZERO: return 0;
    case P18.FLOAT: return reader.readFloat();
    case P18.FLOAT_ZERO: return 0;
    case P18.DOUBLE: return reader.readDouble();
    case P18.DOUBLE_ZERO: return 0;
    case P18.STRING: return readString(reader);
    case P18.NULL:
    case P18.UNKNOWN: return null;
    case P18.COMPRESSED_INT: return zigzag32(reader.readVarint32());
    case P18.COMPRESSED_LONG: return zigzag64(reader.readVarint64());
    case P18.INT1: return reader.readByte();
    case P18.INT1_NEGATIVE: return -reader.readByte();
    case P18.INT2: return reader.readUInt16();
    case P18.INT2_NEGATIVE: return -reader.readUInt16();
    case P18.INT_ZERO: return 0;
    case P18.LONG1: return BigInt(reader.readByte());
    case P18.LONG1_NEGATIVE: return -BigInt(reader.readByte());
    case P18.LONG2: return BigInt(reader.readUInt16());
    case P18.LONG2_NEGATIVE: return -BigInt(reader.readUInt16());
    case P18.LONG_ZERO: return 0n;
    case P18.CUSTOM: return readCustomType(reader, 0);
    case P18.DICTIONARY: {
      const keyType = reader.readByte();
      const valueType = reader.readByte();
      return readDictionaryEntries(reader, keyType, valueType);
    }
    case P18.HASHTABLE: return readDictionaryEntries(reader, P18.UNKNOWN, P18.UNKNOWN);
    case P18.OBJECT_ARRAY:
    case P18.ARRAY: return readArray(reader, (r) => deserialize(r, r.readByte()));
    case P18.BYTE_ARRAY: {
      const length = reader.readVarint32();
      if (length > reader.remaining) { reader.fail(); return Buffer.alloc(0); }
      return Buffer.from(reader.readBytes(length));
    }
    case P18.BOOLEAN_ARRAY: return readBooleanArray(reader);
    case P18.SHORT_ARRAY: return readArray(reader, (r) => r.readInt16(), 2);
    case P18.FLOAT_ARRAY: return readArray(reader, (r) => r.readFloat(), 4);
    case P18.DOUBLE_ARRAY: return readArray(reader, (r) => r.readDouble(), 8);
    case P18.STRING_ARRAY: return readArray(reader, readString);
    case P18.COMPRESSED_INT_ARRAY: return readArray(reader, (r) => zigzag32(r.readVarint32()));
    case P18.COMPRESSED_LONG_ARRAY: return readArray(reader, (r) => zigzag64(r.readVarint64()));
    case P18.CUSTOM_TYPE_ARRAY: {
      const length = reader.readVarint32();
      const customCode = reader.readByte();
      const out = [];
      for (let i = 0; i < length && !reader.isEmpty; i++) {
        const size = reader.readVarint32();
        if (size > reader.remaining) { reader.fail(); break; }
        out.push({ customTypeCode: customCode, data: Buffer.from(reader.readBytes(size)) });
      }
      return out;
    }
    case P18.DICTIONARY_ARRAY: {
      const keyType = reader.readByte();
      const valueType = reader.readByte();
      const length = reader.readVarint32();
      const out = [];
      for (let i = 0; i < length && !reader.isEmpty; i++) out.push(readDictionaryEntries(reader, keyType, valueType));
      return out;
    }
    case P18.HASHTABLE_ARRAY:
      return readArray(reader, (r) => readDictionaryEntries(r, P18.UNKNOWN, P18.UNKNOWN));
    default:
      return null;
  }
}

/** Parameter table: count byte, then {key byte, type byte, value}. */
function readParameterTable(reader) {
  const params = {};
  if (reader.remaining < 1) return params;
  const size = reader.readByte();
  for (let i = 0; i < size; i++) {
    if (reader.remaining < 2) break;
    const key = reader.readByte();
    const typeCode = reader.readByte();
    params[key] = deserialize(reader, typeCode);
  }
  return params;
}

/**
 * Decode one event body (everything after the 0xF3 magic + message type).
 * @returns {{code:number, parameters:object}}
 */
function decodeEventData(body) {
  const reader = new PhotonReader(body);
  const code = reader.readByte();
  return { code, parameters: readParameterTable(reader) };
}

/** Operation request: code byte, then the parameter table. */
function decodeOperationRequest(body) {
  const reader = new PhotonReader(body);
  const code = reader.readByte();
  return { code, parameters: readParameterTable(reader) };
}

/**
 * Operation response: code(1), returnCode(int16 LE), a typed debug message,
 * then the parameter table. Zone identity arrives here — the Join EVENT is an
 * empty envelope, the Join RESPONSE carries the cluster.
 *
 * The debug-message slot is not always a debug message. Albion puts MARKET
 * ORDER LISTS there, as a typed string array, instead of in the parameter
 * table — and reading the slot by the book (keep it only if it is a string)
 * threw every order list away, leaving a capture that looked deaf while the
 * game was answering perfectly. A string array found there is the response's
 * payload, so it is surfaced as parameter 0, where the market reader looks.
 * The reference client does the same.
 */
function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string");
}

function decodeOperationResponse(body) {
  const reader = new PhotonReader(body);
  const code = reader.readByte();
  const returnCode = reader.readInt16();
  let debugMessage = "";
  if (!reader.isEmpty) {
    const value = deserialize(reader, reader.readByte());
    if (typeof value === "string") debugMessage = value;
    else if (isStringArray(value)) return { code, returnCode, debugMessage: "", parameters: { 0: value } };
  }
  return { code, returnCode, debugMessage, parameters: readParameterTable(reader) };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    P18, deserialize, readParameterTable, readString,
    decodeEventData, decodeOperationRequest, decodeOperationResponse,
  };
}
