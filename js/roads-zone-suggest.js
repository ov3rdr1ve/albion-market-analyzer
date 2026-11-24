/**
 * Zone autocomplete for the Roads panel's four free-text boxes.
 *
 * Zone names are Avalonian nonsense ("Quaes-Ovumlum", "Cases-Ugumlos") that
 * nobody can spell from memory, and a miss reads back as a flat "Unknown zone".
 * So the boxes get a live shortlist instead: a native <datalist> refilled on
 * every keystroke, capped so the DOM never carries a thousand options.
 *
 * suggestZones() is the whole decision and is pure — the DOM half below only
 * moves its result into <option> elements.
 *
 * Every zone the catalog knows is offered, cities included: resolveZone() and
 * the route finder both accept them, so leaving them out would only hide zones
 * that already work when typed in full.
 */

(function () {
  const DEFAULT_LIMIT = 12;

  /**
   * Apostrophes vanish (O'Quaes reads as one word to anyone typing it); every
   * other separator becomes a space, so "quaes-o", "quaes o" and "Quaes-O" all
   * hit the same targets.
   */
  function normalise(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  /** Lower rank sorts first. Null means "no match at all". */
  function matchRank(zone, query) {
    const name = normalise(zone.name);
    const id = normalise(zone.id);
    if (name === query || id === query) return 0;
    if (name.startsWith(query)) return 1;
    if (name.includes(` ${query}`)) return 2; // starts a later word
    if (name.includes(query)) return 3;
    if (id.includes(query)) return 4;
    return null;
  }

  // Roads zones are what these boxes are mostly for; open-world zones matter as
  // the far end of an exit; cities are the rarest thing to type here. At equal
  // match quality they sort in that order.
  const TYPE_ORDER = (type) => (type === "roads" ? 0 : type === "city" ? 2 : 1);

  /**
   * @param {Array} zones  the generated catalog (ROADS_ZONES)
   * @param {string} query what the user has typed so far
   * @param {{limit?: number}} [options]
   * @returns {Array} matching zone records, best first
   */
  function suggestZones(zones, query, options) {
    const list = Array.isArray(zones) ? zones : [];
    const limit = options && Number.isFinite(options.limit) ? options.limit : DEFAULT_LIMIT;
    const q = normalise(query);

    const scored = [];
    for (const zone of list) {
      if (!zone) continue;
      // An empty box still offers something to browse, so it ranks everything.
      const rank = q ? matchRank(zone, q) : 1;
      if (rank === null) continue;
      scored.push({ zone, rank });
    }

    scored.sort((a, b) =>
      a.rank - b.rank ||
      TYPE_ORDER(a.zone.type) - TYPE_ORDER(b.zone.type) ||
      String(a.zone.name).localeCompare(String(b.zone.name)));

    // Deduped AFTER ranking, so a name shared by two clusters keeps the better
    // of them rather than whichever the catalog happened to list first.
    const out = [];
    const seen = new Set();
    for (const { zone } of scored) {
      if (seen.has(zone.name)) continue;
      seen.add(zone.name);
      out.push(zone);
      if (out.length >= Math.max(0, limit)) break;
    }
    return out;
  }

  // ── DOM wiring ───────────────────────────────────────────────────────────

  /**
   * Point an <input> at a <datalist> and keep that list refilled as it is typed
   * in. One datalist per input: browsers key suggestions off the element, and
   * sharing one between boxes would show the last box's matches in the others.
   */
  function attachZoneSuggest(input, getZones) {
    if (!input || typeof document === "undefined") return null;
    const listId = `${input.id || `zone-${Math.random().toString(36).slice(2)}`}-list`;
    let list = document.getElementById(listId);
    if (!list) {
      list = document.createElement("datalist");
      list.id = listId;
      input.parentNode.insertBefore(list, input.nextSibling);
    }
    input.setAttribute("list", listId);

    // Rewriting the options while the dropdown is open makes it flicker, so an
    // unchanged shortlist (the common case as a name is typed out) is a no-op.
    let shown = null;

    const refill = () => {
      const zones = typeof getZones === "function" ? getZones() : getZones;
      const hits = suggestZones(zones, input.value);
      const key = hits.map((zone) => zone.id).join("|");
      if (key === shown) return;
      shown = key;
      list.innerHTML = hits
        .map((zone) => {
          const label = zone.tier ? `T${zone.tier}` : zone.type;
          return `<option value="${escapeAttr(zone.name)}">${escapeAttr(label)}</option>`;
        })
        .join("");
    };

    input.addEventListener("input", refill);
    input.addEventListener("focus", refill);
    refill();
    return refill;
  }

  function escapeAttr(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  if (typeof window !== "undefined") {
    window.suggestZones = suggestZones;
    window.attachZoneSuggest = attachZoneSuggest;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { suggestZones, attachZoneSuggest, normalise };
  }
})();
