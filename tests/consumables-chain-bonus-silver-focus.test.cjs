/**
 * Test: chain savings from ingredients that are chain-craftable but NOT
 * focus-craftable (focusCost=0) — computed, reported, and kept OUT of both
 * Pure Profit and Silver/Focus.
 *
 * Backstory: A consumable like Fancy Fish Sauce uses 45 Fish Chops, but fish
 * chops have no craftingfocus in items.xml. If you chain-craft the chops
 * yourself you keep (market − chain) silver per chop as unclaimed profit. The
 * game won't let you spend focus on the chops butcher craft, so that silver has
 * no focus row of its own to sit on.
 *
 * It used to be folded into the PARENT recipe's Silver/Focus — which was the
 * average-vs-marginal error: the bonus is yours whether or not a single focus
 * point is spent, so crediting focus with it overstated what focus buys. Under
 * the shared standard (js/focus-play.js) Silver/Focus counts only what focus
 * itself adds, and the bonus is named beside the figure instead.
 *
 * Rule:
 *  - bonus is summed across each ingredient where:
 *      * CHAIN_RECIPES[matId] exists
 *      * getFocusCost(matId, tier) === 0
 *      * chain.costPerOutput > 0
 *      * marketPrice > 0
 *      * chain.costPerOutput < marketPrice
 *  - silver/focus = (input cost at base RRR − at focus RRR) ÷ focus cost, and
 *    the bonus is NOT a term in it
 *  - pure profit cell is NOT modified
 *  - if parent focusCost === 0, silver/focus stays "—" regardless of bonus
 *
 * Black-box: mirrors the bonus computation + the standardized Silver/Focus.
 * Doesn't touch the renderer DOM.
 *
 * Run: node tests/consumables-chain-bonus-silver-focus.test.cjs
 */

const assert = require("assert");

const SETUP_FEE = 0.025;
function calculateProfitPerFocus(profit, focus) {
  if (!focus || focus <= 0) return 0;
  return profit / focus;
}

// Mirror the bonus computation from render-consumables.js (multi-ingredient
// path). Each ingredient is described as
//   { matId, count, noReturn?, marketCost, chainCost, ingredientFocusCost, hasChainRecipe }
function computeChainBonusProfit(recipe, focusRrr) {
  let bonus = 0;
  const breakdown = [];
  for (const m of recipe) {
    if (!m.hasChainRecipe) continue;
    if (m.ingredientFocusCost > 0) continue;
    if (!(m.chainCost > 0)) continue;
    if (!(m.marketCost > 0)) continue;
    if (m.chainCost >= m.marketCost) continue;
    const effectiveCount = m.noReturn ? m.count : m.count * (1 - focusRrr);
    const savings = (m.marketCost - m.chainCost) * effectiveCount * (1 + SETUP_FEE);
    bonus += savings;
    breakdown.push({ matId: m.matId, savings });
  }
  return { bonus, breakdown };
}

// Mirror the shared Silver/Focus standard (js/focus-play.js): the silver the
// FOCUS ITSELF adds to the finished consumable, over the focus it burns. Focus
// only raises the craft's return rate, so what it adds is the ingredient cost the
// higher rate removes - nothing else. The chain bonus is deliberately NOT an
// argument: no focus point buys it.
function silverPerFocus(inputCostBaseRrr, inputCostFocusRrr, parentFocusCost) {
  return calculateProfitPerFocus(inputCostBaseRrr - inputCostFocusRrr, parentFocusCost);
}

// Input cost of one craft at a given return rate - the only thing focus moves.
function inputCostAtRrr(recipe, atRrr) {
  let cost = 0;
  for (const m of recipe) {
    const eff = m.noReturn ? m.count : m.count * (1 - atRrr);
    cost += m.marketCost * eff * (1 + SETUP_FEE);
  }
  return cost;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (e) { console.error(`  FAIL: ${name} — ${e.message}`); failed++; }
}

console.log("\n=== Eligibility for bonus contribution ===");

test("ingredient with chain recipe + focusCost=0 + chain<market → contributes", () => {
  const recipe = [{
    matId: "T1_FISHCHOPS", count: 45,
    marketCost: 230, chainCost: 140,
    ingredientFocusCost: 0, hasChainRecipe: true,
  }];
  const { bonus, breakdown } = computeChainBonusProfit(recipe, 0.1525); // base RRR
  assert.ok(bonus > 0, `expected bonus > 0, got ${bonus}`);
  assert.strictEqual(breakdown.length, 1);
  assert.strictEqual(breakdown[0].matId, "T1_FISHCHOPS");
});

