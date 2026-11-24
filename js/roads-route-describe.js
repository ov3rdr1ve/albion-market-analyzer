/**
 * One line per route — the only place a hybrid route turns into HTML.
 *
 * A route mixes four kinds of hop, so they are counted apart (the portals are
 * what expires, the zones on foot are what gets you killed, the travels are
 * what costs silver) and the path marks each hop for what it is:
 *
 *   ⟶  a Roads portal
 *   ⇢  city travel     (grey "no luggage" where the network says so)
 *   ›  you run it
 *   ⟼  the Brecilien portal — permanent, and the last hop of any route that
 *      takes it, because nothing comes back out of the pocket
 *
 * Two extra warnings, both about the realmgate: an outbound crossing says which
 * binding it needs while no binding is chosen, and a crossing that would move
 * your binding says so — walking home through a foreign gate re-binds you and
 * shuts your own gate behind you.
 *
 * Pure: every helper is injected, so the Node tests render without a DOM.
 */

/**
 * @param {object} route  a findHybridRoute result
 * @param {object} helpers
 *   zoneLabel(id) → display name, escapeHtml(text), formatDuration(seconds),
 *   t(en, slug) → translated string,
 *   realmgate  the portal city the user is bound to, or "" / null for "any",
 *   prefer     the routing preference in force ("fastest" adds the estimate),
 *   hasPortals whether any live portal is mapped at all
 * @returns {string} HTML
 */
function describeRoute(route, helpers = {}) {
  const {
    zoneLabel = (id) => id,
    escapeHtml = (text) => String(text),
    formatDuration = (s) => String(s),
    t = (en) => en,
    realmgate = null,
    prefer = null,
    hasPortals = false,
  } = helpers;

  const portalHops = route.portalHops === undefined ? route.hops : route.portalHops;
  const footHops = route.footHops || 0;
  const travelHops = route.travelHops || 0;
  const brecilienHops = route.brecilienHops || 0;
  const steps = route.steps || route.zones.slice(1).map((zone) => ({ zone, via: "portal" }));

  const grey = (text) => ` <span style="color:#9ca3af">(${text})</span>`;
  const noLuggage = t("no luggage", "roads_no_luggage");

  let path = escapeHtml(zoneLabel(route.zones[0]));
  steps.forEach((step) => {
    const name = escapeHtml(zoneLabel(step.zone));
    if (step.via === "portal") {
      path += ` <span style="color:#a78bfa">⟶</span> ${name}`;
      return;
    }
    if (step.via === "brecilien") {
      path += ` <span style="color:#e5e7eb">⟼</span> ${name}`;
      return;
    }
    if (step.via === "travel") {
      path += ` <span style="color:#6ea8fe">⇢</span> ${name}`;
      if (step.noLuggage) path += grey(noLuggage);
      if (step.gate === "out" && !realmgate) {
        path += grey(t("needs {zone} binding", "roads_needs_binding")
          .replace("{zone}", escapeHtml(zoneLabel(step.zone))));
      }
      if (step.gate === "in" && step.rebindsTo && step.rebindsTo !== realmgate) {
        path += grey(t("re-binds you to {zone}", "roads_rebinds_to")
          .replace("{zone}", escapeHtml(zoneLabel(step.rebindsTo))));
      }
      return;
    }
    path += ` › ${name}`;
  });

  const parts = [];
  if (portalHops || (!footHops && !travelHops && !brecilienHops)) {
    const word = portalHops === 1 ? t("portal", "roads_portal_one") : t("portals", "roads_portal_many");
    parts.push(`${portalHops} ${word}`);
  }
  if (travelHops) {
    const word = travelHops === 1
      ? t("travel", "roads_travel_hop_one")
      : t("travels", "roads_travel_hop_many");
    parts.push(`${travelHops} ${word}`);
  }
  if (footHops) {
    const word = footHops === 1
      ? t("zone on foot", "roads_foot_hop_one")
      : t("zones on foot", "roads_foot_hop_many");
    parts.push(`${footHops} ${word}`);
  }
  // Never plural: the pocket is a sink, so one is all a route can ever take.
  if (brecilienHops) parts.push(t("Brecilien portal", "roads_brecilien_hop"));

  let tail = "";
  if (portalHops) {
    // A leg whose timer nobody read makes this an upper bound, not a promise:
    // say so rather than let "valid 9h" read as a measured nine hours.
    tail += grey(route.timerEstimated
      ? `${t("open at most", "roads_route_valid_estimated")} ${formatDuration(route.secondsLeft)}`
      : `${t("valid", "roads_route_valid")} ${formatDuration(route.secondsLeft)}`);
  } else if (hasPortals) {
    // The search is cost-optimal, so this is a fact, not a guess.
    tail += grey(t("no mapped portal makes this shorter", "roads_no_portal_shortcut"));
  }
  if (prefer === "fastest" && Number.isFinite(route.estimatedSeconds)) {
    tail += grey(t("about {time}", "roads_route_eta")
      .replace("{time}", formatDuration(route.estimatedSeconds)));
  }

  return `<strong>${parts.join(" + ")}</strong>: ${path}${tail}`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { describeRoute };
}
