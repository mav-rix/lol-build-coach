import type { DDragonChampion } from '@/types/ddragon'

// Support-quest items. Everyone starts with World Atlas and upgrades it through
// the quest to Bounty of Worlds, then picks ONE final. The starter is fixed —
// the *final* is the real decision, driven by the support's class and tuned by
// the enemy comp.
//
//   3865 World Atlas → 3866 Runic Compass → 3867 Bounty of Worlds → one of:
//     3877 Bloodsong            — AD / lethality
//     3876 Solstice Sleigh      — engage / CC
//     3870 Dream Maker          — enchanter (heal & shield power)
//     3871 Zaz'Zak's Realmspike — AP, % max-health magic
//     3869 Celestial Opposition — defensive / warden

export const SUPPORT_ITEMS = {
  bloodsong: 3877,
  solstice: 3876,
  dream: 3870,
  zazzak: 3871,
  celestial: 3869,
} as const

// Bounty of Worlds — quest complete, the shop now offers the five finals.
export const SUPPORT_QUEST_COMPLETE_ID = 3867

export const SUPPORT_FINAL_IDS = new Set([3869, 3870, 3871, 3876, 3877])
// Whole quest line, for "is on the support path" checks.
export const SUPPORT_QUEST_IDS = new Set([3865, 3866, 3867, 3869, 3870, 3871, 3876, 3877])

export const ownsFinalSupportItem = (ownedIds: Set<number>) =>
  [...ownedIds].some((id) => SUPPORT_FINAL_IDS.has(id))

// Class buckets — DDragon tags can't separate enchanters from poke-mages (both
// are Support+Mage), so the common support champions are curated by archetype.
// Anything unmatched falls back to sensible tag/stat defaults below.
const ENCHANTERS = new Set([
  'Lulu', 'Janna', 'Nami', 'Soraka', 'Sona', 'Yuumi', 'Karma', 'Milio',
  'Renata', 'Seraphine', 'Taric', 'Rakan', 'Ivern', 'Nidalee',
])
const POKE_MAGE_SUPPORTS = new Set([
  'Brand', 'Zyra', 'Xerath', 'Velkoz', 'Swain', 'Lux', 'Morgana', 'Hwei',
  'Neeko', 'Zoe', 'VelKoz',
])
const AD_SUPPORTS = new Set(['Senna', 'Pyke', 'Pantheon', 'Sett', 'Ashe', 'Draven', 'Shaco'])

export interface SupportItemPick {
  itemId: number
  reason: string
}

/**
 * Pick the final support item from the champion's class, adjusted by comp:
 *   - AD / lethality supports        → Bloodsong
 *   - engage tanks                   → Solstice Sleigh (Celestial vs burst)
 *   - enchanters                     → Dream Maker (Celestial vs burst)
 *   - poke mages                     → Zaz'Zak's (extra value vs tanks)
 * The comp lever: vs a damage-heavy enemy, protective supports take the
 * defensive Celestial Opposition to survive the burst.
 */
export function pickSupportItem(
  champion: DDragonChampion,
  conditions: ReadonlySet<string>,
): SupportItemPick {
  const tags = champion.tags
  const damageHeavy = conditions.has('enemy_heavy_ad') || conditions.has('enemy_heavy_ap')
  const id = champion.id

  // AD / lethality supports (Senna, Pyke, Pantheon…).
  if (AD_SUPPORTS.has(id) || tags.includes('Marksman')) {
    return { itemId: SUPPORT_ITEMS.bloodsong, reason: "Bloodsong — scales your AD/lethality support damage" }
  }

  // Poke mages (Brand, Zyra, Xerath…).
  if (POKE_MAGE_SUPPORTS.has(id)) {
    return {
      itemId: SUPPORT_ITEMS.zazzak,
      reason: conditions.has('enemy_has_tanks')
        ? "Zaz'Zak's Realmspike — % max-health magic shreds their tanks"
        : "Zaz'Zak's Realmspike — AP damage for a poke support",
    }
  }

  // Enchanters (Lulu, Nami, Soraka…) — Dream Maker, or the defensive Celestial
  // when the enemy comp is damage-heavy and your job is keeping a carry alive.
  if (ENCHANTERS.has(id)) {
    return damageHeavy
      ? { itemId: SUPPORT_ITEMS.celestial, reason: 'Celestial Opposition — defensive shield vs their burst' }
      : { itemId: SUPPORT_ITEMS.dream, reason: 'Dream Maker — amps your heals and shields' }
  }

  // Engage tanks — Solstice, swapping to the defensive Celestial vs burst.
  if (tags.includes('Tank') || tags.includes('Fighter')) {
    return damageHeavy
      ? { itemId: SUPPORT_ITEMS.celestial, reason: 'Celestial Opposition — survive their burst while you engage' }
      : { itemId: SUPPORT_ITEMS.solstice, reason: 'Solstice Sleigh — engage item, procs when you lock a target down' }
  }

  // Fallback: treat as an enchanter (safest default for a support).
  return damageHeavy
    ? { itemId: SUPPORT_ITEMS.celestial, reason: 'Celestial Opposition — defensive support item vs their burst' }
    : { itemId: SUPPORT_ITEMS.dream, reason: 'Dream Maker — flexible enchanter support item' }
}
