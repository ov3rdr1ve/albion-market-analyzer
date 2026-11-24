/**
 * My Crafting List — persisted store (js/craft-list-store.js).
 *
 * Black-box over the module's public API: entries are references
 * ({tableId, rowKey, itemId, qty}), never row snapshots, so the only behaviour
 * worth pinning is identity/dedupe, quantity normalization, and the
 * localStorage round-trip (version gate + corruption tolerance).
 *
 * Run: node tests/craft-list-store.test.cjs
 */
const assert = require("assert");
const path = require("path");

const store = require(path.join(__dirname, "..", "js", "craft-list-store.js"));
const {
  CRAFT_LIST_KEY,
  CRAFT_LIST_VERSION_KEY,
  CRAFT_LIST_SCHEMA_VERSION,
  setCraftListStorage,
  craftListEntryId,
  craftListIdentity,
  normalizeCraftQty,
  getCraftList,
  hasCraftListEntry,
  addCraftListEntry,
  removeCraftListEntry,
  toggleCraftListEntry,
  setCraftListQty,
  clearCraftList,
  saveCraftListToStorage,
  loadCraftListFromStorage,
} = store;

// Storage stub mirroring the Storage interface (same shape as
// tests/helpers/load-focus-spec.cjs).
function makeStorage(backing) {
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null),
    setItem: (k, v) => { backing[k] = String(v); },
    removeItem: (k) => { delete backing[k]; },
    get length() { return Object.keys(backing).length; },
    key: (i) => Object.keys(backing)[i] ?? null,
  };
}

let backing = {};
function reset(initial = {}) {
  backing = { ...initial };
  setCraftListStorage(makeStorage(backing));
  clearCraftList();
  backing = { ...initial };            // clearCraftList wrote an empty list back
  setCraftListStorage(makeStorage(backing));
  loadCraftListFromStorage();
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const PLANNER = "craft-planner-table";
const KEY_A = "T6_BAG|Martlock|royal";
const KEY_B = "T5_BAG|Caerleon|caerleon";

// ── identity ────────────────────────────────────────────────────────────────

test("entry id joins table and row key", () => {
  assert.strictEqual(craftListEntryId(PLANNER, KEY_A), `${PLANNER}::${KEY_A}`);
});

test("same row key in two tables is two entries", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "T6_BAG" });
  addCraftListEntry({ tableId: "crafting-table", rowKey: KEY_A, itemId: "T6_BAG" });
  assert.strictEqual(getCraftList().length, 2);
  assert.ok(hasCraftListEntry(PLANNER, KEY_A));
  assert.ok(hasCraftListEntry("crafting-table", KEY_A));
});

// ── city-independent identity ───────────────────────────────────────────────
// getRowKey (js/sorting.js) bakes the WINNING city into the key, and prices
// move that city. Membership must survive the drift, or a restart re-paints
// "+" on a row already on the list and the next click duplicates it.

[
  ["crafting: winning craft city moved", "crafting-table", "T6_BAG|Martlock", "T6_BAG|Bridgewatch", true],
  ["crafting: no city yet (unpriced) vs priced", "crafting-table", "T6_BAG|", "T6_BAG|Martlock", true],
  ["planner: same section, city moved", PLANNER, "T6_BAG|Martlock|royal", "T6_BAG|Lymhurst|royal", true],
  ["planner: DIFFERENT section stays distinct", PLANNER, "T6_BAG|Martlock|royal", "T6_BAG|Martlock|caerleon", false],
  ["planner: different item stays distinct", PLANNER, "T6_BAG|Martlock|royal", "T5_BAG|Martlock|royal", false],
  // route split: Caerleon is a route of its own, so moving the refine city onto
  // it is not drift the way a royal-to-royal move is — the two stay distinct.
  ["transport: refine city moved onto the Caerleon route", "transport-table", "T4_ORE|T4_METALBAR|Thetford|chain", "T4_ORE|T4_METALBAR|Caerleon|chain", false],
  ["transport: variant stays distinct", "transport-table", "T4_ORE|T4_METALBAR|Thetford|chain", "T4_ORE|T4_METALBAR|Thetford|direct", false],
  ["gathering: no city in the key at all", "gathering-table", "T5_ORE|royal", "T5_ORE|royal", true],
  ["Smuggler's Den counts as a city", "crafting-table", "T6_BAG|Smuggler's Den", "T6_BAG|Martlock", true],
].forEach(([name, tableId, keyA, keyB, same]) => {
  test(`identity — ${name}`, () => {
    const eq = craftListIdentity(tableId, keyA) === craftListIdentity(tableId, keyB);
    assert.strictEqual(eq, same);
  });
});

