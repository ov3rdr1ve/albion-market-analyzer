/**
 * The asynchronous re-render.
 *
 * Every gesture that changes a number — committing a price, flipping Premium or
 * Focus, importing settings, a captured price arriving from the monitor — used
 * to call renderAllTables() synchronously. That is one unbroken block of work:
 * 1306 ms with a single section open (js/render-gating.js), 19.3 s cold
 * (js/render-schedule.js). For all of it the window is frozen — nothing
 * scrolls, nothing clicks, and no spinner can turn, because the thread that
 * would animate it is the thread doing the rendering.
 *
 * Boot already solved this: js/render-schedule.js runs the same tables as
 * phases and hands the thread back between them. This file is the other half —
 * the part that decides WHEN a pass runs, which pass wins when two are asked
 * for, and when to stop one that is already going.
 *
 * Three rules, and they are the whole file:
 *
 *   coalesce   A burst of edits is one pass. The debounce is short (the user is
 *              waiting) but long enough that typing into three cells in a row
 *              does not pay for three passes.
 *
 *   supersede  A new request bumps the pass token immediately, so the pass in
 *              flight stops at its next step instead of racing the new one to
 *              the same tbodies. A boolean flag cannot express this: a
 *              cancelled pass A and a fresh pass B would share it, and B would
 *              cancel itself.
 *
 *   yield      A pass stops the moment the user opens another price editor.
 *              Editing four cells in a row should cost one pass at the end, not
 *              four interleaved with the typing — and renderAllTables has always
 *              refused to run under an open editor anyway, because redrawing the
 *              tbody destroys the editor sitting in it.
 *
 * Nothing here knows about tables, renderers or the DOM: `planPass` returns the
 * steps and the draw call, everything else is injected. So it runs in Node
 * (tests/render-async-scheduler.test.cjs).
 */

/** Long enough to swallow a burst of commits, short enough not to feel laggy. */
const RERENDER_DEBOUNCE_MS = 60;

/**
 * How long a run of tables may hold the thread before handing back a frame.
 * ~2 frames: long enough that the yield itself is not the cost, short enough
 * that a click during the pass is answered in about a tenth of a second.
 */
const RERENDER_BUDGET_MS = 120;

/**
 * How much slower to re-check a request being held for an open price editor.
 * The hold is a poll, not a debounce — there is no burst to coalesce, only a
 * gesture to wait out — so it runs at 60 × 4 = 240 ms rather than every frame.
 */
const HELD_RETRY_FACTOR = 4;

/**
 * Requests that bring new DATA rather than a user's gesture. They never cancel
 * a pass in flight — they queue behind it. A market browse emits one captured
 * patch after another, and superseding on each one kept cancelling the Crafting
 * Planner (seconds of chunked work) before it could paint: the captured price
 * never reached it until the user updated the table by hand.
 */
const DATA_REFRESH_REASONS = new Set(["captured-prices"]);

/**
 * The phase list a re-render reports. It lives in js/render-schedule.js, which
 * is a plain script loaded before this one in the browser — a top-level `const`
 * there is in global LEXICAL scope, reachable by bare identifier but NOT on
 * globalThis, hence the `typeof` probe rather than a property read. In Node the
 * tests load the module directly.
 */
const SCHEDULE_PHASES = typeof RERENDER_PHASES !== "undefined"
  ? RERENDER_PHASES
  : (typeof require === "function" ? require("./render-schedule.js").RERENDER_PHASES : null);

/**
 * @param {object}   deps
 * @param {Function} deps.planPass       ({priorityTableId}) => {steps, render, plannedIds} | null
 * @param {Function} deps.runSteps       the runner from js/render-schedule.js
 * @param {Function} deps.yieldTo        () => Promise, hands back a frame
 * @param {Function} deps.beginPass      () => token, invalidates every older pass
 * @param {Function} deps.isCurrentPass  (token) => boolean
 * @param {Function} [deps.canSchedule]  () => boolean, is there anything to draw at all
 * @param {Function} [deps.isEditorOpen] () => boolean
 * @param {Function} [deps.markDeferred] (tableId) => void, for what a stopped pass skipped
 * @param {Function} [deps.markComputing] (tableId) => void
 * @param {Function} [deps.onHeld]       ({reason}), a request parked behind an editor
 * @param {Function} [deps.onPassStart]  ({reason, total, tableIds, itemIds})
 * @param {Function} [deps.onProgress]   ({done, total, phase, id})
 * @param {Function} [deps.onTableDrawn] (tableId), after that table's render returns
 * @param {Function} [deps.onPhaseDone]  (phase)
 * @param {Function} [deps.onPassEnd]    ({reason, superseded, abortedByEditor, rendered, failed})
 * @returns {{schedule: Function, cancel: Function, isBusy: Function, whenIdle: Function}}
 */
