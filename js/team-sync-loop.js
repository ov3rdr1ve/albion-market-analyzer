/**
 * The publish/pull loop for team sync (renderer).
 *
 * A shared Dropbox folder is not a database, and treating it like one is how a
 * guild ends up with a folder full of conflicted copies and a client that spends
 * its evening re-uploading the same megabyte. So this loop's whole job is
 * restraint:
 *
 *   - a burst of edits is ONE write (debounce);
 *   - a floor between writes keeps a busy session off the folder, and a change
 *     arriving inside the floor is DELAYED, never dropped;
 *   - the price file is a hundred times the size of the portal file, so it runs
 *     on its own slower clock and is skipped entirely when no cell is newer than
 *     the one already published;
 *   - a peer that is unreadable, malformed or mid-upload costs us that peer, not
 *     the tick.
 *
 * Everything with an opinion lives outside: what a payload is
 * (js/team-sync-payload.js), how it reaches the disk (js/sync-folder.js via the
 * preload bridge), and what a merged portal means (js/render-roads.js). Clock,
 * timers and bridge are all injected, so the tests never touch a real one.
 */

const PORTAL_DEBOUNCE_MS = 3000;
const PORTAL_MIN_INTERVAL_MS = 15000;
const PRICE_DEBOUNCE_MS = 30000;
const PRICE_MIN_INTERVAL_MS = 120000;
const PULL_INTERVAL_MS = 20000;

/**
 * @param {object} options
 * @param {object} options.bridge            {publish(kind, text), readPeers(seen)}
 * @param {object} [options.timers]          {setTimeout, clearTimeout, setInterval, clearInterval}
 * @param {()=>number} [options.now]
 * @param {()=>object} options.getPrefs      {enabled, sharePrices}
 * @param {()=>object|null} options.getPortalPayload
 * @param {()=>object|null} options.getPricePayload   payload carries `newestAt`
 * @param {(payload:object, kind:string)=>object} options.applyPeer  {portals, cells}
 * @param {(status:object)=>void} [options.onStatus]
 */
