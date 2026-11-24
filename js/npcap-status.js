/**
 * Is the npcap driver present, and what should be done if it is not.
 *
 * The live monitor reads packets off the wire through the native `cap` module,
 * which is only a thin binding: the actual capture driver is npcap, a separate
 * Windows product this app cannot install for you.
 *
 * WHY IT IS NOT SIMPLY BUNDLED: the free Npcap licence does not grant
 * redistribution rights, and its silent installer (/S) is an Npcap OEM feature.
 * So the honest options are (a) ship a licensed OEM installer that whoever
 * builds the package drops into build/npcap/, or (b) send the user to
 * npcap.com. Both are covered here; the app picks whichever is available.
 *
 * Node/Electron-main only — the renderer never sees a filesystem.
 */

const path = require("path");

const NPCAP_DOWNLOAD_URL = "https://npcap.com/#download";

/**
 * Places that only contain a file once npcap (or WinPcap, whose API npcap can
 * take over) is installed. Any single hit is proof: an install with
 * WinPcap-compatible mode off never creates System32\wpcap.dll, and a driver
 * present without the DLLs still means the user has npcap and only needs a
 * repair rather than a first-time download.
 */
function npcapProbePaths(systemRoot) {
  const root = systemRoot || "C:\\Windows";
  return [
    path.win32.join(root, "System32", "drivers", "npcap.sys"),
    path.win32.join(root, "System32", "Npcap", "wpcap.dll"),
    path.win32.join(root, "System32", "wpcap.dll"),
    path.win32.join(root, "SysWOW64", "Npcap", "wpcap.dll"),
  ];
}

/**
 * @param {object} options
 * @param {string} [options.platform]    process.platform
 * @param {string} [options.systemRoot]  %SystemRoot%
 * @param {(p:string)=>boolean} [options.exists]  fs.existsSync
 * @returns {boolean} true when the capture driver is usable — and always true
 *   off Windows, where libpcap is the platform's own affair and there is
 *   nothing for this app to prompt about.
 */
function isNpcapInstalled({
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
  exists = require("fs").existsSync,
} = {}) {
  if (platform !== "win32") return true;
  return npcapProbePaths(systemRoot).some((p) => {
    try { return !!exists(p); } catch (e) { return false; }
  });
}

/**
 * A licensed Npcap OEM installer placed in the packaged app's resources by
 * whoever built it. Absent in the public build, so the lookup must be quiet:
 * a missing directory is the normal case, not an error.
 *
 * @returns {string|null} full path to the installer to run
 */
function findBundledNpcapInstaller({ dir, listFiles = require("fs").readdirSync } = {}) {
  if (!dir) return null;
  let names;
  try { names = listFiles(dir) || []; } catch (e) { return null; }
  const installers = names.filter((n) => typeof n === "string" && /\.exe$/i.test(n));
  if (!installers.length) return null;
  // Newest by name: npcap installers are versioned (npcap-1.82.exe), so the
  // highest string sorts to the version to install.
  installers.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return path.win32.join(dir, installers[installers.length - 1]);
}

/**
 * What to offer the user, given what was found.
 *   none     — nothing to do,
 *   run      — launch the bundled installer at `target`,
 *   download — open `target` in the browser.
 */
function npcapAction({ installed, bundledInstaller } = {}) {
  if (installed) return { kind: "none", target: null };
  if (bundledInstaller) return { kind: "run", target: bundledInstaller };
  return { kind: "download", target: NPCAP_DOWNLOAD_URL };
}

module.exports = {
  NPCAP_DOWNLOAD_URL,
  npcapProbePaths,
  isNpcapInstalled,
  findBundledNpcapInstaller,
  npcapAction,
};
