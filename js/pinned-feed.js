// Pinned feed tiers for the breeding table's food cells. A food-mode price
// edit used to persist only a price override on (tier, city) plus a city
// force — never the chosen tier itself — so findCheapestFeed re-ranked the
// whole category on every recompute and the next cheapest tier displaced the
// user's pick ("food price doesn't pin, it just switches to next cheapest").
// This module persists that pick: one tier id per food category ("plants",
// "meat", "chocolate", "mounts"), written by the commit path in js/app.js and
// consulted by findCheapestFeed ahead of its ranking.
const PINNED_FEEDS_KEY = "pinnedFeeds";

const PinnedFeed = {
  /** Pinned tier id for a food category, or null. */
  get(category) {
    const map = readMap();
    return map[category] || null;
  },

  set(category, tierId) {
    if (!category || !tierId) return;
    const map = readMap();
    map[category] = tierId;
    writeMap(map);
  },

  /** Drops a category's pin. Returns true when a pin was actually removed. */
  clear(category) {
    const map = readMap();
    if (!Object.prototype.hasOwnProperty.call(map, category)) return false;
    delete map[category];
    writeMap(map);
    return true;
  },
};

function readMap() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(PINNED_FEEDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PINNED_FEEDS_KEY, JSON.stringify(map));
  } catch {
    // Storage full or blocked — the pin just won't survive a restart.
  }
}
