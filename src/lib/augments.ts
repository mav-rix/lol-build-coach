// Augment goal list for augmented Abyss modes (ARAM Mayhem). The Live Client
// API exposes neither the augment offer nor your picks, so the overlay can't
// react to the pick screen — instead it shows the highest win-rate augments FOR
// YOUR CHAMPION as goals: when the offer appears, take one of these, otherwise
// reroll. Champion-specific rows (from Arena Match-V5, where augments live in
// the API) are blended with the global ranking so thin samples degrade
// gracefully.
//
// Two pools are bundled, both aggregated from the same Arena Match-V5 data
// (see aggregate-augments.mjs) but scoped by different metadata files (see
// fetch-augments.mjs):
//   - augments.json / augmentStats.json / augmentChampStats.json — intersected
//     with the CURRENT Mayhem pool. What the Mayhem overlay's vision matcher
//     and badges use (augmentBadgeFor, championPriorityKeys, visionManifest) —
//     it must never show an augment that can't actually appear in Mayhem.
//   - augmentsArena.json / augmentStatsArena.json / augmentChampStatsArena.json
//     — the FULL real Arena pool, Arena's own rarity. What Arena-facing
//     features use (topAugmentsFor, the Build page's pre-game panel) — Mayhem's
//     pool is roughly half the size of Arena's, so using the intersected set
//     there would silently hide real Arena augments.
// All data files are lazy-imported, mirroring aggregatedBuilds.ts, so they
// stay out of the initial bundle.

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
  firstRate: number // % of games finishing 1st
  // % of players (of that champion, for per-champ rows) who took this augment.
  // Optional: rows merged forward from pre-pickRate data files won't have it.
  pickRate?: number
}

export interface AugmentGoal extends AugmentStat {
  meta: AugmentMeta
  source: 'champion' | 'global'
}

// ARAM Mayhem stats scraped from op.gg (see scripts/fetch-mayhem-stats.mjs) —
// the only source, since Riot's Match-V5 doesn't index the Mayhem queue.
// pickRate is a real %; `score` is op.gg's opaque composite (ranges past 100,
// NOT a win rate); tier is op.gg's 0=S…4=D ranking. Keyed by Riot augment id.
export interface MayhemChampStat {
  pickRate: number
  score: number
  tier: number
}
export interface MayhemStat extends MayhemChampStat {
  name: string
  canon: string
  champions: Record<string, MayhemChampStat> // Data Dragon champion id → row
}

// The three pickable tiers; anything else is a utility pseudo-augment.
const RARITY_RANK = { prismatic: 0, gold: 1, silver: 2 } as const