test("ingredient with focusCost > 0 → SKIPPED (its own focus return already counts)", () => {
  const recipe = [{
    matId: "T6_MEAT", count: 47,
    marketCost: 200, chainCost: 130,
    ingredientFocusCost: 35, hasChainRecipe: true,
  }];
  const { bonus } = computeChainBonusProfit(recipe, 0.435);
  assert.strictEqual(bonus, 0);
});

test("ingredient with NO chain recipe → SKIPPED", () => {
  const recipe = [{
    matId: "T6_POTATO", count: 47,
    marketCost: 200, chainCost: 0,
    ingredientFocusCost: 0, hasChainRecipe: false,
  }];
  const { bonus } = computeChainBonusProfit(recipe, 0.435);
  assert.strictEqual(bonus, 0);
});

test("chain cost >= market cost → no savings (skipped)", () => {
  const recipe = [{
    matId: "T1_FISHCHOPS", count: 45,
    marketCost: 100, chainCost: 100,
    ingredientFocusCost: 0, hasChainRecipe: true,
  }];
  const { bonus } = computeChainBonusProfit(recipe, 0.1525);
  assert.strictEqual(bonus, 0);
});

test("market cost = 0 (unavailable on market) → skipped (can't compute savings)", () => {
  const recipe = [{
    matId: "T1_FISHCHOPS", count: 45,
    marketCost: 0, chainCost: 80,
    ingredientFocusCost: 0, hasChainRecipe: true,
  }];
  const { bonus } = computeChainBonusProfit(recipe, 0.1525);
  assert.strictEqual(bonus, 0);
});

test("chain cost = 0 (no data) → skipped", () => {
  const recipe = [{
    matId: "T1_FISHCHOPS", count: 45,
    marketCost: 230, chainCost: 0,
    ingredientFocusCost: 0, hasChainRecipe: true,
  }];
  const { bonus } = computeChainBonusProfit(recipe, 0.1525);
  assert.strictEqual(bonus, 0);
});

console.log("\n=== Math: effective count includes RRR ===");

test("effective count = count × (1 - focusRrr) for return-eligible ingredient", () => {
  const recipe = [{
    matId: "T1_FISHCHOPS", count: 45,
    marketCost: 230, chainCost: 140,
    ingredientFocusCost: 0, hasChainRecipe: true,
  }];
  const focusRrr = 0.435; // focus-on Royal: 0.77 / 1.77
  const { bonus } = computeChainBonusProfit(recipe, focusRrr);
  // perUnit_savings = 90; effective = 45 × (1 - 0.435) = 25.425
  // bonus = 90 × 25.425 × 1.025 = 2,345.46...
  const expected = (230 - 140) * 45 * (1 - focusRrr) * (1 + SETUP_FEE);
  assert.ok(Math.abs(bonus - expected) < 1e-6, `expected ${expected}, got ${bonus}`);
});

test("noReturn ingredient → effective count = m.count (no RRR adjustment)", () => {
  const recipe = [{
    matId: "T6_LEATHER", count: 10,
    marketCost: 500, chainCost: 400,
    ingredientFocusCost: 0, hasChainRecipe: true,
    noReturn: true,
  }];
  const focusRrr = 0.435;
  const { bonus } = computeChainBonusProfit(recipe, focusRrr);
  // perUnit_savings = 100; effective = 10 (noReturn); bonus = 100 × 10 × 1.025
  const expected = (500 - 400) * 10 * (1 + SETUP_FEE);
  assert.ok(Math.abs(bonus - expected) < 1e-6, `expected ${expected}, got ${bonus}`);
});

test("higher focusRrr → smaller effective count → smaller bonus", () => {
  const recipe = [{
    matId: "T1_FISHCHOPS", count: 45,
    marketCost: 230, chainCost: 140,
    ingredientFocusCost: 0, hasChainRecipe: true,
  }];
  const { bonus: baseBonus } = computeChainBonusProfit(recipe, 0.1525); // base RRR
  const { bonus: focusBonus } = computeChainBonusProfit(recipe, 0.435); // focus RRR
  assert.ok(focusBonus < baseBonus,
    `focusBonus (${focusBonus}) should be < baseBonus (${baseBonus}) — RRR reduces effective consumption`);
});

