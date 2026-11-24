/**
 * Dragonslayer leather armor — Dragonfire, 2026-08-31.
 *
 * Three pieces (Hood / Jacket / Shoes) at T4–T8. Ordinary artifact-armor
 * recipes — leather of the item's own tier plus one Dragonhide artifact — but
 * they live in their own file rather than at the end of gear-leather-armor.js,
 * which is already well past the repo's 800-line source cap.
 *
 * The artifact (T{n}_ARTEFACT_{slot}_LEATHER_DRAGON) is bought for 50 Fire
 * Dragon Scales at the ENERGY MANIPULATOR — a deterministic exchange where you
 * pick the piece, not a random Artifact Foundry meld; see
 * js/data-energy-exchange.js and ARTIFACT_MAPPING in js/data-artifacts.js.
 * There is no Crystallized-token substitute — items.xml gives these items a
 * single craftingrequirements block — and js/gear-token-substitute.js already
 * returns null for them because no favor tier is mapped to the "Dragon" family.
 *
 * Counts and names are verbatim from the ao-bin-dumps items.xml of 2026-08-31.
 * Spread into GEAR_RECIPES_ALL by js/gear.js.
 */
const GEAR_LEATHER_DRAGON = [
  // Dragonslayer Hood
  {
    "id": "T4_HEAD_LEATHER_DRAGON",
    "name": "Adept's Dragonslayer Hood [T4]",
    "materials": [
      {
        "matId": "T4_LEATHER",
        "count": 8
      },
      {
        "matId": "T4_ARTEFACT_HEAD_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_helmet",
    "group": "artifact"
  },
  {
    "id": "T5_HEAD_LEATHER_DRAGON",
    "name": "Expert's Dragonslayer Hood [T5]",
    "materials": [
      {
        "matId": "T5_LEATHER",
        "count": 8
      },
      {
        "matId": "T5_ARTEFACT_HEAD_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_helmet",
    "group": "artifact"
  },
  {
    "id": "T6_HEAD_LEATHER_DRAGON",
    "name": "Master's Dragonslayer Hood [T6]",
    "materials": [
      {
        "matId": "T6_LEATHER",
        "count": 8
      },
      {
        "matId": "T6_ARTEFACT_HEAD_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_helmet",
    "group": "artifact"
  },
  {
    "id": "T7_HEAD_LEATHER_DRAGON",
    "name": "Grandmaster's Dragonslayer Hood [T7]",
    "materials": [
      {
        "matId": "T7_LEATHER",
        "count": 8
      },
      {
        "matId": "T7_ARTEFACT_HEAD_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_helmet",
    "group": "artifact"
  },
  {
    "id": "T8_HEAD_LEATHER_DRAGON",
    "name": "Elder's Dragonslayer Hood [T8]",
    "materials": [
      {
        "matId": "T8_LEATHER",
        "count": 8
      },
      {
        "matId": "T8_ARTEFACT_HEAD_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_helmet",
    "group": "artifact"
  },
  // Dragonslayer Jacket
  {
    "id": "T4_ARMOR_LEATHER_DRAGON",
    "name": "Adept's Dragonslayer Jacket [T4]",
    "materials": [
      {
        "matId": "T4_LEATHER",
        "count": 16
      },
      {
        "matId": "T4_ARTEFACT_ARMOR_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_armor",
    "group": "artifact"
  },
  {
    "id": "T5_ARMOR_LEATHER_DRAGON",
    "name": "Expert's Dragonslayer Jacket [T5]",
    "materials": [
      {
        "matId": "T5_LEATHER",
        "count": 16
      },
      {
        "matId": "T5_ARTEFACT_ARMOR_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_armor",
    "group": "artifact"
  },
  {
    "id": "T6_ARMOR_LEATHER_DRAGON",
    "name": "Master's Dragonslayer Jacket [T6]",
    "materials": [
      {
        "matId": "T6_LEATHER",
        "count": 16
      },
      {
        "matId": "T6_ARTEFACT_ARMOR_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_armor",
    "group": "artifact"
  },
  {
    "id": "T7_ARMOR_LEATHER_DRAGON",
    "name": "Grandmaster's Dragonslayer Jacket [T7]",
    "materials": [
      {
        "matId": "T7_LEATHER",
        "count": 16
      },
      {
        "matId": "T7_ARTEFACT_ARMOR_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_armor",
    "group": "artifact"
  },
  {
    "id": "T8_ARMOR_LEATHER_DRAGON",
    "name": "Elder's Dragonslayer Jacket [T8]",
    "materials": [
      {
        "matId": "T8_LEATHER",
        "count": 16
      },
      {
        "matId": "T8_ARTEFACT_ARMOR_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_armor",
    "group": "artifact"
  },
  // Dragonslayer Shoes
  {
    "id": "T4_SHOES_LEATHER_DRAGON",
    "name": "Adept's Dragonslayer Shoes [T4]",
    "materials": [
      {
        "matId": "T4_LEATHER",
        "count": 8
      },
      {
        "matId": "T4_ARTEFACT_SHOES_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_shoes",
    "group": "artifact"
  },
  {
    "id": "T5_SHOES_LEATHER_DRAGON",
    "name": "Expert's Dragonslayer Shoes [T5]",
    "materials": [
      {
        "matId": "T5_LEATHER",
        "count": 8
      },
      {
        "matId": "T5_ARTEFACT_SHOES_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_shoes",
    "group": "artifact"
  },
  {
    "id": "T6_SHOES_LEATHER_DRAGON",
    "name": "Master's Dragonslayer Shoes [T6]",
    "materials": [
      {
        "matId": "T6_LEATHER",
        "count": 8
      },
      {
        "matId": "T6_ARTEFACT_SHOES_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_shoes",
    "group": "artifact"
  },
  {
    "id": "T7_SHOES_LEATHER_DRAGON",
    "name": "Grandmaster's Dragonslayer Shoes [T7]",
    "materials": [
      {
        "matId": "T7_LEATHER",
        "count": 8
      },
      {
        "matId": "T7_ARTEFACT_SHOES_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_shoes",
    "group": "artifact"
  },
  {
    "id": "T8_SHOES_LEATHER_DRAGON",
    "name": "Elder's Dragonslayer Shoes [T8]",
    "materials": [
      {
        "matId": "T8_LEATHER",
        "count": 8
      },
      {
        "matId": "T8_ARTEFACT_SHOES_LEATHER_DRAGON",
        "count": 1
      }
    ],
    "craftType": "leather_shoes",
    "group": "artifact"
  },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GEAR_LEATHER_DRAGON };
}
