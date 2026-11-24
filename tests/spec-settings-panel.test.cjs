/**
 * Test (TLD): the ⚙ Specs panel is wired to every table that uses focus.
 *
 * jsdom isn't vendored here, so — like tests/header-controls-no-collapse.test.cjs
 * — this asserts the wiring at the source level: buttons exist in index.html for
 * exactly the scopes the panel knows about, every scope's branches resolve to
 * real Destiny Board nodes, and each scoped table's renderer is bound so the
 * per-table scan buttons and search fetches see the same levels.
 *
 * Run: node tests/spec-settings-panel.test.cjs
 */

const fs = require("fs");
const { appSource } = require("./helpers/app-source.cjs");
const path = require("path");
const assert = require("assert");

const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf-8");
const { readIndexHtml } = require("./helpers/page-source.cjs");
const html = readIndexHtml();
const panelSrc = read("js/spec-settings-panel.js");
const appSrc = appSource();
const {
  TABLE_SPEC_BRANCHES, SPEC_BRANCH_LABELS, SPEC_SCOPED_RENDERERS,
  specNodeIdsForScope,
} = require("../js/spec-settings-panel.js");
const { FOCUS_SPEC_NODES, FOCUS_SPEC_GROUPS } = require("../js/focus-spec-nodes.js");
const { defaultSpecLevel } = require("../js/focus-spec.js");
// The panel is a browser script: it reads the node catalogue off the global that
// index.html has already loaded, so give it the same one here.
Object.assign(global, { FOCUS_SPEC_NODES, FOCUS_SPEC_GROUPS });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

const buttonScopes = [...html.matchAll(/class="spec-settings-btn"[^>]*data-spec-scope="([^"]+)"/g)]
  .map((m) => m[1]);

console.log("Spec Settings Panel Tests\n");

test("index.html has a ⚙ button for exactly the panel's scopes", () => {
  assert.deepStrictEqual(buttonScopes.slice().sort(), Object.keys(TABLE_SPEC_BRANCHES).sort());
});

test("every ⚙ button targets a table that exists in index.html", () => {
  buttonScopes.forEach((scope) => {
    assert.ok(html.includes(`<table id="${scope}"`), `no <table id="${scope}">`);
  });
});

test("every scope's branches exist in the node data and are labelled", () => {
  const branches = new Set(Object.values(FOCUS_SPEC_NODES).map((n) => n.branch));
  Object.entries(TABLE_SPEC_BRANCHES).forEach(([scope, list]) => {
    assert.ok(list.length > 0, `${scope} lists no branches`);
    list.forEach((branch) => {
      assert.ok(branches.has(branch), `${scope}: no nodes in branch ${branch}`);
      assert.ok(SPEC_BRANCH_LABELS[branch], `branch ${branch} has no label`);
    });
  });
});

test("each scope resolves to at least one node", () => {
  Object.entries(TABLE_SPEC_BRANCHES).forEach(([scope, list]) => {
    const count = Object.values(FOCUS_SPEC_NODES).filter((n) => list.includes(n.branch)).length;
    assert.ok(count > 0, `${scope} would open an empty panel`);
  });
});

// ── Nodes are listed by specialization group, not one flat alphabetical list. ─
test("every scope's nodes fall into groups of related nodes", () => {
  Object.entries(TABLE_SPEC_BRANCHES).forEach(([scope, branches]) => {
    const nodes = Object.entries(FOCUS_SPEC_NODES).filter(([, n]) => branches.includes(n.branch));
    const groups = new Set(nodes.map(([, n]) => n.group));
    assert.ok(groups.size > 0, `${scope} has no groups`);
    assert.ok(groups.size < nodes.length, `${scope} groups nothing (${nodes.length} singletons)`);
    groups.forEach((g) => assert.ok(FOCUS_SPEC_GROUPS[g], `${scope}: unknown group ${g}`));
  });
});

