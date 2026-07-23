import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BuildNext } from '@/components/BuildNext'
import { EnemyThreats } from '@/components/EnemyThreats'
import { ItemIcon } from '@/components/ItemIcon'
import { LoadingScreenPanel } from '@/components/LoadingScreenPanel'
import { useLiveBuildState } from '@/hooks/useLiveBuildState'
import { useLoadingScreen } from '@/hooks/useLoadingScreen'
import { formatClock } from '@/lib/analysis'
import {
  augmentBadgeFor,
  loadAugmentData,
  visionManifest,
  type VisionTemplate,
} from '@/lib/augments'
import { starterOwned } from '@/lib/gameplan'

// Compact in-game overlay, rendered inside a transparent always-on-top Electron
// window. u.gg-style: one flat, near-opaque dark panel, hairline-divided
// sections, tabular numbers, orange = actionable / green = done / red = threat.
// Minimal chrome, maximal readable data.

interface VisionCard {
  key: string
  score: number
  cx: number
  cy: number
}

interface VisionPayload {
  cards: VisionCard[]
  iconSize: number
  origin: { x: number; y: number }
}

declare global {
  interface Window {
    // Exposed by overlay/preload.js; absent in a plain browser. The vision*
    // surface only exists in the packaged app (electron/preload.js).
    overlay?: {
      reportHandles?: (rects: { x: number; y: number; w: number; h: number }[]) => void
      onGripHover?: (cb: (hover: boolean) => void) => () => void
      beginDrag: () => void
      dragTo: (dx: number, dy: number) => void
      endDrag: () => void
      setLoadingLayout: (active: boolean) => void
      visionStart?: (manifest: VisionTemplate[]) => void
      visionStop?: () => void
      visionSetAlive?: (alive: boolean) => void
      onVisionOffer?: (cb: (payload: VisionPayload | null) => void) => () => void
    }
  }
}

// Lets you drag the whole overlay window by its grip, and returns whether the
// pointer is over a [data-drag-handle] element (drives hover-expand).
//
// In Electron the window is click-through with NO mouse-move forwarding —
// forward:true installs a global mouse hook that lags the real in-game cursor —
// so hover can't be observed from here. Instead this reports the handle rects
// to main, which polls the cursor against them, flips the window interactive
// while the pointer is over one, and pushes the hover state back down. Once
// interactive, real mouse events arrive and the drag works normally. In a
// plain browser (no bridge) hover falls back to mouse-move target checks so
// previews still expand.
function useOverlayDrag(): boolean {
  const [handleHover, setHandleHover] = useState(false)
  useEffect(() => {
    const api = window.overlay
    let dragging = false
    let startX = 0
    let startY = 0
    const isHandle = (t: EventTarget | null) =>
      t instanceof Element && Boolean(t.closest('[data-drag-handle]'))
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !isHandle(e.target) || !api) return
      dragging = true
      startX = e.screenX
      startY = e.screenY
      api.beginDrag()
      e.preventDefault()
    }
    const onMove = (e: MouseEvent) => {
      if (dragging) api?.dragTo(e.screenX - startX, e.screenY - startY)
    }
    const onUp = () => {
      if (dragging) {
        dragging = false
        api?.endDrag()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)

    const cleanups: (() => void)[] = []
    if (api?.onGripHover) {
      cleanups.push(api.onGripHover(setHandleHover))
      // Handle rects move when the card expands/collapses or content reflows;
      // re-measure on a short interval and resend only on change.
      let last = ''
      const report = () => {
        const rects = Array.from(document.querySelectorAll('[data-drag-handle]')).map((el) => {
          const r = el.getBoundingClientRect()
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          }
        })
        const key = JSON.stringify(rects)
        if (key !== last) {
          last = key
          api.reportHandles?.(rects)
        }
      }
      report()
      const t = window.setInterval(report, 300)
      cleanups.push(() => window.clearInterval(t))
    } else {
      const hoverMove = (e: MouseEvent) => setHandleHover(isHandle(e.target))
      window.addEventListener('mousemove', hoverMove)
      cleanups.push(() => window.removeEventListener('mousemove', hoverMove))
    }
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      cleanups.forEach((fn) => fn())
    }
  }, [])
  return handleHover
}

