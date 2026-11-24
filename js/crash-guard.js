/**
 * Evidence for silent deaths: the crash reporter plus a listener for every way
 * the main process can leave.
 *
 * On 2026-09-20 the app died 5 ms into a packet burst with one stderr line —
 * `crashpad_client_win.cc:867] not connected` — and left nothing else: no WER
 * event, no .dmp, no Crashpad directory, because nothing ever called
 * `crashReporter.start`. That line means a dump was REQUESTED by a client that
 * never connected; with no client there is no dump, and a death with no dump
 * names no module. Starting the reporter at boot closes that gap for good.
 *
 * The listeners close the other gap: exits that are not crashes at all. An
 * uncaught exception, a gone child process (the GPU one has form — see
 * js/gpu-preference.js), a gone renderer, the quit path and the final process
 * exit code each get one synchronous line in the daily log (js/main-log.js),
 * so the last moments of any future death are on disk even if the dump is not.
 *
 * The exception handlers deliberately do NOT exit or quit: this module gathers
 * evidence, it does not decide death. Whoever dies, dies with a paper trail.
 *
 * Installed at the very top of main.js, before anything that could die — and
 * crashReporter.start before any listener, so the dump pipeline exists before
 * the code it watches.
 *
 * No `electron` import — app and crashReporter are injected, so
 * tests/crash-guard.test.cjs can drive the whole thing with fakes.
 */

/** Whatever was thrown, in a form that always carries the message. */
function describeError(err) {
  return err instanceof Error && err.stack ? err.stack : String(err);
}

/** The one-line shape of a child-process-gone / render-process-gone detail. */
function describeDetails(details) {
  const d = details || {};
  // Utility processes carry their serviceName — "albion-capture" is the one
  // that runs cap (js/sniffer-supervisor.js).
  const name = d.name ? ` name=${d.name}` : "";
  return `type=${d.type}${name} reason=${d.reason} exitCode=${d.exitCode}`;
}

/**
 * Install every guard. Exactly once, at the top of main.js.
 *
 * @param {object} options
 * @param {object} options.app  the electron app
 * @param {object} options.crashReporter  electron's crashReporter module
 * @param {object} [options.process]  defaults to the real process
 * @param {Function} [options.createLogger]  defaults to js/main-log.js
 * @param {string} options.logDir  where the daily logs go
 * @returns {{logger:{log:(m:string)=>void}, trackWebContents:(wc:object)=>void}}
 */
function installCrashGuard({
  app,
  crashReporter,
  process: proc = process,
  createLogger = (o) => require("./main-log.js").createLogger(o),
  logDir,
} = {}) {
  // Dumps BEFORE anything else: a crashpad client that connected at boot is
  // one that can still write a .dmp when the burst hits. Off-site uploads
  // stay off — the dumps are for reading locally, next to the log.
  crashReporter.start({ uploadToServer: false });

  const logger = createLogger({ dir: logDir });

  proc.on("uncaughtException", (err) => {
    logger.log(`uncaughtException: ${describeError(err)}`);
  });
  proc.on("unhandledRejection", (reason) => {
    logger.log(`unhandledRejection: ${describeError(reason)}`);
  });

  app.on("child-process-gone", (_event, details) => {
    logger.log(`child-process-gone: ${describeDetails(details)}`);
  });
  app.on("will-quit", () => {
    logger.log("will-quit");
  });
  app.on("quit", (_event, exitCode) => {
    logger.log(`quit (exitCode=${exitCode})`);
  });
  proc.on("exit", (code) => {
    logger.log(`process exit (code=${code})`);
  });

  // Renderers report on their own webContents, not on the app, so every
  // window created after the install is tracked the moment it exists.
  const trackWebContents = (contents) => {
    contents.on("render-process-gone", (_event, details) => {
      logger.log(`render-process-gone: ${describeDetails(details)}`);
    });
  };
  app.on("web-contents-created", (_event, contents) => trackWebContents(contents));

  return { logger, trackWebContents };
}

module.exports = { installCrashGuard };
