/**
 * Tests for showing the app window (js/app-boot.js).
 *
 * The window used to be created shown, so Windows painted an empty 1400x900
 * rectangle the moment the app started — long before the renderer had produced
 * a frame. It is built hidden instead and shown on the first signal that it has
 * painted. There is no stand-in window any more: what it paints is the real
 * page, with a loading row on every table boot is filling
 * (js/table-loading-mark.js).
 *
 * Contract:
 *   mainWindowOptions() — the window is built hidden (show: false) and keeps its
 *                         sandboxing/preload/size settings.
 *   bootWindows()       — shows the window on the first ready signal; a fallback
 *                         timer shows it anyway if that signal never arrives, so
 *                         the app can never end up running with nothing visible;
 *                         and it never shows twice. The first show is preceded
 *                         by exactly one maximize(), so the first visible frame
 *                         is already full-screen size.
 *
 * Black-box: fake window objects, injected timers, no Electron, no real window.
 *
 * Run: node tests/app-boot.test.cjs
 */

const assert = require("assert");
const {
  mainWindowOptions,
  bootWindows,
  BOOT_SHOW_TIMEOUT_MS,
} = require("../js/app-boot.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** A window that records what was done to it and can fire `ready-to-show`. */
function fakeWindow() {
  const win = {
    shown: 0,
    closed: 0,
    destroyed: 0,
    maximized: 0,
    calls: [], // every maximize/show in order — the first frame must be full-size
    handlers: {},
    once(event, fn) { (win.handlers[event] ||= []).push(fn); },
    show() { win.shown++; win.calls.push("show"); },
    maximize() { win.maximized++; win.calls.push("maximize"); },
    close() { win.closed++; },
    destroy() { win.destroyed++; },
    isDestroyed() { return win.destroyed > 0 || win.closed > 0; },
    emit(event) { (win.handlers[event] || []).forEach((fn) => fn()); },
  };
  return win;
}

/** Hand-rolled timer pair: nothing fires until fire() is called. */
function fakeTimers() {
  const timers = { pending: [], cleared: [], nextId: 1 };
  return {
    timers,
    setTimeout: (fn, ms) => {
      const id = timers.nextId++;
      timers.pending.push({ id, fn, ms });
      return id;
    },
    clearTimeout: (id) => { timers.cleared.push(id); },
    fire: () => {
      const due = timers.pending.filter((t) => !timers.cleared.includes(t.id));
      due.forEach((t) => t.fn());
    },
  };
}

const boot = (main, clock) =>
  bootWindows({
    main,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

// ── main window options ────────────────────────────────────────────────────

test("the main window is created hidden", () => {
  assert.strictEqual(mainWindowOptions({ preloadPath: "C:\\app\\preload.js" }).show, false);
});

test("the main window keeps its size, minimum size and dark backdrop", () => {
  const o = mainWindowOptions({ preloadPath: "p.js" });
  assert.strictEqual(o.width, 1400);
  assert.strictEqual(o.height, 900);
  assert.strictEqual(o.minWidth, 900);
  assert.strictEqual(o.minHeight, 600);
  assert.strictEqual(o.backgroundColor, "#1a1b1e");
  assert.strictEqual(o.autoHideMenuBar, true);
});

test("a hidden window still paints, or it can never report being ready", () => {
  // Measured: without this the renderer produced no frame while the window was
  // hidden, `ready-to-show` never arrived, and only the fallback timer showed
  // the app — seconds of nothing for a page that was already ready.
  assert.strictEqual(mainWindowOptions({ preloadPath: "p.js" }).paintWhenInitiallyHidden, true);
});

test("the renderer is not throttled when the window is out of sight", () => {
  // The boot render pass waits on animation frames between phases; a throttled
  // renderer stops producing them and the tables never finish.
  assert.strictEqual(
    mainWindowOptions({ preloadPath: "p.js" }).webPreferences.backgroundThrottling,
    false,
  );
});

test("the main window keeps the renderer sandboxed and loads the preload", () => {
  const o = mainWindowOptions({ preloadPath: "C:\\app\\preload.js" });
  assert.strictEqual(o.webPreferences.contextIsolation, true);
  assert.strictEqual(o.webPreferences.nodeIntegration, false);
  assert.strictEqual(o.webPreferences.preload, "C:\\app\\preload.js");
});

// ── showing the window ─────────────────────────────────────────────────────

test("nothing is shown before the window has painted", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  assert.strictEqual(main.shown, 0);
});

test("ready-to-show shows the app", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.emit("ready-to-show");
  assert.strictEqual(main.shown, 1);
});

test("the fallback timer is cancelled once the app is up", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.emit("ready-to-show");
  assert.strictEqual(clock.timers.cleared.length, 1);
  clock.fire(); // the cancelled timer must not run
  assert.strictEqual(main.shown, 1);
});

