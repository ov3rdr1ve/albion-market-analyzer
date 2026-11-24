/**
 * Crystallized-token substitution for the artifact material slot.
 *
 * In items.xml a craftable artifact gear item carries TWO craftingrequirements
 * blocks per enchant level: identical base resources, identical focus, one
 * consuming the artifact material and one consuming a Crystallized token of the
 * matching tier. So the token is NOT crafted into an artifact first (there is no
 * such recipe) — it goes straight into the gear craft as an alternate input, and
 * the craft simply costs whichever of the two is cheaper on the market.
 *
 * Token class follows the artifact's RARITY tier, not its faction:
 *   Rune      -> TOKEN_FAVOR_1  (Crystallized Spirit)
 *   Soul      -> TOKEN_FAVOR_2  (Crystallized Dread)
 *   Relic     -> TOKEN_FAVOR_3  (Crystallized Magic)
 *   Avalonian -> TOKEN_FAVOR_4  (Crystallized Divinity)
 *
 * 112 of the 125 non-Crystal artifacts have a token block (560 gear items over
 * T4-T8). Crystal-rarity artifacts have none — they stay shard-only — and so do
 * the shapeshifter and Fey artifacts listed below; verified against live
 * ao-bin-dumps items.xml, not just the repo copy.
 *
 * Depends on ARTIFACT_MAPPING (js/data-artifacts.js) — load it first.
 */
const ARTIFACT_TOKEN_FAVOR_BY_TIER = { Rune: 1, Soul: 2, Relic: 3, Avalonian: 4 };

// Non-Crystal artifacts whose gear has no token craftingrequirements block.
const ARTIFACT_NO_TOKEN_PATH = new Set([
  "2H_SHAPESHIFTER_MORGANA", "2H_SHAPESHIFTER_HELL",
  "2H_SHAPESHIFTER_KEEPER", "2H_SHAPESHIFTER_AVALON",
  "HEAD_CLOTH_FEY", "ARMOR_CLOTH_FEY", "SHOES_CLOTH_FEY",
  "HEAD_LEATHER_FEY", "ARMOR_LEATHER_FEY", "SHOES_LEATHER_FEY",
  "HEAD_PLATE_FEY", "ARMOR_PLATE_FEY", "SHOES_PLATE_FEY",
]);

const ARTIFACT_MAT_RE = /^T([4-8])_ARTEFACT_(.+)$/;

/** Crystallized token that can replace `matId` in a craft, or null. */
function getArtifactTokenId(matId) {
  const m = typeof matId === "string" && matId.match(ARTIFACT_MAT_RE);
  if (!m) return null;
  const [, tier, suffix] = m;
  if (ARTIFACT_NO_TOKEN_PATH.has(suffix)) return null;
  const info = ARTIFACT_MAPPING[suffix];
  const favor = info && ARTIFACT_TOKEN_FAVOR_BY_TIER[info.tier];
  return favor ? `T${tier}_ARTEFACT_TOKEN_FAVOR_${favor}` : null;
}

// Crystal artifact lines that also ship an expiring twin. In items.xml the twin
// is a separate simpleitem (…_CRYSTAL_DECAY) carrying decayitem="<the plain
// artifact>" and decayondatetime="CRYSTAL_ARTIFACT_BATCH_n_DECAY": same name,
// same craft slot, but it stops working on a date. It is stock handed out by
// Crystal League rewards, so it trades below the permanent artifact and fills
// the same slot — worth pricing as an alternate input. Only these three lines
// have one (verified against ao-bin-dumps items.xml).
const ARTIFACT_DECAY_LINES = new Set([
  "2H_BOW_CRYSTAL",
  "2H_KNUCKLES_CRYSTAL",
  "MAIN_CURSEDSTAFF_CRYSTAL",
]);

/** Expiring twin that can replace `matId` in a craft, or null. */
function getArtifactDecayId(matId) {
  const m = typeof matId === "string" && matId.match(ARTIFACT_MAT_RE);
  if (!m) return null;
  const [, tier, suffix] = m;
  return ARTIFACT_DECAY_LINES.has(suffix) ? `T${tier}_ARTEFACT_${suffix}_DECAY` : null;
}

/**
 * Every id a craft may buy to fill this material slot, cheapest-wins. The
 * material's own id is always first so callers can treat it as the default.
 */
function getCraftMatCandidates(matId) {
  const alts = [getArtifactTokenId(matId), getArtifactDecayId(matId)].filter(Boolean);
  return [matId, ...alts];
}

/** Every expiring-twin id a market scan needs so the substitution can be priced. */
function getArtifactDecayIds(out) {
  const ids = out || new Set();
  for (let t = 4; t <= 8; t++) {
    for (const suffix of ARTIFACT_DECAY_LINES) ids.add(`T${t}_ARTEFACT_${suffix}_DECAY`);
  }
  return ids;
}

/** Every token id a market scan needs so the substitution can be priced. */
function getArtifactTokenIds(out) {
  const ids = out || new Set();
  for (let t = 4; t <= 8; t++) {
    for (const favor of Object.values(ARTIFACT_TOKEN_FAVOR_BY_TIER)) {
      ids.add(`T${t}_ARTEFACT_TOKEN_FAVOR_${favor}`);
    }
  }
  return ids;
}
