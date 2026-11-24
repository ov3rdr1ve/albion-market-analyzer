/**
 * Test: what the app shows while it starts.
 *
 * Replaces tests/app-loading-splash.test.cjs, whose contract has been inverted.
 * The app used to start behind two curtains — a native splash window
 * (splash.html) and a full-screen #app-loader overlay held until the LAST table
 * was filled, which on a real price map is ~19 s of a screen nobody can read or
 * touch. Reported: computing tables should show a loading animation instead of a
 * splash.
 *
 * Contract now:
 *   no curtains        — splash.html is gone, main.js opens no stand-in window,
 *                        index.html carries no #app-loader overlay, and nothing
 *                        ships or loads either.
 *   the ring survives  — @keyframes app-loader-spin used to live in the deleted
 *                        inline <style>. Three existing marks turn on it, so it
 *                        has to be in css/styles.css now.
 *   per-table loaders  — js/app.js marks every table the boot pass plans, the
 *                        visible ones included, and clears them when the pass
 *                        ends however it ends.
 *   boot still timed   — js/boot-timing.js is loaded NOT deferred and prints one
 *                        summary line; it no longer shows or hides anything.
 *
 * Black-box: source and markup assertions plus a require of the timing module.
 * No jsdom, no app boot.
 *
 * Run: node tests/boot-loading.test.cjs
 */

