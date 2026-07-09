import { CONDITION_LABELS } from '@/lib/situational'
import { unavailableItems } from '@/lib/itemAvailability'
import type { LiveThreatAnalysis } from '@/lib/threats'
import type { ModeConfig } from '@/lib/modes'
import type { BuildPath } from '@/types/app'
import type { DDragonItem } from '@/types/ddragon'
import type { LivePlayer } from '@/types/live'

// The adaptive item builder decides what to buy NEXT given: the champion's
// remaining build path, what the enemy has actually purchased (via threats),
// and how the game is going for you. It reuses the same scoreboard-only data
// as the threats engine — no fog-of-war information.

export type RecPriority = 'urgent' | 'recommended' | 'planned'

export interface BuildRec {
  itemId: number
  name: string
  cost: number
  priority: RecPriority
  reason: string
  affordable: boolean
  goldNeeded: number
  source: 'core' | 'situational' | 'defensive'
}

const BOOT_IDS = new Set([1001, 3006, 3009, 3020, 3047, 3111, 3117, 3158])

function isBoots(item: DDragonItem | undefined, itemId: number): boolean {
  return BOOT_IDS.has(itemId) || (item?.tags.includes('Boots') ?? false)
}

/**
 * Rank the next purchases. Core path items keep their order, but a situational
 * item whose live condition is active gets promoted ahead of the next core
 * item — e.g. anti-heal jumps the queue the moment an enemy completes healing.
 */
export function recommendPurchases(
  build: BuildPath,
  ownedIds: Set<number>,
  gold: number,
  threats: LiveThreatAnalysis | null,
  self: LivePlayer | null,
  items: Record<string, DDragonItem>,
  modeConfig: ModeConfig,
): BuildRec[] {
  const recs: BuildRec[] = []
  const seen = new Set<number>()
  // Items already consumed into what you own, or made unbuildable by a
  // one-per-inventory conflict (e.g. a second Tear item) — never worth showing.
  const blocked = unavailableItems(ownedIds, items)

  const nameOf = (id: number) => items[String(id)]?.name ?? `Item ${id}`
  const costOf = (id: number) => items[String(id)]?.gold.total ?? 0
  const push = (
    itemId: number,
    priority: RecPriority,
    reason: string,
    source: BuildRec['source'],
  ) => {
    if (seen.has(itemId) || ownedIds.has(itemId) || blocked.has(itemId)) return
    seen.add(itemId)
    const cost = costOf(itemId)
    recs.push({
      itemId,
      name: nameOf(itemId),
      cost,
      priority,
      reason,
      affordable: gold >= cost,
      goldNeeded: Math.max(0, Math.ceil(cost - gold)),
      source,
    })
  }

  const activeConditions = threats?.activeConditions ?? new Set(['general'])

  // 1) Boots first if not yet bought and past the mode's boots deadline window.
  const firstBoots = build.bootsOptions[0]
  if (firstBoots && !ownedIds.has(firstBoots)) {
    const hasAnyBoots = [...ownedIds].some((id) => isBoots(items[String(id)], id))
    if (!hasAnyBoots) {
      push(firstBoots, 'recommended', 'Early boots for map mobility', 'core')
    }
  }

  // 2) Situational promotions — active enemy signals outrank remaining core.
  const activeSituationals = build.situationalItems.filter(
    (s) => s.condition !== 'general' && activeConditions.has(s.condition),
  )
  for (const s of activeSituationals) {
    push(
      s.itemId,
      'urgent',
      `${CONDITION_LABELS[s.condition]} — ${s.description}`,
      'situational',
    )
  }

  // 3) Defensive pivot: if you're dying a lot, suggest a survivability item
  //    from the situational pool (GA/Zhonya/Maw-type items live there).
  const deaths = self?.scores.deaths ?? 0
  const kills = self?.scores.kills ?? 0
  if (deaths >= 5 && deaths > kills + 2) {
    const defensive = build.situationalItems.find((s) => {
      const item = items[String(s.itemId)]
      return (
        item &&
        (item.tags.includes('Armor') ||
          item.tags.includes('SpellBlock') ||
          item.tags.includes('Health'))
      )
    })
    if (defensive) {
      push(
        defensive.itemId,
        'urgent',
        `You've died ${deaths} times — a defensive item helps you stay in fights`,
        'defensive',
      )
    }
  }

  // 4) Remaining core items in order.
  for (const id of build.coreItems) {
    push(id, 'planned', 'Next in your core build path', 'core')
  }

  // 5) Any remaining situationals as longer-term options.
  for (const s of build.situationalItems) {
    push(s.itemId, 'planned', s.description, 'situational')
  }

  // Order: urgent → recommended → planned, and within a tier put affordable
  // items first so the top card is always something you can buy right now.
  const rank: Record<RecPriority, number> = { urgent: 0, recommended: 1, planned: 2 }
  recs.sort((a, b) => {
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority]
    if (a.affordable !== b.affordable) return a.affordable ? -1 : 1
    return a.cost - b.cost
  })

  // Cap the visible list — top 5 is plenty for an in-game glance.
  void modeConfig
  return recs.slice(0, 5)
}
