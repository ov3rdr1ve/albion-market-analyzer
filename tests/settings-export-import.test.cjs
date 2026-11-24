/**
 * Test: the Export/Import Settings round-trip carries ⚙ Specs levels, not just
 * manual prices.
 *
 * Symptom that motivated this: exporting from one install and importing into
 * another moved the price overrides but left every table back at max spec, so a
 * half-levelled refiner silently re-priced as a maxed one.
 *
 * Covers the two halves:
 *   1. exportSpecLevels / importSpecLevels (js/focus-spec.js) — scope discovery,
 *      sparse storage, exact replacement.
 *   2. The v2 bundle shape and the v1 (bare price map) fallback that the
 *      import handler in js/app.js discriminates on.
 *
 * Run: node tests/settings-export-import.test.cjs
 */

const assert = require("assert");
const { loadFocusSpec } = require("./helpers/load-focus-spec.cjs");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("Settings Export/Import Tests\n");

// ── exportSpecLevels ───────────────────────────────────────────────────────
const EXPORT_CASES = [
  {
    name: "no custom levels exports an empty map",
    edits: [],
    expected: {},
  },
  {
    name: "one scope exports only its non-default nodes",
    edits: [["refining-table", "CRAFT_REFINE_ORE_T5", 60]],
    expected: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
  },
  {
    name: "several scopes each export separately",
    edits: [
      ["refining-table", "CRAFT_REFINE_ORE_T5", 60],
      ["crafting-table", "CRAFT_SWORDS_SWORD", 40],
    ],
    expected: {
      "refining-table": { CRAFT_REFINE_ORE_T5: 60 },
      "crafting-table": { CRAFT_SWORDS_SWORD: 40 },
    },
  },
  {
    name: "a node put back to its default drops out of the export",
    edits: [
      ["refining-table", "CRAFT_REFINE_ORE_T5", 60],
      ["refining-table", "CRAFT_REFINE_ORE_T5", 0], // a refining tier defaults to 0
    ],
    expected: {},
  },
  {
    name: "a maxed specialization is a real value, not a missing one",
    edits: [["refining-table", "CRAFT_REFINE_ORE_T5", 100]],
    expected: { "refining-table": { CRAFT_REFINE_ORE_T5: 100 } },
  },
  {
    name: "a mastery below its 100 default exports too",
    edits: [["consumable-table", "FARM_COOK", 40]],
    expected: { "consumable-table": { FARM_COOK: 40 } },
  },
];

EXPORT_CASES.forEach((c) => {
  test(`export: ${c.name}`, () => {
    const spec = loadFocusSpec();
    c.edits.forEach(([scope, node, level]) => spec.setSpecLevel(scope, node, level));
    assert.deepStrictEqual(spec.exportSpecLevels(), c.expected);
  });
});

test("export ignores unrelated localStorage keys", () => {
  const store = { useFocus: "1", premiumAccount: "0", "priceOverrides": "{}" };
  const spec = loadFocusSpec(store);
  spec.setSpecLevel("refining-table", "CRAFT_REFINE_ORE_T5", 60);
  assert.deepStrictEqual(spec.exportSpecLevels(), {
    "refining-table": { CRAFT_REFINE_ORE_T5: 60 },
  });
});

// ── importSpecLevels ───────────────────────────────────────────────────────
const IMPORT_CASES = [
  {
    name: "empty machine takes the whole imported profile",
    existing: [],
    payload: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
    expected: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
  },
  {
    name: "import replaces a conflicting level rather than merging it",
    existing: [["refining-table", "CRAFT_REFINE_ORE_T5", 20]],
    payload: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
    expected: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
  },
  {
    name: "scopes absent from the file are reset to their defaults",
    existing: [["crafting-table", "CRAFT_SWORDS_SWORD", 40]],
    payload: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
    expected: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
  },
  {
    name: "an empty payload clears every scope",
    existing: [
      ["crafting-table", "CRAFT_SWORDS_SWORD", 40],
      ["refining-table", "CRAFT_REFINE_ORE_T5", 60],
    ],
    payload: {},
    expected: {},
  },
  {
    name: "a missing specLevels block is treated as empty, not a throw",
    existing: [["refining-table", "CRAFT_REFINE_ORE_T5", 60]],
    payload: undefined,
    expected: {},
  },
  {
    name: "out-of-range levels are clamped on the way in",
    existing: [],
    payload: { "refining-table": { CRAFT_REFINE_ORE_T5: 900, CRAFT_REFINE_WOOD_T5: -5 } },
    // 900 clamps to 100, -5 to 0 — and 0 IS a refining tier's default, so only
    // the clamped 100 is worth storing.
    expected: { "refining-table": { CRAFT_REFINE_ORE_T5: 100 } },
  },
];

