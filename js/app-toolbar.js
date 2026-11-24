/**
 * Boot step: wire the header toolbar — focus / premium, spec levels, server,
 * language, station fee, Daily Production Bonus, laborer happiness, house tier
 * and the pricing-model radios — restoring each saved preference.
 *
 * Split out of js/app.js (800-line limit). Called from its DOMContentLoaded
 * handler.
 */
function setupToolbarControls() {
  const orderTypeGroups = [
    { name: "buyOrderType", key: "buyOrderType" },
    { name: "sellOrderType", key: "sellOrderType" },
  ];

  const salvageInput = document.getElementById("salvage-return");

  if (salvageInput) {
    salvageInput.addEventListener("input", () => {
      if (lastMarketData) renderRollingTable(lastMarketData);
    });
  }

  // Tabs replaced with static labels — all categories shown at once

  // Show All Items checkbox — restore saved preference
  const showAllCb = document.getElementById("show-all-items");
  if (showAllCb) {
    showAllCb.checked = localStorage.getItem("showAllItems") === "1";
    showAllCb.addEventListener("change", () => {
      localStorage.setItem("showAllItems", showAllCb.checked ? "1" : "0");
      scheduleRerender("show-all");
    });
  }

  // Black/Red Zone Routes checkbox — restore saved preference
  const caerleonCb = document.getElementById("include-caerleon");
  if (caerleonCb) {
    caerleonCb.checked = localStorage.getItem("caerleonRoutes") === "true";
    caerleonCb.addEventListener("change", () => {
      localStorage.setItem("caerleonRoutes", caerleonCb.checked);
      scheduleRerender("black-zone-routes");
    });
  }

  const useFocusCb = document.getElementById("use-focus");
  const premiumCb = document.getElementById("premium-account");

  // Keep the "Crafting" heading in sync with whether focus is effectively on.
  // Uses isFocusEnabled() (which itself gates on Premium) so the label reads
  // "No Focus" when Premium is off, even though the box shows unchecked.
  // The heading title lives in the [data-i18n] <span> and reflects two things:
  // whether focus is on, and whether the Crafting table's ⚙ Specs are still
  // maxed. Both are handled by the top-level updateSpecHeadings().
  function updateFocusHeading() {
    updateSpecHeadings();
  }

  // Reflect Premium status on the "Use Focus" checkbox: non-Premium accounts
  // can't regenerate focus, so it's forced off and disabled. Restoring Premium
  // re-enables it at the user's saved preference (localStorage untouched while
  // disabled, so the choice survives the round-trip).
  function syncFocusToPremium() {
    if (!useFocusCb) return;
    const premium = !premiumCb || premiumCb.checked;
    if (premium) {
      useFocusCb.disabled = false;
      useFocusCb.checked = localStorage.getItem("useFocus") !== "0";
      useFocusCb.title = "";
    } else {
      useFocusCb.disabled = true;
      useFocusCb.checked = false;
      useFocusCb.title = "Non-Premium accounts don't regenerate focus — enable Premium to use focus.";
    }
  }

  // Use Focus checkbox — restore saved preference (default: checked)
  if (useFocusCb) {
    useFocusCb.checked = localStorage.getItem("useFocus") !== "0";
    useFocusCb.addEventListener("change", () => {
      localStorage.setItem("useFocus", useFocusCb.checked ? "1" : "0");
      updateFocusHeading();
      scheduleRerender("use-focus");
    });
  }

  // Premium Account checkbox — restore saved preference (default: checked).
  // Drives the live PREMIUM_TAX getter (4% tax w/ Premium, 8% without) so every
  // profit table re-prices on toggle; also gates focus availability.
  if (premiumCb) {
    premiumCb.checked = localStorage.getItem("premiumAccount") !== "0";
    premiumCb.addEventListener("change", () => {
      localStorage.setItem("premiumAccount", premiumCb.checked ? "1" : "0");
      syncFocusToPremium();
      updateFocusHeading();
      scheduleRerender("premium");
    });
  }

  // Header "All Specs" — a one-shot action, not a stored preference: it writes
  // into the same per-table specLevels the ⚙ panels edit, then snaps back to "—"
  // so the box never claims to describe the current (possibly hand-edited)
  // levels. setAllTablesSpecLevels re-renders through applySpecChange.
  const globalSpecSelect = document.getElementById("global-spec-level");
  if (globalSpecSelect) {
    globalSpecSelect.addEventListener("change", () => {
      const choice = globalSpecSelect.value;
      globalSpecSelect.value = "";
      if (choice === "" || typeof setAllTablesSpecLevels !== "function") return;
      setAllTablesSpecLevels(choice);
    });
  }

  // Initial reconciliation — handles a saved Premium=off preference on load.
  syncFocusToPremium();
  updateFocusHeading();

  // Server / region switcher — restore saved preference (default: Americas/West).
  // Switching only persists the choice; the newly selected region's prices load
  // on the next manual "Scan Market Now" — no auto-fetch, and the currently
  // displayed data is left untouched until then. setApiServer clears the scan
  // cooldown so that next scan isn't rate-blocked by a recent scan on the
  // previous server.
  const serverSelect = document.getElementById("server-select");
  if (serverSelect && typeof getApiServerKey === "function") {
    serverSelect.value = getApiServerKey();
    serverSelect.addEventListener("change", () => {
      setApiServer(serverSelect.value);
      // Gold trades per region, and it scales every silver sink through the
      // Global Discount, so it must follow the server switch immediately
      // rather than wait for the next manual scan.
      pullGoldPrice();
    });
  }

  // Live gold price → Global Discount on every silver cost. One cheap request;
  // the cached value from localStorage prices the tables until it lands.
  function pullGoldPrice() {
    if (typeof renderGlobalDiscountReadout === "function") renderGlobalDiscountReadout();
    if (typeof refreshGoldPrice !== "function") return;
    refreshGoldPrice().then(() => {
      if (typeof renderGlobalDiscountReadout === "function") renderGlobalDiscountReadout();
    });
  }
  pullGoldPrice();

  // UI language switcher — English / Spanish. Purely client-side: item names
  // (getItemDisplayName) + static chrome ([data-i18n]) re-localize instantly.
  // Prices are language-independent, so switching never triggers a re-scan; the
  // already-scanned data is just re-rendered in the new language.
  const langSelect = document.getElementById("lang-select");
  if (langSelect && typeof getLang === "function") {
    langSelect.value = getLang();
    langSelect.addEventListener("change", () => {
      setLang(langSelect.value);
      // The ⚙ panel's node names are baked in at open time, so drop it rather
      // than leave half of it in the old language.
      if (typeof closeSpecPanel === "function") closeSpecPanel();
      if (typeof applyStaticI18n === "function") applyStaticI18n();
      // applyStaticI18n repaints [data-i18n] chrome from the language table,
      // which wipes the "*" marker the ⚙ buttons carry for a customised scope —
      // and the heading's maxed/custom slug with it. Re-apply after it.
      updateSpecHeadings();
      // The Roads panel is static (no market data), so renderAllTables never
      // touches it — repaint its rows and map in the new language by hand.
      if (typeof window.renderRoadsPanel === "function") window.renderRoadsPanel();
      // Built from interpolated strings, not [data-i18n] chrome, so it needs
      // its own repaint too.
      if (typeof renderGlobalDiscountReadout === "function") renderGlobalDiscountReadout();
      scheduleRerender("language");
    });
  }
  // Apply the saved language to the static chrome on initial load.
  if (typeof applyStaticI18n === "function") applyStaticI18n();
  updateSpecHeadings();

  // Station Fee input — restore saved preference (default: 400)
  const stationFeeInput = document.getElementById("station-fee");
  if (stationFeeInput) {
    stationFeeInput.value = localStorage.getItem("stationFee") ?? "400";
    stationFeeInput.addEventListener("change", () => {
      localStorage.setItem("stationFee", stationFeeInput.value);
      scheduleRerender("station-fee");
    });
  }

  // Daily Production Bonus — TWO toolbar slots, each a (group, bonus) pair.
  // The station's rotating +10%/+20% applies PER ITEM GROUP only (craft rows
  // match their craftType, refining "refine:<resource>", butcher "butcher" —
  // js/data-daily-bonus-groups.js), and it feeds the production-bonus sum
  // inside every RRR (js/calculations.js), so a change re-renders every table.
  // The group picker is a text input over ONE shared <datalist> (Chromium
  // filters its options by substring as the user types); the input's visible
  // text is only the group's label, so the resolved group id is kept on the
  // input's data-daily-bonus-group attribute — the attribute is what the RRR
  // readers (getDailyProductionBonus) trust. The pref is a JSON map string,
  // e.g. {"sword":0.2,"refine:wood":0.1}; legacy scalar values parse to {}.
  const dpbGroup1 = document.getElementById("daily-bonus-group-1");
  const dpbValue1 = document.getElementById("daily-bonus-value-1");
  const dpbGroup2 = document.getElementById("daily-bonus-group-2");
  const dpbValue2 = document.getElementById("daily-bonus-value-2");
  if (dpbGroup1 && dpbValue1 && dpbGroup2 && dpbValue2) {
    const dpbGroups = (typeof globalThis.DAILY_BONUS_GROUPS !== "undefined" && globalThis.DAILY_BONUS_GROUPS) || [];
    const dpbLabel = (id) => (typeof globalThis.dailyBonusGroupLabel === "function" ? globalThis.dailyBonusGroupLabel(id) : id);
    // Fill the shared datalist from the group model; both inputs point at it
    // via their list= attribute (static in index.html).
    const dpbDatalist = document.getElementById("daily-bonus-groups-list");
    if (dpbDatalist) {
      dpbGroups.forEach((id) => {
        const opt = document.createElement("option");
        opt.value = dpbLabel(id);
        dpbDatalist.appendChild(opt);
      });
    }
    // Entry 1 fills slot 1, entry 2 slot 2; empty/parsed-junk slots restore to
    // an empty input (dataset "none" = no bonus) and the "+10%" default.
    const applyDailyBonusSlots = (map) => {
      const entries = Object.entries(map || {}).slice(0, 2);
      [dpbGroup1, dpbGroup2].forEach((input, i) => {
        input.value = entries[i] ? dpbLabel(entries[i][0]) : "";
        input.dataset.dailyBonusGroup = entries[i] ? entries[i][0] : "none";
      });
      [dpbValue1, dpbValue2].forEach((sel, i) => {
        sel.value = entries[i] ? String(entries[i][1]) : "0.1";
      });
    };
    applyDailyBonusSlots(
      typeof parseDailyBonusJson === "function"
        ? parseDailyBonusJson(localStorage.getItem("dailyProductionBonus"))
        : {}
    );
    // One listener per control (4): the group inputs resolve the typed text
    // back to a group id onto the dataset first (dailyBonusGroupIdFromLabel
    // maps unknown/empty text to "none", so junk simply prices as no bonus and
    // the input keeps the text), then share the persist path with the value
    // selects — serialize the slots through the SAME validity rules the RRR
    // readers use (getDailyProductionBonus reads the dataset, skips
    // "none"/invalid groups and junk values) and store the JSON map.
    const persistDailyBonusSlots = () => {
      const map = (typeof getDailyProductionBonus === "function") ? getDailyProductionBonus() : {};
      localStorage.setItem("dailyProductionBonus", JSON.stringify(map));
      scheduleRerender("daily-production-bonus");
    };
    const onGroupInputChange = (input) => {
      input.dataset.dailyBonusGroup =
        (typeof globalThis.dailyBonusGroupIdFromLabel === "function")
          ? globalThis.dailyBonusGroupIdFromLabel(input.value)
          : "none"; // no group model loaded → nothing can be resolved
      persistDailyBonusSlots();
    };
    [dpbGroup1, dpbGroup2].forEach((input) => {
      input.addEventListener("change", () => onGroupInputChange(input));
    });
    [dpbValue1, dpbValue2].forEach((sel) => {
      sel.addEventListener("change", persistDailyBonusSlots);
    });
    // The per-slot ✕ buttons (#daily-bonus-clear-1 / #daily-bonus-clear-2,
    // one right after each group input in index.html): the day's bonus for
    // THAT group expired, so clicking empties its own slot — input text and
    // the resolved data-daily-bonus-group id — and prices it as no bonus.
    // The emptied state persists through the same path as the change
    // listeners above (persistDailyBonusSlots serializes
    // getDailyProductionBonus() and schedules the rerender), so the tables
    // reprice instantly. The other slot keeps its group: clearing is per
    // slot, no re-typing of the survivor.
    [dpbGroup1, dpbGroup2].forEach((input, i) => {
      const dpbClearBtn = document.getElementById("daily-bonus-clear-" + (i + 1));
      if (!dpbClearBtn) return;
      dpbClearBtn.addEventListener("click", () => {
        input.value = "";
        input.dataset.dailyBonusGroup = "none";
        persistDailyBonusSlots();
      });
    });
  }
  // One-time cleanup: the Gathering Tier pref died with its header control, and
  // a stale value must never leak back in through settings import.
  if (localStorage.getItem("journalFillTier") !== null) {
    localStorage.removeItem("journalFillTier");
  }
  // Same deal: the "Clear" checkbox died with the per-slot ✕ buttons, so its
  // stale "true" must not survive on disk or ride an export.
  if (localStorage.getItem("dailyBonusCleared") !== null) {
    localStorage.removeItem("dailyBonusCleared");
  }

  // Trophy Happiness box — sets every laborer's own-tier journal yield. Same
  // deal: the module (js/laborer-happiness.js) owns restore/persist.
  if (typeof initLaborerHappinessControl === "function") {
    initLaborerHappinessControl(() => scheduleRerender("laborer-happiness"));
  }

  // House Tier pickers — a building holds furniture of its own tier or lower, so
  // this caps both Trophy Happiness boxes and hides the Crafting Planner's
  // unplaceable furniture. Both pickers edit one preference (js/house-tier.js);
  // the happiness boxes are re-painted here because their ceilings just moved.
  if (typeof initHouseTierControl === "function") {
    initHouseTierControl(() => {
      if (typeof refreshLaborerHappinessControl === "function") {
        refreshLaborerHappinessControl();
      }
      scheduleRerender("house-tier");
    });
  }

  // Pricing Model radios — one group per LEG (default: instant on both).
  // A pre-split install stored a single "orderType"; it seeds whichever side has
  // no saved value of its own, so an upgrade lands on the mode the user had.
  const legacyOrderType = localStorage.getItem("orderType");
  orderTypeGroups.forEach(({ name, key }) => {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    if (!radios.length) return;
    let saved = localStorage.getItem(key);
    if (saved !== "market" && saved !== "instant") {
      saved = (legacyOrderType === "market" || legacyOrderType === "instant")
        ? legacyOrderType : null;
      if (saved) localStorage.setItem(key, saved);
    }
    if (saved) radios.forEach((radio) => { radio.checked = radio.value === saved; });
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        if (radio.checked) localStorage.setItem(key, radio.value);
        scheduleRerender("order-type");
      });
    });
  });
}
