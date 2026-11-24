/**
 * Tests for the npcap presence check.
 *
 * The live monitor needs the npcap driver, which is NOT part of this app and
 * cannot be shipped with it: the free Npcap licence forbids redistribution and
 * its silent installer (/S) is an OEM-only feature. So the app has to answer
 * three questions on its own — is the driver here, is a licensed installer
 * bundled next to us, and what should be offered to the user — and each answer
 * is decided here, without touching a real filesystem.
 *
 * Run: node tests/npcap-status.test.cjs
 */

const assert = require("assert");
const {
  NPCAP_DOWNLOAD_URL,
  npcapProbePaths,
  isNpcapInstalled,
  findBundledNpcapInstaller,
  npcapAction,
} = require("../js/npcap-status.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const ROOT = "C:\\Windows";
/** A fake `fs.existsSync` that knows only the paths it was handed. */
const existsIn = (paths) => (p) => paths.includes(p);

// ── which files count as "npcap is here" ───────────────────────────────────
test("every probe path sits under the given system root", () => {
  const paths = npcapProbePaths(ROOT);
  assert.ok(paths.length >= 3, "several places to look");
  paths.forEach((p) => assert.ok(p.startsWith(ROOT + "\\"), p));
});

test("probe paths follow the system root it is given", () => {
  const paths = npcapProbePaths("D:\\WinNT");
  paths.forEach((p) => assert.ok(p.startsWith("D:\\WinNT\\"), p));
});

// Each of these alone is proof enough: the driver, the modern DLL directory,
// the WinPcap-compatible install, and the 32-bit view of the same.
[
  ["the npcap driver binary", "C:\\Windows\\System32\\drivers\\npcap.sys"],
  ["the npcap DLL directory", "C:\\Windows\\System32\\Npcap\\wpcap.dll"],
  ["WinPcap-compatible mode", "C:\\Windows\\System32\\wpcap.dll"],
  ["the 32-bit DLL directory", "C:\\Windows\\SysWOW64\\Npcap\\wpcap.dll"],
].forEach(([label, hit]) => {
  test(`${label} alone means installed`, () => {
    const found = isNpcapInstalled({ platform: "win32", systemRoot: ROOT, exists: existsIn([hit]) });
    assert.strictEqual(found, true);
  });
});

test("nothing on disk means not installed", () => {
  const found = isNpcapInstalled({ platform: "win32", systemRoot: ROOT, exists: existsIn([]) });
  assert.strictEqual(found, false);
});

test("an unrelated file under the system root proves nothing", () => {
  const exists = existsIn(["C:\\Windows\\System32\\kernel32.dll"]);
  assert.strictEqual(isNpcapInstalled({ platform: "win32", systemRoot: ROOT, exists }), false);
});

test("a missing SystemRoot falls back to C:\\Windows rather than throwing", () => {
  const found = isNpcapInstalled({
    platform: "win32",
    systemRoot: "",
    exists: existsIn(["C:\\Windows\\System32\\Npcap\\wpcap.dll"]),
  });
  assert.strictEqual(found, true);
});

// libpcap is the platform's own business off Windows — the app must never
// nag a Linux or macOS user about a Windows driver.
["linux", "darwin"].forEach((platform) => {
  test(`${platform} is never reported as missing npcap`, () => {
    const found = isNpcapInstalled({ platform, systemRoot: ROOT, exists: existsIn([]) });
    assert.strictEqual(found, true);
  });
});

// ── a licensed installer bundled by whoever built the package ──────────────
test("an .exe in the bundle directory is the installer to run", () => {
  const found = findBundledNpcapInstaller({
    dir: "C:\\app\\resources\\npcap",
    listFiles: () => ["README.txt", "npcap-1.79.exe"],
  });
  assert.strictEqual(found, "C:\\app\\resources\\npcap\\npcap-1.79.exe");
});

test("the newest-looking installer wins when several are bundled", () => {
  const found = findBundledNpcapInstaller({
    dir: "C:\\app\\resources\\npcap",
    listFiles: () => ["npcap-1.79.exe", "npcap-1.82.exe", "npcap-1.80.exe"],
  });
  assert.strictEqual(found, "C:\\app\\resources\\npcap\\npcap-1.82.exe");
});

test("non-executables are ignored", () => {
  const found = findBundledNpcapInstaller({
    dir: "C:\\app\\resources\\npcap",
    listFiles: () => ["README.txt", "npcap.zip"],
  });
  assert.strictEqual(found, null);
});

test("a missing bundle directory is not an error", () => {
  const found = findBundledNpcapInstaller({
    dir: "C:\\app\\resources\\npcap",
    listFiles: () => { throw new Error("ENOENT"); },
  });
  assert.strictEqual(found, null);
});

// ── what to offer the user ─────────────────────────────────────────────────
test("nothing is offered when the driver is already installed", () => {
  const action = npcapAction({ installed: true, bundledInstaller: "C:\\x\\npcap.exe" });
  assert.strictEqual(action.kind, "none");
});

test("a bundled installer is run rather than sending the user to the web", () => {
  const action = npcapAction({ installed: false, bundledInstaller: "C:\\x\\npcap-1.79.exe" });
  assert.strictEqual(action.kind, "run");
  assert.strictEqual(action.target, "C:\\x\\npcap-1.79.exe");
});

test("without a bundled installer the user is sent to the download page", () => {
  const action = npcapAction({ installed: false, bundledInstaller: null });
  assert.strictEqual(action.kind, "download");
  assert.strictEqual(action.target, NPCAP_DOWNLOAD_URL);
  assert.ok(/^https:\/\/npcap\.com/.test(NPCAP_DOWNLOAD_URL));
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
