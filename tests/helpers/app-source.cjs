/**
 * The app controller's source, as one string.
 *
 * js/app.js was split into cohesive files for the 800-line limit. Tests that
 * lift a function (or assert on wiring) out of the controller's source read it
 * through here, so they keep working whichever of those files a piece lives in.
 * js/app.js comes first: it is the boot sequence, and it calls the boot-step
 * files below in the order they follow (so "awaits the catalogs, then merges
 * them" still reads top to bottom). The rest keep the original js/app.js order.
 */
const fs = require("fs");
const path = require("path");

const APP_SOURCE_FILES = [
  "js/app.js",
  "js/app-cells.js",
  "js/app-row-overrides.js",
  "js/render-pipeline.js",
  "js/collapsible-sections.js",
  "js/app-catalog-merge.js",
  "js/app-toolbar.js",
  "js/price-editor.js",
  "js/app-scan-controls.js",
];

const ROOT = path.join(__dirname, "..", "..");

function appSource() {
  return APP_SOURCE_FILES
    // CRLF checkouts (Windows, core.autocrlf=true): the tests lift functions
    // with \n-anchored regexes, so normalize line endings as their old read() did.
    .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n"))
    .join("\n");
}

module.exports = { appSource, APP_SOURCE_FILES };
