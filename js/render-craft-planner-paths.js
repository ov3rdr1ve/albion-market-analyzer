// Crafting Planner — the "best path" line: one inline line printed directly
// under each material in the Materials cell, naming in words the route the row
// ACTUALLY took to obtain that material. The Artifact Rolling table reuses the
// fragment variant at the bottom of this file.
//
// This used to be an expandable panel row (a craft root, a nested chain tree and
// an "other craft cities" block, opened from a "▸ best path" toggle). The
// expander is gone: a row has exactly one path, so the path is printed rather
// than hidden behind a click. Losing options are still never printed, and the
// nested tree is not either — the Materials column is width-capped, and a
// recursive breakdown does not fit in it.
//
// Everything here is read off the row's OWN `sourcing` entry — the winner
// js/craft-planner-pricing.js already booked. Nothing is re-priced: the line
// costs nothing to render on every repaint, and it cannot contradict the Cost
// cell it explains.

function _cpPathTx(en, slug) {
  return (typeof tx === "function") ? tx(en, slug) : en;
}

// "buy it" label. It quotes no price: the material line directly above already
// prints that price, as the editable span that fixes it, and repeating it here
// put two identical spans in one cell. The line names the ROUTE, not the number.
// `matId` is passed only when the thing bought is not the material the recipe
// asks for (a transmute buys a cheaper node instead).
function _cpPathBuy(city, matId) {
  const head = matId
    ? _cpPathTx("buy {item}", "r_paths_buy_item").replace("{item}", getItemDisplayName(matId))
    : _cpPathTx("buy it", "r_paths_buy");
  const from = city ? ` <small style="color:#9ca3af">(${_cpPathTx("from", "r_from_lower")} ${city})</small>` : "";
  return `${head}${from}`;
}

// Which raw-side substitution the refine took, so the line can name it. Only the
// root's inputs are inspected: that is the only depth buildRefiningChain will
// spend a heart at. A heart and a transmute can both fire on the same node — the
// heart is reported, since it is the rarer play and the one that changes what
// you have to carry. An ordinary refine gets no tag; it needs no explaining.
function _cpPathMechanismTag(chain) {
  const inputs = (chain && chain.inputs) || [];
  const heart = inputs.find((i) => i.sourcing && i.sourcing.source === "heart");
  if (heart) {
    const heartName = getItemDisplayName(heart.matId);
    return ` <small style="color:#fbbf24" title="${_cpPathTx("One raw unit is replaced by a faction heart — cheaper than the raw it stands in for. The heart is fully consumed (no resource return).", "r_tip_paths_heart")}">${_cpPathTx("(with {heart})", "r_paths_with_heart").replace("{heart}", heartName)}</small>`;
  }
  if (inputs.some((i) => i.sourcing && i.sourcing.source === "transmute")) {
    return ` <small style="color:#c084fc" title="${_cpPathTx("Its raw is not bought at its own price: a cheaper lower node is bought and transmuted up.", "r_tip_paths_transmute")}">${_cpPathTx("(via transmute)", "r_via_transmute")}</small>`;
  }
  return "";
}

// "refine it yourself" label. Head only, and priceless for the same reason as
// _cpPathBuy — the material line above already quotes the refine's per-unit cost.
// The recursive chain tree the panel used to nest here went with the panel.
function _cpPathRefine(src) {
  const rt = src.chain.resourceType || "";
  return `${_cpPathTx("refine it yourself", "r_paths_refine")} <small style="color:#7ab8c4">${rt} ▲</small>`
    + _cpPathMechanismTag(src.chain);
}

/** The one "best path: …" line for a single sourced material. */
function cpBestPathLine(s, craftCity) {
  const src = (s && s.sourcing) || {};
  let how;
  if (src.source === "transmute" && src.transmute) {
    // The material itself is never bought here: a cheaper node is, and is then
    // transmuted up. Name the node that is actually bought.
    how = _cpPathBuy(src.transmute.startCity, src.transmute.startId)
      + ` <small style="color:#c084fc">${_cpPathTx("(via transmute)", "r_via_transmute")}</small>`;
  } else if (src.source === "chain" && src.chain) {
    how = _cpPathRefine(src);
  } else {
    how = _cpPathBuy(src.city || craftCity, null);
  }
  return `<div class="cp-best-path">${_cpPathTx("best path", "r_paths_best")}: ${how}</div>`;
}

