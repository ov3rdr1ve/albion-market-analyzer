/**
 * My Crafting List — the "gathered" secondary line in "Profit / 10k Focus"
 * (plan.md step 1: tests first, TDD red).
 *
 * Commit 846e9cf put a dimmed `gathered` <small> under the bought value in the
 * Crafting, Craft Planner, Consumables and Mounts craft tables
 * (gatheredPer10kSmallHtml in js/self-found-profit.js). The crafting list then
 * overwrites the whole cell in patchPer10kCell / refreshPer10kCell
 * (js/craft-list-per10k.js), so the line vanishes. Like the self-found twin it
 * must be re-built COMBINED: combinedPer10k(gathered, rowProfit, parked).
 *
 * Contract under test:
 *   patchPer10kCell(tr, tableId, base, rowProfit, parked, baseSelf, baseGathered)
 *     - finite baseGathered -> a dimmed display:block <small> labelled
 *       "gathered" with its own tooltip, and data-cl-p10k-base-gathered;
 *     - otherwise byte-identical to today.
 *   refreshPer10kCell(row, rowProfit, parked)
 *     - rebuilds BOTH lines from the stashed attributes, never duplicating.
 *   renderCraftListTable passes row.profitPer10kFocusGathered through.
 *
 * Black box: fake thead/row objects for the unit scenarios; scenario e reuses
 * the fake-DOM harness of tests/craft-list-self-found-per10k-focus.test.cjs and
 * renders a real list. No market data, no browser, no live API.
 *
 * Run: node tests/craft-list-gathered-per10k-focus.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const MOD = path.join(ROOT, "js", "craft-list-per10k.js");

globalThis.tx = (en) => en;
globalThis.formatSilver = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

const BASE = 4192063;
const PROFIT = 12927886;
const SELF = 5000000;
const GATH = 6100000;
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

/** Every <small> in a cell, with attributes. */
function smallsOf(html) {
  const out = [];
  const re = /<small\b([^>]*)>([\s\S]*?)<\/small>/gi;
  let m;
  while ((m = re.exec(String(html)))) {
    const attrs = {};
    String(m[1]).replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ""; });
    out.push({ open: m[1], inner: m[2], attrs, title: attrs.title || "" });
  }
  return out;
}
const gatheredOf = (html) => smallsOf(html).filter((s) => /gathered/.test(s.inner) && !/self-found/.test(s.inner));
const selfOf = (html) => smallsOf(html).filter((s) => /self-found/.test(s.inner));

function td(text) {
  const cell = { _html: text || "", className: "silver-val", attrs: {} };
  cell.classList = {
    add(c) {
      const have = String(cell.className).split(/\s+/).filter(Boolean);
      if (!have.includes(c)) cell.className = have.concat(c).join(" ");
    },
    contains(c) { return String(cell.className).split(/\s+/).includes(c); },
  };
  cell.setAttribute = (k, v) => { cell.attrs[k] = String(v); };
  cell.getAttribute = (k) => (k in cell.attrs ? cell.attrs[k] : null);
  cell.removeAttribute = (k) => { delete cell.attrs[k]; };
  cell.insertAdjacentHTML = (pos, html) => {
    if (pos === "beforeend") cell._html += html;
    else if (pos === "afterbegin") cell._html = html + cell._html;
    else throw new Error("harness: unsupported insertAdjacentHTML position " + pos);
  };
  Object.defineProperty(cell, "innerHTML", {
    get() { return cell._html; },
    set(v) { cell._html = String(v); },
  });
  Object.defineProperty(cell, "textContent", {
    get() { return cell._html.replace(/<[^>]*>/g, ""); },
    set(v) { cell._html = String(v); },
  });
  return cell;
}
function row(cells) {
  return {
    cells,
    querySelectorAll(sel) { return sel === "td" ? cells : []; },
    querySelector(sel) {
      const want = sel.replace(/^\./, "");
      return cells.find((c) => String(c.className).split(/\s+/).includes(want)) || null;
    },
  };
}
function plannedRow() {
  const sorts = ["", "name", "profit", "profitPer10kFocus", "focusMats"];
  globalThis.document = {
    querySelectorAll(sel) {
      if (!/^#[\w-]+ thead th$/.test(sel)) return [];
      return sorts.map((s) => ({ getAttribute: (a) => (a === "data-sort" ? s : null) }));
    },
  };
  return row([td("+"), td("Moose [T6]"), td(fmt(209603)), td(fmt(BASE)), td("20x Baby Moose")]);
}

const { patchPer10kCell, refreshPer10kCell } = require(MOD);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// ── a. patching with a finite gathered base ─────────────────────────────────
[
  { label: "planned", parked: false, want: GATH + PROFIT, main: BASE + PROFIT },
  { label: "parked", parked: true, want: GATH, main: BASE },
].forEach(({ label, parked, want, main }) => {
  test(`a. ${label}: gathered line = combinedPer10k(gathered, rowProfit, parked), main unchanged`, () => {
    const tr = plannedRow();
    assert.strictEqual(patchPer10kCell(tr, "crafting-table", BASE, PROFIT, parked, undefined, GATH), true);
    const cell = tr.cells[3];
    assert.ok(cell.textContent.startsWith(fmt(main)), `main value changed: "${cell.textContent}"`);
    const g = gatheredOf(cell.innerHTML);
    assert.strictEqual(g.length, 1, "exactly one gathered line expected");
    assert.match(g[0].open, /display:\s*block/);
    assert.match(g[0].open, /#9ca3af/);
    assert.ok(g[0].inner.includes(fmt(want)), `line must show ${fmt(want)} — got "${g[0].inner}"`);
    assert.ok(g[0].title.length > 0, "the gathered line needs its own tooltip");
    assert.strictEqual(cell.attrs["data-cl-p10k-base-gathered"], String(GATH));
    assert.strictEqual(cell.attrs["data-cl-p10k-base"], String(BASE));
  });
});

// ── b. both lines ───────────────────────────────────────────────────────────
test("b. self-found and gathered both render, neither replaces the other", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF, GATH);
  const cell = tr.cells[3];
  assert.ok(cell.textContent.startsWith(fmt(BASE + PROFIT)));
  const s = selfOf(cell.innerHTML), g = gatheredOf(cell.innerHTML);
  assert.strictEqual(s.length, 1, "self-found line lost");
  assert.strictEqual(g.length, 1, "gathered line lost");
  assert.ok(s[0].inner.includes(fmt(SELF + PROFIT)));
  assert.ok(g[0].inner.includes(fmt(GATH + PROFIT)));
  assert.strictEqual(cell.attrs["data-cl-p10k-base-self"], String(SELF));
  assert.strictEqual(cell.attrs["data-cl-p10k-base-gathered"], String(GATH));
});

