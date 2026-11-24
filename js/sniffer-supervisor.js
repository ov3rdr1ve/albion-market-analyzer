/**
 * The capture, supervised from main: createPacketTap's surface, backed by
 * a utility process.
 *
 * `cap` runs in the "albion-capture" utilityProcess (js/sniffer-host.js) so
 * its native close-path fault kills only that process instead of the whole
 * app. This module is what main.js hands monitor-session in place of the
 * sniffer — same start/stop and getters, so nothing downstream changes —
 * plus what a process boundary adds: noticing the child died and bringing it
 * back.
 *
 *   - Payload batches from the child go through the Photon parser HERE, so
 *     onMessage gets exactly what it got before (decoded messages hold
 *     Buffers and Maps, which do not survive the trip).
 *   - The child's state messages are mirrored into the getters and double as
 *     its heartbeat: 30 s of silence means a hung Npcap, and the child is
 *     killed, which counts as a crash.
 *   - A crash restarts after min(30 s, 1 s · 2^n) with ±50% jitter, n being
 *     the crashes in a row before it; a child that stays up a minute clears
 *     n. Five crashes inside two minutes trip a breaker: the monitor goes off
 *     and says so, and the next Start resets it.
 *
 * `running` is the monitor's switch, as it is on the sniffer itself — on
 * through a restart backoff, so the button keeps offering Stop and a Start
 * click does not build a second supervisor beside this one.
 *
 * No `electron` import: fork, timers, clock and parser are injected, so
 * tests/sniffer-supervisor.test.cjs drives all of it with fakes.
 */

const { unpackBatch } = require("./sniffer-batch.js");

const SERVICE_NAME = "albion-capture";
const STOP_GRACE_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 30000;
const STABLE_UPTIME_MS = 60000;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BREAKER_WINDOW_MS = 120000;
const BREAKER_CRASHES = 5;

const EMPTY_STATE = Object.freeze({
  running: false, capturing: false, serverIp: null, packetsSeen: 0, deviceName: null,
});

/**
 * @param {object} options
 * @param {(message:object) => void} options.onMessage  decoded photon message
 * @param {(state:{status:string, message:string}) => void} [options.onStatus]
 * @param {string} [options.device]   npcap device name, passed to the child
 * @param {Function} options.fork     utilityProcess.fork
 * @param {string} options.entryPath  path of js/sniffer-host.js
 * @param {{log:(m:string) => void}} [options.logger]
 * @param {Function} [options.createParser]  defaults to createPhotonParser
 * @param {() => number} [options.now]
 * @param {Function} [options.setTimer]
 * @param {Function} [options.clearTimer]
 * @param {() => number} [options.random]  backoff jitter source
 */
