import { useMemo } from 'react'
import { championIconUrl } from '@/services/ddragon'
import type { LoadingPlayer, LoadingScreenState } from '@/hooks/useLoadingScreen'
import type { DDragonChampion } from '@/types/ddragon'

// Loading-screen scouting report: while League sits on the loading screen the
// overlay window becomes a centered, near-opaque dark panel (Porofessor-style)
// showing both teams — champion, name, rank, and recent form (hot/cold
// streaks) pulled from the LCU. It swaps back to the transparent side card the
// moment the game itself is reachable.

const TIER_COLOR: Record<string, string> = {
  IRON: 'text-zinc-500',
  BRONZE: 'text-amber-700',
  SILVER: 'text-zinc-300',
  GOLD: 'text-amber-400',
  PLATINUM: 'text-teal-300',
  EMERALD: 'text-emerald-400',
  DIAMOND: 'text-sky-300',
  MASTER: 'text-violet-400',
  GRANDMASTER: 'text-rose-400',
  CHALLENGER: 'text-yellow-300',
}

const tierLabel = (tier: string) =>
  tier.charAt(0) + tier.slice(1).toLowerCase()

function StreakChip({ streak }: { streak: NonNullable<LoadingPlayer['streak']> }) {
  const hot = streak.kind === 'hot'
  return (
    <span
      title={hot ? `Won the last ${streak.count} games` : `Lost the last ${streak.count} games`}
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
        hot ? 'bg-orange-500/15 text-orange-400' : 'bg-sky-500/15 text-sky-400'
      }`}
    >
      {streak.count}
      {hot ? 'W' : 'L'} {hot ? 'hot' : 'cold'} streak
    </span>
  )
}

function PlayerRow({
  player,
  patch,
  keyToId,
}: {
  player: LoadingPlayer
  patch: string
  keyToId: Map<number, string>
}) {
  const champId = keyToId.get(player.championId)
  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 ${
        player.isSelf ? 'bg-orange-500/10' : ''
      }`}
    >
      {champId && patch ? (
        <img
          src={championIconUrl(patch, champId)}
          alt={champId}
          className="h-9 w-9 shrink-0 rounded bg-zinc-900"
        />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-zinc-800" />
      )}
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-xs font-semibold ${
            player.isSelf ? 'text-orange-300' : 'text-zinc-100'
          }`}
        >
          {player.name}
        </div>
        <div
          className={`text-[10px] font-medium ${
            player.rank ? (TIER_COLOR[player.rank.tier] ?? 'text-zinc-400') : 'text-zinc-600'
          }`}
        >
          {player.rank
            ? `${tierLabel(player.rank.tier)}${player.rank.division ? ` ${player.rank.division}` : ''}`
            : 'Unranked'}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {player.streak && <StreakChip streak={player.streak} />}
        {player.recent && (
          <span
            title={`Last ${player.recent.wins + player.recent.losses} games`}
            className="font-mono text-[11px] tabular-nums text-zinc-400"
          >
            {player.recent.wins}–{player.recent.losses}
          </span>
        )}
      </div>
    </div>
  )
}

function TeamColumn({
  label,
  labelClass,
  players,
  patch,
  keyToId,
}: {
  label: string
  labelClass: string
  players: LoadingPlayer[]
  patch: string
  keyToId: Map<number, string>
}) {
  return (
    <div>
      <div
        className={`px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider ${labelClass}`}
      >
        {label}
      </div>
      <div className="divide-y divide-zinc-800/60">
        {players.map((p, i) => (
          <PlayerRow key={`${p.name}-${i}`} player={p} patch={patch} keyToId={keyToId} />
        ))}
      </div>
    </div>
  )
}

export function LoadingScreenPanel({
  data,
  patch,
  champions,
}: {
  data: LoadingScreenState
  patch: string
  champions: DDragonChampion[]
}) {
  // Data Dragon numeric key (103) → champion id ("Ahri") for icon URLs.
  const keyToId = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of champions) map.set(Number(c.key), c.id)
    return map
  }, [champions])

  return (
    <div className="flex h-screen w-screen items-center justify-center p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-950/95 text-zinc-100 shadow-2xl">
        <div className="flex items-baseline justify-between border-b border-zinc-800 px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
            Loading Screen · Scouting Report
          </span>
          <span className="text-[10px] text-zinc-500">
            switches to the in-game card when the match starts
          </span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-zinc-800">
          <TeamColumn
            label="Your Team"
            labelClass="text-sky-400"
            players={data.myTeam ?? []}
            patch={patch}
            keyToId={keyToId}
          />
          <TeamColumn
            label="Enemy Team"
            labelClass="text-red-400"
            players={data.enemyTeam ?? []}
            patch={patch}
            keyToId={keyToId}
          />
        </div>
        {data.windowMode === 0 && (
          <div className="border-t border-amber-700/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-300">
            League is set to <span className="font-semibold">Fullscreen</span> — the in-game
            overlay can&apos;t be drawn over exclusive fullscreen, so Tab won&apos;t show it once
            the match starts. Switch Window Mode to{' '}
            <span className="font-semibold">Borderless</span> (in-game Settings → Video).
          </div>
        )}
      </div>
    </div>
  )
}
