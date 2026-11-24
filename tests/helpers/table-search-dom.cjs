/**
 * Tiny fake DOM for the generic table search filter tests (js/table-search.js).
 *
 * Split out of tests/table-search.test.cjs for file size (the repo caps files at
 * 800 lines). No live DOM, no network — just enough surface for
 * applyTableSearchFilter to read the pickers and write row display.
 */

// ── fake DOM ──────────────────────────────────────────────────────────────────
// A <tr> only needs textContent, classList.contains, hasAttribute and a mutable
// style.display for the filter to operate on it.
// `cityCells` models the row's price cells: [{ city, side }], the same
// data-city / data-city-list pair js/app.js priceTd and matPriceSpan emit. The
// Buy City / Sell City pickers read those and nothing else, so a row without
// them answers to neither (js/table-filters.js rowCities).
function makeRow({ text = "", cls = [], attrs = [], display = "", rowKey = null, dataAttrs = {}, cityCells = null } = {}) {
  const classes = new Set(cls);
  const attrSet = new Set(attrs);
  const tr = {
    textContent: text,
    style: { display },
    classList: { contains: (c) => classes.has(c) },
    hasAttribute: (a) => attrSet.has(a),
    getAttribute: (a) =>
      a === "data-row-key" ? rowKey : Object.prototype.hasOwnProperty.call(dataAttrs, a) ? dataAttrs[a] : null,
  };
  if (cityCells) {
    tr.querySelectorAll = (selector) => {
      const m = String(selector).match(/data-city-list="(\w+)"/);
      const want = m ? m[1] : null;
      return cityCells
        .filter((c) => !want || c.side === want)
        .map((c) => ({ getAttribute: (a) => (a === "data-city" ? c.city : a === "data-city-list" ? c.side : null) }));
    };
  }
  return tr;
}

// Wire document so getElementById('search-<id>') → input and
// querySelector('#<id> tbody') → { rows }. Returns the input so tests can set
// .value and re-run.
// Returns the search input. The tier/enchant selects (present only when
// tierEnch:true) are attached as input.tierSel / input.enchSel so existing
// `const input = mountTable(...)` callers keep working unchanged.
// `pickers:true` additionally mounts the Category / Subcategory / Buy City /
// Sell City selects (input.catSel / input.subSel / input.buyCitySel /
// input.sellCitySel).
function mountTable(tableId, rows, { hasInput = true, tierEnch = false, pickers = false } = {}) {
  const input = { value: "" };
  const tbody = { rows };
  const tierSel = { value: "" };
  const enchSel = { value: "" };
  const catSel = { value: "", style: {}, options: [] };
  const subSel = { value: "", style: {}, options: [] };
  const buyCitySel = { value: "", style: {}, options: [] };
  const sellCitySel = { value: "", style: {}, options: [] };
  input.tierSel = tierSel;
  input.enchSel = enchSel;
  input.catSel = catSel;
  input.subSel = subSel;
  input.buyCitySel = buyCitySel;
  input.sellCitySel = sellCitySel;
  global.document = {
    getElementById(id) {
      if (hasInput && id === "search-" + tableId) return input;
      if (tierEnch && id === "tierfilter-" + tableId) return tierSel;
      if (tierEnch && id === "enchfilter-" + tableId) return enchSel;
      if (pickers && id === "catfilter-" + tableId) return catSel;
      if (pickers && id === "subcatfilter-" + tableId) return subSel;
      if (pickers && id === "buycityfilter-" + tableId) return buyCitySel;
      if (pickers && id === "sellcityfilter-" + tableId) return sellCitySel;
      return null;
    },
    querySelector(sel) {
      return sel === `#${tableId} tbody` ? tbody : null;
    },
  };
  return input;
}

const DISPLAYS = (rows) => rows.map((r) => r.style.display);


module.exports = { makeRow, mountTable, DISPLAYS };
