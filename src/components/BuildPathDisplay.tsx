import { ItemIcon } from '@/components/ItemIcon'
import { RunePage } from '@/components/RunePage'
import { SkillOrder } from '@/components/SkillOrder'
import { CONDITION_LABELS } from '@/lib/situational'
import { JUNGLE_PET_IDS, pickJunglePet } from '@/lib/jungle'
import { pickSupportItem } from '@/lib/support'
import { MODE_CONFIG } from '@/lib/modes'
import type { BuildPath, SituationalCondition } from '@/types/app'
import type { DDragonChampion, DDragonItem, DDragonRunePath } from '@/types/ddragon'

interface Props {
  build: BuildPath
  items: Record<string, DDragonItem>
  runes: DDragonRunePath[]
  patch: string
  activeConditions?: Set<SituationalCondition>
  champion?: DDragonChampion | null
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  )
}

export function BuildPathDisplay({
  build,
  items,
  runes,
  patch,
  activeConditions,
  champion,
}: Props) {
  // Data Dragon flags which items exist per map — hide ones invalid in this mode.
  const mapKey = String(MODE_CONFIG[build.mode].mapId)
  const validOnMap = (itemId: number) => items[String(itemId)]?.maps[mapKey] !== false
  const situational = build.situationalItems.filter((s) => validOnMap(s.itemId))

  // Jungle companion is chosen by enemy comp, not baked into the seed — swap the
  // seed's pet for the comp-appropriate one and explain the pick.
  const jungle =
    build.role === 'JUNGLE' && build.mode === 'SR'
      ? pickJunglePet(activeConditions ?? new Set(['general']))
      : null
  const starterItems = jungle
    ? [jungle.itemId, ...build.starterItems.filter((id) => !JUNGLE_PET_IDS.has(id))]
    : build.starterItems

  // Support: the starter is fixed (World Atlas); the comp/class-picked *final*
  // upgrade is surfaced as a target the quest builds toward.
  const support =
    build.role === 'SUPPORT' && build.mode === 'SR' && champion
      ? pickSupportItem(champion, activeConditions ?? new Set(['general']))
      : null

  return (
    <div className="space-y-8">
      <Section title="Starter Items">
        <div className="flex gap-4">
          {starterItems.map((id) => (
            <ItemIcon key={id} itemId={id} patch={patch} items={items} showCost />
          ))}
        </div>
        {jungle && (
          <p className="mt-2 text-xs text-amber-300/90">▸ {jungle.reason}</p>
        )}
        {support && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <ItemIcon itemId={support.itemId} patch={patch} items={items} size={32} />
            <p className="text-xs text-amber-300/90">
              Support quest target — {support.reason}
            </p>
          </div>
        )}
      </Section>

      <Section title="Core Build Path">
        <ol className="flex flex-wrap items-stretch gap-y-3">
          {build.coreItems.map((id, i) => {
            const item = items[String(id)]
            const stats = build.coreItemStats?.[id]
            return (
              <li key={id} className="flex items-center">
                {i > 0 && (
                  <span aria-hidden className="mx-1.5 self-center text-lg text-zinc-600">
                    →
                  </span>
                )}
                <div className="relative flex w-[92px] flex-col items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 pb-2 pt-3 text-center">
                  <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <ItemIcon itemId={id} patch={patch} items={items} size={44} />
                  <div className="w-full truncate text-xs font-medium text-zinc-200">
                    {item?.name ?? `Item ${id}`}
                  </div>
                  <div className="text-[11px] text-amber-400">
                    {item ? `${item.gold.total}g` : ''}
                  </div>
                  {stats && (
                    <div
                      className="text-[10px] leading-tight text-zinc-500"
                      title={`Built in ${stats.pickRate}% of games (${stats.games} games)`}
                    >
                      <span
                        className={
                          stats.winRate >= 52
                            ? 'text-emerald-400'
                            : stats.winRate < 48
                              ? 'text-rose-400'
                              : 'text-zinc-400'
                        }
                      >
                        {stats.winRate}% WR
                      </span>{' '}
                      · {stats.pickRate}% pick
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </Section>

      <Section title="Boots">
        <div className="flex gap-4">
          {build.bootsOptions.map((id) => (
            <ItemIcon key={id} itemId={id} patch={patch} items={items} showCost />
          ))}
        </div>
      </Section>

      <Section title="Situational Items">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {situational.map((s) => {
            const highlighted =
              activeConditions?.has(s.condition) && s.condition !== 'general'
            return (
              <div
                key={s.itemId}
                className={`flex items-start gap-3 rounded-lg border p-3 ${
                  highlighted
                    ? 'border-amber-500/70 bg-amber-500/10'
                    : 'border-zinc-800 bg-zinc-900/60'
                }`}
              >
                <ItemIcon itemId={s.itemId} patch={patch} items={items} size={40} />
                <div className="min-w-0">
                  <span
                    className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      highlighted
                        ? 'bg-amber-500 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {CONDITION_LABELS[s.condition]}
                  </span>
                  <p className="text-xs text-zinc-400">{s.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Runes">
        <RunePage build={build} runes={runes} />
      </Section>

      <Section title="Skill Order">
        <SkillOrder skillMaxOrder={build.skillMaxOrder} skillStart={build.skillStart} />
      </Section>

      {build.notes.length > 0 && (
        <Section title="Notes">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-300">
            {build.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Section>
      )}

      {build.winRate !== undefined && (
        <p className="text-xs text-zinc-500">
          {build.winRate}% win rate
          {build.sampleSize && ` · ${build.sampleSize.toLocaleString()} games`} ·{' '}
          {build.patch === 'seed'
            ? 'hand-tuned seed build'
            : `high-elo data from patch ${build.patch}`}
        </p>
      )}
    </div>
  )
}
