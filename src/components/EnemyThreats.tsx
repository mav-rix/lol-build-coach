import { useState } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { championIconUrl } from '@/services/ddragon'
import type { LiveThreatAnalysis } from '@/lib/threats'
import type { DDragonChampion, DDragonItem } from '@/types/ddragon'

interface Props {
  threats: LiveThreatAnalysis
  patch: string
  items: Record<string, DDragonItem>
  championsById: Record<string, DDragonChampion>
  compact?: boolean
}

function ChampIcon({
  championId,
  championName,
  patch,
  known,
  size,
}: {
  championId: string
  championName: string
  patch: string
  known: boolean
  size: number
}) {
  const [broken, setBroken] = useState(false)
  if (!known || broken) {
    return (
      <div
        className="flex items-center justify-center rounded bg-zinc-800 text-xs font-bold text-zinc-400"
        style={{ width: size, height: size }}
        title={championName}
      >
        {championName.slice(0, 2)}
      </div>
    )
  }
  return (
    <img
      src={championIconUrl(patch, championId)}
      alt={championName}
      width={size}
      height={size}
      className="rounded"
      onError={() => setBroken(true)}
    />
  )
}

export function EnemyThreats({ threats, patch, items, championsById, compact = false }: Props) {
  if (threats.enemies.length === 0) {
    return compact ? null : (
      <p className="text-sm text-zinc-500">No enemy players visible yet.</p>
    )
  }

  // Overlay (u.gg style): flat table — portrait · level · items · threat note,
  // hairline-divided rows, threats in red.
  if (compact) {
    return (
      <div>
        <div className="divide-y divide-zinc-800/60">
          {threats.enemies.map((e) => (
            <div key={e.championId + e.championName} className="flex items-center gap-2 py-1">
              <ChampIcon
                championId={e.championId}
                championName={e.championName}
                patch={patch}
                known={championsById[e.championId] !== undefined}
                size={24}
              />
              <span className="w-4 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                {e.level}
              </span>
              <div className="flex flex-1 flex-wrap gap-0.5">
                {e.itemIds.map((id, i) => (
                  <ItemIcon key={`${id}-${i}`} itemId={id} patch={patch} items={items} size={18} />
                ))}
              </div>
              {e.note && (
                <span
                  className="max-w-32 shrink-0 truncate text-right text-[10px] text-red-400/90"
                  title={e.note}
                >
                  {e.note}
                </span>
              )}
            </div>
          ))}
        </div>
        {threats.notes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[10px] text-red-400/80">
            {threats.notes.map((n, i) => (
              <li key={i}>▸ {n}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const iconSize = 40
  const itemSize = 26

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {threats.enemies.map((e) => (
          <li
            key={e.championId + e.championName}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
          >
            <ChampIcon
              championId={e.championId}
              championName={e.championName}
              patch={patch}
              known={championsById[e.championId] !== undefined}
              size={iconSize}
            />
            <div className="w-24 min-w-0">
              <div className="truncate text-sm text-zinc-200">{e.championName}</div>
              <div className="text-xs text-zinc-500">Lv {e.level}</div>
            </div>
            <div className="flex flex-1 gap-1">
              {e.itemIds.map((id, i) => (
                <ItemIcon key={`${id}-${i}`} itemId={id} patch={patch} items={items} size={itemSize} />
              ))}
            </div>
            {e.note && (
              <span
                className="min-w-0 max-w-56 truncate text-xs text-amber-300/90"
                title={e.note}
              >
                {e.note}
              </span>
            )}
          </li>
        ))}
      </ul>
      {threats.notes.length > 0 && (
        <ul className="space-y-1 text-sm text-amber-300/90">
          {threats.notes.map((n, i) => (
            <li key={i}>▸ {n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
