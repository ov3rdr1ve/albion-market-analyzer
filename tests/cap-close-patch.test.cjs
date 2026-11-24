/**
 * Guard for the cap close-race patch (patches/cap+0.2.1.patch).
 *
 * cap 0.2.1's Pcap::close() unregisters its packet wait with the
 * NON-blocking UnregisterWait, so an OnPacket callback already running on a
 * thread-pool thread can uv_async_send on the handle close() is tearing down
 * — the access violation behind the silent deaths of 2026-09-25, 09-28 and
 * 10-02. The patch swaps in UnregisterWaitEx(wait, INVALID_HANDLE_VALUE),
 * which waits for that callback to finish. cap is dormant (no release since
 * 2019), so patch-package re-applies this on every install; this test makes
 * sure the patch, and the postinstall that applies it, are not lost.
 *
 * Text-only: no build, no cap.
 *
 * Run: node tests/cap-close-patch.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PATCH = path.join(ROOT, "patches", "cap+0.2.1.patch");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const patch = fs.existsSync(PATCH) ? fs.readFileSync(PATCH, "utf8") : "";
const lines = patch.split(/\r?\n/);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("the patch file exists", () => {
  assert.ok(patch.length > 0, `missing ${PATCH}`);
});

test("the patch targets cap's binding.cc", () => {
  assert.ok(patch.includes("node_modules/cap/src/binding.cc"));
});

test("the patch removes the non-blocking UnregisterWait(wait)", () => {
  assert.ok(lines.some((l) => /^-\s*UnregisterWait\(wait\);/.test(l)), "no removed UnregisterWait(wait) line");
});

test("the patch adds the blocking UnregisterWaitEx(wait, INVALID_HANDLE_VALUE)", () => {
  assert.ok(
    lines.some((l) => /^\+\s*UnregisterWaitEx\(wait, INVALID_HANDLE_VALUE\);/.test(l)),
    "no added UnregisterWaitEx line",
  );
});

test("the patch is pinned to the cap version installed", () => {
  // patch-package refuses a patch whose version does not match; a cap bump
  // must come with a re-made patch, and this is the reminder.
  assert.strictEqual(pkg.dependencies.cap.replace(/^[\^~]/, ""), "0.2.1");
});

test("patch-package runs on install", () => {
  assert.ok(pkg.devDependencies["patch-package"], "patch-package is a devDependency");
  assert.match(pkg.scripts.postinstall || "", /patch-package/);
});

test("the build rebuilds cap from source", () => {
  // The patch only matters if the binding is recompiled after it is applied.
  assert.match(pkg.scripts["rebuild:electron"], /electron-rebuild -f -w cap/);
  assert.match(pkg.scripts.dist, /rebuild:electron/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
