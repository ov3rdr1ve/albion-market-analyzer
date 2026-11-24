/**
 * Wiring for the Clear / Export / Import Settings buttons.
 *
 * Split out of js/app.js: the bundle shape lives in js/settings-transfer.js,
 * this file only moves it in and out of the running page (file picker, blob
 * download, confirm prompts, and the re-render / control re-sync afterwards).
 */

/** Runtime string: English inline, Spanish from the UI_STRINGS_ES overlay. */
function TX(en, slug) {
  return typeof tx === "function" ? tx(en, slug) : en;
}

/** Prices, volumes and pinned cities are all "manually entered" — clear all 3. */
function clearAllOverrides() {
  priceOverrides = {};
  saveOverridesToStorage();
  if (typeof volumeOverrides !== "undefined") {
    volumeOverrides = {};
    saveVolumeOverridesToStorage();
  }
  if (typeof cityForceOverrides !== "undefined") {
    cityForceOverrides = {};
    saveCityForcesToStorage();
  }
}

/** Legacy ({ price: N }) entries import as both sides, like the storage loader. */
function normalizePriceOverrideMap(source) {
  const normalized = {};
  for (const [itemId, cities] of Object.entries(source || {})) {
    if (!cities || typeof cities !== "object") continue;
    for (const [city, entry] of Object.entries(cities)) {
      const norm = normalizeOverrideEntry(entry);
      if (norm) {
        if (!normalized[itemId]) normalized[itemId] = {};
        normalized[itemId][city] = norm;
      }
    }
  }
  return normalized;
}

function normalizeVolumeOverrideMap(source) {
  const normalized = {};
  for (const [itemId, cities] of Object.entries(source || {})) {
    if (!cities || typeof cities !== "object") continue;
    for (const [city, entry] of Object.entries(cities)) {
      const volume = entry && typeof entry === "object" ? entry.volume : entry;
      if (typeof volume === "number" && Number.isFinite(volume)) {
        if (!normalized[itemId]) normalized[itemId] = {};
        normalized[itemId][city] = { volume };
      }
    }
  }
  return normalized;
}

function normalizeCityForceMap(source) {
  const normalized = {};
  for (const [itemId, sides] of Object.entries(source || {})) {
    if (!sides || typeof sides !== "object") continue;
    ["buy", "sell"].forEach((side) => {
      if (typeof sides[side] === "string" && sides[side]) {
        if (!normalized[itemId]) normalized[itemId] = {};
        normalized[itemId][side] = sides[side];
      }
    });
  }
  return normalized;
}

function mergeOverrideMaps(target, incoming) {
  for (const [itemId, entries] of Object.entries(incoming)) {
    if (!target[itemId]) target[itemId] = {};
    Object.assign(target[itemId], entries);
  }
  return target;
}

/**
 * Push imported preference values onto the header controls. Each control's own
 * `change` listener writes storage, so we set the DOM from the (already
 * written) storage values instead of dispatching events — no write-back loops.
 */
