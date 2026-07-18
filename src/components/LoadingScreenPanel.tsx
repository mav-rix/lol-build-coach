import { useMemo } from 'react'
import { championLoadingUrl } from '@/services/ddragon'
import { useRankedStats } from '@/hooks/useRankedStats'
import { resolveBucket, type RankedStatsData } from '@/lib/draft'
import type { LoadingPlayer, LoadingScreenState } from '@/hooks/useLoadingScreen'
import type { DDragonChampion } from '@/types/ddragon'

// Loading-screen scouting report: while League sits on the loading screen the
// overlay window becomes a centered, near-opaque dark panel showing both teams
// laid out the way League's own loading screen is — five champion portraits in
// a horizontal row, yours on top and the enemy on the bottom. Each portrait
// carries a profile card underneath it (name, rank, recent form) pulled from
// the LCU. It swaps back to the transparent side card once the match clock
// starts running.

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

// Ring color painted around each portrait, echoing the rank crest border
// League draws on loading-screen frames.
const TIER_RING: Record<string, string> = {
  IRON: 'ring-zinc-600',
  BRONZE: 'ring-amber-700',
  SILVER: 'ring-zinc-400',
  GOLD: 'ring-amber-400',
  PLATINUM: 'ring-teal-400',
  EMERALD: 'ring-emerald-400',
  DIAMOND: 'ring-sky-400',
  MASTER: 'ring-violet-400',
  GRANDMASTER: 'ring-rose-400',
  CHALLENGER: 'ring-yellow-300',
}

const tierLabel = (tier: string) =>
  tier.charAt(0) + tier.slice(1).toLowerCase()

function StreakChip({ streak }: { streak: NonNullable<LoadingPlayer['streak']> }) {
  const hot = streak.kind === 'hot'
  return (
    <span
      title={hot ? `Won the last ${streak.count} games` : `Lost the last ${streak.count} games`}
      className={`rounded px-1 py-0.5 text-[9px] font-bold leading-none tabular-nums ${
        hot ? 'bg-orange-500/20 text-orange-300' : 'bg-sky-500/20 text-sky-300'
      }`}
    >
      {streak.count}
      {hot ? 'W' : 'L'}
    </span>
  )
}

// Win rate on THIS champion at the player's own elo (nearest aggregated
// bucket), from the same dataset the draft assistant uses. Null when the
// stats chunk is missing or the champ has too few games there to mean much.
function champWinRate(
  stats: RankedStatsData | null,
  champId: string | undefined,
  tier: string | null,
): { winRate: number; games: number; bucketLabel: string } | null {
  if (!stats || !champId) return null
  const resolved = resolveBucket(stats, tier)
  const entry = resolved?.bucket.champions[champId]
  if (!resolved || !entry || entry.g < 10) return null
  return {
    winRate: (100 * entry.w) / entry.g,
    games: entry.g,
    bucketLabel: resolved.bucket.label,
  }
}

function PlayerCard({
  player,
  keyToId,
  accent,
  stats,
}: {
  player: LoadingPlayer
  keyToId: Map<number, string>
  accent: string
  stats: RankedStatsData | null
}) {
  const champId = keyToId.get(player.championId)
  const champWr = champWinRate(stats, champId, player.rank?.tier ?? null)
  const ring = player.isSelf
    ? 'ring-orange-400'
    : player.rank
      ? (TIER_RING[player.rank.tier] ?? 'ring-zinc-700')
      : 'ring-zinc-700'

  return (
    <div className="flex w-full min-w-0 flex-col items-stretch">
      {/* Portrait — League uses the tall loading crop */}
      <div
        className={`relative w-full overflow-hidden rounded-md ring-2 ${ring} ${
          player.isSelf ? 'ring-offset-1 ring-offset-orange-500/40' : ''
        }`}
        style={{ aspectRatio: '3 / 4' }}
      >
        {champId ? (
          <img
            src={championLoadingUrl(champId)}
            alt={champId}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full bg-zinc-800" />
        )}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent" />
        {/* Name over the base of the portrait, like League */}
        <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1">
          <div
            className={`truncate text-center text-[11px] font-semibold ${
              player.isSelf ? 'text-orange-300' : 'text-zinc-50'
            }`}
            title={player.name}
          >
            {player.name}
          </div>
        </div>
        <div className={`absolute inset-x-0 top-0 h-0.5 ${accent}`} />
      </div>

      {/* Profile block under the portrait */}
      <div className="mt-1 flex flex-col items-center gap-1">
        <div
          className={`text-[10px] font-semibold leading-none ${
            player.rank ? (TIER_COLOR[player.rank.tier] ?? 'text-zinc-400') : 'text-zinc-600'
          }`}
        >
          {player.rank
            ? `${tierLabel(player.rank.tier)}${player.rank.division ? ` ${player.rank.division}` : ''}`
            : 'Unranked'}
        </div>
        <div className="flex items-center gap-1.5">
          {player.streak && <StreakChip streak={player.streak} />}
          {player.recent && (
            <span
              title={`Last ${player.recent.wins + player.recent.losses} games`}
              className="font-mono text-[10px] leading-none tabular-nums text-zinc-400"
            >
              {player.recent.wins}–{player.recent.losses}
            </span>
          )}
        </div>
        {champWr && (
          <span
            title={`${champWr.winRate.toFixed(1)}% win rate on this champion in ${champWr.bucketLabel} (${champWr.games} games)`}
            className={`font-mono text-[10px] leading-none tabular-nums ${
              champWr.winRate >= 52
                ? 'text-emerald-400'
                : champWr.winRate < 48
                  ? 'text-rose-400'
                  : 'text-zinc-400'
            }`}
          >
            {Math.round(champWr.winRate)}% champ
          </span>
        )}
      </div>
    </div>
  )
}

