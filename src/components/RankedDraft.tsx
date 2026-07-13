import { useMemo } from 'react'
import { championIconUrl } from '@/services/ddragon'
import { COUNTER_LABELS } from '@/lib/counterpick'
import {
  NEED_LABELS,
  NEED_SUMMARY,
  allyCompNeeds,
  resolveBucket,
  suggestBans,
  suggestPicks,
  type RankedStatsData,
} from '@/lib/draft'
import type { ChampSelectState } from '@/hooks/useChampSelect'
import type { DDragonChampion } from '@/types/ddragon'
import type { Role } from '@/types/app'

interface Props {
  champSelect: ChampSelectState
  stats: RankedStatsData
  championsById: Record<string, DDragonChampion>
  patch: string
  onPick: (championId: string, role: Role) => void
}

const fmtRank = (rank: ChampSelectState['selfRank']) =>
  rank ? `${rank.tier.charAt(0)}${rank.tier.slice(1).toLowerCase()} ${rank.division}`.trim() : null

/**
 * Live ranked-draft assistant: statistical ban suggestions for the player's elo
 * and pick suggestions that weigh elo winrate, the ally comp taking shape from
 * hovers, and the revealed enemy comp.
 */
export function RankedDraft({ champSelect, stats, championsById, patch, onPick }: Props) {
  const { selfRank, self, allyChampionIds, enemyChampionIds, banChampionIds } = champSelect

  const resolved = useMemo(
    () => resolveBucket(stats, selfRank?.tier ?? null),
    [stats, selfRank],
  )

  const allies = useMemo(
    () =>
      allyChampionIds
        .map((id) => championsById[id])
        .filter((c): c is DDragonChampion => Boolean(c)),
    [allyChampionIds, championsById],
  )
  const enemies = useMemo(
    () =>
      enemyChampionIds
        .map((id) => (id ? championsById[id] : null))
        .filter((c): c is DDragonChampion => Boolean(c)),
    [enemyChampionIds, championsById],
  )

  const bans = useMemo(() => {
    if (!resolved) return []
    // Never suggest banning something your own team is hovering (or you locked).
    const exclude = new Set([...banChampionIds, ...allyChampionIds])
    if (self.championId) exclude.add(self.championId)
    return suggestBans(resolved, championsById, exclude)
  }, [resolved, banChampionIds, allyChampionIds, self.championId, championsById])

  const picks = useMemo(() => {
    if (!resolved || !self.role) return []
    const exclude = new Set([
      ...banChampionIds,
      ...allyChampionIds,
      ...enemyChampionIds.filter((id): id is string => id !== null),
    ])
    return suggestPicks(resolved, self.role, allies, enemies, championsById, exclude)
  }, [resolved, self.role, allies, enemies, banChampionIds, allyChampionIds, enemyChampionIds, championsById])

  const needs = useMemo(() => allyCompNeeds(allies), [allies])

  if (!resolved) return null
  const rankLabel = fmtRank(selfRank)

  return (
    <div>
      <div className="mb-2">
        <label className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
          Ranked Draft — {resolved.bucket.label}
          {rankLabel && <span className="font-normal normal-case"> (you: {rankLabel})</span>}
        </label>
        <p className="text-xs text-zinc-500">
          Win/pick/ban rates from {resolved.bucket.matches.toLocaleString()} ranked games on
          patch {stats.patch}.
          {!resolved.exact &&
            ' No dataset for your elo yet — showing the nearest bucket (npm run aggregate:ranked builds yours).'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-300/90">
            Ban targets — most OP in {resolved.bucket.label}
          </h4>
          <ul className="space-y-1.5">
            {bans.map((b) => (
              <li key={b.championId} className="flex items-center gap-2 rounded-md p-1">
                <img
                  src={championIconUrl(patch, b.championId)}
                  alt=""
                  width={32}
                  height={32}
                  className="rounded"
                  loading="lazy"
                />
                <span className="flex-1 truncate text-sm font-medium text-zinc-100">
                  {b.championName}
                </span>
                <span className="text-xs font-semibold text-emerald-300">{b.winRate}% WR</span>
                <span className="w-24 text-right text-[11px] text-zinc-500">
                  {b.pickRate}% pick · {b.banRate}% ban
                </span>
              </li>
            ))}
            {bans.length === 0 && (
              <li className="p-1 text-xs text-zinc-500">All top threats are already banned or hovered.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-sky-300/90">
            Pick for your comp{self.role ? ` — ${self.role}` : ''}
          </h4>
          {needs.size > 0 && (
            <p className="mb-2 text-[11px] text-amber-300/90">
              {[...needs].map((n) => NEED_SUMMARY[n]).join(' · ')}
            </p>
          )}
          <ul className="space-y-1.5">
            {picks.map((p) => (
              <li key={p.championId}>
                <button
                  type="button"
                  onClick={() => self.role && onPick(p.championId, self.role)}
                  className="flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-zinc-800/60"
                >
                  <img
                    src={championIconUrl(patch, p.championId)}
                    alt=""
                    width={32}
                    height={32}
                    className="rounded"
                    loading="lazy"
                  />
                  <span className="truncate text-sm font-medium text-zinc-100">
                    {p.championName}
                  </span>
                  <span className="flex flex-1 flex-wrap justify-end gap-1">
                    {p.fills.map((n) => (
                      <span
                        key={n}
                        className="rounded bg-sky-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-sky-300"
                      >
                        {NEED_LABELS[n]}
                      </span>
                    ))}
                    {p.answers.map((c) => (
                      <span
                        key={c}
                        className="rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-300"
                      >
                        {COUNTER_LABELS[c]}
                      </span>
                    ))}
                  </span>
                  <span className="text-xs font-semibold text-emerald-300">{p.winRate}% WR</span>
                </button>
              </li>
            ))}
            {picks.length === 0 && (
              <li className="p-1 text-xs text-zinc-500">
                {self.role
                  ? 'No stats for this role in your elo yet.'
                  : 'Waiting for your assigned role…'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
