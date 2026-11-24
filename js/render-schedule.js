/**
 * Boot render schedule.
 *
 * renderAllTables (js/app.js) draws every table in one synchronous pass. That is
 * right for a scan — the user pressed a button and is waiting for all of it —
 * but at startup it measured 19.3 s on a real price map, during which the window
 * was up and completely frozen: the per-table loading rows could not animate,
 * nothing scrolled, nothing could be clicked. Almost none of that time was spent on what the user
 * was looking at. The cost sat in the craft list catching its sources up (5.7 s,
 * dragging the Craft Planner in with it) and in collapsed feeder tables computed
 * only because a Top-10 board was open.
 *
 * So boot runs the same work as a sequence of phases, handing the thread back to
 * the browser between them:
 *
 *   visible → the tables actually on screen. Boot uncovers the app after these.
 *   sources → collapsed feeders, needed only because a board reads their cache.
 *   boards  → the two Top-10s, which project over the caches filled above.
 *   list    → My Crafting List, which renders through those same sources.
 *
 * Between phases, not between tables: a yield is a full layout and paint of a
 * page that can hold 80 000 nodes, and yielding after every one of the fourteen
 * tables measured SLOWER end to end (37 s) than the single blocking pass it
 * replaced (19 s). Four paints is the point — the first one is what puts a
 * usable app on screen.
 *
 * The same two functions also drive the re-render that follows a price edit or a
 * header toggle (js/render-async.js), which is the identical problem one gesture
 * later: that pass used to run synchronously and froze the window for as long as
 * it took. Two options exist for it and are inert at boot:
 *
 *   first     → the table the user just edited, drawn ahead of everything in its
 *               own "edited" phase so the number they typed appears at once.
 *   budgetMs  → yield INSIDE a phase once a run of tables has eaten that many ms.
 *               Boot leaves it at 0 and keeps its four paints; a re-render turns
 *               it on, because there the visible phase is the whole page and
 *               holding the thread for all of it is the freeze being fixed.
 *
 * Nothing here touches the DOM or the clock: the caller supplies `isHidden`, the
 * renderers, the yield and (for the budget) the clock, so the whole schedule is
 * testable in Node (tests/render-schedule.test.cjs).
 */

/** The Top-10 boards. They read other tables' caches, so they go last but one. */
const BOARD_TABLES = ["joined-summary-table", "joined-focus-table", "bm-board-table"];

/** My Crafting List — not a profit table, but it renders through them. */
const CRAFT_LIST_TABLE = "craft-list-table";

/** Rerolling has no rows until a quality-aware scan has run. */
const QUALITY_ONLY_TABLES = new Set(["rerolling-table"]);

const BOOT_PHASES = ["visible", "sources", "boards", "list"];

/**
 * Boot's phases, plus the two a re-render adds: the edited table in front, and
 * the craft list's own sources broken out ahead of the list that reads them.
 */
const RERENDER_PHASES = ["edited", "visible", "sources", "boards", "list-sources", "list"];

/**
 * Plan a boot pass.
 *
 * @param {object}   options
 * @param {string[]} options.order           table ids in the app's draw order
 * @param {Function} options.isHidden        (tableId) => boolean
 * @param {Set}      options.summarySources  tables the boards read
 * @param {boolean}  [options.hasQuality]    a quality-aware map is loaded
 * @param {string[]} [options.boards]
 * @param {string}   [options.craftList]
 * @param {string[]} [options.first]         tables to draw before all others
 * @param {string[]} [options.listSources]   tables the craft list reads
 * @returns {{id: string, phase: string}[]} steps, in the order to run them
 */
