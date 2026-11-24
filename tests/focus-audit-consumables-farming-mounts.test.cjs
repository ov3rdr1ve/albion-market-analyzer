/**
 * Focus audit — Consumables (cook/brew + chain rows: butcher, mill, fish sauce),
 * Pasture (eggs/milk chain rows), Farming, and Breeding & Mounts.
 *
 * One global "Use Focus" checkbox drives every table. For each table that has a
 * focus effect or a Profit / 10k Focus column, three rules:
 *
 *   1. Profit / 10k Focus is the focus-ON value and never moves with the
 *      checkbox — checked both ways (render OFF then ON, and ON then OFF), with
 *      the zones split (royal / Caerleon sections) and merged (Black/Red Zone
 *      routes on, one row per item).
 *   2. Focus-on profit includes only focus effects whose focus is billed in
 *      `focusCost`: no free effect that costs no focus, and no billed focus
 *      without its effect.
 *   3. Focus-off profit, materials and cost are fully unfocused: no focus RRR,
 *      watering, nurture or focused return rate leaks in.
 *
 * Black-box: the REAL renderers run against synthetic market data with the DOM
 * checkboxes stubbed. Only the presentation seam (table writer, cell helpers)
 * is stubbed. No live API, no network.
 *
 * Run: node --test tests/focus-audit-consumables-farming-mounts.test.cjs
 */

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const J = (f) => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const EPS = 1e-6;
const near = (a, b, eps = EPS) => Math.abs(a - b) <= Math.max(eps, Math.abs(b) * 1e-9);
const ALL = ["Caerleon", "Lymhurst", "Fort Sterling", "Thetford", "Martlock", "Bridgewatch", "Brecilien"];
const barPlays = (focus) => (focus > 10000 ? 10000 / focus : Math.floor(10000 / focus));

const COMMON_STUBS = `
const _els = {
  "use-focus": { checked: true },
  "premium-account": { checked: true },
  "include-caerleon": { checked: false },
};
const document = { getElementById: (id) => _els[id] || null, addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const window = { addEventListener: () => {} };
function renderTableData(id, rows, fmt) { tableState[id].data = rows; tableState[id].html = rows.map((r,i)=>{ try { return fmt(r,i); } catch(e){ return "ERR:"+e.message; } }); }
function priceTd(p){ return "<td>"+p+"</td>"; }
function volTd(){ return "<td></td>"; }
function profitTd(){ return "<td></td>"; }
function pureProfitTd(){ return "<td></td>"; }
function aggregateCostTd(c){ return "<td>"+c+"</td>"; }
function matPriceSpan(id, c, p){ return "<span>"+p+"</span>"; }
function addTdForKey(){ return '<td class="cell-add"></td>'; }
function getRowKey(row){ return (row.item && (row.item.id || row.item.babyId)) + "|" + (row.section || ""); }
function getProfitClass(){ return ""; }
function dispName(id, name){ return name || id; }
function tx(en){ return en; }
function focusSpecMark(){ return ""; }
function focusSpecTitle(){ return ""; }
function getItemDisplayName(id){ return id; }
const ITEM_NAMES_MAP = {};
let lastMpMarketData = null, lastMarketData = null;
const ROYAL_CITIES = ["Lymhurst","Fort Sterling","Thetford","Martlock","Bridgewatch","Brecilien"];
const CITIES = ["Caerleon", ...ROYAL_CITIES];
const BLACK_ZONE_CITIES = ["Smuggler's Den"];
const CRAFT_CITIES = ["Caerleon", ...ROYAL_CITIES];
const SELL_CITIES = [...CITIES, "Black Market"];
const CRAFTING_ITEMS = [], FLIPPING_ITEMS = [], TRANSPORT_ITEMS = [], FARMING_ITEMS = [], ARTIFACT_FLIP_ITEMS = [], GEAR_CAPES = [];
`;

function compile(name, extraStubs, files, exportsExpr) {
  const mod = new Module(name);
  mod._compile(
    COMMON_STUBS + extraStubs + files.map(J).join("\n") + `\nmodule.exports = ${exportsExpr};`,
    `${name}.js`,
  );
  return mod.exports;
}