console.log("\n=== Multiple ingredients: bonus sums across eligible items ===");

test("two non-focus chain-eligible ingredients → bonuses sum", () => {
  const recipe = [
    { matId: "T1_FISHCHOPS", count: 45, marketCost: 230, chainCost: 140, ingredientFocusCost: 0, hasChainRecipe: true },
    { matId: "T6_SOMETHING", count: 10, marketCost: 1000, chainCost: 800, ingredientFocusCost: 0, hasChainRecipe: true },
  ];
  const focusRrr = 0.435;
  const { bonus, breakdown } = computeChainBonusProfit(recipe, focusRrr);
  const expected1 = (230 - 140) * 45 * (1 - focusRrr) * (1 + SETUP_FEE);
  const expected2 = (1000 - 800) * 10 * (1 - focusRrr) * (1 + SETUP_FEE);
  assert.ok(Math.abs(bonus - (expected1 + expected2)) < 1e-6);
  assert.strictEqual(breakdown.length, 2);
});

test("mixed: one eligible (chops) + one ineligible (mutton w/ focus) → only chops contributes", () => {
  const recipe = [
    { matId: "T1_FISHCHOPS", count: 45, marketCost: 230, chainCost: 140, ingredientFocusCost: 0, hasChainRecipe: true },
    { matId: "T6_MEAT", count: 47, marketCost: 200, chainCost: 130, ingredientFocusCost: 35, hasChainRecipe: true },
    { matId: "T6_POTATO", count: 47, marketCost: 250, chainCost: 0, ingredientFocusCost: 0, hasChainRecipe: false },
  ];
  const focusRrr = 0.435;
  const { bonus, breakdown } = computeChainBonusProfit(recipe, focusRrr);
  const expected = (230 - 140) * 45 * (1 - focusRrr) * (1 + SETUP_FEE);
  assert.ok(Math.abs(bonus - expected) < 1e-6);
  assert.strictEqual(breakdown.length, 1);
  assert.strictEqual(breakdown[0].matId, "T1_FISHCHOPS");
});

console.log("\n=== silver/focus is what the FOCUS buys, and the chain bonus is not it ===");

const SAUCE_RECIPE = [
  { matId: "T1_FISHCHOPS", count: 45, marketCost: 230, chainCost: 140, ingredientFocusCost: 0, hasChainRecipe: true },
  { matId: "T1_SEAWEED", count: 3, marketCost: 296, chainCost: 0, ingredientFocusCost: 0, hasChainRecipe: false },
];
const BASE_RRR = 0.1525;   // royal, focus off
const FOCUS_RRR = 0.435;   // royal, focus on
const COST_BASE = () => inputCostAtRrr(SAUCE_RECIPE, BASE_RRR);
const COST_FOCUS = () => inputCostAtRrr(SAUCE_RECIPE, FOCUS_RRR);

test("silver/focus = (input cost at base RRR - at focus RRR) / focus cost", () => {
  const focusCost = 672;
  const spf = silverPerFocus(COST_BASE(), COST_FOCUS(), focusCost);
  assert.ok(Math.abs(spf - (COST_BASE() - COST_FOCUS()) / focusCost) < 1e-9);
  assert.ok(spf > 0, "focus must buy something on a returnable recipe");
});

test("the chain bonus does NOT enter silver/focus (no focus point buys it)", () => {
  // The old rule was (focusProfit + bonus) / focusCost, which inflated a sauce's
  // focus efficiency with silver the row keeps whether or not focus is spent -
  // exactly the average-vs-marginal error the standard exists to stop.
  const focusCost = 672;
  const { bonus } = computeChainBonusProfit(SAUCE_RECIPE, FOCUS_RRR);
  assert.ok(bonus > 0, "this recipe does have chain savings to be tempted by");
  const spf = silverPerFocus(COST_BASE(), COST_FOCUS(), focusCost);
  const inflated = calculateProfitPerFocus((COST_BASE() - COST_FOCUS()) + bonus, focusCost);
  assert.ok(inflated > spf, "sanity: folding the bonus in would raise the figure");
  assert.ok(Math.abs(spf * focusCost - (COST_BASE() - COST_FOCUS())) < 1e-9,
    "the reported figure must contain the RRR delta and nothing else");
});

