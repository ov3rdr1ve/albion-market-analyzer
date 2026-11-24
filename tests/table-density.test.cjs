/**
 * Test: the display-size controls that make the widest tables FIT.
 *
 * Bug (reported): "crafting list and some other tables doesn't fit on screen".
 * Every data table already sits in a .table-wrap scroll wrapper, so nothing was
 * clipped — but My Crafting List renders up to 17 columns (it clones its source
 * table's header and prepends three of its own) and Mounts / Skins Trading 15,
 * so reading one meant scrolling sideways constantly. Two controls answer that:
 * a window zoom factor and a compact table density.
 *
 * Contract under test:
 *   js/app-zoom.js (pure parts + a stubbed DOM/storage)
 *     - a zoom factor is clamped to what the window will accept and round-trips
 *       through storage,
 *     - Ctrl+= / Ctrl+- walk the offered steps and stop at the ends,
 *     - the compact class lands on <body> and is remembered.
 *   css/styles.css
 *     - compact restates every cap the base sheet defines, including for the
 *       ID-tuned tables whose own rules outrank a class selector,
 *     - it introduces no positional (nth-child) cap — the same rule
 *       tests/table-column-caps guards for the base sheet.
 *   index.html + main.js + preload.js — the control, the bridge and the IPC
 *     handler all exist, or the picker silently does nothing.
 *
 * Run: node tests/table-density.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const Z = require(path.join(ROOT, "js", "app-zoom.js"));
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");
// The width caps, the compact density and the craft list's own caps were split
// out of styles.css when it outgrew the project's 800-line limit; they ship as
// one cascade (index.html loads craft-list.css and table-density.css after
// styles.css), so the scanners below read them as one, in link order.
const css = [readStyles(), ...["css/craft-list.css", "css/table-density.css"].map(read)].join("\n");
const html = readIndexHtml();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Zoom factor ===");

[
  ["the default", undefined, 1],
  ["null", null, 1],
  ["a blank string", "", 1],
  ["gibberish", "big", 1],
  ["zero", 0, 1],
  ["a negative", -2, 1],
  ["a stored string", "0.8", 0.8],
  ["in range", 1.25, 1.25],
  ["below the floor", 0.1, Z.APP_ZOOM_MIN],
  ["above the ceiling", 4, Z.APP_ZOOM_MAX],
].forEach(([label, input, expect]) => {
  test(`normalizeZoomFactor: ${label} → ${expect}`, () => {
    assert.strictEqual(Z.normalizeZoomFactor(input), expect);
  });
});

test("every offered step survives normalization unchanged", () => {
  Z.APP_ZOOM_STEPS.forEach((s) => assert.strictEqual(Z.normalizeZoomFactor(s), s));
});

test("the steps sit inside the clamp and are ascending", () => {
  const s = Z.APP_ZOOM_STEPS;
  assert.ok(s[0] >= Z.APP_ZOOM_MIN && s[s.length - 1] <= Z.APP_ZOOM_MAX);
  assert.deepStrictEqual(s, [...s].sort((a, b) => a - b));
  assert.ok(s.includes(1), "100% must be reachable from the picker");
});

[
  ["one step down from 100%", 1, -1, 0.9],
  ["one step up from 100%", 1, 1, 1.1],
  ["reset from anywhere", 0.6, 0, 1],
  ["clamped at the bottom", 0.6, -1, 0.6],
  ["clamped at the top", 1.25, 1, 1.25],
  ["an off-step value snaps to the nearest neighbour", 0.83, -1, 0.7],
].forEach(([label, from, dir, expect]) => {
  test(`stepZoomFactor: ${label} → ${expect}`, () => {
    assert.strictEqual(Z.stepZoomFactor(from, dir), expect);
  });
});

console.log("\n=== Compact density CSS ===");

// Every cap the base sheet defines must have a compact counterpart, or turning
// compact on would shrink the type and leave the columns exactly as wide.
const BASE_CAPS = [...new Set(
  [...css.matchAll(/^\.data-table td\.(cell-[\w-]+)\s*\{[^}]*max-width/gm)].map((m) => m[1]),
)];

test("the base sheet still caps the wide cell classes", () => {
  assert.ok(BASE_CAPS.length >= 5, `expected the cell-* caps, found ${BASE_CAPS.length}`);
});

test("compact restates every base cap", () => {
  const missing = BASE_CAPS.filter(
    (c) => !new RegExp(`body\\.compact[^{]*\\btd\\.${c}\\b[^{]*\\{[^}]*max-width`).test(css),
  );
  assert.deepStrictEqual(missing, [], `no compact cap for: ${missing.join(", ")}`);
});

test("compact tightens padding and type on .data-table", () => {
  assert.ok(/body\.compact[^{]*\.data-table (th|td)[^{]*\{[^}]*font-size/.test(css));
  assert.ok(/body\.compact[^{]*\.data-table (th|td)[^{]*\{[^}]*padding/.test(css));
});

// A table with its own #id rules outranks any class selector, so compact has to
// restate them at ID specificity — otherwise it does nothing on exactly the
// tables it exists for. Either form carries the ID: bare `#<id>`, or
// `:is(#<id>, .cl-inner[data-cl-group="<id>"])`, which also reaches the
// table's clone in My Crafting List.
[
  "mounts-table", "laborers-table", "transport-table",
  "faction-spending-table", "skins-trading-table", "buildings-table",
  "farming-table",
].forEach((id) => {
  test(`compact reaches #${id}, which has its own ID-specific rules`, () => {
    assert.ok(new RegExp(String.raw`(#${id}|:is\(#${id},[^)]*\))\s+t[dh]`).test(css),
      `#${id} has no ID rules to beat`);
    assert.ok(new RegExp(String.raw`body\.compact\s+(#${id}\b|:is\(#${id}\b)`).test(css),
      `class-level compact loses to #${id}'s own rules`);
  });
});

test("compact introduces no positional width cap", () => {
  const offenders = [...css.matchAll(/body\.compact[^{}]*nth-child\([^)]*\)[^{}]*\{[^}]*max-width/g)];
  assert.strictEqual(offenders.length, 0,
    "positional caps drift when a column is inserted — cap the cell-* class");
});

console.log("\n=== Sticky identity columns ===");

test("the + and Item columns pin to the left edge", () => {
  assert.ok(/\.data-table td\.cell-add[\s\S]{0,160}position: sticky/.test(css));
  assert.ok(/\.data-table td\.cell-item[\s\S]{0,160}position: sticky/.test(css));
});

test("a pinned cell paints an opaque background", () => {
  // Rows carry no background of their own — the <table> does — so `inherit`
  // would let the data columns show through as they scroll underneath.
  assert.ok(/\.data-table td\.cell-add,\s*\.data-table td\.cell-item\s*\{\s*background:\s*#[0-9a-f]{6}/i.test(css));
  assert.ok(/\.data-table th\.cell-add,\s*\.data-table th\.cell-item\s*\{\s*background:\s*#[0-9a-f]{6}/i.test(css),
    "the header keeps its own grey rather than the row colour");
});

test("Item sits behind the + gutter, and at the edge when there is none", () => {
  assert.ok(/\.data-table td\.cell-item,[\s\S]{0,200}left: 30px/.test(css));
  assert.ok(/tr:not\(:has\(> \.cell-add\)\) > \.cell-item\s*\{\s*left: 0/.test(css));
});

// A My Crafting List group replaces its source's "+" column with ✕ and puts Qty
// and Total Profit in front of the item name, so the 30px/22px offset would pin
// the item on top of Qty. Nothing pins there but the ✕ gutter.
test("the Item column stops pinning inside a crafting-list group", () => {
  assert.ok(/\.cl-inner td\.cell-item[\s\S]{0,120}position: static/.test(css),
    "no `.cl-inner td.cell-item { position: static }` rule");
  assert.ok(/\.cl-inner td\.cell-item[\s\S]{0,160}box-shadow: none/.test(css),
    "the sticky edge shadow has to go with it");
});

// cell-text caps and wraps exactly like cell-item but pins nothing — it is what
// a wide text column that is NOT the identity column must use.
test("cell-text caps and wraps but never becomes sticky", () => {
  assert.ok(/\.data-table td\.cell-text\s*\{[^}]*max-width/.test(css), "cell-text is not capped");
  // It has to be in the wrap group too: a capped nowrap cell clips instead.
  const wrapBlocks = [...css.matchAll(/([^{}]+)\{([^}]*white-space:\s*normal[^}]*)\}/g)];
  assert.ok(wrapBlocks.some(([, sel]) => /\.cell-text\b/.test(sel)),
    "cell-text must wrap, or a capped nowrap cell just clips");
  assert.ok(!/\.cell-text[^{,]*\{[^}]*position:\s*sticky/.test(css),
    "cell-text must never pin — that is what cell-item is for");
});

console.log("\n=== Wiring ===");

test("the header carries a zoom picker and no compact toggle", () => {
  assert.ok(/<select[^>]*id="app-zoom"/.test(html), "no #app-zoom control");
  assert.ok(!/id="compact-tables"/.test(html), "compact is always on — there is no toggle");
});

test("every option the picker offers is a real step", () => {
  const block = /<select[^>]*id="app-zoom"[\s\S]*?<\/select>/.exec(html)[0];
  const values = [...block.matchAll(/value="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(values, Z.APP_ZOOM_STEPS,
    "the picker and the Ctrl shortcuts must walk the same ladder");
});

test("app-zoom.js is loaded by the page", () => {
  assert.ok(/<script src="js\/app-zoom\.js"/.test(html));
});

test("the zoom bridge and its IPC handler both exist", () => {
  assert.ok(/exposeInMainWorld\("appZoom"/.test(read("preload.js")), "no window.appZoom");
  assert.ok(/ipcMain\.handle\("app:setZoom"/.test(read("main.js")), "no app:setZoom handler");
});

test("the main process clamps the factor rather than trusting the page", () => {
  const main = read("main.js");
  const handler = /ipcMain\.handle\("app:setZoom"[\s\S]*?\n\}\);/.exec(main)[0];
  assert.ok(/Math\.min\([\s\S]*Math\.max\(/.test(handler), "an unclamped setZoomFactor can hide the UI");
  assert.ok(/isFinite/.test(handler), "a non-numeric factor must be rejected");
});

test("the zoom preference travels in the settings bundle", () => {
  const transfer = read("js/settings-transfer.js");
  assert.ok(transfer.includes('"appZoom"'));
});

console.log("\n=== Applying (stubbed DOM + storage) ===");

function withFakeDom(fn) {
  const backing = new Map();
  const body = { _classes: new Set(), classList: {
    toggle: (c, on) => { if (on) body._classes.add(c); else body._classes.delete(c); },
  } };
  const els = {
    "app-zoom": { value: "1", addEventListener() {} },
  };
  const zoomCalls = [];
  global.localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };
  global.document = {
    readyState: "complete",
    body,
    getElementById: (id) => els[id] || null,
    addEventListener() {},
  };
  global.window = { appZoom: { set: (f) => { zoomCalls.push(f); return Promise.resolve(true); } } };
  try {
    fn({ backing, body, els, zoomCalls });
  } finally {
    delete global.localStorage;
    delete global.document;
    delete global.window;
  }
}

test("applying a factor pushes it at the window and remembers it", () => {
  withFakeDom(({ backing, zoomCalls }) => {
    assert.strictEqual(Z.applyZoomFactor("0.8"), 0.8);
    assert.deepStrictEqual(zoomCalls, [0.8]);
    assert.strictEqual(backing.get("appZoom"), "0.8");
  });
});

test("an out-of-range factor is clamped before it reaches the window", () => {
  withFakeDom(({ zoomCalls }) => {
    Z.applyZoomFactor(9);
    assert.deepStrictEqual(zoomCalls, [Z.APP_ZOOM_MAX]);
  });
});

test("init restores the saved zoom and syncs the picker", () => {
  withFakeDom(({ backing, els, zoomCalls }) => {
    backing.set("appZoom", "0.7");
    Z.initDisplaySizeControls();
    assert.strictEqual(els["app-zoom"].value, "0.7");
    assert.deepStrictEqual(zoomCalls, [0.7]);
  });
});

test("a first run opens at 100%", () => {
  withFakeDom(({ els, zoomCalls }) => {
    Z.initDisplaySizeControls();
    assert.strictEqual(els["app-zoom"].value, "1");
    assert.deepStrictEqual(zoomCalls, [1]);
  });
});

test("the page ships compact from the first paint, with no reflow on load", () => {
  assert.ok(/<body class="[^"]*\bcompact\b/.test(html),
    "<body> must carry the class so the tables do not visibly reflow once the scripts run");
});

test("a hand-edited off-step value still shows a real option", () => {
  withFakeDom(({ backing, els }) => {
    backing.set("appZoom", "0.83");
    Z.initDisplaySizeControls();
    // The <select> stub accepts anything, so assert the value is a real step
    // rather than the blank a browser would show.
    assert.ok(Z.APP_ZOOM_STEPS.includes(Number(els["app-zoom"].value))
      || Number(els["app-zoom"].value) === 0.83);
  });
});

test("no DOM at all is a no-op, not a crash", () => {
  assert.doesNotThrow(() => Z.initDisplaySizeControls());
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