const put = (md, id, c, b, s, v = 9999) => { (md[id] = md[id] || {})[c] = { buy_price: b, sell_price: s, volume_24h: v }; };

// Render with the given checkbox / zone state; snapshot the rows.
function renderWith(X, fn, tableId, md, { focus, merged }) {
  X._els["use-focus"].checked = focus;
  X._els["include-caerleon"].checked = merged;
  fn(md);
  return X.tableState[tableId].data.slice();
}

const MODES = [
  { label: "sections", merged: false },
  { label: "merged (BZ routes)", merged: true },
];
const ORDERS = [
  { label: "off→on", first: false },
  { label: "on→off", first: true },
];

// ════════════════════════════════════════════════════════════════════════════
// CONSUMABLES (cook/brew rows + chain rows: butcher, mill, pasture, fish sauce)
// ════════════════════════════════════════════════════════════════════════════

const C = compile(
  "focus-audit-consumables",
  `
const recipeCache = {};
const expandedCraftItems = new Set();
const tableState = { "consumable-table": { data: [] } };
function renderConsumableIngredients(){ return ""; }
function renderChainBreakdown(){ return ""; }
`,
  [
    "route-cell.js", "focus-play.js", "data-faction-fp-costs.js", "focus-costs.js",
    "data-mounts.js", "data-consumables.js", "data-enchant-sauces.js", "data-farming.js",
    "recipes.js", "recipe-resolver.js", "chain-recipes.js", "pasture-econ.js",
    "chain-pricing.js", "data-city-bonuses.js", "calculations.js", "calculations-margins.js", "travel-cost.js",
    "mp-bonus.js", "utils.js", "utils-item-ids.js", "utils-overrides.js", "utils-focus-fees.js",
    "render-mounts.js", "render-mounts-breeding-row.js", "render-mounts-craft-row.js",
    "consumable-pasture-row.js", "render-consumable-chain-row.js",
    "render-consumable-no-data-row.js", "consumable-flip-row.js",
    "consumable-enchant-variants.js", "consumable-city-pick.js", "render-consumables.js", "render-consumables-row.js",
  ],
  "{ tableState, renderConsumableTable, _els, SETUP_FEE, getRecipeOutput }",
);

// Prices are chosen so the merged (Black/Red Zone) mode has a real decision to
// flip: Caerleon's ingredients are a little cheaper, the royal side has the
// better return rate (Brecilien potion spec, Fort Sterling mutton butcher spec).
// Which side wins then depends on whether focus is on — the RRR gap narrows in
// relative terms once +59% focus is added.
function consumablesMarket() {
  const md = {};
  ALL.forEach((c) => {
    const caer = c === "Caerleon";
    put(md, "T3_COMFREY", c, caer ? 271 : 300, caer ? 281 : 320);
    put(md, "T3_POTION_STONESKIN", c, 900, 1000);
    put(md, "T6_FARM_SHEEP_GROWN", c, caer ? 82560 : 86000, 88000);
    put(md, "T6_MEAT", c, 6500, 6800);
    put(md, "T3_WHEAT", c, 60, 70);
    put(md, "T3_FLOUR", c, 150, 160);
    put(md, "T4_TURNIP", c, 100, 110);
    put(md, "T4_MILK", c, 400, 420);
    put(md, "T4_FARM_GOAT_GROWN", c, 250000, 251000);
    put(md, "T1_FISH_FRESHWATER_ALL_COMMON", c, 50, 55);
    put(md, "T1_FISHCHOPS", c, 70, 80);
    put(md, "T1_SEAWEED", c, 20, 25);
    put(md, "T1_FISHSAUCE_LEVEL1", c, 1900, 2000);
  });
  return md;
}

