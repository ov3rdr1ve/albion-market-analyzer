/**
 * Focus specialization — turns Destiny Board node levels into a focus cost
 * multiplier.
 *
 * The game halves focus cost for every 10,000 Focus Cost Efficiency (FCE)
 * points, and a node at level L grants  bonus × 100 × L  FCE (bonus values come
 * from achievements.xml via scripts/gen-focus-spec-nodes.cjs):
 *
 *   FCE(item)  = Σ over the item's nodes of  bonus × 100 × level(node)
 *   multiplier = 0.5 ^ (FCE / 10000)
 *
 * A node the user has never typed a level for reads 0 — EXCEPT the mastery
 * heading its own group (Chef, Alchemist, Animals, Swords…), which anybody who
 * crafts at all has maxed and which is ten numbers rather than 367.
 *
 * Defaulting everything to 100 (what this file did until 2026-08-04) is
 * invisible and expensive: set two cooking nodes in a table's ⚙ panel and the
 * other eight silently stay maxed, which is 24,000 FCE and prices the craft ~4×
 * too cheap. The reported case — Chef 100, Butcher 100, Stew Chef 17 — read 19
 * focus on a T6 Avalonian Stew against 80.3 in game, and 15 on a butchered goose
 * against 74. "All 100 (max spec)" in the panel is one click for a maxed
 * character.
 *
 * Levels are stored PER TABLE ("scope", e.g. "crafting-table"), so the Crafting
 * table can model a maxed crafter while Refining / Transports models a
 * half-levelled refiner. Renderers set the scope ambiently with withSpecScope()
 * rather than threading it through the ~40 getFocusCost call sites.
 *
 * Sanity anchors (all nodes at 100), verified in-game / on the wiki:
 *   refining        40,000 FCE → 6.25 %      cooking / potions 55,000 → 2.21 %
 *   gear           ~44,500 FCE → ~4.6 %      gathering tools   40,000 → 6.25 %
 *   mounts, furniture, journals: no node at all → base focus cost
 */

const SPEC_LEVEL_MAX = 100;
const SPEC_STORAGE_PREFIX = "specLevels:";

// scope -> { nodeId: level }, sparse (only levels ≠ the node's default are
// kept). Mirrors localStorage so a re-render doesn't re-parse JSON per row.
const _specLevelCache = {};
// scope -> { itemId: fce } memo, dropped whenever a level changes.
const _specFceCache = {};
// Ambient scope for the renderer currently running (see withSpecScope).
let _currentSpecScope = null;

// Node ≥22 exposes a `localStorage` global that has no Storage methods unless
// the runtime was started with a store file, so feature-detect rather than
// trusting `typeof` — the migration below runs at load, outside any browser.
function _specStorage() {
  if (typeof localStorage === "undefined" || !localStorage) return null;
  return typeof localStorage.getItem === "function" ? localStorage : null;
}

/**
 * The level a node reads when the user has never typed one.
 *
 * 0 for a specialization, 100 for the mastery heading its own group (Chef,
 * Alchemist, Animals, Swords…). A mastery is the one node anybody who crafts
 * the category at all has maxed, and there are ten of them against 367
 * specializations — assuming the specializations instead is what priced a
 * partially-specced cook four times too cheap.
 *
 * Refining tier chains (CRAFT_REFINE_ORE_T4…T8) have no mastery node in their
 * group, so every tier defaults to 0.
 */
function defaultSpecLevel(nodeId) {
  const node = typeof FOCUS_SPEC_NODES !== "undefined" ? FOCUS_SPEC_NODES[nodeId] : null;
  return node && node.group === nodeId ? SPEC_LEVEL_MAX : 0;
}

// Anything that isn't a real number (null, "", undefined, NaN — e.g. a cleared
// input box) means "leave it at this node's default".
function _clampSpecLevel(value, nodeId) {
  if (value === null || value === undefined || value === "") return defaultSpecLevel(nodeId);
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultSpecLevel(nodeId);
  return Math.max(0, Math.min(SPEC_LEVEL_MAX, Math.round(n)));
}

