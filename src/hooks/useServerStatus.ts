import { useQuery } from '@tanstack/react-query'

// League server health — /lcu/server-status (electron/server.js or the dev
// lcu-bridge): proxies Riot's public, unauthenticated status feed (the same
// one status.riotgames.com reads) for the player's own region, detected from
// the LCU when the client is open (falls back to NA1 otherwise). The feed is
// undocumented and can get rate-limited, so a failed fetch just means no
// status — the badge hides rather than showing something wrong.

export interface ServerIssue {
  id: string | number
  severity: string
  title: string
  updatedAt: string | null
}

export interface ServerStatus {
  ok: boolean
  platform: string
  name: string
  status: 'online' | 'maintenance' | 'incident'
  issues: ServerIssue[]
}

const POLL_MS = 5 * 60_000

async function fetchServerStatus(): Promise<ServerStatus> {
  const res = await fetch('/lcu/server-status')
  if (!res.ok) throw new Error(`server-status bridge ${res.status}`)
  return res.json()
}

export function useServerStatus(): { status: ServerStatus | null } {
  const query = useQuery({
    queryKey: ['server-status'],
    queryFn: fetchServerStatus,
    refetchInterval: POLL_MS,
  })
  return { status: query.data ?? null }
}
