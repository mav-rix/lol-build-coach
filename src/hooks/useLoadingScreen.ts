import { useQuery } from '@tanstack/react-query'
import { MOCK_LOADING_SCREEN } from '@/data/mockLoadingScreen'

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

const useMockLoad = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('mockload')

async function fetchLoadingScreen(): Promise<LoadingScreenState> {
  const res = await fetch('/lcu/loading-screen')
  if (!res.ok) throw new Error(`LCU bridge responded ${res.status}`)
  return (await res.json()) as LoadingScreenState
}

/**
 * Polls the LCU bridge for the loading-screen scouting report (both teams,
 * rank, hot/cold streaks). Polling stops once the game itself is reachable —
 * the overlay switches to the live card then. ?mockload=1 serves a fixture.
 */
export function useLoadingScreen(isInGame: boolean): LoadingScreenState {
  const mock = useMockLoad()
  const query = useQuery({
    queryKey: ['lcu-loading-screen'],
    queryFn: fetchLoadingScreen,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    gcTime: 0,
    enabled: !mock && !isInGame,
  })
  if (mock) return MOCK_LOADING_SCREEN
  return query.data ?? EMPTY
}