const cKey = (r) => `${r.item && r.item.id}|${r.isChainCraft ? "chain" : r.isFlip ? "flip" : "craft"}|${r.section || ""}`;
const cValued = (r) => r && r.item && !r.isFlip && r.marginInfo && r.marginInfo.margin !== -1;
// Priced both ways round: an input with no listing costs 0, and a free input
// has nothing for a return rate to hand back (e.g. T3 meat with no chicken).
const cPriced = (r) => cValued(r) && r.totalInputCost > 0 && r.sellPot && r.sellPot.price > 0;
const cRender = (state) => renderWith(C, C.renderConsumableTable, "consumable-table", consumablesMarket(), state);
const AUDITED_C = ["T3_POTION_STONESKIN", "T6_MEAT", "T3_FLOUR", "T4_MILK", "T1_FISHSAUCE_LEVEL1", "T1_FISHCHOPS"];

MODES.forEach((mode) => {
  test(`consumables [${mode.label}] fixture sanity: every audited item values a row`, () => {
    const rows = cRender({ focus: true, merged: mode.merged });
    AUDITED_C.forEach((id) => {
      assert.ok(rows.some((r) => r.item && r.item.id === id && cValued(r)), `${id}: no valued row`);
    });
  });

  ORDERS.forEach((order) => {
    test(`consumables [${mode.label}] rule 1 (${order.label}): Profit / 10k Focus does not move`, () => {
      const a = cRender({ focus: order.first, merged: mode.merged });
      const b = cRender({ focus: !order.first, merged: mode.merged });
      const A = new Map(a.map((r) => [cKey(r), r]));
      let compared = 0;
      b.forEach((r) => {
        const o = A.get(cKey(r));
        if (!o || !AUDITED_C.includes(r.item && r.item.id)) return;
        if (o.profitPer10kFocus == null && r.profitPer10kFocus == null) return;
        compared++;
        assert.ok(near(o.profitPer10kFocus || 0, r.profitPer10kFocus || 0),
          `${cKey(r)}: per-10k moved ${o.profitPer10kFocus} → ${r.profitPer10kFocus}`);
        assert.ok(near(o.profitFocusOn || 0, r.profitFocusOn || 0),
          `${cKey(r)}: focus-on operand moved ${o.profitFocusOn} → ${r.profitFocusOn}`);
      });
      assert.ok(compared >= AUDITED_C.length, `only ${compared} rows compared`);
    });
  });

  test(`consumables [${mode.label}] rule 2: focus-on profit carries exactly the billed focus effect`, () => {
    const on = cRender({ focus: true, merged: mode.merged }).filter(cPriced);
    const off = new Map(cRender({ focus: false, merged: mode.merged }).map((r) => [cKey(r), r]));
    let compared = 0;
    on.forEach((r) => {
      const o = off.get(cKey(r));
      const focusCost = r.focusCost || 0;
      if (!r.isChainCraft) {
        // Cook/brew: the operand IS the focus-on headline; the RRR moves only
        // when focus is billed.
        assert.ok(near(r.profitFocusOn, r.marginInfo.profit), `${cKey(r)}: profitFocusOn ≠ focus-on profit`);
        if (focusCost > 0) assert.ok(r.focusRrr > r.baseRrr + EPS, `${cKey(r)}: focus billed, no RRR gained`);
        else assert.ok(near(r.focusRrr, r.baseRrr) && near(r.rrr, r.baseRrr), `${cKey(r)}: free RRR with no focus`);
      } else {
        const perOut = r.effectiveOutput || 0;
        if (r.chainStation !== "pasture" && focusCost > 0) {
          assert.ok(near(r.profitFocusOn, r.marginInfo.profit * perOut, 1e-4),
            `${cKey(r)}: profitFocusOn ≠ focus-on batch`);
          assert.ok(r.chainRrr > r.baseRrr + EPS, `${cKey(r)}: focus billed, no RRR gained`);
        } else {
          assert.ok(near(r.chainRrr || 0, r.baseRrr || 0), `${cKey(r)}: free RRR with no focus`);
          assert.ok(!(r.profitPer10kFocus > 0), `${cKey(r)}: per-10k figure with no focus billed`);
        }
      }
      // Same route both ways: the profit gap is exactly the billed play.
      if (!o || !cValued(o) || o.craftCity !== r.craftCity || o.sellPot?.city !== r.sellPot?.city) return;
      compared++;
      const gap = r.marginInfo.profit - o.marginInfo.profit;
      const play = focusCost > 0
        ? (r.isChainCraft ? r.focusProfitPerOutput : (r.bestFocusPlay ? r.bestFocusPlay.profitDelta : 0))
        : 0;
      assert.ok(near(gap, play, 1e-4), `${cKey(r)}: on−off ${gap} ≠ billed play ${play}`);
      if (focusCost > 0) assert.ok(gap > EPS, `${cKey(r)}: focus billed but profit unchanged`);
    });
    assert.ok(compared > 0, "no same-route pairs compared");
  });

  test(`consumables [${mode.label}] rule 3: focus-off rows are fully unfocused`, () => {
    const off = cRender({ focus: false, merged: mode.merged }).filter(cPriced);
    off.forEach((r) => {
      if (!r.isChainCraft) {
        assert.ok(near(r.rrr, r.baseRrr), `${cKey(r)}: rrr ${r.rrr} ≠ base ${r.baseRrr}`);
        // Cost rebuilt from the row's own ingredients at the BASE return rate.
        const out = C.getRecipeOutput(r.item.id);
        let cost = 0;
        r.recipe.forEach((m) => {
          const eff = (m.noReturn ? m.count : m.count * (1 - r.baseRrr)) / out;
          cost += r.matBestPrices[m.matId].price * eff * (1 + C.SETUP_FEE);
        });
        cost += r.brecilienFee || 0;
        assert.ok(near(r.totalInputCost, cost, 1e-6), `${cKey(r)}: cost ${r.totalInputCost} ≠ unfocused ${cost}`);
      } else {
        assert.ok(near(r.chainRrr || 0, r.baseRrr || 0), `${cKey(r)}: chainRrr ${r.chainRrr} ≠ base ${r.baseRrr}`);
        const chain = r.chainSourcing.chain;
        if (r.chainStation === "butcher") {
          assert.ok(near(r.effectiveOutput, chain.output * (1 + r.baseRrr)),
            `${cKey(r)}: butcher output uses a focused RRR`);
        }
      }
    });
  });
});

