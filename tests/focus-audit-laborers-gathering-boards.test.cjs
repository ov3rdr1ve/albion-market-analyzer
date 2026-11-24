/**
 * Focus audit — Laborers / Journals, Gathering, Transmute / Rolling, and the
 * two Top-10 boards.
 *
 * The one global "Use Focus" checkbox (#use-focus, read by isFocusEnabled in
 * js/utils.js) has to move exactly the figures that are focused, and nothing
 * else. This file pins that, black-box, in two halves:
 *
 *  1. The five feeder tables that spend NO focus (Laborers, Journal Filling,
 *     Gathering, Transmute, Artifact Rolling). Each is rendered by its REAL
 *     renderer over the REAL js/utils.js + js/calculations.js, against a
 *     synthetic market that prices every id it is asked for, once with the box
 *     ticked and once with it cleared. Every row and every rendered cell must
 *     come out identical, and the renderer must never even read #use-focus.
 *     The three of them that feed the Top-10 boards must also contribute the
 *     same Pure Profit board either way, and never reach the focus board.
 *
 *  2. The Top-10 boards (js/render-joined-summary.js over
 *     js/joined-summary-sources.js) fed synthetic rows shaped like the five
 *     focus-spending tables publish them: `marginInfo.profit` follows the
 *     checkbox, while `focusCost`, `profitFocusOn` and `profitPer10kFocus` are
 *     the focus-ON benchmark and do not. The focus board must rank and print
 *     only the focus-ON figures; the profit board only the checkbox figure.
 *
 * No DOM, no network: every market price is synthesized.
 *
 * Run: node --test tests/focus-audit-laborers-gathering-boards.test.cjs
 */

const { test } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const JS = path.join(ROOT, "js");
const J = (f) => fs.readFileSync(path.join(JS, f), "utf8");

// ─── Part 1: real renderers, focus toggled ──────────────────────────────────

// Inert table/cell helpers. Every cell echoes the numbers it was handed, so a
// focus-driven change to any of them would show up in the rendered HTML.
const STUBS = `
const _els = {
  "use-focus": { checked: true },
  "premium-account": { checked: true },
  "include-caerleon": { checked: false },
};
const _reads = [];
const document = {
  getElementById: (id) => { _reads.push(id); return _els[id] || null; },
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
};
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const window = { addEventListener() {} };
const tableState = {
  "laborers-table": {}, "journal-filling-table": {}, "gathering-table": {},
  "transmute-table": {}, "rolling-table": {},
};
function renderTableData(id, rows, fmt) {
  tableState[id] = tableState[id] || {};
  tableState[id].data = rows;
  tableState[id].html = rows.map((r, i) => { try { return fmt(r, i); } catch (e) { return "ERR:" + e.message; } });
}
function priceTd(p, id, city) { return "<td>" + p + "|" + id + "|" + city + "</td>"; }
function profitTd(mi) { return "<td>" + (mi && mi.profit) + "</td>"; }
function pureProfitTd(mi) { return "<td>" + (mi && mi.profit) + "</td>"; }
function profitWithMarginTd(mi, breakdown) { return "<td>" + (mi && mi.profit) + "|" + breakdown + "</td>"; }
function aggregateCostTd(c) { return "<td>" + c + "</td>"; }
function volTd(v) { return "<td>" + v + "</td>"; }
function addTdForKey() { return "<td></td>"; }
function getRowKey(row, t) {
  return t + "|" + JSON.stringify([row.item && row.item.id, row.item && row.item.name, row.artId,
    row.rawId, row.tier, row.section, row.mode, row.rollType, row.transition && row.transition.label]);
}
function dispName(id, name) { return name || id; }
function tx(en) { return en; }
function formatPriceAge() { return null; }
function resourceAliasSpan() { return ""; }
function matPriceSpan(id, city, p) { return "<span>" + p + "</span>"; }
function suspectMarginBadge() { return ""; }
const ITEM_NAMES_MAP = {};
let lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
`;

