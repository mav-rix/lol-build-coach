import { useState } from 'react'
import { ItemIcon } from '@/components/ItemIcon'
import { useStaticData } from '@/hooks/useStaticData'
import { findBuild } from '@/data/builds'
import { DEMO_MATCH, DEMO_MATCH_ARAM } from '@/data/demoMatch'
import { analyzeMatch, formatClock, formatDeviation } from '@/lib/analysis'
import { MODE_CONFIG } from '@/lib/modes'
import type { MatchAnalysis, MatchInput } from '@/types/app'

const TIP_STYLES = {
  positive: 'border-emerald-800 bg-emerald-900/20 text-emerald-300',
  negative: 'border-red-900 bg-red-900/20 text-red-300',
  neutral: 'border-zinc-700 bg-zinc-800/40 text-zinc-300',
} as const

function scoreColor(score: number) {
  if (score >= 80) return 'text-emerald-400'
  if (score >= 60) return 'text-amber-300'
  return 'text-red-400'
}

export default function Review() {
  const { data } = useStaticData()
  const [jsonInput, setJsonInput] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [match, setMatch] = useState<MatchInput | null>(null)
  const [analysis, setAnalysis] = useState<MatchAnalysis | null>(null)

  const runAnalysis = (input: MatchInput) => {
    if (!data) return
    const mode = input.mode ?? 'SR'
    const build = findBuild(input.championId, input.role ?? null, mode)
    if (!build) {
      setParseError(
        `No seeded ${MODE_CONFIG[mode].label} build path for ${input.championId} to compare against.`,
      )
      return
    }
    setParseError(null)
    setMatch(input)
    setAnalysis(analyzeMatch(input.actualBuild, build, input.stats, data.items))
  }

  const analyzePasted = () => {
    try {
      runAnalysis(JSON.parse(jsonInput) as MatchInput)
    } catch (e) {
      setParseError(`Invalid JSON: ${(e as Error).message}`)
    }
  }

  if (!data) {
    return <p className="py-20 text-center text-zinc-400">Loading Data Dragon…</p>
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="mb-2 text-lg font-bold text-zinc-100">Post-Game Review</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Automatic match import needs the backend + a Riot API key (Phase 3 of the
          roadmap). For now, load the demo match or paste match data as JSON —{' '}
          <code className="text-zinc-300">
            {'{ championId, role, actualBuild: [{ itemId, gameTime, goldAtTime }], stats }'}
          </code>
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <button
            onClick={() => runAnalysis(DEMO_MATCH)}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Load SR demo (Vayne, 37:25 win)
          </button>
          <button
            onClick={() => runAnalysis(DEMO_MATCH_ARAM)}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            Load ARAM demo (Ahri, 23:40 win)
          </button>
          <button
            onClick={() => setJsonInput(JSON.stringify(DEMO_MATCH, null, 2))}
            className="rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
          >
            Copy demo into editor
          </button>
        </div>
        <textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          placeholder="Paste match JSON here…"
          rows={6}
          className="mt-4 w-full rounded-md border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        <button
          onClick={analyzePasted}
          disabled={!jsonInput.trim()}
          className="mt-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
        >
          Analyze pasted match
        </button>
        {parseError && <p className="mt-3 text-sm text-red-400">{parseError}</p>}
      </section>

      {match && analysis && (
        <>
          <section className="flex flex-wrap items-center gap-6 rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="text-center">
              <div className={`text-6xl font-bold ${scoreColor(analysis.efficiencyScore)}`}>
                {analysis.efficiencyScore}
              </div>
              <div className="text-xs uppercase tracking-wide text-zinc-500">
                Build Efficiency
              </div>
            </div>
            <div className="space-y-1 text-sm text-zinc-300">
              <div>
                <span className="font-semibold text-zinc-100">
                  {data.championsById[match.championId]?.name ?? match.championId}
                </span>{' '}
                {match.mode === 'ARAM' ? 'ARAM' : (match.role ?? '')} ·{' '}
                <span
                  className={
                    match.stats.result === 'WIN' ? 'text-emerald-400' : 'text-red-400'
                  }
                >
                  {match.stats.result}
                </span>{' '}
                · {formatClock(match.stats.duration)}
              </div>
              <div>
                {match.stats.kills}/{match.stats.deaths}/{match.stats.assists} ·{' '}
                {match.stats.cs} CS (
                {(match.stats.cs / (match.stats.duration / 60)).toFixed(1)}/min)
              </div>
              <div>
                {match.stats.damageDealt.toLocaleString()} damage ·{' '}
                {match.stats.goldEarned.toLocaleString()} gold ·{' '}
                {(match.stats.damageDealt / match.stats.goldEarned).toFixed(2)} dmg/gold
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Build Timeline vs. Expected
            </h3>
            <div className="overflow-x-auto rounded-lg border border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Bought</th>
                    <th className="px-4 py-2">Target</th>
                    <th className="px-4 py-2">Deviation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {analysis.timelineComparison.map((row) => {
                    const item = data.items[String(row.itemId)]
                    return (
                      <tr key={row.itemId} className="bg-zinc-900/40">
                        <td className="flex items-center gap-2 px-4 py-2 text-zinc-200">
                          <ItemIcon
                            itemId={row.itemId}
                            patch={data.patch}
                            items={data.items}
                            size={28}
                          />
                          {item?.name ?? `Item ${row.itemId}`}
                        </td>
                        <td className="px-4 py-2 font-mono text-zinc-300">
                          {row.actualTime !== null ? formatClock(row.actualTime) : '—'}
                        </td>
                        <td className="px-4 py-2 font-mono text-zinc-500">
                          {formatClock(row.expectedTime)}
                        </td>
                        <td
                          className={`px-4 py-2 font-mono ${
                            row.deviation === null
                              ? 'text-zinc-600'
                              : !row.isCore
                                ? 'text-zinc-400'
                                : row.deviation > 120
                                  ? 'text-red-400'
                                  : row.deviation > 60
                                    ? 'text-amber-300'
                                    : 'text-emerald-400'
                          }`}
                        >
                          {row.deviation !== null
                            ? formatDeviation(row.deviation)
                            : 'not bought'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-600">
              Targets are projected from item costs at an average{' '}
              {MODE_CONFIG[match.mode ?? 'SR'].label} income of ~
              {MODE_CONFIG[match.mode ?? 'SR'].goldPerMin} gold/min. Only core items
              (colored) affect the score.
            </p>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Coaching Tips
            </h3>
            <ul className="space-y-2">
              {analysis.tips.length === 0 && (
                <li className="text-sm text-zinc-500">
                  Nothing stood out — solid, standard game.
                </li>
              )}
              {analysis.tips.map((tip, i) => (
                <li
                  key={i}
                  className={`rounded-lg border px-4 py-3 text-sm ${TIP_STYLES[tip.type]}`}
                >
                  <span className="mr-2 rounded bg-black/30 px-1.5 py-0.5 text-[10px] uppercase">
                    {tip.category}
                  </span>
                  {tip.message}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
