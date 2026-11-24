/**
 * The "Start Monitor" control.
 *
 * One button drives the whole live capture: while it runs, every market window
 * you open in the game rewrites this app's prices for that city, and the same
 * readings go back to the Albion Online Data Project the Scan button reads from.
 *
 * The button hides itself in a plain browser: the capture lives in the Electron
 * main process (it needs a native driver), and the page only ever receives
 * already-decoded price patches over IPC.
 *
 * Re-rendering is debounced. Opening a market emits one patch per response and
 * a full table re-render is expensive, so patches are collected and drawn once
 * the burst settles.
 */

(function () {
  const store = (typeof require !== "undefined") ? require("./market-price-store.js") : null;
  const locations = (typeof require !== "undefined") ? require("./market-locations.js") : null;
  const cityForLocation = locations ? locations.marketCityName : globalThis.marketCityName;
  const flattenQuality = store ? store.flattenQuality : globalThis.flattenQuality;
  const mergeQualityPrices = store ? store.mergeQualityPrices : globalThis.mergeQualityPrices;
  const mergeFlatPrices = store ? store.mergeFlatPrices : globalThis.mergeFlatPrices;

  const RENDER_DEBOUNCE_MS = 1200;
  // Ceiling on how long the idle scheduler may hold the redraw back once the
  // burst has settled — past this it runs whether the browser is busy or not.
  const IDLE_DEADLINE_MS = 3000;
  const UPLOAD_PREF_KEY = "monitorUpload";
  const CITY_PREF_KEY = "monitorCity";

  // Past this, the line says how old the position is. A capture that has not
  // heard a Join in half an hour is still confidently naming a city, and that
  // confidence is the bug: "at Brecilien" outlived a trip to Lymhurst.
  const STALE_LOCATION_MS = 10 * 60 * 1000;

  let redrawTimer = null;
  let dirty = false;
  /**
   * Every item the un-drawn patches touched. Opening one market in game moves
   * one item's numbers, not the whole board, and the redraw says so: these ids
   * scope the pending marks to the rows that show them (js/recalc-cell-mark.js).
   * Accumulated across the burst the debounce coalesces, emptied when it draws.
   */
  let dirtyItemIds = new Set();
  let lastCity = null;
  // {locationId, city, at} — where the GAME last said the player is, as opposed
  // to lastCity, which is also written by the manual city picker.
  let lastLocation = null;
  let counts = { orders: 0, uploads: 0 };
  // The last state the main process pushed. Kept because the periodic stats tick
  // and every price patch redraw the status line, and they must not invent a
  // state of their own — doing so used to erase the adapter name the capture had
  // just reported ("listening on Ethernet (192.168.0.5)" → "listening").
  let lastState = null;
  // Wire-level counters from the main process, refreshed on the stats tick.
  let lastDiagnostics = null;

  function el(id) { return document.getElementById(id); }

  function bridge() {
    return typeof window !== "undefined" ? window.marketMonitor : null;
  }

  function uploadEnabled() {
    try { return localStorage.getItem(UPLOAD_PREF_KEY) !== "0"; } catch (e) { return true; }
  }

  function setUploadEnabled(on) {
    try { localStorage.setItem(UPLOAD_PREF_KEY, on ? "1" : "0"); } catch (e) { /* private mode */ }
    const api = bridge();
    if (api && typeof api.setUpload === "function") api.setUpload(on);
  }

  /**
   * The city the capture should assume it is in.
   *
   * The game names the city only on a zone Join, so a monitor started while you
   * already stand at the market has no city to file prices under and throws
   * every order away. This is the way out that does not involve walking through
   * a gate; the first real Join still overrides it.
   */
  function readCityPref() {
    try { return localStorage.getItem(CITY_PREF_KEY) || ""; } catch (e) { return ""; }
  }

  function setCityPref(locationId) {
    try { localStorage.setItem(CITY_PREF_KEY, locationId || ""); } catch (e) { /* private mode */ }
    const api = bridge();
    if (api && typeof api.setCity === "function") api.setCity(locationId || "");
    // Say it in the line straight away. The city used to be named only by the
    // next price patch, so a pick looked like it did nothing — and while the
    // capture held a stale city, the line went on showing that one instead.
    // Auto (no id) names nothing: the last known city is still the truth.
    const name = locationId && typeof cityForLocation === "function" ? cityForLocation(locationId) : null;
    if (name) lastCity = name;
    setStatus(statusLine(lastState || { message: "listening" }), statusDetail());
  }

  function setStatus(text, detail) {
    const badge = el("monitor-status");
    if (!badge) return;
    badge.textContent = text;
    // The full wire counters stay one hover away rather than in the line.
    badge.title = detail || "";
  }

  function setRunning(running) {
    const button = el("monitor-toggle");
    if (!button) return;
    button.textContent = running
      ? tx("■ Stop Monitor", "r_stop_monitor")
      : tx("▶ Start Monitor", "start_monitor");
    button.dataset.running = running ? "1" : "0";
    // Green while the tap is open — the one control whose state persists after
    // you look away from it, so it has to read at a glance.
    button.classList.toggle("monitor-live", !!running);
  }

  // States in which the capture is NOT open. Everything else — including "idle",
  // which the sniffer reports after 20 s without an Albion packet — leaves the
  // tap running, so the button must keep offering Stop. Treating "idle" as
  // stopped made the button flip back to "▶ Start Monitor" while the capture was
  // still live, and the next click was a no-op (main.js returns early while the
  // session runs), stranding the control.
  const STOPPED_STATUSES = new Set(["stopped", "unavailable", "error"]);

  function captureRunning(state) {
    if (!state) return false;
    if (typeof state.running === "boolean") return state.running;
    return !STOPPED_STATUSES.has(state.status);
  }

  function compact(n) {
    return n >= 10000 ? `${Math.round(n / 1000)}k` : String(n);
  }

  /**
   * What the wire is doing, in the fewest words that still distinguish the
   * failure modes. "listening · 8 orders" alone is ambiguous: it reads the same
   * whether the game went quiet, the capture went deaf, or the market messages
   * arrived and were thrown away. So:
   *   - no packets at all  → wrong adapter, or the game is not running,
   *   - packets but no market message → the market was never opened, or the
   *     operation codes moved (a patch renumbers them),
   *   - market messages dropped for want of a zone → the capture started while
   *     you were already standing in the city, so no Join was ever seen.
   */
  /**
   * Orders thrown away for want of a location the ingest accepts. The count
   * alone is unactionable — 1598 dropped could be a capture with no position at
   * all or a session spent in the Roads, and those need opposite responses — so
   * the location that caused them is named.
   */
  function droppedBit(diag) {
    const where = diag.lastDroppedLocation;
    return where
      ? `${diag.droppedNoLocation} dropped (${where})`
      : `${diag.droppedNoLocation} dropped (no zone)`;
  }

  function diagnosticBits(diag, now = Date.now()) {
    if (!diag) return [];
    const bits = [];
    if (!diag.packets) return ["no packets — wrong adapter?"];
    bits.push(`${compact(diag.packets)} pkts`);
    // Responses decoded at all, versus responses that carried orders: the first
    // says the decoder is alive, the second says the game answered a market.
    if (diag.events) bits.push(`${compact(diag.events)} ev`);
    if (diag.responses) bits.push(`${compact(diag.responses)} resp`);
    if (diag.orderResponses) bits.push(`${diag.orderResponses} market msg`);
    // The game answered and nobody was listing. Reported apart from "market
    // msg" because the two say opposite things about the item, and the same
    // thing about the capture: it is working.
    if (diag.emptyOrderResponses) bits.push(`${diag.emptyOrderResponses} empty book`);
    if (diag.droppedNoLocation) bits.push(droppedBit(diag));
    // Order lists are the only messages big enough to be fragmented. Spelled
    // out as "msg of frag" because the two count DIFFERENT THINGS — whole
    // messages against the pieces they were rebuilt from — and the bare "13/71"
    // this used to print reads as a 82% loss rate to anyone who has not read
    // the parser. A five-piece order list is normal; the counter that means
    // loss is `abandoned`, and it sits in the fault bits where it belongs.
    if (diag.fragments) bits.push(`${diag.reassembled || 0} msg of ${diag.fragments} frag`);
    if (diag.encrypted) bits.push(`${compact(diag.encrypted)} enc`);
    // Frames the decoder could not walk. A handful is normal on a live tap;
    // a count anywhere near the packet count is the decoder failing, not the
    // game staying quiet.
    if (diag.malformed) bits.push(`${compact(diag.malformed)} bad`);
    const unknown = Object.keys(diag.unknownOps || {});
    if (unknown.length) bits.push(`op ${unknown.join("/")}`);
    // Your own orders: what you listed, cancelled, sold or bought. Counted apart
    // because it is what tells a market reading from your own traffic — and
    // because these operation codes move with client patches, so a session that
    // traded and shows nothing here is the warning that one has moved.
    const ownEvents = Object.values(diag.ownOrderOps || {}).reduce((a, b) => a + b, 0);
    if (ownEvents) bits.push(`${ownEvents} own order`);
    if (diag.mixedSideResponses) bits.push(`${diag.mixedSideResponses} two-sided`);
    // Positions taken off a response that did NOT arrive under the Join
    // operation code. The payload had to be unmistakably a Join to be read at
    // all (js/join-location.js), but a code appearing here is the client having
    // moved its Join, and that is worth naming rather than absorbing.
    const fallbackOps = Object.entries(diag.joinsByFallbackOp || {});
    if (fallbackOps.length) {
      bits.push(`join via ${fallbackOps.map(([code, count]) => `op ${code}×${count}`).join(", ")}`);
    }
    return bits;
  }

  // A live tap always malforms a few frames — other traffic on port 5056, and
  // packets clipped by the capture buffer. Only a share this large means the
  // decoder itself is failing.
  const MALFORMED_FAULT_SHARE = 0.05;

  // How long a position may go unconfirmed before the status line says so:
  // long enough that walking around a city never trips it, short enough to
  // catch a capture that has lost the game within one look at the panel.
  const POSITION_STALE_MS = 10 * 60 * 1000;

  /**
   * The subset of the diagnostics that says something is WRONG. A working
   * capture says nothing: while it is decoding markets, the counters are noise
   * scrolling under the button, and the line has to stay readable at a glance.
   * Unknown operation codes are not a fault — order lists are recognised by
   * shape, so a patch renumbering them changes nothing the user must act on.
   */
  function faultBits(diag, now = Date.now()) {
    if (!diag) return [];
    if (!diag.packets) return ["no packets — wrong adapter?"];
    const bits = [];
    // Traffic is arriving and none of it has confirmed where the player is:
    // the game stopped sending Joins, or sent one in a shape the reader refused.
    if (diag.locationAt && (now - diag.locationAt) > POSITION_STALE_MS) {
      bits.push(`position not confirmed ${ageText(diag.locationAt, now)}`);
    }
    // Normal for the first minutes of a session; the point is it goes away the
    // moment a market is opened, so a line that keeps saying it is the symptom.
    // Keyed on marketResponses, not orderResponses: browsing a thin item whose
    // book is empty IS market data arriving, and saying otherwise is what made
    // a working capture look broken.
    if (!diag.marketResponses && !diag.orderResponses) bits.push("no market data yet");
    else if (!diag.orderResponses) bits.push(`${diag.emptyOrderResponses} empty book — no listings`);
    if (diag.droppedNoLocation) bits.push(droppedBit(diag));
    // Order lists given up on half-received. Unlike every other counter here
    // this one is silent when the capture is healthy, so any value at all is
    // worth the line: it means a market the player opened never arrived whole,
    // and the prices from it are simply missing.
    if (diag.abandoned) bits.push(`${diag.abandoned} lost mid-message`);
    // The game's numeric item ids moved (a patch) and the shipped index names
    // the wrong items. Book reads fall back to what the orders say, but empty
    // books and price-chart volumes cannot be filed until the app is updated.
    if (diag.itemIndexStale) bits.push("item ids out of date — update the app");
    if (diag.malformed > diag.packets * MALFORMED_FAULT_SHARE) {
      bits.push(`${compact(diag.malformed)}/${compact(diag.packets)} bad`);
    }
    return bits;
  }

  /** "12m ago", "3h ago", or "" while the reading is still fresh enough to omit. */
  function ageText(at, now) {
    if (!at) return "";
    const minutes = Math.floor((now - at) / 60000);
    if (minutes < 1) return "";
    return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
  }

  /**
   * Where the capture thinks it is.
   *
   * Two rules, both learned from the same report. A location the app prices
   * under is named by its city; anything else — a roads tunnel, a hideout bank,
   * a den — is named by its RAW ID, because falling back to the last city that
   * happened to have a name is what put "at Brecilien" under a capture standing
   * in the Roads. And once the reading goes stale it says so.
   */
  function locationBit(now) {
    if (lastLocation && lastLocation.locationId) {
      const name = lastLocation.city;
      const text = name ? `at ${name}` : `at ${lastLocation.locationId} (no market)`;
      const age = (now - lastLocation.at) > STALE_LOCATION_MS ? ageText(lastLocation.at, now) : "";
      return age ? `${text} · ${age}` : text;
    }
    return lastCity ? `at ${lastCity}` : null;
  }

  /** Short line under the button: what the capture has picked up so far. */
  function statusLine(state, now = Date.now()) {
    const bits = [];
    if (state && state.message) bits.push(state.message);
    const where = locationBit(now);
    if (where) bits.push(where);
    if (counts.orders) bits.push(`${counts.orders} orders`);
    if (counts.uploads) bits.push(`${counts.uploads} shared`);
    bits.push(...faultBits(lastDiagnostics, now));
    return bits.join(" · ");
  }

  /**
   * The last few markets the capture actually saw, named.
   *
   * This is the answer to "why is there no price for X?" — it says whether the
   * game was asked about X at all, and how many listings came back. Without it
   * an item with an empty order book and an item the capture never saw look
   * identical from outside.
   */
  function queryLines(diag) {
    if (!diag || !Array.isArray(diag.lastQueries) || !diag.lastQueries.length) return [];
    return diag.lastQueries.map((q) => {
      const side = q.side === "request" ? "buy" : "sell";
      return `${queryName(q)} · ${q.city || "?"} · ${q.count} ${side}`;
    });
  }

  /**
   * What one logged query was ABOUT.
   *
   * A category browse — the Black Market opened with no search term — answers
   * with one page of orders for dozens of different items, so there is no name
   * to print. It used to print "?", which reads as "the capture saw nothing"
   * and is the reason a perfectly good Black Market capture was reported as a
   * dead sniffer. It says how many books it read instead.
   */
  function queryName(q) {
    if (q.itemId) {
      return typeof getItemDisplayName === "function" ? getItemDisplayName(q.itemId) : q.itemId;
    }
    if (q.itemCount > 1) {
      return `${q.itemCount} ${tx("items", "r_mon_items")}`;
    }
    return q.albionId != null ? `#${q.albionId}` : "?";
  }

  /** Every counter, for the badge's tooltip — the old status line, on hover. */
  function statusDetail(now = Date.now()) {
    const lines = [diagnosticBits(lastDiagnostics, now).join(" · ")];
    const queries = queryLines(lastDiagnostics);
    if (queries.length) lines.push("", "last seen:", ...queries);
    return lines.filter((l) => l !== undefined).join("\n");
  }

  function redrawNow() {
    if (!dirty) return;
    dirty = false;
    const itemIds = [...dirtyItemIds];
    dirtyItemIds = new Set();
    try {
      // Through the scheduler (js/render-async.js): a patch that lands while
      // the user is editing a price supersedes that pass cleanly instead of
      // racing it, and neither one holds the thread for the whole redraw. The
      // debounce and the idle wait above still apply — this only changes how
      // the pass itself runs.
      if (typeof scheduleRerender === "function") {
        scheduleRerender("captured-prices", { itemIds });
        return;
      }
      if (typeof renderAllTables === "function" && typeof lastMarketData !== "undefined" && lastMarketData) {
        renderAllTables(lastMarketData);
      }
    } catch (e) {
      console.error("monitor redraw:", e);
    }
  }

  /** Run the redraw when the browser is next free, never inside the patch call. */
  function redrawWhenIdle() {
    redrawTimer = null;
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(redrawNow, { timeout: IDLE_DEADLINE_MS });
    } else {
      redrawNow();
    }
  }

  /**
   * Coalesce a burst of patches into one redraw.
   *
   * `renderAllTables` recomputes ~18 tables — every route, every city — and
   * that is a long synchronous block. Opening one market emits a patch per
   * response, so a fixed window redrew mid-burst and the window froze under
   * each capture. Three rules keep it out of the way:
   *
   *   - TRAILING: every patch pushes the timer back, so the redraw happens once
   *     the burst has gone quiet rather than repeatedly during it,
   *   - IDLE: the redraw is handed to requestIdleCallback, so it waits for a
   *     frame where it is not competing with scrolling or typing,
   *   - HIDDEN: while the window is in the background — the normal case, since
   *     you are in the game when prices arrive — nothing is drawn at all. The
   *     patches still land in the price maps; the tables are drawn once, on the
   *     way back to a visible window.
   */
  function scheduleRedraw() {
    dirty = true;
    if (typeof document !== "undefined" && document.hidden) {
      if (redrawTimer) { clearTimeout(redrawTimer); redrawTimer = null; }
      return;
    }
    if (redrawTimer) clearTimeout(redrawTimer);
    redrawTimer = setTimeout(redrawWhenIdle, RENDER_DEBOUNCE_MS);
  }

  /**
   * Write the captured map out now. Its save is debounced (a per-response save
   * used to freeze the window — see captured-prices-store.js), so the moments
   * the app might stop receiving events have to force one.
   */
  function persistCaptures() {
    if (typeof flushCapturedPrices !== "function") return;
    try { flushCapturedPrices(); } catch (e) { /* quota / private mode */ }
  }

  /** Draw what arrived while the window was hidden, once it comes back. */
  function flushOnVisible() {
    if (typeof document === "undefined") return;
    // Going to the background is the normal case — that is where the game is —
    // so it is also the safest point to pay for a full save.
    if (document.hidden) { persistCaptures(); return; }
    if (!dirty) return;
    scheduleRedraw();
  }

  /**
   * Fold one captured patch into the app's live price maps.
   * Exposed for tests; also the whole of what onPrices does.
   */
  function applyPrices(update) {
    if (!update || !update.prices) return 0;
    const flat = flattenQuality(update.prices, 1);

    // Mirror the capture to localStorage so it survives a restart AND a later
    // full scan (which assigns lastMarketData wholesale). See
    // captured-prices-store.js.
    if (typeof recordCapturedPrices === "function") {
      try { recordCapturedPrices(update.prices); } catch (e) { /* quota / private mode */ }
    }

    // Team sync, when it is on. Its own clock is far slower than a capture
    // burst — see PRICE_MIN_INTERVAL_MS in js/team-sync-loop.js.
    if (typeof window !== "undefined" && window.teamSyncLoop) {
      try { window.teamSyncLoop.notifyPricesChanged(); } catch (e) { /* sync off */ }
    }

    // Both maps are top-level `let`s in app.js: the quality-aware one feeds the
    // rerolling/quality views, the flat one is what every other table reads.
    if (typeof lastQualityMarketData !== "undefined") {
      if (!lastQualityMarketData) lastQualityMarketData = {};
      mergeQualityPrices(lastQualityMarketData, update.prices);
    }
    let written = 0;
    if (typeof lastMarketData !== "undefined") {
      if (!lastMarketData) lastMarketData = {};
      written = mergeFlatPrices(lastMarketData, flat);
    }

    counts.orders += update.count || 0;
    if (update.city) lastCity = update.city;
    // Prices name a location too, and in the browser build (no IPC push) they
    // are the only thing that does.
    if (update.locationId) {
      lastLocation = { locationId: String(update.locationId), city: update.city || null, at: Date.now() };
    }
    if (written) {
      Object.keys(flat).forEach((itemId) => dirtyItemIds.add(itemId));
      scheduleRedraw();
    }
    return written;
  }

  function bind() {
    const api = bridge();
    const button = el("monitor-toggle");
    const label = el("monitor-upload-label");
    const cityLabel = el("monitor-city-label");
    const autoStartLabel = el("monitor-autostart-label");
    // Plain browser build: no capture available, so the control stays hidden
    // rather than offering something that cannot work.
    if (!api || !button) return;

    button.classList.remove("hidden");
    if (label) label.classList.remove("hidden");
    if (cityLabel) cityLabel.classList.remove("hidden");
    if (autoStartLabel) autoStartLabel.classList.remove("hidden");

    const city = el("monitor-city");
    if (city) {
      city.value = readCityPref();
      setCityPref(city.value);
      city.addEventListener("change", () => setCityPref(city.value));
    }

    const checkbox = el("monitor-upload");
    if (checkbox) {
      checkbox.checked = uploadEnabled();
      setUploadEnabled(checkbox.checked);
      checkbox.addEventListener("change", () => setUploadEnabled(checkbox.checked));
    }

    // Auto-start is the main process's own setting — it has to be readable
    // before this page exists — so the box is filled from there, not from
    // localStorage. By the time it arrives the capture is usually already
    // running, which is the point.
    const autoStart = el("monitor-autostart");
    if (autoStart && typeof api.getAutoStart === "function") {
      Promise.resolve(api.getAutoStart())
        .then((on) => { autoStart.checked = on !== false; })
        .catch(() => {});
      autoStart.addEventListener("change", () => {
        if (typeof api.setAutoStart === "function") api.setAutoStart(autoStart.checked);
      });
    }

    button.addEventListener("click", () => {
      const running = button.dataset.running === "1";
      setStatus(running ? "stopping…" : "starting…");
      const call = running ? api.stop() : api.start();
      Promise.resolve(call).then((state) => {
        lastState = state;
        setRunning(!running && captureRunning(state));
        setStatus(statusLine(state), statusDetail());
      }).catch((e) => setStatus(e.message));
    });

    // Say what is missing before the user clicks a button that cannot work.
    // The install prompt itself belongs to the main process — it is the side
    // that knows whether a licensed installer was bundled — and Start already
    // opens it, so this line only has to name the cause.
    if (typeof api.npcap === "function") {
      Promise.resolve(api.npcap()).then((info) => {
        if (!info || info.installed) return;
        setStatus(tx("npcap capture driver not installed — press Start to install", "npcap_missing"));
      }).catch(() => {});
    }

    if (typeof api.onStatus === "function") {
      api.onStatus((state) => {
        lastState = state;
        setRunning(captureRunning(state));
        setStatus(statusLine(state), statusDetail());
      });
    }
    // The position, the moment the game names it — not when the next market is
    // opened. This is the channel that keeps the city honest.
    if (typeof api.onLocation === "function") {
      api.onLocation((loc) => {
        if (!loc || !loc.locationId) return;
        lastLocation = {
          locationId: String(loc.locationId),
          city: loc.city || null,
          at: loc.at || Date.now(),
        };
        if (loc.city) lastCity = loc.city;
        setStatus(statusLine(lastState || { message: "listening" }), statusDetail());
      });
    }
    if (typeof api.onPrices === "function") {
      api.onPrices((update) => {
        applyPrices(update);
        setStatus(statusLine(lastState || { message: "listening" }), statusDetail());
      });
    }
    // Which standing numbers are the player's own. Wired beside the prices
    // because it changes what a row is allowed to quote, not merely how it is
    // drawn — see flipLegs (js/flip-route.js).
    if (typeof api.onOwnOrders === "function" && typeof setOwnOrderBooks === "function") {
      api.onOwnOrders((update) => {
        setOwnOrderBooks(update && update.books);
        if (typeof scheduleRedraw === "function") scheduleRedraw();
      });
    }
    if (typeof api.onStats === "function") {
      api.onStats((stats) => {
        if (!stats) return;
        counts = { orders: stats.orders || 0, uploads: stats.uploads || 0 };
        if (stats.diagnostics) {
          lastDiagnostics = stats.diagnostics;
          // Catch-up for a page that loaded after the Join: the tick carries the
          // capture's own view of where it is, which the push cannot replay.
          const diag = stats.diagnostics;
          if (diag.location && (!lastLocation || lastLocation.locationId !== String(diag.location))) {
            lastLocation = {
              locationId: String(diag.location),
              city: typeof cityForLocation === "function" ? cityForLocation(diag.location) : null,
              at: diag.locationAt || Date.now(),
            };
          }
        }
        setStatus(statusLine(lastState || { message: "listening" }), statusDetail());
      });
    }
  }

  if (typeof window !== "undefined") {
    window.applyMonitorPrices = applyPrices;
    document.addEventListener("visibilitychange", flushOnVisible);
    window.addEventListener("beforeunload", persistCaptures);
    document.addEventListener("DOMContentLoaded", () => {
      try { bind(); } catch (e) { console.error("monitor bind:", e); }
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      applyPrices,
      statusLine,
      statusDetail,
      captureRunning,
      _bind: bind,
      _setDiagnostics: (diag) => { lastDiagnostics = diag; },
      _setLocation: (loc) => { lastLocation = loc; },
      _flushOnVisible: flushOnVisible,
      _pendingRedraw: () => dirty,
      _reset: () => {
        counts = { orders: 0, uploads: 0 };
        lastCity = null;
        lastLocation = null;
        lastState = null;
        lastDiagnostics = null;
        dirty = false;
        if (redrawTimer) { clearTimeout(redrawTimer); redrawTimer = null; }
      },
    };
  }
})();