test("identity never merges across tables", () => {
  assert.notStrictEqual(
    craftListIdentity("crafting-table", "T6_BAG|Martlock"),
    craftListIdentity(PLANNER, "T6_BAG|Martlock"),
  );
});

test("a drifted row key still reads as ON the list", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  assert.strictEqual(hasCraftListEntry("crafting-table", "T6_BAG|Bridgewatch"), true);
});

test("re-adding under a drifted key does not duplicate", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG", qty: 9 });
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Bridgewatch", itemId: "T6_BAG" });
  const list = getCraftList();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].qty, 9, "the typed quantity survives the re-add");
});

test("re-adding under a drifted key re-points the stored row key", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Bridgewatch", itemId: "T6_BAG" });
  assert.strictEqual(getCraftList()[0].rowKey, "T6_BAG|Bridgewatch");
});

test("toggle under a drifted key removes the original entry", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  assert.strictEqual(
    toggleCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Bridgewatch", itemId: "T6_BAG" }),
    false,
  );
  assert.strictEqual(getCraftList().length, 0, "no orphan left behind");
});

test("remove and setQty accept a drifted key", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  assert.strictEqual(setCraftListQty("crafting-table", "T6_BAG|Thetford", 12), true);
  assert.strictEqual(getCraftList()[0].qty, 12);
  assert.strictEqual(removeCraftListEntry("crafting-table", "T6_BAG|Lymhurst"), true);
  assert.strictEqual(getCraftList().length, 0);
});

test("an exact key match wins over an identity match", () => {
  reset();
  // Two planner rows that differ only by section — distinct identities, so both
  // stay, and each lookup must land on its own entry.
  addCraftListEntry({ tableId: PLANNER, rowKey: "T6_BAG|Martlock|royal", itemId: "T6_BAG", qty: 2 });
  addCraftListEntry({ tableId: PLANNER, rowKey: "T6_BAG|Caerleon|caerleon", itemId: "T6_BAG", qty: 5 });
  setCraftListQty(PLANNER, "T6_BAG|Caerleon|caerleon", 7);
  assert.deepStrictEqual(getCraftList().map((e) => e.qty), [2, 7]);
});

// ── route split: the Caerleon route is an entry of its own ──────────────────
// crafting-table / mounts-table row keys are `itemId|craftCity`, and the same
// item legitimately renders twice — once per route (the royal rows, and the
// Caerleon / Black Market side). Stripping EVERY city segment made
// `T6_BAG|Martlock` and `T6_BAG|Caerleon` one identity, so adding the item from
// both routes silently re-pointed the first entry instead of adding a second.
// Royal segments still collapse (the winning royal city drifts with prices);
// only the Caerleon / Black Market family survives the strip, as a `caerleon`
// tag, so the two routes never merge — and one route never duplicates.

test("identity — the Caerleon route survives the strip as a caerleon tag", () => {
  assert.strictEqual(
    craftListIdentity("crafting-table", "T6_BAG|Martlock"),
    "crafting-table::T6_BAG",
    "royal drift still collapses to the bare item",
  );
  assert.strictEqual(craftListIdentity("crafting-table", "T6_BAG|Caerleon"), "crafting-table::T6_BAG|caerleon");
});

test("identity — Caerleon and Black Market are one family", () => {
  assert.strictEqual(
    craftListIdentity("crafting-table", "T6_BAG|Caerleon"),
    craftListIdentity("crafting-table", "T6_BAG|Black Market"),
  );
  assert.strictEqual(
    craftListIdentity("transport-table", "T4_ORE|T4_METALBAR|Caerleon|chain"),
    craftListIdentity("transport-table", "T4_ORE|T4_METALBAR|Black Market|chain"),
  );
});

