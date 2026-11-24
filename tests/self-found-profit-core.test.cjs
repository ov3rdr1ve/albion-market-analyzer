/**
 * Test: the shared "self-gathered" pure-profit twin — plan.md step 1 (TDD red).
 *
 * Every profit table that subtracts market-bought materials gains a second,
 * dimmed number: the same profit with the GATHERABLE inputs priced at zero and
 * every non-material silver term (station fee, recipe silver, travel legs,
 * artifacts, taxes) kept. Convention copied from the mounts breeding table's
 * self-found line (js/render-mounts-breeding-row.js, commit ea54329) and the
 * refining "Profit Gathered" logic (js/refining-route.js computeRefineGatheredProfit).
 *
 * Contract under test (plan.md architecture 1-2):
 *
 *   js/self-found-profit.js (NEW module):
 *     selfFoundProfit(sellPrice, keptSilverCosts)
 *       → sellPrice × (1 − PREMIUM_TAX) − keptSilverCosts, where PREMIUM_TAX is
 *         the SAME live getter the primary numbers use (js/calculations.js:63-65
 *         — 4% sales tax + 2.5% sell setup fee for a Premium market-order
 *         account, 8% when the Premium box is off). Non-finite inputs yield
 *         null so a renderer can omit the line instead of printing NaN.
 *     selfFoundSmallHtml(value, tipTx)
 *       → '<small style="color:#9ca3af;display:block;font-size:0.7rem"
 *          title="{tipTx}">self-gathered {formatSilver(value)}</small>'
 *          exactly like the breeding row's line; "" when value is not finite.
 *
 *   pureProfitTd (js/app.js:260) / profitWithMarginTd (js/app.js:273):
 *     marginInfo.selfFoundProfit finite → the dimmed <small> line is appended
 *     after the headline value, with its OWN title tooltip; no selfFoundProfit
 *     (or a non-finite one) → output byte-identical to today. profitWithMarginTd
 *     keeps its margin line AND gains the small line.
 *
 *   ES i18n: r_selffound (label) + r_selffound_tip (tooltip, {value}
 *   placeholder) in js/i18n-strings-es-rows.js, merged into UI_STRINGS_ES.
 *
 * How the tax getter is controlled (the repo-wide convention): PREMIUM_TAX is a
 * live getter on globalThis; it resolves isPremiumEnabled() → the
 * #premium-account checkbox stub and getOrderType() → the order-type radios.
 * Tests drive it exactly like tests/breeding-self-found-per10k-focus.test.cjs:
 * flip `_els["premium-account"].checked`, keeping orders at "market" so
 * SETUP_FEE stays 0.025.
 *
 * pureProfitTd/profitWithMarginTd are loaded the way plan.md step 2 will leave
 * them: from js/pure-profit-cell.js once it exists, otherwise lifted out of
 * js/app.js source (the planner harness lifts marginalSilverPerFocus the same
 * way). Either way the assertions run against the REAL production cells.
 *
 * RED BY DESIGN: js/self-found-profit.js does not exist yet and no renderer
 * writes selfFoundProfit, so the module test, the <small> tests and the ES
 * test must fail now, for exactly those reasons.
 *
 * All market data simulated; no browser, no live API.
 *
 * Run: node --test tests/self-found-profit-core.test.cjs
 */

const assert = require("assert");
const { test } = require("node:test");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = path.join(__dirname, "..");
const J = (f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8").replace(/\r\n/g, "\n");

// The app-global shims every harness in this repo stands up. formatSilver is
// deterministic (en-US grouping) so byte-exact HTML assertions are possible;
// tx identity keeps assertions in English.
const SANDBOX = `
const _els = {
  "premium-account": { checked: true },
  "station-fee": { value: "0" },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
function isPremiumEnabled() {
  const cb = document.getElementById("premium-account");
  return !cb || cb.checked;
}
function getOrderType() { return "market"; }   // orders: SETUP_FEE 0.025 applies
function formatSilver(n) { return Math.round(Number(n) || 0).toLocaleString("en-US"); }
function tx(en, slug) { return en; }
`;

function compile(sources, name) {
  const mod = new Module(name);
  mod._compile(SANDBOX + sources + "\nmodule.exports = { _els };", name);
  return mod.exports;
}

// ── 1. js/self-found-profit.js ───────────────────────────────────────────────

const SF_PATH = path.join(ROOT, "js", "self-found-profit.js");
let sf = null;
let sfError = null;
try {
  sf = compile(
    J("data-city-bonuses.js") + (J("calculations.js") + J("calculations-margins.js")) + fs.readFileSync(SF_PATH, "utf8"),
    "self-found-profit-test.js",
  );
} catch (e) {
  sfError = e;
}

const near = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-9);

