import { ItemIcon } from '@/components/ItemIcon'
import { RunePage } from '@/components/RunePage'
import { SkillOrder } from '@/components/SkillOrder'
import { CONDITION_LABELS } from '@/lib/situational'
import { MODE_CONFIG } from '@/lib/modes'
import type { BuildPath, SituationalCondition } from '@/types/app'
import type { DDragonItem, DDragonRunePath } from '@/types/ddragon'

interface Props {
  build: BuildPath
  items: Record<string, DDragonItem>
  runes: DDragonRunePath[]
  patch: string
  activeConditions?: Set<SituationalCondition>
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

export function BuildPathDisplay({ build, items, runes, patch, activeConditions }: Props) {
  // Data Dragon flags which items exist per map — hide ones invalid in this mode.
  const mapKey = String(MODE_CONFIG[build.mode].mapId)
  const validOnMap = (itemId: number) => items[String(itemId)]?.maps[mapKey] !== false
  const situational = build.situationalItems.filter((s) => validOnMap(s.itemId))

  return (
    <div className="space-y-8">
      <Section title="Starter Items">
        <div className="flex gap-4">
          {build.starterItems.map((id) => (
            <ItemIcon key={id} itemId={id} patch={patch} items={items} showCost />
          ))}
        </div>
      </Section>

      <Section title="Core Build">
        <ol className="relative space-y-4 border-l border-zinc-700 pl-6">
          {build.coreItems.map((id, i) => {
            const item = items[String(id)]
            return (
              <li key={id} className="relative">
                <span className="absolute -left-[31px] top-3 flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="flex items-center gap-3">
                  <ItemIcon itemId={id} patch={patch} items={items} />
                  <div>
                    <div className="font-medium text-zinc-100">
                      {item?.name ?? `Item ${id}`}
                    </div>
                    {item && (
                      <div className="text-sm text-amber-400">{item.gold.total}g</div>
                    )}
                  </div>
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
          {build.sampleSize && ` · ${build.sampleSize.toLocaleString()} games`} · seeded
          build data
        </p>
      )}
    </div>
  )
}
