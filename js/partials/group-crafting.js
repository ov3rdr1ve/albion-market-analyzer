// Markup of the "crafting" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-crafting" data-group="crafting">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_crafting">Crafting &amp; Refining</span>
        <span class="tgroup-sub" data-i18n="group_crafting_sub">Turning materials into sellable items</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 id="crafting-heading" style="display:flex;align-items:center;gap:12px">
      <span data-i18n="crafting_w_focus">Crafting (w/ Focus)</span>
      <button id="scan-crafting-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Crafting table only — fetches material &amp; gear prices and recomputes profit per craft at your ⚙ Specs levels." data-i18n="scan_crafting" data-i18n-title="scan_the_crafting_table_only_fetches_materia">Scan Crafting</button>
      <button type="button" class="spec-settings-btn" data-spec-scope="crafting-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <input id="search-crafting-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. bag" data-i18n-ph="filter_e_g_bag" />
    </h2>
    <table id="crafting-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="In-game item id of the gear this row crafts: tier, type, and the enchantment after the @." data-i18n="item_code" data-i18n-title="in_game_item_id_of_the_gear_this_row_crafts_">Item Code</th>
          <th data-sort="route" class="sortable" title="Where the materials are bought and where the finished gear is sold." data-i18n="route_buy_mats_sell_gear" data-i18n-title="where_the_materials_are_bought_and_where_the">
            Route (Buy Mats -> Sell Gear)
          </th>
          <th data-sort="materials" class="sortable" title="What one craft consumes, net of the resource return rate, at the prices shown." data-i18n="required_materials" data-i18n-title="what_one_craft_consumes_net_of_the_resource_">Required Materials</th>
          <th data-sort="cost" class="sortable" title="What one craft's materials cost, net of the return rate — focus raises that return, so it lowers this." data-i18n="input_cost" data-i18n-title="what_one_craft_s_materials_cost_net_of_the_r">Input Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for the crafted item on your sell leg." data-i18n="best_sell_price" data-i18n-title="best_sell_price_for_the_crafted_item_on_your">Best Sell Price</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Input Cost." data-i18n="profit" data-i18n-title="pure_profit_input_cost">Profit %</th>
          <th data-sort="profit" class="sortable" title="Sell price minus input cost, after sales tax, the setup fee and the crafting station fee." data-i18n="pure_profit" data-i18n-title="sell_price_minus_input_cost_after_sales_tax_">Pure Profit</th>
          <th data-sort="profitWithLaborer" class="sortable" title="Pure Profit + the craft's journal worked by your own T8 laborer (it returns loot and the empty journal). Picks the best journal tier in the ±2 fill window." data-i18n-title="pure_profit_plus_what_this_craft_s_journal_i" data-i18n="profit_laborer_journal">Profit + Laborer Journal</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Pure Profit per craft (after mat costs) × the whole crafts a 10,000 focus bar buys. 'Mats to Buy (10k Focus)' is that mat component, not an extra charge. Leftover focus is dropped." data-i18n-title="total_profit_from_spending_a_full_10_000_foc" data-i18n="profit_10k_focus">Profit / 10k Focus</th>
          <th data-sort="focusMats" class="sortable" title="Materials to buy for a full 10,000 focus of crafting = crafts per 10k focus × mats per craft, net of the focus return rate." data-i18n-title="total_quantity_of_materials_to_buy_to_spend_" data-i18n="mats_to_buy_10k_focus">
            Mats to Buy (10k Focus)
          </th>
          <th data-sort="profitPerFocus" class="sortable" title="Silver the FOCUS buys on this craft at your ⚙ Specs levels, not its whole profit: the extra material the return rate hands back ÷ focus per craft. The Crafting Planner ranks it against refining." data-i18n-title="net_silver_earned_per_focus_point_spent_craf" data-i18n="silver_focus">Silver/Focus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="12" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 id="craft-planner-heading" style="display:flex;align-items:center;gap:12px">
      <span data-i18n="crafting_planner_refine_craft_journal_one_be">Crafting Planner (Refine ▸ Craft ▸ Journal, one best Focus step)</span>
      <button id="scan-craft-planner-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Crafting Planner only — materials, the full refining ladder, the finished item and the journals, then recompute combined profit and the best focus play." data-i18n-title="scan_the_crafting_planner_only_fetches_mater" data-i18n="scan_planner">Scan Planner</button>
      <button type="button" class="spec-settings-btn" data-spec-scope="craft-planner-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <label
        style="color:#9ca3af;font-size:0.9rem;font-weight:normal;display:flex;align-items:center;gap:4px"
        title="The house you own. A building holds furniture of its own tier or lower, so furniture above this tier is hidden — you could craft it, but you could not place it." data-i18n-title="the_house_you_own_a_building_holds_furniture"
      >
        <span data-i18n="house_tier_label">House:</span>
        <select
          class="house-tier-select"
          id="house-tier-craft-planner"
          style="background:#1f2937;color:#e5e7eb;border:1px solid #3e5e82;padding:2px 4px;font-size:0.85rem;border-radius:3px"
        >
          <option value="2">T2</option>
          <option value="3">T3</option>
          <option value="4">T4</option>
          <option value="5">T5</option>
          <option value="6">T6</option>
          <option value="7">T7</option>
          <option value="8">T8</option>
        </select>
      </label>
      <input id="search-craft-planner-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. table, plate, T8" data-i18n-ph="filter_e_g_table_plate_t8" />
    </h2>
    <table id="craft-planner-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The item this plan crafts — one row per item, whichever city wins." data-i18n="item" data-i18n-title="the_item_this_plan_crafts_one_row_per_item_w">Item</th>
          <th data-sort="route" class="sortable" title="Every step from raw to finished item: what is bought, what is refined, and where each step happens." data-i18n="pipeline" data-i18n-title="every_step_from_raw_to_finished_item_what_is">Pipeline</th>
          <th data-sort="materials" class="sortable" title="Each material, with the cheaper of buying it or refining it yourself marked." data-i18n="materials_refine_vs_buy" data-i18n-title="each_material_with_the_cheaper_of_buying_it_">Materials (refine ▲ vs buy)</th>
          <th data-sort="cost" class="sortable" title="Per-craft cost: every material at the CHEAPER of buying the bar vs refining it yourself, net of the return rate, plus setup and station fees." data-i18n-title="total_per_craft_cost_every_material_sourced_" data-i18n="cost">Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for the finished item on your sell leg." data-i18n-title="best_sell_price_for_the_finished_item_on_you"><span data-i18n="sell">Sell</span> <span class="th-sub-sort" data-sort-sub="sellVol" title="Sort by the 24h sell volume at each row's sell city." data-i18n="vol_sort" data-i18n-title="sort_by_the_24h_sell_volume_at_each_row_s_sell">vol</span></th>
          <th data-sort="rerollEv" class="sortable" title="Extra silver per item from optimally quality-rerolling the craft instead of selling at Normal, at this row's sell city. Fills after a full Scan or Scan Rerolling (per-quality prices)." data-i18n-title="expected_extra_silver_per_item_from_optimal" data-i18n="reroll_ev">Reroll EV</th>
          <th data-sort="combined" class="sortable" title="Sell (after 6.5% tax) − cost + journal-fill silver. 'Use Focus' applies focus to ONE play only — the Best Focus winner, chosen to make this number the highest." data-i18n-title="pure_profit_per_craft_sell_after_6_5_tax_cos" data-i18n="profit_craft">Profit / Craft</th>
          <th data-sort="journalFill" class="sortable" title="Extra silver per craft from filling the crafting journal with this craft's fame: fame/craft × the best journal's silver-per-fame. The prices below are click-to-edit." data-i18n-title="extra_silver_per_craft_from_filling_the_craf" data-i18n="journal_fill">Journal Fill</th>
          <th data-sort="laborerCombined" class="sortable" title="Craft profit + crafting fame × a T8 laborer's silver per fame — the journal comes back empty, so it is never re-bought. An alternative to Profit / Craft, not an addition." data-i18n-title="profit_per_craft_under_the_other_journal_pla" data-i18n="laborer_journal">Laborer Journal</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Profit / Craft (after mat costs) × the whole crafts a 10,000 focus bar buys, spending the focus where Best Focus says. Leftover focus that can't pay for one more craft is dropped." data-i18n-title="cp_profit_10k_focus_tip" data-i18n="profit_10k_focus">Profit / 10k Focus</th>
          <th data-sort="silverPerFocus" class="sortable" title="The best single focus play for this row — the craft itself, or one material refine. Shown as the +silver/craft it adds, with its silver-per-focus after it." data-i18n-title="the_highest_silver_per_focus_play_for_this_r" data-i18n="best_focus">Best Focus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="12" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="refining_transports_all_cities">Refining / Transports (All Cities)</span>
      <button id="scan-transport-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Refining / Transport table only — fetches raw &amp; refined prices and recomputes refine-and-haul profit (with city return rates &amp; focus)." data-i18n-title="scan_the_refining_transport_table_only_fetch" data-i18n="scan_transport">Scan Transport</button>
      <button type="button" class="spec-settings-btn" data-spec-scope="transport-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <input id="search-transport-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. planks" data-i18n-ph="filter_e_g_planks" />
    </h2>
    <table id="transport-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The refined resource this row makes." data-i18n="refined" data-i18n-title="the_refined_resource_this_row_makes">Refined</th>
          <th data-sort="route" class="sortable" title="Where the raw is bought and where the refined resource is sold. Refining happens at the resource's spec city." data-i18n="route" data-i18n-title="where_the_raw_is_bought_and_where_the_refine">Route</th>
          <th data-sort="materials" class="sortable" title="Raw and lower-tier refined material one refine eats, net of the return rate." data-i18n="materials" data-i18n-title="raw_and_lower_tier_refined_material_one_refi">Materials</th>
          <th data-sort="cost" class="sortable" title="What one refine's inputs cost, net of the return rate." data-i18n="raw_cost" data-i18n-title="what_one_refine_s_inputs_cost_net_of_the_ret">Raw Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for the refined resource on your sell leg." data-i18n="sell" data-i18n-title="best_sell_price_for_the_refined_resource_on_">Sell</th>
          <th data-sort="margin" class="sortable" title="Profit ÷ Raw Cost." data-i18n="margin" data-i18n-title="profit_raw_cost">Margin</th>
          <th data-sort="profit" class="sortable" title="Sell price minus raw cost, after sales tax, the setup fee and the refining station fee." data-i18n="profit_2" data-i18n-title="sell_price_minus_raw_cost_after_sales_tax_th">Profit</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Profit per refine (after mat costs) × the whole refines a 10,000 focus bar buys. Pairs with '10k Focus Mats'; leftover focus that can't buy one more refine is dropped." data-i18n-title="total_profit_from_spending_a_full_10_000_foc_2" data-i18n="profit_10k_focus">Profit / 10k Focus</th>
          <th data-sort="profitGatheredPer10kFocus" class="sortable" title="Same 10,000 focus bar with the raws self-gathered: they cost 0 here and along the chain. Fees and tax still apply; heart and transmute substitutes are dropped." data-i18n-title="same_full_10_000_focus_bar_but_the_raw_resou" data-i18n="profit_gathered_10k_focus">Profit Gathered / 10k Focus</th>
          <th data-sort="focusMats" class="sortable" title="Raws to buy for a full 10,000 focus of refining = refines per 10k focus × raw per refine, net of the focus return rate." data-i18n-title="total_quantity_of_raw_materials_to_buy_to_sp" data-i18n="10k_focus_mats">10k Focus Mats</th>
          <th data-sort="profitPerFocus" class="sortable" title="Silver the FOCUS buys on this refine at your ⚙ Specs levels, not the route's whole profit — the Best Focus winner's extra raw, per focus point." data-i18n-title="marginal_silver_gained_per_focus_point_spent" data-i18n="silver_focus">Silver/Focus</th>
          <th data-sort="bestFocus" class="sortable" title="Which focus play leaves the refined resource you sell most profitable. On a chain row every tier is a candidate; the winner removes the most silver from the bar." data-i18n-title="which_focus_spending_leaves_the_refined_reso" data-i18n="best_focus">Best Focus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="13" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="consumables_all_cities">Consumables (All Cities)</span>
      <button id="scan-consumable-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Consumables table only — fetches ingredient &amp; meal/potion prices and recomputes cooking/brewing profit." data-i18n-title="scan_the_consumables_table_only_fetches_ingr" data-i18n="scan_consumables">Scan Consumables</button>
      <button type="button" class="spec-settings-btn" data-spec-scope="consumable-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <input id="search-consumable-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. t6 stew" data-i18n-ph="filter_e_g_t6_stew" />
    </h2>
    <table id="consumable-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The food or potion this row cooks or brews." data-i18n="consumable" data-i18n-title="the_food_or_potion_this_row_cooks_or_brews">Consumable</th>
          <th data-sort="route" class="sortable" title="Where the ingredients come from and where the finished consumable is sold." data-i18n="route_craft_buy_sell" data-i18n-title="where_the_ingredients_come_from_and_where_th">Route (Craft/Buy → Sell)</th>
          <th data-sort="materials" class="sortable" title="Ingredients one craft eats, net of the return rate. Farmed inputs can be bought or grown." data-i18n="ingredients" data-i18n-title="ingredients_one_craft_eats_net_of_the_return">Ingredients</th>
          <th data-sort="cost" class="sortable" title="Ingredient cost per output unit — a recipe that yields several units is divided by that yield." data-i18n="total_input_cost" data-i18n-title="ingredient_cost_per_output_unit_a_recipe_tha">Total Input Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for one unit on your sell leg." data-i18n="sell_price" data-i18n-title="best_sell_price_for_one_unit_on_your_sell_le">Sell Price</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Total Input Cost." data-i18n="margin" data-i18n-title="pure_profit_total_input_cost">Margin</th>
          <th data-sort="profit" class="sortable" title="Sell price minus input cost, after sales tax, the setup fee and the station fee." data-i18n="pure_profit" data-i18n-title="sell_price_minus_input_cost_after_sales_tax__2">Pure Profit</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Pure Profit per craft (after mat costs) × the whole crafts a 10,000 focus bar buys cooking or brewing this. Pairs with 'Mats to Buy (10k Focus)'; leftover focus is dropped." data-i18n-title="total_profit_from_spending_a_full_10_000_foc_3" data-i18n="profit_10k_focus">Profit / 10k Focus</th>
          <th data-sort="focusMats" class="sortable" title="Ingredients to buy for a full 10,000 focus of cooking or brewing = crafts per 10k focus × ingredients per craft, net of the focus return rate." data-i18n-title="total_quantity_of_ingredients_to_buy_to_spen" data-i18n="mats_to_buy_10k_focus">
            Mats to Buy (10k Focus)
          </th>
          <th data-sort="profitPerFocus" class="sortable" title="Silver the FOCUS buys on this row at your ⚙ Specs levels, not the craft's whole profit — the Best Focus winner's extra ingredient value, per focus point." data-i18n-title="net_silver_earned_per_focus_point_spent_cook" data-i18n="silver_focus">Silver/Focus</th>
          <th data-sort="bestFocus" class="sortable" title="Which focus play leaves this consumable most profitable. Ingredients are bought, so only the cook/brew step (or a chain craft) can take focus." data-i18n-title="which_focus_spending_leaves_this_consumable_" data-i18n="best_focus">Best Focus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="12" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="artifact_rolling">Artifact Rolling</span>
      <button id="scan-rolling-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Artifact Rolling table only — fetches fragment &amp; artifact prices and recomputes roll-cost vs. sell margins." data-i18n-title="scan_the_artifact_rolling_table_only_fetches" data-i18n="scan_rolling">Scan Rolling</button>
      <input id="search-rolling-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. relic" data-i18n-ph="filter_e_g_relic" />
    </h2>

    <table id="rolling-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="Melding at the Artifact Foundry turns fragments into a RANDOM artifact. Rows group by fragment type and tier; the badge is the advice — ✓ sell, ↩ reroll, ♻ salvage, ⊘ skip." data-i18n="roll_type_artifact" data-i18n-title="melding_at_the_artifact_foundry_turns_runes_">Roll Type / Artifact</th>
          <th title="Cheapest city to buy the fragments this meld consumes, with price age and 24h volume. Click a price to override it." data-i18n="fragment_buy" data-i18n-title="cheapest_city_to_buy_the_fragments_this_meld">Fragment — Buy</th>
          <th data-sort="cost" class="sortable" title="One meld = fragments per roll × fragment price + a 2.5% setup fee. A reroll costs that again, minus the 10 fragments salvaging gives back." data-i18n="roll_cost" data-i18n-title="silver_for_one_meld_fragments_per_roll_fragm">Roll Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price found for this specific artifact across the allowed cities (sell orders first, falling back to buy orders). Click to override." data-i18n="artifact_sell_price" data-i18n-title="best_sell_price_found_for_this_specific_arti">Artifact Sell Price</th>
          <th data-sort="margin" class="sortable" title="Artifact row: (net sale − roll cost) ÷ roll cost, if that artifact drops. Group header: expected campaign profit ÷ expected spend, rerolls included." data-i18n="margin_2" data-i18n-title="on_an_artifact_row_net_sale_roll_cost_roll_c">Margin %</th>
          <th data-sort="profit" class="sortable" title="Artifact row: net sale − roll cost, if that artifact drops. Group header: silver per FRAGMENT of melding instead of selling, after every expected reroll." data-i18n="pure_profit" data-i18n-title="on_an_artifact_row_single_outcome_payout_net">Pure Profit</th>
          <th title="Where to sell the artifact when the advice is ✓ sell. Blank when the optimal play is to reroll, salvage or skip." data-i18n="sell" data-i18n-title="where_to_sell_the_artifact_when_the_advice_i">Sell</th>
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