IMPORT_CASES.forEach((c) => {
  test(`import: ${c.name}`, () => {
    const spec = loadFocusSpec();
    c.existing.forEach(([scope, node, level]) => spec.setSpecLevel(scope, node, level));
    spec.importSpecLevels(c.payload);
    assert.deepStrictEqual(spec.exportSpecLevels(), c.expected);
  });
});

test("import lands the exporting machine's focus costs, not the defaults", () => {
  const source = loadFocusSpec();
  source.setAllSpecLevels("refining-table", 100);
  const bundle = source.exportSpecLevels();

  const target = loadFocusSpec();
  assert.strictEqual(target.getItemFCE("T5_METALBAR", "refining-table"), 0,
    "a fresh machine has no refining levels typed");
  target.importSpecLevels(bundle);
  assert.strictEqual(target.getItemFCE("T5_METALBAR", "refining-table"), 40000);
  assert.strictEqual(target.hasCustomSpec("refining-table"), true);
});

test("round-trip through JSON survives (the file is written as JSON)", () => {
  const source = loadFocusSpec();
  source.setSpecLevel("refining-table", "CRAFT_REFINE_ORE_T5", 60);
  source.setSpecLevel("crafting-table", "CRAFT_SWORDS_SWORD", 40);

  const target = loadFocusSpec();
  target.importSpecLevels(JSON.parse(JSON.stringify(source.exportSpecLevels())));
  assert.deepStrictEqual(target.exportSpecLevels(), source.exportSpecLevels());
});

// ── Bundle build / read (js/settings-transfer.js) ───────────────────────────
// v1 files are the bare priceOverrides map; v2/v3 wrap it. readSettingsBundle
// tells them apart by the wrapper marks — item ids never collide with
// "format"/"overrides"/"specLevels" because they're all T*_ / UNIQUE_ ids.
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");

function loadTransfer(store = {}) {
  const localStorageStub = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
  const module_ = { exports: {} };
  new Function(
    "localStorage", "module",
    fs.readFileSync(path.join(ROOT, "js/settings-transfer.js"), "utf-8")
  )(localStorageStub, module_);
  const api = module_.exports;
  api.__store = store;
  return api;
}