test("a renderer that never paints still gets its window shown", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  assert.strictEqual(clock.timers.pending.length, 1);
  assert.strictEqual(clock.timers.pending[0].ms, BOOT_SHOW_TIMEOUT_MS);
  clock.fire();
  assert.strictEqual(main.shown, 1);
});

test("ready-to-show arriving after the timeout does not show twice", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  clock.fire();
  main.emit("ready-to-show");
  assert.strictEqual(main.shown, 1);
});

test("any of the ready signals shows the window, whichever lands first", () => {
  const main = fakeWindow(), clock = fakeTimers();
  const contents = fakeWindow();
  bootWindows({
    main,
    readyOn: [[main, "ready-to-show"], [contents, "dom-ready"]],
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  contents.emit("dom-ready"); // the one that arrives on a window born hidden
  assert.strictEqual(main.shown, 1);
  main.emit("ready-to-show"); // the slower signal must not double up
  assert.strictEqual(main.shown, 1);
});

test("the trigger and the wait are reported", () => {
  const main = fakeWindow(), clock = fakeTimers();
  const seen = [];
  let clock_ = 1000;
  bootWindows({
    main,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onShown: (reason, ms) => seen.push([reason, ms]),
    now: () => clock_,
  });
  clock_ = 1450;
  main.emit("ready-to-show");
  assert.deepStrictEqual(seen, [["ready-to-show", 450]]);
});

test("the fallback says so, so a never-painting renderer is recognisable", () => {
  const main = fakeWindow(), clock = fakeTimers();
  const seen = [];
  bootWindows({
    main,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onShown: (reason) => seen.push(reason),
  });
  clock.fire();
  assert.deepStrictEqual(seen, ["timeout"]);
});

test("a second ready-to-show is ignored", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.emit("ready-to-show");
  main.emit("ready-to-show");
  assert.strictEqual(main.shown, 1);
});

test("a window destroyed before it paints is never shown", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.destroyed = 1; // window closed during boot
  clock.fire();
  assert.strictEqual(main.shown, 0);
});

// ── maximize before the first show ─────────────────────────────────────────

test("ready-to-show maximizes the window before the first show", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.emit("ready-to-show");
  assert.strictEqual(main.maximized, 1);
  assert.deepStrictEqual(main.calls, ["maximize", "show"]);
});

test("dom-ready maximizes the window before the first show", () => {
  const main = fakeWindow(), clock = fakeTimers();
  const contents = fakeWindow();
  bootWindows({
    main,
    readyOn: [[main, "ready-to-show"], [contents, "dom-ready"]],
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  contents.emit("dom-ready");
  assert.strictEqual(main.maximized, 1);
  assert.deepStrictEqual(main.calls, ["maximize", "show"]);
});

test("the fallback timer maximizes the window before the first show", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  clock.fire();
  assert.strictEqual(main.maximized, 1);
  assert.deepStrictEqual(main.calls, ["maximize", "show"]);
});

test("later triggers after the first show do not maximize again", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.emit("ready-to-show");
  main.emit("ready-to-show");
  main.emit("dom-ready");
  clock.fire();
  assert.strictEqual(main.shown, 1);
  assert.strictEqual(main.maximized, 1);
});

test("a window that cannot maximize is still shown", () => {
  // Harnesses and exotic window objects without maximize() must not crash
  // the handoff — the show is the part that may never be skipped.
  const main = fakeWindow(), clock = fakeTimers();
  delete main.maximize;
  boot(main, clock);
  main.emit("ready-to-show");
  assert.strictEqual(main.shown, 1);
  assert.strictEqual(main.maximized, 0);
});

test("a window destroyed before it paints is never maximized", () => {
  const main = fakeWindow(), clock = fakeTimers();
  boot(main, clock);
  main.destroyed = 1; // window closed during boot
  clock.fire();
  assert.strictEqual(main.maximized, 0);
});

// ── the timeout itself ─────────────────────────────────────────────────────

test("the fallback is short, because nothing stands in front of it", () => {
  // It used to be 30 s, which was affordable while a stand-in window was on
  // screen for the whole wait. With that gone the screen is EMPTY until this
  // fires, so a not-yet-painted window beats nothing at all.
  assert.ok(BOOT_SHOW_TIMEOUT_MS <= 8000, "an empty desktop must not last");
  assert.ok(BOOT_SHOW_TIMEOUT_MS >= 2000, "still long enough for a healthy cold start");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
