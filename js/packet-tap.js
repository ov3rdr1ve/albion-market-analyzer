/**
 * Live capture tap — Node/Electron-main only.
 *
 * Opens the local NIC through npcap, filters udp/5056 (Photon), and hands every
 * decoded message to a callback. Read-only: nothing is ever written to the
 * socket and the game process is never touched. This is the same passive
 * technique the Albion Online Data Project client uses for market prices.
 *
 * Picking the adapter is its own problem: a machine offers the real NIC plus a
 * Hyper-V bridge, a WSL adapter, a VPN tap and Bluetooth, and taking the first
 * one npcap lists is a coin flip whose failure is silent — the app says
 * "listening" and never sees a packet. So candidates are ranked (the adapter
 * holding the outbound IP first, virtual ones last) and then CONFIRMED BY
 * TRAFFIC: if no Albion packet arrives within the grace window, the capture
 * moves to the next candidate, and past the last one the whole walk restarts —
 * the game is usually not running YET, and a walk done before it starts would
 * otherwise park on a virtual NIC forever. npcap exposes no byte counters, so
 * actually watching for packets is the only honest measure. Silence AFTER
 * traffic is a different illness: it usually means the route itself moved to
 * another adapter (hotspot unplugged, Wi-Fi joined), so the ranking is rebuilt
 * around a fresh route probe and the capture moves — see the rerank below.
 *
 * Interpretation of the messages (market orders, which city you are in) lives
 * in js/market-sniffer-events.js. This file only deals
 * with getting bytes off the wire and into the parser, so it can be tested by
 * injecting a fake capture backend.
 */

const PHOTON_PORT = 5056;
const PHOTON_FILTER = `tcp port ${PHOTON_PORT} or udp port ${PHOTON_PORT}`;
const PHOTON_HEADER_BYTES = 12;
// The boot walk's grace window per adapter. 10 s: a capture parked on a wrong
// or absent NIC moves on — and, past the last candidate, re-walks — briskly.
const DEFAULT_SWITCH_AFTER_MS = 10000;

// How much of a packet has to reach the kernel buffer before npcap raises the
// read event. node-cap's README suggests 0, but 0 asks the driver to signal
// even with nothing to hand over — and a capture left open for hours ends up
// signalled continuously: the wait thread wakes the main thread thousands of
// times a second, each wake dispatching zero packets. Measured live at ~1.9
// cores with the game closed. 1 byte is still immediate for a real packet.
const MIN_TO_COPY_BYTES = 1;

// Watchdog. A tap that burns CPU while its packet counter stands still is not
// capturing anything — it is spinning on a dead or permanently-signalled
// handle, which is what an adapter reset or a resume from sleep leaves behind.
// Reopening clears it; if it does not, the capture is stopped rather than left
// burning a core for the rest of the session.
const DEFAULT_HEALTH_MS = 10000;  // 10 s samples: the 10 s silence heal and the 10 s walk land on schedule
const SPIN_CORE_RATIO = 0.25;     // fraction of one core, averaged over a window
const SPIN_WINDOWS = 2;           // consecutive bad windows before acting
const RECYCLE_COOLDOWN_MS = 300000;
const MAX_RECYCLES = 3;
// Past that, the tap is closed and the whole capture retried on a doubling
// delay. It never gives up: an adapter comes back from sleep, a VPN drops, the
// game is launched hours later — all of that fixes itself, and none of it
// should need the user to notice a stopped monitor and click Start.
const RESTART_DELAY_MS = 300000;
const MAX_RESTART_DELAY_MS = 1800000;

// A route that moved AFTER traffic was seen is a different silence. The walk
// above parks the moment a packet arrives, so a capture opened on a phone
// hotspot sits there deaf forever once the machine joins Wi-Fi: the handle is
// healthy, the traffic just leaves by another NIC now. A minute of silence on
// a capture that HAS carried traffic, with a fresh route probe naming another
// adapter, is that move — and five minutes between moves keeps a flapping
// route from churning the adapters.
const RERANK_SILENCE_MS = 60000;
const RERANK_COOLDOWN_MS = 300000;

