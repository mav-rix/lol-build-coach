// Augment goal list for augmented Abyss modes (ARAM Mayhem). The Live Client
// API exposes neither the augment offer nor your picks, so the overlay can't
// react to the pick screen — instead it shows the highest win-rate augments FOR
// YOUR CHAMPION as goals: when the offer appears, take one of these, otherwise
// reroll. Champion-specific rows (from Arena Match-V5, where augments live in
// the API) are blended with the global ranking so thin samples degrade
// gracefully. All three data files are lazy-imported, mirroring
// aggregatedBuilds.ts, so they stay out of the initial bundle.

export interface AugmentMeta {
  id: number
  name: string
  rarity: string // 'prismatic' | 'gold' | 'silver' | 'other'
  desc: string
  icon: string
}

export interface AugmentStat {
  id: number
  games: number
  avgPlacement: number // 1–8, lower is better
  firstRate: number
}

export interface AugmentGoal extends AugmentStat {
  meta: AugmentMeta
  source: 'champion' | 'global'
}

// The three pickable tiers; anything else is a utility pseudo-augment.
const RARITY_RANK = { prismatic: 0, gold: 1, silver: 2 } as const

interface AugmentData {
  metaById: Map<number, AugmentMeta>
  global: AugmentStat[]
  byChamp: Record<string, AugmentStat[]>
}

let cache: AugmentData | null = null
let pending: Promise<AugmentData> | null = null

/** Lazily fetch augment metadata + global and per-champion stats (memoized). */
export function loadAugmentData(): Promise<AugmentData> {
  if (!pending) {
    pending = Promise.all([
      import('@/data/augments.json'),
      import('@/data/augmentStats.json'),
      import('@/data/augmentChampStats.json'),
    ]).then(([meta, global, byChamp]) => {
      cache = {
        metaById: new Map(
          (meta.default as unknown as AugmentMeta[]).map((a) => [a.id, a]),
        ),
        global: global.default as unknown as AugmentStat[],
        byChamp: byChamp.default as unknown as Record<string, AugmentStat[]>,
      }
      return cache
    })
  }
  return pending
}

/**
 * Top augment goals for a champion: champion-specific rows first (they already
 * cleared the aggregator's per-pair sample floor), then the global ranking
 * fills the rest. Returns [] until loadAugmentData() has resolved.
 */
export function topAugmentsFor(championId: string | null, count = 6): AugmentGoal[] {
  if (!cache || !championId) return []
  const { metaById, global, byChamp } = cache
  const out: AugmentGoal[] = []
  const seen = new Set<number>()
  const push = (s: AugmentStat, source: AugmentGoal['source']) => {
    const meta = metaById.get(s.id)
    // Rarity guard: utility pseudo-augments (Replace Augment, stat anvils) can
    // linger in stats aggregated against older metadata — never goal-worthy.
    if (!meta || seen.has(s.id) || !(meta.rarity in RARITY_RANK)) return
    seen.add(s.id)
    out.push({ ...s, meta, source })
  }
  for (const s of byChamp[championId] ?? []) {
    if (out.length >= count) break
    push(s, 'champion')
  }
  for (const s of global) {
    if (out.length >= count) break
    push(s, 'global')
  }
  return out
}
