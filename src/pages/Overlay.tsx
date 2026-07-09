import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { BuildNext } from '@/components/BuildNext'
import { EnemyThreats } from '@/components/EnemyThreats'
import { ItemIcon } from '@/components/ItemIcon'
import { useLiveBuildState } from '@/hooks/useLiveBuildState'
import { formatClock } from '@/lib/analysis'

// Compact in-game overlay, rendered inside a transparent always-on-top Electron
// window. u.gg-style: one flat, near-opaque dark panel, hairline-divided
// sections, tabular numbers, orange = actionable / green = done / red = threat.
// Minimal chrome, maximal readable data.

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-zinc-800/70 px-2.5 py-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  )
}

export default function Overlay() {
  const {
    live,
    isInGame,
    staticData,
    items,
    patch,
    self,
    championId,
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
        <span className="rounded border border-zinc-800 bg-zinc-950/90 px-2.5 py-1 font-mono text-[11px] tracking-wide text-zinc-400">
          LoL Build Coach — waiting for game…
        </span>
      </div>
    )
  }

  const name = self?.championName ?? championId ?? 'In Game'
  const kda = scores ? `${scores.kills}/${scores.deaths}/${scores.assists}` : '—'
  const pathItems = plan.filter((p) => p.label !== 'starter')

  return (
    <div className="ml-auto w-[22rem] overflow-hidden rounded-md border border-zinc-800/80 bg-zinc-950/92 text-zinc-100 shadow-xl backdrop-blur-sm">
      {/* Header — identity + live stat line, all tabular */}
      <div className="px-2.5 pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-bold tracking-wide text-zinc-100">{name}</span>
            <span className="text-[10px] font-semibold text-zinc-500">Lv{live.activePlayer.level}</span>
          </div>
          <span className="font-mono text-xs tabular-nums text-zinc-400">{formatClock(gameTime)}</span>
        </div>
        <div className="flex items-center gap-3 pb-2 pt-0.5 font-mono text-xs tabular-nums">
          <span className={affordable ? 'font-semibold text-orange-400' : 'text-amber-300'}>
            {Math.floor(gold).toLocaleString()}g
          </span>
          <span className="text-zinc-300">{kda}</span>
          <span className="text-zinc-500">{csPerMin.toFixed(1)} cs/m</span>
        </div>
      </div>

      {recommendations.length > 0 && (
        <Section label="Build Next">
          <BuildNext compact recommendations={recommendations} patch={patch} items={items} />
        </Section>
      )}

      {pathItems.length > 0 && (
        <Section label="Build Path">
          <div className="flex flex-wrap items-center gap-1">
            {pathItems.map((p, i) => {
              const owned = ownedIds.has(p.itemId)
              const isNext = nextPlanItem?.itemId === p.itemId
              return (
                <div key={`${p.label}-${p.itemId}`} className="flex items-center gap-1">
                  <div
                    title={items[String(p.itemId)]?.name}
                    className={`rounded ${
                      owned
                        ? 'ring-1 ring-emerald-600/70'
                        : isNext
                          ? 'ring-1 ring-orange-500'
                          : 'opacity-40'
                    }`}
                  >
                    <ItemIcon itemId={p.itemId} patch={patch} items={items} size={26} />
                  </div>
                  {i < pathItems.length - 1 && (
                    <span className="text-[10px] text-zinc-700" aria-hidden>
                      ›
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {threats && staticData && threats.enemies.length > 0 && (
        <Section label="Enemies">
          <EnemyThreats
            compact
            threats={threats}
            patch={patch}
            items={items}
            championsById={staticData.championsById}
          />
        </Section>
      )}
    </div>
  )
}
