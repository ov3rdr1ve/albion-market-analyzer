/**
 * Boot windows.
 *
 * An Electron window is visible the instant it is created, whether or not its
 * renderer has drawn anything — so creating the window at startup put an empty
 * 1400x900 rectangle on screen for as long as it took to read and compile ~5 MB
 * of catalog scripts out of the asar.
 *
 * So the window is built HIDDEN and shown on the first signal that its renderer
 * has painted. What it paints is the real page: the headings are there and the
 * tables boot is about to fill carry their own loading rows
 * (js/table-loading-mark.js), so there is no splash and no full-screen overlay
 * — the app arrives already working, and the user can scroll and click while it
 * finishes.
 *
 * A fallback timer shows the window anyway if no such signal ever arrives: a
 * renderer that fails to paint must not leave the app running with no window
 * the user can find.
 *
 * No `electron` import — the module is pure so tests/app-boot.test.cjs can
 * drive it with fake windows and fake timers.
 */

/**
 * Last resort only. Short, because nothing stands in front any more: with no
 * splash window there is NOTHING on screen while this runs, and a not-yet-
 * painted rectangle beats an empty desktop and a taskbar icon that goes
 * nowhere. A measured cold boot reaches its first frame in well under a second,
 * so anything past a few seconds is a renderer that is not coming.
 */
const BOOT_SHOW_TIMEOUT_MS = 4000;

/**
 * Options for the real window. Identical to what the app has always used,
 * except that it starts hidden.
 */
function mainWindowOptions({ preloadPath } = {}) {
  return {
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    // Still set: it is the colour behind the page between show() and the next
    // frame, and the colour of a resize gutter.
    backgroundColor: "#1a1b1e",
    autoHideMenuBar: true, // clean look; menu still reachable via Alt
    title: "Albion Market Analyzer",
    // Shown by bootWindows() once the renderer has painted — never before.
    show: false,
    // Measured: without this the hidden window produced no frame at all, so
    // `ready-to-show` never fired and only the fallback timer ever showed the
    // app — 30 s of splash for a page that had been ready for 29 of them.
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // The boot render pass hands the thread back through
      // requestAnimationFrame between phases (js/render-schedule.js). A
      // throttled renderer — hidden at startup, or minimised later — would sit
      // on those frames and never finish drawing the tables.
      backgroundThrottling: false,
      // Exposes only the narrow bridges declared in preload.js.
      preload: preloadPath,
    },
  };
}

/** True for a window that is gone (closed, destroyed, or never created). */
function isGone(win) {
  if (!win) return true;
  try {
    return typeof win.isDestroyed === "function" && win.isDestroyed();
  } catch (e) {
    return true; // an object that throws on inspection is not usable either
  }
}

/**
 * Put the window on screen.
 *
 * Runs at most once, whichever trigger gets there first — `ready-to-show` on a
 * healthy boot, the timer on a renderer that never paints. The window may
 * already be closed by the time we are called, so that is checked rather than
 * assumed.
 */
function bootWindows({
  main,
  // Signals that the page has something on it, as [emitter, event] pairs. More
  // than one because `ready-to-show` alone has been seen not to arrive at all
  // for a window that starts hidden; `dom-ready` on the webContents is the
  // second opinion, and whichever lands first wins.
  readyOn = [],
  timeoutMs = BOOT_SHOW_TIMEOUT_MS,
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
  onShown = () => {},
  now = () => Date.now(),
} = {}) {
  let done = false;
  let timer = null;
  let maximized = false; // once per boot: the first frame must already be full-size
  const startedAt = now();

  const handoff = (reason = "ready-to-show") => {
    if (done) return;
    done = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!isGone(main)) {
      // Maximize before the first show so the first visible frame is already
      // full-screen size, never a 1400x900 window that then resizes. There is
      // no `maximized` constructor option, so it has to happen here, at show
      // time. Tolerant of window objects without maximize (test fakes).
      if (!maximized) {
        maximized = true;
        try {
          if (typeof main.maximize === "function") main.maximize();
        } catch (e) { /* window closed mid-boot */ }
      }
      try { main.show(); } catch (e) { /* window closed mid-boot */ }
    }
    // Which trigger won, and how long it took: "shown by the fallback" means the
    // renderer never reported a frame, which is a different bug from a slow one.
    try { onShown(reason, now() - startedAt); } catch (e) { /* diagnostic only */ }
  };

  const signals = readyOn.length
    ? readyOn
    : (main ? [[main, "ready-to-show"]] : []);
  signals.forEach(([emitter, event]) => {
    if (!emitter || typeof emitter.once !== "function") return;
    emitter.once(event, () => handoff(event));
  });
  timer = setTimer(() => handoff("timeout"), timeoutMs);

  return { handoff, isDone: () => done };
}

module.exports = {
  BOOT_SHOW_TIMEOUT_MS,
  mainWindowOptions,
  bootWindows,
};
