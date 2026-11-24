/**
 * Roads of Avalon map layout — pure geometry, no DOM.
 *
 * The Roads have no fixed geography: portals rotate every 12-24h and no zone
 * carries map coordinates (the generated catalog has tier/depth and nothing
 * spatial). So the picture has to be derived from the live edges themselves —
 * a force-directed placement of whatever portals this client has recorded.
 *
 * Two steps, both deterministic so the map does not jitter between renders:
 *
 *   buildRoadsGraphModel — portals + zone catalog → {nodes, edges}
 *   layoutRoadsGraph     — nodes/edges → the same nodes with x/y inside a box
 *
 * Seeding is a circle in id order (no RNG), and the simulation is a plain
 * Fruchterman-Reingold.
 *
 * Every connected component is simulated ON ITS OWN, and the results are packed
 * side by side. One simulation over all of them at once needs a centre gravity
 * to stop loose clusters drifting off screen, and that gravity heaps them on
 * top of each other: a real 92-portal map came out with 79 overlapping node
 * pairs, the closest 10.9px apart against a ~15px radius, while the median pair
 * sat 186px away — clumped, not crowded. Packing gives each cluster its own
 * patch of canvas, and a final relaxation pass separates whatever circles still
 * touch.
 */

const ROADS_LAYOUT_DEFAULTS = {
  width: 940,
  height: 620,
  padding: 38,
  iterations: 300,
  spacing: 1.1, // >1 spreads nodes apart, <1 packs them
  // Attraction uses a shorter ideal length than repulsion, so a linked pair
  // settles nearer than an unlinked one. Plain FR (both = k) leaves separate
  // portal clusters indistinguishable at the handful-of-nodes scale here.
  linkLength: 0.7,
  // Holds a component together while it is simulated alone. Nothing has to be
  // held on screen any more — the components no longer share a canvas.
  gravity: 0.15,
  // Canvas side per node when a component is simulated alone: side =
  // sqrt(count) * cell, i.e. one cell of room each.
  componentCell: 78,
  // Clear space kept between two node circles, and between packed components.
  nodeGap: 20,
  relaxIterations: 120,
  // Share of the canvas the padded circles may cover before the canvas itself
  // grows. Past roughly a third, "no overlap" stops being geometrically
  // possible in a fixed box and the relaxation pass can only pick its victims.
  maxCoverage: 0.35,
};

/**
 * Drawn radius of a node. The view draws its circle from this, and the overlap
 * pass has to use the same number — so it lives here and both read it.
 */
function nodeRadius(node) {
  const tier = Number.isFinite(node && node.tier) && node.tier ? node.tier : 4;
  const degree = Number.isFinite(node && node.degree) ? node.degree : 0;
  return 9 + (tier - 3) * 1.8 + Math.min(4, degree * 0.4);
}

/** Brecilien's zone id: the catalog's if it is loaded, else the known one. */
function brecilienId() {
  return typeof BRECILIEN_ZONE_ID !== "undefined" ? BRECILIEN_ZONE_ID : "5000";
}

/** The entrance test: injected, else the shipped catalog-derived one. */
function resolveEntrancePredicate(isEntrance) {
  if (typeof isEntrance === "function") return isEntrance;
  if (typeof isBrecilienEntrance === "function") return isBrecilienEntrance;
  return () => false;
}

/** Portals may arrive as live graph objects or as plain persisted rows. */
function portalSecondsLeft(portal, now) {
  if (portal && typeof portal.secondsLeft === "function") return portal.secondsLeft(now);
  const expiresAt = Number(portal && portal.expiresAt);
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, Math.round((expiresAt - now) / 1000));
}

/**
 * @param {object} options
 * @param {Array}  options.portals     portal records (graph.all() output)
 * @param {Function} [options.zoneById] id → zone record from the static catalog
 * @param {Function} [options.isExit]  zone → true when it leaves the Roads
 * @param {number} [options.now]
 * @param {boolean} [options.includeExpired] keep lapsed portals as dead edges
 * @param {Function} [options.isEntrance] zone id → holds a Brecilien portal
 * @returns {{nodes: Array, edges: Array}}
 */
