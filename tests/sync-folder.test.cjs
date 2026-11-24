/**
 * Test: the shared-folder transport (js/sync-folder.js).
 *
 * This is the whole Dropbox half of team sync, and it is deliberately dumb:
 * list names, read text, write text. It never learns what a portal is — the
 * merge lives in the renderer next to the graph, exactly as the price files do
 * (js/scan-price-file.js).
 *
 * The rules it DOES own are the ones the folder forces on us:
 *   - one file per user, so two clients never write the same path and Dropbox
 *     never has a conflict to "resolve" by dropping somebody's map;
 *   - our own files are never read back as a peer;
 *   - Dropbox's own droppings (conflicted copies, desktop.ini, .dropbox) are
 *     not peers either;
 *   - an unchanged mtime is not re-read, so a quiet folder costs one readdir;
 *   - a write lands atomically (tmp + rename), because Dropbox uploads whatever
 *     is on disk the instant it changes and half a JSON file would go out to
 *     every peer.
 *
 * Black-box: every fs call is injected. No real filesystem.
 *
 * Run: node tests/sync-folder.test.cjs
 */

const assert = require("assert");
const path = require("path");

const F = require(path.join(__dirname, "..", "js", "sync-folder.js"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Sync folder transport tests\n");

const FOLDER = "D:\\Dropbox\\Team\\albion-roads";
const ME = "aaaabbbb";

/** A fake folder: {name: {text, mtimeMs}}. */
function fakeFs(entries) {
  const calls = { read: [], written: [], renamed: [], mkdir: [] };
  const getBaseName = (f) => path.win32.basename(f);
  return {
    calls,
    readdir: () => Object.keys(entries),
    stat: (file) => {
      const name = getBaseName(file);
      if (!entries[name]) throw new Error("ENOENT");
      return { mtimeMs: entries[name].mtimeMs };
    },
    readFile: (file) => {
      const name = getBaseName(file);
      calls.read.push(name);
      if (!entries[name]) throw new Error("ENOENT");
      if (entries[name].text === null) throw new Error("EACCES");
      return entries[name].text;
    },
    writeFile: (file, data) => { calls.written.push([getBaseName(file), data]); },
    rename: (from, to) => { calls.renamed.push([getBaseName(from), getBaseName(to)]); },
    mkdir: (dir) => { calls.mkdir.push(dir); },
  };
}

// ── file naming ─────────────────────────────────────────────────────────────

const NAME_CASES = [
  ["portals", "peer-aaaabbbb.json"],
  ["prices", "peer-aaaabbbb-prices.json"],
];

NAME_CASES.forEach(([kind, expected]) => {
  test(`the ${kind} file is named ${expected}`, () => {
    assert.strictEqual(F.peerFileName(ME, kind), expected);
  });
});

const PARSE_CASES = [
  ["peer-aaaabbbb.json", { deviceId: "aaaabbbb", kind: "portals" }],
  ["peer-9f8e7d6c-prices.json", { deviceId: "9f8e7d6c", kind: "prices" }],
  ["peer-aaaabbbb.json.tmp", null],
  ["peer-aaaabbbb (Alex's conflicted copy 2026-08-12).json", null],
  ["peer-aaaabbbb-prices (conflicted copy).json", null],
  ["desktop.ini", null],
  [".dropbox", null],
  ["notes.json", null],
  ["peer-.json", null],
  ["peer-../../evil.json", null],
  ["scan-prices.json", null],
];

PARSE_CASES.forEach(([name, expected]) => {
  test(`parsePeerFileName: ${name} → ${expected ? expected.kind : "not a peer file"}`, () => {
    assert.deepStrictEqual(F.parsePeerFileName(name), expected);
  });
});

test("a name round-trips through the parser for both kinds", () => {
  ["portals", "prices"].forEach((kind) => {
    assert.deepStrictEqual(F.parsePeerFileName(F.peerFileName(ME, kind)), { deviceId: ME, kind });
  });
});

// ── listing ─────────────────────────────────────────────────────────────────

test("peers are listed, this box's own files are not", () => {
  const fs = fakeFs({
    "peer-aaaabbbb.json": { text: "{}", mtimeMs: 10 },
    "peer-aaaabbbb-prices.json": { text: "{}", mtimeMs: 10 },
    "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 20 },
  });
  const result = F.listPeerFiles({ folder: FOLDER, deviceId: ME, ...fs });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.files.map((f) => f.name), ["peer-9f8e7d6c.json"]);
});

test("non-peer files in a shared folder are ignored, not read", () => {
  const fs = fakeFs({
    "desktop.ini": { text: "x", mtimeMs: 1 },
    ".dropbox": { text: "x", mtimeMs: 1 },
    "Guild roster.xlsx": { text: "x", mtimeMs: 1 },
    "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 2 },
  });
  const result = F.listPeerFiles({ folder: FOLDER, deviceId: ME, ...fs });
  assert.deepStrictEqual(result.files.map((f) => f.name), ["peer-9f8e7d6c.json"]);
});

test("a Dropbox conflicted copy is never treated as a peer", () => {
  const fs = fakeFs({
    "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 2 },
    "peer-9f8e7d6c (Ana's conflicted copy 2026-08-12).json": { text: "{}", mtimeMs: 3 },
  });
  const result = F.listPeerFiles({ folder: FOLDER, deviceId: ME, ...fs });
  assert.deepStrictEqual(result.files.map((f) => f.name), ["peer-9f8e7d6c.json"]);
});

test("a listed peer carries its device id, kind and mtime", () => {
  const fs = fakeFs({ "peer-9f8e7d6c-prices.json": { text: "{}", mtimeMs: 4242 } });
  const [file] = F.listPeerFiles({ folder: FOLDER, deviceId: ME, ...fs }).files;
  assert.strictEqual(file.deviceId, "9f8e7d6c");
  assert.strictEqual(file.kind, "prices");
  assert.strictEqual(file.mtimeMs, 4242);
});

test("a file that vanished between readdir and stat is dropped, not thrown", () => {
  const fs = fakeFs({ "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 1 } });
  const readdir = () => ["peer-9f8e7d6c.json", "peer-11112222.json"];
  const result = F.listPeerFiles({ folder: FOLDER, deviceId: ME, ...fs, readdir });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.files.map((f) => f.name), ["peer-9f8e7d6c.json"]);
});

test("a missing folder reports an error instead of throwing", () => {
  const result = F.listPeerFiles({
    folder: FOLDER,
    deviceId: ME,
    readdir: () => { throw new Error("ENOENT: no such file or directory"); },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(/ENOENT/.test(result.error));
  assert.deepStrictEqual(result.files, []);
});

test("no folder configured is not an error, just nothing to read", () => {
  const result = F.listPeerFiles({ folder: "", deviceId: ME, readdir: () => { throw new Error("nope"); } });
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.files, []);
});

// ── reading ─────────────────────────────────────────────────────────────────

test("reading returns the raw text of each peer file", () => {
  const fs = fakeFs({ "peer-9f8e7d6c.json": { text: '{"hello":1}', mtimeMs: 5 } });
  const result = F.readPeerFiles({ folder: FOLDER, deviceId: ME, seen: {}, ...fs });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.peers.length, 1);
  assert.strictEqual(result.peers[0].text, '{"hello":1}');
  assert.strictEqual(result.peers[0].deviceId, "9f8e7d6c");
});

test("an unchanged mtime is not re-read", () => {
  const fs = fakeFs({ "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 5 } });
  const result = F.readPeerFiles({
    folder: FOLDER, deviceId: ME, seen: { "peer-9f8e7d6c.json": 5 }, ...fs,
  });
  assert.deepStrictEqual(fs.calls.read, [], "the file must not be opened at all");
  assert.strictEqual(result.peers.length, 0);
  assert.strictEqual(result.skipped, 1);
});

test("a newer mtime is read again", () => {
  const fs = fakeFs({ "peer-9f8e7d6c.json": { text: '{"v":2}', mtimeMs: 9 } });
  const result = F.readPeerFiles({
    folder: FOLDER, deviceId: ME, seen: { "peer-9f8e7d6c.json": 5 }, ...fs,
  });
  assert.strictEqual(result.peers.length, 1);
  assert.strictEqual(result.peers[0].text, '{"v":2}');
});

test("the caller gets back the mtimes it should remember", () => {
  const fs = fakeFs({
    "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 7 },
    "peer-11112222.json": { text: "{}", mtimeMs: 8 },
  });
  const result = F.readPeerFiles({ folder: FOLDER, deviceId: ME, seen: {}, ...fs });
  assert.deepStrictEqual(result.mtimes, { "peer-9f8e7d6c.json": 7, "peer-11112222.json": 8 });
});

test("mtimes of files that are gone drop out, so a deleted peer can come back", () => {
  const fs = fakeFs({ "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 7 } });
  const result = F.readPeerFiles({
    folder: FOLDER, deviceId: ME, seen: { "peer-dead0000.json": 3 }, ...fs,
  });
  assert.deepStrictEqual(Object.keys(result.mtimes), ["peer-9f8e7d6c.json"]);
});

test("the roster names everyone in the folder, read or skipped", () => {
  const fs = fakeFs({
    "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 5 },
    "peer-9f8e7d6c-prices.json": { text: "{}", mtimeMs: 5 },
    "peer-11112222.json": { text: "{}", mtimeMs: 6 },
  });
  const result = F.readPeerFiles({
    folder: FOLDER, deviceId: ME,
    // Everything already seen: a quiet tick still knows who is out there.
    seen: { "peer-9f8e7d6c.json": 5, "peer-9f8e7d6c-prices.json": 5, "peer-11112222.json": 6 },
    ...fs,
  });
  assert.strictEqual(result.peers.length, 0, "nothing needed re-reading");
  assert.deepStrictEqual(result.peerIds.sort(), ["11112222", "9f8e7d6c"]);
});

test("a peer counts once however many files they own", () => {
  const fs = fakeFs({
    "peer-9f8e7d6c.json": { text: "{}", mtimeMs: 1 },
    "peer-9f8e7d6c-prices.json": { text: "{}", mtimeMs: 2 },
  });
  assert.deepStrictEqual(F.readPeerFiles({ folder: FOLDER, deviceId: ME, seen: {}, ...fs }).peerIds, ["9f8e7d6c"]);
});

test("a peer who left the folder drops off the roster", () => {
  const fs = fakeFs({ "peer-11112222.json": { text: "{}", mtimeMs: 1 } });
  const result = F.readPeerFiles({
    folder: FOLDER, deviceId: ME, seen: { "peer-9f8e7d6c.json": 5 }, ...fs,
  });
  assert.deepStrictEqual(result.peerIds, ["11112222"]);
});

test("one unreadable peer does not cost us the others", () => {
  const fs = fakeFs({
    "peer-9f8e7d6c.json": { text: null, mtimeMs: 1 },   // mid-sync, locked
    "peer-11112222.json": { text: '{"ok":1}', mtimeMs: 2 },
  });
  const result = F.readPeerFiles({ folder: FOLDER, deviceId: ME, seen: {}, ...fs });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.peers.map((p) => p.deviceId), ["11112222"]);
});

test("an unreadable peer is not remembered, so the next tick retries it", () => {
  const fs = fakeFs({ "peer-9f8e7d6c.json": { text: null, mtimeMs: 1 } });
  const result = F.readPeerFiles({ folder: FOLDER, deviceId: ME, seen: {}, ...fs });
  assert.deepStrictEqual(result.mtimes, {});
});

// ── writing ─────────────────────────────────────────────────────────────────

test("a write goes to a temp file and is renamed into place", () => {
  const fs = fakeFs({});
  const result = F.writeOwnFile({
    folder: FOLDER, deviceId: ME, kind: "portals", text: '{"a":1}', ...fs,
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(fs.calls.written, [["peer-aaaabbbb.json.tmp", '{"a":1}']]);
  assert.deepStrictEqual(fs.calls.renamed, [["peer-aaaabbbb.json.tmp", "peer-aaaabbbb.json"]]);
});

test("the folder is created if it is not there yet", () => {
  const fs = fakeFs({});
  F.writeOwnFile({ folder: FOLDER, deviceId: ME, kind: "prices", text: "{}", ...fs });
  assert.deepStrictEqual(fs.calls.mkdir, [FOLDER]);
});

test("a failed write reports it and never renames a stale temp into place", () => {
  const fs = fakeFs({});
  const result = F.writeOwnFile({
    folder: FOLDER, deviceId: ME, kind: "portals", text: "{}", ...fs,
    writeFile: () => { throw new Error("ENOSPC"); },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(/ENOSPC/.test(result.error));
  assert.deepStrictEqual(fs.calls.renamed, []);
});

test("a failed rename reports it rather than throwing", () => {
  const fs = fakeFs({});
  const result = F.writeOwnFile({
    folder: FOLDER, deviceId: ME, kind: "portals", text: "{}", ...fs,
    rename: () => { throw new Error("EPERM"); },
  });
  assert.strictEqual(result.ok, false);
});

const BAD_WRITE_CASES = [
  ["no folder", { folder: "", deviceId: ME, kind: "portals", text: "{}" }],
  ["no device id", { folder: FOLDER, deviceId: "", kind: "portals", text: "{}" }],
  ["an unknown kind", { folder: FOLDER, deviceId: ME, kind: "secrets", text: "{}" }],
  ["no text", { folder: FOLDER, deviceId: ME, kind: "portals", text: "" }],
];

BAD_WRITE_CASES.forEach(([name, args]) => {
  test(`${name} writes nothing at all`, () => {
    const fs = fakeFs({});
    const result = F.writeOwnFile({ ...args, ...fs });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(fs.calls.written, []);
  });
});

test("this box can always read back what it wrote — the names agree", () => {
  const fs = fakeFs({});
  F.writeOwnFile({ folder: FOLDER, deviceId: ME, kind: "prices", text: "{}", ...fs });
  const [, written] = fs.calls.renamed[0];
  assert.deepStrictEqual(F.parsePeerFileName(written), { deviceId: ME, kind: "prices" });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
