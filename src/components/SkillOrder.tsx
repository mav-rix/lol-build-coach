import { skillSequence } from '@/lib/skills'

interface Props {
  skillMaxOrder: string
  skillStart?: string
}

const SKILL_COLORS: Record<string, string> = {
  Q: 'bg-sky-600',
  W: 'bg-emerald-600',
  E: 'bg-violet-600',
  R: 'bg-amber-500 text-zinc-900',
}

export function SkillOrder({ skillMaxOrder, skillStart }: Props) {
  const sequence = skillSequence(skillMaxOrder, skillStart)

  return (
    <div>
      <div className="mb-3 text-lg font-semibold text-zinc-100">
        {skillMaxOrder}
        {skillStart && (
          <span className="ml-3 text-sm font-normal text-zinc-400">
            start {skillStart}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-1">
          {sequence.map((skill, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-zinc-500">{i + 1}</span>
              <span
                className={`flex h-7 w-7 items-center justify-center rounded text-xs font-bold text-white ${SKILL_COLORS[skill]}`}
              >
                {skill}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