test("consumables [merged] fixture sanity: the focus toggle really flips the displayed route", () => {
  const on = new Map(cRender({ focus: true, merged: true }).map((r) => [cKey(r), r]));
  const off = cRender({ focus: false, merged: true });
  const flipped = off.filter((r) => {
    const o = on.get(cKey(r));
    return o && cValued(o) && cValued(r) && o.craftCity !== r.craftCity;
  }).map(cKey);
  assert.ok(flipped.some((k) => k.startsWith("T3_POTION_STONESKIN|craft")), `cook row did not flip: ${flipped}`);
  assert.ok(flipped.some((k) => k.startsWith("T6_MEAT|chain")), `butcher row did not flip: ${flipped}`);
});

test("pasture rows: no focus billed, no focus effect, identical both ways", () => {
  [false, true].forEach((merged) => {
    const on = cRender({ focus: true, merged }).filter((r) => r.chainStation === "pasture" && cValued(r));
    const off = new Map(cRender({ focus: false, merged }).map((r) => [cKey(r), r]));
    assert.ok(on.length > 0, "no pasture row");
    on.forEach((r) => {
      const o = off.get(cKey(r));
      assert.strictEqual(r.focusCost, 0, `${cKey(r)}: pasture bills focus`);
      assert.ok(!(r.profitPer10kFocus > 0), `${cKey(r)}: pasture shows a per-10k figure`);
      assert.ok(near(r.marginInfo.profit, o.marginInfo.profit), `${cKey(r)}: profit moved with the checkbox`);
      assert.ok(near(r.effectiveOutput, o.effectiveOutput), `${cKey(r)}: produce moved with the checkbox`);
      assert.ok(near(r.totalInputCost, o.totalInputCost), `${cKey(r)}: cost moved with the checkbox`);
    });
  });
});

test("consumables: no row template threw", () => {
  [false, true].forEach((focus) => [false, true].forEach((merged) => {
    cRender({ focus, merged });
    const bad = (C.tableState["consumable-table"].html || []).filter((h) => String(h).startsWith("ERR:"));
    assert.deepStrictEqual(bad, []);
  }));
});

