import { useQuery } from '@tanstack/react-query'

// Player profile from the LCU bridge (/lcu/profile — electron/server.js): the
// current summoner, ranked tiers, and recent games. Read-only; only works while
// the League client is open (the app ships no Riot API key). ?mock=1 fabricates
// a profile for browser previews/screenshots.

export interface RankedEntry {
  tier: string
  division: string
  lp: number
  wins: number
  losses: number
}

export interface ProfileGame {
  gameId: number
  championId: number // Data Dragon numeric key
  win: boolean | null
  kills: number
  deaths: number
  assists: number
  queueId: number
  gameMode: string
  mapId: number
  gameCreation: number // epoch ms
  gameDuration: number // seconds (or ms on old games — normalized in the UI)
}

export interface Profile {
  clientOpen: boolean
  summoner: { gameName: string; tagLine: string; level: number; profileIconId: number } | null
  ranked?: { solo: RankedEntry | null; flex: RankedEntry | null }
  games?: ProfileGame[]
}

const POLL_MS = 60_000

async function fetchProfile(): Promise<Profile> {
  const res = await fetch('/lcu/profile')
  if (!res.ok) throw new Error(`profile bridge ${res.status}`)
  return res.json()
}

const MOCK: Profile = {
  clientOpen: true,
  summoner: { gameName: 'Mav', tagLine: 'UCE', level: 412, profileIconId: 6299 },
  ranked: {
    solo: { tier: 'GOLD', division: 'II', lp: 47, wins: 63, losses: 51 },
    flex: { tier: 'SILVER', division: 'I', lp: 12, wins: 20, losses: 18 },
  },
  games: [
    { gameId: 1, championId: 63, win: true, kills: 12, deaths: 4, assists: 18, queueId: 450, gameMode: 'ARAM', mapId: 12, gameCreation: Date.now() - 3_600_000, gameDuration: 1120 },
    { gameId: 2, championId: 157, win: false, kills: 6, deaths: 9, assists: 5, queueId: 420, gameMode: 'CLASSIC', mapId: 11, gameCreation: Date.now() - 90_000_000, gameDuration: 1980 },
    { gameId: 3, championId: 101, win: true, kills: 21, deaths: 7, assists: 11, queueId: 2400, gameMode: 'KIWI', mapId: 12, gameCreation: Date.now() - 92_000_000, gameDuration: 900 },
    { gameId: 4, championId: 30, win: true, kills: 15, deaths: 3, assists: 9, queueId: 2400, gameMode: 'KIWI', mapId: 12, gameCreation: Date.now() - 95_000_000, gameDuration: 840 },
    { gameId: 5, championId: 22, win: false, kills: 8, deaths: 8, assists: 14, queueId: 440, gameMode: 'CLASSIC', mapId: 11, gameCreation: Date.now() - 172_800_000, gameDuration: 2400 },
  ],
}

export function useProfile(): { profile: Profile | null; isLoading: boolean } {
  const mock = new URLSearchParams(window.location.search).has('mock')
  const query = useQuery({
    queryKey: ['lcu-profile'],
    queryFn: fetchProfile,
    refetchInterval: POLL_MS,
    enabled: !mock,
  })
  if (mock) return { profile: MOCK, isLoading: false }
  return { profile: query.data ?? null, isLoading: query.isLoading }
}
