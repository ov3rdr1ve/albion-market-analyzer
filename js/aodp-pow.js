/**
 * Proof-of-work for the Albion Online Data Project public ingest.
 *
 * The endpoint hands out a challenge {key, wanted} and only accepts an upload
 * whose solution hashes to a bit prefix equal to `wanted`. Transcribed from
 * albiondata-client/client/uploader_http_pow.go:
 *
 *     sha256("aod^" + randomHex(16) + "^" + key)
 *
 * then hex-encode the digest and read the bits of the ASCII CHARACTERS of that
 * hex text — Go builds the bit string with fmt.Sprintf("%08b", s[i]) over the
 * hex string, so the character '0' contributes 00110000, not 0000. Reading the
 * raw digest bits instead produces solutions the server silently rejects.
 *
 * Node only (needs crypto): this runs in the Electron main process.
 */

const crypto = require("crypto");

/** 16 random bytes as 32 lowercase hex chars — the shape the reference uses. */
function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

/** The exact string that gets hashed. */
function powChallengeString(candidate, key) {
  return `aod^${candidate}^${key}`;
}

/** sha256 of the challenge, hex encoded. */
function powHashHex(candidate, key) {
  return crypto.createHash("sha256").update(powChallengeString(candidate, key)).digest("hex");
}

/**
 * First `bits` bits of the hex TEXT, read one ASCII character at a time.
 * Returns fewer bits only when the text itself runs out.
 */
function powBitPrefix(hex, bits) {
  if (bits <= 0) return "";
  let out = "";
  for (let i = 0; i < hex.length && out.length < bits; i++) {
    const byte = hex.charCodeAt(i) & 0xff;
    for (let j = 7; j >= 0 && out.length < bits; j--) {
      out += (byte >> j) & 1 ? "1" : "0";
    }
  }
  return out;
}

/** Does this candidate satisfy the challenge? */
function isPowSolution(pow, candidate) {
  const wanted = (pow && pow.wanted) || "";
  if (!wanted) return true;
  return powBitPrefix(powHashHex(candidate, pow.key), wanted.length) === wanted;
}

/**
 * Brute-force a solution. Returns null rather than spinning forever if the
 * server ever hands out a challenge this machine cannot meet.
 *
 * @param {{key:string, wanted:string}} pow
 * @param {{randomHex?:() => string, maxAttempts?:number}} [options]
 */
function solvePow(pow, { randomHex: candidateSource = () => randomHex(16), maxAttempts = 5_000_000 } = {}) {
  if (!pow || typeof pow.key !== "string") return null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = candidateSource();
    if (isPowSolution(pow, candidate)) return candidate;
  }
  return null;
}

module.exports = {
  randomHex, powChallengeString, powHashHex, powBitPrefix, isPowSolution, solvePow,
};
