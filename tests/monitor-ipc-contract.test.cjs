/**
 * The preload bridge and the main process have to agree on channel names.
 *
 * They are separate files with no shared constant between them, so a renamed
 * channel fails at runtime as a silent unhandled invoke — the button does
 * nothing and no error reaches the page. This scans the sources and pairs
 * them, and checks the auto-start control the main process serves is actually
 * on the page.
 *
 * Run: node tests/monitor-ipc-contract.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const main = read("main.js");
const served = main;
const preload = read("preload.js");
const html = readIndexHtml();

let passed = 0, failed = 0;
// Async cases are collected here rather than raced by the runner.
const settling = [];
function test(name, fn) {
  const ok = () => { console.log(`  PASS: ${name}`); passed++; };
  const bad = (e) => { console.error(`  FAIL: ${name} - ${e.message}`); failed++; };
  try {
    const out = fn();
    if (out && typeof out.then === "function") { settling.push(out.then(ok, bad)); return; }
    ok();
  } catch (e) { bad(e); }
}

const matches = (src, re) => [...new Set([...src.matchAll(re)].map((m) => m[1]))];
const invoked = matches(preload, /ipcRenderer\.invoke\(\s*"([^"]+)"/g);
const handled = matches(served, /ipcMain\.handle\(\s*"([^"]+)"/g);

test("the bridge invokes something at all", () => {
  assert.ok(invoked.length >= 8, `only ${invoked.length} channels found — did the call shape change?`);
});

test("every channel the bridge invokes is handled in the main process", () => {
  const orphans = invoked.filter((c) => !handled.includes(c));
  assert.deepStrictEqual(orphans, [], `unhandled: ${orphans.join(", ")}`);
});

// The controls the renderer needs for the driver check and the auto-start
// opt-out; named here so removing one fails loudly.
["monitor:getAutoStart", "monitor:setAutoStart", "monitor:npcap", "monitor:installNpcap",
  "monitor:start", "monitor:stop", "monitor:setCity"].forEach((channel) => {
  test(`${channel} is served and reachable`, () => {
    assert.ok(handled.includes(channel), "not handled in main.js");
    assert.ok(invoked.includes(channel), "not exposed by preload.js");
  });
});

// ── pushed channels ────────────────────────────────────────────────────────
// invoke/handle is only half the surface. The main process also PUSHES, and a
// listener with no sender is the quieter failure of the two: the page simply
// never updates, which is what let a stale city sit under the button.
const listened = matches(preload, /ipcRenderer\.on\(\s*"([^"]+)"/g);
const pushed = matches(served, /sendToRenderer\(\s*"([^"]+)"/g);

test("every channel the bridge listens on is pushed by the main process", () => {
  const deaf = listened.filter((c) => !pushed.includes(c));
  assert.deepStrictEqual(deaf, [], `never sent: ${deaf.join(", ")}`);
});

["monitor:location", "monitor:prices", "monitor:stats",
  "monitor:own-orders"].forEach((channel) => {
  test(`${channel} is pushed and listened for`, () => {
    assert.ok(pushed.includes(channel), "not sent from main.js");
    assert.ok(listened.includes(channel), "no listener in preload.js");
  });
});

// The Roads panel is manual: it needs no IPC, so no roads: channel may exist on
// either side of the bridge, handled, pushed or listened for.
test("no roads: channel exists in the bridge or the main process", () => {
  const all = [...invoked, ...handled, ...listened, ...pushed].filter((c) => c.startsWith("roads:"));
  assert.deepStrictEqual(all, []);
  assert.ok(!preload.includes('exposeInMainWorld("roads'), "a roads bridge is still exposed");
});

test("the page consumes the pushed location", () => {
  const render = read("js/render-monitor.js");
  assert.ok(/onLocation/.test(render), "render-monitor never subscribes to onLocation");
});

// Which standing numbers are the player's own changes what a row may QUOTE, so
// a channel nobody subscribes to would leave the tables routing against the
// player's own listing — the reported Black Market bug.
test("the page consumes the pushed own orders", () => {
  const render = read("js/render-monitor.js");
  assert.ok(/onOwnOrders/.test(render), "render-monitor never subscribes to onOwnOrders");
  assert.ok(/setOwnOrderBooks/.test(render), "render-monitor never stores them");
});

// ── auto-start ─────────────────────────────────────────────────────────────
// Scans every `did-finish-load` and asks that the BOOT one, specifically,
// starts the capture against the pref.
test("the capture is started once the window has loaded", () => {
  const at = main.indexOf("did-finish-load");
  assert.ok(at !== -1, "no load hook in main.js");
  const boots = [...main.matchAll(/did-finish-load/g)]
    .filter((m) => {
      const hook = main.slice(m.index, m.index + 800);
      return /startMonitor\(\)/.test(hook) && /prefs\.autoStart/.test(hook);
    });
  assert.ok(boots.length > 0, "load hook does not start the monitor against the auto-start pref");
});

test("auto-start is checked against the driver before the capture is opened", () => {
  assert.ok(/isNpcapInstalled\(\)/.test(main), "main.js never checks for npcap");
  const start = main.slice(main.indexOf("function startMonitor"));
  const body = start.slice(0, start.indexOf("function stopMonitor"));
  assert.ok(body.indexOf("isNpcapInstalled") < body.indexOf("session.start()"),
    "the driver check must come before the capture is opened");
});

// ── the capture city ───────────────────────────────────────────────────────
// It has to reach the session BEFORE the first packet. The page pushes it, but
// the capture auto-starts while the page is still loading, so the main process
// keeps its own copy next to the auto-start pref.
test("the capture city is remembered in the main-process prefs", () => {
  const handler = main.slice(main.indexOf('ipcMain.handle("monitor:setCity"'));
  const body = handler.slice(0, handler.indexOf("});") + 3);
  assert.ok(/saveMonitorPrefs|captureCity/.test(body), "setCity does not persist the city");
});

test("the remembered city seeds the session before it starts", () => {
  assert.ok(/prefs\.captureCity/.test(main), "main.js never reads the saved capture city");
  const start = main.slice(main.indexOf("function startMonitor"));
  const body = start.slice(0, start.indexOf("function stopMonitor"));
  assert.ok(body.indexOf("seedLocation") < body.indexOf("session.start()"),
    "the city must be seeded before the capture is opened");
});

test("saving one monitor pref does not wipe the other", () => {
  const auto = main.slice(main.indexOf('ipcMain.handle("monitor:setAutoStart"'));
  const autoBody = auto.slice(0, auto.indexOf("});") + 3);
  assert.ok(/\.\.\.prefs/.test(autoBody), "setAutoStart replaces the prefs instead of merging");
  const city = main.slice(main.indexOf('ipcMain.handle("monitor:setCity"'));
  const cityBody = city.slice(0, city.indexOf("});") + 3);
  assert.ok(/\.\.\.prefs/.test(cityBody), "setCity replaces the prefs instead of merging");
});

test("the page carries the auto-start checkbox the bridge fills in", () => {
  assert.ok(/id="monitor-autostart"/.test(html), "checkbox missing from index.html");
  assert.ok(/id="monitor-autostart-label"/.test(html), "label missing from index.html");
  const render = read("js/render-monitor.js");
  assert.ok(/monitor-autostart-label/.test(render), "the label is never unhidden");
  assert.ok(/getAutoStart/.test(render) && /setAutoStart/.test(render), "the checkbox is not wired");
});

Promise.all(settling).then(() => {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
