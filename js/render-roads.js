/**
 * Roads of Avalon panel — live portal graph + zone reference.
 *
 * Two tables, two very different data lifetimes:
 *
 *   #roads-portals-table — the LIVE graph. Every row is a portal the player
 *     typed in (or took from a teammate's shared folder); they expire 12-24h
 *     after they spawn, so the countdown ticks and lapsed rows grey out until
 *     pruned. Persisted to localStorage so a restart keeps what is still
 *     alive. No API publishes this data — nothing here is fetched.
 *
 *   #roads-zones-table — the STATIC catalog (js/data-roads-zones.js, 817 zones
 *     regenerated from albionroadsmapper.com). Tier, chests, resources, and
 *     which deep roads hold a Brecilien portal. Useful with zero portals
 *     recorded, which is why it renders on load.
 *
 * Find Route runs BFS over the live graph AND the static overland map
 * (js/roads-hybrid-route.js), so a portal landing ten zones from the target is
 * still an answer — you run the rest. The route dies with its shortest-lived
 * portal. Nearest Exit stays portal-only (js/roads-route.js): "get me out of
 * the Roads" is a question about portals.
 */

(function () {
  const REFRESH_MS = 15000; // countdown tick

  /**
   * Runtime string. English stays inline (so the generated EN table never has
   * to carry it) and Spanish comes from the UI_STRINGS_ES overlay via tx() —
   * the same contract the other render-*.js files use. Guarded because this
   * module is also required by the Node tests, where js/i18n.js is absent.
   */
  function T(en, slug) {
    return typeof tx === "function" ? tx(en, slug) : en;
  }

  // Everything this panel reads from a sibling script is resolved PER CALL,
  // never captured at eval time. The catalogs land after first paint
  // (js/catalog-loader.js), and a classic script's top-level `const` is a
  // global LEXICAL binding — never a globalThis property — so anything
  // captured while this file evaluates reads undefined and stays undefined
  // forever. The typeof guards are the same stand-in pattern the zone getters
  // below use, and every local wrapper is named apart from the global it reads
  // so nothing is shadowed.

  // The [English, slug] tables live in js/roads-labels.js — data, not rendering.
  function labelTables() {
    return {
      type: typeof ROADS_TYPE_LABELS !== "undefined" ? ROADS_TYPE_LABELS : {},
      size: typeof ROADS_SIZE_LABELS !== "undefined" ? ROADS_SIZE_LABELS : {},
      resource: typeof ROADS_RESOURCE_LABELS !== "undefined" ? ROADS_RESOURCE_LABELS : {},
      marker: typeof ROADS_MARKER_LABELS !== "undefined" ? ROADS_MARKER_LABELS : {},
      chest: typeof ROADS_CHEST_LABELS !== "undefined" ? ROADS_CHEST_LABELS : {},
    };
  }

  // Whether a zone holds a Brecilien portal is DERIVED from the catalog
  // (js/data-roads-brecilien.js), so a gen-roads-zones.cjs regen can never
  // leave the table's marker stale. An absent catalog means no marker —
  // never a thrown error.
  function brecilienEntrance(zoneId) {
    return typeof isBrecilienEntrance === "function" ? isBrecilienEntrance(zoneId) : false;
  }

  // Portal timers are typed the way the game shows them ("2:30", "30m", "23h"),
  // so both entry points parse through one shared module whose syntax the
  // tests pin (js/roads-time-input.js). A missing parser rejects everything,
  // which lands in the existing need-fields guard.
  function timeInput() {
    return typeof RoadsTimeInput !== "undefined"
      ? RoadsTimeInput
      : { parse: () => null };
  }

  // The Time Left cell editor lives in its own module (this file is at the
  // 800-line ceiling); the panel hands it the graph hooks when it binds. A
  // missing editor reads as "not editing" and binds nothing.
  function portalEditor() {
    return typeof RoadsPortalEditor !== "undefined"
      ? RoadsPortalEditor
      : { isEditing: () => false, bindPortalEditing: () => {} };
  }

  /** Look a [en, slug] pair up in one of the tables above. */
  function label(table, key, fallback) {
    const pair = table[key];
    return pair ? T(pair[0], pair[1]) : fallback !== undefined ? fallback : key;
  }

  let graph = null;
  let timer = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function zones() {
    return typeof ROADS_ZONES !== "undefined" ? ROADS_ZONES : [];
  }

  function zoneById(id) {
    if (typeof ROADS_ZONE_BY_ID !== "undefined") return ROADS_ZONE_BY_ID.get(id) || null;
    return zones().find((z) => z.id === id) || null;
  }

  /**
   * Accepts a cluster id as the game reports it ("TNL-022", "3004"), a display
   * name ("Tetos-Igaelum"), or a slug — in that order, since ids are exact.
   */
  function resolveZone(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    const byId = zoneById(raw) || zoneById(raw.toUpperCase());
    if (byId) return byId;

    if (typeof ROADS_ZONE_BY_NAME !== "undefined") {
      const byName = ROADS_ZONE_BY_NAME.get(raw.toLowerCase());
      if (byName) return byName;
    }

    const slug = raw.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return zoneById(slug) || zones().find((z) => z.slug === slug) || null;
  }

  /**
   * The zones a box may name as a STARTING point or a portal end. The Brecilien
   * pocket is in the static catalog (it is a place in the game) and can be
   * routed to, but nothing ever comes back out of it, so offering it here would
   * only invite a route that cannot exist.
   */
  function routableZones() {
    if (typeof isOffRoadsNetwork !== "function") return zones();
    return zones().filter((zone) => !isOffRoadsNetwork(zone.id));
  }

  /** The zones a route may END at — the same list plus the pocket. */
  function destinationZones() {
    return zones();
  }

  /** Which of the given zones are inside the Brecilien pocket. */
  function offNetworkZones(...list) {
    if (typeof isOffRoadsNetwork !== "function") return [];
    return list.filter((zone) => zone && isOffRoadsNetwork(zone.id));
  }

  /** Why a pocket zone cannot be where a route starts. */
  function pocketStartMessage(offZones) {
    return T("You cannot route out of {zone} — its only exit is a one-way portal to a random Road.", "roads_pocket_no_exit")
      .replace("{zone}", offZones.map((zone) => zone.name).join(", "));
  }

  /** Why a pocket zone cannot be one end of a recorded portal. */
  function pocketPortalMessage(offZones) {
    return T("{zone} has no tunnel exits — the only way in is the permanent portal in the deep T8 roads.", "roads_pocket_no_tunnel")
      .replace("{zone}", offZones.map((zone) => zone.name).join(", "));
  }

  function zoneLabel(id) {
    const zone = zoneById(id);
    return zone ? zone.name : id;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    if (seconds <= 0) return T("expired", "roads_expired");
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }

  function chestSummary(chests) {
    const chestLabels = labelTables().chest;
    const parts = [];
    for (const colour of ["green", "blue", "gold"]) {
      if (chests[colour]) parts.push(`${chests[colour]}×${label(chestLabels, colour)}`);
    }
    return parts.join(", ") || "—";
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ── graph lifecycle ──────────────────────────────────────────────────────

  function ensureGraph() {
    if (graph) return graph;
    graph = typeof loadPortalGraph === "function" ? loadPortalGraph(null, Date.now()) : createPortalGraph();
    return graph;
  }

  function persist() {
    if (typeof savePortalGraph === "function") savePortalGraph(graph);
    // Team sync, when it is on: the loop debounces, so a burst of edits
    // is still one write to the shared folder (js/team-sync-loop.js).
    if (typeof window !== "undefined" && window.teamSyncLoop) {
      try { window.teamSyncLoop.notifyPortalsChanged(); } catch (e) { /* sync off */ }
    }
  }

  /**
   * Drop the portals that closed, on the countdown tick. Expiry is applied on
   * read in the store, so without this a portal that dies mid-session sits in
   * the table reading "expired" until the app restarts.
   *
   * It stands down while the player is typing, for the same reason the redraw
   * does: a row must not vanish from under an open Time Left cell or size
   * dropdown. It goes on the next tick instead.
   *
   * @returns {number} how many portals were dropped
   */
  function autoPruneExpired(now) {
    if (isEditingPortals()) return 0;
    const dropped = ensureGraph().prune(Number.isFinite(now) ? now : Date.now());
    // Only a real deletion writes: an idle tick must not ping team sync.
    if (dropped) {
      persist();
      renderPortalsMap();
    }
    return dropped;
  }

  /** Record one portal edge in the graph and repaint. */
  function recordPortal(edge) {
    const portal = ensureGraph().record({ ...edge, now: Date.now() });
    if (portal) {
      persist();
      renderPortalsTable();
      renderPortalsMap();
    }
    return portal;
  }

  // ── portals table ────────────────────────────────────────────────────────

  // Order shown in the Type dropdown. "unknown" is last: it is what a row
  // starts as, never something anyone means to pick.
  const SIZE_CHOICES = ["solo", "group", "raid", "unknown"];

  /**
   * Type is a dropdown, not text: the game encrypts portal objects, so the
   * player has to say the size.
   */
  function sizeSelect(portal) {
    const options = SIZE_CHOICES.map((size) =>
      `<option value="${size}"${size === portal.size ? " selected" : ""}>` +
      `${escapeHtml(label(labelTables().size, size))}</option>`).join("");
    return (
      `<select class="roads-portal-size" data-key="${escapeHtml(portal.key)}" ` +
      `style="font-size:0.72rem;padding:1px 2px">${options}</select>`
    );
  }

  function portalRow(portal, now) {
    const secondsLeft = portal.secondsLeft(now);
    const dead = secondsLeft <= 0;
    const style = dead ? ' style="opacity:0.45"' : "";
    const from = zoneById(portal.fromZoneId);
    const to = zoneById(portal.toZoneId);
    const tierOf = (z) => (z ? `T${z.tier}` : "?");
    // An estimated timer is not a countdown at all — it is the ceiling, the
    // longest the portal can still be open, and it reads "≤".
    const guessTitle = escapeHtml(T(
      "Estimated — this portal was recorded from a zone change, which carries no timer. " +
      "Portals close 12-24h after they spawn, so this is the longest it can still be open. " +
      "Click to type what the game showed you.",
      "roads_timer_estimated",
    ));
    const timer = portal.estimated && !dead
      ? `<span title="${guessTitle}" style="color:#9ca3af">≤${formatDuration(secondsLeft)}</span>`
      : formatDuration(secondsLeft);
    const charges = Number.isFinite(portal.chargesLeft)
      ? ` <span style="color:#9ca3af" title="${escapeHtml(T("Charges left", "roads_charges_left"))}">(${portal.chargesLeft})</span>`
      : "";
    return (
      `<tr${style} data-portal="${escapeHtml(portal.key)}">` +
      `<td>${escapeHtml(zoneLabel(portal.fromZoneId))} <span style="color:#9ca3af">${tierOf(from)}</span></td>` +
      `<td>${escapeHtml(zoneLabel(portal.toZoneId))} <span style="color:#9ca3af">${tierOf(to)}</span></td>` +
      `<td${portal.size === "unknown" ? ` title="${escapeHtml(T("Unknown — the game encrypts portal objects, so the size has to be set by hand.", "roads_size_unknown_hint"))}"` : ""}>` +
      `${sizeSelect(portal)}${charges}</td>` +
      `<td class="roads-portal-time" data-key="${escapeHtml(portal.key)}" ` +
      `title="${escapeHtml(T("Click to set the time left. Type h:mm like 2:30, or 30m / 23h.", "roads_time_edit_hint"))}" ` +
      `style="cursor:text">${timer}</td>` +
      `<td>${T("typed", "roads_source_typed")}</td>` +
      `<td><button class="roads-drop-portal" data-key="${escapeHtml(portal.key)}" style="font-size:0.7rem;padding:2px 6px">✗</button></td>` +
      "</tr>"
    );
  }

  /**
   * True while the player is typing in the table. The countdown redraw rewrites
   * the whole tbody, which would swallow the keystrokes and shut the dropdown,
   * so a scheduled redraw stands down until the edit is done. The Time Left
   * editor's own open/closed state lives in js/roads-portal-editor.js.
   */
  function isEditingPortals() {
    if (portalEditor().isEditing()) return true;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return !!(active && typeof active.closest === "function" && active.closest("#roads-portals-table"));
  }

  function renderPortalsTable(force) {
    if (!force && isEditingPortals()) return;
    const tbody = document.querySelector("#roads-portals-table tbody");
    if (!tbody) return;
    const now = Date.now();
    const portals = ensureGraph().all();
    if (!portals.length) {
      const hint = T("No portals recorded. Add portals by hand below.", "roads_no_portals_manual");
      tbody.innerHTML = `<tr><td colspan="6" style="color:#9ca3af">${hint}</td></tr>`;
      return;
    }
    portals.sort((a, b) => a.expiresAt - b.expiresAt);
    tbody.innerHTML = portals.map((p) => portalRow(p, now)).join("");
    // Rows are rebuilt on a timer, so the search box has to be re-applied here
    // or a filtered list un-filters itself a second later.
    if (typeof window.applyTableSearchFilter === "function") {
      window.applyTableSearchFilter("roads-portals-table");
    }
  }

  // ── editing a portal by hand ─────────────────────────────────────────────
  //
  // Both live fields are typed, not read: the game encrypts portal objects, so
  // both have to be typed. A correction
  // is authoritative (graph.update), which is why it can shorten a timer.
  // The Time Left cell's editor itself lives in js/roads-portal-editor.js —
  // this file only supplies the graph hooks it patches through.

  function portalOf(key) {
    const [a, b] = String(key || "").split("|");
    return a && b ? ensureGraph().get(a, b) : null;
  }

  function applyPortalPatch(key, patch) {
    const [a, b] = String(key || "").split("|");
    if (!a || !b) return null;
    const portal = ensureGraph().update(a, b, patch);
    if (portal) persist();
    return portal;
  }

  // ── map ──────────────────────────────────────────────────────────────────

  // The bridge to the SVG view lives in js/render-roads-map.js — translating a
  // selection on a picture into a record in the store is its own job, and the
  // Brecilien link made it a job with rules.
  const buildMapBridge = (typeof require !== "undefined")
    ? require("./render-roads-map.js").createRoadsMapBridge
    : createRoadsMapBridge;
  const mapBridge = buildMapBridge({
    T,
    graph: () => ensureGraph(),
    zoneById,
    zoneLabel,
    isExit: (zone) => isExitZone(zone),
    persist,
    afterDelete: () => renderPortalsTable(true),
  });
  const { renderPortalsMap, deleteFromMap, showRouteOnMap, routeMapPairs, isBrecilienSelection } = mapBridge;

  // ── zone reference table ─────────────────────────────────────────────────

  function zoneRow(zone) {
    const { type: typeLabels, resource: resourceLabels, marker: markerLabels } = labelTables();
    const resources = zone.resources.map((r) => label(resourceLabels, r)).join(", ") || "—";
    const markers = Object.entries(zone.markers)
      .map(([k, v]) => (v > 1 ? `${v}× ${label(markerLabels, k)}` : label(markerLabels, k)))
      .join(", ") || "—";
    const brecilienTitle = escapeHtml(T("Brecilien portal", "roads_brecilien_portal"));
    return (
      "<tr>" +
      `<td>${escapeHtml(zone.name)}${brecilienEntrance(zone.id) ? ` <span title="${brecilienTitle}" style="color:#38bdf8">◆</span>` : ""}</td>` +
      `<td>T${zone.tier}</td>` +
      `<td>${label(typeLabels, zone.type)}</td>` +
      `<td>${chestSummary(zone.chests)}</td>` +
      `<td>${resources}</td>` +
      `<td>${markers}</td>` +
      "</tr>"
    );
  }

  function renderZonesTable() {
    const tbody = document.querySelector("#roads-zones-table tbody");
    if (!tbody) return;
    const roads = zones().filter((z) => z.type === "roads");
    roads.sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
    tbody.innerHTML = roads.map(zoneRow).join("") ||
      `<tr><td colspan="6">${T("Zone data unavailable.", "roads_zone_data_unavailable")}</td></tr>`;
    if (typeof window.applyTableSearchFilter === "function") window.applyTableSearchFilter("roads-zones-table");
  }

  // ── route finder ─────────────────────────────────────────────────────────

  /**
   * A way out of the Roads: any zone the upstream catalog colours, i.e. royal
   * or outlands open world. Cities are deliberately absent — a roads portal
   * never opens into one, so they would be unreachable graph nodes.
   */
  function isExitZone(zone) {
    return !!zone && zone.type !== "roads";
  }

  /**
   * One line per route — the markup itself lives in js/roads-route-describe.js,
   * which is pure so the tests can render without a DOM. Everything it needs to
   * annotate the answer (the binding in force, the preference, whether any
   * portal is mapped at all) is read here, where the controls are.
   */
  function renderRouteLine(route) {
    return describeRoute(route, {
      zoneLabel,
      escapeHtml,
      formatDuration,
      t: T,
      realmgate: selectedRealmgate(),
      prefer: selectedPreference(),
      hasPortals: ensureGraph().all().some((p) => p.isLive(Date.now())),
    });
  }

  function renderNearestExit() {
    const out = document.getElementById("roads-route-result");
    if (!out) return;
    const typed = document.getElementById("roads-route-from")?.value;
    const from = resolveZone(typed);
    if (!from) {
      out.textContent = T("Enter the zone you are standing in.", "roads_enter_current_zone");
      return;
    }
    const off = offNetworkZones(from);
    if (off.length) {
      out.textContent = pocketStartMessage(off);
      showRouteOnMap(null);
      return;
    }
    const route = findNearest(ensureGraph(), from.id, (id) => isExitZone(zoneById(id)), { now: Date.now() });
    const noExit = T("No live way out of {zone} recorded.", "roads_no_exit").replace("{zone}", escapeHtml(from.name));
    out.innerHTML = route
      ? renderRouteLine(route)
      : `<span style="color:#c47a7a">${noExit}</span>`;
    showRouteOnMap(route);
  }

  function renderRoute() {
    const out = document.getElementById("roads-route-result");
    if (!out) return;
    const fromInput = document.getElementById("roads-route-from")?.value;
    const toInput = document.getElementById("roads-route-to")?.value;
    const from = resolveZone(fromInput);
    const to = resolveZone(toInput);
    if (!from || !to) {
      const unknown = [!from && fromInput, !to && toInput].filter(Boolean);
      out.textContent = unknown.length
        ? T("Unknown zone: {zones}. Cities are not roads zones — use the open-world zone name.", "roads_unknown_zone")
            .replace("{zones}", unknown.join(", "))
        : T("Enter two zone names.", "roads_enter_two_zones");
      return;
    }
    // The pocket takes routes and never gives them back, so it is a fine
    // destination and an impossible start — saying "no live route" for the
    // latter would suggest one might turn up tomorrow.
    const off = offNetworkZones(from);
    if (off.length) {
      out.textContent = pocketStartMessage(off);
      showRouteOnMap(null);
      return;
    }
    const route = findHybridRoute(ensureGraph(), from.id, to.id, routeOptions());
    if (!route) {
      renderClosestApproach(out, from, to);
      return;
    }
    out.innerHTML = renderRouteLine(route);
    showRouteOnMap(route);
  }

  const REALMGATE_KEY = "roadsRealmgate";
  const PREFER_KEY = "roadsRoutePrefer";
  const CARGO_KEY = "roadsRouteCargo";
  const DEFAULT_PREFER = "portal";

  /** The portal city the character is bound to, or "" while none is chosen. */
  function selectedRealmgate() {
    const picked = document.getElementById("roads-route-gate")?.value;
    if (picked !== undefined) return picked || "";
    try { return localStorage.getItem(REALMGATE_KEY) || ""; } catch { return ""; }
  }

  /** Which kind of hop the search should favour. */
  function selectedPreference() {
    const picked = document.getElementById("roads-route-prefer")?.value;
    if (picked) return picked;
    try { return localStorage.getItem(PREFER_KEY) || DEFAULT_PREFER; } catch { return DEFAULT_PREFER; }
  }

  /** Whether the character is hauling — off unless it was ticked and saved. */
  function carryingCargo() {
    const box = document.getElementById("roads-route-cargo");
    if (box) return !!box.checked;
    try { return localStorage.getItem(CARGO_KEY) === "1"; } catch { return false; }
  }

  /**
   * Search options shared by both route buttons. City travel to Caerleon takes
   * no luggage, so a hauler wants those hops gone rather than merely labelled;
   * the binding decides which realmgate the search may leave through.
   */
  function routeOptions() {
    const cargo = carryingCargo();
    return {
      now: Date.now(),
      allowNoLuggage: !cargo,
      realmgate: selectedRealmgate() || null,
      prefer: selectedPreference(),
    };
  }

  /**
   * Fill the realmgate picker from the generated gate map, so the five portal
   * cities are never spelled out here, and restore both saved choices.
   */
  function initRouteControls() {
    const gate = document.getElementById("roads-route-gate");
    if (gate && typeof ROADS_REALMGATES !== "undefined") {
      const options = [...ROADS_REALMGATES.keys()]
        .map((id) => ({ id, name: zoneLabel(id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const { id, name } of options) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = name;
        gate.appendChild(option);
      }
    }
    try {
      const savedGate = localStorage.getItem(REALMGATE_KEY);
      if (gate && savedGate && [...gate.options].some((o) => o.value === savedGate)) {
        gate.value = savedGate;
      }
      const prefer = document.getElementById("roads-route-prefer");
      const savedPrefer = localStorage.getItem(PREFER_KEY);
      if (prefer && savedPrefer && [...prefer.options].some((o) => o.value === savedPrefer)) {
        prefer.value = savedPrefer;
      }
      const cargo = document.getElementById("roads-route-cargo");
      if (cargo) cargo.checked = localStorage.getItem(CARGO_KEY) === "1";
    } catch { /* private mode — the defaults stand */ }
  }

  /** Remember a control's value and re-run the answer under the new rule. */
  function onRouteRuleChanged(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
    if (document.getElementById("roads-route-result")?.textContent) renderRoute();
  }

  /**
   * Nothing reaches the destination — say how close the mapped portals get
   * anyway, which is the question behind "no live route": where do I run to?
   */
  function renderClosestApproach(out, from, to) {
    const noRoute = T("No live route from {from} to {to}.", "roads_no_route")
      .replace("{from}", escapeHtml(from.name))
      .replace("{to}", escapeHtml(to.name));
    const found = typeof findClosestApproach === "function"
      ? findClosestApproach(ensureGraph(), from.id, to.id, routeOptions())
      : null;
    if (!found) {
      out.innerHTML = `<span style="color:#c47a7a">${noRoute}</span>`;
      showRouteOnMap(null);
      return;
    }
    const closest = T("Closest you can get: {zone}", "roads_closest_approach")
      .replace("{zone}", `<strong>${escapeHtml(zoneLabel(found.target))}</strong>`);
    const gap = T("no mapped way to run the rest", "roads_closest_approach_gap");
    out.innerHTML =
      `<span style="color:#c47a7a">${noRoute}</span> ${closest} — ${renderRouteLine(found.route)} ` +
      `<span style="color:#9ca3af">(${gap})</span>`;
    showRouteOnMap(found.route);
  }

  // ── manual entry ─────────────────────────────────────────────────────────

  function addManualPortal() {
    const status = document.getElementById("roads-add-status");
    const from = resolveZone(document.getElementById("roads-add-from")?.value);
    const to = resolveZone(document.getElementById("roads-add-to")?.value);
    const size = document.getElementById("roads-add-size")?.value;
    const seconds = timeInput().parse(document.getElementById("roads-add-hours")?.value);
    if (!from || !to || seconds === null) {
      if (status) status.textContent = T("Need two known zones and a time left.", "roads_add_need_fields");
      return;
    }
    const off = offNetworkZones(from, to);
    if (off.length) {
      if (status) status.textContent = pocketPortalMessage(off);
      return;
    }
    const portal = recordPortal({
      fromZoneId: from.id,
      toZoneId: to.id,
      size,
      secondsRemaining: seconds,
      source: "manual",
    });
    if (!status) return;
    status.textContent = portal
      ? T("Added {from} → {to}.", "roads_added_portal").replace("{from}", from.name).replace("{to}", to.name)
      : T("Rejected (same zone?).", "roads_add_rejected");
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  /**
   * Zone names are unspellable from memory, so every free-text zone box gets a
   * live shortlist. Wired here rather than in the markup because the options
   * come from the generated catalog, which only exists once its script has run.
   */
  function bindZoneSuggest() {
    if (typeof attachZoneSuggest !== "function") return;
    // Only the destination box may name the pocket: you route TO Brecilien,
    // never from it, and no portal record may name it at either end.
    for (const id of ["roads-route-from", "roads-add-from", "roads-add-to"]) {
      attachZoneSuggest(document.getElementById(id), routableZones);
    }
    attachZoneSuggest(document.getElementById("roads-route-to"), destinationZones);
  }

  function bindControls() {
    bindZoneSuggest();
    initRouteControls();
    document.getElementById("roads-route-btn")?.addEventListener("click", renderRoute);
    document.getElementById("roads-exit-btn")?.addEventListener("click", renderNearestExit);
    // Re-run rather than leave a stale answer standing under a changed rule.
    document.getElementById("roads-route-cargo")?.addEventListener("change", (e) => {
      onRouteRuleChanged(CARGO_KEY, e.target.checked ? "1" : "0");
    });
    document.getElementById("roads-route-gate")?.addEventListener("change", (e) => {
      onRouteRuleChanged(REALMGATE_KEY, e.target.value);
    });
    document.getElementById("roads-route-prefer")?.addEventListener("change", (e) => {
      onRouteRuleChanged(PREFER_KEY, e.target.value);
    });
    document.getElementById("roads-add-btn")?.addEventListener("click", addManualPortal);
    // Wiping the graph is unrecoverable — the portals only ever existed on this
    // machine — so it asks, but only when there is something to lose.
    document.getElementById("roads-clear-btn")?.addEventListener("click", () => {
      const graph = ensureGraph();
      const count = graph.all().length;
      if (!count) return;
      const question = T("Remove all {n} recorded portals? This cannot be undone.", "roads_clear_confirm")
        .replace("{n}", count);
      if (typeof confirm === "function" && !confirm(question)) return;
      graph.clear();
      persist();
      renderPortalsTable(true);
      renderPortalsMap();
      const status = document.getElementById("roads-add-status");
      if (status) status.textContent = T("Cleared {n} portals.", "roads_cleared").replace("{n}", count);
    });
    const portalsTable = document.querySelector("#roads-portals-table");
    portalsTable?.addEventListener("click", (event) => {
      const button = event.target.closest(".roads-drop-portal");
      if (!button) return;
      const [a, b] = button.dataset.key.split("|");
      ensureGraph().remove(a, b);
      persist();
      renderPortalsTable(true);
      renderPortalsMap();
    });
    portalEditor().bindPortalEditing(portalsTable, {
      portalOf,
      applyPortalPatch,
      renderPortalsTable,
      renderPortalsMap,
    });
  }

  function renderRoadsPanel() {
    ensureGraph();
    autoPruneExpired(Date.now());
    renderZonesTable();
    renderPortalsTable();
    renderPortalsMap();
  }

  /** Drop the cached graph and re-read storage — used after a settings import. */
  function reloadPortals() {
    graph = null;
    renderRoadsPanel();
  }

  if (typeof window !== "undefined") {
    window.renderRoadsPanel = renderRoadsPanel;
    window.reloadRoadsPortals = reloadPortals;
    document.addEventListener("DOMContentLoaded", () => {
      // The zones/portals tables render from the injected catalogs
      // (js/catalog-loader.js), which land after first paint — paint on their
      // promise or the first render reads empty guards and stays that way
      // until the section is collapsed and reopened.
      const paint = () => {
        try {
          renderRoadsPanel();
          bindControls();
          const zonesTable = document.getElementById("roads-zones-table");
          if (zonesTable) zonesTable._staticRenderer = renderZonesTable;
          const portalsTable = document.getElementById("roads-portals-table");
          // Expanding the section replays this; the map is part of that section.
          if (portalsTable) portalsTable._staticRenderer = () => { renderPortalsTable(); renderPortalsMap(); };
          timer = setInterval(() => {
            // Prune first, so a portal that died since the last tick is gone in
            // the same paint that redraws the countdowns.
            autoPruneExpired(Date.now());
            renderPortalsTable();
            // Timers only — a relayout here would discard dragged positions.
            window.roadsGraphView?.tick(Date.now());
          }, REFRESH_MS);
        } catch (e) {
          console.error("renderRoadsPanel:", e);
        }
      };
      if (typeof showCatalogLoading === "function") {
        showCatalogLoading("roads-zones-table");
        showCatalogLoading("roads-portals-table");
      }
      if (typeof whenCatalogsReady === "function") whenCatalogsReady(paint);
      else paint();
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      renderRoadsPanel, renderPortalsTable, renderZonesTable, renderRoute, renderNearestExit,
      recordPortal, resolveZone, formatDuration, chestSummary, zoneRow, portalRow, renderPortalsMap,
      autoPruneExpired,
      isExitZone, renderRouteLine, routeOptions, initRouteControls, deleteFromMap,
      routeMapPairs, isBrecilienSelection,
      routableZones, destinationZones, offNetworkZones,
      pocketStartMessage, pocketPortalMessage,
      _setGraph: (g) => { graph = g; },
      _stop: () => clearInterval(timer),
    };
  }
})();
