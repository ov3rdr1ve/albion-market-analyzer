/**
 * Entry point of the capture utility process ("albion-capture").
 *
 * `cap` 0.2.1 has a close-path race: its non-blocking UnregisterWait lets a
 * packet callback already in flight touch a freed handle after pcap_close,
 * and every adapter switch, recycle and stop closes a handle. In the main
 * process that is an access violation with no message — the app just
 * vanishes (2026-09-25, 09-28, 10-02). Here it kills only this process, and
 * js/sniffer-supervisor.js in main restarts it.
 *
 * So this file owns the capture and nothing else: it runs createPacketTap
 * with a parser that does NOT parse — it batches the raw Photon payloads for
 * main (js/sniffer-batch.js), where the real parser and everything downstream
 * stay exactly as they were.
 *
 * Protocol, over Electron's parentPort (messages arrive as {data}):
 *   in   {type:"start", options:{device}}  {type:"stop"}
 *   out  {type:"batch", buf, offsets}      {type:"status", status}
 *        {type:"state", state:{running, capturing, serverIp, packetsSeen,
 *                              deviceName}} — on every status and every 2 s;
 *        the supervisor treats it as the heartbeat.
 *
 * Everything is injected through runHost, so tests/sniffer-host.test.cjs can
 * drive it without Electron or cap.
 */

const { createBatcher } = require("./sniffer-batch.js");

const STATE_EVERY_MS = 2000;

/**
 * @param {object} options
 * @param {object} options.parentPort  Electron's process.parentPort
 * @param {Function} options.createPacketTap
 * @param {(code:number) => void} options.exit
 * @param {Function} [options.setInterval]
 * @param {Function} [options.clearInterval]
 * @param {Function} [options.setTimer]    the batch flush timer
 * @param {Function} [options.clearTimer]
 */
function runHost({
  parentPort,
  createPacketTap,
  exit,
  setInterval: setEvery = setInterval,
  clearInterval: clearEvery = clearInterval,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const post = (message) => {
    try { parentPort.postMessage(message); } catch (e) { /* main is gone; nothing to tell */ }
  };
  const batcher = createBatcher({ post, setTimer, clearTimer });
  let sniffer = null;
  let heartbeat = null;

  function snapshot() {
    const s = sniffer;
    return {
      running: !!(s && s.running),
      capturing: !!(s && s.capturing),
      serverIp: (s && s.serverIp) || null,
      packetsSeen: (s && s.packetsSeen) || 0,
      deviceName: (s && s.deviceName) || null,
    };
  }
  const postState = () => post({ type: "state", state: snapshot() });

  function start(options) {
    if (sniffer && sniffer.running) { postState(); return; }
    // What packet-tap reads from a parser: handle() per payload, plus the
    // stats/pendingFragments it reports. The real numbers live in main.
    const parser = {
      handle: (buf) => batcher.push(buf),
      stats: {},
      pendingFragments: 0,
    };
    try {
      sniffer = createPacketTap({
        onMessage: () => {},
        onStatus: (status) => { post({ type: "status", status }); postState(); },
        device: options.device,
        parser,
      });
      if (sniffer.start() === false) postState();
    } catch (e) {
      post({ type: "status", status: { status: "unavailable", message: e.message } });
      postState();
    }
    if (heartbeat === null) heartbeat = setEvery(postState, STATE_EVERY_MS);
  }

  function stop() {
    if (heartbeat !== null) { clearEvery(heartbeat); heartbeat = null; }
    if (sniffer) {
      try { sniffer.stop(); } catch (e) { /* already closed */ }
    }
    batcher.flush();
    exit(0);
  }

  parentPort.on("message", (event) => {
    const message = event && event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === "start") start(message.options || {});
    else if (message.type === "stop") stop();
  });
}

if (process.parentPort) {
  runHost({
    parentPort: process.parentPort,
    createPacketTap: require("./packet-tap.js").createPacketTap,
    exit: (code) => process.exit(code),
  });
}

module.exports = { runHost };
