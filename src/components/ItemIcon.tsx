import { useEffect, useState } from 'react'
import { itemIconUrl } from '@/services/ddragon'
import type { DDragonItem } from '@/types/ddragon'

interface Props {
  itemId: number
  patch: string
  items: Record<string, DDragonItem>
  size?: number
  showCost?: boolean
}

export function ItemIcon({ itemId, patch, items, size = 48, showCost = false }: Props) {
  const [broken, setBroken] = useState(false)
  const item = items[String(itemId)]
  const name = item?.name ?? `Item ${itemId}`

  // A failed load isn't permanent — the patch may not have been known yet.
  useEffect(() => setBroken(false), [itemId, patch])

  return (
    <div className="flex flex-col items-center gap-1" title={item?.plaintext || name}>
      {broken || !patch ? (
        <div
          className="flex items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-[10px] text-zinc-500"
          style={{ width: size, height: size }}
        >
          ?
        </div>
      ) : (
        <img
          src={itemIconUrl(patch, itemId)}
          alt={name}
          width={size}
          height={size}
          className="rounded border border-zinc-700"
          onError={() => setBroken(true)}
          loading="lazy"
        />
      )}
      {showCost && item && (
        <span className="text-xs text-amber-400">{item.gold.total}g</span>
      )}
    </div>
  )
}
