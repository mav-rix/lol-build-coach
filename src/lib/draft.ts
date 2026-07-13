import { HEAVY_CC } from '@/lib/situational'
import { enemyCounterConditions, type CounterCondition } from '@/lib/counterpick'
import type { Role } from '@/types/app'
import type { DDragonChampion } from '@/types/ddragon'

// Ranked-draft assistant: statistical ban suggestions ("most OP in your elo")
// and pick suggestions that blend elo winrate for your assigned role with what
// the ally comp (hovers + locks) is missing and what the enemy comp rewards.
// Data comes from src/data/rankedChampStats.json, generated offline by
// scripts/aggregate-ranked-stats.mjs per elo bucket.

// ---- dataset shape (matches aggregate-ranked-stats.mjs output) -------------
export interface RankedChampStat {
  g: number // games picked
  w: number // wins
  b: number // times banned
  roles: Partial<Record<Role, [games: number, wins: number]>>
}
export interface RankedBucket {
  label: string
  matches: number
  champions: Record<string, RankedChampStat>
}
export interface RankedStatsData {
  patch: string
  generatedAt: string
  queue: number
  buckets: Partial<Record<BucketKey, RankedBucket>>
}

export type BucketKey =
  | 'IRON_BRONZE'
  | 'SILVER_GOLD'
  | 'PLAT_EMERALD'
  | 'DIAMOND'
  | 'MASTER_PLUS'

const TIER_TO_BUCKET: Record<string, BucketKey> = {
  IRON: 'IRON_BRONZE',
  BRONZE: 'IRON_BRONZE',
  SILVER: 'SILVER_GOLD',
  GOLD: 'SILVER_GOLD',
  PLATINUM: 'PLAT_EMERALD',
  EMERALD: 'PLAT_EMERALD',
  DIAMOND: 'DIAMOND',
  MASTER: 'MASTER_PLUS',
  GRANDMASTER: 'MASTER_PLUS',
  CHALLENGER: 'MASTER_PLUS',
}
// Fallback order when the player's own bucket wasn't aggregated: walk outward,
// preferring the nearest bucket (higher elo data is the better stand-in).
const BUCKET_ORDER: BucketKey[] = [
  'IRON_BRONZE',
  'SILVER_GOLD',
  'PLAT_EMERALD',
  'DIAMOND',
  'MASTER_PLUS',
]

export interface ResolvedBucket {
  key: BucketKey
  bucket: RankedBucket
  exact: boolean // false when we fell back to another elo's data
}

/** The stats bucket for a ranked tier, falling back to the nearest available. */
export function resolveBucket(
  data: RankedStatsData,
  tier: string | null,
): ResolvedBucket | null {
  const want = TIER_TO_BUCKET[tier?.toUpperCase() ?? ''] ?? 'PLAT_EMERALD'
  const exact = data.buckets[want]
  if (exact) return { key: want, bucket: exact, exact: true }
  const i = BUCKET_ORDER.indexOf(want)
  const byDistance = BUCKET_ORDER.map((key, j) => ({ key, d: Math.abs(j - i) }))
    .sort((a, b) => a.d - b.d || b.key.localeCompare(a.key))
  for (const { key } of byDistance) {
    const bucket = data.buckets[key]
    if (bucket) return { key, bucket, exact: false }
  }
  return null
}

// Bayesian shrinkage toward 50% so a 12-game 75% champ doesn't top the list.
const smoothedWinrate = (wins: number, games: number, strength: number) =>
  (wins + strength * 0.5) / (games + strength)

// ---- ban suggestions --------------------------------------------------------
export interface BanSuggestion {
  championId: string
  championName: string
  winRate: number // smoothed, 0–100
  pickRate: number // 0–100, share of matches the champ was picked in
  banRate: number // 0–100
  score: number
}

/**
 * The most-OP champions in the bucket: highest smoothed winrate among champions
 * with real presence, with a small presence weight so a 56% champ picked or
 * banned every other game outranks a 57% niche pick. Excluded ids (already
 * banned, ally hovers — never suggest banning your own team's pick) are skipped.
 */