// ── c. non-finite gathered ──────────────────────────────────────────────────
[undefined, NaN, null, "—"].forEach((g) => {
  test(`c. non-finite gathered (${String(g)}) renders exactly as before`, () => {
    const tr = plannedRow();
    patchPer10kCell(tr, "crafting-table", BASE, PROFIT, false, undefined, g);
    const cell = tr.cells[3];
    assert.strictEqual(cell.innerHTML, fmt(BASE + PROFIT));
    assert.strictEqual(cell.attrs["data-cl-p10k-base-gathered"], undefined);
    assert.strictEqual(smallsOf(cell.innerHTML).length, 0);
  });
});

// ── d. live qty path ────────────────────────────────────────────────────────
test("d. refresh rebuilds the gathered line from the stored base, no duplicates", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "crafting-table", BASE, PROFIT, false, undefined, GATH);
  [209603, 500, 12345].forEach((p) => {
    assert.strictEqual(refreshPer10kCell(tr, p, false), true);
    const cell = tr.cells[3];
    assert.ok(cell.textContent.startsWith(fmt(BASE + p)));
    const g = gatheredOf(cell.innerHTML);
    assert.strictEqual(g.length, 1, `duplicate or missing gathered line after refresh(${p})`);
    assert.ok(g[0].inner.includes(fmt(GATH + p)), `stale gathered value — got "${g[0].inner}"`);
    assert.ok(g[0].title.includes(fmt(p)) || !g[0].title.includes(fmt(PROFIT)),
      "stale value in the tooltip");
  });
});

test("d. refresh keeps both lines, and parking drops the planned half", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "mounts-table", BASE, PROFIT, false, SELF, GATH);
  refreshPer10kCell(tr, 0, true);
  refreshPer10kCell(tr, 0, true);
  const cell = tr.cells[3];
  assert.strictEqual(selfOf(cell.innerHTML).length, 1);
  const g = gatheredOf(cell.innerHTML);
  assert.strictEqual(g.length, 1);
  assert.ok(g[0].inner.includes(fmt(GATH)) && !g[0].inner.includes(fmt(GATH + PROFIT)));
});

test("d. refresh adds no gathered line to a row that never had one", () => {
  const tr = plannedRow();
  patchPer10kCell(tr, "crafting-table", BASE, PROFIT, false);
  refreshPer10kCell(tr, 209603, false);
  assert.strictEqual(smallsOf(tr.cells[3].innerHTML).length, 0);
});

// ── e. integration through the real render stack ────────────────────────────
// Reuse the fake-DOM sandbox of the self-found test (text between its
// "const loadFile" and "const m = new Module"), so the harness is not forked.
const selfTest = fs.readFileSync(
  path.join(__dirname, "craft-list-self-found-per10k-focus.test.cjs"), "utf8");
