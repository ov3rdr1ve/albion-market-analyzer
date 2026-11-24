/**
 * Tests for the monitor preferences file.
 *
 * The capture now starts by itself when the app opens, and that decision is
 * made in the main process BEFORE the page (and its localStorage) exists — so
 * the opt-out has to live in a small file of its own under userData. What
 * matters is that a fresh install auto-starts, a user who turned it off stays
 * off across restarts, and no shape of broken file can stop the app booting.
 *
 * Run: node tests/monitor-prefs.test.cjs
 */

const assert = require("assert");
const { DEFAULT_MONITOR_PREFS, loadMonitorPrefs, saveMonitorPrefs } = require("../js/monitor-prefs.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const FILE = "C:\\userData\\monitor-prefs.json";
const missing = () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; };

// ── defaults ───────────────────────────────────────────────────────────────
test("a fresh install auto-starts the monitor", () => {
  assert.strictEqual(DEFAULT_MONITOR_PREFS.autoStart, true);
  assert.strictEqual(loadMonitorPrefs({ file: FILE, readFile: missing }).autoStart, true);
});

[
  ["empty file", ""],
  ["not JSON", "{oops"],
  ["JSON that is not an object", "[1,2,3]"],
  ["null", "null"],
  ["an object with nothing known in it", '{"colour":"red"}'],
  ["autoStart of the wrong type", '{"autoStart":"yes"}'],
  ["captureCity of the wrong type", '{"captureCity":1002}'],
].forEach(([label, contents]) => {
  test(`${label} falls back to the defaults`, () => {
    const prefs = loadMonitorPrefs({ file: FILE, readFile: () => contents });
    assert.deepStrictEqual(prefs, DEFAULT_MONITOR_PREFS);
  });
});

// The capture city has to be readable before the page exists for the same
// reason auto-start is: the capture opens with the app, and a city that only
// arrives once localStorage is loaded comes too late — every order the game
// sent in between is filed nowhere.
test("a fresh install has no capture city named", () => {
  assert.strictEqual(DEFAULT_MONITOR_PREFS.captureCity, "");
  assert.strictEqual(loadMonitorPrefs({ file: FILE, readFile: missing }).captureCity, "");
});

test("a named capture city survives a restart", () => {
  const prefs = loadMonitorPrefs({ file: FILE, readFile: () => '{"captureCity":"1002"}' });
  assert.strictEqual(prefs.captureCity, "1002");
  assert.strictEqual(prefs.autoStart, true, "the other pref is untouched");
});

test("saving a capture city writes it and returns it", () => {
  const written = [];
  const prefs = saveMonitorPrefs({
    file: FILE,
    writeFile: (path, data) => written.push(data),
    prefs: { captureCity: "3008" },
  });
  assert.strictEqual(prefs.captureCity, "3008");
  assert.strictEqual(JSON.parse(written[0]).captureCity, "3008");
});

test("going back to Auto is saved as no city", () => {
  const prefs = saveMonitorPrefs({ file: FILE, writeFile: () => {}, prefs: { captureCity: "" } });
  assert.strictEqual(prefs.captureCity, "");
});

test("a read that blows up does not stop the app", () => {
  const prefs = loadMonitorPrefs({ file: FILE, readFile: () => { throw new Error("EACCES"); } });
  assert.deepStrictEqual(prefs, DEFAULT_MONITOR_PREFS);
});

// ── round trip ─────────────────────────────────────────────────────────────
test("turning auto-start off is what comes back", () => {
  const prefs = loadMonitorPrefs({ file: FILE, readFile: () => '{"autoStart":false}' });
  assert.strictEqual(prefs.autoStart, false);
});

test("saving writes JSON to the given file and returns the merged prefs", () => {
  const written = [];
  const prefs = saveMonitorPrefs({
    file: FILE,
    writeFile: (path, data) => written.push([path, data]),
    prefs: { autoStart: false },
  });
  assert.strictEqual(prefs.autoStart, false);
  assert.strictEqual(prefs.captureCity, "");
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0][0], FILE);
  assert.deepStrictEqual(JSON.parse(written[0][1]), prefs);
});

// A prefs file written by an older build may still carry obsolete
// window blocks. They are dropped on load and never written back.
test("a legacy window block is ignored and not persisted", () => {
  const prefs = loadMonitorPrefs({
    file: FILE,
    readFile: () => JSON.stringify({
      autoStart: false, captureCity: "0301", window: { open: true },
    }),
  });
  assert.strictEqual(prefs.autoStart, false);
  assert.strictEqual(prefs.captureCity, "0301");
  assert.ok(!("window" in prefs));
  const written = [];
  saveMonitorPrefs({ file: FILE, writeFile: (f, d) => written.push(d), prefs });
  assert.ok(!/window/.test(written[0]));
});

test("a partial save keeps the untouched defaults", () => {
  const prefs = saveMonitorPrefs({ file: FILE, writeFile: () => {}, prefs: {} });
  assert.deepStrictEqual(prefs, DEFAULT_MONITOR_PREFS);
});

test("an unwritable file still yields the prefs the caller asked for", () => {
  const prefs = saveMonitorPrefs({
    file: FILE,
    writeFile: () => { throw new Error("EACCES"); },
    prefs: { autoStart: false },
  });
  assert.strictEqual(prefs.autoStart, false);
});

test("saving does not mutate the defaults", () => {
  saveMonitorPrefs({ file: FILE, writeFile: () => {}, prefs: { autoStart: false } });
  assert.strictEqual(DEFAULT_MONITOR_PREFS.autoStart, true);
});

// ── an obsolete lastZone key ─────────────────────────────────────────────────
// Older builds stored a lastZone key. A prefs file
// that still carries one must load cleanly, and the key must not be written
// back.

[
  ["a well-formed lastZone", '{"autoStart":false,"lastZone":{"id":"1211","at":123}}'],
  ["a junk lastZone", '{"autoStart":false,"lastZone":"1211"}'],
].forEach(([label, contents]) => {
  test(`a stored file with ${label} loads without it`, () => {
    const prefs = loadMonitorPrefs({ file: FILE, readFile: () => contents });
    assert.strictEqual(prefs.autoStart, false);
    assert.ok(!("lastZone" in prefs), "lastZone is not a pref any more");
  });
});

test("a lastZone handed to a save is not written", () => {
  const written = [];
  saveMonitorPrefs({
    file: FILE,
    writeFile: (p, d) => written.push(d),
    prefs: { autoStart: true, lastZone: { id: "1211", at: 123 } },
  });
  assert.ok(!("lastZone" in JSON.parse(written[0])));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
