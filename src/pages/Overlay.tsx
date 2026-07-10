import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { BuildNext } from '@/components/BuildNext'
import { EnemyThreats } from '@/components/EnemyThreats'
import { ItemIcon } from '@/components/ItemIcon'
import { useLiveBuildState } from '@/hooks/useLiveBuildState'
import { formatClock } from '@/lib/analysis'
import { loadAugmentData, topAugmentsFor, type AugmentGoal } from '@/lib/augments'

// Compact in-game overlay, rendered inside a transparent always-on-top Electron
// window. u.gg-style: one flat, near-opaque dark panel, hairline-divided
// sections, tabular numbers, orange = actionable / green = done / red = threat.
// Minimal chrome, maximal readable data.

declare global {
  interface Window {
    // Exposed by overlay/preload.js; absent in a plain browser.
    overlay?: {
      setHover: (hover: boolean) => void
      beginDrag: () => void
      dragTo: (dx: number, dy: number) => void
      endDrag: () => void
    }
  }
}

// Lets you drag the whole overlay window by its grip. Grabbable any time: while
// the pointer is over a [data-drag-handle] element, main stops ignoring mouse
// events (via the preload bridge) so a left press-and-hold there moves the
// window; the rest of the overlay stays click-through so it never blocks the
// game. No-op in a plain browser (no window.overlay bridge).
function useOverlayDrag() {
  useEffect(() => {
    const api = window.overlay
    if (!api) return
    let dragging = false
    let hovering = false
    let startX = 0
    let startY = 0
    const isHandle = (t: EventTarget | null) =>
      t instanceof Element && Boolean(t.closest('[data-drag-handle]'))
    const setHover = (h: boolean) => {
      if (h !== hovering) {
        hovering = h
        api.setHover(h)
      }
    }
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !isHandle(e.target)) return
      dragging = true
      startX = e.screenX
      startY = e.screenY
      api.beginDrag()
      e.preventDefault()
    }
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        api.dragTo(e.screenX - startX, e.screenY - startY)
        return
      }
      setHover(isHandle(e.target))
    }
    const onUp = (e: MouseEvent) => {
      if (dragging) {
        dragging = false
        api.endDrag()
      }
      setHover(isHandle(e.target))
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])
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

// Highest win-rate augments for this champion (ARAM Mayhem). The API doesn't
// expose the live augment offer, so these are GOALS: when the pick screen
// appears, take one of these — otherwise reroll. Lazy-loads the augment data
// only in augmented modes.
function useAugmentGoals(championId: string | null, enabled: boolean): AugmentGoal[] {
  const [goals, setGoals] = useState<AugmentGoal[]>([])
  useEffect(() => {
    if (!enabled || !championId) return
    let active = true
    loadAugmentData().then(() => {
      if (active) setGoals(topAugmentsFor(championId, 5))
    })
    return () => {
      active = false
    }
  }, [championId, enabled])
  return enabled ? goals : []
}

const RARITY_DOT: Record<string, string> = {
  prismatic: 'bg-violet-400',
  gold: 'bg-amber-400',
  silver: 'bg-zinc-400',
}

function AugmentGoals({ goals }: { goals: AugmentGoal[] }) {
  return (
    <div className="space-y-1">
      {goals.map((g) => (
        <div key={g.id} className="flex items-center gap-2" title={g.meta.desc}>
          <img src={g.meta.icon} alt="" className="h-6 w-6 shrink-0 rounded bg-zinc-900" />
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RARITY_DOT[g.meta.rarity] ?? 'bg-zinc-500'}`} />
          <span
            className={`min-w-0 flex-1 truncate text-xs font-medium ${
              g.source === 'champion' ? 'text-zinc-100' : 'text-zinc-400'
            }`}
          >
            {g.meta.name}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-300">
            {g.avgPlacement.toFixed(1)} avg · {g.firstRate}%
          </span>
        </div>
      ))}
      <p className="pt-0.5 text-[10px] leading-tight text-zinc-600">
        Pick these when offered — none in the offer? Reroll.
      </p>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-zinc-700/30 px-2.5 py-2">
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
    gamePlan,
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

  const augmentGoals = useAugmentGoals(championId, augmentMode)

  useOverlayDrag()

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

  if (!isInGame || !live) {
    return (
      <div className="flex justify-end p-2">
        <span
          data-drag-handle
          title="Drag to move — press and hold the left mouse button"
          className="cursor-grab rounded border border-zinc-800 bg-zinc-950/90 px-2.5 py-1 font-mono text-[11px] tracking-wide text-zinc-400 active:cursor-grabbing"
        >
          LoL Build Coach — waiting for game…
        </span>
      </div>
    )
  }

  const name = self?.championName ?? championId ?? 'In Game'
  const kda = scores ? `${scores.kills}/${scores.deaths}/${scores.assists}` : '—'
  const pathItems = plan.filter((p) => p.label !== 'starter')

  return (
    // Mostly-transparent chrome: the game should read through the card. Text
    // stays legible over bright terrain via an inherited text-shadow; icons and
    // the key numbers (gold, costs) carry the contrast.
    <div className="ml-auto w-[22rem] overflow-hidden rounded-md border border-zinc-700/40 bg-zinc-950/45 text-zinc-100 backdrop-blur-[2px] [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
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

      {augmentMode && augmentGoals.length > 0 && (
        <Section label="Augment Goals">
          <AugmentGoals goals={augmentGoals} />
        </Section>
      )}

      {pathItems.length > 0 && (
        <Section
          label={`Build Path · ${gamePlan?.active === 'comp' ? 'vs comp' : 'highest WR'}`}
        >
          <div className="flex flex-wrap items-center gap-1">
            {pathItems.map((p, i) => {
              const owned = ownedIds.has(p.itemId)
              const isNext = nextPlanItem?.itemId === p.itemId
              return (
                <div key={`${p.label}-${p.itemId}`} className="flex items-center gap-1">
                  <div
                    title={
                      p.swapReason
                        ? `${items[String(p.itemId)]?.name} · ${p.swapReason}`
                        : items[String(p.itemId)]?.name
                    }
                    className={`rounded ${
                      owned
                        ? 'ring-1 ring-emerald-600/70'
                        : isNext
                          ? 'ring-1 ring-orange-500'
                          : p.swapReason
                            ? 'ring-1 ring-sky-500/70 opacity-70'
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
