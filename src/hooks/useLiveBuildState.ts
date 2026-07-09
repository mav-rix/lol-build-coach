import { useMemo, useRef } from 'react'
import { useLiveGameData } from '@/hooks/useLiveGameData'
import { useStaticData } from '@/hooks/useStaticData'
import { useAppStore } from '@/store/useAppStore'
import { findBuild } from '@/data/builds'
import { MOCK_LIVE, mockLiveFor } from '@/data/mockLive'
import { MODE_CONFIG, gameModeFromLive } from '@/lib/modes'
import { analyzeThreats, championIdFromRaw } from '@/lib/threats'
import { recommendPurchases } from '@/lib/builder'
import { recommendByScore } from '@/lib/scoring'
import type { BuildPath } from '@/types/app'
import type { DDragonItem } from '@/types/ddragon'
import type { LiveAllGameData, LivePlayer } from '@/types/live'

export interface PlanItem {
  itemId: number
  label: 'starter' | 'boots' | 'core'
}

// Stable empty fallback so memo deps don't churn before static data loads.
const EMPTY_ITEMS: Record<string, DDragonItem> = {}

function findSelf(data: LiveAllGameData): LivePlayer | null {
  const name = data.activePlayer.summonerName
  return (
    data.allPlayers.find((p) => p.summonerName === name) ??
    data.allPlayers.find((p) => name.startsWith(p.summonerName)) ??
    null
  )
}

function buildPlan(build: BuildPath): PlanItem[] {
  return [
    ...build.starterItems.map((id): PlanItem => ({ itemId: id, label: 'starter' })),
    ...(build.bootsOptions[0]
      ? [{ itemId: build.bootsOptions[0], label: 'boots' as const }]
      : []),
    ...build.coreItems.map((id): PlanItem => ({ itemId: id, label: 'core' })),
  ]
}

const mockParams = () =>
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

/** Everything the live views need, shared by /live and /overlay. */
export function useLiveBuildState() {
  const params = mockParams()
  const mock = params?.has('mock') ?? false
  const mockChamp = params?.get('champ') ?? null
  const { data: staticData } = useStaticData()
  const poll = useLiveGameData()
  const { selectedChampionId, selectedRole, selectedMode } = useAppStore()
  const purchaseTimes = useRef(new Map<number, number>())

  const live = mock ? (mockChamp ? mockLiveFor(mockChamp) : MOCK_LIVE) : poll.data
  const isInGame = mock ? true : poll.isInGame

  const self = live ? findSelf(live) : null
  const championId = self
    ? championIdFromRaw(self.rawChampionName)
    : selectedChampionId

  const mode = live
    ? gameModeFromLive(live.gameData.gameMode, live.gameData.mapNumber)
    : selectedMode
  const modeConfig = MODE_CONFIG[mode]
  const build = championId ? findBuild(championId, selectedRole, mode) : null
  const items = staticData?.items ?? EMPTY_ITEMS
  const patch = staticData?.patch ?? ''

  const ownedIds = useMemo(() => {
    const ids = new Set<number>()
    for (const it of self?.items ?? []) ids.add(it.itemID)
    return ids
  }, [self])

  if (live && self) {
    for (const id of ownedIds) {
      if (!purchaseTimes.current.has(id)) {
        purchaseTimes.current.set(id, live.gameData.gameTime)
      }
    }
  }

  const threats = useMemo(
    () =>
      live && staticData
        ? analyzeThreats(live, self, staticData.items, staticData.championsById)
        : null,
    [live, self, staticData],
  )

  const gold = live?.activePlayer.currentGold ?? 0
  const plan = build ? buildPlan(build) : []
  const nextPlanItem = plan.find(
    (p) => p.label !== 'starter' && !ownedIds.has(p.itemId),
  )
  const nextItem: DDragonItem | undefined = nextPlanItem
    ? items[String(nextPlanItem.itemId)]
    : undefined
  const nextCost = nextItem?.gold.total ?? 0
  const affordable = nextPlanItem !== undefined && gold >= nextCost
  const affordableComponents = (nextItem?.from ?? [])
    .map((id) => Number(id))
    .filter(
      (id) => !ownedIds.has(id) && (items[String(id)]?.gold.total ?? Infinity) <= gold,
    )

  const scores = self?.scores ?? null
  const gameTime = live?.gameData.gameTime ?? 0
  const minutes = gameTime / 60
  const csPerMin = scores && minutes > 0 ? scores.creepScore / minutes : 0

  // Adaptive "build next" ranking driven by live enemy purchases. A seeded
  // build path takes priority; otherwise the scoring engine computes one for
  // any champion from item stats + live enemy state.
  const champion =
    championId && staticData ? (staticData.championsById[championId] ?? null) : null
  const usingScoredBuild = !build && champion !== null
  const recommendations = useMemo(() => {
    if (build) {
      return recommendPurchases(build, ownedIds, gold, threats, self, items, modeConfig)
    }
    if (champion) {
      return recommendByScore({
        champion,
        ownedIds,
        gold,
        items,
        threats,
        self,
        mapId: modeConfig.mapId,
      })
    }
    return []
  }, [build, champion, ownedIds, gold, threats, self, items, modeConfig])
  const topRec = recommendations[0] ?? null

  return {
    recommendations,
    topRec,
    usingScoredBuild,
    live,
    isInGame,
    staticData,
    items,
    patch,
    self,
    championId,
    mode,
    modeConfig,
    build,
    plan,
    ownedIds,
    purchaseTimes: purchaseTimes.current,
    nextPlanItem,
    nextItem,
    nextCost,
    affordable,
    affordableComponents,
    threats,
    gold,
    scores,
    gameTime,
    csPerMin,
  }
}
