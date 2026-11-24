/**
 * Tests for the section grouping — index.html's 27 tables are bundled into
 * themed <section class="tgroup"> bands (css/table-groups.css) whose headers
 * collapse the whole band (js/section-groups.js).
 *
 * Two halves, both black-box:
 *   1. markup — read the real index.html and assert every section landed in a
 *      group, that no section was lost or duplicated by the regrouping, and
 *      that the group labels are translatable (EN table + ES overrides).
 *   2. behaviour — run the REAL setupSectionGroups() against a minimal fake DOM
 *      and assert what the user sees: badge counts, collapse toggling, the
 *      persisted state, and that group collapse never touches a table's own
 *      collapsed state. No jsdom, no live storage.
 *
 * Run: node tests/table-groups.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { readIndexHtml } = require("./helpers/page-source.cjs");
const html = readIndexHtml();
const { UI_STRINGS_EN } = require("../js/i18n-strings-en.js");
const { UI_STRINGS_ES } = require("../js/i18n-strings-es.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL: ${name} - ${e.message}`);
  }
}

// ── the sections that must exist, and the group each belongs to ──────────────
// Keyed by the id of the section's table (or its wrapper, for the two sections
// that have no table). Parameterised: adding a table means adding a row here.
const SECTIONS = [
  ["craft-list-table", "craftlist"],
  ["craft-list-mats-table", "craftlist"],
  ["gold-chart-section", "market"],
  ["fees-calculator", "market"],
  ["joined-summary-table", "market"],
  ["flipping-table", "market"],
  ["skins-trading-table", "market"],
  ["volume-table", "market"],
  ["crafting-table", "crafting"],
  ["craft-planner-table", "crafting"],
  ["transport-table", "crafting"],
  ["consumable-table", "crafting"],
  ["rolling-table", "crafting"],
  ["enchanting-table", "upgrades"],
  ["transmute-table", "upgrades"],
  ["rerolling-table", "upgrades"],
  ["gathering-table", "production"],
  ["farming-table", "production"],
  ["mounts-table", "production"],
  ["laborers-table", "production"],
  ["journal-filling-table", "production"],
  ["buildings-table", "production"],
  ["fp-calc-result", "faction"],
  ["faction-spending-table", "faction"],
  ["roads-portals-table", "roads"],
  ["city-bonuses-table", "reference"],
  ["black-zone-bonuses-table", "reference"],
  ["black-zone-locations-table", "reference"],
  ["brecilien-fees-table", "reference"],
  ["roads-zones-table", "reference"],
];

const GROUP_IDS = [...new Set(SECTIONS.map(([, g]) => g))];

/** Slice index.html into { groupId: innerHtml } by scanning the group markers. */
function groupSlices(source) {
  const out = {};
  const re = /<section class="tgroup" id="group-([a-z-]+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(source)) !== null) starts.push({ id: m[1], at: m.index });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : source.length;
    out[s.id] = source.slice(s.at, end);
  });
  return out;
}
const slices = groupSlices(html);

console.log("\n── markup ──");

test("every group in the layout is one of the declared groups", () => {
  assert.deepStrictEqual(Object.keys(slices).sort(), [...GROUP_IDS].sort());
});

SECTIONS.forEach(([id, group]) => {
  test(`#${id} sits in the "${group}" group`, () => {
    const marker = `id="${id}"`;
    const hits = GROUP_IDS.filter((g) => (slices[g] || "").includes(marker));
    assert.deepStrictEqual(hits, [group], `found in: ${hits.join(", ") || "no group"}`);
  });
});

test("no section appears twice in the document", () => {
  SECTIONS.forEach(([id]) => {
    const n = html.split(`id="${id}"`).length - 1;
    assert.strictEqual(n, 1, `#${id} occurs ${n}×`);
  });
});

test("every <h2> lives inside a group body", () => {
  const inGroups = GROUP_IDS.reduce(
    (n, g) => n + (slices[g].match(/<h2[\s>]/g) || []).length,
    0,
  );
  assert.strictEqual(inGroups, (html.match(/<h2[\s>]/g) || []).length);
});