function createTeamSyncLoop(options) {
  const opts = options || {};
  const timers = opts.timers || (typeof globalThis !== "undefined" ? globalThis : {});
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const bridge = opts.bridge || null;
  const getPrefs = opts.getPrefs || (() => ({ enabled: false, sharePrices: false }));
  const applyPeer = opts.applyPeer || (() => ({ portals: 0, cells: 0 }));
  // Validation belongs to the payload module; the loop only needs it early
  // enough that a Dropbox error page never reaches the merge.
  const readPayload = opts.readPeerPayload
    || (typeof globalThis !== "undefined" && globalThis.readPeerPayload)
    || (typeof module !== "undefined" && module.exports
      ? require("./team-sync-payload.js").readPeerPayload
      : null);
  const onStatus = typeof opts.onStatus === "function" ? opts.onStatus : null;

  const setTimer = timers.setTimeout.bind(timers);
  const clearTimer = timers.clearTimeout.bind(timers);
  const setEvery = timers.setInterval.bind(timers);
  const clearEvery = timers.clearInterval.bind(timers);

  /** One publish channel: its own debounce, its own floor, its own last write. */
  function channel(kind, debounceMs, floorMs, build) {
    return { kind, debounceMs, floorMs, build, timer: null, lastAt: 0, lastNewestAt: 0, dirty: false };
  }

  const channels = [
    channel("portals", PORTAL_DEBOUNCE_MS, PORTAL_MIN_INTERVAL_MS, () => opts.getPortalPayload && opts.getPortalPayload()),
    channel("prices", PRICE_DEBOUNCE_MS, PRICE_MIN_INTERVAL_MS, () => opts.getPricePayload && opts.getPricePayload()),
  ];

  let pullTimer = null;
  let pulling = false;
  let running = false;
  let seenMtimes = {};

  const status = {
    running: false,
    lastPullAt: 0,
    lastPublishAt: 0,
    lastPortalsTaken: 0,
    lastCellsTaken: 0,
    lastError: null,
    peers: [],
  };

  function report() {
    status.running = running;
    if (onStatus) { try { onStatus({ ...status }); } catch (e) { /* a status line must not break the loop */ } }
  }

  function enabled() {
    const prefs = getPrefs() || {};
    return !!prefs.enabled && !!bridge;
  }

  function wants(kind) {
    if (!enabled()) return false;
    if (kind !== "prices") return true;
    return !!(getPrefs() || {}).sharePrices;
  }

  // ── publishing ────────────────────────────────────────────────────────────

  function arm(chan) {
    if (chan.timer !== null) return;
    // Inside the floor the write is postponed to the moment the floor lifts,
    // rather than dropped — otherwise the last portal of a busy minute would
    // never reach the guild.
    const sinceWrite = now() - chan.lastAt;
    const wait = chan.lastAt && sinceWrite < chan.floorMs
      ? Math.max(chan.debounceMs, chan.floorMs - sinceWrite)
      : chan.debounceMs;
    chan.timer = setTimer(() => { chan.timer = null; return flush(chan); }, wait);
  }

  async function flush(chan) {
    if (!chan.dirty) return;
    if (!running || !wants(chan.kind)) { chan.dirty = false; return; }
    if (chan.lastAt && now() - chan.lastAt < chan.floorMs) { arm(chan); return; }

    let payload;
    try { payload = chan.build(); } catch (e) { payload = null; }
    if (!payload) { chan.dirty = false; return; }

    // A price file whose freshest cell is the one we already sent says nothing
    // new, and it is the expensive file to send.
    const newestAt = Number(payload.newestAt) || 0;
    if (chan.kind === "prices" && newestAt && newestAt <= chan.lastNewestAt) { chan.dirty = false; return; }

    chan.dirty = false;
    chan.lastAt = now();
    try {
      const result = await bridge.publish(chan.kind, JSON.stringify(payload));
      if (result && result.ok === false) {
        status.lastError = result.error || "write failed";
      } else {
        status.lastError = null;
        status.lastPublishAt = now();
        chan.lastNewestAt = newestAt || chan.lastNewestAt;
      }
    } catch (e) {
      status.lastError = String((e && e.message) || e);
    }
    report();
  }

  function notify(kind) {
    const chan = channels.find((c) => c.kind === kind);
    if (!chan || !running || !wants(kind)) return;
    chan.dirty = true;
    arm(chan);
  }

  // ── pulling ───────────────────────────────────────────────────────────────

  async function pull() {
    if (!running || !enabled() || pulling) return;
    pulling = true;
    try {
      const result = await bridge.readPeers(seenMtimes);
      status.lastPullAt = now();
      if (!result || result.ok === false) {
        status.lastError = (result && result.error) || "folder unreadable";
        report();
        return;
      }
      status.lastError = null;
      seenMtimes = result.mtimes && typeof result.mtimes === "object" ? result.mtimes : {};

      let portals = 0;
      let cells = 0;
      // The roster is who is IN the folder, from the listing — not who was
      // parsed this tick. On a quiet tick nothing is re-read, and counting the
      // parsed files would report a guild of nobody.
      const peers = new Map();
      (result.peerIds || []).forEach((id) => peers.set(id, { deviceId: id, deviceName: "", writtenAt: 0 }));
      (result.peers || []).forEach((peer) => {
        const payload = readPayload ? readPayload(peer.text) : null;
        // Not ours to read: a Dropbox error page, a half-synced file, another
        // app's JSON. Skip the peer, keep the tick.
        if (!payload) return;
        let taken;
        try {
          taken = applyPeer(payload, peer.kind);
        } catch (e) {
          // One peer's file cannot cost us the rest of the folder.
          status.lastError = String((e && e.message) || e);
          return;
        }
        peers.set(payload.deviceId, {
          deviceId: payload.deviceId,
          deviceName: payload.deviceName || peers.get(payload.deviceId)?.deviceName || "",
          writtenAt: payload.writtenAt || 0,
        });
        if (!taken) return;
        portals += Number(taken.portals) || 0;
        cells += Number(taken.cells) || 0;
      });
      status.lastPortalsTaken = portals;
      status.lastCellsTaken = cells;
      status.peers = [...peers.values()];
      report();
    } finally {
      pulling = false;
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  function start() {
    if (running) return;
    running = true;
    pullTimer = setEvery(() => pull(), PULL_INTERVAL_MS);
    // Switching sync on IS the change. A box that has been mapping for a week
    // has nothing left to notify us about, so waiting for the next edited
    // portal would leave the shared folder empty for hours and the feature
    // looking dead. Both channels go through the ordinary debounce, so this is
    // one write each, and the price channel stays quiet when it is not shared.
    notify("portals");
    notify("prices");
    // Same reason on the way in: the status line should say who is in the
    // folder now, not one pull interval from now.
    pull();
    report();
  }

  function stop() {
    running = false;
    if (pullTimer !== null) { clearEvery(pullTimer); pullTimer = null; }
    channels.forEach((chan) => {
      if (chan.timer !== null) { clearTimer(chan.timer); chan.timer = null; }
      chan.dirty = false;
    });
    report();
  }

  /** Forget what we have read, so the next tick re-reads every peer file. */
  function resetSeen() {
    seenMtimes = {};
  }

  return {
    start,
    stop,
    pull,
    resetSeen,
    notifyPortalsChanged: () => notify("portals"),
    notifyPricesChanged: () => notify("prices"),
    status: () => ({ ...status, running }),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PORTAL_DEBOUNCE_MS,
    PORTAL_MIN_INTERVAL_MS,
    PRICE_DEBOUNCE_MS,
    PRICE_MIN_INTERVAL_MS,
    PULL_INTERVAL_MS,
    createTeamSyncLoop,
  };
}