test("the sale price cannot move silver/focus (marginal, not an average)", () => {
  // Both cycles sell the same consumable at the same price, so revenue cancels
  // out of the difference. Nothing in the formula references revenue at all -
  // the property the old profit-over-focus average lacked.
  const spf = silverPerFocus(COST_BASE(), COST_FOCUS(), 672);
  assert.ok(spf > 0 && Number.isFinite(spf));
});

test("parent with focusCost=0 (fish sauce) -> silver/focus 0, bonus or not", () => {
  // Fish sauce has no craftingfocus, so no focus can be spent on it. The chain
  // savings on its chops are still real silver, and still not focus value.
  assert.strictEqual(silverPerFocus(COST_BASE(), COST_FOCUS(), 0), 0);
});

test("an all-noReturn recipe has nothing for focus to return -> 0", () => {
  const recipe = [{ matId: "T6_LEATHER", count: 10, marketCost: 500, chainCost: 400,
    ingredientFocusCost: 0, hasChainRecipe: true, noReturn: true }];
  const spf = silverPerFocus(inputCostAtRrr(recipe, BASE_RRR), inputCostAtRrr(recipe, FOCUS_RRR), 672);
  assert.strictEqual(spf, 0);
});

console.log("\n=== Pure profit invariance: bonus does NOT mutate pure profit ===");

// The renderer pulls pure profit from marginInfo.profit (computed pre-bonus).
// We simulate the data path: compute profit on full market-priced inputs,
// then compute bonus separately, then assert the bonus DOES NOT mutate
// the profit number. This is a guard against future regressions where
// someone reuses the bonus inside the pure-profit code path.

function pureProfitInvariantCheck(recipe, parentSellRevenue, parentRrr) {
  // Pure profit uses parent rrr (current toggle) and MARKET prices for inputs.
  let inputCost = 0;
  for (const m of recipe) {
    const eff = m.noReturn ? m.count : m.count * (1 - parentRrr);
    inputCost += m.marketCost * eff * (1 + SETUP_FEE);
  }
  const pureProfit = parentSellRevenue - inputCost;
  // Bonus is computed independently from the same recipe.
  const { bonus } = computeChainBonusProfit(recipe, parentRrr);
  return { pureProfit, bonus };
}

test("pure profit ignores chain bonus — bonus is reported separately", () => {
  const recipe = [
    { matId: "T1_FISHCHOPS", count: 45, marketCost: 230, chainCost: 140, ingredientFocusCost: 0, hasChainRecipe: true },
    { matId: "T1_SEAWEED", count: 3, marketCost: 296, chainCost: 0, ingredientFocusCost: 0, hasChainRecipe: false },
  ];
  const revenue = 15000; // example sale revenue post-tax
  const { pureProfit, bonus } = pureProfitInvariantCheck(recipe, revenue, 0.1525);
  // Manually verify pureProfit:
  //   chops: 230 × 45 × (1 - 0.1525) × 1.025 = 230 × 38.1375 × 1.025 = 8,993.46
  //   seaweed: 296 × 3 × (1 - 0.1525) × 1.025 = 296 × 2.5425 × 1.025 = 771.43
  //   inputCost ≈ 9,764.89; pureProfit ≈ 15000 - 9764.89 = 5235.11
  // Bonus is non-zero (chops chain saves) but pureProfit doesn't include it.
  const expectedInputCost = 230 * 45 * (1 - 0.1525) * 1.025 + 296 * 3 * (1 - 0.1525) * 1.025;
  const expectedPure = revenue - expectedInputCost;
  assert.ok(Math.abs(pureProfit - expectedPure) < 0.01, `pure=${pureProfit} expected≈${expectedPure}`);
  assert.ok(bonus > 0, "bonus should be > 0 for this recipe");
});

console.log("\n=== Tooltip composition (suffix string format) ===");

function makeSuffix(focusCost, chainBonusProfit, craftsWithFocus, breakdown, names) {
  if (!(focusCost > 0) || !(chainBonusProfit > 0)) return "";
  const labels = breakdown.map(b => names[b.matId] || b.matId).join(", ");
  return ` + ${(chainBonusProfit * craftsWithFocus).toFixed(0)} bonus per 10K focus from chain-crafting non-focus ingredients (${labels})`;
}

test("suffix empty when bonus = 0", () => {
  assert.strictEqual(makeSuffix(672, 0, 14, [], {}), "");
});

test("suffix empty when parent focusCost = 0 (even with bonus)", () => {
  assert.strictEqual(makeSuffix(0, 3514, 0, [{ matId: "T1_FISHCHOPS" }], {}), "");
});

