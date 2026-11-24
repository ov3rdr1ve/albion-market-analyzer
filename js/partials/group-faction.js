// Markup of the "faction" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-faction" data-group="faction">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_faction">Faction Warfare</span>
        <span class="tgroup-sub" data-i18n="group_faction_sub">Spending Faction Points and Favor</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 style="display:flex;align-items:center;gap:12px" title="Pure Faction-Point math (no market scan): given an FP budget, how many crests, hearts, and complete faction capes you can craft." data-i18n-title="pure_faction_point_math_no_market_scan_given">
      <span data-i18n="faction_point_calculator_fp_hearts_crests">Faction Point Calculator (FP → hearts &amp; crests)</span>
    </h2>
    <div class="fp-calc" data-collapse-key="fp-calc">
      <div class="fp-calc-controls">
        <label><span data-i18n="fp_budget_label">FP budget</span>
          <input id="fp-calc-budget" type="number" min="0" step="1000" value="200000" />
        </label>
        <label><span data-i18n="faction_word">Faction</span>
          <select id="fp-calc-city">
            <option value="THETFORD" data-i18n="thetford">Thetford</option>
            <option value="LYMHURST" data-i18n="lymhurst">Lymhurst</option>
            <option value="FORTSTERLING" data-i18n="fort_sterling">Fort Sterling</option>
            <option value="BRIDGEWATCH" data-i18n="bridgewatch">Bridgewatch</option>
            <option value="MARTLOCK" data-i18n="martlock">Martlock</option>
          </select>
        </label>
        <label><span data-i18n="tier">Tier</span>
          <select id="fp-calc-tier">
            <option value="4" data-i18n="tome_t4">T4 — Adept's</option>
            <option value="5" data-i18n="tome_t5">T5 — Expert's</option>
            <option value="6" data-i18n="tome_t6">T6 — Master's</option>
            <option value="7" data-i18n="tome_t7">T7 — Grandmaster's</option>
            <option value="8" selected data-i18n="tome_t8">T8 — Elder's</option>
          </select>
        </label>
      </div>
      <div id="fp-calc-result"></div>
    </div>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="faction_spending_fp_favor_silver">Faction Spending (FP / Favor → Silver)</span>
      <button id="scan-faction-spending-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Faction Spending table only — recomputes silver-per-Faction-Point (FP) and silver-per-Favor (Energy Manipulator) for everything you can buy." data-i18n-title="scan_the_faction_spending_table_only_recompu" data-i18n="scan_faction_spending">Scan Faction Spending</button>
      <label style="font-size:0.8rem;font-weight:normal;color:#9ca3af;display:flex;align-items:center;gap:6px">
        <span data-i18n="faction_label">Faction:</span>
        <select id="faction-spending-filter" style="font-size:0.8rem;padding:3px 6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:3px">
          <option value="" data-i18n="all_factions">All factions</option>
          <option value="Thetford" data-i18n="thetford">Thetford</option>
          <option value="Lymhurst" data-i18n="lymhurst">Lymhurst</option>
          <option value="Fort Sterling" data-i18n="fort_sterling">Fort Sterling</option>
          <option value="Bridgewatch" data-i18n="bridgewatch">Bridgewatch</option>
          <option value="Martlock" data-i18n="martlock">Martlock</option>
          <option value="Caerleon" data-i18n="caerleon">Caerleon</option>
          <option value="Brecilien" data-i18n="brecilien">Brecilien</option>
          <option value="Energy Manipulator" data-i18n="energy_manipulator">Energy Manipulator</option>
          <option value="Smuggler's Den" data-i18n="smugglers_den">Smuggler's Den</option>
          <option value="The Antiquarian" data-i18n="the_antiquarian">The Antiquarian</option>
        </select>
      </label>
      <button type="button" class="spec-settings-btn" data-spec-scope="faction-spending-table" title="Set your Destiny Board specialization levels for this table. Masteries start at 100 and specializations at 0; raising a level lowers the focus cost of what it covers." data-i18n-title="set_your_destiny_board_specialization_levels" data-i18n="specs">&#9881; Specs</button>
      <input id="search-faction-spending-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. baby" data-i18n-ph="filter_e_g_baby" />
    </h2>
    <table id="faction-spending-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The item bought with faction points." data-i18n="item" data-i18n-title="the_item_bought_with_faction_points">Item</th>
          <th data-sort="category" class="sortable" title="What the FP item is: a crest, a heart, a mount baby, a tome." data-i18n="category" data-i18n-title="what_the_fp_item_is_a_crest_a_heart_a_mount_">Category</th>
          <th data-sort="sellCity" class="sortable" title="City paying most for this item on your sell leg." data-i18n="best_city" data-i18n-title="city_paying_most_for_this_item_on_your_sell_">Best City</th>
          <th data-sort="fpCost" class="sortable" title="Cost in Faction Points (earned from faction warfare / enlistment) to buy this item from the Faction Enlistment NPC. Compare its silver-equivalent via the S/FP columns." data-i18n-title="cost_in_faction_points_earned_from_faction_w" data-i18n="fp_cost">FP Cost</th>
          <th data-sort="favorCost" class="sortable" title="Favor cost at the Energy Manipulator (150 Favor = 1 Siphoned Energy; Conqueror's Chest = 6,750)" data-i18n-title="favor_cost_at_the_energy_manipulator_150_fav" data-i18n="favor_cost">Favor Cost</th>
          <th data-sort="sellPrice" class="sortable" title="Best sell price per unit, and what one purchase yields." data-i18n="sell_yield" data-i18n-title="best_sell_price_per_unit_and_what_one_purcha">Sell / Yield</th>
          <th data-sort="netSilver" class="sortable" title="Net silver after market fees (4% premium tax + 2.5% setup fee)" data-i18n-title="net_silver_after_market_fees_4_premium_tax_2" data-i18n="net_silver">Net Silver</th>
          <th data-sort="silverPerFp" class="sortable" title="Silver/FP from selling/opening this item directly" data-i18n-title="silver_fp_from_selling_opening_this_item_dir" data-i18n="s_fp_direct">S/FP (Direct)</th>
          <th data-sort="silverPerFavor" class="sortable" title="Silver per Favor — Energy Manipulator rows (chest, Runes/Souls/Relics, combat mounts)" data-i18n-title="silver_per_favor_energy_manipulator_rows_che" data-i18n="s_favor">S/Favor</th>
          <th data-sort="breedSilverPerFp" class="sortable" title="For Baby rows: silver/FP if you instead nurture & saddle the baby. Other rows N/A." data-i18n-title="for_baby_rows_silver_fp_if_you_instead_nurtu" data-i18n="s_fp_bred">S/FP (Bred)</th>
          <th data-sort="fpFocusPer10k" class="sortable" title="Profit from a full 10,000-focus bar when the FP-bought item is USED, not resold (babies bred &amp; saddled) — the baby costs 0 silver. Hearts and other items show a dash." data-i18n-title="profit_from_a_full_10000_focus_bar_when_the_" data-i18n="profit_per_10k_focus_fp">Profit / 10k Focus (FP inputs)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="12" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>
      </div>
    </section>
`);
