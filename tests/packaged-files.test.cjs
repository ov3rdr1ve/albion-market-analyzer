/**
 * Everything the app loads at runtime has to be inside the installer.
 *
 * `build.files` in package.json globs `css/**` and `js/**`, so those look after
 * themselves — but top-level HTML entries are listed BY NAME. Adding a window
 * and forgetting its page is a failure that cannot happen in a dev run (the
 * file is right there on disk) and only appears in a shipped installer, as a
 * blank window with no error.
 *
 * So: every top-level .html file in the repo must be named in build.files, and
 * every page main.js loads must exist.
 *
 * Run: node tests/packaged-files.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

const files = (pkg.build && pkg.build.files) || [];
const htmlOnDisk = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));

test("the build actually lists files", () => {
  assert.ok(files.length > 0, "package.json build.files is empty");
});

htmlOnDisk.forEach((file) => {
  test(`${file} is packaged`, () => {
    assert.ok(files.includes(file), `add "${file}" to build.files in package.json`);
  });
});

// Every `loadFile(path.join(__dirname, "x.html"))` in the main process.
const loaded = [...new Set(
  [...main.matchAll(/loadFile\(path\.join\(__dirname,\s*"([^"]+\.html)"\)\)/g)].map((m) => m[1]),
)];

test("main.js loads the main page", () => {
  assert.ok(loaded.includes("index.html"), "index.html is not loaded from main.js");
});

loaded.forEach((file) => {
  test(`${file} exists and is packaged`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `main.js loads ${file}, which is not in the repo`);
    assert.ok(files.includes(file), `main.js loads ${file}, which is not in build.files`);
  });
});

// ── shutdown ───────────────────────────────────────────────────────────

test("quitting stops the capture before anything is torn down", () => {
  assert.ok(/app\.on\("before-quit"/.test(main), "no before-quit hook");
  const hook = main.slice(main.indexOf('app.on("before-quit"'));
  assert.ok(/stopMonitor\(\)/.test(hook.slice(0, 300)));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
