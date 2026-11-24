/**
 * A craft-list row is HELD while the app recomputes it (js/render-craft-list.js).
 *
 * The list draws each entry through its source table's formatter. While a
 * re-render pass runs, a source can momentarily fail to resolve — the state is
 * being rebuilt, the row key has moved with the winning city — and the panel
 * used to swap in _clPlaceholderRow: one sentence spanning the whole group,
 * with the row's dozen value cells gone. Measured in a browser, that group
 * table was 238px narrower than the same table with its real rows, so the
 * columns stepped in when a pass started and back out when it ended, over and
 * over while the market monitor streamed. It also threw away readable numbers
 * to say "computing", which js/recalc-cell-mark.js is already saying ON those
 * numbers.
 *
 * So mid-pass the previous render's row is re-emitted, tagged `cl-held`. The
 * placeholder is still the right answer when there is nothing to hold, and when
 * no work is in flight — an unresolved row then really is unpriced.
 *
 * The harvest also reverts any open price editor it finds in a row: the popup
 * lives inside its cell, and a cached popup is re-emitted verbatim by
 * _clPlaceholderRow as the phantom input the user keeps seeing after a cancel.
 *
 * Black-box: a tiny fake DOM (no jsdom in this repo), the module compiled into
 * it, and assertions on the emitted HTML.
 *
 * Run: node tests/craft-list-held-rows.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const loadFile = (rel) =>
  fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/if \(typeof module[\s\S]*$/, "");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── the module under a fake document ────────────────────────────────────────
// Nothing here renders: the two functions under test walk a tbody and return a
// string, so the document only has to exist.

const sandbox = `
const document = {
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  createElement() { return {}; },
};
const window = {};
function tx(en) { return en; }
function formatSilver(n) { return String(Math.round(Number(n) || 0)); }
function getItemDisplayName(id) { return "NAME:" + id; }
let _rerenderBusy = false;
function isRerenderBusy() { return _rerenderBusy; }
function setRerenderBusy(v) { _rerenderBusy = !!v; }
function isBootFilling() { return false; }
`;

const src = sandbox
  + loadFile("js/render-craft-list-header.js")
  + loadFile("js/render-craft-list-source.js")
  + loadFile("js/render-craft-list-cells.js")
  + loadFile("js/render-craft-list.js")
  + `
module.exports = { _clHeldRows, _clPlaceholderRow, _clHeldKey, setRerenderBusy };`;

const m = new Module("craft-list-held-rows-test");
m._compile(src, path.join(ROOT, "js", "craft-list-held-rows-test.js"));
const api = m.exports;

// ── what the panel left on screen last time ─────────────────────────────────
// A <tr> that answers the handful of DOM questions _clHeldRows asks of it,
// including per-<td> ones: the harvest reverts any open price editor it finds,
// so the fake cells must carry the editor's markup and the _oldHtml expando
// the way the real DOM does (cloneNode never copies expandos).

function fakeTd(html) {
  const open = html.slice(0, html.indexOf(">") + 1);
  const td = {
    _open: open,
    _content: html.slice(open.length, html.lastIndexOf("</td>")),
    _oldHtml: undefined,
    className: (/(?:^|\s)class="([^"]*)"/.exec(open) || [null, ""])[1] || "",
    style: {},
    querySelector(sel) {
      return sel === ".pe-popup" && /pe-popup/.test(this._content) ? {} : null;
    },
    querySelectorAll(sel) {
      if (sel !== ".pe-popup" || !/pe-popup/.test(this._content)) return [];
      const self = this;
      return [{
        remove() {
          self._content = self._content.replace(/<div class="pe-popup"[\s\S]*<\/div>/, "");
        },
      }];
    },
    get outerHTML() {
      const head = /class="/.test(this._open)
        ? this._open.replace(/class="[^"]*"/, `class="${this.className}"`)
        : (this.className ? this._open.replace(/<td/, `<td class="${this.className}"`) : this._open);
      return `${head}${this._content}</td>`;
    },
    set innerHTML(v) { this._content = v; },
    get innerHTML() { return this._content; },
  };
  td.classList = {
    contains: (c) => td.className.split(/\s+/).includes(c),
    add(c) { if (!td.classList.contains(c)) td.className = (td.className ? `${td.className} ` : "") + c; },
    remove(c) { td.className = td.className.split(/\s+/).filter((x) => x !== c).join(" "); },
  };
  return td;
}

function fakeRow(html) {
  const head = html.slice(0, html.indexOf(">"));
  const attrs = {};
  const re = /(data-[\w-]+)="([^"]*)"/g;
  let match;
  while ((match = re.exec(head))) attrs[match[1]] = match[2];

  const tds = [];
  const tdRe = /<td[^>]*>[\s\S]*?<\/td>/g;
  let cell;
  while ((cell = tdRe.exec(html))) tds.push(fakeTd(cell[0]));

  const row = {
    _tds: tds,
    className: (/<tr[^>]*class="([^"]*)"/.exec(html) || [null, ""])[1],
    getAttribute: (name) => (attrs[name] != null ? attrs[name] : null),
    // A fresh parse: like the real cloneNode, it carries no expandos and none
    // of the mutations made after the row was built.
    cloneNode: () => fakeRow(html),
    querySelectorAll: (sel) => (sel === "td" ? row._tds : []),
    get outerHTML() {
      let open = html.slice(0, html.indexOf(">") + 1);
      if (/class="/.test(open)) open = open.replace(/class="[^"]*"/, `class="${row.className}"`);
      else if (row.className) open = open.replace(/<tr/, `<tr class="${row.className}"`);
      return open + row._tds.map((td) => td.outerHTML).join("") + "</tr>";
    },
  };
  row.classList = {
    add: (cls) => {
      if (row.className.split(/\s+/).includes(cls)) return;
      row.className = (row.className ? `${row.className} ` : "") + cls;
    },
  };
  return row;
}

const fakeGroup = (tableId, rowsHtml) => ({
  getAttribute: (name) => (name === "data-cl-group" ? tableId : null),
  tBodies: [{ rows: rowsHtml.map(fakeRow) }],
});

const fakeTbody = (groups) => ({
  querySelectorAll: (sel) => (sel === "table.cl-inner" ? groups : []),
});

const held = (groups) => api._clHeldRows(fakeTbody(groups));

const REAL_ROW = '<tr data-row-key="ITEM|Martlock">'
  + '<td class="cell-add">x</td><td class="cl-qty-cell">1</td>'
  + '<td class="silver-val cl-row-total">51,204</td>'
  + '<td class="cell-item">Elder Plate Helmet</td>'
  + '<td class="silver-val">120,000</td></tr>';

const ENTRY = { tableId: "crafting-table", rowKey: "ITEM|Martlock", itemId: "ITEM", qty: 1 };
const KEY = api._clHeldKey("crafting-table", "ITEM|Martlock");

/** Run fn with the re-render scheduler reporting busy (or idle). */
function whileBusy(busy, fn) {
  api.setRerenderBusy(busy);
  try { return fn(); } finally { api.setRerenderBusy(false); }
}

