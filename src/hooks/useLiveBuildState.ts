import { useMemo, useRef } from 'react'
import { useAggregatedBuilds } from '@/hooks/useAggregatedBuilds'
import { useLiveGameData } from '@/hooks/useLiveGameData'
import { useStaticData } from '@/hooks/useStaticData'
import { useAppStore } from '@/store/useAppStore'
import { findBuild } from '@/data/builds'
import { MOCK_LIVE, mockLiveFor } from '@/data/mockLive'
import { MODE_CONFIG, gameModeFromLive, isAugmentedAbyss } from '@/lib/modes'
import { analyzeThreats, championIdFromRaw } from '@/lib/threats'
import { buildGamePlan, type GamePlan } from '@/lib/gameplan'
import { JUNGLE_PET_IDS, ownsJunglePet, pickJunglePet } from '@/lib/jungle'
import {
  SUPPORT_QUEST_COMPLETE_ID,
  ownsFinalSupportItem,
  pickSupportItem,
} from '@/lib/support'
import type { BuildRec } from '@/lib/builder'
import { recommendByScore } from '@/lib/scoring'
import type { BuildPath, Role } from '@/types/app'
import type { DDragonChampion } from '@/types/ddragon'
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

// Build Next simply walks the plan: the next unowned items, with
// affordability — no mid-game path churn. Once the core path runs dry (short
// aggregated builds, or late game with most slots filled), the remaining slots
// come from the build's situational pool — comp-active swaps first, then
// popular alternatives — so the list always offers a full inventory's worth.
function recommendationsFromPlan(
  plan: GamePlan,
  build: BuildPath | null,
  ownedIds: Set<number>,
  gold: number,
  items: Record<string, DDragonItem>,
): BuildRec[] {
  const recs: BuildRec[] = []
  const push = (
    itemId: number,
    priority: BuildRec['priority'],
    reason: string,
    source: BuildRec['source'],
  ) => {
    if (ownedIds.has(itemId) || recs.some((r) => r.itemId === itemId)) return
    const item = items[String(itemId)]
    if (!item) return
    const cost = item.gold.total
    recs.push({
      itemId,
      name: item.name,
      cost,
      priority,
      reason,
      affordable: gold >= cost,
      goldNeeded: Math.max(0, Math.ceil(cost - gold)),
      source,
    })
  }

  for (const p of plan.items) {
    if (p.label === 'starter') continue
    push(
      p.itemId,
      recs.length === 0 ? 'recommended' : 'planned',
      'Next in your build path',
      'core',
    )
    if (recs.length >= 6) break
  }

  if (build && recs.length < 6) {
    const isActive = (s: BuildPath['situationalItems'][number]) =>
      s.condition !== 'general' && plan.activeConditions.has(s.condition)
    const sits = [...build.situationalItems].sort(
      (a, b) => Number(isActive(b)) - Number(isActive(a)),
    )
    for (const s of sits) {
      if (recs.length >= 6) break
      push(s.itemId, isActive(s) ? 'urgent' : 'planned', s.description, 'situational')
    }
  }
  return recs
}

const mockParams = () =>
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null

