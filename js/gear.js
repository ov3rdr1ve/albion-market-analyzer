// Every gear recipe, T1 upward. GEAR_RECIPES below drops T1 only: a T1 item has
// no marketplace to speak of, so a T1 row is a row that can never be priced.
// T2/T3 stay in — they are craftable, they sell, and they fill the T2/T3
// CRAFTING JOURNALS (js/laborer-craft-fill.js reads GEAR_RECIPES_ALL, which
// keeps T1 as well because a journal counts the craft, not the sale).
const GEAR_RECIPES_ALL = [
  ...GEAR_CLOTH_ARMOR, ...GEAR_LEATHER_ARMOR, ...GEAR_LEATHER_DRAGON, ...GEAR_PLATE_ARMOR,
  ...GEAR_MELEE_LIGHT, ...GEAR_MELEE_HEAVY, ...GEAR_RANGED,
  ...GEAR_STAVES_A, ...GEAR_STAVES_B, ...GEAR_STAVES_C,
  ...GEAR_OFFHAND, ...GEAR_CAPES, ...GEAR_TOOLS, ...GEAR_GATHERER,
  ...GEAR_CRYSTAL_WEAPONS, ...GEAR_CRYSTAL_WEAPONS_B,
  // Artifact MATERIALS are deliberately absent — none of them is gear-station
  // work. Every artifact carries a 50-fragment craftingrequirements block in
  // items.xml, but where those 50 fragments go depends on the family:
  //   • Rune / Soul / Relic / Avalonian → a MELD at the Artifact Foundry, which
  //     hands back a RANDOM artifact of that fragment type/class rather than
  //     the one you picked (wiki: Artifact Foundry § Melding). Priced by the
  //     Artifact Rolling table, which models the randomness, reroll and salvage.
  //   • Crystal Shard / Fire Dragon Scale → a deterministic EXCHANGE at the
  //     Energy Manipulator: you pick the artifact. Priced as an ordinary
  //     crafting row from js/data-energy-exchange.js.
  // Crystallized tokens are a different item again: no craft at all, they
  // substitute for the artifact inside the gear recipe — js/gear-token-substitute.js.
];

const GEAR_RECIPES = GEAR_RECIPES_ALL.filter((item) => parseInt(item.id[1]) >= 2);