function buildRoadsGraphModel({
  portals = [],
  zoneById = () => null,
  isExit = null,
  now = Date.now(),
  includeExpired = true,
  isEntrance = null,
} = {}) {
  const nodes = new Map();
  const edges = [];

  function touch(zoneId) {
    let node = nodes.get(zoneId);
    if (node) return node;
    const zone = zoneById(zoneId) || null;
    node = {
      id: zoneId,
      name: zone && zone.name ? zone.name : zoneId,
      tier: zone && Number.isFinite(zone.tier) ? zone.tier : 0,
      type: zone ? zone.type : "other",
      // Biome caption (forest/swamp/…) from the catalog record; zones the
      // catalog does not know — and old records without the field — draw none.
      biome: zone && zone.biome ? zone.biome : null,
      isRest: !!(zone && zone.isRest),
      isExit: zone ? (isExit ? !!isExit(zone) : zone.type !== "roads") : false,
      isBrecilien: zoneId === brecilienId(),
      known: !!zone,
      chests: zone && zone.chests ? zone.chests : {},
      degree: 0,
      liveDegree: 0,
    };
    nodes.set(zoneId, node);
    return node;
  }

  for (const portal of portals) {
    if (!portal || !portal.fromZoneId || !portal.toZoneId) continue;
    const secondsLeft = portalSecondsLeft(portal, now);
    const dead = secondsLeft <= 0;
    if (dead && !includeExpired) continue;

    const source = touch(portal.fromZoneId);
    const target = touch(portal.toZoneId);
    source.degree++;
    target.degree++;
    if (!dead) { source.liveDegree++; target.liveDegree++; }

    edges.push({
      key: portal.key || `${portal.fromZoneId}|${portal.toZoneId}`,
      source: source.id,
      target: target.id,
      size: portal.size || "unknown",
      // Kept so the countdown can be refreshed without a relayout.
      expiresAt: Number(portal.expiresAt) || 0,
      secondsLeft,
      dead,
    });
  }

  // The Brecilien portal standing in the deep T8 roads (TUNNEL_DEEP only — the
  // raid roads have none). It is not a record anyone
  // entered and it never expires, so it is drawn from the catalog rather than
  // from `portals` — and only for zones already on the map, because a node no
  // portal reaches has no place to be drawn.
  const entrance = resolveEntrancePredicate(isEntrance);
  const brecilienEntranceIds = [...nodes.keys()].filter((id) => entrance(id));
  if (brecilienEntranceIds.length) {
    const city = touch(brecilienId());
    for (const id of brecilienEntranceIds) {
      // `degree` sizes the node and seeds the layout, so the static link
      // counts. `liveDegree` is the tally of entered portals still open — this
      // one was never entered and never closes, so it stays out of it.
      const source = nodes.get(id);
      source.degree++;
      city.degree++;
      edges.push({
        key: `${id}|${city.id}`,
        source: id,
        target: city.id,
        size: "raid",
        kind: "brecilien",
        directed: true,
        expiresAt: Infinity,
        secondsLeft: Infinity,
        dead: false,
      });
    }
  }

  // Busiest zones first, id as the tiebreak: seeding reads this order, so a
  // stable sort is what keeps the map from reshuffling on every repaint.
  const list = [...nodes.values()].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  edges.sort((a, b) => a.key.localeCompare(b.key));
  return { nodes: list, edges };
}

/** Undirected neighbour lists, edges pointing at unknown nodes ignored. */
function buildAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source).push(edge.target);
    adjacency.get(edge.target).push(edge.source);
  }
  return adjacency;
}

/**
 * Split the graph into connected components, biggest first. Node order inside a
 * component follows the model order (busiest zone first), so seeding stays the
 * deterministic walk it was.
 *
 * @returns {Array<{nodes: Array, edges: Array}>}
 */
