import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { BuildNext } from '@/components/BuildNext'
import { EnemyThreats } from '@/components/EnemyThreats'
import { ItemIcon } from '@/components/ItemIcon'
import { useLiveBuildState } from '@/hooks/useLiveBuildState'
import { formatClock } from '@/lib/analysis'

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

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t border-zinc-800/70 px-2.5 py-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
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
  } = useLiveBuildState()

  useOverlayDrag()

  useEffect(() => {
    document.documentElement.style.background = 'transparent'
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
    <div className="ml-auto w-[22rem] overflow-hidden rounded-md border border-zinc-800/80 bg-zinc-950/92 text-zinc-100 shadow-xl backdrop-blur-sm">
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
        <Section label="Build Path">
          <div className="flex flex-wrap items-center gap-1">
            {pathItems.map((p, i) => {
              const owned = ownedIds.has(p.itemId)
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
