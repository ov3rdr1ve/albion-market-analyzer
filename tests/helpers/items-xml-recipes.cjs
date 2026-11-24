/**
 * Shared items.xml recipe parser for the recipe-audit tests.
 *
 * items.xml is the wholesale ao-bin-dumps copy at the repo root — the source of
 * truth every hand-maintained recipe catalog in js/ is supposed to mirror. Two
 * tests already parsed it inline with per-element regexes
 * (consumable-recipes-match-itemsxml, buildings-catalog). Those only work when
 * you know the element name up front, and craft recipes live under many:
 * <furnitureitem>, <mount>, <weapon>, <equipmentitem>, <consumableitem>,
 * <simpleitem>, <trackingitem>, ...
 *
 * A "nearest preceding uniquename=" scan is NOT a safe generalisation: item
 * blocks contain nested tags that carry their own uniquename (<mountspell>,
 * <craftspell>, <enchantment> children) and self-closing sibling items sit
 * directly above <craftingrequirements> blocks. That mis-keys recipes and
 * silently drops real ones — it is why a 2x drift in the gatherer ARMOR
 * recipes went unnoticed. So this parser walks a real element stack.
 *
 * Repo files only — no network, no DB.
 */

const fs = require("fs");
const path = require("path");

const ITEMS_XML = path.join(__dirname, "..", "..", "data", "dumps", "items.xml");

// One tag at a time. The alternation lets attribute values contain ">".
const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)((?:"[^"]*"|[^>])*?)(\/?)>/g;

const attr = (raw, name) => {
  const m = raw.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
};

/**
 * gameinfo/items.xml refined-enchant ids carry a _LEVELn suffix; the market
 * (AODP) id for the same resource is _LEVELn@n. Equipment is plain @n and has
 * no _LEVEL suffix, so this is a no-op for it.
 */
function toMarketId(uniquename) {
  return String(uniquename).replace(/_LEVEL(\d)$/, "_LEVEL$1@$1");
}

let _recipes = null;
let _names = null;

function parse() {
  if (_recipes) return;

  // Comments first: <!--...--> blocks in items.xml contain live-looking tags
  // (commented-out <skins>, spell blocks). Same convention as buildings-catalog.
  const xml = fs.readFileSync(ITEMS_XML, "utf8").replace(/<!--[\s\S]*?-->/g, "");

  const recipes = {};
  const names = new Set();
  const stack = [];
  // Keys whose first <craftingrequirements> has already been consumed. Later
  // blocks on the same element are enchant/alternate variants (e.g. the twin
  // token-substitute block on artifact gear) and must not overwrite the base.
  const claimed = new Set();

  /**
   * Which catalog id(s) a <craftingrequirements> block belongs to.
   *
   * Returns MORE THAN ONE key when the owning element carries its own
   * enchantmentlevel: items.xml marks some inherently-enchanted items that way
   * (the Battle Mammoth and the Keeper Cougar are enchantmentlevel="1" on the
   * <mount> element), and the app addresses those by the PLAIN id, while it
   * addresses the dark easter rabbit by "...@1". Both spellings are indexed so
   * the audit never has to guess which convention a catalog picked.
   */
  const ownerKeysFor = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const el = stack[i];
      if (el.name === "enchantment" && el.enchantmentlevel) {
        // <enchantment> sits inside its item; find the item that owns it.
        for (let j = i - 1; j >= 0; j--) {
          if (stack[j].uniquename) return [stack[j].uniquename + "@" + el.enchantmentlevel];
        }
        return [];
      }
      if (el.uniquename) {
        const lvl = el.enchantmentlevel;
        return lvl && lvl !== "0" ? [el.uniquename, el.uniquename + "@" + lvl] : [el.uniquename];
      }
    }
    return [];
  };

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(xml)) !== null) {
    const closing = m[1] === "/";
    const name = m[2];
    const raw = m[3] || "";
    const selfClosing = m[4] === "/";

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const uniquename = attr(raw, "uniquename");
    if (uniquename) names.add(uniquename);

    if (name === "craftresource") {
      const top = stack[stack.length - 1];
      if (!top || top.name !== "craftingrequirements" || !top.key || !top.collect) continue;
      if (!uniquename) continue;
      const count = attr(raw, "count");
      // An inherently-enchanted input (the Rageclaw consumes the Swiftclaw,
      // enchantmentlevel="1") trades only as its @n id.
      const lvl = attr(raw, "enchantmentlevel");
      const marketId = toMarketId(uniquename);
      top.collect.push({
        matId: lvl && lvl !== "0" && !marketId.includes("@") ? marketId + "@" + lvl : marketId,
        count: count === null ? 1 : parseInt(count, 10),
        noReturn: attr(raw, "maxreturnamount") === "0",
      });
      continue;
    }

    if (selfClosing) continue;

    const el = {
      name,
      uniquename,
      enchantmentlevel: attr(raw, "enchantmentlevel"),
      key: null,
      collect: null,
    };
    stack.push(el);

    if (name === "craftingrequirements") {
      const keys = ownerKeysFor().filter((k) => !claimed.has(k));
      if (keys.length) {
        const collect = [];
        for (const k of keys) {
          claimed.add(k);
          recipes[k] = collect;
        }
        el.key = keys[0];
        el.collect = collect;
      }
    }
  }

  // A <craftingrequirements> with zero <craftresource> children (pure silver
  // crafts, uncraftable stubs) is not a recipe — drop it so callers can treat
  // "absent" as "not craftable from materials".
  for (const k of Object.keys(recipes)) {
    if (recipes[k].length === 0) delete recipes[k];
  }

  _recipes = recipes;
  _names = names;
}

/** @returns {Object<string, Array<{matId:string,count:number,noReturn:boolean}>>} */
function parseItemsXmlRecipes() {
  parse();
  return _recipes;
}

/** Every uniquename in items.xml — lets a caller tell "id absent" from "present but not craftable". */
function itemsXmlUniqueNames() {
  parse();
  return _names;
}

/** Order-independent comparable signature: "matId:count[:NR]" joined. */
function recipeSignature(mats, { withNoReturn = false } = {}) {
  return (mats || [])
    .map((m) => `${m.matId}:${m.count}${withNoReturn && m.noReturn ? ":NR" : ""}`)
    .sort()
    .join(" | ");
}

module.exports = { parseItemsXmlRecipes, itemsXmlUniqueNames, recipeSignature, toMarketId, ITEMS_XML };
