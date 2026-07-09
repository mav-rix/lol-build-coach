import type { BuildPath, GameMode, Role } from '@/types/app'
import raw from './aggregatedBuilds.json'

// Machine-aggregated builds generated offline from high-elo Match-V5 data by
// `scripts/aggregate-builds.mjs` (re-run each patch). This is the base "pro
// build" layer: the adaptive engine (src/lib/builder.ts) then adjusts it
// case-by-case for the live enemy comp. Consulted after the hand-authored
// seeds and before the scoring engine — see findBuild. Phase 1 builds carry no
// situationalItems yet (that's Phase 2's comp-conditioned aggregation), so the
// live situational swaps only fire for seeded champs for now.
export const AGGREGATED_BUILDS = raw as unknown as BuildPath[]

// Below this many observations we don't trust an aggregated build at all — it
// won't even stand in for the scoring engine. Start low for small ingests; raise
// toward ~50 once you're aggregating thousands of matches.
export const MIN_AGGREGATED_SAMPLE = 5

// At or above this sample the aggregated build is confident enough to supersede
// a hand-authored seed (it's current-patch, real data, and — post Phase 2 —
// carries comp-conditioned situationals). Below it, the seed still wins.
export const PREFER_AGGREGATED_SAMPLE = 40

/**
 * The aggregated build for a champion+role, or null if none clears the sample
 * floor. SR only (ARAM isn't ingested). When no role is given, returns the
 * champion's most-played aggregated build.
 */
export function findAggregatedBuild(
  championId: string,
  role: Role | null | undefined,
  mode: GameMode,
): BuildPath | null {
  if (mode !== 'SR') return null
  const candidates = AGGREGATED_BUILDS.filter(
    (b) =>
      b.championId === championId &&
      b.mode === 'SR' &&
      (b.sampleSize ?? 0) >= MIN_AGGREGATED_SAMPLE,
  )
  if (candidates.length === 0) return null
  if (role) return candidates.find((b) => b.role === role) ?? null
  return candidates.sort((a, b) => (b.sampleSize ?? 0) - (a.sampleSize ?? 0))[0]
}
