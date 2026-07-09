import type { GameMode } from '@/types/app'

export interface ModeConfig {
  label: string
  mapId: number // Data Dragon maps key: 11 = Summoner's Rift, 12 = Howling Abyss
  startingGold: number
  goldPerMin: number // average income used for timeline projection
  hasRecall: boolean
  hasRoles: boolean
  bootsDeadlineS: number // "buy boots earlier" tip threshold
  csGoodPerMin: number
  csLowPerMin: number
}

export const MODE_CONFIG: Record<GameMode, ModeConfig> = {
  SR: {
    label: "Summoner's Rift",
    mapId: 11,
    startingGold: 500,
    goldPerMin: 420,
    hasRecall: true,
    hasRoles: true,
    bootsDeadlineS: 600,
    csGoodPerMin: 7,
    csLowPerMin: 5.5,
  },
  ARAM: {
    label: 'ARAM',
    mapId: 12,
    startingGold: 1400,
    goldPerMin: 600,
    hasRecall: false, // no backing except death — shopping happens on respawn
    hasRoles: false,
    bootsDeadlineS: 420,
    csGoodPerMin: 5,
    csLowPerMin: 3.5,
  },
}

// The Howling Abyss (ARAM and all its variants) is always this map.
const HOWLING_ABYSS_MAP = 12

/**
 * Map a Live Client API game to our GameMode. Detect by map first: every
 * ARAM-family mode — normal ARAM, ARAM Mayhem, ARAM Clash, and future Abyss
 * events — runs on map 12, regardless of the gameMode string (which varies by
 * event). Fall back to a substring match on the mode string as a safety net.
 */
export function gameModeFromLive(liveGameMode: string, mapNumber?: number): GameMode {
  if (mapNumber === HOWLING_ABYSS_MAP) return 'ARAM'
  return liveGameMode.toUpperCase().includes('ARAM') ? 'ARAM' : 'SR'
}