test("every .data-table lives inside a group body", () => {
  const inGroups = GROUP_IDS.reduce(
    (n, g) => n + (slices[g].match(/class="data-table"/g) || []).length,
    0,
  );
  assert.strictEqual(inGroups, (html.match(/class="data-table"/g) || []).length);
});

test("each group header carries a title, a subtitle and an indicator", () => {
  GROUP_IDS.forEach((g) => {
    const head = slices[g].slice(0, slices[g].indexOf('class="tgroup-body"'));
    assert.ok(head.includes('class="tgroup-title"'), `${g}: title`);
    assert.ok(head.includes('class="tgroup-sub"'), `${g}: subtitle`);
    assert.ok(head.includes('class="tgroup-indicator"'), `${g}: indicator`);
  });
});

test("group labels are translatable (EN table + ES overrides)", () => {
  GROUP_IDS.forEach((g) => {
    [`group_${g}`, `group_${g}_sub`].forEach((slug) => {
      assert.ok(UI_STRINGS_EN[slug], `${slug} missing from EN`);
      assert.ok(UI_STRINGS_ES[slug], `${slug} missing from ES`);
    });
  });
});

test("the stylesheet and the behaviour script are wired up", () => {
  assert.ok(html.includes('href="css/table-groups.css"'), "css link");
  assert.ok(html.includes('src="js/section-groups.js"'), "script tag");
});

// A single-section group drops its own header and promotes the section's <h2>
// to the band, so it reads like every other group without nesting two headers.
test("the stylesheet hides a solo group's header and bands its heading", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "table-groups.css"), "utf8");
  assert.match(css, /\.tgroup\.solo\s*>\s*\.tgroup-head\s*\{[^}]*display:\s*none/);
  const heading = css.match(
    /\.tgroup\.solo\s*>\s*\.tgroup-body\s*>\s*h2:first-child,[^{]*\{([^}]*)\}/,
  );
  assert.ok(heading, "the solo heading is styled");
  assert.match(heading[1], /background:\s*linear-gradient/, "banded like a group head");
  assert.match(heading[1], /border-left:\s*4px solid var\(--tgroup-accent\)/, "same accent rail");
});

test("the solo heading's title takes the group accent, not the whole heading", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "table-groups.css"), "utf8");
  const title = css.match(
    /\.tgroup\.solo\s*>\s*\.tgroup-body\s*>\s*h2:first-child\s*>\s*span:first-child\s*\{([^}]*)\}/,
  );
  assert.ok(title, "the title span is styled");
  assert.match(title[1], /text-transform:\s*uppercase/);
  assert.match(title[1], /color:\s*var\(--tgroup-accent\)/);
});

// ── behaviour ────────────────────────────────────────────────────────────────
console.log("\n── behaviour ──");

class El {
  constructor(tag, cls) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.textContent = "";
    this.dataset = {};
    this.attrs = {};
    this._listeners = {};
    this.classList = {
      _set: new Set((cls || "").split(" ").filter(Boolean)),
      add: (c) => this.classList._set.add(c),
      remove: (c) => this.classList._set.delete(c),
      contains: (c) => this.classList._set.has(c),
      toggle: (c, on) => (on ? this.classList._set.add(c) : this.classList._set.delete(c)),
    };
    // Assigning className must re-seed classList, the way a real element does —
    // the badge is created bare and given its class afterwards.
    Object.defineProperty(this, "className", {
      get: () => [...this.classList._set].join(" "),
      set: (v) => {
        this.classList._set = new Set(String(v).split(" ").filter(Boolean));
      },
    });
    this.className = cls || "";
  }
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  insertBefore(node, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(node);
    else this.children.splice(i, 0, node);
    return node;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(t, fn) {
    (this._listeners[t] ||= []).push(fn);
  }
  fire(type, event) {
    (this._listeners[type] || []).forEach((fn) => fn(event));
  }
  closest(sel) {
    const tags = sel.split(",").map((s) => s.trim().toUpperCase());
    return tags.includes(this.tagName) ? this : null;
  }
  _descendants() {
    return this.children.flatMap((c) => [c, ...c._descendants()]);
  }
  _matches(sel) {
    return sel
      .split(",")
      .map((s) => s.trim())
      .some((s) =>
        s.startsWith(".")
          ? this.classList.contains(s.slice(1))
          : this.tagName === s.replace(":scope > ", "").toUpperCase(),
      );
  }
  querySelector(sel) {
    return this._descendants().find((e) => e._matches(sel)) || null;
  }
  querySelectorAll(sel) {
    const scoped = sel.includes(":scope >");
    const pool = scoped ? this.children : this._descendants();
    const bare = sel.replace(/:scope >\s*/g, "");
    return pool.filter((e) => e._matches(bare));
  }
}

