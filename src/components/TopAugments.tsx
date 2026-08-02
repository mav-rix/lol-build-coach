import { useEffect, useState } from 'react'
import { loadAugmentData, topAugmentsFor } from '@/lib/augments'

const RARITY_DOT: Record<string, string> = {
  prismatic: 'bg-violet-400',
  gold: 'bg-amber-400',
  silver: 'bg-zinc-400',
}

interface Props {
  championId: string
  championName: string
}

/** Pre-game "best augments for this champion" reference for Arena, from real
 *  Arena Match-V5 win-rate data — the same dataset the Augments tier list
 *  page uses, scoped to one champion. */
export function TopAugments({ championId, championName }: Props) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    loadAugmentData().then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return null
  const augments = topAugmentsFor(championId, 6)
  if (augments.length === 0) return null

  return (
    <div>
      <label className="mb-2 block text-sm font-semibold uppercase tracking-wide text-zinc-400">
        Top Augments — {championName}
      </label>
      <p className="mb-2 text-xs text-zinc-500">
        Best avg. placement from Arena games. Not offer-aware (Riot doesn’t expose your augment
        choices live) — a reference for what to prioritize when it comes up.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {augments.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2.5 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
          >
            <img
              src={a.meta.icon}
              alt=""
              className="h-9 w-9 shrink-0 rounded"
              loading="lazy"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${RARITY_DOT[a.meta.rarity] ?? RARITY_DOT.silver}`}
                />
                <span className="truncate text-sm font-medium text-zinc-100">{a.meta.name}</span>
                {a.source === 'champion' && (
                  <span className="shrink-0 rounded bg-sky-800/70 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-300">
                    {championName}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-zinc-500">
                {a.avgPlacement.toFixed(2)} avg place · {a.firstRate}% 1st
                {a.pickRate != null ? ` · ${a.pickRate}% pick` : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
