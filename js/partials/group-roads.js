// Markup of the "roads" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-roads" data-group="roads">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_roads">Roads of Avalon</span>
        <span class="tgroup-sub" data-i18n="group_roads_sub">Mapped portals and zone directory</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span data-i18n="roads_live_portals_title">Roads of Avalon — Live Portals</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="roads_portals_intro">
      Portals expire 12-24h after they spawn and no API publishes them — every row here was typed in below or taken from a teammate's shared folder.
    </small>
      <input id="search-roads-portals-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. group" data-i18n-ph="filter_e_g_group" />
    </h2>
    <div class="controls" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <input id="roads-route-from" type="search" autocomplete="off" placeholder="From zone…" style="font-size:0.8rem;padding:3px 6px" data-i18n-ph="from_zone" />
      <input id="roads-route-to" type="search" autocomplete="off" placeholder="To zone…" style="font-size:0.8rem;padding:3px 6px" data-i18n-ph="to_zone" />
      <button id="roads-route-btn" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" data-i18n="find_route">Find Route</button>
      <button id="roads-exit-btn" style="font-size:0.8rem;padding:4px 12px" title="Shortest recorded way out of the Roads from the 'From' zone — cities are not roads zones, so routes end at a royal or outlands zone." data-i18n-title="shortest_recorded_way_out_of_the_roads_from_" data-i18n="nearest_exit">Nearest Exit</button>
      <label style="font-size:0.8rem;color:#9ca3af;display:flex;align-items:center;gap:4px" title="City travel to Caerleon takes no luggage — tick this and the route avoids those hops." data-i18n-title="city_travel_to_caerleon_takes_no_luggage_">
        <input id="roads-route-cargo" type="checkbox" />
        <span data-i18n="roads_carrying_cargo">carrying cargo</span>
      </label>
      <label style="font-size:0.8rem;color:#9ca3af;display:flex;align-items:center;gap:4px" title="Your realmgate binding. You can only leave the royal continent through the portal city you are bound to; coming back through any other one re-binds you." data-i18n-title="your_realmgate_binding_you_can_only_leave_">
        <span data-i18n="roads_realmgate_label">realmgate</span>
        <select id="roads-route-gate" style="font-size:0.8rem;padding:3px 6px">
          <option value="" data-i18n="roads_realmgate_any">any</option>
        </select>
      </label>
      <label style="font-size:0.8rem;color:#9ca3af;display:flex;align-items:center;gap:4px" title="Which way of moving the route should favour. Fastest weighs each hop in real time instead." data-i18n-title="which_way_of_moving_the_route_should_favour">
        <span data-i18n="roads_prefer_label">prefer</span>
        <select id="roads-route-prefer" style="font-size:0.8rem;padding:3px 6px">
          <option value="portal" data-i18n="roads_prefer_portal">Roads</option>
          <option value="travel" data-i18n="roads_prefer_travel">city travel</option>
          <option value="foot" data-i18n="roads_prefer_foot">running</option>
          <option value="fastest" data-i18n="roads_prefer_fastest">fastest</option>
        </select>
      </label>
      <span id="roads-route-result" style="font-size:0.8rem;color:#e5e7eb"></span>
    </div>
    <div class="controls" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <input id="roads-add-from" type="search" autocomplete="off" placeholder="Portal from…" style="font-size:0.8rem;padding:3px 6px" data-i18n-ph="portal_from" />
      <input id="roads-add-to" type="search" autocomplete="off" placeholder="Portal to…" style="font-size:0.8rem;padding:3px 6px" data-i18n-ph="portal_to" />
      <select id="roads-add-size" style="font-size:0.8rem;padding:3px 6px">
        <option value="solo" data-i18n="portal_size_solo">Solo</option>
        <option value="group" data-i18n="portal_size_group">Group</option>
        <option value="raid" data-i18n="portal_size_raid">Raid</option>
      </select>
      <input id="roads-add-hours" type="text" style="font-size:0.8rem;padding:3px 6px;width:70px" placeholder="2:30 / 30m / 23h" title="Time left (2:30, 30m or 23h)" data-i18n-title="hours_left_on_the_portal" data-i18n-ph="2_30_30m_23h" />
      <button id="roads-add-btn" style="font-size:0.8rem;padding:4px 12px" data-i18n="add_portal">Add Portal</button>
      <button id="roads-clear-btn" style="font-size:0.8rem;padding:4px 12px" title="Remove every recorded portal, live and expired. Cannot be undone." data-i18n-title="remove_every_recorded_portal_live_and_expire" data-i18n="clear_all_portals">Clear All</button>
      <span id="roads-add-status" style="font-size:0.75rem;color:#9ca3af"></span>
    </div>
    <div class="controls hidden" id="roads-sync-controls" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      <label style="font-size:0.8rem;color:#9ca3af;display:flex;align-items:center;gap:4px" title="Share your mapped portals with everyone pointing at the same folder. Your portals and captured prices are written into that folder, where anyone with access can read them." data-i18n-title="share_your_mapped_portals_with_everyone_poin">
        <input id="roads-sync-enabled" type="checkbox" />
        <span data-i18n="roads_sync_label">team sync</span>
      </label>
      <button id="roads-sync-folder-btn" style="font-size:0.8rem;padding:4px 12px" data-i18n="roads_sync_choose_folder">Shared Folder…</button>
      <span id="roads-sync-folder" style="font-size:0.75rem;color:#9ca3af"></span>
      <label style="font-size:0.8rem;color:#9ca3af;display:flex;align-items:center;gap:4px" title="Also write the prices your live monitor captured into the same folder, where anyone with access can read them. They are the only prices the API cannot refetch, but the files get much bigger." data-i18n-title="also_write_the_prices_your_live_monitor_capt">
        <input id="roads-sync-prices" type="checkbox" />
        <span data-i18n="roads_sync_prices_label">share captured prices</span>
      </label>
      <span id="roads-sync-status" style="font-size:0.75rem;color:#9ca3af"></span>
    </div>
    <div class="roads-map-wrap" id="roads-map-wrap">
      <svg id="roads-map" role="img" tabindex="0" aria-label="Recorded Roads of Avalon portal network"></svg>
      <div class="roads-map-tip" id="roads-map-tip"></div>
      <div class="roads-map-empty" id="roads-map-empty" data-i18n="roads_map_empty">
        Nothing mapped yet — add a portal below and the network draws itself here.
      </div>
      <div class="roads-map-legend">
        <span><span class="swatch" style="background:#7c5cbf"></span><span data-i18n="roads_type_roads">Roads</span></span>
        <span><span class="swatch" style="background:#3b82f6"></span><span data-i18n="roads_legend_royal">Royal</span></span>
        <span><span class="swatch" style="background:#b45309"></span><span data-i18n="roads_type_outlands">Outlands</span></span>
        <span style="color:#a78bfa">◯ <span data-i18n="roads_legend_rest">Rest</span></span>
        <span style="color:#9ae6b4">◌ <span data-i18n="roads_legend_exit">dashed ring = exit</span></span>
        <span data-i18n="roads_legend_lines">thicker line = bigger portal · dashed line = expired</span>
        <span style="color:#cbd5e1">⟼ <span data-i18n="roads_legend_brecilien">deep T8 roads have a one-way portal to Brecilien — raid roads do not</span></span>
        <span data-i18n="roads_map_hint">drag nodes · wheel to zoom · click a zone for “From”, shift-click for “To”</span>
        <span data-i18n="roads_map_delete_hint">click a zone or a portal, then press Del to remove it</span>
        <button id="roads-map-reset" style="font-size:0.7rem;padding:2px 8px" data-i18n="reset_view">Reset View</button>
        <span id="roads-map-status" style="color:#e2b53f"></span>
      </div>
    </div>
    <table id="roads-portals-table" class="data-table">
      <thead>
        <tr>
          <th data-i18n="from">From</th>
          <th data-i18n="to">To</th>
          <th data-i18n="type">Type</th>
          <th data-i18n="time_left">Time Left</th>
          <th data-i18n="source">Source</th>
          <th></th>
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
