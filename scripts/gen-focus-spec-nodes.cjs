/**
 * Generate the Focus Cost Efficiency (FCE) spec tables from achievements.xml.
 *
 * Every Destiny Board node carries focus-cost bonuses in the game dump:
 *
 *   <bonus type="craftingfocuscostreduction" bonus="B" mintier="4" maxtier="8">
 *     <itempattern pattern="T?_MAIN_ARCANESTAFF" />
 *   </bonus>
 *
 * A node at level L contributes  B * 100 * L  Focus Cost Efficiency points, and
 * the focus cost of an action is halved for every 10,000 FCE:
 *
 *   focusCost = baseCost * 0.5 ^ (totalFCE / 10000)
 *
 * A single node usually holds TWO bonus entries — a wide "category" one
 * (B ~= 0.15-0.6, matching the whole weapon/armor family) and its own "group"
 * one (B = 2.5, matching just the items it specializes in). Both scale with the
 * SAME node level, so the runtime only ever needs one 0-100 level per node.
 *
 * Verified totals with every node at 100 (see tests/focus-spec-catalog.test.cjs):
 *   refining          40,000 FCE -> 6.25%   (matches the in-game measurements)
 *   cooking / potions  55,000 FCE -> 2.21%   (matches the wiki)
 *   meat, butcher node only 28,000 FCE -> 540 base = 77 focus (in-game)
 *   gear              ~44,500 FCE -> ~4.6%
 *   furniture / mounts / journals     0 FCE -> base cost
 *
 * Outputs two files so neither is a monolith:
 *   js/focus-spec-nodes.js  - FOCUS_SPEC_NODES  { nodeId: { name, branch } }
 *   js/focus-spec-items.js  - FOCUS_SPEC_FAMILIES [[ [nodeId, bonus], ... ], ...]
 *                             FOCUS_SPEC_ITEM_FAMILY { itemId: familyIndex }
 *
 * Item ids are matched OFFLINE here (patterns + mintier/maxtier) so the browser
 * never runs a regex to price a craft.
 *
 * Usage:
 *   node scripts/gen-focus-spec-nodes.cjs [achievements.xml] [localization.json]
 *
 * achievements.xml defaults to the vendored copy in the repo root. The
 * localization dump (91 MB, ao-bin-dumps) is OPTIONAL — pass it to bake real
 * Destiny Board titles into the node table; without it node ids are prettified
 * ("CRAFT_REFINE_ORE_T5" -> "Ore Refining T5").
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const xmlPath = process.argv[2] || path.join(root, "data", "dumps", "achievements.xml");
const locPath = process.argv[3] || null;

const FOCUS_BONUS_TYPES = ["craftingfocuscostreduction", "farmingfocuscostreduction"];

// ---------------------------------------------------------------- node parsing

// Split on element starts, then keep only REAL nodes: <achievement id="X" />
// references inside <parentachievements> split too, but carry no rewards block.
function parseNodes(xml) {
  const blocks = xml
    .split(/<(?=templateachievement|achievement )/)
    .slice(1)
    .filter((b) => /<baserewards|<masterylevels/.test(b));

  const nodes = [];
  for (const block of blocks) {
    const id = (block.match(/\sid="([^"]+)"/) || [])[1];
    if (!id) continue;
    const titleTag = (block.match(/<title tag="([^"]+)"/) || [])[1] || null;

    // Read the attributes out of the tag rather than matching them in a fixed
    // order. Four elements in the dump are written `mintier maxtier type bonus`
    // instead of `type bonus mintier maxtier` — and all four are the big GROUP
    // bonus of a specialization (CRAFT_BAG_BAG 3.1, CRAFT_BAG_INSIGHT 3.1,
    // CRAFT_CAPE_CAPE 3.4, CRAFT_TOOL_SIEGEHAMMER_SIEGEHAMMER 3.1). An
    // order-sensitive regex dropped them silently and priced a maxed bag, cape
    // and siege hammer at 9,000/6,000 FCE instead of 40,000. Do not "tidy" this
    // back into one regex: XML attribute order carries no meaning.
    //
    // <overridemasterylevel> RESTATES a node's rewards at a given mastery level
    // (an override, not an addition). FARM_ANIMALS is the only node in the dump
    // that carries a focus bonus there, and summing both copies doubled its
    // 1/level to 2/level — a maxed breeder read 40,000 FCE instead of 30,000, so
    // nurture cost came out half the game's. Drop those sections before scanning.
    const rewards = block.replace(/<overridemasterylevel[\s\S]*?<\/overridemasterylevel>/g, "");
    const bonuses = [];
    const tagRe = /<bonus\s([^>]*?)(\/)?>/g;
    let m;
    while ((m = tagRe.exec(rewards))) {
      const attrs = m[1];
      const type = (attrs.match(/type="([^"]+)"/) || [])[1];
      if (FOCUS_BONUS_TYPES.indexOf(type) === -1) continue;
      // \b so the element name isn't read as the `bonus="…"` attribute.
      const value = parseFloat((attrs.match(/\bbonus="([\d.]+)"/) || [])[1]);
      if (!Number.isFinite(value)) continue;
      // A self-closing <bonus …/> owns no patterns; taking everything up to the
      // next </bonus> would hand it the following bonus's item list.
      let body = "";
      if (!m[2]) {
        const end = rewards.indexOf("</bonus>", tagRe.lastIndex);
        if (end !== -1) body = rewards.slice(tagRe.lastIndex, end);
      }
      bonuses.push({
        value,
        minTier: parseInt((attrs.match(/mintier="(\d+)"/) || [])[1] || "0", 10),
        maxTier: parseInt((attrs.match(/maxtier="(\d+)"/) || [])[1] || "99", 10),
        patterns: [...body.matchAll(/itempattern pattern="([^"]+)"/g)].map((x) => x[1]),
      });
    }
    if (bonuses.length) nodes.push({ id, titleTag, bonuses });
  }
  return nodes;
}

// Which settings group the node belongs to — drives which tables list it.
function branchOf(nodeId) {
  if (nodeId.startsWith("CRAFT_REFINE_")) return "refine";
  if (nodeId.startsWith("CRAFT_TOOL_")) return "tool";
  if (nodeId.startsWith("CRAFT_CAPE")) return "cape";
  if (nodeId.startsWith("CRAFT_BAG")) return "cape";
  if (nodeId.startsWith("CRAFT_")) return "gear";
  if (nodeId.startsWith("FARM_COOK")) return "cook";
  if (nodeId.startsWith("FARM_ALCHEMIST")) return "alchemy";
  if (nodeId.startsWith("FARM_ANIMALS")) return "breeding";
  if (nodeId.startsWith("FARM_CROPS") || nodeId.startsWith("FARM_HERBS")) return "farming";
  return "other";
}

const REFINE_WORD = { ORE: "Ore", WOOD: "Wood", FIBER: "Fiber", HIDE: "Hide", ROCK: "Rock" };

// The panel groups nodes by SPECIALIZATION FAMILY, so the five tiers of Fiber
// refining sit together instead of interleaving with Hide and Ore alphabetically,
// and a weapon line sits under its own mastery node.
//
// Two shapes in the data:
//   • refining is a tier CHAIN (CRAFT_REFINE_FIBER_T4…T8) with no parent node of
//     its own → family = the id minus the tier, ordered by tier.
//   • everything else is "mastery node + specialists" whose ids extend the
//     mastery id (CRAFT_ARCANESTAFFS + CRAFT_ARCANESTAFFS_ARCANE, FARM_COOK +
//     FARM_COOK_SOUP) → family = the longest OTHER node id that prefixes it.
// (The dump's <parentachievements> can't be used for this: it lists a node's
// children as well as its parent, and refining chains T4→T5→…→T8.)
function groupOf(nodeId, nodeIds) {
  const refine = nodeId.match(/^(CRAFT_REFINE_[A-Z]+)_T\d$/);
  if (refine) return refine[1];
  let best = null;
  for (const candidate of nodeIds) {
    if (candidate === nodeId) continue;
    if (!nodeId.startsWith(candidate + "_")) continue;
    if (!best || candidate.length > best.length) best = candidate;
  }
  return best || nodeId;
}

// Rows sort by tier inside a refining group, and mastery-node-first elsewhere.
function groupOrder(nodeId) {
  const refine = nodeId.match(/^CRAFT_REFINE_[A-Z]+_T(\d)$/);
  if (refine) return Number(refine[1]);
  return 0;
}

// A refining group has no node of its own to borrow a title from.
const REFINE_WORD_ES = { ORE: "mineral", WOOD: "madera", FIBER: "fibra", HIDE: "cuero", ROCK: "piedra" };
function refineGroupTitle(groupId) {
  const res = (groupId.match(/^CRAFT_REFINE_([A-Z]+)$/) || [])[1];
  if (!res) return null;
  return {
    en: `${REFINE_WORD[res] || res} Refining`,
    es: REFINE_WORD_ES[res] ? `Refinado de ${REFINE_WORD_ES[res]}` : null,
  };
}

// Readable fallback name when no localization dump is supplied.
function prettifyNodeId(nodeId) {
  const refine = nodeId.match(/^CRAFT_REFINE_([A-Z]+)_T(\d)$/);
  if (refine) return `${REFINE_WORD[refine[1]] || refine[1]} Refining T${refine[2]}`;
  const words = nodeId
    .replace(/^(CRAFT|FARM)_/, "")
    .split("_")
    .map((w) => (/^T\d$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
  return words.join(" ");
}

// Destiny Board titles live in the (huge) TMX-shaped localization dump:
//   { "@tuid": "@DESTINYBOARD_TITLE_X",
//     "tuv": [ { "@xml:lang": "EN-US", "seg": "Adept's Smelter" }, ... ] }
// Split on the tuid key and only parse the chunks we actually want, so the
// 91 MB file never becomes 100k parsed objects.
function loadTitles(file, tags) {
  const wanted = new Set(tags.filter(Boolean).map((t) => t.replace(/^@/, "")));
  const found = {};
  const chunks = fs.readFileSync(file, "utf-8").split('"@tuid":');
  for (const chunk of chunks) {
    const key = (chunk.match(/^\s*"@?([A-Z0-9_]+)"/) || [])[1];
    if (!key || !wanted.has(key)) continue;
    const seg = (lang) => {
      const m = chunk.match(
        new RegExp(`"@xml:lang":\\s*"${lang}",\\s*"seg":\\s*"((?:[^"\\\\]|\\\\.)*)"`)
      );
      return m ? JSON.parse(`"${m[1]}"`) : null;
    };
    const en = seg("EN-US");
    if (en) found[key] = { en, es: seg("ES-ES") };
  }
  return found;
}

/**
 * Titles already baked into js/focus-spec-nodes.js, keyed by title tag so they
 * slot straight into the `titles` map loadTitles produces. Lets the generator be
 * re-run for a DATA fix (a mis-parsed bonus) without the 91 MB localization dump
 * and without losing the EN/ES node names. Silently empty on a first run.
 */
