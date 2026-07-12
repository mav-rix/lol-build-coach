import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChampionSelect } from '@/components/ChampionSelect'
import { BuildPathDisplay } from '@/components/BuildPathDisplay'
import { CounterPicks } from '@/components/CounterPicks'
import { ImportBuildButton } from '@/components/ImportBuildButton'
import { useAggregatedBuilds } from '@/hooks/useAggregatedBuilds'
import { useStaticData } from '@/hooks/useStaticData'
import { useChampSelect } from '@/hooks/useChampSelect'
import { useAppStore } from '@/store/useAppStore'
import { BUILD_PATHS, findBuild } from '@/data/builds'
import { analyzeEnemyComp } from '@/lib/situational'
import { suggestCounterPicks } from '@/lib/counterpick'
import { MODE_CONFIG } from '@/lib/modes'
import { ROLES, type GameMode, type Role } from '@/types/app'
import type { DDragonChampion } from '@/types/ddragon'

// Rough mapping from Data Dragon tags to a default role.
function defaultRole(champion: DDragonChampion): Role {
  const [primary] = champion.tags
  switch (primary) {
    case 'Marksman':
      return 'ADC'
    case 'Support':
      return 'SUPPORT'
    case 'Tank':
    case 'Fighter':
      return 'TOP'
    default:
      return 'MID'
  }
}

