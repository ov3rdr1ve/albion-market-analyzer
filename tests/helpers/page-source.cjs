/**
 * The page as the browser sees it, for tests that grep markup or sheets.
 * index.html pulls each tab group's markup from js/partials/group-*.js
 * (document.write) and css/styles*.css are one logical stylesheet; this
 * expands the partial script tags in place and joins the sheets in link order.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PARTIAL_TAG = /[ \t]*<script src="(js\/partials\/[\w-]+\.js)"><\/script>\r?\n?/g;
const PARTIAL_BODY = /document\.write\(String\.raw`([\s\S]*)`\);\s*$/;

function partialMarkup(rel, root = ROOT) {
  const src = fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
  const m = PARTIAL_BODY.exec(src);
  if (!m) throw new Error(`${rel}: not a document.write partial`);
  return m[1].replace(/^\n/, "").replace(/\n$/, "\n");
}

// index.html with every partial script tag replaced by that partial's markup.
function readIndexHtml(root = ROOT) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  return html.replace(PARTIAL_TAG, (_, rel) => partialMarkup(rel, root));
}

// The stylesheets that used to be css/styles.css, concatenated in link order.
function readStyles(root = ROOT) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const links = [...html.matchAll(/<link rel="stylesheet" href="(css\/styles[\w-]*\.css)"/g)].map((m) => m[1]);
  return links.map((rel) => fs.readFileSync(path.join(root, rel), "utf8")).join("");
}

module.exports = { readIndexHtml, readStyles, partialMarkup, ROOT };
