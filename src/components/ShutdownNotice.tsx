import { useStaticData } from '@/hooks/useStaticData'
import {
  ADVICE,
  DATA_PATCH,
  PROJECT_URL,
  SHUTDOWN_DATE,
  computeStaleness,
  type StalenessLevel,
} from '@/lib/shutdown'

// Colour escalates with the gap. 'current' stays neutral: on the day of the
// final release the data IS the live patch, and dressing that up as a warning
// would train people to ignore the banner before it ever means anything.
const TONE: Record<StalenessLevel, string> = {
  current: 'border-zinc-700 bg-zinc-800/60 text-zinc-300',
  aging: 'border-amber-700/60 bg-amber-950/40 text-amber-200',
  stale: 'border-orange-600/70 bg-orange-950/50 text-orange-200',
  ancient: 'border-red-700/70 bg-red-950/50 text-red-200',
}

/**
 * Permanent end-of-life notice. Deliberately not dismissible: the whole point
 * is that someone opening this app in a year is told the data is old, and a
 * dismissal saved in settings would defeat that for exactly the people most
 * likely to be running an ancient copy.
 */
export function ShutdownNotice() {
  const { data, isLoading } = useStaticData()

  // Until Data Dragon resolves we know nothing about the live patch, and
  // computeStaleness's no-version branch reads "couldn't reach Data Dragon" —
  // true after a failure, alarming and wrong during the first second of every
  // cold start. Say only what's known until the answer arrives.
  const staleness = isLoading ? null : computeStaleness(data?.patch)
  const level = staleness?.level ?? 'current'

  return (
    <div className={`border-b px-4 py-2.5 text-center text-xs ${TONE[level]}`}>
      <span className="font-semibold">
        This project is no longer maintained (ended {SHUTDOWN_DATE}).
      </span>{' '}
      <span>
        {staleness ? `${staleness.summary} ${ADVICE[staleness.level]}` : 'Checking the live patch…'}
      </span>{' '}
      <a
        href={PROJECT_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 opacity-80 hover:opacity-100"
      >
        Source and final build
      </a>
      <span className="opacity-60"> · bundled data from patch {DATA_PATCH}</span>
    </div>
  )
}
