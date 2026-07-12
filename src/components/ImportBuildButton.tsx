import { useEffect, useState } from 'react'
import { importBuildToClient } from '@/lib/lcuImport'
import type { BuildPath } from '@/types/app'
import type { DDragonChampion, DDragonRunePath } from '@/types/ddragon'

interface Props {
  build: BuildPath
  champion: DDragonChampion
  mapId: number
  runes: DDragonRunePath[]
  /** LCU bridge reachable and the League client open (champSelect.available). */
  clientOpen: boolean
}

type Phase = 'idle' | 'busy' | 'done' | 'error'

/**
 * Pushes the displayed build into the League client as a rune page + item set.
 * Works any time the client is open — the shop picks the set up at game start,
 * and the rune page applies to the next champ select (or the current one).
 */
export function ImportBuildButton({ build, champion, mapId, runes, clientOpen }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')

  // A different build invalidates any previous import result.
  useEffect(() => {
    setPhase('idle')
    setMessage('')
  }, [build])

  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setPhase('idle'), 4000)
    return () => clearTimeout(t)
  }, [phase])

  const run = async () => {
    setPhase('busy')
    const result = await importBuildToClient(build, champion, mapId, runes)
    setMessage(result.message)
    setPhase(result.ok ? 'done' : 'error')
  }

  const label =
    phase === 'busy'
      ? 'Importing…'
      : phase === 'done'
        ? 'Imported ✓'
        : phase === 'error'
          ? 'Retry import'
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
      <button
        onClick={run}
        disabled={!clientOpen || phase === 'busy'}
        title={
          clientOpen
            ? 'Create the rune page and item set in your League client'
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
