/**
 * Lazy catalog loader.
 *
 * index.html used to carry the 63 catalog scripts — js/data*.js, js/gear-*.js
 * and the item-name / resource-name / recipe / focus-spec / focus-cost /
 * item-value / black-market tables — as deferred tags. Deferred still blocks
 * dom-ready, and boot gates every table on DOMContentLoaded, so ~2.7MB of
 * catalogs held up first paint for seconds on every start. They are gone from
 * the markup; this file injects them after first paint, a small batch at a
 * time, and exposes the promise boot waits on.
 *
 * Four former markup tags read catalog consts AT EVAL TIME, so they ride the
 * loader too — a classic script's top-level const is a global LEXICAL binding
 * that only exists once its script has run, and a deferred tag would meet
 * undeclared identifiers now that its catalogs land after paint:
 *   js/gather-fame-rates.js — reads GATHER_UNITS_PER_HOUR at eval; injected
 *     immediately after js/data-gathering.js (the file that declares it), so
 *     its `(typeof GATHER_UNITS_PER_HOUR !== "undefined") ? null : require()`
 *     browser branch stays on the null side instead of ReferenceError-ing on
 *     require.
 *   js/gear.js, js/refining-chain-recipes.js, js/render-rerolling.js — spread
 *     or forEach the catalog consts at top level (GEAR_CLOTH_ARMOR & co.,
 *     RESOURCE_DEFS, QUALITY_TRANSITIONS); injected after EVERY catalog, as
 *     the last three entries.
 *
 * Contract:
 *   CATALOG_SCRIPTS  — the 67 paths: the 63 catalogs in the order index.html
 *                      used to list them, gather-fame-rates slotted after
 *                      data-gathering, the three top-level readers last.
 *   loadCatalogs(o)  — start (or join) the one load. Options count on the first
 *                      call only: { batch = 6, onProgress(done, total), yieldFn }.
 *   catalogsReady    — the load's promise; assigned as soon as the load starts.
 *   catalogsState()  — { total, loaded, failed, done, readyMs } for boot-timing.
 *
 * The load starts the moment this file is evaluated. The tag in index.html is
 * deferred like its neighbours were, so evaluation already happens after the
 * parse, and the injection itself is asynchronous — the parser is never
 * blocked. One microtask is taken before the first batch so a caller with
 * options can win the race (a test harness does exactly that); in the app
 * nothing calls loadCatalogs() and the defaults run.
 */

const CATALOG_SCRIPTS = [
  "js/item-names.js",
  "js/item-names-es.js",
  "js/resource-names.js",
  "js/data.js",
  "js/data-luxury.js",
  "js/data-consumables.js",
  "js/data-mounts.js",
  "js/data-farming.js",
  "js/data-black-zone.js",
  "js/data-gathering.js",
  // Reads GATHER_UNITS_PER_HOUR / FISH_UNITS_PER_HOUR at eval — must run
  // immediately after the file that declares them (see the header).
  "js/gather-fame-rates.js",
  "js/data-journals.js",
  "js/data-artifacts.js",
  "js/data-laborers.js",
  "js/data-weights.js",
  "js/data-skins.js",
  "js/data-buildings.js",
  "js/data-craft-journal-fame.js",
  "js/data-craft-planner.js",
  "js/gear-cloth-armor.js",
  "js/gear-leather-armor.js",
  "js/gear-leather-dragon.js",
  "js/gear-plate-armor.js",
  "js/gear-melee-light.js",
  "js/gear-melee-heavy.js",
  "js/gear-ranged.js",
  "js/gear-staves-a.js",
  "js/gear-staves-b.js",
  "js/gear-staves-c.js",
  "js/gear-crystal-weapons.js",
  "js/gear-crystal-weapons-b.js",
  "js/gear-token-substitute.js",
  "js/gear-offhand.js",
  "js/gear-capes.js",
  "js/gear-tools.js",
  "js/data-tracking-tools.js",
  "js/data-maps.js",
  "js/data-waystones.js",
  "js/data-energy-exchange.js",
  "js/data-craft-stations.js",
  "js/data-item-categories.js",
  "js/black-market-items.js",
  "js/data-roads-zones.js",
  "js/data-roads-brecilien.js",
  "js/data-roads-overland.js",
  "js/data-roads-portals.js",
  "js/gear-gatherer.js",
  "js/data-flip-extras.js",
  "js/focus-costs.js",
  "js/focus-spec-nodes.js",
  "js/focus-spec-items.js",
  "js/data-city-bonuses.js",
  "js/data-daily-bonus-groups.js",
  "js/recipes.js",
  "js/recipes-rare-potions.js",
  "js/recipes-dragon-potions.js",
  "js/data-enchant-sauces.js",
  "js/data-faction-fp-costs.js",
  "js/data-faction-chests.js",
  "js/data-favor-costs.js",
  "js/data-enchanting.js",
  "js/data-transmute.js",
  "js/item-values.js",
  "js/data-rerolling.js",
  // Top-level catalog readers, after EVERY catalog (see the header): gear.js
  // spreads the 16 gear-* tables into GEAR_RECIPES_ALL, refining-chain-recipes
  // forEaches RESOURCE_DEFS, render-rerolling's init IIFE reads
  // QUALITY_TRANSITIONS / QUALITY_NAMES.
  "js/gear.js",
  "js/refining-chain-recipes.js",
  "js/render-rerolling.js",
];

