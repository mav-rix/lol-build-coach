import { analyzeEnemyComp } from '@/lib/situational'
import { GRIEVOUS_AD, GRIEVOUS_AP, PERCENT_HP } from '@/lib/scoring'
import type { BuildPath, SituationalCondition } from '@/types/app'
import type { DDragonChampion, DDragonItem } from '@/types/ddragon'

// The game plan: both build categories, decided ONCE when the enemy comp is
// known (the first live poll — i.e. the loading screen) and stable from then on.
//
//   1. WR build   — the highest win-rate build for the champion, as aggregated
//                   (or the hand-authored seed). Untouched by the comp.
//   2. vs-comp    — the WR build with up to two comp-driven swaps (anti-heal vs
//                   healers, pen/%HP vs tanks, a defensive last item vs a
//                   damage-skewed comp) plus a boots swap vs AP/CC or AD.
//
// The plan is deliberately NOT live-reactive: knowing *when* to deviate is
// decided from the comp before the game starts, so the path doesn't churn
// mid-game. Build Next simply walks the active path.

export type PlanLabel = 'starter' | 'boots' | 'core'

export interface GamePlanItem {
  itemId: number
  label: PlanLabel
  /** Set when this slot was comp-swapped in — the why, for tooltips. */
  swapReason?: string
}

export interface PlanSwap {
  inItemId: number
  outItemId: number
  condition: SituationalCondition
  reason: string
}

export interface GamePlan {
  /** Category 1 — the unmodified highest win-rate path. */
  wrItems: GamePlanItem[]
  /** Category 2 — the comp-adjusted path (equals wrItems when no signals). */
  compItems: GamePlanItem[]
  swaps: PlanSwap[]
  /** Which category Build Next follows: comp when any signal fired. */
  active: 'wr' | 'comp'
  /** One-line comp reads shown alongside the plan. */
  compSummary: string[]
}

const BOOTS_VS = { apCc: 3111, ad: 3047 } // Mercury's Treads / Plated Steelcaps

const isAP = (c: DDragonChampion) =>
  c.tags.includes('Mage') || (!c.tags.includes('Marksman') && c.info.magic > c.info.attack)

function pathOf(build: BuildPath): GamePlanItem[] {
  return [
    ...build.starterItems.map((id): GamePlanItem => ({ itemId: id, label: 'starter' })),
    ...(build.bootsOptions[0]
      ? [{ itemId: build.bootsOptions[0], label: 'boots' as const }]
      : []),
    ...build.coreItems.map((id): GamePlanItem => ({ itemId: id, label: 'core' })),
  ]
}

/** First situational matching a condition that isn't already in the path. */
function pickSituational(
  build: BuildPath,
  condition: SituationalCondition,
  inPath: Set<number>,
  fallback?: ReadonlySet<number>,
): number | null {
  const fromBuild = build.situationalItems.find(
    (s) => s.condition === condition && !inPath.has(s.itemId),
  )
  if (fromBuild) return fromBuild.itemId
  if (fallback) for (const id of fallback) if (!inPath.has(id)) return id
  return null
}

/**
 * Compute the game plan for a build against a known enemy comp. Pure — callers
 * memoize on the comp signature so the plan stays fixed for the whole game.
 */
export function buildGamePlan(
  build: BuildPath,
  champion: DDragonChampion | null,
  enemies: DDragonChampion[],
  items: Record<string, DDragonItem>,
): GamePlan {
  const wrItems = pathOf(build)
  const comp = analyzeEnemyComp(enemies)
  const cond = comp.activeConditions
  const compItems = wrItems.map((p) => ({ ...p }))
  const swaps: PlanSwap[] = []
  const known = (id: number) => items[String(id)] !== undefined
  const inPath = new Set(compItems.map((p) => p.itemId))
  const nameOf = (id: number) => items[String(id)]?.name ?? `Item ${id}`
  const ap = champion ? isAP(champion) : false

  // Boots swap — Mercury's vs AP/CC, Steelcaps vs AD. Doesn't count toward the
  // two core swaps.
  const bootsSlot = compItems.find((p) => p.label === 'boots')
  if (bootsSlot) {
    const target = cond.has('enemy_heavy_ap') || cond.has('enemy_heavy_cc')
      ? { id: BOOTS_VS.apCc, why: 'Mercury’s — tenacity/MR into their AP/CC' }
      : cond.has('enemy_heavy_ad')
        ? { id: BOOTS_VS.ad, why: 'Steelcaps — armor into their AD threats' }
        : null
    if (target && target.id !== bootsSlot.itemId && known(target.id)) {
      swaps.push({
        inItemId: target.id,
        outItemId: bootsSlot.itemId,
        condition: cond.has('enemy_heavy_ap') || cond.has('enemy_heavy_cc') ? 'enemy_heavy_cc' : 'enemy_heavy_ad',
        reason: target.why,
      })
      bootsSlot.itemId = target.id
      bootsSlot.swapReason = target.why
    }
  }

  // Core swaps — replace from the BACK of the core path (the least essential
  // slots), capped at two so the build keeps its identity.
  const coreSlots = compItems.filter((p) => p.label === 'core')
  let replaceIdx = coreSlots.length - 1
  const coreSwap = (condition: SituationalCondition, itemId: number | null, reason: string) => {
    if (itemId === null || replaceIdx < 0 || swaps.filter((s) => s.condition !== 'general').length >= 3) return
    if (!known(itemId) || inPath.has(itemId)) return
    const slot = coreSlots[replaceIdx--]
    swaps.push({ inItemId: itemId, outItemId: slot.itemId, condition, reason })
    inPath.add(itemId)
    slot.itemId = itemId
    slot.swapReason = reason
  }

  if (cond.has('enemy_has_healing')) {
    const id = pickSituational(build, 'enemy_has_healing', inPath, ap ? GRIEVOUS_AP : GRIEVOUS_AD)
    if (id !== null) coreSwap('enemy_has_healing', id, `${nameOf(id)} — anti-heal for their sustain`)
  }
  if (cond.has('enemy_has_tanks')) {
    const id = pickSituational(build, 'enemy_has_tanks', inPath, ap ? undefined : PERCENT_HP)
    if (id !== null) coreSwap('enemy_has_tanks', id, `${nameOf(id)} — cuts through their tanks`)
  }
  // Damage-skewed comp → one defensive slot, only if a swap slot remains.
  const defCond: SituationalCondition | null = cond.has('enemy_heavy_ap')
    ? 'enemy_heavy_ap'
    : cond.has('enemy_heavy_ad')
      ? 'enemy_heavy_ad'
      : null
  if (defCond && swaps.filter((s) => s.condition !== 'general').length < 3) {
    const id = pickSituational(build, defCond, inPath)
    if (id !== null)
      coreSwap(defCond, id, `${nameOf(id)} — survive their ${defCond === 'enemy_heavy_ap' ? 'AP' : 'AD'} damage`)
  }

  return {
    wrItems,
    compItems,
    swaps,
    active: swaps.length > 0 ? 'comp' : 'wr',
    compSummary: comp.summary,
  }
}
