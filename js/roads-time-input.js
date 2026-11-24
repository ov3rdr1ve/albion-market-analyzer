/**
 * The one parser behind both Roads portal-timer entry points: the in-table
 * "Time Left" cell editor (js/roads-portal-editor.js) and the Add-Portal form
 * (js/render-roads.js).
 *
 * A portal's lifetime is read off the game UI as "23h", "4h" or "30m", or
 * typed as a clock read "2:30" — never as the decimal hours the boxes took
 * before (typing "30m" as "0.5" was the mistake this replaces). Everything is
 * normalized to integer seconds, the unit the portal graph already stores
 * (secondsRemaining), and anything unparsable or past the 24 h ceiling the
 * store keeps returns null so the caller can refuse the edit.
 *
 * Accepted syntax:
 *   H:M / H:MM      "2:30" -> 9000, "24:00" -> 86400 (minutes must be 0-59)
 *   Nm / Nh         "30m" -> 1800, "23h" -> 82800 (case-insensitive)
 *   plain number    legacy decimal hours: "1.5" -> 5400, "24" -> 86400
 *
 * Whitespace is trimmed; 24 h (86400 s) is the inclusive ceiling, matching the
 * old max="24" the number inputs carried.
 *
 * Browser-global module (window.RoadsTimeInput, the sibling roads-module
 * pattern) with a Node export guard so tests can require it directly.
 */

(function () {
  /** A portal can never outlive 24 h — the graph clamps to the same value. */
  const MAX_SECONDS = 24 * 3600;

  /**
   * Text -> integer seconds, or null when it is not a time this accepts.
   * @param {string} text whatever the player typed
   */
  function parse(text) {
    const raw = String(text == null ? "" : text).trim();
    if (!raw) return null;

    // H:M / H:MM — the clock style. Minutes stay 0-59 and the whole thing
    // must not pass the ceiling ("24:00" is in, "24:01" and "2:75" are out).
    let m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
    if (m) {
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60;
      return Number(m[2]) <= 59 && seconds <= MAX_SECONDS ? seconds : null;
    }

    // Nm / Nh — what the portal object itself shows, case-insensitive.
    m = /^(\d+)([mh])$/i.exec(raw);
    if (m) {
      const seconds = Number(m[1]) * (m[2].toLowerCase() === "h" ? 3600 : 60);
      return seconds <= MAX_SECONDS ? seconds : null;
    }

    // Plain number — the legacy decimal hours the form used to take.
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const seconds = Math.round(Number(raw) * 3600);
      return seconds <= MAX_SECONDS ? seconds : null;
    }

    return null;
  }

  /**
   * Seconds -> the H:MM the editor prefills. Sub-minute leftovers clamp UP to
   * one minute: a portal with 30 s left must not offer a prefill that commits
   * nothing ("0:00" is reserved for genuinely nothing left).
   * @param {number} seconds
   */
  function formatForEdit(seconds) {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.max(60, Math.round(seconds)) : 0;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  }

  const RoadsTimeInput = { parse, formatForEdit };

  if (typeof window !== "undefined") window.RoadsTimeInput = RoadsTimeInput;
  if (typeof globalThis !== "undefined") globalThis.RoadsTimeInput = RoadsTimeInput;
  if (typeof module !== "undefined" && module.exports) module.exports = RoadsTimeInput;
})();
