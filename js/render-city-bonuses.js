/**
 * City Bonuses reference table.
 *
 * Static rollup of every per-city production bonus the calculator already
 * uses elsewhere — surfaced as a single sortable-free reference panel so
 * the player can see at a glance which city gives which spec.
 *
 * Sources (all live in js/calculations.js, single source of truth):
 *   - BASE_CITY_BONUS              18% for every royal city + Brecilien + Caerleon
 *   - CITY_CRAFT_SPEC   +15%       per-craft-type list
 *   - CITY_REFINE_SPEC  +40%       single refined resource
 *   - CITY_BUTCHER_SPEC +10% PB    per-meat-tier list
 *   - CITY_FARM_SPEC    +10% yield crops / herbs / byproducts split
 *
 * No market data dependency — renders once on DOMContentLoaded and never
 * re-renders. Header click handlers are intentionally skipped (rows are
 * fixed-order by CITY_ORDER, no sortable columns).
 */

(function () {
  // Stable order — matches the rest of the dashboard's city dropdowns.
  const CITY_ORDER = [
    "Caerleon",
    "Bridgewatch",
    "Fort Sterling",
    "Lymhurst",
    "Martlock",
    "Thetford",
    "Brecilien",
  ];

  // Display labels for craft-type keys (kebab → Title Case where the raw
  // id isn't already human-readable). Anything not listed gets a default
  // title-case pass.
  const CRAFT_TYPE_LABELS = {
    plate_helmet: "Plate Helmet",
    plate_armor: "Plate Armor",
    plate_shoes: "Plate Shoes",
    leather_helmet: "Leather Helmet",
    leather_armor: "Leather Armor",
    leather_shoes: "Leather Shoes",
    cloth_helmet: "Cloth Helmet",
    cloth_armor: "Cloth Armor",
    cloth_shoes: "Cloth Shoes",
    quarterstaff: "Quarterstaff",
    holystaff: "Holy Staff",
    arcanestaff: "Arcane Staff",
    cursestaff: "Curse Staff",
    naturestaff: "Nature Staff",
    firestaff: "Fire Staff",
    froststaff: "Frost Staff",
    shapeshifterstaff: "Shapeshifter Staff",
    skinningknife: "Skinning Knife",
    stonehammer: "Stonehammer",
    demolitionhammer: "Demolition Hammer",
    woodaxe: "Wood Axe",
    fibergatherer_helmet: "Fiber Gatherer Helmet",
    fibergatherer_armor: "Fiber Gatherer Armor",
    fibergatherer_shoes: "Fiber Gatherer Shoes",
    fibergatherer_backpack: "Fiber Gatherer Backpack",
    hidegatherer_helmet: "Hide Gatherer Helmet",
    hidegatherer_armor: "Hide Gatherer Armor",
    hidegatherer_shoes: "Hide Gatherer Shoes",
    hidegatherer_backpack: "Hide Gatherer Backpack",
    oregatherer_helmet: "Ore Gatherer Helmet",
    oregatherer_armor: "Ore Gatherer Armor",
    oregatherer_shoes: "Ore Gatherer Shoes",
    oregatherer_backpack: "Ore Gatherer Backpack",
    rockgatherer_helmet: "Rock Gatherer Helmet",
    rockgatherer_armor: "Rock Gatherer Armor",
    rockgatherer_shoes: "Rock Gatherer Shoes",
    rockgatherer_backpack: "Rock Gatherer Backpack",
    woodgatherer_helmet: "Wood Gatherer Helmet",
    woodgatherer_armor: "Wood Gatherer Armor",
    woodgatherer_shoes: "Wood Gatherer Shoes",
    woodgatherer_backpack: "Wood Gatherer Backpack",
    fishgatherer_helmet: "Fish Gatherer Helmet",
    fishgatherer_armor: "Fish Gatherer Armor",
    fishgatherer_shoes: "Fish Gatherer Shoes",
    fishgatherer_backpack: "Fish Gatherer Backpack",
    food: "Food (Meals)",
    knuckles: "War Gloves",
  };

  const REFINE_LABELS = {
    wood: "Planks (Wood)",
    fiber: "Cloth (Fiber)",
    rock: "Stone Blocks (Rock)",
    ore: "Metal Bars (Ore)",
    hide: "Leather (Hide)",
  };

  /** Slug for a city name: "Fort Sterling" → fort_sterling, apostrophes dropped. */
  function citySlug(city) {
    return String(city).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_");
  }

  function prettyCraftType(key) {
    const en = CRAFT_TYPE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
    return typeof tx === "function" ? tx(en, `craft_type_${key}`) : en;
  }

  function itemDisplayName(id) {
    // getItemDisplayName localizes (ITEM_NAMES_ES in es mode); the raw EN map
    // is the fallback for the Node harness, where utils.js is not loaded.
    if (typeof getItemDisplayName === "function") {
      const name = getItemDisplayName(id);
      if (name) return name;
    }
    if (typeof ITEM_NAMES_MAP !== "undefined" && ITEM_NAMES_MAP[id]) {
      return ITEM_NAMES_MAP[id];
    }
    return id;
  }

  // Build per-city payload from the constants. Pure — caller passes the
  // constants explicitly so the test harness can stub them.
  function buildCityBonusRows(constants) {
    const {
      CITY_CRAFT_SPEC = {},
      CITY_REFINE_SPEC = {},
      CITY_BUTCHER_SPEC = {},
      CITY_FARM_SPEC = {},
      cityOrder = CITY_ORDER,
    } = constants || {};

    return cityOrder.map((city) => {
      const farm = CITY_FARM_SPEC[city] || {};
      return {
        city,
        crafts: (CITY_CRAFT_SPEC[city] || []).slice(),
        refine: CITY_REFINE_SPEC[city] || null,
        butcher: (CITY_BUTCHER_SPEC[city] || []).slice(),
        crops: (farm.crops || []).slice(),
        herbs: (farm.herbs || []).slice(),
        byproducts: (farm.byproducts || []).slice(),
      };
    });
  }

  function listCell(items, mapper) {
    if (!items || items.length === 0) {
      return '<span style="color:#6b7280">—</span>';
    }
    return items
      .map((id) => `<span class="cb-chip">${mapper(id)}</span>`)
      .join(" ");
  }

  function renderRow(row) {
    return `
      <tr>
        <td class="cb-city">${typeof tx === "function" ? tx(row.city, citySlug(row.city)) : row.city}</td>
        <td class="cb-base">+18%</td>
        <td class="cb-crafts">${listCell(row.crafts, prettyCraftType)}</td>
        <td class="cb-refine">${
          row.refine
            ? `<span class="cb-chip">${
                typeof tx === "function"
                  ? tx(REFINE_LABELS[row.refine] || row.refine, `refine_type_${row.refine}`)
                  : REFINE_LABELS[row.refine] || row.refine
              }</span>`
            : '<span style="color:#6b7280">—</span>'
        }</td>
        <td class="cb-butcher">${listCell(row.butcher, itemDisplayName)}</td>
        <td class="cb-crops">${listCell(row.crops, itemDisplayName)}</td>
        <td class="cb-herbs">${listCell(row.herbs, itemDisplayName)}</td>
        <td class="cb-byproducts">${listCell(row.byproducts, itemDisplayName)}</td>
      </tr>
    `;
  }

  function renderCityBonusesTable() {
    const tbody = document.querySelector("#city-bonuses-table tbody");
    if (!tbody) return;
    const constants = {
      CITY_CRAFT_SPEC: typeof CITY_CRAFT_SPEC !== "undefined" ? CITY_CRAFT_SPEC : {},
      CITY_REFINE_SPEC: typeof CITY_REFINE_SPEC !== "undefined" ? CITY_REFINE_SPEC : {},
      CITY_BUTCHER_SPEC: typeof CITY_BUTCHER_SPEC !== "undefined" ? CITY_BUTCHER_SPEC : {},
      CITY_FARM_SPEC: typeof CITY_FARM_SPEC !== "undefined" ? CITY_FARM_SPEC : {},
    };
    const rows = buildCityBonusRows(constants);
    tbody.innerHTML = rows.map(renderRow).join("");
    // Static table — re-apply its own search box on every re-render (load /
    // expand) since updateTableDisplay never runs for it.
    if (typeof window !== "undefined" && typeof window.applyTableSearchFilter === "function") {
      window.applyTableSearchFilter("city-bonuses-table");
    }
  }

  if (typeof window !== "undefined") {
    window.renderCityBonusesTable = renderCityBonusesTable;
    window.buildCityBonusRows = buildCityBonusRows;
    window.CITY_BONUS_ORDER = CITY_ORDER;
    // Shared with render-black-zone-bonuses.js — one craft-label map for both.
    window.prettyCraftType = prettyCraftType;
    window.CRAFT_TYPE_LABELS = CRAFT_TYPE_LABELS;
    document.addEventListener("DOMContentLoaded", () => {
      // The bonus rows come from the injected catalogs (js/catalog-loader.js);
      // painting on parse-end would read them before they land and render an
      // all-"—" table that nothing ever re-renders. Wait for the catalogs.
      const paint = () => {
        try {
          renderCityBonusesTable();
          // Let the collapsible-tables handler in app.js replay our render
          // after the section is re-expanded (it wipes tbody on collapse).
          const tbl = document.getElementById("city-bonuses-table");
          if (tbl) tbl._staticRenderer = renderCityBonusesTable;
        } catch (e) {
          console.error("renderCityBonusesTable:", e);
        }
      };
      if (typeof showCatalogLoading === "function") showCatalogLoading("city-bonuses-table");
      if (typeof whenCatalogsReady === "function") whenCatalogsReady(paint);
      else paint();
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildCityBonusRows,
      renderRow,
      CITY_ORDER,
      CRAFT_TYPE_LABELS,
      REFINE_LABELS,
      prettyCraftType,
    };
  }
})();
