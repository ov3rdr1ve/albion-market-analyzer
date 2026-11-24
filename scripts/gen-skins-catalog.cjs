/**
 * Regenerate the SKIN_TRADE_ITEMS array body for js/data-skins.js.
 *
 * Source of truth: the ao-bin-dumps in data/dumps/ — items.xml (which item
 * ids exist + the unlock-token namespace) and items.json (EN-US LocalizedNames).
 *
 * It emits ONLY genuinely tradeable wardrobe unlock tokens:
 *   include: uniquename matching  UNIQUE_UNLOCK_*VANITY*
 *   exclude: _TELLAFRIEND (referral, account-bound), _NON_TRADABLE, internal _COPY
 * The applied SKIN_* / UNIQUE_ARMOR_VANITY_* forms are deliberately skipped —
 * they're account-bound (showinmarketplace="false") and return no market data.
 *
 * Usage:
 *   node scripts/gen-skins-catalog.cjs            # prints the array body to stdout
 * Then paste the output between the SKIN_TRADE_ITEMS [ ... ] brackets in
 * js/data-skins.js (names have the "Wardrobe Skin: " prefix stripped).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const items = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "dumps", "items.json"), "utf8"));
const nameOf = {};
for (const o of items) {
  const v = o.LocalizationNameVariable;
  if (!v) continue;
  const id = v.replace(/^@ITEMS_/, "");
  const en = o.LocalizedNames && o.LocalizedNames["EN-US"];
  if (en) nameOf[id] = en;
}

const xml = fs.readFileSync(path.join(ROOT, "data", "dumps", "items.xml"), "utf8");
const re = /uniquename="(UNIQUE_UNLOCK_[A-Z0-9_]*VANITY[A-Z0-9_]*)"/g;
const seen = new Set();
const ids = [];
let m;
while ((m = re.exec(xml))) {
  const id = m[1];
  if (seen.has(id)) continue;
  seen.add(id);
  if (/TELLAFRIEND|NON_?TRADABLE|_COPY/.test(id)) continue;
  // No EN-US localization = the token exists in the files but not in the live
  // game (unreleased content). Emitting it would put a raw id in the table.
  if (!nameOf[id]) continue;
  ids.push(id);
}

const slotOf = (id) =>
  /_ARMOR_VANITY/.test(id) ? "Armor" :
  /_CAPE_VANITY/.test(id) ? "Cape" :
  /_HEAD_VANITY/.test(id) ? "Head" :
  /_SHOES_VANITY/.test(id) ? "Shoes" :
  /_BACKPACK_VANITY/.test(id) ? "Backpack" :
  /_OFF_VANITY/.test(id) ? "Offhand" :
  /VANITY_(2H|MAIN)/.test(id) ? "Weapon" : "Other";

const slotOrder = { Armor: 0, Cape: 1, Head: 2, Shoes: 3, Offhand: 4, Backpack: 5, Weapon: 6, Other: 7 };
const rows = ids.map((id) => ({
  id,
  slot: slotOf(id),
  name: (nameOf[id] || id).replace(/^Wardrobe Skin:\s*/, "").replace(/"/g, "'"),
}));
rows.sort((a, b) => slotOrder[a.slot] - slotOrder[b.slot] || a.name.localeCompare(b.name));

let cur = null;
for (const r of rows) {
  if (r.slot !== cur) { console.log(`  // -- ${r.slot} --`); cur = r.slot; }
  console.log(`  { id: "${r.id}", slot: "${r.slot}", name: "${r.name}" },`);
}
console.error(`generated ${rows.length} tradeable skin tokens`);
