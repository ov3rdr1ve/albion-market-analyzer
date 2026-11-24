// Markup of the "market" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-market" data-group="market">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_market">Market &amp; Trading</span>
        <span class="tgroup-sub" data-i18n="group_market_sub">Live prices, flips, fees and traded volume</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <!-- ── Gold Price chart ─────────────────────────────────────────────────
         Server-wide gold price (AODP /stats/gold) rendered with TradingView
         Lightweight Charts + our own technical indicators. Heading is a styled
         <div> (not <h2>) on purpose: the h2 auto-collapse wiring binds a
         heading to the next <table>, and this section has no table. -->
    <div id="gold-chart-section" style="margin: 8px 0 16px">
      <div id="gold-collapse-toggle" class="section-title" style="display:flex;align-items:center;gap:12px;font-size:1.2rem;font-weight:bold;color:#f3f4f6;margin-bottom:0.5rem;padding-bottom:0.25rem;border-bottom:1px solid #374151;cursor:pointer;user-select:none">
        <span data-i18n="gold_price_chart">Gold Chart</span>
        <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="gold_intro">
          Server-wide gold/silver exchange rate with technical indicators — uses the selected region above
        </small>
        <span id="gold-collapse-indicator" style="font-size:0.75rem;color:#9ca3af;font-weight:400;margin-left:8px"> ▼</span>
      </div>

      <div id="gold-chart-body">
      <div class="gold-controls" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;background:#26272b;padding:10px;border-radius:8px;margin-bottom:8px;font-size:0.85rem;color:#e5e7eb">
        <!-- Interval buttons (candle width) — TradingView-style. Source data is
             hourly, so 1h is the finest resolution possible. -->
        <div id="gold-interval-group" style="display:inline-flex;gap:2px;background:#1b1c1f;border:1px solid #3a3d44;border-radius:5px;padding:2px">
          <button class="gold-tf-btn" data-interval="3600" data-i18n="1h">1h</button>
          <button class="gold-tf-btn" data-interval="14400" data-i18n="4h">4h</button>
          <button class="gold-tf-btn" data-interval="43200" data-i18n="12h">12h</button>
          <button class="gold-tf-btn" data-interval="86400" data-i18n="1d">1D</button>
        </div>

        <label style="display:inline-flex;align-items:center;gap:5px">
          <span style="color:#9ca3af" data-i18n="range_label">Range:</span>
          <select id="gold-range" style="font-size:0.85rem;padding:3px 6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:3px">
            <option value="72" data-i18n="range_3_days">3 days</option>
            <option value="168" data-i18n="range_7_days">7 days</option>
            <option value="336" data-i18n="range_14_days">14 days</option>
            <option value="720" selected data-i18n="range_30_days_max">30 days (max)</option>
          </select>
        </label>

        <label style="display:inline-flex;align-items:center;gap:5px">
          <span style="color:#9ca3af" data-i18n="style_label">Style:</span>
          <select id="gold-style" style="font-size:0.85rem;padding:3px 6px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:3px">
            <option value="candles" selected data-i18n="chart_style_candles">Candles</option>
            <option value="line" data-i18n="chart_style_line">Line</option>
          </select>
        </label>

        <button id="gold-ind-toggle" title="Configure indicators" style="margin-left:8px;background:#1f2937;color:#e5e7eb;border:1px solid #4b5563;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:0.85rem" data-i18n-title="configure_indicators" data-i18n="indicators">⚙ Indicators</button>
        <button id="gold-load-btn" class="primary-btn" title="Re-fetch gold price history for the selected region" data-i18n-title="re_fetch_gold_price_history_for_the_selected" data-i18n="reload">↻ Reload</button>

        <span id="gold-status" style="margin-left:auto;color:#9ca3af;font-size:0.8rem"></span>
      </div>

      <!-- What the live gold price is doing to every silver cost in the app.
           Populated by js/render-global-discount.js. -->
      <div id="global-discount-readout" style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;background:#26272b;padding:8px 10px;border-radius:8px;margin-bottom:8px;font-size:0.8rem"></div>

      <!-- Indicator settings panel — populated by render-gold-chart.js, hidden by default. -->
      <div id="gold-ind-panel" style="display:none;background:#1f2023;border:1px solid #3a3d44;border-radius:8px;padding:12px;margin-bottom:8px;font-size:0.82rem;color:#e5e7eb"></div>

      <div id="gold-chart" style="width:100%;height:520px;background:#1b1c1f;border:1px solid #2d2f34;border-radius:8px"></div>
      <div id="gold-legend" style="display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;font-size:0.72rem;color:#9ca3af"></div>
      </div>
    </div>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="fees_calculator">Fees Calculator</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="fc_intro">
        Enter buy / sell price + quantity to see net silver after Albion market fees
      </small>
    </h2>
    <div id="fees-calculator" class="fees-calculator">
      <div class="fc-row">
        <label class="fc-field fc-field-wide">
          <span data-i18n="item_note">Item / Note</span>
          <input type="text" id="fc-name" placeholder="e.g. T6 Bag" data-i18n-ph="e_g_t6_bag" maxlength="60" />
        </label>
        <label class="fc-field fc-field-wide">
          <span data-i18n="city_route">City / Route</span>
          <input type="text" id="fc-city" placeholder="e.g. Martlock → Caerleon" data-i18n-ph="e_g_martlock_caerleon" maxlength="60" />
        </label>
      </div>
      <div class="fc-row">
        <label class="fc-field">
          <span data-i18n="buy_price">Buy Price</span>
          <input type="number" id="fc-buy-price" min="0" step="1" placeholder="e.g. 5000" data-i18n-ph="e_g_5000" />
        </label>
        <span class="fc-mode" role="radiogroup" aria-label="Buy order type">
          <label><input type="radio" name="fc-buy-mode" id="fc-buy-instant" value="instant" /> <span data-i18n="fc_instant">Instant</span></label>
          <label><input type="radio" name="fc-buy-mode" id="fc-buy-market" value="market" checked /> <span data-i18n="fc_market_order">Market Order</span></label>
        </span>
      </div>
      <div class="fc-row">
        <label class="fc-field">
          <span data-i18n="sell_price">Sell Price</span>
          <input type="number" id="fc-sell-price" min="0" step="1" placeholder="e.g. 6500" data-i18n-ph="e_g_6500" />
        </label>
        <span class="fc-mode" role="radiogroup" aria-label="Sell order type">
          <label><input type="radio" name="fc-sell-mode" id="fc-sell-instant" value="instant" /> <span data-i18n="fc_instant">Instant</span></label>
          <label><input type="radio" name="fc-sell-mode" id="fc-sell-market" value="market" checked /> <span data-i18n="fc_market_order">Market Order</span></label>
        </span>
      </div>
      <div class="fc-row">
        <label class="fc-field">
          <span data-i18n="quantity">Quantity</span>
          <input type="number" id="fc-quantity" min="0" step="1" value="1" />
        </label>
        <span class="fc-mode">
          <label><input type="checkbox" id="fc-premium" checked /> <span data-i18n="fc_premium_label">Premium (4% tax, else 8%)</span></label>
        </span>
        <span class="fc-actions">
          <button type="button" id="fc-save-row" class="fc-action-btn fc-save" data-i18n="save_row">+ Save Row</button>
          <button type="button" id="fc-clear-form" class="fc-action-btn" data-i18n="clear_form">Clear Form</button>
        </span>
      </div>

      <div class="fc-results">
        <div class="fc-result">
          <div class="fc-result-label" data-i18n="total_buy_cost">Total Buy Cost</div>
          <div id="fc-buy-cost" class="fc-result-value">0 silver</div>
          <div id="fc-buy-detail" class="fc-result-detail">gross 0 (no fees — instant buy)</div>
        </div>
        <div class="fc-result">
          <div class="fc-result-label" data-i18n="net_sell_revenue">Net Sell Revenue</div>
          <div id="fc-sell-revenue" class="fc-result-value">0 silver</div>
          <div id="fc-sell-detail" class="fc-result-detail">gross 0 − tax 0 (4%)</div>
        </div>
        <div class="fc-result fc-result-net">
          <div class="fc-result-label" data-i18n="net_profit">Net Profit</div>
          <div id="fc-net-profit" class="fc-result-value">+0 silver</div>
          <div class="fc-result-detail">
            <span data-i18n="fc_per_item">per item</span> <span id="fc-profit-per-item" class="fc-inline-value">—</span>
            · <span data-i18n="fc_margin">margin</span> <span id="fc-margin" class="fc-inline-value">—</span>
          </div>
        </div>
      </div>

      <div class="fc-saved-wrap">
        <div class="fc-saved-header">
          <h3 class="fc-saved-title"><span data-i18n="saved_trades">Saved Trades</span> <span id="fc-saved-count" class="fc-saved-count">(0)</span></h3>
          <button type="button" id="fc-clear-all" class="fc-action-btn fc-danger" hidden data-i18n="clear_all">Clear All</button>
        </div>
        <div class="fc-saved-table-wrap">
          <table id="fc-saved-table" class="data-table fc-saved-table">
            <thead>
              <tr>
                <th data-i18n="item_note">Item / Note</th>
                <th data-i18n="city_route">City / Route</th>
                <th data-i18n="buy">Buy</th>
                <th data-i18n="sell">Sell</th>
                <th data-i18n="qty">Qty</th>
                <th title="Buy mode / Sell mode (I=Instant, M=Market Order)" data-i18n-title="buy_mode_sell_mode_i_instant_m_market_order" data-i18n="mode">Mode</th>
                <th data-i18n="buy_cost">Buy Cost</th>
                <th title="What the sale brings in: sell price × qty minus the sales tax and 2.5% setup fee. Your buy cost is NOT subtracted here — see Net Profit." data-i18n-title="what_the_sale_brings_in_sell_price_qty_minus" data-i18n="net_revenue">Net Revenue</th>
                <th title="Net Revenue − Buy Cost (buy cost includes its own 2.5% setup fee) — the actual silver you keep after all market fees." data-i18n-title="net_revenue_buy_cost_buy_cost_includes_its_o" data-i18n="net_profit">Net Profit</th>
                <th data-i18n="margin">Margin</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="fc-saved-tbody">
              <tr>
                <td colspan="11" class="fc-saved-empty">No saved trades yet — fill in the calculator and click "+ Save Row".</td>
              </tr>
            </tbody>
            <tfoot id="fc-saved-tfoot"></tfoot>
          </table>
        </div>
      </div>
    </div>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="top_10_pure_profit">Top 10 Pure Profit</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem">
        <span data-i18n="top_profit_subtitle">The ten biggest silver profits across every scanned table — one play each</span>
      </small>
      <input id="search-joined-summary-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. crafting" data-i18n-ph="filter_e_g_crafting" />
    </h2>
    <table id="joined-summary-table" class="data-table">
      <thead>
        <tr>
          <th data-sort="category" class="sortable" data-i18n="category">Category</th>
          <th data-sort="name" class="sortable" data-i18n="item_route">Item / Route</th>
          <th data-sort="route" class="sortable" data-i18n="route">Route</th>
          <th data-sort="cost" class="sortable" data-i18n="input_cost">Input Cost</th>
          <th data-sort="revenue" class="sortable" data-i18n="best_sell_price">Best Sell Price</th>
          <th data-sort="margin" class="sortable" data-i18n="profit">Profit %</th>
          <th data-sort="profit" class="sortable" data-i18n="pure_profit">Pure Profit</th>
          <th data-sort="throughput" class="sortable" title="Pure Profit × Daily Volume — silver throughput potential" data-i18n-title="pure_profit_daily_volume_silver_throughput_p" data-i18n="throughput">Throughput</th>
          <th data-sort="dailyVol" class="sortable" data-i18n="sell_vol_24h">Sell Vol (24h)</th>
          <th data-i18n="jump">Jump</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="10" style="text-align:center;color:#9ca3af;font-style:italic">
            <span data-i18n="run_scan_to_populate">Run "Scan Market Now" to populate top opportunities</span>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="top_10_profit_10k_focus">Top 10 Profit / 10k Focus</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem">
        <span data-i18n="top_focus_subtitle">The ten best uses of a focus bar — Crafting, Refining, Consumables, Farming and Mounts, the five tables that spend focus</span>
      </small>
      <input id="search-joined-focus-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. crafting" data-i18n-ph="filter_e_g_crafting" />
    </h2>
    <table id="joined-focus-table" class="data-table">
      <thead>
        <tr>
          <th data-sort="category" class="sortable" data-i18n="category">Category</th>
          <th data-sort="name" class="sortable" data-i18n="item_route">Item / Route</th>
          <th data-sort="route" class="sortable" data-i18n="route">Route</th>
          <th data-sort="cost" class="sortable" data-i18n="input_cost">Input Cost</th>
          <th data-sort="revenue" class="sortable" data-i18n="best_sell_price">Best Sell Price</th>
          <th data-sort="margin" class="sortable" data-i18n="profit">Profit %</th>
          <th data-sort="profit" class="sortable" data-i18n="pure_profit">Pure Profit</th>
          <th data-sort="focusCost" class="sortable" data-i18n="focus_cost">Focus Cost</th>
          <th data-sort="profitPer10kFocus" class="sortable" title="Profit per play × the plays one 10,000-focus bar buys (after mat costs)" data-i18n-title="profit_per_play_the_plays_one_10_000_focus_b" data-i18n="profit_10k_focus">Profit / 10k Focus</th>
          <th data-sort="dailyVol" class="sortable" data-i18n="sell_vol_24h">Sell Vol (24h)</th>
          <th data-i18n="jump">Jump</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="11" style="text-align:center;color:#9ca3af;font-style:italic">
            <span data-i18n="run_scan_to_populate">Run "Scan Market Now" to populate top opportunities</span>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="black_market_opportunities">Black Market Opportunities</span>
      <button id="scan-bm-board-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Re-read the Black Market bids this board leans on, then rebuild it. Falls back to a full market scan when no prices have been fetched yet." data-i18n-title="re_read_the_black_market_bids_this_board_lea" data-i18n="scan_black_market">Scan Black Market</button>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem">
        <span data-i18n="bm_board_subtitle">Every profitable play that ENDS at the Black Market, from every scanned table — with the age of the bid each one leans on</span>
      </small>
      <input id="search-bm-board-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. crafting" data-i18n-ph="filter_e_g_crafting" />
    </h2>
    <table id="bm-board-table" class="data-table">
      <thead>
        <tr>
          <th data-sort="category" class="sortable" data-i18n="category">Category</th>
          <th data-sort="name" class="sortable" data-i18n="item">Item</th>
          <th data-sort="route" class="sortable" data-i18n="buy_city">Buy City</th>
          <th data-sort="cost" class="sortable" data-i18n="input_cost">Input Cost</th>
          <th data-sort="revenue" class="sortable" data-i18n="bm_bid">Black Market Bid</th>
          <th title="How long ago that bid was read — a Black Market number the book no longer holds says so here" data-i18n-title="bm_bid_age_title" data-i18n="bid_age">Bid Age</th>
          <th data-sort="margin" class="sortable" data-i18n="profit">Profit %</th>
          <th data-sort="profit" class="sortable" data-i18n="pure_profit">Pure Profit</th>
          <th data-sort="profitPerLoad" class="sortable" title="Profit for one full Transport Ox load (a T8 carries 3,200 kg) = Pure Profit per item × the items that fit by weight. Ranks routes by silver per haul." data-i18n-title="profit_for_one_full_transport_ox_load_a_t4_t" data-i18n="profit_ox">Profit/Ox</th>
          <th data-sort="throughput" class="sortable" title="Pure Profit × Daily Volume — silver throughput potential" data-i18n-title="pure_profit_daily_volume_silver_throughput_p" data-i18n="throughput">Throughput</th>
          <th data-sort="dailyVol" class="sortable" data-i18n="sell_vol_24h">Sell Vol (24h)</th>
          <th data-i18n="jump">Jump</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="12" style="text-align:center;color:#9ca3af;font-style:italic">
            <span data-i18n="run_scan_to_populate">Run "Scan Market Now" to populate top opportunities</span>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="flipping_all_cities">Flipping (All Cities)</span>
      <button id="scan-flipping-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Flipping table only — fetches buy/sell prices across all cities and recomputes inter-city flip margins." data-i18n-title="scan_the_flipping_table_only_fetches_buy_sel" data-i18n="scan_flipping">Scan Flipping</button>
      <input id="search-flipping-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. ore" data-i18n-ph="filter_e_g_ore" />
    </h2>
    <table id="flipping-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The item this route flips — bought in one city's order book, sold in another." data-i18n="item" data-i18n-title="the_item_this_route_flips_bought_in_one_city">Item</th>
          <th data-sort="tier" class="sortable" title="Item tier, with the enchantment level after the dot (4.1 = T4 enchant 1)." data-i18n="tier" data-i18n-title="item_tier_with_the_enchantment_level_after_t">Tier</th>
          <th data-sort="route" class="sortable" title="Buy city → sell city for this flip. Every city pair is priced, not only the cheapest source." data-i18n="route_all_cities" data-i18n-title="buy_city_sell_city_for_this_flip_every_city_">Route (All Cities)</th>
          <th data-sort="cost" class="sortable" title="What one unit costs in the buy city, on the buy leg you picked (instant, or a market order)." data-i18n="buy_cost" data-i18n-title="what_one_unit_costs_in_the_buy_city_on_the_b">Buy Cost</th>
          <th data-sort="revenue" class="sortable" title="What one unit fetches in the sell city, on the sell leg you picked — before tax." data-i18n="sell_revenue" data-i18n-title="what_one_unit_fetches_in_the_sell_city_on_th">Sell Revenue</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Buy Cost. A percentage, so a cheap item can beat an expensive one here." data-i18n="profit" data-i18n-title="pure_profit_buy_cost_a_percentage_so_a_cheap">Profit %</th>
          <th data-sort="profit" class="sortable" title="Sell revenue minus buy cost, after sales tax and the setup fee the order type charges." data-i18n="pure_profit" data-i18n-title="sell_revenue_minus_buy_cost_after_sales_tax_">Pure Profit</th>
          <th data-sort="profitPerLoad" class="sortable" title="Profit for one full Transport Ox load (a T8 carries 3,200 kg) = Pure Profit per item × the items that fit by weight. Ranks routes by silver per haul." data-i18n-title="profit_for_one_full_transport_ox_load_a_t4_t" data-i18n="profit_ox">Profit/Ox</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="9" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px">
      <span data-i18n="skins_trading_tradeable_vanity">Skins Trading (Tradeable Vanity)</span>
      <button id="scan-skins-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Scan the Skins Trading table only — fetches each tradeable vanity unlock-token's listing price across all cities and recomputes the best buy→sell flip." data-i18n-title="scan_the_skins_trading_table_only_fetches_ea" data-i18n="scan_skins">Scan Skins</button>
      <input id="search-skins-trading-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. cape, skeleton, gladiator" data-i18n-ph="filter_e_g_cape_skeleton_gladiator" />
    </h2>
    <p style="margin:2px 0 6px;color:#9ca3af;font-size:0.8rem;max-width:70ch" data-i18n-html="skins_desc">
      Tradeable wardrobe <em>unlock tokens</em> — the only marketable form of skins; applied ones are account-bound. Best Buy = cheapest city, Best Sell = dearest. Low-volume by nature, so thin rows show.
    </p>
    <table id="skins-trading-table" class="data-table">
      <thead>
        <tr>
          <th class="cell-add" title="Add to My Crafting List" data-i18n-title="add_to_my_crafting_list"></th>
          <th data-sort="name" class="sortable" title="The skin's unlock token — the tradable item. An APPLIED skin is account-bound and cannot be sold." data-i18n="skin" data-i18n-title="the_skin_s_unlock_token_the_tradable_item_an">Skin</th>
          <th data-sort="slot" class="sortable" title="Equipment slot the skin belongs to." data-i18n="slot" data-i18n-title="equipment_slot_the_skin_belongs_to">Slot</th>
          <th data-sort="cost" class="sortable" title="Cheapest city to buy the unlock token, on your buy leg." data-i18n="best_buy" data-i18n-title="cheapest_city_to_buy_the_unlock_token_on_you">Best Buy</th>
          <th data-sort="revenue" class="sortable" title="Best city to sell the unlock token, on your sell leg." data-i18n="best_sell" data-i18n-title="best_city_to_sell_the_unlock_token_on_your_s">Best Sell</th>
          <th data-sort="margin" class="sortable" title="Pure Profit ÷ Best Buy." data-i18n="profit" data-i18n-title="pure_profit_best_buy">Profit %</th>
          <th data-sort="profit" class="sortable" title="Best Sell minus Best Buy, after sales tax and the setup fee." data-i18n="pure_profit" data-i18n-title="best_sell_minus_best_buy_after_sales_tax_and">Pure Profit</th>
          <th title="Caerleon" data-i18n-title="caerleon" data-i18n="caer">Caer</th>
          <th title="Lymhurst" data-i18n-title="lymhurst" data-i18n="lym">Lym</th>
          <th title="Fort Sterling" data-i18n-title="fort_sterling" data-i18n="ftst">FtSt</th>
          <th title="Thetford" data-i18n-title="thetford" data-i18n="thet">Thet</th>
          <th title="Martlock" data-i18n-title="martlock" data-i18n="mart">Mart</th>
          <th title="Bridgewatch" data-i18n-title="bridgewatch" data-i18n="bdg">Bdg</th>
          <th title="Brecilien" data-i18n-title="brecilien" data-i18n="brec">Brec</th>
          <th title="Smuggler's Den" data-i18n-title="smugglers_den" data-i18n="smug">Smug</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="15" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>

    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span data-i18n="highest_trade_volume_top_items">Highest Trade Volume (Top Items)</span>
      <button id="scan-volume-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" title="Refresh the Highest Trade Volume table — re-fetches 24h traded volume across all cities for the top items." data-i18n-title="refresh_the_highest_trade_volume_table_re_fe" data-i18n="refresh_volume">Refresh Volume</button>
      <input id="volume-search" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. T4.2 planks" data-i18n-ph="filter_e_g_t4_2_planks" />
      <span id="volume-refresh-status" style="font-size:0.75rem;color:#9ca3af;font-weight:normal"></span>
    </h2>
    <table id="volume-table" class="data-table">
      <thead>
        <tr>
          <th data-sort="name" class="sortable" title="The item this volume was measured for." data-i18n="item" data-i18n-title="the_item_this_volume_was_measured_for">Item</th>
          <th data-sort="tier" class="sortable" title="Item tier, with the enchantment level after the dot." data-i18n="tier" data-i18n-title="item_tier_with_the_enchantment_level_after_t_2">Tier</th>
          <th data-sort="category" class="sortable" title="Marketplace category the item is filed under in game." data-i18n="type" data-i18n-title="marketplace_category_the_item_is_filed_under">Type</th>
          <th data-sort="totalVol" class="sortable" title="Units traded across every scanned city — how liquid the item is, not what it earns." data-i18n="total_volume_all_cities" data-i18n-title="units_traded_across_every_scanned_city_how_l">
            Total Volume (All Cities)
          </th>
          <th data-sort="topCity" class="sortable" title="City with the highest traded volume for this item." data-i18n="top_city" data-i18n-title="city_with_the_highest_traded_volume_for_this">Top City</th>
          <th data-sort="topCityVol" class="sortable" title="Units traded in the top city." data-i18n="top_city_volume" data-i18n-title="units_traded_in_the_top_city">Top City Volume</th>
          <th data-sort="topCityPrice" class="sortable" title="Price in the top city — the city the volume actually happened in." data-i18n="price_top_city" data-i18n-title="price_in_the_top_city_the_city_the_volume_ac">Price (Top City)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="7" data-i18n="r_awaiting_scan">Awaiting Scan...</td>
        </tr>
      </tbody>
    </table>
      </div>
    </section>
`);
