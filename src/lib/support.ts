import type { Role } from '@/types/app'
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

// --- Support legendary build ---------------------------------------------
//
// The score-from-stats engine can't rank enchanter/warden legendaries: Data
// Dragon's item `stats` don't express the things that make them (ability haste,
// heal-and-shield power, item actives, team auras) — an Ardent Censer looks like
// a 45-AP item to the scorer, so it gets buried under real mage items. These
// builds are modeled explicitly here, ordered as a typical path and nudged by
// the enemy comp, the same way the jungle pet and support-quest final are.

// Enchanter legendaries (heal/shield/utility). IDs validated against the live
// patch; unknown ids degrade gracefully in the UI.
export const ENCHANTER_ITEMS = {
  moonstone: 6617, // Moonstone Renewer — heal/shield chaining engine
  ardent: 3504, // Ardent Censer — attack-speed/on-hit amp for the carry
  staff: 6616, // Staff of Flowing Water — AP + haste on heal/shield
  redemption: 3107, // Redemption — AoE heal active
  mikaels: 3222, // Mikael's Blessing — cleanse + heal power
  shurelyas: 2065, // Shurelya's Battlesong — team movement-speed active
} as const

// Warden / engage-support legendaries (protect a carry, peel, soak). These carry
// resistances the scorer *could* value, but the actives/auras/bind that define
// them aren't in the stat map, so they're modeled here too.
export const WARDEN_ITEMS = {
  locket: 3190, // Locket of the Iron Solari — AoE shield active
  knightsVow: 3109, // Knight's Vow — bind to the carry, redirect + heal
  zekes: 3050, // Zeke's Convergence — engage combo with the carry
  redemption: 3107,
} as const

export type SupportArchetype = 'enchanter' | 'warden' | 'poke' | 'ad'

/**
 * Classify a support for itemization. Enchanters and wardens get the curated
 * build below; poke mages and AD supports build like mages/lethality carries,
 * which the stat scorer already handles, so they return their label but no
 * curated legendaries. Non-support roles return null.
 */
export function supportArchetype(
  champion: DDragonChampion,
  role: Role | null | undefined,
): SupportArchetype | null {
  if (role !== 'SUPPORT') return null
  const id = champion.id
  const tags = champion.tags
  if (AD_SUPPORTS.has(id) || tags.includes('Marksman')) return 'ad'
  if (POKE_MAGE_SUPPORTS.has(id)) return 'poke'
  if (ENCHANTERS.has(id)) return 'enchanter'
  if (tags.includes('Tank') || tags.includes('Fighter')) return 'warden'
  // Unlisted support: lean on the damage profile — AP-leaning plays enchanter,
  // bruiser/tank-leaning plays warden.
  return champion.info.magic >= champion.info.attack ? 'enchanter' : 'warden'
}

export interface SupportBuildRec {
  itemId: number
  reason: string
  urgent: boolean
}

/**
 * The curated support legendary path for enchanters and wardens, ordered as a
 * typical build and adjusted by the enemy comp:
 *   - heavy CC        → Mikael's cleanse jumps the queue (enchanter)
 *   - burst (AD/AP)   → AoE heal/shield (Redemption / Locket) is promoted
 * Poke mages and AD supports return [] — their damage build is scored normally.
 */
export function recommendSupportBuild(
  archetype: SupportArchetype,
  conditions: ReadonlySet<string>,
): SupportBuildRec[] {
  const cc = conditions.has('enemy_heavy_cc')
  const burst = conditions.has('enemy_heavy_ad') || conditions.has('enemy_heavy_ap')
  const recs: SupportBuildRec[] = []
  const add = (itemId: number, reason: string, urgent = false) =>
    recs.push({ itemId, reason, urgent })

  if (archetype === 'enchanter') {
    add(ENCHANTER_ITEMS.moonstone, 'Moonstone Renewer — chains your heals and shields across the team')
    if (cc) {
      add(ENCHANTER_ITEMS.mikaels, "Mikael's Blessing — cleanse the CC that's locking your carry down", true)
    }
    add(ENCHANTER_ITEMS.ardent, "Ardent Censer — amps your carry's attack speed and on-hit")
    add(ENCHANTER_ITEMS.staff, 'Staff of Flowing Water — AP and haste every time you heal or shield')
    if (burst) {
      add(ENCHANTER_ITEMS.redemption, 'Redemption — AoE heal to answer their burst and poke', true)
    }
    if (!cc) add(ENCHANTER_ITEMS.mikaels, "Mikael's Blessing — cleanse plus extra heal power")
    add(ENCHANTER_ITEMS.shurelyas, "Shurelya's Battlesong — team-wide speed to engage or peel")
    return recs
  }

  if (archetype === 'warden') {
    add(WARDEN_ITEMS.locket, 'Locket of the Iron Solari — AoE shield to blanket your team', burst)
    add(WARDEN_ITEMS.knightsVow, "Knight's Vow — bind your carry to tank for them and heal off their damage")
    add(WARDEN_ITEMS.zekes, "Zeke's Convergence — pairs with your carry for burn and slow on engage")
    if (burst) add(WARDEN_ITEMS.redemption, 'Redemption — extra AoE healing to survive their burst')
    return recs
  }

  return []
}
