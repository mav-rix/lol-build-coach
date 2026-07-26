import { useServerStatus } from '@/hooks/useServerStatus'

// Small nav pill for the detected region's server health. Hidden entirely
// while there's no data (client closed, bridge not running, or the
// unofficial status feed unavailable) — see useServerStatus. Always links out
// to the official status page as ground truth, live badge or not.

const DOT = {
  online: 'bg-emerald-400',
  maintenance: 'bg-amber-400',
  incident: 'bg-rose-400',
}

const LABEL = {
  online: 'Servers OK',
  maintenance: 'Maintenance',
  incident: 'Server issues',
}

export function ServerStatusBadge() {
  const { status } = useServerStatus()
  if (!status) return null

  const tooltip =
    status.issues.length > 0
      ? status.issues.map((i) => i.title).join('\n')
      : `${status.name} — all systems operational`

  return (
    <a
      href={`https://status.riotgames.com/?p=lol&region=${status.platform}`}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      className="flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status.status]}`} />
      {LABEL[status.status]}
    </a>
  )
}
