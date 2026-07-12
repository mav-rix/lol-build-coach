// Preload for the MAIN app window: a minimal, whitelisted bridge for update UX.
// contextIsolation is on — the page only sees these three calls.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('appUpdates', {
  /**
   * Fires on every update-state change:
   * { version, state: 'available' | 'downloading' | 'ready', percent?, file? }
   */
  onUpdateReady: (cb) => {
    const listener = (_e, info) => cb(info)
    ipcRenderer.on('app:update-ready', listener)
    return () => ipcRenderer.removeListener('app:update-ready', listener)
  },
  /** Ask main whether an update is already known (covers late mounts). */
  getPendingUpdate: () => ipcRenderer.invoke('app:get-pending-update'),
  /** Start downloading the available update (manual flow — user-initiated). */
  downloadUpdate: () => ipcRenderer.send('app:download-update'),
  /** Quit and install the downloaded update now. */
  installUpdate: () => ipcRenderer.send('app:install-update'),
})
