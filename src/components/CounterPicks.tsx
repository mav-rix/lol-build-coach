import { championIconUrl } from '@/services/ddragon'
import { COUNTER_LABELS, type CounterSuggestion } from '@/lib/counterpick'
import { ROLES, type Role } from '@/types/app'

interface Props {
  suggestions: Record<Role, CounterSuggestion[]>
  patch: string
  seededChampionIds: Set<string>
  onPick: (championId: string, role: Role) => void
}

export function CounterPicks({ suggestions, patch, seededChampionIds, onPick }: Props) {
  const rolesWithPicks = ROLES.filter((role) => suggestions[role].length > 0)
  if (rolesWithPicks.length === 0) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rolesWithPicks.map((role) => (
        <div key={role} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            {role}
          </h4>
          <ul className="space-y-2">
            {suggestions[role].map((s) => (
              <li key={s.championId}>
                <button
                  type="button"
                  onClick={() => onPick(s.championId, role)}
                  className="flex w-full items-start gap-2 rounded-md p-1.5 text-left hover:bg-zinc-800/60"
                >
                  <img
                    src={championIconUrl(patch, s.championId)}
                    alt=""
                    width={36}
                    height={36}
                    className="rounded"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-zinc-100">
                        {s.championName}
                      </span>
                      {seededChampionIds.has(s.championId) && (
                        <span className="rounded bg-emerald-800/70 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-300">
                          Build
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {s.matched.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-300"
                        >
                          {COUNTER_LABELS[c]}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">{s.why}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
