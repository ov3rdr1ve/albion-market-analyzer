/**
 * Tests for uploading captured market data to the Albion Online Data Project.
 *
 * The public ingest is proof-of-work gated (albiondata-client/uploader_http_pow.go):
 * GET /pow for a challenge, solve it, then POST the payload as form fields to
 * /pow/<topic>. The regional endpoint is chosen from the GAME server's IP, not
 * from whatever region the user picked in the app — uploading Europe prices to
 * the West database would poison the very data the app scans.
 *
 * No network here: fetch and the solver are injected.
 *
 * Run: node tests/aodp-uploader.test.cjs
 */

const assert = require("assert");
const {
  createAodpUploader, serverFromIp, encodeForm, INGEST_TOPICS,
} = require("../js/aodp-uploader.js");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── region from the game server IP ─────────────────────────────────────────
const SERVER_CASES = [
  ["5.188.125.7", 1, "https://pow.west.albion-online-data.com"],
  ["5.45.187.200", 2, "https://pow.east.albion-online-data.com"],
  ["193.169.238.1", 3, "https://pow.europe.albion-online-data.com"],
  ["8.8.8.8", 0, null],
  ["", 0, null],
  [null, 0, null],
];
SERVER_CASES.forEach(([ip, serverId, baseUrl]) => {
  test(`serverFromIp(${JSON.stringify(ip)}) = server ${serverId}`, () => {
    assert.deepStrictEqual(serverFromIp(ip), { serverId, baseUrl });
  });
});

// ── form encoding ──────────────────────────────────────────────────────────
test("form fields are url-encoded, including the JSON payload", () => {
  const body = encodeForm({ key: "a b", natsmsg: '{"x":1}' });
  assert.strictEqual(body, "key=a%20b&natsmsg=%7B%22x%22%3A1%7D");
});

test("the topic list matches the ingest subjects the project publishes", () => {
  assert.deepStrictEqual(INGEST_TOPICS, {
    orders: "marketorders.ingest",
    histories: "markethistories.ingest",
    gold: "goldprices.ingest",
  });
});

// ── uploading ──────────────────────────────────────────────────────────────
function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next || { ok: true, status: 200, json: async () => ({}) };
  };
  return { fetch, calls };
}

const powResponse = () => ({ ok: true, status: 200, json: async () => ({ key: "K1", wanted: "0101" }) });

function uploader(over = {}) {
  const { fetch, calls } = fakeFetch(over.responses || [powResponse(), { ok: true, status: 200 }]);
  const u = createAodpUploader({
    fetch,
    solve: () => "SOLVED",
    getServerIp: () => "5.188.125.7",
    newIdentifier: () => "uuid-1",
    ...over,
  });
  return { u, calls };
}

(async () => {
  await testAsync("a successful upload asks for a challenge then posts the solution", async () => {
    const { u, calls } = uploader();
    const result = await u.upload({ Orders: [] }, INGEST_TOPICS.orders);
    assert.deepStrictEqual(result, { ok: true, status: 200 });
    assert.strictEqual(calls[0].url, "https://pow.west.albion-online-data.com/pow");
    assert.strictEqual(calls[1].url, "https://pow.west.albion-online-data.com/pow/marketorders.ingest");
    assert.strictEqual(calls[1].init.method, "POST");
  });

  await testAsync("the posted body carries key, solution, server id, payload and identifier", async () => {
    const { u, calls } = uploader();
    await u.upload({ Orders: [{ Id: 1 }] }, INGEST_TOPICS.orders);
    const fields = Object.fromEntries(new URLSearchParams(calls[1].init.body));
    assert.deepStrictEqual(fields, {
      key: "K1",
      solution: "SOLVED",
      serverid: "1",
      natsmsg: '{"Orders":[{"Id":1}]}',
      identifier: "uuid-1",
    });
  });

  await testAsync("the post is form-encoded", async () => {
    const { u, calls } = uploader();
    await u.upload({}, INGEST_TOPICS.gold);
    assert.strictEqual(calls[1].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  });

  await testAsync("the region follows the game server, not the app's setting", async () => {
    const { u, calls } = uploader({ getServerIp: () => "193.169.238.9" });
    await u.upload({}, INGEST_TOPICS.orders);
    assert.ok(calls[0].url.startsWith("https://pow.europe."), calls[0].url);
    const fields = Object.fromEntries(new URLSearchParams(calls[1].init.body));
    assert.strictEqual(fields.serverid, "3");
  });

  await testAsync("nothing is sent while the game server is unknown", async () => {
    const { u, calls } = uploader({ getServerIp: () => null });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "unknown-server" });
    assert.strictEqual(calls.length, 0);
  });

  await testAsync("uploading can be switched off entirely", async () => {
    const { u, calls } = uploader({ isEnabled: () => false });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "disabled" });
    assert.strictEqual(calls.length, 0);
  });

  await testAsync("a failed challenge request aborts before posting", async () => {
    const { u, calls } = uploader({ responses: [{ ok: false, status: 503 }] });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "pow-failed", status: 503 });
    assert.strictEqual(calls.length, 1);
  });

  await testAsync("a challenge without a key is refused", async () => {
    const { u } = uploader({ responses: [{ ok: true, status: 200, json: async () => ({}) }] });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "pow-failed", status: 200 });
  });

  await testAsync("an unsolvable challenge is reported, not retried forever", async () => {
    const { u } = uploader({ solve: () => null });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "unsolved" });
  });

  await testAsync("a rejected upload reports the status", async () => {
    const { u } = uploader({ responses: [powResponse(), { ok: false, status: 429 }] });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "rejected", status: 429 });
  });

  await testAsync("a network error is caught, never thrown at the caller", async () => {
    const { u } = uploader({ responses: [new Error("ECONNRESET")] });
    assert.deepStrictEqual(await u.upload({}, INGEST_TOPICS.orders), { ok: false, reason: "network", message: "ECONNRESET" });
  });

  await testAsync("an empty payload is skipped before any request", async () => {
    const { u, calls } = uploader();
    assert.deepStrictEqual(await u.upload(null, INGEST_TOPICS.orders), { ok: false, reason: "empty" });
    assert.strictEqual(calls.length, 0);
  });

  await testAsync("counters track what was sent and what failed", async () => {
    const { u } = uploader({ responses: [powResponse(), { ok: true, status: 200 }, powResponse(), { ok: false, status: 500 }] });
    await u.upload({ a: 1 }, INGEST_TOPICS.orders);
    await u.upload({ a: 2 }, INGEST_TOPICS.orders);
    assert.deepStrictEqual(u.stats, { sent: 1, failed: 1 });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