/** One group: header + body holding `n` <h2> sections, each with a table. */
function buildGroup(id, n) {
  const group = new El("section", "tgroup");
  group.dataset.group = id;
  const head = new El("div", "tgroup-head");
  head.appendChild(new El("span", "tgroup-title"));
  head.appendChild(new El("span", "tgroup-indicator"));
  const body = new El("div", "tgroup-body");
  for (let i = 0; i < n; i++) {
    body.appendChild(new El("h2"));
    body.appendChild(new El("table"));
  }
  group.appendChild(head);
  group.appendChild(body);
  return group;
}

/**
 * Mount the groups in a fake document. Defaults to a RETURNING user (the
 * first-run marker is already stored); pass `{ firstRun: true }` for a fresh
 * install with nothing in storage at all.
 */
function install(groups, stored, opts) {
  const root = new El("div");
  groups.forEach((g) => root.appendChild(g));
  clearFirstRunLatch();
  const store = { ...(stored || {}) };
  if (!(opts && opts.firstRun)) store["ui-defaults-applied"] = "1";
  global.document = {
    readyState: "complete",
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    createElement: (tag) => new El(tag),
  };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
    removeItem: (k) => delete store[k],
  };
  return store;
}

const {
  setupSectionGroups,
  expandAllSectionGroups,
  collapseAllSectionGroups,
} = require("../js/section-groups.js");

/** Reset the latched first-run verdict between cases. */
function clearFirstRunLatch() {
  delete globalThis.__uiFirstRun;
}

test("the header badge counts the sections in the group", () => {
  const g = buildGroup("market", 6);
  install([g]);
  setupSectionGroups();
  const badge = g.querySelector(".tgroup-count");
  assert.ok(badge, "badge added");
  assert.strictEqual(badge.textContent, 6);
});

test("the badge counts the gold chart, whose heading is a nested div", () => {
  // #gold-chart-section wraps its own .section-title heading (it has no table,
  // so it is not an <h2>) — it must still count as one section.
  const g = buildGroup("market", 5);
  const wrapper = new El("div");
  wrapper.appendChild(new El("div", "section-title"));
  g.querySelector(".tgroup-body").insertBefore(
    wrapper,
    g.querySelector(".tgroup-body").children[0],
  );
  install([g]);
  setupSectionGroups();
  assert.strictEqual(g.querySelector(".tgroup-count").textContent, 6);
});

test("a returning user with nothing stored gets expanded groups", () => {
  const g = buildGroup("crafting", 3);
  install([g]);
  setupSectionGroups();
  assert.strictEqual(g.classList.contains("collapsed"), false);
  assert.strictEqual(g.querySelector(".tgroup-indicator").textContent, "▼");
});

test("a fresh install starts every group collapsed, and remembers it", () => {
  const a = buildGroup("market", 6);
  const b = buildGroup("reference", 4);
  const store = install([a, b], null, { firstRun: true });
  setupSectionGroups();
  assert.strictEqual(a.classList.contains("collapsed"), true);
  assert.strictEqual(b.classList.contains("collapsed"), true);
  // Persisted, so the collapsed start is not a one-off that unfolds on reload.
  assert.strictEqual(store["group-collapsed-market"], "1");
  assert.strictEqual(store["group-collapsed-reference"], "1");
  assert.strictEqual(store["ui-defaults-applied"], "1");
});

