/**
 * The Time Left cell's click-to-edit editor for the Roads portals table.
 *
 * Moved out of js/render-roads.js because that file sits at its 800-line
 * ceiling — and because an input that must not have its keystrokes swallowed
 * is its own responsibility: while the editor is open the panel's countdown
 * redraw and the prune tick both stand down (the panel asks isEditing()),
 * and committing goes through the shared RoadsTimeInput parser so what the
 * player reads off the portal ("2:30", "30m", "23h") is what gets stored.
 *
 * The graph lives in the panel, so the panel hands over the hooks this needs
 * when it binds — the same handover js/render-roads-map.js gets:
 *
 *   RoadsPortalEditor.bindPortalEditing(table, {
 *     portalOf, applyPortalPatch, renderPortalsTable, renderPortalsMap,
 *   });
 *
 * Browser-global module (window.RoadsPortalEditor, the sibling roads-module
 * pattern) with a Node export guard.
 */

(function () {
  // The parser/formatter shared with the Add-Portal form (js/roads-time-input.js).
  const RoadsTimeInput = (typeof require !== "undefined")
    ? require("./roads-time-input.js")
    : (typeof window !== "undefined" ? window.RoadsTimeInput : globalThis.RoadsTimeInput);

  // Key of the row whose Time Left cell is open for typing, if any.
  let editingKey = null;
  // Graph/DOM hooks, set by bindPortalEditing().
  let hooks = {};

  /** Swap the Time Left cell for a text box, pre-filled with what is left. */
  function openTimeEditor(cell) {
    if (!cell || editingKey || cell.querySelector("input")) return;
    const portal = hooks.portalOf ? hooks.portalOf(cell.dataset.key) : null;
    if (!portal) return;
    editingKey = cell.dataset.key;
    cell.innerHTML =
      `<input type="text" class="roads-portal-hours" ` +
      `value="${RoadsTimeInput.formatForEdit(portal.secondsLeft(Date.now()))}" ` +
      `style="width:4.5rem;font-size:0.72rem">`;
    const input = cell.querySelector("input");
    input.focus();
    if (typeof input.select === "function") input.select();
  }

  /**
   * Close the editor: parse what was typed and patch the portal, or on a
   * rejected parse put the countdown back untouched.
   *
   * @param {boolean} save false for Escape — put the countdown back untouched.
   */
  function closeTimeEditor(input, save) {
    if (!input || input.dataset.closed) return;
    // The redraw below removes the input, which fires blur a second time.
    input.dataset.closed = "1";
    const cell = input.closest("td");
    const seconds = RoadsTimeInput.parse(input.value);
    editingKey = null;
    if (save && seconds !== null) {
      hooks.applyPortalPatch(cell && cell.dataset.key, {
        secondsRemaining: seconds,
        now: Date.now(),
      });
    }
    hooks.renderPortalsTable(true);
    hooks.renderPortalsMap();
  }

  /**
   * Wire the portals table: click a Time Left cell to edit it, Enter or a
   * click away commits, Escape reverts, and the size dropdown keeps saving
   * through the same patch helper.
   *
   * @param {Element} table the #roads-portals-table
   * @param {object} deps {portalOf, applyPortalPatch, renderPortalsTable, renderPortalsMap}
   */
  function bindPortalEditing(table, deps) {
    hooks = deps || {};
    if (!table) return;

    table.addEventListener("click", (event) => {
      const cell = event.target.closest(".roads-portal-time");
      if (cell) openTimeEditor(cell);
    });

    table.addEventListener("change", (event) => {
      const select = event.target.closest(".roads-portal-size");
      if (!select) return;
      hooks.applyPortalPatch(select.dataset.key, { size: select.value });
      hooks.renderPortalsMap();
    });

    table.addEventListener("keydown", (event) => {
      const input = event.target.closest(".roads-portal-hours");
      if (!input) return;
      if (event.key === "Enter") { event.preventDefault(); closeTimeEditor(input, true); }
      else if (event.key === "Escape") { event.preventDefault(); closeTimeEditor(input, false); }
    });

    // Clicking away commits: the typed value is what the player just read off
    // the portal, so losing it to a stray click would be the surprising choice.
    table.addEventListener("focusout", (event) => {
      const input = event.target.closest(".roads-portal-hours");
      if (input) closeTimeEditor(input, true);
    });
  }

  const RoadsPortalEditor = {
    bindPortalEditing,
    openTimeEditor,
    closeTimeEditor,
    /** True while a Time Left cell is open for typing (redraw/prune stand down). */
    isEditing: () => !!editingKey,
  };

  if (typeof window !== "undefined") window.RoadsPortalEditor = RoadsPortalEditor;
  if (typeof globalThis !== "undefined") globalThis.RoadsPortalEditor = RoadsPortalEditor;
  if (typeof module !== "undefined" && module.exports) module.exports = RoadsPortalEditor;
})();