test("Refining / Transports lists one group per resource, five tiers each", () => {
  const branches = TABLE_SPEC_BRANCHES["transport-table"];
  const nodes = Object.entries(FOCUS_SPEC_NODES).filter(([, n]) => branches.includes(n.branch));
  const groups = {};
  nodes.forEach(([, n]) => { groups[n.group] = (groups[n.group] || 0) + 1; });
  assert.strictEqual(Object.keys(groups).length, 5, "expected Ore/Wood/Fiber/Hide/Rock");
  Object.values(groups).forEach((count) => assert.strictEqual(count, 5, "expected T4-T8"));
});

test("the panel renders groups, sorts by board order and offers a per-group set-all", () => {
  assert.ok(panelSrc.includes("function specGroupsForScope"), "grouping helper missing");
  assert.ok(/order/.test(panelSrc) && panelSrc.includes("FOCUS_SPEC_NODES[a].order"),
    "rows must sort by the node's board order");
  assert.ok(panelSrc.includes("spec-group-setall"), "no per-group set-all control");
  assert.ok(panelSrc.includes("setSpecLevelsFor("), "set-all must write the group's nodes");
  assert.ok(panelSrc.includes("spec-branch-caption"), "no branch caption for multi-branch scopes");
});

// ── Scope binding covers every entry point, not just renderAllTables. ──────
test("every scoped table has its renderer bound to that scope", () => {
  const scopes = Object.values(SPEC_SCOPED_RENDERERS).sort();
  assert.deepStrictEqual(scopes, Object.keys(TABLE_SPEC_BRANCHES).sort());
  Object.keys(SPEC_SCOPED_RENDERERS).forEach((name) => {
    assert.ok(appSrc.includes(`${name}(`), `${name} is not called from app.js`);
  });
});

