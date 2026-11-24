/**
 * Where the inline price editor goes.
 *
 * The editor is centred on the cell it edits, which is fine everywhere except
 * the last column — Price (Top City) sits hard against the window edge, and a
 * box centred there hangs half off the screen with nothing able to scroll to
 * it. Worse, an absolutely positioned box is also clipped by the table's own
 * horizontal scroll container, so the ✗ button simply vanished.
 *
 * Hence: fixed positioning plus this function, which centres on the cell and
 * then pulls the box back inside the viewport. Kept pure so the arithmetic can
 * be tested without a DOM — the caller supplies measured rectangles.
 */

/**
 * @param {{left:number, top:number, width:number, height:number}} cell
 * @param {{width:number, height:number}} editor
 * @param {{width:number, height:number}} viewport
 * @param {number} [margin]  breathing room kept at every edge
 * @returns {{left:number, top:number}} viewport coordinates for the editor
 */
function clampEditorPosition(cell, editor, viewport, margin = 8) {
  const fit = (start, size, limit) => {
    // An editor wider than the window can only be pinned to the left edge;
    // clamping the far side first would push its controls off to the left.
    if (size + margin * 2 >= limit) return margin;
    return Math.max(margin, Math.min(start, limit - margin - size));
  };
  return {
    left: Math.round(fit(cell.left + cell.width / 2 - editor.width / 2, editor.width, viewport.width)),
    top: Math.round(fit(cell.top + cell.height / 2 - editor.height / 2, editor.height, viewport.height)),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { clampEditorPosition };
}
