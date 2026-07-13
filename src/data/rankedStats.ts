import type { RankedStatsData } from '@/lib/draft'

// Per-elo ranked champion stats generated offline by
// scripts/aggregate-ranked-stats.mjs (re-run each patch alongside the build
// aggregation). Dynamic import so the dataset stays out of the initial bundle,
// mirroring aggregatedBuilds.ts.

let cache: RankedStatsData | null = null
let pending: Promise<RankedStatsData | null> | null = null

/** Lazily fetch the ranked-stats chunk (memoized). Null if the file is empty. */
export function loadRankedStats(): Promise<RankedStatsData | null> {
  if (!pending) {
    pending = import('./rankedChampStats.json').then((mod) => {
      const data = mod.default as unknown as RankedStatsData
      cache = data?.buckets && Object.keys(data.buckets).length > 0 ? data : null
      return cache
    })
  }
  return pending
}

/** The loaded dataset, or null until loadRankedStats resolves. */
export const getRankedStats = (): RankedStatsData | null => cache
