import { runeIconUrl } from '@/services/ddragon'
import { STAT_SHARDS } from '@/data/statShards'
import type { BuildPath } from '@/types/app'
import type { DDragonRune, DDragonRunePath } from '@/types/ddragon'

interface Props {
  build: BuildPath
  runes: DDragonRunePath[]
}

function findRune(runes: DDragonRunePath[], id: number): DDragonRune | null {
  for (const path of runes) {
    for (const slot of path.slots) {
      const rune = slot.runes.find((r) => r.id === id)
      if (rune) return rune
    }
  }
  return null
}

function RuneRow({ rune, size = 32 }: { rune: DDragonRune | null; size?: number }) {
  if (!rune) return null
  return (
    <div className="flex items-center gap-2" title={rune.shortDesc?.replace(/<[^>]+>/g, '')}>
      <img src={runeIconUrl(rune.icon)} alt="" width={size} height={size} />
      <span className="text-sm text-zinc-200">{rune.name}</span>
    </div>
  )
}

export function RunePage({ build, runes }: Props) {
  const primaryPath = runes.find((p) => p.id === build.primaryPathId)
  const secondaryPath = runes.find((p) => p.id === build.secondaryPathId)
  const keystone = findRune(runes, build.keystoneId)

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          {primaryPath && (
            <img src={runeIconUrl(primaryPath.icon)} alt="" width={20} height={20} />
          )}
          <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {primaryPath?.name ?? 'Primary'}
          </h4>
        </div>
        {keystone && (
          <div className="mb-3 flex items-center gap-3 rounded-md bg-zinc-800/80 p-2">
            <img src={runeIconUrl(keystone.icon)} alt="" width={48} height={48} />
            <div>
              <div className="font-medium text-amber-300">{keystone.name}</div>
              <div className="text-xs text-zinc-500">Keystone</div>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {build.primaryRuneIds.map((id) => (
            <RuneRow key={id} rune={findRune(runes, id)} />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-3 flex items-center gap-2">
          {secondaryPath && (
            <img src={runeIconUrl(secondaryPath.icon)} alt="" width={20} height={20} />
          )}
          <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            {secondaryPath?.name ?? 'Secondary'}
          </h4>
        </div>
        <div className="space-y-2">
          {build.secondaryRuneIds.map((id) => (
            <RuneRow key={id} rune={findRune(runes, id)} />
          ))}
        </div>
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Stat Shards
          </h5>
          <div className="flex flex-wrap gap-2">
            {build.statRuneIds.map((id, i) => (
              <span
                key={`${id}-${i}`}
                className="rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
              >
                {STAT_SHARDS[id] ?? `Shard ${id}`}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
