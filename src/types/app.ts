// Domain models for the app itself.

export type Role = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

export const ROLES: Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

export type GameMode = 'SR' | 'ARAM'

export interface BuildPath {
  id: number
  championId: string
  mode: GameMode
  role: Role | null // null for modes without roles (ARAM)
  patch: string
  starterItems: number[]
  coreItems: number[] // ordered — buy in sequence
  situationalItems: SituationalItem[]
  bootsOptions: number[]
  primaryPathId: number
  keystoneId: number
  primaryRuneIds: number[]
  secondaryPathId: number
  secondaryRuneIds: number[]
  statRuneIds: number[]
  skillMaxOrder: string // "Q > W > E"
  skillStart?: string
  notes: string[]
  winRate?: number
  sampleSize?: number
}

export type SituationalCondition =
  | 'enemy_has_healing'
  | 'enemy_has_tanks'
  | 'enemy_heavy_ap'
  | 'enemy_heavy_ad'
  | 'enemy_heavy_cc'
  | 'general'

export interface SituationalItem {
  itemId: number
  condition: SituationalCondition
  description: string
}

export interface BuildProgressItem {
  itemId: number
  status: 'pending' | 'purchased' | 'skipped'
  purchasedAt?: number // game time (s)
  goldAtPurchase?: number
}

export interface BuildTimelineEntry {
  itemId: number
  gameTime: number
  goldAtTime: number
}

export interface AnalysisTip {
  type: 'positive' | 'negative' | 'neutral'
  category: 'timing' | 'itemization' | 'runes' | 'general'
  message: string
  data?: Record<string, unknown>
}

export interface MatchStats {
  duration: number // seconds
  result: 'WIN' | 'LOSS' | 'REMAKE'
  kills: number
  deaths: number
  assists: number
  cs: number
  damageDealt: number
  goldEarned: number
}

export interface TimelineComparison {
  itemId: number
  isCore: boolean // only core items affect the efficiency score
  actualTime: number | null // null = never bought
  expectedTime: number
  deviation: number | null // seconds late (+) or early (-)
}

export interface MatchAnalysis {
  efficiencyScore: number // 0-100
  timelineComparison: TimelineComparison[]
  tips: AnalysisTip[]
}

export interface MatchInput {
  championId: string
  mode?: GameMode // defaults to SR
  role?: Role // only meaningful for SR
  actualBuild: BuildTimelineEntry[]
  stats: MatchStats
}
