import type { GameMode } from '@/types/app'

export interface ModeConfig {
  label: string
  mapId: number // Data Dragon maps key: 11 = Summoner's Rift, 12 = Howling Abyss, 30 = Arena
  startingGold: number
  goldPerMin: number // average income used for timeline projection
  hasRecall: boolean
  hasRoles: boolean
  // Pre-game opponents are a fixed, known 5-slot team (SR/ARAM). Arena's
  // opponent is a rotating 1v1 duo only knowable live, round to round — so it
  // gets no pre-game enemy picker and no team-comp situational logic yet.
  hasFixedEnemyTeam: boolean
  hasCs: boolean // whether the mode has a minion-farming economy at all
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
    hasFixedEnemyTeam: true,
    hasCs: true,
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
    hasFixedEnemyTeam: true,
    hasCs: true,
    bootsDeadlineS: 420,
    csGoodPerMin: 5,
    csLowPerMin: 3.5,
  },
  ARENA: {
    label: 'Arena',
    mapId: 30,
    startingGold: 1400, // round-1 shop budget, mirrors ARAM's ballpark
    goldPerMin: 600,
    hasRecall: false, // shopping happens between rounds, not via backing
    hasRoles: false,
    hasFixedEnemyTeam: false,
    hasCs: false, // no minions — nothing to farm
    bootsDeadlineS: 420,
    csGoodPerMin: 0,
    csLowPerMin: 0,
  },
}

// The Howling Abyss (ARAM and all its variants) is always this map.
const HOWLING_ABYSS_MAP = 12
// Arena (Rings of Wrath / "Cherry") is always this map.
const ARENA_MAP = 30

/**
 * Maps whose item and rune systems are NOT the live game's, so every
 * recommendation this app makes would be wrong there. `gameModeFromLive`
 * otherwise falls through to SR for any unknown map, which is silently
 * confident nonsense in these — so they get named and refused instead.
 *
 * League Classic (map 453, "Classic Rift", internal codename "Jade") shipped
 * in patch 26.15. It runs an early-League snapshot: a legacy item set and the
 * pre-reforged Runes/Masteries pages. Critically, it CANNOT be told apart by
 * the gameMode string — modern Summoner's Rift already reports "CLASSIC" —
 * so the map number is the only reliable discriminator.
 *
 * Swarm (map 33) is PvE horde survival with an entirely bespoke item set.
 *
 * Deliberately absent: Nexus Blitz (21) and Brawl / The Bandlewood (35) both
 * run the live item and rune systems, so treating them as SR is imperfect but
 * useful. Unknown maps keep falling through to SR for the same reason.
 */
const UNSUPPORTED_MAPS: Record<number, string> = {
  453: 'League Classic',
  33: 'Swarm',
}

/**
 * Display name of the unsupported mode this game is in, or null when the mode
 * is one we can actually advise on. Callers should check this BEFORE using
 * `gameModeFromLive`, whose SR fallback is meaningless for these maps.
 */
export function unsupportedLiveMode(mapNumber?: number): string | null {
  return mapNumber === undefined ? null : (UNSUPPORTED_MAPS[mapNumber] ?? null)
}

/**
 * Map a Live Client API game to our GameMode. Detect by map first: every
 * ARAM-family mode — normal ARAM, ARAM Mayhem, ARAM Clash, and future Abyss
 * events — runs on map 12, regardless of the gameMode string (which varies by
 * event). Fall back to a substring match on the mode string as a safety net.
 * Arena reports gameMode "CHERRY".
 */
export function gameModeFromLive(liveGameMode: string, mapNumber?: number): GameMode {
  if (mapNumber === HOWLING_ABYSS_MAP) return 'ARAM'
  if (mapNumber === ARENA_MAP || liveGameMode.toUpperCase() === 'CHERRY') return 'ARENA'
  return liveGameMode.toUpperCase().includes('ARAM') ? 'ARAM' : 'SR'
}

/**
 * Augmented Abyss variant (ARAM Mayhem and future augment events). Same map as
 * ARAM, distinguished only by the event's gameMode string — plain ARAM reads
 * exactly "ARAM", so any other string on map 12 is an event variant. Augment
 * events are the ones that deviate; if a non-augment Abyss event ever appears,
 * tighten this to match its string. Confirmed live: ARAM Mayhem reports
 * gameMode "KIWI" (patch 16.13).
 */
export function isAugmentedAbyss(liveGameMode: string, mapNumber?: number): boolean {
  if (gameModeFromLive(liveGameMode, mapNumber) !== 'ARAM') return false
  return liveGameMode.toUpperCase() !== 'ARAM'
}
