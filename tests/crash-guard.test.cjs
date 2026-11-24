/**
 * Tests for the main-process crash instrumentation (js/crash-guard.js,
 * js/main-log.js).
 *
 * On 2026-09-20 the app died silently 5 ms into a packet burst: one stderr
 * line (`crashpad_client_win.cc:867] not connected`), no WER event, no .dmp,
 * no Crashpad dir — because nothing ever called `crashReporter.start`. A death
 * with no dump names no module, so the fix is instrumentation: start the
 * crash reporter (dumps on disk) and log every process-death signal to a
 * daily file, synchronously, before the process can vanish.
 *
 * Contract:
 *   installCrashGuard() — starts the crash reporter exactly once, with
 *                         uploads off and BEFORE any listener is attached;
 *                         logs uncaughtException (without exiting or quitting),
 *                         unhandledRejection, child-process-gone, the quit
 *                         path and the final process exit code; hands back a
 *                         helper that tracks `render-process-gone` on any
 *                         webContents.
 *   createLogger()      — appends ISO-stamped lines to main-YYYY-MM-DD.log in
 *                         an injected dir, keeps the 7 newest main-*.log files,
 *                         and never throws no matter what the filesystem does.
 *
 * Black-box: fake app, fake process, fake crashReporter, fake fs — no
 * Electron, no real userData, no disk.
 *
 * Run: node tests/crash-guard.test.cjs
 */

const assert = require("assert");
const path = require("path");
const { installCrashGuard } = require("../js/crash-guard.js");
const { createLogger } = require("../js/main-log.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── fakes ──────────────────────────────────────────────────────────────────

/** An EventEmitters-lite app/process that records what was subscribed. */
function fakeEmitter() {
  const em = {
    handlers: {},
    on(event, fn) { (em.handlers[event] ||= []).push(fn); },
    emit(event, ...args) { (em.handlers[event] || []).forEach((fn) => fn(...args)); },
    listenerNames(event) { return (em.handlers[event] || []).map((f) => f.name); },
  };
  return em;
}

/** The electron app surface the guard touches, plus quit/exit spies. */
function fakeApp() {
  const app = fakeEmitter();
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; };
  app.exitCodes = [];
  app.exit = (code) => { app.exitCodes.push(code); };
  return app;
}

/** A process whose exit is a recording, not a death. */
function fakeProcess() {
  const proc = fakeEmitter();
  proc.exitCodes = [];
  proc.exit = (code) => { proc.exitCodes.push(code); };
  return proc;
}

/** The crashReporter API surface the guard uses, recording calls. */
function fakeCrashReporter() {
  return {
    starts: [],
    start(opts) { this.starts.push(opts); },
  };
}

/** A logger factory that captures its options and hands back a recorder. */
function fakeLoggerFactory() {
  const factory = (opts) => {
    factory.createdWith.push(opts);
    const logger = { lines: [], log(msg) { logger.lines.push(msg); } };
    factory.loggers.push(logger);
    return logger;
  };
  factory.createdWith = [];
  factory.loggers = [];
  return factory;
}

/** A fake filesystem: records appends/removals, lists what it is told to. */
function fakeFs(dirEntries) {
  const fake = {
    dirEntries,
    appends: [],
    removed: [],
    mkdirCalls: 0,
    failRemove: null,
  };
  fake.mkdir = () => { fake.mkdirCalls++; };
  fake.append = (file, data) => { fake.appends.push([file, data]); };
  fake.readdir = () => fake.dirEntries;
  fake.remove = (file) => {
    fake.removed.push(file);
    if (fake.failRemove && fake.failRemove(file)) throw new Error("EBUSY: file locked");
  };
  return fake;
}

const install = (over = {}) => {
  const app = over.app || fakeApp();
  const proc = over.process || fakeProcess();
  const crashReporter = over.crashReporter || fakeCrashReporter();
  const loggerFactory = over.createLogger || fakeLoggerFactory();
  const out = installCrashGuard({
    app,
    process: proc,
    crashReporter,
    createLogger: loggerFactory,
    logDir: over.logDir ?? "C:\\logdir",
    ...over.extra,
  });
  return { app, proc, crashReporter, loggerFactory, ...out };
};

const lines = (g) => g.loggerFactory.loggers[0].lines.join("\n");

// ── the crash reporter starts, first of all ────────────────────────────────

test("the crash reporter is started exactly once, with uploads off", () => {
  const g = install();
  assert.strictEqual(g.crashReporter.starts.length, 1);
  assert.strictEqual(g.crashReporter.starts[0].uploadToServer, false);
});

