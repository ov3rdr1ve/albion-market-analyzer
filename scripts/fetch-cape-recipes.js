/**
 * Fetch cape crafting recipes from the Albion gameinfo API and emit
 * ready-to-paste GEAR_CAPES entries for Smuggler, Brecilien, Avalonian
 * across tiers T4-T8.
 *
 * Endpoint: https://gameinfo.albiononline.com/api/gameinfo/items/{ID}/data
 * Parses: enchantments[0].craftingRequirements.craftResourceList
 *
 * Usage: node scripts/fetch-cape-recipes.js > /tmp/new-capes.js
 */
const https = require("https");

const FAMILIES = [
  { idStem: "CAPEITEM_SMUGGLER",     label: "Smuggler" },
  { idStem: "CAPEITEM_FW_BRECILIEN", label: "Brecilien" },
  { idStem: "CAPEITEM_AVALON",       label: "Avalonian" },
];

const TIER_PREFIX = {
  T4: "Adept's",
  T5: "Expert's",
  T6: "Master's",
  T7: "Grandmaster's",
  T8: "Elder's",
};

const TIERS = ["T4", "T5", "T6", "T7", "T8"];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "albion-market-cape-fetch" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
        });
      })
      .on("error", reject);
  });
}

function formatEntry(id, name, materials) {
  const lines = [];
  lines.push("  {");
  lines.push(`    "id": "${id}",`);
  lines.push(`    "name": "${name}",`);
  lines.push(`    "materials": [`);
  materials.forEach((m, i) => {
    const comma = i < materials.length - 1 ? "," : "";
    lines.push(`      {`);
    lines.push(`        "matId": "${m.matId}",`);
    lines.push(`        "count": ${m.count}`);
    lines.push(`      }${comma}`);
  });
  lines.push(`    ],`);
  lines.push(`    "craftType": "cape",`);
  lines.push(`    "group": "normal"`);
  lines.push("  },");
  return lines.join("\n");
}

async function main() {
  const output = [];
  for (const { idStem, label } of FAMILIES) {
    for (const tier of TIERS) {
      const id = `${tier}_${idStem}`;
      const url = `https://gameinfo.albiononline.com/api/gameinfo/items/${id}/data`;
      process.stderr.write(`Fetching ${id}... `);
      let data;
      try { data = await fetchJSON(url); }
      catch (e) {
        process.stderr.write(`FAIL (${e.message})\n`);
        process.exit(1);
      }
      const ench0 =
        data && data.enchantments && Array.isArray(data.enchantments.enchantments)
          ? data.enchantments.enchantments[0]
          : null;
      const list = ench0 && ench0.craftingRequirements && ench0.craftingRequirements.craftResourceList;
      if (!Array.isArray(list) || list.length === 0) {
        process.stderr.write(`FAIL (no craftResourceList)\n`);
        process.exit(1);
      }
      const materials = list.map((r) => ({ matId: r.uniqueName, count: r.count }));
      const name = `${TIER_PREFIX[tier]} ${label} Cape [${tier}]`;
      output.push(formatEntry(id, name, materials));
      process.stderr.write(`ok (${materials.length} mats)\n`);
    }
  }
  process.stdout.write(output.join("\n") + "\n");
}

main().catch((e) => {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
});
