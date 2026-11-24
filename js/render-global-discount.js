/**
 * Global Discount readout — the one place the live gold price is visible as
 * what it actually does to the tables.
 *
 * Sits under the Gold Chart controls. Gold above the 5,000 pivot means no
 * discount, which is the normal state, so the strip stays grey and states the
 * multiplier is 1. Below the pivot it turns green and names the silver sinks
 * that just got cheaper (see js/global-discount.js).
 */

const GLOBAL_DISCOUNT_READOUT_ID = "global-discount-readout";

function _gdText(en, key) {
  return typeof tx === "function" ? tx(en, key) : en;
}

/**
 * Pure view model for the strip: what to say and how to colour it.
 * Split out from the DOM write so it can be tested without a document.
 */
function buildGlobalDiscountReadout(goldPrice, factor, percent) {
  if (goldPrice === null || goldPrice === undefined) {
    return {
      tone: "unknown",
      headline: _gdText("Gold price unavailable", "gd_unknown"),
      detail: _gdText(
        "Silver costs are billed at full price until the gold quote loads.",
        "gd_unknown_detail",
      ),
    };
  }
  const gold = Number(goldPrice).toLocaleString();
  if (factor >= 1) {
    return {
      tone: "none",
      headline: `${_gdText("Global Discount", "gd_label")} 0%`,
      detail: `${_gdText("Gold", "gd_gold")} ${gold} — ${_gdText(
        "at or above the 5,000 pivot, so silver costs are unchanged (×1.000).",
        "gd_none_detail",
      )}`,
    };
  }
  return {
    tone: "active",
    headline: `${_gdText("Global Discount", "gd_label")} ${percent.toFixed(1)}%`,
    detail: `${_gdText("Gold", "gd_gold")} ${gold} — ${_gdText(
      "silver costs ×",
      "gd_active_detail",
    )}${factor.toFixed(3)} ${_gdText(
      "on station fees, quality rerolls, transmutes, recipe silver and travel.",
      "gd_active_sinks",
    )}`,
  };
}

const _GD_TONE_COLOR = { active: "#5e9e78", none: "#9ca3af", unknown: "#b08a5e" };

/** Repaints the strip from the current gold price. Safe to call any time. */
function renderGlobalDiscountReadout() {
  if (typeof document === "undefined") return;
  const el = document.getElementById(GLOBAL_DISCOUNT_READOUT_ID);
  if (!el) return;
  if (typeof getGlobalDiscountFactor !== "function") return;
  const view = buildGlobalDiscountReadout(
    getGoldPrice(),
    getGlobalDiscountFactor(),
    getGlobalDiscountPercent(),
  );
  // Built as text nodes rather than innerHTML: the gold price is interpolated
  // into these strings, so nothing here can become markup.
  el.textContent = "";
  const headline = document.createElement("strong");
  headline.style.color = _GD_TONE_COLOR[view.tone];
  headline.textContent = view.headline;
  const detail = document.createElement("span");
  detail.style.color = "#9ca3af";
  detail.textContent = view.detail;
  el.appendChild(headline);
  el.appendChild(detail);
}