function createRenderScheduler({
  planPass,
  runSteps,
  yieldTo = async () => {},
  beginPass = () => 0,
  isCurrentPass = () => true,
  canSchedule = () => true,
  isEditorOpen = () => false,
  markDeferred = () => {},
  markComputing = () => {},
  onHeld = () => {},
  onPassStart = () => {},
  onProgress = () => {},
  onTableDrawn = () => {},
  onPhaseDone = () => {},
  onPassEnd = () => {},
  phases = SCHEDULE_PHASES,
  debounceMs = RERENDER_DEBOUNCE_MS,
  budgetMs = RERENDER_BUDGET_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  /** The request waiting for the debounce to expire, if any. */
  let pending = null;
  let timer = null;
  /** The pass currently running, as a promise. Null when nothing is running. */
  let running = null;
  /** A data-refresh request is waiting for the running pass to end. */
  let afterRunning = false;

  /** A listener is a courtesy, never a reason to abandon the redraw. */
  const safely = (fn, arg) => {
    try { if (typeof fn === "function") fn(arg); } catch (e) { /* diagnostic only */ }
  };

  /**
   * Merge the item scopes of two requests that coalesced into one pass.
   *
   * null means "everything moved", and it wins: a Premium toggle arriving in
   * the same debounce window as a captured price really does move every number,
   * so narrowing the pass to the captured item would leave the rest of the app
   * changing with nothing to say it was going to.
   */
  function mergeItemScope(previous, next) {
    if (!previous) return next || null;
    if (!previous.itemIds || !next) return null;
    return [...new Set([...previous.itemIds, ...next])];
  }

  /**
   * Ask for a re-render.
   *
   * @param {string} reason              for the logs and the pending marks
   * @param {object} [options]
   * @param {string} [options.priorityTableId]  drawn first, ahead of everything
   * @param {Function} [options.onPhase]        called as each phase lands
   * @param {string[]} [options.itemIds]        the items whose prices moved.
   *                                            Omitted = every number moved.
   * @returns {boolean} whether a pass is now coming
   */
  function schedule(reason, { priorityTableId = null, onPhase = null, itemIds = null } = {}) {
    if (!canSchedule()) return false;
    const refresh = DATA_REFRESH_REASONS.has(reason);
    // New data while a pass is drawing: let it finish, then run once more. The
    // pass in flight already reads the live price map, so most of the patch is
    // on screen when it paints; the follow-up catches what it had passed by.
    if (refresh && running !== null && (!pending || pending.refreshOnly)) {
      pending = {
        reason,
        priorityTableId: pending ? pending.priorityTableId : priorityTableId,
        onPhase: pending ? pending.onPhase : onPhase,
        itemIds: mergeItemScope(pending, itemIds),
        refreshOnly: true,
      };
      if (timer !== null) { clearTimer(timer); timer = null; }
      afterRunning = true;
      return true;
    }
    // Immediately, not when the timer fires: a pass already running has to stop
    // now, or it spends the whole debounce window drawing numbers that are
    // already stale.
    beginPass();
    afterRunning = false;
    pending = {
      reason,
      priorityTableId,
      onPhase,
      itemIds: mergeItemScope(pending, itemIds),
      // A gesture merged into queued captures makes the whole pass a gesture.
      refreshOnly: refresh && (!pending || !!pending.refreshOnly),
    };
    if (timer !== null) clearTimer(timer);
    timer = setTimer(fire, debounceMs);
    return true;
  }

  function fire() {
    timer = null;
    const request = pending;
    pending = null;
    if (!request) return;
    const pass = run(request);
    running = pass;
    const settle = () => {
      if (running !== pass) return;
      running = null;
      // The captures that queued behind this pass get theirs now.
      if (afterRunning && pending && timer === null) {
        afterRunning = false;
        timer = setTimer(fire, debounceMs);
      }
    };
    pass.then(settle, settle);
  }

  async function run(request) {
    // An open editor is a redraw that would destroy the editor mid-edit, so it
    // is not started at all — but the request is HELD, not dropped. Dropping it
    // lost the redraw outright whenever an editor was open at fire time (click
    // one price cell straight from another, and the first cell's pass vanished
    // inside the debounce window), leaving open tables showing stale numbers
    // until they were collapsed and re-expanded. Re-arming means the pass runs
    // as soon as the editor is gone, whether or not anything else asks for one.
    if (isEditorOpen()) {
      // Never over a newer request: one that arrived while this one was waiting
      // already describes everything this one would have drawn.
      if (!pending) pending = request;
      if (timer !== null) clearTimer(timer);
      // Slower than the debounce: this is a poll for "has the editor closed
      // yet", and an edit can take a while. Still far below the time it takes
      // to notice a stale number.
      timer = setTimer(fire, debounceMs * HELD_RETRY_FACTOR);
      // Nothing is drawing, so nothing should claim to be. The pass this
      // request replaced ended `superseded`, which deliberately leaves the
      // pending marks up (a burst of edits must not strobe them) — without this
      // every value cell would spin for as long as the editor stayed open,
      // reporting work that had stopped and would not restart until it closed.
      safely(onHeld, { reason: request.reason });
      return;
    }

    // itemIds reach the plan only on a data refresh: there, "these items'
    // prices moved" is the whole of what changed, so a renderer may recompute
    // just the rows that read them. A gesture can move numbers no price map
    // records (an override, a pin, a toggle), so it always plans a full pass.
    const refreshOnly = !!request.refreshOnly;
    const plan = planPass({
      priorityTableId: request.priorityTableId,
      itemIds: refreshOnly ? (request.itemIds || null) : null,
      refreshOnly,
    });
    if (!plan || !plan.steps || !plan.steps.length) return;

    const token = beginPass();
    const steps = plan.steps;
    const total = steps.length;
    // The plan's tables and the request's item scope: between them they say
    // exactly which numbers on screen this pass is about to replace, which is
    // what js/recalc-cell-mark.js marks.
    safely(onPassStart, {
      reason: request.reason,
      total,
      tableIds: Array.isArray(plan.plannedIds) && plan.plannedIds.length
        ? plan.plannedIds
        : steps.map((step) => step.id),
      itemIds: request.itemIds || null,
    });

    // Say so in any table that is queued behind others and has nothing in it.
    // After an edit almost every table still shows its last rows, so this is
    // usually a no-op — it is here for the empty one, not the common case.
    const firstPhase = steps[0].phase;
    steps.forEach((step) => {
      if (step.phase !== firstPhase) safely(markComputing, step.id);
    });

    const drawn = new Set();
    let result = { rendered: 0, failed: 0 };
    // Two ways to lose the thread, and they mean the same thing: what this pass
    // is drawing is no longer what the user should be looking at. Handed to the
    // renderers as well as checked between them, so a chunked one (the Craft
    // Planner is seconds of work) can stop inside itself rather than at its edge.
    const isCancelled = () => !isCurrentPass(token) || isEditorOpen();
    try {
      result = await runSteps(steps, {
        render: (tableId) => {
          drawn.add(tableId);
          const drawing = plan.render(tableId, isCancelled);
          // AFTER the render, not before it: what the table shows once the
          // renderer has returned is the new number, and that is the moment its
          // pending marks stop being true. A chunked renderer hands back a
          // promise, so the report waits for it.
          if (drawing && typeof drawing.then === "function") {
            return drawing.then((value) => { safely(onTableDrawn, tableId); return value; });
          }
          safely(onTableDrawn, tableId);
          return drawing;
        },
        yieldTo,
        phases,
        budgetMs,
        onStep: (step, index) => safely(onProgress, { done: index, total, phase: step.phase, id: step.id }),
        onPhase: (phase) => {
          safely(onPhaseDone, phase);
          safely(request.onPhase, phase);
        },
        cancelled: isCancelled,
      });
    } finally {
      const superseded = !isCurrentPass(token);
      const abortedByEditor = isEditorOpen();
      // Anything the pass did not reach is owed a render — the same debt
      // renderAllTables records for a table it skips, so expanding it later
      // replays it instead of showing stale rows for ever.
      if (superseded || abortedByEditor) {
        (plan.plannedIds || []).forEach((id) => {
          if (!drawn.has(id)) safely(markDeferred, id);
        });
      }
      safely(onPassEnd, {
        reason: request.reason,
        superseded,
        abortedByEditor,
        rendered: result.rendered,
        failed: result.failed,
      });
    }
  }

  /** Drop a request that has not started, and stop one that has. */
  function cancel() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    pending = null;
    afterRunning = false;
    beginPass();
  }

  /** A request is waiting, or a pass is drawing. */
  function isBusy() {
    return !!pending || timer !== null || running !== null;
  }

  /**
   * Resolves when no pass is DRAWING. A debounced request that has not fired
   * yet does not delay it — callers use this to know the tbodies have settled,
   * not to wait for the next gesture.
   */
  function whenIdle() {
    return running || Promise.resolve();
  }

  return { schedule, cancel, isBusy, whenIdle };
}

// ── the app's single scheduler ─────────────────────────────────────────────
// Classic scripts, one shared global scope: js/app.js installs it once at
// startup and every caller reaches it through scheduleRerender().

let _renderScheduler = null;

function initRenderScheduler(deps) {
  _renderScheduler = createRenderScheduler(deps);
  return _renderScheduler;
}

/**
 * Re-render the app around a change. The one call every price edit, header
 * toggle and captured price patch should make instead of renderAllTables().
 *
 * @returns {boolean} whether a pass is coming (false before the first scan)
 */
function scheduleRerender(reason, options) {
  if (!_renderScheduler) return false;
  return _renderScheduler.schedule(reason, options);
}

function whenRerenderIdle() {
  return _renderScheduler ? _renderScheduler.whenIdle() : Promise.resolve();
}

function isRerenderBusy() {
  return !!_renderScheduler && _renderScheduler.isBusy();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RERENDER_DEBOUNCE_MS,
    RERENDER_BUDGET_MS,
    DATA_REFRESH_REASONS,
    HELD_RETRY_FACTOR,
    createRenderScheduler,
    initRenderScheduler,
    scheduleRerender,
    whenRerenderIdle,
    isRerenderBusy,
  };
}