// The real shared layer, in index.html's order (the table files lean on it).
const BASE = [
  "resource-names.js", "data-city-bonuses.js", "calculations.js", "calculations-margins.js", "travel-cost.js",
  "mp-bonus.js", "utils.js", "utils-item-ids.js", "utils-overrides.js", "utils-focus-fees.js", "price-freshness.js", "table-sell-city.js",
];
// Laborer + journal stack. Gathering data and fame rates go first: the journal
// fill-speed file reads them at load.
const LABORER_STACK = [
  "data-gathering.js", "gather-fame-rates.js", "data-journals.js", "journal-fill-speed.js",
  "journal-fame-price.js", "house-tier.js", "laborer-happiness.js", "data-laborers.js",
  "laborers-pricing.js", "render-laborers.js", "laborer-journal-value.js",
  "laborer-craft-fill.js", "laborer-self-fill.js", "laborer-journal-play.js",
  "journal-laborer-payload.js",
];

const NO_FOCUS_TABLES = [
  { name: "Laborers", tableId: "laborers-table", fn: "renderLaborersTable",
    files: LABORER_STACK,
    profit: (r) => (r.marginInfo ? r.marginInfo.profit : 0) },
  { name: "Journal Filling", tableId: "journal-filling-table", fn: "renderJournalFillingTable",
    files: [...LABORER_STACK, "render-journals.js"],
    profit: (r) => r.journalMargin || 0 },
  { name: "Gathering", tableId: "gathering-table", fn: "renderGatheringTable",
    files: [...LABORER_STACK, "render-journals.js", "render-gathering.js"],
    profit: (r) => r.silverPerHour || 0 },
  { name: "Transmute", tableId: "transmute-table", fn: "renderTransmuteTable",
    files: ["data-transmute.js", "render-transmute.js"],
    profit: (r) => (r.marginInfo ? r.marginInfo.profit : 0) },
  { name: "Artifact Rolling", tableId: "rolling-table", fn: "renderRollingTable",
    files: ["data-artifacts.js", "fragment-transmute-sourcing.js", "rolling-strategy.js", "render-rolling.js"],
    profit: (r) => (r.sellRevenue || 0) - (r.rollCostSilver || 0) },
];

function loadRenderer(spec) {
  const filename = path.join(JS, `__focus-audit-${spec.tableId}.js`);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(JS);
  mod._compile(
    STUBS + [...BASE, ...spec.files].map(J).join("\n") +
      `\nmodule.exports = { _els, _reads, tableState, render: ${spec.fn}, isFocusEnabled };`,
    filename,
  );
  return mod.exports;
}

// Deterministic per-(item, city) prices for ANY id the renderer asks for, so
// every row is priced. The ids "undefined"/"null" stay absent, as in real data.
const MARKET_CITIES = [...["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien"], "Black Market", "Smuggler's Den"];
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function syntheticMarket() {
  return new Proxy({}, {
    get(_, id) {
      if (typeof id !== "string" || id === "undefined" || id === "null" || id === "") return undefined;
      const out = {};
      MARKET_CITIES.forEach((c) => {
        const p = 100 + (hash(id + "|" + c) % 9000);
        const s = Math.round(p * 1.1);
        out[c] = { buy_price: p, sell_price: s, buy: p, sell: s, volume_24h: 500 };
      });
      return out;
    },
    has: () => true,
  });
}

function renderWith(X, spec, useFocus) {
  X._els["use-focus"].checked = useFocus;
  X._reads.length = 0;
  X.render(syntheticMarket());
  const st = X.tableState[spec.tableId];
  return {
    rows: st.data,
    json: JSON.stringify(st.data),
    html: st.html.slice(),
    readFocus: X._reads.includes("use-focus"),
  };
}

const RENDERS = {};
NO_FOCUS_TABLES.forEach((spec) => {
  const X = loadRenderer(spec);
  RENDERS[spec.tableId] = {
    X,
    on: renderWith(X, spec, true),
    off: renderWith(X, spec, false),
  };
});

