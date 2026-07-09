import { HEALERS, HEAVY_CC } from '@/lib/situational'
import type { Role } from '@/types/app'
import type { DDragonChampion } from '@/types/ddragon'

// Heuristic, explainable counter-pick suggestions. This is NOT statistical
// matchup data (that needs aggregated match history — the Phase 3 backend).
// Instead it reasons about the enemy comp's *attributes*: a mostly-AD comp
// rewards armor stackers, 2+ tanks reward %-health shredders, a squishy comp
// rewards assassins, heavy CC rewards mobile/tenacity champions, and so on.

// The condition an enemy comp presents that a suggested champion exploits.
export type CounterCondition =
  | 'heavy_ad' // 3+ AD threats → armor stackers thrive
  | 'heavy_ap' // 3+ AP threats → MR bruisers thrive
  | 'many_tanks' // 2+ tanks → %-health / true-damage / shred
  | 'squishy_comp' // few tanks, several carries → assassins / burst
  | 'heavy_cc' // CC-heavy → mobile or tenacity-friendly
  | 'low_mobility' // immobile comp → hard engage / dive
  | 'healing' // sustain comp → innate anti-heal / DoT

export const COUNTER_LABELS: Record<CounterCondition, string> = {
  heavy_ad: 'vs. AD-heavy',
  heavy_ap: 'vs. AP-heavy',
  many_tanks: 'vs. Tanks',
  squishy_comp: 'vs. Squishies',
  heavy_cc: 'vs. Heavy CC',
  low_mobility: 'vs. Low mobility',
  healing: 'vs. Healing',
}

interface CounterEntry {
  championId: string
  role: Role
  counters: CounterCondition[]
  why: string
}

// Curated pool. Champion IDs validated against Data Dragon.
const COUNTER_POOL: CounterEntry[] = [
  // TOP
  { championId: 'Malphite', role: 'TOP', counters: ['heavy_ad', 'low_mobility'], why: 'Armor stacking wrecks AD comps; R is a game-winning engage on grouped teams' },
  { championId: 'Ornn', role: 'TOP', counters: ['heavy_ad', 'many_tanks', 'low_mobility'], why: 'Tanky vs AD, and his R + item upgrades give a teamfight edge' },
  { championId: 'Fiora', role: 'TOP', counters: ['many_tanks', 'squishy_comp'], why: 'True damage and % health shred melt tanks and duel carries' },
  { championId: 'Mordekaiser', role: 'TOP', counters: ['heavy_ap', 'squishy_comp'], why: 'MR scaling vs AP, and R isolates a key carry' },
  { championId: 'Camille', role: 'TOP', counters: ['many_tanks', 'squishy_comp'], why: 'True-damage passive shreds tanks; R locks down a carry' },
  { championId: 'Darius', role: 'TOP', counters: ['squishy_comp', 'low_mobility'], why: 'Built-in Grievous (Noxian Might) and execute punish immobile squishies' },
  // JUNGLE
  { championId: 'Kayn', role: 'JUNGLE', counters: ['squishy_comp', 'heavy_ad'], why: 'Rhaast tanks AD comps; Shadow Assassin bursts squishies' },
  { championId: 'Sejuani', role: 'JUNGLE', counters: ['heavy_ad', 'low_mobility', 'squishy_comp'], why: 'AoE CC on an immobile comp, tanky vs AD' },
  { championId: 'Vi', role: 'JUNGLE', counters: ['squishy_comp', 'low_mobility'], why: 'Unstoppable R locks a carry; great vs immobile backlines' },
  { championId: 'Amumu', role: 'JUNGLE', counters: ['low_mobility', 'squishy_comp'], why: 'Double R chain-CC is devastating vs grouped, immobile teams' },
  { championId: 'Belveth', role: 'JUNGLE', counters: ['many_tanks', 'heavy_ad'], why: 'True damage on-hit and armor from her kit vs tanky AD' },
  { championId: 'Warwick', role: 'JUNGLE', counters: ['healing', 'squishy_comp'], why: 'Sustain duels and R locks a diver; strong vs squishy comps' },
  // MID
  { championId: 'Malzahar', role: 'MID', counters: ['heavy_cc', 'squishy_comp', 'low_mobility'], why: 'R suppresses a key target; passive shields vs poke/CC' },
  { championId: 'Kassadin', role: 'MID', counters: ['heavy_ap', 'squishy_comp'], why: 'Magic shield vs AP; R mobility bursts squishies late' },
  { championId: 'Galio', role: 'MID', counters: ['heavy_ap', 'low_mobility'], why: 'MR passive vs AP burst; global R engages immobile teams' },
  { championId: 'Cassiopeia', role: 'MID', counters: ['healing', 'low_mobility', 'many_tanks'], why: 'Innate Grievous on Q; sustained DoT vs tanks and sustain comps' },
  { championId: 'Syndra', role: 'MID', counters: ['squishy_comp', 'low_mobility'], why: 'Point-and-click R deletes a squishy; stun vs immobile targets' },
  { championId: 'Ahri', role: 'MID', counters: ['squishy_comp', 'heavy_cc'], why: 'Mobility + charm picks squishies; R dodges CC' },
  // ADC
  { championId: 'Vayne', role: 'ADC', counters: ['many_tanks'], why: '% max-health true damage is the premier tank-shredder' },
  { championId: 'Kaisa', role: 'ADC', counters: ['squishy_comp', 'heavy_ap'], why: 'Flexible damage and R repositioning; can build MR mixed' },
  { championId: 'Ashe', role: 'ADC', counters: ['low_mobility', 'heavy_cc'], why: 'Permaslow and a global stun R lock down immobile comps' },
  { championId: 'Varus', role: 'ADC', counters: ['many_tanks', 'low_mobility'], why: 'On-hit % health and a long-range R chain vs grouped tanks' },
  { championId: 'Caitlyn', role: 'ADC', counters: ['squishy_comp', 'low_mobility'], why: 'Longest range punishes immobile, squishy backlines' },
  // SUPPORT
  { championId: 'Morgana', role: 'SUPPORT', counters: ['heavy_cc', 'low_mobility'], why: 'Black Shield negates CC; long root vs immobile engages' },
  { championId: 'Leona', role: 'SUPPORT', counters: ['squishy_comp', 'low_mobility'], why: 'Chain-CC locks down squishies who cannot escape' },
  { championId: 'Lulu', role: 'SUPPORT', counters: ['squishy_comp', 'heavy_ad'], why: 'Peels assassins off your carry; shields vs AD burst' },
  { championId: 'Karma', role: 'SUPPORT', counters: ['heavy_cc', 'low_mobility'], why: 'Shields/speed vs CC; poke pressures immobile lanes' },
  { championId: 'Janna', role: 'SUPPORT', counters: ['low_mobility', 'squishy_comp'], why: 'Disengage vs dive; her R resets fights vs squishy all-ins' },
]