const state = {
  total: CATALOG_SCRIPTS.length,
  loaded: 0,
  failed: [],
  done: false,
  readyMs: null,
};

let singleton = null;
let catalogsReady = null;

/** Hand the thread back between batches. */
function defaultYield() {
  try {
    const yielded = typeof scheduler !== "undefined" ? scheduler?.yield?.() : null;
    if (yielded) return yielded;
  } catch (e) {
    /* fall through to the timeout */
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runLoad({ batch = 6, onProgress, yieldFn } = {}) {
  // A yield that throws (or a scheduler that rejects) must never stall boot.
  const yieldBetweenBatches = async () => {
    try {
      await (yieldFn ? yieldFn() : defaultYield());
    } catch (e) {
      /* keep going: the next batch appends without the pause */
    }
  };

  for (let i = 0; i < CATALOG_SCRIPTS.length; i += batch) {
    const slice = CATALOG_SCRIPTS.slice(i, i + batch);
    await Promise.all(
      slice.map(
        (src) =>
          new Promise((resolve) => {
            const el = document.createElement("script");
            el.src = src;
            // A dynamically inserted script ignores defer; async=false is what
            // keeps them executing in list order, which the global-const
            // catalog layout (later files read earlier files' consts) relies on.
            el.defer = false;
            el.async = false;
            // Both handlers go on before the element can possibly load.
            el.onload = () => {
              state.loaded++;
              resolve();
            };
            el.onerror = () => {
              state.failed.push(src);
              console.error(`[catalog-loader] failed to load ${src}`);
              resolve(); // one missing catalog degrades, it must not hang boot
            };
            (document.head || document.documentElement).appendChild(el);
          }),
      ),
    );
    state.done = state.loaded + state.failed.length >= state.total;
    if (state.done) state.readyMs = typeof performance !== "undefined" ? performance.now() : null;
    if (onProgress) {
      try {
        onProgress(state.loaded + state.failed.length, state.total);
      } catch (e) {
        /* progress is a diagnostic, never a dependency */
      }
    }
    await yieldBetweenBatches();
  }
  state.done = true;
  if (state.readyMs === null) state.readyMs = typeof performance !== "undefined" ? performance.now() : null;
}

/** Start the one load, or return the one already running. */
function loadCatalogs(options = {}) {
  if (singleton) return singleton;
  singleton = runLoad(options);
  return singleton;
}

/** Where the catalogs stand — read by boot-timing's summary. */
function catalogsState() {
  return {
    total: state.total,
    loaded: state.loaded,
    failed: state.failed.slice(),
    done: state.done,
    readyMs: state.readyMs,
  };
}

const hasDom =
  typeof document !== "undefined" &&
  typeof document.createElement === "function" &&
  typeof document.head?.appendChild === "function";

if (hasDom) {
  Promise.resolve().then(() => {
    catalogsReady = loadCatalogs();
  });
} else {
  // Node harness: nothing to inject into, nothing to wait for.
  catalogsReady = Promise.resolve(false);
}

if (typeof module !== "undefined" && module.exports) {
  const exportsObj = { CATALOG_SCRIPTS, loadCatalogs, catalogsState };
  // Live binding: the test harness reads catalogsReady after the load starts.
  Object.defineProperty(exportsObj, "catalogsReady", {
    get: () => catalogsReady,
    enumerable: true,
  });
  module.exports = exportsObj;
}