/** Sparse { nodeId: level } map for a scope (only non-default levels). */
function getSpecLevels(scope) {
  const key = scope || "";
  if (_specLevelCache[key]) return _specLevelCache[key];
  let levels = {};
  const storage = _specStorage();
  if (storage) {
    try {
      const raw = storage.getItem(SPEC_STORAGE_PREFIX + key);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        Object.keys(parsed).forEach((nodeId) => {
          const level = _clampSpecLevel(parsed[nodeId], nodeId);
          if (level !== defaultSpecLevel(nodeId)) levels[nodeId] = level;
        });
      }
    } catch (e) {
      levels = {}; // corrupt entry — fall back to the defaults rather than throw
    }
  }
  _specLevelCache[key] = levels;
  return levels;
}

function _writeSpecLevels(scope, levels) {
  const key = scope || "";
  _specLevelCache[key] = levels;
  delete _specFceCache[key];
  const storage = _specStorage();
  if (!storage) return;
  if (Object.keys(levels).length === 0) storage.removeItem(SPEC_STORAGE_PREFIX + key);
  else storage.setItem(SPEC_STORAGE_PREFIX + key, JSON.stringify(levels));
}

/** Level of one node in a scope; its default unless the user typed one. */
function getSpecLevel(scope, nodeId) {
  const levels = getSpecLevels(scope);
  return Object.prototype.hasOwnProperty.call(levels, nodeId)
    ? levels[nodeId]
    : defaultSpecLevel(nodeId);
}

function setSpecLevel(scope, nodeId, level) {
  const levels = Object.assign({}, getSpecLevels(scope));
  const value = _clampSpecLevel(level, nodeId);
  if (value === defaultSpecLevel(nodeId)) delete levels[nodeId];
  else levels[nodeId] = value;
  _writeSpecLevels(scope, levels);
  _recordMySpecLevels(scope, levels, [nodeId]);
}

/** Replace a scope's levels wholesale (panel "apply", import, etc.). */
function setSpecLevels(scope, levels) {
  const next = {};
  Object.keys(levels || {}).forEach((nodeId) => {
    const value = _clampSpecLevel(levels[nodeId], nodeId);
    if (value !== defaultSpecLevel(nodeId)) next[nodeId] = value;
  });
  _writeSpecLevels(scope, next);
  _recordMySpecLevels(scope, next, null);
}

/** Set a specific list of nodes to one level — the panel's per-group "set all". */
function setSpecLevelsFor(scope, nodeIds, level) {
  const levels = Object.assign({}, getSpecLevels(scope));
  (nodeIds || []).forEach((nodeId) => {
    const value = _clampSpecLevel(level, nodeId);
    if (value === defaultSpecLevel(nodeId)) delete levels[nodeId];
    else levels[nodeId] = value;
  });
  _writeSpecLevels(scope, levels);
  _recordMySpecLevels(scope, levels, nodeIds || []);
}

/**
 * Set every node (optionally only those in `branches`) to one level — the
 * panel's top "set all" control.
 */
function setAllSpecLevels(scope, level, branches) {
  const nodeIds = Object.keys(FOCUS_SPEC_NODES).filter(
    (nodeId) => !branches || branches.indexOf(FOCUS_SPEC_NODES[nodeId].branch) !== -1
  );
  setSpecLevelsFor(scope, nodeIds, level);
}

/** Back to the defaults: masteries at 100, every specialization at 0. */
function resetSpecLevels(scope) {
  _writeSpecLevels(scope, {});
  _recordMySpecLevels(scope, {}, null);
}

/** True when the scope has any node off its default — drives the table heading. */
function hasCustomSpec(scope) {
  return Object.keys(getSpecLevels(scope)).length > 0;
}

/**
 * Run `fn` with `scope` as the ambient specialization scope. Renderers wrap
 * their whole pass in this; nested calls and throws restore the previous scope.
 */
function withSpecScope(scope, fn) {
  const previous = _currentSpecScope;
  _currentSpecScope = scope;
  try {
    return fn();
  } finally {
    _currentSpecScope = previous;
  }
}

function currentSpecScope() {
  return _currentSpecScope;
}

/**
 * Pin `fn` to the scope that is ambient right now, so a later call re-enters it.
 *
 * For callbacks that are STORED and run again after the render pass has ended —
 * a table's row formatter (renderTableData in js/app.js), replayed on every
 * sort, search, price override and collapsed-table expand. withSpecScope only
 * covers the synchronous pass, so an unbound callback re-prices whatever its
 * HTML recomputes at the DEFAULT levels (a mastery 100, every specialization 0)
 * instead of the table's own.
 *
 * Binding null (nothing was ambient) is a real binding, not a no-op: it keeps a
 * scope-less table scope-less even when the repaint is triggered from inside
 * another table's pass.
 */