test("the second load is not a first run — the user's own state wins", () => {
  const first = buildGroup("market", 6);
  const store = install([first], null, { firstRun: true });
  setupSectionGroups();
  first.querySelector(".tgroup-head").fire("click", {
    target: first.querySelector(".tgroup-head"),
  }); // user opens it

  const second = buildGroup("market", 6);
  install([second], store); // reload, same storage
  setupSectionGroups();
  assert.strictEqual(second.classList.contains("collapsed"), false);
});

test("clicking the header collapses the group and remembers it", () => {
  const g = buildGroup("roads", 2);
  const store = install([g]);
  setupSectionGroups();
  const head = g.querySelector(".tgroup-head");
  head.fire("click", { target: head });
  assert.strictEqual(g.classList.contains("collapsed"), true);
  assert.strictEqual(g.querySelector(".tgroup-indicator").textContent, "▶");
  assert.strictEqual(store["group-collapsed-roads"], "1");
});

test("clicking again expands it and forgets the flag", () => {
  const g = buildGroup("roads", 2);
  const store = install([g], { "group-collapsed-roads": "1" });
  setupSectionGroups();
  assert.strictEqual(g.classList.contains("collapsed"), true, "restored collapsed");
  const head = g.querySelector(".tgroup-head");
  head.fire("click", { target: head });
  assert.strictEqual(g.classList.contains("collapsed"), false);
  assert.strictEqual("group-collapsed-roads" in store, false);
});

test("a stored flag only collapses its own group", () => {
  const a = buildGroup("market", 2);
  const b = buildGroup("reference", 4);
  install([a, b], { "group-collapsed-reference": "1" });
  setupSectionGroups();
  assert.strictEqual(a.classList.contains("collapsed"), false);
  assert.strictEqual(b.classList.contains("collapsed"), true);
});

test("clicks landing on a control in the header do not toggle", () => {
  const g = buildGroup("faction", 2);
  install([g]);
  setupSectionGroups();
  const head = g.querySelector(".tgroup-head");
  head.fire("click", { target: new El("button") });
  assert.strictEqual(g.classList.contains("collapsed"), false);
});

test("Enter and Space toggle; other keys do not", () => {
  const g = buildGroup("upgrades", 3);
  install([g]);
  setupSectionGroups();
  const head = g.querySelector(".tgroup-head");
  assert.strictEqual(head.attrs.role, "button");
  assert.strictEqual(head.attrs.tabindex, "0");
  const key = (k) => head.fire("keydown", { key: k, preventDefault() {} });
  key("Enter");
  assert.strictEqual(g.classList.contains("collapsed"), true);
  key(" ");
  assert.strictEqual(g.classList.contains("collapsed"), false);
  key("a");
  assert.strictEqual(g.classList.contains("collapsed"), false);
});

test("collapsing a group leaves each table's own collapsed state alone", () => {
  const g = buildGroup("production", 2);
  const store = install([g], { "table-collapsed-farming-table": "1" });
  setupSectionGroups();
  const head = g.querySelector(".tgroup-head");
  head.fire("click", { target: head });
  head.fire("click", { target: head });
  assert.strictEqual(store["table-collapsed-farming-table"], "1");
  // …and no per-table key was invented for the tables inside the group.
  const invented = Object.keys(store).filter(
    (k) => k.startsWith("table-collapsed-") && k !== "table-collapsed-farming-table",
  );
  assert.deepStrictEqual(invented, []);
});