const BUNDLE_CASES = [
  {
    name: "v3 bundle yields every block",
    file: {
      format: "albion-market-settings",
      version: 3,
      overrides: { T5_METALBAR: { Martlock: { buyOrder: 100 } } },
      volumeOverrides: { T5_METALBAR: { Martlock: { volume: 40 } } },
      cityForceOverrides: { T5_METALBAR: { buy: "Thetford" } },
      specLevels: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
      prefs: { useFocus: "0" },
    },
    expect: (b) => {
      assert.strictEqual(b.isBundle, true);
      assert.strictEqual(b.version, 3);
      assert.deepStrictEqual(b.volumeOverrides, { T5_METALBAR: { Martlock: { volume: 40 } } });
      assert.deepStrictEqual(b.cityForceOverrides, { T5_METALBAR: { buy: "Thetford" } });
      assert.deepStrictEqual(b.prefs, { useFocus: "0" });
    },
  },
  {
    name: "v2 bundle reads with empty v3 blocks, not undefined",
    file: {
      format: "albion-market-settings",
      version: 2,
      overrides: { T5_METALBAR: { Martlock: { buyOrder: 100 } } },
      specLevels: { "refining-table": { CRAFT_REFINE_ORE_T5: 60 } },
    },
    expect: (b) => {
      assert.strictEqual(b.isBundle, true);
      assert.deepStrictEqual(b.volumeOverrides, {});
      assert.deepStrictEqual(b.cityForceOverrides, {});
      assert.deepStrictEqual(b.prefs, {});
      assert.strictEqual(b.roadsPortals, null);
    },
  },
  {
    name: "v1 bare price map still imports as prices",
    file: { T5_METALBAR: { Martlock: { buyOrder: 100 } } },
    expect: (b) => {
      assert.strictEqual(b.isBundle, false);
      assert.deepStrictEqual(b.overrides, { T5_METALBAR: { Martlock: { buyOrder: 100 } } });
      assert.deepStrictEqual(b.specLevels, {});
    },
  },
  {
    name: "a volumes-only bundle is recognised as a bundle",
    file: { volumeOverrides: { T5_METALBAR: { Martlock: { volume: 40 } } } },
    expect: (b) => {
      assert.strictEqual(b.isBundle, true);
      assert.deepStrictEqual(b.overrides, {});
    },
  },
  {
    name: "junk blocks degrade to empty objects",
    file: { format: "albion-market-settings", version: 3, overrides: 7, prefs: "nope" },
    expect: (b) => {
      assert.deepStrictEqual(b.overrides, {});
      assert.deepStrictEqual(b.prefs, {});
    },
  },
];

BUNDLE_CASES.forEach((c) => {
  test(`bundle: ${c.name}`, () => {
    c.expect(loadTransfer().readSettingsBundle(c.file));
  });
});

test("bundle: a non-object file reads as empty, not a throw", () => {
  const t = loadTransfer();
  [null, 42, "text", []].forEach((junk) => {
    const b = t.readSettingsBundle(junk);
    assert.strictEqual(b.isBundle, false);
    assert.deepStrictEqual(b.overrides, {});
  });
});

// ── prefs / panels round-trip ──────────────────────────────────────────────
test("prefs: only whitelisted keys are exported", () => {
  const store = {
    useFocus: "0",
    premiumAccount: "0",
    stationFee: "1200",
    orderType: "instant",
    caerleonRoutes: "true",
    showAllItems: "1",
    appLang: "es",
    dailyProductionBonus: '{"sword":0.2}',
    dailyBonusCleared: "true", // legacy leftover: the Clear checkbox is gone
    roadsRealmgate: "1301",
    roadsRoutePrefer: "fastest",
    journalFillTier: "8",    // legacy leftover: the Gathering Tier control is gone
    apiServer: "west",       // machine-local
    monitorUpload: "1",      // machine-local
    "table-collapsed-refining-table": "1", // window layout
  };
  const t = loadTransfer(store);
  const bundle = t.buildSettingsBundle({ storage: undefined });
  assert.deepStrictEqual(bundle.prefs, {
    useFocus: "0",
    premiumAccount: "0",
    stationFee: "1200",
    orderType: "instant",
    caerleonRoutes: "true",
    showAllItems: "1",
    appLang: "es",
    dailyProductionBonus: '{"sword":0.2}',
    roadsRealmgate: "1301",
    roadsRoutePrefer: "fastest",
  });
  assert.ok(!("journalFillTier" in bundle.prefs),
    "the removed Gathering Tier key must not travel");
  assert.ok(!("dailyBonusCleared" in bundle.prefs),
    "the removed Clear-checkbox key must not travel either");
  assert.strictEqual(bundle.version, 3);
  assert.strictEqual(bundle.format, "albion-market-settings");
});

test("prefs: import writes carried keys and clears the rest", () => {
  const store = { useFocus: "0", stationFee: "1200", apiServer: "west" };
  const t = loadTransfer(store);
  t.applyStoredKeys({ premiumAccount: "0" }, t.TRANSFER_PREF_KEYS);
  assert.strictEqual(store.premiumAccount, "0");
  assert.strictEqual(store.useFocus, undefined, "key absent from the file is cleared");
  assert.strictEqual(store.stationFee, undefined);
  assert.strictEqual(store.apiServer, "west", "machine-local key is never touched");
});