const from = selfTest.indexOf("const loadFile");
const to = selfTest.indexOf("const m = new Module");
assert.ok(from > 0 && to > from, "harness markers missing in the self-found test");
const buildSrc = new Function("fs", "path", "ROOT", "BASE", "SELF", "assert",
  selfTest.slice(from, to) + "\nreturn src;");
const src = buildSrc(fs, path, ROOT, BASE, SELF, assert);
const m = new Module("craft-list-gathered-per10k-test");
m._compile(src, path.join(ROOT, "js", "craft-list-gathered-per10k-test.js"));
const api = m.exports;

function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
  };
}
api.setCraftListStorage(makeStorage({}));
api.setCraftListSortStorage(makeStorage({}));
const listBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
const matsBody = { set innerHTML(v) { this._v = v; }, get innerHTML() { return this._v || ""; } };
api._store.tbodies["#craft-list-table tbody"] = listBody;
api._store.tbodies["#craft-list-mats-table tbody"] = matsBody;
api._store.els["cl-count"] = { textContent: "" };
api._store.els["cl-clear-all"] = { hidden: false };
api._store.heads["mounts-table"] = ["", "Item:name", "Profit / 10k Focus:profitPer10kFocus"];

const MOUNT_KEY = "T6_MOOSE|Martlock";
function mountRow(extra) {
  return Object.assign({
    isBreeding: false,
    item: { id: "T6_MOOSE", name: "Moose [T6]" },
    materials: [{ matId: "T4_LEATHER", count: 20 }],
    matBestPrices: { T4_LEATHER: { city: "Martlock", price: 200 } },
    buyMat: { city: "Martlock", price: 1000 },
    craftCity: "Martlock",
    sellPot: { city: "Caerleon", price: 9000 },
    totalInputCost: 4000,
    marginInfo: { profit: 400, margin: 50 },
    focusCost: 120,
    profitPer10kFocus: BASE,
  }, extra);
}
// A craft formatter whose p10k cell carries the source "gathered" line.
function craftFormatter(r) {
  const g = Number.isFinite(r.profitPer10kFocusGathered)
    ? `<small style="color:#9ca3af;display:block;font-size:0.7rem" title="src">gathered ${r.profitPer10kFocusGathered}</small>`
    : "";
  return `
  <tr data-row-key="${MOUNT_KEY}">
    <td class="cell-add"><button data-add-row="1">+</button></td>
    <td class="cell-item">${r.item.name}</td>
    <td class="silver-val">${r.profitPer10kFocus}${g}</td>
  </tr>`;
}
function renderOne(r) {
  api.clearCraftList();
  api.setBootFilling(false);
  api.setRerenderBusy(false);
  api.tableState["mounts-table"].data = [r];
  api.tableState["mounts-table"].formatter = craftFormatter;
  listBody.innerHTML = "";
  api.addCraftListEntry({ tableId: "mounts-table", rowKey: MOUNT_KEY, itemId: "T6_MOOSE", qty: 1 });
  api.renderCraftListTable();
  const html = listBody.innerHTML;
  const at = html.indexOf(`data-row-key="${MOUNT_KEY}"`);
  assert.ok(at > 0, "row rendered");
  const rowHtml = html.slice(at, html.indexOf("</tr>", at));
  const cell = /<td\b[^>]*class="[^"]*cl-p10k[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(rowHtml);
  assert.ok(cell, "p10k cell carries the cl-p10k class");
  return { rowHtml, inner: cell[1] };
}

/** The sandbox formatSilver prints ungrouped digits. */
const plain = (n) => String(Math.round(Number(n) || 0));

test("e. a craft entry's list cell keeps the source row's gathered line, combined", () => {
  const { rowHtml, inner } = renderOne(mountRow({ profitPer10kFocusGathered: GATH }));
  assert.ok(inner.includes(plain(BASE + 400)), `bought combined lost — got "${inner}"`);
  const g = gatheredOf(inner);
  assert.strictEqual(g.length, 1, "no gathered line in the list cell");
  assert.ok(g[0].inner.includes(plain(GATH + 400)), `must read gathered ${plain(GATH + 400)} — got "${g[0].inner}"`);
  assert.match(rowHtml, /data-cl-p10k-base-gathered="6100000"/);
});

test("e. an entry without a gathered value renders without the line", () => {
  const { rowHtml, inner } = renderOne(mountRow({}));
  assert.strictEqual(smallsOf(inner).length, 0);
  assert.doesNotMatch(rowHtml, /data-cl-p10k-base-gathered/);
  assert.ok(inner.includes(plain(BASE + 400)));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
