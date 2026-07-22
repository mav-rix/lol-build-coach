import { useMemo } from 'react'
import { CheckForUpdatesButton } from '@/components/CheckForUpdatesButton'
import { useProfile, type ProfileGame } from '@/hooks/useProfile'
import { useStaticData } from '@/hooks/useStaticData'
import { useAppStore } from '@/store/useAppStore'
import { championIconUrl, profileIconUrl } from '@/services/ddragon'
import type { DDragonChampion } from '@/types/ddragon'

// Queue id → short label. Covers the modes this app cares about; anything else
// falls back to a cleaned gameMode string.
const QUEUE_LABEL: Record<number, string> = {
  420: 'Ranked Solo',
  440: 'Ranked Flex',
  400: 'Normal Draft',
  430: 'Normal Blind',
  450: 'ARAM',
  2400: 'ARAM Mayhem',
  900: 'URF',
  700: 'Clash',
  1700: 'Arena',
  1900: 'URF',
}

const TIER_COLOR: Record<string, string> = {
  IRON: 'text-zinc-400',
  BRONZE: 'text-amber-700',
  SILVER: 'text-zinc-300',
  GOLD: 'text-amber-300',
  PLATINUM: 'text-teal-300',
  EMERALD: 'text-emerald-300',
  DIAMOND: 'text-sky-300',
  MASTER: 'text-fuchsia-300',
  GRANDMASTER: 'text-red-300',
  CHALLENGER: 'text-yellow-200',
}

function AutoOpenBuildToggle() {
  const enabled = useAppStore((s) => s.autoOpenBuild)
  const setEnabled = useAppStore((s) => s.setAutoOpenBuild)
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled(!enabled)}
        className={`relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition-colors ${
          enabled ? 'bg-sky-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            enabled ? 'left-3.5' : 'left-0.5'
          }`}
        />
      </button>
      <span className="text-xs leading-tight text-zinc-400">
        <span className="font-medium text-zinc-200">Auto-open build</span>
        <br />
        Jump to the build page when champ select starts.
      </span>
    </label>
  )
}

const titleCase = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)

function queueLabel(g: ProfileGame) {
  return QUEUE_LABEL[g.queueId] ?? titleCase(g.gameMode || 'Game')
}

function timeAgo(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function duration(d: number) {
  const sec = d > 10000 ? Math.round(d / 1000) : d // LCU is ms on older games
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function kda(k: number, d: number, a: number) {
  const ratio = d === 0 ? k + a : (k + a) / d
  return ratio.toFixed(1)
}

function GameRow({
  game,
  champ,
  patch,
}: {
  game: ProfileGame
  champ: DDragonChampion | null
  patch: string
}) {
  const win = game.win
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
        win === true
          ? 'border-sky-900/50 bg-sky-950/30'
          : win === false
            ? 'border-red-900/40 bg-red-950/20'
            : 'border-zinc-800 bg-zinc-900/40'
      }`}
    >
      {champ ? (
        <img
          src={championIconUrl(patch, champ.id)}
          alt={champ.name}
          className="h-10 w-10 rounded-md"
          loading="lazy"
        />
      ) : (
        <div className="h-10 w-10 rounded-md bg-zinc-800" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-zinc-100">
            {champ?.name ?? 'Unknown'}
          </span>
          <span
            className={`text-[11px] font-bold uppercase ${win ? 'text-sky-400' : win === false ? 'text-red-400' : 'text-zinc-500'}`}
          >
            {win === true ? 'Win' : win === false ? 'Loss' : '—'}
          </span>
        </div>
        <div className="text-[11px] text-zinc-500">
          {queueLabel(game)} · {duration(game.gameDuration)} · {timeAgo(game.gameCreation)}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular-nums text-zinc-200">
          {game.kills}/{game.deaths}/{game.assists}
        </div>
        <div className="text-[11px] text-zinc-500">{kda(game.kills, game.deaths, game.assists)} KDA</div>
      </div>
    </li>
  )
}

function RankBadge({ label, entry }: { label: string; entry: { tier: string; division: string; lp: number; wins: number; losses: number } | null }) {
  if (!entry) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <div className="text-[11px] font-medium text-zinc-500">{label}</div>
        <div className="text-sm font-semibold text-zinc-500">Unranked</div>
      </div>
    )
  }
  const total = entry.wins + entry.losses
  const wr = total ? Math.round((entry.wins / total) * 100) : 0
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={`text-sm font-bold ${TIER_COLOR[entry.tier] ?? 'text-zinc-200'}`}>
        {titleCase(entry.tier)} {entry.division} · {entry.lp} LP
      </div>
      <div className="text-[11px] text-zinc-500">
        {entry.wins}W {entry.losses}L · {wr}% WR
      </div>
    </div>
  )
}

export default function Profile() {
  const { profile } = useProfile()
  const { data } = useStaticData()
  const patch = data?.patch ?? ''

  // Recent games carry numeric champion ids; the static data is keyed by Data
  // Dragon id, so index it by numeric key once.
  const champByNumeric = useMemo(() => {
    const map = new Map<number, DDragonChampion>()
    if (data) for (const c of Object.values(data.championsById)) map.set(Number(c.key), c)
    return map
  }, [data])

  const sidebar = (
    <aside className="shrink-0">
      <CheckForUpdatesButton />
      <AutoOpenBuildToggle />
    </aside>
  )

  if (!profile) {
    return (
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          Loading your profile…
        </div>
        {sidebar}
      </div>
    )
  }

  if (!profile.clientOpen || !profile.summoner) {
    return (
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
          <p className="text-sm font-medium text-zinc-300">Open the League client to see your profile</p>
          <p className="mt-1 text-xs text-zinc-500">
            Your summoner info, rank, and recent games are read from the running client.
          </p>
        </div>
        {sidebar}
      </div>
    )
  }

  const s = profile.summoner
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="min-w-0 flex-1 space-y-5">
        {/* Summoner header */}
        <div className="flex items-center gap-4">
          {patch && s.profileIconId ? (
            <img
              src={profileIconUrl(patch, s.profileIconId)}
              alt=""
              className="h-16 w-16 rounded-lg ring-2 ring-zinc-700"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-zinc-800" />
          )}
          <div>
            <div className="text-xl font-bold text-zinc-100">
              {s.gameName}
              {s.tagLine && <span className="text-base font-medium text-zinc-500"> #{s.tagLine}</span>}
            </div>
            <div className="text-xs text-zinc-500">Level {s.level}</div>
          </div>
        </div>

        {/* Ranks */}
        <div className="grid grid-cols-2 gap-3">
          <RankBadge label="Ranked Solo/Duo" entry={profile.ranked?.solo ?? null} />
          <RankBadge label="Ranked Flex" entry={profile.ranked?.flex ?? null} />
        </div>

        {/* Recent games */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Recent games</h2>
          {profile.games && profile.games.length > 0 ? (
            <ul className="space-y-2">
              {profile.games.map((g) => (
                <GameRow
                  key={g.gameId}
                  game={g}
                  champ={champByNumeric.get(g.championId) ?? null}
                  patch={patch}
                />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-6 text-center text-xs text-zinc-500">
              No recent games found.
            </p>
          )}
        </div>
      </div>
      {sidebar}
    </div>
  )
}
