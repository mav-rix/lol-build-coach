import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GameMode, Role } from '@/types/app'

interface AppState {
  selectedChampionId: string | null
  selectedRole: Role | null
  selectedMode: GameMode
  enemyChampionIds: (string | null)[] // always length 5
  autoOpenBuild: boolean // jump to /build when champ select begins
  selectChampion: (championId: string | null) => void
  selectRole: (role: Role | null) => void
  selectMode: (mode: GameMode) => void
  setEnemyChampion: (slot: number, championId: string | null) => void
  clearEnemies: () => void
  setAutoOpenBuild: (on: boolean) => void
}

const EMPTY_ENEMIES: (string | null)[] = [null, null, null, null, null]

/** Pre-game selections, persisted so the Live tracker sees them mid-game. */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedChampionId: null,
      selectedRole: null,
      selectedMode: 'SR',
      enemyChampionIds: EMPTY_ENEMIES,
      autoOpenBuild: true,
      selectChampion: (championId) => set({ selectedChampionId: championId }),
      selectRole: (role) => set({ selectedRole: role }),
      selectMode: (mode) => set({ selectedMode: mode }),
      setEnemyChampion: (slot, championId) =>
        set((s) => {
          const enemyChampionIds = [...s.enemyChampionIds]
          enemyChampionIds[slot] = championId
          return { enemyChampionIds }
        }),
      clearEnemies: () => set({ enemyChampionIds: EMPTY_ENEMIES }),
      setAutoOpenBuild: (on) => set({ autoOpenBuild: on }),
    }),
    { name: 'lol-build-coach' },
  ),
)

// The main window and the overlay are separate renderers, each with its own
// store instance; persist only reads localStorage once, at store creation. A
// selection made in one window (champ-select auto-fill, a role/mode change)
// would never reach the other, so the two could recommend different builds
// whenever the live API doesn't decide the value itself (no position in blind
// pick/practice tool, champion/mode fallbacks out of game). The storage event
// fires in every OTHER same-origin window on each persisted write — rehydrate
// there to keep all windows on the same selections.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'lol-build-coach') void useAppStore.persist.rehydrate()
  })
}
