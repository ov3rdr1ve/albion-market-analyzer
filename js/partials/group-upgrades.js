// Markup of the "upgrades" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-upgrades" data-group="upgrades">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_upgrades">Item Upgrades</span>
        <span class="tgroup-sub" data-i18n="group_upgrades_sub">Enchanting, transmuting and quality rerolls</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="enchanting">Enchanting</span>
      <button id="scan-enchanting-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Enchanting table only — fetches base-item &amp; enchant-material prices and recomputes upgrade (.n → .n+1) profit." data-i18n-title="scan_the_enchanting_table_only_fetches_base_" data-i18n="scan_enchanting">Scan Enchanting</button>
      <input id="search-enchanting-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. leather" data-i18n-ph="filter_e_g_leather" />
    </h2>
    <table id="enchanting-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The item being enchanted, at the level this row produces." data-i18n="item" data-i18n-title="the_item_being_enchanted_at_the_level_this_r">Item</th>
          <th title="The enchant step being crafted — e.g. .0 → .1 upgrades a base item to enchant level 1 by adding enchant materials (runes/souls/relics)." data-i18n-title="the_enchant_step_being_crafted_e_g_0_1_upgra" data-i18n="transition">Transition</th>
          <th title="Where the unenchanted base item is bought, and what it costs there." data-i18n="source_buy" data-i18n-title="where_the_unenchanted_base_item_is_bought_an">Source — Buy</th>
          <th title="Runes, souls or relics the upgrade eats, at the cheapest city." data-i18n="enchant_mats" data-i18n-title="runes_souls_or_relics_the_upgrade_eats_at_th">Enchant Mats</th>
          <th data-sort="cost" class="sortable" title="Base item plus enchant materials, net of the return rate." data-i18n="total_input" data-i18n-title="base_item_plus_enchant_materials_net_of_the_">Total Input</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for the enchanted item on your sell leg." data-i18n="sell_price" data-i18n-title="best_sell_price_for_the_enchanted_item_on_yo">Sell Price</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Total Input." data-i18n="margin_2" data-i18n-title="pure_profit_total_input">Margin %</th>
          <th data-sort="profit" class="sortable" title="Sell price minus total input, after sales tax, the setup fee and the station fee." data-i18n="pure_profit" data-i18n-title="sell_price_minus_total_input_after_sales_tax">Pure Profit</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="9" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="transmute">Transmute</span>
      <button id="scan-transmute-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Transmute table only — fetches resource prices and recomputes silver-cost resource transmutation margins." data-i18n-title="scan_the_transmute_table_only_fetches_resour" data-i18n="scan_transmute">Scan Transmute</button>
      <input id="search-transmute-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. t5" data-i18n-ph="filter_e_g_t5" />
    </h2>
    <table id="transmute-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="Tier this transmute produces, out of the tier below it." data-i18n="tier" data-i18n-title="tier_this_transmute_produces_out_of_the_tier">Tier</th>
          <th title="The transmutation being performed at the Transmutation Tower — converting one resource or enchant currency into another (e.g. a tier change, or Rune → Soul → Relic)." data-i18n-title="the_transmutation_being_performed_at_the_tra" data-i18n="transition">Transition</th>
          <th title="Where the input resource is bought, and what it costs there." data-i18n="source_buy" data-i18n-title="where_the_input_resource_is_bought_and_what_">Source — Buy</th>
          <th title="Station silver fee the transmute charges on top of the materials." data-i18n="silver_cost" data-i18n-title="station_silver_fee_the_transmute_charges_on_">Silver Cost</th>
          <th data-sort="cost" class="sortable" title="Input resources plus the silver fee." data-i18n="total_input" data-i18n-title="input_resources_plus_the_silver_fee">Total Input</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for the transmuted resource on your sell leg." data-i18n="sell_price" data-i18n-title="best_sell_price_for_the_transmuted_resource_">Sell Price</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Total Input." data-i18n="margin_2" data-i18n-title="pure_profit_total_input">Margin %</th>
          <th data-sort="profit" class="sortable" title="Sell price minus total input, after sales tax and the setup fee." data-i18n="pure_profit" data-i18n-title="sell_price_minus_total_input_after_sales_tax_2">Pure Profit</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="9" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="quality_rerolling">Quality Rerolling</span>
      <button id="scan-rerolling-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Quality Rerolling table only — fetches item prices by quality and recomputes reroll-cost vs. quality uplift." data-i18n-title="scan_the_quality_rerolling_table_only_fetche" data-i18n="scan_rerolling">Scan Rerolling</button>
      <label style="font-size:0.8rem;font-weight:normal;color:#9ca3af;display:flex;align-items:center;gap:6px">
        <span data-i18n="transition_label">Transition:</span>
        <select id="rerolling-quality-filter" style="font-size:0.8rem;padding:3px 6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:3px">
          <option value="" data-i18n="all_transitions">All transitions</option>
        </select>
      </label>
      <input id="search-rerolling-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. t6" data-i18n-ph="filter_e_g_t6" />
    </h2>
    <table id="rerolling-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The item being rerolled for a higher quality." data-i18n="item" data-i18n-title="the_item_being_rerolled_for_a_higher_quality">Item</th>
          <th title="The quality upgrade being attempted — e.g. Good → Outstanding. Buy the item at the lower quality and reroll it for a chance at the higher quality." data-i18n-title="the_quality_upgrade_being_attempted_e_g_good" data-i18n="quality_transition">Quality Transition</th>
          <th data-sort="cost" class="sortable" title="What one unit of the starting item costs on your buy leg." data-i18n="buy_price" data-i18n-title="what_one_unit_of_the_starting_item_costs_on_">Buy Price</th>
          <th title="Expected silver to reach the target quality. A reroll is a random walk, so this averages the rolls it takes." data-i18n="reroll_cost" data-i18n-title="expected_silver_to_reach_the_target_quality_">Reroll Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price at the target quality." data-i18n="sell_price" data-i18n-title="best_sell_price_at_the_target_quality">Sell Price</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Buy Price." data-i18n="margin_2" data-i18n-title="pure_profit_buy_price">Margin %</th>
          <th data-sort="profit" class="sortable" title="Sell price minus buy price and reroll cost, after sales tax and the setup fee." data-i18n="pure_profit" data-i18n-title="sell_price_minus_buy_price_and_reroll_cost_a">Pure Profit</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="8" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>
      </div>
    </section>
`);
