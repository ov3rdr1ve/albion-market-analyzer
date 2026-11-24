/**
 * The captured-price map on disk (main process).
 *
 * Sibling of js/scan-price-file.js and deliberately just as dumb: read text,
 * parse it, write text. Everything that decides whether a map is worth keeping
 * — schema, cell age, the cell cap — lives in js/captured-prices-store.js next
 * to the code that consumes it.
 *
 * Captures used to live in the page's localStorage. A week of them runs to
 * megabytes, which put the whole app one quota error away from silently losing
 * not just captures but the crafting list and the price overrides sharing that
 * quota. Under userData there is no quota to blow, and the file survives a
 * reinstall like scan-prices.json does.
 *
 * Failure is never fatal: an unreadable file loads as null and the session
 * starts with whatever the monitor captures next.
 */

const CAPTURED_PRICES_FILENAME = "captured-prices.json";

/**
 * @param {object} options
 * @param {string} options.file  full path to the map
 * @param {(f:string)=>string} [options.readFile]  reads it as UTF-8
 * @returns {object|null} the parsed map, or null when unreadable
 */
function loadCapturedPricesFile({
  file,
  readFile = (f) => require("fs").readFileSync(f, "utf8"),
} = {}) {
  let text;
  try { text = readFile(file); } catch (e) { return null; }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * @param {object} options
 * @param {string} options.file
 * @param {object} options.map  the quality-shaped captured map
 * @param {(f:string,d:string)=>void} [options.writeFile]
 * @returns {boolean} whether the write landed
 */
function saveCapturedPricesFile({
  file,
  map,
  writeFile = (f, d) => require("fs").writeFileSync(f, d),
} = {}) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return false;
  try {
    // No pretty-printing: this file reaches tens of megabytes and indentation
    // would add a third of that for nobody's benefit.
    writeFile(file, JSON.stringify(map));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  CAPTURED_PRICES_FILENAME,
  loadCapturedPricesFile,
  saveCapturedPricesFile,
};
