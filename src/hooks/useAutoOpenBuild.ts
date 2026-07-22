import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useChampSelect } from '@/hooks/useChampSelect'
import { useAppStore } from '@/store/useAppStore'

// The gameflow phase that surfaces the build page: champ select has begun, so
// the player has committed to the game (an accepted queue, past the
// accept/decline dialog). Landing on /build here lets champ-select auto-fill do
// its work the moment the player looks at the app.
const OPEN_ON = new Set(['ChampSelect'])

/**
 * Navigates the main window to /build on the rising edge of champ select, so
 * entering the draft automatically surfaces the build page.
 *
 * Edge-triggered: it fires once per transition into the phase, never every
 * poll, so the player stays free to browse elsewhere afterward without being
 * yanked back. It also stays put if they're already on /build.
 */
export function useAutoOpenBuild(): void {
  const { phase } = useChampSelect()
  const enabled = useAppStore((s) => s.autoOpenBuild)
  const navigate = useNavigate()
  const location = useLocation()
  const prevPhase = useRef(phase)

  useEffect(() => {
    const justEntered = OPEN_ON.has(phase) && !OPEN_ON.has(prevPhase.current)
    prevPhase.current = phase
    if (enabled && justEntered && location.pathname !== '/build') navigate('/build')
  }, [phase, enabled, navigate, location.pathname])
}