// ════════════════════════════════════════════════════════════════════════════
// FARMING
// ════════════════════════════════════════════════════════════════════════════

const F = compile(
  "focus-audit-farming",
  `
const tableState = { "farming-table": { data: [], html: [] } };
function focusPlayCell() { return "<td></td>"; }
`,
  [
    "data-city-bonuses.js", "calculations.js", "calculations-margins.js", "travel-cost.js", "mp-bonus.js", "utils.js", "utils-item-ids.js", "utils-overrides.js", "utils-focus-fees.js",
    "focus-play.js", "focus-costs.js", "data-farming.js", "farming-row-econ.js", "render-farming.js",
  ],
  "{ tableState, renderFarmingTable, _els, FARMING_PRODUCTION }",
);

// Seeds and crops for a crop and a herb at two tiers each, plus the pasture
// feed/produce for two byproduct rows. Caerleon is slightly different so the
// merged pool has a choice of farm city.
const FARM_IDS = ["T3_FARM_WHEAT_SEED", "T6_FARM_POTATO_SEED", "T3_FARM_COMFREY_SEED", "T7_FARM_MULLEIN_SEED", "T3_WHEAT", "T4_TURNIP"];
function farmingMarket() {
  const md = {};
  ALL.forEach((c) => {
    const k = c === "Caerleon" ? 0.97 : 1;
    put(md, "T3_FARM_WHEAT_SEED", c, 900 * k, 950);
    put(md, "T3_WHEAT", c, 60, 70);
    put(md, "T6_FARM_POTATO_SEED", c, 9000 * k, 9500);
    put(md, "T6_POTATO", c, 400, 420);
    put(md, "T3_FARM_COMFREY_SEED", c, 1000 * k, 1100);
    put(md, "T3_COMFREY", c, 120, 130);
    put(md, "T7_FARM_MULLEIN_SEED", c, 30000 * k, 32000);
    put(md, "T7_MULLEIN", c, 1500, 1600);
    put(md, "T4_TURNIP", c, 100 * k, 110);
    put(md, "T4_MILK", c, 400, 420);
    put(md, "T4_FARM_GOAT_GROWN", c, 250000, 251000);
    put(md, "T3_EGG", c, 300, 320);
    put(md, "T3_FARM_CHICKEN_GROWN", c, 40000, 41000);
    put(md, "T1_WORM", c, 200, 220);
  });
  return md;
}
const fKey = (r) => `${r.item && r.item.id}|${r.item && r.item.outputId}|${r.section || ""}`;
const fRender = (state) => renderWith(F, F.renderFarmingTable, "farming-table", farmingMarket(), state);
const fAudited = (r) => r && r.item && FARM_IDS.includes(r.item.id) && r.seedPriced;