// And a third silence, the shortest of all: traffic WAS seen on this handle,
// and now nothing arrives. The addon reports no errors, and the handle is not
// even spinning — idle-dead, 0 packets and 0 CPU — so the watchdog, the
// rerank and the walk all stay gated. A full start() (route probe, device
// list, pcap_open) costs no more than the boot walk's 10-second adapter hops,
// so the churn is accepted: silence past SILENCE_RESTART_MS on a capture that
// has carried traffic runs the same fresh start() an app restart runs. The
// threshold doubles as the cooldown — openedAt re-arms the gate after every
// heal — so an offline capture heals once per window and picks traffic back
// up within one of the line returning.
const SILENCE_RESTART_MS = 10 * 1000;

// Adapters that exist to carry something other than this machine's internet
// traffic. They still appear in npcap's list, often before the real NIC.
const VIRTUAL_ADAPTER = /virtual|hyper-v|vethernet|vmware|virtualbox|wsl|tap-|tunnel|bluetooth|loopback|npcap loopback|pseudo/i;

function ipv4Addresses(device) {
  return (device.addresses || [])
    .map((a) => a && a.addr)
    .filter((addr) => typeof addr === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(addr) && addr !== "127.0.0.1");
}

/**
 * Capture candidates, best first. Loopback-only and address-less adapters are
 * dropped entirely; among the rest the one holding `localIp` wins, then
 * physical adapters, then the order the OS gave.
 *
 * @param {object[]} devices  npcap device list
 * @param {string|null} localIp  this machine's outbound address, if known
 */
function rankDevices(devices, localIp) {
  const usable = (devices || []).filter((d) => ipv4Addresses(d).length > 0);
  const score = (d) => {
    if (localIp && ipv4Addresses(d).includes(localIp)) return 0;
    return VIRTUAL_ADAPTER.test(d.description || d.name || "") ? 2 : 1;
  };
  return usable
    .map((device, index) => ({ device, index, score: score(device) }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.device);
}

/**
 * Pure half of the outbound-IP probe: the data rows of `route print` output.
 * Column headers are localized on Windows, so only the row SHAPE is trusted —
 * five whitespace-separated columns starting 0.0.0.0/0.0.0.0 (destination,
 * netmask, gateway, interface, metric; metric optional → 0). Everything else
 * — Interface List, borders, garbage — is ignored, and malformed input yields
 * [] rather than an exception. Sorted ascending by metric, the OS's own
 * preference order.
 * @param {string|null} output  full stdout of `route print -4 0.0.0.0`
 * @returns {{iface: string, metric: number}[]}
 */
function parseDefaultRouteIps(output) {
  const entries = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4 || cols[0] !== "0.0.0.0" || cols[1] !== "0.0.0.0") continue;
    const metric = cols.length >= 5 ? parseInt(cols[4], 10) : 0;
    entries.push({ iface: cols[3], metric: Number.isFinite(metric) ? metric : 0 });
  }
  return entries.sort((a, b) => a.metric - b.metric);
}

/**
 * Pure selection half: the first default-route entry, in metric order, whose
 * interface address is a real non-internal IPv4 address on this machine.
 * @param {{iface: string, metric: number}[]} entries  parseDefaultRouteIps output
 * @param {object} interfaces  os.networkInterfaces()-shaped object
 * @returns {string|null}
 */
function matchRouteInterfaceIp(entries, interfaces) {
  const listed = new Set();
  for (const addrs of Object.values(interfaces || {})) {
    for (const addr of addrs || []) {
      if (!addr || addr.internal) continue;
      if (!/^(ipv?4)$/i.test(String(addr.family))) continue;
      listed.add(addr.address);
    }
  }
  const byMetric = [...(entries || [])].sort(
    (a, b) => (a.metric || 0) - (b.metric || 0)
  );
  for (const entry of byMetric) {
    if (entry && entry.iface && listed.has(entry.iface)) return entry.iface;
  }
  return null;
}

