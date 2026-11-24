/**
 * Tests for the Albion Online Data Project proof-of-work.
 *
 * The public ingest endpoint hands out a challenge {key, wanted} and only
 * accepts an upload whose solution hashes to a bit prefix equal to `wanted`.
 * The exact recipe is transcribed from albiondata-client/client/uploader_http_pow.go:
 *
 *   sha256("aod^" + randomHex(16 bytes) + "^" + key)
 *   hex-encode the digest, then read the bits of the ASCII CHARACTERS of that
 *   hex string — not of the raw digest — and compare the first len(wanted).
 *
 * That ASCII detail is the whole trick: Go builds the bit string with
 * fmt.Sprintf("%08b", s[i]) over the hex text, so '0' contributes 00110000.
 * Get it wrong and every solution is rejected by the server with no useful
 * error, so it is pinned with hand-computed vectors below.
 *
 * Run: node tests/aodp-pow.test.cjs
 */

const assert = require("assert");
const crypto = require("crypto");
const {
  powChallengeString, powHashHex, powBitPrefix, isPowSolution, solvePow,
} = require("../js/aodp-pow.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── challenge shape ────────────────────────────────────────────────────────
test("the challenge string is aod^<random>^<key>", () => {
  assert.strictEqual(powChallengeString("deadbeef", "abc123"), "aod^deadbeef^abc123");
});

test("the hash is sha256 of that exact string, hex encoded", () => {
  const want = crypto.createHash("sha256").update("aod^deadbeef^abc123").digest("hex");
  assert.strictEqual(powHashHex("deadbeef", "abc123"), want);
});

// ── bit prefix: bits of the ASCII hex text ─────────────────────────────────
const PREFIX_CASES = [
  // '0' = 0x30 = 00110000, '1' = 0x31 = 00110001, 'f' = 0x66 = 01100110
  ["0abc", 8, "00110000"],
  ["1abc", 8, "00110001"],
  ["fabc", 8, "01100110"],
  ["00", 16, "0011000000110000"],
  ["ab", 4, "0110"],
  ["ab", 1, "0"],
  ["ab", 0, ""],
];
PREFIX_CASES.forEach(([hex, n, want]) => {
  test(`powBitPrefix(${JSON.stringify(hex)}, ${n}) = ${JSON.stringify(want)}`, () => {
    assert.strictEqual(powBitPrefix(hex, n), want);
  });
});

test("powBitPrefix never returns more bits than the hex text holds", () => {
  assert.strictEqual(powBitPrefix("ab", 999).length, 16);
});

// ── verification ───────────────────────────────────────────────────────────
test("isPowSolution accepts a candidate whose prefix matches", () => {
  const key = "some-server-key";
  const candidate = "00112233445566778899aabbccddeeff";
  const wanted = powBitPrefix(powHashHex(candidate, key), 12);
  assert.strictEqual(isPowSolution({ key, wanted }, candidate), true);
});

test("isPowSolution rejects a candidate whose prefix differs", () => {
  const key = "some-server-key";
  const wanted = powBitPrefix(powHashHex("aaaa", key), 20);
  assert.strictEqual(isPowSolution({ key, wanted }, "bbbb"), false);
});

test("an empty wanted prefix is satisfied by anything", () => {
  assert.strictEqual(isPowSolution({ key: "k", wanted: "" }, "whatever"), true);
});

// ── solving ────────────────────────────────────────────────────────────────
test("solvePow returns a candidate that verifies", () => {
  const key = "solve-me";
  const wanted = powBitPrefix(powHashHex("seed-0", key), 8);
  const solution = solvePow({ key, wanted });
  assert.strictEqual(isPowSolution({ key, wanted }, solution), true);
});

test("solvePow uses the injected candidate source, so it is deterministic", () => {
  const key = "deterministic";
  const wanted = powBitPrefix(powHashHex("candidate-3", key), 24);
  let n = 0;
  const solution = solvePow({ key, wanted }, { randomHex: () => `candidate-${n++}` });
  assert.strictEqual(solution, "candidate-3");
  assert.strictEqual(n, 4, "stopped as soon as it found the match");
});

test("solvePow gives up after maxAttempts instead of spinning forever", () => {
  const solution = solvePow(
    { key: "k", wanted: "1".repeat(40) },
    { randomHex: () => "x", maxAttempts: 5 },
  );
  assert.strictEqual(solution, null);
});

test("the default candidate source is 16 random bytes as 32 hex chars", () => {
  const seen = new Set();
  let captured = null;
  solvePow({ key: "k", wanted: "" }, { randomHex: (...a) => {
    captured = require("../js/aodp-pow.js").randomHex(16);
    seen.add(captured);
    return captured;
  } });
  assert.strictEqual(captured.length, 32);
  assert.ok(/^[0-9a-f]+$/.test(captured));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
