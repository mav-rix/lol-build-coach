import { analyzeEnemyComp } from '@/lib/situational'
import { JUNGLE_PET_IDS } from '@/lib/jungle'
import { SUPPORT_QUEST_IDS } from '@/lib/support'
import type { BuildPath, SituationalCondition } from '@/types/app'
import type { DDragonChampion } from '@/types/ddragon'

// The game plan: ONE item path — the highest win-rate build for the champion,
// exactly what the Build page recommends. Decided once when the enemy comp is
// known (the first live poll — i.e. the loading screen) and stable from then
// on; Build Next simply walks it.
//
// There used to be a second, comp-adjusted path (anti-heal/pen/defensive swaps
// picked from the enemy comp) that took over whenever any comp signal fired —
// in practice it almost never beat the straight WR build, so it's gone. The
// comp analysis itself is kept only for single-item role starts (the support
// quest final pick), not for reshaping the path.

export type PlanLabel = 'starter' | 'boots' | 'core'

export interface GamePlanItem {
  itemId: number
  label: PlanLabel
}

export interface GamePlan {
  /** The highest win-rate path — the same build the Build page recommends. */
  items: GamePlanItem[]
  /** The comp conditions that fired — reused for role-start picks (quest final). */
  activeConditions: ReadonlySet<SituationalCondition>
}

/**
 * Starter-slot ownership that survives transformations: jungle pets evolve into
 * different item ids, and the support World Atlas upgrades through its quest —
 * owning ANY stage counts as owning the starter.
 */
export function starterOwned(itemId: number, ownedIds: ReadonlySet<number>): boolean {
  if (ownedIds.has(itemId)) return true
  if (JUNGLE_PET_IDS.has(itemId)) return [...ownedIds].some((id) => JUNGLE_PET_IDS.has(id))
  if (SUPPORT_QUEST_IDS.has(itemId)) return [...ownedIds].some((id) => SUPPORT_QUEST_IDS.has(id))
  return false
}

function pathOf(build: BuildPath): GamePlanItem[] {
  return [
    ...build.starterItems.map((id): GamePlanItem => ({ itemId: id, label: 'starter' })),
    ...(build.bootsOptions[0]
      ? [{ itemId: build.bootsOptions[0], label: 'boots' as const }]
      : []),
    ...build.coreItems.map((id): GamePlanItem => ({ itemId: id, label: 'core' })),
  ]
}

/**
 * Compute the game plan for a build against a known enemy comp. Pure — callers
 * memoize on the comp signature so the plan stays fixed for the whole game.
 */
export function buildGamePlan(build: BuildPath, enemies: DDragonChampion[]): GamePlan {
  return {
    items: pathOf(build),
    activeConditions: analyzeEnemyComp(enemies).activeConditions,
  }
}