export function suggestBans(
  resolved: ResolvedBucket,
  championsById: Record<string, DDragonChampion>,
  excludeIds: Set<string>,
  count = 5,
): BanSuggestion[] {
  const { matches, champions } = resolved.bucket
  const minGames = Math.max(20, matches * 0.01)
  const out: BanSuggestion[] = []
  for (const [id, c] of Object.entries(champions)) {
    if (excludeIds.has(id) || c.g < minGames) continue
    const wr = smoothedWinrate(c.w, c.g, 30)
    const presence = (c.g + c.b) / matches
    out.push({
      championId: id,
      championName: championsById[id]?.name ?? id,
      winRate: Math.round(wr * 1000) / 10,
      pickRate: Math.round((c.g / matches) * 1000) / 10,
      banRate: Math.round((c.b / matches) * 1000) / 10,
      score: (wr - 0.5) + presence * 0.05,
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, count)
}

// ---- ally comp needs ---------------------------------------------------------
export type CompNeed = 'frontline' | 'ap_damage' | 'ad_damage' | 'hard_cc'

export const NEED_LABELS: Record<CompNeed, string> = {
  frontline: 'adds frontline',
  ap_damage: 'adds AP damage',
  ad_damage: 'adds AD damage',
  hard_cc: 'adds hard CC',
}
export const NEED_SUMMARY: Record<CompNeed, string> = {
  frontline: 'No frontline yet',
  ap_damage: 'All-AD so far',
  ad_damage: 'All-AP so far',
  hard_cc: 'Light on hard CC',
}

const isAP = (c: DDragonChampion) => c.tags.includes('Mage')
const isAD = (c: DDragonChampion) =>
  c.tags.includes('Marksman') ||
  (c.tags.includes('Fighter') && !c.tags.includes('Mage')) ||
  (c.tags.includes('Assassin') && !c.tags.includes('Mage'))
const isFrontline = (c: DDragonChampion) => c.tags.includes('Tank')
const hasHardCC = (c: DDragonChampion) => HEAVY_CC.has(c.id) || c.tags.includes('Tank')

/** What the ally comp (hovered + locked champs) is still missing. */
export function allyCompNeeds(allies: DDragonChampion[]): Set<CompNeed> {
  const needs = new Set<CompNeed>()
  // With fewer than two allies revealed there's no comp to reason about yet.
  if (allies.length < 2) return needs
  if (!allies.some(isFrontline) && allies.filter((c) => c.tags.includes('Fighter')).length < 2)
    needs.add('frontline')
  if (!allies.some(isAP)) needs.add('ap_damage')
  if (!allies.some(isAD)) needs.add('ad_damage')
  if (!allies.some(hasHardCC)) needs.add('hard_cc')
  return needs
}

const fillsNeed: Record<CompNeed, (c: DDragonChampion) => boolean> = {
  frontline: isFrontline,
  ap_damage: isAP,
  ad_damage: isAD,
  hard_cc: hasHardCC,
}

// Generic tag-level answers to enemy-comp conditions (the curated counterpick
// pool covers the "why" in depth; this is the broad statistical layer).
const ANSWERS_CONDITION: Partial<Record<CounterCondition, (c: DDragonChampion) => boolean>> = {
  heavy_ad: (c) => c.tags.includes('Tank'),
  many_tanks: (c) => c.tags.includes('Marksman'),
  squishy_comp: (c) => c.tags.includes('Assassin'),
  low_mobility: hasHardCC,
}

// ---- pick suggestions ---------------------------------------------------------
export interface PickSuggestion {
  championId: string
  championName: string
  winRate: number // smoothed role winrate in this elo, 0–100
  roleGames: number
  fills: CompNeed[] // ally-comp gaps this pick fills
  answers: CounterCondition[] // enemy-comp conditions this pick exploits
  score: number
}

/**
 * Champions worth picking for `role`: ranked by smoothed elo winrate in that
 * role, bumped for each ally-comp gap filled and enemy-comp condition answered.
 * Excluded ids (bans + every revealed pick/hover on either team) are skipped.
 */
export function suggestPicks(
  resolved: ResolvedBucket,
  role: Role,
  allies: DDragonChampion[],
  enemies: DDragonChampion[],
  championsById: Record<string, DDragonChampion>,
  excludeIds: Set<string>,
  count = 5,
): PickSuggestion[] {
  const { matches, champions } = resolved.bucket
  const needs = allyCompNeeds(allies)
  const conditions = enemyCounterConditions(enemies)
  const minRoleGames = Math.max(8, matches * 0.005)

  const out: PickSuggestion[] = []
  for (const [id, c] of Object.entries(champions)) {
    if (excludeIds.has(id)) continue
    const [games, wins] = c.roles[role] ?? [0, 0]
    if (games < minRoleGames) continue
    const champ = championsById[id]
    if (!champ) continue
    const wr = smoothedWinrate(wins, games, 20)
    const fills = [...needs].filter((n) => fillsNeed[n](champ))
    const answers = [...conditions].filter((cond) => ANSWERS_CONDITION[cond]?.(champ))
    out.push({
      championId: id,
      championName: champ.name,
      winRate: Math.round(wr * 1000) / 10,
      roleGames: games,
      fills,
      answers,
      score: (wr - 0.5) + fills.length * 0.02 + answers.length * 0.01,
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, count)
}
