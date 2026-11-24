/**
 * Tests for reading the player's LOCATION off a Join response.
 *
 * The wire never sends a display name — it sends a cluster id ("3005",
 * "TNL-022"), and for an instanced map something that is not a cluster id at
 * all. A private island arrives as "@island@<uuid>", a hideout bank as
 * "BLACKBANK-…", a hell den as "…-HellDen". The app used to refuse every one of
 * those unless it was a plain string in parameter 8, and a refused Join is
 * indistinguishable from a Join that never arrived: the position simply stopped
 * moving, for the rest of the session.
 *
 * The shapes below are the reference client's (ao-data/albiondata-client,
 * client/listener.go normalizeLocationID and client/decode.go
 * looksLikeJoinResponse / extractLocationLikeString, read 2026-09-03).
 *
 * Run: node tests/join-location.test.cjs
 */

const assert = require("assert");
const {
  normalizeLocationId, extractLocationLikeString, readJoinLocation,
  looksLikeJoinResponse, isInstancedLocation,
} = require("../js/join-location.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const UUID = "1f2e3d4c-5b6a-7980-9a1b-2c3d4e5f6071";

// ── normalizeLocationId: the shapes the game actually sends ──

const ACCEPTED = [
  ["a city cluster", "3005", "3005"],
  ["a zero-padded cluster", "0301", "0301"],
  ["a roads cluster", "TNL-022", "TNL-022"],
  ["a numeric cluster as a number", 3005, "3005"],
  ["Caerleon second auction house", "3013-Auction2", "3013-Auction2"],
  ["a hideout bank", "BLACKBANK-9f3c", "BLACKBANK-9f3c"],
  ["a hell den", "3005-HellDen", "3005-HellDen"],
  ["a private island", "@island@" + UUID, "@ISLAND@" + UUID],
  ["a private island, upper case", "@ISLAND@" + UUID, "@ISLAND@" + UUID],
  ["an island embedded in a longer value", "xyz@island@" + UUID, "@ISLAND@" + UUID],
  ["the other island spelling", "@player-island-4711", "@player-island-4711"],
  ["the third island spelling", "Island-Player-4711", "Island-Player-4711"],
  ["a guild island", "@island-guild-4711", "@island-guild-4711"],
  ["a value the game padded with punctuation", ",3005.", "3005"],
];

for (const [name, raw, expected] of ACCEPTED) {
  test(`normalizeLocationId accepts ${name}`, () => {
    assert.strictEqual(normalizeLocationId(raw), expected);
  });
}

const REFUSED = [
  ["a display name", "Anklesnag Mire"],
  ["an empty string", ""],
  ["whitespace only", "   "],
  ["null", null],
  ["undefined", undefined],
  ["a boolean", true],
  ["an over-long token", "x".repeat(65)],
  ["a two-digit number", 42],
  ["a seven-digit number", "1234567"],
  ["an object", { 0: "3005" }],
];

for (const [name, raw] of REFUSED) {
  test(`normalizeLocationId refuses ${name}`, () => {
    assert.strictEqual(normalizeLocationId(raw), null);
  });
}

test("normalizeLocationId is strict: an unknown token is not a location", () => {
  // The loose read that lets the Mists through belongs to readJoinLocation,
  // which knows the message IS a Join. Here it would let any short string in
  // any parameter of any response name a position.
  assert.strictEqual(normalizeLocationId("SomethingElse"), null);
});

// ── isInstancedLocation ──

test("isInstancedLocation names the maps the portal graph must never route through", () => {
  assert.strictEqual(isInstancedLocation("@ISLAND@" + UUID), true);
  assert.strictEqual(isInstancedLocation("Island-Player-4711"), true);
  assert.strictEqual(isInstancedLocation("BLACKBANK-9f3c"), true);
  assert.strictEqual(isInstancedLocation("3005-HellDen"), true);
  assert.strictEqual(isInstancedLocation("3005"), false);
  assert.strictEqual(isInstancedLocation("TNL-022"), false);
});

// ── extractLocationLikeString: the value arrives inside bytes ──

const bytes = (text) => Buffer.from(text, "latin1");

test("extractLocationLikeString reads a location out of a Buffer", () => {
  assert.strictEqual(extractLocationLikeString(bytes("@island@" + UUID)), "@ISLAND@" + UUID);
});

test("extractLocationLikeString splits on non-printable padding", () => {
  const padded = Buffer.concat([Buffer.from([0, 3, 0]), bytes("@island@" + UUID), Buffer.from([0, 7])]);
  assert.strictEqual(extractLocationLikeString(padded), "@ISLAND@" + UUID);
});

test("extractLocationLikeString reads an int8 array (negative bytes)", () => {
  const signed = Array.from(bytes("@island@" + UUID)).map((b) => (b > 127 ? b - 256 : b));
  assert.strictEqual(extractLocationLikeString(signed), "@ISLAND@" + UUID);
});

test("extractLocationLikeString descends into nested containers", () => {
  assert.strictEqual(extractLocationLikeString({ 4: [{ 9: bytes("3005") }] }), "3005");
});

test("extractLocationLikeString descends into a Map", () => {
  assert.strictEqual(extractLocationLikeString(new Map([[1, new Map([[2, "0301"]])]])), "0301");
});

test("extractLocationLikeString finds nothing in ordinary payloads", () => {
  assert.strictEqual(extractLocationLikeString({ 0: "hello world", 1: [1, 2, 3] }), null);
});

test("extractLocationLikeString does not recurse forever", () => {
  const loop = { 0: null };
  loop[0] = loop;
  assert.strictEqual(extractLocationLikeString(loop), null);
});

// ── readJoinLocation: parameter 8, then 66, then the bytes ──

test("readJoinLocation reads parameter 8", () => {
  assert.strictEqual(readJoinLocation({ 8: "3005" }), "3005");
});

test("readJoinLocation falls back to parameter 66", () => {
  assert.strictEqual(readJoinLocation({ 66: "0301" }), "0301");
});

test("readJoinLocation canonicalises an island in parameter 8", () => {
  assert.strictEqual(readJoinLocation({ 8: "@island@" + UUID }), "@ISLAND@" + UUID);
});

test("readJoinLocation keeps the loose read that lets the Mists through", () => {
  // An instanced map has no cluster shape at all. On a message already known to
  // be a Join, an unrecognised token still names where the player is standing.
  assert.strictEqual(readJoinLocation({ 8: "MISTS-4711-abc" }), "MISTS-4711-abc");
});

test("readJoinLocation still refuses a display name", () => {
  assert.strictEqual(readJoinLocation({ 8: "Anklesnag Mire" }), null);
});

test("readJoinLocation reads a location that arrived as bytes", () => {
  assert.strictEqual(readJoinLocation({ 8: bytes("@island@" + UUID) }), "@ISLAND@" + UUID);
});

test("readJoinLocation scans other parameters only as a last resort", () => {
  // Parameter 8 wins even when another parameter also looks like a location.
  assert.strictEqual(readJoinLocation({ 8: "3005", 12: "0301" }), "3005");
});

// The whole-payload scan is for a message whose OPERATION already named it a
// Join. Reported 2026-09-04: after leaving a private island the app kept
// announcing the island. Ordinary traffic carries the player's own island
// reference, and an unconfirmed message holding one was read as an arrival, so
// every such response undid the real zone.
test("readJoinLocation finds an island hiding in another parameter, on a confirmed Join", () => {
  assert.strictEqual(
    readJoinLocation({ 1: "character-id", 12: "@island@" + UUID }, { confirmed: true }),
    "@ISLAND@" + UUID,
  );
});

test("readJoinLocation refuses an island outside the location parameters when the Join is unconfirmed", () => {
  assert.strictEqual(readJoinLocation({ 1: "character-id", 12: "@island@" + UUID }), null);
});

test("readJoinLocation reads the location parameters without confirmation", () => {
  // The gate is on the whole-payload scan alone: parameters 8 and 66 are read
  // the same way either way.
  assert.strictEqual(readJoinLocation({ 8: "@island@" + UUID }), "@ISLAND@" + UUID);
  assert.strictEqual(readJoinLocation({ 66: "3005" }), "3005");
});

for (const [name, raw] of [
  ["the uuid form", "@island@" + UUID],
  ["the guild spelling", "@island-guild-4711"],
  ["the player spelling", "@player-island-4711"],
  ["the third spelling", "Island-Player-4711"],
]) {
  test(`readJoinLocation gates ${name} in an unnamed parameter on confirmation`, () => {
    assert.strictEqual(readJoinLocation({ 12: raw }), null);
    assert.ok(readJoinLocation({ 12: raw }, { confirmed: true }));
  });
}

test("readJoinLocation returns null for a Join carrying no location", () => {
  assert.strictEqual(readJoinLocation({ 1: "character-id" }), null);
});

// ── looksLikeJoinResponse: the unknown-operation fallback ──

const joinShaped = (location) => ({ 1: "character-id", 2: "PlayerName", 8: location });

test("looksLikeJoinResponse accepts a Join-shaped payload", () => {
  assert.strictEqual(looksLikeJoinResponse(joinShaped("3005")), true);
});

// Reported 2026-09-04: leaving a private island left the window and the status
// line stuck on "@ISLAND@…". The island branch used to need no corroboration at
// all — "no other message carries an island token by accident" — and post-island
// traffic carrying the player's own island reference was read as an arrival back
// at it, over and over. The claim was as wrong for islands as it was for hell
// dens (the Rowanwood report): an island now counts outside parameters 8/66 only
// beside the Join's own character block.
test("looksLikeJoinResponse refuses an island in an unrelated payload", () => {
  assert.strictEqual(looksLikeJoinResponse({ 4: "@island@" + UUID }), false);
});

test("looksLikeJoinResponse refuses an island that arrived as bytes with nothing else", () => {
  assert.strictEqual(looksLikeJoinResponse({ 4: bytes("@island@" + UUID) }), false);
});

test("looksLikeJoinResponse accepts an island outside the location slot beside the character block", () => {
  // The teleport-straight-to-an-island case this branch exists for.
  assert.strictEqual(
    looksLikeJoinResponse({ 1: "character-id", 2: "PlayerName", 4: "@island@" + UUID }),
    true,
  );
});

test("looksLikeJoinResponse accepts an island as bytes beside the character block", () => {
  assert.strictEqual(
    looksLikeJoinResponse({ 1: "character-id", 2: "PlayerName", 4: bytes("@island@" + UUID) }),
    true,
  );
});

test("looksLikeJoinResponse refuses a bare cluster-shaped number on its own", () => {
  // This is the Willowshade Icemarsh failure: an unrelated response held "0320"
  // in a parameter and was read as an arrival, moving the player across the map
  // for the rest of the session.
  assert.strictEqual(looksLikeJoinResponse({ 0: "0320" }), false);
});

test("looksLikeJoinResponse refuses a cluster in parameter 8 without the character block", () => {
  assert.strictEqual(looksLikeJoinResponse({ 8: "0320" }), false);
});

test("looksLikeJoinResponse refuses an ordinary payload", () => {
  assert.strictEqual(looksLikeJoinResponse({ 0: [1, 2, 3], 1: "hello world" }), false);
});

// ── what ELSE sends an instanced id ────────────────────────────────────────
// Reported from Rowanwood: entering the zone announced "Antiquarian's Den".
// An ordinary response embedded a "…-HellDen" id deep in its payload, and the
// fallback gate — built on "an instanced id nothing else sends" — promoted the
// whole message to a Join. The claim is only true for ISLANDS: an
// "@island@<uuid>" token names the player's own island and nothing else
// carries it, while a den or bank id is a short suffix token that zone-entry
// payloads legitimately mention (the den entrance standing in the map being
// entered). Islands stay readable anywhere; den and bank ids must arrive in
// the confirmed parameters, or beside the Join's character block.

test("looksLikeJoinResponse refuses a den id embedded outside the location parameters", () => {
  assert.strictEqual(looksLikeJoinResponse({ 4: "3005-HellDen" }), false);
});

test("looksLikeJoinResponse refuses a hideout bank id embedded outside the location parameters", () => {
  assert.strictEqual(looksLikeJoinResponse({ 4: "BLACKBANK-9f3c" }), false);
});

test("looksLikeJoinResponse accepts a den id in the location slot beside the character block", () => {
  assert.strictEqual(looksLikeJoinResponse(joinShaped("3005-HellDen")), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
