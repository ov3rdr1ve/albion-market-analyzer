/**
 * The shared-folder transport (main process).
 *
 * Team sync is a Dropbox folder and nothing more: no server, no account, no
 * protocol. Everyone points at the same shared folder, each install owns one
 * pair of files in it, and the merge happens in the renderer next to the portal
 * graph — this module never learns what a portal is, exactly like
 * js/scan-price-file.js never learns what a price is.
 *
 * The layout is forced by how Dropbox resolves a clash. Two clients writing one
 * path produces `… (Ana's conflicted copy 2026-08-12).json` and one side's map
 * is quietly gone. So nobody shares a write target:
 *
 *   peer-<deviceId>.json         portals, small, written every few seconds
 *   peer-<deviceId>-prices.json  a window of captured cells, big and slow
 *
 * Every write lands atomically — a temp file, then a rename. Dropbox uploads
 * whatever is on disk the moment it changes, and half a JSON file would be
 * handed straight to every peer in the guild.
 *
 * Nothing here throws. A folder that is gone, unmounted, still syncing or
 * read-only comes back as {ok:false, error} and the loop tries again next tick.
 */

const PEER_PREFIX = "peer-";
const PEER_KINDS = { portals: "", prices: "-prices" };
const TMP_SUFFIX = ".tmp";

// Dropbox's own droppings, plus what its clients leave behind mid-sync. A
// conflicted copy is somebody's LOST write: reading it back would resurrect the
// data the folder already decided to drop.
const NOT_A_PEER = /conflicted copy|\.tmp$|^~|^\./i;

function pathJoin(dir, name) {
  const sep = /\\/.test(dir) && !/\//.test(dir) ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

/** The file this install owns for one kind of payload. */
function peerFileName(deviceId, kind) {
  if (!deviceId || !(kind in PEER_KINDS)) return null;
  return `${PEER_PREFIX}${deviceId}${PEER_KINDS[kind]}.json`;
}

/**
 * The inverse — and the only gate on what counts as a peer file at all.
 * @returns {{deviceId:string, kind:string}|null}
 */
function parsePeerFileName(name) {
  if (typeof name !== "string" || NOT_A_PEER.test(name)) return null;
  const match = /^peer-([a-z0-9]{4,32})(-prices)?\.json$/i.exec(name);
  if (!match) return null;
  return { deviceId: match[1], kind: match[2] ? "prices" : "portals" };
}

/**
 * Every peer file in the folder, with its mtime. This box's own files are not
 * peers — reading them back would fold our own portals in on themselves once
 * per tick for no gain.
 *
 * @returns {{ok:boolean, files:Array, error:string|null}}
 */
function listPeerFiles({
  folder,
  deviceId,
  readdir = (dir) => require("fs").readdirSync(dir),
  stat = (file) => require("fs").statSync(file),
} = {}) {
  if (!folder) return { ok: false, files: [], error: "no folder" };

  let names;
  try { names = readdir(folder); } catch (e) { return { ok: false, files: [], error: String(e.message || e) }; }

  const files = [];
  (names || []).forEach((name) => {
    const parsed = parsePeerFileName(name);
    if (!parsed || parsed.deviceId === deviceId) return;
    // A file can vanish between the listing and the stat — a peer left the
    // guild, Dropbox re-wrote it. That is one missing peer, not a failed tick.
    try {
      const info = stat(pathJoin(folder, name));
      files.push({ name, deviceId: parsed.deviceId, kind: parsed.kind, mtimeMs: Number(info.mtimeMs) || 0 });
    } catch (e) { /* gone since readdir */ }
  });
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, files, error: null };
}

/**
 * Read the peer files that changed since last time.
 *
 * `seen` is the {name: mtimeMs} map from the previous call — a quiet folder
 * therefore costs one readdir and no parses at all, which matters because this
 * runs every 20s for the life of the session and the price files are megabytes.
 *
 * The text is returned raw: validating it is the renderer's job
 * (js/team-sync-payload.js), where the caps and the merge rules live.
 *
 * @returns {{ok:boolean, peers:Array, mtimes:object, skipped:number, error:string|null}}
 */
function readPeerFiles({
  folder,
  deviceId,
  seen,
  readdir,
  stat,
  readFile = (f) => require("fs").readFileSync(f, "utf8"),
} = {}) {
  const listed = listPeerFiles({ folder, deviceId, readdir, stat });
  if (!listed.ok) return { ok: false, peers: [], peerIds: [], mtimes: {}, skipped: 0, error: listed.error };

  const known = seen && typeof seen === "object" ? seen : {};
  const peers = [];
  const mtimes = {};
  // Who is in the folder right now, whether or not their file needed re-reading.
  // The roster has to come from the listing: on a quiet tick nothing is parsed,
  // and counting only the files read would report a guild of nobody.
  const peerIds = [...new Set(listed.files.map((file) => file.deviceId))];
  let skipped = 0;

  listed.files.forEach((file) => {
    if (known[file.name] === file.mtimeMs) {
      mtimes[file.name] = file.mtimeMs;
      skipped++;
      return;
    }
    let text;
    try { text = readFile(pathJoin(folder, file.name)); } catch (e) { return; }
    // An unreadable file is deliberately NOT remembered: it is usually a peer
    // mid-upload, and the next tick must try it again rather than treat the
    // failure as "already seen".
    peers.push({ ...file, text });
    mtimes[file.name] = file.mtimeMs;
  });

  return { ok: true, peers, peerIds, mtimes, skipped, error: null };
}

/**
 * Publish one of this install's own files, atomically.
 *
 * @returns {{ok:boolean, file:string|null, error:string|null}}
 */
function writeOwnFile({
  folder,
  deviceId,
  kind,
  text,
  writeFile = (f, d) => require("fs").writeFileSync(f, d),
  rename = (from, to) => require("fs").renameSync(from, to),
  mkdir = (dir) => require("fs").mkdirSync(dir, { recursive: true }),
} = {}) {
  const name = peerFileName(deviceId, kind);
  if (!folder || !name) return { ok: false, file: null, error: "not configured" };
  if (typeof text !== "string" || text === "") return { ok: false, file: null, error: "nothing to write" };

  const target = pathJoin(folder, name);
  const temp = target + TMP_SUFFIX;
  try {
    try { mkdir(folder); } catch (e) { /* already there, or we are about to fail louder */ }
    writeFile(temp, text);
  } catch (e) {
    return { ok: false, file: null, error: String(e.message || e) };
  }
  try {
    rename(temp, target);
  } catch (e) {
    return { ok: false, file: null, error: String(e.message || e) };
  }
  return { ok: true, file: target, error: null };
}

module.exports = {
  PEER_PREFIX,
  PEER_KINDS,
  peerFileName,
  parsePeerFileName,
  listPeerFiles,
  readPeerFiles,
  writeOwnFile,
};
