// Laborer-fed crafting journals — the "don't sell the journal, work it" play.
//
// The Crafting Planner already values a filled crafting journal the market way:
// buy an empty, fill it with the crafting fame you earn anyway, sell the full
// one (craft-planner-pricing.js → getCraftJournalFill). This module models the
// OTHER play, which is what a crafter with laborers actually does:
//
//   fill the journal → hand it to your own laborer → 22h later collect the
//   refined-resource loot AND THE SAME JOURNAL BACK, empty.
//
// Two consequences the market model doesn't have:
//   • No empty journal is ever bought. One set of journals cycles forever, so
//     journal market prices don't enter the maths at all — the value of a fill
//     is purely what the laborer returns.
//   • The payout is the laborer's crafting loot (the profession's refined-
//     resource mix, enchant-spread), sold at the craft city net of tax — the
//     same per-cycle revenue the Laborers table computes (_craftingRevenue in
//     js/render-laborers.js, reused here so the two can never drift).
//
// Yield assumption: a MAX-tier (T8) laborer, matching the app-wide max-spec
// convention. A journal below the laborer's tier runs at the 150% ceiling; a T8
// journal on a T8 laborer runs at the rate its happiness buys (getLaborerYield —
// 150% at the default max trophy happiness, 100% with no trophies at all). A
// laborer can never take a journal above its own tier, so T8 covers every
// candidate.
//
// There is NO city bonus for laborers — yield is a function of laborer tier,
// journal tier and happiness only (wiki: Laborer, "Happiness and Yield"). The
// only city effect is where you sell the loot, which is the craft city here.

// Tier of the laborer this model assumes you own.
const LABORER_JOURNAL_ASSUMED_TIER = 8;

// Yield multiplier for running `journalTier` on a `laborerTier` laborer: the
// 150% ceiling for any journal below the laborer's tier, else the happiness-
// driven own-tier rate. A journal below the laborer's tier starts at 150% base
// yield, so it is already at the cap and no amount of happiness changes it —
// only an own-tier journal reads the trophy setup, and then only the trophies
// that reach ITS type, which is why `laborerSlug` matters (a crafting laborer
// has none of its own and cannot pass 120%).
function getLaborerJournalYield(journalTier, laborerTier = LABORER_JOURNAL_ASSUMED_TIER, laborerSlug) {
  if (journalTier < laborerTier) return LABORER_YIELD_CAP;
  return getLaborerYieldFor(laborerSlug, journalTier);
}

// The refined-resource mix a crafting journal slug's laborer returns
// (WARRIOR → Blacksmith, HUNTER → Fletcher, MAGE → Imbuer, TOOLMAKER → Tinker).
// Null for gathering / mercenary slugs, which no craft fills.
function getCraftingLaborerMix(slug) {
  if (!slug || typeof LABORERS === "undefined") return null;
  const lab = LABORERS.find((l) => l.slug === slug);
  return (lab && lab.craftingMix) || null;
}

// Silver a single full journal of `slug` at `journalTier` returns when worked by
// the laborer: the refined mix × baseloot × yield, priced at `city` net of sales
// tax. `hasData` is false when nothing in the mix is priced (or the slug has no
// crafting laborer) — the caller then shows no laborer value rather than a zero.
function laborerJournalPayout(slug, journalTier, marketData, city, laborerTier) {
  const mix = getCraftingLaborerMix(slug);
  // `slug` IS the laborer here (WARRIOR/HUNTER/MAGE/TOOLMAKER) — all crafting
  // laborers, so an own-tier journal only ever gets the general trophies.
  const yield_ = getLaborerJournalYield(journalTier, laborerTier, slug);
  if (!mix || typeof _craftingRevenue !== "function") {
    return { revenue: 0, hasData: false, yield: yield_, mix: null, lines: [] };
  }
  const r = _craftingRevenue(mix, journalTier, marketData, city, yield_);
  return {
    revenue: r.revenue || 0,
    hasData: !!r.hasData && r.revenue > 0,
    yield: yield_,
    mix,
    // Per-material breakdown of what the laborer hands back, for the callers that
    // show the return itself rather than only its silver.
    lines: r.lines || [],
  };
}

