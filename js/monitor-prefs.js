/**
 * The handful of monitor settings the MAIN process needs.
 *
 * The upload switch lives in the page's localStorage, because only the page
 * needs it. These two cannot: both are read while the window is still loading,
 * long before any renderer storage is readable — auto-start decides whether the
 * capture opens at all, and the capture city is what the session files prices
 * under until the game announces a zone. A city that only arrived with the page
 * came too late: every order captured in between was dropped for want of a
 * zone. So they get a small JSON file under userData.
 *
 * Failure is never fatal here. A missing, empty, truncated or hand-edited file
 * falls back to the defaults — a preference file must not be able to stop the
 * app from opening.
 */

const DEFAULT_MONITOR_PREFS = Object.freeze({
  autoStart: true,
  captureCity: "",
});

function coerce(raw) {
  const prefs = { ...DEFAULT_MONITOR_PREFS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return prefs;
  }
  if (typeof raw.autoStart === "boolean") prefs.autoStart = raw.autoStart;
  if (typeof raw.captureCity === "string") prefs.captureCity = raw.captureCity.trim();
  return prefs;
}

/**
 * @param {object} options
 * @param {string} options.file  full path to the prefs file
 * @param {(f:string)=>string} [options.readFile]  reads it as UTF-8
 */
function loadMonitorPrefs({ file, readFile = (f) => require("fs").readFileSync(f, "utf8") } = {}) {
  let text;
  try { text = readFile(file); } catch (e) { return { ...DEFAULT_MONITOR_PREFS }; }
  try { return coerce(JSON.parse(text)); } catch (e) { return { ...DEFAULT_MONITOR_PREFS }; }
}

/**
 * @returns {object} the merged prefs — returned even when the write failed, so
 *   the current session honours the choice the user just made.
 */
function saveMonitorPrefs({ file, writeFile = (f, d) => require("fs").writeFileSync(f, d), prefs } = {}) {
  const merged = coerce(prefs);
  try { writeFile(file, JSON.stringify(merged, null, 2)); } catch (e) { /* read-only profile */ }
  return merged;
}

module.exports = {
  DEFAULT_MONITOR_PREFS, loadMonitorPrefs, saveMonitorPrefs,
};
