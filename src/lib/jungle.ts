// Jungle companion selection. On Summoner's Rift a jungler starts with one of
// three pets, and the choice is a real decision — so we drive it off the enemy
// comp instead of hard-coding one per build.
//
//   1101 Scorchclaw Pup      — damage
//   1102 Gustwalker Hatchling — mobility
//   1103 Mosstomper Seedling  — durability

export const JUNGLE_PETS = {
  damage: 1101, // Scorchclaw Pup
  mobility: 1102, // Gustwalker Hatchling
  durability: 1103, // Mosstomper Seedling
} as const

// Base pets plus their evolved/variant ids, for "already has a pet" checks.
export const JUNGLE_PET_IDS = new Set([1101, 1102, 1103, 1105, 1106, 1107])

export const isJunglePet = (itemId: number) => JUNGLE_PET_IDS.has(itemId)

export const ownsJunglePet = (ownedIds: Set<number>) =>
  [...ownedIds].some((id) => JUNGLE_PET_IDS.has(id))

export interface JunglePetPick {
  itemId: number
  reason: string
}

/**
 * Pick a jungle companion from the enemy composition:
 *   - heavy CC              → Gustwalker (mobility to dodge/kite chained CC)
 *   - heavy AD/AP or tanks  → Mosstomper (durability for the long fights this
 *                             comp forces)
 *   - otherwise (squishy)   → Scorchclaw (damage to snowball early ganks)
 *
 * Conditions are the same set the situational engine produces
 * (`enemy_heavy_cc`, `enemy_heavy_ad`, …); accepted as a plain string set so
 * both the live threat analysis and pre-game comp analysis can pass theirs.
 */
export function pickJunglePet(conditions: ReadonlySet<string>): JunglePetPick {
  if (conditions.has('enemy_heavy_cc')) {
    return {
      itemId: JUNGLE_PETS.mobility,
      reason: 'Gustwalker — mobility to dodge and kite their heavy CC',
    }
  }
  if (
    conditions.has('enemy_heavy_ad') ||
    conditions.has('enemy_heavy_ap') ||
    conditions.has('enemy_has_tanks')
  ) {
    return {
      itemId: JUNGLE_PETS.durability,
      reason: 'Mosstomper — durability for the drawn-out fights this comp forces',
    }
  }
  return {
    itemId: JUNGLE_PETS.damage,
    reason: 'Scorchclaw — damage to snowball early ganks vs a killable comp',
  }
}