console.log("\n=== Harvesting the previous render ===");

// Parameterised over every row state the panel can leave behind: only the ones
// carrying real numbers are worth holding.
[
  ["a computed row is held", REAL_ROW, true],
  [
    "a held row is held again, so a burst of passes does not lose it",
    REAL_ROW.replace("<tr ", '<tr class="cl-held" '),
    true,
  ],
  [
    "a placeholder mid-pass is not held",
    '<tr class="cl-pending" data-row-key="ITEM|Martlock"><td colspan="8">'
      + '<span class="row-fluid row-computing"></span></td></tr>',
    false,
  ],
  [
    "an unpriced placeholder is not held",
    '<tr class="cl-missing" data-row-key="ITEM|Martlock"><td colspan="8">Not priced</td></tr>',
    false,
  ],
  [
    "a row with no key could never be found again",
    REAL_ROW.replace(' data-row-key="ITEM|Martlock"', ""),
    false,
  ],
].forEach(([name, rowHtml, kept]) => {
  test(name, () => {
    assert.strictEqual(held([fakeGroup("crafting-table", [rowHtml])]).has(KEY), kept);
  });
});

test("holding does not mark the live row — only the copy carries cl-held", () => {
  const group = fakeGroup("crafting-table", [REAL_ROW]);
  const map = held([group]);
  assert.match(map.get(KEY), /class="[^"]*cl-held/);
  assert.ok(
    !/cl-held/.test(group.tBodies[0].rows[0].outerHTML),
    "the row still on screen must not be tagged",
  );
});

console.log("\n=== Open editors must never reach the cache (the phantom input) ===");
//
// The price editor's popup lives INSIDE its cell (js/app.js), and a close path
// that lost its cell — a re-render detached the td — leaves that markup behind
// with the .pe-editing marker already stripped. Whatever the state, the held
// copy must never carry the editor's inputs: a mid-pass render re-emits the
// held row verbatim (_clPlaceholderRow), and a cached popup is the phantom
// input the user keeps seeing after a cancel.

