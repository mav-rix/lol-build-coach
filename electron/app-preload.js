// Preload for the MAIN app window: a minimal, whitelisted bridge for update UX.
// contextIsolation is on — the page only sees these three calls.
const { contextBridge, ipcRenderer } = require('electron')

// App-settings store (see electron/main.js). Duplicated identically in
// preload.js rather than shared via require('./store-bridge') — sandboxed
// preload scripts can only require('electron'), not local files; that require
// silently killed this ENTIRE preload script (including the bridge below) the
// first time this was tried. Keep the two copies in sync by hand.
contextBridge.exposeInMainWorld('appStore', {
  get: () => ipcRenderer.invoke('store:get'),
  set: (value) => ipcRenderer.send('store:set', value),
  onUpdate: (cb) => {
    const listener = (_e, value) => cb(value)
    ipcRenderer.on('store:update', listener)
    return () => ipcRenderer.removeListener('store:update', listener)
  },
})

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
  /** Trigger an on-demand update check (button in the app / tray). */
  checkForUpdates: () => ipcRenderer.send('app:check-updates'),
  /** Manual-check feedback: 'checking' | 'uptodate' | 'found' | 'error'. */
  onCheckStatus: (cb) => {
    const listener = (_e, status) => cb(status)
    ipcRenderer.on('app:check-status', listener)
    return () => ipcRenderer.removeListener('app:check-status', listener)
  },
})