test("suffix lists ingredient names when bonus > 0", () => {
  const s = makeSuffix(672, 2345, 14, [{ matId: "T1_FISHCHOPS" }], { T1_FISHCHOPS: "Fish Chops [T1]" });
  assert.ok(s.includes("Fish Chops [T1]"));
  assert.ok(s.includes("bonus per 10K focus"));
  assert.ok(s.includes("chain-crafting non-focus ingredients"));
});

console.log("\n=== Full-recursive chain cost: every non-focus sub uses min(market, chain) ===");

// Mirror fullChainCostRecursive. Tree nodes:
//   { matId, focusCost, marketPrice, output, inputs }
// fullChain(matId) =
//   - marketPrice if matId has no chain recipe (leaf)
//   - marketPrice if focusCost > 0 (don't chain focus items)
//   - else sum( inp.count × min(marketPrice(inp), fullChain(inp)) ) / output
function fullChainCost(matId, all, depth) {
  const d = depth || 0;
  const node = all[matId];
  if (!node) return 0;
  if (d > 5) return node.marketPrice;
  if (node.focusCost > 0) return node.marketPrice;
  if (!node.inputs || node.inputs.length === 0) return node.marketPrice;  // leaf

  let cost = 0;
  for (const inp of node.inputs) {
    const subMarket = all[inp.matId]?.marketPrice || 0;
    const subChain = fullChainCost(inp.matId, all, d + 1);
    let subCost;
    if (subMarket > 0 && subChain > 0) subCost = Math.min(subMarket, subChain);
    else if (subMarket > 0) subCost = subMarket;
    else if (subChain > 0) subCost = subChain;
    else return 0;
    cost += subCost * inp.count;
  }
  return cost / (node.output || 1);
}

function chainSavings(matId, all) {
  const node = all[matId];
  if (!node || node.focusCost > 0) return 0;
  if (!(node.marketPrice > 0)) return 0;
  const chain = fullChainCost(matId, all);
  if (!(chain > 0)) return 0;
  return node.marketPrice > chain ? node.marketPrice - chain : 0;
}

test("chops with chain cheaper than market → direct savings", () => {
  const nodes = {
    T2_FISH: { matId: "T2_FISH", focusCost: 0, marketPrice: 297, output: 1, inputs: [] },
    T1_FISHCHOPS: {
      matId: "T1_FISHCHOPS", focusCost: 0, marketPrice: 230, output: 2,
      inputs: [{ matId: "T2_FISH", count: 1 }],
    },
  };
  const s = chainSavings("T1_FISHCHOPS", nodes);
  // fullChain = 297 / 2 = 148.5. Savings = 230 - 148.5 = 81.5
  assert.ok(Math.abs(s - 81.5) < 1e-9, `expected 81.5, got ${s}`);
});

test("tradeable sauce uses RECURSIVE chops chain (not market chops)", () => {
  const nodes = {
    T2_FISH:      { matId: "T2_FISH",      focusCost: 0, marketPrice: 297, output: 1, inputs: [] },
    T1_FISHCHOPS: { matId: "T1_FISHCHOPS", focusCost: 0, marketPrice: 230, output: 2, inputs: [{ matId: "T2_FISH", count: 1 }] },
    T1_SEAWEED:   { matId: "T1_SEAWEED",   focusCost: 0, marketPrice: 296, output: 1, inputs: [] },
    T1_FISHSAUCE_LEVEL3: {
      matId: "T1_FISHSAUCE_LEVEL3", focusCost: 0, marketPrice: 35420, output: 1,
      inputs: [
        { matId: "T1_FISHCHOPS", count: 135 },
        { matId: "T1_SEAWEED",   count: 9 },
      ],
    },
  };
  const s = chainSavings("T1_FISHSAUCE_LEVEL3", nodes);
  // fullChain sauce = 135 × min(230, 148.5) + 9 × 296 = 135 × 148.5 + 2664 = 22711.5
  // savings = 35420 - 22711.5 = 12708.5
  assert.ok(Math.abs(s - 12708.5) < 1e-6, `expected 12708.5, got ${s}`);
});

