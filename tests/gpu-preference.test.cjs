/**
 * Tests for the GPU choice made before the app is ready (js/gpu-preference.js).
 *
 * On a dual-GPU laptop Chromium renders on the integrated GPU by default. With
 * an Intel Iris Xe the renderer logged "GPU state invalid after
 * WaitForGetOffsetInRange" at boot and the window froze for good: the GPU
 * process stayed alive, so no `child-process-gone` event ever fired. The app
 * therefore always asks Chromium for the high-performance GPU.
 *
 * Contract:
 *   applyGpuPreference(commandLine)
 *     — appends `force-high-performance-gpu` and returns true;
 *     — returns false and appends nothing when the switch is already there
 *       (never doubled), when the GPU is turned off with `disable-gpu`
 *       (software rendering has no GPU to pick), or when there is no usable
 *       command line object.
 *
 * Black-box: a fake command line, no Electron.
 *
 * Run: node tests/gpu-preference.test.cjs
 */

const assert = require("assert");
const {
  HIGH_PERFORMANCE_GPU_SWITCH,
  applyGpuPreference,
} = require("../js/gpu-preference.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

/** A command line that starts with the given switches and records appends. */
function fakeCommandLine(initial = []) {
  const switches = new Set(initial);
  const appended = [];
  return {
    appended,
    hasSwitch(name) { return switches.has(name); },
    appendSwitch(name, value) { switches.add(name); appended.push([name, value]); },
  };
}

test("the switch name is the one Chromium reads", () => {
  assert.strictEqual(HIGH_PERFORMANCE_GPU_SWITCH, "force-high-performance-gpu");
});

[
  { name: "no switches yet", initial: [], applied: true },
  { name: "unrelated switch present", initial: ["lang"], applied: true },
  { name: "already forced (e.g. from the launch line)", initial: ["force-high-performance-gpu"], applied: false },
  { name: "GPU turned off with disable-gpu", initial: ["disable-gpu"], applied: false },
].forEach(({ name, initial, applied }) => {
  test(`${name}: applied=${applied}`, () => {
    const cl = fakeCommandLine(initial);
    assert.strictEqual(applyGpuPreference(cl), applied);
    const expected = applied ? [[HIGH_PERFORMANCE_GPU_SWITCH, undefined]] : [];
    assert.deepStrictEqual(cl.appended, expected);
  });
});

test("calling twice appends once", () => {
  const cl = fakeCommandLine();
  assert.strictEqual(applyGpuPreference(cl), true);
  assert.strictEqual(applyGpuPreference(cl), false);
  assert.strictEqual(cl.appended.length, 1);
});

[
  { name: "undefined", value: undefined },
  { name: "null", value: null },
  { name: "object without appendSwitch", value: { hasSwitch: () => false } },
].forEach(({ name, value }) => {
  test(`unusable command line (${name}) returns false without throwing`, () => {
    assert.strictEqual(applyGpuPreference(value), false);
  });
});

test("a command line without hasSwitch still gets the switch", () => {
  const appended = [];
  const cl = { appendSwitch(n) { appended.push(n); } };
  assert.strictEqual(applyGpuPreference(cl), true);
  assert.deepStrictEqual(appended, [HIGH_PERFORMANCE_GPU_SWITCH]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
