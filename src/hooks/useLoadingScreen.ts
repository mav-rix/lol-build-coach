import { useQuery } from '@tanstack/react-query'
import { MOCK_LOADING_SCREEN, MOCK_LOADING_SCREEN_SOLO } from '@/data/mockLoadingScreen'

// Shape returned by the LCU bridge (/lcu/loading-screen). One enrichment per
// game happens server-side; polling just picks up the cached result.
export interface LoadingPlayer {
  championId: number // Data Dragon numeric key; 0 until known
  name: string
  isSelf: boolean
  rank: { tier: string; division: string } | null
  streak: { kind: 'hot' | 'cold'; count: number } | null
  recent: { wins: number; losses: number } | null
}

export interface LoadingScreenState {
  available: boolean
  phase: string
  show: boolean
  /** League Video setting: 0 Fullscreen, 1 Windowed, 2 Borderless, null unknown. */
  windowMode: number | null
  myTeam?: LoadingPlayer[]
  enemyTeam?: LoadingPlayer[]
}

const EMPTY: LoadingScreenState = {
  available: false,
  phase: 'None',
  show: false,
  windowMode: null,
}

const POLL_MS = 3000

// null = no mock; '1' = full 5v5 fixture; 'solo' = Practice Tool shape.
const useMockLoad = (): string | null =>
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('mockload')
    : null

async function fetchLoadingScreen(): Promise<LoadingScreenState> {
  const res = await fetch('/lcu/loading-screen')
  if (!res.ok) throw new Error(`LCU bridge responded ${res.status}`)
  return (await res.json()) as LoadingScreenState
}

/**
 * Polls the LCU bridge for the loading-screen scouting report (both teams,
 * rank, hot/cold streaks). Polling stops once the match has actually started
 * (the game clock is running — the Live Client API responds while the loading
 * screen is still up, so reachability alone isn't enough); the overlay
 * switches to the live card then. ?mockload=1 serves a fixture.
 */
export function useLoadingScreen(gameStarted: boolean): LoadingScreenState {
  const mock = useMockLoad()
  const query = useQuery({
    queryKey: ['lcu-loading-screen'],
    queryFn: fetchLoadingScreen,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    gcTime: 0,
    enabled: mock === null && !gameStarted,
  })
  if (mock !== null) return mock === 'solo' ? MOCK_LOADING_SCREEN_SOLO : MOCK_LOADING_SCREEN
  return query.data ?? EMPTY
}
