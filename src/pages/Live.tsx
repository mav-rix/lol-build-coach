import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BuildNext } from '@/components/BuildNext'
import { EnemyThreats } from '@/components/EnemyThreats'
import { ItemIcon } from '@/components/ItemIcon'
import { useLiveBuildState } from '@/hooks/useLiveBuildState'
import { useAppStore } from '@/store/useAppStore'
import { formatClock } from '@/lib/analysis'

export default function Live() {
  const {
    live,
    isInGame,
    staticData,
    items,
    patch,
    self,
    championId,
    modeConfig,
    build,
    plan,
    ownedIds,
    purchaseTimes,
    nextPlanItem,
    nextItem,
    affordable,
    affordableComponents,
    recommendations,
    usingScoredBuild,
    threats,
    gold,
    scores,
    gameTime,
    csPerMin,
  } = useLiveBuildState()

  const { selectedChampionId, enemyChampionIds, setEnemyChampion } = useAppStore()

  // Sync live enemies into the store so the Build page's comp analysis matches.
  useEffect(() => {
    if (!threats || !staticData) return
    threats.enemies.slice(0, 5).forEach((e, slot) => {
      const known = staticData.championsById[e.championId] ? e.championId : null
      if (known && enemyChampionIds[slot] !== known) setEnemyChampion(slot, known)
    })
  }, [threats, staticData, enemyChampionIds, setEnemyChampion])

  if (!isInGame || !live) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mb-6 text-6xl">🕹️</div>
        <h2 className="mb-3 text-xl font-bold text-zinc-100">Not in game</h2>
        <p className="mb-2 text-zinc-400">
          Start a League of Legends match (Practice Tool works) and this page will
          connect automatically. It checks every 10 seconds.
        </p>
        <p className="mb-6 text-sm text-zinc-500">
          The tracker reads only scoreboard-visible data from the local Live Client
          API (127.0.0.1:2999) — read-only, Riot-compliant.
        </p>
        {!selectedChampionId && (
          <p className="text-sm text-zinc-500">
            Tip: pick your champion on the{' '}
            <Link to="/" className="text-sky-400 hover:underline">
              Build page
            </Link>{' '}
            first so the tracker knows your build path.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-zinc-100">
            {self?.championName ?? championId ?? 'In Game'}
          </h2>
          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-sm text-zinc-300">
            Lv {live.activePlayer.level}
          </span>
          <span className="rounded-full bg-violet-900/60 px-2.5 py-0.5 text-sm text-violet-300">
            {modeConfig.label}
          </span>
        </div>
        <div className="font-mono text-2xl text-zinc-300">{formatClock(gameTime)}</div>
      </header>

      {affordable && nextItem && (
        <div className="animate-pulse rounded-lg border border-amber-500 bg-amber-500/15 px-4 py-3 text-center font-semibold text-amber-300">
          {modeConfig.hasRecall
            ? `RECALL RECOMMENDED — you can afford ${nextItem.name} (${nextItem.gold.total}g)`
            : `${nextItem.name} AFFORDABLE (${nextItem.gold.total}g) — buy it on your next respawn`}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Current Gold</div>
          <div
            className={`mt-1 text-4xl font-bold ${
              affordable ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {Math.floor(gold).toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-zinc-500">KDA</div>
          <div className="mt-1 text-4xl font-bold text-zinc-100">
            {scores ? `${scores.kills}/${scores.deaths}/${scores.assists}` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <div className="text-xs uppercase tracking-wide text-zinc-500">CS</div>
          <div className="mt-1 text-4xl font-bold text-zinc-100">
            {scores?.creepScore ?? '—'}
            <span className="ml-2 text-base font-normal text-zinc-500">
              {csPerMin.toFixed(1)}/min
            </span>
          </div>
        </div>
      </div>

      {self && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Inventory
          </h3>
          <div className="flex gap-2">
            {Array.from({ length: 6 }).map((_, slot) => {
              const it = self.items.find((i) => i.slot === slot)
              return it ? (
                <ItemIcon key={slot} itemId={it.itemID} patch={patch} items={items} size={44} />
              ) : (
                <div
                  key={slot}
                  className="h-11 w-11 rounded border border-dashed border-zinc-800"
                />
              )
            })}
          </div>
        </section>
      )}

      {build ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Build Progress — {build.championId}{' '}
            {build.mode === 'ARAM' ? '(ARAM)' : build.role}
          </h3>
          <ul className="space-y-2">
            {plan.map((p) => {
              const item = items[String(p.itemId)]
              const owned = ownedIds.has(p.itemId)
              const isNext = nextPlanItem?.itemId === p.itemId
              const boughtAt = purchaseTimes.get(p.itemId)
              return (
                <li
                  key={`${p.label}-${p.itemId}`}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    owned
                      ? 'border-emerald-800/60 bg-emerald-900/20'
                      : isNext
                        ? 'border-sky-600 bg-sky-900/20'
                        : 'border-zinc-800 bg-zinc-900/40 opacity-60'
                  }`}
                >
                  <span className="w-5 text-center">
                    {owned ? '✓' : isNext ? '⧖' : '·'}
                  </span>
                  <ItemIcon itemId={p.itemId} patch={patch} items={items} size={32} />
                  <span className="flex-1 text-sm text-zinc-200">
                    {item?.name ?? `Item ${p.itemId}`}
                    <span className="ml-2 text-xs uppercase text-zinc-500">{p.label}</span>
                  </span>
                  {owned && boughtAt !== undefined && (
                    <span className="text-xs text-zinc-500">@ {formatClock(boughtAt)}</span>
                  )}
                  {isNext && item && (
                    <span
                      className={`text-sm font-semibold ${
                        affordable ? 'text-emerald-400' : 'text-zinc-400'
                      }`}
                    >
                      {affordable
                        ? `AFFORDABLE (${item.gold.total}g)`
                        : `need ${Math.ceil(item.gold.total - gold).toLocaleString()}g more`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {!affordable && affordableComponents.length > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <span className="text-sm text-zinc-400">Components you can afford now:</span>
              {affordableComponents.map((id) => (
                <ItemIcon key={id} itemId={id} patch={patch} items={items} size={32} showCost />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {recommendations.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Build Next — adapts to their items
          </h3>
          {usingScoredBuild && (
            <p className="mb-3 text-xs text-zinc-500">
              Computed for {championId ?? 'your champion'} from item stats + the enemy
              team (no hand-authored build needed).
            </p>
          )}
          <BuildNext recommendations={recommendations} patch={patch} items={items} />
        </section>
      )}

      {threats && staticData && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Enemy Threats — scoreboard data (same as TAB)
          </h3>
          <EnemyThreats
            threats={threats}
            patch={patch}
            items={items}
            championsById={staticData.championsById}
          />
        </section>
      )}
    </div>
  )
}