function graphComponents(nodes, edges) {
  const adjacency = buildAdjacency(nodes, edges);
  const seen = new Set();
  const groups = [];
  for (const start of nodes) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    const ids = new Set([start.id]);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift();
      for (const next of adjacency.get(id) || []) {
        if (ids.has(next)) continue;
        ids.add(next);
        seen.add(next);
        queue.push(next);
      }
    }
    groups.push(ids);
  }
  return groups
    .map((ids) => ({
      nodes: nodes.filter((n) => ids.has(n.id)),
      edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.nodes[0].id.localeCompare(b.nodes[0].id));
}

/**
 * Seed order: breadth-first per component, starting at the busiest zone.
 *
 * Seeding in plain id order interleaves unrelated clusters around the ring, and
 * a symmetric start (linked pairs sitting opposite each other) is a saddle the
 * simulation cannot fall out of — the cross it produces reads as "everything is
 * connected to everything". Walking the graph puts neighbours side by side.
 */
function seedOrder(nodes, edges) {
  const adjacency = buildAdjacency(nodes, edges);
  const seen = new Set();
  const order = [];
  for (const start of nodes) {
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    const queue = [start.id];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const next of [...adjacency.get(id)].sort()) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return order.map((id) => byId.get(id));
}

/** Deterministic start: a ring in seed order, with a fixed anti-symmetry wobble. */
function seedPositions(nodes, edges, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.38;
  const ordered = seedOrder(nodes, edges);
  const n = ordered.length;
  ordered.forEach((node, i) => {
    if (n === 1) { node.x = cx; node.y = cy; return; }
    const angle = (2 * Math.PI * i) / n;
    // Alternating radii break the perfect circle, which otherwise sits in a
    // symmetric equilibrium the simulation cannot escape.
    const r = radius * (i % 2 ? 1 : 0.72);
    node.x = cx + Math.cos(angle) * r;
    node.y = cy + Math.sin(angle) * r;
  });
}

function fitToBox(nodes, { width, height, padding }) {
  if (!nodes.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const boxW = Math.max(1, width - padding * 2);
  const boxH = Math.max(1, height - padding * 2);
  // One scale for both axes so the graph is not stretched into a smear.
  const scale = Math.min(boxW / spanX, boxH / spanY);
  const offsetX = padding + (boxW - spanX * scale) / 2;
  const offsetY = padding + (boxH - spanY * scale) / 2;
  for (const node of nodes) {
    node.x = offsetX + (node.x - minX) * scale;
    node.y = offsetY + (node.y - minY) * scale;
  }
}

/**
 * Fruchterman-Reingold with centre gravity, over ONE component in its own
 * square canvas. Node count here is tens, not thousands (one client's recorded
 * portals), so the O(n²) repulsion is fine and no quadtree is warranted.
 *
 * Positions are written onto the nodes in place.
 */
function simulateComponent(nodes, edges, opts, width, height) {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  seedPositions(nodes, edges, width, height);
  if (nodes.length === 1) return;

  const area = width * height;
  const k = Math.sqrt(area / nodes.length) * opts.spacing;
  const linkK = Math.max(1, k * opts.linkLength);
  const cx = width / 2;
  const cy = height / 2;
  let temperature = Math.min(width, height) * 0.12;
  const cooling = temperature / (opts.iterations + 1);

  const dx = new Float64Array(nodes.length);
  const dy = new Float64Array(nodes.length);

  for (let step = 0; step < opts.iterations; step++) {
    dx.fill(0); dy.fill(0);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let vx = nodes[i].x - nodes[j].x;
        let vy = nodes[i].y - nodes[j].y;
        let dist = Math.hypot(vx, vy);
        if (dist < 0.01) { // exactly-coincident nodes: nudge along the index
          vx = (i - j) * 0.01 || 0.01; vy = 0.01; dist = Math.hypot(vx, vy);
        }
        const force = (k * k) / dist;
        const fx = (vx / dist) * force;
        const fy = (vy / dist) * force;
        dx[i] += fx; dy[i] += fy;
        dx[j] -= fx; dy[j] -= fy;
      }
    }

    for (const edge of edges) {
      const a = index.get(edge.source);
      const b = index.get(edge.target);
      if (a === undefined || b === undefined || a === b) continue;
      const vx = nodes[a].x - nodes[b].x;
      const vy = nodes[a].y - nodes[b].y;
      const dist = Math.max(0.01, Math.hypot(vx, vy));
      // Expired portals still pull, but weakly — they are history, not routes.
      const weight = edge.dead ? 0.35 : 1;
      const force = ((dist * dist) / linkK) * weight;
      const fx = (vx / dist) * force;
      const fy = (vy / dist) * force;
      dx[a] -= fx; dy[a] -= fy;
      dx[b] += fx; dy[b] += fy;
    }

    for (let i = 0; i < nodes.length; i++) {
      dx[i] += (cx - nodes[i].x) * opts.gravity * k * 0.05;
      dy[i] += (cy - nodes[i].y) * opts.gravity * k * 0.05;

      const disp = Math.hypot(dx[i], dy[i]) || 1;
      const capped = Math.min(disp, temperature);
      nodes[i].x += (dx[i] / disp) * capped;
      nodes[i].y += (dy[i] / disp) * capped;
    }

    temperature = Math.max(0.1, temperature - cooling);
  }
}