[
  ["crafting-table", "T6_BAG|Martlock", "T6_BAG|Caerleon"],
  ["mounts-table", "T7_HORSE|Martlock", "T7_HORSE|Caerleon"],
].forEach(([tableId, royal, caerleon]) => {
  const itemId = royal.split("|")[0];

  test(`route split — ${tableId}: the two routes are two entries`, () => {
    reset();
    addCraftListEntry({ tableId, rowKey: royal, itemId });
    assert.strictEqual(hasCraftListEntry(tableId, caerleon), false, "the royal pick is not the Caerleon pick");
    addCraftListEntry({ tableId, rowKey: caerleon, itemId });
    assert.strictEqual(getCraftList().length, 2);
    assert.deepStrictEqual(getCraftList().map((e) => e.rowKey), [royal, caerleon]);
  });

  test(`route split — ${tableId}: toggling the royal row keeps the Caerleon entry`, () => {
    reset();
    addCraftListEntry({ tableId, rowKey: royal, itemId, qty: 2 });
    addCraftListEntry({ tableId, rowKey: caerleon, itemId, qty: 5 });
    assert.strictEqual(toggleCraftListEntry({ tableId, rowKey: royal, itemId }), false);
    const list = getCraftList();
    assert.strictEqual(list.length, 1, "only the royal entry went");
    assert.strictEqual(list[0].rowKey, caerleon);
    assert.strictEqual(list[0].qty, 5, "the Caerleon quantity survives");
  });

  test(`route split — ${tableId}: quantities are independent per route`, () => {
    reset();
    addCraftListEntry({ tableId, rowKey: royal, itemId, qty: 2 });
    addCraftListEntry({ tableId, rowKey: caerleon, itemId, qty: 5 });
    setCraftListQty(tableId, royal, 9);
    assert.deepStrictEqual(
      getCraftList().map((e) => [e.rowKey, e.qty]),
      [[royal, 9], [caerleon, 5]],
      "the exact key updates its own route only",
    );
  });
});

test("route split — royal drift still collapses while a Caerleon entry exists", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Martlock", itemId: "T6_BAG" });
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Caerleon", itemId: "T6_BAG" });
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Bridgewatch", itemId: "T6_BAG" });
  assert.strictEqual(getCraftList().length, 2, "Bridgewatch joins the royal entry, not the Caerleon one");
  assert.deepStrictEqual(
    getCraftList().map((e) => e.rowKey).sort(),
    ["T6_BAG|Bridgewatch", "T6_BAG|Caerleon"],
  );
});

test("route split — Caerleon and Black Market keys share one entry", () => {
  reset();
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Caerleon", itemId: "T6_BAG", qty: 3 });
  assert.strictEqual(hasCraftListEntry("crafting-table", "T6_BAG|Black Market"), true, "one family");
  addCraftListEntry({ tableId: "crafting-table", rowKey: "T6_BAG|Black Market", itemId: "T6_BAG" });
  assert.strictEqual(getCraftList().length, 1, "no duplicate inside the caerleon route");
  assert.strictEqual(getCraftList()[0].rowKey, "T6_BAG|Black Market", "the stored key follows the table");
  setCraftListQty("crafting-table", "T6_BAG|Caerleon", 7);
  assert.strictEqual(getCraftList()[0].qty, 7, "the family key still reaches the entry");
});

// ── add / remove / toggle ───────────────────────────────────────────────────

[
  { name: "adds one entry", rows: [[PLANNER, KEY_A]], expect: 1 },
  { name: "adds two distinct rows", rows: [[PLANNER, KEY_A], [PLANNER, KEY_B]], expect: 2 },
  { name: "re-adding the same row does not duplicate", rows: [[PLANNER, KEY_A], [PLANNER, KEY_A]], expect: 1 },
].forEach(({ name, rows, expect }) => {
  test(name, () => {
    reset();
    rows.forEach(([t, k]) => addCraftListEntry({ tableId: t, rowKey: k, itemId: "X" }));
    assert.strictEqual(getCraftList().length, expect);
  });
});

test("add keeps insertion order", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_B, itemId: "B" });
  assert.deepStrictEqual(getCraftList().map((e) => e.itemId), ["A", "B"]);
});

test("re-adding preserves the existing quantity", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A", qty: 7 });
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  assert.strictEqual(getCraftList()[0].qty, 7);
});

test("add rejects an entry with no table or row key", () => {
  reset();
  assert.strictEqual(addCraftListEntry({ rowKey: KEY_A }), null);
  assert.strictEqual(addCraftListEntry({ tableId: PLANNER }), null);
  assert.strictEqual(getCraftList().length, 0);
});

test("remove drops only the named entry", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_B, itemId: "B" });
  assert.strictEqual(removeCraftListEntry(PLANNER, KEY_A), true);
  assert.deepStrictEqual(getCraftList().map((e) => e.itemId), ["B"]);
});

test("remove of an absent entry is false", () => {
  reset();
  assert.strictEqual(removeCraftListEntry(PLANNER, KEY_A), false);
});

