// Markup of the "craftlist" tab group, split out of index.html (800-line limit).
// document.write from a classic (non-deferred) script inserts it at this tag's
// position while the parser is still running, so it is in the DOM before every
// deferred app script runs, with no fetch() / XHR (file:// safe in Electron).
// scripts/gen-i18n-index.cjs tags this file together with index.html.
document.write(String.raw`
    <section class="tgroup" id="group-craftlist" data-group="craftlist">
      <div class="tgroup-head">
        <span class="tgroup-title" data-i18n="group_craftlist">My Crafting List</span>
        <span class="tgroup-sub" data-i18n="group_craftlist_sub">Rows you picked with "+", with quantities and everything to buy</span>
        <span class="tgroup-indicator">▼</span>
      </div>
      <div class="tgroup-body">
    <h2 id="craft-list-heading" style="display:flex;align-items:center;gap:12px">
      <span data-i18n="my_crafting_list">My Crafting List</span>
      <span id="cl-count" style="color:#9ca3af;font-size:0.9rem">(0)</span>
      <button type="button" id="cl-clear-all" class="primary-btn" style="font-size:0.8rem;padding:4px 12px" hidden data-i18n="clear_list">Clear List</button>
      <!-- Shown only when a write to localStorage failed. A list that quietly
           stops saving looks identical to one that got wiped, and the user only
           finds out after the next restart. -->
      <span id="cl-save-warning" class="cl-save-warning" hidden data-i18n="r_cl_save_failed">⚠ This list could not be saved — it will be lost when the app closes.</span>
      <input id="search-craft-list-table" class="table-search" type="search" autocomplete="off" placeholder="Filter… e.g. t6 bag" data-i18n-ph="filter_e_g_t6_bag" />
    </h2>
    <table id="craft-list-table" class="data-table">
      <tbody>
        <tr>
          <td colspan="1" class="cl-empty"><span class="row-fluid row-note" data-i18n="r_cl_empty_static">Nothing on the list yet — click the "+" on any row to add it.</span></td>
        </tr>
      </tbody>
    </table>

    <h2 id="craft-list-mats-heading" style="display:flex;align-items:center;gap:12px">
      <span data-i18n="materials_to_buy">Materials to Buy</span>
      <small style="font-weight:normal;color:#9ca3af;font-size:0.75rem" data-i18n="materials_to_buy_sub">Every list row's inputs × its quantity, merged per material and city — prices are click-to-edit</small>
    </h2>
    <table id="craft-list-mats-table" class="data-table">
      <thead>
        <tr>
          <th data-i18n="material">Material</th>
          <th data-i18n="city">City</th>
          <th data-i18n="quantity">Quantity</th>
          <th data-i18n="unit_price">Unit Price</th>
          <th data-i18n="total">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="5"><span class="row-fluid row-note" data-i18n="r_cl_no_materials_static">No purchasable materials on the list yet.</span></td>
        </tr>
      </tbody>
    </table>
      </div>
    </section>
`);