export interface CounterSuggestion {
  championId: string
  championName: string
  role: Role
  matched: CounterCondition[] // which enemy conditions this pick exploits
  why: string
  score: number
}

/** Derive which counter conditions the enemy comp presents. */
export function enemyCounterConditions(
  enemies: DDragonChampion[],
): Set<CounterCondition> {
  const conditions = new Set<CounterCondition>()
  if (enemies.length === 0) return conditions

  const tanks = enemies.filter((c) => c.tags.includes('Tank'))
  const mages = enemies.filter((c) => c.tags.includes('Mage'))
  const physical = enemies.filter(
    (c) =>
      c.tags.includes('Marksman') ||
      (c.tags.includes('Assassin') && !c.tags.includes('Mage')) ||
      (c.tags.includes('Fighter') && !c.tags.includes('Mage')),
  )
  const carries = enemies.filter(
    (c) => c.tags.includes('Marksman') || c.tags.includes('Assassin') || c.tags.includes('Mage'),
  )
  const mobile = enemies.filter((c) => c.tags.includes('Assassin'))
  const healers = enemies.filter((c) => HEALERS.has(c.id))
  const ccers = enemies.filter((c) => HEAVY_CC.has(c.id))

  if (physical.length >= 3) conditions.add('heavy_ad')
  if (mages.length >= 3) conditions.add('heavy_ap')
  if (tanks.length >= 2) conditions.add('many_tanks')
  if (carries.length >= 3 && tanks.length <= 1) conditions.add('squishy_comp')
  if (ccers.length >= 2) conditions.add('heavy_cc')
  if (mobile.length === 0 && enemies.length >= 3) conditions.add('low_mobility')
  if (healers.length >= 1) conditions.add('healing')

  return conditions
}

/**
 * Suggest counter-pick champions for each role given the enemy comp.
 * Only returns champions matching at least one active condition, ranked by
 * how many conditions they answer.
 */
export function suggestCounterPicks(
  enemies: DDragonChampion[],
  championsById: Record<string, DDragonChampion>,
  seededChampionIds: Set<string>,
): Record<Role, CounterSuggestion[]> {
  const conditions = enemyCounterConditions(enemies)
  const byRole: Record<Role, CounterSuggestion[]> = {
    TOP: [],
    JUNGLE: [],
    MID: [],
    ADC: [],
    SUPPORT: [],
  }
  if (conditions.size === 0) return byRole

  for (const entry of COUNTER_POOL) {
    const matched = entry.counters.filter((c) => conditions.has(c))
    if (matched.length === 0) continue
    // Seeded champions get a small tiebreak bump so users can grab a full build.
    const seedBonus = seededChampionIds.has(entry.championId) ? 0.5 : 0
    byRole[entry.role].push({
      championId: entry.championId,
      championName: championsById[entry.championId]?.name ?? entry.championId,
      role: entry.role,
      matched,
      why: entry.why,
      score: matched.length + seedBonus,
    })
  }

  for (const role of Object.keys(byRole) as Role[]) {
    byRole[role].sort((a, b) => b.score - a.score)
    byRole[role] = byRole[role].slice(0, 3)
  }
  return byRole
}