MODES.forEach((mode) => {
  ORDERS.forEach((order) => {
    test(`farming [${mode.label}] rule 1 (${order.label}): Profit / 10k Focus does not move`, () => {
      const a = new Map(fRender({ focus: order.first, merged: mode.merged }).map((r) => [fKey(r), r]));
      const b = fRender({ focus: !order.first, merged: mode.merged }).filter(fAudited);
      let compared = 0, moved = 0;
      b.forEach((r) => {
        const o = a.get(fKey(r));
        if (!o) return;
        compared++;
        if (!near(o.profitPerCycle, r.profitPerCycle)) moved++;
        assert.ok(near(o.profitPer10kFocus, r.profitPer10kFocus),
          `${fKey(r)}: per-10k moved ${o.profitPer10kFocus} → ${r.profitPer10kFocus}`);
        assert.ok(near(o.profitFocusOn, r.profitFocusOn), `${fKey(r)}: focus-on operand moved`);
        assert.strictEqual(o.focusCost, r.focusCost, `${fKey(r)}: focus cost moved`);
      });
      assert.ok(compared >= 6, `only ${compared} rows compared`);
      assert.ok(moved > 0, "fixture sanity: no displayed profit reacted to the checkbox");
    });
  });

  test(`farming [${mode.label}] rule 2: watered profit is billed the watering focus; pastures bill nothing`, () => {
    const on = fRender({ focus: true, merged: mode.merged }).filter(fAudited);
    const off = new Map(fRender({ focus: false, merged: mode.merged }).map((r) => [fKey(r), r]));
    assert.ok(on.length >= 6);
    on.forEach((r) => {
      const o = off.get(fKey(r));
      if (r.item.type === "byproduct") {
        assert.strictEqual(r.focusCost, 0, `${fKey(r)}: pasture bills focus`);
        assert.ok(!r.profitPer10kFocus, `${fKey(r)}: pasture shows a per-10k figure`);
        assert.ok(near(r.profitPerCycle, o.profitPerCycle), `${fKey(r)}: free focus effect on a pasture`);
        return;
      }
      assert.ok(near(r.focusCost, r.focusPerSeed * r.seedSlots), `${fKey(r)}: billed ≠ one watering per slot`);
      assert.ok(near(r.profitFocusOn, r.profitPerCycle), `${fKey(r)}: focus-on operand ≠ watered cycle`);
      assert.ok(near(r.profitPer10kFocus, r.profitFocusOn * barPlays(r.focusCost)), `${fKey(r)}: per-10k arithmetic`);
      if (o.farmCity === r.farmCity) {
        const gap = r.profitPerCycle - o.profitPerCycle;
        assert.ok(near(gap, r.bestFocusPlay.profitDelta, 1e-4), `${fKey(r)}: on−off ${gap} ≠ watering play`);
        assert.ok(gap > EPS, `${fKey(r)}: watering billed but changed nothing`);
      }
    });
  });

  test(`farming [${mode.label}] rule 3: focus-off rows are dry`, () => {
    const off = fRender({ focus: false, merged: mode.merged }).filter(fAudited);
    off.forEach((r) => {
      assert.strictEqual(r.focusProfitPerOutput, 0, `${fKey(r)}: focus delta in the headline`);
      if (r.item.type === "byproduct") return;
      assert.ok(near(r.totalSeedYield, r.item.baseSeedYield), `${fKey(r)}: seed yield ${r.totalSeedYield} is watered`);
      assert.ok(near(r.seedYieldShown, r.item.baseSeedYield), `${fKey(r)}: shown seed yield is watered`);
      assert.ok(near(r.profitPerCycle, r.profitFocusOn - r.bestFocusPlay.profitDelta, 1e-4),
        `${fKey(r)}: dry cycle ≠ watered − watering play`);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BREEDING & MOUNTS
// ════════════════════════════════════════════════════════════════════════════

const M = compile(
  "focus-audit-mounts",
  `
const tableState = { "mounts-table": { data: [] }, "faction-spending-table": { data: [] } };
const CONSUMABLES = [];
`,
  [
    "focus-play.js", "data-faction-fp-costs.js", "focus-costs.js", "data-mounts.js",
    "data-city-bonuses.js", "calculations.js", "calculations-margins.js", "travel-cost.js", "mp-bonus.js", "utils.js", "utils-item-ids.js", "utils-overrides.js", "utils-focus-fees.js",
    "rrr-eligible.js", "render-mounts.js", "render-mounts-breeding-row.js", "render-mounts-craft-row.js",
  ],
  "{ tableState, renderMountsTable, _els, SETUP_FEE, PREMIUM_TAX, isRrrEligible, getFocusCost, getTierFromId }",
);

// T8 Riding Horse: a breeding row (baby → grown → saddled with 20x leather)
// and a craft row (grown horse + 20x leather). Caerleon's leather is dearer and
// its grown horse cheaper, so in merged mode the craft city a row settles on
// depends on how much of the leather the return rate hands back.
const BABY = "T8_FARM_HORSE_BABY";
function mountsMarket() {
  const md = {};
  ALL.forEach((c) => {
    const caer = c === "Caerleon";
    put(md, BABY, c, 60000, 65000, 500);
    put(md, "T8_FARM_HORSE_GROWN", c, caer ? 58000 : 100000, 110000, 500);
    put(md, "T8_LEATHER", c, caer ? 12000 : 9000, 9500, 5000);
    put(md, "T8_MOUNT_HORSE", c, 380000, 420000, 500);
    put(md, "T3_WHEAT", c, 100, 110, 5000);
  });
  return md;
}
const mKey = (r) => `${(r.item && (r.item.id || r.item.babyId)) || "?"}|${r.isCraft ? "craft" : "breed"}|${r.section || ""}`;
const mRender = (state) => renderWith(M, M.renderMountsTable, "mounts-table", mountsMarket(), state);
const isHorseBreed = (r) => !r.isCraft && r.item && r.item.babyId === BABY && r.marginInfo && r.marginInfo.margin !== -1;
const isHorseCraft = (r) => r.isCraft && r.item && r.item.id === "T8_MOUNT_HORSE" && r.marginInfo && r.marginInfo.margin !== -1;
const mAudited = (r) => isHorseBreed(r) || isHorseCraft(r);

MODES.forEach((mode) => {
  ORDERS.forEach((order) => {
    test(`mounts [${mode.label}] rule 1 (${order.label}): Profit / 10k Focus does not move`, () => {
      const a = new Map(mRender({ focus: order.first, merged: mode.merged }).map((r) => [mKey(r), r]));
      const b = mRender({ focus: !order.first, merged: mode.merged }).filter(mAudited);
      let breeds = 0, crafts = 0;
      b.forEach((r) => {
        const o = a.get(mKey(r));
        if (!o) return;
        if (r.isCraft) crafts++; else breeds++;
        assert.ok(near(o.profitPer10kFocus || 0, r.profitPer10kFocus || 0),
          `${mKey(r)}: per-10k moved ${o.profitPer10kFocus} → ${r.profitPer10kFocus}`);
        assert.ok(near(o.profitFocusOn || 0, r.profitFocusOn || 0), `${mKey(r)}: focus-on operand moved`);
        if (!r.isCraft) {
          assert.ok(near(o.profitPer10kFocusSelfFound || 0, r.profitPer10kFocusSelfFound || 0),
            `${mKey(r)}: self-found per-10k moved`);
        }
      });
      assert.ok(breeds > 0 && crafts > 0, `compared ${breeds} breeding / ${crafts} craft rows`);
    });
  });

  test(`mounts [${mode.label}] rule 2: crafts — focus-on profit carries exactly the billed craft focus`, () => {
    const on = mRender({ focus: true, merged: mode.merged }).filter(isHorseCraft);
    const off = new Map(mRender({ focus: false, merged: mode.merged }).map((r) => [mKey(r), r]));
    assert.ok(on.length > 0);
    on.forEach((r) => {
      assert.ok(r.focusCost > 0, `${mKey(r)}: no craft focus`);
      assert.ok(near(r.profitFocusOn, r.marginInfo.profit), `${mKey(r)}: operand ≠ focus-on profit`);
      assert.ok(r.focusRrr > r.baseRrr + EPS && near(r.rrr, r.focusRrr), `${mKey(r)}: billed focus without its RRR`);
      const o = off.get(mKey(r));
      if (o && o.craftCity === r.craftCity && o.sellPot.city === r.sellPot.city) {
        assert.ok(near(r.marginInfo.profit - o.marginInfo.profit, r.bestFocusPlay.profitDelta, 1e-4),
          `${mKey(r)}: on−off ≠ the craft play`);
      }
    });
  });

  // A breeding row's focus-on figure may hold the NURTURE play (billed as
  // meta.totalNurtureFocus) and, if it saddles, the SADDLER craft's focus-on
  // return rate. Each effect it holds must be paid for in the focus the bar is
  // divided by, and each focus it pays must buy its effect.
  //
  // The bar bills nurture focus only, so the operand holds the nurture play
  // alone, with the saddler at its base rate (decided with the owner on #7).
  test(`mounts [${mode.label}] rule 2: breeding — every focus effect in the operand is billed`, () => {
    const on = mRender({ focus: true, merged: mode.merged }).filter(isHorseBreed);
    assert.ok(on.length > 0);
    on.forEach((r) => {
      assert.ok(r.saddlerFocusCost > 0, "fixture: the saddler craft must be focus-craftable");
      const nurtureFocus = r.meta.totalNurtureFocus;
      const revenue = r.sellPot.price * (1 - M.PREMIUM_TAX);
      const cycleNoFocus = revenue - r.totalInputCostNoFocus;
      const chanceFull = (r.meta.baseOffspringPct + r.meta.nurtureGainPct) / 100;
      // The operand with the nurture play only (saddler at its base rate).
      const nurtureOnly = cycleNoFocus + chanceFull * Math.max(r.buyMat.price, cycleNoFocus);
      const holdsSaddlerEffect = r.profitFocusOn > nurtureOnly + 1e-4;
      const billsSaddler = r.focusCost >= nurtureFocus + r.saddlerFocusCost - EPS;
      assert.ok(r.focusCost >= nurtureFocus - EPS, `${mKey(r)}: nurture focus not billed`);
      assert.ok(holdsSaddlerEffect === billsSaddler,
        `${mKey(r)}: saddler effect in operand=${holdsSaddlerEffect} but saddler focus billed=${billsSaddler} ` +
        `(profitFocusOn ${r.profitFocusOn}, nurture-only ${nurtureOnly}, focusCost ${r.focusCost}, ` +
        `nurture ${nurtureFocus}, saddler ${r.saddlerFocusCost})`);
      // Since 2026-10-07 the bar is the focus-ONLY gain: the nurture slice of
      // the offspring chance on the unfocused cycle, no saddler effect at all.
      const gain = (r.meta.nurtureGainPct / 100) * Math.max(r.buyMat.price, cycleNoFocus);
      assert.ok(near(r.profitFocusGain, gain, 1e-3), `${mKey(r)}: focus-only gain ${r.profitFocusGain} ≠ ${gain}`);
      assert.ok(near(r.profitPer10kFocus, gain * barPlays(r.focusCost), 1e-3), `${mKey(r)}: per-10k arithmetic`);
    });
  });

  test(`mounts [${mode.label}] rule 3: focus-off rows are fully unfocused`, () => {
    const off = mRender({ focus: false, merged: mode.merged }).filter(mAudited);
    assert.ok(off.length > 0);
    off.forEach((r) => {
      if (r.isCraft) {
        assert.ok(near(r.rrr, r.baseRrr), `${mKey(r)}: craft rrr ${r.rrr} ≠ base ${r.baseRrr}`);
        let cost = 0;
        r.recipe.forEach((m) => {
          const eff = M.isRrrEligible(m.matId) ? m.count * (1 - r.baseRrr) : m.count;
          cost += r.matBestPrices[m.matId].price * eff * (1 + M.SETUP_FEE);
        });
        cost += r.brecilienFee || 0;
        assert.ok(near(r.totalInputCost, cost), `${mKey(r)}: cost ${r.totalInputCost} ≠ unfocused ${cost}`);
        return;
      }
      assert.ok(near(r.saddlerRrr, r.saddlerRrrNoFocus), `${mKey(r)}: saddler rrr is focused`);
      assert.ok(near(r.totalInputCost, r.totalInputCostNoFocus), `${mKey(r)}: input cost is focused`);
      assert.ok(near(r.marginInfo.profit, r.profitNoFocus), `${mKey(r)}: profit ${r.marginInfo.profit} ≠ unfocused ${r.profitNoFocus}`);
      assert.strictEqual(r.focusProfitDelta, 0, `${mKey(r)}: focus delta leaks into the headline`);
    });
  });
});

test("mounts [merged] fixture sanity: the focus toggle really flips the craft city", () => {
  const on = mRender({ focus: true, merged: true }).filter(isHorseCraft);
  const off = mRender({ focus: false, merged: true }).filter(isHorseCraft);
  assert.ok(on.length === 1 && off.length === 1);
  assert.notStrictEqual(on[0].craftCity, off[0].craftCity,
    `craft city ${on[0].craftCity} both ways — fixture cannot exercise the flip`);
});
