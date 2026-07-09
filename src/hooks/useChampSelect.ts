import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStaticData } from '@/hooks/useStaticData'
import { MOCK_CHAMP_SELECT } from '@/data/mockChampSelect'
import type { Role } from '@/types/app'

// Shape returned by the LCU bridge (/lcu/champ-select).
interface BridgeCell {
  cellId: number
  championId: number // Data Dragon numeric key; 0 until revealed
  position: string
  role: Role | null
}
export interface BridgeChampSelect {
  clientOpen: boolean
  phase: string
  inChampSelect: boolean
  self?: { championId: number; role: Role | null; position: string } | null
  myTeam?: BridgeCell[]
  theirTeam?: BridgeCell[]
  enemyChampionKeys?: number[]
  bans?: number[]
}

export interface ChampSelectState {
  available: boolean // bridge reachable and client open
  inChampSelect: boolean
  phase: string
  self: { championId: string | null; role: Role | null }
  enemyChampionIds: (string | null)[] // Data Dragon ids, length 5, nulls for unrevealed
  banChampionIds: string[]
}

const POLL_MS = 2000

const useMockCS = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('mockcs')

async function fetchChampSelect(): Promise<BridgeChampSelect> {
  const res = await fetch('/lcu/champ-select')
  if (!res.ok) throw new Error(`LCU bridge responded ${res.status}`)
  return (await res.json()) as BridgeChampSelect
}

/**
 * Polls the LCU bridge for champ-select state and maps Data Dragon numeric
 * keys to string champion ids. Returns a stable, UI-friendly shape.
 */
export function useChampSelect(): ChampSelectState {
  const mock = useMockCS()
  const { data: staticData } = useStaticData()

  const query = useQuery({
    queryKey: ['lcu-champ-select'],
    queryFn: fetchChampSelect,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    gcTime: 0,
    enabled: !mock,
  })

  // Data Dragon numeric key ("103") → champion id ("Ahri").
  const keyToId = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of staticData?.champions ?? []) map.set(Number(c.key), c.id)
    return map
  }, [staticData])

  const bridge: BridgeChampSelect | null = mock
    ? MOCK_CHAMP_SELECT
    : (query.data ?? null)

  return useMemo(() => {
    const empty: ChampSelectState = {
      available: false,
      inChampSelect: false,
      phase: bridge?.phase ?? 'None',
      self: { championId: null, role: null },
      enemyChampionIds: [null, null, null, null, null],
      banChampionIds: [],
    }
    if (!bridge || !bridge.clientOpen) return empty

    const mapKey = (key: number): string | null =>
      key > 0 ? (keyToId.get(key) ?? null) : null

    const enemies = (bridge.enemyChampionKeys ?? []).map(mapKey)
    while (enemies.length < 5) enemies.push(null)

    return {
      available: true,
      inChampSelect: bridge.inChampSelect,
      phase: bridge.phase,
      self: {
        championId: bridge.self ? mapKey(bridge.self.championId) : null,
        role: bridge.self?.role ?? null,
      },
      enemyChampionIds: enemies.slice(0, 5),
      banChampionIds: (bridge.bans ?? [])
        .map(mapKey)
        .filter((id): id is string => id !== null),
    }
  }, [bridge, keyToId])
}