const POPUP = '<div class="pe-popup">'
  + '<select><option>Theford</option></select>'
  + '<input type="number" value="0">'
  + '<button>✓</button><button>✗</button>'
  + '</div>';
const EDITED_CELL = '<span class="price-editable" data-item-id="ITEM">120,000</span>';
const editorRow = (tdClass) => `<tr data-row-key="ITEM|Martlock">`
  + '<td class="cell-add">x</td><td class="cl-qty-cell">1</td>'
  + '<td class="silver-val cl-row-total">51,204</td>'
  + '<td class="cell-item">Elder Plate Helmet</td>'
  + `<td class="${tdClass}">${POPUP}</td></tr>`;

/** held() over one editor row, with the editor's _oldHtml expando present or not. */
function heldEditorRow(rowHtml, withOldHtml) {
  const group = fakeGroup("crafting-table", [rowHtml]);
  const tds = group.tBodies[0].rows[0]._tds;
  if (withOldHtml) tds[tds.length - 1]._oldHtml = EDITED_CELL;
  return held([group]).get(KEY) || "";
}

// Parameterised over every state a cell can be left in: with the class marker
// and the saved markup, with the markup alone (the zombie a close path leaves
// when the cell was detached under it), and with nothing to restore from.
[
  ["an open editor (class marker + _oldHtml) reverts in the held copy",
    editorRow("silver-val price-editable pe-editing"), true],
  ["a ZOMBIE editor — popup markup, class already stripped — reverts too",
    editorRow("silver-val price-editable"), true],
  ["an editor whose _oldHtml is gone has its popup stripped, not cached",
    editorRow("silver-val price-editable pe-editing"), false],
].forEach(([name, rowHtml, withOldHtml]) => {
  test(name, () => {
    const out = heldEditorRow(rowHtml, withOldHtml);
    assert.ok(!/pe-popup/.test(out), "no popup markup in the held row");
    assert.ok(!/<input/.test(out), "no editor input in the held row");
    assert.ok(!/<select/.test(out), "no editor dropdown in the held row");
    assert.ok(!/pe-editing/.test(out), "no editor class in the held row");
    if (withOldHtml) {
      assert.ok(out.includes(EDITED_CELL), "the cell is back the way it was found");
    }
  });
});

test("a plain row keeps its own inputs — the revert must not eat the qty field", () => {
  const out = heldEditorRow(
    `<tr data-row-key="ITEM|Martlock">`
    + '<td class="cell-add">x</td>'
    + '<td class="cl-qty-cell"><input class="cl-qty" data-cl-qty="1" value="3"></td>'
    + '<td class="silver-val cl-row-total">51,204</td>'
    + '<td class="cell-item">Elder Plate Helmet</td>'
    + `<td class="silver-val">${EDITED_CELL}</td></tr>`,
    false,
  );
  assert.ok(out.includes('class="cl-qty"'), "the qty input survives the harvest");
  assert.ok(out.includes(EDITED_CELL), "and the price cell is untouched");
});

console.log("\n=== What the placeholder does with a held row ===");

test("mid-pass, the held row is re-emitted instead of a placeholder", () => {
  const html = whileBusy(true, () =>
    api._clPlaceholderRow(ENTRY, held([fakeGroup("crafting-table", [REAL_ROW])])));
  assert.ok(html.includes("51,204"), "the last numbers must survive");
  assert.ok(!/row-computing/.test(html), "no placeholder mark");
  assert.match(html, /class="[^"]*cl-held/);
});

test("idle, an unresolved row falls back to the placeholder", () => {
  const html = whileBusy(false, () =>
    api._clPlaceholderRow(ENTRY, held([fakeGroup("crafting-table", [REAL_ROW])])));
  assert.match(html, /scan/i, "an idle unresolved row is unpriced, not computing");
  assert.ok(!html.includes("51,204"), "stale numbers must not outlive the pass");
});

test("nothing held: the placeholder is still the answer mid-pass", () => {
  assert.match(whileBusy(true, () => api._clPlaceholderRow(ENTRY, held([]))), /row-computing/);
});

test("a held row from ANOTHER group is not borrowed", () => {
  const html = whileBusy(true, () =>
    api._clPlaceholderRow(ENTRY, held([fakeGroup("consumable-table", [REAL_ROW])])));
  assert.match(html, /row-computing/);
});

test("no held map at all is the same as nothing held", () => {
  assert.match(whileBusy(true, () => api._clPlaceholderRow(ENTRY)), /row-computing/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
