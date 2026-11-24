/**
 * Premium gates focus: a non-Premium account can't regenerate focus, so
 * isFocusEnabled() must return false whenever Premium is off — regardless of
 * the "Use Focus" checkbox state. This decouples the two header toggles at the
 * single source of truth (isFocusEnabled), which every render module funnels
 * through to pick focus-on vs focus-off RRR.
 *
 * Black-box: extract the REAL isFocusEnabled + isPremiumEnabled source from
 * js/utils.js and run them against a stubbed DOM (checkbox states), covering
 * the full 2×2 matrix of (Premium, UseFocus).
 *
 * Run: node tests/premium-focus-gating.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const src = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"].map((n) => fs.readFileSync(path.join(__dirname, "..", "js/" + n + ".js"), "utf8")).join("\n");

// Grab a top-level `function name(...) { ... }` block (body ends at the first
// line that is a lone "}" in column 0 — matches the file's formatting).
function grab(name) {
  const m = src.match(new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not extract ${name} from utils.js`);
  return m[0];
}

const sandbox = `
const document = {
  getElementById(id) {
    if (id === "use-focus") return { checked: globalThis.__FOCUS__ };
    if (id === "premium-account") return { checked: globalThis.__PREMIUM__ };
    return null;
  }
};
`;

const mod = new Module("premium-focus-gating-test");
mod._compile(
  sandbox + grab("isPremiumEnabled") + "\n" + grab("isFocusEnabled") +
    "\nmodule.exports = { isFocusEnabled, isPremiumEnabled };",
  "utils.js",
);
const { isFocusEnabled, isPremiumEnabled } = mod.exports;

function set(premium, focus) {
  globalThis.__PREMIUM__ = premium;
  globalThis.__FOCUS__ = focus;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("=== Premium gates focus (isFocusEnabled 2×2 matrix) ===");

test("Premium ON, Use Focus ON → focus enabled", () => {
  set(true, true);
  assert.strictEqual(isPremiumEnabled(), true);
  assert.strictEqual(isFocusEnabled(), true);
});

test("Premium ON, Use Focus OFF → focus disabled (user choice)", () => {
  set(true, false);
  assert.strictEqual(isFocusEnabled(), false);
});

test("Premium OFF, Use Focus ON → focus disabled (gated by Premium)", () => {
  set(false, true);
  assert.strictEqual(isPremiumEnabled(), false);
  assert.strictEqual(isFocusEnabled(), false);
});

test("Premium OFF, Use Focus OFF → focus disabled", () => {
  set(false, false);
  assert.strictEqual(isFocusEnabled(), false);
});

console.log(`\n${passed} passed`);