test("the crash reporter starts BEFORE any listener is attached", () => {
  // The whole point: a dump pipeline that exists before anything can die.
  const order = [];
  install();
  // Re-run the install against order-tracking fakes to observe the sequence.
  const app = fakeApp(), proc = fakeProcess(), cr = fakeCrashReporter();
  cr.start = (o) => order.push("crashReporter.start");
  app.on = (e) => order.push(`app.on:${e}`);
  proc.on = (e) => order.push(`process.on:${e}`);
  installCrashGuard({
    app, process: proc, crashReporter: cr,
    createLogger: () => ({ log() {} }),
    logDir: "C:\\logdir",
  });
  assert.strictEqual(order[0], "crashReporter.start");
  assert.ok(order.length > 1, "listeners must still be attached");
});

test("the logger is built for the injected directory", () => {
  const g = install({ logDir: "D:\\somewhere\\logs" });
  assert.strictEqual(g.loggerFactory.createdWith[0].dir, "D:\\somewhere\\logs");
});

// ── uncaughtException: evidence, not an exit ───────────────────────────────

test("an uncaught exception is logged with its stack", () => {
  const g = install();
  g.proc.emit("uncaughtException", new Error("boom"));
  assert.ok(lines(g).includes("uncaughtException"), "names the signal");
  assert.ok(lines(g).includes("boom"), "carries the message");
});

test("an uncaught exception does NOT exit, quit or set an exit code", () => {
  // The guard's job is evidence at death, not deciding death: the process
  // must be left to live or die on its own terms.
  const g = install();
  g.proc.emit("uncaughtException", new Error("boom"));
  assert.deepStrictEqual(g.proc.exitCodes, []);
  assert.deepStrictEqual(g.app.exitCodes, []);
  assert.strictEqual(g.app.quitCalls, 0);
});

test("a non-Error uncaught exception is still logged", () => {
  const g = install();
  g.proc.emit("uncaughtException", "a thrown string");
  assert.ok(lines(g).includes("a thrown string"));
});

test("an unhandled rejection is logged with reason and stack", () => {
  const g = install();
  g.proc.emit("unhandledRejection", new Error("rejected reason"), {});
  assert.ok(lines(g).includes("unhandledRejection"), "names the signal");
  assert.ok(lines(g).includes("rejected reason"), "carries the reason");
});

// ── child processes and renderers ──────────────────────────────────────────

test("a gone child process is logged with type, reason and exitCode", () => {
  const g = install();
  g.app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });
  const seen = lines(g);
  assert.ok(seen.includes("child-process-gone"), "names the signal");
  assert.ok(seen.includes("type=GPU"), `type: ${seen}`);
  assert.ok(seen.includes("reason=crashed"), `reason: ${seen}`);
  assert.ok(seen.includes("exitCode=1"), `exitCode: ${seen}`);
});

test("a gone utility process is logged with its service name", () => {
  // The capture runs in a utilityProcess named albion-capture (plan.md); a
  // native fault in cap now shows up here instead of killing the app.
  const g = install();
  g.app.emit("child-process-gone", {}, {
    type: "Utility", name: "albion-capture", reason: "crashed", exitCode: -1073741819,
  });
  const seen = lines(g);
  assert.ok(seen.includes("type=Utility"), `type: ${seen}`);
  assert.ok(seen.includes("name=albion-capture"), `name: ${seen}`);
  assert.ok(seen.includes("exitCode=-1073741819"), `exitCode: ${seen}`);
});

test("a gone child with no name does not log name=undefined", () => {
  const g = install();
  g.app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 1 });
  assert.ok(!lines(g).includes("name="), lines(g));
});

test("the render-process-gone helper registers on a webContents", () => {
  const g = install();
  const contents = fakeEmitter();
  g.trackWebContents(contents);
  assert.ok(
    (contents.handlers["render-process-gone"] || []).length === 1,
    "one render-process-gone listener",
  );
});

test("a gone renderer is logged with reason and exitCode", () => {
  const g = install();
  const contents = fakeEmitter();
  g.trackWebContents(contents);
  contents.emit("render-process-gone", {}, { reason: "oom", exitCode: 7 });
  const seen = lines(g);
  assert.ok(seen.includes("render-process-gone"), "names the signal");
  assert.ok(seen.includes("reason=oom"), `reason: ${seen}`);
  assert.ok(seen.includes("exitCode=7"), `exitCode: ${seen}`);
});

test("webContents created after the install are tracked automatically", () => {
  const g = install();
  const contents = fakeEmitter();
  g.app.emit("web-contents-created", {}, contents);
  contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 2 });
  assert.ok(lines(g).includes("render-process-gone"));
});

// ── the quit path ──────────────────────────────────────────────────────────

test("will-quit is logged", () => {
  const g = install();
  g.app.emit("will-quit", {});
  assert.ok(lines(g).includes("will-quit"));
});