export default function Home() {
  const { data, isLoading, error, retry } = useStaticData()
  // Load the lazy aggregated-builds chunk; re-renders when ready so findBuild picks it up.
  useAggregatedBuilds()
  const {
    selectedChampionId,
    selectedRole,
    selectedMode,
    enemyChampionIds,
    selectChampion,
    selectRole,
    selectMode,
    setEnemyChampion,
    clearEnemies,
  } = useAppStore()

  // Auto-fill from the League client's champ select (via the LCU bridge).
  const champSelect = useChampSelect()
  useEffect(() => {
    if (!champSelect.inChampSelect) return
    // Mirror my locked pick + assigned role.
    if (champSelect.self.championId) selectChampion(champSelect.self.championId)
    if (champSelect.self.role) selectRole(champSelect.self.role)
    // Mirror revealed enemy picks into their slots.
    champSelect.enemyChampionIds.forEach((id, slot) => {
      if (id && enemyChampionIds[slot] !== id) setEnemyChampion(slot, id)
    })
  }, [champSelect, enemyChampionIds, selectChampion, selectRole, setEnemyChampion])

  const selectedChampion = selectedChampionId
    ? (data?.championsById[selectedChampionId] ?? null)
    : null

  const enemies = useMemo(
    () =>
      enemyChampionIds
        .map((id) => (id && data ? data.championsById[id] : null))
        .filter((c): c is DDragonChampion => c !== null && c !== undefined),
    [enemyChampionIds, data],
  )

  const comp = useMemo(() => analyzeEnemyComp(enemies), [enemies])

  const seededChampionIds = useMemo(
    () => new Set(BUILD_PATHS.filter((b) => b.mode === 'SR').map((b) => b.championId)),
    [],
  )
  const counterPicks = useMemo(
    () =>
      data ? suggestCounterPicks(enemies, data.championsById, seededChampionIds) : null,
    [enemies, data, seededChampionIds],
  )
  const hasCounterPicks =
    counterPicks !== null && ROLES.some((r) => counterPicks[r].length > 0)

  if (isLoading) {
    return <p className="py-20 text-center text-zinc-400">Loading Data Dragon…</p>
  }
  if (error || !data) {
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-red-400">Failed to load game data from Data Dragon.</p>
        <button
          onClick={() => retry()}
          className="rounded-md bg-sky-600 px-4 py-2 text-white hover:bg-sky-500"
        >
          Retry
        </button>
      </div>
    )
  }

  const build = selectedChampion
    ? findBuild(selectedChampion.id, selectedRole, selectedMode)
    : null
  const modeConfig = MODE_CONFIG[selectedMode]
  const seedsForMode = BUILD_PATHS.filter((b) => b.mode === selectedMode)

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {champSelect.inChampSelect && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-900/25 px-4 py-2.5 text-sm text-emerald-200">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          Champ Select connected — auto-filling your champion, role, and enemy team
          from the draft as picks lock in.
        </div>
      )}
      {champSelect.available && !champSelect.inChampSelect && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs text-zinc-500">
          League client connected ({champSelect.phase}). Auto-fill activates when you
          enter champ select.
        </div>
      )}

      <div>
        <label className="mb-2 block text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Game Mode
        </label>
        <div className="flex gap-2">
          {(Object.keys(MODE_CONFIG) as GameMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => selectMode(mode)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                selectedMode === mode
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {MODE_CONFIG[mode].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Your Champion
          </label>
          <ChampionSelect
            champions={data.champions}
            patch={data.patch}
            selectedChampion={selectedChampion}
            onSelect={(c) => {
              selectChampion(c?.id ?? null)
              if (c) selectRole(defaultRole(c))
            }}
            clearable
          />
          {selectedChampion && (
            <p className="mt-2 text-sm text-zinc-500">
              {selectedChampion.name}, {selectedChampion.title} ·{' '}
              {selectedChampion.tags.join(' / ')}
            </p>
          )}
        </div>

        {modeConfig.hasRoles ? (
          <div>
            <label className="mb-2 block text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Role
            </label>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => (
                <button
                  key={role}
                  onClick={() => selectRole(role)}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    selectedRole === role
                      ? 'bg-sky-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="self-end text-sm text-zinc-500">
            No roles in {modeConfig.label} — builds are per champion. Enemy team is
            visible from the loading screen, so filling it in below pays off.
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Enemy Team <span className="font-normal normal-case">(optional)</span>
          </label>
          {enemies.length > 0 && (
            <button
              onClick={clearEnemies}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {enemyChampionIds.map((id, slot) => (
            <ChampionSelect
              key={slot}
              compact
              clearable
              champions={data.champions}
              patch={data.patch}
              selectedChampion={id ? (data.championsById[id] ?? null) : null}
              onSelect={(c) => setEnemyChampion(slot, c?.id ?? null)}
              placeholder={`Enemy ${slot + 1}`}
            />
          ))}
        </div>
        {comp.summary.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-amber-300/90">
            {comp.summary.map((s, i) => (
              <li key={i}>▸ {s}</li>
            ))}
          </ul>
        )}
      </div>

      {modeConfig.hasRoles && hasCounterPicks && counterPicks && (
        <div>
          <div className="mb-2">
            <label className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Counter-Pick Suggestions
            </label>
            <p className="text-xs text-zinc-500">
              Champions whose kit exploits this comp’s weaknesses. Heuristic (not
              matchup stats) — click one to build it. “Build” = full seeded build
              available.
            </p>
          </div>
          <CounterPicks
            suggestions={counterPicks}
            patch={data.patch}
            seededChampionIds={seededChampionIds}
            onPick={(championId, role) => {
              selectChampion(championId)
              selectRole(role)
            }}
          />
        </div>
      )}

      <hr className="border-zinc-800" />

      {!selectedChampion && (
        <div className="py-10 text-center text-zinc-500">
          <p className="mb-4">Pick your champion to get a build recommendation.</p>
          <p className="text-sm">
            Seeded {modeConfig.label} builds:{' '}
            {seedsForMode
              .map((b) => data.championsById[b.championId]?.name ?? b.championId)
              .join(', ')}
          </p>
        </div>
      )}

      {selectedChampion && !build && (
        <div className="py-10 text-center text-zinc-500">
          <p>
            No seeded {modeConfig.label} build for {selectedChampion.name} yet. MVP
            data covers:{' '}
            {seedsForMode
              .map((b) => data.championsById[b.championId]?.name ?? b.championId)
              .join(', ')}
            .
          </p>
        </div>
      )}

      {selectedChampion && build && (
        <>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-zinc-100">
              Recommended Build — {selectedChampion.name}{' '}
              {build.mode === 'ARAM' ? '(ARAM)' : build.role}
            </h2>
            <div className="flex items-center gap-2">
              <ImportBuildButton
                build={build}
                champion={selectedChampion}
                mapId={modeConfig.mapId}
                runes={data.runes}
                clientOpen={champSelect.available}
              />
              <Link
                to="/live"
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600"
              >
                Track in game →
              </Link>
            </div>
          </div>
          <BuildPathDisplay
            build={build}
            items={data.items}
            runes={data.runes}
            patch={data.patch}
            activeConditions={comp.activeConditions}
            champion={selectedChampion}
          />
        </>
      )}
    </div>
  )
}
