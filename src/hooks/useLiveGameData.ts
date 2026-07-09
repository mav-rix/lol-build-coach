import { useQuery } from '@tanstack/react-query'
import type { LiveAllGameData } from '@/types/live'

const IN_GAME_POLL_MS = 5_000 // Riot policy: stay well under 1 req/sec locally
const IDLE_POLL_MS = 10_000

async function fetchAllGameData(): Promise<LiveAllGameData> {
  // Proxied by the Vite dev server to https://127.0.0.1:2999 (see vite.config.ts)
  const res = await fetch('/liveclientdata/allgamedata')
  if (!res.ok) throw new Error(`Live Client API responded ${res.status}`)
  const data = (await res.json()) as LiveAllGameData
  if (!data.activePlayer) throw new Error('Game not fully loaded yet')
  return data
}

/**
 * Polls the local Live Client Data API. Read-only, own-machine data only.
 * Polls every 5s while in game, backs off to 10s while waiting for a game.
 */
export function useLiveGameData() {
  const query = useQuery({
    queryKey: ['live-game-data'],
    queryFn: fetchAllGameData,
    refetchInterval: (q) => (q.state.status === 'success' ? IN_GAME_POLL_MS : IDLE_POLL_MS),
    refetchIntervalInBackground: true,
    retry: false, // a failure just means "not in game" — keep polling instead
    gcTime: 0,
  })

  const isInGame = query.isSuccess && !query.isError

  return {
    data: isInGame ? (query.data ?? null) : null,
    isInGame,
    isLoading: query.isPending && query.fetchStatus === 'fetching' && !query.data,
    error: query.error,
    refresh: query.refetch,
  }
}