function syncPrefControlsFromStorage() {
  const setChecked = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!on;
  };
  setChecked("show-all-items", localStorage.getItem("showAllItems") === "1");
  setChecked("include-caerleon", localStorage.getItem("caerleonRoutes") === "true");
  setChecked("premium-account", localStorage.getItem("premiumAccount") !== "0");
  const premium = localStorage.getItem("premiumAccount") !== "0";
  setChecked("use-focus", premium && localStorage.getItem("useFocus") !== "0");

  const stationFee = document.getElementById("station-fee");
  if (stationFee) stationFee.value = localStorage.getItem("stationFee") ?? "400";

  // The Daily Production Bonus pref is a JSON map string (up to two
  // group→bonus entries, e.g. {"sword":0.2}). parseDailyBonusJson
  // (js/utils.js, on globalThis) validates it; a missing key, a legacy scalar
  // or junk restores BOTH slots to their cleared defaults (empty group input,
  // dataset "none", "+10%"). The group input is a text field: it shows the
  // group's LABEL, while the resolved group id goes to its
  // data-daily-bonus-group attribute — the attribute is what the RRR readers
  // (getDailyProductionBonus) trust.
  const dpbEntries = (typeof globalThis !== "undefined" && typeof globalThis.parseDailyBonusJson === "function")
    ? Object.entries(globalThis.parseDailyBonusJson(localStorage.getItem("dailyProductionBonus"))).slice(0, 2)
    : [];
  ["daily-bonus-group-1", "daily-bonus-group-2"].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const entry = dpbEntries[i];
    if (el.dataset) el.dataset.dailyBonusGroup = entry ? entry[0] : "none";
    el.value = entry
      ? (typeof globalThis.dailyBonusGroupLabel === "function" ? globalThis.dailyBonusGroupLabel(entry[0]) : entry[0])
      : "";
  });
  ["daily-bonus-value-1", "daily-bonus-value-2"].forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.value = dpbEntries[i] ? String(dpbEntries[i][1]) : "0.1";
  });

  // Trophy happiness: the module clamps and re-derives the caption from storage,
  // so a missing key restores the max default rather than a blank box.
  if (typeof laborerHappinessSummary === "function") {
    const summary = laborerHappinessSummary();
    const general = document.getElementById("laborer-happiness-general");
    if (general) general.value = String(summary.general);
    const matching = document.getElementById("laborer-happiness-matching");
    if (matching) matching.value = String(summary.matching);
    const note = document.getElementById("laborer-happiness-note");
    if (note) note.textContent = summary.text;
  }

  // Roads route rules. The panel restores these at load; on import the controls
  // are already on screen, so a stale box would keep overriding the imported
  // value (routeOptions reads the DOM first). A saved gate is only applied if
  // its option exists — the picker is filled from ROADS_REALMGATES at runtime.
  setChecked("roads-route-cargo", localStorage.getItem("roadsRouteCargo") === "1");
  const gate = document.getElementById("roads-route-gate");
  const savedGate = localStorage.getItem("roadsRealmgate") ?? "";
  if (gate && [...gate.options].some((o) => o.value === savedGate)) gate.value = savedGate;
  const prefer = document.getElementById("roads-route-prefer");
  const savedPrefer = localStorage.getItem("roadsRoutePrefer") ?? "portal";
  if (prefer && [...prefer.options].some((o) => o.value === savedPrefer)) prefer.value = savedPrefer;

  // Pricing Model, one radio group per leg. A bundle exported before the split
  // carries only "orderType"; it drives both sides, exactly as it did then.
  const legacyOrderType = localStorage.getItem("orderType");
  ["buyOrderType", "sellOrderType"].forEach((key) => {
    const value = localStorage.getItem(key) || legacyOrderType;
    if (value !== "market" && value !== "instant") return;
    document.querySelectorAll(`input[name="${key}"]`).forEach((radio) => {
      radio.checked = radio.value === value;
    });
  });

  // Display size: the module re-reads storage and pushes the zoom factor at the
  // window, so the import takes effect without a restart.
  if (typeof initDisplaySizeControls === "function") initDisplaySizeControls();

  // Language: storage already holds the imported value, so just repaint the
  // static chrome (the tables re-render on the caller's renderAllTables).
  const langSelect = document.getElementById("lang-select");
  const lang = localStorage.getItem("appLang");
  if (langSelect && lang && langSelect.value !== lang) {
    langSelect.value = lang;
    if (typeof closeSpecPanel === "function") closeSpecPanel();
    if (typeof applyStaticI18n === "function") applyStaticI18n();
  }
}

