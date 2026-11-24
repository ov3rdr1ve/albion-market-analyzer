/**
 * GPU choice, made before the app is ready.
 *
 * On a dual-GPU laptop Chromium renders on the integrated GPU by default. On an
 * Intel Iris Xe that meant "GPU state invalid after WaitForGetOffsetInRange" at
 * boot and a window that never repainted again. The GPU process stayed alive,
 * so `child-process-gone` never fired and there was nothing to recover from —
 * the only fix is to not start on that GPU. So the app always asks Chromium for
 * the high-performance one; a machine with a single GPU is unaffected.
 *
 * Command line switches only take effect before `ready`, so main.js calls this
 * at the top, before anything else touches the app.
 *
 * No `electron` import — the module is pure so tests/gpu-preference.test.cjs
 * can drive it with a fake command line.
 */

/** Chromium's name for it (gpu/config/gpu_switches.cc, kForceHighPerformanceGPU). */
const HIGH_PERFORMANCE_GPU_SWITCH = "force-high-performance-gpu";

/**
 * Append the switch to Electron's `app.commandLine`.
 *
 * Returns true only when it was appended. Left alone when it is already there
 * (e.g. passed on the launch line) and when `--disable-gpu` was passed, which
 * is the escape hatch for a machine where no GPU works and leaves none to pick.
 */
function applyGpuPreference(commandLine) {
  if (!commandLine || typeof commandLine.appendSwitch !== "function") return false;
  const has = (name) =>
    typeof commandLine.hasSwitch === "function" && commandLine.hasSwitch(name);
  if (has(HIGH_PERFORMANCE_GPU_SWITCH) || has("disable-gpu")) return false;
  commandLine.appendSwitch(HIGH_PERFORMANCE_GPU_SWITCH);
  return true;
}

module.exports = {
  HIGH_PERFORMANCE_GPU_SWITCH,
  applyGpuPreference,
};
