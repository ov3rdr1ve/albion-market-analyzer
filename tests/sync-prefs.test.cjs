/**
 * Test: the team-sync preferences file (js/sync-prefs.js).
 *
 * These four settings decide whether this install talks to a shared folder at
 * all, so they are read in the main process before the window exists — same
 * reason js/monitor-prefs.js has its own file. The one thing that MUST be
 * stable is `deviceId`: it names the file this box owns in the shared folder,
 * and a box that mints a new one on every boot litters the folder with orphan
 * peers that never expire.
 *
 * Black-box: readFile / writeFile / makeId are injected. No real filesystem.
 *
 * Run: node tests/sync-prefs.test.cjs
 */

const assert = require("assert");
const path = require("path");

const P = require(path.join(__dirname, "..", "js", "sync-prefs.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Team sync prefs tests\n");

/** A load against a file that isn't there, with a deterministic id source. */
function loadFresh(overrides) {
  return P.loadSyncPrefs({
    file: "sync-prefs.json",
    readFile: () => { throw new Error("ENOENT"); },
    makeId: () => "aaaabbbb",
    ...overrides,
  });
}

test("the filename is stable — a rename would re-mint every user's device id", () => {
  assert.strictEqual(P.SYNC_PREFS_FILENAME, "sync-prefs.json");
});

// ── defaults ────────────────────────────────────────────────────────────────

const DEFAULT_CASES = [
  ["sync is off until the user asks for it", "enabled", false],
  ["no folder is chosen", "folder", ""],
  ["prices ride along once sync is on", "sharePrices", true],
];

DEFAULT_CASES.forEach(([name, key, expected]) => {
  test(`default: ${name}`, () => {
    assert.strictEqual(loadFresh()[key], expected);
  });
});

test("a device id is minted when there is no file", () => {
  assert.strictEqual(loadFresh().deviceId, "aaaabbbb");
});

test("the minted id is url/filename safe", () => {
  const real = P.loadSyncPrefs({ file: "x", readFile: () => { throw new Error("ENOENT"); } });
  assert.ok(/^[a-z0-9]{6,32}$/.test(real.deviceId), `got ${real.deviceId}`);
});

// ── tolerance ───────────────────────────────────────────────────────────────

const JUNK_CASES = [
  ["a truncated file", '{"enabled": tr'],
  ["an array", "[]"],
  ["a bare string", '"enabled"'],
  ["null", "null"],
  ["an empty file", ""],
];

JUNK_CASES.forEach(([name, text]) => {
  test(`${name} falls back to defaults rather than stopping the app`, () => {
    const prefs = P.loadSyncPrefs({ file: "x", readFile: () => text, makeId: () => "aaaabbbb" });
    assert.strictEqual(prefs.enabled, false);
    assert.strictEqual(prefs.folder, "");
    assert.strictEqual(prefs.deviceId, "aaaabbbb");
  });
});

const COERCE_CASES = [
  ["a string enabled is not a boolean", { enabled: "yes" }, "enabled", false],
  ["a numeric folder is not a path", { folder: 7 }, "folder", ""],
  ["a folder is trimmed", { folder: "  D:\\Dropbox\\roads  " }, "folder", "D:\\Dropbox\\roads"],
  ["sharePrices can be turned off", { sharePrices: false }, "sharePrices", false],
  ["a junk sharePrices keeps the default", { sharePrices: 3 }, "sharePrices", true],
  ["a blank deviceName is allowed", { deviceName: "" }, "deviceName", ""],
];

COERCE_CASES.forEach(([name, raw, key, expected]) => {
  test(name, () => {
    const prefs = P.loadSyncPrefs({
      file: "x",
      readFile: () => JSON.stringify(raw),
      makeId: () => "aaaabbbb",
    });
    assert.strictEqual(prefs[key], expected);
  });
});

test("a stored device id is kept, never re-minted", () => {
  const prefs = P.loadSyncPrefs({
    file: "x",
    readFile: () => JSON.stringify({ deviceId: "deadbeef" }),
    makeId: () => { throw new Error("must not mint over a stored id"); },
  });
  assert.strictEqual(prefs.deviceId, "deadbeef");
});

test("a junk device id is replaced — the filename has to be safe", () => {
  const prefs = P.loadSyncPrefs({
    file: "x",
    readFile: () => JSON.stringify({ deviceId: "../../etc/passwd" }),
    makeId: () => "aaaabbbb",
  });
  assert.strictEqual(prefs.deviceId, "aaaabbbb");
});

// ── save ────────────────────────────────────────────────────────────────────

test("a save round-trips through a load", () => {
  let written = null;
  const saved = P.saveSyncPrefs({
    file: "x",
    writeFile: (f, d) => { written = d; },
    prefs: { enabled: true, folder: "D:\\Dropbox\\roads", deviceId: "deadbeef", deviceName: "PC", sharePrices: false },
  });
  assert.strictEqual(saved.enabled, true);
  const back = P.loadSyncPrefs({ file: "x", readFile: () => written });
  assert.deepStrictEqual(back, saved);
});

test("a save keeps the existing device id when the caller omits it", () => {
  const saved = P.saveSyncPrefs({
    file: "x",
    writeFile: () => {},
    prefs: { enabled: true, deviceId: "deadbeef" },
  });
  assert.strictEqual(saved.deviceId, "deadbeef");
});

test("a read-only profile still returns the choice the user just made", () => {
  const saved = P.saveSyncPrefs({
    file: "x",
    writeFile: () => { throw new Error("EACCES"); },
    prefs: { enabled: true, folder: "D:\\x", deviceId: "deadbeef" },
  });
  assert.strictEqual(saved.enabled, true);
  assert.strictEqual(saved.folder, "D:\\x");
});

test("saving never writes a partial record — every field is present", () => {
  let written = null;
  P.saveSyncPrefs({ file: "x", writeFile: (f, d) => { written = d; }, prefs: { enabled: true } });
  const parsed = JSON.parse(written);
  ["enabled", "folder", "deviceId", "deviceName", "sharePrices"].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, key), `missing ${key}`);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