// Collapsed-by-default card. Expansion must be INTENTIONAL: the pointer has to
// dwell on the strip for a beat first, so the cursor merely sweeping across it
// mid-fight doesn't pop the card open. Once expanded it lingers after the
// pointer leaves so it doesn't vanish the instant the pointer slips off.
function useHoverExpand(gripHover: boolean, dwellMs = 400, lingerMs = 1200): boolean {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setExpanded(gripHover), gripHover ? dwellMs : lingerMs)
    return () => window.clearTimeout(t)
  }, [gripHover, dwellMs, lingerMs])
  return expanded
}

// Grab grip — press-and-hold left mouse here to move the overlay.
function DragGrip({ className = '' }: { className?: string }) {
  return (
    <div
      data-drag-handle
      title="Drag to move — press and hold the left mouse button"
      className={`flex cursor-grab items-center justify-center gap-[3px] active:cursor-grabbing ${className}`}
    >
      <span className="h-[3px] w-[3px] rounded-full bg-zinc-600" />
      <span className="h-[3px] w-[3px] rounded-full bg-zinc-600" />
      <span className="h-[3px] w-[3px] rounded-full bg-zinc-600" />
    </div>
  )
}

// Screen-capture augment identification (packaged app only): while an offer
// window is active, main watches the display for the pick screen and reports
// which augment art sits on each card (electron/augment-vision.js). The window
// is swapped to cover the display and this hook's payload drives % badges
// rendered directly over the cards. ?badgemock=1 fabricates a payload for
// previews/screenshots (1080p geometry, no IPC needed).
function useAugmentVision(active: boolean, isDead: boolean): VisionPayload | null {
  const [payload, setPayload] = useState<VisionPayload | null>(null)
  const [, setDataReady] = useState(false)
  // Report alive/dead to main so its scan loop can slow down during live play
  // (the augment pick screen only appears while dead). Cuts screen-capture load
  // during teamfights.
  useEffect(() => {
    if (active) window.overlay?.visionSetAlive?.(!isDead)
  }, [active, isDead])
  // Load the augment stats cache in whatever renderer shows the badges. The
  // dedicated badge window (?badges=1) renders the pills but runs with
  // active=false — it only receives detections over IPC — so without loading
  // here its augmentBadgeFor cache stays null and EVERY pill reads "no stats
  // yet". Re-render on ready so an already-received payload picks up its stats.
  useEffect(() => {
    let cancelled = false
    void loadAugmentData().then(() => {
      if (!cancelled) setDataReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => window.overlay?.onVisionOffer?.((p) => setPayload(p)), [])
  useEffect(() => {
    const api = window.overlay
    if (!api?.visionStart || !active) return
    let cancelled = false
    loadAugmentData().then(() => {
      if (!cancelled) api.visionStart!(visionManifest())
    })
    return () => {
      cancelled = true
      api.visionStop?.()
      setPayload(null)
    }
  }, [active])
  const mock = new URLSearchParams(window.location.search).has('badgemock')
  if (mock && active) {
    return {
      cards: [
        { key: 'x:2103', score: 0.91, cx: 598, cy: 312 }, // From Downtown
        { key: 'x:1150', score: 0.9, cx: 965, cy: 312 }, // Bread And Jam
        { key: 'x:1133', score: 0.91, cx: 1335, cy: 312 }, // Magic Missile
      ],
      iconSize: 140,
      origin: { x: 0, y: 0 },
    }
  }
  return payload
}

const RARITY_BADGE: Record<string, string> = {
  prismatic: 'border-violet-400/70 text-violet-200',
  gold: 'border-amber-400/70 text-amber-200',
  silver: 'border-zinc-400/60 text-zinc-200',
}
const RARITY_FILL: Record<string, string> = {
  prismatic: 'bg-violet-400',
  gold: 'bg-amber-400',
  silver: 'bg-zinc-300',
}

// One pill per detected card, centered under the card's icon. The name is
// always shown — Riot reuses identical art across some augments, so when the
// match is an art-sibling the mismatched name tells the player to ignore it.
// Pick rate renders as a filled bar (Porofessor-style): champion-specific when
// that sample exists, otherwise the all-champions rate.
// op.gg augment tier (0=S … 4=D) → label + color.
const MAYHEM_TIER = ['S', 'A', 'B', 'C', 'D']
const MAYHEM_TIER_COLOR = [
  'text-amber-300 border-amber-400/70',
  'text-emerald-300 border-emerald-400/60',
  'text-sky-300 border-sky-400/60',
  'text-zinc-300 border-zinc-400/50',
  'text-zinc-400 border-zinc-500/50',
]

function AugmentBadges({ payload, championId }: { payload: VisionPayload; championId: string | null }) {
  const badges = payload.cards.map((card) => ({ card, badge: augmentBadgeFor(championId, card.key) }))
  // The pick-rate bar is RELATIVE to the best rate among the three cards on
  // screen: absolute Mayhem rates run 1–9% across a 260-augment pool, which
  // fills almost nothing. Relative length answers "which of THESE three is the
  // popular pick" while the label keeps the true %. Prefer Mayhem (op.gg)
  // pick rate; fall back to the Arena proxy rate for augments op.gg doesn't
  // list.
  const rateOf = (b: ReturnType<typeof augmentBadgeFor>) => b?.mayhem?.pickRate ?? b?.stat?.pickRate ?? 0
  const maxRate = Math.max(...badges.map(({ badge }) => rateOf(badge)), 0.01)
  return (
    <div className="relative h-screen w-screen">
      {badges.map(({ card, badge }) => {
        if (!badge) return null
        // Mayhem stats are mode-accurate and preferred; Arena proxy is the
        // fallback signal for dual-pool augments op.gg doesn't cover.
        const m = badge.mayhem
        const pickRate = m?.pickRate ?? badge.stat?.pickRate ?? null
        const forChamp = m ? badge.mayhemSource === 'champion' : badge.source === 'champion'
        const tier = m ? MAYHEM_TIER[m.tier] : null
        return (
          <div
            key={card.key}
            style={{
              left: card.cx - payload.origin.x,
              // Anchor just above the card's top edge (icon center minus one
              // icon height clears the frame at any resolution), pill grows up.
              top: card.cy - payload.origin.y - payload.iconSize,
            }}
            className={`absolute flex w-40 -translate-x-1/2 -translate-y-full flex-col items-center gap-1 rounded-2xl border bg-zinc-950/85 px-3.5 py-2 text-center ${
              RARITY_BADGE[badge.rarity ?? ''] ?? 'border-zinc-600/60 text-zinc-200'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {tier && (
                <span
                  className={`rounded border px-1 text-[10px] font-bold leading-tight ${MAYHEM_TIER_COLOR[m!.tier] ?? MAYHEM_TIER_COLOR[4]}`}
                >
                  {tier}
                </span>
              )}
              <span className="text-xs font-semibold leading-tight">{badge.name}</span>
            </div>
            {pickRate != null ? (
              <>
                <div className="flex w-full items-center gap-1.5">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-700/70">
                    <div
                      className={`h-full rounded-full ${RARITY_FILL[badge.rarity ?? ''] ?? 'bg-zinc-300'}`}
                      style={{ width: `${Math.min(100, Math.max(6, (pickRate / maxRate) * 100))}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] font-semibold tabular-nums leading-none">
                    {pickRate}%
                  </span>
                </div>
                <span className="font-mono text-[10px] tabular-nums leading-none text-zinc-400">
                  {forChamp ? 'picked · this champ' : 'picked · all champs'}
                </span>
              </>
            ) : (
              <span className="text-[11px] leading-tight text-zinc-500">no stats yet</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Section({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`border-t border-zinc-700/30 px-2.5 py-2 ${className}`}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      {children}
    </div>
  )
}

export default function Overlay() {
  const {
    live,
    isInGame,
    staticData,
    items,
    patch,
    self,
    championId,
    plan,
    ownedIds,
    nextPlanItem,
    recommendations,
    affordable,
    threats,
    gold,
    scores,
    gameTime,
    csPerMin,
    augmentMode,
  } = useLiveBuildState()

  // ?badges=1: this render is the dedicated badge window (see main.js) — it
  // only ever displays vision payloads pushed to it. Sensing/arming stays with
  // the primary overlay window, which knows the offer/death state.
  const badgesOnly = new URLSearchParams(window.location.search).has('badges')

  // Loading screen: centered scouting report instead of the transparent side
  // card. Main resizes/centers the window (and forces it visible) while active.
  // The Live Client API already responds while the loading screen is still up,
  // so "the game started" means the match clock is running — not merely that
  // the API is reachable. That keeps the report up for the whole load.
  const gameStarted = isInGame && gameTime > 0
  const loading = useLoadingScreen(gameStarted)
  const showLoading =
    loading.show &&
    !gameStarted &&
    ((loading.myTeam?.length ?? 0) > 0 || (loading.enemyTeam?.length ?? 0) > 0)
  useEffect(() => {
    // The badge window must never drive the loading-layout swap — that's the
    // primary overlay window's job, and both reporting would fight over it.
    if (!badgesOnly) window.overlay?.setLoadingLayout(showLoading)
  }, [showLoading, badgesOnly])
  useEffect(() => () => window.overlay?.setLoadingLayout(false), [])

  const gripHover = useOverlayDrag()
  const hoverExpanded = useHoverExpand(gripHover)
  // Armed for the entire Mayhem game: the pick screen can appear at ANY death
  // after an unlock (or via the AUGMENTS button whenever a pick is banked), so
  // windowed arming kept missing it. Probes are cheap half-res captures — the
  // expensive full capture + OCR only runs when a probe sees the cards.
  const visionOffer = useAugmentVision(
    !badgesOnly && augmentMode && gameStarted,
    self?.isDead ?? false,
  )
  // ?expand=1 (mock/dev only): force the full card for previews/screenshots,
  // where there's no real pointer to hover the grip with.
  const forceExpand = new URLSearchParams(window.location.search).has('expand')
  const expanded = hoverExpanded || forceExpand

  useEffect(() => {
    // ?bg=1 (mock/dev only): stand-in for game terrain, to preview how
    // transparent the card really is. In the real overlay both stay transparent.
    const demoBg = new URLSearchParams(window.location.search).has('bg')
      ? 'linear-gradient(135deg,#3b6b35 0%,#7ba05b 35%,#c8b35a 65%,#4a7ec2 100%)'
      : 'transparent'
    document.documentElement.style.background = demoBg
    document.body.style.background = 'transparent'
    return () => {
      document.documentElement.style.background = ''
      document.body.style.background = ''
    }
  }, [])

  // Dedicated badge window: badges or nothing, no other overlay modes.
  if (badgesOnly) {
    return visionOffer ? <AugmentBadges payload={visionOffer} championId={championId} /> : null
  }

  if (showLoading) {
    return (
      <LoadingScreenPanel
        data={loading}
        patch={patch}
        champions={staticData?.champions ?? []}
      />
    )
  }

  // Out of game the overlay renders nothing — except the Fullscreen warning,
  // which is the one thing worth surfacing before a game starts (the overlay
  // can never appear over exclusive Fullscreen, so warn while it's fixable).
  if (!isInGame || !live) {
    return (
      <div className="flex flex-col items-end gap-1 p-2">
        {loading.windowMode === 0 && (
          <span className="max-w-[20rem] rounded border border-amber-700/60 bg-zinc-950/90 px-2.5 py-1 text-[11px] leading-snug text-amber-300">
            League is set to Fullscreen — the overlay can&apos;t appear in-game. Switch Window
            Mode to Borderless (in-game Settings → Video).
          </span>
        )}
      </div>
    )
  }

  const name = self?.championName ?? championId ?? 'In Game'
  const kda = scores ? `${scores.kills}/${scores.deaths}/${scores.assists}` : '—'
  // Show substantive starters (jungle pet, World Atlas, Doran's) in the path —
  // they're the mandatory first buy — but not consumables like potions.
  const pathItems = plan.filter(
    (p) =>
      p.label !== 'starter' ||
      !(items[String(p.itemId)]?.tags.includes('Consumable') ?? true),
  )

  // Real detections render in the dedicated badge window (?badges=1); in this
  // window a payload only ever exists via ?badgemock=1 previews.
  if (visionOffer) {
    return <AugmentBadges payload={visionOffer} championId={championId} />
  }

  // Collapsed strip: the next unowned buys + gold + clock, nothing else. The
  // whole strip is a drag handle, so hovering it anywhere expands the card
  // (and lets you drag). Transformation-aware via starterOwned, like the card.
  if (!expanded) {
    const upcoming = pathItems.filter((p) => !starterOwned(p.itemId, ownedIds)).slice(0, 3)
    return (
      <div
        data-drag-handle
        title="Hover to expand — press and hold the left mouse button to drag"
        className="ml-auto flex w-fit cursor-grab items-center gap-2 rounded-md border border-zinc-700/40 bg-zinc-950/45 px-2 py-1 text-zinc-100 active:cursor-grabbing [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]"
      >
        <span className="flex items-center gap-[3px]" aria-hidden>
          <span className="h-[3px] w-[3px] rounded-full bg-zinc-600" />
          <span className="h-[3px] w-[3px] rounded-full bg-zinc-600" />
          <span className="h-[3px] w-[3px] rounded-full bg-zinc-600" />
        </span>
        {upcoming.map((p) => (
          <div
            key={`${p.label}-${p.itemId}`}
            title={items[String(p.itemId)]?.name}
            className={`rounded ${
              nextPlanItem?.itemId === p.itemId ? 'ring-1 ring-orange-500' : 'opacity-60'
            }`}
          >
            <ItemIcon itemId={p.itemId} patch={patch} items={items} size={20} />
          </div>
        ))}
        <span
          className={`font-mono text-xs tabular-nums ${
            affordable ? 'font-semibold text-orange-400' : 'text-amber-300'
          }`}
        >
          {Math.floor(gold).toLocaleString()}g
        </span>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          {formatClock(gameTime)}
        </span>
      </div>
    )
  }

  return (
    // Mostly-transparent chrome: the game should read through the card. Text
    // stays legible over bright terrain via an inherited text-shadow; icons and
    // the key numbers (gold, costs) carry the contrast.
    <div className="ml-auto w-[22rem] overflow-hidden rounded-md border border-zinc-700/40 bg-zinc-950/45 text-zinc-100 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
      {/* Grip — press-and-hold left mouse to drag the overlay */}
      <DragGrip className="py-1" />
      {/* Header — identity + live stat line, all tabular */}
      <div className="px-2.5 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-sm font-bold tracking-wide text-zinc-100">{name}</span>
            <span className="text-[10px] font-semibold text-zinc-500">Lv{live.activePlayer.level}</span>
          </div>
          <span className="font-mono text-xs tabular-nums text-zinc-400">{formatClock(gameTime)}</span>
        </div>
        <div className="flex items-center gap-3 pb-2 pt-0.5 font-mono text-xs tabular-nums">
          <span className={affordable ? 'font-semibold text-orange-400' : 'text-amber-300'}>
            {Math.floor(gold).toLocaleString()}g
          </span>
          <span className="text-zinc-300">{kda}</span>
          <span className="text-zinc-500">{csPerMin.toFixed(1)} cs/m</span>
        </div>
      </div>

      {recommendations.length > 0 && (
        <Section label="Build Next">
          <BuildNext compact recommendations={recommendations} patch={patch} items={items} />
        </Section>
      )}

      {pathItems.length > 0 && (
        <Section label="Build Path · highest WR">
          <div className="flex flex-wrap items-center gap-1">
            {pathItems.map((p, i) => {
              // Transformation-aware: pets evolve, the support item upgrades.
              const owned = starterOwned(p.itemId, ownedIds)
              const isNext = nextPlanItem?.itemId === p.itemId
              return (
                <div key={`${p.label}-${p.itemId}`} className="flex items-center gap-1">
                  <div
                    title={items[String(p.itemId)]?.name}
                    className={`rounded ${
                      owned
                        ? 'ring-1 ring-emerald-600/70'
                        : isNext
                          ? 'ring-1 ring-orange-500'
                          : 'opacity-40'
                    }`}
                  >
                    <ItemIcon itemId={p.itemId} patch={patch} items={items} size={26} />
                  </div>
                  {i < pathItems.length - 1 && (
                    <span className="text-[10px] text-zinc-700" aria-hidden>
                      ›
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {threats && staticData && threats.enemies.length > 0 && (
        <Section label="Enemies">
          <EnemyThreats
            compact
            threats={threats}
            patch={patch}
            items={items}
            championsById={staticData.championsById}
          />
        </Section>
      )}
    </div>
  )
}
