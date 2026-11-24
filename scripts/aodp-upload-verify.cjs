#!/usr/bin/env node
/**
 * Round-trip check for the AODP upload path.
 *
 * The uploader (js/aodp-uploader.js) only ever learns that the ingest endpoint
 * accepted a POST — a 200 there means the proof-of-work was valid, not that the
 * record survived into the public database. The only way to know it did is to
 * ask AODP for the same item/city back and see our own reading in the answer.
 *
 * That is what this does: read the captured-price map this machine wrote
 * (userData/captured-prices.json), pick the newest cells, query the public
 * price API for exactly those item/city pairs, and classify each one.
 *
 * The strong signal is the TIMESTAMP, not the price. Another player standing in
 * the same market uploads the same numbers, so an equal price proves nothing on
 * its own; an AODP stamp equal to the second we captured at is our upload and
 * nobody else's.
 *
 *   node scripts/aodp-upload-verify.cjs [--region west|europe|east|auto]
 *                                       [--limit N] [--hours H] [--city NAME]
 *                                       [--file PATH] [--json]
 *
 * Read-only: it never writes the captured map and never uploads anything.
 */

const REGIONS = {
  west: "https://west.albion-online-data.com",
  europe: "https://europe.albion-online-data.com",
  east: "https://east.albion-online-data.com",
};

// AODP truncates its stamps to the second and re-stamps on ingest, so an
// arrival is a few seconds behind the capture. Wider than this and another
// player's upload of the same book starts counting as ours.
const ISO_TOLERANCE_MS = 15000;

// Measured against the live API: every date it serves lands on a 5-minute
// boundary (07:05:00, 07:15:00, 07:20:00), so a capture at 07:18:52 comes back
// stamped 07:15:00. Comparing raw stamps called those arrivals "stale" when
// they were our own upload, four minutes rounded off.
const AODP_BUCKET_MS = 300000;

// "0001-01-01T00:00:00" is AODP's null date — the row exists, the side is empty.
const NULL_DATE_YEAR = "0001";

// ── pure helpers ────────────────────────────────────────────────────────────