function exportSettingsFile() {
  const bundle = buildSettingsBundle({
    priceOverrides,
    volumeOverrides: typeof volumeOverrides !== "undefined" ? volumeOverrides : {},
    cityForceOverrides:
      typeof cityForceOverrides !== "undefined" ? cityForceOverrides : {},
    specLevels: typeof exportSpecLevels === "function" ? exportSpecLevels() : {},
    roadsPortals:
      typeof loadPortalGraph === "function"
        ? loadPortalGraph(null, Date.now()).toJSON()
        : null,
  });
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `albion-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importSettingsBundle(parsed) {
  const bundle = readSettingsBundle(parsed);

  const prices = normalizePriceOverrideMap(bundle.overrides);
  const volumes = normalizeVolumeOverrideMap(bundle.volumeOverrides);
  const cities = normalizeCityForceMap(bundle.cityForceOverrides);

  const hasExisting =
    Object.keys(priceOverrides).length > 0 ||
    (typeof volumeOverrides !== "undefined" && Object.keys(volumeOverrides).length > 0);
  const replace = hasExisting
    ? confirm(TX("Replace all existing prices & volumes? OK = Replace, Cancel = Merge", "settings_replace_or_merge"))
    : true;

  if (replace) {
    priceOverrides = prices;
    if (typeof volumeOverrides !== "undefined") volumeOverrides = volumes;
    if (typeof cityForceOverrides !== "undefined") cityForceOverrides = cities;
  } else {
    mergeOverrideMaps(priceOverrides, prices);
    if (typeof volumeOverrides !== "undefined") mergeOverrideMaps(volumeOverrides, volumes);
    if (typeof cityForceOverrides !== "undefined") {
      for (const [itemId, sides] of Object.entries(cities)) {
        if (!cityForceOverrides[itemId]) cityForceOverrides[itemId] = {};
        Object.assign(cityForceOverrides[itemId], sides);
      }
    }
  }
  saveOverridesToStorage();
  if (typeof saveVolumeOverridesToStorage === "function") saveVolumeOverridesToStorage();
  if (typeof saveCityForcesToStorage === "function") saveCityForcesToStorage();

  if (!bundle.isBundle) return { ...bundle, portals: 0 };

  // Specs, prefs and panels are one profile, not per-item data — always
  // replaced, whatever the merge/replace answer above was.
  if (typeof importSpecLevels === "function") {
    // importSpecLevels also makes them "my levels", so the header "All Specs"
    // Reset restores the imported profile, not what this machine had before.
    importSpecLevels(bundle.specLevels);
    if (typeof updateSpecHeadings === "function") updateSpecHeadings();
  }
  applyStoredKeys(bundle.prefs, TRANSFER_PREF_KEYS);
  applyStoredKeys(bundle.panels, TRANSFER_PANEL_KEYS);
  syncPrefControlsFromStorage();

  // Portals MERGE: they're timed sightings, and two players' maps add up.
  const portals = importRoadsPortals(bundle.roadsPortals, Date.now());
  if (portals > 0 && typeof window.reloadRoadsPortals === "function") {
    window.reloadRoadsPortals();
  }
  return { ...bundle, portals };
}

function setupSettingsTransferControls() {
  const clearBtn = document.getElementById("clear-overrides-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!confirm(TX("Clear all manually entered prices, volumes and pinned cities?", "settings_clear_confirm"))) return;
      clearAllOverrides();
      scheduleRerender("clear-all-overrides");
    });
  }

  const exportBtn = document.getElementById("export-overrides-btn");
  if (exportBtn) exportBtn.addEventListener("click", exportSettingsFile);

  const importBtn = document.getElementById("import-overrides-btn");
  const fileInput = document.getElementById("import-overrides-file");
  if (importBtn && fileInput) {
    importBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            alert(TX("Invalid settings file.", "settings_invalid_file"));
            return;
          }
          const result = importSettingsBundle(parsed);
          scheduleRerender("settings-import");
          if (result.isBundle && Object.keys(result.panels).length > 0) {
            alert(TX("Settings imported. Chart & calculator panels apply after a restart.", "settings_imported_restart"));
          }
        } catch {
          alert(TX("Failed to parse settings file.", "settings_parse_failed"));
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    clearAllOverrides,
    normalizePriceOverrideMap,
    normalizeVolumeOverrideMap,
    normalizeCityForceMap,
    importSettingsBundle,
    setupSettingsTransferControls,
  };
}