// The Daily Production Bonus pref is an opaque JSON map string now — e.g.
// '{"sword":0.2}' or '{"refine:wood":0.1,"butcher":0.2}'. It must travel as
// the opaque string it is rather than being parsed, re-shaped or coerced by
// any JSON hop; only the restore path (parseDailyBonusJson) interprets it.
test("prefs: the Daily Production Bonus survives a round-trip as an opaque string", () => {
  [
    ['{"sword":0.2}', '{"sword":0.2}'],
    ['{"refine:wood":0.1,"butcher":0.2}', '{"refine:wood":0.1,"butcher":0.2}'],
    ["", ""],
  ].forEach(([exported, expected]) => {
    const store = { dailyProductionBonus: exported };
    const t = loadTransfer(store);
    const bundle = t.buildSettingsBundle({ storage: undefined });
    assert.strictEqual(bundle.prefs.dailyProductionBonus, exported);
    const dest = { dailyProductionBonus: "0" }; // a legacy scalar at the destination
    loadTransfer(dest).applyStoredKeys(bundle.prefs, t.TRANSFER_PREF_KEYS);
    assert.strictEqual(dest.dailyProductionBonus, expected);
  });
});

// The Clear checkbox pref is GONE (the checkbox died with the per-slot ✕
// buttons). It must not travel in new exports. Import neither reads nor
// writes the key — like journalFillTier, a stale value a receiving box still
// holds is left to that box's own one-time boot cleanup (js/app.js).
test("prefs: dailyBonusCleared is not exported and is ignored on import", () => {
  const store = { dailyBonusCleared: "true" };
  const t = loadTransfer(store);
  const bundle = t.buildSettingsBundle({ storage: undefined });
  assert.deepStrictEqual(bundle.prefs, {},
    "a removed pref must never appear in the prefs block");
  const dest = { dailyBonusCleared: "true" }; // a stale value at the destination
  loadTransfer(dest).applyStoredKeys(bundle.prefs, t.TRANSFER_PREF_KEYS);
  assert.strictEqual(dest.dailyBonusCleared, "true",
    "the un-whitelisted stale key is untouched by import — app.js's boot cleanup removes it");
});

test("prefs: panel keys travel in their own block", () => {
  const store = { "gold-chart-config": '{"style":"line"}', feesCalculatorSavedRows: "[]" };
  const t = loadTransfer(store);
  const bundle = t.buildSettingsBundle({});
  assert.deepStrictEqual(bundle.panels, {
    "gold-chart-config": '{"style":"line"}',
    feesCalculatorSavedRows: "[]",
  });
  assert.deepStrictEqual(bundle.prefs, {});
});

// ── Roads portals ──────────────────────────────────────────────────────────
const portalsModule = require(path.join(ROOT, "js", "data-roads-portals.js"));
const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;

function portalDeps(store) {
  return {
    loadPortalGraph: (_s, now) =>
      portalsModule.createPortalGraph(JSON.parse(store.roadsPortals || "null"), now),
    savePortalGraph: (graph) => {
      store.roadsPortals = JSON.stringify(graph.toJSON());
      return true;
    },
    // The page reads this off globalThis; the sandbox below has no globals of
    // its own, so it is injected like the other two.
    portalRetainUntil: portalsModule.portalRetainUntil,
  };
}

