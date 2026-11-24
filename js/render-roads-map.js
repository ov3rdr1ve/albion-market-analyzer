/**
 * The panel's half of the node-link map — js/render-roads.js's bridge to
 * js/roads-graph-view.js.
 *
 * Split out of the panel because it is a separate responsibility: the view owns
 * no portal data and the panel owns no geometry, so somebody has to translate
 * between "a selection on an SVG" and "a record in the portal store". That is
 * all this file does.
 *
 * Two translations, and both are less obvious than they look:
 *
 *   DELETING   an edge is one portal record. A NODE is not a record at all — it
 *              exists only while some portal names its zone, so deleting it
 *              means dropping every portal touching it, and 2+ asks first
 *              because there is no undo. The Brecilien link is neither: it is a
 *              fact about the game, derived from the zone catalog, so nothing
 *              can remove it and its key never reaches the store.
 *
 *   HIGHLIGHT  a hybrid route mixes four kinds of hop and only two of them are
 *              edges here. Portals are, the Brecilien portal is, and the zones a
 *              route runs or travels through were never drawn — so the view is
 *              fed those pairs rather than the zone path.
 *
 * Dependency-injected, so the tests drive it without a DOM.
 */

/**
 * @param {object} deps
 *   T(en, slug)          translator
 *   graph()              the live portal store
 *   zoneById(id)         id → zone record
 *   zoneLabel(id)        id → display name
 *   isExit(zone)         zone → leaves the Roads
 *   persist()            write the store back
 *   afterDelete()        redraw whatever the removal invalidated
 *   view()               the SVG view, or null before it mounts
 *   confirm(question)    → boolean
 *   brecilienId()        → Brecilien's zone id
 */
function createRoadsMapBridge(deps = {}) {
  const {
    T = (en) => en,
    graph = () => null,
    zoneById = () => null,
    zoneLabel = (id) => id,
    isExit = null,
    persist = () => {},
    afterDelete = () => {},
    view = () => (typeof window !== "undefined" ? window.roadsGraphView : null),
    confirm: ask = (q) => (typeof confirm === "function" ? confirm(q) : true),
    brecilienId = () => (typeof BRECILIEN_ZONE_ID !== "undefined" ? BRECILIEN_ZONE_ID : "5000"),
  } = deps;

  /** Redraw the map. Full relayout — call it when portals change. */
  function renderPortalsMap() {
    const v = view();
    const g = graph();
    if (!v || !g) return;
    v.render({
      portals: g.all(),
      zoneById,
      isExit,
      now: Date.now(),
      onDelete: deleteFromMap,
    });
  }

  /** Does this selection name the static Brecilien link, or the city itself? */
  function isBrecilienSelection(selection) {
    const city = brecilienId();
    if (selection.kind === "edge") return String(selection.key || "").split("|").includes(city);
    return selection.id === city;
  }

  /**
   * Del on the map.
   * @param {{kind: "node"|"edge", id?: string, key?: string}} selection
   * @returns {number} portals removed
   */
  function deleteFromMap(selection) {
    if (!selection) return 0;
    if (isBrecilienSelection(selection)) return 0;
    const g = graph();
    if (!g) return 0;
    let dropped;

    if (selection.kind === "edge") {
      const [a, b] = String(selection.key || "").split("|");
      if (!a || !b || !g.remove(a, b)) return 0;
      dropped = 1;
    } else {
      const hits = g.all().filter((p) => p.fromZoneId === selection.id || p.toZoneId === selection.id);
      if (!hits.length) return 0;
      if (hits.length > 1) {
        const question = T("Remove all {n} portals at {zone}? This cannot be undone.", "roads_delete_zone_confirm")
          .replace("{n}", hits.length)
          .replace("{zone}", zoneLabel(selection.id));
        if (!ask(question)) return 0;
      }
      dropped = g.removeZone(selection.id);
    }

    persist();
    afterDelete();
    renderPortalsMap();
    return dropped;
  }

  /** The route hops that exist as edges on the map: portals and Brecilien. */
  function routeMapPairs(route) {
    const pairs = [...(route.portalPairs || [])];
    const zones = route.zones || [];
    (route.steps || []).forEach((step, i) => {
      if (step.via === "brecilien") pairs.push([zones[i], zones[i + 1]]);
    });
    return pairs;
  }

  function showRouteOnMap(route) {
    const v = view();
    if (!v) return;
    v.highlightRoute(route ? route.zones : [], route ? routeMapPairs(route) : undefined);
  }

  return { renderPortalsMap, deleteFromMap, showRouteOnMap, routeMapPairs, isBrecilienSelection };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createRoadsMapBridge };
}