const assert = require("assert");
const { appSource } = require("./helpers/app-source.cjs");
const fs = require("fs");
const path = require("path");
const { readIndexHtml, readStyles } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const html = readIndexHtml();
const appJs = appSource();
const mainJs = read("main.js");
const css = readStyles();

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} - ${e.message}`); failed++; }
}

// ── nothing covers the app any more ───────────────────────────────────────

console.log("\n=== No splash, no overlay ===");

test("splash.html is gone", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "splash.html")));
});

test("js/app-loader.js is gone", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "js", "app-loader.js")));
});

[
  ["index.html", html, ['id="app-loader"', "app-loader-status", "app-loader-out", "js/app-loader.js"]],
  ["main.js", mainJs, ["splash", "createSplash", "splashWindowOptions"]],
  ["js/app-boot.js", read("js/app-boot.js"), ["splashWindowOptions"]],
  ["js/app.js", appJs, ["setAppLoaderStatus", "setAppLoaderProgress", "hideAppLoader", "bootPhaseLabel"]],
].forEach(([label, source, banned]) => {
  banned.forEach((needle) => {
    test(`${label} no longer mentions ${needle}`, () => {
      // Case-insensitive so a stray comment counts too: a curtain that is only
      // half removed is the state this whole change exists to leave behind.
      assert.ok(
        !source.toLowerCase().includes(needle.toLowerCase()),
        `found "${needle}"`,
      );
    });
  });
});

test("splash.html is not packed into the app", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!pkg.build.files.includes("splash.html"));
});

// ── the spinning ring outlived the overlay it came from ───────────────────

console.log("\n=== The ring vocabulary ===");

test("@keyframes app-loader-spin lives in css/styles.css", () => {
  // It used to be inlined in index.html's <head>, which is deleted. Three marks
  // that have nothing to do with boot animate on it.
  assert.ok(/@keyframes app-loader-spin/.test(css));
  assert.ok(!/@keyframes app-loader-spin/.test(html), "and not in the markup any more");
});

[".pe-pending::after", ".search-fetch-status::after", ".row-computing::after"]
  .forEach((rule) => {
    test(`${rule} still turns`, () => {
      // The declaration, not a mention of the name in a comment above it.
      const at = css.indexOf("\n" + rule + " {");
      assert.ok(at > -1, "the rule exists");
      const block = css.slice(at, css.indexOf("}", at));
      assert.ok(
        block.includes("animation: app-loader-spin"),
        "and animates on the keyframe",
      );
    });
  });

test("the loading row honours reduced motion", () => {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.ok(at > -1);
  assert.ok(css.slice(at, at + 400).includes(".row-computing::after"));
});

// ── the per-table loading animation ───────────────────────────────────────

console.log("\n=== Per-table loading rows ===");

test("index.html loads js/table-loading-mark.js", () => {
  assert.ok(/<script src="js\/table-loading-mark\.js" defer><\/script>/.test(html));
});

test("boot marks every table it plans, visible ones included", () => {
  // The old code filtered these to `phase !== "visible"` because the overlay
  // covered the visible tables. There is no overlay, so those are precisely the
  // tables the user is watching.
  assert.ok(/markTableLoading\(/.test(appJs), "app.js marks tables loading");
  assert.ok(
    !/phase !== "visible"[\s\S]{0,120}markTable/.test(appJs),
    "the visible phase is no longer skipped",
  );
});

test("a drawn table drops its mark", () => {
  assert.ok(/tableLoadingDone\(/.test(appJs));
});

test("the pass clears whatever it never reached, failure included", () => {
  assert.ok(
    /\}\)\(\)\.finally\(\(\) => \{[\s\S]*?clearTablesLoading/.test(appJs),
    "clearTablesLoading is in the hydration .finally()",
  );
});

test("markTableComputing still exists for the re-render scheduler", () => {
  // js/render-async.js is wired to this name; both paths want the same mark.
  assert.ok(/function markTableComputing\(/.test(appJs));
  assert.ok(/markComputing: markTableComputing/.test(appJs));
});

test("boot still clears the fill flag when the pass is over", () => {
  assert.ok(/setBootFilling\(false\)/.test(appJs));
});

test("the craft list's sources are still scheduled as steps", () => {
  // Not for a splash to animate any more — so the browser gets a frame between
  // each and the page stays scrollable through the longest block in the app.
  assert.ok(/listSources:[\s\S]{0,120}craftListSourceTableIds\(\)/.test(appJs));
});

// ── boot timing ───────────────────────────────────────────────────────────

console.log("\n=== Boot timing ===");

test("js/boot-timing.js is loaded eagerly, before the catalog scripts", () => {
  assert.ok(/<script src="js\/boot-timing\.js"><\/script>/.test(html));
  assert.ok(/<script src="js\/app\.js" defer><\/script>/.test(html), "app.js stays deferred");
  assert.ok(
    html.indexOf("js/boot-timing.js") < html.indexOf("js/app.js"),
    "and runs first",
  );
});

test("app.js reports its boot stages", () => {
  assert.ok(/bootStage\(/.test(appJs));
  assert.ok(/bootFinish\(\)/.test(appJs));
});

test("bootFinish prints one summary line naming each stage", () => {
  const timing = require(path.join(ROOT, "js", "boot-timing.js"));
  const logged = [];
  const realInfo = console.info;
  console.info = (line) => logged.push(String(line));
  try {
    timing.bootStage("Restoring saved prices…");
    timing.bootStage("Computing tables…");
    timing.bootFinish();
  } finally {
    console.info = realInfo;
  }
  const summary = logged.find((l) => l.startsWith("[boot] document")) || "";
  assert.ok(summary, "a summary line is printed");
  assert.ok(summary.includes("Restoring saved prices"), "the stages are in it");
  assert.ok(summary.includes("Computing tables"));
  assert.ok(/total \d+ms/.test(summary), "and a total");
});

test("bootFinish is idempotent and a late stage is ignored", () => {
  const timing = require(path.join(ROOT, "js", "boot-timing.js"));
  const logged = [];
  const realInfo = console.info;
  console.info = (line) => logged.push(String(line));
  try {
    timing.bootStage("too late");
    timing.bootFinish();
  } finally {
    console.info = realInfo;
  }
  assert.strictEqual(logged.length, 0, "the second finish prints nothing");
});

// ── lazy catalog loading ─────────────────────────────────────────────────────

console.log("\n=== Lazy catalog loading ===");

test("index.html carries none of the catalog script tags any more", () => {
  // Exact-list check: no remaining tag src is one of the paths the loader
  // injects — the strongest form of "they are all gone".
  const loader = require(path.join(ROOT, "js", "catalog-loader.js"));
  const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  const leftovers = srcs.filter((s) => loader.CATALOG_SCRIPTS.includes(s));
  assert.deepStrictEqual(leftovers, [], `still in the markup: ${leftovers.join(", ")}`);
});

test("index.html carries no catalog-style script tag under any name", () => {
  // Prefix check over the catalog families. focus-spec-explain.js / focus-play.js
  // / gear.js / recipe-resolver.js stay — they are app code, not catalogs.
  const re = /<script[^>]*src="js\/(?:data[^"]*|gear-[^"]*|item-names[^"]*|resource-names[^"]*|recipes[^"]*|focus-spec-(?:items|nodes)[^"]*|focus-costs[^"]*|item-values[^"]*|black-market-items[^"]*)"/;
  const hit = html.match(re);
  assert.ok(!hit, `found a catalog tag still in index.html: ${hit && hit[0]}`);
});

test("index.html loads js/catalog-loader.js deferred, before js/app.js", () => {
  assert.ok(
    /<script src="js\/catalog-loader\.js" defer><\/script>/.test(html),
    "the loader tag is there, deferred like its neighbours",
  );
  assert.ok(
    html.indexOf("js/catalog-loader.js") < html.indexOf("js/app.js"),
    "and it is injected before app.js evaluates",
  );
});

test("app.js awaits the catalogs before the catalog merges", () => {
  assert.ok(/await catalogsReady/.test(appJs), "app.js waits on catalogsReady");
  assert.ok(
    appJs.indexOf("await catalogsReady") < appJs.indexOf("buildArtifactFlipItems("),
    "before buildArtifactFlipItems() reads ARTIFACT_MAPPING",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