interface AugmentData {
  metaById: Map<number, AugmentMeta>
  global: AugmentStat[]
  byChamp: Record<string, AugmentStat[]>
  mayhemByCanon: Map<string, MayhemStat>
  // Full Arena pool (not intersected with Mayhem) — see fetch-augments.mjs.
  // Used by Arena-facing features that want the complete picture; the fields
  // above stay Mayhem-scoped for the overlay's vision/badge system.
  arenaMetaById: Map<number, AugmentMeta>
  arenaGlobal: AugmentStat[]
  arenaByChamp: Record<string, AugmentStat[]>
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
      import('@/data/mayhemAugmentStats.json'),
      import('@/data/augmentsArena.json'),
      import('@/data/augmentStatsArena.json'),
      import('@/data/augmentChampStatsArena.json'),
    ]).then(([meta, global, byChamp, mayhem, arenaMeta, arenaGlobal, arenaByChamp]) => {
      const mayhemById = mayhem.default as unknown as Record<string, MayhemStat>
      cache = {
        metaById: new Map(
          (meta.default as unknown as AugmentMeta[]).map((a) => [a.id, a]),
        ),
        global: global.default as unknown as AugmentStat[],
        byChamp: byChamp.default as unknown as Record<string, AugmentStat[]>,
        mayhemByCanon: new Map(Object.values(mayhemById).map((s) => [s.canon, s])),
        arenaMetaById: new Map(
          (arenaMeta.default as unknown as AugmentMeta[]).map((a) => [a.id, a]),
        ),
        arenaGlobal: arenaGlobal.default as unknown as AugmentStat[],
        arenaByChamp: arenaByChamp.default as unknown as Record<string, AugmentStat[]>,
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
// Mayhem-only augments have no Arena id — so no Match-V5 stats and no
// augments.json row. They're still in the live offer pool, so the vision
// pipeline needs their names (for title OCR) and icons (as detector
// templates). augmentExtras.json is generated from CDragon's game data
// (cherry-augments.json, every kiwi-icon entry); keys are "x:<id>" so badge
// rendering knows there's no stats row behind them.
import extraData from '@/data/augmentExtras.json'
const EXTRA_TEMPLATES = extraData as { key: string; name: string; rarity: string | null; icon: string }[]

export interface VisionTemplate {
  key: string
  name: string
  icon: string
}

/** Icon manifest for the screen matcher: every known augment + the no-stats
 *  Mayhem-only extras. Empty until loadAugmentData() has resolved. */
export function visionManifest(): VisionTemplate[] {
  if (!cache) return []
  return [
    ...[...cache.metaById.values()].map((m) => ({ key: String(m.id), name: m.name, icon: m.icon })),
    ...EXTRA_TEMPLATES,
  ]
}

export interface AugmentBadge {
  name: string
  rarity: string | null
  stat: AugmentStat | null
  source: 'champion' | 'global' | null
  // Mayhem (op.gg) stats when this augment is in the Mayhem pool. pickRate is a
  // real % (per-champion when `mayhemSource === 'champion'`, else pool-wide),
  // tier is op.gg's 0=S…4=D. Preferred over `stat` for display — these badges
  // only render in Mayhem, where op.gg's numbers are mode-accurate.
  mayhem: MayhemChampStat | null
  mayhemSource: 'champion' | 'global' | null
}

const canonName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Badge content for a matched template key. In ARAM Mayhem (the only place
 *  these render) op.gg's per-champion pick rate is the headline; Arena stats
 *  and name-only fall back when an augment isn't in op.gg's Mayhem table. */
export function augmentBadgeFor(championId: string | null, key: string): AugmentBadge | null {
  const extra = EXTRA_TEMPLATES.find((t) => t.key === key)
  let name: string | null = null
  let rarity: string | null = null
  if (extra) {
    name = extra.name
    rarity = extra.rarity
    const twin = cache
      ? [...cache.metaById.values()].find((m) => m.name.toLowerCase() === extra.name.toLowerCase())
      : undefined
    if (twin) key = String(twin.id)
  }
  if (!cache) return name ? { name, rarity, stat: null, source: null, mayhem: null, mayhemSource: null } : null

  const meta = cache.metaById.get(Number(key))
  if (meta) {
    name = meta.name
    rarity = meta.rarity
  }
  if (!name) return null

  // Mayhem stats first — mode-accurate. Per-champion row when we have it.
  const mayhem = cache.mayhemByCanon.get(canonName(name)) ?? null
  const champMayhem = mayhem && championId ? mayhem.champions[championId] : undefined
  const mayhemStat = champMayhem ?? (mayhem ? { pickRate: mayhem.pickRate, score: mayhem.score, tier: mayhem.tier } : null)
  const mayhemSource = champMayhem ? 'champion' : mayhem ? 'global' : null

  // Arena stats as a fallback signal (dual-pool augments not in op.gg's table).
  let stat: AugmentStat | null = null
  let source: 'champion' | 'global' | null = null
  if (meta) {
    const champRow = championId
      ? (cache.byChamp[championId] ?? []).find((s) => s.id === meta.id)
      : undefined
    if (champRow) {
      stat = champRow
      source = 'champion'
    } else {
      stat = cache.global.find((s) => s.id === meta.id) ?? null
      source = stat ? 'global' : null
    }
  }
  return { name, rarity, stat, source, mayhem: mayhemStat, mayhemSource }
}

/**
 * Ranked augment keys (numeric ids + "x:" extras) most likely for this
 * champion, for the vision matcher's priority-first OCR pass. Every known
 * augment gets a score — the champion's own Mayhem row when op.gg has one,
 * else the augment's global row — so this never invents or excludes
 * anything, it only reorders. Augments with no Mayhem data at all (never
 * scraped) are omitted here but remain fully matchable via the full-list
 * fallback in electron/augment-vision.js.
 */
export function championPriorityKeys(championId: string | null, topK = 40): string[] {
  if (!cache || !championId) return []
  const scored: { key: string; value: number }[] = []
  const scoreOf = (m: MayhemStat) => (m.champions[championId] ?? m).score
  for (const m of cache.metaById.values()) {
    const mayhem = cache.mayhemByCanon.get(canonName(m.name))
    if (mayhem) scored.push({ key: String(m.id), value: scoreOf(mayhem) })
  }
  for (const e of EXTRA_TEMPLATES) {
    const mayhem = cache.mayhemByCanon.get(canonName(e.name))
    if (mayhem) scored.push({ key: e.key, value: scoreOf(mayhem) })
  }
  scored.sort((a, b) => b.value - a.value)
  return scored.slice(0, topK).map((s) => s.key)
}

/** Top Arena augments for a champion — the FULL Arena pool (not intersected
 *  with Mayhem's smaller one), for the pre-game Build page. */
export function topAugmentsFor(championId: string | null, count = 6): AugmentGoal[] {
  if (!cache || !championId) return []
  const { arenaMetaById, arenaGlobal, arenaByChamp } = cache
  const out: AugmentGoal[] = []
  const seen = new Set<number>()
  const push = (s: AugmentStat, source: AugmentGoal['source']) => {
    const meta = arenaMetaById.get(s.id)
    // Meta guard: augmentsArena.json is filtered to real pickable rarities, so
    // stats rows without metadata (utility pseudo-augments, stat anvils, or
    // anything retired since the stats were aggregated) never surface as goals.
    if (!meta || seen.has(s.id) || !(meta.rarity in RARITY_RANK)) return
    seen.add(s.id)
    out.push({ ...s, meta, source })
  }
  for (const s of arenaByChamp[championId] ?? []) {
    if (out.length >= count) break
    push(s, 'champion')
  }
  for (const s of arenaGlobal) {
    if (out.length >= count) break
    push(s, 'global')
  }
  return out
}
