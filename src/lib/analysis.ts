import type {
  AnalysisTip,
  BuildPath,
  BuildTimelineEntry,
  MatchAnalysis,
  MatchStats,
  TimelineComparison,
} from '@/types/app'
import type { DDragonItem } from '@/types/ddragon'
import { MODE_CONFIG } from '@/lib/modes'

const BOOT_IDS = new Set([1001, 3006, 3009, 3020, 3047, 3111, 3117, 3158])

function isBoots(itemId: number, items?: Record<string, DDragonItem>) {
  if (BOOT_IDS.has(itemId)) return true
  return items?.[String(itemId)]?.tags.includes('Boots') ?? false
}

/**
 * Project an expected completion time for each core item + first boots,
 * based on cumulative cost at the mode's average income rate.
 */
export function expectedTimeline(
  build: BuildPath,
  items: Record<string, DDragonItem>,
): BuildTimelineEntry[] {
  const { startingGold, goldPerMin } = MODE_CONFIG[build.mode]
  const starters = build.starterItems.filter(
    (id) => !(items[String(id)]?.tags.includes('Consumable') ?? false),
  )
  const plan = [
    ...starters.map((id) => ({ id, cost: items[String(id)]?.gold.total ?? 0 })),
    ...(build.bootsOptions[0]
      ? [{ id: build.bootsOptions[0], cost: items[String(build.bootsOptions[0])]?.gold.total ?? 1100 }]
      : []),
    ...build.coreItems.map((id) => ({ id, cost: items[String(id)]?.gold.total ?? 3000 })),
  ]
  let spent = 0
  return plan.map(({ id, cost }) => {
    spent += cost
    const gameTime = Math.max(0, ((spent - startingGold) / goldPerMin) * 60)
    return { itemId: id, gameTime: Math.round(gameTime), goldAtTime: spent }
  })
}

/**
 * Pure analysis engine: compares an actual purchase timeline against the
 * expected build path and produces a score, comparison rows, and tips.
 */
export function analyzeMatch(
  actualBuild: BuildTimelineEntry[],
  expectedBuild: BuildPath,
  stats: MatchStats,
  items: Record<string, DDragonItem>,
): MatchAnalysis {
  const expected = expectedTimeline(expectedBuild, items)
  const purchasesById = new Map<number, BuildTimelineEntry>()
  for (const entry of actualBuild) {
    if (!purchasesById.has(entry.itemId)) purchasesById.set(entry.itemId, entry)
  }

  const timelineComparison: TimelineComparison[] = expected.map((exp) => {
    const actual = purchasesById.get(exp.itemId) ?? null
    return {
      itemId: exp.itemId,
      isCore: expectedBuild.coreItems.includes(exp.itemId),
      actualTime: actual ? actual.gameTime : null,
      expectedTime: exp.gameTime,
      deviation: actual ? actual.gameTime - exp.gameTime : null,
    }
  })

  const coreComparisons = timelineComparison.filter((c) => c.isCore)
  const coreCompleted = coreComparisons.every((c) => c.actualTime !== null)
  const minutes = stats.duration / 60
  const csPerMin = minutes > 0 ? stats.cs / minutes : 0
  const damagePerGold = stats.goldEarned > 0 ? stats.damageDealt / stats.goldEarned : 0

  const modeConfig = MODE_CONFIG[expectedBuild.mode]

  // Scoring rules from the spec (section 10, prompt 7); CS bar varies by mode.
  let score = 50
  if (coreCompleted) score += 20
  for (const c of coreComparisons) {
    if (c.deviation === null) continue
    if (Math.abs(c.deviation) <= 60) score += 15
    else if (c.deviation > 120) score -= 10
  }
  if (stats.result === 'WIN') score += 10
  if (csPerMin >= modeConfig.csGoodPerMin) score += 10
  if (damagePerGold < 0.8) score -= 10
  const efficiencyScore = Math.max(0, Math.min(100, score))

  const tips: AnalysisTip[] = []
  const itemName = (id: number) => items[String(id)]?.name ?? `Item ${id}`

  const firstCore = coreComparisons[0]
  if (firstCore && firstCore.deviation !== null && firstCore.deviation > 120) {
    tips.push({
      type: 'negative',
      category: 'timing',
      message: `Delayed first item — ${itemName(firstCore.itemId)} came ${Math.round(
        firstCore.deviation / 60,
      )}+ min late. ${
        modeConfig.hasRecall
          ? 'Focus on CS and recall timing.'
          : 'Focus on CS and poke gold — every death is a shopping trip.'
      }`,
      data: { itemId: firstCore.itemId, deviation: firstCore.deviation },
    })
  }

  const bootsPurchase = actualBuild.find((e) => isBoots(e.itemId, items))
  if (
    (!bootsPurchase || bootsPurchase.gameTime > modeConfig.bootsDeadlineS) &&
    stats.duration > modeConfig.bootsDeadlineS
  ) {
    tips.push({
      type: 'negative',
      category: 'itemization',
      message: `No boots by ${Math.round(
        modeConfig.bootsDeadlineS / 60,
      )} minutes. Consider buying boots earlier for map mobility.`,
    })
  }

  const onTime =
    coreCompleted &&
    coreComparisons.every((c) => c.deviation !== null && c.deviation <= 60)
  if (stats.result === 'WIN' && onTime) {
    tips.push({
      type: 'positive',
      category: 'timing',
      message: 'Excellent build timing! Your items were perfectly paced.',
    })
  }

  if (damagePerGold < 0.6) {
    tips.push({
      type: 'negative',
      category: 'general',
      message: `Your damage output was low (${damagePerGold.toFixed(
        2,
      )} damage per gold). Consider more aggressive positioning.`,
    })
  }

  for (const c of coreComparisons) {
    if (c.deviation !== null && c.deviation > 120 && c !== firstCore) {
      tips.push({
        type: 'negative',
        category: 'timing',
        message: `${itemName(c.itemId)} completed ${formatDeviation(c.deviation)} late (bought at ${formatClock(
          c.actualTime ?? 0,
        )}, target ${formatClock(c.expectedTime)}).`,
      })
    }
  }
  for (const c of coreComparisons) {
    if (c.actualTime === null && stats.duration > c.expectedTime + 180) {
      tips.push({
        type: 'neutral',
        category: 'itemization',
        message: `${itemName(c.itemId)} was never completed despite the game running past its target timing.`,
      })
    }
  }

  if (csPerMin >= modeConfig.csGoodPerMin) {
    tips.push({
      type: 'positive',
      category: 'general',
      message: `Strong farming: ${csPerMin.toFixed(1)} CS/min.`,
    })
  } else if (csPerMin > 0 && csPerMin < modeConfig.csLowPerMin && minutes >= 12) {
    tips.push({
      type: 'neutral',
      category: 'general',
      message: `${csPerMin.toFixed(1)} CS/min — every 15 CS is roughly one kill of gold. Aim for ${modeConfig.csGoodPerMin}+.`,
    })
  }

  return { efficiencyScore, timelineComparison, tips }
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDeviation(seconds: number): string {
  const abs = Math.abs(seconds)
  const m = Math.floor(abs / 60)
  const s = Math.round(abs % 60)
  const body = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
  return seconds >= 0 ? `+${body}` : `−${body}`
}