test("js/self-found-profit.js loads and exports both helpers", () => {
  if (sfError) {
    throw new Error("js/self-found-profit.js is missing or failed to load: " + sfError.message);
  }
  assert.strictEqual(typeof sf.selfFoundProfit, "function",
    "module must export selfFoundProfit(sellPrice, keptSilverCosts)");
  assert.strictEqual(typeof sf.selfFoundSmallHtml, "function",
    "module must export selfFoundSmallHtml(value, tipTx)");
});

// Pull the helpers, failing with the load error (not a TypeError) while red.
function helpers() {
  if (sfError) throw new Error("js/self-found-profit.js failed to load: " + sfError.message);
  return sf;
}

test("formula: sellPrice x (1 - PREMIUM_TAX) - keptSilverCosts", () => {
  const { selfFoundProfit } = helpers();
  // 1000 x (1 - 0.065) - 200 = 935 - 200 = 735 (Premium, market orders).
  assert.ok(near(selfFoundProfit(1000, 200), 735), `got ${selfFoundProfit(1000, 200)}`);
});

test("zero kept costs: the twin is the taxed revenue alone", () => {
  const { selfFoundProfit } = helpers();
  assert.ok(near(selfFoundProfit(1000, 0), 935), `got ${selfFoundProfit(1000, 0)}`);
});

test("a negative result stays negative (no clamping to zero)", () => {
  const { selfFoundProfit } = helpers();
  assert.ok(near(selfFoundProfit(1000, 5000), 935 - 5000), `got ${selfFoundProfit(1000, 5000)}`);
  assert.ok(selfFoundProfit(1000, 5000) < 0, "must not be clamped");
});

test("fractional silver is preserved, not rounded", () => {
  const { selfFoundProfit } = helpers();
  assert.ok(near(selfFoundProfit(420, 0), 420 * (1 - 0.065)), `got ${selfFoundProfit(420, 0)}`);
});

[NaN, Infinity, -Infinity, undefined, null].forEach((bad) => {
  test(`non-finite sellPrice (${String(bad)}) → null`, () => {
    const { selfFoundProfit } = helpers();
    assert.strictEqual(selfFoundProfit(bad, 100), null);
  });
  test(`non-finite keptSilverCosts (${String(bad)}) → null`, () => {
    const { selfFoundProfit } = helpers();
    assert.strictEqual(selfFoundProfit(1000, bad), null);
  });
});

test("the twin rides the LIVE premium-account getter (8% tax when the box is off)", () => {
  const { selfFoundProfit, _els } = helpers();
  _els["premium-account"].checked = false;
  try {
    // 1000 x (1 - 0.105) - 0 = 895.
    assert.ok(near(selfFoundProfit(1000, 0), 895), `got ${selfFoundProfit(1000, 0)}`);
  } finally {
    _els["premium-account"].checked = true;
  }
  assert.ok(near(selfFoundProfit(1000, 0), 935), "must follow the checkbox back");
});

test("selfFoundSmallHtml: the breeding-row line, value formatted like formatSilver", () => {
  const { selfFoundSmallHtml } = helpers();
  const html = selfFoundSmallHtml(1234.6, "Same craft, mats self-gathered: {value}");
  assert.strictEqual(
    html,
    '<small style="color:#9ca3af;display:block;font-size:0.7rem"'
      + ' title="Same craft, mats self-gathered: {value}">self-gathered 1,235</small>',
    `got ${html}`,
  );
});

test("selfFoundSmallHtml: a non-finite value omits the line", () => {
  const { selfFoundSmallHtml } = helpers();
  assert.strictEqual(selfFoundSmallHtml(NaN, "tip"), "");
  assert.strictEqual(selfFoundSmallHtml(undefined, "tip"), "");
  assert.strictEqual(selfFoundSmallHtml(Infinity, "tip"), "");
});

