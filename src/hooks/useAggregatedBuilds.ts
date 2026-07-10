import { useEffect, useState } from 'react'
import { loadAggregatedBuilds } from '@/data/aggregatedBuilds'

/**
 * Kicks off the lazy load of the aggregated-builds chunk and re-renders once
 * it's ready, so the synchronous findBuild() picks up aggregated builds. Call it
 * in any component/hook that resolves builds via findBuild. Returns true once
 * the dataset has loaded (already-loaded mounts flip to true on first effect).
 */
export function useAggregatedBuilds(): boolean {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true
    loadAggregatedBuilds().then(() => {
      if (active) setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])
  return loaded
}
