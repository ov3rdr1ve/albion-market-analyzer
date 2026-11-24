// Runs after patch-package in `npm install`: build the native `cap` module for
// Electron's ABI (what `npm start` and `npm run dist` load). The Node test
// suite never loads `cap` (js/packet-tap.js requires it lazily), so tests need
// no rebuild; `npm run rebuild:node` flips the binary back for plain Node.
// A missing C++ toolchain only warns: contributors can still lint and test.
const { spawnSync } = require("child_process");

const r = spawnSync("npx electron-rebuild -f -w cap", { stdio: "inherit", shell: true });
if (r.status !== 0) {
  console.warn("\n[postinstall] cap was not rebuilt for Electron (C++ toolchain missing?).");
  console.warn("[postinstall] Tests and lint still work; run `npm run rebuild:electron` before `npm start`.\n");
}
