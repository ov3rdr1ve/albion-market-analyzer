/**
 * Roads of Avalon map view — the live portal graph drawn as connected nodes.
 *
 * Everything spatial comes from js/roads-graph-layout.js (pure, testable); this
 * file only turns positioned nodes into SVG and wires the pointer.
 *
 * Reading the picture:
 *   node size   = zone tier          node colour = zone type (roads/royal/outlands)
 *   ◆ ring      = Avalonian Rest     dashed ring = a way out of the Roads
 *   edge width  = portal size (solo/group/raid)
 *   dashed grey = expired portal, kept until you Drop Expired
 *   gold path   = the route currently shown in the route box
 *
 * Pointer: drag a node to rearrange, drag the background to pan, wheel to zoom,
 * click a node to load it into "From" (shift-click into "To").
 *
 * Keyboard: a clicked node or portal stays selected; Del asks the host to delete
 * it (via the `onDelete` callback render() is handed), Escape drops the
 * selection. The view owns no portal data, so deleting is somebody else's job.
 */

(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";

  const TYPE_FILL = {
    roads: "#7c5cbf",
    royalBlue: "#3b82f6",
    royalYellow: "#d9a441",
    royalRed: "#c05252",
    outlands: "#b45309",
    city: "#6b7280",
    other: "#4b5563",
  };

  const SIZE_WIDTH = { solo: 1.6, group: 2.8, raid: 4.4, unknown: 1.6 };
  const SIZE_LABEL = {
    solo: ["Solo", "portal_size_solo"],
    group: ["Group", "portal_size_group"],
    raid: ["Raid", "portal_size_raid"],
    unknown: ["?", "portal_size_unknown"],
  };

  const TYPE_NAME = {
    roads: ["Roads", "roads_type_roads"],
    royalBlue: ["Royal (blue)", "roads_type_royal_blue"],
    royalYellow: ["Royal (yellow)", "roads_type_royal_yellow"],
    royalRed: ["Royal (red)", "roads_type_royal_red"],
    outlands: ["Outlands", "roads_type_outlands"],
    city: ["City", "roads_type_city"],
    other: ["Other", "roads_type_other"],
  };

  const CHEST_NAME = {
    green: ["green", "roads_chest_green"],
    blue: ["blue", "roads_chest_blue"],
    gold: ["gold", "roads_chest_gold"],
  };

  /** Runtime string: English inline, Spanish from the UI_STRINGS_ES overlay. */
  function T(en, slug) {
    return typeof tx === "function" ? tx(en, slug) : en;
  }

  function label(table, key, fallback) {
    const pair = table[key];
    return pair ? T(pair[0], pair[1]) : fallback !== undefined ? fallback : key;
  }

  /**
   * Biome names come from the shared ROADS_BIOME_LABELS table in
   * js/roads-labels.js. That file loads AFTER this script in the browser
   * (defer order) and is a plain require in Node, so the table is resolved at
   * draw time, not captured at load; a missing table falls back to the raw key.
   */
  function biomeLabel(key) {
    const table = typeof ROADS_BIOME_LABELS !== "undefined" ? ROADS_BIOME_LABELS
      : typeof require === "function" ? require("./roads-labels.js").ROADS_BIOME_LABELS
      : null;
    return label(table || {}, key);
  }

  const VIEW_W = 940;
  // Matches #roads-map's CSS height, so one viewBox unit is one CSS pixel at
  // the default zoom and the layout's node gaps land on screen as drawn.
  const VIEW_H = 620;

  let state = {
    nodes: [],
    edges: [],
    byId: new Map(),
    routeEdges: new Set(),
    routeNodes: new Set(),
    // The layout grows its canvas past VIEW_W/VIEW_H when the portals no longer
    // fit without overlapping, so the fitted view is whatever it handed back.
    canvas: { w: VIEW_W, h: VIEW_H },
    view: { x: 0, y: 0, w: VIEW_W, h: VIEW_H },
    onDelete: null,
  };

  let svg = null;
  let root = null; // <g> holding everything, so pan/zoom is one viewBox write
  let tip = null;
  let drag = null;
  // {kind:"node", id} | {kind:"edge", key} | null. Kept by id/key, never as a
  // reference: render() rebuilds every node object, so a held one would go stale.
  let selection = null;

  // ── element helpers ──────────────────────────────────────────────────────

  function el(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    }
    return node;
  }

  /** Same radius the layout's overlap pass separates by — never fork it. */
  function radiusOf(node) {
    return typeof nodeRadius === "function" ? nodeRadius(node) : 12;
  }

  function formatLeft(seconds) {
    if (seconds <= 0) return T("expired", "roads_expired");
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }

  function chestText(chests) {
    const parts = [];
    for (const colour of ["green", "blue", "gold"]) {
      if (chests[colour]) parts.push(`${chests[colour]}×${label(CHEST_NAME, colour)}`);
    }
    return parts.join(", ");
  }

  // ── drawing ──────────────────────────────────────────────────────────────

  function edgePath(edge) {
    const a = state.byId.get(edge.source);
    const b = state.byId.get(edge.target);
    if (!a || !b) return null;
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  /**
   * The arrowhead on the Brecilien edge — the only directed line on the map,
   * and the only thing that says the trip does not come back.
   */
  function brecilienArrowDefs() {
    const defs = el("defs", {});
    const marker = el("marker", {
      id: "roads-brecilien-arrow", markerWidth: 6, markerHeight: 6,
      refX: 5.4, refY: 3, orient: "auto", markerUnits: "strokeWidth",
    });
    marker.appendChild(el("path", { d: "M0,0.6 L5.6,3 L0,5.4 z", class: "roads-brecilien-arrow" }));
    defs.appendChild(marker);
    return defs;
  }

  function drawEdges(layer) {
    for (const edge of state.edges) {
      const p = edgePath(edge);
      if (!p) continue;
      const routed = state.routeEdges.has(edge.key);
      const picked = isSelected("edge", edge.key);

      // A 1.6px stroke is not something anyone can hit with a mouse, so the
      // gestures live on a fat invisible twin drawn under the real line.
      const hit = el("line", {
        x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
        class: "roads-edge-hit", "stroke-width": 12, "data-key": edge.key,
      });
      hit.addEventListener("pointerenter", () => showTip(edgeTip(edge)));
      hit.addEventListener("pointerleave", hideTip);
      hit.addEventListener("pointerdown", (event) => startEdgePress(event, edge));
      layer.appendChild(hit);

      const line = el("line", {
        x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
        class: `roads-edge${edge.kind === "brecilien" ? " is-brecilien" : ""}` +
          `${edge.dead ? " is-dead" : ""}${routed ? " is-route" : ""}${picked ? " is-selected" : ""}`,
        "stroke-width": (SIZE_WIDTH[edge.size] || 1.6) * (routed ? 1.9 : 1),
        "data-key": edge.key,
      });
      if (edge.kind === "brecilien") line.setAttribute("marker-end", "url(#roads-brecilien-arrow)");
      layer.appendChild(line);
      // Held so the drag redraw and the countdown tick never have to guess which
      // of the two same-keyed lines a selector meant.
      edge.line = line;
      edge.hit = hit;
    }
  }

  function drawNodes(layer) {
    // Same threshold repaint() uses for the is-dense class: past ~30 zones the
    // name labels hide, and the biome caption hides with them (the tooltip
    // still carries the biome).
    const dense = state.nodes.length > 30;
    for (const node of state.nodes) {
      const r = radiusOf(node);
      const group = el("g", {
        class: `roads-node${state.routeNodes.has(node.id) ? " is-route" : ""}${node.isExit ? " is-exit" : ""}` +
          `${node.isBrecilien ? " is-brecilien" : ""}${isSelected("node", node.id) ? " is-selected" : ""}`,
        "data-id": node.id,
        transform: `translate(${node.x},${node.y})`,
      });

      if (node.isRest) group.appendChild(el("circle", { r: r + 4.5, class: "roads-node-rest" }));
      if (node.isExit) group.appendChild(el("circle", { r: r + 4.5, class: "roads-node-exit-ring" }));
      group.appendChild(el("circle", {
        r,
        class: "roads-node-dot",
        fill: TYPE_FILL[node.type] || TYPE_FILL.other,
      }));

      const label = el("text", { class: "roads-node-label", y: -r - 5 });
      label.textContent = node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name;
      group.appendChild(label);

      // Second caption line in the label stack. The name's baseline sits at
      // -(r+5) with glyphs growing upward, and the rest/exit rings top out at
      // about -(r+5.7): the only free line is directly ABOVE the name, clear
      // of both rings and of the tier text inside the circle.
      if (!dense && node.biome) {
        const biome = el("text", { class: "roads-node-biome", y: -r - 16 });
        biome.textContent = biomeLabel(node.biome);
        group.appendChild(biome);
      }

      const tier = el("text", { class: "roads-node-tier", y: 3.5 });
      tier.textContent = node.tier ? `T${node.tier}` : "";
      group.appendChild(tier);

      group.addEventListener("pointerenter", () => showTip(nodeTip(node)));
      group.addEventListener("pointerleave", hideTip);
      group.addEventListener("pointerdown", (event) => startNodeDrag(event, node, group));
      layer.appendChild(group);
    }
  }

  function repaint() {
    if (!root) return;
    root.textContent = "";
    // Past ~30 zones the names collide; drop back to hover/route labels only.
    root.setAttribute("class", `roads-map-root${state.nodes.length > 30 ? " is-dense" : ""}`);
    const edgeLayer = el("g", { class: "roads-edges" });
    const nodeLayer = el("g", { class: "roads-nodes" });
    root.appendChild(edgeLayer);
    root.appendChild(nodeLayer);
    drawEdges(edgeLayer);
    drawNodes(nodeLayer);
    applyView();
  }

  /** Cheap path used while dragging: move one node, redraw only its lines. */
  function moveNode(node) {
    const group = root.querySelector(`.roads-node[data-id="${cssEscape(node.id)}"]`);
    if (group) group.setAttribute("transform", `translate(${node.x},${node.y})`);
    for (const edge of state.edges) {
      if (edge.source !== node.id && edge.target !== node.id) continue;
      const p = edgePath(edge);
      if (!p) continue;
      for (const line of [edge.line, edge.hit]) {
        if (!line) continue;
        line.setAttribute("x1", p.x1); line.setAttribute("y1", p.y1);
        line.setAttribute("x2", p.x2); line.setAttribute("y2", p.y2);
      }
    }
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  // ── tooltip ──────────────────────────────────────────────────────────────

  function nodeTip(node) {
    const bits = [`<strong>${escapeHtml(node.name)}</strong>`];
    const meta = [
      node.tier ? `T${node.tier}` : null,
      label(TYPE_NAME, node.type),
      node.isRest ? T("Avalonian Rest", "roads_avalonian_rest") : null,
    ].filter(Boolean).join(" · ");
    if (meta) bits.push(escapeHtml(meta));
    if (node.biome) bits.push(escapeHtml(biomeLabel(node.biome)));
    const chests = chestText(node.chests || {});
    if (chests) bits.push(`${escapeHtml(T("chests", "roads_chests_lower"))}: ${escapeHtml(chests)}`);
    const live = node.liveDegree === 1
      ? T("{n} live portal", "roads_live_portal_one")
      : T("{n} live portals", "roads_live_portal_many");
    bits.push(escapeHtml(live.replace("{n}", node.liveDegree)));
    if (node.isExit) bits.push(escapeHtml(T("way out of the Roads", "roads_map_exit_note")));
    if (node.isBrecilien) bits.push(escapeHtml(T("no way back out — the exit lands in a random Road", "roads_map_brecilien_note")));
    if (!node.known) bits.push(escapeHtml(T("unknown zone id — not in the catalog", "roads_map_unknown_id")));
    return bits.join("<br>");
  }

  function edgeTip(edge) {
    const from = state.byId.get(edge.source);
    const to = state.byId.get(edge.target);
    const ends = `${escapeHtml(from ? from.name : edge.source)} — ${escapeHtml(to ? to.name : edge.target)}`;
    // The Brecilien portal has no size and no clock, and the arrow is the
    // point: it goes one way.
    if (edge.kind === "brecilien") {
      return `<strong>${ends}</strong><br>` +
        escapeHtml(T("permanent one-way portal into Brecilien", "roads_map_brecilien_edge"));
    }
    const size = `${label(SIZE_LABEL, edge.size, "?")} ${T("portal", "roads_portal_one")}`;
    return (
      `<strong>${ends}</strong><br>` +
      `${escapeHtml(size)} · ${escapeHtml(formatLeft(edge.secondsLeft))}`
    );
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function showTip(html) {
    if (!tip) return;
    tip.innerHTML = html;
    tip.style.display = "block";
  }

  function hideTip() {
    if (tip) tip.style.display = "none";
  }

  function trackTip(event) {
    if (!tip || tip.style.display === "none") return;
    const box = svg.parentElement.getBoundingClientRect();
    tip.style.left = `${event.clientX - box.left + 14}px`;
    tip.style.top = `${event.clientY - box.top + 14}px`;
  }

  // ── pan / zoom / drag ────────────────────────────────────────────────────

  function applyView() {
    if (!svg) return;
    const v = state.view;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  function resetView() {
    state.view = { x: 0, y: 0, w: state.canvas.w, h: state.canvas.h };
    applyView();
  }

  /** Client pixels → viewBox units. */
  function toGraph(event) {
    const box = svg.getBoundingClientRect();
    const v = state.view;
    return {
      x: v.x + ((event.clientX - box.left) / box.width) * v.w,
      y: v.y + ((event.clientY - box.top) / box.height) * v.h,
    };
  }

  function startNodeDrag(event, node, group) {
    event.stopPropagation();
    const start = toGraph(event);
    drag = {
      kind: "node", node, group, pointerId: event.pointerId,
      offsetX: node.x - start.x, offsetY: node.y - start.y, moved: false,
    };
    capture(event.pointerId);
    takeFocus();
  }

  /** A portal has no geometry of its own to drag, so a press only decides
   *  whether the gesture ends as a pick or as a pan that ran over the line. */
  function startEdgePress(event, edge) {
    event.stopPropagation();
    drag = { kind: "edge", key: edge.key, pointerId: event.pointerId, moved: false };
    capture(event.pointerId);
    takeFocus();
  }

  function startPan(event) {
    const start = toGraph(event);
    drag = {
      kind: "pan", pointerId: event.pointerId,
      startX: start.x, startY: start.y, viewX: state.view.x, viewY: state.view.y,
      moved: false,
    };
    capture(event.pointerId);
    takeFocus();
  }

  /** Del is a key on the map, and only a focused element gets keydown. */
  function takeFocus() {
    if (svg && typeof svg.focus === "function") {
      try { svg.focus({ preventScroll: true }); } catch (e) { svg.focus(); }
    }
  }

  /** Capture is an optimisation (it keeps a fast drag on target); losing it is
   *  survivable, and a synthetic pointer id has none to take. */
  function capture(pointerId) {
    try { svg.setPointerCapture(pointerId); } catch (e) { /* no live pointer */ }
  }

  function onPointerMove(event) {
    trackTip(event);
    if (!drag) return;
    const at = toGraph(event);
    if (drag.kind === "node") {
      drag.node.x = at.x + drag.offsetX;
      drag.node.y = at.y + drag.offsetY;
      drag.moved = true;
      moveNode(drag.node);
    } else if (drag.kind === "edge") {
      // Nothing to move — the flag is only here so a pan that started on a
      // portal line does not end as a pick.
      drag.moved = true;
    } else {
      drag.moved = true;
      state.view.x = drag.viewX - (at.x - drag.startX);
      state.view.y = drag.viewY - (at.y - drag.startY);
      applyView();
    }
  }

  /**
   * Selection happens HERE, not on a click listener attached to the node.
   * startNodeDrag captures the pointer on the <svg>, and a captured pointer
   * retargets the follow-up click to the capture element — so a listener on the
   * node <g> never fires and clicking a node did nothing at all. Deciding it on
   * pointerup is also the only way to tell a click from a finished drag.
   */
  function onPointerUp(event) {
    // A drag that actually moved rearranges the map and must not also retarget
    // the route box.
    if (drag && !drag.moved) {
      if (drag.kind === "node") {
        pickZone(drag.node, !!(event && event.shiftKey));
        select({ kind: "node", id: drag.node.id });
      } else if (drag.kind === "edge") {
        select({ kind: "edge", key: drag.key });
      } else {
        select(null); // a press on empty map drops the selection
      }
    }
    cancelDrag();
  }

  /** Leaving the svg mid-gesture ends it without selecting anything. */
  function cancelDrag() {
    if (drag && drag.pointerId !== undefined && svg && svg.releasePointerCapture) {
      try { svg.releasePointerCapture(drag.pointerId); } catch (e) { /* already released */ }
    }
    drag = null;
  }

  function onWheel(event) {
    event.preventDefault();
    const at = toGraph(event);
    const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
    const v = state.view;
    const w = Math.min(state.canvas.w * 4, Math.max(state.canvas.w * 0.15, v.w * factor));
    const scale = w / v.w;
    state.view = { x: at.x - (at.x - v.x) * scale, y: at.y - (at.y - v.y) * scale, w, h: v.h * scale };
    applyView();
  }

  /** Click a node: load it into the route box, so the map drives the finder. */
  function pickZone(node, toSlot) {
    const input = document.getElementById(toSlot ? "roads-route-to" : "roads-route-from");
    if (!input) return;
    input.value = node.name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const status = document.getElementById("roads-map-status");
    const slot = toSlot ? T("To", "to") : T("From", "from");
    if (status) status.textContent = `${slot}: ${node.name}`;
  }

  // ── selection ────────────────────────────────────────────────────────────

  function isSelected(kind, id) {
    if (!selection || selection.kind !== kind) return false;
    return kind === "node" ? selection.id === id : selection.key === id;
  }

  /** A selection the current model no longer contains is not a selection. */
  function selectionAlive() {
    if (!selection) return false;
    return selection.kind === "node"
      ? state.byId.has(selection.id)
      : state.edges.some((edge) => edge.key === selection.key);
  }

  function zoneName(zoneId) {
    const node = state.byId.get(zoneId);
    return node ? node.name : zoneId;
  }

  function selectionStatus() {
    const status = document.getElementById("roads-map-status");
    if (!status || !selection) return;
    if (selection.kind === "node") {
      // pickZone already wrote which route box it filled; the hint is appended
      // so both facts about the same click stay on one line.
      status.textContent = `${status.textContent} — ${T("Del removes it", "roads_map_del_hint")}`;
      return;
    }
    const [a, b] = selection.key.split("|");
    status.textContent = T("Portal {from} ↔ {to} — Del removes it", "roads_map_edge_selected")
      .replace("{from}", zoneName(a))
      .replace("{to}", zoneName(b));
  }

  function select(next) {
    const same = !next && !selection;
    selection = next;
    if (!same && state.nodes.length) repaint();
    if (next) selectionStatus();
    else {
      const status = document.getElementById("roads-map-status");
      if (status) status.textContent = "";
    }
  }

  /**
   * Del removes what is selected. The view has no portal store of its own, so it
   * asks the host through the callback render() was handed — that is also what
   * keeps the confirm prompt out of here and the module headless-testable.
   */
  function onKeyDown(event) {
    if (event.key === "Escape") { select(null); return; }
    if (event.key !== "Delete") return;
    if (!selection || typeof state.onDelete !== "function") return;
    event.preventDefault();
    // The selection is left standing: the host may put a confirm in the way, and
    // a cancelled delete must not also lose what the player had picked. render()
    // drops it once the model no longer holds it.
    state.onDelete(selection);
  }

  // ── public API ───────────────────────────────────────────────────────────

  function mount() {
    if (svg) return true;
    svg = document.getElementById("roads-map");
    tip = document.getElementById("roads-map-tip");
    if (!svg) return false;
    svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
    // Focusable so Del reaches the map. The listener stays on the <svg> on
    // purpose: a document-level one would also fire while the player is typing
    // in the portals table's hour editor or in a search box.
    svg.setAttribute("tabindex", "0");
    svg.appendChild(brecilienArrowDefs());
    root = el("g", { class: "roads-map-root" });
    svg.appendChild(root);

    svg.addEventListener("pointerdown", startPan);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointerleave", () => { cancelDrag(); hideTip(); });
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("keydown", onKeyDown);
    document.getElementById("roads-map-reset")?.addEventListener("click", resetView);
    return true;
  }

  /**
   * Rebuild the whole map from the current portal graph.
   * @param {{portals: Array, zoneById: Function, isExit: Function, now: number}} input
   */
  function render(input) {
    if (!mount()) return;
    const empty = document.getElementById("roads-map-empty");
    const model = buildRoadsGraphModel({ ...input, now: input.now || Date.now() });
    // Re-read every call, so a re-render never silently unwires Del.
    state.onDelete = typeof input.onDelete === "function" ? input.onDelete : null;

    if (!model.nodes.length) {
      state.nodes = []; state.edges = []; state.byId = new Map();
      selection = null;
      if (root) root.textContent = "";
      if (empty) empty.style.display = "";
      if (svg) svg.style.display = "none";
      return;
    }
    if (empty) empty.style.display = "none";
    if (svg) svg.style.display = "";

    const laid = layoutRoadsGraph(model, { width: VIEW_W, height: VIEW_H });
    state.nodes = laid.nodes;
    state.edges = laid.edges;
    state.byId = new Map(laid.nodes.map((n) => [n.id, n]));
    const canvas = { w: laid.width || VIEW_W, h: laid.height || VIEW_H };
    // A canvas that changed size makes the old viewBox meaningless; one that did
    // not keeps whatever the user panned or zoomed to.
    const resized = canvas.w !== state.canvas.w || canvas.h !== state.canvas.h;
    state.canvas = canvas;
    if (resized) resetView();
    // What was selected may be exactly what the caller just deleted.
    if (!selectionAlive()) selection = null;
    repaint();
  }

  /**
   * Highlight the zone path the route finder just produced. `portalPairs` is
   * optional and wins when given: a hybrid route walks part of the way on foot,
   * and only its portal hops are edges on this map.
   */
  function highlightRoute(zoneIds, portalPairs) {
    state.routeNodes = new Set(zoneIds || []);
    if (portalPairs && typeof routeEdgeKeysFromPairs === "function") {
      state.routeEdges = routeEdgeKeysFromPairs(portalPairs);
    } else {
      state.routeEdges = typeof routeEdgeKeys === "function" ? routeEdgeKeys(zoneIds || []) : new Set();
    }
    if (state.nodes.length) repaint();
  }

  function clearRoute() {
    highlightRoute([]);
  }

  /**
   * Countdown tick. Positions are untouched — a relayout every 15s would throw
   * away whatever the user dragged, and only the timers actually moved.
   */
  function tick(now = Date.now()) {
    if (!root || !state.edges.length) return;
    for (const edge of state.edges) {
      // The Brecilien portal has no clock to run down.
      if (!edge.expiresAt || edge.kind === "brecilien") continue;
      edge.secondsLeft = Math.max(0, Math.round((edge.expiresAt - now) / 1000));
      const dead = edge.secondsLeft <= 0;
      if (dead === edge.dead) continue;
      edge.dead = dead;
      if (edge.line) edge.line.classList.toggle("is-dead", dead);
    }
  }

  if (typeof window !== "undefined") {
    window.roadsGraphView = { render, highlightRoute, clearRoute, resetView, tick };
  }
})();