function previousTitles(nodes) {
  const generated = path.join(root, "js", "focus-spec-nodes.js");
  if (!fs.existsSync(generated)) return {};
  let table;
  try {
    ({ FOCUS_SPEC_NODES: table } = require(generated));
  } catch (e) {
    return {};
  }
  const titles = {};
  for (const node of nodes) {
    const previous = table[node.id];
    if (!node.titleTag || !previous || !previous.name) continue;
    titles[node.titleTag.replace(/^@/, "")] = { en: previous.name, es: previous.nameEs || null };
  }
  return titles;
}

// ---------------------------------------------------------------- item mapping

function patternToRegExp(pattern) {
  // Patterns use `?` for one tier char and `*` for "anything after"; ids are
  // plain [A-Z0-9_] plus the @n enchant suffix the app appends.
  const body = pattern
    .split("?")
    .join("[A-Za-z0-9]")
    .split("*")
    .join("[A-Za-z0-9_@]*");
  return new RegExp(`^${body}$`);
}

function tierOf(itemId) {
  const m = itemId.match(/^T(\d)_/);
  return m ? parseInt(m[1], 10) : 0;
}

// Enchantment is not part of the Destiny Board's item identity: the narrow
// "group" patterns are exact ids (`T?_SHOES_PLATE_AVALON`), so an enchanted
// `..._AVALON@2` would otherwise only pick up the wide category bonus and land
// in a different, cheaper family than its own base item.
function baseItemId(itemId) {
  return itemId.replace(/@\d+$/, "").replace(/_LEVEL\d+$/, "");
}

