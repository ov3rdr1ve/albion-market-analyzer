/**
 * The scan-price bundle on disk (main process).
 *
 * Deliberately dumb: read text, parse it, write text. Everything that decides
 * whether a bundle is TRUSTWORTHY — schema version, age, emptiness — lives in
 * js/scan-price-store.js next to the code that consumes it, so the main
 * process never has to know what a price map looks like.
 *
 * Failure is never fatal. A missing, truncated or hand-edited file loads as
 * null and the app opens with empty tables, exactly as it did before anything
 * was persisted; a read-only profile makes the save report false and the
 * session carries on with its prices in memory.
 */

const SCAN_PRICES_FILENAME = "scan-prices.json";

/**
 * @param {object} options
 * @param {string} options.file  full path to the bundle
 * @param {(f:string)=>string} [options.readFile]  reads it as UTF-8
 * @returns {object|null} the parsed bundle, or null when unreadable
 */
function loadScanPricesFile({ file, readFile = (f) => require("fs").readFileSync(f, "utf8") } = {}) {
  let text;
  try { text = readFile(file); } catch (e) { return null; }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * @param {object} options
 * @param {string} options.file
 * @param {object} options.bundle  whatever the renderer built
 * @param {(f:string,d:string)=>void} [options.writeFile]
 * @returns {boolean} whether the write landed
 */
function saveScanPricesFile({
  file,
  bundle,
  writeFile = (f, d) => require("fs").writeFileSync(f, d),
} = {}) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return false;
  try {
    // No pretty-printing: this file reaches tens of megabytes, and indentation
    // would add a third of that for nobody's benefit.
    writeFile(file, JSON.stringify(bundle));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { SCAN_PRICES_FILENAME, loadScanPricesFile, saveScanPricesFile };
