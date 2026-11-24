/**
 * Shared sandbox loader for the focus-specialization tests.
 *
 * The browser loads js/focus-spec-nodes.js, js/focus-spec-items.js and
 * js/focus-spec.js as plain globals; here we stitch the same sources into one
 * `new Function` scope with a stubbed localStorage, so every test starts from a
 * clean, isolated store (no shared state between test files).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf-8");

const SPEC_EXPORTS = [
  "FOCUS_SPEC_NODES",
  "FOCUS_SPEC_GROUPS",
  "FOCUS_SPEC_FAMILIES",
  "FOCUS_SPEC_ITEM_FAMILY",
  "specNodesForItem",
  "getItemFCE",
  "focusSpecMultiplier",
  "defaultSpecLevel",
  "getSpecLevel",
  "getSpecLevels",
  "setSpecLevel",
  "setSpecLevels",
  "setSpecLevelsFor",
  "setAllSpecLevels",
  "resetSpecLevels",
  "hasCustomSpec",
  "withSpecScope",
  "currentSpecScope",
  "exportSpecLevels",
  "importSpecLevels",
  "hasMySpecLevels",
  "exportMySpecLevels",
  "restoreMySpecLevels",
  "withoutSpecRecording",
];

/** focus-spec.js + the ⚙ panel module (TABLE_SPEC_BRANCHES, the global apply). */
function loadFocusSpecWithPanel(store = {}) {
  // The panel only touches `document` behind a typeof guard, so it loads
  // headless here exactly as the browser loads it after focus-spec.js.
  const api = new Function(
    "localStorage",
    `${read("js/focus-spec-nodes.js")}
     ${read("js/focus-spec-items.js")}
     ${read("js/focus-spec.js")}
     ${read("js/spec-settings-panel.js")}
     return { ${SPEC_EXPORTS.join(", ")},
              TABLE_SPEC_BRANCHES, specNodeIdsForScope, setAllTablesSpecLevels };`
  )(makeLocalStorage(store));
  api.__store = store;
  return api;
}

// Mirrors the Storage interface, including length/key(i) — exportSpecLevels
// enumerates the store to find every scope the user has touched.
function makeLocalStorage(store) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => {
      const keys = Object.keys(store);
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
  };
}

/** focus-spec.js alone (node data + level store + multiplier). */
function loadFocusSpec(store = {}) {
  const api = new Function(
    "localStorage",
    `${read("js/focus-spec-nodes.js")}
     ${read("js/focus-spec-items.js")}
     ${read("js/focus-spec.js")}
     return { ${SPEC_EXPORTS.join(", ")} };`
  )(makeLocalStorage(store));
  api.__store = store;
  return api;
}

/** focus-spec.js + js/utils.js, i.e. the real getFocusCost pipeline. */
function loadFocusSpecWithUtils(store = {}) {
  const focusCosts = JSON.parse(read("js/focus-costs.json"));
  const api = new Function(
    "localStorage",
    `const FOCUS_COSTS = ${JSON.stringify(focusCosts)};
     ${read("js/focus-spec-nodes.js")}
     ${read("js/focus-spec-items.js")}
     ${read("js/focus-spec.js")}
     ${read("js/chain-recipes.js")}
     ${(read("js/utils.js") + read("js/utils-item-ids.js") + read("js/utils-overrides.js") + read("js/utils-focus-fees.js"))}
     return { ${SPEC_EXPORTS.join(", ")},
              getFocusCost, getBaseFocusCost, getCraftFocusCost, getButcherFocusCost };`
  )(makeLocalStorage(store));
  api.__store = store;
  return api;
}

module.exports = { loadFocusSpec, loadFocusSpecWithUtils, loadFocusSpecWithPanel };