// Compile every pattern once — the generator does ~7k items x ~370 nodes.
function compilePatterns(nodes) {
  const compiled = new Map();
  for (const node of nodes) {
    for (const bonus of node.bonuses) {
      compiled.set(bonus, bonus.patterns.map(patternToRegExp));
    }
  }
  return compiled;
}

// Every node bonus that applies to this item, as [nodeId, bonusPerLevel] pairs
// merged per node (a node's category + group bonuses add up).
function familyFor(rawItemId, nodes, compiled) {
  const itemId = baseItemId(rawItemId);
  const tier = tierOf(itemId);
  const perNode = new Map();
  for (const node of nodes) {
    let sum = 0;
    for (let i = 0; i < node.bonuses.length; i++) {
      const bonus = node.bonuses[i];
      if (tier < bonus.minTier || tier > bonus.maxTier) continue;
      const regexps = compiled.get(bonus);
      if (regexps.some((rx) => rx.test(itemId))) sum += bonus.value;
    }
    if (sum > 0) perNode.set(node.id, +sum.toFixed(4));
  }
  return [...perNode.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

// Ids the app prices with focus: everything in focus-costs.json (crafts,
// refines, consumables) plus the farming/breeding ids, whose focus cost is a
// per-cycle constant rather than an items.xml craftingfocus.
function collectItemIds() {
  const ids = new Set(
    Object.keys(JSON.parse(fs.readFileSync(path.join(root, "js", "focus-costs.json"), "utf-8")))
  );
  const items = fs.readFileSync(path.join(root, "data", "dumps", "items.xml"), "utf-8");
  const farmRe = /uniquename="(T\d_FARM_[A-Z0-9_]+)"/g;
  let m;
  while ((m = farmRe.exec(items))) ids.add(m[1]);
  return [...ids].sort();
}

// ---------------------------------------------------------------- file writing

function writeNodesFile(nodes, titles) {
  const ids = nodes.map((n) => n.id);
  const titleOf = (node) => {
    const tag = node.titleTag ? node.titleTag.replace(/^@/, "") : null;
    const title = (tag && titles[tag]) || null;
    return { en: (title && title.en) || prettifyNodeId(node.id), es: title && title.es };
  };

  const groups = {}; // groupId -> { branch, nodes: [...] }
  nodes.forEach((node) => {
    const group = groupOf(node.id, ids);
    (groups[group] = groups[group] || { branch: branchOf(node.id), nodes: [] }).nodes.push(node.id);
  });

  const entries = nodes
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((node) => {
      const title = titleOf(node);
      const es = title.es ? `, nameEs: ${JSON.stringify(title.es)}` : "";
      return `  ${JSON.stringify(node.id)}: { name: ${JSON.stringify(title.en)}, branch: ${JSON.stringify(
        branchOf(node.id)
      )}, group: ${JSON.stringify(groupOf(node.id, ids))}, order: ${groupOrder(node.id)}${es} },`;
    });

  const byId = {};
  nodes.forEach((node) => { byId[node.id] = node; });
  const groupEntries = Object.keys(groups)
    .sort()
    .map((groupId) => {
      const title = refineGroupTitle(groupId) ||
        (byId[groupId] ? titleOf(byId[groupId]) : { en: prettifyNodeId(groupId), es: null });
      const es = title.es ? `, nameEs: ${JSON.stringify(title.es)}` : "";
      return `  ${JSON.stringify(groupId)}: { name: ${JSON.stringify(title.en)}, branch: ${JSON.stringify(
        groups[groupId].branch
      )}${es} },`;
    });

  const out = `// GENERATED by scripts/gen-focus-spec-nodes.cjs — do not edit by hand.
//
// Every Destiny Board node that reduces focus cost. The user sets one level
// (0-100) per node; js/focus-spec.js turns those levels into Focus Cost
// Efficiency and a focus multiplier.
//
//   branch — which tables' ⚙ panels list the node
//   group  — the specialization family it belongs to (a weapon line and its
//            specialists, or the five tiers of one refining resource), so the
//            panel can show "Fiber Refining: T4…T8" as one block
//   order  — sort key inside the group (refining tier; 0 = the mastery node)
const FOCUS_SPEC_NODES = {
${entries.join("\n")}
};

// Display names for the groups above. A refining group has no Destiny Board node
// of its own, so its title is derived; every other group is named after its
// mastery node.
const FOCUS_SPEC_GROUPS = {
${groupEntries.join("\n")}
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FOCUS_SPEC_NODES, FOCUS_SPEC_GROUPS };
}
`;
  fs.writeFileSync(path.join(root, "js", "focus-spec-nodes.js"), out);
  return { nodes: entries.length, groups: groupEntries.length };
}

function writeItemsFile(families, itemFamily) {
  const familyLines = families.map(
    (f) => `  [${f.map(([id, b]) => `[${JSON.stringify(id)},${b}]`).join(",")}],`
  );
  const itemLines = Object.keys(itemFamily)
    .sort()
    .map((id) => `  ${JSON.stringify(id)}: ${itemFamily[id]},`);

  const out = `// GENERATED by scripts/gen-focus-spec-nodes.cjs — do not edit by hand.
//
// FOCUS_SPEC_FAMILIES[i] is the list of [nodeId, bonusPerLevel] pairs that apply
// to every item mapped to family i. Items sharing a node set share a family, so
// this stays a few hundred lists instead of one per item. Ids absent from
// FOCUS_SPEC_ITEM_FAMILY have no focus specialization at all (mounts, furniture,
// journals, combine crafts) and pay their base focus cost.
const FOCUS_SPEC_FAMILIES = [
${familyLines.join("\n")}
];

const FOCUS_SPEC_ITEM_FAMILY = {
${itemLines.join("\n")}
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { FOCUS_SPEC_FAMILIES, FOCUS_SPEC_ITEM_FAMILY };
}
`;
  fs.writeFileSync(path.join(root, "js", "focus-spec-items.js"), out);
}

// ---------------------------------------------------------------------- main

function main() {
  const nodes = parseNodes(fs.readFileSync(xmlPath, "utf-8"));
  console.log(`Parsed ${nodes.length} focus-cost nodes from ${path.basename(xmlPath)}`);

  // Titles come from the localization dump when one is passed, and otherwise
  // from the last generated file — the dump is 91 MB and is not vendored, so a
  // routine regenerate would otherwise replace 367 real Destiny Board names with
  // prettified ids ("Cook Meat" for "Butcher") and nobody would know which row
  // to type a level into.
  const titles = Object.assign(
    previousTitles(nodes),
    locPath ? loadTitles(locPath, nodes.map((n) => n.titleTag)) : {}
  );
  console.log(`Resolved ${Object.keys(titles).length} Destiny Board titles`);

  const compiled = compilePatterns(nodes);

  const familyIndex = new Map(); // serialized family -> index
  const families = [];
  const itemFamily = {};
  for (const itemId of collectItemIds()) {
    const family = familyFor(itemId, nodes, compiled);
    if (!family.length) continue; // no spec at all -> base cost
    const key = JSON.stringify(family);
    let idx = familyIndex.get(key);
    if (idx === undefined) {
      idx = families.length;
      families.push(family);
      familyIndex.set(key, idx);
    }
    itemFamily[itemId] = idx;
  }

  const counts = writeNodesFile(nodes, titles);
  writeItemsFile(families, itemFamily);
  console.log(
    `Wrote js/focus-spec-nodes.js (${counts.nodes} nodes in ${counts.groups} groups) and ` +
      `js/focus-spec-items.js (${families.length} families, ${Object.keys(itemFamily).length} items)`
  );
}

// The parsing half is exported so tests/focus-spec-bonus-parse.test.cjs can feed
// it synthetic XML; generating only happens when the file is run directly.
if (require.main === module) main();

module.exports = { parseNodes, compilePatterns, familyFor, patternToRegExp, branchOf, groupOf };