// ── 2. pureProfitTd / profitWithMarginTd gain the dimmed line ────────────────

function liftFn(name, src) {
  const m = src.match(new RegExp("function " + name + "\\([\\s\\S]*?\\n}\\n"));
  if (!m) throw new Error(`function ${name} not found for the cell-builder harness`);
  return m[0];
}

let cellMod = null;
let cellError = null;
try {
  // plan.md step 2 extracts the cell builders into js/pure-profit-cell.js with
  // app.js re-exporting them. Load the module once it exists; until then lift
  // the REAL definitions out of app.js so the assertions run on production code
  // either way.
  const pureCellPath = path.join(ROOT, "js", "pure-profit-cell.js");
  const buildersSrc = fs.existsSync(pureCellPath)
    ? fs.readFileSync(pureCellPath, "utf8").replace(/\r\n/g, "\n")
    : liftFn("pureProfitTd", J("app.js")) + liftFn("profitWithMarginTd", J("app.js"));
  // getProfitClass is js/calculations.js's (margin → CSS class); the twin line
  // needs the shared self-found helper in scope, exactly like the browser,
  // where index.html loads both before the renderers run.
  const src = SANDBOX
    + liftFn("getProfitClass", (J("calculations.js") + J("calculations-margins.js")))
    + (fs.existsSync(SF_PATH) ? fs.readFileSync(SF_PATH, "utf8").replace(/\r\n/g, "\n") : "")
    + buildersSrc
    + "\nmodule.exports = { pureProfitTd, profitWithMarginTd, _els };";
  const mod = new Module("pure-profit-cell-test");
  mod._compile(src, "pure-profit-cell-test.js");
  cellMod = mod.exports;
} catch (e) {
  cellError = e;
}

function cells() {
  if (cellError) throw new Error("cell builders failed to load: " + cellError.message);
  return cellMod;
}

const MARGIN_INFO = { profit: 12345, margin: 25 };

test("pureProfitTd WITHOUT selfFoundProfit is byte-identical to today", () => {
  const { pureProfitTd } = cells();
  assert.strictEqual(
    pureProfitTd(MARGIN_INFO, "Sell 60,000 - mats 44,805 + fees"),
    '<td class="silver-val profit-high" title="Sell 60,000 - mats 44,805 + fees">12,345</td>',
  );
  // The dash fallback must not grow a line either.
  assert.strictEqual(
    pureProfitTd({ margin: 10 }, "no profit"),
    '<td class="silver-val" style="color:#6b7280;font-style:italic">\u2014</td>',
  );
});

test("profitWithMarginTd WITHOUT selfFoundProfit is byte-identical to today", () => {
  const { profitWithMarginTd } = cells();
  assert.strictEqual(
    profitWithMarginTd(MARGIN_INFO, "Arithmetic: 60,000 - 44,805", "crafting-table", 7, "Lymhurst"),
    '<td class="silver-val profit-high profit-cell-clickable" data-profit-cell="1"'
      + ' data-table-id="crafting-table" data-row-idx="7" data-sell-city="Lymhurst"'
      + ' title="Arithmetic: 60,000 - 44,805 \u2014 click to change sell city">12,345'
      + '<br><small style="color:#9ca3af">25.00%</small></td>',
  );
});

function smallOf(html) {
  const m = /<small\b([^>]*)>([\s\S]*?)<\/small>([\s\S]*)$/.exec(String(html));
  if (!m) return null;
  const attrs = {};
  String(m[1]).replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ""; });
  return { open: m[1], inner: m[2], rest: m[3], attrs, title: attrs.title || "" };
}

