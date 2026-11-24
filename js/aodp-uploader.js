/**
 * Uploads captured market data to the Albion Online Data Project.
 *
 * This is the giving half of the deal: the app scans AODP's API for prices, so
 * whatever this machine sees goes back in. The public ingest is proof-of-work
 * gated (albiondata-client/uploader_http_pow.go):
 *
 *     GET  <base>/pow            → {key, wanted}
 *     POST <base>/pow/<topic>    → key, solution, serverid, natsmsg, identifier
 *
 * The regional endpoint follows the GAME server's IP, never the region picked
 * in the app's own dropdown — uploading European prices into the West database
 * would poison the very data the app scans.
 *
 * Node only (Electron main process). fetch and the solver are injectable.
 */

const INGEST_TOPICS = {
  orders: "marketorders.ingest",
  histories: "markethistories.ingest",
  gold: "goldprices.ingest",
};

// Class-C ranges published by the reference client. Anything else is not an
// Albion game server, so we have no idea which database the data belongs to.
const SERVERS = [
  { prefix: "5.188.125.", serverId: 1, baseUrl: "https://pow.west.albion-online-data.com" },
  { prefix: "5.45.187.", serverId: 2, baseUrl: "https://pow.east.albion-online-data.com" },
  { prefix: "193.169.238.", serverId: 3, baseUrl: "https://pow.europe.albion-online-data.com" },
];

/** @returns {{serverId:number, baseUrl:string|null}} */
function serverFromIp(ip) {
  const text = typeof ip === "string" ? ip : "";
  const hit = SERVERS.find((s) => text.startsWith(s.prefix));
  return hit ? { serverId: hit.serverId, baseUrl: hit.baseUrl } : { serverId: 0, baseUrl: null };
}

/**
 * Form encoding with percent-escaped spaces. URLSearchParams would write "+",
 * which the Go endpoint's parser accepts but the reference client does not
 * produce; staying identical keeps the payload byte-comparable.
 */
function encodeForm(fields) {
  return Object.keys(fields)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(fields[k])}`)
    .join("&");
}

/**
 * @param {object} options
 * @param {Function} [options.fetch]           injectable for tests
 * @param {Function} [options.solve]           (pow) => solution|null
 * @param {() => string|null} options.getServerIp
 * @param {() => boolean} [options.isEnabled]
 * @param {() => string} [options.newIdentifier]
 */
function createAodpUploader({
  fetch: fetchImpl = globalThis.fetch,
  solve,
  getServerIp = () => null,
  isEnabled = () => true,
  newIdentifier,
} = {}) {
  const stats = { sent: 0, failed: 0 };

  // Solving takes 0.2–2 s of sha256, so by default it happens on a worker
  // thread — inline it froze the main process, and with it the window, for the
  // length of every upload. The result is awaited, so an injected synchronous
  // solver still works.
  let powSolver = null;
  const solver = solve || ((pow) => {
    if (!powSolver) powSolver = require("./aodp-pow-async.js").createPowSolver();
    return powSolver.solve(pow);
  });
  const identifier = newIdentifier || (() => require("crypto").randomUUID());

  async function upload(payload, topic) {
    if (!isEnabled()) return { ok: false, reason: "disabled" };
    if (payload === null || payload === undefined) return { ok: false, reason: "empty" };

    const { serverId, baseUrl } = serverFromIp(getServerIp());
    if (!baseUrl) return { ok: false, reason: "unknown-server" };

    try {
      const powResponse = await fetchImpl(`${baseUrl}/pow`, {
        method: "GET",
        headers: { "User-Agent": "albion-market-analyzer" },
      });
      if (!powResponse || !powResponse.ok) {
        stats.failed++;
        return { ok: false, reason: "pow-failed", status: powResponse ? powResponse.status : 0 };
      }
      const pow = await powResponse.json();
      if (!pow || typeof pow.key !== "string") {
        stats.failed++;
        return { ok: false, reason: "pow-failed", status: powResponse.status };
      }

      const solution = await solver(pow);
      if (!solution) {
        stats.failed++;
        return { ok: false, reason: "unsolved" };
      }

      const body = encodeForm({
        key: pow.key,
        solution,
        serverid: String(serverId),
        natsmsg: JSON.stringify(payload),
        identifier: identifier(),
      });

      const posted = await fetchImpl(`${baseUrl}/pow/${topic}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "albion-market-analyzer",
        },
        body,
      });
      if (!posted || !posted.ok) {
        stats.failed++;
        return { ok: false, reason: "rejected", status: posted ? posted.status : 0 };
      }
      stats.sent++;
      return { ok: true, status: posted.status };
    } catch (e) {
      stats.failed++;
      return { ok: false, reason: "network", message: e.message };
    }
  }

  return { upload, stats };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createAodpUploader, serverFromIp, encodeForm, INGEST_TOPICS };
}
