import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { GameMode, Role } from '@/types/app'

declare global {
  interface Window {
    // Exposed by electron/preload.js and electron/app-preload.js; absent in a plain browser (npm run
    // dev), where localStorage is used instead — see `storage` below.
    appStore?: {
      get: () => Promise<string | null>
      set: (value: string) => void
      onUpdate: (cb: (value: string | null) => void) => () => void
    }
  }
}

// Settings live in a userData file via IPC when packaged (see electron/main.js),
// not in browser localStorage: localStorage is scoped per-origin including the
// port, and the embedded server's port is now ephemeral (see electron/server.js
// for why). Falls back to localStorage outside Electron.
const storage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === 'undefined') return null
    if (window.appStore) return window.appStore.get()
    return window.localStorage.getItem(name)
  },
  setItem: async (name, value) => {
    if (typeof window === 'undefined') return
    if (window.appStore) return window.appStore.set(value)
    window.localStorage.setItem(name, value)
  },
  removeItem: async (name) => {
    if (typeof window === 'undefined') return
    if (window.appStore) return window.appStore.set('')
    window.localStorage.removeItem(name)
  },
}

interface AppState {
  selectedChampionId: string | null
  selectedRole: Role | null
  selectedMode: GameMode
  enemyChampionIds: (string | null)[] // always length 5
  autoOpenBuild: boolean // jump to /build when champ select begins
  showServerStatus: boolean // nav pill for the League server-status badge
  overlayEnabled: boolean // master on/off for the in-game overlay
  overlayShowBuild: boolean // build-path/build-next panel
  overlayShowEnemies: boolean // enemy-comp panel
  overlayShowAugmentBadges: boolean // Mayhem augment-pick vision badges
  selectChampion: (championId: string | null) => void
  selectRole: (role: Role | null) => void
  selectMode: (mode: GameMode) => void
  setEnemyChampion: (slot: number, championId: string | null) => void
  clearEnemies: () => void
  setAutoOpenBuild: (on: boolean) => void
  setShowServerStatus: (on: boolean) => void
  setOverlayEnabled: (on: boolean) => void
  setOverlayShowBuild: (on: boolean) => void
  setOverlayShowEnemies: (on: boolean) => void
  setOverlayShowAugmentBadges: (on: boolean) => void
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
      showServerStatus: true,
      overlayEnabled: true,
      overlayShowBuild: true,
      overlayShowEnemies: true,
      overlayShowAugmentBadges: true,
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
      setShowServerStatus: (on) => set({ showServerStatus: on }),
      setOverlayEnabled: (on) => set({ overlayEnabled: on }),
      setOverlayShowBuild: (on) => set({ overlayShowBuild: on }),
      setOverlayShowEnemies: (on) => set({ overlayShowEnemies: on }),
      setOverlayShowAugmentBadges: (on) => set({ overlayShowAugmentBadges: on }),
    }),
    { name: 'lol-build-coach', storage: createJSONStorage(() => storage) },
  ),
)

// The main window and the overlay are separate renderers, each with its own
// store instance; persist only reads on store creation. A selection made in
// one window (champ-select auto-fill, a role/mode change) would never reach
// the other, so the two could recommend different builds whenever the live
// API doesn't decide the value itself (no position in blind pick/practice
// tool, champion/mode fallbacks out of game). Rehydrate on every OTHER
// window's write to keep all windows on the same selections: the IPC broadcast
// in Electron (electron/main.js), or the browser 'storage' event outside it.
if (typeof window !== 'undefined') {
  if (window.appStore) {
    window.appStore.onUpdate(() => void useAppStore.persist.rehydrate())
  } else {
    window.addEventListener('storage', (e) => {
      if (e.key === 'lol-build-coach') void useAppStore.persist.rehydrate()
    })
  }
}
