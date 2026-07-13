import { useEffect, useState } from 'react'
import { loadRankedStats } from '@/data/rankedStats'
import type { RankedStatsData } from '@/lib/draft'

/**
 * Kicks off the lazy load of the ranked champion-stats chunk and re-renders
 * once it's ready. Null while loading or when no dataset has been generated.
 */
export function useRankedStats(): RankedStatsData | null {
  const [data, setData] = useState<RankedStatsData | null>(null)
  useEffect(() => {
    let active = true
    loadRankedStats().then((d) => {
      if (active) setData(d)
    })
    return () => {
      active = false
    }
  }, [])
  return data
}