/** AODP serves UTC without a zone suffix; ours already carries Z. */
function parseStamp(text) {
  if (!text || typeof text !== "string") return 0;
  if (text.startsWith(NULL_DATE_YEAR)) return 0;
  const ms = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function capturedStamp(entry) {
  return Math.max(parseStamp(entry && entry.sell_date), parseStamp(entry && entry.buy_date));
}

function remoteStamp(row) {
  if (!row) return 0;
  return Math.max(parseStamp(row.sell_price_min_date), parseStamp(row.buy_price_max_date));
}

/** Does AODP quote the same numbers we captured on every side we observed? */
function pricesAgree(captured, remote) {
  if (!captured || !remote) return false;
  const sides = [
    [Number(captured.sell_price) || 0, Number(remote.sell_price_min) || 0],
    [Number(captured.buy_price) || 0, Number(remote.buy_price_max) || 0],
  ].filter(([ours]) => ours > 0);
  return sides.length > 0 && sides.every(([ours, theirs]) => ours === theirs);
}

/**
 * One captured cell against one AODP row.
 *
 * landed      — AODP is carrying the reading we captured, in our own 5-minute
 *               bucket (or inside the ingest tolerance)
 * newer-there — AODP moved on since; ours may have landed and been replaced
 * stale-there — AODP's newest reading predates our capture: ours never arrived
 * missing     — AODP has no price for this item/city at all
 * undated     — our own cell carries no timestamp, nothing to compare
 *
 * @returns {"landed"|"newer-there"|"stale-there"|"missing"|"undated"}
 */
function classifyCell({ captured, remote }) {
  const ours = capturedStamp(captured);
  if (!ours) return "undated";

  const hasPrice = remote
    && ((Number(remote.sell_price_min) || 0) > 0 || (Number(remote.buy_price_max) || 0) > 0);
  if (!hasPrice) return "missing";

  const theirs = remoteStamp(remote);
  if (Math.abs(theirs - ours) <= ISO_TOLERANCE_MS) return "landed";
  if (Math.floor(theirs / AODP_BUCKET_MS) === Math.floor(ours / AODP_BUCKET_MS)) return "landed";
  return theirs > ours ? "newer-there" : "stale-there";
}

/** Newest cells first, flattened out of the quality-shaped map. */
function flattenCells(map, { hours = 0, city = "", now = Date.now() } = {}) {
  const cells = [];
  Object.keys(map || {}).forEach((itemId) => {
    Object.keys(map[itemId] || {}).forEach((quality) => {
      Object.keys(map[itemId][quality] || {}).forEach((location) => {
        const entry = map[itemId][quality][location];
        const ts = capturedStamp(entry);
        if (hours && (!ts || now - ts > hours * 3600000)) return;
        if (city && location.toLowerCase() !== city.toLowerCase()) return;
        cells.push({ itemId, quality: Number(quality), location, entry, ts });
      });
    });
  });
  cells.sort((a, b) => b.ts - a.ts);
  return cells;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Key an AODP row the same way a captured cell is keyed. */
function rowKey(itemId, quality, location) {
  return `${itemId}|${quality}|${location}`;
}

// ── network ─────────────────────────────────────────────────────────────────

/**
 * Fetch the AODP price rows for a set of cells.
 * @returns {Promise<Map<string, object>>} rowKey → row
 */
async function fetchRemote(cells, { host, fetchImpl = globalThis.fetch, log = () => {} }) {
  const ids = [...new Set(cells.map((c) => c.itemId))];
  const locations = [...new Set(cells.map((c) => c.location))];
  const qualities = [...new Set(cells.map((c) => c.quality))].sort();
  const rows = new Map();

  // The path carries the ids, so the batch has to stay inside a sane URL length.
  for (const batch of chunk(ids, 40)) {
    const url = `${host}/api/v2/stats/prices/${batch.map(encodeURIComponent).join(",")}`
      + `?locations=${locations.map(encodeURIComponent).join(",")}`
      + `&qualities=${qualities.join(",")}`;
    const response = await fetchImpl(url, { headers: { "User-Agent": "albion-market-analyzer" } });
    if (!response || !response.ok) {
      log(`  request failed: ${response ? response.status : "no response"}`);
      continue;
    }
    const data = await response.json();
    (Array.isArray(data) ? data : []).forEach((row) => {
      rows.set(rowKey(row.item_id, row.quality, row.city), row);
    });
  }
  return rows;
}

// ── report ──────────────────────────────────────────────────────────────────

function verify(cells, rows) {
  return cells.map((cell) => {
    const remote = rows.get(rowKey(cell.itemId, cell.quality, cell.location)) || null;
    return {
      itemId: cell.itemId,
      quality: cell.quality,
      location: cell.location,
      capturedAt: new Date(cell.ts).toISOString(),
      ourSell: cell.entry.sell_price || 0,
      ourBuy: cell.entry.buy_price || 0,
      aodpSell: remote ? (remote.sell_price_min || 0) : 0,
      aodpBuy: remote ? (remote.buy_price_max || 0) : 0,
      aodpAt: remote && remoteStamp(remote) ? new Date(remoteStamp(remote)).toISOString() : null,
      priceMatch: pricesAgree(cell.entry, remote),
      verdict: classifyCell({ captured: cell.entry, remote }),
    };
  });
}

function tally(results) {
  const counts = {};
  results.forEach((r) => { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
  return counts;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { region: "auto", limit: 60, hours: 24, city: "", file: "", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--region") args.region = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--hours") args.hours = Number(argv[++i]);
    else if (a === "--city") args.city = argv[++i];
    else if (a === "--file") args.file = argv[++i];
  }
  return args;
}

function defaultFile() {
  const path = require("path");
  const base = process.env.APPDATA
    || path.join(require("os").homedir(), "AppData", "Roaming");
  return path.join(base, "albion-market-analyzer", "captured-prices.json");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.file || defaultFile();
  const map = JSON.parse(require("fs").readFileSync(file, "utf8"));

  const all = flattenCells(map, { hours: args.hours, city: args.city });
  const cells = all.slice(0, args.limit);
  if (!cells.length) {
    console.log(`No captures in the last ${args.hours}h in ${file}`);
    return;
  }
  console.log(`${file}`);
  console.log(`${all.length} captured cells in the last ${args.hours}h; checking the newest ${cells.length}\n`);

  const regions = args.region === "auto" ? Object.keys(REGIONS) : [args.region];
  const reports = [];
  for (const region of regions) {
    const rows = await fetchRemote(cells, { host: REGIONS[region], log: console.log });
    const results = verify(cells, rows);
    const counts = tally(results);
    reports.push({ region, results, counts });
    console.log(`${region.padEnd(7)} ${JSON.stringify(counts)}`);
  }

  // On --region auto the region that actually holds our data is the one with
  // any "landed" at all; the other two are somebody else's database.
  const best = reports.slice().sort((a, b) => (b.counts.landed || 0) - (a.counts.landed || 0))[0];
  const results = best.results;

  if (args.json) {
    console.log(JSON.stringify({ region: best.region, counts: best.counts, results }, null, 1));
    return;
  }

  console.log(`\n── ${best.region} ──`);
  const width = Math.min(38, Math.max(...results.map((r) => r.itemId.length)));
  results.forEach((r) => {
    console.log(
      `${r.verdict.padEnd(12)}${r.priceMatch ? "=" : " "} ${r.itemId.padEnd(width)} q${r.quality} ${r.location.padEnd(13)}`
      + ` ours ${String(r.ourSell).padStart(9)}/${String(r.ourBuy).padStart(9)} @ ${r.capturedAt}`
      + `  aodp ${String(r.aodpSell).padStart(9)}/${String(r.aodpBuy).padStart(9)} @ ${r.aodpAt || "-"}`
    );
  });

  const landed = best.counts.landed || 0;
  const newer = best.counts["newer-there"] || 0;
  const matched = results.filter((r) => r.priceMatch).length;
  const priced = results.filter((r) => r.verdict !== "missing" && r.verdict !== "undated").length;
  console.log(`\n${landed} of ${results.length} carry our own timestamp — the upload is reaching AODP.`);
  console.log(`${matched} of ${priced} priced rows quote our exact numbers (the "=" column).`);
  if (newer) console.log(`${newer} were overwritten by a later reading (ours or another uploader's).`);
  if (best.counts["stale-there"]) {
    console.log(`${best.counts["stale-there"]} are STALE at AODP: our newer capture never arrived.`);
  }
  if (best.counts.missing) {
    console.log(`${best.counts.missing} have no AODP price at all — expected for artifacts and the Black Market.`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = {
  REGIONS,
  ISO_TOLERANCE_MS,
  AODP_BUCKET_MS,
  pricesAgree,
  parseStamp,
  capturedStamp,
  remoteStamp,
  classifyCell,
  flattenCells,
  fetchRemote,
  verify,
  tally,
};
