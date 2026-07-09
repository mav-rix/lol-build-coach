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

  const iconSize = compact ? 26 : 40
  const itemSize = compact ? 20 : 26

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-4'}>
      <ul className={compact ? 'space-y-1.5' : 'space-y-2'}>
        {threats.enemies.map((e) => (
          <li
            key={e.championId + e.championName}
            className={`flex items-center gap-2 rounded-lg border border-zinc-800 ${
              compact ? 'bg-zinc-950/80 px-2 py-1.5' : 'bg-zinc-900/60 px-3 py-2'
            }`}
          >
            <ChampIcon
              championId={e.championId}
              championName={e.championName}
              patch={patch}
              known={championsById[e.championId] !== undefined}
              size={iconSize}
            />
            {!compact && (
              <div className="w-24 min-w-0">
                <div className="truncate text-sm text-zinc-200">{e.championName}</div>
                <div className="text-xs text-zinc-500">Lv {e.level}</div>
              </div>
            )}
            <div className="flex flex-1 gap-1">
              {e.itemIds.map((id, i) => (
                <ItemIcon key={`${id}-${i}`} itemId={id} patch={patch} items={items} size={itemSize} />
              ))}
            </div>
            {e.note && (
              <span
                className={`min-w-0 truncate text-amber-300/90 ${
                  compact ? 'max-w-40 text-[10px]' : 'max-w-56 text-xs'
                }`}
                title={e.note}
              >
                {e.note}
              </span>
            )}
          </li>
        ))}
      </ul>
      {threats.notes.length > 0 && (
        <ul className={`space-y-1 ${compact ? 'text-[11px]' : 'text-sm'} text-amber-300/90`}>
          {threats.notes.map((n, i) => (
            <li key={i}>▸ {n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
