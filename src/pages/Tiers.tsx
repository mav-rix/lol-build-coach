import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRankedStats } from '@/hooks/useRankedStats'
import { useStaticData } from '@/hooks/useStaticData'
import { useAppStore } from '@/store/useAppStore'
import { championIconUrl } from '@/services/ddragon'
import { BUCKET_ORDER, type BucketKey, type RankedChampStat } from '@/lib/draft'
import { ROLES, type Role } from '@/types/app'

// Ranked tier list, per elo bucket: every champion graded from the same
// win/pick/ban dataset the draft assistant uses. Win rate is shrunk toward 50%
// by sample size (small samples can't reach the extreme tiers), which is what
// keeps a 12-game 60% champion out of S.

type Tier = 'S' | 'A' | 'B' | 'C' | 'D'

const TIER_STYLE: Record<Tier, string> = {
  S: 'bg-amber-400 text-zinc-900',
  A: 'bg-emerald-500 text-zinc-900',
  B: 'bg-sky-500 text-zinc-900',
  C: 'bg-zinc-500 text-zinc-950',
  D: 'bg-zinc-700 text-zinc-300',
}

// Grade on rank percentile within the slice, not absolute win rate — with a
// few hundred matches per bucket absolute thresholds put half the roster in S.
function tierOf(rank: number, total: number): Tier {
  const pct = rank / total
  if (pct < 0.1) return 'S'
  if (pct < 0.3) return 'A'
  if (pct < 0.7) return 'B'
  if (pct < 0.9) return 'C'
  return 'D'
}

interface Row {
  championId: string
  tier: Tier | null // assigned after ranking
  winRate: number
  adjusted: number
  games: number
  pickRate: number
  banRate: number
  role: Role | null // best role (games-wise) when no role filter is active
}

const MIN_GAMES = 10

function rowsFor(
  champions: Record<string, RankedChampStat>,
  matches: number,
  role: Role | 'ALL',
): Row[] {
  const rows: Row[] = []
  for (const [championId, stat] of Object.entries(champions)) {
    let games: number
    let wins: number
    if (role === 'ALL') {
      games = stat.g
      wins = stat.w
    } else {
      const r = stat.roles[role]
      if (!r) continue
      ;[games, wins] = r
    }
    if (games < MIN_GAMES) continue
    const winRate = (100 * wins) / games
    const adjusted = 50 + (winRate - 50) * (games / (games + 50))
    const bestRole =
      role === 'ALL'
        ? ((Object.entries(stat.roles).sort((a, b) => b[1][0] - a[1][0])[0]?.[0] as Role) ??
          null)
        : role
    rows.push({
      championId,
      tier: null,
      winRate,
      adjusted,
      games,
      pickRate: (100 * stat.g) / matches,
      banRate: (100 * stat.b) / matches,
      role: bestRole,
    })
  }
  rows.sort((a, b) => b.adjusted - a.adjusted)
  rows.forEach((row, i) => {
    row.tier = tierOf(i, rows.length)
  })
  return rows
}

export default function Tiers() {
  const { data } = useStaticData()
  const stats = useRankedStats()
  const navigate = useNavigate()
  const { selectChampion, selectRole, selectMode } = useAppStore()
  const [bucketKey, setBucketKey] = useState<BucketKey>('PLAT_EMERALD')
  const [role, setRole] = useState<Role | 'ALL'>('ALL')

  const availableBuckets = useMemo(
    () => BUCKET_ORDER.filter((k) => stats?.buckets[k]),
    [stats],
  )
  const bucket = stats?.buckets[bucketKey] ?? stats?.buckets[availableBuckets[0]]

  const rows = useMemo(
    () => (bucket ? rowsFor(bucket.champions, bucket.matches, role) : []),
    [bucket, role],
  )

  if (!stats || !data) {
    return (
      <p className="py-20 text-center text-zinc-400">
        {stats === null ? 'Loading ranked stats…' : 'Loading…'}
      </p>
    )
  }

  const openBuild = (row: Row) => {
    selectMode('SR')
    selectChampion(row.championId)
    if (row.role) selectRole(row.role)
    navigate('/')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-bold text-zinc-100">Ranked Tier List</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Win/pick/ban rates per elo from ranked solo queue, patch {stats.patch}. Click a
          champion to open its build.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex gap-2">
          {availableBuckets.map((k) => (
            <button
              key={k}
              onClick={() => setBucketKey(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                (stats.buckets[bucketKey] ? bucketKey : availableBuckets[0]) === k
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {stats.buckets[k]?.label ?? k}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {(['ALL', ...ROLES] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                role === r
                  ? 'bg-sky-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-zinc-500">
          Not enough games in this elo/role slice yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">Champion</th>
                <th className="px-3 py-2.5 font-semibold">Tier</th>
                <th className="px-3 py-2.5 text-right font-semibold">Win rate</th>
                <th className="px-3 py-2.5 text-right font-semibold">Pick rate</th>
                <th className="px-3 py-2.5 text-right font-semibold">Ban rate</th>
                <th className="px-3 py-2.5 text-right font-semibold">Games</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const champ = data.championsById[row.championId]
                return (
                  <tr
                    key={row.championId}
                    onClick={() => openBuild(row)}
                    className="cursor-pointer border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-zinc-800/50"
                  >
                    <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={championIconUrl(data.patch, row.championId)}
                          alt=""
                          className="h-7 w-7 rounded border border-zinc-700"
                          loading="lazy"
                        />
                        <span className="font-medium text-zinc-100">
                          {champ?.name ?? row.championId}
                        </span>
                        {role === 'ALL' && row.role && (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {row.role}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {row.tier && (
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded font-bold ${TIER_STYLE[row.tier]}`}
                        >
                          {row.tier}
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        row.winRate >= 52
                          ? 'text-emerald-400'
                          : row.winRate < 48
                            ? 'text-rose-400'
                            : 'text-zinc-300'
                      }`}
                    >
                      {row.winRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                      {row.pickRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                      {row.banRate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                      {row.games.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        {bucket ? `${bucket.matches.toLocaleString()} matches in ${bucket.label}` : ''} ·
        win rates are shrunk toward 50% by sample size before grading, so low-game
        champions can’t spike into S tier.
      </p>
    </div>
  )
}
