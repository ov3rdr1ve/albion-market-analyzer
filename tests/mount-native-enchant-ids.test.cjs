/**
 * Test: every mount id in MOUNT_RECIPES is a real market id.
 *
 * Swiftclaw, Rageclaw, Spectral Bonehorse, Morgana Nightmare, Command Mammoth
 * and Caerleon Cottontail are .1 by nature (items.xml enchantmentlevel="1"):
 * the market, the AODP API and the sniffer's item index only know them as the
 * @1 id. Listing Swiftclaw under the bare T5_MOUNT_COUGAR_KEEPER meant sniffed
 * prices landed under an id the table never read, and the row showed 5.0.
 *
 * Run: node tests/mount-native-enchant-ids.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ctx = { console };
vm.createContext(ctx);
const load = (f) =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, { filename: f });
load("item-index.js");
load("data-mounts.js");
const known = new Set(Object.values(vm.runInContext("ALBION_ITEM_INDEX", ctx)));
const MOUNT_RECIPES = vm.runInContext("MOUNT_RECIPES", ctx);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Mount native-enchant id tests\n");

MOUNT_RECIPES.forEach((m) => {
  test(`${m.name} id ${m.id} is in the item index`, () =>
    assert.ok(known.has(m.id), `${m.id} is not a market id`));
  m.materials.filter((x) => /_MOUNT_/.test(x.matId)).forEach((x) => {
    test(`${m.name} mount input ${x.matId} is in the item index`, () =>
      assert.ok(known.has(x.matId), `${x.matId} is not a market id`));
  });
});

test("Swiftclaw is listed as T5_MOUNT_COUGAR_KEEPER@1", () => {
  const sw = MOUNT_RECIPES.find((m) => m.name.startsWith("Swiftclaw"));
  assert.strictEqual(sw.id, "T5_MOUNT_COUGAR_KEEPER@1");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
