import { useEffect, useMemo, useRef, useState } from 'react'
import { championIconUrl } from '@/services/ddragon'
import type { DDragonChampion } from '@/types/ddragon'

interface Props {
  champions: DDragonChampion[]
  patch: string
  selectedChampion?: DDragonChampion | null
  onSelect: (champion: DDragonChampion | null) => void
  placeholder?: string
  compact?: boolean
  clearable?: boolean
}

const MAX_VISIBLE = 8

export function ChampionSelect({
  champions,
  patch,
  selectedChampion,
  onSelect,
  placeholder = 'Search champions…',
  compact = false,
  clearable = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return champions
    return champions.filter(
      (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    )
  }, [champions, query])

  useEffect(() => setHighlighted(0), [query])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const pick = (champion: DDragonChampion) => {
    onSelect(champion)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[highlighted]) pick(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const iconSize = compact ? 28 : 40

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        {selectedChampion && !open && (
          <img
            src={championIconUrl(patch, selectedChampion.id)}
            alt=""
            width={iconSize}
            height={iconSize}
            className="rounded"
          />
        )}
        <input
          type="text"
          value={open ? query : (selectedChampion?.name ?? '')}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className={`w-full rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 placeholder-zinc-500 focus:border-sky-500 focus:outline-none ${
            compact ? 'px-2 py-1 text-sm' : 'px-3 py-2'
          }`}
        />
        {clearable && selectedChampion && !open && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Clear selection"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <ul
          className="absolute z-20 mt-1 w-full overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-xl"
          style={{ maxHeight: MAX_VISIBLE * (compact ? 40 : 52) }}
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">No champions found</li>
          )}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => pick(c)}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left ${
                  i === highlighted ? 'bg-zinc-700/60' : ''
                }`}
              >
                <img
                  src={championIconUrl(patch, c.id)}
                  alt=""
                  width={compact ? 28 : 36}
                  height={compact ? 28 : 36}
                  className="rounded"
                  loading="lazy"
                />
                <span className="flex-1 truncate text-sm text-zinc-100">{c.name}</span>
                {!compact &&
                  c.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400"
                    >
                      {t}
                    </span>
                  ))}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