test("toggle adds then removes", () => {
  reset();
  assert.strictEqual(toggleCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" }), true);
  assert.strictEqual(hasCraftListEntry(PLANNER, KEY_A), true);
  assert.strictEqual(toggleCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" }), false);
  assert.strictEqual(hasCraftListEntry(PLANNER, KEY_A), false);
});

test("clear empties the list", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  clearCraftList();
  assert.strictEqual(getCraftList().length, 0);
});

test("getCraftList returns a copy — callers cannot mutate the store", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  getCraftList().pop();
  assert.strictEqual(getCraftList().length, 1);
});

// ── quantity ────────────────────────────────────────────────────────────────

// 0 is a legitimate plan: it PARKS the row on the list without it counting
// (see tests/craft-list-qty-zero.test.cjs). Only an unreadable quantity falls
// back to 1 — that is the "+" button, which passes none at all.
[
  ["missing", undefined, 1],
  ["zero", 0, 0],
  ["negative", -5, 0],
  ["empty string", "", 0],
  ["non-numeric", "abc", 1],
  ["fractional rounds down", 3.9, 3],
  ["numeric string", "12", 12],
  ["absurd is capped", 1e12, 1000000],
].forEach(([name, input, expect]) => {
  test(`quantity ${name} → ${expect}`, () => {
    assert.strictEqual(normalizeCraftQty(input), expect);
  });
});

test("setCraftListQty updates the entry and normalizes", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  assert.strictEqual(setCraftListQty(PLANNER, KEY_A, 25), true);
  assert.strictEqual(getCraftList()[0].qty, 25);
  setCraftListQty(PLANNER, KEY_A, 0);
  assert.strictEqual(getCraftList()[0].qty, 0, "0 parks the row rather than snapping to 1");
  setCraftListQty(PLANNER, KEY_A, "abc");
  assert.strictEqual(getCraftList()[0].qty, 1);
});

test("setCraftListQty on an absent entry is false", () => {
  reset();
  assert.strictEqual(setCraftListQty(PLANNER, KEY_A, 4), false);
});

test("added entry defaults to quantity 1", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  assert.strictEqual(getCraftList()[0].qty, 1);
});

// ── persistence ─────────────────────────────────────────────────────────────

test("add writes through to storage", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A", qty: 3 });
  const raw = JSON.parse(backing[CRAFT_LIST_KEY]);
  assert.strictEqual(raw.length, 1);
  assert.strictEqual(raw[0].qty, 3);
  assert.strictEqual(backing[CRAFT_LIST_VERSION_KEY], CRAFT_LIST_SCHEMA_VERSION);
});

test("load restores a saved list", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A", qty: 4 });
  saveCraftListToStorage();
  const saved = { ...backing };
  reset(saved);
  assert.deepStrictEqual(
    getCraftList().map((e) => [e.tableId, e.rowKey, e.qty]),
    [[PLANNER, KEY_A, 4]],
  );
});

test("load wipes the list on a schema version mismatch", () => {
  reset();
  addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
  saveCraftListToStorage();
  const stale = { ...backing, [CRAFT_LIST_VERSION_KEY]: "0" };
  reset(stale);
  assert.strictEqual(getCraftList().length, 0);
  assert.strictEqual(backing[CRAFT_LIST_KEY], undefined);
});

[
  ["corrupt JSON", "{not json"],
  ["not an array", '{"a":1}'],
].forEach(([name, raw]) => {
  test(`load tolerates ${name}`, () => {
    reset({ [CRAFT_LIST_KEY]: raw, [CRAFT_LIST_VERSION_KEY]: CRAFT_LIST_SCHEMA_VERSION });
    assert.strictEqual(getCraftList().length, 0);
  });
});

test("load drops malformed entries but keeps the good ones", () => {
  const stored = JSON.stringify([
    { tableId: PLANNER, rowKey: KEY_A, itemId: "A", qty: 2 },
    { rowKey: "orphan" },
    null,
    { tableId: PLANNER, rowKey: KEY_B, itemId: "B", qty: "bad" },
  ]);
  reset({ [CRAFT_LIST_KEY]: stored, [CRAFT_LIST_VERSION_KEY]: CRAFT_LIST_SCHEMA_VERSION });
  const list = getCraftList();
  assert.deepStrictEqual(list.map((e) => e.rowKey), [KEY_A, KEY_B]);
  assert.deepStrictEqual(list.map((e) => e.qty), [2, 1]);
});

test("a missing storage backend never throws", () => {
  setCraftListStorage(null);
  clearCraftList();
  assert.doesNotThrow(() => {
    addCraftListEntry({ tableId: PLANNER, rowKey: KEY_A, itemId: "A" });
    setCraftListQty(PLANNER, KEY_A, 3);
    loadCraftListFromStorage();
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
