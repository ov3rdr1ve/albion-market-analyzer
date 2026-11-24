/**
 * Black Zone (Outlands) Bonuses reference tables.
 *
 * Two static, market-data-free panels rendered from js/data-black-zone.js:
 *
 *   #black-zone-bonuses-table   — the hideout crafting matrix: every
 *       zone quality (1-6) × power level (1-9) combination, with the general
 *       and specialized production bonus and the resource return rate each
 *       yields with and without focus.
 *   #black-zone-locations-table — the flat baselines: refining bonus per
 *       location, plus which crafts each Outlands biome / Rest specializes in.
 *
 * Same static-renderer contract as render-city-bonuses.js: render once on
 * DOMContentLoaded, re-render via `_staticRenderer` when app.js re-expands the
 * section, re-apply the table's search filter afterwards.
 */

(function () {
  // Data + label helpers live in other files. In the browser they are ambient
  // globals (plain <script> tags); under Node the test harness requires this
  // module directly, so pull them in explicitly.
  function bzData() {
    if (typeof getHideoutCraftPB === "function") {
      return {
        ZONE_QUALITIES, POWER_LEVELS, HIDEOUT_REFINE_PB, ROADS_REFINE_PB,
        REST_BONUS, BIOME_TO_CITY, REST_CRAFT_SPEC,
        getHideoutCraftPB, getBlackZoneRRR,
      };
    }
    return require("./data-black-zone.js");
  }

  function craftSpecOf(city) {
    if (typeof CITY_CRAFT_SPEC !== "undefined") return CITY_CRAFT_SPEC[city] || [];
    return require("./calculations.js").CITY_CRAFT_SPEC[city] || [];
  }

  function labelCraft(key) {
    if (typeof prettyCraftType === "function") return prettyCraftType(key);
    return require("./render-city-bonuses.js").prettyCraftType(key);
  }

  function pct(rate) {
    return `${(rate * 100).toFixed(1)}%`;
  }

  /**
   * One row per zone quality × power level (54 rows), quality-major order.
   */
  function buildHideoutMatrixRows() {
    const d = bzData();
    const rows = [];
    d.ZONE_QUALITIES.forEach((quality) => {
      d.POWER_LEVELS.forEach((power) => {
        const generalPB = d.getHideoutCraftPB(quality, power, false);
        const specPB = d.getHideoutCraftPB(quality, power, true);
        rows.push({
          quality,
          power,
          generalPB,
          generalRRR: d.getBlackZoneRRR(generalPB, false),
          generalRRRFocus: d.getBlackZoneRRR(generalPB, true),
          specPB,
          specRRR: d.getBlackZoneRRR(specPB, false),
          specRRRFocus: d.getBlackZoneRRR(specPB, true),
        });
      });
    });
    return rows;
  }

  /**
   * Flat baselines: the 5 Outlands biomes (hideouts), Roads hideouts, and the
   * 3 Rests. `crafts` holds the craft-type keys the location specializes in.
   */
  function buildLocationRows() {
    const d = bzData();
    const rows = Object.keys(d.BIOME_TO_CITY).map((biome) => ({
      location: `Hideout — ${biome}`,
      refinePB: d.HIDEOUT_REFINE_PB,
      craftGeneralPB: "0 – 26",
      craftSpecPB: "1 – 82",
      note: `Same specialization as ${d.BIOME_TO_CITY[biome]}`,
      crafts: craftSpecOf(d.BIOME_TO_CITY[biome]).slice(),
    }));

    rows.push({
      location: "Hideout — Roads of Avalon",
      refinePB: d.ROADS_REFINE_PB,
      craftGeneralPB: "0 – 26",
      craftSpecPB: "1 – 57",
      note: "Always Zone Quality 1",
      crafts: [],
    });

    Object.keys(d.REST_CRAFT_SPEC).forEach((rest) => {
      rows.push({
        location: rest,
        refinePB: d.REST_BONUS.refine,
        craftGeneralPB: String(d.REST_BONUS.craftBase),
        craftSpecPB: String(d.REST_BONUS.craftSpec),
        note: "Flat — no zone quality / power level",
        crafts: d.REST_CRAFT_SPEC[rest].slice(),
      });
    });

    return rows;
  }

  function renderMatrixRow(row) {
    return `
      <tr>
        <td class="cb-city">Q${row.quality}</td>
        <td class="cb-base">${row.power}</td>
        <td class="bz-num">${row.generalPB}</td>
        <td class="bz-num">${pct(row.generalRRR)}</td>
        <td class="bz-num bz-focus">${pct(row.generalRRRFocus)}</td>
        <td class="bz-num">${row.specPB}</td>
        <td class="bz-num">${pct(row.specRRR)}</td>
        <td class="bz-num bz-focus">${pct(row.specRRRFocus)}</td>
      </tr>
    `;
  }

  function renderLocationRow(row) {
    const d = bzData();
    const chips =
      row.crafts.length === 0
        ? '<span style="color:#6b7280">—</span>'
        : row.crafts.map((k) => `<span class="cb-chip">${labelCraft(k)}</span>`).join(" ");
    return `
      <tr>
        <td class="cb-city">${row.location}</td>
        <td class="bz-num">${row.refinePB}</td>
        <td class="bz-num">${pct(d.getBlackZoneRRR(row.refinePB, false))}</td>
        <td class="bz-num bz-focus">${pct(d.getBlackZoneRRR(row.refinePB, true))}</td>
        <td class="bz-num">${row.craftGeneralPB}</td>
        <td class="bz-num">${row.craftSpecPB}</td>
        <td class="bz-note">${row.note}</td>
        <td class="cb-crafts">${chips}</td>
      </tr>
    `;
  }

  function renderBlackZoneTables() {
    const matrix = document.querySelector("#black-zone-bonuses-table tbody");
    if (matrix) {
      matrix.innerHTML = buildHideoutMatrixRows().map(renderMatrixRow).join("");
      if (typeof window.applyTableSearchFilter === "function") {
        window.applyTableSearchFilter("black-zone-bonuses-table");
      }
    }
    const locations = document.querySelector("#black-zone-locations-table tbody");
    if (locations) {
      locations.innerHTML = buildLocationRows().map(renderLocationRow).join("");
      if (typeof window.applyTableSearchFilter === "function") {
        window.applyTableSearchFilter("black-zone-locations-table");
      }
    }
  }

  if (typeof window !== "undefined") {
    window.renderBlackZoneTables = renderBlackZoneTables;
    window.buildHideoutMatrixRows = buildHideoutMatrixRows;
    window.buildLocationRows = buildLocationRows;
    document.addEventListener("DOMContentLoaded", () => {
      // The zone tables read the injected catalogs (js/catalog-loader.js),
      // which land after first paint — paint on their promise, not on
      // parse-end, or bzData()'s bare reads throw and the tables stay empty.
      const paint = () => {
        try {
          renderBlackZoneTables();
          // app.js wipes a collapsed table's tbody — let it replay our render.
          ["black-zone-bonuses-table", "black-zone-locations-table"].forEach((id) => {
            const tbl = document.getElementById(id);
            if (tbl) tbl._staticRenderer = renderBlackZoneTables;
          });
        } catch (e) {
          console.error("renderBlackZoneTables:", e);
        }
      };
      if (typeof showCatalogLoading === "function") {
        showCatalogLoading("black-zone-bonuses-table");
        showCatalogLoading("black-zone-locations-table");
      }
      if (typeof whenCatalogsReady === "function") whenCatalogsReady(paint);
      else paint();
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      buildHideoutMatrixRows,
      buildLocationRows,
      renderMatrixRow,
      renderLocationRow,
    };
  }
})();
