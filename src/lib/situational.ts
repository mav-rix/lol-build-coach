import type { DDragonChampion } from '@/types/ddragon'
import type { SituationalCondition } from '@/types/app'

// Champions whose kits provide meaningful healing (self or allied).
export const HEALERS = new Set([
  'Soraka', 'Yuumi', 'Sona', 'Nami', 'Aatrox', 'Vladimir', 'DrMundo',
  'Sylas', 'Swain', 'Illaoi', 'Fiora', 'Warwick', 'Maokai', 'Kayn',
  'Briar', 'Zac', 'Renata', 'Senna', 'Nidalee', 'Ivern',
])

// Hard-CC-heavy champions (point-and-click or reliable lockdown).
export const HEAVY_CC = new Set([
  'Malzahar', 'Warwick', 'Skarner', 'Lissandra', 'Leona', 'Nautilus',
  'Morgana', 'Ashe', 'Sejuani', 'Maokai', 'Amumu', 'Rell', 'Thresh',
])

export interface EnemyCompProfile {
  activeConditions: Set<SituationalCondition>
  summary: string[]
}

/** Derive which situational-item conditions the enemy comp activates. */
export function analyzeEnemyComp(enemies: DDragonChampion[]): EnemyCompProfile {
  const active = new Set<SituationalCondition>(['general'])
  const summary: string[] = []
  if (enemies.length === 0) return { activeConditions: active, summary }

  const tanks = enemies.filter((c) => c.tags.includes('Tank'))
  const mages = enemies.filter((c) => c.tags.includes('Mage'))
  const physical = enemies.filter(
    (c) => c.tags.includes('Marksman') || (c.tags.includes('Assassin') && !c.tags.includes('Mage')),
  )
  const healers = enemies.filter((c) => HEALERS.has(c.id))
  const ccers = enemies.filter((c) => HEAVY_CC.has(c.id))

  if (tanks.length >= 2) {
    active.add('enemy_has_tanks')
    summary.push(`${tanks.length} tanks — consider % damage / penetration`)
  }
  if (mages.length >= 3) {
    active.add('enemy_heavy_ap')
    summary.push(`${mages.length} AP threats — magic resist valuable`)
  }
  if (physical.length >= 3) {
    active.add('enemy_heavy_ad')
    summary.push(`${physical.length} AD threats — armor valuable`)
  }
  if (healers.length >= 1) {
    active.add('enemy_has_healing')
    summary.push(`Healing from ${healers.map((c) => c.name).join(', ')} — buy anti-heal`)
  }
  if (ccers.length >= 2) {
    active.add('enemy_heavy_cc')
    summary.push(`Heavy CC (${ccers.map((c) => c.name).join(', ')}) — tenacity/cleanse valuable`)
  }
  return { activeConditions: active, summary }
}

export const CONDITION_LABELS: Record<SituationalCondition, string> = {
  enemy_has_healing: 'vs. Healing',
  enemy_has_tanks: 'vs. Tanks',
  enemy_heavy_ap: 'vs. AP',
  enemy_heavy_ad: 'vs. AD',
  enemy_heavy_cc: 'vs. CC',
  general: 'General',
}