test("quit is logged with its exit code", () => {
  const g = install();
  g.app.emit("quit", {}, 3);
  assert.ok(lines(g).includes("quit"), "names the signal");
  assert.ok(lines(g).includes("exitCode=3"), `code: ${lines(g)}`);
});

test("the process exit code is logged", () => {
  const g = install();
  g.proc.emit("exit", 0);
  assert.ok(lines(g).includes("code=0"), `code: ${lines(g)}`);
});

// ── the logger: file naming and line format ────────────────────────────────

/** A fixed local timestamp: 2026-09-20 13:29:21.706, the crash moment. */
const crashMoment = new Date(2026, 8, 20, 13, 29, 21, 706);
/**
 * Where the logger's default (real) path.join puts `name` in the test dir.
 * The app ships on Windows, but the suite runs on any OS: the expectation goes
 * through the same join as the code, so the exact-path checks hold everywhere.
 */
const inLogDir = (name) => path.join("C:\\logdir", name);
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("a line lands in main-YYYY-MM-DD.log in the injected dir", () => {
  const fs = fakeFs([]);
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    ...fs,
  });
  logger.log("zone joined");
  const [file, data] = fs.appends[0];
  assert.strictEqual(file, inLogDir(`main-${ymd(crashMoment)}.log`));
  assert.strictEqual(data, `${crashMoment.toISOString()} zone joined\n`);
});

test("the logger appends; it never rewrites what is already there", () => {
  const fs = fakeFs([]);
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    ...fs,
  });
  logger.log("first");
  logger.log("second");
  assert.deepStrictEqual(
    fs.appends.map(([, data]) => data),
    [`${crashMoment.toISOString()} first\n`, `${crashMoment.toISOString()} second\n`],
  );
});

// ── the logger: rotation ───────────────────────────────────────────────────

test("rotation keeps the 7 newest main-*.log and deletes the older ones", () => {
  // Deliberately unsorted: real readdir order is directory order, and the
  // newest-seven choice must not depend on luck.
  const shuffled = ["main-2026-09-05.log", "main-2026-09-01.log", "main-2026-09-09.log",
    "monitor-prefs.json", "main-2026-09-03.log", "main-2026-09-07.log",
    "main-2026-09-02.log", "main-2026-09-06.log", "Crashpad", "main-2026-09-04.log",
    "main-2026-09-08.log"];
  const fs = fakeFs(shuffled);
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    ...fs,
  });
  logger.log("today");
  // Today's file plus the 6 newest older ones survive; the 2 oldest go.
  assert.deepStrictEqual(fs.removed, [
    inLogDir("main-2026-09-01.log"),
    inLogDir("main-2026-09-02.log"),
  ]);
  // Junk is never touched: only main-*.log is rotation's business.
  assert.ok(!fs.removed.some((f) => !/main-\d{4}-\d{2}-\d{2}\.log$/.test(f)));
});

test("rotation scans once even across several writes on the same day", () => {
  const fs = fakeFs(["main-2026-09-01.log"]);
  let readdirCalls = 0;
  const fsWithCount = { ...fs, readdir: () => { readdirCalls++; return fs.dirEntries; } };
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    ...fsWithCount,
  });
  logger.log("one");
  logger.log("two");
  assert.strictEqual(readdirCalls, 1);
});

// ── the logger: never throws ───────────────────────────────────────────────

test("a failing append does not throw", () => {
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    mkdir: () => {},
    append: () => { throw new Error("ENOSPC: no space left on device"); },
    readdir: () => [],
    remove: () => {},
  });
  logger.log("doomed");
});

test("a failing mkdir does not throw and does not stop logging", () => {
  const fs = fakeFs([]);
  const failingMkdir = () => { throw new Error("EACCES: permission denied"); };
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    ...fs,
    mkdir: failingMkdir,
  });
  logger.log("still logged");
  assert.strictEqual(fs.appends.length, 1, "the append was still attempted");
});

test("a locked log file does not break rotation of the others", () => {
  const fs = fakeFs([
    "main-2026-09-01.log", "main-2026-09-02.log", "main-2026-09-03.log",
    "main-2026-09-04.log", "main-2026-09-05.log", "main-2026-09-06.log",
    "main-2026-09-07.log", "main-2026-09-08.log", "main-2026-09-09.log",
  ]);
  fs.failRemove = (f) => f.endsWith("09-01.log");
  const logger = createLogger({
    dir: "C:\\logdir",
    now: () => new Date(crashMoment),
    ...fs,
  });
  logger.log("today");
  assert.ok(fs.removed.some((f) => f.endsWith("09-02.log")), "the others still got removed");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
