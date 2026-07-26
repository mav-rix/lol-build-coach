import { useEffect, useState } from 'react'
import { importBuildToClient, overwriteRunePage } from '@/lib/lcuImport'
import type { BuildPath } from '@/types/app'
import type { DDragonChampion, DDragonItem, DDragonRunePath } from '@/types/ddragon'

interface Props {
  build: BuildPath
  champion: DDragonChampion
  mapId: number
  runes: DDragonRunePath[]
  items: Record<string, DDragonItem>
  /** LCU bridge reachable and the League client open (champSelect.available). */
  clientOpen: boolean
  /** ARAM Mayhem & other augmented-Abyss events: no rune pages, import items only. */
  skipRunes?: boolean
}

type Phase = 'idle' | 'busy' | 'done' | 'error'

/**
 * Pushes the displayed build into the League client as a rune page + item set.
 * Works any time the client is open — the shop picks the set up at game start,
 * and the rune page applies to the next champ select (or the current one).
 */
export function ImportBuildButton({
  build,
  champion,
  mapId,
  runes,
  items,
  clientOpen,
  skipRunes = false,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  // Set when the client's rune pages are all full of the player's own pages —
  // lets the player opt into overwriting one instead of just failing.
  const [runeOverwrite, setRuneOverwrite] = useState<{ id: number; name: string } | null>(null)

  // A different build invalidates any previous import result.
  useEffect(() => {
    setPhase('idle')
    setMessage('')
    setRuneOverwrite(null)
  }, [build])

  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setPhase('idle'), 4000)
    return () => clearTimeout(t)
  }, [phase])

  const run = async () => {
    setPhase('busy')
    setRuneOverwrite(null)
    const result = await importBuildToClient(build, champion, mapId, runes, items, skipRunes)
    setMessage(result.message)
    setRuneOverwrite(result.runeOverwrite ?? null)
    setPhase(result.ok ? 'done' : 'error')
  }

  const confirmOverwrite = async () => {
    if (!runeOverwrite) return
    setPhase('busy')
    const result = await overwriteRunePage(build, champion, runes, runeOverwrite.id)
    setMessage(result.message)
    setRuneOverwrite(null)
    setPhase(result.ok ? 'done' : 'error')
  }

  const label =
    phase === 'busy'
      ? 'Importing…'
      : phase === 'done'
        ? 'Imported ✓'
        : phase === 'error'
          ? 'Retry import'
          : skipRunes
            ? 'Import items to League client'
            : 'Import to League client'

  return (
    <div className="flex items-center gap-2">
      {(phase === 'done' || phase === 'error') && (
        <span
          className={`max-w-xs text-right text-xs ${
            phase === 'error' ? 'text-red-400' : 'text-emerald-400'
          }`}
        >
          {message}
        </span>
      )}
      {phase === 'error' && runeOverwrite && (
        <button
          onClick={confirmOverwrite}
          disabled={!clientOpen}
          title={`Delete "${runeOverwrite.name}" and put the coach rune page in its place`}
          className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          Overwrite &quot;{runeOverwrite.name}&quot;
        </button>
      )}
      <button
        onClick={run}
        disabled={!clientOpen || phase === 'busy'}
        title={
          clientOpen
            ? skipRunes
              ? 'Create the item set in your League client (this mode has no rune pages)'
              : 'Create the rune page and item set in your League client'
            : 'Open the League client (and the bridge, in dev) to enable importing'
        }
        className={`rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors ${
          phase === 'done'
            ? 'bg-emerald-700'
            : 'bg-violet-700 hover:bg-violet-600 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500'
        }`}
      >
        {label}
      </button>
    </div>
  )
}