// The old probe, kept as the fallback. A connected UDP socket only sets a
// route, it sends nothing — but on current runtimes socket.address() read in
// the same tick as connect() still reports 0.0.0.0, so it answers honestly
// only by accident. The Windows route table below is the reliable primary.
// `makeSocket` is injectable for tests; production never passes it.
function udpProbeLocalIp(makeSocket) {
  const newSocket = typeof makeSocket === "function"
    ? makeSocket
    : () => require("dgram").createSocket("udp4");
  try {
    const socket = newSocket();
    // A connect with no route to the far end does not throw — it emits
    // 'error' on a later tick. The try/catch below only sees synchronous
    // throws, so without this sink the failure escapes as an
    // uncaughtException and, in Electron, as the crash dialog an offline
    // start used to show. Best-effort probe: swallow it.
    socket.on("error", () => {});
    socket.unref();
    let address = null;
    socket.connect(53, "8.8.8.8");
    address = socket.address() && socket.address().address;
    socket.close();
    return address && address !== "0.0.0.0" ? address : null;
  } catch (e) {
    return null;
  }
}

// url() is called on every panel refresh and route.exe spawn is not free;
// 10 s of staleness is harmless for an address that only moves when a VPN or
// NIC changes.
const ROUTE_CACHE_TTL_MS = 10000;
const routeCache = { at: 0, output: null };

/**
 * The address this machine would use to reach the internet — i.e. the one the
 * game client is talking through. On Windows that is read straight out of the
 * route table (synchronous, no traffic, no tick-timing luck); elsewhere the
 * UDP probe above is the best available. Returns null if anything is odd.
 */