function bindSpecScope(fn) {
  if (typeof fn !== "function") return fn;
  const scope = _currentSpecScope;
  const bound = function (...args) {
    return withSpecScope(scope, () => fn.apply(this, args));
  };
  bound.__specBoundScope = scope;
  return bound;
}

/** Every scope that has non-default levels, as { scope: { nodeId: level } }. */
function exportSpecLevels() {
  const out = {};
  const storage = _specStorage();
  if (!storage) return out;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || key.indexOf(SPEC_STORAGE_PREFIX) !== 0) continue;
    const scope = key.slice(SPEC_STORAGE_PREFIX.length);
    const levels = getSpecLevels(scope);
    if (Object.keys(levels).length > 0) out[scope] = Object.assign({}, levels);
  }
  return out;
}

/**
 * Replace stored spec levels with `map` ({ scope: { nodeId: level } }).
 * Scopes absent from `map` are reset to their defaults (a mastery back to 100,
 * every specialization to 0 — see defaultSpecLevel), so an import lands the
 * exporting machine's setup exactly — no leftovers from the old profile.
 *
 * The imported profile becomes "my levels" wholesale rather than node by node:
 * it is the user's setup, and Reset must not roll back to what this machine held
 * before the import.
 */
function importSpecLevels(map) {
  const next = map && typeof map === "object" ? map : {};
  withoutSpecRecording(() => {
    Object.keys(exportSpecLevels()).forEach((scope) => {
      if (!Object.prototype.hasOwnProperty.call(next, scope)) resetSpecLevels(scope);
    });
    Object.keys(next).forEach((scope) => {
      const levels = next[scope];
      if (levels && typeof levels === "object") setSpecLevels(scope, levels);
    });
  });
  _writeMySpecLevels(exportSpecLevels());
}

/**
 * "My levels": every level the user authored in a ⚙ Specs panel, kept per node
 * as { scope: { nodeId: level } }, so the header "All Specs" Reset can replay
 * them.
 *
 * It is a running record, not a snapshot taken at the first global apply — that
 * older design lost data two ways: a profile that only ever used the ⚙ panels
 * had nothing to restore and Reset wiped it to the defaults, and a level typed
 * after a global apply was thrown away by the next Reset.
 *
 * Recording is per node, so an edit made on top of an active global 100 replaces
 * only that node's entry while every untouched node still restores its earlier
 * value. The record is never consumed, so Reset is repeatable and idempotent.
 * The header apply and the restore itself write through withoutSpecRecording —
 * they are what Reset undoes, so they must not become "mine".
 */
const MY_SPEC_LEVELS_KEY = "specLevelsMine";
// Pre-2026-08 one-shot snapshot, migrated into the record below and then dropped.
const LEGACY_SPEC_SNAPSHOT_KEY = "specLevelsBackup";

let _specRecording = true;

function _plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function _readMySpecLevels() {
  const storage = _specStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(MY_SPEC_LEVELS_KEY));
    const record = _plainObject(parsed);
    if (record) return record;
  } catch (e) {
    /* corrupt entry — behave as if nothing had been recorded */
  }
  return {};
}

function _writeMySpecLevels(record) {
  const storage = _specStorage();
  if (storage) storage.setItem(MY_SPEC_LEVELS_KEY, JSON.stringify(record || {}));
}

/**
 * Fold a write into the record. `levels` is the scope's sparse map as it was
 * just stored; `nodeIds` are the nodes this write touched, or null when the
 * whole scope was replaced.
 */
function _recordMySpecLevels(scope, levels, nodeIds) {
  if (!_specRecording) return;
  const key = scope || "";
  const record = _readMySpecLevels();
  let entry;
  if (nodeIds) {
    entry = Object.assign({}, _plainObject(record[key]) || {});
    nodeIds.forEach((nodeId) => {
      // Absent from the sparse map means "back at its default" — drop it, or a
      // cleared input box would keep restoring the old level.
      if (Object.prototype.hasOwnProperty.call(levels, nodeId)) entry[nodeId] = levels[nodeId];
      else delete entry[nodeId];
    });
  } else {
    entry = Object.assign({}, levels);
  }
  if (Object.keys(entry).length === 0) delete record[key];
  else record[key] = entry;
  _writeMySpecLevels(record);
}

