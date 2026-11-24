/**
 * Test: heartSubstituteLine — the Required-Materials cell line rendered when a
 * faction heart wins the secondary slot in the Refining/Transports table.
 *
 * render-transport.js is all function declarations at top level, so it compiles
 * with tiny stubs for the two render helpers heartSubstituteLine calls.
 *
 * Run: node tests/refining-chain-heart-render.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Row text runs through tx(english, slug); en-mode identity keeps assertions in English.
globalThis.tx = globalThis.tx || ((en) => en);

const sandbox = `
function getItemDisplayName(id){ return ({ "T1_FACTION_FOREST_TOKEN_1": "Treeheart" })[id] || id; }
function matPriceSpan(id, city, price){
  return '<span class="mat-price" data-mat="' + id + '" data-city="' + city + '">' + price + '</span>';
}
`;

const src = fs.readFileSync(path.join(__dirname, "..", "js/render-transport.js"), "utf8");
const mod = new Module("render-transport-heart-test");
mod._compile(sandbox + src + "\nmodule.exports = { heartSubstituteLine };", "render-transport.js");
const { heartSubstituteLine } = mod.exports;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("heartSubstituteLine render tests\n");

const secHeart = { id: "T1_FACTION_FOREST_TOKEN_1", price: 50, city: "Fort Sterling", count: 1 };

test("shows the heart name, count and an overridable price span", () => {
  const html = heartSubstituteLine(secHeart, "T8 Fiber");
  assert.ok(html.includes("Treeheart"), "heart display name");
  assert.ok(/\b1x\b/.test(html), "count");
  assert.ok(html.includes('data-mat="T1_FACTION_FOREST_TOKEN_1"'), "price span keyed to the heart");
  assert.ok(html.includes('data-city="Fort Sterling"'), "price span carries the buy city");
});

test("uses the amber '(substitute — cheaper than …)' tag naming the RAW it replaces", () => {
  const html = heartSubstituteLine(secHeart, "T8 Fiber");
  assert.ok(html.includes("substitute — cheaper than T8 Fiber"), "substitute tag names the raw resource");
  assert.ok(html.includes("#fbbf24"), "amber style matches the (via chain) tag");
});

console.log(`\n--- ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