function outboundLocalIp() {
  if (process.platform === "win32") {
    try {
      if (routeCache.output === null || Date.now() - routeCache.at > ROUTE_CACHE_TTL_MS) {
        routeCache.at = Date.now();
        routeCache.output = require("child_process").execSync("route print -4 0.0.0.0", {
          encoding: "utf8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        });
      }
      const hit = matchRouteInterfaceIp(
        parseDefaultRouteIps(routeCache.output),
        require("os").networkInterfaces()
      );
      if (hit) return hit;
    } catch (e) {
      // route.exe missing or blocked — the fallback below still gets a say.
    }
  }
  return udpProbeLocalIp();
}

/**
 * @param {object} options
 * @param {(message:object) => void} options.onMessage  decoded photon message
 * @param {(state:{status:string, message:string}) => void} [options.onStatus]
 * @param {string} [options.device]      npcap device name; pinned, never switched
 * @param {object} [options.backend]     injected {Cap, decoders} for tests
 * @param {object} [options.parser]      injected photon parser for tests
 * @param {string|null} [options.localIp]     outbound address override
 * @param {() => string|null} [options.probeRouteIp]  route probe for the rerank; defaults to outboundLocalIp(), and the rerank always calls it FRESH rather than trusting `localIp`
 * @param {number} [options.switchAfterMs]    silence before trying the next NIC
 * @param {Function} [options.setTimer]       injectable timer for tests
 * @param {Function} [options.clearTimer]
 * @param {number} [options.healthMs]         watchdog sampling window
 * @param {Function} [options.setHealthTimer] injectable interval for tests
 * @param {Function} [options.clearHealthTimer]
 * @param {() => number} [options.now]        injectable clock
 * @param {() => number} [options.cpuMicros]  CPU microseconds burnt so far
 */
function createPacketTap({
  onMessage,
  onStatus = () => {},
  device,
  backend,
  parser,
  localIp,
  probeRouteIp = outboundLocalIp,
  switchAfterMs = DEFAULT_SWITCH_AFTER_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  healthMs = DEFAULT_HEALTH_MS,
  setHealthTimer = setInterval,
  clearHealthTimer = clearInterval,
  setRestartTimer = setTimeout,
  clearRestartTimer = clearTimeout,
  now = Date.now,
  cpuMicros = () => {
    const usage = process.cpuUsage();
    return usage.user + usage.system;
  },
} = {}) {
  let cap = null;
  // Two different questions. `wanted` is whether the monitor is on — the user's
  // switch. `cap` is whether a handle is open right now, which the watchdog
  // takes away and gives back while it heals a spinning tap. The monitor must
  // not read as stopped for the minutes that takes.
  let wanted = false;
  // Whichever Albion server is answering. The market uploader needs it to pick
  // the right regional ingest — the game's own IP is the only honest source,
  // since the app's region dropdown says nothing about which client is running.
  let serverIp = null;
  let candidates = [];
  let candidateIndex = 0;
  let packetsSeen = 0;
  // When the last packet arrived, for the route-change rerank below. null
  // means nothing has arrived yet, which is the walk's business, not this.
  let lastPacketAt = null;
  // Sticky: the first packet ends the walk's silence business for good, and
  // this remembers it. Never reset — it is what tells the silence restart
  // below apart from a capture that never saw traffic (the game is usually
  // just not running yet), which stays the walk's to handle.
  let everSawTraffic = false;
  // When the handle in hand was opened; null while closed. The silence
  // restart measures from here once the last packet is behind it, which is
  // what re-arms the gate after every heal.
  let openedAt = null;
  let switchTimer = null;
  // Kept so the panel can report what the decoder made of the traffic —
  // encrypted bodies and half-reassembled fragments are invisible otherwise.
  let photonParser = null;
  // Watchdog state: last CPU/packet sample, how many bad windows in a row, and
  // how many times the handle has been recycled this session.
  let healthTimer = null;
  let lastSample = null;
  let spinWindows = 0;
  let recycles = 0;
  let lastRecycleAt = null;
  // When the capture last moved adapters because the route did.
  let lastRerankAt = null;
  // Auto-restart state: the pending timer and how many times in a row a fresh
  // capture has gone bad, which is what widens the wait.
  let restartTimer = null;
  let restartAttempts = 0;

  function loadBackend() {
    if (backend) return backend;
    // `cap` is a native module: absent in the browser build, absent until npcap
    // is installed on Windows, and compiled against ONE ABI at a time. A binary
    // built for Node throws here under Electron and vice versa, so the error is
    // rewritten into the command that fixes it.
    try {
      return require("cap");
    } catch (e) {
      if (/NODE_MODULE_VERSION|was compiled against a different Node/i.test(e.message)) {
        const target = process.versions.electron ? "npm run rebuild:electron" : "npm run rebuild:node";
        throw new Error(`cap was built for a different runtime — run: ${target}`, { cause: e });
      }
      throw e;
    }
  }

  /**
   * Capture candidates, best first. Loopback-only and address-less adapters are
   * dropped entirely; among the rest the one holding `localIp` wins, then
   * physical adapters, then the order the OS gave. `routeIp` overrides the
   * address the ranking is built around — the rerank passes the FRESH probe
   * answer here, deliberately not the start-time `localIp` option.
   *
   * @param {object} Cap  capture library (for its device list)
   * @param {string|null} [routeIp]  the outbound address to rank around
   */
  function buildCandidates(Cap, routeIp = localIp === undefined ? outboundLocalIp() : localIp) {
    const devices = Cap.deviceList();
    if (device) {
      const hit = devices.find((d) => d.name === device || d.description === device);
      if (!hit) throw new Error(`no such capture device: ${device}`);
      return [hit];
    }
    const ranked = rankDevices(devices, routeIp);
    if (!ranked.length) throw new Error("no IPv4 capture device found");
    return ranked;
  }

  // npcap's descriptions are NDIS strings, not the friendly Windows names — a
  // Wi-Fi card can read as bare "Microsoft". The address disambiguates it, and
  // is what lets a user check the pick against ipconfig.
  function label(target) {
    const name = target.description || target.name;
    const addr = ipv4Addresses(target)[0];
    return addr ? `${name} (${addr})` : name;
  }

  function closeCap() {
    if (cap) {
      try { cap.close(); } catch (e) { /* already closed */ }
      cap = null;
      openedAt = null;
    }
  }

  function armSwitch() {
    if (switchTimer !== null) { clearTimer(switchTimer); switchTimer = null; }
    // A pinned device or the last candidate has nowhere to move to; the timer
    // still runs so the user is told the capture is silent.
    switchTimer = setTimer(() => {
      switchTimer = null;
      if (!cap || packetsSeen > 0) return;
      const current = candidates[candidateIndex];
      if (candidateIndex + 1 >= candidates.length) {
        onStatus({
          status: "idle",
          message: `no Albion traffic on ${label(current)} — is the game running?`,
        });
        // Silence on every adapter usually means the game is not running YET —
        // it is launched after the app, or a VPN reconnect moved its route.
        // Parking here forever would miss all of that, so after another grace
        // window the whole walk starts again from the best-ranked adapter.
        switchTimer = setTimer(() => {
          switchTimer = null;
          if (!wanted || !cap) return;
          closeCap();
          candidateIndex = 0;
          openDevice(candidates[0]);
        }, switchAfterMs);
        return;
      }
      candidateIndex++;
      const next = candidates[candidateIndex];
      onStatus({ status: "listening", message: `no Albion traffic on ${label(current)} — trying ${label(next)}` });
      closeCap();
      openDevice(next);
    }, switchAfterMs);
  }

  function clearHealth() {
    if (healthTimer !== null) { clearHealthTimer(healthTimer); healthTimer = null; }
    lastSample = null;
    spinWindows = 0;
  }

  /** Take a fresh baseline — after arming, and after every recycle. */
  function sampleHealth() {
    lastSample = { at: now(), cpu: cpuMicros(), packets: packetsSeen };
    spinWindows = 0;
  }

  /** Close the spinning handle and open the same adapter again. */
  function recycleCapture() {
    const target = candidates[candidateIndex];
    recycles++;
    lastRecycleAt = now();
    closeCap();
    if (!openDevice(target)) { pauseAndRetry(); return; }
    onStatus({
      status: "listening",
      message: `capture was spinning with no traffic — reopened ${label(target)}`,
    });
    sampleHealth();
  }

  /** How long to wait before the next attempt: doubling, and then capped. */
  function restartDelay() {
    return Math.min(RESTART_DELAY_MS * (2 ** restartAttempts), MAX_RESTART_DELAY_MS);
  }

  /**
   * Reopening in place did not cure it. Close the tap — that alone gives the
   * core back — and start the whole capture again later, device ranking
   * included, since the adapter itself may be what went away. The monitor stays
   * on: this heals without a click.
   */
  function pauseAndRetry() {
    const target = candidates[candidateIndex];
    if (switchTimer !== null) { clearTimer(switchTimer); switchTimer = null; }
    clearHealth();
    closeCap();
    const delay = restartDelay();
    restartAttempts++;
    if (restartTimer !== null) clearRestartTimer(restartTimer);
    restartTimer = setRestartTimer(() => {
      restartTimer = null;
      if (!wanted) return;
      // A fresh start(), not a reopen: candidates are ranked again and every
      // counter goes back to zero.
      wanted = false;
      if (!start()) {
        // No adapter right now (VPN down, NIC gone). Keep the monitor on and
        // come back to it — that is the same illness, one step further out.
        wanted = true;
        pauseAndRetry();
      }
    }, delay);
    if (restartTimer && typeof restartTimer.unref === "function") restartTimer.unref();
    onStatus({
      status: "idle",
      message: `capture kept spinning with no traffic on ${label(target)} — paused it; `
        + `retry in ${Math.round(delay / 60000)} min`,
    });
  }

  /**
   * Long silence on a capture that HAS carried traffic is not always a dead
   * adapter — sometimes the route moved and the NIC in hand is simply no
   * longer the way out (hotspot unplugged, Wi-Fi joined). The probe is taken
   * fresh and the start-time `localIp` option is deliberately ignored:
   * detecting that it went stale is the whole point. Every guard is cheap and
   * silent — standing idle on the same network must not churn adapters or
   * spam the status line, and a capture that never saw traffic is the walk's
   * business, not this.
   * @param {number} at  the current hand-clock time
   * @returns {boolean} whether the capture moved
   */
  function rerankForMovedRoute(at) {
    if (!cap || packetsSeen === 0) return false;
    if (restartTimer !== null) return false;       // already healing from a worse fault
    if (lastRerankAt !== null && at - lastRerankAt < RERANK_COOLDOWN_MS) return false;
    if (lastPacketAt === null || at - lastPacketAt < RERANK_SILENCE_MS) return false;
    if (device) return false;                      // a pinned device is never second-guessed
    const freshIp = probeRouteIp();
    if (!freshIp) return false;
    const current = candidates[candidateIndex];
    if (!current || ipv4Addresses(current).includes(freshIp)) return false;
    return rerankCapture(freshIp, at);
  }

  /** The action half: rebuild the ranking around `freshIp` and move. */
  function rerankCapture(freshIp, at) {
    const was = candidates[candidateIndex];
    const silentFor = Math.round((at - lastPacketAt) / 1000);
    let next;
    try {
      next = buildCandidates(loadBackend().Cap, freshIp);
    } catch (e) {
      // Nothing usable for the new route — the capture in hand still works;
      // keep it and let a later tick try again.
      return false;
    }
    if (next[0] === was) return false; // the new route rides an adapter npcap cannot open
    lastRerankAt = at;
    closeCap();
    candidates = next;
    candidateIndex = 0;
    if (!openDevice(next[0])) { pauseAndRetry(); return true; }
    // The new adapter starts with clean silence clocks, exactly like a fresh
    // start(): the counter reads zero until it proves itself, which re-arms
    // the walk and restarts the rerank's own silence baseline.
    packetsSeen = 0;
    lastPacketAt = null;
    // The old handle's CPU history must not read as the new one's first spin.
    sampleHealth();
    onStatus({
      status: "listening",
      message: `no traffic for ${silentFor}s — was ${label(was)}, trying ${label(next[0])}`,
    });
    return true;
  }

  /**
   * The silence that means the line died: the capture HAS carried traffic
   * (everSawTraffic — a capture that never did is the walk's business, since
   * the game is usually just not running yet), and nothing has arrived for
   * SILENCE_RESTART_MS — measured from the last packet, or from the open
   * itself once the heal has zeroed the counters, which is what re-arms the
   * gate: one heal per window, so a line that comes back is picked up within
   * one more. The addon reports no errors, so this is the only door out; a
   * pinned device gets it too, reopening the device it was pinned to.
   * @param {number} at  the current hand-clock time
   * @returns {boolean} whether the capture was restarted
   */
  function restartForDeadSilence(at) {
    if (!cap || !everSawTraffic) return false;
    if (restartTimer !== null) return false;       // already healing from a worse fault
    if (at - (lastPacketAt ?? openedAt) < SILENCE_RESTART_MS) return false;
    restartCapture(at);
    return true;
  }

  /**
   * The action half: close the idle-dead handle and run the whole start()
   * again — fresh probe, fresh ranking, every counter back to zero, exactly
   * what an app restart does minus the restart. start() refuses to run while
   * the monitor reads "on", so the switch is dropped for the call; if no
   * adapter can be found, the fault goes to the backoff like any other.
   * @param {number} at  the current hand-clock time
   */
  function restartCapture(at) {
    const was = candidates[candidateIndex];
    const silentFor = Math.round((at - lastPacketAt) / 1000);
    closeCap();
    wanted = false;
    if (!start()) {
      wanted = true;
      pauseAndRetry();
      return;
    }
    sampleHealth();
    onStatus({
      status: "listening",
      message: `no traffic for ${silentFor}s on ${label(was)} — restarted the capture`,
    });
  }

  function checkHealth() {
    if (!cap) return;
    const at = now();
    const cpu = cpuMicros();
    const previous = lastSample;
    lastSample = { at, cpu, packets: packetsSeen };
    if (!previous) return;

    const elapsed = at - previous.at;
    // Microseconds of CPU per millisecond of wall time = cores in use.
    const cores = elapsed > 0 ? (cpu - previous.cpu) / (elapsed * 1000) : Infinity;

    // A moved route is answered before the spin arithmetic: the handle in
    // hand is healthy, it is just listening in the wrong place.
    if (rerankForMovedRoute(at)) return;

    // A dead connection is answered next — but only on a COLD window. A
    // quiet handle that burns CPU is the spin detector's patient below, and
    // its cheap in-place recycles get their chance first; the idle-dead
    // handle this heals burns nothing at all, which is what makes it the
    // silence case.
    if (cores < SPIN_CORE_RATIO && restartForDeadSilence(at)) return;

    if (elapsed <= 0) return;
    // Traffic explains CPU. Only silence plus load is a spin.
    const quiet = packetsSeen === previous.packets;
    spinWindows = (quiet && cores >= SPIN_CORE_RATIO) ? spinWindows + 1 : 0;
    if (spinWindows < SPIN_WINDOWS) return;
    // The cooldown only applies once something has actually been recycled — a
    // clock that starts near zero must not read as "just recycled".
    if (lastRecycleAt !== null && at - lastRecycleAt < RECYCLE_COOLDOWN_MS) return;
    if (recycles >= MAX_RECYCLES) { pauseAndRetry(); return; }
    recycleCapture();
  }

  function armHealth() {
    if (healthTimer !== null) return;
    sampleHealth();
    healthTimer = setHealthTimer(checkHealth, healthMs);
    // The watchdog is never a reason for the process to stay alive.
    if (healthTimer && typeof healthTimer.unref === "function") healthTimer.unref();
  }

  function openDevice(target) {
    const { Cap, decoders } = loadBackend();
    const photon = parser || require("./photon-packets.js").createPhotonParser(onMessage);
    photonParser = photon;
    const buffer = Buffer.alloc(65535);
    cap = new Cap();

    let linkType;
    try {
      // Both transports: Albion carries Photon over TCP as well as UDP, and a
      // UDP-only tap misses whatever went the other way — indistinguishable
      // from a decoder that has gone deaf. The reference client filters both.
      linkType = cap.open(target.name, PHOTON_FILTER, 10 * 1024 * 1024, buffer);
    } catch (e) {
      // Npcap can be installed in admin-only mode, in which case this is the
      // one failure a user can actually fix.
      onStatus({ status: "error", message: `cannot open ${label(target)}: ${e.message}` });
      cap = null;
      return false;
    }
    if (cap.setMinBytes) cap.setMinBytes(MIN_TO_COPY_BYTES);
    openedAt = now();

    /**
     * Where this frame's Photon payload starts and ends, or null if the frame
     * is not Photon at all. Both transports are read: the length comes from the
     * UDP header directly, and for TCP from the IP total minus the two headers
     * (v4) or payloadlen minus the TCP header (v6).
     */
    function photonPayloadBounds(nbytes, ip) {
      if (ip.info.protocol === decoders.PROTOCOL.IP.UDP) {
        const udp = decoders.UDP(buffer, ip.offset);
        if (udp.info.srcport !== PHOTON_PORT && udp.info.dstport !== PHOTON_PORT) return null;
        // Inbound means the far end is the game server.
        if (udp.info.srcport === PHOTON_PORT) serverIp = ip.info.srcaddr;
        // udp.info.length is ALREADY payload-only — cap's decoder subtracts the
        // 8-byte header itself. Subtracting it again cut every packet short by
        // exactly one command; the packet still looked well-formed until its
        // last command, so the capture reported traffic while quietly losing a
        // fragment out of every order list. Clamp to the bytes actually
        // captured so a truncated frame cannot over-read.
        return { start: udp.offset, end: Math.min(udp.offset + udp.info.length, nbytes, buffer.length) };
      }
      if (ip.info.protocol === decoders.PROTOCOL.IP.TCP && decoders.TCP) {
        const tcp = decoders.TCP(buffer, ip.offset);
        if (tcp.info.srcport !== PHOTON_PORT && tcp.info.dstport !== PHOTON_PORT) return null;
        if (tcp.info.srcport === PHOTON_PORT) serverIp = ip.info.srcaddr;
        // v4's totallen covers the whole datagram, so both headers come off;
        // v6's payloadlen already excludes its 40-byte fixed header, so only
        // the TCP header does.
        const length = ip.info.payloadlen !== undefined
          ? Number(ip.info.payloadlen) - Number(tcp.hdrlen)
          : Number(ip.info.totallen) - Number(ip.hdrlen) - Number(tcp.hdrlen);
        if (!Number.isFinite(length) || length <= 0) return null;
        return { start: tcp.offset, end: Math.min(tcp.offset + length, nbytes, buffer.length) };
      }
      return null;
    }

    cap.on("packet", (nbytes) => {
      try {
        if (linkType !== "ETHERNET") return;
        const eth = decoders.Ethernet(buffer);
        // A phone hotspot puts the game on IPv6: probed live, 100% of port-5056
        // traffic arrived as 0x86DD frames. Guard on decoders.IPV6 like the TCP
        // guard below so backend stubs without it keep working.
        let ip = null;
        if (eth.info.type === decoders.PROTOCOL.ETHERNET.IPV4) ip = decoders.IPV4(buffer, eth.offset);
        else if (decoders.IPV6 && eth.info.type === decoders.PROTOCOL.ETHERNET.IPV6) ip = decoders.IPV6(buffer, eth.offset);
        if (!ip) return;
        const bounds = photonPayloadBounds(nbytes, ip);
        if (!bounds) return;

        // This adapter carries the game — the search is over. Say so: the grace
        // window may already have reported silence, and that line would
        // otherwise sit above a rising packet count for the rest of the session.
        packetsSeen++;
        lastPacketAt = now();
        everSawTraffic = true;
        if (packetsSeen === 1) {
          onStatus({ status: "listening", message: `listening on ${label(target)}` });
          // A tap that has actually carried a packet is well. Whatever backoff
          // an earlier bad spell earned is spent — the next one starts short.
          restartAttempts = 0;
        }

        if (bounds.end - bounds.start < PHOTON_HEADER_BYTES) return; // ack / keepalive
        photon.handle(Buffer.from(buffer.subarray(bounds.start, bounds.end)));
      } catch {
        /* malformed frame — skip */
      }
    });

    wanted = true;
    onStatus({ status: "listening", message: `listening on ${label(target)}` });
    armSwitch();
    armHealth();
    return true;
  }

  function start() {
    if (wanted) return true;
    let Cap;
    try {
      ({ Cap } = loadBackend());
    } catch (e) {
      onStatus({ status: "unavailable", message: `capture library missing (${e.message})` });
      return false;
    }

    try {
      candidates = buildCandidates(Cap);
    } catch (e) {
      onStatus({ status: "unavailable", message: e.message });
      return false;
    }

    candidateIndex = 0;
    packetsSeen = 0;
    lastPacketAt = null;
    lastRerankAt = null;
    recycles = 0;
    lastRecycleAt = null;
    return openDevice(candidates[0]);
  }

  function stop() {
    if (switchTimer !== null) { clearTimer(switchTimer); switchTimer = null; }
    if (restartTimer !== null) { clearRestartTimer(restartTimer); restartTimer = null; }
    restartAttempts = 0;
    clearHealth();
    closeCap();
    wanted = false;
    onStatus({ status: "stopped", message: "stopped" });
  }

  return {
    start,
    stop,
    // The monitor's switch — true while a paused capture waits to retry.
    get running() { return wanted; },
    // Whether a handle is open this instant. Only the watchdog cares.
    get capturing() { return cap !== null; },
    get serverIp() { return serverIp; },
    get packetsSeen() { return packetsSeen; },
    get photonStats() { return photonParser ? photonParser.stats : null; },
    get pendingFragments() { return photonParser ? photonParser.pendingFragments : 0; },
    get deviceName() { return candidates[candidateIndex] ? candidates[candidateIndex].name : null; },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPacketTap,
    rankDevices,
    outboundLocalIp,
    udpProbeLocalIp,
    parseDefaultRouteIps,
    matchRouteInterfaceIp,
    PHOTON_PORT,
  };
}