/** Run `fn` with recording off — the header apply, the restore, an import. */
function withoutSpecRecording(fn) {
  const previous = _specRecording;
  _specRecording = false;
  try {
    return fn();
  } finally {
    _specRecording = previous;
  }
}

function hasMySpecLevels() {
  return Object.keys(_readMySpecLevels()).length > 0;
}

function exportMySpecLevels() {
  const record = _readMySpecLevels();
  const out = {};
  Object.keys(record).forEach((scope) => {
    const levels = _plainObject(record[scope]);
    if (levels) out[scope] = Object.assign({}, levels);
  });
  return out;
}

/**
 * Put my levels back. A scope the record does not know was only ever written by
 * the global apply, so it returns to its defaults. Keeps the record, so calling
 * this twice lands in the same place.
 */
function restoreMySpecLevels() {
  const record = exportMySpecLevels();
  withoutSpecRecording(() => {
    Object.keys(exportSpecLevels()).forEach((scope) => {
      if (!Object.prototype.hasOwnProperty.call(record, scope)) resetSpecLevels(scope);
    });
    Object.keys(record).forEach((scope) => setSpecLevels(scope, record[scope]));
  });
}

/**
 * One-time move off the old snapshot key. A pending snapshot is the truer "my
 * levels" (the live entries may be a global 0/100 the user has not reset yet);
 * with none, the live entries are the best evidence of what was typed.
 */
function _migrateSpecSnapshot() {
  const storage = _specStorage();
  if (!storage) return;
  if (storage.getItem(MY_SPEC_LEVELS_KEY) === null) {
    let seed;
    try {
      seed = _plainObject(JSON.parse(storage.getItem(LEGACY_SPEC_SNAPSHOT_KEY)));
    } catch (e) {
      seed = null;
    }
    _writeMySpecLevels(seed || exportSpecLevels());
  }
  storage.removeItem(LEGACY_SPEC_SNAPSHOT_KEY);
}

_migrateSpecSnapshot();

/**
 * [nodeId, bonusPerLevel] pairs that affect this item, or [] when the item has
 * no focus specialization at all (mounts, furniture, journals, combines).
 * Enchant suffixes reuse the base item's nodes.
 */
function specNodesForItem(itemId) {
  if (!itemId || typeof FOCUS_SPEC_ITEM_FAMILY === "undefined") return [];
  let index = FOCUS_SPEC_ITEM_FAMILY[itemId];
  if (index === undefined) {
    const baseId = String(itemId).replace(/@\d+$/, "");
    if (baseId !== itemId) index = FOCUS_SPEC_ITEM_FAMILY[baseId];
  }
  if (index === undefined) return [];
  return FOCUS_SPEC_FAMILIES[index] || [];
}

/** Total Focus Cost Efficiency for this item under a scope's node levels. */
function getItemFCE(itemId, scope) {
  const key = scope !== undefined && scope !== null ? scope : _currentSpecScope || "";
  const memo = _specFceCache[key] || (_specFceCache[key] = {});
  if (itemId && Object.prototype.hasOwnProperty.call(memo, itemId)) return memo[itemId];

  const nodes = specNodesForItem(itemId);
  let fce = 0;
  for (let i = 0; i < nodes.length; i++) {
    fce += nodes[i][1] * 100 * getSpecLevel(key, nodes[i][0]);
  }
  fce = Math.round(fce);
  if (itemId) memo[itemId] = fce;
  return fce;
}

/**
 * Focus cost multiplier for this item — 1 when it has no specialization (base
 * cost), 0.0625 for a maxed refine, ~0.0221 for maxed cooking, and so on.
 */
function focusSpecMultiplier(itemId, scope) {
  const fce = getItemFCE(itemId, scope);
  return fce > 0 ? Math.pow(0.5, fce / 10000) : 1;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SPEC_LEVEL_MAX,
    defaultSpecLevel,
    getSpecLevels,
    getSpecLevel,
    setSpecLevel,
    setSpecLevels,
    setSpecLevelsFor,
    setAllSpecLevels,
    resetSpecLevels,
    hasCustomSpec,
    withSpecScope,
    currentSpecScope,
    bindSpecScope,
    exportSpecLevels,
    importSpecLevels,
    hasMySpecLevels,
    exportMySpecLevels,
    restoreMySpecLevels,
    withoutSpecRecording,
    specNodesForItem,
    getItemFCE,
    focusSpecMultiplier,
  };
}
