import type { BuildPath, GameMode, Role } from '@/types/app'

// Machine-aggregated builds generated offline from high-elo Match-V5 data by
// `scripts/aggregate-builds.mjs` (re-run each patch). This is the base "pro
// build" layer: the adaptive engine (src/lib/builder.ts) then adjusts it
// case-by-case for the live enemy comp. Consulted after the hand-authored seeds
// and before the scoring engine — see findBuild.
//
// The dataset is large (hundreds of KB), so it's a **dynamic import** split into
// its own chunk and pulled in on first use rather than shipped in the initial
// bundle. loadAggregatedBuilds() populates the module cache that the synchronous
// findAggregatedBuild() reads; components/hooks that depend on it call the
// useAggregatedBuilds() hook so the chunk loads and they re-render when it's
// ready. Until it resolves, findAggregatedBuild() returns null and callers fall
// back to a seed or the scoring engine.

// Below this many observations we don't trust an aggregated build at all — it
// won't even stand in for the scoring engine. Start low for small ingests; raise
// toward ~50 once you're aggregating thousands of matches.
export const MIN_AGGREGATED_SAMPLE = 5

// At or above this sample the aggregated build is confident enough to supersede
// a hand-authored seed (it's current-patch, real data, and carries
// comp-conditioned situationals). Below it, the seed still wins.
export const PREFER_AGGREGATED_SAMPLE = 40

let cache: BuildPath[] = []
let pending: Promise<BuildPath[]> | null = null

/**
 * Lazily fetch the aggregated-builds chunks (memoized). The SR and ARAM datasets
 * are separate files (ARAM is per-champion, roleless) merged into one cache;
 * findAggregatedBuild filters by mode.
 */
export function loadAggregatedBuilds(): Promise<BuildPath[]> {
  if (!pending) {
    pending = Promise.all([
      import('./aggregatedBuilds.json'),
      import('./aggregatedBuildsAram.json'),
    ]).then(([sr, aram]) => {
      cache = [
        ...(sr.default as unknown as BuildPath[]),
        ...(aram.default as unknown as BuildPath[]),
      ]
      return cache
    })
  }
  return pending
}

/**
 * Champions with a usable aggregated build in a mode (empty until the chunk
 * loads) — drives coverage badges/copy alongside the hand-authored seeds.
 */
export function aggregatedChampionIds(mode: GameMode): Set<string> {
  const ids = new Set<string>()
  for (const b of cache) {
    if (b.mode === mode && (b.sampleSize ?? 0) >= MIN_AGGREGATED_SAMPLE) ids.add(b.championId)
  }
  return ids
}

/**
 * The aggregated build for a champion in a mode, or null if none clears the
 * sample floor (or the dataset hasn't loaded yet). ARAM is roleless — one build
 * per champion. For SR, a role selects; with no role, the most-played build.
 */
export function findAggregatedBuild(
  championId: string,
  role: Role | null | undefined,
  mode: GameMode,
): BuildPath | null {
  const candidates = cache.filter(
    (b) =>
      b.championId === championId &&
      b.mode === mode &&
      (b.sampleSize ?? 0) >= MIN_AGGREGATED_SAMPLE,
  )
  if (candidates.length === 0) return null
  const mostPlayed = () =>
    [...candidates].sort((a, b) => (b.sampleSize ?? 0) - (a.sampleSize ?? 0))[0]
  if (mode === 'ARAM') return mostPlayed()
  if (role) return candidates.find((b) => b.role === role) ?? null
  return mostPlayed()
}