for (const spec of NO_FOCUS_TABLES) {
  const R = () => RENDERS[spec.tableId];

  test(`${spec.name}: the harness really toggles Use Focus (positive control)`, () => {
    const { X } = R();
    X._els["use-focus"].checked = true;
    assert.strictEqual(X.isFocusEnabled(), true);
    X._els["use-focus"].checked = false;
    assert.strictEqual(X.isFocusEnabled(), false);
  });

  test(`${spec.name}: renders priced, profitable rows without a formatter error`, () => {
    const { on } = R();
    assert.ok(on.rows.length > 0, "no rows rendered");
    assert.ok(!on.html.some((h) => h.startsWith("ERR:")), on.html.find((h) => h.startsWith("ERR:")));
    assert.ok(on.rows.some((r) => spec.profit(r) > 0), "no row is profitable — the comparison would be vacuous");
  });

  test(`${spec.name}: OK — no focus play: the renderer never reads #use-focus`, () => {
    const { on, off } = R();
    assert.strictEqual(on.readFocus, false);
    assert.strictEqual(off.readFocus, false);
  });

  test(`${spec.name}: every row's profit is identical with Use Focus on and off`, () => {
    const { on, off } = R();
    assert.strictEqual(on.rows.length, off.rows.length);
    on.rows.forEach((r, i) => assert.strictEqual(spec.profit(off.rows[i]), spec.profit(r), `row ${i}`));
  });

  test(`${spec.name}: every row and every rendered cell is identical with Use Focus on and off`, () => {
    const { on, off } = R();
    assert.strictEqual(off.json, on.json);
    assert.deepStrictEqual(off.html, on.html);
  });

  test(`${spec.name}: no row carries a focus cost or a Profit / 10k Focus figure`, () => {
    const { on } = R();
    on.rows.forEach((r, i) => {
      assert.ok(!(Number(r.focusCost) > 0), `row ${i} has focusCost ${r.focusCost}`);
      assert.ok(r.profitPer10kFocus == null || r.profitPer10kFocus === 0, `row ${i} has a per-10k figure`);
    });
  });
}

// ─── Part 2: the Top-10 boards ──────────────────────────────────────────────

const calc = require(path.join(JS, "calculations.js"));
globalThis.tx = globalThis.tx || ((en) => en);
globalThis.dispName = globalThis.dispName || ((id, fallback) => fallback);
globalThis.getRowKey = (row, tableId) =>
  `${tableId}|${row?.item?.id || row?.route?.refinedId || row?.artId || row?.name || ""}|${row?.mode || ""}|${row?.tier || ""}|${row?.section || ""}|${row?.rollType || ""}`;
globalThis.formatSilver = calc.formatSilver;
globalThis.formatFocusCost = calc.formatFocusCost;
globalThis.focusBarCrafts = calc.focusBarCrafts;
globalThis.formatBarCrafts = calc.formatBarCrafts;
globalThis.getProfitClass = calc.getProfitClass;

const { JOINED_SOURCES } = require(path.join(JS, "joined-summary-sources.js"));
const {
  collectTopProfitRows, collectTopFocusRows, formatJoinedFocusRow,
} = require(path.join(JS, "render-joined-summary.js"));

function setTables(map) {
  globalThis.tableState = {};
  Object.entries(map).forEach(([id, rows]) => { globalThis.tableState[id] = { data: rows }; });
}

/**
 * One row of a focus-spending table, as that table publishes it for the given
 * checkbox state. `on` / `off` are the focus-ON and focus-OFF profits of one
 * play; the focus cost, profitFocusOn and the per-10k figure are invariant.
 */