test("Expand All opens every group", () => {
  const a = buildGroup("market", 2);
  const b = buildGroup("reference", 3);
  const store = install([a, b], {
    "group-collapsed-market": "1",
    "group-collapsed-reference": "1",
  });
  setupSectionGroups();
  expandAllSectionGroups();
  assert.strictEqual(a.classList.contains("collapsed"), false);
  assert.strictEqual(b.classList.contains("collapsed"), false);
  assert.deepStrictEqual(
    Object.keys(store).filter((k) => k.startsWith("group-collapsed-")),
    [],
  );
});

test("Collapse All folds every group", () => {
  const a = buildGroup("market", 2);
  const b = buildGroup("reference", 3);
  const store = install([a, b]);
  setupSectionGroups();
  collapseAllSectionGroups();
  assert.strictEqual(a.classList.contains("collapsed"), true);
  assert.strictEqual(b.classList.contains("collapsed"), true);
  assert.strictEqual(store["group-collapsed-market"], "1");
  assert.strictEqual(store["group-collapsed-reference"], "1");
});

// ── single-section groups are not drawn as groups ────────────────────────────
// A band around one table repeats that table's own <h2> and folding it
// duplicates the table's own collapse, so the wrapper steps out of the way.
[0, 1].forEach((n) => {
  test(`a group holding ${n} section(s) is unwrapped, with no badge`, () => {
    const g = buildGroup("roads", n);
    install([g]);
    setupSectionGroups();
    assert.strictEqual(g.classList.contains("solo"), true);
    assert.strictEqual(g.querySelector(".tgroup-count"), null);
  });
});

test("a group holding several sections is still banded", () => {
  const g = buildGroup("market", 2);
  install([g]);
  setupSectionGroups();
  assert.strictEqual(g.classList.contains("solo"), false);
  assert.ok(g.querySelector(".tgroup-count"), "badge added");
});

test("a solo group's hidden header is not clickable, so it never folds", () => {
  const g = buildGroup("roads", 1);
  const store = install([g]);
  setupSectionGroups();
  const head = g.querySelector(".tgroup-head");
  head.fire("click", { target: head });
  head.fire("keydown", { key: "Enter", preventDefault() {} });
  assert.strictEqual(g.classList.contains("collapsed"), false);
  assert.strictEqual("group-collapsed-roads" in store, false);
});

test("Collapse All and a fresh install leave a solo group open", () => {
  const solo = buildGroup("roads", 1);
  const band = buildGroup("market", 3);
  const store = install([solo, band], null, { firstRun: true });
  setupSectionGroups();
  assert.strictEqual(solo.classList.contains("collapsed"), false, "fresh install");
  collapseAllSectionGroups();
  assert.strictEqual(solo.classList.contains("collapsed"), false, "Collapse All");
  assert.strictEqual(band.classList.contains("collapsed"), true);
  assert.strictEqual("group-collapsed-roads" in store, false);
});

// Without a header there is nothing to click, so a flag left over from when the
// group had more tables must not hide the one that is left.
test("a stored collapsed flag cannot strand a group that became solo", () => {
  const g = buildGroup("roads", 1);
  install([g], { "group-collapsed-roads": "1" });
  setupSectionGroups();
  assert.strictEqual(g.classList.contains("collapsed"), false);
});

test("app.js drives the groups from both Collapse All and Expand All", () => {
  const appSrc = appSource();
  const fnBody = (name) => {
    const at = appSrc.indexOf(`function ${name}()`);
    assert.ok(at >= 0, `${name}() not found in app.js`);
    let depth = 0;
    for (let i = appSrc.indexOf("{", at); i < appSrc.length; i++) {
      if (appSrc[i] === "{") depth++;
      else if (appSrc[i] === "}" && --depth === 0) return appSrc.slice(at, i + 1);
    }
    return "";
  };
  assert.ok(fnBody("expandAll").includes("expandAllSectionGroups"));
  assert.ok(fnBody("collapseAll").includes("collapseAllSectionGroups"));
  // …and tables start folded on a fresh install, like the groups do.
  assert.ok(
    /isFirstRun\(\)/.test(fnBody("setupCollapsibleTables")),
    "setupCollapsibleTables must consult isFirstRun() for the first-run default",
  );
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