test("pureProfitTd with a finite selfFoundProfit appends the dimmed self-gathered line", () => {
  const { pureProfitTd } = cells();
  const html = pureProfitTd({ ...MARGIN_INFO, selfFoundProfit: 9000 }, "arithmetic");
  assert.ok(html.includes('<td class="silver-val profit-high" title="arithmetic">12,345'),
    `headline value lost: ${html}`);
  assert.ok(html.indexOf("12,345") < html.indexOf("<small"),
    "the twin line must come after the headline value");
  const small = smallOf(html);
  assert.ok(small, `no <small> twin line: ${html}`);
  assert.match(small.open, /display:\s*block/, "the line must be a block of its own");
  assert.match(small.open, /#9ca3af/, "the line must be dimmed like the breeding row's");
  assert.match(small.inner, /self-gathered/, "the line must carry the self-gathered label");
  assert.ok(small.inner.includes("9,000"),
    `line must show formatSilver(9000) — got "${small.inner}"`);
  assert.ok(small.title.length > 0, "the twin line carries no own tooltip");
  assert.notStrictEqual(small.title, "arithmetic",
    "the line must not reuse the headline cell's tooltip");
});

test("profitWithMarginTd keeps its margin line AND gains the self-gathered line", () => {
  const { profitWithMarginTd } = cells();
  const html = profitWithMarginTd(
    { ...MARGIN_INFO, selfFoundProfit: 9000 }, "arithmetic", "crafting-table", 7, "Lymhurst");
  assert.ok(html.includes(">12,345<br><small style=\"color:#9ca3af\">25.00%</small>"),
    `the bought value + margin line must survive: ${html}`);
  const tail = html.slice(html.indexOf("25.00%</small>"));
  assert.match(tail, /<small[^>]*display:\s*block[^>]*>[\s\S]*?self-gathered[\s\S]*?9,000[\s\S]*?<\/small>/,
    `no self-gathered line after the margin line: ${html}`);
  const openTag = /<small[^>]*display:\s*block[^>]*>/.exec(html)[0];
  assert.match(openTag, /title="[^"]+"/, "the twin line carries its own title attribute");
});

test("a NON-finite selfFoundProfit (NaN) changes nothing", () => {
  const { pureProfitTd, profitWithMarginTd } = cells();
  assert.strictEqual(
    pureProfitTd({ ...MARGIN_INFO, selfFoundProfit: NaN }, "arithmetic"),
    '<td class="silver-val profit-high" title="arithmetic">12,345</td>',
  );
  assert.strictEqual(
    profitWithMarginTd({ ...MARGIN_INFO, selfFoundProfit: NaN }, "arithmetic",
      "crafting-table", 7, "Lymhurst"),
    '<td class="silver-val profit-high profit-cell-clickable" data-profit-cell="1"'
      + ' data-table-id="crafting-table" data-row-idx="7" data-sell-city="Lymhurst"'
      + ' title="arithmetic \u2014 click to change sell city">12,345'
      + '<br><small style="color:#9ca3af">25.00%</small></td>',
  );
});

test("a negative selfFoundProfit still renders (loss stays visible)", () => {
  const { pureProfitTd } = cells();
  const html = pureProfitTd({ ...MARGIN_INFO, selfFoundProfit: -4000 }, "arithmetic");
  assert.ok(html.includes("self-gathered -4,000"), `got ${html}`);
});

// ── 3. the ES overlay ────────────────────────────────────────────────────────

test("ES i18n: r_selffound / r_selffound_tip exist with placeholders intact", () => {
  const { UI_STRINGS_ES_ROWS } = require(path.join(ROOT, "js", "i18n-strings-es-rows.js"));
  const { UI_STRINGS_ES } = require(path.join(ROOT, "js", "i18n-strings-es.js"));
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_selffound, "string",
    "missing ES entry r_selffound in js/i18n-strings-es-rows.js");
  assert.ok(!/\{[a-z]+\}/.test(UI_STRINGS_ES_ROWS.r_selffound),
    "r_selffound is a plain label and must not carry placeholders");
  assert.strictEqual(typeof UI_STRINGS_ES_ROWS.r_selffound_tip, "string",
    "missing ES entry r_selffound_tip in js/i18n-strings-es-rows.js");
  assert.ok(UI_STRINGS_ES_ROWS.r_selffound_tip.includes("{value}"),
    "r_selffound_tip lost the {value} placeholder");
  assert.ok(UI_STRINGS_ES.r_selffound != null && UI_STRINGS_ES.r_selffound_tip != null,
    "slugs not merged into UI_STRINGS_ES — tx() would render English in the Spanish UI");
});