test("the binding runs before any render, from the panel's DOM setup", () => {
  assert.ok(/function setupSpecSettingsButtons\(\)\s*\{\s*installSpecScopedRenderers\(\);/.test(panelSrc),
    "installSpecScopedRenderers must run first in setupSpecSettingsButtons");
  assert.ok(panelSrc.includes("DOMContentLoaded"), "no DOM-ready hook");
});

test("index.html loads the spec sources before utils.js", () => {
  // The two data catalogs are injected after first paint now
  // (js/catalog-loader.js) — their relative order lives in CATALOG_SCRIPTS.
  // focus-spec.js and utils.js stay as plain tags, still reader-after-source
  // in the markup, and every read of the data is behind typeof guards or
  // behind app.js's `await catalogsReady`.
  const { CATALOG_SCRIPTS } = require("../js/catalog-loader.js");
  assert.ok(
    CATALOG_SCRIPTS.indexOf("js/focus-costs.js") < CATALOG_SCRIPTS.indexOf("js/focus-spec-nodes.js") &&
      CATALOG_SCRIPTS.indexOf("js/focus-spec-nodes.js") < CATALOG_SCRIPTS.indexOf("js/focus-spec-items.js"),
    "costs → nodes → items, in loader order",
  );
  assert.ok(html.indexOf("js/focus-spec.js") > 0, "focus-spec.js still a tag");
  assert.ok(html.indexOf("js/focus-spec.js") < html.indexOf("js/utils.js"), "module before utils.js");
  assert.ok(html.indexOf("js/spec-settings-panel.js") < html.indexOf("js/app.js"),
    "the panel must load before app.js so its DOM hook runs first");
});

// ── The popover must not live inside the collapsible <h2>. ────────────────
test("the panel is appended to <body>, and its button stops the collapse click", () => {
  assert.ok(panelSrc.includes("document.body.appendChild(panel)"), "panel is not body-level");
  assert.ok(/e\.stopPropagation\(\)/.test(panelSrc), "the ⚙ click must not bubble to the h2");
});

test("panel styles are linked", () => {
  assert.ok(html.includes('href="css/spec-panel.css"'), "css/spec-panel.css is not linked");
  assert.ok(read("css/spec-panel.css").includes(".spec-panel"), "panel styles missing");
});

// ── Alignment (TLD): controls of three element types share one grid. ──────
const css = read("css/spec-panel.css");

test("the panel declares the shared sizing variables", () => {
  ["--spec-ctl-h:", "--spec-num-w:", "--spec-num-h:", "--spec-pad-x:", "--spec-gutter:"]
    .forEach((v) => assert.ok(css.includes(v), `${v} is not declared on .spec-panel`));
});

test("every toolbar control is one height, every level box one size", () => {
  const toolbarRule = css.match(
    /\.spec-panel-filter,\s*\.spec-panel-setall,\s*\.spec-panel-reset,\s*\.spec-panel-max\s*\{[^}]*\}/
  );
  assert.ok(toolbarRule, "filter / set-all / reset / all-100 are not sized by one rule");
  assert.ok(/height:\s*var\(--spec-ctl-h\)/.test(toolbarRule[0]), "toolbar height is not shared");
  assert.ok(/box-sizing:\s*border-box/.test(toolbarRule[0]),
    "padding would change the toolbar height without border-box");

  [".spec-panel-setall-input", ".spec-group-setall", ".spec-node-level"].forEach((sel) => {
    const rule = css.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`));
    assert.ok(rule, `${sel} has no sizing rule`);
    assert.ok(/width:\s*var\(--spec-num-w\)/.test(rule[0]), `${sel} does not use --spec-num-w`);
    assert.ok(/height:\s*var\(--spec-num-h\)/.test(rule[0]), `${sel} does not use --spec-num-h`);
    assert.ok(/box-sizing:\s*border-box/.test(rule[0]), `${sel} is not border-box`);
    assert.ok(/text-align:\s*right/.test(rule[0]), `${sel} must right-align its digits`);
  });
});

// ── The two escape hatches from the defaults ──────────────────────────────
//
// A node nobody typed counts as 0 (100 for a mastery). "All 100 (max spec)" is
// the one click back to the old app-wide assumption; "Reset" clears the scope
// to those defaults, which is the starting point for typing in real levels.

test("the toolbar carries an All-100 button, wired to setAllSpecLevels(…, 100)", () => {
  assert.ok(/class="spec-panel-max"/.test(panelSrc), "no All-100 button in the toolbar");
  assert.ok(
    /\.spec-panel-max"\)\.addEventListener\("click"[\s\S]{0,260}setAllSpecLevels\(\s*_specPanelScope,\s*SPEC_LEVEL_MAX,\s*TABLE_SPEC_BRANCHES\[_specPanelScope\]\s*\)/
      .test(panelSrc),
    "the button does not max this scope's branches"
  );
  assert.ok(/applySpecChange\(\)/.test(panelSrc), "the button must reprice the tables");
});

test("the toolbar carries a Reset button, wired to resetSpecLevels", () => {
  assert.ok(/class="spec-panel-reset"/.test(panelSrc), "no Reset button in the toolbar");
  assert.ok(
    /\.spec-panel-reset"\)\.addEventListener\("click"[\s\S]{0,200}resetSpecLevels\(_specPanelScope\)/
      .test(panelSrc),
    "Reset does not clear the scope back to the defaults"
  );
});

test("every scope's nodes default to 0 except the mastery heading each group", () => {
  Object.keys(TABLE_SPEC_BRANCHES).forEach((scope) => {
    const all = specNodeIdsForScope(scope);
    assert.ok(all.length > 0, `${scope}: no nodes at all`);
    // Refining groups are five TIERS of one resource with no mastery node above
    // them, so every tier defaults to 0 — right for a refiner who has levelled
    // T4-T6 but not T7-T8.
    all.forEach((nodeId) => {
      const expected = FOCUS_SPEC_NODES[nodeId].group === nodeId ? 100 : 0;
      assert.strictEqual(defaultSpecLevel(nodeId), expected,
        `${scope}: ${nodeId} should default to ${expected}`);
    });
  });
});

test("the cooking scope keeps Cook at 100 and defaults its nine specializations to 0", () => {
  assert.strictEqual(defaultSpecLevel("FARM_COOK"), 100, "the Cook mastery stays at 100");
  ["FARM_COOK_STEW", "FARM_COOK_MEAT", "FARM_COOK_SOUP"].forEach((nodeId) =>
    assert.strictEqual(defaultSpecLevel(nodeId), 0, `${nodeId} must default to 0`));
});

test("the summary always names how many nodes are still on their default", () => {
  const summary = panelSrc.match(/function updateSpecPanelSummary[\s\S]*?\n}/);
  assert.ok(summary, "updateSpecPanelSummary is gone");
  assert.ok(/specNodeIdsForScope\(scope\)/.test(summary[0]),
    "the count must come from the scope's real node list");
  assert.ok(/r_spec_nodes_set/.test(summary[0]) && /r_spec_all_max/.test(summary[0]),
    "both summary strings must go through tx() so Spanish gets them");
  assert.ok(!/below 100/.test(summary[0]),
    "counting only the edited nodes hides the assumption this line exists to show");
});

test("the new panel strings are translated", () => {
  const es = read("js/i18n-strings-es-rows.js");
  ["r_all_max", "r_all_max_tip", "r_reset_defaults", "r_reset_defaults_tip",
   "r_spec_foot", "r_spec_nodes_set", "r_spec_all_max"].forEach((key) =>
    assert.ok(new RegExp(`${key}:`).test(es), `${key} has no Spanish string`));
  // The count line is interpolated, so both placeholders must survive translation.
  const line = es.match(/r_spec_nodes_set:\s*"([^"]*)"/);
  assert.ok(line && line[1].includes("{set}") && line[1].includes("{max}"),
    "the Spanish count line dropped a placeholder");
});

test("styles.css's global button margin is zeroed inside the panel", () => {
  assert.ok(/\.spec-panel button\s*\{\s*margin:\s*0/.test(css),
    "a page-level button margin would push the panel's buttons off their row");
});

test("node rows indent to the group name's x", () => {
  const toggleMarker = css.match(/\.spec-group-toggle::before\s*\{[^}]*\}/);
  assert.ok(toggleMarker && /width:\s*10px/.test(toggleMarker[0]),
    "the ▸ marker needs a fixed width for the names to share an x");
  const row = css.match(/\.spec-node-row\s*\{[^}]*\}/);
  assert.ok(row && /padding:[^;]*calc\(var\(--spec-pad-x\) \+ 16px\)/.test(row[0]),
    "node rows must indent by the marker width + its gap");
});

test("the head, tools and foot are padded by the measured scrollbar gutter", () => {
  [".spec-panel-head", ".spec-panel-tools", ".spec-panel-foot"].forEach((sel) => {
    const rule = css.match(new RegExp(`\\${sel}\\s*\\{[^}]*\\}`));
    assert.ok(rule && /calc\(var\(--spec-pad-x\) \+ var\(--spec-gutter\)\)/.test(rule[0]),
      `${sel} does not offset the body's scrollbar`);
  });
  const body = css.match(/\.spec-panel-body\s*\{[^}]*\}/);
  assert.ok(body && /scrollbar-gutter:\s*stable/.test(body[0]),
    "the gutter must not appear and vanish with the filtered row count");
  assert.ok(panelSrc.includes("function measureSpecPanelGutter(panel)"), "no gutter measurement");
  assert.ok(/offsetWidth - body\.clientWidth/.test(panelSrc), "the gutter is not measured");
  assert.ok(/setProperty\("--spec-gutter"/.test(panelSrc), "the measurement is not fed back to CSS");
  assert.ok(panelSrc.indexOf("measureSpecPanelGutter(_specPanel)") >
    panelSrc.indexOf("_specPanel.hidden = false"),
    "a hidden panel measures 0 — measure after it is shown");
});

// ── Heading feedback. ─────────────────────────────────────────────────────
test("app.js marks the ⚙ button when that table's specs are edited", () => {
  assert.ok(appSrc.includes("function updateSpecHeadings()"), "updateSpecHeadings missing");
  // The heading dropped its "Maxed / Custom Specs" suffix — the per-table ⚙
  // button is now the only place the customised state shows.
  assert.ok(/classList\.toggle\("is-custom", isCustom\)/.test(appSrc),
    "the ⚙ button is not marked when its scope is customised");
  assert.ok(/isCustom \? `\$\{specsLabel\} \*` : specsLabel/.test(appSrc),
    "the ⚙ button label is not asterisked when customised");
  const en = read("js/i18n-strings-en.js");
  ["crafting_w_focus", "crafting_no_focus"].forEach((slug) => {
    assert.ok(en.includes(`"${slug}"`), `${slug} missing from the EN table`);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