// The "best path: …" line for a row the planner booked as bought-then-enchanted
// (row.enchantedVia, js/craft-planner-enchant-route.js): buy the @(n-1) item,
// enchant it up at a station with slotCount runes/souls/relics. Sits under the
// two material lines (base + mat) in the Materials cell. Priceless, like every
// line here — the editable price spans directly above quote the numbers.
// The tint is the Enchanting table's transition color for the mat type
// (js/render-enchanting.js: RUNE blue, SOUL purple, RELIC amber).
function cpEnchantPathLine(via) {
  if (!via || !via.baseId || !via.matId) return "";
  const color = via.matId.includes("_SOUL") ? "#b07ac4"
    : via.matId.includes("_RELIC") ? "#c4a07a" : "#7ab8c4";
  const detail = ` <small style="color:#9ca3af">(${
    _cpPathTx("buy {item}", "r_paths_buy_item").replace("{item}", getItemDisplayName(via.baseId))
  } + ${via.matCount}× ${getItemDisplayName(via.matId)})</small>`;
  const tip = _cpPathTx(
    "Cheaper than crafting it: buy the lower-enchant item here and enchant it up at a crafting station — the runes are fully consumed and no crafting journal is filled.",
    "r_tip_paths_enchant",
  );
  return `<div class="cp-best-path">${_cpPathTx("best path", "r_paths_best")}: `
    + `<span style="color:${color}" title="${tip}">${_cpPathTx("enchant it yourself", "r_paths_enchant")}</span>`
    + `${detail}${fragmentTransmuteTag(via.matSourcing, via.matId, via.matCount)}</div>`;
}

// ── Artifact fragments (Rune / Soul / Relic / Avalonian Shard) ───────────────
// The same "best path" line for a fragment sourced by
// js/fragment-transmute-sourcing.js: bought as itself, or a cheaper node bought
// and transmuted up. Used by the Artifact Rolling table's fragment cell and the
// planner's buy-and-enchant route. Priceless like every line here; the route's
// steps and all-in cost live in the tooltip.

// "5× Adept's Soul → Expert's Soul; Expert's Soul → Expert's Relic"
function _fragPathSteps(steps) {
  return (steps || []).map((s) =>
    `${s.ratio > 1 ? `${s.ratio}× ` : ""}${getItemDisplayName(s.fromId)} → ${getItemDisplayName(s.toId)}`,
  ).join("; ");
}

// "(via transmute)" tag with the route in its tooltip. `count` is how many
// fragments the caller consumes (36 per meld, 384 per enchant) — "" when the
// route is a straight buy.
function fragmentTransmuteTag(src, fragmentId, count) {
  if (!src || src.source !== "transmute") return "";
  const tip = _cpPathTx(
    "{count}× {frag} = {total}× {start} bought, then transmuted: {steps}. {cost} per {frag} all-in (setup fee on the bought part only).",
    "r_tip_frag_transmute",
  )
    .split("{frag}").join(getItemDisplayName(fragmentId))
    .replace("{count}", count)
    .replace("{total}", count * (src.buyCount || 1))
    .replace("{start}", getItemDisplayName(src.buyId))
    .replace("{steps}", _fragPathSteps(src.steps))
    .replace("{cost}", formatSilver(Math.round(src.perUnit)));
  return ` <small style="color:#c084fc" title="${tip}">${_cpPathTx("(via transmute)", "r_via_transmute")}</small>`;
}

/** The "best path: …" line for one fragment route (null route → ""). */
function rollingFragmentPathLine(src, fragmentId, count) {
  if (!src) return "";
  const how = src.source === "transmute"
    ? _cpPathBuy(src.buyCity, src.buyId) + fragmentTransmuteTag(src, fragmentId, count)
    : _cpPathBuy(src.buyCity, null);
  return `<div class="cp-best-path">${_cpPathTx("best path", "r_paths_best")}: ${how}</div>`;
}

/**
 * The "best path" line on an Artifact Rolling artifact row whose slot in a gear
 * craft is cheaper to fill with a Crystallized token (row.tokenSub from
 * render-rolling.js). Unlike the lines above it quotes the token's price, as a
 * click-to-edit span: nothing else on the row prices the token.
 */
function artifactTokenPathLine(sub, artName) {
  if (!sub) return "";
  const tokenName = getItemDisplayName(sub.tokenId);
  const price = (typeof matPriceSpan === "function")
    ? ` ${matPriceSpan(sub.tokenId, sub.city, sub.price)}`
    : ` @ ${formatSilver(sub.price)}`;
  const from = sub.city ? ` <small style="color:#9ca3af">(${_cpPathTx("from", "r_from_lower")} ${sub.city})</small>` : "";
  const tip = _cpPathTx(
    "Crafters can fill the {art} slot with {token} instead: same craft, same focus, cheaper to buy. It caps what this artifact sells for.",
    "r_tip_artifact_token_substitute",
  ).replace("{art}", artName).replace("{token}", tokenName);
  const tag = _cpPathTx("(substitute — cheaper than {raw})", "r_substitute_cheaper")
    .replace("{raw}", `${artName} @ ${formatSilver(sub.artPrice)}`);
  return `<div class="cp-best-path">${_cpPathTx("best path", "r_paths_best")}: `
    + `${_cpPathTx("buy {item}", "r_paths_buy_item").replace("{item}", tokenName)}${price}${from}`
    + ` <small style="color:#fbbf24" title="${tip}">${tag}</small></div>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    cpBestPathLine, cpEnchantPathLine, fragmentTransmuteTag, rollingFragmentPathLine, artifactTokenPathLine,
  };
}