/** Everything the live views need, shared by /live and /overlay. */
export function useLiveBuildState() {
  const params = mockParams()
  const mock = params?.has('mock') ?? false
  const mockChamp = params?.get('champ') ?? null
  const { data: staticData } = useStaticData()
  // Ensures the lazy aggregated-builds chunk loads and re-renders when ready, so
  // findBuild below can return an aggregated build once it's available.
  useAggregatedBuilds()
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
  // In a live SR game, the player's ACTUAL position beats whatever role the
  // Build page last had selected (which may be stale or never set). ARAM
  // reports "NONE" and is roleless anyway.
  const LIVE_POSITION_ROLE: Record<string, Role> = {
    TOP: 'TOP',
    JUNGLE: 'JUNGLE',
    MIDDLE: 'MID',
    BOTTOM: 'ADC',
    UTILITY: 'SUPPORT',
  }
  const role: Role | null =
    (self && LIVE_POSITION_ROLE[self.position]) ?? selectedRole
  // Augmented Abyss (ARAM Mayhem): drives the overlay's augment goal panel.
  // ?mayhem=1 forces it in mock mode for previews/screenshots.
  const augmentMode = mock
    ? (params?.has('mayhem') ?? false)
    : live
      ? isAugmentedAbyss(live.gameData.gameMode, live.gameData.mapNumber)
      : false
  const build = championId ? findBuild(championId, role, mode) : null
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
  const champion =
    championId && staticData ? (staticData.championsById[championId] ?? null) : null

  // Enemy comp, stable per game: champions only (never live purchases), so the
  // plan below is decided once — effectively at the loading screen. The memo is
  // keyed on the comp signature, not the live object, so polls don't churn it.
  const enemySignature =
    live && self
      ? live.allPlayers
          .filter((p) => p.team !== self.team)
          .map((p) => p.rawChampionName)
          .sort()
          .join(',')
      : ''
  const enemies = useMemo((): DDragonChampion[] => {
    if (!live || !self || !staticData) return []
    return live.allPlayers
      .filter((p) => p.team !== self.team)
      .map((p) => staticData.championsById[championIdFromRaw(p.rawChampionName)])
      .filter((c): c is DDragonChampion => Boolean(c))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemySignature, staticData])

  // The single build path — highest WR, same as the Build page — computed once
  // per (build, comp) and stable for the whole game.
  const gamePlan = useMemo(
    () => (build ? buildGamePlan(build, enemies) : null),
    [build, enemies],
  )

  const plan: PlanItem[] = gamePlan
    ? gamePlan.items
    : build
      ? buildPlan(build)
      : []
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

  // Build Next: walk the game-plan path. Champions with no build at all fall
  // back to the scoring engine.
  const usingScoredBuild = !build && champion !== null
  const recommendations = useMemo(() => {
    if (gamePlan) {
      const recs = recommendationsFromPlan(gamePlan, build, ownedIds, gold, items)
      // Mandatory role starts (ranked SR) lead the list until bought:
      // the jungle companion — highest win-rate pick from the data on the WR
      // plan, comp-driven on the vs-comp plan — and the support quest final
      // once Bounty of Worlds completes.
      const lead = (itemId: number, reason: string) => {
        const item = items[String(itemId)]
        if (!item) return
        recs.unshift({
          itemId,
          name: item.name,
          cost: item.gold.total,
          priority: 'recommended',
          reason,
          affordable: gold >= item.gold.total,
          goldNeeded: Math.max(0, Math.ceil(item.gold.total - gold)),
          source: 'core',
        })
      }
      if (mode === 'SR' && role === 'SUPPORT' && champion &&
          ownedIds.has(SUPPORT_QUEST_COMPLETE_ID) && !ownsFinalSupportItem(ownedIds)) {
        const pick = pickSupportItem(champion, gamePlan.activeConditions)
        lead(pick.itemId, pick.reason)
      }
      if (mode === 'SR' && role === 'JUNGLE' && !ownsJunglePet(ownedIds)) {
        const petId = build?.starterItems.find((id) => JUNGLE_PET_IDS.has(id))
        if (petId) lead(petId, 'Highest win-rate jungle companion for your champion')
        else {
          // Build data carries no pet — fall back to the comp-driven pick.
          const pet = pickJunglePet(gamePlan.activeConditions)
          lead(pet.itemId, pet.reason)
        }
      }
      return recs.slice(0, 6)
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
        role,
      })
    }
    return []
  }, [gamePlan, champion, ownedIds, gold, threats, self, items, modeConfig, role, mode, build])
  const topRec = recommendations[0] ?? null

  return {
    recommendations,
    topRec,
    usingScoredBuild,
    gamePlan,
    live,
    isInGame,
    staticData,
    items,
    patch,
    self,
    championId,
    mode,
    modeConfig,
    augmentMode,
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
