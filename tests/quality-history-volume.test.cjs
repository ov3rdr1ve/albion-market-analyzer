/**
 * Test: quality-aware 24h volume aggregation for the Quality Rerolling table.
 *
 * `fetchPricesBatchWithQualities` used to hardcode `volume_24h: 0`, so the
 * rerolling table's "Daily Vol" column always showed 0. It now pairs a 24h
 * history request with the price request and aggregates `item_count` per
 * (item, city, quality) via the pure `sumQualityHistoryVolume` helper.
 *
 * Black-box: feed AODP-shaped history entries, assert the per-key volume map.
 *
 * Run: node tests/quality-history-volume.test.cjs
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const apiSrc = fs.readFileSync(
  path.join(__dirname, "..", "js", "api.js"),
  "utf8",
);
const mod = new Module("quality-history-volume-test");
const sandbox = `
const fetch = () => Promise.resolve({ ok: false, status: 0 });
const document = { getElementById: () => null };
`;
mod._compile(sandbox + apiSrc, "api.js");
const { sumQualityHistoryVolume } = mod.exports;

assert.ok(
  typeof sumQualityHistoryVolume === "function",
  "api.js must export sumQualityHistoryVolume for testability",
);

// AODP /stats/history entry shape: { item_id, location, quality, data: [{ item_count, ... }] }
const entry = (item_id, location, quality, counts) => ({
  item_id,
  location,
  quality,
  data: counts.map((c) => ({ item_count: c, avg_price: 1000, timestamp: "2026-06-24T00:00:00" })),
});

const cases = [
  {
    name: "sums item_count across buckets per key",
    input: [entry("T4_BAG", "Martlock", 2, [3, 5, 2])],
    expectKey: "T4_BAG:Martlock:2",
    expectVol: 10,
  },
  {
    name: "keeps qualities of the same item/city separate",
    input: [
      entry("T4_BAG", "Martlock", 1, [4]),
      entry("T4_BAG", "Martlock", 3, [7, 1]),
    ],
    expectKey: "T4_BAG:Martlock:3",
    expectVol: 8,
  },
  {
    name: "keeps cities of the same item/quality separate",
    input: [
      entry("T4_BAG", "Martlock", 2, [4]),
      entry("T4_BAG", "Caerleon", 2, [9]),
    ],
    expectKey: "T4_BAG:Caerleon:2",
    expectVol: 9,
  },
  {
    name: "defaults missing quality to 1",
    input: [{ item_id: "T4_BAG", location: "Bridgewatch", data: [{ item_count: 6 }] }],
    expectKey: "T4_BAG:Bridgewatch:1",
    expectVol: 6,
  },
  {
    name: "treats missing/empty data as zero volume",
    input: [{ item_id: "T4_BAG", location: "Lymhurst", quality: 5 }],
    expectKey: "T4_BAG:Lymhurst:5",
    expectVol: 0,
  },
];

let passed = 0;
for (const c of cases) {
  const out = sumQualityHistoryVolume(c.input);
  assert.strictEqual(
    out[c.expectKey],
    c.expectVol,
    `${c.name}: expected ${c.expectKey}=${c.expectVol}, got ${out[c.expectKey]}`,
  );
  passed++;
}

// Edge: null/undefined input must not throw and yields an empty map.
assert.deepStrictEqual(sumQualityHistoryVolume(null), {}, "null input → {}");
assert.deepStrictEqual(sumQualityHistoryVolume(undefined), {}, "undefined input → {}");
passed += 2;

console.log(`quality-history-volume.test.cjs: ${passed} assertions passed`);