// Placeholder frame for an unfilled slot (practice tool, custom games, bots the
// LCU doesn't report) — keeps the 5-across layout so real players stay in the
// slot they'd occupy on League's own loading screen.
function EmptySlot() {
  return (
    <div className="flex w-full min-w-0 flex-col items-stretch opacity-40">
      <div
        className="w-full rounded-md border border-dashed border-zinc-700 bg-zinc-900/40"
        style={{ aspectRatio: '3 / 4' }}
      />
      <div className="mt-1 text-center text-[10px] leading-none text-zinc-600">—</div>
    </div>
  )
}

const TEAM_SIZE = 5

function TeamRow({
  label,
  labelClass,
  accent,
  players,
  keyToId,
  stats,
}: {
  label: string
  labelClass: string
  accent: string
  players: LoadingPlayer[]
  keyToId: Map<number, string>
  stats: RankedStatsData | null
}) {
  // Always render a full row of equal-width slots. A partial lobby (Practice
  // Tool, customs) pads with placeholders instead of letting one portrait
  // stretch across the whole panel.
  const slots = Math.max(TEAM_SIZE, players.length)
  return (
    <div className="px-3 py-2.5">
      <div className={`pb-1.5 text-[10px] font-semibold uppercase tracking-wider ${labelClass}`}>
        {label}
      </div>
      <div
        className="grid items-start gap-2"
        style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
      >
        {players.map((p, i) => (
          <PlayerCard
            key={`${p.name}-${i}`}
            player={p}
            keyToId={keyToId}
            accent={accent}
            stats={stats}
          />
        ))}
        {Array.from({ length: slots - players.length }).map((_, i) => (
          <EmptySlot key={`empty-${i}`} />
        ))}
      </div>
    </div>
  )
}

export function LoadingScreenPanel({
  data,
  champions,
}: {
  data: LoadingScreenState
  patch: string
  champions: DDragonChampion[]
}) {
  // Data Dragon numeric key (103) → champion id ("Ahri") for art URLs.
  const keyToId = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of champions) map.set(Number(c.key), c.id)
    return map
  }, [champions])
  // Per-elo champion stats for the "% champ" win-rate line (lazy chunk).
  const rankedStats = useRankedStats()

  return (
    <div className="flex h-screen w-screen items-center justify-center p-4">
      <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-lg border border-zinc-700/60 bg-zinc-950/95 text-zinc-100 shadow-2xl">
        <div className="flex items-baseline justify-between border-b border-zinc-800 px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
            Loading Screen · Scouting Report
          </span>
          <span className="text-[10px] text-zinc-500">
            switches to the in-game card when the match starts
          </span>
        </div>
        {/* Both teams laid out like League: five portraits across, yours on
            top and the enemy below. */}
        <div className="divide-y divide-zinc-800">
          <TeamRow
            label="Your Team"
            labelClass="text-sky-400"
            accent="bg-sky-500"
            players={data.myTeam ?? []}
            keyToId={keyToId}
            stats={rankedStats}
          />
          <TeamRow
            label="Enemy Team"
            labelClass="text-red-400"
            accent="bg-red-500"
            players={data.enemyTeam ?? []}
            keyToId={keyToId}
            stats={rankedStats}
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
