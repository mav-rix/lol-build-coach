import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GameMode, Role } from '@/types/app'

interface AppState {
  selectedChampionId: string | null
  selectedRole: Role | null
  selectedMode: GameMode
  enemyChampionIds: (string | null)[] // always length 5
  selectChampion: (championId: string | null) => void
  selectRole: (role: Role | null) => void
  selectMode: (mode: GameMode) => void
  setEnemyChampion: (slot: number, championId: string | null) => void
  clearEnemies: () => void
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
    }),
    { name: 'lol-build-coach' },
  ),
)
