/**
 * A tiny synchronous log for the main process's last words.
 *
 * The 2026-09-20 crash left exactly one stderr line and nothing else: the
 * process was gone before anything buffered could be flushed. Whatever writes
 * here has to be synchronous appendFileSync — an async stream is a promise to
 * write later, and "later" is exactly what a dying process does not have.
 *
 * Failure is never fatal here, twice over. The logger exists to record a
 * death, so it must not be able to cause one: a full disk, a missing dir, a
 * file locked by the crash dump being written are all swallowed. And it must
 * not grow forever: each write leaves at most the 7 newest main-*.log files,
 * deleting older ones.
 *
 * No `electron` import — the module is pure so tests/crash-guard.test.cjs can
 * drive it with a fake filesystem.
 */

/** The retention window: how many daily files survive a rotation. */
const KEEP_FILES = 7;

/** Only these files are rotation's business; nothing else is ever deleted. */
const LOG_FILE = /^main-\d{4}-\d{2}-\d{2}\.log$/;

/** The local calendar date, as the log file names it: YYYY-MM-DD. */
function localDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Build a logger that appends to `dir/main-YYYY-MM-DD.log`.
 *
 * Every filesystem capability is injectable so tests can simulate the disk;
 * the defaults do the real thing. `now` is injectable so a test can pin the
 * day the log names.
 *
 * @param {object} options
 * @param {string} options.dir  the directory the daily files live in
 * @param {()=>Date} [options.now]
 * @param {(d:string)=>void} [options.mkdir]
 * @param {(f:string,data:string)=>void} [options.append]
 * @param {(d:string)=>string[]} [options.readdir]
 * @param {(f:string)=>void} [options.remove]
 * @param {(a:string,b:string)=>string} [options.join]
 */
function createLogger({
  dir,
  now = () => new Date(),
  mkdir = (d) => require("fs").mkdirSync(d, { recursive: true }),
  append = (f, data) => require("fs").appendFileSync(f, data),
  readdir = (d) => require("fs").readdirSync(d),
  remove = (f) => require("fs").unlinkSync(f),
  join = (a, b) => require("path").join(a, b),
} = {}) {
  let dirReady = false;
  // The name of the day rotation last ran for: a burst of lines in one death
  // must not rescan the directory per line, but a new day must rotate.
  let rotatedFor = null;

  /** Keep the newest KEEP_FILES logs; delete the rest. Never throws. */
  function rotate() {
    let entries;
    try { entries = readdir(dir); } catch (e) { return; } // unreadable dir: skip
    const logs = entries.filter((f) => LOG_FILE.test(f)).sort();
    // ISO dates sort lexicographically, so the tail is the oldest.
    for (const victim of logs.slice(0, Math.max(0, logs.length - KEEP_FILES))) {
      try { remove(join(dir, victim)); } catch (e) { /* locked (a dump?) */ }
    }
  }

  /**
   * Append one line, ISO-timestamped, to the day's file.
   *
   * @param {string} message  the line, without newline
   * @returns {string} the file it was written to (or aimed at)
   */
  function log(message) {
    const date = now();
    const file = join(dir, `main-${localDate(date)}.log`);
    if (!dirReady) {
      dirReady = true; // only ever attempt it once — a bad dir stays bad
      try { mkdir(dir); } catch (e) { /* read-only profile: keep trying anyway */ }
    }
    try { append(file, `${date.toISOString()} ${message}\n`); } catch (e) { /* full disk */ }
    if (rotatedFor !== `main-${localDate(date)}.log`) {
      rotatedFor = `main-${localDate(date)}.log`;
      try { rotate(); } catch (e) { /* rotation is housekeeping, never load-bearing */ }
    }
    return file;
  }

  return { log };
}

module.exports = { createLogger, KEEP_FILES };
