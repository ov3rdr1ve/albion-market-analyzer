// Why a focus figure is the number it is — the tooltip behind every focus cost.
//
// js/focus-spec.js turns Destiny Board node levels into a multiplier, and a node
// the user has never typed reads its default — 0, or 100 for the mastery heading
// its group. Whatever the default is, it is INVISIBLE: set two nodes in a
// table's ⚙ panel and the other forty are counted at a level nobody entered.
// (Real case: a T6 Avalonian Stew showed 19 focus against 80.3 in-game, the whole
// gap being eight untouched cooking specialization nodes counted as maxed.)
//
// This module says it out loud on the row:
//
//   80 focus = base 176 × 0.5^(11,330 FCE ÷ 10,000). Stew Chef 17, Chef 100,
//   Butcher 100, Omelette Chef 5, +6 more. 2 nodes at their default — set
//   yours in ⚙ Specs.
//
// It computes nothing of its own — the base, the node list and the multiplier
// all come from getBaseFocusCost / specNodesForItem / focusSpecMultiplier — so
// the tooltip can never disagree with the figure it explains.

// Nodes are listed heaviest-first: the specialization that actually drives the
// cost (bonus 2.8 for a cook spec) before the mastery and sibling nodes (0.3).
// Beyond this many named nodes the list is summarised, or a gear item's tooltip
// would run to forty entries.
const FOCUS_SPEC_TOOLTIP_NODES = 4;

function _fseNodeName(nodeId) {
  const node = (typeof FOCUS_SPEC_NODES !== "undefined") ? FOCUS_SPEC_NODES[nodeId] : null;
  if (!node) return nodeId;
  const spanish = typeof getLang === "function" && getLang() === "es";
  return (spanish && node.nameEs) || node.name || nodeId;
}

// Node names come from the game's localization dump and land in a `title="…"`
// attribute, so the finished line is escaped here — every caller then just
// interpolates it, and none of them can forget.
function _fseEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _fseNumber(n) {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString();
}

/**
 * Everything the tooltip needs about one item's focus cost.
 *
 * `base` is the caller's own base when supplied — butchering charges
 * craftingfocus × amountcrafted per animal rather than the per-unit figure
 * getBaseFocusCost returns, and the tooltip has to explain the number actually
 * on the row. Omit it and the per-unit items.xml cost is used.
 *
 * Returns { base, fce, multiplier, cost, nodes, atDefault, hasSpec }, where
 * `nodes` is [{ nodeId, name, level, bonus }] sorted by bonus (heaviest first)
 * and `atDefault` counts the nodes still sitting at the untouched default.
 */
function focusSpecExplain(itemId, { scope, base } = {}) {
  // getItemFCE / focusSpecMultiplier fall back to the ambient scope on their
  // own, but getSpecLevel takes its argument literally — an omitted scope would
  // read the empty scope and report every node at 100 while the FCE beside it
  // came from the table's real levels. Renderers call this from inside
  // withSpecScope without passing one, so resolve it here, once.
  const resolvedScope = scope !== undefined && scope !== null
    ? scope
    : ((typeof currentSpecScope === "function") ? currentSpecScope() : null);
  const resolvedBase = base != null
    ? base
    : ((typeof getBaseFocusCost === "function") ? getBaseFocusCost(itemId) : 0);
  const out = {
    base: resolvedBase, fce: 0, multiplier: 1, cost: resolvedBase,
    nodes: [], atDefault: 0, hasSpec: false,
  };
  if (!itemId || !(resolvedBase > 0)) return out;

  const pairs = (typeof specNodesForItem === "function") ? specNodesForItem(itemId) : [];
  const max = (typeof SPEC_LEVEL_MAX !== "undefined") ? SPEC_LEVEL_MAX : 100;
  out.nodes = pairs.map(([nodeId, bonus]) => {
    const level = (typeof getSpecLevel === "function") ? getSpecLevel(resolvedScope, nodeId) : max;
    const fallback = (typeof defaultSpecLevel === "function") ? defaultSpecLevel(nodeId) : max;
    if (level === fallback) out.atDefault++;
    return { nodeId, name: _fseNodeName(nodeId), level, bonus };
  }).sort((a, b) => b.bonus - a.bonus || a.name.localeCompare(b.name));

  out.hasSpec = out.nodes.length > 0;
  out.fce = (typeof getItemFCE === "function") ? getItemFCE(itemId, resolvedScope) : 0;
  out.multiplier = (typeof focusSpecMultiplier === "function")
    ? focusSpecMultiplier(itemId, resolvedScope) : 1;
  // Mirrors getFocusCost exactly, fraction and all: the tooltip sits on the very
  // cell that prints the cost, so a rounded figure here read as a contradiction
  // ("0.84 focus ea" under a tooltip claiming "1 focus"). _fseNumber trims it to
  // two decimals for display.
  out.cost = out.multiplier === 1
    ? resolvedBase
    : Math.max(0.01, resolvedBase * out.multiplier);
  return out;
}

/**
 * The tooltip line, escaped and ready to drop into a `title` attribute.
 * Returns "" when the item has no focus cost at all, so a caller can fall back
 * to whatever it said before.
 */
function focusSpecTitle(itemId, options) {
  const info = focusSpecExplain(itemId, options);
  if (!(info.base > 0)) return "";
  if (!info.hasSpec) {
    return _fseEscape(`${_fseNumber(info.cost)} focus — base cost, this item has no focus specialization on the Destiny Board.`);
  }

  const head = `${_fseNumber(info.cost)} focus = base ${_fseNumber(info.base)}`
    + ` × 0.5^(${_fseNumber(info.fce)} FCE ÷ 10,000).`;

  const named = info.nodes.slice(0, FOCUS_SPEC_TOOLTIP_NODES)
    .map((n) => `${n.name} ${n.level}`).join(", ");
  const rest = info.nodes.length - Math.min(info.nodes.length, FOCUS_SPEC_TOOLTIP_NODES);
  const tail = rest > 0 ? `, +${rest} more` : "";

  // The whole point of the tooltip: name the silent assumption. The level store
  // is sparse (a node at its default and a node never touched are the same
  // stored state), hence the neutral wording — it is true either way, and it
  // still tells a partially-specced player exactly what to go and fix.
  const assumed = info.atDefault > 0
    ? ` ${info.atDefault} node${info.atDefault === 1 ? "" : "s"} at their default`
      + ` — set yours in ⚙ Specs.`
    : "";

  return _fseEscape(`${head} ${named}${tail}.${assumed}`);
}

/**
 * A one-character mark for a figure that still rests on untouched nodes, to sit
 * beside the number the tooltip explains. "" once every node has a typed level.
 */
function focusSpecMark(itemId, options) {
  const info = focusSpecExplain(itemId, options);
  return info.base > 0 && info.hasSpec && info.atDefault > 0 ? "*" : "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FOCUS_SPEC_TOOLTIP_NODES, focusSpecExplain, focusSpecTitle, focusSpecMark };
}
