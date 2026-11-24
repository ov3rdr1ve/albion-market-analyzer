/**
 * Which prices the app can actually read, city by city — with the Black Market
 * under the microscope.
 *
 * Written for the "T3 Bag and the T6.1/.2/.3 bags are missing when the City
 * picker is set to Black Market" report. Two mechanisms were behind it, and
 * this script measures both against a REAL saved scan rather than a fixture:
 *
 *   1. the cross-city outlier gate deleting legitimate Black Market bids
 *      (js/utils.js getIQRBounds / getSellPrice — now exempt),
 *   2. rows that can be priced at a city but never chose it, which is what the
 *      City pick now re-prices (js/table-sell-city.js).
 *
 * A SCRIPT, not a test: it reads the live scan file in userData, which the test
 * suite must never do. It changes nothing.
 *
 * Usage:
 *   node scripts/audit-black-market-coverage.cjs [path-to-scan-prices.json] [--limit N]
 *
 * Default path: %APPDATA%\albion-market-analyzer\scan-prices.json
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const BM = "Black Market";

// ── Load the REAL price helpers, once with the Black Market exempt from the
//    cross-city pools (the shipped js/utils.js) and once with it pooled back in
//    (the old behaviour), so section 1 can quote the difference. ─────────────
function loadUtils({ poolBlackMarket }) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  const elements = { "sort-instant": { checked: false } }; // market mode
  sandbox.document = { getElementById: (id) => elements[id] || null };
  sandbox.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  const ctx = vm.createContext(sandbox);
  let code = ["utils", "utils-item-ids", "utils-overrides", "utils-focus-fees"]
    .map((n) => fs.readFileSync(path.join(__dirname, "..", "js", n + ".js"), "utf8")).join("\n");
  if (poolBlackMarket) {
    // Undo the two exemptions, exactly and visibly, to model the old gate.
    // Anchored on the statement, not the whole line, because the repo's files
    // are CRLF — a "\n"-terminated needle silently matches nothing and the
    // comparison then reports no difference at all.
    const undo = [
      /^[ \t]*if \(city === "Black Market"\) return;[ \t]*\r?\n/m,
      /^[ \t]*if \(isBm\) return price;[ \t]*\r?\n/m,
    ];
    undo.forEach((re) => {
      if (!re.test(code)) {
        throw new Error(`cannot model the old gate: ${re} no longer matches js/utils.js`);
      }
      code = code.replace(re, "");
    });
  }
  code += "\n;globalThis.__exp = { getIQRBounds, getSellPrice, getBuyPrice };";
  vm.runInContext(code, ctx, { filename: "utils.js" });
  return sandbox.__exp;
}

const CURRENT = loadUtils({ poolBlackMarket: false });
const OLD = loadUtils({ poolBlackMarket: true });

// ── Input ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 20 : 20;
const fileArg = args.find((a) => !a.startsWith("--") && a !== String(LIMIT));
const scanPath = fileArg || path.join(
  process.env.APPDATA || path.join(process.env.HOME || ".", ".config"),
  "albion-market-analyzer", "scan-prices.json",
);

if (!fs.existsSync(scanPath)) {
  console.error(`No scan file at ${scanPath}\nPass one as the first argument.`);
  process.exit(1);
}
const saved = JSON.parse(fs.readFileSync(scanPath, "utf8"));
const flat = saved.flat || saved.prices || saved;
const ids = Object.keys(flat);
console.log(`Scan: ${scanPath}`);
console.log(`Saved ${saved.savedAt || "(unknown date)"} — ${ids.length} ids\n`);

// The planner/crafting row universe: equipment slots carry a .1–.4 ladder and
// are what the City pick is used on. Mirrors CP_EQUIP_SLOT_RE in
// js/render-craft-planner.js.
const EQUIP_RE = /^T\d+_(HEAD|ARMOR|SHOES|CAPEITEM|CAPE|BAG|MAIN|2H|OFF)(?:_|$|@)/;
const family = (id) => String(id).replace(/^T\d+_/, "").replace(/@\d+$/, "");
const fmt = (n) => Math.round(n).toLocaleString();

function section(title) { console.log(`\n=== ${title} ===`); }
function topFamilies(list, n = 8) {
  const counts = new Map();
  list.forEach((id) => counts.set(family(id), (counts.get(family(id)) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([f, c]) => `${f} ×${c}`).join(", ");
}

// ── 1. Black Market bids the OLD gate deleted ──────────────────────────────
section("1. Black Market bids the cross-city outlier gate used to delete");
const nulled = [];
const stillNulled = [];
ids.forEach((id) => {
  const d = flat[id];
  const bm = d[BM];
  if (!bm || !(bm.buy_price > 0)) return;
  const oldPrice = OLD.getSellPrice(d, BM, OLD.getIQRBounds(d), id);
  const nowPrice = CURRENT.getSellPrice(d, BM, CURRENT.getIQRBounds(d), id);
  if (oldPrice <= 0 && nowPrice > 0) nulled.push({ id, price: nowPrice, cap: OLD.getIQRBounds(d).buyUpper });
  if (nowPrice <= 0) stillNulled.push(id);
});
console.log(`recovered: ${nulled.length}   still unreadable: ${stillNulled.length} (must be 0)`);
nulled.slice(0, LIMIT).forEach((r) =>
  console.log(`  ${r.id.padEnd(34)} bid ${fmt(r.price).padStart(10)}  old ceiling ${fmt(r.cap)}`));
if (nulled.length > LIMIT) console.log(`  … and ${nulled.length - LIMIT} more`);

// ── 2. City ceilings the Black Market's own ask used to move ───────────────
section("2. City ask ceilings the Black Market's ask used to skew");
const skewed = [];
ids.forEach((id) => {
  const d = flat[id];
  if (!d[BM] || !(d[BM].sell_price > 0)) return;
  if (Math.round(OLD.getIQRBounds(d).sellUpper) !== Math.round(CURRENT.getIQRBounds(d).sellUpper)) {
    skewed.push(id);
  }
});
console.log(`${skewed.length} ids — the Black Market has no sell offers in game, so this was`);
console.log("noise judging real city listings.");
console.log(`  families: ${topFamilies(skewed)}`);

// ── 3. What each City pick can actually show ───────────────────────────────
section("3. Equipment ids with a usable price, per City pick");
const equipIds = ids.filter((id) => EQUIP_RE.test(id));
const CITIES = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock",
  "Bridgewatch", "Brecilien", BM];
const priceable = new Map(CITIES.map((c) => [c, 0]));
const bestElsewhere = new Map(CITIES.map((c) => [c, 0]));
equipIds.forEach((id) => {
  const d = flat[id];
  const b = CURRENT.getIQRBounds(d);
  let bestCity = null, bestPrice = 0;
  CITIES.forEach((c) => {
    const p = CURRENT.getSellPrice(d, c, b, id);
    if (p > 0) priceable.set(c, priceable.get(c) + 1);
    if (p > bestPrice) { bestPrice = p; bestCity = c; }
  });
  CITIES.forEach((c) => {
    if (c !== bestCity && CURRENT.getSellPrice(d, c, b, id) > 0) {
      bestElsewhere.set(c, bestElsewhere.get(c) + 1);
    }
  });
});
console.log(`${equipIds.length} equipment ids in the scan.`);
console.log("  city".padEnd(20) + "priceable".padStart(11) + "  of which another city pays more");
CITIES.forEach((c) => {
  console.log(`  ${c}`.padEnd(20) + String(priceable.get(c)).padStart(11)
    + String(bestElsewhere.get(c)).padStart(35));
});
console.log("\nThe last column is what a City pick could never show before it re-priced");
console.log("the table: a row priced there whose best sale is somewhere else.");

// ── 4. Ids with no price anywhere ──────────────────────────────────────────
section("4. Ids with no price in ANY city (market thinness, not a bug)");
const dead = ids.filter((id) => {
  const d = flat[id];
  return !Object.values(d).some((c) => c.buy_price > 0 || c.sell_price > 0);
});
console.log(`${dead.length} ids — every row that needs one of these is a no-data row`);
console.log("whatever the sell city (e.g. an enchanted bar nobody has listed).");
console.log(`  families: ${topFamilies(dead)}`);
const deadEnchMats = dead.filter((id) => /_(CLOTH|LEATHER|METALBAR|PLANKS|STONEBLOCK)_LEVEL\d@\d$/.test(id));
if (deadEnchMats.length) {
  console.log(`  unlisted enchanted bars (${deadEnchMats.length}): ${deadEnchMats.slice(0, LIMIT).join(", ")}`);
}
