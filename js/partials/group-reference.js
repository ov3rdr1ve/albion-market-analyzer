// Markup of the "reference" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-reference" data-group="reference">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_reference">Reference</span>
        <span class="tgroup-sub" data-i18n="group_reference_sub">Static bonus tables — no market scan needed</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="city_bonuses_reference">City Bonuses (Reference)</span>
      <input id="search-city-bonuses-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. martlock" data-i18n-ph="filter_e_g_martlock" />
    </h2>
    <table id="city-bonuses-table" class="data-table">
      <thead>
        <tr>
          <th data-i18n="city">City</th>
          <th title="Base Royal City production bonus (every city)" data-i18n-title="base_royal_city_production_bonus_every_city" data-i18n="base">Base</th>
          <th title="+15% craft bonus for these item types" data-i18n-title="15_craft_bonus_for_these_item_types" data-i18n="crafting_15">Crafting (+15%)</th>
          <th title="+40% refining bonus for this resource" data-i18n-title="40_refining_bonus_for_this_resource" data-i18n="refining_40">Refining (+40%)</th>
          <th title="+10 production points on these meat tiers" data-i18n-title="10_production_points_on_these_meat_tiers" data-i18n="butcher_10_pb">Butcher (+10 PB)</th>
          <th title="+10% product yield bonus on these crops" data-i18n-title="10_seed_yield_bonus_on_these_crops" data-i18n="farm_crops_10">Farm Crops (+10%)</th>
          <th title="+10% product yield bonus on these herbs" data-i18n-title="10_seed_yield_bonus_on_these_herbs" data-i18n="farm_herbs_10">Farm Herbs (+10%)</th>
          <th title="+10% byproduct yield bonus (eggs / milk)" data-i18n-title="10_byproduct_yield_bonus_eggs_milk" data-i18n="farm_byproducts_10">Farm Byproducts (+10%)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="8" data-i18n="loading">Loading...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="black_zone_bonuses_reference">Black Zone Crafting: Zone Quality × Power Level (Reference)</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="black_zone_desc">
      Hideout production bonus and resource return rate. The drivers are Zone Quality (1-6) and Power Level (1-9); hideout level only buys slots. Focus adds a flat +59 bonus.
    </small>
      <input id="search-black-zone-bonuses-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. q4" data-i18n-ph="filter_e_g_q4" />
    </h2>
    <table id="black-zone-bonuses-table" class="data-table">
      <thead>
        <tr>
          <th title="Zone quality of the region the hideout sits in (1-6)" data-i18n-title="bz_zone_quality_tip" data-i18n="zone_quality">Zone Quality</th>
          <th title="Hideout power level, fed by Power Cores (decays over time)" data-i18n-title="bz_power_level_tip" data-i18n="power_level">Power Level</th>
          <th title="Production bonus for non-specialized crafts — power level only, zone quality does not matter" data-i18n-title="bz_general_pb_tip" data-i18n="general_pb">General PB</th>
          <th title="Resource return rate without focus" data-i18n-title="bz_general_rrr_tip" data-i18n="general_rrr">General RRR</th>
          <th title="Resource return rate with focus (+59 production bonus)" data-i18n-title="bz_general_rrr_focus_tip" data-i18n="general_rrr_focus">General RRR (Focus)</th>
          <th title="Production bonus for crafts the region's biome specializes in" data-i18n-title="bz_spec_pb_tip" data-i18n="specialized_pb">Specialized PB</th>
          <th title="Specialized resource return rate without focus" data-i18n-title="bz_spec_rrr_tip" data-i18n="specialized_rrr">Specialized RRR</th>
          <th title="Specialized resource return rate with focus (+59 production bonus)" data-i18n-title="bz_spec_rrr_focus_tip" data-i18n="specialized_rrr_focus">Specialized RRR (Focus)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="8" data-i18n="loading">Loading...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="black_zone_locations_reference">Black Zone Locations &amp; Refining (Reference)</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="black_zone_locations_desc">
      Refining in the Outlands is flat — no zone quality, power level or specialization. Crafting bonuses scale with quality and power (table above); the Rests are flat.
    </small>
      <input id="search-black-zone-locations-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. swamp" data-i18n-ph="filter_e_g_swamp" />
    </h2>
    <table id="black-zone-locations-table" class="data-table">
      <thead>
        <tr>
          <th data-i18n="location">Location</th>
          <th title="Refining production bonus at this location" data-i18n-title="bz_refine_pb_tip" data-i18n="refining_pb">Refining PB</th>
          <th title="Refining resource return rate without focus" data-i18n-title="bz_refine_rrr_tip" data-i18n="refining_rrr">Refining RRR</th>
          <th title="Refining resource return rate with focus (+59 production bonus)" data-i18n-title="bz_refine_rrr_focus_tip" data-i18n="refining_rrr_focus">Refining RRR (Focus)</th>
          <th title="Crafting production bonus for non-specialized items" data-i18n-title="bz_craft_general_tip" data-i18n="crafting_pb_general">Crafting PB (General)</th>
          <th title="Crafting production bonus for items this location specializes in" data-i18n-title="bz_craft_spec_tip" data-i18n="crafting_pb_specialized">Crafting PB (Specialized)</th>
          <th data-i18n="notes">Notes</th>
          <th title="Item types that get the specialized crafting bonus here" data-i18n-title="bz_spec_crafts_tip" data-i18n="specialized_crafts">Specialized Crafts</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="8" data-i18n="loading">Loading...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="brecilien_travel_planner_fees_out_of_brecili">Brecilien Travel Planner Fees (Out of Brecilien)</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="brecilien_desc">
      Per-unit Travel Planner fee for moving goods out of Brecilien; resources double per enchant level. Reference only — the profit tables no longer apply it.
    </small>
      <input id="search-brecilien-fees-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. relic" data-i18n-ph="filter_e_g_relic" />
    </h2>
    <table id="brecilien-fees-table" class="data-table">
      <thead>
        <tr>
          <th data-i18n="item">Item</th>
          <th data-i18n="t4">T4</th>
          <th data-i18n="t5">T5</th>
          <th data-i18n="t6">T6</th>
          <th data-i18n="t7">T7</th>
          <th data-i18n="t8">T8</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="6" data-i18n="loading">Loading...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span data-i18n="roads_zone_reference_title">Roads of Avalon — Zone Reference</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="roads_zones_intro">
        406 roads zones with tier, chest spawns and gatherable resources. ◆ marks a Brecilien portal (T8 deep roads).
      </small>
      <input id="search-roads-zones-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. gold" data-i18n-ph="filter_e_g_gold" />
    </h2>
    <table id="roads-zones-table" class="data-table">
      <thead>
        <tr>
          <th data-i18n="zone">Zone</th>
          <th data-i18n="tier">Tier</th>
          <th data-i18n="type">Type</th>
          <th data-i18n="chests">Chests</th>
          <th data-i18n="resources">Resources</th>
          <th data-i18n="markers">Markers</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="6" data-i18n="loading">Loading...</td>
        </tr>
      </tbody>
    </table>
      </div>
    </section>
`);
