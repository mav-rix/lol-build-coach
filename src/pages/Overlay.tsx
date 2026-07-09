import { useEffect } from 'react'
import { BuildNext } from '@/components/BuildNext'
import { EnemyThreats } from '@/components/EnemyThreats'
import { ItemIcon } from '@/components/ItemIcon'
import { useLiveBuildState } from '@/hooks/useLiveBuildState'
import { formatClock } from '@/lib/analysis'

// Compact in-game overlay, rendered inside a transparent always-on-top
// Electron window. Draws nothing but floating cards — the page background
// stays transparent so the game shows through.

export default function Overlay() {
  const {
    live,
    isInGame,
    staticData,
    items,
    patch,
    plan,
    ownedIds,
    nextPlanItem,
    recommendations,
    affordable,
    threats,
    gold,
    scores,
    gameTime,
    csPerMin,
  } = useLiveBuildState()

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => {
      document.documentElement.style.background = ''
      document.body.style.background = ''
    }
  }, [])

  if (!isInGame || !live) {
    return (
      <div className="flex justify-end p-2">
        <span className="rounded-full border border-zinc-700 bg-zinc-950/80 px-3 py-1 text-xs text-zinc-400">
          LoL Build Coach — waiting for game…
        </span>
      </div>
    )
  }

  return (
    <div className="ml-auto flex w-90 flex-col gap-2 p-2 text-zinc-100">
      {/* Header: time, gold, KDA/CS */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/85 px-3 py-2">
        <span className="font-mono text-sm text-zinc-400">{formatClock(gameTime)}</span>
        <span
          className={`text-xl font-bold ${affordable ? 'text-emerald-400' : 'text-amber-300'}`}
        >
          {Math.floor(gold).toLocaleString()}g
        </span>
        <span className="text-xs text-zinc-400">
          {scores ? `${scores.kills}/${scores.deaths}/${scores.assists}` : '—'} ·{' '}
          {csPerMin.toFixed(1)} cs/m
        </span>
      </div>

      {/* Adaptive build recommendations */}
      {recommendations.length > 0 && (
        <div className="rounded-lg bg-zinc-950/85 p-1">
          <BuildNext compact recommendations={recommendations} patch={patch} items={items} />
        </div>
      )}

      {/* Build checklist (icons only) */}
      {plan.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/85 px-3 py-2">
          {plan
            .filter((p) => p.label !== 'starter')
            .map((p) => {
              const owned = ownedIds.has(p.itemId)
              const isNext = nextPlanItem?.itemId === p.itemId
              return (
                <div
                  key={`${p.label}-${p.itemId}`}
                  className={`rounded ${
                    owned
                      ? 'ring-1 ring-emerald-500'
                      : isNext
                        ? 'ring-1 ring-sky-400'
                        : 'opacity-40'
                  }`}
                >
                  <ItemIcon itemId={p.itemId} patch={patch} items={items} size={26} />
                </div>
              )
            })}
        </div>
      )}

      {/* Enemy threats */}
      {threats && staticData && threats.enemies.length > 0 && (
        <EnemyThreats
          compact
          threats={threats}
          patch={patch}
          items={items}
          championsById={staticData.championsById}
        />
      )}
    </div>
  )
}