function bootRenderSteps({
  order = [],
  isHidden = () => true,
  summarySources = new Set(),
  hasQuality = false,
  boards = BOARD_TABLES,
  craftList = CRAFT_LIST_TABLE,
  first = [],
  listSources = [],
} = {}) {
  const drawable = order.filter(
    (id) => !QUALITY_ONLY_TABLES.has(id) || hasQuality,
  );
  const openBoards = boards.filter((id) => !isHidden(id));

  const steps = [];
  const taken = new Set();
  const add = (id, phase) => {
    if (taken.has(id)) return;
    taken.add(id);
    steps.push({ id, phase });
  };

  // The table the edit was made in, so the number the user typed lands in the
  // first paint instead of behind every other table. A board or the craft list
  // is never eligible however it is asked for: both project over the source
  // tables' caches, so drawing one first would paint the OLD number and then
  // correct it a second later — worse than making the user wait for it.
  first.forEach((id) => {
    if (!drawable.includes(id) || boards.includes(id) || id === craftList) return;
    if (isHidden(id)) return;
    add(id, "edited");
  });

  // On screen: the only work the user is actually waiting for.
  drawable.forEach((id) => {
    if (!boards.includes(id) && !isHidden(id)) add(id, "visible");
  });

  // Collapsed, but a board projects over its cache — so it is computed and not
  // drawn. Without an open board this phase is empty, which is the whole point
  // of the gating in js/render-gating.js.
  if (openBoards.length) {
    drawable.forEach((id) => {
      if (isHidden(id) && summarySources.has(id)) add(id, "sources");
    });
  }

  openBoards.forEach((id) => add(id, "boards"));

  // The craft list renders through its sources, and catches up any that are
  // stale or empty INSIDE its own renderer — 8.7 s in one unbroken block on a
  // measured price map, the biggest freeze in the app. Scheduling them here
  // does not add work, it splits work the list was going to do anyway, so the
  // browser gets a frame between each. Deliberately NOT filtered by isHidden:
  // a collapsed source is exactly the one the list has to render.
  listSources.forEach((id) => {
    if (!drawable.includes(id) || boards.includes(id) || id === craftList) return;
    add(id, "list-sources");
  });

  add(craftList, "list");

  return steps;
}

/**
 * Run a plan, one table per turn.
 *
 * @param {{id: string, phase: string}[]} steps
 * @param {object}   options
 * @param {Function} options.render     (tableId) => void
 * @param {Function} options.yieldTo    () => Promise, called before each phase
 * @param {Function} [options.onPhase]  (phase) => void, once that phase is done
 * @param {Function} [options.onError]  (tableId, error) => void
 * @param {Function} [options.cancelled] () => boolean, checked between tables
 * @param {string[]} [options.phases]   phases to report even when empty
 * @param {number}   [options.budgetMs] yield mid-phase after this much work.
 *                                      0 (the default, and boot) never does.
 * @param {Function} [options.now]      the clock the budget is measured on
 * @param {Function} [options.onStep]   (step, index, total) before each render
 * @returns {Promise<{rendered: number, failed: number}>}
 */
async function runRenderSteps(steps, {
  render,
  yieldTo = async () => {},
  onPhase = () => {},
  onError = (id, e) => {
    if (typeof console !== "undefined") console.error(`${id}:`, e);
  },
  cancelled = () => false,
  phases = null,
  budgetMs = 0,
  now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  onStep = () => {},
} = {}) {
  let rendered = 0;
  let failed = 0;
  const reported = new Set();

  const finishPhase = (phase) => {
    if (phase === null || reported.has(phase)) return;
    reported.add(phase);
    try { onPhase(phase); } catch (e) { /* a listener must not stop the pass */ }
  };

  let current = null;
  // When the current unbroken run of renders started, for the budget below.
  let blockStart = now();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (cancelled()) break;
    if (step.phase !== current) {
      finishPhase(current);
      current = step.phase;
      // Before the phase, not after: the frame showing what the last phase drew
      // has to land before the next one takes the thread for seconds.
      await yieldTo();
      if (cancelled()) break;
      blockStart = now();
    }
    try { onStep(step, i, steps.length); } catch (e) { /* a listener must not stop the pass */ }
    try {
      // A renderer may be chunked — one that computes across its own yields
      // and hands back a promise. Awaited only when it actually returns one, so
      // an ordinary synchronous renderer costs not even a microtask.
      const drawing = render(step.id);
      if (drawing && typeof drawing.then === "function") await drawing;
      rendered++;
    } catch (e) {
      failed++;
      onError(step.id, e);
    }
    if (cancelled()) break;
    // One phase can be the whole visible page on a re-render, and holding the
    // thread for all of it is exactly the freeze this exists to remove. Boot
    // leaves budgetMs at 0 and keeps running its phases unbroken.
    if (budgetMs > 0 && now() - blockStart >= budgetMs && i + 1 < steps.length
        && steps[i + 1].phase === current) {
      await yieldTo();
      if (cancelled()) break;
      blockStart = now();
    }
  }
  finishPhase(current);

  // A phase with nothing in it never became `current`, but boot still waits on
  // it — an empty visible phase must not stall the pass forever.
  (phases || BOOT_PHASES).forEach(finishPhase);

  return { rendered, failed };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BOARD_TABLES,
    CRAFT_LIST_TABLE,
    BOOT_PHASES,
    RERENDER_PHASES,
    bootRenderSteps,
    runRenderSteps,
  };
}
