import { useEffect, useMemo, useState } from 'react'

// Arena / ARAM Mayhem augment tier list. A static win-rate reference — the Live
// Client API doesn't expose which augments are being offered, so this can't be a
// live "pick this now" helper. Data: src/data/augments.json (metadata from
// Community Dragon) joined with src/data/augmentStats.json (win-rates aggregated
// from Arena Match-V5). Both are lazy-imported so they stay out of the main
// bundle. Empty until `npm run aggregate:augments` has been run.

interface Augment {
  id: number
  name: string
  rarity: string
  desc: string
  icon: string
}
interface AugmentStat {
  id: number
  games: number
  avgPlacement: number
  firstRate: number
}
type RankedAugment = AugmentStat & { aug: Augment }
type Rarity = 'prismatic' | 'gold' | 'silver'

const RARITY_ORDER: Rarity[] = ['prismatic', 'gold', 'silver']
const RARITY_STYLE: Record<Rarity, { dot: string; text: string; label: string }> = {
  prismatic: { dot: 'bg-violet-400', text: 'text-violet-300', label: 'Prismatic' },
  gold: { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Gold' },
  silver: { dot: 'bg-zinc-400', text: 'text-zinc-300', label: 'Silver' },
}
const FILTERS: Array<{ key: 'all' | Rarity; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'prismatic', label: 'Prismatic' },
  { key: 'gold', label: 'Gold' },
  { key: 'silver', label: 'Silver' },
]

function AugmentRow({ rank, r }: { rank: number; r: RankedAugment }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
      <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600">
        {rank}
      </span>
      <img src={r.aug.icon} alt="" className="h-9 w-9 shrink-0 rounded" loading="lazy" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-100">{r.aug.name}</div>
        <p className="truncate text-xs text-zinc-500" title={r.aug.desc}>
          {r.aug.desc}
        </p>
      </div>
      <div className="shrink-0 text-right font-mono tabular-nums">
        <div className="text-sm font-semibold text-sky-300">{r.avgPlacement.toFixed(2)}</div>
        <div className="text-[10px] text-zinc-500">
          {r.firstRate}% 1st · {r.games.toLocaleString()}g
        </div>
      </div>
    </li>
  )
}

export default function Augments() {
  const [augments, setAugments] = useState<Augment[]>([])
  const [stats, setStats] = useState<AugmentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | Rarity>('all')

  useEffect(() => {
    Promise.all([import('@/data/augments.json'), import('@/data/augmentStats.json')])
      .then(([a, s]) => {
        setAugments(a.default as unknown as Augment[])
        setStats(s.default as unknown as AugmentStat[])
      })
      .finally(() => setLoading(false))
  }, [])

  // One ranked group per rarity, each sorted best-placement-first.
  const groups = useMemo(() => {
    const byId = new Map(augments.map((a) => [a.id, a]))
    const rows = stats
      .map((s) => ({ ...s, aug: byId.get(s.id) }))
      .filter((r): r is RankedAugment => Boolean(r.aug))
    return RARITY_ORDER.map((rarity) => ({
      rarity,
      rows: rows
        .filter((r) => r.aug.rarity === rarity)
        .sort((a, b) => a.avgPlacement - b.avgPlacement),
    })).filter((g) => g.rows.length > 0)
  }, [augments, stats])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Augment tier list</h1>
        <p className="text-sm text-zinc-400">
          Strongest Arena augments by average team placement (lower is better), from recent
          high-elo Arena games. ARAM Mayhem shares the same augments, so it applies there too.
          This is a static reference — the game doesn’t expose your live augment choices.
        </p>
      </header>

      {!loading && stats.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-sm text-zinc-400">
          No augment data yet. Generate it with a Riot dev key:
          <pre className="mt-2 rounded bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
            npm run augments:meta{'\n'}npm run aggregate:augments -- --region na1 --matches 500
          </pre>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  filter === f.key
                    ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            {groups
              .filter((g) => filter === 'all' || g.rarity === filter)
              .map((g) => {
                const style = RARITY_STYLE[g.rarity]
                return (
                  <section key={g.rarity} className="space-y-1.5">
                    <div className="flex items-center gap-2 px-1">
                      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                      <h2 className={`text-sm font-semibold ${style.text}`}>{style.label}</h2>
                      <span className="text-xs text-zinc-600">{g.rows.length}</span>
                    </div>
                    <ol className="space-y-1">
                      {g.rows.map((r, i) => (
                        <AugmentRow key={r.id} rank={i + 1} r={r} />
                      ))}
                    </ol>
                  </section>
                )
              })}
          </div>
        </>
      )}
    </div>
  )
}