/** Bounding box of a set of positioned nodes. */
function boundsOf(nodes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Shelf-pack the components' bounding boxes, biggest first, wrapping to a new
 * row once a row is as wide as the target aspect wants. Boxes never overlap, so
 * two clusters can no longer be drawn on top of each other.
 */
function packComponents(components, opts) {
  const boxes = components.map((component) => {
    const bounds = boundsOf(component.nodes);
    return { component, bounds, width: bounds.width + opts.nodeGap, height: bounds.height + opts.nodeGap };
  });
  const totalArea = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
  const aspect = opts.height > 0 ? opts.width / opts.height : 1;
  const rowLimit = Math.max(
    boxes.reduce((widest, box) => Math.max(widest, box.width), 0),
    Math.sqrt(Math.max(1, totalArea) * aspect),
  );

  let rowX = 0, rowY = 0, rowHeight = 0;
  for (const box of boxes) {
    if (rowX > 0 && rowX + box.width > rowLimit) {
      rowX = 0;
      rowY += rowHeight + opts.nodeGap;
      rowHeight = 0;
    }
    // Move the component from wherever it settled to this shelf slot.
    const shiftX = rowX - box.bounds.minX;
    const shiftY = rowY - box.bounds.minY;
    for (const node of box.component.nodes) {
      node.x += shiftX;
      node.y += shiftY;
    }
    rowX += box.width + opts.nodeGap;
    rowHeight = Math.max(rowHeight, box.height);
  }
}

/**
 * Push apart every pair of circles closer than `r(a) + r(b) + gap`, half the
 * deficit each, clamped to the padded box. Runs on the FINAL coordinates —
 * fitToBox scales the drawing, and a gap enforced before that scaling would be
 * shrunk right back.
 *
 * Fixed pair order, no RNG: same input, same output.
 */
function relaxOverlaps(nodes, opts) {
  const radii = nodes.map((node) => nodeRadius(node));
  const minX = opts.padding, maxX = Math.max(opts.padding, opts.width - opts.padding);
  const minY = opts.padding, maxY = Math.max(opts.padding, opts.height - opts.padding);

  for (let step = 0; step < opts.relaxIterations; step++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const want = radii[i] + radii[j] + opts.nodeGap;
        let vx = nodes[i].x - nodes[j].x;
        let vy = nodes[i].y - nodes[j].y;
        let dist = Math.hypot(vx, vy);
        if (dist >= want) continue;
        if (dist < 0.01) { // stacked exactly: separate along the index
          vx = (i - j) * 0.01 || 0.01; vy = 0.01; dist = Math.hypot(vx, vy);
        }
        const push = (want - dist) / 2;
        const fx = (vx / dist) * push;
        const fy = (vy / dist) * push;
        nodes[i].x += fx; nodes[i].y += fy;
        nodes[j].x -= fx; nodes[j].y -= fy;
        moved = true;
      }
    }
    for (const node of nodes) {
      node.x = Math.min(maxX, Math.max(minX, node.x));
      node.y = Math.min(maxY, Math.max(minY, node.y));
    }
    if (!moved) break;
  }
}