// Non-artifact material count = the mats that award crafting fame. Uses the
// Crafting table's own classifier when loaded (browser + crafting tests); the
// pattern list is the same one render-crafting.js documents.
function _ljNonArtifactMatCount(materials) {
  const isArtifact = (matId) =>
    typeof isNonReturnableCraftMat === "function"
      ? isNonReturnableCraftMat(matId)
      : /ARTEFACT|QUESTITEM_TOKEN|_FACTION_|UNIQUE_GVGTOKEN|_FARM_|_MOUNT_|_MOUNTUPGRADE_|ALCHEMY_RARE|_SKILLBOOK_STANDARD/.test(matId);
  let n = 0;
  (materials || []).forEach((m) => { if (!isArtifact(m.matId)) n += m.count; });
  return n;
}

function _ljEnchantOf(id) {
  const m = id && id.match(/@(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// Extra silver ONE craft is worth when its fame fills a journal you then work
// with your own laborer. A crafting journal is filled only by crafts of its own
// tier (items.xml lists same-tier ids under <craftitemfame>), so there is one
// candidate, not a ±2 window — that window belongs to the gathering journals.
//
// Returns null when the craft fills no crafting journal — food, mounts and the
// combine crafts (artifact capes, Royal armour, Crystal weapons) are all absent
// from every journal's list. `nonArtifactMatCount` may be passed to skip the
// recount.
function getLaborerJournalFill(item, materials, craftCity, marketData, nonArtifactMatCount, laborerTier) {
  const slug = (typeof getCraftJournalSlug === "function") ? getCraftJournalSlug(item) : null;
  if (!slug) return null;
  if (!getCraftingLaborerMix(slug)) return null;

  const matCount = nonArtifactMatCount != null ? nonArtifactMatCount : _ljNonArtifactMatCount(materials);
  const famePerCraft = getCraftingFamePerCraft(item, matCount, _ljEnchantOf(item.id));
  if (famePerCraft <= 0) return { slug, famePerCraft: 0, bestJournal: null, extraSilverPerCraft: 0 };

  const tier = getTierFromId(item.id);
  const cands = getCraftPlannerJournalCandidates(slug, tier);

  let best = null;
  cands.forEach((c) => {
    if (!c.maxfame) return;
    const payout = laborerJournalPayout(slug, c.tier, marketData, craftCity, laborerTier);
    if (!payout.hasData) return;
    const spf = payout.revenue / c.maxfame;
    if (!best || spf > best.silverPerFame) {
      best = {
        tier: c.tier,
        maxfame: c.maxfame,
        payout: payout.revenue,
        yield: payout.yield,
        silverPerFame: spf,
        // What the laborer actually returns, so a caller can print the refined
        // mix instead of only the silver it sums to.
        mix: payout.mix,
        lines: payout.lines,
      };
    }
  });

  return {
    slug,
    famePerCraft,
    bestJournal: best,
    extraSilverPerCraft: best ? famePerCraft * best.silverPerFame : 0,
  };
}

// Market ids the laborer payout needs: every refined resource the four crafting
// mixes return, at every journal tier, enchant-spread the same way the loot is
// (base-only below T4). NO journal or contract ids — this play never trades them.
function getLaborerJournalPayoutIds() {
  const slugs = new Set();
  (typeof CRAFT_JOURNAL_SLUGS !== "undefined" ? CRAFT_JOURNAL_SLUGS : []).forEach((s) => {
    const mix = getCraftingLaborerMix(s);
    if (mix) Object.keys(mix).forEach((refined) => slugs.add(refined));
  });
  const ids = new Set();
  slugs.forEach((refined) => {
    LABORER_TIERS.forEach((tier) => {
      getLaborerEnchantDistribution(refined, tier).forEach((e) => {
        ids.add(getEnchantedResourceId(refined, tier, e.level));
      });
    });
  });
  return Array.from(ids);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    LABORER_JOURNAL_ASSUMED_TIER,
    getLaborerJournalYield,
    getCraftingLaborerMix,
    laborerJournalPayout,
    getLaborerJournalFill,
    getLaborerJournalPayoutIds,
  };
}
