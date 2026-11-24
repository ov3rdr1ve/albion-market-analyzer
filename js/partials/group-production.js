// Markup of the "production" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-production" data-group="production">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_production">Gathering &amp; Production</span>
        <span class="tgroup-sub" data-i18n="group_production_sub">Harvesting, farms, animals, laborers and journals</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span data-i18n="gathering_most_profitable_to_harvest">Gathering (Most Profitable to Harvest)</span>
      <button id="scan-gathering-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Gathering table only — fetches raw-resource, fish, seaweed, tracking remains &amp; Shapeshifter artifact prices and recomputes silver/kg &amp; silver/hour for every gathering activity." data-i18n-title="scan_the_gathering_table_only_fetches_raw_re" data-i18n="scan_gathering">Scan Gathering</button>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="gathering_desc">
      One row per activity × tier (T2–T8). Silver/kg and Silver/Hour are all-in — enchanted drops, biome rare fish and tracking loot are folded straight into the number.
    </small>
      <input id="search-gathering-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. fish, rare, ore" data-i18n-ph="filter_e_g_fish_rare_ore" />
    </h2>
    <table id="gathering-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The raw resource gathered." data-i18n="resource" data-i18n-title="the_raw_resource_gathered">Resource</th>
          <th data-sort="tier" class="sortable" title="Resource tier, with the enchantment level after the dot." data-i18n="tier" data-i18n-title="resource_tier_with_the_enchantment_level_aft">Tier</th>
          <th data-sort="sellPrice" class="sortable" title="Best sell price for one unit on your sell leg." data-i18n="sell_unit" data-i18n-title="best_sell_price_for_one_unit_on_your_sell_le">Sell / Unit</th>
          <th data-sort="netPerUnit" class="sortable" title="Sell price after the 6.5% market tax (no buy-side cost — you gather for free)" data-i18n-title="sell_price_after_the_6_5_market_tax_no_buy_s" data-i18n="net_unit">Net / Unit</th>
          <th data-sort="weight" class="sortable" title="Weight of one unit. Mined/quarried resources use 0.1 × 1.5^tier; fish carry their real (lighter) in-game weight, seaweed is a flat 1 kg." data-i18n-title="weight_of_one_unit_mined_quarried_resources_" data-i18n="weight">Weight</th>
          <th data-sort="silverPerKg" class="sortable" title="All-in net silver per unit ÷ weight — haul efficiency for weight-limited mounts and bags. The bonus drops are folded in; Quarrying has none." data-i18n-title="all_in_net_silver_per_unit_weight_haul_effic" data-i18n="silver_kg">Silver / kg</th>
          <th data-sort="unitsPerHour" class="sortable" title="Estimated units gathered per hour at this tier — it falls as the tier rises. Fishing uses its minigame rate; Tracking is kills/hour × remains/kill." data-i18n-title="estimated_units_gathered_per_hour_at_this_ti" data-i18n="units_h_est">Units / h (est.)</th>
          <th data-sort="silverPerHour" class="sortable" title="All-in net silver per unit × estimated units/hour — the headline for comparing activities. Enchanted drops, rare fish and tracking loot are folded in." data-i18n-title="all_in_net_silver_per_unit_estimated_units_h" data-i18n="silver_hour_est">Silver / Hour (est.)</th>
          <th data-sort="journalExtraPerHour" class="sortable" title="Best journal to fill while gathering here, as extra silver/hour = silver-per-fame × your base fame/hour. A journal fills from its own tier up to +2." data-i18n-title="best_journal_to_fill_while_doing_this_activi" data-i18n="best_journal_est">Best Journal (est.)</th>
          <th data-sort="laborerPerHour" class="sortable" title="Fill this journal yourself and feed it to a laborer; it comes back empty. Gross silver per HOUR of gathering, assuming a T8 laborer. ×N = laborers kept fed." data-i18n-title="what_that_same_journal_is_worth_handed_to_a_" data-i18n="feed_a_laborer">Feed a Laborer</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="11" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="farming">Farming</span>
      <button id="scan-farming-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Farming table only — fetches seed/baby &amp; output prices and recomputes profit per grow cycle and per day." data-i18n-title="scan_the_farming_table_only_fetches_seed_bab" data-i18n="scan_farming">Scan Farming</button>
      <button type="button" class="spec-settings-btn" data-spec-scope="farming-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <input id="search-farming-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. carrot" data-i18n-ph="filter_e_g_carrot" />
    </h2>
    <table id="farming-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The crop, herb or animal this plot grows." data-i18n="item" data-i18n-title="the_crop_herb_or_animal_this_plot_grows">Item</th>
          <th data-sort="route" class="sortable" title="Where the seed or baby is bought and where the harvest is sold." data-i18n="route_buy_sell" data-i18n-title="where_the_seed_or_baby_is_bought_and_where_t">Route (Buy → Sell)</th>
          <th data-sort="bonusCity" class="sortable" title="City whose farming bonus applies: +10% PRODUCT yield, never seed yield." data-i18n="bonus_city" data-i18n-title="city_whose_farming_bonus_applies_10_product_">Bonus City</th>
          <th data-sort="cost" class="sortable" title="What one seed or baby costs on your buy leg." data-i18n="seed_baby" data-i18n-title="what_one_seed_or_baby_costs_on_your_buy_leg">Seed / Baby</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for one harvested unit on your sell leg." data-i18n="output" data-i18n-title="best_sell_price_for_one_harvested_unit_on_yo">Output</th>
          <th data-sort="cycleHours" class="sortable" title="Real hours one cycle takes, from planting to harvest." data-i18n="cycle" data-i18n-title="real_hours_one_cycle_takes_from_planting_to_">Cycle</th>
          <th data-sort="totalSeedYield" class="sortable" title="Units one cycle returns, seeds given back included. A seed yields 3-6 crops, 6-12 with Premium." data-i18n="yield_cycle" data-i18n-title="units_one_cycle_returns_seeds_given_back_inc">Yield / Cycle</th>
          <th data-sort="margin" class="sortable" title="Profit ÷ what the cycle costs to start." data-i18n="margin" data-i18n-title="profit_what_the_cycle_costs_to_start">Margin</th>
          <th data-sort="profitPerCycle" class="sortable" title="Profit of one harvest cycle at the chosen farm city. Line two is the same cycle farmed on the other side of the +10% city bonus; the gap is what the bonus is worth. Sorting follows line one." data-i18n-title="profit_of_one_harvest_cycle_at_the_chosen_fa" data-i18n="profit_cycle">Profit / Cycle</th>
          <th data-sort="profitPerDay" class="sortable" title="Profit / Cycle extrapolated over 24h. Line two is the same cycle farmed on the other side of the +10% city bonus. Sorting follows line one." data-i18n-title="profit_cycle_extrapolated_over_24h_the_secon" data-i18n="profit_day">Profit / Day</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Profit per harvest cycle (after seed costs) × the whole cycles a 10,000 focus bar waters or nurtures. Always prices the watered cycle, so it does not move with the Use Focus checkbox." data-i18n="profit_10k_focus" data-i18n-title="profit_per_harvest_cycle_the_whole_cycles_a_">Profit / 10k Focus</th>
          <th data-sort="focusMats" class="sortable" title="Seeds a full 10,000 focus bar plants (9 slots per cycle). Line two: seeds to buy at the return Use Focus gives — watered re-seeds itself, dry does not." data-i18n-title="seeds_a_full_10_000_focus_bar_plants_the_who" data-i18n="seeds_to_plant_10k_focus">
            Seeds to Plant (10k Focus)
          </th>
          <th data-sort="profitPerFocus" class="sortable" title="Silver the FOCUS buys on this row, per focus point — the Best Focus winner ÷ its focus cost, not the cycle's whole profit." data-i18n-title="silver_the_focus_itself_buys_on_this_row_per" data-i18n="silver_focus_2">Silver / Focus</th>
          <th data-sort="bestFocus" class="sortable" title="Which focus play leaves this harvest most profitable, and what it adds per cycle: watering on a crop or herb plot, nurturing on a pasture animal." data-i18n-title="which_focus_spending_leaves_this_row_s_harve" data-i18n="best_focus">Best Focus</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="15" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="breeding_mounts">Breeding & Mounts</span>
      <button id="scan-mounts-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Breeding &amp; Mounts table only — fetches baby, mount &amp; material prices and recomputes breeding and mount-craft profit." data-i18n-title="scan_the_breeding_mounts_table_only_fetches_" data-i18n="scan_mounts">Scan Mounts</button>
      <button type="button" class="spec-settings-btn" data-spec-scope="mounts-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <input id="search-mounts-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. ox" data-i18n-ph="filter_e_g_ox" />
    </h2>
    <table id="mounts-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The mount this row breeds or crafts." data-i18n="item" data-i18n-title="the_mount_this_row_breeds_or_crafts">Item</th>
          <th data-sort="route" class="sortable" title="Where the baby and the feed are bought, and where the finished mount is sold." data-i18n="route" data-i18n-title="where_the_baby_and_the_feed_are_bought_and_w">Route</th>
          <th data-sort="materials" class="sortable" title="Baby, feed and the saddler craft's inputs for one cycle." data-i18n="materials" data-i18n-title="baby_feed_and_the_saddler_craft_s_inputs_for">Materials</th>
          <th data-sort="cost" class="sortable" title="Baby plus feed plus saddler materials for one cycle, net of the return rate." data-i18n="cost" data-i18n-title="baby_plus_feed_plus_saddler_materials_for_on">Cost</th>
          <th data-sort="revenue" class="sortable" title="Best sell price for the saddled mount on your sell leg." data-i18n="sell" data-i18n-title="best_sell_price_for_the_saddled_mount_on_you">Sell</th>
          <th data-sort="margin" class="sortable" title="Profit ÷ Cost." data-i18n="margin" data-i18n-title="profit_cost">Margin</th>
          <th data-sort="profit" class="sortable" title="Sale minus inputs, plus the baby the cycle returns: the base offspring chance always, the nurtured slice with Use Focus on. A fully nurtured common animal passes 100% — that surplus is a second baby." data-i18n-title="profit_incl_offspring_chance" data-i18n="profit_2">Profit</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Craft: profit per craft (after mat costs) × the crafts a 10,000 focus bar buys. Breeding: only the extra profit focus adds (nurtured offspring × nurtured babies). Pairs with 'Mats / 10k Focus'." data-i18n-title="total_profit_from_spending_a_full_10_000_foc_4" data-i18n="profit_10k_focus">Profit / 10k Focus</th>
          <th data-sort="nurtureEv" class="sortable" title="Cycle profit plus the WHOLE offspring chance, base + nurtured. Profit already carries whatever the Use Focus checkbox allows, so this reads — when focus is on." data-i18n-title="expected_value_including_focus_nurture_offsp" data-i18n="ev_w_nurture">EV w/ Nurture</th>
          <th data-sort="focusMats" class="sortable" title="Feed to buy for a full 10,000 focus of nurturing = nurture cycles per 10k focus × feed pieces per cycle." data-i18n-title="total_feed_to_buy_to_spend_a_full_10_000_foc" data-i18n="mats_10k_focus">Mats / 10k Focus</th>
          <th data-sort="profitPerFocus" class="sortable" title="Silver the FOCUS buys on this row at your ⚙ Specs levels, not its whole profit — the Best Focus winner (nurture, or the saddler craft) per focus point." data-i18n-title="net_silver_per_focus_point_spent_nurturing_o" data-i18n="sil_focus">Sil/Focus</th>
          <th data-sort="bestFocus" class="sortable" title="Which focus play leaves this mount most profitable, and what it adds: nurture the offspring, or focus the saddler craft. A crafted mount can only focus the craft." data-i18n-title="which_focus_spending_leaves_this_row_s_finis_2" data-i18n="best_focus">Best Focus</th>
          <th data-sort="silverPerFp" class="sortable" title="Net profit ÷ total FP outlay (baby + hearts) when nurtured & saddled" data-i18n-title="net_profit_total_fp_outlay_baby_hearts_when_" data-i18n="s_fp_breed">S/FP (Breed)</th>
          <th data-sort="babyRawSilverPerFp" class="sortable" title="Net silver from selling the baby raw ÷ baby FP cost (3K T5 / 15K T8) — skip breeding entirely" data-i18n-title="net_silver_from_selling_the_baby_raw_baby_fp" data-i18n="s_fp_raw">S/FP (Raw)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="15" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="laborers_all_modes">Laborers (All Modes)</span>
      <button id="scan-laborers-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Laborers table only — fetches journal/contract &amp; payload prices and recomputes profit per cycle and T8 breakeven." data-i18n-title="scan_the_laborers_table_only_fetches_journal" data-i18n="scan_laborers">Scan Laborers</button>
      <label
        style="color:#9ca3af;font-size:0.9rem;font-weight:normal;display:flex;align-items:center;gap:4px"
        title="General trophies (any laborer), 5 each; 40 = all 8 placed. The only kind a crafting laborer takes, so those cap at 120% on their own tier. Each point = +0.5% yield." data-i18n-title="happiness_from_general_trophies_5_each_the_o"
      >
        <span data-i18n="general_trophies_label">General trophies: +</span>
        <input
          type="number"
          id="laborer-happiness-general"
          min="0"
          max="40"
          step="5"
          style="width:52px;background:#1f2937;color:#e5e7eb;border:1px solid #3e5e82;padding:2px 4px;font-size:0.85rem;border-radius:3px"
        />
      </label>
      <label
        style="color:#9ca3af;font-size:0.9rem;font-weight:normal;display:flex;align-items:center;gap:4px"
        title="Own-type trophies (wood, ore, hide, fishing, …), 10 each; 70 = T2-T8 all placed. Crafting laborers have no such trophy, so this box does not move them." data-i18n-title="happiness_from_trophies_of_the_laborer_s_own"
      >
        <span data-i18n="matching_trophies_label">Matching trophies: +</span>
        <input
          type="number"
          id="laborer-happiness-matching"
          min="0"
          max="70"
          step="10"
          style="width:52px;background:#1f2937;color:#e5e7eb;border:1px solid #3e5e82;padding:2px 4px;font-size:0.85rem;border-radius:3px"
        />
      </label>
      <label
        style="color:#9ca3af;font-size:0.9rem;font-weight:normal;display:flex;align-items:center;gap:4px"
        title="The house your laborers live in. A building holds furniture of its own tier or lower, so a T6 house has no T7 or T8 trophy to place — the two boxes above are capped by it." data-i18n-title="the_house_your_laborers_live_in_a_building_h"
      >
        <span data-i18n="house_tier_label">House:</span>
        <select
          class="house-tier-select"
          id="house-tier-laborers"
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
      <span id="laborer-happiness-note" style="color:#6b7280;font-size:0.8rem;font-weight:normal"></span>
      <input id="search-laborers-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. mercenary" data-i18n-ph="filter_e_g_mercenary" />
    </h2>
    <table id="laborers-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The laborer, and what its journal or item output is." data-i18n="laborer" data-i18n-title="the_laborer_and_what_its_journal_or_item_out">Laborer</th>
          <th data-sort="mode" class="sortable" title="What the laborer produces from a filled journal: Resource (raw resources), Trophy (a Trophy item), Crafting (refined/crafted goods), or Mercenary (untaxed silver)." data-i18n-title="what_the_laborer_produces_from_a_filled_jour" data-i18n="mode">Mode</th>
          <th data-sort="route" class="sortable" title="Where to buy the filled journal vs. where the laborer runs and the payload is sold. One cycle ≈ 22h." data-i18n-title="where_to_buy_the_filled_journal_vs_where_the" data-i18n="route">Route</th>
          <th data-sort="cost" class="sortable" title="Market PRICE of one filled journal (click to override). The cost charged against profit is this price + 2.5% setup fee, and it is the only up-front cost per cycle." data-i18n-title="cost_to_buy_one_filled_journal_for_this_cycl" data-i18n="filled_cost">Filled Cost</th>
          <th data-sort="revenue" class="sortable" title="What one filled journal's payload is worth. Trophy rows show the trophy's UNIT price (click to override); other modes show per-cycle silver after tax." data-i18n-title="gross_revenue_silver_the_cycle_s_payload_sel" data-i18n="payload_cycle">Payload / Cycle</th>
          <th data-sort="emptyRevenue" class="sortable" title="Market PRICE of the emptied journal the laborer hands back (click to override). Market tax is taken off it before it is added on top of Payload revenue." data-i18n-title="silver_from_selling_the_emptied_journal_back" data-i18n="empty_sell">Empty Sell</th>
          <th data-sort="profit" class="sortable" title="Payload revenue + empty-journal sale − filled-journal cost, with Margin % of the filled cost under it. Hover for the arithmetic; click to change the sell city." data-i18n-title="net_silver_you_pocket_per_cycle_payload_cycl" data-i18n="profit_cycle">Profit / Cycle</th>
          <th data-sort="journalPlay" class="sortable" title="Two plays, different units — never compare them. Top: self-fill, silver per HOUR of gathering, net of the fame's sale value. Bottom: buy filled, per 22h cycle." data-i18n-title="the_two_ways_to_work_this_laborer_each_price" data-i18n="best_journal_play">Best Journal Play</th>
          <th data-sort="contractBuyCost" class="sortable" title="Market price of a pre-leveled contract at THIS ROW'S TIER. Click to override; your value feeds the Best Leveling Path. Breakeven always uses the T8 price." data-i18n-title="market_price_of_a_pre_leveled_contract_for_t" data-i18n="buy_contract">Buy Contract</th>
          <th data-sort="levelingPathProfit" class="sortable" title="Best leveling path: take a contract at the start tier, level it on this mode's journals, sell at the best end tier. Net of leveling cost and tax, all tier combos." data-i18n-title="most_profitable_leveling_path_acquire_a_cont" data-i18n="best_leveling_path">Best Leveling Path</th>
          <th data-sort="breakevenCycles" class="sortable" title="Cycles needed to recoup the T8 buy cost via this row's per-cycle profit (1 cycle ≈ 22h)" data-i18n-title="cycles_needed_to_recoup_the_t8_buy_cost_via_" data-i18n="breakeven">Breakeven</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="12" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span data-i18n="journal_filling_best_tier_type_to_fill">Journal Filling (Best Tier &amp; Type to Fill)</span>
      <button id="scan-journals-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Journal Filling table only — fetches empty &amp; full journal prices for every gathering, trophy and General journal and recomputes Silver / 1k Fame." data-i18n-title="scan_the_journal_filling_table_only_fetches_" data-i18n="scan_journals">Scan Journals</button>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="journal_desc">
      Buy an empty journal, fill it with fame you earn anyway, sell it full. Profit = full sell (after 6.5% tax) − empty buy; ranked by Silver / 1k Fame.
    </small>
      <input id="search-journal-filling-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. ore, trophy, T8" data-i18n-ph="filter_e_g_ore_trophy_t8" />
    </h2>
    <table id="journal-filling-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The journal being filled, by its craft or gathering family." data-i18n="journal" data-i18n-title="the_journal_being_filled_by_its_craft_or_gat">Journal</th>
          <th data-sort="tier" class="sortable" title="Journal tier. The fame it accepts comes from a window of item tiers around it." data-i18n="tier" data-i18n-title="journal_tier_the_fame_it_accepts_comes_from_">Tier</th>
          <th data-sort="type" class="sortable" title="Gathering = resource journal (laborer turns it into raw resources); Trophy = trophy journal (laborer turns it into a Trophy); General = General Trophy, which fills from ANY fame." data-i18n-title="gathering_resource_journal_laborer_turns_it_" data-i18n="type">Type</th>
          <th data-sort="emptyCost" class="sortable" title="Cost to BUY one empty journal (the input you fill with fame)." data-i18n-title="cost_to_buy_one_empty_journal_the_input_you_" data-i18n="empty_buy">Empty Buy</th>
          <th data-sort="fullGross" class="sortable" title="Price to SELL one full journal (before the 6.5% market tax)." data-i18n-title="price_to_sell_one_full_journal_before_the_6_" data-i18n="full_sell">Full Sell</th>
          <th data-sort="journalMargin" class="sortable" title="Full sell after 6.5% tax − empty buy. The silver you net per journal filled." data-i18n-title="full_sell_after_6_5_tax_empty_buy_the_silver" data-i18n="margin">Margin</th>
          <th data-sort="fameToFill" class="sortable" title="Base fame needed to fill the journal (items.xml maxfame). Premium bonus fame does not count." data-i18n-title="base_fame_needed_to_fill_the_journal_items_x" data-i18n="fame_to_fill">Fame to Fill</th>
          <th data-sort="silverPer1kFame" class="sortable" title="Margin ÷ fame-to-fill × 1,000 — the headline ranking. Higher = each point of gathering fame is worth more." data-i18n-title="margin_fame_to_fill_1_000_the_headline_ranki" data-i18n="silver_1k_fame">Silver / 1k Fame</th>
          <th data-sort="journalFillPerHour" class="sortable" title="Fill time at the journal's own tier, and the silver/hour it implies (margin ÷ hours). A journal fills from its own tier up to +2; outside that window, a dash." data-i18n-title="how_long_this_journal_takes_to_fill_at_the_g" data-i18n="fill_speed_max_profit">Fill Speed / Max Profit</th>
          <th data-sort="laborerPerHour" class="sortable" title="Fill this journal yourself and feed it to a laborer; it comes back empty. Gross silver per HOUR of gathering, assuming a T8 laborer. ×N = laborers kept fed." data-i18n-title="what_that_same_journal_is_worth_handed_to_a_" data-i18n="feed_a_laborer">Feed a Laborer</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="11" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span data-i18n="building_costs">Building Costs</span>
      <button id="scan-buildings-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Building Costs table only — fetches the construction materials, laborer contracts and furniture every building needs." data-i18n-title="scan_the_building_costs_table_only_fetches_t" data-i18n="scan_buildings">Scan Buildings</button>
      <label style="font-size:0.8rem;font-weight:normal;color:#9ca3af;display:flex;align-items:center;gap:6px">
        <span data-i18n="laborer_label">Laborer:</span>
        <select id="buildings-laborer-select" style="font-size:0.8rem;padding:3px 6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:3px" title="Which laborer every row hires: it sets the contract bought per slot in the Laborers column and the trophy line the leftover slots take in the Furniture column. Remembered between sessions." data-i18n-title="buildings_laborer_pick">
          <option value="" data-i18n="cheapest_contract">Cheapest contract</option>
        </select>
      </label>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="buildings_desc">
      What owning a building costs at a given tier: the whole upgrade ladder from the family's lowest tier, priced from the game's buildings.xml. Hover a Total for the step-by-step breakdown.
    </small>
      <input id="search-buildings-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. guild hall, T8" data-i18n-ph="filter_e_g_guild_hall_t8" />
    </h2>
    <table id="buildings-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The building, priced furnished — the Total column includes its furniture." data-i18n="building" data-i18n-title="the_building_priced_furnished_the_total_colu">Building</th>
          <th data-sort="category" class="sortable" title="Station = crafting or refining building; House / Guild Hall = the buildings with laborer and furniture slots; Farm = farming plot; Hideout = the black-zone hideout." data-i18n="type" data-i18n-title="station_crafting_or_refining_building_house_">Type</th>
          <th data-sort="materials" class="sortable" title="Every upgrade step's materials from the family's lowest tier to this one, each priced at the cheapest city listing it. Prices are click-to-edit." data-i18n-title="every_upgrade_step_s_materials_rolled_up_fro" data-i18n="required_materials">Required Materials</th>
          <th data-sort="silverFee" class="sortable" title="The placement fee paid at every step of the upgrade ladder (plus the hideout's recipe silver), after the Global Discount the gold price sets." data-i18n-title="the_placement_fee_paid_at_every_step_of_the_" data-i18n="silver_fee">Silver Fee</th>
          <th data-sort="materialCost" class="sortable" title="Market cost of the whole rolled-up bill of materials." data-i18n-title="market_cost_of_the_whole_rolled_up_bill_of_m" data-i18n="material_cost">Material Cost</th>
          <th data-sort="laborers" class="sortable" title="Laborer slots the building has, filled with the contract chosen in the Laborer picker. Only houses and guild halls have slots." data-i18n-title="laborer_slots_the_building_has_filled_with_t" data-i18n="laborers">Laborers</th>
          <th data-sort="furniture" class="sortable" title="The furniture plan: one bed per laborer, one table per 4 laborers (6 from T5), leftover slots on trophies — one of each tier, cheapest first. Prices are click-to-edit." data-i18n-title="the_furnishing_plan_for_the_building_s_furni" data-i18n="furniture">Furniture</th>
          <th data-sort="journal" class="sortable" title="The journal tier this laborer is most profitably fed, from the Laborers table. Below the laborer's own tier it already yields the full 150%. Needs a scan." data-i18n-title="the_journal_tier_this_laborer_is_most_profit" data-i18n="best_journal">Best Journal</th>
          <th data-sort="selfFill" class="sortable" title="Silver per HOUR of your gathering when you fill this crew's journals yourself, net of what that fame could have sold for. Crafting crews are priced per craft." data-i18n-title="what_this_building_s_crew_turns_a_point_of_y" data-i18n="self_fill_rate">Self-Fill Rate</th>
          <th data-sort="totalCost" class="sortable" title="Everything this row buys from an empty plot: every upgrade step's fee and materials, plus contracts and furniture (counted once, at this tier). Hover for the breakdown." data-i18n-title="everything_this_row_buys_from_an_empty_plot_" data-i18n="total_cost">Total Cost</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="11" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>
      </div>
    </section>
`);
