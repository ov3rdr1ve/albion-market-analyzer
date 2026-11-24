/**
 * Little-endian cursor over a Buffer, with the varint/zigzag primitives
 * Photon's Protocol18 needs.
 *
 * Every read is bounds-checked and returns a default instead of throwing: a
 * sniffer sees truncated and malformed frames constantly, and one bad packet
 * must never take the reader down. `ok` records whether anything ran short so
 * callers can discard a half-decoded value.
 *
 * Note the endianness split, which is easy to get wrong: the Photon PACKET and
 * COMMAND headers are big-endian, while every Protocol18 VALUE is little-endian.
 * This reader is the little-endian half; the packet walker reads its headers
 * with readUInt32BE directly.
 */

class PhotonReader {
  constructor(buffer) {
    this.buf = Buffer.isBuffer(buffer) ? buffer : Buffer.alloc(0);
    this.pos = 0;
    this.ok = true;
  }

  get remaining() {
    return Math.max(0, this.buf.length - this.pos);
  }

  get isEmpty() {
    return this.remaining <= 0;
  }

  /** Marks the stream broken and parks the cursor at the end. */
  fail() {
    this.ok = false;
    this.pos = this.buf.length;
    return null;
  }

  skip(count) {
    if (count > this.remaining) return this.fail();
    this.pos += count;
    return true;
  }

  readByte() {
    if (this.remaining < 1) { this.fail(); return 0; }
    return this.buf.readUInt8(this.pos++);
  }

  readBytes(count) {
    if (count < 0 || count > this.remaining) { this.fail(); return Buffer.alloc(0); }
    const out = this.buf.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }

  readInt16() {
    if (this.remaining < 2) { this.fail(); return 0; }
    const value = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return value;
  }

  readUInt16() {
    if (this.remaining < 2) { this.fail(); return 0; }
    const value = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return value;
  }

  readFloat() {
    if (this.remaining < 4) { this.fail(); return 0; }
    const value = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return value;
  }

  readDouble() {
    if (this.remaining < 8) { this.fail(); return 0; }
    const value = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return value;
  }

  /** Base-128 varint, 5 bytes max. Returns an unsigned Number. */
  readVarint32() {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (this.remaining < 1) { this.fail(); return 0; }
      const byte = this.buf.readUInt8(this.pos++);
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value >>> 0 === value ? value : value % 2 ** 32;
    }
    this.fail();
    return 0;
  }

  /** Base-128 varint, 10 bytes max. Returns a BigInt so 64-bit ids survive. */
  readVarint64() {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.remaining < 1) { this.fail(); return 0n; }
      const byte = BigInt(this.buf.readUInt8(this.pos++));
      value |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) return value;
    }
    this.fail();
    return 0n;
  }
}

/** ZigZag: unsigned varint → signed value. */
function zigzag32(value) {
  return (value >>> 1) ^ -(value & 1);
}

function zigzag64(value) {
  const big = BigInt(value);
  return (big >> 1n) ^ -(big & 1n);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { PhotonReader, zigzag32, zigzag64 };
}