const FOCUS_FEEDERS = {
  "crafting-table": (id, on, off, cost, useFocus) => ({
    item: { id, name: id }, craftCity: "Lymhurst",
    sellGear: { city: "Martlock", price: 100000 }, totalInputCost: 50000, sellVol: 100,
  }),
  "transport-table": (id) => ({
    route: { refinedId: id, rawId: id + "_RAW" }, buyRaw: { city: "Lymhurst" },
    refineCity: "Lymhurst", sellRefined: { city: "Martlock", price: 1000 },
    totalRawCost: 500, dailyVol: 100,
  }),
  "consumable-table": (id) => ({
    item: { id, name: id }, craftCity: "Martlock", sellPot: { city: "Caerleon", price: 1500 },
    totalInputCost: 800, dailyVol: 100,
  }),
  "farming-table": (id) => ({
    item: { id, name: id, outputId: id + "_CROP" }, buySeed: { city: "Thetford", price: 100 },
    sellCrop: { city: "Lymhurst", price: 500 }, farmCity: "Lymhurst",
    totalInputCost: 100, dailyVol: 100,
    profitPerFocus: 999999, // the marginal rate — must never be ranked
  }),
  "mounts-table": (id) => ({
    item: { id, name: id }, isBreeding: false, craftCity: "Lymhurst",
    buyMat: { city: "Lymhurst", price: 1000 }, sellPot: { city: "Martlock", price: 100000 },
    totalInputCost: 50000, dailyVol: 10,
  }),
};

function feederRow(tableId, id, { on, off, cost }, useFocus) {
  return {
    ...FOCUS_FEEDERS[tableId](id),
    marginInfo: { profit: useFocus ? on : off, margin: 10 },
    focusCost: cost,
    profitFocusOn: on,
    profitPer10kFocus: calc.calculateProfitPer10kFocus(on, cost),
  };
}

// Three plays per table, chosen so the focus-ON order, the focus-OFF order and
// the per-10k order all differ: ranking on the wrong field is visible.
//   A: big focus gain, cheap focus  → best per 10k, best ON, worst OFF
//   B: no focus gain, dear focus    → worst per 10k, middle ON, best OFF
//   C: middle
const PLAYS = {
  A: { on: 9000, off: 1000, cost: 100 },
  B: { on: 5000, off: 5000, cost: 2000 },
  C: { on: 7000, off: 3000, cost: 500 },
};
function feederRows(tableId, useFocus) {
  return Object.entries(PLAYS).map(([k, p]) => feederRow(tableId, `${tableId}_${k}`, p, useFocus));
}
const per10kOf = (k) => calc.calculateProfitPer10kFocus(PLAYS[k].on, PLAYS[k].cost);
const playOf = (row) => {
  const m = /_([ABC])(?:_CROP)?$/.exec(row.sellItemId || "") || /_([ABC])\b/.exec(row.itemName || "");
  return m ? m[1] : null;
};