const PORTAL_CASES = [
  {
    name: "portals from the file land in an empty graph",
    existing: null,
    file: [{ fromZoneId: "TNL-001", toZoneId: "TNL-002", size: "group", expiresAt: NOW + 6 * HOUR, discoveredAt: NOW }],
    taken: 1,
    expectKeys: ["TNL-001|TNL-002"],
  },
  {
    // Measured: the file says somebody read this portal's own clock, so the
    // lapsed time is a fact and the row is worthless.
    name: "already-expired portals are dropped",
    existing: null,
    file: [{ fromZoneId: "TNL-001", toZoneId: "TNL-002", size: "group", expiresAt: NOW - HOUR, discoveredAt: NOW - 20 * HOUR, estimated: false }],
    taken: 0,
    expectKeys: [],
  },
  {
    // A guess, from a build that stamped 6h on everything. 8h after the
    // sighting the portal can easily still be standing, so it comes in.
    name: "a lapsed GUESS from an older file still comes in",
    existing: null,
    file: [{ fromZoneId: "TNL-001", toZoneId: "TNL-002", size: "group", expiresAt: NOW - 2 * HOUR, discoveredAt: NOW - 8 * HOUR, estimated: true }],
    taken: 1,
    expectKeys: ["TNL-001|TNL-002"],
  },
  {
    name: "a guess past the 24h ceiling is dropped",
    existing: null,
    file: [{ fromZoneId: "TNL-001", toZoneId: "TNL-002", size: "group", expiresAt: NOW - 19 * HOUR, discoveredAt: NOW - 25 * HOUR, estimated: true }],
    taken: 0,
    expectKeys: [],
  },
  {
    name: "an empty / missing block is a no-op",
    existing: null,
    file: null,
    taken: 0,
    expectKeys: [],
  },
];

PORTAL_CASES.forEach((c) => {
  test(`portals: ${c.name}`, () => {
    const store = {};
    if (c.existing) store.roadsPortals = JSON.stringify({ version: 1, portals: c.existing });
    const t = loadTransfer(store);
    const taken = t.importRoadsPortals(c.file, NOW, portalDeps(store));
    assert.strictEqual(taken, c.taken);
    const graph = portalsModule.createPortalGraph(JSON.parse(store.roadsPortals || "null"), NOW);
    assert.deepStrictEqual(graph.all(NOW).map((p) => p.key), c.expectKeys);
  });
});

test("portals: import MERGES with what this box already mapped", () => {
  const store = {
    roadsPortals: JSON.stringify({
      version: 1,
      portals: [{ fromZoneId: "TNL-100", toZoneId: "TNL-200", size: "solo", expiresAt: NOW + 2 * HOUR, discoveredAt: NOW, source: "sniffer" }],
    }),
  };
  const t = loadTransfer(store);
  const taken = t.importRoadsPortals(
    { version: 1, portals: [{ fromZoneId: "TNL-300", toZoneId: "TNL-400", size: "raid", expiresAt: NOW + 5 * HOUR, discoveredAt: NOW }] },
    NOW,
    portalDeps(store)
  );
  assert.strictEqual(taken, 1);
  const graph = portalsModule.createPortalGraph(JSON.parse(store.roadsPortals), NOW);
  assert.deepStrictEqual(graph.all(NOW).map((p) => p.key), ["TNL-100|TNL-200", "TNL-300|TNL-400"]);
});

// Both sides are MEASURED here on purpose: a guessed timer is held to the 24h
// ceiling either way, so it could not tell a working merge from a broken one.
test("portals: a longer expiry from the file wins on the same link", () => {
  const store = {
    roadsPortals: JSON.stringify({
      version: 1,
      portals: [{ fromZoneId: "TNL-100", toZoneId: "TNL-200", size: "solo", expiresAt: NOW + HOUR, discoveredAt: NOW, estimated: false, source: "sniffer" }],
    }),
  };
  const t = loadTransfer(store);
  t.importRoadsPortals(
    { version: 1, portals: [{ fromZoneId: "TNL-200", toZoneId: "TNL-100", size: "solo", expiresAt: NOW + 9 * HOUR, discoveredAt: NOW, estimated: false }] },
    NOW,
    portalDeps(store)
  );
  const graph = portalsModule.createPortalGraph(JSON.parse(store.roadsPortals), NOW);
  const portals = graph.all(NOW);
  assert.strictEqual(portals.length, 1, "the reversed pair is the same portal");
  assert.strictEqual(portals[0].expiresAt, NOW + 9 * HOUR);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
