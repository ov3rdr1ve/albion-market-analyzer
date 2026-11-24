/**
 * Test (TLD): the header "All Specs" control sets every table's specialization
 * levels at once, and its Reset undoes it.
 *
 * The control is a one-shot action, not a stored mode: it writes into the same
 * specLevels:<scope> entries the ⚙ panels edit. Because a global 0/100 would
 * otherwise destroy hand-typed levels, every ⚙ write is recorded per node in
 * specLevelsMine and Reset replays that record. The record is never consumed, so
 * Reset is repeatable, and it can never wipe a level the user typed — including
 * one typed after a global apply, or typed on a profile that never touched the
 * header control at all.
 *
 * jsdom isn't vendored here, so the markup/wiring half asserts at the source
 * level (same style as tests/spec-settings-panel.test.cjs); the behaviour half
 * runs the real modules against a stubbed localStorage.
 *
 * Run: node tests/global-spec-level.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const assert = require("assert");
const { loadFocusSpecWithPanel } = require("./helpers/load-focus-spec.cjs");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf-8");
const html = readIndexHtml();
const appSrc = appSource();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

// A mastery (defaults to 100) and a specialization (defaults to 0) per scope,
// so "set all to 0" and "set all to 100" are both proved to move something.
function sampleNodes(api, scope) {
  const ids = api.specNodeIdsForScope(scope);
  const mastery = ids.find((id) => api.defaultSpecLevel(id) === 100);
  const spec = ids.find((id) => api.defaultSpecLevel(id) === 0);
  return { ids, mastery, spec };
}

console.log("Global \"All Specs\" Control Tests\n");

// ── the control itself ─────────────────────────────────────────────────────

console.log("=== markup and wiring ===");

const selectMatch = html.match(/<select\s+id="global-spec-level"[\s\S]*?<\/select>/);

test("index.html has the #global-spec-level select in the header", () => {
  assert.ok(selectMatch, "no <select id=\"global-spec-level\"> in index.html");
});

test("the select offers exactly the neutral label plus the three actions", () => {
  const values = [...selectMatch[0].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(values, ["", "0", "100", "reset"]);
});

test("every option is translatable", () => {
  const options = selectMatch[0].match(/<option [^>]*>/g) || [];
  options.forEach((opt) => {
    assert.ok(/data-i18n="/.test(opt), `option without data-i18n: ${opt}`);
  });
});

test("the handler snaps the select back to the neutral value after reading it", () => {
  const handler = appSrc.match(/globalSpecSelect\.addEventListener\("change",[\s\S]*?\n {2}\}\);/);
  assert.ok(handler, "no change handler for #global-spec-level in js/app.js");
  const body = handler[0];
  const readAt = body.indexOf("globalSpecSelect.value;");
  const clearAt = body.indexOf('globalSpecSelect.value = "";');
  assert.ok(readAt !== -1, "handler never reads the chosen value");
  assert.ok(clearAt > readAt, "handler must clear the select AFTER reading it");
  assert.ok(/setAllTablesSpecLevels\(choice\)/.test(body), "handler never applies the choice");
});

// ── applying a level ───────────────────────────────────────────────────────

console.log("\n=== set all to 0 / 100 ===");

test("\"0\" puts every node of every scope at 0, masteries included", () => {
  const api = loadFocusSpecWithPanel();
  api.setAllTablesSpecLevels("0");
  Object.keys(api.TABLE_SPEC_BRANCHES).forEach((scope) => {
    const { ids, mastery } = sampleNodes(api, scope);
    ids.forEach((nodeId) => {
      assert.strictEqual(api.getSpecLevel(scope, nodeId), 0, `${scope}: ${nodeId}`);
    });
    // transport-table is refining-only and refining chains have no mastery, so
    // all-zero IS its default — nothing is stored and the ⚙ shows no marker.
    assert.strictEqual(api.hasCustomSpec(scope), mastery !== undefined,
      `${scope}: custom marker should follow whether it owns a mastery node`);
  });
});

test("\"100\" puts every node of every scope at 100", () => {
  const api = loadFocusSpecWithPanel();
  api.setAllTablesSpecLevels("100");
  Object.keys(api.TABLE_SPEC_BRANCHES).forEach((scope) => {
    api.specNodeIdsForScope(scope).forEach((nodeId) => {
      assert.strictEqual(api.getSpecLevel(scope, nodeId), 100, `${scope}: ${nodeId}`);
    });
    assert.strictEqual(api.hasCustomSpec(scope), true, `${scope} should read as custom`);
  });
});

test("a scope is written only for the branches its ⚙ panel lists", () => {
  const api = loadFocusSpecWithPanel();
  api.setAllTablesSpecLevels("100");
  // mounts-table is breeding-only: a gear node must stay at its default there.
  const gearNode = Object.keys(api.FOCUS_SPEC_NODES)
    .find((id) => api.FOCUS_SPEC_NODES[id].branch === "gear");
  assert.strictEqual(
    api.getSpecLevel("mounts-table", gearNode),
    api.defaultSpecLevel(gearNode),
    "gear leaked into the mounts scope",
  );
});

test("every node in the catalogue is covered by some scope", () => {
  const api = loadFocusSpecWithPanel();
  const branches = new Set();
  Object.values(api.TABLE_SPEC_BRANCHES).forEach((list) => list.forEach((b) => branches.add(b)));
  Object.keys(api.FOCUS_SPEC_NODES).forEach((id) => {
    assert.ok(branches.has(api.FOCUS_SPEC_NODES[id].branch), `${id} is in no scope`);
  });
});

// ── reset ──────────────────────────────────────────────────────────────────

console.log("\n=== reset ===");

test("on a fresh profile, reset lands on the per-node defaults", () => {
  const api = loadFocusSpecWithPanel();
  api.setAllTablesSpecLevels("reset");
  Object.keys(api.TABLE_SPEC_BRANCHES).forEach((scope) => {
    sampleNodes(api, scope).ids.forEach((nodeId) => {
      assert.strictEqual(api.getSpecLevel(scope, nodeId), api.defaultSpecLevel(nodeId),
        `${scope}: ${nodeId}`);
    });
    assert.strictEqual(api.hasCustomSpec(scope), false, `${scope} should be back at defaults`);
  });
});

test("reset keeps hand-typed levels when the header control was never used", () => {
  // The reported bug: levels typed in the ⚙ panels only. There is nothing to
  // undo, so Reset must be a no-op — never a wipe to the defaults.
  const api = loadFocusSpecWithPanel();
  const { mastery, spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 60);
  api.setSpecLevel("crafting-table", mastery, 40);

  api.setAllTablesSpecLevels("reset");

  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 60);
  assert.strictEqual(api.getSpecLevel("crafting-table", mastery), 40);
});

test("reset restores hand-typed levels after a global apply", () => {
  const api = loadFocusSpecWithPanel();
  const { mastery, spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 60);
  api.setSpecLevel("crafting-table", mastery, 40);
  api.setSpecLevel("consumable-table", sampleNodes(api, "consumable-table").spec, 25);

  api.setAllTablesSpecLevels("100");
  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 100, "global apply did not land");

  api.setAllTablesSpecLevels("reset");
  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 60);
  assert.strictEqual(api.getSpecLevel("crafting-table", mastery), 40);
  assert.strictEqual(
    api.getSpecLevel("consumable-table", sampleNodes(api, "consumable-table").spec), 25);
  assert.strictEqual(api.hasMySpecLevels(), true, "the record must survive the restore");
});

test("reset drops nodes the global apply raised but the user never typed", () => {
  const api = loadFocusSpecWithPanel();
  const { ids, spec } = sampleNodes(api, "crafting-table");
  const untouched = ids.find((id) => id !== spec && api.defaultSpecLevel(id) === 0);
  api.setSpecLevel("crafting-table", spec, 60);

  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("reset");

  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 60);
  assert.strictEqual(api.getSpecLevel("crafting-table", untouched), 0,
    "a node the user never typed must fall back to its default");
});

test("100 then 0 then reset still lands on my levels, not the intermediate state", () => {
  const api = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 70);

  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("0");
  api.setAllTablesSpecLevels("reset");

  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 70);
});

test("a ⚙ edit made while a global level is active survives reset", () => {
  const api = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 55);

  api.setAllTablesSpecLevels("100");
  api.setSpecLevel("crafting-table", spec, 15); // hand edit on top of the global 100
  api.setAllTablesSpecLevels("reset");

  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 15,
    "the newest hand-typed level is the one to restore");
});

test("a ⚙ reset back to the default is recorded too", () => {
  const api = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 55);
  api.setSpecLevel("crafting-table", spec, "");   // cleared in the panel

  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("reset");

  assert.strictEqual(api.getSpecLevel("crafting-table", spec), api.defaultSpecLevel(spec));
});

test("an empty record is honoured — a clean profile resets to defaults, not 100", () => {
  const api = loadFocusSpecWithPanel();
  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("reset");
  Object.keys(api.TABLE_SPEC_BRANCHES).forEach((scope) => {
    assert.strictEqual(api.hasCustomSpec(scope), false, `${scope} left custom after reset`);
  });
});

test("reset is idempotent — a second one changes nothing", () => {
  const api = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 45);
  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("reset");   // back to 45
  api.setAllTablesSpecLevels("reset");   // still 45
  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 45);
});

test("the global apply itself never enters the record", () => {
  const api = loadFocusSpecWithPanel();
  api.setAllTablesSpecLevels("100");
  assert.deepStrictEqual(api.exportMySpecLevels(), {},
    "a header apply must stay undoable");
});

// ── persistence ────────────────────────────────────────────────────────────

console.log("\n=== persistence ===");

test("levels and the record both survive a reload", () => {
  const store = {};
  const first = loadFocusSpecWithPanel(store);
  const { spec } = sampleNodes(first, "crafting-table");
  first.setSpecLevel("crafting-table", spec, 35);
  first.setAllTablesSpecLevels("0");

  const reloaded = loadFocusSpecWithPanel(store); // same backing store, fresh module
  assert.strictEqual(reloaded.getSpecLevel("crafting-table", spec), 0);
  assert.strictEqual(reloaded.hasMySpecLevels(), true);
  reloaded.setAllTablesSpecLevels("reset");
  assert.strictEqual(reloaded.getSpecLevel("crafting-table", spec), 35);
});

test("a corrupt record entry is dropped instead of throwing", () => {
  const store = { specLevelsMine: "{not json" };
  const api = loadFocusSpecWithPanel(store);
  assert.deepStrictEqual(api.exportMySpecLevels(), {});
  api.setAllTablesSpecLevels("reset"); // must not throw
});

test("importing a settings bundle makes the imported levels the record", () => {
  // Otherwise Reset would roll the imported profile back to what this machine
  // had before the import.
  const api = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(api, "crafting-table");
  api.setSpecLevel("crafting-table", spec, 20);

  api.importSpecLevels({ "crafting-table": { [spec]: 80 } });
  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("reset");

  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 80);
});

test("settings-transfer-ui no longer reaches for the retired snapshot API", () => {
  const uiSrc = read("js/settings-transfer-ui.js");
  assert.ok(/importSpecLevels\(bundle\.specLevels\)/.test(uiSrc),
    "no importSpecLevels call in settings-transfer-ui.js");
  assert.ok(!/SpecSnapshot/.test(uiSrc), "still calls a removed *SpecSnapshot function");
});

// ── migration off the old one-shot snapshot ────────────────────────────────

console.log("\n=== migration ===");

test("a pending specLevelsBackup becomes the record and the old key goes", () => {
  const probe = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(probe, "crafting-table");
  const store = {
    specLevelsBackup: JSON.stringify({ "crafting-table": { [spec]: 65 } }),
    "specLevels:crafting-table": JSON.stringify({ [spec]: 100 }), // mid global apply
  };

  const api = loadFocusSpecWithPanel(store);
  assert.strictEqual(store.specLevelsBackup, undefined, "the old key must be dropped");
  api.setAllTablesSpecLevels("reset");
  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 65);
});

test("with no snapshot the live levels seed the record", () => {
  const probe = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(probe, "crafting-table");
  const store = { "specLevels:crafting-table": JSON.stringify({ [spec]: 30 }) };

  const api = loadFocusSpecWithPanel(store);
  api.setAllTablesSpecLevels("100");
  api.setAllTablesSpecLevels("reset");
  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 30);
});

test("migration runs once — it never overwrites an existing record", () => {
  const probe = loadFocusSpecWithPanel();
  const { spec } = sampleNodes(probe, "crafting-table");
  const store = {
    specLevelsMine: JSON.stringify({ "crafting-table": { [spec]: 50 } }),
    "specLevels:crafting-table": JSON.stringify({ [spec]: 100 }),
  };

  const api = loadFocusSpecWithPanel(store);
  api.setAllTablesSpecLevels("reset");
  assert.strictEqual(api.getSpecLevel("crafting-table", spec), 50);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