test("focus-craftable sub-ingredient → priced at market, not chain", () => {
  const nodes = {
    T6_SHEEP_GROWN: { matId: "T6_SHEEP_GROWN", focusCost: 0, marketPrice: 5000, output: 1, inputs: [] },
    T6_MEAT: {
      matId: "T6_MEAT", focusCost: 35, marketPrice: 200, output: 18,
      inputs: [{ matId: "T6_SHEEP_GROWN", count: 1 }],
    },
    PARENT: {
      matId: "PARENT", focusCost: 0, marketPrice: 1000, output: 1,
      inputs: [{ matId: "T6_MEAT", count: 5 }],
    },
  };
  // T6_MEAT has focus → its own focus return; do NOT chain it.
  // Parent fullChain = 5 × 200 (meat market) = 1000. Savings = 1000 - 1000 = 0.
  const s = chainSavings("PARENT", nodes);
  assert.strictEqual(s, 0);
});

test("non-tradeable item → 0 savings (no market baseline)", () => {
  const nodes = {
    LEAF: { matId: "LEAF", focusCost: 0, marketPrice: 100, output: 1, inputs: [] },
    NONTRADE: {
      matId: "NONTRADE", focusCost: 0, marketPrice: 0, output: 1,
      inputs: [{ matId: "LEAF", count: 1 }],
    },
  };
  const s = chainSavings("NONTRADE", nodes);
  assert.strictEqual(s, 0);
});

test("chain pricier than market → savings = 0", () => {
  const nodes = {
    SUB:    { matId: "SUB",    focusCost: 0, marketPrice: 1000, output: 1, inputs: [] },
    PARENT: { matId: "PARENT", focusCost: 0, marketPrice: 100,  output: 1,
              inputs: [{ matId: "SUB", count: 1 }] },
  };
  // fullChain parent = 1000. market = 100. Chain pricier → 0.
  const s = chainSavings("PARENT", nodes);
  assert.strictEqual(s, 0);
});

test("depth limit prevents runaway recursion", () => {
  const nodes = {};
  for (let i = 0; i < 10; i++) {
    nodes[`L${i}`] = {
      matId: `L${i}`, focusCost: 0, marketPrice: 100, output: 1,
      inputs: i < 9 ? [{ matId: `L${i+1}`, count: 1 }] : [],
    };
  }
  // Should not throw.
  const s = chainSavings("L0", nodes);
  // At depth 5 we fall back to market (100). So fullChain at L4 = 100, L3 = 100, etc.
  // L0 fullChain = 100 (after recursion termination). Savings = 100 - 100 = 0.
  assert.ok(s >= 0);
});

console.log("\n=== Inline 'uses non-focus-craftable consumable' tag composition ===");

// Mirror the per-ingredient nonFocusTag logic in render-consumables.js.
function makeNonFocusTag(chainBonusBreakdown, matId, focusCost) {
  const entry = (chainBonusBreakdown || []).find(b => b.matId === matId);
  if (!entry) return "";
  const note = focusCost > 0
    ? ""
    : " (silver/focus stays '—' because THIS recipe itself has no focus cost, but the bonus is real)";
  return `(uses non-focus-craftable consumable)${note ? "|" + note : ""}`;
}

test("ingredient in chainBonusBreakdown → tag rendered with label", () => {
  const tag = makeNonFocusTag(
    [{ matId: "T1_FISHCHOPS", savings: 3186 }],
    "T1_FISHCHOPS",
    0
  );
  assert.ok(tag.includes("uses non-focus-craftable consumable"), tag);
});

test("ingredient NOT in chainBonusBreakdown → empty tag", () => {
  const tag = makeNonFocusTag(
    [{ matId: "T1_FISHCHOPS", savings: 3186 }],
    "T1_SEAWEED",
    0
  );
  assert.strictEqual(tag, "");
});

test("parent has focusCost > 0 → tag has no qualifier note (silver/focus actually used)", () => {
  const tag = makeNonFocusTag(
    [{ matId: "T1_FISHCHOPS", savings: 3186 }],
    "T1_FISHCHOPS",
    672  // salad has focus cost
  );
  assert.ok(tag.includes("uses non-focus-craftable consumable"));
  assert.ok(!tag.includes("silver/focus stays"), "no qualifier when parent uses focus");
});

test("parent has focusCost === 0 → tag adds qualifier explaining silver/focus stays '—'", () => {
  const tag = makeNonFocusTag(
    [{ matId: "T1_FISHCHOPS", savings: 3186 }],
    "T1_FISHCHOPS",
    0  // fish sauce
  );
  assert.ok(tag.includes("silver/focus stays"), tag);
});

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