function createSupervisedSniffer({
  onMessage,
  onStatus = () => {},
  device,
  fork,
  entryPath,
  logger = { log() {} },
  createParser = (fn) => require("./photon-packets.js").createPhotonParser(fn),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  random = Math.random,
} = {}) {
  const parser = createParser(onMessage);
  const log = (m) => { try { logger.log(m); } catch (e) { /* logging never kills capture */ } };

  // The user's switch. Off after stop(), a failed start, or the breaker.
  let wanted = false;
  // The live child: {proc, sawRunning}. null while none is up.
  let current = null;
  let mirror = { ...EMPTY_STATE };
  let restartTimer = null;
  let heartbeatTimer = null;
  let stableTimer = null;
  // Crashes in a row (the backoff exponent) and recent crash times (the breaker).
  let failures = 0;
  let crashTimes = [];

  /** Timers here never hold the app open on quit. */
  function arm(fn, ms) {
    const id = setTimer(fn, ms);
    if (id && typeof id.unref === "function") id.unref();
    return id;
  }
  function disarm(id) { if (id !== null) clearTimer(id); return null; }

  function clearChildTimers() {
    heartbeatTimer = disarm(heartbeatTimer);
    stableTimer = disarm(stableTimer);
  }

  function armHeartbeat(child) {
    heartbeatTimer = disarm(heartbeatTimer);
    heartbeatTimer = arm(() => {
      heartbeatTimer = null;
      if (current !== child) return;
      log(`capture process pid=${child.proc.pid} sent no heartbeat for ${HEARTBEAT_TIMEOUT_MS / 1000}s — killing it`);
      try { child.proc.kill(); } catch (e) { /* already gone */ }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  /** Pipe the child's stdout/stderr into the log, one line at a time. */
  function pipeLines(stream) {
    if (!stream || typeof stream.on !== "function") return;
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + String(chunk)).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) if (line) log(`[capture] ${line}`);
    });
  }

  function onChildMessage(child, message) {
    if (current !== child || !message || typeof message !== "object") return;
    if (message.type === "batch") {
      for (const payload of unpackBatch(message)) {
        try { parser.handle(payload); } catch (e) { /* one bad frame must not stop the tap */ }
      }
    } else if (message.type === "status") {
      onStatus(message.status);
    } else if (message.type === "state" && message.state) {
      const s = message.state;
      mirror = {
        running: !!s.running,
        capturing: !!s.capturing,
        serverIp: s.serverIp || null,
        packetsSeen: Number(s.packetsSeen) || 0,
        deviceName: s.deviceName || null,
      };
      armHeartbeat(child);
      if (mirror.running) child.sawRunning = true;
      else if (!child.sawRunning) {
        // The child's own start() gave up (no npcap, no adapter) and it
        // already said why. That is the sniffer's "start() returned false":
        // the monitor goes off and the idle child is let go.
        log("capture process could not start a capture — stopping it");
        wanted = false;
        retire(child);
      }
    }
  }

  function onChildExit(child, code) {
    if (child.killTimer) child.killTimer = disarm(child.killTimer);
    if (current !== child) {
      log(`capture process pid=${child.proc.pid} exited (code=${code})`);
      return;
    }
    current = null;
    clearChildTimers();
    mirror = { ...EMPTY_STATE };
    if (!wanted) {
      log(`capture process pid=${child.proc.pid} exited (code=${code})`);
      return;
    }

    const at = now();
    crashTimes = crashTimes.filter((t) => at - t < BREAKER_WINDOW_MS);
    crashTimes.push(at);
    if (crashTimes.length >= BREAKER_CRASHES) {
      wanted = false;
      log(`capture process crashed (exitCode=${code}); ${crashTimes.length} crashes in `
        + `${BREAKER_WINDOW_MS / 60000} min — stopped after repeated crashes`);
      onStatus({
        status: "error",
        message: "capture stopped after repeated crashes — press Start to try again",
      });
      return;
    }

    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** failures) * (0.5 + random() / 2);
    failures++;
    log(`capture process crashed (exitCode=${code}) — restarting in ${Math.round(delay)} ms`);
    onStatus({
      status: "error",
      message: `capture process crashed (code ${code}) — restarting in ${Math.max(1, Math.round(delay / 1000))}s`,
    });
    restartTimer = disarm(restartTimer);
    restartTimer = arm(() => {
      restartTimer = null;
      if (wanted && !current) spawn();
    }, delay);
  }

  /** Fork a child and tell it to start. False if the fork itself failed. */
  function spawn() {
    let proc;
    try {
      proc = fork(entryPath, [], { serviceName: SERVICE_NAME, stdio: "pipe" });
    } catch (e) {
      wanted = false;
      log(`capture process failed to start: ${e.message}`);
      onStatus({ status: "unavailable", message: `capture process failed to start: ${e.message}` });
      return false;
    }
    const child = { proc, sawRunning: false, killTimer: null };
    current = child;
    mirror = { ...EMPTY_STATE };
    proc.on("message", (message) => onChildMessage(child, message));
    proc.on("exit", (code) => onChildExit(child, code));
    pipeLines(proc.stdout);
    pipeLines(proc.stderr);
    log(`capture process started (pid=${proc.pid})`);

    armHeartbeat(child);
    stableTimer = disarm(stableTimer);
    stableTimer = arm(() => {
      stableTimer = null;
      if (current === child) failures = 0;
    }, STABLE_UPTIME_MS);

    try {
      proc.postMessage({ type: "start", options: { device } });
    } catch (e) {
      log(`capture process did not take the start message: ${e.message}`);
    }
    return true;
  }

  /** Ask a child to stop; kill it if it has not gone after the grace period. */
  function retire(child) {
    if (current === child) {
      current = null;
      clearChildTimers();
      mirror = { ...EMPTY_STATE };
    }
    try { child.proc.postMessage({ type: "stop" }); } catch (e) { /* already gone */ }
    child.killTimer = arm(() => {
      child.killTimer = null;
      log(`capture process pid=${child.proc.pid} did not stop in ${STOP_GRACE_MS} ms — killing it`);
      try { child.proc.kill(); } catch (e) { /* already gone */ }
    }, STOP_GRACE_MS);
  }

  function start() {
    if (wanted) return true;
    wanted = true;
    // An explicit Start is the user's answer to the breaker.
    failures = 0;
    crashTimes = [];
    return spawn();
  }

  function stop() {
    wanted = false;
    restartTimer = disarm(restartTimer);
    if (current) retire(current);
    clearChildTimers();
    mirror = { ...EMPTY_STATE };
    onStatus({ status: "stopped", message: "stopped" });
  }

  return {
    start,
    stop,
    get running() { return wanted; },
    get capturing() { return mirror.capturing; },
    get serverIp() { return mirror.serverIp; },
    get packetsSeen() { return mirror.packetsSeen; },
    get photonStats() { return parser ? parser.stats : null; },
    get pendingFragments() { return parser ? parser.pendingFragments : 0; },
    get deviceName() { return mirror.deviceName; },
  };
}

module.exports = { createSupervisedSniffer, SERVICE_NAME };
