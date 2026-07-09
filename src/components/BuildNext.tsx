import { ItemIcon } from '@/components/ItemIcon'
import type { BuildRec, RecPriority } from '@/lib/builder'
import type { DDragonItem } from '@/types/ddragon'

interface Props {
  recommendations: BuildRec[]
  patch: string
  items: Record<string, DDragonItem>
  compact?: boolean
}

const PRIORITY_STYLE: Record<RecPriority, string> = {
  urgent: 'border-amber-500/70 bg-amber-500/10',
  recommended: 'border-sky-600/60 bg-sky-900/20',
  planned: 'border-zinc-800 bg-zinc-900/50',
}

const PRIORITY_BADGE: Record<RecPriority, string> = {
  urgent: 'bg-amber-500 text-zinc-900',
  recommended: 'bg-sky-600 text-white',
  planned: 'bg-zinc-700 text-zinc-300',
}

const PRIORITY_LABEL: Record<RecPriority, string> = {
  urgent: 'Buy now',
  recommended: 'Recommended',
  planned: 'Planned',
}

export function BuildNext({ recommendations, patch, items, compact = false }: Props) {
  if (recommendations.length === 0) return null

  // Overlay: a glanceable horizontal strip of item icons + cost, priority shown
  // by border color — many fit per row in the narrow overlay window.
  if (compact) {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {recommendations.map((rec) => (
          <li
            key={rec.itemId}
            title={`${PRIORITY_LABEL[rec.priority]} · ${rec.name} · ${rec.cost}g`}
            className={`flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-1 ${
              PRIORITY_STYLE[rec.priority]
            }`}
          >
            <ItemIcon itemId={rec.itemId} patch={patch} items={items} size={30} />
            <span
              className={`text-[10px] font-semibold leading-none ${
                rec.affordable ? 'text-emerald-400' : 'text-zinc-400'
              }`}
            >
              {rec.cost}g
            </span>
          </li>
        ))}
      </ul>
    )
  }

  // Live page: detailed cards laid out inline (wrapping) rather than stacked.
  return (
    <ul className="flex flex-wrap gap-2">
      {recommendations.map((rec) => (
        <li
          key={rec.itemId}
          className={`flex flex-1 basis-56 items-center gap-2 rounded-lg border px-3 py-2 ${
            PRIORITY_STYLE[rec.priority]
          }`}
        >
          <ItemIcon itemId={rec.itemId} patch={patch} items={items} size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  PRIORITY_BADGE[rec.priority]
                }`}
              >
                {PRIORITY_LABEL[rec.priority]}
              </span>
              <span className="truncate text-sm font-medium text-zinc-100">
                {rec.name}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-zinc-400">{rec.reason}</p>
          </div>
          <div className="shrink-0 text-right">
            <div
              className={`text-sm font-semibold ${
                rec.affordable ? 'text-emerald-400' : 'text-zinc-400'
              }`}
            >
              {rec.affordable ? `${rec.cost}g ✓` : `${rec.cost}g`}
            </div>
            {!rec.affordable && (
              <div className="text-[10px] text-zinc-500">
                need {rec.goldNeeded.toLocaleString()}g
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
