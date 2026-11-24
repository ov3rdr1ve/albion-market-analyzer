/**
 * Is boot still filling the tables?
 *
 * One flag, because two renderers need the same answer and neither can work it
 * out for itself. My Crafting List paints an entry it cannot resolve as
 * "Not priced yet — scan X to fill this row." That sentence is correct for a
 * user who has never scanned and actively wrong during boot, when the app is
 * computing that exact row and the user only has to wait.
 *
 * `true` from script evaluation, not from any event: the craft list's own
 * module-init render (js/render-craft-list.js) runs before js/app.js has begun,
 * so a flag that only turned on inside app.js would be read false by the very
 * paint it exists to describe. js/app.js turns it off once the boot render pass
 * has finished, success or not.
 */

let bootFilling = true;

/** Are the tables still being filled by boot? */
function isBootFilling() {
  return bootFilling;
}

/**
 * @param {boolean} filling — no argument means done, so a bare
 *   setBootFilling() in a `finally` reads the way it looks.
 */
function setBootFilling(filling) {
  bootFilling = !!filling;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { isBootFilling, setBootFilling };
}