for (const tableId of Object.keys(FOCUS_FEEDERS)) {
  test(`Top-10 focus board / ${tableId}: Profit / 10k Focus is the focus-ON figure and does not move with Use Focus`, () => {
    setTables({ [tableId]: feederRows(tableId, true) });
    const on = collectTopFocusRows();
    setTables({ [tableId]: feederRows(tableId, false) });
    const off = collectTopFocusRows();
    assert.deepStrictEqual(on.map(playOf), ["A", "C", "B"], "ranked by per 10k, best first");
    assert.deepStrictEqual(off.map(playOf), on.map(playOf), "the order moved with the checkbox");
    on.forEach((r, i) => {
      assert.strictEqual(r.profitPer10kFocus, per10kOf(playOf(r)));
      assert.strictEqual(off[i].profitPer10kFocus, r.profitPer10kFocus);
      assert.strictEqual(off[i].focusCost, r.focusCost);
    });
  });

  test(`Top-10 focus board / ${tableId}: its Profit column is the focus-ON profit the per-10k figure multiplies, in both states`, () => {
    for (const useFocus of [true, false]) {
      setTables({ [tableId]: feederRows(tableId, useFocus) });
      collectTopFocusRows().forEach((r) => {
        assert.strictEqual(r.pureProfit, PLAYS[playOf(r)].on,
          `Use Focus ${useFocus ? "on" : "off"}: play ${playOf(r)} shows ${r.pureProfit}`);
      });
    }
  });

  test(`Top-10 focus board / ${tableId}: the rendered row's math tooltip quotes the focus-ON profit with Use Focus off`, () => {
    setTables({ [tableId]: feederRows(tableId, false) });
    const row = collectTopFocusRows().find((r) => playOf(r) === "A");
    const html = formatJoinedFocusRow(row, 0);
    const tip = /title="([^"]*profit × [^"]*)"/.exec(html);
    assert.ok(tip, "no focus-math tooltip");
    assert.ok(tip[1].startsWith(calc.formatSilver(PLAYS.A.on) + " profit"), tip[1]);
    assert.ok(html.includes(`<b>${calc.formatSilver(per10kOf("A"))}</b>`), "per-10k cell");
  });

  test(`Top-10 profit board / ${tableId}: ranks and prints the CURRENT-toggle profit, never the focus-ON one`, () => {
    setTables({ [tableId]: feederRows(tableId, false) });
    const off = collectTopProfitRows();
    assert.deepStrictEqual(off.map(playOf), ["B", "C", "A"], "focus-off order");
    off.forEach((r) => assert.strictEqual(r.pureProfit, PLAYS[playOf(r)].off));
    setTables({ [tableId]: feederRows(tableId, true) });
    const on = collectTopProfitRows();
    assert.deepStrictEqual(on.map(playOf), ["A", "C", "B"], "focus-on order");
    on.forEach((r) => assert.strictEqual(r.pureProfit, PLAYS[playOf(r)].on));
  });
}

test("Top-10 focus board: all five focus tables together rank identically with Use Focus on and off", () => {
  const all = (useFocus) => Object.fromEntries(
    Object.keys(FOCUS_FEEDERS).map((t) => [t, feederRows(t, useFocus)]));
  setTables(all(true));
  const on = collectTopFocusRows().map((r) => [r.tableId, playOf(r), r.profitPer10kFocus, r.pureProfit]);
  setTables(all(false));
  const off = collectTopFocusRows().map((r) => [r.tableId, playOf(r), r.profitPer10kFocus, r.pureProfit]);
  assert.strictEqual(on.length, 10);
  assert.deepStrictEqual(off, on);
});

test("Top-10 focus board: farming ranks on its per-10k figure, never on its marginal Silver/Focus rate", () => {
  setTables({
    "farming-table": [feederRow("farming-table", "farming-table_C", PLAYS.C, false)],
    "crafting-table": [feederRow("crafting-table", "crafting-table_A", PLAYS.A, false)],
  });
  const board = collectTopFocusRows();
  assert.deepStrictEqual(board.map((r) => r.tableId), ["crafting-table", "farming-table"]);
});

// The three no-focus feeders, from their REAL rendered rows (part 1).
const NO_FOCUS_FEEDERS = ["laborers-table", "transmute-table", "rolling-table"];

for (const tableId of NO_FOCUS_FEEDERS) {
  test(`Top-10 boards / ${tableId}: OK — no focus play: same profit board with Use Focus on and off`, () => {
    const R = RENDERS[tableId];
    const project = () => collectTopProfitRows().map((r) => [r.rowKey, r.pureProfit, r.inputCost, r.sellPrice]);
    setTables({ [tableId]: R.on.rows });
    const on = project();
    setTables({ [tableId]: R.off.rows });
    const off = project();
    assert.ok(on.length > 0, "the real rows fed nothing to the profit board");
    assert.deepStrictEqual(off, on);
  });

  test(`Top-10 boards / ${tableId}: never reaches the focus board, even with stray focus fields`, () => {
    const rows = RENDERS[tableId].on.rows.map((r) => ({ ...r, focusCost: 100, profitPer10kFocus: 1e9, profitFocusOn: 1e6 }));
    assert.strictEqual(JOINED_SOURCES[tableId].focus(rows[0]), null);
    setTables({ [tableId]: rows });
    assert.deepStrictEqual(collectTopFocusRows(), []);
  });
}