/**
 * Canvas big enough for these nodes. Below `maxCoverage` it is the box the
 * caller asked for; above it, the same box grown by the same factor on both
 * axes — a map with hundreds of portals draws larger and the view zooms out to
 * it, rather than stacking circles that cannot fit.
 */
function canvasFor(nodes, opts) {
  const needed = nodes.reduce((sum, node) => {
    const r = nodeRadius(node) + opts.nodeGap / 2;
    return sum + Math.PI * r * r;
  }, 0);
  const usable = Math.max(1, (opts.width - opts.padding * 2) * (opts.height - opts.padding * 2));
  const grow = Math.sqrt(needed / (usable * opts.maxCoverage));
  if (!(grow > 1)) return { width: opts.width, height: opts.height };
  return { width: Math.round(opts.width * grow), height: Math.round(opts.height * grow) };
}

/**
 * Place every node: components simulated apart, packed, fitted to the canvas,
 * then de-overlapped.
 *
 * @returns {{nodes: Array, edges: Array, width: number, height: number}}
 */
function layoutRoadsGraph(model, options = {}) {
  const opts = { ...ROADS_LAYOUT_DEFAULTS, ...options };
  const nodes = (model && model.nodes ? model.nodes : []).map((n) => ({ ...n }));
  const edges = model && model.edges ? model.edges : [];
  const box = { nodes, edges, width: opts.width, height: opts.height };
  if (!nodes.length) return box;
  if (nodes.length === 1) {
    nodes[0].x = opts.width / 2;
    nodes[0].y = opts.height / 2;
    return box;
  }

  // A crowded map draws on a bigger canvas instead of stacking circles.
  const canvas = canvasFor(nodes, opts);
  opts.width = canvas.width;
  opts.height = canvas.height;
  box.width = canvas.width;
  box.height = canvas.height;

  const components = graphComponents(nodes, edges);
  for (const component of components) {
    // Square canvas of one cell per node: enough room for the simulation to
    // spread, small enough that a two-node cluster is not a smear.
    const side = Math.max(160, Math.sqrt(component.nodes.length) * opts.componentCell);
    simulateComponent(component.nodes, component.edges, opts, side, side);
  }
  packComponents(components, opts);
  fitToBox(nodes, opts);
  relaxOverlaps(nodes, opts);

  for (const node of nodes) {
    node.x = Math.round(node.x * 100) / 100;
    node.y = Math.round(node.y * 100) / 100;
  }
  return box;
}

/** Edge list as {from,to} pairs for a route's zone path — used to highlight. */
function routeEdgeKeys(zoneIds = []) {
  const pairs = [];
  for (let i = 1; i < zoneIds.length; i++) pairs.push([zoneIds[i - 1], zoneIds[i]]);
  return routeEdgeKeysFromPairs(pairs);
}

/**
 * Same keys from explicit pairs. A hybrid route runs partly on foot, and those
 * zones are not on this map at all — consecutive entries in its zone path can
 * be a run rather than a portal, so the caller hands over the portal pairs and
 * nothing is invented in between.
 */
function routeEdgeKeysFromPairs(pairs = []) {
  const keys = new Set();
  for (const pair of pairs) {
    if (!pair || pair.length < 2) continue;
    const [a, b] = pair;
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildRoadsGraphModel,
    layoutRoadsGraph,
    routeEdgeKeys,
    routeEdgeKeysFromPairs,
    fitToBox,
    graphComponents,
    relaxOverlaps,
    nodeRadius,
    ROADS_LAYOUT_DEFAULTS,
  };
}
